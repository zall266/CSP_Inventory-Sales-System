// Permission keys match src/features/settings/permissions.ts.
// This is the same vocabulary, not a second permission model.

var PERMISSION_KEYS = [
  'dashboard.view',
  'sales.view',
  'sales.create',
  'sales.edit',
  'sales.void',
  'sales.quotation.view',
  'sales.quotation.create',
  'sales.quotation.edit',
  'sales.quotation.issue',
  'sales.quotation.cancel',
  'sales.quotation.print',
  'sales.invoice.view',
  'sales.invoice.create',
  'sales.invoice.edit',
  'sales.invoice.issue',
  'sales.invoice.cancel',
  'sales.invoice.print',
  'sales.delivery.view',
  'sales.delivery.create',
  'sales.delivery.edit',
  'sales.delivery.issue',
  'sales.delivery.cancel',
  'sales.delivery.print',
  'purchases.view',
  'purchases.create',
  'purchases.edit',
  'purchases.delete',
  'receiving.view',
  'receiving.create',
  'receiving.link_purchase',
  'halal.view',
  'halal.manage',
  'opening_balance.view',
  'opening_balance.create',
  'inventory.view',
  'inventory.adjust',
  'inventory.transfer',
  'inventory.count',
  'inventory.usage',
  'warehouse_map.view',
  'warehouse_map.putaway',
  'warehouse_map.move',
  'warehouse_map.layout.edit',
  'warehouse_map.location.manage',
  'warehouse_map.balance.use',
  'manufacturing.view',
  'manufacturing.create',
  'manufacturing.edit',
  'manufacturing.start',
  'manufacturing.complete',
  'manufacturing.completed.edit',
  'manufacturing.history.view',
  'manufacturing.plan.edit',
  'manufacturing.plan.amend',
  'reports.view',
  'reports.export',
  'finance.view',
  'payments.view',
  'receivables.view',
  'payables.view',
  'expenses.manage',
  'users.view',
  'users.create',
  'users.edit',
  'users.role.change',
  'users.deactivate',
  'roles.view',
  'roles.create',
  'roles.edit',
  'roles.deactivate',
  'roles.permissions.manage',
  'settings.view',
  'settings.edit',
  'agent.view',
  'agent.manage',
  'agent.stock.view',
  'agent.stock.transfer',
  'agent.sale.create',
  'agent.sale.view',
  'agent.earnings.view',
  'agent.withdrawal.create',
  'agent.withdrawal.process',
  'task.view',
  'task.create',
  'task.edit',
  'task.assign',
  'task.complete',
  'task.category.manage',
  'sales_return.view',
  'sales_return.create',
  'sales_return.manage',
  'return_source.manage',
  'return_reason.manage',
  'customer.pricing.view',
  'customer.pricing.manage'
];

function emptyPermissions() {
  var next = {};
  PERMISSION_KEYS.forEach(function (key) { next[key] = false; });
  return next;
}

function fullPermissions() {
  var next = {};
  PERMISSION_KEYS.forEach(function (key) { next[key] = true; });
  return next;
}

function withPermissionKeys(keys) {
  var next = emptyPermissions();
  keys.forEach(function (key) { next[key] = true; });
  return next;
}

var SALES_CORE = ['sales.view', 'sales.create', 'sales.edit'];
var DOCUMENT_KEYS = [
  'sales.quotation.view', 'sales.quotation.create', 'sales.quotation.edit', 'sales.quotation.issue', 'sales.quotation.cancel', 'sales.quotation.print',
  'sales.invoice.view', 'sales.invoice.create', 'sales.invoice.edit', 'sales.invoice.issue', 'sales.invoice.cancel', 'sales.invoice.print',
  'sales.delivery.view', 'sales.delivery.create', 'sales.delivery.edit', 'sales.delivery.issue', 'sales.delivery.cancel', 'sales.delivery.print'
];
var PURCHASES_ALL = ['purchases.view', 'purchases.create', 'purchases.edit', 'purchases.delete'];
var RECEIVING_STAFF = ['receiving.view', 'receiving.create'];
var RECEIVING_ALL = ['receiving.view', 'receiving.create', 'receiving.link_purchase'];
var INVENTORY_ALL = ['inventory.view', 'inventory.adjust', 'inventory.transfer', 'inventory.count', 'inventory.usage'];
var AGENT_STOCK_OPS = ['agent.view', 'agent.stock.view', 'agent.stock.transfer'];
var WAREHOUSE_MAP_STAFF = ['warehouse_map.view', 'warehouse_map.putaway', 'warehouse_map.move', 'warehouse_map.balance.use'];
var WAREHOUSE_MAP_ALL = ['warehouse_map.view', 'warehouse_map.putaway', 'warehouse_map.move', 'warehouse_map.layout.edit', 'warehouse_map.location.manage', 'warehouse_map.balance.use'];
var MFG_RUN = ['manufacturing.view', 'manufacturing.create', 'manufacturing.edit', 'manufacturing.start', 'manufacturing.complete', 'manufacturing.history.view'];
var FINANCE_VIEW = ['finance.view', 'payments.view', 'receivables.view', 'payables.view'];
var TASK_STAFF = ['task.view', 'task.complete'];
var TASK_OPERATIONS = ['task.view', 'task.create', 'task.edit', 'task.assign', 'task.complete'];

