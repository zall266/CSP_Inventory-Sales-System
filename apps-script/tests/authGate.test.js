import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attachAuthServices,
  authDevProperties,
  createFakeDrive,
  createFakeSpreadsheet,
  createNonReentrantScriptLock,
  loadBackend,
  seedIdentity,
} from './harness.js'

function identityPayload() {
  return {
    departments: [
      { id: 'dept-management', name: 'Management', status: 'active' },
      { id: 'dept-sales', name: 'Sales', status: 'active' },
    ],
    roles: [
      { id: 'role-owner', name: 'Owner', description: 'Owner', status: 'active', protected: true, legacyRole: 'owner' },
      { id: 'role-admin', name: 'Admin', description: 'Admin', status: 'active', protected: false, legacyRole: 'admin' },
      { id: 'role-supervisor', name: 'Supervisor', description: 'Supervisor', status: 'active', protected: false, legacyRole: 'manager' },
      { id: 'role-staff', name: 'Staff', description: 'Staff', status: 'active', protected: false, legacyRole: 'staff' },
      { id: 'role-cashier', name: 'Cashier', description: 'Cashier', status: 'active', protected: false, legacyRole: 'cashier' },
      { id: 'role-warehouse', name: 'Warehouse', description: 'Warehouse', status: 'active', protected: false, legacyRole: 'warehouse' },
      { id: 'role-settings-only', name: 'Settings Only', description: 'settings.view only', status: 'active', protected: false, legacyRole: 'staff' },
      { id: 'role-users-only', name: 'Users Only', description: 'users.view only', status: 'active', protected: false, legacyRole: 'staff' },
      { id: 'role-roles-only', name: 'Roles Only', description: 'roles.view only', status: 'active', protected: false, legacyRole: 'staff' },
    ],
    users: [
      { id: 'u-owner', name: 'Owner', email: 'owner@coolslurppy.my', roleId: 'role-owner', departmentId: 'dept-management', status: 'active' },
      { id: 'u-admin', name: 'Admin', email: 'admin@coolslurppy.my', roleId: 'role-admin', departmentId: 'dept-management', status: 'active' },
      { id: 'u-supervisor', name: 'Supervisor', email: 'super@coolslurppy.my', roleId: 'role-supervisor', departmentId: 'dept-management', status: 'active' },
      { id: 'u-staff', name: 'Staff', email: 'staff@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-cashier', name: 'Cashier', email: 'cashier@coolslurppy.my', roleId: 'role-cashier', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-warehouse', name: 'Warehouse', email: 'wh@coolslurppy.my', roleId: 'role-warehouse', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-inactive', name: 'Inactive', email: 'inactive@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'inactive' },
      { id: 'u-settings-only', name: 'Settings Only', email: 'settings-only@coolslurppy.my', roleId: 'role-settings-only', departmentId: 'dept-management', status: 'active' },
      { id: 'u-users-only', name: 'Users Only', email: 'users-only@coolslurppy.my', roleId: 'role-users-only', departmentId: 'dept-management', status: 'active' },
      { id: 'u-roles-only', name: 'Roles Only', email: 'roles-only@coolslurppy.my', roleId: 'role-roles-only', departmentId: 'dept-management', status: 'active' },
    ],
    settings: {
      businessName: 'Cool Slurppy', legalName: 'Cool Slurppy Sdn Bhd', logoUrl: '', phone: '03',
      email: 'hello@coolslurppy.my', address: 'KL', website: '', registrationNo: '123456-A', bankName: 'Maybank',
      bankAccount: '1234567890', paymentTerms: 'Net 7 days', documentTerms: 'Terms', currency: 'MYR',
      defaultWarehouseId: 'wh-main', allowNegativeStock: false, costingMethod: 'average',
      batchTracking: true, expiryTracking: true, defaultCustomerId: 'c-walkin', allowDiscount: true,
      allowReturns: true, enabledPaymentMethods: ['cash'], roleMatrix: {},
    },
    userAuditLogs: [],
  }
}

function app(options = {}) {
  let current = options.nowMs ?? Date.parse('2026-04-01T00:00:00.000Z')
  const spreadsheet = createFakeSpreadsheet()
  const drive = createFakeDrive('drive-id')
  const lockEvents = options.lockEvents || []
  const context = loadBackend({
    PropertiesService: { getScriptProperties: () => options.properties || authDevProperties() },
    LockService: createNonReentrantScriptLock({ events: lockEvents, state: options.lockState || { held: false } }),
    SpreadsheetApp: { openById: () => spreadsheet },
    DriveApp: drive,
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) {
        return { text, setMimeType() { return this } }
      },
    },
  })
  const sheets = context.createSheetRepository({ openSpreadsheet: () => spreadsheet })
  const driveStorage = context.createDriveStorage({
    getRoot: () => drive.getFolderById('drive-id'),
    getFileById: (id) => drive.getFileById(id),
  })
  const backend = attachAuthServices({
    sheets,
    drive,
    spreadsheet,
    context,
    driveStorage,
    system: context.createSystemService({ sheetRepository: sheets, driveStorage }),
    idempotency: context.createIdempotencyService(sheets),
    foundation: context.createFoundationService(sheets),
    identity: context.createIdentityService({ sheetRepository: sheets, driveStorage }),
    masters: context.createMasterService({ sheetRepository: sheets }),
    products: context.createProductService({ sheetRepository: sheets, driveStorage }),
    parties: context.createPartyService({ sheetRepository: sheets }),
    inventory: context.createInventoryService({ sheetRepository: sheets }),
    warehouse: context.createWarehouseService({ sheetRepository: sheets }),
    purchases: context.createPurchaseService({ sheetRepository: sheets }),
    sales: context.createSalesService({ sheetRepository: sheets }),
    reporting: context.createReportingService({ sheetRepository: sheets }),
    nowFn: () => new Date(current),
  }, { defaultActorId: 'u-owner', now: () => new Date(current) })
  backend.tick = (ms) => { current += ms }
  return backend
}

