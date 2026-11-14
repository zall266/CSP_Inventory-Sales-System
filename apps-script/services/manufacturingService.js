// Module 11 production orders and packing. Module 12 daily sessions.
// Ledger posts on packing.confirm, productionOrders.complete, sessions.complete,
// and completed-session stock edits. MANUAL components do not auto-out.

var PACKING_ACTIONS = {
  'packing.list': true,
  'packing.get': true,
  'packing.create': true,
  'packing.update': true,
  'packing.refresh': true,
  'packing.cancel': true,
  'packing.confirm': true
};

var PRODUCTION_ORDER_ACTIONS = {
  'productionOrders.list': true,
  'productionOrders.get': true,
  'productionOrders.create': true,
  'productionOrders.update': true,
  'productionOrders.start': true,
  'productionOrders.pause': true,
  'productionOrders.resume': true,
  'productionOrders.cancel': true,
  'productionOrders.updateConsumption': true,
  'productionOrders.addLine': true,
  'productionOrders.confirmConsumption': true,
  'productionOrders.recordWastage': true,
  'productionOrders.complete': true,
  'productionOrders.createPurchaseRequest': true
};

var SESSION_ACTIONS = {
  'sessions.list': true,
  'sessions.get': true,
  'sessions.create': true,
  'sessions.accept': true,
  'sessions.start': true,
  'sessions.cancelPlanned': true,
  'sessions.update': true,
  'sessions.amend': true,
  'sessions.changeTarget': true,
  'sessions.togglePicking': true,
  'sessions.addMaterial': true,
  'sessions.saveResult': true,
  'sessions.saveDistribution': true,
  'sessions.saveMaterialClosing': true,
  'sessions.complete': true,
  'sessions.continueCarryForward': true,
  'sessions.editCompleted': true,
  'sessions.editCompletedClosing': true
};

