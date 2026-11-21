import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createFakeDrive,
  createFakeSpreadsheet,
  devProperties,
  loadBackend,
} from './harness.js'

function app() {
  const spreadsheet = createFakeSpreadsheet()
  const drive = createFakeDrive('drive-id')
  const properties = devProperties()
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
    context,
    system: context.createSystemService({ sheetRepository: sheets, driveStorage }),
    idempotency: context.createIdempotencyService(sheets),
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

function identityPayload() {
  return {
    departments: [
      { id: 'dept-management', name: 'Management', status: 'active' },
      { id: 'dept-sales', name: 'Sales', status: 'active' },
    ],
    roles: [
      { id: 'role-owner', name: 'Owner', description: 'Full system access.', status: 'active', protected: true, legacyRole: 'owner' },
      { id: 'role-supervisor', name: 'Supervisor', description: 'Operations.', status: 'active', protected: false, legacyRole: 'manager' },
      { id: 'role-staff', name: 'Staff', description: 'Day-to-day operations.', status: 'active', protected: false, legacyRole: 'staff' },
    ],
    users: [
      { id: 'u-aina', name: 'Aina Rahman', email: 'aina@coolslurppy.my', roleId: 'role-owner', departmentId: 'dept-management', status: 'active' },
      { id: 'u-siti', name: 'Siti Rahman', email: 'siti@coolslurppy.my', roleId: 'role-supervisor', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-mei', name: 'Mei Ling', email: 'mei@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-off', name: 'Off Duty', email: 'off@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'inactive' },
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

function ready() {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(call(backend, 'identity.bootstrap', identityPayload()).ok, true)
  return backend
}

function ownerSession(backend) {
  const boot = call(backend, 'auth.bootstrapOwner', {
    username: 'aina@coolslurppy.my',
    password: 'OwnerPass12',
  })
  assert.equal(boot.ok, true, boot.error && boot.error.message)
  return boot.data
}

test('PBKDF2-HMAC-SHA256 hashes and verifies with a unique salt', () => {
  const backend = app()
  const started = Date.now()
  const first = backend.context.authHashPassword('OwnerPass12')
  const elapsed = Date.now() - started
  assert.equal(first.algorithm, 'pbkdf2-hmac-sha256')
  assert.equal(first.iterations, 12000)
  assert.equal(first.salt.length, 32)
  assert.equal(first.hash.length, 64)
  assert.equal(backend.context.authVerifyPassword('OwnerPass12', first), true)
  assert.equal(backend.context.authVerifyPassword('wrong-password', first), false)
  const second = backend.context.authHashPassword('OwnerPass12')
  assert.notEqual(first.salt, second.salt)
  assert.notEqual(first.hash, second.hash)
  assert.ok(elapsed < 2000, `hashing took ${elapsed}ms`)
})

test('password policy rejects short, letter-only, and username-matching secrets', () => {
  const backend = app()
  assert.throws(() => backend.context.authValidatePasswordPolicy('short1', 'user'), (error) => error.code === 'VALIDATION_ERROR')
  assert.throws(() => backend.context.authValidatePasswordPolicy('noletters!!', 'user'), (error) => error.code === 'VALIDATION_ERROR')
  assert.throws(() => backend.context.authValidatePasswordPolicy('NoDigitsHere', 'user'), (error) => error.code === 'VALIDATION_ERROR')
  assert.throws(() => backend.context.authValidatePasswordPolicy('aina@coolslurppy.my', 'aina@coolslurppy.my'), (error) => error.code === 'VALIDATION_ERROR')
  backend.context.authValidatePasswordPolicy('OwnerPass12', 'aina@coolslurppy.my')
})

test('auth.status reports owner bootstrap without listing users', () => {
  const backend = ready()
  const status = call(backend, 'auth.status', {})
  assert.equal(status.ok, true)
  assert.equal(status.data.identityReady, true)
  assert.equal(status.data.needsOwnerBootstrap, true)
  assert.equal(status.data.algorithm, 'pbkdf2-hmac-sha256')
  assert.equal(JSON.stringify(status.data).includes('aina@'), false)
})

test('owner bootstrap is single-use and mints a session', () => {
  const backend = ready()
  const denied = call(backend, 'auth.bootstrapOwner', {
    username: 'mei@coolslurppy.my',
    password: 'StaffPass12',
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'FORBIDDEN')
  const session = ownerSession(backend)
  assert.equal(session.user.id, 'u-aina')
  assert.equal(session.user.isOwner, true)
  assert.match(session.sessionToken, /^[0-9a-f]{64}$/)
  const again = call(backend, 'auth.bootstrapOwner', {
    username: 'aina@coolslurppy.my',
    password: 'OwnerPass12',
  })
  assert.equal(again.ok, false)
  assert.equal(again.error.code, 'FORBIDDEN')
})

test('login accepts the owner password and rejects unknown, wrong, and disabled accounts', () => {
  const backend = ready()
  ownerSession(backend)
  const ok = call(backend, 'auth.login', { username: 'AINA@coolslurppy.my', password: 'OwnerPass12' })
  assert.equal(ok.ok, true)
  assert.equal(ok.data.user.id, 'u-aina')
  assert.equal(JSON.stringify(ok.data).includes('OwnerPass12'), false)
  const wrong = call(backend, 'auth.login', { username: 'aina@coolslurppy.my', password: 'not-the-password' })
  assert.equal(wrong.ok, false)
  assert.equal(wrong.error.message, 'Username or password is incorrect.')
  const unknown = call(backend, 'auth.login', { username: 'nobody@coolslurppy.my', password: 'OwnerPass12' })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.message, 'Username or password is incorrect.')
  const missing = call(backend, 'auth.login', { username: '', password: '' })
  assert.equal(missing.error.code, 'VALIDATION_ERROR')
  const reset = call(backend, 'auth.resetPassword', {
    sessionToken: ok.data.sessionToken,
    userId: 'u-off',
    newPassword: 'TempPass12a',
  })
  assert.equal(reset.ok, true)
  const disabled = call(backend, 'auth.login', { username: 'off@coolslurppy.my', password: 'TempPass12a' })
  assert.equal(disabled.ok, false)
  assert.equal(disabled.error.message, 'This account is disabled.')
})

test('repeated failed logins lock the username', () => {
  const backend = ready()
  ownerSession(backend)
  let last
  for (let i = 0; i < 5; i += 1) {
    last = call(backend, 'auth.login', { username: 'aina@coolslurppy.my', password: 'wrong-password' }, { requestId: `fail-${i}` })
    assert.equal(last.ok, false)
  }
  const locked = call(backend, 'auth.login', { username: 'aina@coolslurppy.my', password: 'OwnerPass12' })
  assert.equal(locked.ok, false)
  assert.equal(locked.error.message, 'Username or password is incorrect.')
})

test('backend overwrites a forged actorUserId from the validated session', () => {
  const backend = ready()
  const owner = ownerSession(backend)
  const forged = call(backend, 'users.create', {
    sessionToken: owner.sessionToken,
    actorUserId: 'u-admin',
    name: 'New Staff',
    email: 'new@coolslurppy.my',
    roleId: 'role-staff',
    departmentId: 'dept-sales',
  })
  assert.equal(forged.ok, true)
  assert.equal(forged.data.userAuditLogs[0].changedBy, 'Aina Rahman')
})

test('requests without a session cannot impersonate owner', () => {
  const backend = ready()
  ownerSession(backend)
  const denied = call(backend, 'users.create', {
    sessionToken: '',
    actorUserId: 'u-aina',
    name: 'Hacker',
    email: 'hack@coolslurppy.my',
    roleId: 'role-staff',
    departmentId: 'dept-sales',
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  const bogus = call(backend, 'users.create', {
    sessionToken: 'a'.repeat(64),
    actorUserId: 'u-aina',
    name: 'Hacker',
    email: 'hack2@coolslurppy.my',
    roleId: 'role-staff',
    departmentId: 'dept-sales',
  })
  assert.equal(bogus.error.code, 'UNAUTHORIZED')
})

test('staff cannot reset passwords or view security events', () => {
  const backend = ready()
  const owner = ownerSession(backend)
  const reset = call(backend, 'auth.resetPassword', {
    sessionToken: owner.sessionToken,
    userId: 'u-mei',
    newPassword: 'StaffPass12',
  })
  assert.equal(reset.ok, true)
  const staff = call(backend, 'auth.login', { username: 'mei@coolslurppy.my', password: 'StaffPass12' })
  assert.equal(staff.ok, true)
  assert.equal(staff.data.user.mustChange, true)
  const blocked = call(backend, 'users.create', {
    sessionToken: staff.data.sessionToken,
    actorUserId: 'u-aina',
    name: 'Escalated',
    email: 'esc@coolslurppy.my',
    roleId: 'role-owner',
    departmentId: 'dept-management',
  })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error.code, 'FORBIDDEN')
  const resetDenied = call(backend, 'auth.resetPassword', {
    sessionToken: staff.data.sessionToken,
    userId: 'u-aina',
    newPassword: 'HackedPass12',
  })
  assert.equal(resetDenied.ok, false)
  const eventsDenied = call(backend, 'auth.events', { sessionToken: staff.data.sessionToken })
  assert.equal(eventsDenied.ok, false)
})

test('first-login password setup then logout and expiry isolation', () => {
  const backend = ready()
  const owner = ownerSession(backend)
  call(backend, 'auth.resetPassword', {
    sessionToken: owner.sessionToken,
    userId: 'u-siti',
    newPassword: 'TempPass12a',
  })
  const first = call(backend, 'auth.login', { username: 'siti@coolslurppy.my', password: 'TempPass12a' })
  assert.equal(first.data.user.mustChange, true)
  const changed = call(backend, 'auth.changePassword', {
    sessionToken: first.data.sessionToken,
    currentPassword: 'TempPass12a',
    newPassword: 'SitiPass12b',
  })
  assert.equal(changed.ok, true)
  const stale = call(backend, 'auth.me', { sessionToken: first.data.sessionToken })
  assert.equal(stale.ok, true)
  const login = call(backend, 'auth.login', { username: 'siti@coolslurppy.my', password: 'SitiPass12b' })
  assert.equal(login.ok, true)
  const out = call(backend, 'auth.logout', { sessionToken: login.data.sessionToken })
  assert.equal(out.ok, true)
  const after = call(backend, 'auth.me', { sessionToken: login.data.sessionToken })
  assert.equal(after.ok, false)
  assert.equal(after.error.code, 'UNAUTHORIZED')
})

test('password change and deactivation revoke other sessions', () => {
  const backend = ready()
  const owner = ownerSession(backend)
  const other = call(backend, 'auth.login', { username: 'aina@coolslurppy.my', password: 'OwnerPass12' })
  assert.equal(other.ok, true)
  const changed = call(backend, 'auth.changePassword', {
    sessionToken: owner.sessionToken,
    currentPassword: 'OwnerPass12',
    newPassword: 'OwnerPass13x',
  })
  assert.equal(changed.ok, true)
  const revoked = call(backend, 'auth.me', { sessionToken: other.data.sessionToken })
  assert.equal(revoked.ok, false)
  const still = call(backend, 'auth.me', { sessionToken: owner.sessionToken })
  assert.equal(still.ok, true)
  call(backend, 'auth.resetPassword', {
    sessionToken: owner.sessionToken,
    userId: 'u-mei',
    newPassword: 'StaffPass12',
  })
  const staff = call(backend, 'auth.login', { username: 'mei@coolslurppy.my', password: 'StaffPass12' })
  const deactivated = call(backend, 'users.update', {
    sessionToken: owner.sessionToken,
    id: 'u-mei',
    patch: { status: 'inactive' },
  })
  assert.equal(deactivated.ok, true)
  const dead = call(backend, 'auth.me', { sessionToken: staff.data.sessionToken })
  assert.equal(dead.ok, false)
})

test('expired sessions are rejected and tokens are stored hashed', () => {
  const backend = ready()
  const owner = ownerSession(backend)
  const rows = backend.spreadsheet.store.AuthSessions
  assert.equal(rows[1].includes(owner.sessionToken), false)
  rows[1][5] = '2000-01-01T00:00:00.000Z'
  const expired = call(backend, 'auth.me', { sessionToken: owner.sessionToken })
  assert.equal(expired.ok, false)
  assert.equal(expired.error.message, 'Your session has expired. Please sign in again.')
})

test('auth events never include secrets and owner can list them', () => {
  const backend = ready()
  const owner = ownerSession(backend)
  call(backend, 'auth.login', { username: 'aina@coolslurppy.my', password: 'bad-password' })
  const events = call(backend, 'auth.events', { sessionToken: owner.sessionToken, limit: 20 })
  assert.equal(events.ok, true)
  const blob = JSON.stringify(events.data)
  assert.equal(blob.includes('OwnerPass12'), false)
  assert.equal(blob.includes(owner.sessionToken), false)
  assert.ok(events.data.events.some((item) => item.eventType === 'login' || item.eventType === 'owner_bootstrap'))
  assert.ok(events.data.events.some((item) => item.eventType === 'login_failed'))
})