function request(action, payload, extra = {}) {
  return {
    v: 1,
    requestId: extra.requestId || action,
    action,
    payload: payload || {},
    sessionToken: extra.sessionToken,
  }
}

function call(backend, action, payload, extra = {}) {
  const next = { ...extra }
  if (next.anonymous) {
    if (next.sessionToken === undefined) next.sessionToken = ''
  } else if (next.sessionToken === undefined) {
    next.sessionToken = backend.sessionFor(next.asUser || (payload && payload.actorUserId) || 'u-owner')
  }
  return backend.context.handleRequest(request(action, payload, next), backend)
}

function grantOnly(backend, roleId, keys) {
  const allowed = new Set(keys)
  const header = backend.spreadsheet.store.RolePermissions[0]
  const kept = backend.spreadsheet.store.RolePermissions.filter((row, index) => index === 0 || row[0] !== roleId)
  backend.context.PERMISSION_KEYS.forEach((key) => {
    kept.push([roleId, key, allowed.has(key)])
  })
  kept[0] = header
  backend.spreadsheet.store.RolePermissions = kept
}

function ready(options = {}) {
  const backend = app(options)
  backend.foundation.initialize()
  const payload = identityPayload()
  const matrix = {}
  for (const role of payload.roles) {
    matrix[role.id] = backend.context.defaultPermissionsForLegacy(role.legacyRole)
  }
  payload.settings.roleMatrix = matrix
  seedIdentity(backend, payload)
  grantOnly(backend, 'role-settings-only', ['settings.view'])
  grantOnly(backend, 'role-users-only', ['users.view'])
  grantOnly(backend, 'role-roles-only', ['roles.view'])
  return backend
}

