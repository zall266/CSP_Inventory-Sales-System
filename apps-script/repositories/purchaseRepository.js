// Module 9 purchases, purchase returns, and supplier payments.

var PURCHASE_HEADERS = [
  'id', 'purchaseNo', 'date', 'supplierId', 'warehouseId', 'invoiceNumber',
  'subtotal', 'discount', 'tax', 'shipping', 'total', 'paid', 'balance', 'status', 'notes', 'receivingId'
];
var PURCHASE_LINE_HEADERS = [
  'id', 'purchaseId', 'productId', 'qty', 'price', 'discount', 'total', 'returnedQty',
  'batchNo', 'expiry', 'description'
];
var PURCHASE_RETURN_HEADERS = [
  'id', 'returnNo', 'date', 'purchaseId', 'warehouseId', 'reason', 'total'
];
var PURCHASE_RETURN_LINE_HEADERS = [
  'id', 'purchaseReturnId', 'productId', 'qty', 'price'
];
var PAYMENT_HEADERS = [
  'id', 'paymentNo', 'date', 'partyType', 'partyId', 'invoiceId', 'invoiceNo', 'method', 'amount', 'status'
];
var RECEIVING_LINK_HEADERS = ['id', 'receivingNo', 'purchaseId', 'purchaseNo'];

