// Module 15 sales import tables. Parsed PDF lines are stored as JSON, not Drive blobs.

var SALES_IMPORT_ACCOUNT_HEADERS = ['id', 'platform', 'name', 'active', 'createdAt'];
var SALES_IMPORT_BATCH_HEADERS = [
  'id', 'platform', 'accountId', 'status', 'createdBy', 'createdAt',
  'accountAcknowledged', 'accountAcknowledgedBy', 'accountAcknowledgedAt', 'spotCheckedKeysJson'
];
var SALES_IMPORT_FILE_HEADERS = [
  'id', 'batchId', 'role', 'fileName', 'fileHash', 'detectedLayout', 'parsedAt', 'parseError',
  'detectedUsername', 'identityReliable', 'warningsJson', 'customerMessagesJson', 'parsedLinesJson'
];
var SALES_IMPORT_ORDER_HEADERS = [
  'id', 'batchId', 'externalOrderId', 'customerMessage', 'status', 'saleId', 'fileId'
];
var SALES_IMPORT_LINE_HEADERS = [
  'id', 'orderId', 'externalProductName', 'variationText', 'parentSku', 'externalSku',
  'quantity', 'quantitySource', 'pickingQuantity', 'quantityReview', 'mappedProductId',
  'mappedProductSnapshotJson', 'unallocated', 'sharedOrderCount'
];
var SALES_IMPORT_MAPPING_HEADERS = [
  'id', 'platform', 'accountId', 'keyType', 'key', 'productId', 'createdAt', 'active'
];
var SALES_IMPORT_SHIPMENT_HEADERS = [
  'id', 'platform', 'accountId', 'batchId', 'externalOrderId', 'trackingNumber', 'courierText',
  'recipientName', 'recipientAddress', 'serviceText', 'sourceFileId', 'linkStatus',
  'packingLinesJson', 'createdAt', 'updatedAt'
];

