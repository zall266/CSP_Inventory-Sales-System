// Module 8 opening balance documents and lines.

var OPENING_BALANCE_HEADERS = [
  'id', 'documentNo', 'date', 'type', 'status', 'notes',
  'createdBy', 'createdByName', 'createdAt', 'confirmedBy', 'confirmedAt'
];
var OPENING_BALANCE_LINE_HEADERS = [
  'id', 'openingBalanceId', 'productId', 'qty', 'unit', 'baseQty', 'warehouseId',
  'batchNo', 'expiry', 'notes', 'locationKind', 'locationId', 'container'
];

function createOpeningBalanceRepository(sheetRepository) {
  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function num(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function forceText(sheet, column) {
    if (!sheet || column < 1) return;
    var range = sheet.getRange(1, column, 1000, 1);
    if (range.setNumberFormat) range.setNumberFormat('@');
  }

  function ensure(spreadsheet) {
    var docs = sheetRepository.ensureSheet(spreadsheet, 'OpeningBalances', OPENING_BALANCE_HEADERS);
    var lines = sheetRepository.ensureSheet(spreadsheet, 'OpeningBalanceLines', OPENING_BALANCE_LINE_HEADERS);
    forceText(docs, OPENING_BALANCE_HEADERS.indexOf('id') + 1);
    forceText(lines, OPENING_BALANCE_LINE_HEADERS.indexOf('openingBalanceId') + 1);
    return { docs: docs, lines: lines };
  }

  function readLines(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'OpeningBalanceLines');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var line = {
        id: text(row.id).trim(),
        openingBalanceId: text(row.openingBalanceId).trim(),
        productId: text(row.productId).trim(),
        qty: num(row.qty),
        unit: text(row.unit).trim(),
        baseQty: num(row.baseQty),
        warehouseId: text(row.warehouseId).trim(),
        batchNo: text(row.batchNo).trim(),
        expiry: text(row.expiry).trim(),
        notes: text(row.notes).trim(),
        locationKind: text(row.locationKind).trim(),
        locationId: text(row.locationId).trim(),
        container: text(row.container).trim()
      };
      return line;
    }).filter(function (row) { return row.id && row.openingBalanceId; });
  }

  function readDocuments(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'OpeningBalances');
    if (!sheet) return [];
    var lines = readLines(spreadsheet);
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var doc = {
        id: id,
        documentNo: text(row.documentNo).trim(),
        date: text(row.date).trim(),
        type: text(row.type).trim(),
        status: text(row.status).trim() === 'confirmed' ? 'confirmed' : 'draft',
        notes: text(row.notes).trim(),
        createdBy: text(row.createdBy).trim(),
        createdByName: text(row.createdByName).trim(),
        createdAt: text(row.createdAt).trim(),
        confirmedBy: text(row.confirmedBy).trim(),
        confirmedAt: text(row.confirmedAt).trim(),
        items: []
      };
      lines.forEach(function (line) {
        if (line.openingBalanceId !== id) return;
        var item = {
          id: line.id,
          productId: line.productId,
          qty: line.qty,
          unit: line.unit,
          baseQty: line.baseQty,
          warehouseId: line.warehouseId
        };
        if (line.batchNo) item.batchNo = line.batchNo;
        if (line.expiry) item.expiry = line.expiry;
        if (line.notes) item.notes = line.notes;
        if (line.locationKind) item.locationKind = line.locationKind;
        if (line.locationId) item.locationId = line.locationId;
        if (line.container) item.container = line.container;
        doc.items.push(item);
      });
      return doc;
    }).filter(Boolean);
  }

  function writeDocuments(spreadsheet, documents) {
    ensure(spreadsheet);
    var headers = [];
    var lineRows = [];
    (documents || []).forEach(function (doc) {
      headers.push({
        id: doc.id,
        documentNo: doc.documentNo,
        date: doc.date,
        type: doc.type,
        status: doc.status,
        notes: doc.notes || '',
        createdBy: doc.createdBy || '',
        createdByName: doc.createdByName || '',
        createdAt: doc.createdAt || '',
        confirmedBy: doc.confirmedBy || '',
        confirmedAt: doc.confirmedAt || ''
      });
      (doc.items || []).forEach(function (item) {
        lineRows.push({
          id: item.id,
          openingBalanceId: doc.id,
          productId: item.productId,
          qty: item.qty,
          unit: item.unit,
          baseQty: item.baseQty,
          warehouseId: item.warehouseId,
          batchNo: item.batchNo || '',
          expiry: item.expiry || '',
          notes: item.notes || '',
          locationKind: item.locationKind || '',
          locationId: item.locationId || '',
          container: item.container || ''
        });
      });
    });
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'OpeningBalances'), headers);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'OpeningBalanceLines'), lineRows);
  }

  return {
    headers: OPENING_BALANCE_HEADERS,
    lineHeaders: OPENING_BALANCE_LINE_HEADERS,
    ensure: ensure,
    readDocuments: readDocuments,
    writeDocuments: writeDocuments
  };
}
