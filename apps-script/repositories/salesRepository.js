// Module 13 sales documents: sales, quotations, delivery orders, print audit.
// Payments stay on the existing Payments tab from Module 9.

var SALE_HEADERS = [
  'id', 'invoiceNo', 'date', 'customerId', 'warehouseId', 'salesperson',
  'subtotal', 'discount', 'tax', 'shipping', 'total', 'paid', 'balance', 'status',
  'paymentMethod', 'notes', 'reference', 'quotationId', 'quotationNo', 'dueDate',
  'paymentTerms', 'pricingMode'
];
var SALE_LINE_HEADERS = [
  'id', 'saleId', 'productId', 'qty', 'price', 'discount', 'total', 'returnedQty',
  'batchNo', 'expiry', 'description'
];
var SALE_LINE_COMPONENT_HEADERS = [
  'id', 'saleId', 'saleLineId', 'productId', 'productName', 'sku', 'qty', 'unit'
];
var QUOTATION_HEADERS = [
  'id', 'quotationNo', 'date', 'validUntil', 'customerId', 'salesperson', 'reference',
  'notes', 'terms', 'subtotal', 'discount', 'tax', 'shipping', 'total', 'status',
  'agentId', 'convertedSaleId', 'convertedInvoiceNo', 'createdAt', 'updatedAt'
];
var QUOTATION_LINE_HEADERS = [
  'id', 'quotationId', 'productId', 'description', 'qty', 'unit', 'price', 'discount', 'total'
];
var DELIVERY_HEADERS = [
  'id', 'doNo', 'date', 'customerId', 'deliveryAddress', 'contactPerson', 'contactNumber',
  'saleId', 'invoiceNo', 'quotationId', 'quotationNo', 'transport', 'preparedBy', 'notes',
  'status', 'createdAt', 'updatedAt'
];
var DELIVERY_LINE_HEADERS = [
  'id', 'deliveryOrderId', 'productId', 'description', 'qty', 'unit'
];
var DOCUMENT_AUDIT_HEADERS = [
  'id', 'action', 'documentType', 'documentId', 'documentNo', 'field', 'oldValue',
  'newValue', 'changedBy', 'changedAt'
];

