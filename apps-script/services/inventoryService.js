// Module 5 inventory ledger.
// InventoryBalances is the current Product + Warehouse projection.
// StockMovements is the append-only history. A posted line is not edited.
// Writes: inventory.adjust, inventory.usage, inventory.transfer, inventory.count.
// Those match the locked stock screens. Opening balance, purchases, sales,
// production, warehouse map, and agent stock transfer stay later modules.
// Product cost and costingMethod are unchanged. No FIFO engine.

var INVENTORY_ACTIONS = {
  'inventory.get': true,
  'inventory.adjust': true,
  'inventory.usage': true,
  'inventory.transfer': true,
  'inventory.count': true
};

function createInventoryService(deps) {
  var sheets = deps.sheetRepository;
  var repository = createInventoryRepository(sheets);
  var products = createProductRepository(sheets);
  var masters = createMasterRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(INVENTORY_ACTIONS[action]);
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

  function allowNegative(spreadsheet) {
    var rows = sheetRows(spreadsheet, 'Settings');
    for (var i = 0; i < rows.length; i += 1) {
      if (text(rows[i].id).trim() === 'settings') return flagCell(rows[i].allowNegativeStock);
    }
    return false;
  }

  function productById(spreadsheet, productId) {
    var id = text(productId).trim();
    var match = null;
    products.readProducts(spreadsheet).forEach(function (row) {
      if (row.id === id) match = row;
    });
    return match;
  }

  function requireProduct(spreadsheet, productId) {
    var product = productById(spreadsheet, productId);
    if (!product) throw appError('NOT_FOUND', 'Product was not found.');
    return product;
  }

  function warehouseById(spreadsheet, warehouseId) {
    masters.ensure(spreadsheet);
    var id = text(warehouseId).trim();
    var match = null;
    masters.readWarehouses(spreadsheet).forEach(function (row) {
      if (row.id === id) match = row;
    });
    if (!match) throw appError('NOT_FOUND', 'Warehouse was not found.');
    if (match.kind !== 'company') throw appError('VALIDATION_ERROR', 'Choose a company warehouse');
    return match;
  }

  function positiveQty(value) {
    var qty = round2(value);
    if (!Number.isFinite(qty) || qty <= 0) throw appError('VALIDATION_ERROR', 'Enter a quantity');
    return qty;
  }

  function qtyOf(balances, productId, warehouseId) {
    var current = 0;
    balances.forEach(function (row) {
      if (row.productId === productId && row.warehouseId === warehouseId) current = round2(row.qty);
    });
    return current;
  }

  function putQty(balances, productId, warehouseId, qty) {
    var next = balances.map(function (row) {
      return { productId: row.productId, warehouseId: row.warehouseId, qty: round2(row.qty) };
    });
    var found = false;
    next.forEach(function (row) {
      if (row.productId === productId && row.warehouseId === warehouseId) {
        row.qty = qty;
        found = true;
      }
    });
    if (!found) next.push({ productId: productId, warehouseId: warehouseId, qty: qty });
    return next;
  }

  function nextReference(movements, prefix) {
    var max = 0;
    movements.forEach(function (row) {
      if (text(row.reference).indexOf(prefix) !== 0) return;
      var match = text(row.reference).match(/(\d+)\s*$/);
      if (match) max = Math.max(max, Number(match[1]));
    });
    return prefix + String(max + 1).padStart(4, '0');
  }

  function movementId() {
    return 'mv_' + createId().replace(/-/g, '').slice(0, 16);
  }

  function buildLine(input) {
    var balance = round2(input.current + input.stockIn - input.stockOut);
    return {
      id: movementId(),
      date: input.date,
      reference: input.reference,
      productId: input.productId,
      warehouseId: input.warehouseId,
      type: input.type,
      stockIn: input.stockIn,
      stockOut: input.stockOut,
      balance: balance,
      user: input.user,
      notes: input.notes || ''
    };
  }

  function commit(spreadsheet, balances, lines) {
    lines.forEach(function (line) { repository.appendMovement(spreadsheet, line); });
    products.writeBalances(spreadsheet, balances);
  }

  function snapshot(spreadsheet) {
    var movements = repository.readMovements(spreadsheet);
    movements.reverse();
    return {
      inventory: products.readBalances(spreadsheet).map(function (row) {
        return { productId: row.productId, warehouseId: row.warehouseId, qty: round2(row.qty) };
      }),
      stockMovements: movements
    };
  }

  function systemAudit(spreadsheet, entry) {
    sheets.ensureSheet(spreadsheet, 'AuditLogs', typeof AUDIT_HEADERS !== 'undefined' ? AUDIT_HEADERS : [
      'auditId', 'timestamp', 'userId', 'action', 'entityType', 'entityId', 'reference', 'before', 'after', 'requestId'
    ]);
    audit.append(entry);
  }

  function guardShortage(spreadsheet, current, stockOut) {
    if (allowNegative(spreadsheet)) return;
    if (stockOut > current) throw appError('VALIDATION_ERROR', 'Not enough stock. Current stock is ' + current + '.');
  }

  function adjust(spreadsheet, payload, requestId, actor) {
    var warehouse = warehouseById(spreadsheet, payload.warehouseId);
    var product = requireProduct(spreadsheet, payload.productId);
    var type = text(payload.type).trim();
    if (type !== 'increase' && type !== 'decrease') throw appError('VALIDATION_ERROR', 'Adjustment type is not valid.');
    var qty = positiveQty(payload.qty);
    var balances = products.readBalances(spreadsheet);
    var current = qtyOf(balances, product.id, warehouse.id);
    var stockIn = type === 'increase' ? qty : 0;
    var stockOut = type === 'decrease' ? qty : 0;
    if (type === 'decrease') guardShortage(spreadsheet, current, stockOut);
    var reason = text(payload.reason).trim();
    var extra = text(payload.notes).trim();
    var notes = reason + (extra ? ' — ' + extra : '');
    var reference = nextReference(repository.readMovements(spreadsheet), 'ADJ-');
    var line = buildLine({
      current: current,
      date: nowIso(),
      reference: reference,
      productId: product.id,
      warehouseId: warehouse.id,
      type: 'adjustment',
      stockIn: stockIn,
      stockOut: stockOut,
      user: actor.name,
      notes: notes
    });
    commit(spreadsheet, putQty(balances, product.id, warehouse.id, line.balance), [line]);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'inventory.adjust',
      entityType: 'inventory',
      entityId: product.id,
      reference: reference,
      before: String(current),
      after: String(line.balance),
      requestId: requestId
    });
    var state = snapshot(spreadsheet);
    state.reference = reference;
    return state;
  }

  function usage(spreadsheet, payload, requestId, actor) {
    var warehouse = warehouseById(spreadsheet, payload.warehouseId);
    var product = requireProduct(spreadsheet, payload.productId);
    if (product.status !== 'active') throw appError('VALIDATION_ERROR', 'Choose a product');
    var qty = positiveQty(payload.qty);
    var balances = products.readBalances(spreadsheet);
    var current = qtyOf(balances, product.id, warehouse.id);
    guardShortage(spreadsheet, current, qty);
    var dateText = text(payload.date).trim();
    var date = nowIso();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) date = dateText + 'T08:00:00.000+08:00';
    else if (dateText && !Number.isNaN(Date.parse(dateText))) date = dateText;
    var noteParts = [text(payload.reason).trim(), text(payload.notes).trim()].filter(Boolean);
    var reference = nextReference(repository.readMovements(spreadsheet), 'USE-');
    var line = buildLine({
      current: current,
      date: date,
      reference: reference,
      productId: product.id,
      warehouseId: warehouse.id,
      type: 'stock_usage',
      stockIn: 0,
      stockOut: qty,
      user: actor.name,
      notes: noteParts.join(' — ')
    });
    commit(spreadsheet, putQty(balances, product.id, warehouse.id, line.balance), [line]);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'inventory.usage',
      entityType: 'inventory',
      entityId: product.id,
      reference: reference,
      before: String(current),
      after: String(line.balance),
      requestId: requestId
    });
    var state = snapshot(spreadsheet);
    state.reference = reference;
    return state;
  }

  function transfer(spreadsheet, payload, requestId, actor) {
    var from = warehouseById(spreadsheet, payload.fromWarehouseId);
    var to = warehouseById(spreadsheet, payload.toWarehouseId);
    if (from.id === to.id) throw appError('VALIDATION_ERROR', 'Choose different warehouses');
    var product = requireProduct(spreadsheet, payload.productId);
    var qty = positiveQty(payload.qty);
    var balances = products.readBalances(spreadsheet);
    var sourceQty = qtyOf(balances, product.id, from.id);
    var destQty = qtyOf(balances, product.id, to.id);
    if (!allowNegative(spreadsheet) && qty > sourceQty) {
      throw appError('VALIDATION_ERROR', 'Not enough stock at source. Available: ' + sourceQty + '.');
    }
    var note = text(payload.notes).trim();
    var reference = nextReference(repository.readMovements(spreadsheet), 'TRF-');
    var date = nowIso();
    var outLine = buildLine({
      current: sourceQty,
      date: date,
      reference: reference,
      productId: product.id,
      warehouseId: from.id,
      type: 'transfer_out',
      stockIn: 0,
      stockOut: qty,
      user: actor.name,
      notes: [note, 'To ' + to.name].filter(Boolean).join(' — ')
    });
    var inLine = buildLine({
      current: destQty,
      date: date,
      reference: reference,
      productId: product.id,
      warehouseId: to.id,
      type: 'transfer_in',
      stockIn: qty,
      stockOut: 0,
      user: actor.name,
      notes: [note, 'From ' + from.name].filter(Boolean).join(' — ')
    });
    var next = putQty(balances, product.id, from.id, outLine.balance);
    next = putQty(next, product.id, to.id, inLine.balance);
    commit(spreadsheet, next, [outLine, inLine]);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'inventory.transfer',
      entityType: 'inventory',
      entityId: product.id,
      reference: reference,
      before: from.id + ':' + sourceQty + ',' + to.id + ':' + destQty,
      after: from.id + ':' + outLine.balance + ',' + to.id + ':' + inLine.balance,
      requestId: requestId
    });
    var state = snapshot(spreadsheet);
    state.reference = reference;
    return state;
  }

  function count(spreadsheet, payload, requestId, actor) {
    var warehouse = warehouseById(spreadsheet, payload.warehouseId);
    var counts = payload.counts;
    if (!Array.isArray(counts)) throw appError('VALIDATION_ERROR', 'Enter a quantity');
    var balances = products.readBalances(spreadsheet);
    var running = balances.map(function (row) {
      return { productId: row.productId, warehouseId: row.warehouseId, qty: round2(row.qty) };
    });
    var plan = [];
    counts.forEach(function (row) {
      var product = requireProduct(spreadsheet, row && row.productId);
      var counted = round2(row.countedQty);
      if (!Number.isFinite(counted) || counted < 0) throw appError('VALIDATION_ERROR', 'Enter a quantity');
      var system = qtyOf(running, product.id, warehouse.id);
      var diff = round2(counted - system);
      if (diff === 0) return;
      var stockIn = diff > 0 ? diff : 0;
      var stockOut = diff < 0 ? round2(Math.abs(diff)) : 0;
      if (stockOut) guardShortage(spreadsheet, system, stockOut);
      plan.push({ product: product, system: system, stockIn: stockIn, stockOut: stockOut });
      running = putQty(running, product.id, warehouse.id, round2(system + stockIn - stockOut));
    });
    if (!plan.length) {
      var unchanged = snapshot(spreadsheet);
      unchanged.changes = 0;
      return unchanged;
    }
    var reference = nextReference(repository.readMovements(spreadsheet), 'CNT-');
    var date = nowIso();
    var lines = plan.map(function (row) {
      return buildLine({
        current: row.system,
        date: date,
        reference: reference,
        productId: row.product.id,
        warehouseId: warehouse.id,
        type: 'stock_count',
        stockIn: row.stockIn,
        stockOut: row.stockOut,
        user: actor.name,
        notes: 'Physical count'
      });
    });
    commit(spreadsheet, running, lines);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'inventory.count',
      entityType: 'inventory',
      entityId: warehouse.id,
      reference: reference,
      before: String(plan.length),
      after: reference,
      requestId: requestId
    });
    var state = snapshot(spreadsheet);
    state.reference = reference;
    state.changes = plan.length;
    return state;
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'inventory.get') return okEnvelope(snapshot(spreadsheet));
      requireKey(request);
      var result;
      if (action === 'inventory.adjust') {
        result = adjust(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'inventory.adjust', 'You cannot adjust stock.'));
      } else if (action === 'inventory.usage') {
        result = usage(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'inventory.usage', 'You cannot record stock usage.'));
      } else if (action === 'inventory.transfer') {
        result = transfer(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'inventory.transfer', 'You cannot transfer stock.'));
      } else if (action === 'inventory.count') {
        result = count(spreadsheet, payload, requestId, requirePermission(spreadsheet, payload.actorUserId, 'inventory.count', 'You cannot complete a stock count.'));
      } else {
        return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
      }
      return okEnvelope(result);
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
