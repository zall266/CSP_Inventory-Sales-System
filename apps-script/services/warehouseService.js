// Module 6 warehouse map. Location and placement only.
// A carton move updates SlotOccupancies. It does not post stock IN, OUT,
// adjustment, or transfer, and it does not change InventoryBalances.
// Display, pallet/floor, and balance storage stay separate location types.
// The seed layout matches the locked frontend map: 2 CTN racks, 4 levels,
// 4 front and 4 back, plus Display, DEPAN OFFICE, and Balance Storage.

var WAREHOUSE_ACTIONS = {
  'warehouse.get': true,
  'warehouse.bootstrap': true,
  'warehouse.place': true,
  'warehouse.move': true,
  'warehouse.topUp': true,
  'warehouse.empty': true,
  'warehouse.ensurePalletSlot': true,
  'warehouse.createTemporary': true,
  'warehouse.createRack': true,
  'warehouse.rename': true,
  'warehouse.deactivate': true,
  'warehouse.useBalance': true
};

var WAREHOUSE_LAYOUT_AT = '2026-09-08T09:15:00+08:00';
var WAREHOUSE_PLACED_AT = '2026-09-08T16:15:00+08:00';
var DISPLAY_STOCK_DESTINATION = 'display-stock';

function createWarehouseService(deps) {
  var sheets = deps.sheetRepository;
  var repository = createWarehouseRepository(sheets);
  var products = createProductRepository(sheets);
  var masters = createMasterRepository(sheets);
  var inventory = createInventoryRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(WAREHOUSE_ACTIONS[action]);
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
    return prefix + createId().replace(/-/g, '').slice(0, 12);
  }

  function slotIdFor(locationId, level, face, slotNo) {
    return locationId + '-l' + level + '-' + String(face || 'NONE').toLowerCase() + '-' + slotNo;
  }

  function slotRow(locationId, level, face, slotNo) {
    return {
      id: slotIdFor(locationId, level, face, slotNo),
      locationId: locationId,
      level: level,
      face: face,
      slotNo: slotNo,
      capacity: 0,
      active: true
    };
  }

  function generateRackSlots(locationId, levels, frontCount, backCount) {
    var rows = [];
    for (var level = levels; level >= 1; level -= 1) {
      for (var front = 1; front <= frontCount; front += 1) rows.push(slotRow(locationId, level, 'FRONT', front));
      for (var back = 1; back <= backCount; back += 1) rows.push(slotRow(locationId, level, 'BACK', back));
    }
    return rows;
  }

  function generateGenericSlots(locationId, count) {
    var rows = [];
    for (var slotNo = 1; slotNo <= count; slotNo += 1) rows.push(slotRow(locationId, 0, 'NONE', slotNo));
    return rows;
  }

  function nextGenericSlot(locationId, slots) {
    var slotNo = 0;
    slots.forEach(function (row) {
      if (row.locationId === locationId) slotNo = Math.max(slotNo, Number(row.slotNo) || 0);
    });
    return slotRow(locationId, 0, 'NONE', slotNo + 1);
  }

  function locationRow(id, name, type, warehouseId, active, at) {
    return {
      id: id,
      name: name,
      type: type,
      warehouseId: warehouseId,
      active: active,
      createdAt: at,
      updatedAt: at
    };
  }

  function seedMap() {
    var at = WAREHOUSE_LAYOUT_AT;
    var placedAt = WAREHOUSE_PLACED_AT;
    var locations = [
      locationRow('loc-rack-1', 'Rack 1', 'RACK', 'wh-main', true, at),
      locationRow('loc-rack-2', 'Rack 2', 'RACK', 'wh-main', true, at),
      locationRow('loc-display', 'Display Rack', 'DISPLAY', 'wh-main', false, at),
      locationRow('loc-pallet-depan-office', 'DEPAN OFFICE', 'PALLET', 'wh-main', true, at),
      locationRow('loc-balance', 'Balance Storage', 'BALANCE_AREA', 'wh-main', true, at)
    ];
    var slots = []
      .concat(generateRackSlots('loc-rack-1', 4, 4, 4))
      .concat(generateRackSlots('loc-rack-2', 4, 4, 4))
      .concat(generateGenericSlots('loc-display', 6))
      .concat(generateGenericSlots('loc-pallet-depan-office', 4))
      .concat(generateGenericSlots('loc-balance', 3));
    function occupy(slotId, productId, quantityPacks, batchRef) {
      return {
        id: 'occ-' + slotId,
        slotId: slotId,
        productId: productId,
        quantityPacks: quantityPacks,
        batchRef: batchRef,
        productionSessionRef: batchRef,
        placedBy: 'Admin',
        placedAt: placedAt,
        updatedAt: placedAt
      };
    }
    var occupancies = [
      occupy(slotIdFor('loc-rack-1', 3, 'FRONT', 1), 'p-pack-st', 20, 'PROD-20260908-001'),
      occupy(slotIdFor('loc-rack-1', 3, 'FRONT', 2), 'p-pack-mt', 20, 'PROD-20260908-001'),
      occupy(slotIdFor('loc-rack-1', 3, 'BACK', 1), 'p-pack-cl', 20, 'PROD-20260909-001'),
      occupy(slotIdFor('loc-rack-1', 4, 'BACK', 3), 'p-pack-mlt', 20, 'PROD-20260908-001')
    ];
    var historical = [
      occupy(slotIdFor('loc-display', 0, 'NONE', 1), 'p-pack-st', 5, 'PROD-20260908-001'),
      occupy(slotIdFor('loc-display', 0, 'NONE', 2), 'p-pack-mt', 8, 'PROD-20260908-001'),
      occupy(slotIdFor('loc-display', 0, 'NONE', 3), 'p-pack-ch', 12, 'PROD-20260909-001')
    ];
    var logs = occupancies.concat(historical).map(function (row) {
      return {
        id: 'pl-' + row.id,
        action: 'PLACED',
        productId: row.productId,
        quantity: row.quantityPacks,
        fromSlotId: '',
        toSlotId: row.slotId,
        batchRef: row.batchRef,
        referenceId: row.productionSessionRef,
        performedBy: 'Admin',
        performedAt: placedAt,
        reason: 'Opening warehouse layout'
      };
    });
    var display = [
      { id: 'ds-p-pack-st', warehouseId: 'wh-main', productId: 'p-pack-st', qty: 5, updatedAt: placedAt },
      { id: 'ds-p-pack-mt', warehouseId: 'wh-main', productId: 'p-pack-mt', qty: 8, updatedAt: placedAt },
      { id: 'ds-p-pack-ch', warehouseId: 'wh-main', productId: 'p-pack-ch', qty: 12, updatedAt: placedAt }
    ];
    var productionBalances = [
      {
        id: 'pb-mt-1', productId: 'p-pack-mt', quantity: 100, unit: 'g', location: 'Main Warehouse',
        container: 'Box 1', warehouseId: 'wh-main', productionDate: '2026-09-08T16:15:00+08:00',
        productionReference: 'PROD-20260908-001', status: 'available'
      },
      {
        id: 'pb-st-1', productId: 'p-pack-st', quantity: 867, unit: 'g', location: 'Main Warehouse',
        container: 'Box 2', warehouseId: 'wh-main', productionDate: '2026-09-08T16:15:00+08:00',
        productionReference: 'PROD-20260908-001', status: 'available'
      },
      {
        id: 'pb-cl-1', productId: 'p-pack-cl', quantity: 200, unit: 'g', location: 'Main Warehouse',
        container: 'Box 1', warehouseId: 'wh-main', productionDate: '2026-09-09T16:15:00+08:00',
        productionReference: 'PROD-20260909-001', status: 'available'
      }
    ];
    return {
      locations: locations,
      slots: slots,
      occupancies: occupancies,
      logs: logs,
      display: display,
      productionBalances: productionBalances
    };
  }

  function readState(spreadsheet) {
    return {
      locations: repository.readLocations(spreadsheet),
      slots: repository.readSlots(spreadsheet),
      occupancies: repository.readOccupancies(spreadsheet),
      logs: repository.readLogs(spreadsheet),
      display: repository.readDisplay(spreadsheet),
      productionBalances: repository.readProductionBalances(spreadsheet),
      balanceUsageLogs: repository.readBalanceUsage(spreadsheet)
    };
  }

  function snapshot(spreadsheet) {
    var state = readState(spreadsheet);
    var logs = state.logs.slice().reverse();
    var usage = state.balanceUsageLogs.slice().reverse();
    return {
      storageLocations: state.locations,
      storageSlots: state.slots,
      slotOccupancies: state.occupancies,
      displayStocks: state.display,
      placementLogs: logs,
      productionBalances: state.productionBalances,
      balanceUsageLogs: usage
    };
  }

  function systemAudit(spreadsheet, entry) {
    sheets.ensureSheet(spreadsheet, 'AuditLogs', typeof AUDIT_HEADERS !== 'undefined' ? AUDIT_HEADERS : [
      'auditId', 'timestamp', 'userId', 'action', 'entityType', 'entityId', 'reference', 'before', 'after', 'requestId'
    ]);
    audit.append(entry);
  }

  function findLocation(state, id) {
    var match = null;
    state.locations.forEach(function (row) {
      if (row.id === id) match = row;
    });
    return match;
  }

  function findSlot(state, id) {
    var match = null;
    state.slots.forEach(function (row) {
      if (row.id === id) match = row;
    });
    return match;
  }

  function occupancyOn(state, slotId) {
    var match = null;
    state.occupancies.forEach(function (row) {
      if (row.slotId === slotId) match = row;
    });
    return match;
  }

  function warehouseOf(spreadsheet, warehouseId) {
    masters.ensure(spreadsheet);
    var id = text(warehouseId).trim();
    var match = null;
    masters.readWarehouses(spreadsheet).forEach(function (row) {
      if (row.id === id) match = row;
    });
    return match;
  }

  function requireCompanyWarehouse(spreadsheet, warehouseId) {
    var warehouse = warehouseOf(spreadsheet, warehouseId);
    if (!warehouse) throw appError('NOT_FOUND', 'Warehouse was not found.');
    if (warehouse.kind === 'agent') throw appError('VALIDATION_ERROR', 'Agent warehouses cannot have storage locations');
    if (warehouse.kind !== 'company') throw appError('VALIDATION_ERROR', 'Choose a company warehouse');
    return warehouse;
  }

  function productById(spreadsheet, productId) {
    var id = text(productId).trim();
    var match = null;
    products.readProducts(spreadsheet).forEach(function (row) {
      if (row.id === id) match = row;
    });
    return match;
  }

  function inventoryQty(spreadsheet, productId, warehouseId) {
    var qty = 0;
    products.readBalances(spreadsheet).forEach(function (row) {
      if (row.productId === productId && row.warehouseId === warehouseId) qty = round2(row.qty);
    });
    return qty;
  }

  function movementCount(spreadsheet) {
    return inventory.readMovements(spreadsheet).length;
  }

  function placedPacks(state, productId, warehouseId) {
    var locationIds = {};
    state.locations.forEach(function (row) {
      if (row.warehouseId === warehouseId && row.active && (row.type === 'RACK' || row.type === 'PALLET' || row.type === 'FLOOR')) {
        locationIds[row.id] = true;
      }
    });
    var slotIds = {};
    state.slots.forEach(function (row) {
      if (locationIds[row.locationId] && row.active) slotIds[row.id] = true;
    });
    var sum = 0;
    state.occupancies.forEach(function (row) {
      if (slotIds[row.slotId] && row.productId === productId) sum = round2(sum + row.quantityPacks);
    });
    return sum;
  }

  function displayPacks(state, productId, warehouseId) {
    var qty = 0;
    state.display.forEach(function (row) {
      if (row.productId === productId && row.warehouseId === warehouseId) qty = round2(row.qty);
    });
    return qty;
  }

  function unplacedPacks(spreadsheet, state, productId, warehouseId) {
    return round2(Math.max(0, inventoryQty(spreadsheet, productId, warehouseId) - displayPacks(state, productId, warehouseId) - placedPacks(state, productId, warehouseId)));
  }

  function positiveQty(value) {
    var qty = round2(value);
    if (!Number.isFinite(qty) || qty <= 0) throw appError('VALIDATION_ERROR', 'Enter a quantity');
    return qty;
  }

  function appendPlacement(spreadsheet, row) {
    repository.appendLog(spreadsheet, row);
  }

  function ledgerFingerprint(spreadsheet) {
    return {
      balances: products.readBalances(spreadsheet).map(function (row) {
        return row.productId + '|' + row.warehouseId + '|' + round2(row.qty);
      }).join(','),
      movements: movementCount(spreadsheet)
    };
  }

  function assertLedgerUntouched(spreadsheet, before) {
    var after = ledgerFingerprint(spreadsheet);
    if (before.balances !== after.balances || before.movements !== after.movements) {
      throw appError('INTERNAL_ERROR', 'Warehouse placement must not change inventory.');
    }
  }

  function bootstrap(spreadsheet, payload, requestId) {
    var actor = requirePermission(spreadsheet, payload.actorUserId, 'warehouse_map.view', 'You do not have permission to view the warehouse map.');
    repository.ensure(spreadsheet);
    var existing = repository.readLocations(spreadsheet);
    if (existing.length) throw appError('CONFLICT', 'Warehouse map is already initialized.');
    var seed = seedMap();
    var before = ledgerFingerprint(spreadsheet);
    repository.writeLocations(spreadsheet, seed.locations);
    repository.writeSlots(spreadsheet, seed.slots);
    repository.writeOccupancies(spreadsheet, seed.occupancies);
    repository.writeDisplay(spreadsheet, seed.display);
    repository.writeProductionBalances(spreadsheet, seed.productionBalances);
    seed.logs.forEach(function (row) { repository.appendLog(spreadsheet, row); });
    assertLedgerUntouched(spreadsheet, before);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'warehouse.bootstrap',
      entityType: 'warehouseMap',
      entityId: 'wh-main',
      reference: '',
      before: '',
      after: String(seed.occupancies.length) + ' placements',
      requestId: requestId
    });
    return snapshot(spreadsheet);
  }

  function place(spreadsheet, payload, requestId, actor) {
    var qty = positiveQty(payload.qty);
    var state = readState(spreadsheet);
    var slot = findSlot(state, text(payload.slotId).trim());
    var location = slot ? findLocation(state, slot.locationId) : null;
    if (!slot || !slot.active || !location || !location.active || location.type === 'BALANCE_AREA') {
      throw appError('VALIDATION_ERROR', 'Choose a storage position');
    }
    if (location.type === 'DISPLAY') throw appError('VALIDATION_ERROR', 'Display is loose stock');
    requireCompanyWarehouse(spreadsheet, location.warehouseId);
    if (occupancyOn(state, slot.id)) throw appError('VALIDATION_ERROR', 'Slot occupied');
    var product = productById(spreadsheet, payload.productId);
    if (!product) throw appError('NOT_FOUND', 'Product was not found.');
    var available = unplacedPacks(spreadsheet, state, product.id, location.warehouseId);
    if (qty > available) throw appError('VALIDATION_ERROR', 'Not enough unplaced stock');
    var before = ledgerFingerprint(spreadsheet);
    var stamp = nowIso();
    var occupancy = {
      id: newId('occ_'),
      slotId: slot.id,
      productId: product.id,
      quantityPacks: qty,
      batchRef: text(payload.batchRef).trim(),
      productionSessionRef: text(payload.productionSessionRef).trim(),
      placedBy: actor.name,
      placedAt: stamp,
      updatedAt: stamp
    };
    repository.writeOccupancies(spreadsheet, state.occupancies.concat([occupancy]));
    appendPlacement(spreadsheet, {
      id: newId('pl_'),
      action: 'PLACED',
      productId: product.id,
      quantity: qty,
      fromSlotId: '',
      toSlotId: slot.id,
      batchRef: occupancy.batchRef,
      referenceId: occupancy.productionSessionRef,
      performedBy: actor.name,
      performedAt: stamp,
      reason: text(payload.reason).trim()
    });
    assertLedgerUntouched(spreadsheet, before);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'warehouse.place',
      entityType: 'slotOccupancy',
      entityId: occupancy.id,
      reference: occupancy.productionSessionRef || occupancy.batchRef,
      before: '',
      after: JSON.stringify({
        slotId: slot.id,
        productId: product.id,
        quantityPacks: qty,
        batchRef: occupancy.batchRef,
        productionSessionRef: occupancy.productionSessionRef
      }),
      requestId: requestId
    });
    return snapshot(spreadsheet);
  }

  function move(spreadsheet, payload, requestId, actor) {
    var qty = positiveQty(payload.qty);
    var fromSlotId = text(payload.fromSlotId).trim();
    var toSlotId = text(payload.toSlotId).trim();
    if (fromSlotId === toSlotId) throw appError('VALIDATION_ERROR', 'Choose a different position');
    var state = readState(spreadsheet);
    var source = occupancyOn(state, fromSlotId);
    var fromSlot = findSlot(state, fromSlotId);
    var toSlot = findSlot(state, toSlotId);
    var toLocation = toSlot ? findLocation(state, toSlot.locationId) : null;
    var fromLocation = fromSlot ? findLocation(state, fromSlot.locationId) : null;
    if (!source || !fromSlot || !fromSlot.active || !toSlot || !toSlot.active || !toLocation || !toLocation.active || toLocation.type === 'BALANCE_AREA' || toLocation.type === 'DISPLAY') {
      throw appError('VALIDATION_ERROR', toLocation && toLocation.type === 'DISPLAY' ? 'Use Top up Display instead of a map slot.' : 'Choose valid positions');
    }
    if (fromLocation && fromLocation.warehouseId !== toLocation.warehouseId) {
      throw appError('VALIDATION_ERROR', 'Choose valid positions');
    }
    requireCompanyWarehouse(spreadsheet, toLocation.warehouseId);
    if (qty > round2(source.quantityPacks)) throw appError('VALIDATION_ERROR', 'Not enough in that position');
    var destination = occupancyOn(state, toSlot.id);
    if (destination && destination.productId !== source.productId) {
      throw appError('VALIDATION_ERROR', 'Slot has another product');
    }
    var sourceRef = source.productionSessionRef || source.batchRef;
    var destRef = destination ? (destination.productionSessionRef || destination.batchRef) : '';
    if (destination && sourceRef && destRef && sourceRef !== destRef) {
      throw appError('VALIDATION_ERROR', 'Keep cartons separate');
    }
    var beforeLedger = ledgerFingerprint(spreadsheet);
    var stamp = nowIso();
    var remaining = round2(source.quantityPacks - qty);
    var occupancies = state.occupancies.filter(function (row) { return row.id !== source.id; });
    if (remaining > 0) {
      occupancies.push({
        id: source.id,
        slotId: source.slotId,
        productId: source.productId,
        quantityPacks: remaining,
        batchRef: source.batchRef,
        productionSessionRef: source.productionSessionRef,
        placedBy: source.placedBy,
        placedAt: source.placedAt,
        updatedAt: stamp
      });
    }
    var destId = destination ? destination.id : newId('occ_');
    if (destination) {
      occupancies = occupancies.map(function (row) {
        if (row.id !== destination.id) return row;
        return {
          id: row.id,
          slotId: row.slotId,
          productId: row.productId,
          quantityPacks: round2(row.quantityPacks + qty),
          batchRef: row.batchRef,
          productionSessionRef: row.productionSessionRef,
          placedBy: row.placedBy,
          placedAt: row.placedAt,
          updatedAt: stamp
        };
      });
    } else {
      occupancies.push({
        id: destId,
        slotId: toSlot.id,
        productId: source.productId,
        quantityPacks: qty,
        batchRef: source.batchRef,
        productionSessionRef: source.productionSessionRef,
        placedBy: actor.name,
        placedAt: stamp,
        updatedAt: stamp
      });
    }
    var seenSlots = {};
    occupancies.forEach(function (row) {
      if (seenSlots[row.slotId]) throw appError('CONFLICT', 'Slot occupied');
      seenSlots[row.slotId] = true;
    });
    var action = text(payload.action).trim() === 'TOPPED_UP' ? 'TOPPED_UP' : 'MOVED';
    repository.writeOccupancies(spreadsheet, occupancies);
    appendPlacement(spreadsheet, {
      id: newId('pl_'),
      action: action,
      productId: source.productId,
      quantity: qty,
      fromSlotId: fromSlot.id,
      toSlotId: toSlot.id,
      batchRef: source.batchRef,
      referenceId: source.productionSessionRef,
      performedBy: actor.name,
      performedAt: stamp,
      reason: text(payload.reason).trim()
    });
    assertLedgerUntouched(spreadsheet, beforeLedger);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'warehouse.move',
      entityType: 'slotOccupancy',
      entityId: destId,
      reference: source.productionSessionRef || source.batchRef,
      before: JSON.stringify({
        slotId: fromSlot.id,
        productId: source.productId,
        quantityPacks: source.quantityPacks,
        batchRef: source.batchRef,
        productionSessionRef: source.productionSessionRef
      }),
      after: JSON.stringify({
        slotId: toSlot.id,
        productId: source.productId,
        quantityPacks: qty,
        batchRef: source.batchRef,
        productionSessionRef: source.productionSessionRef
      }),
      requestId: requestId
    });
    return snapshot(spreadsheet);
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
        id: newId('ds_'),
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

  function topUp(spreadsheet, payload, requestId, actor) {
    var qty = positiveQty(payload.qty);
    var state = readState(spreadsheet);
    var fromSlotId = text(payload.fromSlotId).trim();
    var source = occupancyOn(state, fromSlotId);
    var fromSlot = findSlot(state, fromSlotId);
    var fromLocation = fromSlot ? findLocation(state, fromSlot.locationId) : null;
    if (!source || !fromSlot || !fromSlot.active || !fromLocation || !fromLocation.active || fromLocation.type === 'BALANCE_AREA' || fromLocation.type === 'DISPLAY') {
      throw appError('VALIDATION_ERROR', 'Choose carton stock');
    }
    requireCompanyWarehouse(spreadsheet, fromLocation.warehouseId);
    if (qty > round2(source.quantityPacks)) throw appError('VALIDATION_ERROR', 'Not enough in that position');
    var beforeLedger = ledgerFingerprint(spreadsheet);
    var stamp = nowIso();
    var remaining = round2(source.quantityPacks - qty);
    var occupancies = state.occupancies.filter(function (row) { return row.id !== source.id; });
    if (remaining > 0) {
      occupancies.push({
        id: source.id,
        slotId: source.slotId,
        productId: source.productId,
        quantityPacks: remaining,
        batchRef: source.batchRef,
        productionSessionRef: source.productionSessionRef,
        placedBy: source.placedBy,
        placedAt: source.placedAt,
        updatedAt: stamp
      });
    }
    repository.writeOccupancies(spreadsheet, occupancies);
    repository.writeDisplay(spreadsheet, applyDisplayDelta(state.display, source.productId, fromLocation.warehouseId, qty, stamp));
    appendPlacement(spreadsheet, {
      id: newId('pl_'),
      action: 'TOPPED_UP',
      productId: source.productId,
      quantity: qty,
      fromSlotId: fromSlot.id,
      toSlotId: DISPLAY_STOCK_DESTINATION,
      batchRef: source.batchRef,
      referenceId: source.productionSessionRef,
      performedBy: actor.name,
      performedAt: stamp,
      reason: text(payload.reason).trim() || 'Top up display stock'
    });
    assertLedgerUntouched(spreadsheet, beforeLedger);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'warehouse.topUp',
      entityType: 'displayStock',
      entityId: source.productId,
      reference: source.productionSessionRef || source.batchRef,
      before: JSON.stringify({ slotId: fromSlot.id, quantityPacks: source.quantityPacks }),
      after: JSON.stringify({
        slotId: DISPLAY_STOCK_DESTINATION,
        productId: source.productId,
        quantityPacks: qty,
        batchRef: source.batchRef,
        productionSessionRef: source.productionSessionRef
      }),
      requestId: requestId
    });
    return snapshot(spreadsheet);
  }

  function empty(spreadsheet, payload, requestId, actor) {
    var slotId = text(payload.slotId).trim();
    var state = readState(spreadsheet);
    var source = occupancyOn(state, slotId);
    if (!source) throw appError('VALIDATION_ERROR', 'Choose valid positions');
    var beforeLedger = ledgerFingerprint(spreadsheet);
    var stamp = nowIso();
    repository.writeOccupancies(spreadsheet, state.occupancies.filter(function (row) { return row.id !== source.id; }));
    appendPlacement(spreadsheet, {
      id: newId('pl_'),
      action: 'EMPTIED',
      productId: source.productId,
      quantity: source.quantityPacks,
      fromSlotId: slotId,
      toSlotId: '',
      batchRef: source.batchRef,
      referenceId: source.productionSessionRef,
      performedBy: actor.name,
      performedAt: stamp,
      reason: text(payload.reason).trim()
    });
    assertLedgerUntouched(spreadsheet, beforeLedger);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'warehouse.empty',
      entityType: 'slotOccupancy',
      entityId: source.id,
      reference: source.productionSessionRef || source.batchRef,
      before: JSON.stringify({
        slotId: slotId,
        productId: source.productId,
        quantityPacks: source.quantityPacks,
        batchRef: source.batchRef,
        productionSessionRef: source.productionSessionRef
      }),
      after: '',
      requestId: requestId
    });
    return snapshot(spreadsheet);
  }

  function ensurePalletSlot(spreadsheet, payload, requestId, actor) {
    var locationId = text(payload.locationId).trim();
    var state = readState(spreadsheet);
    var location = findLocation(state, locationId);
    if (!location || !location.active || (location.type !== 'PALLET' && location.type !== 'FLOOR')) {
      throw appError('VALIDATION_ERROR', 'Choose a storage position');
    }
    requireCompanyWarehouse(spreadsheet, location.warehouseId);
    var emptySlot = null;
    state.slots.filter(function (row) {
      return row.locationId === locationId && row.active;
    }).sort(function (a, b) { return a.slotNo - b.slotNo; }).forEach(function (row) {
      if (!emptySlot && !occupancyOn(state, row.id)) emptySlot = row;
    });
    if (emptySlot) return snapshot(spreadsheet);
    var beforeLedger = ledgerFingerprint(spreadsheet);
    var slot = nextGenericSlot(locationId, state.slots);
    repository.writeSlots(spreadsheet, state.slots.concat([slot]));
    assertLedgerUntouched(spreadsheet, beforeLedger);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'warehouse.ensurePalletSlot',
      entityType: 'storageSlot',
      entityId: slot.id,
      reference: locationId,
      before: '',
      after: slot.id,
      requestId: requestId
    });
    return snapshot(spreadsheet);
  }

  function settingsDefaultWarehouse(spreadsheet) {
    var rows = sheetRows(spreadsheet, 'Settings');
    for (var i = 0; i < rows.length; i += 1) {
      if (text(rows[i].id).trim() === 'settings') return text(rows[i].defaultWarehouseId).trim() || 'wh-main';
    }
    return 'wh-main';
  }

  function createTemporary(spreadsheet, payload, requestId, actor) {
    var name = text(payload.name).trim();
    if (!name) throw appError('VALIDATION_ERROR', 'Location name is required');
    var type = text(payload.type).trim();
    if (type !== 'PALLET' && type !== 'FLOOR') throw appError('VALIDATION_ERROR', 'Choose a storage position');
    var warehouseId = text(payload.warehouseId).trim() || settingsDefaultWarehouse(spreadsheet);
    requireCompanyWarehouse(spreadsheet, warehouseId);
    var count = Math.max(1, Math.round(Number(payload.slotCount) || 3));
    var stamp = nowIso();
    var id = newId('loc_');
    var state = readState(spreadsheet);
    var beforeLedger = ledgerFingerprint(spreadsheet);
    repository.writeLocations(spreadsheet, state.locations.concat([locationRow(id, name, type, warehouseId, true, stamp)]));
    repository.writeSlots(spreadsheet, state.slots.concat(generateGenericSlots(id, count)));
    assertLedgerUntouched(spreadsheet, beforeLedger);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'warehouse.createTemporary',
      entityType: 'storageLocation',
      entityId: id,
      reference: warehouseId,
      before: '',
      after: name,
      requestId: requestId
    });
    return snapshot(spreadsheet);
  }

  function createRack(spreadsheet, payload, requestId, actor) {
    var name = text(payload.name).trim();
    if (!name) throw appError('VALIDATION_ERROR', 'Rack name is required');
    var warehouseId = text(payload.warehouseId).trim() || settingsDefaultWarehouse(spreadsheet);
    requireCompanyWarehouse(spreadsheet, warehouseId);
    var levels = Math.max(1, Math.round(Number(payload.levels) || 4));
    var frontCount = Math.max(1, Math.round(Number(payload.frontCount) || 4));
    var backCount = Math.max(0, Math.round(Number(payload.backCount) || 4));
    var stamp = nowIso();
    var id = newId('loc_');
    var state = readState(spreadsheet);
    var beforeLedger = ledgerFingerprint(spreadsheet);
    repository.writeLocations(spreadsheet, state.locations.concat([locationRow(id, name, 'RACK', warehouseId, true, stamp)]));
    repository.writeSlots(spreadsheet, state.slots.concat(generateRackSlots(id, levels, frontCount, backCount)));
    assertLedgerUntouched(spreadsheet, beforeLedger);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'warehouse.createRack',
      entityType: 'storageLocation',
      entityId: id,
      reference: warehouseId,
      before: '',
      after: name,
      requestId: requestId
    });
    return snapshot(spreadsheet);
  }

  function rename(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var name = text(payload.name).trim();
    if (!name) throw appError('VALIDATION_ERROR', 'Location name is required');
    var state = readState(spreadsheet);
    var location = findLocation(state, id);
    if (!location) throw appError('NOT_FOUND', 'Location was not found.');
    var stamp = nowIso();
    repository.writeLocations(spreadsheet, state.locations.map(function (row) {
      if (row.id !== id) return row;
      return {
        id: row.id,
        name: name,
        type: row.type,
        warehouseId: row.warehouseId,
        active: row.active,
        createdAt: row.createdAt,
        updatedAt: stamp
      };
    }));
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'warehouse.rename',
      entityType: 'storageLocation',
      entityId: id,
      reference: location.warehouseId,
      before: location.name,
      after: name,
      requestId: requestId
    });
    return snapshot(spreadsheet);
  }

  function deactivate(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var state = readState(spreadsheet);
    var location = findLocation(state, id);
    if (!location) throw appError('NOT_FOUND', 'Location was not found.');
    var slotIds = {};
    state.slots.forEach(function (row) {
      if (row.locationId === id) slotIds[row.id] = true;
    });
    var occupied = state.occupancies.some(function (row) { return slotIds[row.slotId]; });
    if (occupied) throw appError('VALIDATION_ERROR', 'Location still has stock');
    var stamp = nowIso();
    repository.writeLocations(spreadsheet, state.locations.map(function (row) {
      if (row.id !== id) return row;
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        warehouseId: row.warehouseId,
        active: false,
        createdAt: row.createdAt,
        updatedAt: stamp
      };
    }));
    repository.writeSlots(spreadsheet, state.slots.map(function (row) {
      if (row.locationId !== id) return row;
      return {
        id: row.id,
        locationId: row.locationId,
        level: row.level,
        face: row.face,
        slotNo: row.slotNo,
        capacity: row.capacity,
        active: false
      };
    }));
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'warehouse.deactivate',
      entityType: 'storageLocation',
      entityId: id,
      reference: location.warehouseId,
      before: 'active',
      after: 'inactive',
      requestId: requestId
    });
    return snapshot(spreadsheet);
  }

  function useBalance(spreadsheet, payload, requestId, actor) {
    var qty = positiveQty(payload.qty);
    var balanceId = text(payload.balanceId).trim();
    var state = readState(spreadsheet);
    var balance = null;
    state.productionBalances.forEach(function (row) {
      if (row.id === balanceId) balance = row;
    });
    if (!balance || balance.status !== 'available' || balance.quantity <= 0) {
      throw appError('VALIDATION_ERROR', 'No available balance');
    }
    if (qty > round2(balance.quantity)) throw appError('VALIDATION_ERROR', 'Quantity exceeds available balance.');
    var beforeLedger = ledgerFingerprint(spreadsheet);
    var remaining = round2(balance.quantity - qty);
    var stamp = nowIso();
    repository.writeProductionBalances(spreadsheet, state.productionBalances.map(function (row) {
      if (row.id !== balance.id) return row;
      return {
        id: row.id,
        productId: row.productId,
        quantity: remaining,
        unit: row.unit,
        location: row.location,
        container: row.container,
        warehouseId: row.warehouseId,
        productionDate: row.productionDate,
        productionReference: row.productionReference,
        status: remaining > 0 ? 'available' : 'consumed'
      };
    }));
    repository.appendUsage(spreadsheet, {
      id: newId('bu_'),
      balanceId: balance.id,
      productId: balance.productId,
      quantity: qty,
      unit: balance.unit,
      productionDate: balance.productionDate,
      productionReference: balance.productionReference,
      container: balance.container,
      location: balance.location,
      reason: text(payload.reason).trim(),
      notes: text(payload.notes).trim(),
      performedBy: actor.name,
      performedAt: stamp
    });
    assertLedgerUntouched(spreadsheet, beforeLedger);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'warehouse.useBalance',
      entityType: 'productionBalance',
      entityId: balance.id,
      reference: balance.productionReference,
      before: String(balance.quantity),
      after: String(remaining),
      requestId: requestId
    });
    var result = snapshot(spreadsheet);
    result.unit = balance.unit;
    return result;
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'warehouse.get') {
        requirePermission(spreadsheet, payload.actorUserId, 'warehouse_map.view', 'You do not have permission to view the warehouse map.');
        repository.ensure(spreadsheet);
        return okEnvelope(snapshot(spreadsheet));
      }
      if (action === 'warehouse.bootstrap') return okEnvelope(bootstrap(spreadsheet, payload, requestId));
      requireKey(request);
      var result;
      if (action === 'warehouse.place') {
        result = place(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'warehouse_map.putaway', 'You cannot place finished goods.'));
      } else if (action === 'warehouse.move') {
        result = move(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'warehouse_map.move', 'You cannot move warehouse stock.'));
      } else if (action === 'warehouse.topUp') {
        result = topUp(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'warehouse_map.move', 'You cannot move warehouse stock.'));
      } else if (action === 'warehouse.empty') {
        result = empty(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'warehouse_map.move', 'You cannot empty a position.'));
      } else if (action === 'warehouse.ensurePalletSlot') {
        result = ensurePalletSlot(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'warehouse_map.putaway', 'You cannot place finished goods.'));
      } else if (action === 'warehouse.createTemporary') {
        result = createTemporary(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'warehouse_map.location.manage', 'You cannot add storage locations.'));
      } else if (action === 'warehouse.createRack') {
        result = createRack(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'warehouse_map.layout.edit', 'You cannot edit warehouse layout.'));
      } else if (action === 'warehouse.rename') {
        result = rename(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'warehouse_map.location.manage', 'You cannot rename locations.'));
      } else if (action === 'warehouse.deactivate') {
        result = deactivate(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'warehouse_map.location.manage', 'You cannot deactivate locations.'));
      } else if (action === 'warehouse.useBalance') {
        result = useBalance(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'warehouse_map.balance.use', 'You cannot use production balance.'));
      } else {
        return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
      }
      return okEnvelope(result);
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