function createSalesRepository(sheetRepository) {
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

  function optional(value) {
    var next = text(value).trim();
    return next || undefined;
  }

  function ensure(spreadsheet) {
    var sales = sheetRepository.ensureSheet(spreadsheet, 'Sales', SALE_HEADERS);
    var lines = sheetRepository.ensureSheet(spreadsheet, 'SaleLines', SALE_LINE_HEADERS);
    var components = sheetRepository.ensureSheet(spreadsheet, 'SaleLineComponents', SALE_LINE_COMPONENT_HEADERS);
    var quotations = sheetRepository.ensureSheet(spreadsheet, 'Quotations', QUOTATION_HEADERS);
    var quotationLines = sheetRepository.ensureSheet(spreadsheet, 'QuotationLines', QUOTATION_LINE_HEADERS);
    var deliveries = sheetRepository.ensureSheet(spreadsheet, 'DeliveryOrders', DELIVERY_HEADERS);
    var deliveryLines = sheetRepository.ensureSheet(spreadsheet, 'DeliveryOrderLines', DELIVERY_LINE_HEADERS);
    var audits = sheetRepository.ensureSheet(spreadsheet, 'DocumentAuditLogs', DOCUMENT_AUDIT_HEADERS);
    forceText(sales, SALE_HEADERS.indexOf('id') + 1);
    forceText(sales, SALE_HEADERS.indexOf('invoiceNo') + 1);
    forceText(lines, SALE_LINE_HEADERS.indexOf('saleId') + 1);
    forceText(quotations, QUOTATION_HEADERS.indexOf('id') + 1);
    forceText(deliveries, DELIVERY_HEADERS.indexOf('id') + 1);
    return {
      sales: sales,
      lines: lines,
      components: components,
      quotations: quotations,
      quotationLines: quotationLines,
      deliveries: deliveries,
      deliveryLines: deliveryLines,
      audits: audits
    };
  }

  function readComponents(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'SaleLineComponents');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      return {
        id: text(row.id).trim(),
        saleId: text(row.saleId).trim(),
        saleLineId: text(row.saleLineId).trim(),
        productId: text(row.productId).trim(),
        productName: text(row.productName).trim(),
        sku: text(row.sku).trim(),
        qty: round2(num(row.qty)),
        unit: text(row.unit).trim()
      };
    }).filter(function (row) { return row.id && row.saleLineId; });
  }

  function readSaleLines(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'SaleLines');
    if (!sheet) return [];
    var components = readComponents(spreadsheet);
    return sheetRepository.readObjects(sheet).map(function (row) {
      var lineId = text(row.id).trim();
      var item = {
        productId: text(row.productId).trim(),
        qty: num(row.qty),
        price: num(row.price),
        discount: num(row.discount),
        total: num(row.total),
        returnedQty: num(row.returnedQty)
      };
      var batchNo = optional(row.batchNo);
      var expiry = optional(row.expiry);
      var description = optional(row.description);
      if (batchNo) item.batchNo = batchNo;
      if (expiry) item.expiry = expiry;
      if (description) item.description = description;
      var snapshot = [];
      components.forEach(function (component) {
        if (component.saleLineId !== lineId) return;
        snapshot.push({
          productId: component.productId,
          productName: component.productName,
          sku: component.sku,
          qty: component.qty,
          unit: component.unit
        });
      });
      if (snapshot.length) item.salesComponentsSnapshot = snapshot;
      return {
        id: lineId,
        saleId: text(row.saleId).trim(),
        item: item
      };
    }).filter(function (row) { return row.id && row.saleId; });
  }

  function readSales(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Sales');
    if (!sheet) return [];
    var lineRows = readSaleLines(spreadsheet);
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var sale = {
        id: id,
        invoiceNo: text(row.invoiceNo).trim(),
        date: text(row.date).trim(),
        customerId: text(row.customerId).trim(),
        warehouseId: text(row.warehouseId).trim(),
        salesperson: text(row.salesperson).trim(),
        items: [],
        subtotal: round2(num(row.subtotal)),
        discount: round2(num(row.discount)),
        tax: round2(num(row.tax)),
        shipping: round2(num(row.shipping)),
        total: round2(num(row.total)),
        paid: round2(num(row.paid)),
        balance: round2(num(row.balance)),
        status: text(row.status).trim() || 'unpaid'
      };
      var paymentMethod = optional(row.paymentMethod);
      var notes = optional(row.notes);
      var reference = optional(row.reference);
      var quotationId = optional(row.quotationId);
      var quotationNo = optional(row.quotationNo);
      var dueDate = optional(row.dueDate);
      var paymentTerms = optional(row.paymentTerms);
      var pricingMode = optional(row.pricingMode);
      if (paymentMethod) sale.paymentMethod = paymentMethod;
      if (notes) sale.notes = notes;
      if (reference) sale.reference = reference;
      if (quotationId) sale.quotationId = quotationId;
      if (quotationNo) sale.quotationNo = quotationNo;
      if (dueDate) sale.dueDate = dueDate;
      if (paymentTerms) sale.paymentTerms = paymentTerms;
      if (pricingMode) sale.pricingMode = pricingMode;
      lineRows.forEach(function (line) {
        if (line.saleId !== id) return;
        sale.items.push(line.item);
      });
      return sale;
    }).filter(Boolean);
  }

  function writeSales(spreadsheet, documents) {
    ensure(spreadsheet);
    var headers = [];
    var lineRows = [];
    var componentRows = [];
    (documents || []).forEach(function (doc) {
      headers.push({
        id: doc.id,
        invoiceNo: doc.invoiceNo,
        date: doc.date,
        customerId: doc.customerId,
        warehouseId: doc.warehouseId,
        salesperson: doc.salesperson,
        subtotal: doc.subtotal,
        discount: doc.discount,
        tax: doc.tax,
        shipping: doc.shipping,
        total: doc.total,
        paid: doc.paid,
        balance: doc.balance,
        status: doc.status,
        paymentMethod: doc.paymentMethod || '',
        notes: doc.notes || '',
        reference: doc.reference || '',
        quotationId: doc.quotationId || '',
        quotationNo: doc.quotationNo || '',
        dueDate: doc.dueDate || '',
        paymentTerms: doc.paymentTerms || '',
        pricingMode: doc.pricingMode || ''
      });
      (doc.items || []).forEach(function (item, index) {
        var lineId = doc.id + '-ln-' + String(index + 1);
        lineRows.push({
          id: lineId,
          saleId: doc.id,
          productId: item.productId,
          qty: item.qty,
          price: item.price,
          discount: item.discount ?? 0,
          total: item.total,
          returnedQty: item.returnedQty ?? 0,
          batchNo: item.batchNo || '',
          expiry: item.expiry || '',
          description: item.description || ''
        });
        (item.salesComponentsSnapshot || []).forEach(function (component, componentIndex) {
          componentRows.push({
            id: lineId + '-c-' + String(componentIndex + 1),
            saleId: doc.id,
            saleLineId: lineId,
            productId: component.productId,
            productName: component.productName || '',
            sku: component.sku || '',
            qty: component.qty,
            unit: component.unit || ''
          });
        });
      });
    });
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Sales'), headers);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'SaleLines'), lineRows);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'SaleLineComponents'), componentRows);
  }

  function readQuotationLines(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'QuotationLines');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      return {
        id: text(row.id).trim(),
        quotationId: text(row.quotationId).trim(),
        item: {
          productId: text(row.productId).trim(),
          description: text(row.description).trim(),
          qty: num(row.qty),
          unit: text(row.unit).trim() || 'pcs',
          price: num(row.price),
          discount: num(row.discount),
          total: num(row.total)
        }
      };
    }).filter(function (row) { return row.id && row.quotationId; });
  }

  function readQuotations(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Quotations');
    if (!sheet) return [];
    var lineRows = readQuotationLines(spreadsheet);
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var quotation = {
        id: id,
        quotationNo: text(row.quotationNo).trim(),
        date: text(row.date).trim(),
        validUntil: text(row.validUntil).trim(),
        customerId: text(row.customerId).trim(),
        salesperson: text(row.salesperson).trim(),
        reference: text(row.reference).trim(),
        notes: text(row.notes).trim(),
        terms: text(row.terms).trim(),
        items: [],
        subtotal: round2(num(row.subtotal)),
        discount: round2(num(row.discount)),
        tax: round2(num(row.tax)),
        shipping: round2(num(row.shipping)),
        total: round2(num(row.total)),
        status: text(row.status).trim() || 'draft',
        createdAt: text(row.createdAt).trim(),
        updatedAt: text(row.updatedAt).trim()
      };
      var agentId = optional(row.agentId);
      var convertedSaleId = optional(row.convertedSaleId);
      var convertedInvoiceNo = optional(row.convertedInvoiceNo);
      if (agentId) quotation.agentId = agentId;
      if (convertedSaleId) quotation.convertedSaleId = convertedSaleId;
      if (convertedInvoiceNo) quotation.convertedInvoiceNo = convertedInvoiceNo;
      lineRows.forEach(function (line) {
        if (line.quotationId !== id) return;
        quotation.items.push(line.item);
      });
      return quotation;
    }).filter(Boolean);
  }

  function writeQuotations(spreadsheet, documents) {
    ensure(spreadsheet);
    var headers = [];
    var lineRows = [];
    (documents || []).forEach(function (doc) {
      headers.push({
        id: doc.id,
        quotationNo: doc.quotationNo,
        date: doc.date,
        validUntil: doc.validUntil,
        customerId: doc.customerId,
        salesperson: doc.salesperson,
        reference: doc.reference || '',
        notes: doc.notes || '',
        terms: doc.terms || '',
        subtotal: doc.subtotal,
        discount: doc.discount,
        tax: doc.tax,
        shipping: doc.shipping,
        total: doc.total,
        status: doc.status,
        agentId: doc.agentId || '',
        convertedSaleId: doc.convertedSaleId || '',
        convertedInvoiceNo: doc.convertedInvoiceNo || '',
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
      });
      (doc.items || []).forEach(function (item, index) {
        lineRows.push({
          id: doc.id + '-ln-' + String(index + 1),
          quotationId: doc.id,
          productId: item.productId,
          description: item.description || '',
          qty: item.qty,
          unit: item.unit || 'pcs',
          price: item.price,
          discount: item.discount ?? 0,
          total: item.total
        });
      });
    });
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Quotations'), headers);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'QuotationLines'), lineRows);
  }

  function readDeliveryLines(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'DeliveryOrderLines');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      return {
        id: text(row.id).trim(),
        deliveryOrderId: text(row.deliveryOrderId).trim(),
        item: {
          productId: text(row.productId).trim(),
          description: text(row.description).trim(),
          qty: num(row.qty),
          unit: text(row.unit).trim() || 'pcs'
        }
      };
    }).filter(function (row) { return row.id && row.deliveryOrderId; });
  }

  function readDeliveries(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'DeliveryOrders');
    if (!sheet) return [];
    var lineRows = readDeliveryLines(spreadsheet);
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var order = {
        id: id,
        doNo: text(row.doNo).trim(),
        date: text(row.date).trim(),
        customerId: text(row.customerId).trim(),
        deliveryAddress: text(row.deliveryAddress).trim(),
        contactPerson: text(row.contactPerson).trim(),
        contactNumber: text(row.contactNumber).trim(),
        transport: text(row.transport).trim(),
        preparedBy: text(row.preparedBy).trim(),
        notes: text(row.notes).trim(),
        items: [],
        status: text(row.status).trim() || 'draft',
        createdAt: text(row.createdAt).trim(),
        updatedAt: text(row.updatedAt).trim()
      };
      var saleId = optional(row.saleId);
      var invoiceNo = optional(row.invoiceNo);
      var quotationId = optional(row.quotationId);
      var quotationNo = optional(row.quotationNo);
      if (saleId) order.saleId = saleId;
      if (invoiceNo) order.invoiceNo = invoiceNo;
      if (quotationId) order.quotationId = quotationId;
      if (quotationNo) order.quotationNo = quotationNo;
      lineRows.forEach(function (line) {
        if (line.deliveryOrderId !== id) return;
        order.items.push(line.item);
      });
      return order;
    }).filter(Boolean);
  }

  function writeDeliveries(spreadsheet, documents) {
    ensure(spreadsheet);
    var headers = [];
    var lineRows = [];
    (documents || []).forEach(function (doc) {
      headers.push({
        id: doc.id,
        doNo: doc.doNo,
        date: doc.date,
        customerId: doc.customerId,
        deliveryAddress: doc.deliveryAddress || '',
        contactPerson: doc.contactPerson || '',
        contactNumber: doc.contactNumber || '',
        saleId: doc.saleId || '',
        invoiceNo: doc.invoiceNo || '',
        quotationId: doc.quotationId || '',
        quotationNo: doc.quotationNo || '',
        transport: doc.transport || '',
        preparedBy: doc.preparedBy || '',
        notes: doc.notes || '',
        status: doc.status,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
      });
      (doc.items || []).forEach(function (item, index) {
        lineRows.push({
          id: doc.id + '-ln-' + String(index + 1),
          deliveryOrderId: doc.id,
          productId: item.productId,
          description: item.description || '',
          qty: item.qty,
          unit: item.unit || 'pcs'
        });
      });
    });
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'DeliveryOrders'), headers);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'DeliveryOrderLines'), lineRows);
  }

  function readDocumentAudits(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'DocumentAuditLogs');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      return {
        id: id,
        action: text(row.action).trim(),
        documentType: text(row.documentType).trim(),
        documentId: text(row.documentId).trim(),
        documentNo: text(row.documentNo).trim(),
        field: text(row.field).trim(),
        oldValue: text(row.oldValue).trim(),
        newValue: text(row.newValue).trim(),
        changedBy: text(row.changedBy).trim(),
        changedAt: text(row.changedAt).trim()
      };
    }).filter(Boolean);
  }

  function writeDocumentAudits(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'DocumentAuditLogs'), (rows || []).map(function (row) {
      return {
        id: row.id,
        action: row.action,
        documentType: row.documentType,
        documentId: row.documentId,
        documentNo: row.documentNo,
        field: row.field || '',
        oldValue: row.oldValue || '',
        newValue: row.newValue || '',
        changedBy: row.changedBy,
        changedAt: row.changedAt
      };
    }));
  }

  function appendDocumentAudit(spreadsheet, row) {
    ensure(spreadsheet);
    writeDocumentAudits(spreadsheet, [row].concat(readDocumentAudits(spreadsheet)));
  }

  return {
    ensure: ensure,
    readSales: readSales,
    writeSales: writeSales,
    readQuotations: readQuotations,
    writeQuotations: writeQuotations,
    readDeliveries: readDeliveries,
    writeDeliveries: writeDeliveries,
    readDocumentAudits: readDocumentAudits,
    writeDocumentAudits: writeDocumentAudits,
    appendDocumentAudit: appendDocumentAudit
  };
}
