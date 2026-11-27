// AUTH-2 exhaustive action classification. Every router-dispatched action is
// listed here. Unlisted actions are rejected. Public access is not inferred
// from action-name prefixes. Permission keys come from permissionCatalog.js.

function authPermission(keys) {
  var list = Array.isArray(keys) ? keys.slice() : [keys];
  return { access: 'permission', permissions: list };
}

function authOwnerOnly() {
  return { access: 'owner', permissions: [] };
}

function authSessionOnly() {
  return { access: 'authenticated', permissions: [] };
}

function authPublic() {
  return { access: 'public', permissions: [] };
}

var SALES_LIST = ['sales.view', 'sales.create', 'sales.invoice.view', 'sales.quotation.view', 'sales.delivery.view'];
var SALES_IMPORT_READ = ['sales.view', 'sales.create'];
var SALES_RETURN_LIST = ['sales_return.view', 'sales_return.create', 'sales_return.manage', 'return_source.manage', 'return_reason.manage'];
var SALES_RETURN_GET = ['sales_return.view', 'sales_return.create', 'sales_return.manage'];
var DISPATCH_READ = ['sales.delivery.view', 'sales.delivery.create', 'sales.delivery.edit', 'settings.edit'];
var HALAL_READ = ['halal.view', 'halal.manage'];
var TASK_READ = ['task.view', 'task.create', 'task.edit', 'task.complete', 'task.category.manage'];
var EXPENSE_READ = ['expenses.manage', 'finance.view'];
var PRODUCT_IMAGE_GET = ['sales.create', 'agent.sale.create', 'products.edit'];
var RECIPE_PHOTO_GET = ['manufacturing.view', 'manufacturing.history.view'];

