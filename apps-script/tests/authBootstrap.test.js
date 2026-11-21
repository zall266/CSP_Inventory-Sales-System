import assert from 'node:assert/strict'
import { pbkdf2Sync } from 'node:crypto'
import test from 'node:test'
import {
  createFakeDrive,
  createFakeSpreadsheet,
  devProperties,
  HARNESS_IDENTITY_BOOTSTRAP_SECRET,
  loadBackend,
} from './harness.js'

function app(propertyOverrides = {}) {
  const spreadsheet = createFakeSpreadsheet()
  const drive = createFakeDrive('drive-id')
  const properties = devProperties()
  Object.entries(propertyOverrides).forEach(([key, value]) => {
    if (value === null) properties.deleteProperty(key)
    else properties.setProperty(key, value)
  })
  const context = loadBackend({
    PropertiesService: { getScriptProperties: () => properties },
    LockService: {
      getScriptLock() {
        return { tryLock: () => true, releaseLock() {} }
      },
    },
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
  return {
    sheets,
    spreadsheet,
    properties,
    context,
    system: context.createSystemService({ sheetRepository: sheets, driveStorage }),
    foundation: context.createFoundationService(sheets),
    identity: context.createIdentityService({ sheetRepository: sheets, driveStorage }),
    auth: context.createAuthService({ sheetRepository: sheets, driveStorage }),
  }
}

function request(action, payload, extra = {}) {
  return { v: 1, requestId: extra.requestId || action, action, payload, idempotencyKey: extra.idempotencyKey }
}

function call(backend, action, payload, extra) {
  return backend.context.handleRequest(request(action, payload, extra), backend)
}

function identityPayload(overrides = {}) {
  return {
    departments: [
      { id: 'dept-management', name: 'Management', status: 'active' },
      { id: 'dept-sales', name: 'Sales', status: 'active' },
    ],
    roles: [
      { id: 'role-owner', name: 'Owner', description: 'Full system access.', status: 'active', protected: true, legacyRole: 'owner' },
      { id: 'role-staff', name: 'Staff', description: 'Day-to-day operations.', status: 'active', protected: false, legacyRole: 'staff' },
    ],
    users: [
      { id: 'u-aina', name: 'Aina Rahman', email: 'aina@coolslurppy.my', roleId: 'role-owner', departmentId: 'dept-management', status: 'active' },
      { id: 'u-mei', name: 'Mei Ling', email: 'mei@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'active' },
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
    ...overrides,
  }
}

function loginWithPassword(backend, username, password) {
  const challenge = call(backend, 'auth.challenge', { username, purpose: 'login' })
  if (!challenge.ok) return challenge
  const verifier = pbkdf2Sync(
    password,
    Buffer.from(challenge.data.salt, 'hex'),
    600000,
    32,
    'sha256',
  ).toString('hex')
  return call(backend, 'auth.login', {
    username,
    challengeId: challenge.data.challengeId,
    challenge: challenge.data.challenge,
    loginProof: backend.context.authLoginProof(
      verifier,
      challenge.data.challengeId,
      challenge.data.challenge,
      username,
      'login',
    ),
  })
}

test('identity.bootstrap is not an unrestricted public action', () => {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(backend.context.isPublicAuthAction('identity.bootstrap'), false)
  assert.equal(backend.context.isSetupAuthAction('identity.bootstrap'), true)
})

test('anonymous caller cannot initialize identity at the router', () => {
  const backend = app()
  backend.foundation.initialize()
  backend.context.AUTH_INJECT_TEST_BOOTSTRAP = false
  const denied = call(backend, 'identity.bootstrap', identityPayload())
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assert.equal(backend.spreadsheet.store.Users, undefined)
})

test('caller without valid bootstrap authorization is rejected', () => {
  const backend = app({ IDENTITY_BOOTSTRAP_HASH: null })
  backend.foundation.initialize()
  backend.context.AUTH_INJECT_TEST_BOOTSTRAP = false
  const denied = call(backend, 'identity.bootstrap', {
    ...identityPayload(),
    setupAuthorization: HARNESS_IDENTITY_BOOTSTRAP_SECRET,
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'UNAUTHORIZED')
})

test('invalid bootstrap authorization is rejected', () => {
  const backend = app()
  backend.foundation.initialize()
  backend.context.AUTH_INJECT_TEST_BOOTSTRAP = false
  const denied = call(backend, 'identity.bootstrap', {
    ...identityPayload(),
    setupAuthorization: 'b'.repeat(64),
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assert.equal((backend.spreadsheet.store.Users || []).slice(1).length, 0)
})

test('missing bootstrap authorization is rejected by the router', () => {
  const backend = app()
  backend.foundation.initialize()
  backend.context.AUTH_INJECT_TEST_BOOTSTRAP = false
  const denied = call(backend, 'identity.bootstrap', {
    ...identityPayload(),
    setupAuthorization: '',
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'UNAUTHORIZED')
})

test('expired bootstrap authorization is rejected', () => {
  const backend = app({ IDENTITY_BOOTSTRAP_EXPIRES_AT: '2000-01-01T00:00:00.000Z' })
  backend.foundation.initialize()
  backend.context.AUTH_INJECT_TEST_BOOTSTRAP = false
  const denied = call(backend, 'identity.bootstrap', {
    ...identityPayload(),
    setupAuthorization: HARNESS_IDENTITY_BOOTSTRAP_SECRET,
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assert.equal((backend.spreadsheet.store.Users || []).slice(1).length, 0)
})

test('first authorized bootstrap succeeds and consumes the setup secret', () => {
  const backend = app()
  backend.foundation.initialize()
  backend.context.AUTH_INJECT_TEST_BOOTSTRAP = false
  const boot = call(backend, 'identity.bootstrap', {
    ...identityPayload(),
    setupAuthorization: HARNESS_IDENTITY_BOOTSTRAP_SECRET,
  })
  assert.equal(boot.ok, true, boot.error && boot.error.message)
  assert.equal(boot.data.users[0].email, 'aina@coolslurppy.my')
  assert.equal(backend.properties.getProperty('IDENTITY_BOOTSTRAP_HASH'), null)
  const blob = JSON.stringify(boot)
  assert.equal(blob.includes(HARNESS_IDENTITY_BOOTSTRAP_SECRET), false)
})

test('reused bootstrap authorization is rejected even if identity is emptied', () => {
  const backend = app()
  backend.foundation.initialize()
  backend.context.AUTH_INJECT_TEST_BOOTSTRAP = false
  const first = call(backend, 'identity.bootstrap', {
    ...identityPayload(),
    setupAuthorization: HARNESS_IDENTITY_BOOTSTRAP_SECRET,
  })
  assert.equal(first.ok, true)
  backend.spreadsheet.store.Users = [backend.spreadsheet.store.Users[0]]
  const reused = call(backend, 'identity.bootstrap', {
    ...identityPayload(),
    setupAuthorization: HARNESS_IDENTITY_BOOTSTRAP_SECRET,
  })
  assert.equal(reused.ok, false)
  assert.equal(reused.error.code, 'UNAUTHORIZED')
})

test('second bootstrap attempt is rejected and existing identity is not overwritten', () => {
  const backend = app()
  backend.foundation.initialize()
  const first = call(backend, 'identity.bootstrap', identityPayload())
  assert.equal(first.ok, true)
  const second = call(backend, 'identity.bootstrap', identityPayload({
    users: [
      { id: 'u-attacker', name: 'Attacker', email: 'attacker@evil.test', roleId: 'role-owner', departmentId: 'dept-management', status: 'active' },
    ],
  }))
  assert.equal(second.ok, false)
  assert.equal(second.error.code, 'CONFLICT')
  const emails = backend.spreadsheet.store.Users.slice(1).map((row) => row[2])
  assert.ok(emails.includes('aina@coolslurppy.my'))
  assert.equal(emails.includes('attacker@evil.test'), false)
})

test('concurrent bootstrap requests cannot both succeed', () => {
  const backend = app()
  backend.foundation.initialize()
  const first = call(backend, 'identity.bootstrap', identityPayload(), { requestId: 'boot-a' })
  const second = call(backend, 'identity.bootstrap', identityPayload(), { requestId: 'boot-b' })
  assert.equal(first.ok, true)
  assert.equal(second.ok, false)
  assert.equal(second.error.code, 'CONFLICT')
  const ownerRows = backend.spreadsheet.store.Users.slice(1).filter((row) => row[2] === 'aina@coolslurppy.my')
  assert.equal(ownerRows.length, 1)
})

test('failed initialization does not leave a usable unauthorized Owner', () => {
  const backend = app()
  backend.foundation.initialize()
  backend.context.AUTH_INJECT_TEST_BOOTSTRAP = false
  const failed = call(backend, 'identity.bootstrap', {
    ...identityPayload({
      users: [
        { id: 'u-mei', name: 'Mei Ling', email: 'mei@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'active' },
      ],
    }),
    setupAuthorization: HARNESS_IDENTITY_BOOTSTRAP_SECRET,
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'VALIDATION_ERROR')
  assert.equal((backend.spreadsheet.store.Users || []).slice(1).length, 0)
  assert.ok(backend.properties.getProperty('IDENTITY_BOOTSTRAP_HASH'))
  const retry = call(backend, 'identity.bootstrap', {
    ...identityPayload(),
    setupAuthorization: HARNESS_IDENTITY_BOOTSTRAP_SECRET,
  })
  assert.equal(retry.ok, true, retry.error && retry.error.message)
})

test('Owner login and Owner-only authorization still work after authorized initialization', () => {
  const backend = app()
  backend.foundation.initialize()
  backend.context.AUTH_INJECT_TEST_BOOTSTRAP = false
  const boot = call(backend, 'identity.bootstrap', {
    ...identityPayload(),
    setupAuthorization: HARNESS_IDENTITY_BOOTSTRAP_SECRET,
  })
  assert.equal(boot.ok, true)
  const owner = call(backend, 'auth.bootstrapOwner', {
    username: 'aina@coolslurppy.my',
    password: 'OwnerPass12',
  })
  assert.equal(owner.ok, true)
  const login = loginWithPassword(backend, 'aina@coolslurppy.my', 'OwnerPass12')
  assert.equal(login.ok, true)
  assert.equal(login.data.user.isOwner, true)
  const created = call(backend, 'users.create', {
    sessionToken: login.data.sessionToken,
    name: 'New Staff',
    email: 'new@coolslurppy.my',
    roleId: 'role-staff',
    departmentId: 'dept-sales',
    temporaryPassword: 'TempPass12a',
  })
  assert.equal(created.ok, true)
  const staff = loginWithPassword(backend, 'new@coolslurppy.my', 'TempPass12a')
  const denied = call(backend, 'users.create', {
    sessionToken: staff.data.sessionToken,
    actorUserId: 'u-aina',
    actorRole: 'owner',
    isOwner: true,
    name: 'Escalated',
    email: 'esc@coolslurppy.my',
    roleId: 'role-owner',
    departmentId: 'dept-management',
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'FORBIDDEN')
})