function serviceActionNames(context) {
  const maps = [
    context.AUTH_ACTIONS,
    context.IDENTITY_ACTIONS,
    context.MASTER_ACTIONS,
    context.PRODUCT_ACTIONS,
    context.PARTY_ACTIONS,
    context.INVENTORY_ACTIONS,
    context.WAREHOUSE_ACTIONS,
    context.BOM_ACTIONS,
    context.OPENING_BALANCE_ACTIONS,
    context.PURCHASE_ACTIONS,
    context.RECEIVING_ACTIONS,
    context.PACKING_ACTIONS,
    context.PRODUCTION_ORDER_ACTIONS,
    context.SESSION_ACTIONS,
    context.SALES_ACTIONS,
    context.SALES_RETURN_ACTIONS,
    context.SALES_IMPORT_ACTIONS,
    context.DISPATCH_ACTIONS,
    context.OPS_ACTIONS,
    context.REPORTING_ACTIONS,
  ]
  const names = new Set(['system.health', 'system.ping'])
  for (const map of maps) {
    Object.keys(map || {}).forEach((key) => names.add(key))
  }
  return names
}

test('every dispatched action is classified and none are left unmapped', () => {
  const context = loadBackend()
  const dispatched = serviceActionNames(context)
  const classified = new Set(context.listAuthorizedActions())
  const unmapped = [...dispatched].filter((action) => !classified.has(action))
  const extra = [...classified].filter((action) => !dispatched.has(action))
  assert.deepEqual(unmapped, [])
  assert.deepEqual(extra, [])
  const publicActions = [...classified].filter((action) => context.getActionAuthorization(action).access === 'public')
  const ownerOnly = [...classified].filter((action) => context.getActionAuthorization(action).access === 'owner')
  const disabled = [...classified].filter((action) => context.getActionAuthorization(action).access === 'disabled')
  assert.deepEqual(publicActions.sort(), ['auth.login', 'system.health', 'system.ping'])
  assert.equal(classified.size, dispatched.size)
  assert.equal(disabled.length, 0)
  assert.ok(ownerOnly.includes('identity.bootstrap'))
  assert.equal(ownerOnly.length, 6)
})

test('anonymous callers cannot read business data or bootstrap', () => {
  const backend = ready()
  const actions = [
    'identity.get', 'users.list', 'settings.get', 'products.list', 'products.get',
    'products.getImage', 'inventory.get', 'masters.get', 'parties.get',
    'dashboard.get', 'reports.sales', 'identity.bootstrap', 'masters.bootstrap',
  ]
  for (const action of actions) {
    const none = call(backend, action, {}, { anonymous: true })
    const empty = call(backend, action, {}, { sessionToken: '' })
    const bogus = call(backend, action, {}, { sessionToken: 'ab'.repeat(32) })
    assert.equal(none.error.code, 'UNAUTHORIZED', action)
    assert.equal(empty.error.code, 'UNAUTHORIZED', action)
    assert.equal(bogus.error.code, 'UNAUTHORIZED', action)
  }
  const health = call(backend, 'system.health', {}, { anonymous: true })
  const ping = call(backend, 'system.ping', {}, { anonymous: true })
  const login = call(backend, 'auth.login', { email: 'missing@coolslurppy.my', password: 'x' }, { anonymous: true })
  assert.equal(health.ok, true)
  assert.equal(ping.ok, true)
  assert.equal(login.error.code, 'UNAUTHORIZED')
})

test('client-supplied actor and role flags are ignored', () => {
  const backend = ready()
  const created = call(backend, 'users.create', {
    actorUserId: 'u-owner',
    roleId: 'role-staff',
    role: 'owner',
    departmentId: 'dept-sales',
    permissions: { 'users.create': true },
    isOwner: true,
    name: 'Forged',
    email: 'forged@coolslurppy.my',
  }, { asUser: 'u-staff' })
  assert.equal(created.error.code, 'FORBIDDEN')
  const owner = call(backend, 'users.create', {
    actorUserId: 'u-staff',
    role: 'staff',
    isOwner: false,
    name: 'Real',
    email: 'real@coolslurppy.my',
    roleId: 'role-staff',
    departmentId: 'dept-sales',
  }, { asUser: 'u-owner' })
  assert.equal(owner.ok, true, owner.error && owner.error.message)
  assert.equal(owner.data.userAuditLogs[0].changedBy, 'Owner')
})

