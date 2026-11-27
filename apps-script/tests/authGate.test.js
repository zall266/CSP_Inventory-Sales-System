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
    ],
    users: [
      { id: 'u-owner', name: 'Owner', email: 'owner@coolslurppy.my', roleId: 'role-owner', departmentId: 'dept-management', status: 'active' },
      { id: 'u-admin', name: 'Admin', email: 'admin@coolslurppy.my', roleId: 'role-admin', departmentId: 'dept-management', status: 'active' },
      { id: 'u-supervisor', name: 'Supervisor', email: 'super@coolslurppy.my', roleId: 'role-supervisor', departmentId: 'dept-management', status: 'active' },
      { id: 'u-staff', name: 'Staff', email: 'staff@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-cashier', name: 'Cashier', email: 'cashier@coolslurppy.my', roleId: 'role-cashier', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-warehouse', name: 'Warehouse', email: 'wh@coolslurppy.my', roleId: 'role-warehouse', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-inactive', name: 'Inactive', email: 'inactive@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'inactive' },
    ],
    settings: {
      businessName: 'Cool Slurppy', legalName: 'Cool Slurppy Sdn Bhd', logoUrl: '', phone: '03',
      email: 'hello@coolslurppy.my', address: 'KL', website: '', registrationNo: '', bankName: '',
      bankAccount: '', paymentTerms: 'Net 7 days', documentTerms: 'Terms', currency: 'MYR',
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
  const context = loadBackend({
    PropertiesService: { getScriptProperties: () => options.properties || authDevProperties() },
    LockService: createNonReentrantScriptLock({ events: [], state: { held: false } }),
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

function ready() {
  const backend = app()
  backend.foundation.initialize()
  const payload = identityPayload()
  const matrix = {}
  for (const role of payload.roles) {
    matrix[role.id] = backend.context.defaultPermissionsForLegacy(role.legacyRole)
  }
  payload.settings.roleMatrix = matrix
  seedIdentity(backend, payload)
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
