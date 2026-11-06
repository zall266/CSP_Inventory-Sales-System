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
    forceText(packings, PACKING_HEADERS.indexOf('id') + 1);
    forceText(snapshots, PACKING_SNAPSHOT_HEADERS.indexOf('packingId') + 1);
    forceText(orders, PRODUCTION_ORDER_HEADERS.indexOf('id') + 1);
    forceText(consumptions, PRODUCTION_CONSUMPTION_HEADERS.indexOf('orderId') + 1);
    forceText(wastage, PRODUCTION_WASTAGE_HEADERS.indexOf('orderId') + 1);
    forceText(batches, BATCH_HEADERS.indexOf('productionOrderId') + 1);
    return {
      packings: packings,
      snapshots: snapshots,
      orders: orders,
      consumptions: consumptions,
      wastage: wastage,
      batches: batches
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

  return {
    headers: {
      packings: PACKING_HEADERS,
      snapshots: PACKING_SNAPSHOT_HEADERS,
      orders: PRODUCTION_ORDER_HEADERS,
      consumptions: PRODUCTION_CONSUMPTION_HEADERS,
      wastage: PRODUCTION_WASTAGE_HEADERS,
      batches: BATCH_HEADERS
    },
    ensure: ensure,
    readPackings: readPackings,
    writePackings: writePackings,
    readOrders: readOrders,
    writeOrders: writeOrders,
    readBatches: readBatches,
    writeBatches: writeBatches
  };
}
