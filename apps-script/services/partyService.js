// Module 4. Customers, suppliers, and agents match the locked screens.
// Customer and supplier screens have no permission key and no edit or
// status control, so any active user may create them and status stays active.
// Agent writes require agent.manage. Agent reads require agent.view,
// agent.manage, owner access, or the linked user.
// Custom wholesale prices require customer.pricing.manage.
// Agent prices stay on Products (products.saveAgentPrices).
// Vehicles, agent stock, agent sales, and withdrawals stay with later modules.

var PARTY_ACTIONS = {
  'parties.get': true,
  'parties.bootstrap': true,
  'customers.list': true,
  'customers.get': true,
  'customers.create': true,
  'customers.saveWholesalePrice': true,
  'customers.deactivateWholesalePrice': true,
  'suppliers.list': true,
  'suppliers.get': true,
  'suppliers.create': true,
  'agents.list': true,
  'agents.get': true,
  'agents.create': true,
  'agents.update': true,
  'agents.setStatus': true
};

function createPartyService(deps) {
  var sheets = deps.sheetRepository;
  var repository = createPartyRepository(sheets);
  var masters = createMasterRepository(sheets);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(PARTY_ACTIONS[action]);
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function locked(fn) {
    return withScriptLock(function () {
      return fn(sheets.openSpreadsheet());
    });
  }

  function round2(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function clientId(value) {
    var id = text(value).trim();
    if (!id) return createId();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw appError('VALIDATION_ERROR', 'Id is not valid.');
    return id;
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

  function optionalActor(spreadsheet, actorUserId) {
    var id = text(actorUserId).trim();
    if (!id) return null;
    try {
      return loadActor(spreadsheet, id, 'You cannot view agents.');
    } catch (error) {
      return null;
    }
  }

  function canViewAgents(spreadsheet, actor) {
    if (!actor) return false;
    return actorMay(spreadsheet, actor, 'agent.view') || actorMay(spreadsheet, actor, 'agent.manage');
  }

  function visibleAgents(spreadsheet, actor, agents) {
    if (canViewAgents(spreadsheet, actor)) return agents;
    if (!actor) return [];
    return agents.filter(function (agent) { return agent.userId === actor.id; });
  }

  function findById(rows, id) {
    var match = null;
    rows.forEach(function (row) {
      if (row.id === id) match = row;
    });
    return match;
  }

  function systemAudit(spreadsheet, entry) {
    sheets.ensureSheet(spreadsheet, 'AuditLogs', typeof AUDIT_HEADERS !== 'undefined' ? AUDIT_HEADERS : [
      'auditId', 'timestamp', 'userId', 'action', 'entityType', 'entityId', 'reference', 'before', 'after', 'requestId'
    ]);
    audit.append(entry);
  }

  function warehouses(spreadsheet) {
    masters.ensure(spreadsheet);
    return masters.readWarehouses(spreadsheet);
  }

  function products(spreadsheet) {
    return sheetRows(spreadsheet, 'Products').map(function (row) {
      var sellable = text(row.sellable).trim();
      return {
        id: text(row.id).trim(),
        name: text(row.name).trim(),
        status: text(row.status).trim() === 'inactive' ? 'inactive' : 'active',
        sellable: sellable === '' ? true : flagCell(row.sellable)
      };
    }).filter(function (row) { return row.id; });
  }

  function users(spreadsheet) {
    return sheetRows(spreadsheet, 'Users').map(function (row) {
      return { id: text(row.id).trim(), name: text(row.name).trim() };
    }).filter(function (row) { return row.id; });
  }

  function load(spreadsheet) {
    return {
      customers: repository.readCustomers(spreadsheet),
      suppliers: repository.readSuppliers(spreadsheet),
      agents: repository.readAgents(spreadsheet),
      customerWholesalePrices: repository.readWholesalePrices(spreadsheet)
    };
  }

  function snapshot(spreadsheet, actor) {
    var state = load(spreadsheet);
    return {
      customers: state.customers,
      suppliers: state.suppliers,
      agents: visibleAgents(spreadsheet, actor, state.agents),
      customerWholesalePrices: state.customerWholesalePrices
    };
  }

  function partyStatus(value) {
    var status = text(value).trim();
    if (!status) return 'active';
    if (status !== 'active' && status !== 'inactive') throw appError('VALIDATION_ERROR', 'Party status is not valid.');
    return status;
  }

  function normalizeCustomer(item, preserveStatus) {
    if (!item) throw appError('VALIDATION_ERROR', 'Customer name is required');
    var name = text(item.name).trim();
    if (!name) throw appError('VALIDATION_ERROR', 'Customer name is required');
    return {
      id: clientId(item.id),
      name: name,
      phone: text(item.phone).trim(),
      email: text(item.email).trim(),
      address: text(item.address).trim(),
      status: preserveStatus ? partyStatus(item.status) : 'active'
    };
  }

  function normalizeSupplier(item, preserveStatus) {
    if (!item) throw appError('VALIDATION_ERROR', 'Supplier name is required');
    var name = text(item.name).trim();
    if (!name) throw appError('VALIDATION_ERROR', 'Supplier name is required');
    return {
      id: clientId(item.id),
      name: name,
      contact: text(item.contact).trim(),
      phone: text(item.phone).trim(),
      email: text(item.email).trim(),
      status: preserveStatus ? partyStatus(item.status) : 'active'
    };
  }

  function agentWarehouseSlug(code) {
    var stripped = text(code).trim().toLowerCase().replace(/^ag[-_]?/, '');
    stripped = stripped.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return stripped || 'agent';
  }

  function nextAgentWarehouseId(rows, code) {
    var base = 'wh-agent-' + agentWarehouseSlug(code);
    if (!rows.some(function (row) { return row.id === base; })) return base;
    var n = 2;
    while (rows.some(function (row) { return row.id === base + '-' + n; })) n += 1;
    return base + '-' + n;
  }

  function agentLinkedWarehouseName(agentName) {
    var name = text(agentName).trim();
    if (!name) return 'Agent';
    if (/^agent\s+/i.test(name)) return name;
    return 'Agent ' + name;
  }

  function normalizeAgent(item, rows, agents, current) {
    var name = text(item && item.name).trim();
    var code = text(item && item.code).trim().toUpperCase();
    if (!name) throw appError('VALIDATION_ERROR', 'Agent name is required');
    if (!code) throw appError('VALIDATION_ERROR', 'Agent code is required');
    var id = current ? current.id : clientId(item.id);
    if (agents.some(function (agent) {
      return agent.id !== id && agent.code.trim().toLowerCase() === code.toLowerCase();
    })) {
      throw appError('VALIDATION_ERROR', 'Agent code already exists');
    }
    var userId = text(item.userId).trim();
    if (userId) {
      var known = null;
      rows.userRows.forEach(function (row) {
        if (row.id === userId) known = row;
      });
      if (!known) throw appError('VALIDATION_ERROR', 'User not found');
      if (agents.some(function (agent) { return agent.id !== id && agent.userId === userId; })) {
        throw appError('VALIDATION_ERROR', 'User already linked to an agent');
      }
    }
    var warehouseId = current ? current.warehouseId : text(item.warehouseId).trim();
    if (!current) {
      if (rows.warehouses.some(function (warehouse) { return warehouse.code.trim().toLowerCase() === code.toLowerCase(); })) {
        throw appError('VALIDATION_ERROR', 'Warehouse code already exists');
      }
      if (!warehouseId) warehouseId = nextAgentWarehouseId(rows.warehouses, code);
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(warehouseId)) throw appError('VALIDATION_ERROR', 'Id is not valid.');
      if (
        rows.warehouses.some(function (warehouse) { return warehouse.id === warehouseId; }) ||
        agents.some(function (agent) { return agent.warehouseId === warehouseId; })
      ) {
        throw appError('VALIDATION_ERROR', 'Linked warehouse already exists');
      }
    }
    var stamp = nowIso();
    return {
      id: id,
      name: name,
      code: code,
      warehouseId: warehouseId,
      userId: userId,
      bankName: text(item.bankName).trim(),
      accountHolder: text(item.accountHolder).trim(),
      bankAccount: text(item.bankAccount).trim(),
      status: current ? current.status : 'active',
      createdAt: current ? current.createdAt : stamp,
      updatedAt: stamp,
      warehouseName: agentLinkedWarehouseName(name)
    };
  }

  function referenceRows(spreadsheet) {
    return {
      warehouses: warehouses(spreadsheet),
      userRows: users(spreadsheet)
    };
  }

  function storedAgent(agent) {
    var row = {
      id: agent.id,
      name: agent.name,
      code: agent.code,
      warehouseId: agent.warehouseId,
      bankName: agent.bankName,
      accountHolder: agent.accountHolder,
      bankAccount: agent.bankAccount,
      status: agent.status,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt
    };
    if (agent.userId) row.userId = agent.userId;
    return row;
  }

  function writeAgentWarehouse(spreadsheet, warehouseId, name, code) {
    var rows = warehouses(spreadsheet);
    var found = false;
    var next = rows.map(function (warehouse) {
      if (warehouse.id !== warehouseId) return warehouse;
      found = true;
      return { id: warehouse.id, name: name, code: warehouse.code, kind: warehouse.kind };
    });
    if (!found) {
      next.push({ id: warehouseId, name: name, code: code, kind: 'agent' });
    }
    masters.writeWarehouses(spreadsheet, next);
  }

  function createCustomer(spreadsheet, payload, requestId) {
    var actor = loadActor(spreadsheet, payload.actorUserId, 'You cannot add customers.');
    var current = repository.readCustomers(spreadsheet);
    var customer = normalizeCustomer(payload, false);
    if (current.some(function (item) { return item.id === customer.id; })) {
      throw appError('CONFLICT', 'Customer already exists.');
    }
    repository.writeCustomers(spreadsheet, [customer].concat(current));
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'customers.create',
      entityType: 'customer',
      entityId: customer.id,
      reference: customer.name,
      before: '',
      after: customer.name,
      requestId: requestId
    });
    return { customers: repository.readCustomers(spreadsheet) };
  }

  function createSupplier(spreadsheet, payload, requestId) {
    var actor = loadActor(spreadsheet, payload.actorUserId, 'You cannot add suppliers.');
    var current = repository.readSuppliers(spreadsheet);
    var supplier = normalizeSupplier(payload, false);
    if (current.some(function (item) { return item.id === supplier.id; })) {
      throw appError('CONFLICT', 'Supplier already exists.');
    }
    repository.writeSuppliers(spreadsheet, [supplier].concat(current));
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'suppliers.create',
      entityType: 'supplier',
      entityId: supplier.id,
      reference: supplier.name,
      before: '',
      after: supplier.name,
      requestId: requestId
    });
    return { suppliers: repository.readSuppliers(spreadsheet) };
  }

  function createAgent(spreadsheet, payload, requestId) {
    var actor = loadActor(spreadsheet, payload.actorUserId, 'You cannot manage agents.');
    if (!actorMay(spreadsheet, actor, 'agent.manage')) throw appError('FORBIDDEN', 'You cannot manage agents.');
    var agents = repository.readAgents(spreadsheet);
    var agent = normalizeAgent(payload, referenceRows(spreadsheet), agents, null);
    if (agents.some(function (item) { return item.id === agent.id; })) {
      throw appError('CONFLICT', 'Agent already exists.');
    }
    writeAgentWarehouse(spreadsheet, agent.warehouseId, agent.warehouseName, agent.code);
    repository.writeAgents(spreadsheet, [storedAgent(agent)].concat(agents));
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'agents.create',
      entityType: 'agent',
      entityId: agent.id,
      reference: agent.code,
      before: '',
      after: agent.name + ' · ' + agent.code,
      requestId: requestId
    });
    return {
      agents: visibleAgents(spreadsheet, actor, repository.readAgents(spreadsheet)),
      warehouses: warehouses(spreadsheet)
    };
  }

  function updateAgent(spreadsheet, payload, requestId) {
    var actor = loadActor(spreadsheet, payload.actorUserId, 'You cannot manage agents.');
    if (!actorMay(spreadsheet, actor, 'agent.manage')) throw appError('FORBIDDEN', 'You cannot manage agents.');
    var agents = repository.readAgents(spreadsheet);
    var id = text(payload.id).trim();
    var current = findById(agents, id);
    if (!current) throw appError('NOT_FOUND', 'Agent was not found.');
    var agent = normalizeAgent(payload, referenceRows(spreadsheet), agents, current);
    writeAgentWarehouse(spreadsheet, current.warehouseId, agent.warehouseName, current.code);
    repository.writeAgents(spreadsheet, agents.map(function (item) {
      return item.id === id ? storedAgent(agent) : item;
    }));
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'agents.update',
      entityType: 'agent',
      entityId: id,
      reference: agent.code,
      before: current.name + ' · ' + current.code,
      after: agent.name + ' · ' + agent.code,
      requestId: requestId
    });
    return {
      agents: visibleAgents(spreadsheet, actor, repository.readAgents(spreadsheet)),
      warehouses: warehouses(spreadsheet)
    };
  }

  function setAgentStatus(spreadsheet, payload, requestId) {
    var actor = loadActor(spreadsheet, payload.actorUserId, 'You cannot manage agents.');
    if (!actorMay(spreadsheet, actor, 'agent.manage')) throw appError('FORBIDDEN', 'You cannot manage agents.');
    var agents = repository.readAgents(spreadsheet);
    var id = text(payload.id).trim();
    var current = findById(agents, id);
    if (!current) throw appError('NOT_FOUND', 'Agent was not found.');
    var status = text(payload.status).trim();
    if (status !== 'active' && status !== 'inactive') throw appError('VALIDATION_ERROR', 'Agent status is not valid.');
    if (current.status !== status) {
      repository.writeAgents(spreadsheet, agents.map(function (item) {
        if (item.id !== id) return item;
        var next = storedAgent(item);
        next.status = status;
        next.updatedAt = nowIso();
        return next;
      }));
      systemAudit(spreadsheet, {
        userId: actor.id,
        action: 'agents.setStatus',
        entityType: 'agent',
        entityId: id,
        reference: current.code,
        before: current.status,
        after: status,
        requestId: requestId
      });
    }
    return { agents: visibleAgents(spreadsheet, actor, repository.readAgents(spreadsheet)) };
  }

  function money(value) {
    var amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return round2(amount);
  }

  function sellableProduct(spreadsheet, productId) {
    var product = null;
    products(spreadsheet).forEach(function (item) {
      if (item.id === productId) product = item;
    });
    if (!product || product.status !== 'active' || product.sellable === false) return null;
    return product;
  }

  function saveWholesalePrice(spreadsheet, payload, requestId) {
    var actor = loadActor(spreadsheet, payload.actorUserId, 'You cannot manage customer pricing.');
    if (!actorMay(spreadsheet, actor, 'customer.pricing.manage')) {
      throw appError('FORBIDDEN', 'You cannot manage customer pricing.');
    }
    var customerId = text(payload.customerId).trim();
    var productId = text(payload.productId).trim();
    if (!findById(repository.readCustomers(spreadsheet), customerId)) {
      throw appError('VALIDATION_ERROR', 'Customer not found');
    }
    var product = null;
    products(spreadsheet).forEach(function (item) {
      if (item.id === productId) product = item;
    });
    if (!product) throw appError('VALIDATION_ERROR', 'Product not found');
    var price = money(payload.price);
    if (price === null) throw appError('VALIDATION_ERROR', 'Custom Wholesale Price cannot be negative.');
    var active = payload.active !== false;
    var prices = repository.readWholesalePrices(spreadsheet);
    var existing = null;
    prices.forEach(function (row) {
      if (row.customerId === customerId && row.productId === productId) existing = row;
    });
    if (!existing && !sellableProduct(spreadsheet, productId)) {
      throw appError('VALIDATION_ERROR', 'This item is not sellable.');
    }
    var stamp = nowIso();
    var next;
    if (existing) {
      next = {
        id: existing.id,
        customerId: existing.customerId,
        productId: existing.productId,
        price: price,
        active: active,
        createdAt: existing.createdAt,
        updatedAt: stamp,
        createdBy: existing.createdBy,
        updatedBy: actor.id
      };
    } else {
      var id = clientId(payload.id);
      if (prices.some(function (row) { return row.id === id; })) throw appError('CONFLICT', 'Custom price already exists.');
      next = {
        id: id,
        customerId: customerId,
        productId: productId,
        price: price,
        active: active,
        createdAt: stamp,
        updatedAt: stamp,
        createdBy: actor.id,
        updatedBy: actor.id
      };
    }
    var rows = existing
      ? prices.map(function (row) { return row.id === existing.id ? next : row; })
      : [next].concat(prices);
    repository.writeWholesalePrices(spreadsheet, rows);
    systemAudit(spreadsheet, {
      userId: actor.id,
      action: 'customers.saveWholesalePrice',
      entityType: 'customerWholesalePrice',
      entityId: next.id,
      reference: customerId + ' · ' + productId,
      before: existing ? String(existing.price) : '',
      after: active ? String(price) : '',
      requestId: requestId
    });
    return { customerWholesalePrices: repository.readWholesalePrices(spreadsheet) };
  }

  function deactivateWholesalePrice(spreadsheet, payload, requestId) {
    var actor = loadActor(spreadsheet, payload.actorUserId, 'You cannot manage customer pricing.');
    if (!actorMay(spreadsheet, actor, 'customer.pricing.manage')) {
      throw appError('FORBIDDEN', 'You cannot manage customer pricing.');
    }
    var id = text(payload.id).trim();
    var prices = repository.readWholesalePrices(spreadsheet);
    var current = findById(prices, id);
    if (!current) throw appError('VALIDATION_ERROR', 'Custom price not found');
    if (current.active) {
      var next = {
        id: current.id,
        customerId: current.customerId,
        productId: current.productId,
        price: current.price,
        active: false,
        createdAt: current.createdAt,
        updatedAt: nowIso(),
        createdBy: current.createdBy,
        updatedBy: actor.id
      };
      repository.writeWholesalePrices(spreadsheet, prices.map(function (row) {
        return row.id === id ? next : row;
      }));
      systemAudit(spreadsheet, {
        userId: actor.id,
        action: 'customers.deactivateWholesalePrice',
        entityType: 'customerWholesalePrice',
        entityId: id,
        reference: current.customerId + ' · ' + current.productId,
        before: String(current.price),
        after: '',
        requestId: requestId
      });
    }
    return { customerWholesalePrices: repository.readWholesalePrices(spreadsheet) };
  }

  function assertUnique(rows, label) {
    var ids = {};
    rows.forEach(function (row) {
      if (ids[row.id]) throw appError('CONFLICT', label + ' already exists.');
      ids[row.id] = true;
    });
  }

  function bootstrap(spreadsheet, payload, requestId) {
    var actorId = '';
    var actor = optionalActor(spreadsheet, payload && payload.actorUserId);
    if (actor) actorId = actor.id;
    var current = load(spreadsheet);
    var wrote = false;
    var customers = current.customers;
    var suppliers = current.suppliers;
    var prices = current.customerWholesalePrices;
    var agents = current.agents;
    if (!customers.length && payload && Array.isArray(payload.customers) && payload.customers.length) {
      customers = payload.customers.map(function (item) { return normalizeCustomer(item, true); });
      assertUnique(customers, 'Customer');
      wrote = true;
    }
    if (!suppliers.length && payload && Array.isArray(payload.suppliers) && payload.suppliers.length) {
      suppliers = payload.suppliers.map(function (item) { return normalizeSupplier(item, true); });
      assertUnique(suppliers, 'Supplier');
      wrote = true;
    }
    if (!prices.length && payload && Array.isArray(payload.customerWholesalePrices) && payload.customerWholesalePrices.length) {
      var customerIds = {};
      customers.forEach(function (customer) { customerIds[customer.id] = true; });
      var productIds = {};
      products(spreadsheet).forEach(function (product) { productIds[product.id] = true; });
      prices = payload.customerWholesalePrices.map(function (item) {
        var customerId = text(item.customerId).trim();
        var productId = text(item.productId).trim();
        if (!customerIds[customerId]) throw appError('VALIDATION_ERROR', 'Customer not found');
        if (!productIds[productId]) throw appError('VALIDATION_ERROR', 'Product not found');
        var price = money(item.price);
        if (price === null) throw appError('VALIDATION_ERROR', 'Custom Wholesale Price cannot be negative.');
        return {
          id: clientId(item.id),
          customerId: customerId,
          productId: productId,
          price: price,
          active: item.active !== false,
          createdAt: text(item.createdAt).trim() || nowIso(),
          updatedAt: text(item.updatedAt).trim() || nowIso(),
          createdBy: text(item.createdBy).trim(),
          updatedBy: text(item.updatedBy).trim()
        };
      });
      assertUnique(prices, 'Custom price');
      wrote = true;
    }
    var warehouseWrites = [];
    if (!agents.length && payload && Array.isArray(payload.agents) && payload.agents.length) {
      var refs = referenceRows(spreadsheet);
      agents = payload.agents.map(function (item) {
        var agent = normalizeAgent(item, refs, agents.concat(warehouseWrites.map(function (row) {
          return { id: row.agentId, code: row.code, warehouseId: row.id };
        })), null);
        refs.warehouses = refs.warehouses.concat([{ id: agent.warehouseId, name: agent.warehouseName, code: agent.code, kind: 'agent' }]);
        warehouseWrites.push({ id: agent.warehouseId, name: agent.warehouseName, code: agent.code, agentId: agent.id });
        return storedAgent(agent);
      });
      assertUnique(agents, 'Agent');
      wrote = true;
    }
    if (!wrote) throw appError('CONFLICT', 'Parties are already initialized.');
    if (customers !== current.customers) repository.writeCustomers(spreadsheet, customers);
    if (suppliers !== current.suppliers) repository.writeSuppliers(spreadsheet, suppliers);
    if (prices !== current.customerWholesalePrices) repository.writeWholesalePrices(spreadsheet, prices);
    if (warehouseWrites.length) {
      var existingWarehouses = warehouses(spreadsheet);
      masters.writeWarehouses(spreadsheet, existingWarehouses.concat(warehouseWrites.map(function (row) {
        return { id: row.id, name: row.name, code: row.code, kind: 'agent' };
      })));
      repository.writeAgents(spreadsheet, agents);
    }
    systemAudit(spreadsheet, {
      userId: actorId,
      action: 'parties.bootstrap',
      entityType: 'customer',
      entityId: 'parties',
      reference: '',
      before: '',
      after: String(customers.length) + ' customers, ' + String(suppliers.length) + ' suppliers, ' + String(agents.length) + ' agents',
      requestId: requestId
    });
    var view = snapshot(spreadsheet, actor);
    view.warehouses = warehouses(spreadsheet);
    return view;
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload || {};
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      var actor = optionalActor(spreadsheet, payload.actorUserId);
      if (action === 'parties.get') return okEnvelope(snapshot(spreadsheet, actor));
      if (action === 'customers.list') return okEnvelope({ customers: repository.readCustomers(spreadsheet) });
      if (action === 'customers.get') {
        var customer = findById(repository.readCustomers(spreadsheet), text(payload.id).trim());
        if (!customer) throw appError('NOT_FOUND', 'Customer was not found.');
        return okEnvelope({ customer: customer });
      }
      if (action === 'suppliers.list') return okEnvelope({ suppliers: repository.readSuppliers(spreadsheet) });
      if (action === 'suppliers.get') {
        var supplier = findById(repository.readSuppliers(spreadsheet), text(payload.id).trim());
        if (!supplier) throw appError('NOT_FOUND', 'Supplier was not found.');
        return okEnvelope({ supplier: supplier });
      }
      if (action === 'agents.list') {
        return okEnvelope({ agents: visibleAgents(spreadsheet, actor, repository.readAgents(spreadsheet)) });
      }
      if (action === 'agents.get') {
        var rows = visibleAgents(spreadsheet, actor, repository.readAgents(spreadsheet));
        var agent = findById(rows, text(payload.id).trim());
        if (!agent) throw appError('NOT_FOUND', 'Agent was not found.');
        var warehouse = null;
        warehouses(spreadsheet).forEach(function (item) {
          if (item.id === agent.warehouseId) warehouse = item;
        });
        return okEnvelope({ agent: agent, warehouse: warehouse });
      }
      var result;
      if (action === 'parties.bootstrap') result = bootstrap(spreadsheet, payload, requestId);
      else if (action === 'customers.create') result = createCustomer(spreadsheet, payload, requestId);
      else if (action === 'customers.saveWholesalePrice') result = saveWholesalePrice(spreadsheet, payload, requestId);
      else if (action === 'customers.deactivateWholesalePrice') result = deactivateWholesalePrice(spreadsheet, payload, requestId);
      else if (action === 'suppliers.create') result = createSupplier(spreadsheet, payload, requestId);
      else if (action === 'agents.create') result = createAgent(spreadsheet, payload, requestId);
      else if (action === 'agents.update') result = updateAgent(spreadsheet, payload, requestId);
      else if (action === 'agents.setStatus') result = setAgentStatus(spreadsheet, payload, requestId);
      else return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
      return okEnvelope(result);
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