test('staff cannot administer users, roles, settings, or unauthorized finance', () => {
  const backend = ready()
  const staff = { asUser: 'u-staff' }
  assert.equal(call(backend, 'users.create', {
    name: 'X', email: 'x@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales',
  }, staff).error.code, 'FORBIDDEN')
  assert.equal(call(backend, 'users.list', {}, staff).error.code, 'FORBIDDEN')
  assert.equal(call(backend, 'roles.create', { name: 'Picker' }, staff).error.code, 'FORBIDDEN')
  assert.equal(call(backend, 'roles.savePermissions', { roleId: 'role-staff', permissions: {} }, staff).error.code, 'FORBIDDEN')
  assert.equal(call(backend, 'settings.update', { patch: { businessName: 'Hack' } }, staff).error.code, 'FORBIDDEN')
  assert.equal(call(backend, 'expenses.create', {
    category: 'Rent', amount: 10, method: 'cash', date: '2026-04-01',
  }, staff).error.code, 'FORBIDDEN')
  assert.equal(call(backend, 'identity.bootstrap', identityPayload(), staff).error.code, 'FORBIDDEN')
})

test('supervisor, cashier, and warehouse follow the existing matrix', () => {
  const backend = ready()
  assert.equal(call(backend, 'dashboard.get', {}, { asUser: 'u-supervisor' }).ok, true)
  assert.equal(call(backend, 'users.create', {
    name: 'Nope', email: 'nope@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales',
  }, { asUser: 'u-supervisor' }).error.code, 'FORBIDDEN')
  assert.equal(call(backend, 'sales.create', {
    customerId: 'c-walkin', warehouseId: 'wh-main', lines: [],
  }, { asUser: 'u-cashier' }).error.code !== 'UNAUTHORIZED', true)
  assert.equal(call(backend, 'users.list', {}, { asUser: 'u-cashier' }).error.code, 'FORBIDDEN')
  assert.equal(call(backend, 'purchases.list', {}, { asUser: 'u-warehouse' }).ok, true)
  assert.equal(call(backend, 'users.list', {}, { asUser: 'u-warehouse' }).error.code, 'FORBIDDEN')
  assert.equal(call(backend, 'users.list', {}, { asUser: 'u-owner' }).ok, true)
})

test('inactive and missing users cannot keep using a session', () => {
  const backend = ready()
  const token = backend.authStore.issueSession({ userId: 'u-inactive' }).token
  const inactive = call(backend, 'dashboard.get', {}, { sessionToken: token })
  assert.equal(inactive.error.code, 'UNAUTHORIZED')
  const missing = backend.authStore.issueSession({ userId: 'nobody' }).token
  const gone = call(backend, 'dashboard.get', {}, { sessionToken: missing })
  assert.equal(gone.error.code, 'UNAUTHORIZED')
  const live = backend.sessionFor('u-staff')
  const listed = backend.identity.dispatch({
    v: 1, requestId: 'deactivate', action: 'users.update',
    payload: { actorUserId: 'u-owner', id: 'u-staff', patch: { status: 'inactive' } },
  })
  assert.equal(listed.ok, true)
  const after = call(backend, 'dashboard.get', {}, { sessionToken: live })
  assert.equal(after.error.code, 'UNAUTHORIZED')
})

test('login throttles repeated failures and recovers after cooldown', () => {
  const backend = ready()
  const secret = backend.authStore.issueCredential({
    userId: 'u-owner',
    username: 'owner@coolslurppy.my',
    createdBy: 'setup',
  })
  for (let i = 0; i < 5; i += 1) {
    const fail = call(backend, 'auth.login', { email: 'owner@coolslurppy.my', password: 'ffff'.repeat(16) }, { anonymous: true })
    assert.equal(fail.error.code, 'UNAUTHORIZED')
    assert.equal(fail.error.message, 'Email or password is incorrect.')
  }
  const cooled = call(backend, 'auth.login', { email: 'owner@coolslurppy.my', password: secret.plaintext }, { anonymous: true })
  assert.equal(cooled.error.code, 'UNAUTHORIZED')
  const stored = JSON.stringify(backend.spreadsheet.store.AuthLoginAttempts || [])
  assert.equal(stored.includes('owner@coolslurppy.my'), false)
  assert.equal(stored.includes(secret.plaintext), false)
  backend.tick(60 * 1000)
  const ok = call(backend, 'auth.login', { email: 'owner@coolslurppy.my', password: secret.plaintext }, { anonymous: true })
  assert.equal(ok.ok, true, ok.error && ok.error.message)
})

