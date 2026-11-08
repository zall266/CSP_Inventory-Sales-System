// Module 11 production orders and packing. Identity is the row id.

var PACKING_HEADERS = [
  'id', 'packingNo', 'date', 'productId', 'bomId', 'warehouseId',
  'plannedQty', 'actualQty', 'unit', 'status', 'posted', 'notes',
  'createdBy', 'createdAt', 'confirmedBy', 'confirmedAt', 'costEstimate',
  'snapshotBomId', 'snapshotName', 'snapshotOutputQty', 'snapshotOutputUnit',
  'snapshotCapturedAt', 'consumptionsJson'
];
var PACKING_SNAPSHOT_HEADERS = [
  'id', 'packingId', 'productId', 'productName', 'sku', 'qty', 'unit',
  'wastagePct', 'notes', 'consumptionMethod'
];
var PRODUCTION_ORDER_HEADERS = [
  'id', 'orderNo', 'date', 'productId', 'bomId', 'warehouseId',
  'plannedQty', 'actualQty', 'unit', 'plannedStart', 'plannedEnd',
  'actualStart', 'actualEnd', 'status', 'batchNo', 'expiryDate',
  'operator', 'notes', 'consumptionConfirmed', 'posted', 'costEstimate'
];
var PRODUCTION_CONSUMPTION_HEADERS = [
  'id', 'orderId', 'productId', 'expectedQty', 'actualQty', 'unit', 'notes', 'consumptionMethod'
];
var PRODUCTION_WASTAGE_HEADERS = [
  'id', 'orderId', 'kind', 'productId', 'qty', 'unit', 'reason', 'notes'
];
var BATCH_HEADERS = [
  'id', 'productId', 'warehouseId', 'batchNo', 'qty', 'expiry', 'productionDate', 'productionOrderId'
];
var SESSION_HEADERS = [
  'id', 'productionDate', 'reference', 'status', 'warehouseId',
  'createdBy', 'createdAt', 'acceptedBy', 'acceptedAt', 'startedBy', 'startedAt',
  'completedBy', 'completedAt', 'cancelledBy', 'cancelledAt',
  'resultSavedBy', 'resultSavedAt', 'distributionSavedBy', 'distributionSavedAt',
  'recipePhoto', 'recipePhotoName', 'uploadedBy', 'uploadedAt', 'notes', 'posted',
  'closingCheckedAt', 'closingCheckedBy', 'closingAcknowledged', 'closingSignificantVariance'
];
var SESSION_ITEM_HEADERS = [
  'id', 'sessionId', 'productId', 'bomId', 'originalTargetQty', 'targetQty', 'actualQty',
  'shortProductionQty', 'shortProductionReason', 'productionBalanceQty', 'balanceLocation',
  'balanceContainer', 'wasteQty', 'wasteReason', 'notes', 'displayQty', 'cartonQty',
  'carryForward', 'carriedFromSessionId', 'carriedFromItemId', 'carriedForwardAt', 'carriedForwardBy'
];
var PICKING_HEADERS = [
  'id', 'sessionId', 'kind', 'productId', 'label', 'requiredQty', 'existingBalanceQty',
  'freshQty', 'qtyToPick', 'unit', 'source', 'location', 'container', 'balanceId',
  'picked', 'previousPickedQty'
];
var EXCESS_RETURN_HEADERS = ['id', 'sessionId', 'productId', 'qty', 'unit', 'status', 'notes'];
var TARGET_CHANGE_HEADERS = [
  'id', 'sessionId', 'productId', 'originalTarget', 'newTarget', 'reason', 'changedBy', 'changedAt'
];
var COMPLETED_EDIT_HEADERS = [
  'id', 'sessionId', 'productId', 'field', 'originalValue', 'newValue', 'reason', 'editedBy', 'editedAt'
];
var MATERIAL_CLOSING_LINE_HEADERS = [
  'id', 'sessionId', 'productId', 'plannedQty', 'availableQty', 'expectedRemainingQty',
  'remainingQty', 'actualUsedQty', 'varianceQty', 'variancePercent', 'fullUnits', 'looseQty'
];
var MATERIAL_ALLOCATION_HEADERS = [
  'id', 'sessionId', 'productId', 'source', 'purchaseQty', 'purchaseUnit', 'baseQty', 'baseUnit',
  'containerType', 'notes', 'reference', 'createdBy', 'createdAt'
];
var MATERIAL_AUDIT_HEADERS = [
  'id', 'sessionId', 'productId', 'action', 'source', 'purchaseQty', 'purchaseUnit', 'baseQty',
  'baseUnit', 'containerType', 'notes', 'reason', 'createdBy', 'createdAt'
];

