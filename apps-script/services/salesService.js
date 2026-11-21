// Module 13 sales documents: POS/invoices, quotations, deliveries, customer payments, print audit.

var SALES_ACTIONS = {
  'sales.list': true,
  'sales.get': true,
  'sales.create': true,
  'sales.createWholesale': true,
  'sales.void': true,
  'sales.recordPayment': true,
  'quotations.list': true,
  'quotations.get': true,
  'quotations.create': true,
  'quotations.update': true,
  'quotations.setStatus': true,
  'quotations.convert': true,
  'deliveries.list': true,
  'deliveries.get': true,
  'deliveries.create': true,
  'deliveries.update': true,
  'deliveries.setStatus': true,
  'documents.recordPrint': true
};

function createSalesService(deps) {
  var sheets = deps.sheetRepository;
  var repository = createSalesRepository(sheets);
  var purchaseRepo = createPurchaseRepository(sheets);
  var products = createProductRepository(sheets);
  var inventoryRepo = createInventoryRepository(sheets);
  var partyRepo = createPartyRepository(sheets);
  var masters = createMasterRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(SALES_ACTIONS[action]);
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

  function requireAnyPermission(spreadsheet, actorUserId, keys, message) {
    var actor = loadActor(spreadsheet, actorUserId, message);
    for (var i = 0; i < keys.length; i += 1) {
      if (actorMay(spreadsheet, actor, keys[i])) return actor;
    }
    throw appError('FORBIDDEN', message);
  }

  function requireKey(request) {
    if (!text(request && request.idempotencyKey).trim()) {
      throw appError('VALIDATION_ERROR', 'Idempotency key is required.');
    }
  }

  function clientId(value, prefix) {
    var id = text(value).trim();
    if (!id) return newId(prefix);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw appError('VALIDATION_ERROR', 'Id is not valid.');
    return id;
  }

  function newId(prefix) {
    return prefix + '_' + createId().replace(/-/g, '').slice(0, 10);
  }

  function movementIdFor(docId, index) {
    return 'mv_' + docId + '.' + String(index + 1);
  }

  function settingsRow(spreadsheet) {
    var rows = sheetRows(spreadsheet, 'Settings');
    for (var i = 0; i < rows.length; i += 1) {
      if (text(rows[i].id).trim() === 'settings') return rows[i];
    }
    return {};
  }

  function allowNegative(spreadsheet) {
    return flagCell(settingsRow(spreadsheet).allowNegativeStock);
  }

  function systemAudit(spreadsheet, entry) {
    sheets.ensureSheet(spreadsheet, 'AuditLogs', typeof AUDIT_HEADERS !== 'undefined' ? AUDIT_HEADERS : [
      'auditId', 'timestamp', 'userId', 'action', 'entityType', 'entityId', 'reference', 'before', 'after', 'requestId'
    ]);
    audit.append(entry);
  }

  function nextDocNo(values, prefix, pad) {
    var width = pad || 6;
    var max = 0;
    (values || []).forEach(function (value) {
      var match = text(value).match(/(\d+)\s*$/);
      if (match) max = Math.max(max, Number(match[1]));
    });
    return prefix + String(max + 1).padStart(width, '0');
  }

  function ymdCompact(iso) {
    return String(businessDate(iso ? new Date(iso) : new Date())).replace(/-/g, '');
  }

  function nextDatedDocNo(values, prefix, iso) {
    var full = prefix + ymdCompact(iso) + '-';
    var max = 0;
    (values || []).forEach(function (value) {
      var current = text(value);
      if (current.indexOf(full) !== 0) return;
      var n = Number(current.slice(full.length));
      if (Number.isFinite(n)) max = Math.max(max, n);
    });
    return full + String(max + 1).padStart(3, '0');
  }

  function addDaysIso(iso, days) {
    var date = new Date(iso);
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    return date.toISOString();
  }

  function qtyOf(balances, productId, warehouseId) {
    var qty = 0;
    balances.forEach(function (row) {
      if (row.productId === productId && row.warehouseId === warehouseId) qty = Number(row.qty) || 0;
    });
    return round2(qty);
  }

  function putQty(balances, productId, warehouseId, qty) {
    var found = false;
    var next = balances.map(function (row) {
      if (row.productId === productId && row.warehouseId === warehouseId) {
        found = true;
        return { productId: productId, warehouseId: warehouseId, qty: round2(qty) };
      }
      return row;
    });
    if (!found) next.push({ productId: productId, warehouseId: warehouseId, qty: round2(qty) });
    return next;
  }

  function catalog(spreadsheet) {
    var list = products.readProducts(spreadsheet);
    var grouped = {};
    products.readComponents(spreadsheet).forEach(function (row) {
      if (!grouped[row.productId]) grouped[row.productId] = [];
      grouped[row.productId].push({ productId: row.componentProductId, qty: row.qty });
    });
    list.forEach(function (product) {
      product.salesComponents = grouped[product.id] || [];
    });
    return list;
  }

  function findProduct(list, productId) {
    var found = null;
    list.forEach(function (row) {
      if (row.id === text(productId).trim()) found = row;
    });
    return found;
  }

  function productIsSellable(product) {
    return !product || product.sellable !== false;
  }

  function requireCustomer(spreadsheet, customerId) {
    var id = text(customerId).trim();
    var found = null;
    partyRepo.readCustomers(spreadsheet).forEach(function (row) {
      if (row.id === id) found = row;
    });
    if (!found) throw appError('VALIDATION_ERROR', 'Select a customer');
    return found;
  }

  function requireCompanyWarehouse(spreadsheet, warehouseId) {
    masters.ensure(spreadsheet);
    var id = text(warehouseId).trim();
    var found = null;
    masters.readWarehouses(spreadsheet).forEach(function (row) {
      if (row.id === id) found = row;
    });
    if (!found) throw appError('VALIDATION_ERROR', 'Choose a company warehouse');
    if (found.kind === 'agent') throw appError('VALIDATION_ERROR', 'Agent stock sales must use the Agent sale flow.');
    return found;
  }

  function resolveWholesaleUnitPrice(spreadsheet, customerId, product) {
    var custom = null;
    partyRepo.readWholesalePrices(spreadsheet).forEach(function (row) {
      if (row.customerId === customerId && row.productId === product.id && row.active !== false) custom = row;
    });
    if (custom && Number.isFinite(Number(custom.price)) && Number(custom.price) >= 0) return round2(Number(custom.price));
    if (Number.isFinite(Number(product.wholesalePrice)) && Number(product.wholesalePrice) >= 0) {
      return round2(Number(product.wholesalePrice));
    }
    return round2(Number(product.sellingPrice) || 0);
  }

  function movementExists(spreadsheet, id) {
    var found = false;
    inventoryRepo.readMovements(spreadsheet).forEach(function (row) {
      if (row.id === id) found = true;
    });
    return found;
  }

  function snapshotComponents(product, catalogRows, saleQty) {
    return (product.salesComponents || []).map(function (row) {
      var component = findProduct(catalogRows, row.productId);
      return {
        productId: row.productId,
        productName: component ? component.name : '',
        sku: component ? component.sku : '',
        qty: round2(saleQty * Number(row.qty)),
        unit: component ? component.unit : ''
      };
    });
  }

  function inactiveComponentName(product, catalogRows) {
    var rows = product && product.salesComponents ? product.salesComponents : [];
    for (var i = 0; i < rows.length; i += 1) {
      var component = findProduct(catalogRows, rows[i].productId);
      if (!component || component.status !== 'active') return component ? component.name : 'Component';
    }
    return null;
  }

  function buildSaleLines(items, catalogRows) {
    var lines = [];
    (items || []).forEach(function (item) {
      var qty = Number(item.qty);
      var price = Number(item.price);
      if (!Number.isFinite(qty) || !(qty > 0)) return;
      if (!Number.isFinite(price)) price = 0;
      var discount = Number(item.discount);
      if (!Number.isFinite(discount)) discount = 0;
      var product = findProduct(catalogRows, item.productId);
      if (!product) throw appError('VALIDATION_ERROR', 'Choose a valid product');
      if (!productIsSellable(product)) throw appError('VALIDATION_ERROR', 'This item is not sellable.');
      var inactive = inactiveComponentName(product, catalogRows);
      if (inactive) throw appError('VALIDATION_ERROR', inactive + ' is inactive.');
      var line = {
        productId: product.id,
        qty: qty,
        price: price,
        discount: discount,
        total: round2(qty * price - discount),
        returnedQty: 0
      };
      var batchNo = text(item.batchNo).trim();
      var expiry = text(item.expiry).trim();
      var description = text(item.description).trim();
      if (batchNo) line.batchNo = batchNo;
      if (expiry) line.expiry = expiry;
      if (description) line.description = description;
      var snapshot = snapshotComponents(product, catalogRows, qty);
      if (snapshot.length) line.salesComponentsSnapshot = snapshot;
      lines.push(line);
    });
    if (!lines.length) throw appError('VALIDATION_ERROR', 'Add at least one product.');
    return lines;
  }

  function stockOutsForLine(line, catalogRows) {
    if (line.salesComponentsSnapshot && line.salesComponentsSnapshot.length) {
      return line.salesComponentsSnapshot.map(function (row) {
        var parent = findProduct(catalogRows, line.productId);
        return {
          productId: row.productId,
          qty: Number(row.qty),
          notes: 'Sales component · ' + ((parent && parent.name) || line.productId)
        };
      });
    }
    return [{ productId: line.productId, qty: Number(line.qty), notes: '' }];
  }

  function assertSaleStock(spreadsheet, lines, warehouseId, catalogRows) {
    if (allowNegative(spreadsheet)) return;
    var required = {};
    lines.forEach(function (line) {
      stockOutsForLine(line, catalogRows).forEach(function (row) {
        if (!(row.qty > 0)) return;
        required[row.productId] = round2((required[row.productId] || 0) + row.qty);
      });
    });
    var balances = products.readBalances(spreadsheet);
    var usesComponents = lines.some(function (line) {
      return line.salesComponentsSnapshot && line.salesComponentsSnapshot.length;
    });
    Object.keys(required).forEach(function (productId) {
      var available = qtyOf(balances, productId, warehouseId);
      var qty = required[productId];
      if (qty > available) {
        var product = findProduct(catalogRows, productId);
        var name = product ? product.name : 'Item';
        if (usesComponents) {
          throw appError('VALIDATION_ERROR', name + ' has ' + available + ' available. Required: ' + qty + '.');
        }
        throw appError('VALIDATION_ERROR', name + ' has ' + available + ' available.');
      }
    });
  }

  function postSaleMovements(spreadsheet, actor, input) {
    var balances = products.readBalances(spreadsheet);
    var index = 0;
    input.lines.forEach(function (line) {
      stockOutsForLine(line, input.catalog).forEach(function (row) {
        if (!(row.qty > 0)) return;
        var movementId = movementIdFor(input.docId, index);
        index += 1;
        if (movementExists(spreadsheet, movementId)) return;
        var current = qtyOf(balances, row.productId, input.warehouseId);
        var balance = round2(current - row.qty);
        inventoryRepo.appendMovement(spreadsheet, {
          id: movementId,
          date: input.date,
          reference: input.reference,
          productId: row.productId,
          warehouseId: input.warehouseId,
          type: 'sale',
          stockIn: 0,
          stockOut: row.qty,
          balance: balance,
          user: actor.name,
          notes: row.notes || ''
        });
        balances = putQty(balances, row.productId, input.warehouseId, balance);
      });
    });
    products.writeBalances(spreadsheet, balances);
  }

  function postVoidMovements(spreadsheet, actor, sale) {
    var balances = products.readBalances(spreadsheet);
    var index = 0;
    sale.items.forEach(function (line) {
      var remainingRatio = line.qty > 0 ? (line.qty - (line.returnedQty || 0)) / line.qty : 0;
      if (!(remainingRatio > 0)) return;
      var restores = line.salesComponentsSnapshot && line.salesComponentsSnapshot.length
        ? line.salesComponentsSnapshot.map(function (row) {
          return { productId: row.productId, qty: round2(row.qty * remainingRatio) };
        })
        : [{ productId: line.productId, qty: round2(line.qty - (line.returnedQty || 0)) }];
      restores.forEach(function (row) {
        if (!(row.qty > 0)) return;
        var movementId = movementIdFor(sale.id + '-VOID', index);
        index += 1;
        if (movementExists(spreadsheet, movementId)) return;
        var current = qtyOf(balances, row.productId, sale.warehouseId);
        var balance = round2(current + row.qty);
        inventoryRepo.appendMovement(spreadsheet, {
          id: movementId,
          date: nowIso(),
          reference: sale.invoiceNo + '-VOID',
          productId: row.productId,
          warehouseId: sale.warehouseId,
          type: 'sales_return',
          stockIn: row.qty,
          stockOut: 0,
          balance: balance,
          user: actor.name,
          notes: 'Voided sale'
        });
        balances = putQty(balances, row.productId, sale.warehouseId, balance);
      });
    });
    products.writeBalances(spreadsheet, balances);
  }

  function appendDocAudit(spreadsheet, actor, entry) {
    repository.appendDocumentAudit(spreadsheet, {
      id: newId('dal'),
      action: entry.action,
      documentType: entry.documentType,
      documentId: entry.documentId,
      documentNo: entry.documentNo,
      field: entry.field || '',
      oldValue: entry.oldValue || '',
      newValue: entry.newValue || '',
      changedBy: actor.name,
      changedAt: nowIso()
    });
  }

  function snapshot(spreadsheet) {
    repository.ensure(spreadsheet);
    purchaseRepo.ensure(spreadsheet);
    inventoryRepo.ensure(spreadsheet);
    var movements = inventoryRepo.readMovements(spreadsheet);
    movements.reverse();
    return {
      sales: repository.readSales(spreadsheet),
      quotations: repository.readQuotations(spreadsheet),
      deliveryOrders: repository.readDeliveries(spreadsheet),
      documentAuditLogs: repository.readDocumentAudits(spreadsheet),
      payments: purchaseRepo.readPayments(spreadsheet),
      inventory: products.readBalances(spreadsheet).map(function (row) {
        return { productId: row.productId, warehouseId: row.warehouseId, qty: round2(row.qty) };
      }),
      stockMovements: movements
    };
  }

  function saleStatus(paidAmount, total) {
    if (paidAmount >= total) return 'paid';
    if (paidAmount > 0) return 'partial';
    return 'unpaid';
  }

  function createSale(spreadsheet, payload, requestId, actor, options) {
    var settings = settingsRow(spreadsheet);
    var catalogRows = catalog(spreadsheet);
    var wholesale = Boolean(options && options.wholesale) || text(payload.pricingMode).trim() === 'wholesale';
    var warehouseId = text(payload.warehouseId).trim() || text(settings.defaultWarehouseId).trim();
    requireCompanyWarehouse(spreadsheet, warehouseId);
    var customer = requireCustomer(spreadsheet, payload.customerId);
    var rawItems = payload.items || [];
    if (wholesale) {
      rawItems = rawItems.map(function (item) {
        var product = findProduct(catalogRows, item.productId);
        if (!product) throw appError('VALIDATION_ERROR', 'Choose a valid product');
        var copy = Object.assign({}, item);
        if (copy.price === undefined || copy.price === null || copy.price === '') {
          copy.price = resolveWholesaleUnitPrice(spreadsheet, customer.id, product);
        }
        return copy;
      });
    }
    var lines = buildSaleLines(rawItems, catalogRows);
    assertSaleStock(spreadsheet, lines, warehouseId, catalogRows);
    var docs = repository.readSales(spreadsheet);
    var id = clientId(payload.clientId || payload.id, 'sal');
    docs.forEach(function (row) {
      if (row.id === id) throw appError('CONFLICT', 'Sale already exists.');
    });
    var subtotal = round2(lines.reduce(function (sum, line) { return sum + line.total; }, 0));
    var discount = round2(Number(payload.discount) || 0);
    var tax = round2(Number(payload.tax) || 0);
    var shipping = round2(Number(payload.shipping) || 0);
    var total = round2(subtotal - discount + tax + shipping);
    var paidAmount = Math.min(round2(Number(payload.paidAmount) || 0), total);
    var date = text(payload.date).trim() || nowIso();
    var invoiceNo = flagCell(payload.datedInvoiceNo)
      ? nextDatedDocNo(docs.map(function (row) { return row.invoiceNo; }), 'INV-', date)
      : nextDocNo(docs.map(function (row) { return row.invoiceNo; }), 'INV-', 6);
    var sale = {
      id: id,
      invoiceNo: invoiceNo,
      date: date,
      customerId: customer.id,
      warehouseId: warehouseId,
      salesperson: text(payload.salesperson).trim() || actor.name,
      items: lines,
      subtotal: subtotal,
      discount: discount,
      tax: tax,
      shipping: shipping,
      total: total,
      paid: paidAmount,
      balance: round2(total - paidAmount),
      status: saleStatus(paidAmount, total)
    };
    var paymentMethod = text(payload.paymentMethod).trim();
    var notes = text(payload.notes).trim();
    var reference = text(payload.reference).trim();
    var quotationId = text(payload.quotationId).trim();
    var quotationNo = text(payload.quotationNo).trim();
    var dueDate = text(payload.dueDate).trim();
    var paymentTerms = text(payload.paymentTerms).trim() || text(settings.paymentTerms).trim();
    if (paymentMethod) sale.paymentMethod = paymentMethod;
    if (notes) sale.notes = notes;
    if (reference) sale.reference = reference;
    if (quotationId) sale.quotationId = quotationId;
    if (quotationNo) sale.quotationNo = quotationNo;
    if (dueDate) sale.dueDate = dueDate;
    if (paymentTerms) sale.paymentTerms = paymentTerms;
    if (wholesale) sale.pricingMode = 'wholesale';
    postSaleMovements(spreadsheet, actor, {
      lines: lines,
      catalog: catalogRows,
      warehouseId: warehouseId,
      date: date,
      reference: invoiceNo,
      docId: id
    });
    repository.writeSales(spreadsheet, [sale].concat(docs));
    if (paidAmount > 0 && paymentMethod) {
      var payments = purchaseRepo.readPayments(spreadsheet);
      purchaseRepo.appendPayment(spreadsheet, {
        id: newId('pay'),
        paymentNo: nextDocNo(payments.map(function (row) { return row.paymentNo; }), 'PAY-', 6),
        date: date,
        partyType: 'customer',
        partyId: customer.id,
        invoiceId: sale.id,
        invoiceNo: invoiceNo,
        method: paymentMethod,
        amount: paidAmount,
        status: 'completed'
      });
    }
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: wholesale ? 'sales.createWholesale' : 'sales.create',
      entityType: 'sale',
      entityId: sale.id,
      reference: sale.invoiceNo,
      before: '',
      after: JSON.stringify({ status: sale.status, paid: sale.paid }),
      requestId: requestId
    });
    return sale;
  }

  function voidSale(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var docs = repository.readSales(spreadsheet);
    var sale = null;
    docs.forEach(function (row) { if (row.id === id) sale = row; });
    if (!sale) throw appError('NOT_FOUND', 'Sale not found');
    if (sale.status === 'voided') throw appError('CONFLICT', 'Sale already voided');
    if (text(sale.invoiceNo).indexOf('SAL-') === 0) {
      throw appError('VALIDATION_ERROR', 'Agent sales cannot be voided in this version.');
    }
    postVoidMovements(spreadsheet, actor, sale);
    var updated = Object.assign({}, sale, { status: 'voided', balance: 0 });
    repository.writeSales(spreadsheet, docs.map(function (row) {
      return row.id === id ? updated : row;
    }));
    appendDocAudit(spreadsheet, actor, {
      action: 'invoice_cancelled',
      documentType: 'invoice',
      documentId: sale.id,
      documentNo: sale.invoiceNo,
      field: 'status',
      oldValue: sale.status,
      newValue: 'cancelled'
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'sales.void',
      entityType: 'sale',
      entityId: sale.id,
      reference: sale.invoiceNo,
      before: JSON.stringify({ status: sale.status }),
      after: JSON.stringify({ status: 'voided' }),
      requestId: requestId
    });
    return updated;
  }

  function recordPayment(spreadsheet, payload, requestId, actor) {
    var amount = Number(payload.amount);
    if (!Number.isFinite(amount) || !(amount > 0)) {
      throw appError('VALIDATION_ERROR', 'Enter an amount');
    }
    var saleId = text(payload.invoiceId || payload.saleId).trim();
    var docs = repository.readSales(spreadsheet);
    var sale = null;
    docs.forEach(function (row) { if (row.id === saleId) sale = row; });
    if (!sale || sale.balance <= 0) throw appError('VALIDATION_ERROR', 'Nothing to collect');
    if (sale.status === 'voided') throw appError('VALIDATION_ERROR', 'Nothing to collect');
    var applied = Math.min(round2(amount), sale.balance);
    var paid = round2(sale.paid + applied);
    var balance = round2(sale.total - paid);
    var method = text(payload.method).trim() || 'cash';
    var payment = {
      id: newId('pay'),
      paymentNo: nextDocNo(purchaseRepo.readPayments(spreadsheet).map(function (row) { return row.paymentNo; }), 'PAY-', 6),
      date: nowIso(),
      partyType: 'customer',
      partyId: sale.customerId,
      invoiceId: sale.id,
      invoiceNo: sale.invoiceNo,
      method: method,
      amount: applied,
      status: 'completed'
    };
    purchaseRepo.appendPayment(spreadsheet, payment);
    var nextStatus = balance <= 0 ? 'paid' : 'partial';
    var updated = Object.assign({}, sale, {
      paid: paid,
      balance: balance,
      status: nextStatus,
      paymentMethod: method
    });
    repository.writeSales(spreadsheet, docs.map(function (row) {
      return row.id === sale.id ? updated : row;
    }));
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'sales.recordPayment',
      entityType: 'sale',
      entityId: sale.id,
      reference: payment.paymentNo,
      before: JSON.stringify({ balance: sale.balance }),
      after: JSON.stringify({ balance: balance, status: nextStatus }),
      requestId: requestId
    });
    return { sale: updated, payment: payment };
  }

  function buildQuoteLines(spreadsheet, items) {
    var catalogRows = catalog(spreadsheet);
    var lines = [];
    (items || []).forEach(function (item) {
      var qty = Number(item.qty);
      var price = Number(item.price);
      if (!Number.isFinite(qty) || !(qty > 0) || !text(item.productId).trim()) return;
      if (!Number.isFinite(price)) price = 0;
      var discount = Number(item.discount);
      if (!Number.isFinite(discount)) discount = 0;
      var product = findProduct(catalogRows, item.productId);
      if (!product) throw appError('VALIDATION_ERROR', 'Choose a valid product');
      if (!productIsSellable(product)) throw appError('VALIDATION_ERROR', 'This item is not sellable.');
      lines.push({
        productId: product.id,
        description: text(item.description).trim() || product.name || 'Item',
        qty: qty,
        unit: text(item.unit).trim() || product.unit || 'pcs',
        price: price,
        discount: discount,
        total: round2(Math.max(0, qty * price - discount))
      });
    });
    if (!lines.length) throw appError('VALIDATION_ERROR', 'Add at least one item');
    return lines;
  }

  function quoteTotals(lines, extraDiscount, tax, shipping) {
    var subtotal = round2(lines.reduce(function (sum, line) { return sum + line.total; }, 0));
    var discount = round2(Number(extraDiscount) || 0);
    var delivery = round2(Number(shipping) || 0);
    var taxAmt = round2(Number(tax) || 0);
    return {
      subtotal: subtotal,
      discount: discount,
      tax: taxAmt,
      shipping: delivery,
      total: round2(Math.max(0, subtotal - discount + taxAmt + delivery))
    };
  }

  function createQuotation(spreadsheet, payload, requestId, actor) {
    var customer = requireCustomer(spreadsheet, payload.customerId);
    var lines = buildQuoteLines(spreadsheet, payload.items);
    var settings = settingsRow(spreadsheet);
    var date = text(payload.date).trim() || nowIso();
    var docs = repository.readQuotations(spreadsheet);
    var id = clientId(payload.clientId || payload.id, 'qt');
    docs.forEach(function (row) {
      if (row.id === id) throw appError('CONFLICT', 'Quotation already exists.');
    });
    var totals = quoteTotals(lines, payload.discount, payload.tax, payload.shipping);
    var quotation = {
      id: id,
      quotationNo: nextDatedDocNo(docs.map(function (row) { return row.quotationNo; }), 'QT-', date),
      date: date,
      validUntil: text(payload.validUntil).trim() || addDaysIso(date, 14),
      customerId: customer.id,
      salesperson: text(payload.salesperson).trim() || actor.name,
      reference: text(payload.reference).trim(),
      notes: text(payload.notes).trim(),
      terms: text(payload.terms).trim() || text(settings.documentTerms).trim(),
      items: lines,
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      shipping: totals.shipping,
      total: totals.total,
      status: text(payload.status).trim() || 'draft',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    var agentId = text(payload.agentId).trim();
    if (agentId) quotation.agentId = agentId;
    repository.writeQuotations(spreadsheet, [quotation].concat(docs));
    appendDocAudit(spreadsheet, actor, {
      action: 'quotation_created',
      documentType: 'quotation',
      documentId: quotation.id,
      documentNo: quotation.quotationNo,
      newValue: customer.name + ' · ' + quotation.total
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'quotations.create',
      entityType: 'quotation',
      entityId: quotation.id,
      reference: quotation.quotationNo,
      before: '',
      after: JSON.stringify({ status: quotation.status, total: quotation.total }),
      requestId: requestId
    });
    return quotation;
  }

  function updateQuotation(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var docs = repository.readQuotations(spreadsheet);
    var current = null;
    docs.forEach(function (row) { if (row.id === id) current = row; });
    if (!current) throw appError('NOT_FOUND', 'Quotation not found');
    if (current.status === 'cancelled' || current.convertedSaleId) {
      throw appError('VALIDATION_ERROR', 'This quotation cannot be edited');
    }
    var lines = buildQuoteLines(spreadsheet, payload.items);
    var totals = quoteTotals(lines, payload.discount, payload.tax, payload.shipping !== undefined ? payload.shipping : current.shipping);
    var updated = Object.assign({}, current, {
      customerId: text(payload.customerId).trim() || current.customerId,
      validUntil: text(payload.validUntil).trim() || current.validUntil,
      salesperson: text(payload.salesperson).trim() || current.salesperson,
      reference: payload.reference !== undefined ? text(payload.reference).trim() : current.reference,
      notes: payload.notes !== undefined ? text(payload.notes).trim() : current.notes,
      terms: payload.terms !== undefined ? text(payload.terms).trim() : current.terms,
      items: lines,
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      shipping: totals.shipping,
      total: totals.total,
      updatedAt: nowIso()
    });
    if (payload.agentId !== undefined) {
      var agentId = text(payload.agentId).trim();
      if (agentId) updated.agentId = agentId;
      else delete updated.agentId;
    }
    repository.writeQuotations(spreadsheet, docs.map(function (row) {
      return row.id === id ? updated : row;
    }));
    appendDocAudit(spreadsheet, actor, {
      action: 'quotation_edited',
      documentType: 'quotation',
      documentId: current.id,
      documentNo: current.quotationNo
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'quotations.update',
      entityType: 'quotation',
      entityId: current.id,
      reference: current.quotationNo,
      before: '',
      after: JSON.stringify({ total: updated.total }),
      requestId: requestId
    });
    return updated;
  }

  function setQuotationStatus(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var status = text(payload.status).trim();
    var docs = repository.readQuotations(spreadsheet);
    var current = null;
    docs.forEach(function (row) { if (row.id === id) current = row; });
    if (!current) throw appError('NOT_FOUND', 'Quotation not found');
    var updated = Object.assign({}, current, { status: status, updatedAt: nowIso() });
    repository.writeQuotations(spreadsheet, docs.map(function (row) {
      return row.id === id ? updated : row;
    }));
    var action = status === 'sent' ? 'quotation_issued' : status === 'cancelled' ? 'quotation_cancelled' : 'quotation_edited';
    appendDocAudit(spreadsheet, actor, {
      action: action,
      documentType: 'quotation',
      documentId: current.id,
      documentNo: current.quotationNo,
      field: 'status',
      oldValue: current.status,
      newValue: status
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'quotations.setStatus',
      entityType: 'quotation',
      entityId: current.id,
      reference: current.quotationNo,
      before: JSON.stringify({ status: current.status }),
      after: JSON.stringify({ status: status }),
      requestId: requestId
    });
    return updated;
  }

  function convertQuotation(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var docs = repository.readQuotations(spreadsheet);
    var quotation = null;
    docs.forEach(function (row) { if (row.id === id) quotation = row; });
    if (!quotation) throw appError('NOT_FOUND', 'Quotation not found');
    if (quotation.convertedSaleId) {
      var existing = null;
      repository.readSales(spreadsheet).forEach(function (row) {
        if (row.id === quotation.convertedSaleId) existing = row;
      });
      return existing;
    }
    if (quotation.status === 'cancelled') {
      throw appError('VALIDATION_ERROR', 'Cancelled quotations cannot be converted');
    }
    if (quotation.agentId) {
      throw appError('VALIDATION_ERROR', 'Agent stock sales must use the Agent sale flow.');
    }
    var settings = settingsRow(spreadsheet);
    var sale = createSale(spreadsheet, {
      clientId: payload.clientSaleId,
      customerId: quotation.customerId,
      warehouseId: text(settings.defaultWarehouseId).trim(),
      salesperson: quotation.salesperson,
      items: quotation.items.map(function (line) {
        return {
          productId: line.productId,
          qty: line.qty,
          price: line.price,
          discount: line.discount,
          description: line.description
        };
      }),
      discount: quotation.discount,
      tax: quotation.tax,
      shipping: quotation.shipping,
      paidAmount: 0,
      notes: quotation.notes,
      reference: quotation.reference,
      datedInvoiceNo: true,
      quotationId: quotation.id,
      quotationNo: quotation.quotationNo,
      dueDate: addDaysIso(nowIso(), 7),
      paymentTerms: text(settings.paymentTerms).trim()
    }, requestId, actor, {});
    var updatedQuote = Object.assign({}, quotation, {
      status: 'accepted',
      convertedSaleId: sale.id,
      convertedInvoiceNo: sale.invoiceNo,
      updatedAt: nowIso()
    });
    repository.writeQuotations(spreadsheet, repository.readQuotations(spreadsheet).map(function (row) {
      return row.id === quotation.id ? updatedQuote : row;
    }));
    appendDocAudit(spreadsheet, actor, {
      action: 'quotation_converted',
      documentType: 'quotation',
      documentId: quotation.id,
      documentNo: quotation.quotationNo,
      oldValue: quotation.quotationNo,
      newValue: sale.invoiceNo
    });
    appendDocAudit(spreadsheet, actor, {
      action: 'invoice_created',
      documentType: 'invoice',
      documentId: sale.id,
      documentNo: sale.invoiceNo,
      newValue: 'From ' + quotation.quotationNo
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'quotations.convert',
      entityType: 'quotation',
      entityId: quotation.id,
      reference: sale.invoiceNo,
      before: JSON.stringify({ status: quotation.status }),
      after: JSON.stringify({ convertedSaleId: sale.id, invoiceNo: sale.invoiceNo }),
      requestId: requestId
    });
    return sale;
  }

  function createDelivery(spreadsheet, payload, requestId, actor) {
    var customer = requireCustomer(spreadsheet, payload.customerId);
    var settings = settingsRow(spreadsheet);
    var sale = null;
    var quotation = null;
    if (text(payload.saleId).trim()) {
      repository.readSales(spreadsheet).forEach(function (row) {
        if (row.id === text(payload.saleId).trim()) sale = row;
      });
    }
    if (text(payload.quotationId).trim()) {
      repository.readQuotations(spreadsheet).forEach(function (row) {
        if (row.id === text(payload.quotationId).trim()) quotation = row;
      });
    }
    var catalogRows = catalog(spreadsheet);
    var items = (payload.items && payload.items.length
      ? payload.items
      : sale
        ? sale.items.map(function (line) {
          var product = findProduct(catalogRows, line.productId);
          return {
            productId: line.productId,
            description: line.description || (product && product.name) || 'Item',
            qty: line.qty,
            unit: (product && product.unit) || 'pcs'
          };
        })
        : []
    ).filter(function (line) { return Number(line.qty) > 0 && text(line.productId).trim(); })
      .map(function (line) {
        var product = findProduct(catalogRows, line.productId);
        return {
          productId: text(line.productId).trim(),
          description: text(line.description).trim() || (product && product.name) || 'Item',
          qty: Number(line.qty),
          unit: text(line.unit).trim() || (product && product.unit) || 'pcs'
        };
      });
    if (!items.length) throw appError('VALIDATION_ERROR', 'Add at least one item');
    var docs = repository.readDeliveries(spreadsheet);
    var id = clientId(payload.clientId || payload.id, 'do');
    docs.forEach(function (row) {
      if (row.id === id) throw appError('CONFLICT', 'Delivery order already exists.');
    });
    var date = text(payload.date).trim() || nowIso();
    var order = {
      id: id,
      doNo: nextDatedDocNo(docs.map(function (row) { return row.doNo; }), 'DO-', date),
      date: date,
      customerId: customer.id,
      deliveryAddress: text(payload.deliveryAddress).trim() || customer.address || text(settings.address).trim(),
      contactPerson: text(payload.contactPerson).trim() || customer.name,
      contactNumber: text(payload.contactNumber).trim() || customer.phone,
      transport: text(payload.transport).trim(),
      preparedBy: text(payload.preparedBy).trim() || actor.name,
      notes: text(payload.notes).trim(),
      items: items,
      status: text(payload.status).trim() || 'draft',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    if (sale) {
      order.saleId = sale.id;
      order.invoiceNo = sale.invoiceNo;
    }
    if (quotation || (sale && sale.quotationId)) {
      order.quotationId = quotation ? quotation.id : sale.quotationId;
      order.quotationNo = quotation ? quotation.quotationNo : sale.quotationNo;
    }
    repository.writeDeliveries(spreadsheet, [order].concat(docs));
    appendDocAudit(spreadsheet, actor, {
      action: 'delivery_created',
      documentType: 'delivery',
      documentId: order.id,
      documentNo: order.doNo,
      newValue: order.invoiceNo || customer.name
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'deliveries.create',
      entityType: 'delivery',
      entityId: order.id,
      reference: order.doNo,
      before: '',
      after: JSON.stringify({ status: order.status }),
      requestId: requestId
    });
    return order;
  }

  function updateDelivery(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var docs = repository.readDeliveries(spreadsheet);
    var current = null;
    docs.forEach(function (row) { if (row.id === id) current = row; });
    if (!current || current.status === 'cancelled' || current.status === 'delivered') {
      throw appError('VALIDATION_ERROR', 'This delivery order cannot be edited');
    }
    var catalogRows = catalog(spreadsheet);
    var items = payload.items
      ? (payload.items || []).filter(function (line) {
        return Number(line.qty) > 0 && text(line.productId).trim();
      }).map(function (line) {
        var product = findProduct(catalogRows, line.productId);
        return {
          productId: text(line.productId).trim(),
          description: text(line.description).trim() || (product && product.name) || 'Item',
          qty: Number(line.qty),
          unit: text(line.unit).trim() || (product && product.unit) || 'pcs'
        };
      })
      : current.items;
    var updated = Object.assign({}, current, {
      deliveryAddress: payload.deliveryAddress !== undefined ? text(payload.deliveryAddress).trim() : current.deliveryAddress,
      contactPerson: payload.contactPerson !== undefined ? text(payload.contactPerson).trim() : current.contactPerson,
      contactNumber: payload.contactNumber !== undefined ? text(payload.contactNumber).trim() : current.contactNumber,
      transport: payload.transport !== undefined ? text(payload.transport).trim() : current.transport,
      notes: payload.notes !== undefined ? text(payload.notes).trim() : current.notes,
      items: items,
      updatedAt: nowIso()
    });
    repository.writeDeliveries(spreadsheet, docs.map(function (row) {
      return row.id === id ? updated : row;
    }));
    appendDocAudit(spreadsheet, actor, {
      action: 'delivery_edited',
      documentType: 'delivery',
      documentId: current.id,
      documentNo: current.doNo
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'deliveries.update',
      entityType: 'delivery',
      entityId: current.id,
      reference: current.doNo,
      before: '',
      after: JSON.stringify({ status: updated.status }),
      requestId: requestId
    });
    return updated;
  }

  function setDeliveryStatus(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var status = text(payload.status).trim();
    var docs = repository.readDeliveries(spreadsheet);
    var current = null;
    docs.forEach(function (row) { if (row.id === id) current = row; });
    if (!current) throw appError('NOT_FOUND', 'Delivery order not found');
    var updated = Object.assign({}, current, { status: status, updatedAt: nowIso() });
    repository.writeDeliveries(spreadsheet, docs.map(function (row) {
      return row.id === id ? updated : row;
    }));
    var action = status === 'issued'
      ? 'delivery_issued'
      : status === 'cancelled'
        ? 'delivery_cancelled'
        : status === 'delivered'
          ? 'delivery_delivered'
          : 'delivery_edited';
    appendDocAudit(spreadsheet, actor, {
      action: action,
      documentType: 'delivery',
      documentId: current.id,
      documentNo: current.doNo,
      field: 'status',
      oldValue: current.status,
      newValue: status
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'deliveries.setStatus',
      entityType: 'delivery',
      entityId: current.id,
      reference: current.doNo,
      before: JSON.stringify({ status: current.status }),
      after: JSON.stringify({ status: status }),
      requestId: requestId
    });
    return updated;
  }

  function recordPrint(spreadsheet, payload, requestId, actor, type) {
    var id = text(payload.id).trim();
    var row = null;
    var documentNo = id;
    if (type === 'quotation') {
      repository.readQuotations(spreadsheet).forEach(function (item) {
        if (item.id === id) row = item;
      });
      if (row) documentNo = row.quotationNo;
    } else if (type === 'invoice') {
      repository.readSales(spreadsheet).forEach(function (item) {
        if (item.id === id) row = item;
      });
      if (row) documentNo = row.invoiceNo;
    } else {
      repository.readDeliveries(spreadsheet).forEach(function (item) {
        if (item.id === id) row = item;
      });
      if (row) documentNo = row.doNo;
    }
    if (!row) throw appError('NOT_FOUND', 'Document not found');
    var action = type === 'quotation' ? 'quotation_printed' : type === 'invoice' ? 'invoice_printed' : 'delivery_printed';
    appendDocAudit(spreadsheet, actor, {
      action: action,
      documentType: type,
      documentId: id,
      documentNo: documentNo
    });
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'documents.recordPrint',
      entityType: type,
      entityId: id,
      reference: documentNo,
      before: '',
      after: action,
      requestId: requestId
    });
    return { id: id, documentNo: documentNo, type: type };
  }

  function findIn(list, id) {
    var found = null;
    list.forEach(function (row) { if (row.id === id) found = row; });
    return found;
  }

  function listPermissionActor(spreadsheet, actorUserId) {
    return requireAnyPermission(
      spreadsheet,
      actorUserId,
      ['sales.view', 'sales.create', 'sales.invoice.view', 'sales.quotation.view', 'sales.delivery.view'],
      'You do not have permission to view sales.'
    );
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'sales.list' || action === 'quotations.list' || action === 'deliveries.list') {
        listPermissionActor(spreadsheet, payload.actorUserId);
        return okEnvelope(snapshot(spreadsheet));
      }
      if (action === 'sales.get') {
        listPermissionActor(spreadsheet, payload.actorUserId);
        var sale = findIn(repository.readSales(spreadsheet), text(payload.id).trim());
        if (!sale) throw appError('NOT_FOUND', 'Sale not found');
        var saleState = snapshot(spreadsheet);
        saleState.sale = sale;
        return okEnvelope(saleState);
      }
      if (action === 'quotations.get') {
        requirePermission(spreadsheet, payload.actorUserId, 'sales.quotation.view', 'You cannot view quotations.');
        var quotation = findIn(repository.readQuotations(spreadsheet), text(payload.id).trim());
        if (!quotation) throw appError('NOT_FOUND', 'Quotation not found');
        var quoteState = snapshot(spreadsheet);
        quoteState.quotation = quotation;
        return okEnvelope(quoteState);
      }
      if (action === 'deliveries.get') {
        requirePermission(spreadsheet, payload.actorUserId, 'sales.delivery.view', 'You cannot view delivery orders.');
        var delivery = findIn(repository.readDeliveries(spreadsheet), text(payload.id).trim());
        if (!delivery) throw appError('NOT_FOUND', 'Delivery order not found');
        var deliveryState = snapshot(spreadsheet);
        deliveryState.deliveryOrder = delivery;
        return okEnvelope(deliveryState);
      }
      if (action === 'sales.create' || action === 'sales.createWholesale') {
        requireKey(request);
        var created = createSale(
          spreadsheet,
          payload,
          requestId,
          action === 'sales.createWholesale'
            ? requireAnyPermission(spreadsheet, payload.actorUserId, ['sales.create', 'sales.invoice.create'], 'You cannot create invoices.')
            : requirePermission(spreadsheet, payload.actorUserId, 'sales.create', 'You cannot create sales.'),
          { wholesale: action === 'sales.createWholesale' }
        );
        var afterCreate = snapshot(spreadsheet);
        afterCreate.sale = created;
        return okEnvelope(afterCreate);
      }
      if (action === 'sales.void') {
        requireKey(request);
        var voided = voidSale(
          spreadsheet,
          payload,
          requestId,
          requireAnyPermission(spreadsheet, payload.actorUserId, ['sales.void', 'sales.invoice.cancel'], 'You cannot void sales.')
        );
        var afterVoid = snapshot(spreadsheet);
        afterVoid.sale = voided;
        return okEnvelope(afterVoid);
      }
      if (action === 'sales.recordPayment') {
        requireKey(request);
        var paid = recordPayment(
          spreadsheet,
          payload,
          requestId,
          requireAnyPermission(spreadsheet, payload.actorUserId, ['sales.create', 'sales.invoice.create', 'sales.invoice.edit'], 'You cannot record customer payments.')
        );
        var afterPay = snapshot(spreadsheet);
        afterPay.sale = paid.sale;
        afterPay.payment = paid.payment;
        return okEnvelope(afterPay);
      }
      if (action === 'quotations.create') {
        var quote = createQuotation(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.quotation.create', 'You cannot create quotations.')
        );
        var afterQuote = snapshot(spreadsheet);
        afterQuote.quotation = quote;
        return okEnvelope(afterQuote);
      }
      if (action === 'quotations.update') {
        var edited = updateQuotation(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.quotation.edit', 'You cannot edit quotations.')
        );
        var afterEdit = snapshot(spreadsheet);
        afterEdit.quotation = edited;
        return okEnvelope(afterEdit);
      }
      if (action === 'quotations.setStatus') {
        var nextStatus = text(payload.status).trim();
        var statusActor = nextStatus === 'sent'
          ? requirePermission(spreadsheet, payload.actorUserId, 'sales.quotation.issue', 'You cannot issue quotations.')
          : nextStatus === 'cancelled'
            ? requirePermission(spreadsheet, payload.actorUserId, 'sales.quotation.cancel', 'You cannot cancel quotations.')
            : requireAnyPermission(spreadsheet, payload.actorUserId, ['sales.quotation.edit', 'sales.quotation.issue'], 'You cannot update this quotation.');
        var statused = setQuotationStatus(spreadsheet, payload, requestId, statusActor);
        var afterStatus = snapshot(spreadsheet);
        afterStatus.quotation = statused;
        return okEnvelope(afterStatus);
      }
      if (action === 'quotations.convert') {
        requireKey(request);
        var converted = convertQuotation(
          spreadsheet,
          payload,
          requestId,
          requireAnyPermission(spreadsheet, payload.actorUserId, ['sales.invoice.create', 'sales.create'], 'You cannot convert this quotation to an invoice.')
        );
        var afterConvert = snapshot(spreadsheet);
        afterConvert.sale = converted;
        return okEnvelope(afterConvert);
      }
      if (action === 'deliveries.create') {
        var createdDo = createDelivery(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.delivery.create', 'You cannot create delivery orders.')
        );
        var afterDo = snapshot(spreadsheet);
        afterDo.deliveryOrder = createdDo;
        return okEnvelope(afterDo);
      }
      if (action === 'deliveries.update') {
        var updatedDo = updateDelivery(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'sales.delivery.edit', 'You cannot edit delivery orders.')
        );
        var afterDoEdit = snapshot(spreadsheet);
        afterDoEdit.deliveryOrder = updatedDo;
        return okEnvelope(afterDoEdit);
      }
      if (action === 'deliveries.setStatus') {
        var doStatus = text(payload.status).trim();
        var doActor = doStatus === 'issued'
          ? requirePermission(spreadsheet, payload.actorUserId, 'sales.delivery.issue', 'You cannot issue delivery orders.')
          : doStatus === 'cancelled'
            ? requirePermission(spreadsheet, payload.actorUserId, 'sales.delivery.cancel', 'You cannot cancel delivery orders.')
            : doStatus === 'delivered'
              ? requireAnyPermission(spreadsheet, payload.actorUserId, ['sales.delivery.issue', 'sales.delivery.edit'], 'You cannot mark this delivery order delivered.')
              : requirePermission(spreadsheet, payload.actorUserId, 'sales.delivery.edit', 'You cannot edit delivery orders.');
        var statusDo = setDeliveryStatus(spreadsheet, payload, requestId, doActor);
        var afterDoStatus = snapshot(spreadsheet);
        afterDoStatus.deliveryOrder = statusDo;
        return okEnvelope(afterDoStatus);
      }
      if (action === 'documents.recordPrint') {
        var type = text(payload.type).trim();
        var printKey = type === 'quotation'
          ? 'sales.quotation.print'
          : type === 'invoice'
            ? 'sales.invoice.print'
            : 'sales.delivery.print';
        if (type !== 'quotation' && type !== 'invoice' && type !== 'delivery') {
          throw appError('VALIDATION_ERROR', 'You cannot print this document.');
        }
        var printed = recordPrint(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, printKey, 'You cannot print this document.'),
          type
        );
        var afterPrint = snapshot(spreadsheet);
        afterPrint.print = printed;
        return okEnvelope(afterPrint);
      }
      return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
    });
  }

  function createImportedSale(spreadsheet, payload, requestId, actor) {
    return createSale(spreadsheet, payload, requestId, actor, {});
  }

  return { canHandle: canHandle, dispatch: dispatch, createImportedSale: createImportedSale };
}
