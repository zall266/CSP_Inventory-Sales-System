// Module 10 receivings and stock orders.

var RECEIVING_HEADERS = [
  'id', 'receivingNo', 'date', 'warehouseId', 'source', 'supplierId', 'supplierNote',
  'photoFileId', 'photoName', 'notes', 'purchaseId', 'purchaseNo', 'receivedBy', 'receivedByName',
  'status', 'stockOrderId'
];
var RECEIVING_LINE_HEADERS = [
  'id', 'receivingId', 'productId', 'qty', 'unit', 'baseQty', 'batchNo', 'expiry', 'notes', 'condition'
];
var STOCK_ORDER_HEADERS = [
  'id', 'productId', 'warehouseId', 'status', 'channel', 'remark', 'orderedQty',
  'markedOrderedBy', 'markedOrderedAt', 'cancelledBy', 'cancelledAt', 'cancelReason',
  'receivedBy', 'receivedAt', 'receivingId', 'receivingNo', 'receivedQty'
];

function createReceivingRepository(sheetRepository) {
  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function num(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function round2(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function forceText(sheet, column) {
    if (!sheet || column < 1) return;
    var range = sheet.getRange(1, column, 1000, 1);
    if (range.setNumberFormat) range.setNumberFormat('@');
  }

  function ensure(spreadsheet) {
    var receivings = sheetRepository.ensureSheet(spreadsheet, 'Receivings', RECEIVING_HEADERS);
    var lines = sheetRepository.ensureSheet(spreadsheet, 'ReceivingLines', RECEIVING_LINE_HEADERS);
    var orders = sheetRepository.ensureSheet(spreadsheet, 'StockOrders', STOCK_ORDER_HEADERS);
    forceText(receivings, RECEIVING_HEADERS.indexOf('id') + 1);
    forceText(lines, RECEIVING_LINE_HEADERS.indexOf('receivingId') + 1);
    forceText(orders, STOCK_ORDER_HEADERS.indexOf('id') + 1);
    return { receivings: receivings, lines: lines, orders: orders };
  }

  function readLines(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'ReceivingLines');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var line = {
        productId: text(row.productId).trim(),
        qty: num(row.qty),
        unit: text(row.unit).trim(),
        baseQty: num(row.baseQty)
      };
      var batchNo = text(row.batchNo).trim();
      var expiry = text(row.expiry).trim();
      var notes = text(row.notes).trim();
      var condition = text(row.condition).trim();
      if (batchNo) line.batchNo = batchNo;
      if (expiry) line.expiry = expiry;
      if (notes) line.notes = notes;
      if (condition) line.condition = condition;
      return {
        id: text(row.id).trim(),
        receivingId: text(row.receivingId).trim(),
        item: line
      };
    }).filter(function (row) { return row.id && row.receivingId; });
  }

  function readReceivings(spreadsheet) {
    ensure(spreadsheet);
    var sheet = sheetRepository.getSheet(spreadsheet, 'Receivings');
    if (!sheet) return [];
    var lineRows = readLines(spreadsheet);
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var receiving = {
        id: id,
        receivingNo: text(row.receivingNo).trim(),
        date: text(row.date).trim(),
        warehouseId: text(row.warehouseId).trim(),
        source: text(row.source).trim() || 'other',
        items: [],
        receivedBy: text(row.receivedBy).trim(),
        receivedByName: text(row.receivedByName).trim(),
        status: text(row.status).trim() || 'completed'
      };
      var supplierId = text(row.supplierId).trim();
      var supplierNote = text(row.supplierNote).trim();
      var photoFileId = text(row.photoFileId).trim();
      var photoName = text(row.photoName).trim();
      var notes = text(row.notes).trim();
      var purchaseId = text(row.purchaseId).trim();
      var purchaseNo = text(row.purchaseNo).trim();
      var stockOrderId = text(row.stockOrderId).trim();
      if (supplierId) receiving.supplierId = supplierId;
      if (supplierNote) receiving.supplierNote = supplierNote;
      if (photoName) receiving.photoName = photoName;
      if (photoFileId) receiving.photoFileId = photoFileId;
      if (notes) receiving.notes = notes;
      if (purchaseId) receiving.purchaseId = purchaseId;
      if (purchaseNo) receiving.purchaseNo = purchaseNo;
      if (stockOrderId) receiving.stockOrderId = stockOrderId;
      lineRows.forEach(function (line) {
        if (line.receivingId === id) receiving.items.push(line.item);
      });
      return receiving;
    }).filter(Boolean);
  }

  function writeReceivings(spreadsheet, documents) {
    ensure(spreadsheet);
    var headers = [];
    var lineRows = [];
    (documents || []).forEach(function (doc) {
      headers.push({
        id: doc.id,
        receivingNo: doc.receivingNo,
        date: doc.date,
        warehouseId: doc.warehouseId,
        source: doc.source,
        supplierId: doc.supplierId || '',
        supplierNote: doc.supplierNote || '',
        photoFileId: doc.photoFileId || '',
        photoName: doc.photoName || '',
        notes: doc.notes || '',
        purchaseId: doc.purchaseId || '',
        purchaseNo: doc.purchaseNo || '',
        receivedBy: doc.receivedBy,
        receivedByName: doc.receivedByName,
        status: doc.status,
        stockOrderId: doc.stockOrderId || ''
      });
      (doc.items || []).forEach(function (item, index) {
        lineRows.push({
          id: doc.id + '_ln' + (index + 1),
          receivingId: doc.id,
          productId: item.productId,
          qty: item.qty,
          unit: item.unit,
          baseQty: item.baseQty,
          batchNo: item.batchNo || '',
          expiry: item.expiry || '',
          notes: item.notes || '',
          condition: item.condition || ''
        });
      });
    });
    var receivingSheet = sheetRepository.getSheet(spreadsheet, 'Receivings');
    var lineSheet = sheetRepository.getSheet(spreadsheet, 'ReceivingLines');
    sheetRepository.replaceObjects(receivingSheet, headers);
    sheetRepository.replaceObjects(lineSheet, lineRows);
  }

  function appendReceivingHeader(spreadsheet, doc) {
    ensure(spreadsheet);
    var receivingSheet = sheetRepository.getSheet(spreadsheet, 'Receivings');
    sheetRepository.appendObject(receivingSheet, {
      id: doc.id,
      receivingNo: doc.receivingNo,
      date: doc.date,
      warehouseId: doc.warehouseId,
      source: doc.source,
      supplierId: doc.supplierId || '',
      supplierNote: doc.supplierNote || '',
      photoFileId: doc.photoFileId || '',
      photoName: doc.photoName || '',
      notes: doc.notes || '',
      purchaseId: doc.purchaseId || '',
      purchaseNo: doc.purchaseNo || '',
      receivedBy: doc.receivedBy,
      receivedByName: doc.receivedByName,
      status: doc.status,
      stockOrderId: doc.stockOrderId || ''
    });
  }

  // Appends only the lines that are not stored yet, so a retry after a partial
  // write never duplicates a line.
  function appendMissingLines(spreadsheet, doc, lineIds) {
    ensure(spreadsheet);
    var lineSheet = sheetRepository.getSheet(spreadsheet, 'ReceivingLines');
    var stored = {};
    readLines(spreadsheet).forEach(function (row) {
      stored[row.id] = true;
    });
    (doc.items || []).forEach(function (item, index) {
      var lineId = (lineIds && lineIds[index]) || (doc.id + '_ln' + (index + 1));
      if (stored[lineId]) return;
      sheetRepository.appendObject(lineSheet, {
        id: lineId,
        receivingId: doc.id,
        productId: item.productId,
        qty: item.qty,
        unit: item.unit,
        baseQty: item.baseQty,
        batchNo: item.batchNo || '',
        expiry: item.expiry || '',
        notes: item.notes || '',
        condition: item.condition || ''
      });
    });
  }

  function appendReceiving(spreadsheet, doc, lineIds) {
    appendReceivingHeader(spreadsheet, doc);
    appendMissingLines(spreadsheet, doc, lineIds);
  }

  function readReceivingLink(spreadsheet, receivingId) {
    var rows = readReceivings(spreadsheet);
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].id === text(receivingId).trim()) {
        return {
          id: rows[i].id,
          receivingNo: rows[i].receivingNo,
          purchaseId: rows[i].purchaseId || '',
          purchaseNo: rows[i].purchaseNo || ''
        };
      }
    }
    return null;
  }

  function linkReceivingToPurchase(spreadsheet, receivingId, purchaseId, purchaseNo) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Receivings');
    if (!sheet) return;
    var rows = sheetRepository.readObjects(sheet);
    if (!rows.length) return;
    var next = rows.map(function (row) {
      if (text(row.id).trim() !== text(receivingId).trim()) return row;
      var copy = Object.assign({}, row);
      copy.purchaseId = purchaseId;
      copy.purchaseNo = purchaseNo;
      return copy;
    });
    sheetRepository.replaceObjects(sheet, next);
  }

  function readStockOrders(spreadsheet) {
    ensure(spreadsheet);
    var sheet = sheetRepository.getSheet(spreadsheet, 'StockOrders');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var order = {
        id: id,
        productId: text(row.productId).trim(),
        warehouseId: text(row.warehouseId).trim(),
        status: text(row.status).trim(),
        markedOrderedBy: text(row.markedOrderedBy).trim(),
        markedOrderedAt: text(row.markedOrderedAt).trim()
      };
      var channel = text(row.channel).trim();
      var remark = text(row.remark).trim();
      var orderedQty = num(row.orderedQty);
      var cancelledBy = text(row.cancelledBy).trim();
      var cancelledAt = text(row.cancelledAt).trim();
      var cancelReason = text(row.cancelReason).trim();
      var receivedBy = text(row.receivedBy).trim();
      var receivedAt = text(row.receivedAt).trim();
      var receivingId = text(row.receivingId).trim();
      var receivingNo = text(row.receivingNo).trim();
      var receivedQty = num(row.receivedQty);
      if (channel) order.channel = channel;
      if (remark) order.remark = remark;
      if (orderedQty > 0) order.orderedQty = round2(orderedQty);
      if (cancelledBy) order.cancelledBy = cancelledBy;
      if (cancelledAt) order.cancelledAt = cancelledAt;
      if (cancelReason) order.cancelReason = cancelReason;
      if (receivedBy) order.receivedBy = receivedBy;
      if (receivedAt) order.receivedAt = receivedAt;
      if (receivingId) order.receivingId = receivingId;
      if (receivingNo) order.receivingNo = receivingNo;
      if (receivedQty > 0) order.receivedQty = round2(receivedQty);
      return order;
    }).filter(Boolean);
  }

  function writeStockOrders(spreadsheet, orders) {
    ensure(spreadsheet);
    var sheet = sheetRepository.getSheet(spreadsheet, 'StockOrders');
    var rows = (orders || []).map(function (order) {
      return {
        id: order.id,
        productId: order.productId,
        warehouseId: order.warehouseId,
        status: order.status,
        channel: order.channel || '',
        remark: order.remark || '',
        orderedQty: order.orderedQty != null ? order.orderedQty : '',
        markedOrderedBy: order.markedOrderedBy || '',
        markedOrderedAt: order.markedOrderedAt || '',
        cancelledBy: order.cancelledBy || '',
        cancelledAt: order.cancelledAt || '',
        cancelReason: order.cancelReason || '',
        receivedBy: order.receivedBy || '',
        receivedAt: order.receivedAt || '',
        receivingId: order.receivingId || '',
        receivingNo: order.receivingNo || '',
        receivedQty: order.receivedQty != null ? order.receivedQty : ''
      };
    });
    sheetRepository.replaceObjects(sheet, rows);
  }

  function appendStockOrder(spreadsheet, order) {
    ensure(spreadsheet);
    var sheet = sheetRepository.getSheet(spreadsheet, 'StockOrders');
    sheetRepository.appendObject(sheet, {
      id: order.id,
      productId: order.productId,
      warehouseId: order.warehouseId,
      status: order.status,
      channel: order.channel || '',
      remark: order.remark || '',
      orderedQty: order.orderedQty != null ? order.orderedQty : '',
      markedOrderedBy: order.markedOrderedBy || '',
      markedOrderedAt: order.markedOrderedAt || '',
      cancelledBy: order.cancelledBy || '',
      cancelledAt: order.cancelledAt || '',
      cancelReason: order.cancelReason || '',
      receivedBy: order.receivedBy || '',
      receivedAt: order.receivedAt || '',
      receivingId: order.receivingId || '',
      receivingNo: order.receivingNo || '',
      receivedQty: order.receivedQty != null ? order.receivedQty : ''
    });
  }

  function updateStockOrder(spreadsheet, order) {
    var orders = readStockOrders(spreadsheet);
    var next = orders.map(function (row) { return row.id === order.id ? order : row; });
    writeStockOrders(spreadsheet, next);
  }

  return {
    ensure: ensure,
    readReceivings: readReceivings,
    writeReceivings: writeReceivings,
    appendReceiving: appendReceiving,
    appendReceivingHeader: appendReceivingHeader,
    appendMissingLines: appendMissingLines,
    readReceivingLink: readReceivingLink,
    linkReceivingToPurchase: linkReceivingToPurchase,
    readStockOrders: readStockOrders,
    writeStockOrders: writeStockOrders,
    appendStockOrder: appendStockOrder,
    updateStockOrder: updateStockOrder
  };
}