test('expired and revoked sessions cannot call business APIs', () => {
  const backend = ready()
  const token = backend.sessionFor('u-owner')
  assert.equal(call(backend, 'dashboard.get', {}, { sessionToken: token }).ok, true)
  backend.tick(backend.context.AUTH_SESSION_IDLE_MS)
  assert.equal(call(backend, 'dashboard.get', {}, { sessionToken: token }).error.code, 'UNAUTHORIZED')
  const fresh = backend.authStore.issueSession({ userId: 'u-owner' }).token
  backend.authStore.revokeCurrentSession(fresh, 'logout')
  assert.equal(call(backend, 'users.list', {}, { sessionToken: fresh }).error.code, 'UNAUTHORIZED')
})

test('public future auth actions are not inferred from the auth. prefix', () => {
  const backend = ready()
  const register = call(backend, 'auth.register', { email: 'x@y.z' }, { anonymous: true })
  assert.equal(register.error.code, 'UNAUTHORIZED')
  const owner = call(backend, 'auth.register', { email: 'x@y.z' }, { asUser: 'u-owner' })
  assert.equal(owner.error.code, 'UNKNOWN_ACTION')
})

test('identity.get redacts users, roles, and bank details by permission', () => {
  const backend = ready()
  const owner = call(backend, 'identity.get', {}, { asUser: 'u-owner' })
  assert.equal(owner.ok, true, owner.error && owner.error.message)
  assert.ok(owner.data.users.some((user) => user.id === 'u-staff'))
  assert.ok(owner.data.roles.some((role) => role.id === 'role-cashier'))
  assert.equal(owner.data.settings.bankName, 'Maybank')
  assert.equal(owner.data.settings.bankAccount, '1234567890')
  assert.ok(owner.data.settings.roleMatrix['role-staff'])

  const settingsOnly = call(backend, 'identity.get', {}, { asUser: 'u-settings-only' })
  assert.equal(settingsOnly.ok, true, settingsOnly.error && settingsOnly.error.message)
  assert.deepEqual(settingsOnly.data.users.map((user) => user.id), ['u-settings-only'])
  assert.deepEqual(settingsOnly.data.roles.map((role) => role.id), ['role-settings-only'])
  assert.equal(settingsOnly.data.settings.bankName, 'Maybank')
  assert.equal(settingsOnly.data.settings.bankAccount, '1234567890')
  assert.equal(settingsOnly.data.settings.roleMatrix['role-staff'], undefined)
  assert.equal(settingsOnly.data.settings.roleMatrix['role-owner'], undefined)
  assert.ok(settingsOnly.data.settings.roleMatrix['role-settings-only'])
  assert.equal(settingsOnly.data.userAuditLogs.length, 0)
  assert.equal(call(backend, 'users.list', {}, { asUser: 'u-settings-only' }).error.code, 'FORBIDDEN')

  const usersOnly = call(backend, 'identity.get', {}, { asUser: 'u-users-only' })
  assert.equal(usersOnly.ok, true, usersOnly.error && usersOnly.error.message)
  assert.ok(usersOnly.data.users.some((user) => user.id === 'u-owner'))
  assert.ok(usersOnly.data.users.some((user) => user.id === 'u-staff'))
  assert.equal(usersOnly.data.settings.bankName, '')
  assert.equal(usersOnly.data.settings.bankAccount, '')
  assert.equal(usersOnly.data.settings.businessName, 'Cool Slurppy')
  assert.equal(usersOnly.data.settings.roleMatrix['role-staff'], undefined)
  assert.ok(usersOnly.data.settings.roleMatrix['role-users-only'])
  assert.ok(usersOnly.data.roles.some((role) => role.id === 'role-owner'))

  const rolesOnly = call(backend, 'identity.get', {}, { asUser: 'u-roles-only' })
  assert.equal(rolesOnly.ok, true, rolesOnly.error && rolesOnly.error.message)
  assert.deepEqual(rolesOnly.data.users.map((user) => user.id), ['u-roles-only'])
  assert.ok(rolesOnly.data.roles.some((role) => role.id === 'role-owner'))
  assert.ok(rolesOnly.data.settings.roleMatrix['role-staff'])
  assert.equal(rolesOnly.data.settings.bankName, '')
  assert.equal(rolesOnly.data.settings.bankAccount, '')
  assert.equal(call(backend, 'settings.get', {}, { asUser: 'u-roles-only' }).error.code, 'FORBIDDEN')
})

