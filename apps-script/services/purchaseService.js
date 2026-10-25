// Module 9 purchases, supplier payments, and purchase returns.

var PURCHASE_ACTIONS = {
  'purchases.list': true,
  'purchases.get': true,
  'purchases.create': true,
  'purchases.receive': true,
  'purchases.recordPayment': true,
  'purchaseReturns.create': true
};

function createPurchaseService(deps) {
  var sheets = deps.sheetRepository;
  var repository = createPurchaseRepository(sheets);
  var products = createProductRepository(sheets);
  var inventoryRepo = createInventoryRepository(sheets);
  var partyRepo = createPartyRepository(sheets);
  var masters = createMasterRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(PURCHASE_ACTIONS[action]);
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

  function clientId(value) {
    var id = text(value).trim();
    if (!id) return newId('pur');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw appError('VALIDATION_ERROR', 'Id is not valid.');
    return id;
  }

  function newId(prefix) {
    return prefix + '_' + createId().replace(/-/g, '').slice(0, 10);
  }

  function movementId() {
    return 'mv_' + createId().replace(/-/g, '').slice(0, 16);
  }

  function allowNegative(spreadsheet) {
    var rows = sheetRows(spreadsheet, 'Settings');
    for (var i = 0; i < rows.length; i += 1) {
      if (text(rows[i].id).trim() === 'settings') return flagCell(rows[i].allowNegativeStock);
    }
    return false;
  }

  function purchaseConversionQty(product) {
    var qty = Number(product.purchaseConversionQty);
    return Number.isFinite(qty) && qty > 0 ? qty : 1;
  }

  function qtyToBaseUnit(qty, fromUnit, product) {
    var unit = text(fromUnit).trim().toUpperCase();
    var base = text(product.unit).trim().toUpperCase();
    var purchase = text(product.purchaseUnit || product.unit).trim().toUpperCase();
    var amount = Number(qty);
    if (!Number.isFinite(amount)) return null;
    if (unit === base) return round2(amount);
    if (unit === purchase) return round2(amount * purchaseConversionQty(product));
    return null;
  }

  function purchaseQtyToBaseQty(qty, product) {
    var converted = qtyToBaseUnit(qty, product.purchaseUnit || product.unit, product);
    return converted === null ? qty : converted;
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

  function buildLineItems(items) {
    var lines = [];
    (items || []).forEach(function (item) {
      var qty = Number(item.qty);
      var price = Number(item.price);
      if (!Number.isFinite(qty) || !(qty > 0)) return;
      if (!Number.isFinite(price)) price = 0;
      var discount = Number(item.discount);
      if (!Number.isFinite(discount)) discount = 0;
      var line = {
        productId: text(item.productId).trim(),
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
      lines.push(line);
    });
    if (!lines.length) throw appError('VALIDATION_ERROR', 'A purchase needs at least one line.');
    return lines;
  }

  function requireSupplier(spreadsheet, supplierId) {
    var id = text(supplierId).trim();
    var found = null;
    partyRepo.readSuppliers(spreadsheet).forEach(function (row) {
      if (row.id === id) found = row;
    });
    if (!found) throw appError('VALIDATION_ERROR', 'Choose a supplier');
    return found;
  }

  function requireCompanyWarehouse(spreadsheet, warehouseId) {
    masters.ensure(spreadsheet);
    var id = text(warehouseId).trim();
    var found = null;
    masters.readWarehouses(spreadsheet).forEach(function (row) {
      if (row.id === id) found = row;
    });
    if (!found || found.kind !== 'company') throw appError('VALIDATION_ERROR', 'Choose a company warehouse');
    return found;
  }

  function requireProduct(spreadsheet, productId) {
    var found = null;
    products.readProducts(spreadsheet).forEach(function (row) {
      if (row.id === text(productId).trim()) found = row;
    });
    if (!found) throw appError('VALIDATION_ERROR', 'Choose a valid product');
    return found;
  }

  function resolveReceiving(spreadsheet, receivingId) {
    var id = text(receivingId).trim();
    if (!id) return null;
    var receiving = repository.readReceivingLink(spreadsheet, id);
    if (!receiving) throw appError('NOT_FOUND', 'Receiving not found');
    if (receiving.purchaseId) {
      throw appError('VALIDATION_ERROR', receiving.receivingNo || 'Receiving already linked');
    }
    return receiving;
  }

  function statusAfterReceive(paid, total) {
    if (paid >= total) return 'paid';
    if (paid > 0) return 'partial';
    return 'received';
  }

  function postPurchaseMovements(spreadsheet, actor, input) {
    var balances = products.readBalances(spreadsheet);
    var movements = [];
    input.items.forEach(function (item) {
      var product = requireProduct(spreadsheet, item.productId);
      var stockIn = purchaseQtyToBaseQty(item.qty, product);
      var current = qtyOf(balances, product.id, input.warehouseId);
      var balance = round2(current + stockIn);
      movements.push({
        id: movementId(),
        date: input.date,
        reference: input.reference,
        productId: product.id,
        warehouseId: input.warehouseId,
        type: 'purchase',
        stockIn: stockIn,
        stockOut: 0,
        balance: balance,
        user: actor.name,
        notes: ''
      });
      balances = putQty(balances, product.id, input.warehouseId, balance);
    });
    movements.forEach(function (line) { inventoryRepo.appendMovement(spreadsheet, line); });
    products.writeBalances(spreadsheet, balances);
    return movements.length;
  }

  function postReturnMovements(spreadsheet, actor, input) {
    var balances = products.readBalances(spreadsheet);
    var movements = [];
    input.items.forEach(function (item) {
      var product = requireProduct(spreadsheet, item.productId);
      var stockOut = Number(item.qty);
      var current = qtyOf(balances, product.id, input.warehouseId);
      if (!allowNegative(spreadsheet) && stockOut > current) {
        throw appError('VALIDATION_ERROR', 'Not enough stock to return');
      }
      var balance = round2(current - stockOut);
      movements.push({
        id: movementId(),
        date: input.date,
        reference: input.reference,
        productId: product.id,
        warehouseId: input.warehouseId,
        type: 'purchase_return',
        stockIn: 0,
        stockOut: stockOut,
        balance: balance,
        user: actor.name,
        notes: input.reason
      });
      balances = putQty(balances, product.id, input.warehouseId, balance);
    });
    movements.forEach(function (line) { inventoryRepo.appendMovement(spreadsheet, line); });
    products.writeBalances(spreadsheet, balances);
  }

  function snapshot(spreadsheet) {
    inventoryRepo.ensure(spreadsheet);
    var movements = inventoryRepo.readMovements(spreadsheet);
    movements.reverse();
    return {
      purchases: repository.readPurchases(spreadsheet),
      purchaseReturns: repository.readPurchaseReturns(spreadsheet),
      payments: repository.readPayments(spreadsheet),
      inventory: products.readBalances(spreadsheet).map(function (row) {
        return { productId: row.productId, warehouseId: row.warehouseId, qty: round2(row.qty) };
      }),
      stockMovements: movements
    };
  }

  function create(spreadsheet, payload, requestId, actor) {
    var lines = buildLineItems(payload.items);
    requireSupplier(spreadsheet, payload.supplierId);
    requireCompanyWarehouse(spreadsheet, payload.warehouseId);
    var receiving = payload.receivingId ? resolveReceiving(spreadsheet, payload.receivingId) : null;
    var docs = repository.readPurchases(spreadsheet);
    var id = clientId(payload.clientId || payload.id);
    docs.forEach(function (row) {
      if (row.id === id) throw appError('CONFLICT', 'Purchase already exists.');
    });
    var subtotal = round2(lines.reduce(function (sum, line) { return sum + line.total; }, 0));
    var discount = round2(Number(payload.discount) || 0);
    var tax = round2(Number(payload.tax) || 0);
    var shipping = round2(Number(payload.shipping) || 0);
    var total = round2(subtotal - discount + tax + shipping);
    var paidAmount = Math.min(round2(Number(payload.paidAmount) || 0), total);
    var receive = flagCell(payload.receive);
    var purchaseNo = nextDocNo(docs.map(function (row) { return row.purchaseNo; }), 'PUR-', 6);
    var date = text(payload.date).trim() || nowIso();
    var invoiceNumber = text(payload.invoiceNumber).trim() || purchaseNo;
    var status = receive ? statusAfterReceive(paidAmount, total) : 'draft';
    var skipStock = Boolean(receiving);
    var movementCount = 0;
    if (receive && !skipStock) {
      movementCount = postPurchaseMovements(spreadsheet, actor, {
        items: lines,
        warehouseId: text(payload.warehouseId).trim(),
        date: date,
        reference: purchaseNo
      });
    }
    var purchase = {
      id: id,
      purchaseNo: purchaseNo,
      date: date,
      supplierId: text(payload.supplierId).trim(),
      warehouseId: text(payload.warehouseId).trim(),
      invoiceNumber: invoiceNumber,
      items: lines,
      subtotal: subtotal,
      discount: discount,
      tax: tax,
      shipping: shipping,
      total: total,
      paid: paidAmount,
      balance: round2(total - paidAmount),
      status: status,
      notes: text(payload.notes).trim() || undefined,
      receivingId: receiving ? receiving.id : undefined
    };
    repository.writePurchases(spreadsheet, [purchase].concat(docs));
    if (receiving) {
      repository.linkReceivingToPurchase(spreadsheet, receiving.id, purchase.id, purchase.purchaseNo);
    }
    var payments = repository.readPayments(spreadsheet);
    if (paidAmount > 0) {
      var payment = {
        id: newId('pay'),
        paymentNo: nextDocNo(payments.map(function (row) { return row.paymentNo; }), 'PAY-', 6),
        date: date,
        partyType: 'supplier',
        partyId: purchase.supplierId,
        invoiceId: purchase.id,
        invoiceNo: purchase.purchaseNo,
        method: 'bank_transfer',
        amount: paidAmount,
        status: 'completed'
      };
      repository.appendPayment(spreadsheet, payment);
    }
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'purchases.create',
      entityType: 'purchase',
      entityId: purchase.id,
      reference: purchase.purchaseNo,
      before: '',
      after: JSON.stringify({ status: status, movementCount: movementCount, receive: receive }),
      requestId: requestId
    });
    return purchase;
  }

  function receive(spreadsheet, payload, requestId, actor) {
    var id = text(payload.id).trim();
    var docs = repository.readPurchases(spreadsheet);
    var existing = null;
    docs.forEach(function (row) { if (row.id === id) existing = row; });
    if (!existing) throw appError('NOT_FOUND', 'Purchase not found');
    if (existing.status !== 'draft') {
      throw appError('CONFLICT', 'Already received');
    }
    var movementCount = 0;
    if (!existing.receivingId) {
      movementCount = postPurchaseMovements(spreadsheet, actor, {
        items: existing.items,
        warehouseId: existing.warehouseId,
        date: nowIso(),
        reference: existing.purchaseNo
      });
    }
    var nextStatus = statusAfterReceive(existing.paid, existing.total);
    var updated = Object.assign({}, existing, { status: nextStatus });
    repository.writePurchases(spreadsheet, docs.map(function (row) {
      return row.id === id ? updated : row;
    }));
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'purchases.receive',
      entityType: 'purchase',
      entityId: existing.id,
      reference: existing.purchaseNo,
      before: JSON.stringify({ status: 'draft' }),
      after: JSON.stringify({ status: nextStatus, movementCount: movementCount }),
      requestId: requestId
    });
    return updated;
  }

  function recordPayment(spreadsheet, payload, requestId, actor) {
    var amount = Number(payload.amount);
    if (!Number.isFinite(amount) || !(amount > 0)) {
      throw appError('VALIDATION_ERROR', 'Enter an amount');
    }
    var purchaseId = text(payload.invoiceId || payload.purchaseId).trim();
    var docs = repository.readPurchases(spreadsheet);
    var purchase = null;
    docs.forEach(function (row) { if (row.id === purchaseId) purchase = row; });
    if (!purchase || purchase.balance <= 0) {
      throw appError('VALIDATION_ERROR', 'Nothing to pay');
    }
    var applied = Math.min(round2(amount), purchase.balance);
    var paid = round2(purchase.paid + applied);
    var balance = round2(purchase.total - paid);
    var method = text(payload.method).trim() || 'bank_transfer';
    var payment = {
      id: newId('pay'),
      paymentNo: nextDocNo(repository.readPayments(spreadsheet).map(function (row) { return row.paymentNo; }), 'PAY-', 6),
      date: nowIso(),
      partyType: 'supplier',
      partyId: purchase.supplierId,
      invoiceId: purchase.id,
      invoiceNo: purchase.purchaseNo,
      method: method,
      amount: applied,
      status: 'completed'
    };
    repository.appendPayment(spreadsheet, payment);
    var nextStatus = balance <= 0 ? 'paid' : 'partial';
    var updated = Object.assign({}, purchase, { paid: paid, balance: balance, status: nextStatus });
    repository.writePurchases(spreadsheet, docs.map(function (row) {
      return row.id === purchase.id ? updated : row;
    }));
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'purchases.recordPayment',
      entityType: 'purchase',
      entityId: purchase.id,
      reference: payment.paymentNo,
      before: JSON.stringify({ balance: purchase.balance }),
      after: JSON.stringify({ balance: balance, status: nextStatus }),
      requestId: requestId
    });
    return { purchase: updated, payment: payment };
  }

  function createReturn(spreadsheet, payload, requestId, actor) {
    var purchaseId = text(payload.purchaseId).trim();
    var docs = repository.readPurchases(spreadsheet);
    var purchase = null;
    docs.forEach(function (row) { if (row.id === purchaseId) purchase = row; });
    if (!purchase) throw appError('NOT_FOUND', 'Purchase not found');
    var returning = (payload.items || []).filter(function (row) {
      return Number(row.qty) > 0;
    });
    if (!returning.length) throw appError('VALIDATION_ERROR', 'Select quantities to return');
    returning.forEach(function (row) {
      var line = null;
      purchase.items.forEach(function (item) {
        if (item.productId === text(row.productId).trim()) line = item;
      });
      var available = (line ? line.qty : 0) - (line ? line.returnedQty : 0);
      if (Number(row.qty) > available) throw appError('VALIDATION_ERROR', 'Return qty too high');
      var onHand = qtyOf(products.readBalances(spreadsheet), text(row.productId).trim(), purchase.warehouseId);
      if (!allowNegative(spreadsheet) && Number(row.qty) > onHand) {
        throw appError('VALIDATION_ERROR', 'Not enough stock to return');
      }
    });
    var returnNo = nextDocNo(repository.readPurchaseReturns(spreadsheet).map(function (row) { return row.returnNo; }), 'PR-', 6);
    var date = nowIso();
    var returnItems = returning.map(function (row) {
      var productId = text(row.productId).trim();
      var line = null;
      purchase.items.forEach(function (item) {
        if (item.productId === productId) line = item;
      });
      return { productId: productId, qty: Number(row.qty), price: line ? line.price : 0 };
    });
    postReturnMovements(spreadsheet, actor, {
      items: returnItems,
      warehouseId: purchase.warehouseId,
      date: date,
      reference: returnNo,
      reason: text(payload.reason).trim()
    });
    var total = round2(returnItems.reduce(function (sum, item) { return sum + item.qty * item.price; }, 0));
    var nextPurchase = Object.assign({}, purchase, {
      items: purchase.items.map(function (line) {
        var ret = null;
        returning.forEach(function (row) {
          if (text(row.productId).trim() === line.productId) ret = row;
        });
        if (!ret) return line;
        return Object.assign({}, line, { returnedQty: round2(line.returnedQty + Number(ret.qty)) });
      })
    });
    repository.writePurchases(spreadsheet, docs.map(function (row) {
      return row.id === purchase.id ? nextPurchase : row;
    }));
    var doc = {
      id: newId('pret'),
      returnNo: returnNo,
      date: date,
      purchaseId: purchase.id,
      warehouseId: purchase.warehouseId,
      items: returnItems,
      reason: text(payload.reason).trim(),
      total: total
    };
    var returns = repository.readPurchaseReturns(spreadsheet);
    repository.writePurchaseReturns(spreadsheet, [doc].concat(returns));
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'purchaseReturns.create',
      entityType: 'purchase_return',
      entityId: doc.id,
      reference: returnNo,
      before: '',
      after: JSON.stringify({ purchaseId: purchase.id, total: total }),
      requestId: requestId
    });
    return doc;
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'purchases.list') {
        requirePermission(spreadsheet, payload.actorUserId, 'purchases.view', 'You do not have permission to view purchases.');
        repository.ensure(spreadsheet);
        return okEnvelope(snapshot(spreadsheet));
      }
      if (action === 'purchases.get') {
        requirePermission(spreadsheet, payload.actorUserId, 'purchases.view', 'You do not have permission to view purchases.');
        repository.ensure(spreadsheet);
        var id = text(payload.id).trim();
        var purchase = null;
        repository.readPurchases(spreadsheet).forEach(function (row) {
          if (row.id === id) purchase = row;
        });
        if (!purchase) throw appError('NOT_FOUND', 'Purchase not found');
        var state = snapshot(spreadsheet);
        state.purchase = purchase;
        return okEnvelope(state);
      }
      if (action === 'purchases.create') {
        if (flagCell(payload.receive)) requireKey(request);
        var created = create(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'purchases.create', 'You cannot create purchases.')
        );
        var afterCreate = snapshot(spreadsheet);
        afterCreate.purchase = created;
        return okEnvelope(afterCreate);
      }
      if (action === 'purchases.receive') {
        requireKey(request);
        var received = receive(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'purchases.create', 'You cannot receive purchases.')
        );
        var afterReceive = snapshot(spreadsheet);
        afterReceive.purchase = received;
        return okEnvelope(afterReceive);
      }
      if (action === 'purchases.recordPayment') {
        requireKey(request);
        var paid = recordPayment(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'purchases.create', 'You cannot record supplier payments.')
        );
        var afterPay = snapshot(spreadsheet);
        afterPay.purchase = paid.purchase;
        afterPay.payment = paid.payment;
        return okEnvelope(afterPay);
      }
      if (action === 'purchaseReturns.create') {
        requireKey(request);
        var returned = createReturn(
          spreadsheet,
          payload,
          requestId,
          requirePermission(spreadsheet, payload.actorUserId, 'purchases.create', 'You cannot create purchase returns.')
        );
        var afterReturn = snapshot(spreadsheet);
        afterReturn.purchaseReturn = returned;
        return okEnvelope(afterReturn);
      }
      return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
