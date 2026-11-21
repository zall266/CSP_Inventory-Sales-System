// Module 8 opening balance. Draft save/update and one-time confirm post.

var OPENING_BALANCE_ACTIONS = {
  'openingBalances.list': true,
  'openingBalances.get': true,
  'openingBalances.save': true,
  'openingBalances.update': true,
  'openingBalances.confirm': true
};

var OPENING_BALANCE_ORIGIN_DATE = '2000-01-01T00:00:00+08:00';

function createOpeningBalanceService(deps) {
  var sheets = deps.sheetRepository;
  var repository = createOpeningBalanceRepository(sheets);
  var products = createProductRepository(sheets);
  var inventoryRepo = createInventoryRepository(sheets);
  var warehouseRepo = createWarehouseRepository(sheets);
  var bomRepo = createBomRepository(sheets);
  var masters = createMasterRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(OPENING_BALANCE_ACTIONS[action]);
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

  function newId(prefix) {
    return prefix + '_' + createId().replace(/-/g, '').slice(0, 10);
  }

  function clientId(value) {
    var id = text(value).trim();
    if (!id) return newId('ob');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw appError('VALIDATION_ERROR', 'Id is not valid.');
    return id;
  }

  function systemAudit(spreadsheet, entry) {
    sheets.ensureSheet(spreadsheet, 'AuditLogs', typeof AUDIT_HEADERS !== 'undefined' ? AUDIT_HEADERS : [
      'auditId', 'timestamp', 'userId', 'action', 'entityType', 'entityId', 'reference', 'before', 'after', 'requestId'
    ]);
    audit.append(entry);
  }

  function readBoms(spreadsheet) {
    bomRepo.ensure(spreadsheet);
    return bomRepo.readBoms(spreadsheet);
  }

  function productHasBom(boms, productId) {
    var id = text(productId).trim();
    for (var i = 0; i < boms.length; i += 1) {
      if (boms[i].status === 'active' && boms[i].productId === id) return true;
    }
    return false;
  }

  function purchaseConversionQty(product) {
    var qty = Number(product.purchaseConversionQty);
    return Number.isFinite(qty) && qty > 0 ? qty : 1;
  }

  function qtyToBaseUnit(qty, fromUnit, product) {
    var unit = text(fromUnit).trim().toUpperCase();
    var base = text(product.unit).trim().toUpperCase();
    var purchase = text(product.purchaseUnit || product.unit).trim().toUpperCase();
    var amount = Number(qty);
    if (!Number.isFinite(amount)) return null;
    if (unit === base) return round2(amount);
    if (unit === purchase) return round2(amount * purchaseConversionQty(product));
    return null;
  }

  function balanceStorageBoxNames(spreadsheet, warehouseId) {
    warehouseRepo.ensure(spreadsheet);
    var locations = warehouseRepo.readLocations(spreadsheet);
    var slots = warehouseRepo.readSlots(spreadsheet);
    var names = [];
    var seen = {};
    slots.forEach(function (slot) {
      if (!slot.active) return;
      var location = null;
      locations.forEach(function (row) {
        if (row.id === slot.locationId) location = row;
      });
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

  function buildLines(spreadsheet, type, items) {
    var boms = readBoms(spreadsheet);
    var productList = products.readProducts(spreadsheet);
    masters.ensure(spreadsheet);
    var warehouses = masters.readWarehouses(spreadsheet);
    var locations = warehouseRepo.readLocations(spreadsheet);
    var lines = [];
    var seen = {};
    if (!Array.isArray(items) || !items.length) {
      throw appError('VALIDATION_ERROR', 'Add at least one line.');
    }
    items.forEach(function (item) {
      var product = null;
      productList.forEach(function (row) {
        if (row.id === text(item.productId).trim()) product = row;
      });
      if (!product) throw appError('VALIDATION_ERROR', 'Choose a valid item for every line.');
      if (product.status !== 'active') throw appError('VALIDATION_ERROR', product.name + ' is inactive.');
      var hasBom = productHasBom(boms, product.id);
      if (type === 'stock_item' && hasBom) {
        throw appError('VALIDATION_ERROR', product.name + ' is finished goods. Use the Finished Goods tab.');
      }
      if ((type === 'finished_goods' || type === 'production_balance') && !hasBom) {
        throw appError('VALIDATION_ERROR', product.name + ' is not a finished product.');
      }
      var qty = Number(item.qty);
      if (!Number.isFinite(qty) || !(qty > 0)) throw appError('VALIDATION_ERROR', 'Enter a quantity greater than 0.');
      var warehouseId = text(item.warehouseId).trim();
      var warehouse = null;
      warehouses.forEach(function (row) {
        if (row.id === warehouseId) warehouse = row;
      });
      if (!warehouse || warehouse.kind !== 'company') {
        throw appError('VALIDATION_ERROR', 'Choose a valid company warehouse.');
      }
      if (type === 'production_balance') {
        var container = text(item.container).trim();
        if (!container) throw appError('VALIDATION_ERROR', 'Storage Box is required.');
        if (!isActiveBalanceStorageBox(spreadsheet, warehouse.id, container)) {
          throw appError('VALIDATION_ERROR', 'Select a valid Storage Box for ' + product.name + '.');
        }
        var pbKey = product.id + ':' + container;
        if (seen[pbKey]) throw appError('VALIDATION_ERROR', 'Duplicate ' + product.name + ' in ' + container + '.');
        seen[pbKey] = true;
        lines.push({
          id: newId('obl'),
          productId: product.id,
          qty: qty,
          unit: 'G',
          baseQty: round2(qty),
          warehouseId: warehouse.id,
          notes: text(item.notes).trim() || undefined,
          container: container
        });
        return;
      }
      var unit = text(item.unit).trim() || text(product.purchaseUnit || product.unit).trim();
      var baseQty = qtyToBaseUnit(qty, unit, product);
      if (baseQty === null || !(baseQty > 0)) {
        throw appError('VALIDATION_ERROR', 'Cannot convert ' + qty + ' ' + unit + ' for ' + product.name + '.');
      }
      var key = product.id + ':' + warehouse.id;
      if (seen[key]) throw appError('VALIDATION_ERROR', 'Duplicate ' + product.name + ' in the same warehouse.');
      seen[key] = true;
      var locationKind = text(item.locationKind).trim();
      var locationId = text(item.locationId).trim();
      if (type === 'finished_goods' && locationId) {
        var location = null;
        locations.forEach(function (row) {
          if (row.id === locationId) location = row;
        });
        if (!location || !location.active) throw appError('VALIDATION_ERROR', 'Choose a valid storage location.');
        if (location.warehouseId !== warehouse.id) {
          throw appError('VALIDATION_ERROR', 'Location must belong to the selected warehouse.');
        }
        if (location.type === 'DISPLAY') locationKind = 'display';
        else if (location.type === 'PALLET') locationKind = 'pallet';
        else if (location.type === 'FLOOR') locationKind = 'floor';
        else if (location.type === 'RACK') locationKind = 'rack';
      }
      var line = {
        id: newId('obl'),
        productId: product.id,
        qty: qty,
        unit: unit,
        baseQty: baseQty,
        warehouseId: warehouse.id,
        batchNo: text(item.batchNo).trim() || undefined,
        expiry: text(item.expiry).trim() || undefined,
        notes: text(item.notes).trim() || undefined
      };
      if (type === 'finished_goods') {
        line.locationKind = locationKind || 'inventory';
        if (locationId) line.locationId = locationId;
      }
      lines.push(line);
    });
    return lines;
  }

  function nextDocumentNo(documents) {
    var max = 0;
    documents.forEach(function (row) {
      var match = text(row.documentNo).match(/^OB-(\d+)/);
      if (match) max = Math.max(max, Number(match[1]));
    });
    return 'OB-' + String(max + 1).padStart(4, '0');
  }

  function findDocument(spreadsheet, id) {
    var docs = repository.readDocuments(spreadsheet);
    for (var i = 0; i < docs.length; i += 1) {
      if (docs[i].id === id) return docs[i];
    }
    return null;
  }

  function publicDocuments(spreadsheet) {
    return repository.readDocuments(spreadsheet).map(function (doc) {
      return {
        id: doc.id,
        documentNo: doc.documentNo,
        date: doc.date,
        type: doc.type,
        status: doc.status,
        items: doc.items,
        notes: doc.notes || undefined,
        createdBy: doc.createdBy,
        createdByName: doc.createdByName,
        createdAt: doc.createdAt,
        confirmedBy: doc.confirmedBy || undefined,
        confirmedAt: doc.confirmedAt || undefined
      };
    });
  }

  function snapshot(spreadsheet) {
    inventoryRepo.ensure(spreadsheet);
    warehouseRepo.ensure(spreadsheet);
    var movements = inventoryRepo.readMovements(spreadsheet);
    movements.reverse();
    return {
      openingBalances: publicDocuments(spreadsheet),
      inventory: products.readBalances(spreadsheet).map(function (row) {
        return { productId: row.productId, warehouseId: row.warehouseId, qty: round2(row.qty) };
      }),
      stockMovements: movements,
      displayStocks: warehouseRepo.readDisplay(spreadsheet),
      productionBalances: warehouseRepo.readProductionBalances(spreadsheet),
      storageSlots: warehouseRepo.readSlots(spreadsheet),
      slotOccupancies: warehouseRepo.readOccupancies(spreadsheet),
      placementLogs: warehouseRepo.readLogs(spreadsheet)
    };
  }

  function qtyOf(balances, productId, warehouseId) {
    var current = 0;
    balances.forEach(function (row) {
      if (row.productId === productId && row.warehouseId === warehouseId) current = round2(row.qty);
    });
    return current;
  }

  function putQty(balances, productId, warehouseId, qty) {
    var next = balances.map(function (row) {
      return { productId: row.productId, warehouseId: row.warehouseId, qty: round2(row.qty) };
    });
    var found = false;
    next.forEach(function (row) {
      if (row.productId === productId && row.warehouseId === warehouseId) {
        row.qty = qty;
        found = true;
      }
    });
    if (!found) next.push({ productId: productId, warehouseId: warehouseId, qty: qty });
    return next;
  }

  function movementId() {
    return 'mv_' + createId().replace(/-/g, '').slice(0, 16);
  }

  function buildMovement(input) {
    var balance = input.skipInventory ? round2(input.current) : round2(input.current + input.stockIn - input.stockOut);
    return {
      id: movementId(),
      date: input.date,
      reference: input.reference,
      productId: input.productId,
      warehouseId: input.warehouseId,
      type: input.type,
      stockIn: input.stockIn,
      stockOut: input.stockOut,
      balance: balance,
      user: input.user,
      notes: input.notes || ''
    };
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
        id: newId('ds'),
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

  function slotIdFor(locationId, level, face, slotNo) {
    return locationId + '-l' + level + '-' + String(face || 'NONE').toLowerCase() + '-' + slotNo;
  }

  function nextGenericSlot(locationId, slots) {
    var slotNo = 0;
    slots.forEach(function (row) {
      if (row.locationId === locationId) slotNo = Math.max(slotNo, Number(row.slotNo) || 0);
    });
    slotNo += 1;
    return {
      id: slotIdFor(locationId, 0, 'NONE', slotNo),
      locationId: locationId,
      level: 0,
      face: 'NONE',
      slotNo: slotNo,
      capacity: 0,
      active: true
    };
  }

  function warehouseName(spreadsheet, warehouseId) {
    masters.ensure(spreadsheet);
    var name = 'Main Warehouse';
    masters.readWarehouses(spreadsheet).forEach(function (row) {
      if (row.id === warehouseId) name = row.name;
    });
    return name;
  }

  function save(spreadsheet, payload, actor) {
    var type = text(payload.type).trim();
    if (type !== 'stock_item' && type !== 'finished_goods' && type !== 'production_balance') {
      throw appError('VALIDATION_ERROR', 'Opening balance type is not valid.');
    }
    var lines = buildLines(spreadsheet, type, payload.items || []);
    repository.ensure(spreadsheet);
    var docs = repository.readDocuments(spreadsheet);
    var id = clientId(payload.clientId || payload.id);
    docs.forEach(function (row) {
      if (row.id === id) throw appError('CONFLICT', 'Opening balance already exists.');
    });
    var doc = {
      id: id,
      documentNo: nextDocumentNo(docs),
      date: text(payload.date).trim() || nowIso(),
      type: type,
      status: 'draft',
      items: lines,
      notes: text(payload.notes).trim() || undefined,
      createdBy: actor.id,
      createdByName: actor.name,
      createdAt: nowIso()
    };
    repository.writeDocuments(spreadsheet, [doc].concat(docs));
    return doc;
  }

  function update(spreadsheet, payload, actor) {
    var id = text(payload.id).trim();
    var existing = findDocument(spreadsheet, id);
    if (!existing) throw appError('NOT_FOUND', 'Opening balance not found.');
    if (existing.status === 'confirmed') throw appError('CONFLICT', existing.documentNo + ' is locked.');
    var type = text(payload.type).trim() || existing.type;
    var lines = buildLines(spreadsheet, type, payload.items || []);
    var doc = {
      id: existing.id,
      documentNo: existing.documentNo,
      date: text(payload.date).trim() || existing.date,
      type: type,
      status: 'draft',
      items: lines,
      notes: text(payload.notes).trim() || undefined,
      createdBy: existing.createdBy,
      createdByName: existing.createdByName,
      createdAt: existing.createdAt
    };
    var docs = repository.readDocuments(spreadsheet).map(function (row) {
      return row.id === id ? doc : row;
    });
    repository.writeDocuments(spreadsheet, docs);
    return doc;
  }

  function confirm(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var existing = findDocument(spreadsheet, id);
    if (!existing) throw appError('NOT_FOUND', 'Opening balance not found.');
    if (existing.status === 'confirmed') {
      throw appError('CONFLICT', existing.documentNo + ' is locked.');
    }
    if (!existing.items.length) throw appError('VALIDATION_ERROR', 'Add at least one line.');

    var balances = products.readBalances(spreadsheet);
    var movements = [];
    var displayStocks = warehouseRepo.readDisplay(spreadsheet);
    var productionBalances = warehouseRepo.readProductionBalances(spreadsheet);
    var storageSlots = warehouseRepo.readSlots(spreadsheet);
    var occupancies = warehouseRepo.readOccupancies(spreadsheet);
    var placementLogs = warehouseRepo.readLogs(spreadsheet);
    var locations = warehouseRepo.readLocations(spreadsheet);
    var date = existing.date;

    existing.items.forEach(function (line) {
      if (existing.type === 'production_balance') {
        productionBalances = [{
          id: newId('pb'),
          productId: line.productId,
          quantity: line.baseQty,
          unit: 'g',
          location: warehouseName(spreadsheet, line.warehouseId),
          container: line.container || 'Box 1',
          warehouseId: line.warehouseId,
          productionDate: OPENING_BALANCE_ORIGIN_DATE,
          productionReference: existing.documentNo,
          status: 'available'
        }].concat(productionBalances);
        var current = qtyOf(balances, line.productId, line.warehouseId);
        movements.push(buildMovement({
          current: current,
          date: date,
          reference: existing.documentNo,
          productId: line.productId,
          warehouseId: line.warehouseId,
          type: 'production_balance_in',
          stockIn: line.baseQty,
          stockOut: 0,
          user: actor.name,
          notes: 'Opening balance ' + (line.container || ''),
          skipInventory: true
        }));
        return;
      }
      var currentQty = qtyOf(balances, line.productId, line.warehouseId);
      var movement = buildMovement({
        current: currentQty,
        date: date,
        reference: existing.documentNo,
        productId: line.productId,
        warehouseId: line.warehouseId,
        type: 'opening_balance',
        stockIn: line.baseQty,
        stockOut: 0,
        user: actor.name,
        notes: line.batchNo ? 'Lot ' + line.batchNo : existing.type === 'finished_goods'
          ? 'Finished goods opening balance'
          : 'Stock item opening balance'
      });
      movements.push(movement);
      balances = putQty(balances, line.productId, line.warehouseId, movement.balance);

      if (existing.type === 'finished_goods' && line.locationKind === 'display') {
        displayStocks = applyDisplayDelta(displayStocks, line.productId, line.warehouseId, line.baseQty, date);
      }
      if (existing.type === 'finished_goods' && line.locationId && line.locationKind &&
          line.locationKind !== 'inventory' && line.locationKind !== 'display') {
        var location = null;
        locations.forEach(function (row) {
          if (row.id === line.locationId && row.active) location = row;
        });
        if (location && location.type !== 'BALANCE_AREA' && location.type !== 'DISPLAY') {
          var slot = null;
          storageSlots.forEach(function (row) {
            if (row.locationId !== location.id || !row.active) return;
            var occupied = false;
            occupancies.forEach(function (occ) {
              if (occ.slotId === row.id) occupied = true;
            });
            if (!occupied) slot = row;
          });
          if (!slot && (location.type === 'PALLET' || location.type === 'FLOOR')) {
            slot = nextGenericSlot(location.id, storageSlots);
            storageSlots = storageSlots.concat([slot]);
          }
          if (slot) {
            occupancies = occupancies.concat([{
              id: newId('occ'),
              slotId: slot.id,
              productId: line.productId,
              quantityPacks: line.baseQty,
              batchRef: line.batchNo || existing.documentNo,
              productionSessionRef: '',
              placedBy: actor.name,
              placedAt: date,
              updatedAt: date
            }]);
            placementLogs = [{
              id: newId('pl'),
              action: 'PLACED',
              productId: line.productId,
              quantity: line.baseQty,
              fromSlotId: '',
              toSlotId: slot.id,
              batchRef: line.batchNo || existing.documentNo,
              referenceId: existing.documentNo,
              performedBy: actor.name,
              performedAt: date,
              reason: 'Opening balance'
            }].concat(placementLogs);
          }
        }
      }
    });

    movements.forEach(function (line) { inventoryRepo.appendMovement(spreadsheet, line); });
    products.writeBalances(spreadsheet, balances);
    warehouseRepo.writeDisplay(spreadsheet, displayStocks);
    warehouseRepo.writeProductionBalances(spreadsheet, productionBalances);
    warehouseRepo.writeSlots(spreadsheet, storageSlots);
    warehouseRepo.writeOccupancies(spreadsheet, occupancies);
    warehouseRepo.writeLogs(spreadsheet, placementLogs);

    var confirmed = {
      id: existing.id,
      documentNo: existing.documentNo,
      date: existing.date,
      type: existing.type,
      status: 'confirmed',
      items: existing.items,
      notes: existing.notes,
      createdBy: existing.createdBy,
      createdByName: existing.createdByName,
      createdAt: existing.createdAt,
      confirmedBy: actor.id,
      confirmedAt: nowIso()
    };
    var docs = repository.readDocuments(spreadsheet).map(function (row) {
      return row.id === id ? confirmed : row;
    });
    repository.writeDocuments(spreadsheet, docs);

    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'openingBalances.confirm',
      entityType: 'opening_balance',
      entityId: confirmed.id,
      reference: confirmed.documentNo,
      before: JSON.stringify({ status: 'draft', movementCount: 0 }),
      after: JSON.stringify({ status: 'confirmed', movementCount: movements.length }),
      requestId: requestId
    });

    var state = snapshot(spreadsheet);
    state.openingBalance = confirmed;
    return state;
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'openingBalances.list') {
        requirePermission(spreadsheet, payload.actorUserId, 'opening_balance.view', 'You do not have permission to view opening balance.');
        repository.ensure(spreadsheet);
        return okEnvelope({ openingBalances: publicDocuments(spreadsheet) });
      }
      if (action === 'openingBalances.get') {
        requirePermission(spreadsheet, payload.actorUserId, 'opening_balance.view', 'You do not have permission to view opening balance.');
        repository.ensure(spreadsheet);
        var doc = findDocument(spreadsheet, text(payload.id).trim());
        if (!doc) throw appError('NOT_FOUND', 'Opening balance not found.');
        return okEnvelope({ openingBalance: doc, openingBalances: publicDocuments(spreadsheet) });
      }
      if (action === 'openingBalances.save') {
        var saved = save(
          spreadsheet,
          payload,
          requirePermission(spreadsheet, payload.actorUserId, 'opening_balance.create', 'You cannot create opening balance.')
        );
        var afterSave = snapshot(spreadsheet);
        afterSave.openingBalance = saved;
        return okEnvelope(afterSave);
      }
      if (action === 'openingBalances.update') {
        var updated = update(
          spreadsheet,
          payload,
          requirePermission(spreadsheet, payload.actorUserId, 'opening_balance.create', 'You cannot update opening balance.')
        );
        var afterUpdate = snapshot(spreadsheet);
        afterUpdate.openingBalance = updated;
        return okEnvelope(afterUpdate);
      }
      if (action === 'openingBalances.confirm') {
        requireKey(request);
        var result = confirm(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'opening_balance.create', 'You cannot confirm opening balance.')
        );
        return okEnvelope(result);
      }
      return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