var ACTION_AUTHORIZATION = {
  'system.health': authPublic(),
  'system.ping': authPublic(),
  'auth.login': authPublic(),
  'auth.logout': authSessionOnly(),
  'auth.session': authSessionOnly(),

  'identity.get': authSessionOnly(),
  'identity.bootstrap': authOwnerOnly(),
  'settings.get': authPermission('settings.view'),
  'settings.update': authPermission('settings.edit'),
  'users.list': authPermission('users.view'),
  'users.create': authPermission('users.create'),
  'users.update': authPermission(['users.edit', 'users.role.change', 'users.deactivate']),
  'roles.create': authPermission('roles.create'),
  'roles.update': authPermission('roles.edit'),
  'roles.setStatus': authPermission(['roles.deactivate', 'roles.edit']),
  'roles.savePermissions': authPermission('roles.permissions.manage'),
  'roles.updateMatrix': authPermission('roles.permissions.manage'),

  'masters.get': authSessionOnly(),
  'masters.bootstrap': authOwnerOnly(),
  'warehouses.list': authSessionOnly(),
  'warehouses.get': authSessionOnly(),
  'categories.list': authSessionOnly(),
  'categories.get': authSessionOnly(),
  'categories.create': authSessionOnly(),
  'categories.rename': authSessionOnly(),

  'products.list': authSessionOnly(),
  'products.get': authSessionOnly(),
  'products.bootstrap': authOwnerOnly(),
  'products.create': authSessionOnly(),
  'products.update': authSessionOnly(),
  'products.setStatus': authSessionOnly(),
  'products.saveAgentPrices': authPermission('agent.manage'),
  'products.getImage': authPermission(PRODUCT_IMAGE_GET),
  'products.uploadImage': authPermission('products.edit'),
  'products.replaceImage': authPermission('products.edit'),
  'products.removeImage': authPermission('products.edit'),

  'parties.get': authSessionOnly(),
  'parties.bootstrap': authOwnerOnly(),
  'customers.list': authSessionOnly(),
  'customers.get': authSessionOnly(),
  'customers.create': authSessionOnly(),
  'customers.saveWholesalePrice': authPermission('customer.pricing.manage'),
  'customers.deactivateWholesalePrice': authPermission('customer.pricing.manage'),
  'suppliers.list': authSessionOnly(),
  'suppliers.get': authSessionOnly(),
  'suppliers.create': authSessionOnly(),
  'agents.list': authSessionOnly(),
  'agents.get': authSessionOnly(),
  'agents.create': authPermission('agent.manage'),
  'agents.update': authPermission('agent.manage'),
  'agents.setStatus': authPermission('agent.manage'),

  'inventory.get': authPermission('inventory.view'),
  'inventory.adjust': authPermission('inventory.adjust'),
  'inventory.usage': authPermission('inventory.usage'),
  'inventory.transfer': authPermission('inventory.transfer'),
  'inventory.count': authPermission('inventory.count'),
  'inventory.markOrdered': authPermission('inventory.adjust'),
  'inventory.cancelOrder': authPermission('inventory.adjust'),

  'warehouse.get': authPermission('warehouse_map.view'),
  'warehouse.bootstrap': authOwnerOnly(),
  'warehouse.place': authPermission('warehouse_map.putaway'),
  'warehouse.move': authPermission('warehouse_map.move'),
  'warehouse.topUp': authPermission('warehouse_map.move'),
  'warehouse.empty': authPermission('warehouse_map.move'),
  'warehouse.ensurePalletSlot': authPermission('warehouse_map.putaway'),
  'warehouse.createTemporary': authPermission('warehouse_map.location.manage'),
  'warehouse.createRack': authPermission('warehouse_map.layout.edit'),
  'warehouse.rename': authPermission('warehouse_map.location.manage'),
  'warehouse.deactivate': authPermission('warehouse_map.location.manage'),
  'warehouse.useBalance': authPermission('warehouse_map.balance.use'),

  'boms.list': authPermission('manufacturing.view'),
  'boms.get': authPermission('manufacturing.view'),
  'boms.bootstrap': authOwnerOnly(),
  'boms.create': authPermission('manufacturing.create'),
  'boms.update': authPermission('manufacturing.edit'),
  'boms.setStatus': authPermission('manufacturing.edit'),

  'openingBalances.list': authPermission('opening_balance.view'),
  'openingBalances.get': authPermission('opening_balance.view'),
  'openingBalances.save': authPermission('opening_balance.create'),
  'openingBalances.update': authPermission('opening_balance.create'),
  'openingBalances.confirm': authPermission('opening_balance.create'),

  'purchases.list': authPermission('purchases.view'),
  'purchases.get': authPermission('purchases.view'),
  'purchases.create': authPermission('purchases.create'),
  'purchases.receive': authPermission('purchases.create'),
  'purchases.recordPayment': authPermission('purchases.create'),
  'purchaseReturns.create': authPermission('purchases.create'),

  'receivings.list': authPermission('receiving.view'),
  'receivings.get': authPermission('receiving.view'),
  'receivings.create': authPermission('receiving.create'),
  'receivings.linkPurchase': authPermission('receiving.link_purchase'),

  'packing.list': authPermission('manufacturing.view'),
  'packing.get': authPermission('manufacturing.view'),
  'packing.create': authPermission('manufacturing.create'),
  'packing.update': authPermission('manufacturing.edit'),
  'packing.refresh': authPermission('manufacturing.edit'),
  'packing.cancel': authPermission('manufacturing.edit'),
  'packing.confirm': authPermission('manufacturing.complete'),

  'productionOrders.list': authPermission('manufacturing.view'),
  'productionOrders.get': authPermission('manufacturing.view'),
  'productionOrders.create': authPermission('manufacturing.create'),
  'productionOrders.update': authPermission('manufacturing.edit'),
  'productionOrders.start': authPermission('manufacturing.start'),
  'productionOrders.pause': authPermission('manufacturing.start'),
  'productionOrders.resume': authPermission('manufacturing.start'),
  'productionOrders.cancel': authPermission('manufacturing.edit'),
  'productionOrders.updateConsumption': authPermission('manufacturing.edit'),
  'productionOrders.addLine': authPermission('manufacturing.edit'),
  'productionOrders.confirmConsumption': authPermission('manufacturing.complete'),
  'productionOrders.recordWastage': authPermission('manufacturing.edit'),
  'productionOrders.complete': authPermission('manufacturing.complete'),
  'productionOrders.createPurchaseRequest': authPermission('manufacturing.view'),

  'sessions.list': authPermission('manufacturing.view'),
  'sessions.get': authPermission('manufacturing.view'),
  'sessions.getRecipePhoto': authPermission(RECIPE_PHOTO_GET),
  'sessions.create': authPermission('manufacturing.create'),
  'sessions.accept': authPermission('manufacturing.start'),
  'sessions.start': authPermission('manufacturing.start'),
  'sessions.cancelPlanned': authPermission('manufacturing.plan.edit'),
  'sessions.update': authPermission('manufacturing.plan.edit'),
  'sessions.amend': authPermission('manufacturing.plan.amend'),
  'sessions.changeTarget': authPermission('manufacturing.plan.amend'),
  'sessions.togglePicking': authPermission('manufacturing.start'),
  'sessions.addMaterial': authPermission('manufacturing.start'),
  'sessions.saveResult': authPermission('manufacturing.complete'),
  'sessions.saveDistribution': authPermission('manufacturing.complete'),
  'sessions.saveMaterialClosing': authPermission('manufacturing.complete'),
  'sessions.complete': authPermission('manufacturing.complete'),
  'sessions.continueCarryForward': authPermission('manufacturing.create'),
  'sessions.editCompleted': authPermission('manufacturing.completed.edit'),
  'sessions.editCompletedClosing': authPermission('manufacturing.completed.edit'),

  'sales.list': authPermission(SALES_LIST),
  'sales.get': authPermission(SALES_LIST),
  'sales.create': authPermission('sales.create'),
  'sales.createWholesale': authPermission(['sales.create', 'sales.invoice.create']),
  'sales.void': authPermission(['sales.void', 'sales.invoice.cancel']),
  'sales.recordPayment': authPermission(['sales.create', 'sales.invoice.create', 'sales.invoice.edit']),
  'quotations.list': authPermission(SALES_LIST),
  'quotations.get': authPermission('sales.quotation.view'),
  'quotations.create': authPermission('sales.quotation.create'),
  'quotations.update': authPermission('sales.quotation.edit'),
  'quotations.setStatus': authPermission(['sales.quotation.edit', 'sales.quotation.issue', 'sales.quotation.cancel']),
  'quotations.convert': authPermission(['sales.invoice.create', 'sales.create']),
  'deliveries.list': authPermission(SALES_LIST),
  'deliveries.get': authPermission('sales.delivery.view'),
  'deliveries.create': authPermission('sales.delivery.create'),
  'deliveries.update': authPermission('sales.delivery.edit'),
  'deliveries.setStatus': authPermission(['sales.delivery.edit', 'sales.delivery.issue', 'sales.delivery.cancel']),
  'documents.recordPrint': authPermission(['sales.quotation.print', 'sales.invoice.print', 'sales.delivery.print']),

  'salesReturns.list': authPermission(SALES_RETURN_LIST),
  'salesReturns.get': authPermission(SALES_RETURN_GET),
  'salesReturns.save': authPermission('sales_return.create'),
  'salesReturns.update': authPermission('sales_return.create'),
  'salesReturns.confirm': authPermission('sales_return.create'),
  'salesReturns.cancel': authPermission(['sales_return.manage', 'sales_return.create']),
  'returnSources.list': authPermission(SALES_RETURN_LIST),
  'returnSources.upsert': authPermission('return_source.manage'),
  'returnSources.setActive': authPermission('return_source.manage'),
  'returnReasons.list': authPermission(SALES_RETURN_LIST),
  'returnReasons.upsert': authPermission('return_reason.manage'),
  'returnReasons.setActive': authPermission('return_reason.manage'),

  'salesImport.list': authPermission(SALES_IMPORT_READ),
  'salesImport.get': authPermission(SALES_IMPORT_READ),
  'salesImport.createAccount': authPermission('sales.create'),
  'salesImport.createBatch': authPermission('sales.create'),
  'salesImport.ingestPicking': authPermission('sales.create'),
  'salesImport.ingestAwb': authPermission('sales.create'),
  'salesImport.acknowledge': authPermission('sales.create'),
  'salesImport.spotCheck': authPermission('sales.create'),
  'salesImport.saveMapping': authPermission('sales.create'),
  'salesImport.updateMapping': authPermission('sales.create'),
  'salesImport.setMappingActive': authPermission('sales.create'),
  'salesImport.confirm': authPermission('sales.create'),

  'dispatch.list': authPermission(DISPATCH_READ),
  'dispatch.get': authPermission(DISPATCH_READ),
  'vehicles.create': authPermission('settings.edit'),
  'vehicles.update': authPermission('settings.edit'),
  'vehicles.setActive': authPermission('settings.edit'),
  'dispatch.create': authPermission('sales.delivery.create'),
  'dispatch.update': authPermission(['sales.delivery.create', 'sales.delivery.edit']),
  'dispatch.confirm': authPermission('sales.delivery.create'),
  'dispatch.void': authPermission('sales.delivery.edit'),
  'dispatch.createInspectionGroup': authPermission('sales.delivery.edit'),
  'dispatch.release': authPermission('sales.delivery.edit'),

  'halal.list': authPermission(HALAL_READ),
  'halal.saveManufacturer': authPermission('halal.manage'),
  'halal.saveCompliance': authPermission('halal.manage'),
  'tasks.list': authPermission(TASK_READ),
  'tasks.createCategory': authPermission('task.category.manage'),
  'tasks.updateCategory': authPermission('task.category.manage'),
  'tasks.deactivateCategory': authPermission('task.category.manage'),
  'tasks.create': authPermission('task.create'),
  'tasks.update': authPermission('task.edit'),
  'tasks.deactivate': authPermission('task.edit'),
  'tasks.start': authPermission('task.complete'),
  'tasks.attachPhoto': authPermission('task.complete'),
  'tasks.complete': authPermission('task.complete'),
  'expenses.list': authPermission(EXPENSE_READ),
  'expenses.create': authPermission('expenses.manage'),

  'dashboard.get': authPermission('dashboard.view'),
  'reports.sales': authPermission('reports.view'),
  'reports.purchases': authPermission('reports.view'),
  'reports.inventory': authPermission('reports.view'),
  'reports.profit': authPermission('reports.view'),
  'reports.manufacturing': authPermission('reports.view'),
  'pjkm.511': authPermission('receiving.view'),
  'pjkm.911': authPermission('receiving.view'),
  'pjkm.1011': authPermission('receiving.view'),
  'bmr.list': authPermission('manufacturing.history.view'),
  'bmr.get': authPermission('manufacturing.history.view')
};

function getActionAuthorization(action) {
  if (!Object.prototype.hasOwnProperty.call(ACTION_AUTHORIZATION, action)) return null;
  return ACTION_AUTHORIZATION[action];
}

function isPublicAction(action) {
  var spec = getActionAuthorization(action);
  return Boolean(spec && spec.access === 'public');
}

function listAuthorizedActions() {
  return Object.keys(ACTION_AUTHORIZATION);
}

function principalMay(snapshot, user, spec) {
  if (!spec) return false;
  if (spec.access === 'public') return true;
  if (!user || user.status !== 'active') return false;
  if (spec.access === 'authenticated') return true;
  if (spec.access === 'owner') return isOwnerUser(snapshot, user);
  if (spec.access === 'disabled') return false;
  if (spec.access !== 'permission') return false;
  var keys = spec.permissions || [];
  var i;
  for (i = 0; i < keys.length; i += 1) {
    if (hasPermission(snapshot, keys[i], user)) return true;
  }
  return false;
}