function createManufacturingRepository(sheetRepository) {
  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function num(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function flag(value) {
    return value === true || value === 'true' || value === 'TRUE';
  }

  function forceText(sheet, column) {
    if (!sheet || column < 1) return;
    var range = sheet.getRange(1, column, 1000, 1);
    if (range.setNumberFormat) range.setNumberFormat('@');
  }

  function ensure(spreadsheet) {
    var packings = sheetRepository.ensureSheet(spreadsheet, 'PackingAssemblies', PACKING_HEADERS);
    var snapshots = sheetRepository.ensureSheet(spreadsheet, 'PackingSnapshotItems', PACKING_SNAPSHOT_HEADERS);
    var orders = sheetRepository.ensureSheet(spreadsheet, 'ProductionOrders', PRODUCTION_ORDER_HEADERS);
    var consumptions = sheetRepository.ensureSheet(spreadsheet, 'ProductionConsumptions', PRODUCTION_CONSUMPTION_HEADERS);
    var wastage = sheetRepository.ensureSheet(spreadsheet, 'ProductionWastage', PRODUCTION_WASTAGE_HEADERS);
    var batches = sheetRepository.ensureSheet(spreadsheet, 'Batches', BATCH_HEADERS);
    var sessions = sheetRepository.ensureSheet(spreadsheet, 'ProductionSessions', SESSION_HEADERS);
    var sessionItems = sheetRepository.ensureSheet(spreadsheet, 'ProductionSessionItems', SESSION_ITEM_HEADERS);
    var picking = sheetRepository.ensureSheet(spreadsheet, 'PickingLines', PICKING_HEADERS);
    var excess = sheetRepository.ensureSheet(spreadsheet, 'ExcessReturns', EXCESS_RETURN_HEADERS);
    var targetChanges = sheetRepository.ensureSheet(spreadsheet, 'TargetChangeLogs', TARGET_CHANGE_HEADERS);
    var completedEdits = sheetRepository.ensureSheet(spreadsheet, 'CompletedEditLogs', COMPLETED_EDIT_HEADERS);
    var closingLines = sheetRepository.ensureSheet(spreadsheet, 'MaterialClosingLines', MATERIAL_CLOSING_LINE_HEADERS);
    var allocations = sheetRepository.ensureSheet(spreadsheet, 'MaterialAllocations', MATERIAL_ALLOCATION_HEADERS);
    var audits = sheetRepository.ensureSheet(spreadsheet, 'MaterialAudits', MATERIAL_AUDIT_HEADERS);
    forceText(packings, PACKING_HEADERS.indexOf('id') + 1);
    forceText(snapshots, PACKING_SNAPSHOT_HEADERS.indexOf('packingId') + 1);
    forceText(orders, PRODUCTION_ORDER_HEADERS.indexOf('id') + 1);
    forceText(consumptions, PRODUCTION_CONSUMPTION_HEADERS.indexOf('orderId') + 1);
    forceText(wastage, PRODUCTION_WASTAGE_HEADERS.indexOf('orderId') + 1);
    forceText(batches, BATCH_HEADERS.indexOf('productionOrderId') + 1);
    forceText(sessions, SESSION_HEADERS.indexOf('id') + 1);
    forceText(sessionItems, SESSION_ITEM_HEADERS.indexOf('sessionId') + 1);
    forceText(picking, PICKING_HEADERS.indexOf('sessionId') + 1);
    return {
      packings: packings,
      snapshots: snapshots,
      orders: orders,
      consumptions: consumptions,
      wastage: wastage,
      batches: batches,
      sessions: sessions,
      sessionItems: sessionItems,
      picking: picking,
      excess: excess,
      targetChanges: targetChanges,
      completedEdits: completedEdits,
      closingLines: closingLines,
      allocations: allocations,
      audits: audits
    };
  }

  function packingStatus(value) {
    var status = text(value).trim();
    if (status === 'confirmed' || status === 'cancelled') return status;
    return 'draft';
  }

  function orderStatus(value) {
    var status = text(value).trim();
    if (status === 'draft' || status === 'in_progress' || status === 'paused' ||
        status === 'completed' || status === 'cancelled') return status;
    return 'planned';
  }

  function parseJson(value, fallback) {
    var raw = text(value).trim();
    if (!raw) return fallback;
    try {
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function readSnapshotItems(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'PackingSnapshotItems');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      return {
        id: text(row.id).trim(),
        packingId: text(row.packingId).trim(),
        productId: text(row.productId).trim(),
        productName: text(row.productName),
        sku: text(row.sku),
        qty: num(row.qty),
        unit: text(row.unit).trim(),
        wastagePct: num(row.wastagePct),
        notes: text(row.notes),
        consumptionMethod: text(row.consumptionMethod).trim() === 'MANUAL' ? 'MANUAL' : 'AUTO'
      };
    }).filter(function (row) { return row.id && row.packingId; });
  }

  function readPackings(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'PackingAssemblies');
    if (!sheet) return [];
    var items = readSnapshotItems(spreadsheet);
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var snapshotItems = items.filter(function (item) { return item.packingId === id; }).map(function (item) {
        return {
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          qty: item.qty,
          unit: item.unit,
          wastagePct: item.wastagePct,
          notes: item.notes,
          consumptionMethod: item.consumptionMethod
        };
      });
      var packing = {
        id: id,
        packingNo: text(row.packingNo).trim(),
        date: text(row.date).trim(),
        productId: text(row.productId).trim(),
        bomId: text(row.bomId).trim(),
        warehouseId: text(row.warehouseId).trim(),
        plannedQty: num(row.plannedQty),
        actualQty: num(row.actualQty),
        unit: text(row.unit).trim(),
        status: packingStatus(row.status),
        posted: flag(row.posted),
        notes: text(row.notes),
        createdBy: text(row.createdBy),
        createdAt: text(row.createdAt).trim(),
        costEstimate: num(row.costEstimate),
        bomSnapshot: {
          bomId: text(row.snapshotBomId).trim() || text(row.bomId).trim(),
          name: text(row.snapshotName),
          outputQty: num(row.snapshotOutputQty) || 1,
          outputUnit: text(row.snapshotOutputUnit).trim() || text(row.unit).trim(),
          capturedAt: text(row.snapshotCapturedAt).trim() || text(row.createdAt).trim(),
          items: snapshotItems
        },
        consumptions: parseJson(row.consumptionsJson, [])
      };
      var confirmedBy = text(row.confirmedBy).trim();
      var confirmedAt = text(row.confirmedAt).trim();
      if (confirmedBy) packing.confirmedBy = confirmedBy;
      if (confirmedAt) packing.confirmedAt = confirmedAt;
      return packing;
    }).filter(Boolean);
  }

  function writePackings(spreadsheet, packings) {
    ensure(spreadsheet);
    var snapshotRows = [];
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'PackingAssemblies'), (packings || []).map(function (row) {
      var snapshot = row.bomSnapshot || { items: [] };
      (snapshot.items || []).forEach(function (item, index) {
        snapshotRows.push({
          id: row.id + '.' + (index + 1),
          packingId: row.id,
          productId: item.productId,
          productName: item.productName || '',
          sku: item.sku || '',
          qty: item.qty,
          unit: item.unit,
          wastagePct: item.wastagePct || 0,
          notes: item.notes || '',
          consumptionMethod: packingConsumptionMethod(item)
        });
      });
      return {
        id: row.id,
        packingNo: row.packingNo,
        date: row.date,
        productId: row.productId,
        bomId: row.bomId,
        warehouseId: row.warehouseId,
        plannedQty: row.plannedQty,
        actualQty: row.actualQty,
        unit: row.unit,
        status: row.status,
        posted: Boolean(row.posted),
        notes: row.notes || '',
        createdBy: row.createdBy || '',
        createdAt: row.createdAt,
        confirmedBy: row.confirmedBy || '',
        confirmedAt: row.confirmedAt || '',
        costEstimate: row.costEstimate || 0,
        snapshotBomId: snapshot.bomId || row.bomId,
        snapshotName: snapshot.name || '',
        snapshotOutputQty: snapshot.outputQty || 0,
        snapshotOutputUnit: snapshot.outputUnit || '',
        snapshotCapturedAt: snapshot.capturedAt || '',
        consumptionsJson: JSON.stringify(row.consumptions || [])
      };
    }));
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'PackingSnapshotItems'), snapshotRows);
  }

  function readConsumptions(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'ProductionConsumptions');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      return {
        id: text(row.id).trim(),
        orderId: text(row.orderId).trim(),
        productId: text(row.productId).trim(),
        expectedQty: num(row.expectedQty),
        actualQty: num(row.actualQty),
        unit: text(row.unit).trim(),
        notes: text(row.notes),
        consumptionMethod: text(row.consumptionMethod).trim() === 'MANUAL' ? 'MANUAL' : 'AUTO'
      };
    }).filter(function (row) { return row.id && row.orderId; });
  }

  function readWastage(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'ProductionWastage');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var item = {
        id: text(row.id).trim(),
        orderId: text(row.orderId).trim(),
        kind: text(row.kind).trim(),
        qty: num(row.qty),
        unit: text(row.unit).trim(),
        reason: text(row.reason),
        notes: text(row.notes)
      };
      var productId = text(row.productId).trim();
      if (productId) item.productId = productId;
      return item;
    }).filter(function (row) { return row.id && row.orderId; });
  }

  function readOrders(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'ProductionOrders');
    if (!sheet) return [];
    var consumptions = readConsumptions(spreadsheet);
    var wastage = readWastage(spreadsheet);
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var order = {
        id: id,
        orderNo: text(row.orderNo).trim(),
        date: text(row.date).trim(),
        productId: text(row.productId).trim(),
        bomId: text(row.bomId).trim(),
        warehouseId: text(row.warehouseId).trim(),
        plannedQty: num(row.plannedQty),
        actualQty: num(row.actualQty),
        unit: text(row.unit).trim(),
        plannedStart: text(row.plannedStart).trim(),
        plannedEnd: text(row.plannedEnd).trim(),
        status: orderStatus(row.status),
        batchNo: text(row.batchNo).trim(),
        operator: text(row.operator),
        notes: text(row.notes),
        consumptions: consumptions.filter(function (line) { return line.orderId === id; }).map(function (line) {
          return {
            productId: line.productId,
            expectedQty: line.expectedQty,
            actualQty: line.actualQty,
            unit: line.unit,
            notes: line.notes,
            consumptionMethod: line.consumptionMethod
          };
        }),
        wastage: wastage.filter(function (line) { return line.orderId === id; }).map(function (line) {
          var item = {
            id: line.id,
            kind: line.kind,
            qty: line.qty,
            unit: line.unit,
            reason: line.reason,
            notes: line.notes
          };
          if (line.productId) item.productId = line.productId;
          return item;
        }),
        consumptionConfirmed: flag(row.consumptionConfirmed),
        posted: flag(row.posted),
        costEstimate: num(row.costEstimate)
      };
      var actualStart = text(row.actualStart).trim();
      var actualEnd = text(row.actualEnd).trim();
      var expiryDate = text(row.expiryDate).trim();
      if (actualStart) order.actualStart = actualStart;
      if (actualEnd) order.actualEnd = actualEnd;
      if (expiryDate) order.expiryDate = expiryDate;
      return order;
    }).filter(Boolean);
  }

  function writeOrders(spreadsheet, orders) {
    ensure(spreadsheet);
    var consumptionRows = [];
    var wastageRows = [];
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'ProductionOrders'), (orders || []).map(function (row) {
      (row.consumptions || []).forEach(function (line, index) {
        consumptionRows.push({
          id: row.id + '.c' + (index + 1),
          orderId: row.id,
          productId: line.productId,
          expectedQty: line.expectedQty,
          actualQty: line.actualQty,
          unit: line.unit,
          notes: line.notes || '',
          consumptionMethod: packingConsumptionMethod(line)
        });
      });
      (row.wastage || []).forEach(function (line) {
        wastageRows.push({
          id: line.id,
          orderId: row.id,
          kind: line.kind,
          productId: line.productId || '',
          qty: line.qty,
          unit: line.unit,
          reason: line.reason || '',
          notes: line.notes || ''
        });
      });
      return {
        id: row.id,
        orderNo: row.orderNo,
        date: row.date,
        productId: row.productId,
        bomId: row.bomId,
        warehouseId: row.warehouseId,
        plannedQty: row.plannedQty,
        actualQty: row.actualQty,
        unit: row.unit,
        plannedStart: row.plannedStart,
        plannedEnd: row.plannedEnd,
        actualStart: row.actualStart || '',
        actualEnd: row.actualEnd || '',
        status: row.status,
        batchNo: row.batchNo || '',
        expiryDate: row.expiryDate || '',
        operator: row.operator || '',
        notes: row.notes || '',
        consumptionConfirmed: Boolean(row.consumptionConfirmed),
        posted: Boolean(row.posted),
        costEstimate: row.costEstimate || 0
      };
    }));
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'ProductionConsumptions'), consumptionRows);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'ProductionWastage'), wastageRows);
  }

  function readBatches(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Batches');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var batch = {
        id: text(row.id).trim(),
        productId: text(row.productId).trim(),
        warehouseId: text(row.warehouseId).trim(),
        batchNo: text(row.batchNo).trim(),
        qty: num(row.qty),
        productionDate: text(row.productionDate).trim(),
        productionOrderId: text(row.productionOrderId).trim()
      };
      var expiry = text(row.expiry).trim();
      if (expiry) batch.expiry = expiry;
      return batch;
    }).filter(function (row) { return row.id; });
  }

  function writeBatches(spreadsheet, batches) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Batches'), (batches || []).map(function (row) {
      return {
        id: row.id,
        productId: row.productId,
        warehouseId: row.warehouseId,
        batchNo: row.batchNo,
        qty: row.qty,
        expiry: row.expiry || '',
        productionDate: row.productionDate,
        productionOrderId: row.productionOrderId
      };
    }));
  }

  function sessionStatus(value) {
    var status = text(value).trim();
    if (status === 'accepted' || status === 'in_progress' || status === 'completed' || status === 'cancelled') return status;
    return 'planned';
  }

  function readChild(spreadsheet, name, mapFn) {
    var sheet = sheetRepository.getSheet(spreadsheet, name);
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(mapFn).filter(function (row) { return row && row.id; });
  }

  function readSessions(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'ProductionSessions');
    if (!sheet) return [];
    var items = readChild(spreadsheet, 'ProductionSessionItems', function (row) {
      return {
        id: text(row.id).trim(),
        sessionId: text(row.sessionId).trim(),
        productId: text(row.productId).trim(),
        bomId: text(row.bomId).trim(),
        originalTargetQty: num(row.originalTargetQty),
        targetQty: num(row.targetQty),
        actualQty: num(row.actualQty),
        shortProductionQty: num(row.shortProductionQty),
        shortProductionReason: text(row.shortProductionReason),
        productionBalanceQty: num(row.productionBalanceQty),
        balanceLocation: text(row.balanceLocation),
        balanceContainer: text(row.balanceContainer),
        wasteQty: num(row.wasteQty),
        wasteReason: text(row.wasteReason),
        notes: text(row.notes),
        displayQty: num(row.displayQty),
        cartonQty: num(row.cartonQty),
        carryForward: flag(row.carryForward),
        carriedFromSessionId: text(row.carriedFromSessionId).trim() || undefined,
        carriedFromItemId: text(row.carriedFromItemId).trim() || undefined,
        carriedForwardAt: text(row.carriedForwardAt).trim() || undefined,
        carriedForwardBy: text(row.carriedForwardBy).trim() || undefined
      };
    });
    var picking = readChild(spreadsheet, 'PickingLines', function (row) {
      var line = {
        id: text(row.id).trim(),
        sessionId: text(row.sessionId).trim(),
        kind: text(row.kind).trim() || 'raw',
        productId: text(row.productId).trim(),
        label: text(row.label),
        requiredQty: num(row.requiredQty),
        existingBalanceQty: num(row.existingBalanceQty),
        freshQty: num(row.freshQty),
        qtyToPick: num(row.qtyToPick),
        unit: text(row.unit).trim(),
        source: text(row.source),
        location: text(row.location),
        container: text(row.container),
        picked: flag(row.picked)
      };
      var balanceId = text(row.balanceId).trim();
      if (balanceId) line.balanceId = balanceId;
      var previous = text(row.previousPickedQty).trim();
      if (previous) line.previousPickedQty = num(row.previousPickedQty);
      return line;
    });
    var excess = readChild(spreadsheet, 'ExcessReturns', function (row) {
      return {
        id: text(row.id).trim(),
        sessionId: text(row.sessionId).trim(),
        productId: text(row.productId).trim(),
        qty: num(row.qty),
        unit: text(row.unit).trim(),
        status: text(row.status).trim() === 'returned' ? 'returned' : 'to_return',
        notes: text(row.notes)
      };
    });
    var targetChanges = readChild(spreadsheet, 'TargetChangeLogs', function (row) {
      return {
        id: text(row.id).trim(),
        sessionId: text(row.sessionId).trim(),
        productId: text(row.productId).trim(),
        originalTarget: num(row.originalTarget),
        newTarget: num(row.newTarget),
        reason: text(row.reason),
        changedBy: text(row.changedBy),
        changedAt: text(row.changedAt).trim()
      };
    });
    var completedEdits = readChild(spreadsheet, 'CompletedEditLogs', function (row) {
      return {
        id: text(row.id).trim(),
        sessionId: text(row.sessionId).trim(),
        productId: text(row.productId).trim(),
        field: text(row.field).trim(),
        originalValue: text(row.originalValue),
        newValue: text(row.newValue),
        reason: text(row.reason),
        editedBy: text(row.editedBy),
        editedAt: text(row.editedAt).trim()
      };
    });
    var closingLines = readChild(spreadsheet, 'MaterialClosingLines', function (row) {
      var line = {
        id: text(row.id).trim(),
        sessionId: text(row.sessionId).trim(),
        productId: text(row.productId).trim(),
        plannedQty: num(row.plannedQty),
        availableQty: num(row.availableQty),
        expectedRemainingQty: num(row.expectedRemainingQty),
        remainingQty: num(row.remainingQty),
        actualUsedQty: num(row.actualUsedQty),
        varianceQty: num(row.varianceQty),
        variancePercent: num(row.variancePercent),
        looseQty: num(row.looseQty)
      };
      if (text(row.fullUnits).trim() !== '') line.fullUnits = num(row.fullUnits);
      return line;
    });
    var allocations = readChild(spreadsheet, 'MaterialAllocations', function (row) {
      var line = {
        id: text(row.id).trim(),
        sessionId: text(row.sessionId).trim(),
        productId: text(row.productId).trim(),
        source: text(row.source).trim() || 'picking',
        baseQty: num(row.baseQty),
        baseUnit: text(row.baseUnit).trim(),
        createdBy: text(row.createdBy),
        createdAt: text(row.createdAt).trim()
      };
      if (text(row.purchaseQty).trim() !== '') line.purchaseQty = num(row.purchaseQty);
      if (text(row.purchaseUnit).trim()) line.purchaseUnit = text(row.purchaseUnit).trim();
      if (text(row.containerType).trim()) line.containerType = text(row.containerType).trim();
      if (text(row.notes).trim()) line.notes = text(row.notes);
      if (text(row.reference).trim()) line.reference = text(row.reference).trim();
      return line;
    });
    var audits = readChild(spreadsheet, 'MaterialAudits', function (row) {
      var line = {
        id: text(row.id).trim(),
        sessionId: text(row.sessionId).trim(),
        productId: text(row.productId).trim(),
        action: text(row.action).trim(),
        createdBy: text(row.createdBy),
        createdAt: text(row.createdAt).trim()
      };
      if (text(row.source).trim()) line.source = text(row.source).trim();
      if (text(row.purchaseQty).trim() !== '') line.purchaseQty = num(row.purchaseQty);
      if (text(row.purchaseUnit).trim()) line.purchaseUnit = text(row.purchaseUnit).trim();
      if (text(row.baseQty).trim() !== '') line.baseQty = num(row.baseQty);
      if (text(row.baseUnit).trim()) line.baseUnit = text(row.baseUnit).trim();
      if (text(row.containerType).trim()) line.containerType = text(row.containerType).trim();
      if (text(row.notes).trim()) line.notes = text(row.notes);
      if (text(row.reason).trim()) line.reason = text(row.reason);
      return line;
    });
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var session = {
        id: id,
        productionDate: text(row.productionDate).trim(),
        reference: text(row.reference).trim(),
        status: sessionStatus(row.status),
        warehouseId: text(row.warehouseId).trim(),
        createdBy: text(row.createdBy),
        createdAt: text(row.createdAt).trim(),
        acceptedBy: text(row.acceptedBy),
        acceptedAt: text(row.acceptedAt).trim(),
        startedBy: text(row.startedBy),
        startedAt: text(row.startedAt).trim(),
        completedBy: text(row.completedBy),
        completedAt: text(row.completedAt).trim(),
        cancelledBy: text(row.cancelledBy).trim() || undefined,
        cancelledAt: text(row.cancelledAt).trim() || undefined,
        resultSavedBy: text(row.resultSavedBy).trim() || undefined,
        resultSavedAt: text(row.resultSavedAt).trim() || undefined,
        distributionSavedBy: text(row.distributionSavedBy).trim() || undefined,
        distributionSavedAt: text(row.distributionSavedAt).trim() || undefined,
        recipePhoto: text(row.recipePhoto),
        recipePhotoName: text(row.recipePhotoName),
        uploadedBy: text(row.uploadedBy),
        uploadedAt: text(row.uploadedAt).trim(),
        notes: text(row.notes),
        posted: flag(row.posted),
        items: items.filter(function (item) { return item.sessionId === id; }),
        picking: picking.filter(function (item) { return item.sessionId === id; }).map(function (item) {
          var copy = Object.assign({}, item);
          delete copy.sessionId;
          return copy;
        }),
        excessReturns: excess.filter(function (item) { return item.sessionId === id; }).map(function (item) {
          var copy = Object.assign({}, item);
          delete copy.sessionId;
          return copy;
        }),
        targetChanges: targetChanges.filter(function (item) { return item.sessionId === id; }),
        completedEdits: completedEdits.filter(function (item) { return item.sessionId === id; }),
        materialAllocations: allocations.filter(function (item) { return item.sessionId === id; }),
        materialAudits: audits.filter(function (item) { return item.sessionId === id; })
      };
      if (text(row.closingCheckedAt).trim()) {
        session.materialClosing = {
          checkedAt: text(row.closingCheckedAt).trim(),
          checkedBy: text(row.closingCheckedBy),
          acknowledged: flag(row.closingAcknowledged),
          significantVariance: flag(row.closingSignificantVariance),
          lines: closingLines.filter(function (item) { return item.sessionId === id; }).map(function (item) {
            var copy = Object.assign({}, item);
            delete copy.id;
            delete copy.sessionId;
            return copy;
          })
        };
      }
      return session;
    }).filter(Boolean);
  }

  function writeSessions(spreadsheet, sessions) {
    ensure(spreadsheet);
    var itemRows = [];
    var pickingRows = [];
    var excessRows = [];
    var changeRows = [];
    var editRows = [];
    var closingRows = [];
    var allocationRows = [];
    var auditRows = [];
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'ProductionSessions'), (sessions || []).map(function (row) {
      (row.items || []).forEach(function (item) {
        itemRows.push({
          id: item.id,
          sessionId: row.id,
          productId: item.productId,
          bomId: item.bomId || '',
          originalTargetQty: item.originalTargetQty,
          targetQty: item.targetQty,
          actualQty: item.actualQty || 0,
          shortProductionQty: item.shortProductionQty || 0,
          shortProductionReason: item.shortProductionReason || '',
          productionBalanceQty: item.productionBalanceQty || 0,
          balanceLocation: item.balanceLocation || '',
          balanceContainer: item.balanceContainer || '',
          wasteQty: item.wasteQty || 0,
          wasteReason: item.wasteReason || '',
          notes: item.notes || '',
          displayQty: item.displayQty || 0,
          cartonQty: item.cartonQty || 0,
          carryForward: Boolean(item.carryForward),
          carriedFromSessionId: item.carriedFromSessionId || '',
          carriedFromItemId: item.carriedFromItemId || '',
          carriedForwardAt: item.carriedForwardAt || '',
          carriedForwardBy: item.carriedForwardBy || ''
        });
      });
      (row.picking || []).forEach(function (item) {
        pickingRows.push({
          id: item.id,
          sessionId: row.id,
          kind: item.kind || 'raw',
          productId: item.productId,
          label: item.label || '',
          requiredQty: item.requiredQty || 0,
          existingBalanceQty: item.existingBalanceQty || 0,
          freshQty: item.freshQty || 0,
          qtyToPick: item.qtyToPick || 0,
          unit: item.unit || '',
          source: item.source || '',
          location: item.location || '',
          container: item.container || '',
          balanceId: item.balanceId || '',
          picked: Boolean(item.picked),
          previousPickedQty: item.previousPickedQty == null ? '' : item.previousPickedQty
        });
      });
      (row.excessReturns || []).forEach(function (item) {
        excessRows.push({
          id: item.id,
          sessionId: row.id,
          productId: item.productId,
          qty: item.qty,
          unit: item.unit || '',
          status: item.status || 'to_return',
          notes: item.notes || ''
        });
      });
      (row.targetChanges || []).forEach(function (item) {
        changeRows.push(item);
      });
      (row.completedEdits || []).forEach(function (item) {
        editRows.push(item);
      });
      ((row.materialClosing && row.materialClosing.lines) || []).forEach(function (item, index) {
        closingRows.push({
          id: row.id + '.c' + (index + 1),
          sessionId: row.id,
          productId: item.productId,
          plannedQty: item.plannedQty,
          availableQty: item.availableQty,
          expectedRemainingQty: item.expectedRemainingQty || 0,
          remainingQty: item.remainingQty,
          actualUsedQty: item.actualUsedQty,
          varianceQty: item.varianceQty,
          variancePercent: item.variancePercent,
          fullUnits: item.fullUnits == null ? '' : item.fullUnits,
          looseQty: item.looseQty == null ? '' : item.looseQty
        });
      });
      (row.materialAllocations || []).forEach(function (item) {
        allocationRows.push({
          id: item.id,
          sessionId: row.id,
          productId: item.productId,
          source: item.source || 'picking',
          purchaseQty: item.purchaseQty == null ? '' : item.purchaseQty,
          purchaseUnit: item.purchaseUnit || '',
          baseQty: item.baseQty,
          baseUnit: item.baseUnit || '',
          containerType: item.containerType || '',
          notes: item.notes || '',
          reference: item.reference || '',
          createdBy: item.createdBy || '',
          createdAt: item.createdAt || ''
        });
      });
      (row.materialAudits || []).forEach(function (item) {
        auditRows.push({
          id: item.id,
          sessionId: row.id,
          productId: item.productId,
          action: item.action || '',
          source: item.source || '',
          purchaseQty: item.purchaseQty == null ? '' : item.purchaseQty,
          purchaseUnit: item.purchaseUnit || '',
          baseQty: item.baseQty == null ? '' : item.baseQty,
          baseUnit: item.baseUnit || '',
          containerType: item.containerType || '',
          notes: item.notes || '',
          reason: item.reason || '',
          createdBy: item.createdBy || '',
          createdAt: item.createdAt || ''
        });
      });
      var closing = row.materialClosing || {};
      return {
        id: row.id,
        productionDate: row.productionDate,
        reference: row.reference,
        status: row.status,
        warehouseId: row.warehouseId,
        createdBy: row.createdBy || '',
        createdAt: row.createdAt || '',
        acceptedBy: row.acceptedBy || '',
        acceptedAt: row.acceptedAt || '',
        startedBy: row.startedBy || '',
        startedAt: row.startedAt || '',
        completedBy: row.completedBy || '',
        completedAt: row.completedAt || '',
        cancelledBy: row.cancelledBy || '',
        cancelledAt: row.cancelledAt || '',
        resultSavedBy: row.resultSavedBy || '',
        resultSavedAt: row.resultSavedAt || '',
        distributionSavedBy: row.distributionSavedBy || '',
        distributionSavedAt: row.distributionSavedAt || '',
        recipePhoto: row.recipePhoto || '',
        recipePhotoName: row.recipePhotoName || '',
        uploadedBy: row.uploadedBy || '',
        uploadedAt: row.uploadedAt || '',
        notes: row.notes || '',
        posted: Boolean(row.posted),
        closingCheckedAt: closing.checkedAt || '',
        closingCheckedBy: closing.checkedBy || '',
        closingAcknowledged: Boolean(closing.acknowledged),
        closingSignificantVariance: Boolean(closing.significantVariance)
      };
    }));
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'ProductionSessionItems'), itemRows);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'PickingLines'), pickingRows);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'ExcessReturns'), excessRows);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'TargetChangeLogs'), changeRows);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'CompletedEditLogs'), editRows);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'MaterialClosingLines'), closingRows);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'MaterialAllocations'), allocationRows);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'MaterialAudits'), auditRows);
  }

  return {
    headers: {
      packings: PACKING_HEADERS,
      snapshots: PACKING_SNAPSHOT_HEADERS,
      orders: PRODUCTION_ORDER_HEADERS,
      consumptions: PRODUCTION_CONSUMPTION_HEADERS,
      wastage: PRODUCTION_WASTAGE_HEADERS,
      batches: BATCH_HEADERS,
      sessions: SESSION_HEADERS
    },
    ensure: ensure,
    readPackings: readPackings,
    writePackings: writePackings,
    readOrders: readOrders,
    writeOrders: writeOrders,
    readBatches: readBatches,
    writeBatches: writeBatches,
    readSessions: readSessions,
    writeSessions: writeSessions
  };
}
