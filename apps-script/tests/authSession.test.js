import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  authDevProperties,
  createFakeDrive,
  createFakeSpreadsheet,
  createNonReentrantScriptLock,
  loadBackend,
  memoryProperties,
} from './harness.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function identityPayload() {
  return {
    departments: [
      { id: 'dept-management', name: 'Management', status: 'active' },
      { id: 'dept-sales', name: 'Sales', status: 'active' },
    ],
    roles: [
      { id: 'role-owner', name: 'Owner', description: 'Full system access. Protected account.', status: 'active', protected: true, legacyRole: 'owner', createdAt: '2026-08-01T01:15:00.000Z', updatedAt: '2026-08-01T01:15:00.000Z' },
      { id: 'role-staff', name: 'Staff', description: 'Day-to-day operations.', status: 'active', protected: false, legacyRole: 'staff', createdAt: '2026-08-01T01:15:00.000Z', updatedAt: '2026-08-01T01:15:00.000Z' },
    ],
    users: [
      { id: 'u-owner', name: 'Real Owner', email: 'owner@coolslurppy.my', roleId: 'role-owner', departmentId: 'dept-management', status: 'active', lastLogin: 'Never' },
      { id: 'u-staff', name: 'Mei Ling', email: 'mei@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'active', lastLogin: 'Never' },
      { id: 'u-inactive', name: 'Inactive User', email: 'inactive@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'inactive', lastLogin: 'Never' },
    ],
    settings: {
      businessName: 'Cool Slurppy',
      legalName: 'Cool Slurppy Sdn Bhd',
      logoUrl: '',
      phone: '03',
      email: 'hello@coolslurppy.my',
      address: 'KL',
      website: '',
      registrationNo: '',
      bankName: '',
      bankAccount: '',
      paymentTerms: 'Net 7 days',
      documentTerms: 'Terms',
      currency: 'MYR',
      defaultWarehouseId: 'wh-main',
      allowNegativeStock: false,
      costingMethod: 'average',
      batchTracking: true,
      expiryTracking: true,
      defaultCustomerId: 'c-walkin',
      allowDiscount: true,
      allowReturns: true,
      enabledPaymentMethods: ['cash'],
      roleMatrix: {},
    },
    userAuditLogs: [],
  }
}

function app(options = {}) {
  let current = options.nowMs ?? Date.parse('2026-03-01T00:00:00.000Z')
  const spreadsheet = options.spreadsheet || createFakeSpreadsheet()
  const drive = createFakeDrive('drive-id')
  const properties = options.properties || authDevProperties()
  const locks = options.locks || []
  const context = loadBackend({
    PropertiesService: { getScriptProperties: () => properties },
    LockService: createNonReentrantScriptLock({ events: locks, state: { held: false } }),
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
  const authStore = context.createAuthStore({
    sheetRepository: sheets,
    now: () => new Date(current),
  })
  const backend = {
    sheets,
    drive,
    spreadsheet,
    context,
    properties,
    locks,
    authStore,
    system: context.createSystemService({ sheetRepository: sheets, driveStorage }),
    idempotency: context.createIdempotencyService(sheets),
    foundation: context.createFoundationService(sheets),
    auth: context.createAuthService({ sheetRepository: sheets, driveStorage, authStore }),
    identity: context.createIdentityService({ sheetRepository: sheets, driveStorage }),
    tick(ms) {
      current += ms
    },
    now() {
      return current
    },
  }
  return backend
}

function request(action, payload, extra = {}) {
  return {
    v: 1,
    requestId: extra.requestId || action,
    action,
    payload,
    idempotencyKey: extra.idempotencyKey,
    sessionToken: extra.sessionToken,
  }
}

function call(backend, action, payload, extra) {
  return backend.context.handleRequest(request(action, payload, extra), backend)
}

function ready() {
  const backend = app()
  backend.foundation.initialize()
  const boot = call(backend, 'identity.bootstrap', identityPayload())
  assert.equal(boot.ok, true)
  const ownerSecret = backend.authStore.issueCredential({
    userId: 'u-owner',
    username: 'owner@coolslurppy.my',
    createdBy: 'setup',
  })
  const staffSecret = backend.authStore.issueCredential({
    userId: 'u-staff',
    username: 'mei@coolslurppy.my',
    createdBy: 'setup',
  })
  const inactiveSecret = backend.authStore.issueCredential({
    userId: 'u-inactive',
    username: 'inactive@coolslurppy.my',
    createdBy: 'setup',
  })
  return { backend, ownerSecret, staffSecret, inactiveSecret }
}

function loginOk(backend, email, password) {
  const result = call(backend, 'auth.login', { email, password })
  assert.equal(result.ok, true, result.error && result.error.message)
  return result
}

test('auth.login succeeds for an active Owner and returns a raw token without hashes', () => {
  const { backend, ownerSecret } = ready()
  const result = loginOk(backend, 'owner@coolslurppy.my', ownerSecret.plaintext)
  assert.equal(typeof result.data.token, 'string')
  assert.match(result.data.token, /^[0-9a-f]{64}$/)
  assert.equal(result.data.user.id, 'u-owner')
  assert.equal(result.data.user.email, 'owner@coolslurppy.my')
  assert.equal(result.data.user.roleId, 'role-owner')
  assert.equal(result.data.user.name, 'Real Owner')
  assert.equal(result.data.secretHash, undefined)
  assert.equal(result.data.tokenHash, undefined)
  assert.equal(result.data.user.secretHash, undefined)
  const body = JSON.stringify(result)
  assert.equal(body.includes('"token"'), true)
  assert.equal(body.includes(result.data.token), true)
  assert.equal(body.includes(ownerSecret.plaintext), false)
  assert.equal(body.includes('secretHash'), false)
  assert.equal(body.includes('tokenHash'), false)
  assert.equal(body.toLowerCase().includes('pepper'), false)
  const stored = JSON.stringify(backend.spreadsheet.store)
  assert.equal(stored.includes(result.data.token), false)
  assert.equal(stored.includes(ownerSecret.plaintext), false)
  const who = call(backend, 'auth.session', {}, { sessionToken: result.data.token })
  assert.equal(who.ok, true)
  assert.equal(who.data.user.id, 'u-owner')
  assert.equal(who.data.token, undefined)
  assert.equal(JSON.stringify(who).includes(result.data.token), false)
})

test('auth.login rejects unknown email and wrong password with the same generic error', () => {
  const { backend, ownerSecret } = ready()
  const unknown = call(backend, 'auth.login', { email: 'missing@coolslurppy.my', password: ownerSecret.plaintext })
  const wrong = call(backend, 'auth.login', { email: 'owner@coolslurppy.my', password: 'ffff'.repeat(16) })
  const empty = call(backend, 'auth.login', { email: 'owner@coolslurppy.my', password: '' })
  for (const result of [unknown, wrong, empty]) {
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'UNAUTHORIZED')
    assert.equal(result.error.message, 'Email or password is incorrect.')
    assert.equal(result.data, null)
  }
  assert.equal(unknown.error.message, wrong.error.message)
  const sessions = backend.spreadsheet.store.AuthSessions || []
  assert.equal(sessions.length, 1)
})

test('auth.login rejects inactive users with the generic error and issues no session', () => {
  const { backend, inactiveSecret } = ready()
  const result = call(backend, 'auth.login', {
    email: 'inactive@coolslurppy.my',
    password: inactiveSecret.plaintext,
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'UNAUTHORIZED')
  assert.equal(result.error.message, 'Email or password is incorrect.')
  const sessions = backend.spreadsheet.store.AuthSessions || []
  assert.equal(sessions.length, 1)
})

test('auth.logout revokes only the current session and rejects token reuse', () => {
  const { backend, ownerSecret, staffSecret } = ready()
  const first = loginOk(backend, 'owner@coolslurppy.my', ownerSecret.plaintext)
  const second = loginOk(backend, 'owner@coolslurppy.my', ownerSecret.plaintext)
  const staff = loginOk(backend, 'mei@coolslurppy.my', staffSecret.plaintext)
  const logout = call(backend, 'auth.logout', {}, { sessionToken: first.data.token })
  assert.equal(logout.ok, true)
  assert.equal(logout.data.revoked, true)
  assert.equal(JSON.stringify(logout).includes(first.data.token), false)
  const reusedSession = call(backend, 'auth.session', {}, { sessionToken: first.data.token })
  assert.equal(reusedSession.ok, false)
  assert.equal(reusedSession.error.code, 'UNAUTHORIZED')
  const reusedLogout = call(backend, 'auth.logout', {}, { sessionToken: first.data.token })
  assert.equal(reusedLogout.ok, false)
  assert.equal(reusedLogout.error.code, 'UNAUTHORIZED')
  const sibling = call(backend, 'auth.session', {}, { sessionToken: second.data.token })
  assert.equal(sibling.ok, true)
  assert.equal(sibling.data.user.id, 'u-owner')
  const otherUser = call(backend, 'auth.session', {}, { sessionToken: staff.data.token })
  assert.equal(otherUser.ok, true)
  assert.equal(otherUser.data.user.id, 'u-staff')
})

test('expired idle and absolute sessions fail closed', () => {
  const { backend, ownerSecret } = ready()
  const idleLogin = loginOk(backend, 'owner@coolslurppy.my', ownerSecret.plaintext)
  backend.tick(backend.context.AUTH_SESSION_IDLE_MS)
  const idle = call(backend, 'auth.session', {}, { sessionToken: idleLogin.data.token })
  assert.equal(idle.ok, false)
  assert.equal(idle.error.code, 'UNAUTHORIZED')
  assert.equal(idle.error.message, 'The session is not valid.')

  const absBackend = ready()
  const absLogin = loginOk(absBackend.backend, 'owner@coolslurppy.my', absBackend.ownerSecret.plaintext)
  absBackend.backend.tick(absBackend.backend.context.AUTH_SESSION_ABSOLUTE_MS)
  const expired = call(absBackend.backend, 'auth.session', {}, { sessionToken: absLogin.data.token })
  assert.equal(expired.ok, false)
  assert.equal(expired.error.code, 'UNAUTHORIZED')
})

test('auth.session slides idle expiry and never extends absolute expiry', () => {
  const { backend, ownerSecret } = ready()
  const login = loginOk(backend, 'owner@coolslurppy.my', ownerSecret.plaintext)
  const originalExpiry = login.data.expiresAt
  backend.tick(60 * 60 * 1000)
  const live = call(backend, 'auth.session', {}, { sessionToken: login.data.token })
  assert.equal(live.ok, true)
  const row = backend.authStore.validateSession(login.data.token)
  assert.equal(row.expiresAt, originalExpiry)
  assert.equal(Date.parse(row.idleExpiresAt) > Date.parse(login.data.idleExpiresAt), true)
})

test('a presented invalid session token fails closed on non-login actions', () => {
  const { backend } = ready()
  const bogus = call(backend, 'identity.get', {}, { sessionToken: 'ab'.repeat(32) })
  assert.equal(bogus.ok, false)
  assert.equal(bogus.error.code, 'UNAUTHORIZED')
  const missing = call(backend, 'auth.logout', {})
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'UNAUTHORIZED')
  const stillOpen = call(backend, 'identity.get', {})
  assert.equal(stillOpen.ok, true)
})

test('authenticated requests overwrite client actorUserId from the session', () => {
  const { backend, ownerSecret } = ready()
  const login = loginOk(backend, 'owner@coolslurppy.my', ownerSecret.plaintext)
  const created = call(backend, 'users.create', {
    actorUserId: 'u-staff',
    name: 'Nur',
    email: 'nur@coolslurppy.my',
    roleId: 'role-staff',
    departmentId: 'dept-sales',
  }, { sessionToken: login.data.token })
  assert.equal(created.ok, true, created.error && created.error.message)
  const audit = created.data.userAuditLogs[0]
  assert.equal(audit.changedBy, 'Real Owner')
})

test('auth.login does not store the raw token in idempotency rows', () => {
  const { backend, ownerSecret } = ready()
  const result = call(backend, 'auth.login', {
    email: 'owner@coolslurppy.my',
    password: ownerSecret.plaintext,
  }, { idempotencyKey: 'login-once' })
  assert.equal(result.ok, true)
  const stored = JSON.stringify(backend.spreadsheet.store.Idempotency || [])
  assert.equal(stored.includes(result.data.token), false)
})

test('auth.login fails closed when the pepper is missing', () => {
  const backend = app({
    properties: memoryProperties({
      ENVIRONMENT: 'DEV',
      SPREADSHEET_ID: 'sheet-id',
      DRIVE_ROOT_ID: 'drive-id',
      TIMEZONE: 'Asia/Kuala_Lumpur',
    }),
  })
  backend.foundation.initialize()
  const boot = call(backend, 'identity.bootstrap', identityPayload())
  assert.equal(boot.ok, true)
  const result = call(backend, 'auth.login', {
    email: 'owner@coolslurppy.my',
    password: 'ab'.repeat(32),
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'INTERNAL_ERROR')
  assert.equal(result.error.message.includes('pepper'), false)
})

test('AUTH-1 does not add a login route or store tokens in frontend localStorage', () => {
  const appSource = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
  const dbSource = fs.readFileSync(path.join(root, 'src/store/db.ts'), 'utf8')
  assert.equal(appSource.includes('path="/login"'), false)
  assert.equal(dbSource.includes('sessionToken'), false)
  assert.equal(dbSource.includes('localStorage.setItem') && dbSource.includes('stockflow-prototype-v8'), true)
})
