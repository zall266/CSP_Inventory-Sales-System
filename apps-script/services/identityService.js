// Module 1 identity writes. actorUserId is the existing prototype switcher
// (ui.currentUserId). It is not a session provider and it is not Phase 2 auth.
// authenticate() is unchanged. Business rules still run here.

var IDENTITY_ACTIONS = {
  'identity.get': true,
  'identity.bootstrap': true,
  'settings.get': true,
  'settings.update': true,
  'users.list': true,
  'users.create': true,
  'users.update': true,
  'roles.create': true,
  'roles.update': true,
  'roles.setStatus': true,
  'roles.savePermissions': true,
  'roles.updateMatrix': true
};

var LEGACY_ROLES = { owner: true, admin: true, manager: true, staff: true, cashier: true, warehouse: true };
var SETTINGS_STRING_FIELDS = [
  'businessName', 'legalName', 'phone', 'email', 'address', 'website', 'registrationNo', 'bankName',
  'bankAccount', 'paymentTerms', 'documentTerms', 'currency', 'defaultWarehouseId', 'defaultCustomerId'
];
var SETTINGS_BOOLEAN_FIELDS = ['allowNegativeStock', 'batchTracking', 'expiryTracking', 'allowDiscount', 'allowReturns'];

function createIdentityService(deps) {
  var sheets = deps.sheetRepository;
  var repository = createIdentityRepository(sheets, deps.driveStorage);
  var audit = deps.audit || createAuditService(sheets);

  function canHandle(action) {
    return Boolean(IDENTITY_ACTIONS[action]);
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function locked(fn) {
    return withScriptLock(function () {
      return fn(sheets.openSpreadsheet());
    });
  }

  function load(spreadsheet) {
    return repository.load(spreadsheet);
  }

  function requireReady(snapshot) {
    if (snapshot.empty || !snapshot.settings) throw appError('CONFLICT', 'Identity is not initialized.');
    return snapshot;
  }

  function findUser(snapshot, id) {
    for (var i = 0; i < snapshot.users.length; i += 1) {
      if (snapshot.users[i].id === id) return snapshot.users[i];
    }
    return null;
  }

  function findDepartment(snapshot, id) {
    for (var i = 0; i < snapshot.departments.length; i += 1) {
      if (snapshot.departments[i].id === id) return snapshot.departments[i];
    }
    return null;
  }

  function requireActor(snapshot, actorUserId, message) {
    var id = text(actorUserId).trim();
    if (!id) throw appError('FORBIDDEN', message);
    var user = findUser(snapshot, id);
    if (!user || user.status !== 'active') throw appError('FORBIDDEN', message);
    return user;
  }

  function knownUser(snapshot, actorUserId, message) {
    var id = text(actorUserId).trim();
    if (!id) throw appError('FORBIDDEN', message);
    var user = findUser(snapshot, id);
    if (!user) throw appError('FORBIDDEN', message);
    return user;
  }

  function clientId(value) {
    var id = text(value).trim();
    if (!id) return createId();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw appError('VALIDATION_ERROR', 'Id is not valid.');
    return id;
  }

  function uniqueRoleName(snapshot, name, excludeId) {
    var needle = name.trim().toLowerCase();
    return !snapshot.roles.some(function (role) {
      return role.id !== excludeId && role.name.trim().toLowerCase() === needle;
    });
  }

  function systemAudit(spreadsheet, entry) {
    sheets.ensureSheet(spreadsheet, 'AuditLogs', AUDIT_HEADERS);
    audit.append(entry);
  }

  function userLog(actor, action, userId, userName, field, oldValue, newValue) {
    return {
      id: createId(),
      action: action,
      userId: userId,
      userName: userName,
      field: field,
      oldValue: oldValue || '',
      newValue: newValue || '',
      changedBy: actor.name,
      changedAt: nowIso()
    };
  }

  function applySettingsPatch(current, patch) {
    var next = {
      businessName: current.businessName,
      legalName: current.legalName,
      logoUrl: current.logoUrl,
      phone: current.phone,
      email: current.email,
      address: current.address,
      website: current.website,
      registrationNo: current.registrationNo,
      bankName: current.bankName,
      bankAccount: current.bankAccount,
      paymentTerms: current.paymentTerms,
      documentTerms: current.documentTerms,
      currency: current.currency,
      defaultWarehouseId: current.defaultWarehouseId,
      allowNegativeStock: current.allowNegativeStock,
      costingMethod: current.costingMethod,
      batchTracking: current.batchTracking,
      expiryTracking: current.expiryTracking,
      defaultCustomerId: current.defaultCustomerId,
      allowDiscount: current.allowDiscount,
      allowReturns: current.allowReturns,
      enabledPaymentMethods: (current.enabledPaymentMethods || []).slice(),
      roleMatrix: current.roleMatrix || {}
    };
    SETTINGS_STRING_FIELDS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) return;
      if (typeof patch[key] !== 'string') throw appError('VALIDATION_ERROR', 'Settings value is not valid.');
      next[key] = patch[key];
    });
    if (Object.prototype.hasOwnProperty.call(patch, 'logoUrl')) {
      if (typeof patch.logoUrl !== 'string') throw appError('VALIDATION_ERROR', 'That file could not be read as an image.');
      next.logoUrl = patch.logoUrl;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'costingMethod')) {
      if (patch.costingMethod !== 'average' && patch.costingMethod !== 'fifo') {
        throw appError('VALIDATION_ERROR', 'Costing method is not valid.');
      }
      next.costingMethod = patch.costingMethod;
    }
    SETTINGS_BOOLEAN_FIELDS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) return;
      if (typeof patch[key] !== 'boolean') throw appError('VALIDATION_ERROR', 'Settings value is not valid.');
      next[key] = patch[key];
    });
    if (Object.prototype.hasOwnProperty.call(patch, 'enabledPaymentMethods')) {
      next.enabledPaymentMethods = cleanPaymentMethods(patch.enabledPaymentMethods);
    }
    return next;
  }

  function cleanPaymentMethods(value) {
    if (!Array.isArray(value)) throw appError('VALIDATION_ERROR', 'Enabled payment methods are not valid.');
    return value.map(function (method) {
      var name = text(method);
      if (!PAYMENT_METHODS[name]) throw appError('VALIDATION_ERROR', 'Enabled payment methods are not valid.');
      return name;
    });
  }

  function cleanFullSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw appError('VALIDATION_ERROR', 'Identity bootstrap is incomplete.');
    }
    var patch = {};
    SETTINGS_STRING_FIELDS.forEach(function (key) {
      patch[key] = typeof settings[key] === 'string' ? settings[key] : '';
    });
    patch.logoUrl = typeof settings.logoUrl === 'string' ? settings.logoUrl : '';
    if (settings.costingMethod !== 'average' && settings.costingMethod !== 'fifo') {
      throw appError('VALIDATION_ERROR', 'Costing method is not valid.');
    }
    patch.costingMethod = settings.costingMethod;
    SETTINGS_BOOLEAN_FIELDS.forEach(function (key) {
      if (typeof settings[key] !== 'boolean') throw appError('VALIDATION_ERROR', 'Settings value is not valid.');
      patch[key] = settings[key];
    });
    patch.enabledPaymentMethods = cleanPaymentMethods(settings.enabledPaymentMethods);
    var blank = applySettingsPatch({
      businessName: '', legalName: '', logoUrl: '', phone: '', email: '', address: '', website: '',
      registrationNo: '', bankName: '', bankAccount: '', paymentTerms: '', documentTerms: '', currency: '',
      defaultWarehouseId: '', allowNegativeStock: false, costingMethod: 'average', batchTracking: false,
      expiryTracking: false, defaultCustomerId: '', allowDiscount: false, allowReturns: false,
      enabledPaymentMethods: [], roleMatrix: {}
    }, patch);
    blank.roleMatrix = settings.roleMatrix && typeof settings.roleMatrix === 'object' ? settings.roleMatrix : {};
    return blank;
  }

  function normalizeRole(role) {
    var legacy = text(role.legacyRole);
    if (!LEGACY_ROLES[legacy]) throw appError('VALIDATION_ERROR', 'Identity bootstrap is incomplete.');
    var status = role.status === 'inactive' ? 'inactive' : 'active';
    if (role.status && role.status !== 'active' && role.status !== 'inactive') {
      throw appError('VALIDATION_ERROR', 'Identity bootstrap is incomplete.');
    }
    return {
      id: clientId(role.id),
      name: text(role.name).trim(),
      description: text(role.description).trim(),
      status: status,
      protected: Boolean(role.protected || legacy === 'owner'),
      legacyRole: legacy,
      createdAt: text(role.createdAt) || nowIso(),
      updatedAt: text(role.updatedAt) || nowIso()
    };
  }

  function bootstrap(spreadsheet, payload, requestId) {
    var current = load(spreadsheet);
    if (!current.empty) throw appError('CONFLICT', 'Identity is already initialized.');
    if (!Array.isArray(payload.users) || !payload.users.length || !Array.isArray(payload.roles) || !payload.roles.length || !Array.isArray(payload.departments) || !payload.departments.length) {
      throw appError('VALIDATION_ERROR', 'Identity bootstrap is incomplete.');
    }
    var departments = payload.departments.map(function (item) {
      if (!item || !text(item.name).trim()) throw appError('VALIDATION_ERROR', 'Identity bootstrap is incomplete.');
      var status = item.status === 'inactive' ? 'inactive' : 'active';
      return { id: clientId(item.id), name: text(item.name).trim(), status: status };
    });
    var roles = payload.roles.map(normalizeRole);
    var settings = cleanFullSettings(payload.settings);
    var matrix = {};
    roles.forEach(function (role) {
      if (!role.name) throw appError('VALIDATION_ERROR', 'Role name is required');
      matrix[role.id] = normalizePermissions(settings.roleMatrix[role.id]);
    });
    settings.roleMatrix = matrix;
    var users = payload.users.map(function (item) {
      var role = null;
      roles.forEach(function (candidate) { if (candidate.id === item.roleId) role = candidate; });
      var department = null;
      departments.forEach(function (candidate) { if (candidate.id === item.departmentId) department = candidate; });
      if (!role || !department) throw appError('VALIDATION_ERROR', 'Identity bootstrap is incomplete.');
      var name = text(item.name).trim();
      var email = text(item.email).trim().toLowerCase();
      if (!name || !email) throw appError('VALIDATION_ERROR', 'Name and email are required');
      var status = item.status === 'inactive' ? 'inactive' : 'active';
      return {
        id: clientId(item.id),
        name: name,
        email: email,
        roleId: role.id,
        role: role.legacyRole,
        departmentId: department.id,
        status: status,
        lastLogin: text(item.lastLogin) || 'Never',
        createdAt: text(item.createdAt) || nowIso(),
        updatedAt: text(item.updatedAt) || nowIso()
      };
    });
    var seenEmail = {};
    var seenUser = {};
    users.forEach(function (user) {
      if (seenEmail[user.email] || seenUser[user.id]) throw appError('VALIDATION_ERROR', 'Email already in use');
      seenEmail[user.email] = true;
      seenUser[user.id] = true;
    });
    var owner = users.some(function (user) {
      if (user.status !== 'active') return false;
      var role = null;
      roles.forEach(function (candidate) { if (candidate.id === user.roleId) role = candidate; });
      return isOwnerUser({ roles: roles, users: users }, Object.assign({}, user, { role: role.legacyRole }));
    });
    if (!owner) throw appError('VALIDATION_ERROR', 'Identity bootstrap is incomplete.');
    var logs = Array.isArray(payload.userAuditLogs) ? payload.userAuditLogs.map(function (item) {
      return {
        id: clientId(item.id),
        action: text(item.action),
        userId: text(item.userId),
        userName: text(item.userName),
        field: text(item.field),
        oldValue: text(item.oldValue),
        newValue: text(item.newValue),
        changedBy: text(item.changedBy),
        changedAt: text(item.changedAt) || nowIso()
      };
    }) : [];
    repository.writeDepartments(spreadsheet, departments);
    repository.writeRoles(spreadsheet, roles);
    repository.writeUsers(spreadsheet, users);
    repository.writeSettings(spreadsheet, settings);
    repository.writeAudits(spreadsheet, logs);
    systemAudit(spreadsheet, {
      userId: '',
      action: 'identity.bootstrap',
      entityType: 'settings',
      entityId: 'settings',
      reference: '',
      before: '',
      after: String(users.length) + ' users',
      requestId: requestId
    });
    return load(spreadsheet);
  }

  function createUser(spreadsheet, payload, requestId) {
    var snapshot = requireReady(load(spreadsheet));
    var actor = requireActor(snapshot, payload.actorUserId, 'You cannot add users.');
    if (!canCreateUser(snapshot, actor)) throw appError('FORBIDDEN', 'You cannot add users.');
    var name = text(payload.name).trim();
    var email = text(payload.email).trim().toLowerCase();
    if (!name || !email) throw appError('VALIDATION_ERROR', 'Name and email are required');
    var role = roleById(snapshot, payload.roleId);
    if (!role || !canAssignRole(snapshot, actor, role)) throw appError('FORBIDDEN', 'You cannot assign that role.');
    var department = findDepartment(snapshot, payload.departmentId);
    if (!department || department.status !== 'active') throw appError('VALIDATION_ERROR', 'Department is required');
    if (snapshot.users.some(function (item) { return item.email === email; })) {
      throw appError('VALIDATION_ERROR', 'Email already in use');
    }
    var status = payload.status ? text(payload.status) : 'active';
    if (status !== 'active' && status !== 'inactive') throw appError('VALIDATION_ERROR', 'Settings value is not valid.');
    var id = clientId(payload.id);
    if (findUser(snapshot, id)) throw appError('CONFLICT', 'User already exists.');
    var stamp = nowIso();
    var user = {
      id: id,
      name: name,
      email: email,
      roleId: role.id,
      role: role.legacyRole,
      departmentId: department.id,
      status: status,
      lastLogin: 'Never',
      createdAt: stamp,
      updatedAt: stamp
    };
    var log = userLog(actor, 'user_created', user.id, user.name, 'user', '', user.name + ' · ' + role.name + ' · ' + department.name + ' · ' + user.status);
    repository.writeUsers(spreadsheet, [user].concat(snapshot.users));
    repository.writeAudits(spreadsheet, [log].concat(snapshot.userAuditLogs));
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'users.create', entityType: 'user', entityId: user.id,
      reference: user.email, before: '', after: user.name, requestId: requestId
    });
    return load(spreadsheet);
  }

  function updateUser(spreadsheet, payload, requestId) {
    var snapshot = requireReady(load(spreadsheet));
    var target = findUser(snapshot, text(payload.id));
    if (!target) throw appError('NOT_FOUND', 'User was not found.');
    var actor = requireActor(snapshot, payload.actorUserId, 'You cannot edit users.');
    var patch = payload.patch || {};
    if (!canEditUserRecord(snapshot, actor) && patch.status === undefined) {
      throw appError('FORBIDDEN', 'You cannot edit users.');
    }
    var nextName = patch.name !== undefined ? text(patch.name).trim() : target.name;
    var nextEmail = text(patch.email !== undefined ? patch.email : target.email).trim().toLowerCase();
    var nextRoleId = patch.roleId !== undefined ? text(patch.roleId) : target.roleId;
    var nextDepartmentId = patch.departmentId !== undefined ? text(patch.departmentId) : target.departmentId;
    var nextStatus = patch.status !== undefined ? text(patch.status) : target.status;
    if (!nextName || !nextEmail) throw appError('VALIDATION_ERROR', 'Name and email are required');
    if (nextStatus !== 'active' && nextStatus !== 'inactive') throw appError('VALIDATION_ERROR', 'Settings value is not valid.');
    if (snapshot.users.some(function (item) { return item.id !== target.id && item.email === nextEmail; })) {
      throw appError('VALIDATION_ERROR', 'Email already in use');
    }
    var nextRole = roleById(snapshot, nextRoleId);
    if (nextRoleId !== target.roleId && !canChangeUserRole(snapshot, actor, target, nextRole)) {
      throw appError('FORBIDDEN', 'You cannot change that user\'s role.');
    }
    if (nextRoleId === target.roleId && !nextRole) throw appError('VALIDATION_ERROR', 'Role not found');
    var nextDepartment = findDepartment(snapshot, nextDepartmentId);
    if (!nextDepartment || (nextDepartment.status !== 'active' && nextDepartmentId !== target.departmentId)) {
      throw appError('VALIDATION_ERROR', 'Department is required');
    }
    if (nextStatus !== target.status && nextStatus === 'inactive' && !canDeactivateUser(snapshot, actor, target)) {
      throw appError('FORBIDDEN', 'You cannot deactivate this user.');
    }
    if (nextStatus === 'inactive' && isOwnerUser(snapshot, target) && !isOwnerUser(snapshot, actor)) {
      throw appError('FORBIDDEN', 'Admin cannot deactivate Owner.');
    }
    if (!canEditUserRecord(snapshot, actor) && nextStatus === target.status) {
      throw appError('FORBIDDEN', 'You cannot edit users.');
    }
    var logs = [];
    if (nextRoleId !== target.roleId) {
      var oldRole = roleById(snapshot, target.roleId);
      logs.push(userLog(actor, 'role_changed', target.id, nextName, 'role', oldRole ? oldRole.name : target.roleId, nextRole.name));
    }
    if (nextDepartmentId !== target.departmentId) {
      var oldDepartment = findDepartment(snapshot, target.departmentId);
      logs.push(userLog(actor, 'department_changed', target.id, nextName, 'department', oldDepartment ? oldDepartment.name : target.departmentId, nextDepartment.name));
    }
    if (nextStatus !== target.status) {
      logs.push(userLog(actor, nextStatus === 'inactive' ? 'user_deactivated' : 'user_reactivated', target.id, nextName, 'status', target.status, nextStatus));
    }
    if (nextName !== target.name) logs.push(userLog(actor, 'user_updated', target.id, nextName, 'name', target.name, nextName));
    if (nextEmail !== target.email) logs.push(userLog(actor, 'user_updated', target.id, nextName, 'email', target.email, nextEmail));
    if (!logs.length) return snapshot;
    var stamp = nowIso();
    var users = snapshot.users.map(function (item) {
      if (item.id !== target.id) return item;
      return {
        id: item.id,
        name: nextName,
        email: nextEmail,
        roleId: nextRole.id,
        role: nextRole.legacyRole,
        departmentId: nextDepartment.id,
        status: nextStatus,
        lastLogin: item.lastLogin,
        createdAt: item.createdAt,
        updatedAt: stamp
      };
    });
    repository.writeUsers(spreadsheet, users);
    repository.writeAudits(spreadsheet, logs.concat(snapshot.userAuditLogs));
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'users.update', entityType: 'user', entityId: target.id,
      reference: nextEmail, before: target.name, after: nextName, requestId: requestId
    });
    return load(spreadsheet);
  }

  function createRole(spreadsheet, payload, requestId) {
    var snapshot = requireReady(load(spreadsheet));
    var actor = requireActor(snapshot, payload.actorUserId, 'You cannot create roles.');
    if (!canCreateRole(snapshot, actor)) throw appError('FORBIDDEN', 'You cannot create roles.');
    var name = text(payload.name).trim();
    if (!name) throw appError('VALIDATION_ERROR', 'Role name is required');
    if (!uniqueRoleName(snapshot, name)) throw appError('VALIDATION_ERROR', 'Role name already exists');
    var status = payload.status ? text(payload.status) : 'active';
    if (status !== 'active' && status !== 'inactive') throw appError('VALIDATION_ERROR', 'Settings value is not valid.');
    var id = clientId(payload.id);
    if (roleById(snapshot, id)) throw appError('CONFLICT', 'Role already exists.');
    var stamp = nowIso();
    var role = {
      id: id,
      name: name,
      description: text(payload.description).trim(),
      status: status,
      protected: false,
      legacyRole: 'staff',
      createdAt: stamp,
      updatedAt: stamp
    };
    var matrix = Object.assign({}, snapshot.settings.roleMatrix);
    matrix[role.id] = emptyPermissions();
    var log = userLog(actor, 'role_created', role.id, role.name, 'role', '', role.name + ' · ' + role.status);
    repository.writeRoles(spreadsheet, snapshot.roles.concat([role]));
    repository.writeMatrix(spreadsheet, matrix);
    repository.writeAudits(spreadsheet, [log].concat(snapshot.userAuditLogs));
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'roles.create', entityType: 'role', entityId: role.id,
      reference: role.name, before: '', after: role.name, requestId: requestId
    });
    return load(spreadsheet);
  }

  function updateRole(spreadsheet, payload, requestId) {
    var snapshot = requireReady(load(spreadsheet));
    var role = roleById(snapshot, text(payload.id));
    if (!role) throw appError('NOT_FOUND', 'Role was not found.');
    var actor = requireActor(snapshot, payload.actorUserId, 'You cannot edit roles.');
    if (!canEditRoleRecord(snapshot, actor)) throw appError('FORBIDDEN', 'You cannot edit roles.');
    var patch = payload.patch || {};
    if (isOwnerRole(role) && patch.name !== undefined && text(patch.name).trim() !== role.name) {
      throw appError('FORBIDDEN', 'The Owner role cannot be renamed.');
    }
    if (patch.name !== undefined && !canRenameRole(snapshot, actor, role) && text(patch.name).trim() !== role.name) {
      throw appError('FORBIDDEN', 'You cannot rename this role.');
    }
    var nextName = text(patch.name !== undefined ? patch.name : role.name).trim();
    var nextDescription = patch.description !== undefined ? text(patch.description).trim() : role.description;
    if (!nextName) throw appError('VALIDATION_ERROR', 'Role name is required');
    if (!uniqueRoleName(snapshot, nextName, role.id)) throw appError('VALIDATION_ERROR', 'Role name already exists');
    var logs = [];
    if (nextName !== role.name) logs.push(userLog(actor, 'role_renamed', role.id, nextName, 'name', role.name, nextName));
    if (nextDescription !== role.description) logs.push(userLog(actor, 'role_updated', role.id, nextName, 'description', role.description, nextDescription));
    if (!logs.length) return snapshot;
    var stamp = nowIso();
    repository.writeRoles(spreadsheet, snapshot.roles.map(function (item) {
      if (item.id !== role.id) return item;
      return Object.assign({}, item, { name: nextName, description: nextDescription, updatedAt: stamp });
    }));
    repository.writeAudits(spreadsheet, logs.concat(snapshot.userAuditLogs));
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'roles.update', entityType: 'role', entityId: role.id,
      reference: nextName, before: role.name, after: nextName, requestId: requestId
    });
    return load(spreadsheet);
  }

  function setRoleStatus(spreadsheet, payload, requestId) {
    var snapshot = requireReady(load(spreadsheet));
    var role = roleById(snapshot, text(payload.id));
    if (!role) throw appError('NOT_FOUND', 'Role was not found.');
    var status = text(payload.status);
    if (status !== 'active' && status !== 'inactive') throw appError('VALIDATION_ERROR', 'Settings value is not valid.');
    var actor = requireActor(snapshot, payload.actorUserId, status === 'inactive' ? 'You cannot deactivate this role.' : 'You cannot reactivate this role.');
    if (!canDeactivateRole(snapshot, actor, role) && status === 'inactive') {
      throw appError('FORBIDDEN', 'You cannot deactivate this role.');
    }
    if (!canEditRoleRecord(snapshot, actor) && status === 'active') {
      throw appError('FORBIDDEN', 'You cannot reactivate this role.');
    }
    if (isOwnerRole(role) && status === 'inactive') throw appError('FORBIDDEN', 'The Owner role cannot be deactivated.');
    if (role.status === status) return snapshot;
    var stamp = nowIso();
    var log = userLog(actor, status === 'inactive' ? 'role_deactivated' : 'role_reactivated', role.id, role.name, 'status', role.status, status);
    repository.writeRoles(spreadsheet, snapshot.roles.map(function (item) {
      return item.id === role.id ? Object.assign({}, item, { status: status, updatedAt: stamp }) : item;
    }));
    repository.writeAudits(spreadsheet, [log].concat(snapshot.userAuditLogs));
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'roles.setStatus', entityType: 'role', entityId: role.id,
      reference: role.name, before: role.status, after: status, requestId: requestId
    });
    return load(spreadsheet);
  }

  function permissionLogs(actor, role, previous, next) {
    var logs = [];
    PERMISSION_KEYS.forEach(function (key) {
      if (previous[key] === next[key]) return;
      logs.push(userLog(actor, 'role_permissions_changed', role.id, role.name, key, previous[key] ? 'ON' : 'OFF', next[key] ? 'ON' : 'OFF'));
    });
    return logs;
  }

  function savePermissions(spreadsheet, payload, requestId) {
    var snapshot = requireReady(load(spreadsheet));
    var actor = requireActor(snapshot, payload.actorUserId, 'You cannot manage role permissions.');
    if (!canManagePermissions(snapshot, actor)) throw appError('FORBIDDEN', 'You cannot manage role permissions.');
    var role = roleById(snapshot, text(payload.roleId));
    if (!role) throw appError('NOT_FOUND', 'Role was not found.');
    if (isOwnerRole(role)) throw appError('FORBIDDEN', 'Owner always has full access. Permissions cannot be reduced.');
    var previous = normalizePermissions(snapshot.settings.roleMatrix[role.id] || defaultPermissionsForLegacy(role.legacyRole));
    var next = normalizePermissions(payload.permissions);
    var logs = permissionLogs(actor, role, previous, next);
    if (!logs.length) return snapshot;
    var matrix = Object.assign({}, snapshot.settings.roleMatrix);
    matrix[role.id] = next;
    repository.writeMatrix(spreadsheet, matrix);
    repository.writeAudits(spreadsheet, logs.concat(snapshot.userAuditLogs));
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'roles.savePermissions', entityType: 'role', entityId: role.id,
      reference: role.name, before: '', after: role.name, requestId: requestId
    });
    return load(spreadsheet);
  }

  function updateMatrix(spreadsheet, payload, requestId) {
    var snapshot = requireReady(load(spreadsheet));
    var actor = requireActor(snapshot, payload.actorUserId, 'You cannot manage role permissions.');
    if (!canManagePermissions(snapshot, actor)) throw appError('FORBIDDEN', 'You cannot manage role permissions.');
    var incoming = payload.matrix || {};
    var nextMatrix = Object.assign({}, snapshot.settings.roleMatrix);
    var logs = [];
    snapshot.roles.forEach(function (role) {
      if (isOwnerRole(role)) {
        nextMatrix[role.id] = normalizePermissions(snapshot.settings.roleMatrix[role.id] || defaultPermissionsForLegacy('owner'));
        return;
      }
      var previous = normalizePermissions(snapshot.settings.roleMatrix[role.id]);
      var next = normalizePermissions(incoming[role.id]);
      nextMatrix[role.id] = next;
      logs = logs.concat(permissionLogs(actor, role, previous, next));
    });
    repository.writeMatrix(spreadsheet, nextMatrix);
    if (logs.length) repository.writeAudits(spreadsheet, logs.concat(snapshot.userAuditLogs));
    if (logs.length) {
      systemAudit(spreadsheet, {
        userId: actor.id, action: 'roles.updateMatrix', entityType: 'settings', entityId: 'settings',
        reference: '', before: '', after: String(logs.length), requestId: requestId
      });
    }
    return load(spreadsheet);
  }

  function updateSettings(spreadsheet, payload, requestId) {
    var snapshot = requireReady(load(spreadsheet));
    var actor = knownUser(snapshot, payload.actorUserId, 'You cannot edit settings.');
    var patch = payload.patch;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw appError('VALIDATION_ERROR', 'Settings value is not valid.');
    }
    var next = applySettingsPatch(snapshot.settings, patch);
    repository.writeSettings(spreadsheet, next, {
      keepLogo: !Object.prototype.hasOwnProperty.call(patch, 'logoUrl')
    });
    systemAudit(spreadsheet, {
      userId: actor.id, action: 'settings.update', entityType: 'settings', entityId: 'settings',
      reference: next.businessName, before: snapshot.settings.businessName, after: next.businessName, requestId: requestId
    });
    return load(spreadsheet);
  }

  function dispatch(request) {
    var action = request.action;
    var payload = request.payload;
    var requestId = request.requestId ? String(request.requestId) : '';
    return locked(function (spreadsheet) {
      if (action === 'identity.get') return okEnvelope(load(spreadsheet));
      if (action === 'settings.get') return okEnvelope({ settings: load(spreadsheet).settings });
      if (action === 'users.list') return okEnvelope({ users: load(spreadsheet).users });
      var result;
      if (action === 'identity.bootstrap') result = bootstrap(spreadsheet, payload, requestId);
      else if (action === 'users.create') result = createUser(spreadsheet, payload, requestId);
      else if (action === 'users.update') result = updateUser(spreadsheet, payload, requestId);
      else if (action === 'roles.create') result = createRole(spreadsheet, payload, requestId);
      else if (action === 'roles.update') result = updateRole(spreadsheet, payload, requestId);
      else if (action === 'roles.setStatus') result = setRoleStatus(spreadsheet, payload, requestId);
      else if (action === 'roles.savePermissions') result = savePermissions(spreadsheet, payload, requestId);
      else if (action === 'roles.updateMatrix') result = updateMatrix(spreadsheet, payload, requestId);
      else if (action === 'settings.update') result = updateSettings(spreadsheet, payload, requestId);
      else return errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: requestId });
      return okEnvelope(result);
    });
  }

  return { canHandle: canHandle, dispatch: dispatch };
}