test('active users may perform existing session-only product, category, and party writes', () => {
  const backend = ready()
  assert.equal(call(backend, 'masters.bootstrap', {
    warehouses: [{ id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', kind: 'company' }],
    categories: [{ id: 'cat-seed', name: 'Seed' }],
  }, { asUser: 'u-owner' }).ok, true)
  const category = call(backend, 'categories.create', {
    id: 'cat-ing', name: 'Ingredients',
  }, { asUser: 'u-cashier' })
  assert.equal(category.ok, true, category.error && category.error.message)
  const renamed = call(backend, 'categories.rename', {
    id: 'cat-ing', name: 'Raw Ingredients',
  }, { asUser: 'u-warehouse' })
  assert.equal(renamed.ok, true, renamed.error && renamed.error.message)

  const cashierProduct = call(backend, 'products.create', {
    id: 'prd-cashier', name: 'Cashier Mix', sku: 'CASH-1', categoryId: 'cat-ing',
    unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1, purchaseCost: 1, sellingPrice: 2,
  }, { asUser: 'u-cashier' })
  assert.equal(cashierProduct.ok, true, cashierProduct.error && cashierProduct.error.message)
  const warehouseEdit = call(backend, 'products.update', {
    id: 'prd-cashier', name: 'Warehouse Mix',
  }, { asUser: 'u-warehouse' })
  assert.equal(warehouseEdit.ok, true, warehouseEdit.error && warehouseEdit.error.message)
  const staffStatus = call(backend, 'products.setStatus', {
    id: 'prd-cashier', status: 'inactive',
  }, { asUser: 'u-staff' })
  assert.equal(staffStatus.ok, true, staffStatus.error && staffStatus.error.message)

  const customer = call(backend, 'customers.create', {
    id: 'cus-staff', name: 'Walk-in Extra',
  }, { asUser: 'u-staff' })
  assert.equal(customer.ok, true, customer.error && customer.error.message)
  const supplier = call(backend, 'suppliers.create', {
    id: 'sup-cashier', name: 'Cashier Supplier',
  }, { asUser: 'u-cashier' })
  assert.equal(supplier.ok, true, supplier.error && supplier.error.message)
  assert.equal(call(backend, 'users.create', {
    name: 'Nope', email: 'nope2@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales',
  }, { asUser: 'u-cashier' }).error.code, 'FORBIDDEN')
})

test('login holds one script lock across throttle check and failure recording', () => {
  const lockEvents = []
  const backend = ready({ lockEvents })
  backend.authStore.issueCredential({
    userId: 'u-owner',
    username: 'owner@coolslurppy.my',
    createdBy: 'setup',
  })
  lockEvents.length = 0
  const fail = call(backend, 'auth.login', {
    email: 'owner@coolslurppy.my', password: 'ffff'.repeat(16),
  }, { anonymous: true })
  assert.equal(fail.error.code, 'UNAUTHORIZED')
  assert.equal(lockEvents.filter((event) => event === 'acquired').length, 1)
  assert.equal(lockEvents.includes('nested-rejected'), false)
})
