// Module 11 production orders and packing.
// Ledger posts only on packing.confirm and productionOrders.complete.
// MANUAL components do not auto-out. Confirm/complete are retry-safe.

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

function createManufacturingService(deps) {
  var sheets = deps.sheetRepository;
  var repository = createManufacturingRepository(sheets);
  var products = createProductRepository(sheets);
  var inventoryRepo = createInventoryRepository(sheets);
  var bomRepo = createBomRepository(sheets);
  var masters = createMasterRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(PACKING_ACTIONS[action] || PRODUCTION_ORDER_ACTIONS[action]);
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
    var movements = inventoryRepo.readMovements(spreadsheet);
    movements.reverse();
    return {
      packingAssemblies: repository.readPackings(spreadsheet),
      productionOrders: repository.readOrders(spreadsheet),
      batches: repository.readBatches(spreadsheet),
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
      var balance = round2(current + line.stockIn - line.stockOut);
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
      balances = putQty(balances, line.productId, warehouseId, balance);
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

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'packing.list' || action === 'productionOrders.list') {
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
      return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