function defaultPermissionsForLegacy(role) {
  if (role === 'owner' || role === 'admin') return fullPermissions();
  if (role === 'manager') {
    return withPermissionKeys([].concat(
      ['dashboard.view'], SALES_CORE, ['sales.void'], DOCUMENT_KEYS, PURCHASES_ALL, RECEIVING_ALL, INVENTORY_ALL,
      AGENT_STOCK_OPS, WAREHOUSE_MAP_ALL, MFG_RUN, ['reports.view'], FINANCE_VIEW, ['settings.view'], TASK_OPERATIONS
    ));
  }
  if (role === 'staff') {
    return withPermissionKeys([].concat(
      ['dashboard.view'], SALES_CORE, DOCUMENT_KEYS, RECEIVING_STAFF, ['inventory.view', 'inventory.usage'],
      WAREHOUSE_MAP_STAFF, MFG_RUN, ['reports.view'], TASK_STAFF
    ));
  }
  if (role === 'cashier') {
    return withPermissionKeys([].concat(
      SALES_CORE,
      ['sales.invoice.view', 'sales.invoice.print', 'sales.quotation.view', 'sales.quotation.print'],
      TASK_STAFF
    ));
  }
  return withPermissionKeys([].concat(
    ['dashboard.view'], PURCHASES_ALL, RECEIVING_STAFF, INVENTORY_ALL, AGENT_STOCK_OPS, WAREHOUSE_MAP_ALL, MFG_RUN,
    ['sales.delivery.view', 'sales.delivery.create', 'sales.delivery.edit', 'sales.delivery.issue', 'sales.delivery.print'],
    TASK_STAFF
  ));
}

function normalizePermissions(input) {
  var next = emptyPermissions();
  if (!input) return next;
  PERMISSION_KEYS.forEach(function (key) {
    next[key] = Boolean(input[key]);
  });
  return next;
}

function isOwnerRole(role) {
  return Boolean(role && (role.protected || role.legacyRole === 'owner'));
}

function roleById(snapshot, roleId) {
  if (!roleId) return null;
  for (var i = 0; i < snapshot.roles.length; i += 1) {
    if (snapshot.roles[i].id === roleId) return snapshot.roles[i];
  }
  return null;
}

function isOwnerUser(snapshot, user) {
  if (!user) return false;
  return isOwnerRole(roleById(snapshot, user.roleId)) || user.role === 'owner';
}

function hasPermission(snapshot, key, user) {
  if (!user || user.status !== 'active') return false;
  if (isOwnerUser(snapshot, user)) return true;
  var role = roleById(snapshot, user.roleId);
  if (!role) return false;
  var matrix = snapshot.settings && snapshot.settings.roleMatrix ? snapshot.settings.roleMatrix : {};
  return Boolean(matrix[role.id] && matrix[role.id][key]);
}

function canCreateUser(snapshot, actor) { return hasPermission(snapshot, 'users.create', actor); }
function canEditUserRecord(snapshot, actor) { return hasPermission(snapshot, 'users.edit', actor); }
function canCreateRole(snapshot, actor) { return hasPermission(snapshot, 'roles.create', actor); }
function canEditRoleRecord(snapshot, actor) { return hasPermission(snapshot, 'roles.edit', actor); }
function canManagePermissions(snapshot, actor) { return hasPermission(snapshot, 'roles.permissions.manage', actor); }

function canAssignRole(snapshot, actor, role, currentRoleId) {
  if (!role) return false;
  var mayChoose = hasPermission(snapshot, 'users.role.change', actor) || hasPermission(snapshot, 'users.create', actor) || role.id === currentRoleId;
  if (!mayChoose) return false;
  if (isOwnerRole(role) && !isOwnerUser(snapshot, actor)) return false;
  if (isOwnerRole(role) && currentRoleId !== role.id) return false;
  if (role.status !== 'active' && role.id !== currentRoleId) return false;
  return true;
}

function canChangeUserRole(snapshot, actor, target, nextRole) {
  if (!nextRole) return false;
  if (isOwnerUser(snapshot, target) && !isOwnerUser(snapshot, actor)) return false;
  if (isOwnerUser(snapshot, target) && nextRole.id !== target.roleId) return false;
  if (target.roleId === nextRole.id) return true;
  if (!hasPermission(snapshot, 'users.role.change', actor)) return false;
  return canAssignRole(snapshot, actor, nextRole, target.roleId);
}

function canDeactivateUser(snapshot, actor, target) {
  if (!hasPermission(snapshot, 'users.deactivate', actor)) return false;
  if (target.id === actor.id) return false;
  if (isOwnerUser(snapshot, target) && !isOwnerUser(snapshot, actor)) return false;
  if (isOwnerUser(snapshot, target)) {
    var otherOwners = snapshot.users.filter(function (user) {
      return user.id !== target.id && user.status === 'active' && isOwnerUser(snapshot, user);
    });
    if (!otherOwners.length) return false;
  }
  return true;
}

function canRenameRole(snapshot, actor, role) {
  if (!hasPermission(snapshot, 'roles.edit', actor)) return false;
  if (isOwnerRole(role)) return false;
  return true;
}

function canDeactivateRole(snapshot, actor, role) {
  if (!hasPermission(snapshot, 'roles.deactivate', actor)) return false;
  if (isOwnerRole(role)) return false;
  return true;
}