function createPurchaseRepository(sheetRepository) {
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
    var purchases = sheetRepository.ensureSheet(spreadsheet, 'Purchases', PURCHASE_HEADERS);
    var lines = sheetRepository.ensureSheet(spreadsheet, 'PurchaseLines', PURCHASE_LINE_HEADERS);
    var returns = sheetRepository.ensureSheet(spreadsheet, 'PurchaseReturns', PURCHASE_RETURN_HEADERS);
    var returnLines = sheetRepository.ensureSheet(spreadsheet, 'PurchaseReturnLines', PURCHASE_RETURN_LINE_HEADERS);
    var payments = sheetRepository.ensureSheet(spreadsheet, 'Payments', PAYMENT_HEADERS);
    forceText(purchases, PURCHASE_HEADERS.indexOf('id') + 1);
    forceText(lines, PURCHASE_LINE_HEADERS.indexOf('purchaseId') + 1);
    return { purchases: purchases, lines: lines, returns: returns, returnLines: returnLines, payments: payments };
  }

  function readLines(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'PurchaseLines');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var item = {
        productId: text(row.productId).trim(),
        qty: num(row.qty),
        price: num(row.price),
        discount: num(row.discount),
        total: num(row.total),
        returnedQty: num(row.returnedQty)
      };
      var batchNo = text(row.batchNo).trim();
      var expiry = text(row.expiry).trim();
      var description = text(row.description).trim();
      if (batchNo) item.batchNo = batchNo;
      if (expiry) item.expiry = expiry;
      if (description) item.description = description;
      return {
        id: text(row.id).trim(),
        purchaseId: text(row.purchaseId).trim(),
        item: item
      };
    }).filter(function (row) { return row.id && row.purchaseId; });
  }

  function readPurchases(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Purchases');
    if (!sheet) return [];
    var lineRows = readLines(spreadsheet);
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var receivingId = text(row.receivingId).trim();
      var purchase = {
        id: id,
        purchaseNo: text(row.purchaseNo).trim(),
        date: text(row.date).trim(),
        supplierId: text(row.supplierId).trim(),
        warehouseId: text(row.warehouseId).trim(),
        invoiceNumber: text(row.invoiceNumber).trim(),
        items: [],
        subtotal: round2(num(row.subtotal)),
        discount: round2(num(row.discount)),
        tax: round2(num(row.tax)),
        shipping: round2(num(row.shipping)),
        total: round2(num(row.total)),
        paid: round2(num(row.paid)),
        balance: round2(num(row.balance)),
        status: text(row.status).trim() || 'draft'
      };
      var notes = text(row.notes).trim();
      if (notes) purchase.notes = notes;
      if (receivingId) purchase.receivingId = receivingId;
      lineRows.forEach(function (line) {
        if (line.purchaseId !== id) return;
        purchase.items.push(line.item);
      });
      return purchase;
    }).filter(Boolean);
  }

  function writePurchases(spreadsheet, documents) {
    ensure(spreadsheet);
    var headers = [];
    var lineRows = [];
    (documents || []).forEach(function (doc) {
      headers.push({
        id: doc.id,
        purchaseNo: doc.purchaseNo,
        date: doc.date,
        supplierId: doc.supplierId,
        warehouseId: doc.warehouseId,
        invoiceNumber: doc.invoiceNumber,
        subtotal: doc.subtotal,
        discount: doc.discount,
        tax: doc.tax,
        shipping: doc.shipping,
        total: doc.total,
        paid: doc.paid,
        balance: doc.balance,
        status: doc.status,
        notes: doc.notes || '',
        receivingId: doc.receivingId || ''
      });
      (doc.items || []).forEach(function (item, index) {
        lineRows.push({
          id: doc.id + '-ln-' + String(index + 1),
          purchaseId: doc.id,
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
      });
    });
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Purchases'), headers);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'PurchaseLines'), lineRows);
  }

  function readReturnLines(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'PurchaseReturnLines');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      return {
        id: text(row.id).trim(),
        purchaseReturnId: text(row.purchaseReturnId).trim(),
        productId: text(row.productId).trim(),
        qty: num(row.qty),
        price: num(row.price)
      };
    }).filter(function (row) { return row.id && row.purchaseReturnId; });
  }

  function readPurchaseReturns(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'PurchaseReturns');
    if (!sheet) return [];
    var lineRows = readReturnLines(spreadsheet);
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      var doc = {
        id: id,
        returnNo: text(row.returnNo).trim(),
        date: text(row.date).trim(),
        purchaseId: text(row.purchaseId).trim(),
        warehouseId: text(row.warehouseId).trim(),
        reason: text(row.reason).trim(),
        total: round2(num(row.total)),
        items: []
      };
      lineRows.forEach(function (line) {
        if (line.purchaseReturnId !== id) return;
        doc.items.push({ productId: line.productId, qty: line.qty, price: line.price });
      });
      return doc;
    }).filter(Boolean);
  }

  function writePurchaseReturns(spreadsheet, documents) {
    ensure(spreadsheet);
    var headers = [];
    var lineRows = [];
    (documents || []).forEach(function (doc) {
      headers.push({
        id: doc.id,
        returnNo: doc.returnNo,
        date: doc.date,
        purchaseId: doc.purchaseId,
        warehouseId: doc.warehouseId,
        reason: doc.reason,
        total: doc.total
      });
      (doc.items || []).forEach(function (item, index) {
        lineRows.push({
          id: doc.id + '-ln-' + String(index + 1),
          purchaseReturnId: doc.id,
          productId: item.productId,
          qty: item.qty,
          price: item.price
        });
      });
    });
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'PurchaseReturns'), headers);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'PurchaseReturnLines'), lineRows);
  }

  function readPayments(spreadsheet) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Payments');
    if (!sheet) return [];
    return sheetRepository.readObjects(sheet).map(function (row) {
      var id = text(row.id).trim();
      if (!id) return null;
      return {
        id: id,
        paymentNo: text(row.paymentNo).trim(),
        date: text(row.date).trim(),
        partyType: text(row.partyType).trim(),
        partyId: text(row.partyId).trim(),
        invoiceId: text(row.invoiceId).trim(),
        invoiceNo: text(row.invoiceNo).trim(),
        method: text(row.method).trim(),
        amount: round2(num(row.amount)),
        status: text(row.status).trim() || 'completed'
      };
    }).filter(Boolean);
  }

  function writePayments(spreadsheet, rows) {
    ensure(spreadsheet);
    sheetRepository.replaceObjects(sheetRepository.getSheet(spreadsheet, 'Payments'), (rows || []).map(function (row) {
      return {
        id: row.id,
        paymentNo: row.paymentNo,
        date: row.date,
        partyType: row.partyType,
        partyId: row.partyId,
        invoiceId: row.invoiceId,
        invoiceNo: row.invoiceNo,
        method: row.method,
        amount: row.amount,
        status: row.status
      };
    }));
  }

  function appendPayment(spreadsheet, payment) {
    ensure(spreadsheet);
    var sheet = sheetRepository.getSheet(spreadsheet, 'Payments');
    sheetRepository.appendObject(sheet, {
      id: payment.id,
      paymentNo: payment.paymentNo,
      date: payment.date,
      partyType: payment.partyType,
      partyId: payment.partyId,
      invoiceId: payment.invoiceId,
      invoiceNo: payment.invoiceNo,
      method: payment.method,
      amount: payment.amount,
      status: payment.status
    });
  }

  function readReceivingLink(spreadsheet, receivingId) {
    var sheet = sheetRepository.getSheet(spreadsheet, 'Receivings');
    if (!sheet) return null;
    var rows = sheetRepository.readObjects(sheet);
    for (var i = 0; i < rows.length; i += 1) {
      if (text(rows[i].id).trim() === text(receivingId).trim()) {
        return {
          id: text(rows[i].id).trim(),
          receivingNo: text(rows[i].receivingNo).trim(),
          purchaseId: text(rows[i].purchaseId).trim(),
          purchaseNo: text(rows[i].purchaseNo).trim()
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

  return {
    ensure: ensure,
    readPurchases: readPurchases,
    writePurchases: writePurchases,
    readPurchaseReturns: readPurchaseReturns,
    writePurchaseReturns: writePurchaseReturns,
    readPayments: readPayments,
    writePayments: writePayments,
    appendPayment: appendPayment,
    readReceivingLink: readReceivingLink,
    linkReceivingToPurchase: linkReceivingToPurchase
  };
}
