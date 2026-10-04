// Module 2. The locked frontend reads warehouses and creates or renames categories.
// There is no warehouse editor and neither type has a status field.
// Agent warehouses stay with agents (later module). Map actions stay warehouse.* (later module).

var MASTER_ACTIONS = {
  'masters.get': true,
  'masters.bootstrap': true,
  'warehouses.list': true,
  'warehouses.get': true,
  'categories.list': true,
  'categories.get': true,
  'categories.create': true,
  'categories.rename': true
};

function createMasterService(deps) {
  var sheets = deps.sheetRepository;
  var repository = createMasterRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(MASTER_ACTIONS[action]);
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function locked(fn) {
    return withScriptLock(function () {
      return fn(sheets.openSpreadsheet());
    });
  }

  function clientId(value) {
    var id = text(value).trim();
    if (!id) return createId();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw appError('VALIDATION_ERROR', 'Id is not valid.');
    return id;
  }

  function load(spreadsheet) {
    repository.ensure(spreadsheet);
    var warehouses = repository.readWarehouses(spreadsheet);
    var categories = repository.readCategories(spreadsheet);
    return {
      empty: warehouses.length === 0 && categories.length === 0,
      warehouses: warehouses,
      categories: categories
    };
  }

  function requireActor(spreadsheet, actorUserId, message) {
    var id = text(actorUserId).trim();
    if (!id) throw appError('FORBIDDEN', message);
    var sheet = sheets.getSheet(spreadsheet, 'Users');
    if (!sheet) throw appError('FORBIDDEN', message);
    var match = null;
    sheets.readObjects(sheet).forEach(function (row) {
      if (text(row.id).trim() === id) match = row;
    });
    if (!match || text(match.status).trim() !== 'active') throw appError('FORBIDDEN', message);
    return { id: text(match.id).trim(), name: text(match.name).trim() };
  }

  function normalizeWarehouse(item) {
    if (!item) throw appError('VALIDATION_ERROR', 'Warehouse bootstrap is incomplete.');
    var name = text(item.name).trim();
    var code = text(item.code).trim();
    var kind = text(item.kind).trim();
    if (!name || !code) throw appError('VALIDATION_ERROR', 'Warehouse bootstrap is incomplete.');
    if (kind !== 'company' && kind !== 'agent') throw appError('VALIDATION_ERROR', 'Warehouse kind is not valid.');
    return { id: clientId(item.id), name: name, code: code, kind: kind };
  }

  function normalizeCategory(item) {
    if (!item) throw appError('VALIDATION_ERROR', 'Category name is required');
    var name = text(item.name).trim();
    if (!name) throw appError('VALIDATION_ERROR', 'Category name is required');
    return { id: clientId(item.id), name: name };
  }

  function assertUniqueWarehouses(warehouses) {
    var ids = {};
    var codes = {};
    var company = false;
    warehouses.forEach(function (warehouse) {
      var codeKey = warehouse.code.toLowerCase();
      if (ids[warehouse.id] || codes[codeKey]) throw appError('VALIDATION_ERROR', 'Warehouse code already exists');
      ids[warehouse.id] = true;
      codes[codeKey] = true;
      if (warehouse.kind === 'company') company = true;
    });
    if (!company) throw appError('VALIDATION_ERROR', 'Warehouse bootstrap is incomplete.');
  }

  function assertUniqueCategories(categories) {
    var ids = {};
    var names = {};
    categories.forEach(function (category) {
      var nameKey = category.name.toLowerCase();
      if (ids[category.id] || names[nameKey]) throw appError('VALIDATION_ERROR', 'Category name already exists');
      ids[category.id] = true;
      names[nameKey] = true;
    });
  }

  function systemAudit(spreadsheet, entry) {
    sheets.ensureSheet(spreadsheet, 'AuditLogs', typeof AUDIT_HEADERS !== 'undefined' ? AUDIT_HEADERS : [
      'auditId', 'timestamp', 'userId', 'action', 'entityType', 'entityId', 'reference', 'before', 'after', 'requestId'
    ]);
    audit.append(entry);
  }

  function bootstrap(spreadsheet, payload, requestId) {
    var current = load(spreadsheet);
    var wrote = false;
    if (!current.warehouses.length) {
      if (!payload || !Array.isArray(payload.warehouses) || !payload.warehouses.length) {
        throw appError('VALIDATION_ERROR', 'Warehouse bootstrap is incomplete.');
      }
      var warehouses = payload.warehouses.map(normalizeWarehouse);
      assertUniqueWarehouses(warehouses);
      repository.writeWarehouses(spreadsheet, warehouses);
      wrote = true;
    }
    if (!current.categories.length) {
      if (!payload || !Array.isArray(payload.categories)) {
        throw appError('VALIDATION_ERROR', 'Category bootstrap is incomplete.');
      }
      var categories = payload.categories.map(normalizeCategory);
      assertUniqueCategories(categories);
      repository.writeCategories(spreadsheet, categories);
      wrote = true;
    }
    if (!wrote) throw appError('CONFLICT', 'Masters are already initialized.');
    var next = load(spreadsheet);
    systemAudit(spreadsheet, {
      userId: '',
      action: 'masters.bootstrap',
      entityType: 'warehouse',
      entityId: 'warehouses',
      reference: '',
      before: '',
      after: String(next.warehouses.length) + ' warehouses, ' + String(next.categories.length) + ' categories',
      requestId: requestId
    });
    return next;
  }

  function createCategory(spreadsheet, payload, requestId) {
    var actor = requireActor(spreadsheet, payload.actorUserId, 'You cannot add categories.');
    var current = load(spreadsheet);
    var category = normalizeCategory(payload);
    if (current.categories.some(function (item) { return item.id === category.id; })) {
      throw appError('CONFLICT', 'Category already exists.');
    }
    if (current.categories.some(function (item) { return item.name.toLowerCase() === category.name.toLowerCase(); })) {
      throw appError('VALIDATION_ERROR', 'Category name already exists');
    }
    var categories = current.categories.concat([category]);
    repository.writeCategories(spreadsheet, categories);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'categories.create',
      entityType: 'category',
      entityId: category.id,
      reference: category.name,
      before: '',
      after: category.name,
      requestId: requestId
    });
    return load(spreadsheet);
  }

  function renameCategory(spreadsheet, payload, requestId) {
    var actor = requireActor(spreadsheet, payload.actorUserId, 'You cannot rename categories.');
    var current = load(spreadsheet);
    var id = text(payload.id).trim();
    var existing = null;
    current.categories.forEach(function (item) {
      if (item.id === id) existing = item;
    });
    if (!existing) throw appError('NOT_FOUND', 'Category was not found.');
    var name = text(payload.name).trim();
    if (!name) throw appError('VALIDATION_ERROR', 'Category name is required');
    if (current.categories.some(function (item) {
      return item.id !== id && item.name.toLowerCase() === name.toLowerCase();
    })) {
      throw appError('VALIDATION_ERROR', 'Category name already exists');
    }
    var categories = current.categories.map(function (item) {
      return item.id === id ? { id: item.id, name: name } : item;
    });
    repository.writeCategories(spreadsheet, categories);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'categories.rename',
      entityType: 'category',
      entityId: id,
      reference: name,
      before: existing.name,
      after: name,
      requestId: requestId
    });
    return load(spreadsheet);
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'masters.get') return okEnvelope(load(spreadsheet));
      if (action === 'warehouses.list') return okEnvelope({ warehouses: load(spreadsheet).warehouses });
      if (action === 'categories.list') return okEnvelope({ categories: load(spreadsheet).categories });
      if (action === 'warehouses.get') {
        var warehouseId = text(payload.id).trim();
        var warehouse = null;
        load(spreadsheet).warehouses.forEach(function (item) {
          if (item.id === warehouseId) warehouse = item;
        });
        if (!warehouse) return errorEnvelope('NOT_FOUND', 'Warehouse was not found.', { requestId: requestId });
        return okEnvelope({ warehouse: warehouse });
      }
      if (action === 'categories.get') {
        var categoryId = text(payload.id).trim();
        var category = null;
        load(spreadsheet).categories.forEach(function (item) {
          if (item.id === categoryId) category = item;
        });
        if (!category) return errorEnvelope('NOT_FOUND', 'Category was not found.', { requestId: requestId });
        return okEnvelope({ category: category });
      }
      var result;
      if (action === 'masters.bootstrap') result = bootstrap(spreadsheet, payload, requestId);
      else if (action === 'categories.create') result = createCategory(spreadsheet, payload, requestId);
      else if (action === 'categories.rename') result = renameCategory(spreadsheet, payload, requestId);
      else return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
      return okEnvelope(result);
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