function createManufacturingService(deps) {
  var sheets = deps.sheetRepository;
  var drive = deps.driveStorage;
  var repository = createManufacturingRepository(sheets);
  var products = createProductRepository(sheets);
  var inventoryRepo = createInventoryRepository(sheets);
  var bomRepo = createBomRepository(sheets);
  var warehouseRepo = createWarehouseRepository(sheets);
  var masters = createMasterRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);
  var SESSION_PHOTO_FOLDER = 'RecipePhotos';
  var SESSION_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
  var SESSION_PHOTO_TYPES = { 'image/png': true, 'image/jpeg': true, 'image/webp': true };

  function canHandle(action) {
    return Boolean(PACKING_ACTIONS[action] || PRODUCTION_ORDER_ACTIONS[action] || SESSION_ACTIONS[action]);
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function round2(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function locked(fn) {
    return withScriptLock(function () {
      return fn(sheets.openSpreadsheet());
    });
  }

  function sheetRows(spreadsheet, name) {
    var sheet = sheets.getSheet(spreadsheet, name);
    if (!sheet) return [];
    return sheets.readObjects(sheet);
  }

  function flagCell(value) {
    return value === true || value === 'true' || value === 'TRUE';
  }

  function loadActor(spreadsheet, actorUserId, message) {
    var id = text(actorUserId).trim();
    if (!id) throw appError('FORBIDDEN', message);
    var match = null;
    sheetRows(spreadsheet, 'Users').forEach(function (row) {
      if (text(row.id).trim() === id) match = row;
    });
    if (!match || text(match.status).trim() !== 'active') throw appError('FORBIDDEN', message);
    return {
      id: text(match.id).trim(),
      name: text(match.name).trim() || text(match.id).trim(),
      roleId: text(match.roleId).trim(),
      role: text(match.role).trim(),
      status: 'active'
    };
  }

  function actorMay(spreadsheet, actor, key) {
    var roles = sheetRows(spreadsheet, 'Roles').map(function (row) {
      return {
        id: text(row.id).trim(),
        protected: flagCell(row.protected),
        legacyRole: text(row.legacyRole).trim()
      };
    });
    var matrix = {};
    sheetRows(spreadsheet, 'RolePermissions').forEach(function (row) {
      var roleId = text(row.roleId).trim();
      var permissionKey = text(row.permissionKey).trim();
      if (!roleId || !permissionKey) return;
      if (!matrix[roleId]) matrix[roleId] = {};
      matrix[roleId][permissionKey] = flagCell(row.allowed);
    });
    return hasPermission({ roles: roles, settings: { roleMatrix: matrix } }, key, actor);
  }

  function requirePermission(spreadsheet, actorUserId, key, message) {
    var actor = loadActor(spreadsheet, actorUserId, message);
    if (!actorMay(spreadsheet, actor, key)) throw appError('FORBIDDEN', message);
    return actor;
  }

  function requireKey(request) {
    if (!text(request && request.idempotencyKey).trim()) {
      throw appError('VALIDATION_ERROR', 'Idempotency key is required.');
    }
  }

  function clientId(value, prefix) {
    var id = text(value).trim();
    if (!id) return prefix + '_' + createId().replace(/-/g, '').slice(0, 10);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw appError('VALIDATION_ERROR', 'Id is not valid.');
    return id;
  }

  function movementIdFor(docId, index) {
    return 'mv_' + docId + '.' + (index + 1);
  }

  function nextDocNo(values, prefix, pad) {
    var width = pad || 4;
    var max = 0;
    (values || []).forEach(function (value) {
      var raw = text(value);
      if (raw.indexOf(prefix) !== 0) return;
      var n = Number(raw.slice(prefix.length));
      if (Number.isFinite(n) && n > max) max = n;
    });
    return prefix + String(max + 1).padStart(width, '0');
  }

  function systemAudit(spreadsheet, entry) {
    sheets.ensureSheet(spreadsheet, 'AuditLogs', typeof AUDIT_HEADERS !== 'undefined' ? AUDIT_HEADERS : [
      'auditId', 'timestamp', 'userId', 'action', 'entityType', 'entityId', 'reference', 'before', 'after', 'requestId'
    ]);
    audit.append(entry);
  }

  function findAudit(spreadsheet, action, entityType, entityId) {
    var found = null;
    sheetRows(spreadsheet, 'AuditLogs').forEach(function (row) {
      if (text(row.action).trim() === action &&
          text(row.entityType).trim() === entityType &&
          text(row.entityId).trim() === entityId) found = row;
    });
    return found;
  }

  function auditIdempotencyKey(row) {
    try {
      return text(JSON.parse(text(row.after)).idempotencyKey).trim();
    } catch (error) {
      return '';
    }
  }

  function allowNegative(spreadsheet) {
    var rows = sheetRows(spreadsheet, 'Settings');
    for (var i = 0; i < rows.length; i += 1) {
      if (text(rows[i].id).trim() === 'settings') return flagCell(rows[i].allowNegativeStock);
    }
    return false;
  }

  function qtyOf(balances, productId, warehouseId) {
    var current = 0;
    balances.forEach(function (row) {
      if (row.productId === productId && row.warehouseId === warehouseId) current = round2(row.qty);
    });
    return current;
  }

  function putQty(balances, productId, warehouseId, qty) {
    var found = false;
    var next = balances.map(function (row) {
      if (row.productId === productId && row.warehouseId === warehouseId) {
        found = true;
        return { productId: productId, warehouseId: warehouseId, qty: round2(qty) };
      }
      return row;
    });
    if (!found) next.push({ productId: productId, warehouseId: warehouseId, qty: round2(qty) });
    return next;
  }

  function requireCompanyWarehouse(spreadsheet, warehouseId) {
    var id = text(warehouseId).trim();
    if (!id) throw appError('VALIDATION_ERROR', 'Select a warehouse.');
    var found = null;
    masters.readWarehouses(spreadsheet).forEach(function (row) {
      if (row.id === id) found = row;
    });
    if (!found || found.kind !== 'company') throw appError('VALIDATION_ERROR', 'Choose a company warehouse.');
    return found;
  }

  function productById(list, id) {
    var match = null;
    list.forEach(function (row) {
      if (row.id === id) match = row;
    });
    return match;
  }

  function bomById(list, id) {
    var match = null;
    list.forEach(function (row) {
      if (row.id === id) match = row;
    });
    return match;
  }

  function snapshot(spreadsheet) {
    repository.ensure(spreadsheet);
    inventoryRepo.ensure(spreadsheet);
    warehouseRepo.ensure(spreadsheet);
    var movements = inventoryRepo.readMovements(spreadsheet);
    movements.reverse();
    return {
      packingAssemblies: repository.readPackings(spreadsheet),
      productionOrders: repository.readOrders(spreadsheet),
      batches: repository.readBatches(spreadsheet),
      productionSessions: repository.readSessions(spreadsheet),
      displayStocks: warehouseRepo.readDisplay(spreadsheet),
      productionBalances: warehouseRepo.readProductionBalances(spreadsheet),
      inventory: products.readBalances(spreadsheet).map(function (row) {
        return { productId: row.productId, warehouseId: row.warehouseId, qty: round2(row.qty) };
      }),
      stockMovements: movements
    };
  }

  function appendPostingLines(spreadsheet, actor, date, reference, warehouseId, docId, lines) {
    var movements = inventoryRepo.readMovements(spreadsheet);
    var posted = {};
    movements.forEach(function (row, index) {
      posted[row.id] = index;
    });
    var balances = products.readBalances(spreadsheet);
    lines.forEach(function (line, index) {
      var movementId = movementIdFor(docId, index);
      if (posted[movementId] !== undefined) {
        var prior = movements[posted[movementId]];
        if (prior.type !== line.type || prior.productId !== line.productId || prior.warehouseId !== warehouseId ||
            round2(prior.stockIn) !== round2(line.stockIn) || round2(prior.stockOut) !== round2(line.stockOut)) {
          throw appError('CONFLICT', 'Manufacturing movement already exists.');
        }
        var newer = movements.some(function (row, position) {
          return position > posted[movementId] && row.productId === line.productId &&
            row.warehouseId === warehouseId && text(row.id).indexOf('mv_' + docId + '.') !== 0;
        });
        if (!newer) balances = putQty(balances, line.productId, warehouseId, prior.balance);
        return;
      }
      var current = qtyOf(balances, line.productId, warehouseId);
      var balance = line.skipInventory ? current : round2(current + line.stockIn - line.stockOut);
      inventoryRepo.appendMovement(spreadsheet, {
        id: movementId,
        date: date,
        reference: reference,
        productId: line.productId,
        warehouseId: warehouseId,
        type: line.type,
        stockIn: line.stockIn,
        stockOut: line.stockOut,
        balance: balance,
        user: actor.name,
        notes: line.notes || ''
      });
      if (!line.skipInventory) balances = putQty(balances, line.productId, warehouseId, balance);
    });
    products.writeBalances(spreadsheet, balances);
    return balances;
  }

  function requireActiveProduct(list, productId, label) {
    var product = productById(list, text(productId).trim());
    if (!product) throw appError('VALIDATION_ERROR', label || 'Select an output product');
    if (product.status !== 'active') throw appError('VALIDATION_ERROR', 'Output product is inactive.');
    return product;
  }

  function activeBomsForProduct(boms, productId) {
    return boms.filter(function (bom) {
      return bom.productId === productId && bom.status === 'active';
    });
  }

  function buildPackingDraft(spreadsheet, payload, existing, options) {
    var productList = products.readProducts(spreadsheet);
    var boms = bomRepo.readBoms(spreadsheet);
    var product = requireActiveProduct(productList, payload.productId, 'Select an output product');
    requireCompanyWarehouse(spreadsheet, payload.warehouseId);
    var plannedQty = Number(payload.plannedQty);
    var actualQty = Number(payload.actualQty);
    var qtyError = packingValidateQuantities(plannedQty, actualQty, product.unit);
    if (qtyError) throw appError('VALIDATION_ERROR', qtyError);
    var active = activeBomsForProduct(boms, product.id);
    if (!active.length) throw appError('VALIDATION_ERROR', 'This product has no active BOM.');
    var bomId = text(payload.bomId).trim();
    if (!bomId) throw appError('VALIDATION_ERROR', active.length > 1 ? 'Select a BOM' : 'This product has no active BOM.');
    if (active.length > 1 && !active.some(function (bom) { return bom.id === bomId; })) {
      throw appError('VALIDATION_ERROR', 'Select a BOM');
    }
    var bom = bomById(boms, bomId);
    if (!bom || bom.productId !== product.id) throw appError('VALIDATION_ERROR', 'Select a BOM');
    if (bom.status !== 'active') throw appError('VALIDATION_ERROR', 'This product has no active BOM.');
    var capturedAt = nowIso();
    var keepSnapshot = Boolean(
      existing &&
      !(options && options.refreshBom) &&
      existing.bomId === bomId &&
      existing.productId === product.id &&
      existing.bomSnapshot && existing.bomSnapshot.items && existing.bomSnapshot.items.length
    );
    var snapshotBom = keepSnapshot ? existing.bomSnapshot : packingCaptureBomSnapshot(bom, productList, capturedAt);
    if (!snapshotBom.items.length) throw appError('VALIDATION_ERROR', 'This BOM has no components.');
    if (packingHasCircularBom(boms, product.id, snapshotBom.items)) {
      throw appError('VALIDATION_ERROR', 'Packing cannot be completed because the BOM contains a circular dependency.');
    }
    var inventory = products.readBalances(spreadsheet);
    var preview = packingLinesFromSnapshot(snapshotBom, actualQty, productList, inventory, text(payload.warehouseId).trim());
    if (!preview.ok) throw appError('VALIDATION_ERROR', preview.conversionError || 'Cannot convert packing units.');
    preview.lines.forEach(function (line) {
      var component = productById(productList, line.productId);
      if (!component || component.status !== 'active') {
        throw appError('VALIDATION_ERROR', 'Component ' + line.name + ' is inactive.');
      }
    });
    return {
      id: existing ? existing.id : clientId(payload.clientId || payload.id, 'pak'),
      packingNo: existing ? existing.packingNo : nextDocNo(repository.readPackings(spreadsheet).map(function (row) { return row.packingNo; }), 'PA-', 4),
      date: existing ? existing.date : capturedAt,
      productId: product.id,
      bomId: bom.id,
      warehouseId: text(payload.warehouseId).trim(),
      plannedQty: plannedQty,
      actualQty: actualQty,
      unit: product.unit,
      status: 'draft',
      posted: false,
      notes: text(payload.notes).trim(),
      createdBy: existing ? existing.createdBy : '',
      createdAt: existing ? existing.createdAt : capturedAt,
      costEstimate: preview.costEstimate,
      bomSnapshot: snapshotBom,
      consumptions: packingConsumptionsFromPreview(preview)
    };
  }

  function savePackings(spreadsheet, packing) {
    var docs = repository.readPackings(spreadsheet);
    var found = false;
    var next = docs.map(function (row) {
      if (row.id === packing.id) {
        found = true;
        return packing;
      }
      return row;
    });
    if (!found) next = [packing].concat(next);
    repository.writePackings(spreadsheet, next);
  }

  function saveOrders(spreadsheet, order) {
    var docs = repository.readOrders(spreadsheet);
    var found = false;
    var next = docs.map(function (row) {
      if (row.id === order.id) {
        found = true;
        return order;
      }
      return row;
    });
    if (!found) next = [order].concat(next);
    repository.writeOrders(spreadsheet, next);
  }

  function createPacking(spreadsheet, payload, requestId, actor) {
    repository.ensure(spreadsheet);
    bomRepo.ensure(spreadsheet);
    var packing = buildPackingDraft(spreadsheet, payload, null, {});
    packing.createdBy = actor.name;
    var existing = null;
    repository.readPackings(spreadsheet).forEach(function (row) {
      if (row.id === packing.id) existing = row;
    });
    if (existing) {
      if (existing.posted || existing.status !== 'draft') throw appError('CONFLICT', 'Packing already exists.');
      return existing;
    }
    savePackings(spreadsheet, packing);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'packing.create',
      entityType: 'packing',
      entityId: packing.id,
      reference: packing.packingNo,
      before: '',
      after: JSON.stringify({ status: packing.status }),
      requestId: requestId
    });
    return packing;
  }

  function updatePacking(spreadsheet, payload, requestId, actor, options) {
    var id = text(payload.id || payload.packingId).trim();
    var existing = null;
    repository.readPackings(spreadsheet).forEach(function (row) {
      if (row.id === id) existing = row;
    });
    if (!existing) throw appError('NOT_FOUND', 'Packing not found');
    if (existing.posted || existing.status !== 'draft') {
      throw appError('VALIDATION_ERROR', 'This packing can no longer be edited');
    }
    var packing = buildPackingDraft(spreadsheet, {
      productId: payload.productId || existing.productId,
      bomId: payload.bomId || existing.bomId,
      warehouseId: payload.warehouseId || existing.warehouseId,
      plannedQty: payload.plannedQty === undefined ? existing.plannedQty : payload.plannedQty,
      actualQty: payload.actualQty === undefined ? existing.actualQty : payload.actualQty,
      notes: payload.notes === undefined ? existing.notes : payload.notes
    }, existing, options || {});
    packing.id = existing.id;
    packing.packingNo = existing.packingNo;
    packing.createdBy = existing.createdBy;
    packing.createdAt = existing.createdAt;
    savePackings(spreadsheet, packing);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: options && options.refreshBom ? 'packing.refresh' : 'packing.update',
      entityType: 'packing',
      entityId: packing.id,
      reference: packing.packingNo,
      before: JSON.stringify({ bomId: existing.bomId }),
      after: JSON.stringify({ bomId: packing.bomId, refreshBom: Boolean(options && options.refreshBom) }),
      requestId: requestId
    });
    return packing;
  }

  function cancelPacking(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id || payload.packingId).trim();
    var existing = null;
    repository.readPackings(spreadsheet).forEach(function (row) {
      if (row.id === id) existing = row;
    });
    if (!existing) throw appError('NOT_FOUND', 'Packing not found');
    if (existing.posted || existing.status === 'confirmed') {
      throw appError('VALIDATION_ERROR', 'Confirmed packing cannot be cancelled');
    }
    if (existing.status === 'cancelled') return existing;
    var packing = Object.assign({}, existing, { status: 'cancelled' });
    savePackings(spreadsheet, packing);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'packing.cancel',
      entityType: 'packing',
      entityId: packing.id,
      reference: packing.packingNo,
      before: existing.status,
      after: 'cancelled',
      requestId: requestId
    });
    return packing;
  }

  function confirmPacking(spreadsheet, payload, requestId, actor, idempotencyKey) {
    var id = text(payload.id || payload.packingId).trim();
    var existing = null;
    repository.readPackings(spreadsheet).forEach(function (row) {
      if (row.id === id) existing = row;
    });
    if (!existing) throw appError('NOT_FOUND', 'Packing not found');
    if (existing.posted || existing.status === 'confirmed') {
      var completed = findAudit(spreadsheet, 'packing.confirm', 'packing', existing.id);
      if (completed && idempotencyKey && auditIdempotencyKey(completed) && auditIdempotencyKey(completed) !== idempotencyKey) {
        throw appError('CONFLICT', 'This packing transaction has already been confirmed.');
      }
      return existing;
    }
    if (existing.status !== 'draft') throw appError('VALIDATION_ERROR', 'Only draft packing can be confirmed');
    var productList = products.readProducts(spreadsheet);
    var product = requireActiveProduct(productList, existing.productId, 'Select an output product');
    requireCompanyWarehouse(spreadsheet, existing.warehouseId);
    var qtyError = packingValidateQuantities(existing.plannedQty, existing.actualQty, product.unit);
    if (qtyError) throw appError('VALIDATION_ERROR', qtyError);
    var boms = bomRepo.readBoms(spreadsheet);
    var liveBom = bomById(boms, existing.bomId);
    if (!liveBom || liveBom.status !== 'active' || liveBom.productId !== existing.productId) {
      throw appError('VALIDATION_ERROR', 'This product has no active BOM.');
    }
    if (packingBomChanged(existing.bomSnapshot, liveBom) && payload.acceptSnapshot !== true) {
      throw appError('VALIDATION_ERROR', 'The BOM has changed since this packing was created.');
    }
    var snapshotBom = existing.bomSnapshot;
    if (!snapshotBom.items.length) throw appError('VALIDATION_ERROR', 'This BOM has no components.');
    if (packingHasCircularBom(boms, existing.productId, snapshotBom.items)) {
      throw appError('VALIDATION_ERROR', 'Packing cannot be completed because the BOM contains a circular dependency.');
    }
    var preview = packingLinesFromSnapshot(
      snapshotBom,
      existing.actualQty,
      productList,
      products.readBalances(spreadsheet),
      existing.warehouseId
    );
    if (!preview.ok) throw appError('VALIDATION_ERROR', preview.conversionError || 'Cannot convert packing units.');
    preview.lines.forEach(function (line) {
      var component = productById(productList, line.productId);
      if (!component || component.status !== 'active') {
        throw appError('VALIDATION_ERROR', 'Component ' + line.name + ' is inactive.');
      }
    });
    if (preview.hasShortage && !allowNegative(spreadsheet)) {
      var short = null;
      preview.lines.forEach(function (line) {
        if (!short && line.shortage > 0) short = line;
      });
      throw appError('VALIDATION_ERROR', 'Insufficient stock for ' + (short ? short.name : 'component') +
        '. Required: ' + (short ? short.requiredQty : '') + '. Available: ' + (short ? short.onHand : '') + '.');
    }
    var date = nowIso();
    var postLines = [];
    preview.lines.forEach(function (line) {
      if (line.consumptionMethod === 'MANUAL' || !(line.requiredQty > 0)) return;
      postLines.push({
        productId: line.productId,
        type: 'production_out',
        stockIn: 0,
        stockOut: line.requiredQty,
        notes: 'Packing / assembly consumption'
      });
    });
    postLines.push({
      productId: existing.productId,
      type: 'production_in',
      stockIn: existing.actualQty,
      stockOut: 0,
      notes: 'Packing / assembly output'
    });
    appendPostingLines(spreadsheet, actor, date, existing.packingNo, existing.warehouseId, existing.id, postLines);
    var packing = Object.assign({}, existing, {
      status: 'confirmed',
      posted: true,
      confirmedBy: actor.name,
      confirmedAt: date,
      costEstimate: preview.costEstimate,
      consumptions: packingConsumptionsFromPreview(preview)
    });
    savePackings(spreadsheet, packing);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'packing.confirm',
      entityType: 'packing',
      entityId: packing.id,
      reference: packing.packingNo,
      before: 'draft',
      after: JSON.stringify({ posted: true, movements: postLines.length, idempotencyKey: idempotencyKey || '' }),
      requestId: requestId
    });
    return packing;
  }

  function consumptionCost(productList, consumptions) {
    var total = 0;
    (consumptions || []).forEach(function (line) {
      var product = productById(productList, line.productId);
      var qty = product ? packingQtyToBaseUnit(line.actualQty, line.unit, product) : line.actualQty;
      if (qty === null) qty = line.actualQty;
      var conversion = packingPurchaseConversionQty(product);
      var unitCost = 0;
      if (product) {
        if (product.purchaseCost !== undefined && product.purchaseCost !== null && Number.isFinite(Number(product.purchaseCost)) && conversion > 0) {
          unitCost = round2(Number(product.purchaseCost) / conversion);
        } else {
          unitCost = round2(product.costPrice || 0);
        }
      }
      total += qty * unitCost;
    });
    return round2(total);
  }

  function createOrder(spreadsheet, payload, requestId, actor) {
    repository.ensure(spreadsheet);
    bomRepo.ensure(spreadsheet);
    var productList = products.readProducts(spreadsheet);
    var product = requireActiveProduct(productList, payload.productId, 'Select product and BOM');
    var bom = bomById(bomRepo.readBoms(spreadsheet), text(payload.bomId).trim());
    if (!bom || bom.productId !== product.id || bom.status !== 'active') {
      throw appError('VALIDATION_ERROR', 'Select product and BOM');
    }
    requireCompanyWarehouse(spreadsheet, payload.warehouseId);
    var plannedQty = Number(payload.plannedQty);
    if (!Number.isFinite(plannedQty) || plannedQty <= 0) {
      throw appError('VALIDATION_ERROR', 'Enter a planned quantity');
    }
    var id = clientId(payload.clientId || payload.id, 'po');
    var existing = null;
    repository.readOrders(spreadsheet).forEach(function (row) {
      if (row.id === id) existing = row;
    });
    if (existing) return existing;
    var consumptions = packingBomLinesForQty(bom, plannedQty);
    var sku = packingText(product.sku).replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'FG';
    var stamp = nowIso().slice(0, 10).replace(/-/g, '');
    var seq = String(repository.readOrders(spreadsheet).length + 1).padStart(3, '0');
    var status = text(payload.status).trim();
    if (status !== 'draft' && status !== 'planned') status = 'planned';
    var order = {
      id: id,
      orderNo: nextDocNo(repository.readOrders(spreadsheet).map(function (row) { return row.orderNo; }), 'PO-', 4),
      date: nowIso(),
      productId: product.id,
      bomId: bom.id,
      warehouseId: text(payload.warehouseId).trim(),
      plannedQty: plannedQty,
      actualQty: 0,
      unit: product.unit,
      plannedStart: text(payload.plannedStart),
      plannedEnd: text(payload.plannedEnd),
      status: status,
      batchNo: text(payload.batchNo).trim() || (sku + '-2026-' + stamp.slice(4) + '-' + seq),
      operator: text(payload.operator).trim() || actor.name,
      notes: text(payload.notes),
      consumptions: consumptions,
      wastage: [],
      consumptionConfirmed: false,
      posted: false,
      costEstimate: consumptionCost(productList, consumptions)
    };
    if (text(payload.expiryDate).trim()) order.expiryDate = text(payload.expiryDate).trim();
    saveOrders(spreadsheet, order);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'productionOrders.create',
      entityType: 'productionOrder',
      entityId: order.id,
      reference: order.orderNo,
      before: '',
      after: JSON.stringify({ status: order.status }),
      requestId: requestId
    });
    return order;
  }

  function requireEditableOrder(order) {
    if (!order) throw appError('NOT_FOUND', 'Production order not found');
    if (order.posted || order.status === 'completed' || order.status === 'cancelled') {
      throw appError('VALIDATION_ERROR', 'This order can no longer be edited');
    }
    return order;
  }

  function findOrder(spreadsheet, payload) {
    var id = text(payload.id || payload.orderId).trim();
    var found = null;
    repository.readOrders(spreadsheet).forEach(function (row) {
      if (row.id === id) found = row;
    });
    if (!found) throw appError('NOT_FOUND', 'Production order not found');
    return found;
  }

  function updateOrder(spreadsheet, payload, requestId, actor) {
    var existing = requireEditableOrder(findOrder(spreadsheet, payload));
    var productList = products.readProducts(spreadsheet);
    var productId = text(payload.productId).trim() || existing.productId;
    var bomId = text(payload.bomId).trim() || existing.bomId;
    var product = requireActiveProduct(productList, productId, 'Select product and BOM');
    var bom = bomById(bomRepo.readBoms(spreadsheet), bomId);
    var plannedQty = payload.plannedQty === undefined ? existing.plannedQty : Number(payload.plannedQty);
    if (!Number.isFinite(plannedQty) || plannedQty <= 0) throw appError('VALIDATION_ERROR', 'Enter a planned quantity');
    if (payload.warehouseId) requireCompanyWarehouse(spreadsheet, payload.warehouseId);
    var consumptions = bom ? packingBomLinesForQty(bom, plannedQty) : existing.consumptions;
    var order = Object.assign({}, existing, {
      productId: product.id,
      bomId: bom ? bom.id : existing.bomId,
      warehouseId: text(payload.warehouseId).trim() || existing.warehouseId,
      plannedQty: plannedQty,
      plannedStart: payload.plannedStart === undefined ? existing.plannedStart : text(payload.plannedStart),
      plannedEnd: payload.plannedEnd === undefined ? existing.plannedEnd : text(payload.plannedEnd),
      operator: payload.operator === undefined ? existing.operator : text(payload.operator),
      notes: payload.notes === undefined ? existing.notes : text(payload.notes),
      unit: product.unit,
      consumptions: consumptions,
      consumptionConfirmed: false,
      costEstimate: consumptionCost(productList, consumptions)
    });
    saveOrders(spreadsheet, order);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'productionOrders.update',
      entityType: 'productionOrder',
      entityId: order.id,
      reference: order.orderNo,
      before: JSON.stringify({ plannedQty: existing.plannedQty }),
      after: JSON.stringify({ plannedQty: order.plannedQty }),
      requestId: requestId
    });
    return order;
  }

  function startOrder(spreadsheet, payload, requestId, actor) {
    var existing = findOrder(spreadsheet, payload);
    if (existing.posted || existing.status === 'cancelled' || existing.status === 'completed') {
      throw appError('VALIDATION_ERROR', 'This order can no longer be started');
    }
    var bom = bomById(bomRepo.readBoms(spreadsheet), existing.bomId);
    var auto = packingAutoConsumptions(bom, existing.consumptions);
    var balances = products.readBalances(spreadsheet);
    var productList = products.readProducts(spreadsheet);
    var shortage = false;
    auto.forEach(function (line) {
      var product = productById(productList, line.productId);
      var converted = product ? packingQtyToBaseUnit(line.actualQty, line.unit, product) : line.actualQty;
      if (converted === null) converted = line.actualQty;
      if (converted > qtyOf(balances, line.productId, existing.warehouseId)) shortage = true;
    });
    if (shortage && payload.ignoreShortage !== true) {
      throw appError('VALIDATION_ERROR', 'Material shortage');
    }
    var order = Object.assign({}, existing, {
      status: 'in_progress',
      actualStart: existing.actualStart || nowIso()
    });
    saveOrders(spreadsheet, order);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'productionOrders.start',
      entityType: 'productionOrder',
      entityId: order.id,
      reference: order.orderNo,
      before: existing.status,
      after: JSON.stringify({ status: 'in_progress', ignoreShortage: payload.ignoreShortage === true }),
      requestId: requestId
    });
    return order;
  }

  function setOrderStatus(spreadsheet, payload, requestId, actor, action, fromStatus, toStatus, message) {
    var existing = findOrder(spreadsheet, payload);
    if (existing.status !== fromStatus) throw appError('VALIDATION_ERROR', message);
    var order = Object.assign({}, existing, { status: toStatus });
    saveOrders(spreadsheet, order);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: action,
      entityType: 'productionOrder',
      entityId: order.id,
      reference: order.orderNo,
      before: fromStatus,
      after: toStatus,
      requestId: requestId
    });
    return order;
  }

  function cancelOrder(spreadsheet, payload, requestId, actor) {
    var existing = findOrder(spreadsheet, payload);
    if (existing.posted || existing.status === 'completed') {
      throw appError('VALIDATION_ERROR', 'Completed orders cannot be cancelled');
    }
    if (existing.status === 'cancelled') return existing;
    var order = Object.assign({}, existing, { status: 'cancelled' });
    saveOrders(spreadsheet, order);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'productionOrders.cancel',
      entityType: 'productionOrder',
      entityId: order.id,
      reference: order.orderNo,
      before: existing.status,
      after: 'cancelled',
      requestId: requestId
    });
    return order;
  }

  function updateConsumption(spreadsheet, payload, requestId, actor) {
    var existing = requireEditableOrder(findOrder(spreadsheet, payload));
    if (existing.posted) throw appError('VALIDATION_ERROR', 'This order can no longer be edited');
    var lines = Array.isArray(payload.lines) ? payload.lines : [];
    var consumptions = existing.consumptions.map(function (line) {
      var next = null;
      lines.forEach(function (item) {
        if (text(item.productId) === line.productId) next = item;
      });
      if (!next) return line;
      return Object.assign({}, line, {
        actualQty: Number(next.actualQty),
        notes: next.notes === undefined ? line.notes : text(next.notes)
      });
    });
    var order = Object.assign({}, existing, {
      consumptions: consumptions,
      consumptionConfirmed: false,
      costEstimate: consumptionCost(products.readProducts(spreadsheet), consumptions)
    });
    saveOrders(spreadsheet, order);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'productionOrders.updateConsumption',
      entityType: 'productionOrder',
      entityId: order.id,
      reference: order.orderNo,
      before: '',
      after: JSON.stringify({ lines: consumptions.length }),
      requestId: requestId
    });
    return order;
  }

  function addConsumptionLine(spreadsheet, payload, requestId, actor) {
    var existing = requireEditableOrder(findOrder(spreadsheet, payload));
    var product = productById(products.readProducts(spreadsheet), text(payload.productId).trim());
    if (!product) throw appError('VALIDATION_ERROR', 'Product was not found.');
    var already = existing.consumptions.some(function (line) { return line.productId === product.id; });
    if (already) throw appError('VALIDATION_ERROR', 'Material already on this order');
    var qty = Number(payload.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw appError('VALIDATION_ERROR', 'Enter a quantity');
    var consumptions = existing.consumptions.concat([{
      productId: product.id,
      expectedQty: 0,
      actualQty: qty,
      unit: product.unit,
      notes: 'Extra material',
      consumptionMethod: 'AUTO'
    }]);
    var order = Object.assign({}, existing, {
      consumptions: consumptions,
      consumptionConfirmed: false,
      costEstimate: consumptionCost(products.readProducts(spreadsheet), consumptions)
    });
    saveOrders(spreadsheet, order);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'productionOrders.addLine',
      entityType: 'productionOrder',
      entityId: order.id,
      reference: order.orderNo,
      before: '',
      after: JSON.stringify({ productId: product.id }),
      requestId: requestId
    });
    return order;
  }

  function confirmConsumption(spreadsheet, payload, requestId, actor) {
    var existing = findOrder(spreadsheet, payload);
    if (existing.posted) throw appError('VALIDATION_ERROR', 'This order can no longer be edited');
    var order = Object.assign({}, existing, { consumptionConfirmed: true });
    saveOrders(spreadsheet, order);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'productionOrders.confirmConsumption',
      entityType: 'productionOrder',
      entityId: order.id,
      reference: order.orderNo,
      before: '',
      after: 'confirmed',
      requestId: requestId
    });
    return order;
  }

  function recordWastage(spreadsheet, payload, requestId, actor) {
    var existing = findOrder(spreadsheet, payload);
    if (existing.status === 'cancelled') throw appError('VALIDATION_ERROR', 'Cancelled orders cannot record wastage');
    var qty = Number(payload.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw appError('VALIDATION_ERROR', 'Enter a wastage quantity');
    var row = {
      id: 'wst_' + createId().replace(/-/g, '').slice(0, 10),
      kind: text(payload.kind).trim() || 'other',
      qty: qty,
      unit: text(payload.unit).trim(),
      reason: text(payload.reason),
      notes: text(payload.notes)
    };
    if (text(payload.productId).trim()) row.productId = text(payload.productId).trim();
    var order = Object.assign({}, existing, { wastage: (existing.wastage || []).concat([row]) });
    saveOrders(spreadsheet, order);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'productionOrders.recordWastage',
      entityType: 'productionOrder',
      entityId: order.id,
      reference: order.orderNo,
      before: '',
      after: JSON.stringify({ kind: row.kind, qty: row.qty }),
      requestId: requestId
    });
    return order;
  }

  function completeOrder(spreadsheet, payload, requestId, actor, idempotencyKey) {
    var existing = findOrder(spreadsheet, payload);
    if (existing.posted || existing.status === 'completed') {
      var completed = findAudit(spreadsheet, 'productionOrders.complete', 'productionOrder', existing.id);
      if (completed && idempotencyKey && auditIdempotencyKey(completed) && auditIdempotencyKey(completed) !== idempotencyKey) {
        throw appError('CONFLICT', 'Already posted');
      }
      return existing;
    }
    if (existing.status !== 'in_progress' && existing.status !== 'paused') {
      throw appError('VALIDATION_ERROR', 'Start production first');
    }
    var actualQty = Number(payload.actualQty);
    if (!Number.isFinite(actualQty) || actualQty <= 0) throw appError('VALIDATION_ERROR', 'Enter actual quantity');
    var productList = products.readProducts(spreadsheet);
    var bom = bomById(bomRepo.readBoms(spreadsheet), existing.bomId);
    var auto = packingAutoConsumptions(bom, existing.consumptions);
    var balances = products.readBalances(spreadsheet);
    var convertedAuto = auto.map(function (line) {
      var product = productById(productList, line.productId);
      var converted = product ? packingQtyToBaseUnit(line.actualQty, line.unit, product) : line.actualQty;
      if (converted === null) throw appError('VALIDATION_ERROR', 'Cannot convert packing units.');
      return { line: line, qty: packingApplyDiscreteRounding(converted, product ? product.unit : line.unit), product: product };
    });
    if (!allowNegative(spreadsheet)) {
      convertedAuto.forEach(function (item) {
        var available = qtyOf(balances, item.line.productId, existing.warehouseId);
        if (item.qty > available) {
          throw appError('VALIDATION_ERROR', 'Insufficient material');
        }
      });
    }
    var date = nowIso();
    var postLines = [];
    convertedAuto.forEach(function (item) {
      if (!(item.qty > 0)) return;
      postLines.push({
        productId: item.line.productId,
        type: 'production_out',
        stockIn: 0,
        stockOut: item.qty,
        notes: 'Material consumption'
      });
    });
    postLines.push({
      productId: existing.productId,
      type: 'production_in',
      stockIn: actualQty,
      stockOut: 0,
      notes: 'Finished goods'
    });
    appendPostingLines(spreadsheet, actor, date, existing.orderNo, existing.warehouseId, existing.id, postLines);
    var batchNo = text(payload.batchNo).trim() || existing.batchNo;
    var yieldLoss = round2(Math.max(0, existing.plannedQty - actualQty));
    var wastage = existing.wastage || [];
    var hasVariance = wastage.some(function (row) { return row.kind === 'yield_variance'; });
    if (yieldLoss > 0 && !hasVariance) {
      wastage = wastage.concat([{
        id: 'wst_' + createId().replace(/-/g, '').slice(0, 10),
        kind: 'yield_variance',
        productId: existing.productId,
        qty: yieldLoss,
        unit: existing.unit,
        reason: 'Yield variance',
        notes: ''
      }]);
    }
    var order = Object.assign({}, existing, {
      status: 'completed',
      posted: true,
      consumptionConfirmed: true,
      actualQty: actualQty,
      actualEnd: date,
      batchNo: batchNo,
      wastage: wastage,
      costEstimate: consumptionCost(productList, existing.consumptions)
    });
    if (text(payload.expiryDate).trim()) order.expiryDate = text(payload.expiryDate).trim();
    saveOrders(spreadsheet, order);
    var batches = repository.readBatches(spreadsheet);
    var already = batches.some(function (row) { return row.productionOrderId === order.id; });
    if (!already) {
      batches = [{
        id: 'bch_' + createId().replace(/-/g, '').slice(0, 10),
        productId: order.productId,
        warehouseId: order.warehouseId,
        batchNo: batchNo,
        qty: actualQty,
        expiry: order.expiryDate,
        productionDate: date,
        productionOrderId: order.id
      }].concat(batches);
      repository.writeBatches(spreadsheet, batches);
    }
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'productionOrders.complete',
      entityType: 'productionOrder',
      entityId: order.id,
      reference: order.orderNo,
      before: existing.status,
      after: JSON.stringify({ posted: true, actualQty: actualQty, idempotencyKey: idempotencyKey || '' }),
      requestId: requestId
    });
    return order;
  }

  function createPurchaseRequest(spreadsheet, payload) {
    var existing = findOrder(spreadsheet, payload);
    var bom = bomById(bomRepo.readBoms(spreadsheet), existing.bomId);
    var auto = packingAutoConsumptions(bom, existing.consumptions);
    var productList = products.readProducts(spreadsheet);
    var balances = products.readBalances(spreadsheet);
    var shortages = [];
    auto.forEach(function (line) {
      var product = productById(productList, line.productId);
      var converted = product ? packingQtyToBaseUnit(line.actualQty, line.unit, product) : line.actualQty;
      if (converted === null) converted = line.actualQty;
      var available = qtyOf(balances, line.productId, existing.warehouseId);
      var shortage = round2(Math.max(0, converted - available));
      if (shortage > 0) {
        shortages.push({
          productId: line.productId,
          name: product ? product.name : line.productId,
          requiredQty: converted,
          onHand: available,
          shortage: shortage,
          unit: product ? product.unit : line.unit
        });
      }
    });
    return {
      orderId: existing.id,
      orderNo: existing.orderNo,
      created: false,
      preview: true,
      shortages: shortages
    };
  }

  function withDoc(state, key, doc) {
    state[key] = doc;
    return okEnvelope(state);
  }

  function actorLegacyRole(spreadsheet, actor) {
    var role = text(actor.role).trim();
    sheetRows(spreadsheet, 'Roles').forEach(function (row) {
      if (text(row.id).trim() === text(actor.roleId).trim()) role = text(row.legacyRole).trim() || role;
    });
    return role;
  }

  function defaultWarehouseId(spreadsheet) {
    var rows = sheetRows(spreadsheet, 'Settings');
    for (var i = 0; i < rows.length; i += 1) {
      if (text(rows[i].id).trim() === 'settings') return text(rows[i].defaultWarehouseId).trim() || 'wh-main';
    }
    return 'wh-main';
  }

  function findSession(spreadsheet, payload) {
    var id = text(payload.id || payload.sessionId).trim();
    var found = null;
    repository.readSessions(spreadsheet).forEach(function (row) {
      if (row.id === id) found = row;
    });
    if (!found) throw appError('NOT_FOUND', 'Production session not found');
    return found;
  }

  function replaceSession(spreadsheet, session) {
    var docs = repository.readSessions(spreadsheet);
    repository.writeSessions(spreadsheet, docs.map(function (row) {
      return row.id === session.id ? session : row;
    }));
    return session;
  }

  function todayKey() {
    return businessDate(new Date());
  }

  function requireToday(session) {
    if (!sessionIsOperationalToday(session, todayKey())) {
      throw appError('VALIDATION_ERROR', "Not today's production");
    }
  }

  function requireSessionRole(spreadsheet, actor, session) {
    if (!sessionCanEdit(actorLegacyRole(spreadsheet, actor), session.status)) {
      throw appError('FORBIDDEN', 'You cannot edit this production session.');
    }
  }

  function applyDisplayDelta(rows, productId, warehouseId, delta, at) {
    var qty = round2(delta);
    var existing = null;
    rows.forEach(function (row) {
      if (row.productId === productId && row.warehouseId === warehouseId) existing = row;
    });
    if (!existing) {
      var nextQty = round2(Math.max(0, qty));
      if (nextQty <= 0) return rows;
      return rows.concat([{
        id: 'ds_' + createId().replace(/-/g, '').slice(0, 10),
        warehouseId: warehouseId,
        productId: productId,
        qty: nextQty,
        updatedAt: at
      }]);
    }
    return rows.map(function (row) {
      if (row.id !== existing.id) return row;
      return {
        id: row.id,
        warehouseId: row.warehouseId,
        productId: row.productId,
        qty: round2(Math.max(0, row.qty + qty)),
        updatedAt: at
      };
    });
  }

  function balanceStorageBoxNames(spreadsheet, warehouseId) {
    var locations = warehouseRepo.readLocations(spreadsheet);
    var slots = warehouseRepo.readSlots(spreadsheet);
    var names = [];
    var seen = {};
    slots.forEach(function (slot) {
      if (!slot.active) return;
      var location = null;
      locations.forEach(function (row) { if (row.id === slot.locationId) location = row; });
      if (!location || !location.active || location.type !== 'BALANCE_AREA') return;
      if (warehouseId && location.warehouseId !== warehouseId) return;
      var name = 'Box ' + slot.slotNo;
      var key = location.warehouseId + ':' + name;
      if (seen[key]) return;
      seen[key] = true;
      names.push(name);
    });
    return names;
  }

  function isActiveBalanceStorageBox(spreadsheet, warehouseId, name) {
    var box = text(name).trim();
    if (!box) return false;
    return balanceStorageBoxNames(spreadsheet, warehouseId).indexOf(box) >= 0;
  }

  function parseRecipePhoto(dataUrl, fileName) {
    var value = text(dataUrl).trim();
    if (!value) return null;
    if (value.indexOf('data:') !== 0) return { stored: value, name: text(fileName).trim() || 'recipe-sheet.jpg' };
    var match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) throw appError('VALIDATION_ERROR', 'Upload recipe photo');
    var mime = match[1].toLowerCase();
    if (mime === 'image/jpg') mime = 'image/jpeg';
    if (!SESSION_PHOTO_TYPES[mime]) throw appError('VALIDATION_ERROR', 'Use a JPG, PNG, or WebP image up to 5 MB.');
    var b64 = match[2].replace(/\s/g, '');
    var padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    var bytes = Math.floor((b64.length * 3) / 4) - padding;
    if (!(bytes > 0) || bytes > SESSION_PHOTO_MAX_BYTES) {
      throw appError('VALIDATION_ERROR', 'Use a JPG, PNG, or WebP image up to 5 MB.');
    }
    return {
      mime: mime,
      bytes: typeof Utilities !== 'undefined' && Utilities.base64Decode ? Utilities.base64Decode(b64) : b64,
      name: text(fileName).trim() || 'recipe-sheet.jpg',
      dataUrl: value
    };
  }

  function storeRecipePhoto(parsed) {
    if (!parsed) return { id: '', name: '' };
    if (parsed.stored) return { id: parsed.stored, name: parsed.name };
    if (drive && typeof Utilities !== 'undefined' && Utilities.newBlob) {
      drive.createChildFolder(SESSION_PHOTO_FOLDER);
      var blob = Utilities.newBlob(parsed.bytes, parsed.mime, parsed.name);
      var uploaded = drive.uploadFile(SESSION_PHOTO_FOLDER, blob, parsed.name);
      return { id: uploaded.id, name: parsed.name };
    }
    return { id: parsed.dataUrl || parsed.stored || '', name: parsed.name };
  }

  function emptySessionItem(sessionId, productId, bomId, targetQty) {
    return {
      id: 'psi_' + createId().replace(/-/g, '').slice(0, 10),
      sessionId: sessionId,
      productId: productId,
      bomId: bomId || '',
      originalTargetQty: targetQty,
      targetQty: targetQty,
      actualQty: 0,
      shortProductionQty: 0,
      shortProductionReason: '',
      productionBalanceQty: 0,
      balanceLocation: 'Main Warehouse',
      balanceContainer: '',
      wasteQty: 0,
      wasteReason: '',
      notes: '',
      displayQty: 0,
      cartonQty: 0
    };
  }

  function activeBomForProduct(boms, productId) {
    var found = null;
    (boms || []).forEach(function (row) {
      if (row.productId === productId && row.status === 'active') found = row;
    });
    return found;
  }

  function createSession(spreadsheet, payload, requestId, actor) {
    if (!sessionCanRun(actorLegacyRole(spreadsheet, actor))) {
      throw appError('FORBIDDEN', 'You cannot create a production session.');
    }
    var items = (payload.items || []).filter(function (row) { return Number(row.targetQty) > 0; });
    if (!items.length) throw appError('VALIDATION_ERROR', 'Add products to the daily plan');
    items.forEach(function (row) {
      if (!Number.isFinite(Number(row.targetQty)) || Number(row.targetQty) <= 0) {
        throw appError('VALIDATION_ERROR', 'Target must be greater than zero');
      }
    });
    var warehouseId = text(payload.warehouseId).trim() || defaultWarehouseId(spreadsheet);
    requireCompanyWarehouse(spreadsheet, warehouseId);
    var productionDate = normalizeBusinessDate(payload.productionDate || todayKey());
    var boms = bomRepo.readBoms(spreadsheet);
    var productList = products.readProducts(spreadsheet);
    var docs = repository.readSessions(spreadsheet);
    var id = clientId(payload.clientId || payload.id, 'ps');
    docs.forEach(function (row) {
      if (row.id === id) throw appError('CONFLICT', 'Production session already exists.');
    });
    var session = {
      id: id,
      productionDate: productionDate,
      reference: sessionNextReference(docs, productionDate),
      status: 'planned',
      warehouseId: warehouseId,
      createdBy: actor.name,
      createdAt: nowIso(),
      acceptedBy: '',
      acceptedAt: '',
      startedBy: '',
      startedAt: '',
      completedBy: '',
      completedAt: '',
      recipePhoto: '',
      recipePhotoName: '',
      uploadedBy: '',
      uploadedAt: '',
      notes: text(payload.notes),
      posted: false,
      items: items.map(function (row) {
        var product = requireActiveProduct(productList, row.productId, 'Choose a finished product');
        var bom = activeBomForProduct(boms, product.id);
        return emptySessionItem(id, product.id, bom ? bom.id : '', Number(row.targetQty));
      }),
      picking: [],
      excessReturns: [],
      targetChanges: [],
      completedEdits: [],
      materialAllocations: [],
      materialAudits: []
    };
    repository.writeSessions(spreadsheet, [session].concat(docs));
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'sessions.create', entityType: 'productionSession',
      entityId: session.id, reference: session.reference, before: '', after: 'planned', requestId: requestId
    });
    return session;
  }

  function acceptSession(spreadsheet, payload, requestId, actor) {
    var existing = findSession(spreadsheet, payload);
    requireToday(existing);
    requireSessionRole(spreadsheet, actor, existing);
    if (existing.status !== 'planned') throw appError('VALIDATION_ERROR', 'Only a planned session can be accepted');
    var session = Object.assign({}, existing, { status: 'accepted', acceptedBy: actor.name, acceptedAt: nowIso() });
    replaceSession(spreadsheet, session);
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'sessions.accept', entityType: 'productionSession',
      entityId: session.id, reference: session.reference, before: 'planned', after: 'accepted', requestId: requestId
    });
    return session;
  }

  function startSession(spreadsheet, payload, requestId, actor) {
    var existing = findSession(spreadsheet, payload);
    requireToday(existing);
    requireSessionRole(spreadsheet, actor, existing);
    if (existing.status === 'planned') throw appError('VALIDATION_ERROR', 'Accept production first');
    if (existing.status !== 'accepted') throw appError('VALIDATION_ERROR', 'Accept production before starting');
    var parsed = parseRecipePhoto(payload.recipePhoto, payload.recipePhotoName);
    if (!parsed) throw appError('VALIDATION_ERROR', 'Upload recipe photo');
    var stored = storeRecipePhoto(parsed);
    var plan = sessionBuildPlan(
      products.readProducts(spreadsheet),
      bomRepo.readBoms(spreadsheet),
      warehouseRepo.readProductionBalances(spreadsheet),
      existing
    );
    var session = Object.assign({}, existing, {
      status: 'in_progress',
      startedBy: actor.name,
      startedAt: nowIso(),
      recipePhoto: stored.id,
      recipePhotoName: stored.name,
      uploadedBy: actor.name,
      uploadedAt: nowIso(),
      picking: plan.picking,
      materialAllocations: existing.materialAllocations || [],
      materialAudits: existing.materialAudits || []
    });
    replaceSession(spreadsheet, session);
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'sessions.start', entityType: 'productionSession',
      entityId: session.id, reference: session.reference, before: 'accepted', after: 'in_progress', requestId: requestId
    });
    return session;
  }

  function cancelPlannedSession(spreadsheet, payload, requestId, actor) {
    var existing = findSession(spreadsheet, payload);
    if (existing.status !== 'planned') throw appError('VALIDATION_ERROR', 'Only planned sessions can be cancelled');
    var session = Object.assign({}, existing, { status: 'cancelled', cancelledBy: actor.name, cancelledAt: nowIso() });
    replaceSession(spreadsheet, session);
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'sessions.cancelPlanned', entityType: 'productionSession',
      entityId: session.id, reference: session.reference, before: 'planned', after: 'cancelled', requestId: requestId
    });
    return session;
  }

  function updatePlannedSession(spreadsheet, payload, requestId, actor) {
    var existing = findSession(spreadsheet, payload);
    if (existing.status !== 'planned') {
      throw appError('VALIDATION_ERROR', 'Normal edit is not allowed after the plan is accepted');
    }
    var items = payload.items || [];
    if (!items.length) throw appError('VALIDATION_ERROR', 'Add products to the daily plan');
    var boms = bomRepo.readBoms(spreadsheet);
    var nextItems = items.map(function (row) {
      var targetQty = Number(row.targetQty);
      if (!Number.isFinite(targetQty) || targetQty <= 0) throw appError('VALIDATION_ERROR', 'Target must be greater than zero');
      var found = null;
      existing.items.forEach(function (item) { if (item.productId === text(row.productId).trim()) found = item; });
      var bom = activeBomForProduct(boms, text(row.productId).trim());
      if (found) return Object.assign({}, found, { bomId: bom ? bom.id : found.bomId, originalTargetQty: targetQty, targetQty: targetQty });
      return emptySessionItem(existing.id, text(row.productId).trim(), bom ? bom.id : '', targetQty);
    });
    var session = Object.assign({}, existing, {
      productionDate: payload.productionDate ? normalizeBusinessDate(payload.productionDate) : existing.productionDate,
      notes: payload.notes === undefined ? existing.notes : text(payload.notes),
      items: nextItems
    });
    replaceSession(spreadsheet, session);
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'sessions.update', entityType: 'productionSession',
      entityId: session.id, reference: session.reference, before: String(existing.items.length), after: String(nextItems.length), requestId: requestId
    });
    return session;
  }

  function amendSession(spreadsheet, payload, requestId, actor) {
    var existing = findSession(spreadsheet, payload);
    requireToday(existing);
    if (existing.status === 'planned') throw appError('VALIDATION_ERROR', 'Use Edit for planned sessions');
    if (!sessionCanAmendStatus(existing.status)) throw appError('VALIDATION_ERROR', 'This plan cannot be amended');
    var reason = text(payload.reason).trim();
    if (!reason) throw appError('VALIDATION_ERROR', 'Enter a reason');
    var items = payload.items || (payload.productId ? [{ productId: payload.productId, targetQty: payload.targetQty }] : []);
    var changes = [];
    existing.items.forEach(function (item) {
      var next = null;
      items.forEach(function (row) { if (text(row.productId).trim() === item.productId) next = row; });
      if (!next) return;
      var newTarget = Number(next.targetQty);
      if (!Number.isFinite(newTarget) || newTarget <= 0) throw appError('VALIDATION_ERROR', 'Target must be greater than zero');
      if (newTarget < (item.actualQty || 0)) throw appError('VALIDATION_ERROR', 'New target cannot be lower than actual production completed.');
      if (newTarget !== item.targetQty) changes.push({ productId: item.productId, originalTarget: item.targetQty, newTarget: newTarget });
    });
    if (!changes.length) throw appError('VALIDATION_ERROR', 'No target changes');
    var updatedItems = existing.items.map(function (item) {
      var change = null;
      changes.forEach(function (row) { if (row.productId === item.productId) change = row; });
      return change ? Object.assign({}, item, { targetQty: change.newTarget }) : item;
    });
    var nextSession = Object.assign({}, existing, { items: updatedItems });
    var plan = sessionBuildPlan(
      products.readProducts(spreadsheet),
      bomRepo.readBoms(spreadsheet),
      warehouseRepo.readProductionBalances(spreadsheet),
      nextSession
    );
    var merged = sessionMergePicking(existing.picking, plan.picking);
    var changedAt = nowIso();
    var logs = changes.map(function (change) {
      return {
        id: 'tcl_' + createId().replace(/-/g, '').slice(0, 10),
        sessionId: existing.id,
        productId: change.productId,
        originalTarget: change.originalTarget,
        newTarget: change.newTarget,
        reason: reason,
        changedBy: actor.name,
        changedAt: changedAt
      };
    });
    var excess = (existing.excessReturns || []).concat(merged.excess.map(function (row) {
      return {
        id: 'ex_' + createId().replace(/-/g, '').slice(0, 10),
        productId: row.productId,
        qty: row.qty,
        unit: row.unit,
        status: 'to_return',
        notes: 'Amendment ' + row.productId
      };
    }));
    var session = Object.assign({}, existing, {
      items: updatedItems,
      picking: merged.picking,
      targetChanges: (existing.targetChanges || []).concat(logs),
      excessReturns: excess
    });
    replaceSession(spreadsheet, session);
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'sessions.amend', entityType: 'productionSession',
      entityId: session.id, reference: session.reference, before: '', after: JSON.stringify(changes), requestId: requestId
    });
    return session;
  }

  function togglePicking(spreadsheet, payload, requestId, actor) {
    var existing = findSession(spreadsheet, payload);
    requireToday(existing);
    if (existing.status !== 'in_progress') throw appError('VALIDATION_ERROR', 'Picking is only for in-progress sessions');
    var lineId = text(payload.lineId).trim();
    var line = null;
    existing.picking.forEach(function (row) { if (row.id === lineId) line = row; });
    if (!line) throw appError('NOT_FOUND', 'Picking line not found');
    var nextPicked = payload.picked === undefined ? !line.picked : payload.picked === true;
    var allocations = existing.materialAllocations || [];
    var audits = existing.materialAudits || [];
    if (Array.isArray(existing.materialAllocations) && sessionIsRawStorePickingLine(line) && nextPicked && !line.picked) {
      var already = allocations.some(function (row) { return row.productId === line.productId && row.source === 'picking'; });
      if (!already) {
        var product = productById(products.readProducts(spreadsheet), line.productId);
        var converted = packingQtyToInventory(line.qtyToPick, line.unit, product);
        var allocation = {
          id: 'pma_' + createId().replace(/-/g, '').slice(0, 10),
          sessionId: existing.id,
          productId: line.productId,
          source: 'picking',
          purchaseQty: line.qtyToPick,
          purchaseUnit: line.unit,
          baseQty: converted.ok ? packingRound2(converted.qty) : line.qtyToPick,
          baseUnit: product ? product.unit : line.unit,
          createdBy: actor.name,
          createdAt: nowIso()
        };
        allocations = allocations.concat([allocation]);
        audits = audits.concat([{
          id: 'pmu_' + createId().replace(/-/g, '').slice(0, 10),
          sessionId: existing.id,
          productId: line.productId,
          action: 'PICKING_ALLOCATED',
          source: 'picking',
          purchaseQty: allocation.purchaseQty,
          purchaseUnit: allocation.purchaseUnit,
          baseQty: allocation.baseQty,
          baseUnit: allocation.baseUnit,
          createdBy: actor.name,
          createdAt: allocation.createdAt
        }]);
      }
    }
    var session = Object.assign({}, existing, {
      picking: existing.picking.map(function (row) {
        return row.id === lineId ? Object.assign({}, row, { picked: nextPicked }) : row;
      }),
      materialAllocations: allocations,
      materialAudits: audits
    });
    replaceSession(spreadsheet, session);
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'sessions.togglePicking', entityType: 'productionSession',
      entityId: session.id, reference: session.reference, before: lineId, after: String(nextPicked), requestId: requestId
    });
    return session;
  }

  function addSessionMaterial(spreadsheet, payload, requestId, actor) {
    var existing = findSession(spreadsheet, payload);
    requireToday(existing);
    requireSessionRole(spreadsheet, actor, existing);
    if (existing.status !== 'in_progress') throw appError('VALIDATION_ERROR', 'Add material only during production');
    if (!Array.isArray(existing.materialAllocations)) {
      throw appError('VALIDATION_ERROR', 'This session has no material allocation ledger');
    }
    var product = requireActiveProduct(products.readProducts(spreadsheet), payload.productId, 'Select a material');
    var at = nowIso();
    var allocation;
    if (text(payload.mode).trim() === 'loose') {
      var looseQty = round2(Number(payload.looseQty));
      if (!Number.isFinite(looseQty) || looseQty <= 0) throw appError('VALIDATION_ERROR', 'Enter a loose quantity');
      allocation = {
        id: 'pma_' + createId().replace(/-/g, '').slice(0, 10),
        sessionId: existing.id, productId: product.id, source: 'loose',
        baseQty: looseQty, baseUnit: product.unit,
        containerType: text(payload.containerType).trim() || 'TONG',
        notes: text(payload.notes).trim() || undefined,
        createdBy: actor.name, createdAt: at
      };
    } else {
      var purchaseQty = round2(Number(payload.purchaseQty));
      if (!Number.isFinite(purchaseQty) || purchaseQty <= 0) throw appError('VALIDATION_ERROR', 'Enter a purchase quantity');
      var converted = packingQtyToInventory(purchaseQty, product.purchaseUnit || product.unit, product);
      allocation = {
        id: 'pma_' + createId().replace(/-/g, '').slice(0, 10),
        sessionId: existing.id, productId: product.id, source: 'additional',
        purchaseQty: purchaseQty, purchaseUnit: product.purchaseUnit || product.unit,
        baseQty: converted.ok ? packingRound2(converted.qty) : purchaseQty,
        baseUnit: product.unit, notes: text(payload.notes).trim() || undefined,
        createdBy: actor.name, createdAt: at
      };
    }
    var session = Object.assign({}, existing, {
      materialAllocations: existing.materialAllocations.concat([allocation]),
      materialAudits: (existing.materialAudits || []).concat([{
        id: 'pmu_' + createId().replace(/-/g, '').slice(0, 10),
        sessionId: existing.id, productId: product.id,
        action: allocation.source === 'loose' ? 'LOOSE_MATERIAL_ALLOCATED' : 'MATERIAL_ADDED',
        source: allocation.source, baseQty: allocation.baseQty, baseUnit: allocation.baseUnit,
        createdBy: actor.name, createdAt: at
      }])
    });
    replaceSession(spreadsheet, session);
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'sessions.addMaterial', entityType: 'productionSession',
      entityId: session.id, reference: session.reference, before: '', after: allocation.source, requestId: requestId
    });
    return session;
  }

  function requireInProgressUnposted(session) {
    if (session.status !== 'in_progress') throw appError('VALIDATION_ERROR', 'Start production first');
    if (session.posted) throw appError('CONFLICT', 'Already posted');
  }

  function saveResult(spreadsheet, payload, requestId, actor) {
    var existing = findSession(spreadsheet, payload);
    requireToday(existing);
    requireSessionRole(spreadsheet, actor, existing);
    requireInProgressUnposted(existing);
    var results = payload.results || payload.items || [];
    existing.items.forEach(function (item) {
      var result = null;
      results.forEach(function (row) { if (row.productId === item.productId) result = row; });
      if (!result || Number(result.actualQty) < 0) throw appError('VALIDATION_ERROR', 'Enter actual quantity for every product');
      if (Number(result.productionBalanceQty) > 0 && (!text(result.balanceLocation).trim() || !text(result.balanceContainer).trim())) {
        throw appError('VALIDATION_ERROR', 'Storage and box required');
      }
      if (Number(result.productionBalanceQty) > 0 && !isActiveBalanceStorageBox(spreadsheet, existing.warehouseId, result.balanceContainer)) {
        throw appError('VALIDATION_ERROR', 'Select a valid Storage Box');
      }
      if (Number(result.actualQty) < item.targetQty && !result.carryForward && !text(result.shortProductionReason).trim()) {
        throw appError('VALIDATION_ERROR', 'Select a reason');
      }
    });
    var savedAt = nowIso();
    var session = Object.assign({}, existing, {
      resultSavedBy: actor.name,
      resultSavedAt: savedAt,
      items: existing.items.map(function (row) {
        var result = null;
        results.forEach(function (entry) { if (entry.productId === row.productId) result = entry; });
        var carryForward = Boolean(result.carryForward) && Number(result.actualQty) < row.targetQty;
        return Object.assign({}, row, {
          actualQty: Number(result.actualQty),
          productionBalanceQty: Number(result.productionBalanceQty) || 0,
          balanceLocation: text(result.balanceLocation),
          balanceContainer: text(result.balanceContainer),
          wasteQty: Number(result.wasteQty) || 0,
          shortProductionQty: carryForward ? 0 : Math.max(0, row.targetQty - Number(result.actualQty)),
          shortProductionReason: carryForward ? '' : text(result.shortProductionReason),
          notes: text(result.notes),
          carryForward: carryForward
        });
      })
    });
    replaceSession(spreadsheet, session);
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'sessions.saveResult', entityType: 'productionSession',
      entityId: session.id, reference: session.reference, before: '', after: savedAt, requestId: requestId
    });
    return session;
  }

  function saveDistribution(spreadsheet, payload, requestId, actor) {
    var existing = findSession(spreadsheet, payload);
    requireToday(existing);
    requireSessionRole(spreadsheet, actor, existing);
    requireInProgressUnposted(existing);
    if (!existing.resultSavedAt) throw appError('VALIDATION_ERROR', 'Save Production Result first');
    var results = payload.results || payload.items || [];
    existing.items.forEach(function (item) {
      var result = null;
      results.forEach(function (row) { if (row.productId === item.productId) result = row; });
      var displayQty = round2(result ? result.displayQty : 0);
      var cartonQty = round2(result ? result.cartonQty : 0);
      if (displayQty < 0 || cartonQty < 0) throw appError('VALIDATION_ERROR', 'Distribution cannot be negative');
      if (!sessionDistributionEqualsActual(displayQty, cartonQty, item.actualQty)) {
        throw appError('VALIDATION_ERROR', 'Display + Carton must equal Actual Produced for every product.');
      }
    });
    var savedAt = nowIso();
    var session = Object.assign({}, existing, {
      distributionSavedBy: actor.name,
      distributionSavedAt: savedAt,
      items: existing.items.map(function (row) {
        var result = null;
        results.forEach(function (entry) { if (entry.productId === row.productId) result = entry; });
        return Object.assign({}, row, {
          displayQty: round2(result ? result.displayQty : 0),
          cartonQty: round2(result ? result.cartonQty : 0)
        });
      })
    });
    replaceSession(spreadsheet, session);
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'sessions.saveDistribution', entityType: 'productionSession',
      entityId: session.id, reference: session.reference, before: '', after: savedAt, requestId: requestId
    });
    return session;
  }

  function saveMaterialClosing(spreadsheet, payload, requestId, actor) {
    var existing = findSession(spreadsheet, payload);
    requireToday(existing);
    requireSessionRole(spreadsheet, actor, existing);
    requireInProgressUnposted(existing);
    if (!existing.distributionSavedAt) throw appError('VALIDATION_ERROR', 'Save Finished Goods Distribution first');
    if (!payload.acknowledged && !(payload.closing && payload.closing.acknowledged)) {
      throw appError('VALIDATION_ERROR', 'Acknowledge the physical check');
    }
    var inputs = (payload.closing && payload.closing.inputs) || payload.inputs || [];
    var built = sessionBuildMaterialClosing(
      products.readProducts(spreadsheet),
      bomRepo.readBoms(spreadsheet),
      warehouseRepo.readProductionBalances(spreadsheet),
      existing,
      inputs
    );
    if (!built.ok) throw appError('VALIDATION_ERROR', built.reason);
    var savedAt = nowIso();
    var session = Object.assign({}, existing, {
      materialClosing: {
        checkedAt: savedAt,
        checkedBy: actor.name,
        acknowledged: true,
        significantVariance: built.lines.some(sessionIsSignificantVariance),
        lines: built.lines
      }
    });
    replaceSession(spreadsheet, session);
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'sessions.saveMaterialClosing', entityType: 'productionSession',
      entityId: session.id, reference: session.reference, before: '', after: savedAt, requestId: requestId
    });
    return session;
  }

  function completeSession(spreadsheet, payload, requestId, actor, idempotencyKey) {
    var existing = findSession(spreadsheet, payload);
    if (existing.posted || existing.status === 'completed') {
      var completed = findAudit(spreadsheet, 'sessions.complete', 'productionSession', existing.id);
      if (completed && idempotencyKey && auditIdempotencyKey(completed) && auditIdempotencyKey(completed) !== idempotencyKey) {
        throw appError('CONFLICT', 'Already posted');
      }
      return existing;
    }
    requireToday(existing);
    requireSessionRole(spreadsheet, actor, existing);
    requireInProgressUnposted(existing);
    var closingPayload = payload.closing || payload;
    if (!closingPayload.acknowledged) throw appError('VALIDATION_ERROR', 'Acknowledge the physical check');
    var results = payload.results || payload.items || [];
    existing.items.forEach(function (item) {
      var result = null;
      results.forEach(function (row) { if (row.productId === item.productId) result = row; });
      if (!result || Number(result.actualQty) < 0) throw appError('VALIDATION_ERROR', 'Enter actual quantity for every product');
      if (Number(result.productionBalanceQty) > 0 && (!text(result.balanceLocation).trim() || !text(result.balanceContainer).trim())) {
        throw appError('VALIDATION_ERROR', 'Storage and box required');
      }
      if (Number(result.productionBalanceQty) > 0 && !isActiveBalanceStorageBox(spreadsheet, existing.warehouseId, result.balanceContainer)) {
        throw appError('VALIDATION_ERROR', 'Select a valid Storage Box');
      }
      var carryForward = Boolean(result.carryForward || item.carryForward) && Number(result.actualQty) < item.targetQty;
      if (Number(result.actualQty) < item.targetQty && !carryForward && !text(result.shortProductionReason).trim()) {
        throw appError('VALIDATION_ERROR', 'Select a reason');
      }
      var displayQty = round2(result.displayQty || 0);
      var cartonQty = round2(result.cartonQty || 0);
      if (displayQty < 0 || cartonQty < 0) throw appError('VALIDATION_ERROR', 'Distribution cannot be negative');
      if (!sessionDistributionEqualsActual(displayQty, cartonQty, result.actualQty)) {
        throw appError('VALIDATION_ERROR', 'Display + Carton must equal Actual Produced for every product.');
      }
    });
    var date = nowIso();
    var items = existing.items.map(function (item) {
      var result = null;
      results.forEach(function (row) { if (row.productId === item.productId) result = row; });
      var carryForward = Boolean(result.carryForward || item.carryForward) && Number(result.actualQty) < item.targetQty;
      return Object.assign({}, item, {
        actualQty: Number(result.actualQty),
        productionBalanceQty: Number(result.productionBalanceQty) || 0,
        balanceLocation: text(result.balanceLocation),
        balanceContainer: text(result.balanceContainer),
        wasteQty: Number(result.wasteQty) || 0,
        shortProductionQty: carryForward ? 0 : Math.max(0, item.targetQty - Number(result.actualQty)),
        shortProductionReason: carryForward ? '' : text(result.shortProductionReason),
        notes: text(result.notes),
        displayQty: round2(result.displayQty || 0),
        cartonQty: round2(result.cartonQty || 0),
        carryForward: carryForward,
        carriedForwardAt: carryForward ? date : undefined,
        carriedForwardBy: carryForward ? actor.name : undefined
      });
    });
    var working = Object.assign({}, existing, { items: items });
    var productList = products.readProducts(spreadsheet);
    var boms = bomRepo.readBoms(spreadsheet);
    var balances = warehouseRepo.readProductionBalances(spreadsheet);
    var built = sessionBuildMaterialClosing(productList, boms, balances, working, closingPayload.inputs || []);
    if (!built.ok) throw appError('VALIDATION_ERROR', built.reason);
    var plan = sessionBuildPlan(productList, boms, balances, working);
    var postLines = [];
    plan.products.forEach(function (req) {
      req.balanceUsed.forEach(function (alloc) {
        balances = balances.map(function (row) {
          if (row.id !== alloc.balanceId) return row;
          var qty = round2(row.quantity - alloc.qty);
          return Object.assign({}, row, { quantity: Math.max(0, qty), status: qty <= 0.001 ? 'consumed' : row.status });
        });
        postLines.push({
          productId: req.productId, type: 'production_balance_out', stockIn: 0, stockOut: alloc.qty,
          notes: 'Use production balance ' + alloc.container, skipInventory: true
        });
      });
    });
    plan.consolidatedRaw.forEach(function (raw) {
      if (sessionComponentIsManual(boms, items, raw.productId)) return;
      var closingLine = null;
      built.lines.forEach(function (row) { if (row.productId === raw.productId) closingLine = row; });
      var outQty = closingLine ? closingLine.actualUsedQty : raw.qty;
      if (!(outQty > 0)) return;
      postLines.push({
        productId: raw.productId, type: 'production_out', stockIn: 0, stockOut: outQty,
        notes: closingLine ? 'Material closing actual used ' + outQty : 'Consolidated material consumption'
      });
    });
    var displayStocks = warehouseRepo.readDisplay(spreadsheet);
    items.forEach(function (item) {
      if (item.actualQty > 0) {
        postLines.push({ productId: item.productId, type: 'production_in', stockIn: item.actualQty, stockOut: 0, notes: 'Finished goods packs' });
      }
      if (item.displayQty > 0) {
        displayStocks = applyDisplayDelta(displayStocks, item.productId, existing.warehouseId, item.displayQty, date);
      }
      if (item.productionBalanceQty > 0) {
        balances = [{
          id: 'pb_' + createId().replace(/-/g, '').slice(0, 10),
          productId: item.productId, quantity: item.productionBalanceQty, unit: 'g',
          location: item.balanceLocation, container: item.balanceContainer,
          warehouseId: existing.warehouseId, productionDate: date,
          productionReference: existing.reference, status: 'available'
        }].concat(balances);
        postLines.push({
          productId: item.productId, type: 'production_balance_in', stockIn: item.productionBalanceQty, stockOut: 0,
          notes: 'Production balance ' + item.balanceContainer, skipInventory: true
        });
      }
      if (item.wasteQty > 0) {
        postLines.push({
          productId: 'p-pouch', type: 'production_wastage', stockIn: 0, stockOut: 0,
          notes: 'Packaging waste ' + item.wasteQty + 'g', skipInventory: true
        });
      }
    });
    if (!allowNegative(spreadsheet)) {
      var inv = products.readBalances(spreadsheet);
      postLines.forEach(function (line) {
        if (line.skipInventory || !(line.stockOut > 0)) return;
        if (qtyOf(inv, line.productId, existing.warehouseId) < line.stockOut) {
          throw appError('VALIDATION_ERROR', 'Insufficient stock');
        }
      });
    }
    appendPostingLines(spreadsheet, actor, date, existing.reference, existing.warehouseId, existing.id, postLines);
    warehouseRepo.writeDisplay(spreadsheet, displayStocks);
    warehouseRepo.writeProductionBalances(spreadsheet, balances);
    var materialClosing = {
      checkedAt: existing.materialClosing && existing.materialClosing.checkedBy ? existing.materialClosing.checkedAt : date,
      checkedBy: existing.materialClosing && existing.materialClosing.checkedBy ? existing.materialClosing.checkedBy : actor.name,
      acknowledged: true,
      significantVariance: built.lines.some(sessionIsSignificantVariance),
      lines: built.lines
    };
    var session = Object.assign({}, existing, {
      items: items,
      status: 'completed',
      posted: true,
      completedBy: actor.name,
      completedAt: date,
      picking: plan.picking.map(function (line) {
        var previous = null;
        existing.picking.forEach(function (row) { if (row.id === line.id) previous = row; });
        return Object.assign({}, line, { picked: previous ? previous.picked : true });
      }),
      materialClosing: materialClosing,
      materialAllocations: existing.materialAllocations || [],
      materialAudits: (existing.materialAudits || []).concat(built.lines.map(function (row) {
        return {
          id: 'pmu_' + createId().replace(/-/g, '').slice(0, 10),
          sessionId: existing.id, productId: row.productId, action: 'MATERIAL_CLOSING_RECORDED',
          baseQty: row.actualUsedQty, createdBy: actor.name, createdAt: date
        };
      })).concat([{
        id: 'pmu_' + createId().replace(/-/g, '').slice(0, 10),
        sessionId: existing.id, productId: existing.items[0] ? existing.items[0].productId : '',
        action: 'PRODUCTION_COMPLETED', notes: existing.reference, createdBy: actor.name, createdAt: date
      }])
    });
    replaceSession(spreadsheet, session);
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'sessions.complete', entityType: 'productionSession',
      entityId: session.id, reference: session.reference,
      before: 'in_progress',
      after: JSON.stringify({ posted: true, actualQty: items.reduce(function (sum, item) { return sum + item.actualQty; }, 0), idempotencyKey: idempotencyKey }),
      requestId: requestId
    });
    return session;
  }

  function continueCarryForward(spreadsheet, payload, requestId, actor) {
    if (!sessionCanRun(actorLegacyRole(spreadsheet, actor))) {
      throw appError('FORBIDDEN', 'You cannot continue production.');
    }
    var originSession = findSession(spreadsheet, { id: payload.originSessionId });
    var origin = null;
    originSession.items.forEach(function (item) { if (item.id === text(payload.originItemId).trim()) origin = item; });
    if (!origin) throw appError('NOT_FOUND', 'Carry Forward not found');
    if (!originSession.posted || originSession.status !== 'completed' || !origin.carryForward) {
      throw appError('VALIDATION_ERROR', 'Carry Forward is not ready');
    }
    var remaining = sessionRemainingTarget(origin);
    if (!(remaining > 0)) throw appError('VALIDATION_ERROR', 'Nothing remaining to continue');
    var docs = repository.readSessions(spreadsheet);
    var resumed = docs.some(function (session) {
      return session.items.some(function (item) { return item.carriedFromItemId === origin.id; });
    });
    if (resumed) throw appError('VALIDATION_ERROR', 'Already continued');
    var today = todayKey();
    var operational = null;
    docs.forEach(function (row) {
      if (sessionDateKey(row.productionDate) !== today) return;
      if (row.status !== 'completed' && row.status !== 'cancelled' && !operational) operational = row;
    });
    var bom = activeBomForProduct(bomRepo.readBoms(spreadsheet), origin.productId);
    if (!operational) {
      var created = createSession(spreadsheet, {
        clientId: payload.clientId,
        productionDate: today,
        items: [{ productId: origin.productId, targetQty: remaining }],
        notes: 'Continued from ' + originSession.reference
      }, requestId, actor);
      created.items = created.items.map(function (row) {
        if (row.productId !== origin.productId) return row;
        return Object.assign({}, row, {
          originalTargetQty: remaining, targetQty: remaining, carryForward: false,
          carriedFromSessionId: originSession.id, carriedFromItemId: origin.id
        });
      });
      replaceSession(spreadsheet, created);
      return created;
    }
    if (operational.items.some(function (item) { return item.productId === origin.productId; })) {
      throw appError('VALIDATION_ERROR', "Already on today's production");
    }
    var nextItem = emptySessionItem(operational.id, origin.productId, bom ? bom.id : origin.bomId, remaining);
    nextItem.carriedFromSessionId = originSession.id;
    nextItem.carriedFromItemId = origin.id;
    var nextItems = operational.items.concat([nextItem]);
    var nextSession = Object.assign({}, operational, { items: nextItems });
    if (operational.status === 'in_progress') {
      var merged = sessionMergePicking(
        operational.picking,
        sessionBuildPlan(products.readProducts(spreadsheet), bomRepo.readBoms(spreadsheet), warehouseRepo.readProductionBalances(spreadsheet), nextSession).picking
      );
      nextSession.picking = merged.picking;
    }
    replaceSession(spreadsheet, nextSession);
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'sessions.continueCarryForward', entityType: 'productionSession',
      entityId: nextSession.id, reference: nextSession.reference, before: originSession.id, after: origin.id, requestId: requestId
    });
    return nextSession;
  }

  function editCompletedSession(spreadsheet, payload, requestId, actor) {
    var existing = findSession(spreadsheet, payload);
    if (existing.status !== 'completed') throw appError('VALIDATION_ERROR', 'Only completed sessions use this edit');
    var reason = text(payload.reason).trim();
    if (!reason) throw appError('VALIDATION_ERROR', 'Reason is required');
    var field = text(payload.field).trim();
    if (field !== 'actualQty' && field !== 'productionBalanceQty' && field !== 'wasteQty') {
      throw appError('VALIDATION_ERROR', 'Field is not editable');
    }
    var item = null;
    existing.items.forEach(function (row) { if (row.productId === text(payload.productId).trim()) item = row; });
    if (!item) throw appError('NOT_FOUND', 'Product line not found');
    var newValue = Number(payload.newValue);
    if (!Number.isFinite(newValue) || newValue < 0) throw appError('VALIDATION_ERROR', 'Enter a valid quantity');
    var original = item[field];
    if (original === newValue) return existing;
    var date = nowIso();
    var diff = round2(newValue - original);
    var postLines = [];
    var balances = warehouseRepo.readProductionBalances(spreadsheet);
    if (field === 'actualQty' && diff !== 0) {
      postLines.push({
        productId: item.productId, type: 'adjustment',
        stockIn: diff > 0 ? diff : 0, stockOut: diff < 0 ? -diff : 0,
        notes: 'Completed production edit · ' + reason
      });
    }
    if (field === 'productionBalanceQty') {
      var existingBal = null;
      balances.forEach(function (row) {
        if (row.productionReference === existing.reference && row.productId === item.productId && row.status === 'available') existingBal = row;
      });
      if (existingBal) {
        balances = balances.map(function (row) {
          if (row.id !== existingBal.id) return row;
          var qty = round2(existingBal.quantity + diff);
          return Object.assign({}, row, { quantity: Math.max(0, qty), status: qty <= 0 ? 'consumed' : 'available' });
        });
      } else if (newValue > 0) {
        balances = [{
          id: 'pb_' + createId().replace(/-/g, '').slice(0, 10),
          productId: item.productId, quantity: newValue, unit: 'g',
          location: item.balanceLocation || 'Main Warehouse',
          container: item.balanceContainer || 'Box 1',
          warehouseId: existing.warehouseId, productionDate: date,
          productionReference: existing.reference, status: 'available'
        }].concat(balances);
      }
      postLines.push({
        productId: item.productId, type: diff >= 0 ? 'production_balance_in' : 'production_balance_out',
        stockIn: diff > 0 ? diff : 0, stockOut: diff < 0 ? -diff : 0,
        notes: 'Balance edit · ' + reason, skipInventory: true
      });
    }
    if (field === 'wasteQty' && diff !== 0) {
      postLines.push({
        productId: 'p-pouch', type: 'production_wastage', stockIn: 0, stockOut: 0,
        notes: 'Waste edit ' + original + 'g → ' + newValue + 'g · ' + reason, skipInventory: true
      });
    }
    if (postLines.length) {
      appendPostingLines(spreadsheet, actor, date, existing.reference + ' adj', existing.warehouseId, existing.id + '-' + field + '-' + date.slice(0, 19), postLines);
    }
    warehouseRepo.writeProductionBalances(spreadsheet, balances);
    var log = {
      id: 'cel_' + createId().replace(/-/g, '').slice(0, 10),
      sessionId: existing.id, productId: item.productId, field: field,
      originalValue: String(original), newValue: String(newValue), reason: reason,
      editedBy: actor.name, editedAt: date
    };
    var session = Object.assign({}, existing, {
      items: existing.items.map(function (row) {
        if (row.productId !== item.productId) return row;
        var next = Object.assign({}, row);
        next[field] = newValue;
        if (field === 'actualQty') next.shortProductionQty = Math.max(0, row.targetQty - newValue);
        return next;
      }),
      completedEdits: (existing.completedEdits || []).concat([log])
    });
    replaceSession(spreadsheet, session);
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'sessions.editCompleted', entityType: 'productionSession',
      entityId: session.id, reference: session.reference, before: String(original), after: String(newValue), requestId: requestId
    });
    return session;
  }

  function editCompletedClosing(spreadsheet, payload, requestId, actor) {
    var existing = findSession(spreadsheet, payload);
    if (existing.status !== 'completed') throw appError('VALIDATION_ERROR', 'Only completed sessions use this edit');
    var reason = text(payload.reason).trim();
    if (!reason) throw appError('VALIDATION_ERROR', 'Reason is required');
    var closing = existing.materialClosing;
    var original = null;
    ((closing && closing.lines) || []).forEach(function (row) {
      if (row.productId === text(payload.productId).trim()) original = row;
    });
    if (!closing || !original) throw appError('VALIDATION_ERROR', 'No material closing to edit');
    var product = requireActiveProduct(products.readProducts(spreadsheet), payload.productId, 'Material is missing from Product Master.');
    var rebuilt = sessionClosingLineFromInput(product, original.plannedQty, original.availableQty, {
      fullUnits: Number(payload.fullUnits),
      looseQty: Number(payload.looseQty)
    });
    if (!rebuilt.ok) throw appError('VALIDATION_ERROR', rebuilt.reason);
    if (rebuilt.line.remainingQty === original.remainingQty && rebuilt.line.actualUsedQty === original.actualUsedQty) return existing;
    var date = nowIso();
    var diff = round2(rebuilt.line.actualUsedQty - original.actualUsedQty);
    if (diff !== 0) {
      appendPostingLines(spreadsheet, actor, date, existing.reference + ' adj', existing.warehouseId, existing.id + '-close-' + date.slice(0, 19), [{
        productId: product.id, type: 'adjustment',
        stockIn: diff < 0 ? -diff : 0, stockOut: diff > 0 ? diff : 0,
        notes: 'Material closing edit · ' + reason
      }]);
    }
    var lines = closing.lines.map(function (row) {
      return row.productId === product.id ? rebuilt.line : row;
    });
    var session = Object.assign({}, existing, {
      materialClosing: Object.assign({}, closing, {
        lines: lines,
        significantVariance: lines.some(sessionIsSignificantVariance)
      }),
      completedEdits: (existing.completedEdits || []).concat([{
        id: 'cel_' + createId().replace(/-/g, '').slice(0, 10),
        sessionId: existing.id, productId: product.id, field: 'remainingQty',
        originalValue: String(original.remainingQty), newValue: String(rebuilt.line.remainingQty),
        reason: reason, editedBy: actor.name, editedAt: date
      }])
    });
    replaceSession(spreadsheet, session);
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'sessions.editCompletedClosing', entityType: 'productionSession',
      entityId: session.id, reference: session.reference, before: String(original.actualUsedQty), after: String(rebuilt.line.actualUsedQty), requestId: requestId
    });
    return session;
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'packing.list' || action === 'productionOrders.list' || action === 'sessions.list') {
        requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.view', 'You cannot view manufacturing.');
        return okEnvelope(snapshot(spreadsheet));
      }
      if (action === 'packing.get') {
        requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.view', 'You cannot view manufacturing.');
        var packing = null;
        repository.readPackings(spreadsheet).forEach(function (row) {
          if (row.id === text(payload.id).trim()) packing = row;
        });
        if (!packing) throw appError('NOT_FOUND', 'Packing not found');
        return withDoc(snapshot(spreadsheet), 'packing', packing);
      }
      if (action === 'productionOrders.get') {
        requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.view', 'You cannot view manufacturing.');
        return withDoc(snapshot(spreadsheet), 'productionOrder', findOrder(spreadsheet, payload));
      }
      if (action === 'packing.create') {
        requireKey(request);
        var createdPacking = createPacking(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.create', 'You cannot create packing / assembly.')
        );
        return withDoc(snapshot(spreadsheet), 'packing', createdPacking);
      }
      if (action === 'packing.update') {
        var updatedPacking = updatePacking(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.edit', 'You cannot edit packing / assembly.'),
          {}
        );
        return withDoc(snapshot(spreadsheet), 'packing', updatedPacking);
      }
      if (action === 'packing.refresh') {
        var refreshedPacking = updatePacking(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.edit', 'You cannot edit packing / assembly.'),
          { refreshBom: true }
        );
        return withDoc(snapshot(spreadsheet), 'packing', refreshedPacking);
      }
      if (action === 'packing.cancel') {
        var cancelledPacking = cancelPacking(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.edit', 'You cannot cancel packing / assembly.')
        );
        return withDoc(snapshot(spreadsheet), 'packing', cancelledPacking);
      }
      if (action === 'packing.confirm') {
        requireKey(request);
        var confirmed = confirmPacking(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.complete', 'You cannot confirm packing / assembly.'),
          text(request.idempotencyKey).trim()
        );
        return withDoc(snapshot(spreadsheet), 'packing', confirmed);
      }
      if (action === 'productionOrders.create') {
        requireKey(request);
        var createdOrder = createOrder(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.create', 'You cannot create production.')
        );
        return withDoc(snapshot(spreadsheet), 'productionOrder', createdOrder);
      }
      if (action === 'productionOrders.update') {
        var updatedOrder = updateOrder(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.edit', 'You cannot edit production.')
        );
        return withDoc(snapshot(spreadsheet), 'productionOrder', updatedOrder);
      }
      if (action === 'productionOrders.start') {
        var startedOrder = startOrder(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.start', 'You cannot start production.')
        );
        return withDoc(snapshot(spreadsheet), 'productionOrder', startedOrder);
      }
      if (action === 'productionOrders.pause') {
        var pausedOrder = setOrderStatus(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.start', 'You cannot pause production.'),
          'productionOrders.pause', 'in_progress', 'paused', 'Only in-progress orders can be paused'
        );
        return withDoc(snapshot(spreadsheet), 'productionOrder', pausedOrder);
      }
      if (action === 'productionOrders.resume') {
        var resumedOrder = setOrderStatus(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.start', 'You cannot resume production.'),
          'productionOrders.resume', 'paused', 'in_progress', 'Only paused orders can be resumed'
        );
        return withDoc(snapshot(spreadsheet), 'productionOrder', resumedOrder);
      }
      if (action === 'productionOrders.cancel') {
        var cancelledOrder = cancelOrder(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.edit', 'You cannot cancel production.')
        );
        return withDoc(snapshot(spreadsheet), 'productionOrder', cancelledOrder);
      }
      if (action === 'productionOrders.updateConsumption') {
        var consumptionOrder = updateConsumption(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.edit', 'You cannot edit production.')
        );
        return withDoc(snapshot(spreadsheet), 'productionOrder', consumptionOrder);
      }
      if (action === 'productionOrders.addLine') {
        var extraOrder = addConsumptionLine(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.edit', 'You cannot edit production.')
        );
        return withDoc(snapshot(spreadsheet), 'productionOrder', extraOrder);
      }
      if (action === 'productionOrders.confirmConsumption') {
        var confirmedConsumption = confirmConsumption(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.complete', 'You cannot complete production.')
        );
        return withDoc(snapshot(spreadsheet), 'productionOrder', confirmedConsumption);
      }
      if (action === 'productionOrders.recordWastage') {
        var wastageOrder = recordWastage(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.edit', 'You cannot edit production.')
        );
        return withDoc(snapshot(spreadsheet), 'productionOrder', wastageOrder);
      }
      if (action === 'productionOrders.complete') {
        requireKey(request);
        var completedOrder = completeOrder(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.complete', 'You cannot complete production.'),
          text(request.idempotencyKey).trim()
        );
        return withDoc(snapshot(spreadsheet), 'productionOrder', completedOrder);
      }
      if (action === 'productionOrders.createPurchaseRequest') {
        requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.view', 'You cannot view manufacturing.');
        var preview = createPurchaseRequest(spreadsheet, payload);
        var state = snapshot(spreadsheet);
        state.purchaseRequest = preview;
        return okEnvelope(state);
      }
      if (action === 'sessions.get') {
        requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.view', 'You cannot view manufacturing.');
        var foundSession = findSession(spreadsheet, payload);
        return withDoc(snapshot(spreadsheet), 'productionSession', foundSession);
      }
      if (action === 'sessions.create') {
        requireKey(request);
        var createdSession = createSession(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.create', 'You cannot create a production session.')
        );
        return withDoc(snapshot(spreadsheet), 'productionSession', createdSession);
      }
      if (action === 'sessions.accept') {
        var acceptedSession = acceptSession(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.start', 'You cannot accept production.')
        );
        return withDoc(snapshot(spreadsheet), 'productionSession', acceptedSession);
      }
      if (action === 'sessions.start') {
        var startedSession = startSession(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.start', 'You cannot start production.')
        );
        return withDoc(snapshot(spreadsheet), 'productionSession', startedSession);
      }
      if (action === 'sessions.cancelPlanned') {
        var cancelledSession = cancelPlannedSession(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.plan.edit', 'You cannot cancel a production plan.')
        );
        return withDoc(snapshot(spreadsheet), 'productionSession', cancelledSession);
      }
      if (action === 'sessions.update') {
        var updatedSession = updatePlannedSession(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.plan.edit', 'You cannot edit a production plan.')
        );
        return withDoc(snapshot(spreadsheet), 'productionSession', updatedSession);
      }
      if (action === 'sessions.amend' || action === 'sessions.changeTarget') {
        var amendedSession = amendSession(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.plan.amend', 'You cannot amend a production plan.')
        );
        return withDoc(snapshot(spreadsheet), 'productionSession', amendedSession);
      }
      if (action === 'sessions.togglePicking') {
        var pickingSession = togglePicking(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.start', 'You cannot update the picking list.')
        );
        return withDoc(snapshot(spreadsheet), 'productionSession', pickingSession);
      }
      if (action === 'sessions.addMaterial') {
        var materialSession = addSessionMaterial(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.start', 'You cannot add material.')
        );
        return withDoc(snapshot(spreadsheet), 'productionSession', materialSession);
      }
      if (action === 'sessions.saveResult') {
        var resultSession = saveResult(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.complete', 'You cannot save production results.')
        );
        return withDoc(snapshot(spreadsheet), 'productionSession', resultSession);
      }
      if (action === 'sessions.saveDistribution') {
        var distributionSession = saveDistribution(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.complete', 'You cannot save finished goods distribution.')
        );
        return withDoc(snapshot(spreadsheet), 'productionSession', distributionSession);
      }
      if (action === 'sessions.saveMaterialClosing') {
        var closingSession = saveMaterialClosing(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.complete', 'You cannot save material closing.')
        );
        return withDoc(snapshot(spreadsheet), 'productionSession', closingSession);
      }
      if (action === 'sessions.complete') {
        requireKey(request);
        var completedSession = completeSession(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.complete', 'You cannot complete production.'),
          text(request.idempotencyKey).trim()
        );
        return withDoc(snapshot(spreadsheet), 'productionSession', completedSession);
      }
      if (action === 'sessions.continueCarryForward') {
        var continuedSession = continueCarryForward(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.create', 'You cannot continue production.')
        );
        return withDoc(snapshot(spreadsheet), 'productionSession', continuedSession);
      }
      if (action === 'sessions.editCompleted') {
        requireKey(request);
        var editedSession = editCompletedSession(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.completed.edit', 'You cannot edit completed production.')
        );
        return withDoc(snapshot(spreadsheet), 'productionSession', editedSession);
      }
      if (action === 'sessions.editCompletedClosing') {
        requireKey(request);
        var editedClosing = editCompletedClosing(
          spreadsheet, payload, requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'manufacturing.completed.edit', 'You cannot edit completed production.')
        );
        return withDoc(snapshot(spreadsheet), 'productionSession', editedClosing);
      }
      return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