function createSalesImportRepository(sheetRepository) {
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

  function optional(value) {
    var next = text(value).trim();
    return next || undefined;
  }

  function forceText(sheet, column) {
    if (!sheet || column < 1) return;
    var range = sheet.getRange(1, column, 1000, 1);
    if (range.setNumberFormat) range.setNumberFormat('@');
  }

  function parseJson(value, fallback) {
    var raw = text(value).trim();
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function jsonCell(value) {
    if (value === undefined || value === null || value === '') return '';
    return JSON.stringify(value);
  }

  function ensure(spreadsheet) {
    var accounts = sheetRepository.ensureSheet(spreadsheet, 'SalesImportAccounts', SALES_IMPORT_ACCOUNT_HEADERS);
    var batches = sheetRepository.ensureSheet(spreadsheet, 'SalesImportBatches', SALES_IMPORT_BATCH_HEADERS);
    var files = sheetRepository.ensureSheet(spreadsheet, 'SalesImportFiles', SALES_IMPORT_FILE_HEADERS);
    var orders = sheetRepository.ensureSheet(spreadsheet, 'SalesImportOrders', SALES_IMPORT_ORDER_HEADERS);
    var lines = sheetRepository.ensureSheet(spreadsheet, 'SalesImportLines', SALES_IMPORT_LINE_HEADERS);
    var mappings = sheetRepository.ensureSheet(spreadsheet, 'SalesImportMappings', SALES_IMPORT_MAPPING_HEADERS);
    var shipments = sheetRepository.ensureSheet(spreadsheet, 'SalesImportShipments', SALES_IMPORT_SHIPMENT_HEADERS);
    forceText(accounts, SALES_IMPORT_ACCOUNT_HEADERS.indexOf('id') + 1);
    forceText(batches, SALES_IMPORT_BATCH_HEADERS.indexOf('id') + 1);
    forceText(files, SALES_IMPORT_FILE_HEADERS.indexOf('fileHash') + 1);
    forceText(orders, SALES_IMPORT_ORDER_HEADERS.indexOf('externalOrderId') + 1);
    forceText(shipments, SALES_IMPORT_SHIPMENT_HEADERS.indexOf('trackingNumber') + 1);
    return {
      accounts: accounts,
      batches: batches,
      files: files,
      orders: orders,
      lines: lines,
      mappings: mappings,
      shipments: shipments
    };
  }

  function readAccounts(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'SalesImportAccounts');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      return {
        id: id,
        platform: text(row.platform).trim(),
        name: text(row.name).trim(),
        active: row.active === '' ? true : flag(row.active),
        createdAt: text(row.createdAt).trim()
      };
    }).filter(Boolean);
  }

  function writeAccounts(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'SalesImportAccounts'), (rows || []).map(function (row) {
      return {
        id: row.id,
        platform: row.platform,
        name: row.name,
        active: row.active !== false,
        createdAt: row.createdAt || ''
      };
    }));
  }

  function readBatches(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'SalesImportBatches');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var batch = {
        id: id,
        platform: text(row.platform).trim(),
        accountId: text(row.accountId).trim(),
        status: text(row.status).trim() || 'draft',
        createdBy: text(row.createdBy).trim(),
        createdAt: text(row.createdAt).trim()
      };
      if (flag(row.accountAcknowledged)) {
        batch.accountAcknowledged = true;
        batch.accountAcknowledgedBy = optional(row.accountAcknowledgedBy);
        batch.accountAcknowledgedAt = optional(row.accountAcknowledgedAt);
      }
      var keys = parseJson(row.spotCheckedKeysJson, []);
      if (Array.isArray(keys) && keys.length) batch.spotCheckedKeys = keys;
      return batch;
    }).filter(Boolean);
  }

  function writeBatches(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'SalesImportBatches'), (rows || []).map(function (row) {
      return {
        id: row.id,
        platform: row.platform,
        accountId: row.accountId,
        status: row.status || 'draft',
        createdBy: row.createdBy || '',
        createdAt: row.createdAt || '',
        accountAcknowledged: row.accountAcknowledged === true,
        accountAcknowledgedBy: row.accountAcknowledgedBy || '',
        accountAcknowledgedAt: row.accountAcknowledgedAt || '',
        spotCheckedKeysJson: jsonCell(row.spotCheckedKeys || [])
      };
    }));
  }

  function readFiles(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'SalesImportFiles');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var file = {
        id: id,
        batchId: text(row.batchId).trim(),
        role: text(row.role).trim() || 'picking',
        fileName: text(row.fileName).trim(),
        fileHash: text(row.fileHash).trim(),
        detectedLayout: text(row.detectedLayout).trim() || 'unknown'
      };
      var parsedAt = optional(row.parsedAt);
      var parseError = optional(row.parseError);
      var detectedUsername = optional(row.detectedUsername);
      if (parsedAt) file.parsedAt = parsedAt;
      if (parseError) file.parseError = parseError;
      if (detectedUsername) file.detectedUsername = detectedUsername;
      if (row.identityReliable !== '') file.identityReliable = flag(row.identityReliable);
      var warnings = parseJson(row.warningsJson, []);
      var messages = parseJson(row.customerMessagesJson, []);
      var lines = parseJson(row.parsedLinesJson, []);
      if (Array.isArray(warnings) && warnings.length) file.warnings = warnings;
      if (Array.isArray(messages) && messages.length) file.customerMessages = messages;
      if (Array.isArray(lines) && lines.length) file.parsedLines = lines;
      return file;
    }).filter(Boolean);
  }

  function writeFiles(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'SalesImportFiles'), (rows || []).map(function (row) {
      return {
        id: row.id,
        batchId: row.batchId,
        role: row.role || 'picking',
        fileName: row.fileName || '',
        fileHash: row.fileHash || '',
        detectedLayout: row.detectedLayout || 'unknown',
        parsedAt: row.parsedAt || '',
        parseError: row.parseError || '',
        detectedUsername: row.detectedUsername || '',
        identityReliable: row.identityReliable === true,
        warningsJson: jsonCell(row.warnings || []),
        customerMessagesJson: jsonCell(row.customerMessages || []),
        parsedLinesJson: jsonCell(row.parsedLines || [])
      };
    }));
  }

  function readOrders(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'SalesImportOrders');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var order = {
        id: id,
        batchId: text(row.batchId).trim(),
        externalOrderId: text(row.externalOrderId).trim(),
        status: text(row.status).trim() || 'new'
      };
      var message = optional(row.customerMessage);
      var saleId = optional(row.saleId);
      var fileId = optional(row.fileId);
      if (message) order.customerMessage = message;
      if (saleId) order.saleId = saleId;
      if (fileId) order.fileId = fileId;
      return order;
    }).filter(Boolean);
  }

  function writeOrders(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'SalesImportOrders'), (rows || []).map(function (row) {
      return {
        id: row.id,
        batchId: row.batchId,
        externalOrderId: row.externalOrderId,
        customerMessage: row.customerMessage || '',
        status: row.status || 'new',
        saleId: row.saleId || '',
        fileId: row.fileId || ''
      };
    }));
  }

  function readLines(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'SalesImportLines');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      var orderId = text(row.orderId).trim();
      if (!id || !orderId) return null;
      var line = {
        id: id,
        orderId: orderId,
        externalProductName: text(row.externalProductName).trim(),
        quantity: num(row.quantity),
        quantitySource: text(row.quantitySource).trim() || 'picking'
      };
      var variation = optional(row.variationText);
      var parentSku = optional(row.parentSku);
      var externalSku = optional(row.externalSku);
      var mapped = optional(row.mappedProductId);
      if (variation) line.variationText = variation;
      if (parentSku) line.parentSku = parentSku;
      if (externalSku) line.externalSku = externalSku;
      if (mapped) line.mappedProductId = mapped;
      if (text(row.pickingQuantity).trim() !== '') line.pickingQuantity = num(row.pickingQuantity);
      if (flag(row.quantityReview)) line.quantityReview = true;
      if (flag(row.unallocated)) line.unallocated = true;
      if (text(row.sharedOrderCount).trim() !== '') line.sharedOrderCount = num(row.sharedOrderCount);
      var snapshot = parseJson(row.mappedProductSnapshotJson, undefined);
      if (snapshot && typeof snapshot === 'object') line.mappedProductSnapshot = snapshot;
      return line;
    }).filter(Boolean);
  }

  function writeLines(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'SalesImportLines'), (rows || []).map(function (row) {
      return {
        id: row.id,
        orderId: row.orderId,
        externalProductName: row.externalProductName || '',
        variationText: row.variationText || '',
        parentSku: row.parentSku || '',
        externalSku: row.externalSku || '',
        quantity: row.quantity || 0,
        quantitySource: row.quantitySource || 'picking',
        pickingQuantity: row.pickingQuantity === undefined || row.pickingQuantity === null ? '' : row.pickingQuantity,
        quantityReview: row.quantityReview === true,
        mappedProductId: row.mappedProductId || '',
        mappedProductSnapshotJson: jsonCell(row.mappedProductSnapshot),
        unallocated: row.unallocated === true,
        sharedOrderCount: row.sharedOrderCount === undefined || row.sharedOrderCount === null ? '' : row.sharedOrderCount
      };
    }));
  }

  function readMappings(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'SalesImportMappings');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var mapping = {
        id: id,
        platform: text(row.platform).trim(),
        accountId: text(row.accountId).trim(),
        keyType: text(row.keyType).trim() === 'text' ? 'text' : 'sku',
        key: text(row.key).trim(),
        productId: text(row.productId).trim(),
        createdAt: text(row.createdAt).trim()
      };
      if (row.active !== '') mapping.active = flag(row.active);
      return mapping;
    }).filter(Boolean);
  }

  function writeMappings(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'SalesImportMappings'), (rows || []).map(function (row) {
      return {
        id: row.id,
        platform: row.platform,
        accountId: row.accountId,
        keyType: row.keyType,
        key: row.key,
        productId: row.productId,
        createdAt: row.createdAt || '',
        active: row.active !== false
      };
    }));
  }

  function readShipments(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'SalesImportShipments');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var shipment = {
        id: id,
        platform: text(row.platform).trim(),
        accountId: text(row.accountId).trim(),
        batchId: text(row.batchId).trim(),
        externalOrderId: text(row.externalOrderId).trim(),
        trackingNumber: text(row.trackingNumber).trim(),
        courierText: text(row.courierText).trim(),
        sourceFileId: text(row.sourceFileId).trim(),
        linkStatus: text(row.linkStatus).trim() || 'pending',
        packingLines: parseJson(row.packingLinesJson, []) || [],
        createdAt: text(row.createdAt).trim(),
        updatedAt: text(row.updatedAt).trim()
      };
      var recipientName = optional(row.recipientName);
      var recipientAddress = optional(row.recipientAddress);
      var serviceText = optional(row.serviceText);
      if (recipientName) shipment.recipientName = recipientName;
      if (recipientAddress) shipment.recipientAddress = recipientAddress;
      if (serviceText) shipment.serviceText = serviceText;
      return shipment;
    }).filter(Boolean);
  }

  function writeShipments(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'SalesImportShipments'), (rows || []).map(function (row) {
      return {
        id: row.id,
        platform: row.platform,
        accountId: row.accountId,
        batchId: row.batchId,
        externalOrderId: row.externalOrderId,
        trackingNumber: row.trackingNumber || '',
        courierText: row.courierText || '',
        recipientName: row.recipientName || '',
        recipientAddress: row.recipientAddress || '',
        serviceText: row.serviceText || '',
        sourceFileId: row.sourceFileId || '',
        linkStatus: row.linkStatus || 'pending',
        packingLinesJson: jsonCell(row.packingLines || []),
        createdAt: row.createdAt || '',
        updatedAt: row.updatedAt || ''
      };
    }));
  }

  return {
    ensure: ensure,
    readAccounts: readAccounts,
    writeAccounts: writeAccounts,
    readBatches: readBatches,
    writeBatches: writeBatches,
    readFiles: readFiles,
    writeFiles: writeFiles,
    readOrders: readOrders,
    writeOrders: writeOrders,
    readLines: readLines,
    writeLines: writeLines,
    readMappings: readMappings,
    writeMappings: writeMappings,
    readShipments: readShipments,
    writeShipments: writeShipments
  };
}
