// Module 14 sales returns, return sources, and return reasons.

var SALES_RETURN_HEADERS = [
  'id', 'returnNo', 'returnDate', 'date', 'sourceId', 'sourceNameSnapshot',
  'originalSaleId', 'originalDocumentNo', 'saleId', 'customerId', 'customerNameSnapshot',
  'reasonId', 'reasonNameSnapshot', 'reason', 'warehouseId', 'status', 'notes',
  'photoUrl', 'photoName', 'evidenceJson', 'createdBy', 'createdByName', 'createdAt',
  'confirmedBy', 'confirmedAt', 'cancelledBy', 'cancelledAt', 'total'
];
var SALES_RETURN_LINE_HEADERS = [
  'id', 'returnId', 'productId', 'productNameSnapshot', 'skuSnapshot', 'returnedQty', 'unit',
  'goodQty', 'repackQty', 'repackRecoveredGrams', 'repackStorageBoxId', 'wasteQty',
  'wasteReason', 'notes', 'qty', 'price'
];
var RETURN_SOURCE_HEADERS = ['id', 'name', 'active', 'createdAt', 'updatedAt'];
var RETURN_REASON_HEADERS = ['id', 'name', 'active', 'createdAt', 'updatedAt'];

function createSalesReturnRepository(sheetRepository) {
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

  function flag(value) {
    return value === true || value === 'true' || value === 'TRUE';
  }

  function optional(value) {
    var next = text(value).trim();
    return next || undefined;
  }

  function forceText(sheet, column) {
    if (!sheet || column < 1) return;
    var range = sheet.getRange(1, column, 1000, 1);
    if (range.setNumberFormat) range.setNumberFormat('@');
  }

  function parseJson(value) {
    var raw = text(value).trim();
    if (!raw) return undefined;
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch (error) {
      return undefined;
    }
  }

  function ensure(spreadsheet) {
    var docs = sheetRepository.ensureSheet(spreadsheet, 'SalesReturns', SALES_RETURN_HEADERS);
    var lines = sheetRepository.ensureSheet(spreadsheet, 'SalesReturnLines', SALES_RETURN_LINE_HEADERS);
    var sources = sheetRepository.ensureSheet(spreadsheet, 'ReturnSources', RETURN_SOURCE_HEADERS);
    var reasons = sheetRepository.ensureSheet(spreadsheet, 'ReturnReasons', RETURN_REASON_HEADERS);
    forceText(docs, SALES_RETURN_HEADERS.indexOf('id') + 1);
    forceText(docs, SALES_RETURN_HEADERS.indexOf('returnNo') + 1);
    forceText(lines, SALES_RETURN_LINE_HEADERS.indexOf('returnId') + 1);
    return { docs: docs, lines: lines, sources: sources, reasons: reasons };
  }

  function readLookups(spreadsheet, name) {
    var sheet = sheetRepository.getSheet(spreadsheet, name);
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      return {
        id: id,
        name: text(row.name).trim(),
        active: row.active === '' ? true : flag(row.active),
        createdAt: text(row.createdAt).trim(),
        updatedAt: text(row.updatedAt).trim()
      };
    }).filter(Boolean);
  }

  function writeLookups(spreadsheet, name, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, name), (rows || []).map(function (row) {
      return {
        id: row.id,
        name: row.name,
        active: row.active !== false,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      };
    }));
  }

  function readLines(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'SalesReturnLines');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      var returnId = text(row.returnId).trim();
      if (!id || !returnId) return null;
      var item = {
        id: id,
        productId: text(row.productId).trim(),
        productNameSnapshot: text(row.productNameSnapshot).trim(),
        skuSnapshot: text(row.skuSnapshot).trim(),
        returnedQty: num(row.returnedQty),
        unit: text(row.unit).trim() || 'PACK',
        goodQty: num(row.goodQty),
        repackQty: num(row.repackQty),
        wasteQty: num(row.wasteQty),
        qty: num(row.qty || row.returnedQty),
        price: num(row.price)
      };
      var grams = optional(row.repackRecoveredGrams);
      var box = optional(row.repackStorageBoxId);
      var wasteReason = optional(row.wasteReason);
      var notes = optional(row.notes);
      if (grams) item.repackRecoveredGrams = num(grams);
      if (box) item.repackStorageBoxId = box;
      if (wasteReason) item.wasteReason = wasteReason;
      if (notes) item.notes = notes;
      return { returnId: returnId, item: item };
    }).filter(Boolean);
  }

  function readReturns(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'SalesReturns');
    if (!sheet) return [];
    var lineRows = readLines(spreadsheet);
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var doc = {
        id: id,
        returnNo: text(row.returnNo).trim(),
        returnDate: text(row.returnDate).trim() || text(row.date).trim(),
        date: text(row.date).trim() || text(row.returnDate).trim(),
        sourceId: text(row.sourceId).trim(),
        sourceNameSnapshot: text(row.sourceNameSnapshot).trim(),
        reasonId: text(row.reasonId).trim(),
        reasonNameSnapshot: text(row.reasonNameSnapshot).trim() || text(row.reason).trim(),
        warehouseId: text(row.warehouseId).trim(),
        items: [],
        status: text(row.status).trim() || 'draft',
        createdBy: text(row.createdBy).trim(),
        createdByName: text(row.createdByName).trim(),
        createdAt: text(row.createdAt).trim(),
        total: round2(num(row.total))
      };
      var originalSaleId = optional(row.originalSaleId) || optional(row.saleId);
      var originalDocumentNo = optional(row.originalDocumentNo);
      var customerId = optional(row.customerId);
      var customerName = optional(row.customerNameSnapshot);
      var notes = optional(row.notes);
      var photoUrl = optional(row.photoUrl);
      var photoName = optional(row.photoName);
      var reason = optional(row.reason) || doc.reasonNameSnapshot;
      var confirmedBy = optional(row.confirmedBy);
      var confirmedAt = optional(row.confirmedAt);
      var cancelledBy = optional(row.cancelledBy);
      var cancelledAt = optional(row.cancelledAt);
      var evidence = parseJson(row.evidenceJson);
      if (originalSaleId) {
        doc.originalSaleId = originalSaleId;
        doc.saleId = originalSaleId;
      }
      if (originalDocumentNo) doc.originalDocumentNo = originalDocumentNo;
      if (customerId) doc.customerId = customerId;
      if (customerName) doc.customerNameSnapshot = customerName;
      if (notes) doc.notes = notes;
      if (photoUrl) doc.photoUrl = photoUrl;
      if (photoName) doc.photoName = photoName;
      if (reason) doc.reason = reason;
      if (confirmedBy) doc.confirmedBy = confirmedBy;
      if (confirmedAt) doc.confirmedAt = confirmedAt;
      if (cancelledBy) doc.cancelledBy = cancelledBy;
      if (cancelledAt) doc.cancelledAt = cancelledAt;
      if (evidence) doc.evidence = evidence;
      lineRows.forEach(function (line) {
        if (line.returnId !== id) return;
        doc.items.push(line.item);
      });
      return doc;
    }).filter(Boolean);
  }

  function writeReturns(spreadsheet, documents) {
    ensure(spreadsheet);
    var headers = [];
    var lineRows = [];
    (documents || []).forEach(function (doc) {
      headers.push({
        id: doc.id,
        returnNo: doc.returnNo,
        returnDate: doc.returnDate || doc.date,
        date: doc.date || doc.returnDate,
        sourceId: doc.sourceId,
        sourceNameSnapshot: doc.sourceNameSnapshot || '',
        originalSaleId: doc.originalSaleId || doc.saleId || '',
        originalDocumentNo: doc.originalDocumentNo || '',
        saleId: doc.saleId || doc.originalSaleId || '',
        customerId: doc.customerId || '',
        customerNameSnapshot: doc.customerNameSnapshot || '',
        reasonId: doc.reasonId,
        reasonNameSnapshot: doc.reasonNameSnapshot || doc.reason || '',
        reason: doc.reason || doc.reasonNameSnapshot || '',
        warehouseId: doc.warehouseId,
        status: doc.status,
        notes: doc.notes || '',
        photoUrl: doc.photoUrl || '',
        photoName: doc.photoName || '',
        evidenceJson: doc.evidence ? JSON.stringify(doc.evidence) : '',
        createdBy: doc.createdBy || '',
        createdByName: doc.createdByName || '',
        createdAt: doc.createdAt || '',
        confirmedBy: doc.confirmedBy || '',
        confirmedAt: doc.confirmedAt || '',
        cancelledBy: doc.cancelledBy || '',
        cancelledAt: doc.cancelledAt || '',
        total: doc.total || 0
      });
      (doc.items || []).forEach(function (item, index) {
        lineRows.push({
          id: item.id || doc.id + '-ln-' + String(index + 1),
          returnId: doc.id,
          productId: item.productId,
          productNameSnapshot: item.productNameSnapshot || '',
          skuSnapshot: item.skuSnapshot || '',
          returnedQty: item.returnedQty,
          unit: item.unit || 'PACK',
          goodQty: item.goodQty,
          repackQty: item.repackQty,
          repackRecoveredGrams: item.repackRecoveredGrams || '',
          repackStorageBoxId: item.repackStorageBoxId || '',
          wasteQty: item.wasteQty,
          wasteReason: item.wasteReason || '',
          notes: item.notes || '',
          qty: item.qty || item.returnedQty,
          price: item.price || 0
        });
      });
    });
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'SalesReturns'), headers);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'SalesReturnLines'), lineRows);
  }

  return {
    ensure: ensure,
    readReturns: readReturns,
    writeReturns: writeReturns,
    readSources: function (spreadsheet) { return readLookups(spreadsheet, 'ReturnSources'); },
    writeSources: function (spreadsheet, rows) { writeLookups(spreadsheet, 'ReturnSources', rows); },
    readReasons: function (spreadsheet) { return readLookups(spreadsheet, 'ReturnReasons'); },
    writeReasons: function (spreadsheet, rows) { writeLookups(spreadsheet, 'ReturnReasons', rows); }
  };
}
