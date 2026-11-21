import assert from 'node:assert/strict'
import { pbkdf2Sync } from 'node:crypto'
import test from 'node:test'
import {
  createFakeDrive,
  createFakeSpreadsheet,
  devProperties,
  harnessOwnerEnrollExpiry,
  harnessOwnerEnrollHash,
  HARNESS_IDENTITY_BOOTSTRAP_SECRET,
  HARNESS_OWNER_ENROLL_SECRET,
  HARNESS_OWNER_ENROLL_USER_ID,
  HARNESS_OWNER_ENROLL_USERNAME,
  loadBackend,
} from './harness.js'

function alwaysSucceedLock() {
  return {
    getScriptLock() {
      return { tryLock: () => true, releaseLock() {} }
    },
  }
}

function createHoldLock(state) {
  return {
    getScriptLock() {
      return {
        tryLock() {
          if (state.held) {
            state.events.push('blocked')
            return false
          }
          state.held = true
          state.events.push('acquired')
          if (typeof state.onHold === 'function') {
            const nested = state.onHold
            state.onHold = null
            state.nestedResult = nested()
          }
          return true
        },
        releaseLock() {
          state.held = false
          state.events.push('released')
        },
      }
    },
  }
}

function app(propertyOverrides = {}, lockService = alwaysSucceedLock()) {
  const spreadsheet = createFakeSpreadsheet()
  const drive = createFakeDrive('drive-id')
  const properties = devProperties()
  Object.entries(propertyOverrides).forEach(([key, value]) => {
    if (value === null) properties.deleteProperty(key)
    else properties.setProperty(key, value)
  })
  const context = loadBackend({
    PropertiesService: { getScriptProperties: () => properties },
    LockService: lockService,
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

function identityPayload() {
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
  }
}

function ready(propertyOverrides, lockService) {
  const backend = app(propertyOverrides, lockService)
  backend.foundation.initialize()
  assert.equal(call(backend, 'identity.bootstrap', identityPayload()).ok, true)
  return backend
}

function enrollPayload(overrides = {}) {
  return {
    username: 'aina@coolslurppy.my',
    password: 'OwnerPass12',
    ownerEnrollmentAuthorization: HARNESS_OWNER_ENROLL_SECRET,
    ...overrides,
  }
}

function deniedEnroll(propertyOverrides, payloadOverrides = {}) {
  const backend = ready(propertyOverrides)
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  const denied = call(backend, 'auth.bootstrapOwner', enrollPayload(payloadOverrides))
  assertNoEnrollment(backend, denied)
  return { backend, denied }
}

function setUserStatus(backend, userId, status) {
  const rows = backend.spreadsheet.store.Users
  const headers = rows[0]
  const idIdx = headers.indexOf('id')
  const statusIdx = headers.indexOf('status')
  for (let i = 1; i < rows.length; i += 1) {
    if (String(rows[i][idIdx]) === userId) rows[i][statusIdx] = status
  }
}

function credentialRows(backend) {
  return (backend.spreadsheet.store.AuthCredentials || []).slice(1).filter((row) => row.some((cell) => String(cell || '').trim()))
}

function sessionRows(backend) {
  return (backend.spreadsheet.store.AuthSessions || []).slice(1).filter((row) => row.some((cell) => String(cell || '').trim()))
}

function assertNoEnrollment(backend, result) {
  assert.equal(result.ok, false)
  assert.equal(Boolean(result.data && result.data.sessionToken), false)
  assert.equal(credentialRows(backend).length, 0)
  assert.equal(sessionRows(backend).length, 0)
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

test('auth.bootstrapOwner is not an unrestricted public action', () => {
  const backend = ready()
  assert.equal(backend.context.isPublicAuthAction('auth.bootstrapOwner'), false)
  assert.equal(backend.context.isSetupAuthAction('auth.bootstrapOwner'), true)
  assert.equal(backend.context.setupAuthorizationField('auth.bootstrapOwner'), 'ownerEnrollmentAuthorization')
})

test('anonymous auth.bootstrapOwner without authorization is rejected at the router', () => {
  const backend = ready()
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  const denied = call(backend, 'auth.bootstrapOwner', {
    username: 'aina@coolslurppy.my',
    password: 'OwnerPass12',
  })
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assertNoEnrollment(backend, denied)
})

test('knowing the Owner email is not enough to register the first password', () => {
  const backend = ready()
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  const denied = call(backend, 'auth.bootstrapOwner', {
    username: 'aina@coolslurppy.my',
    password: 'OwnerPass12',
    ownerEnrollmentAuthorization: '',
    isOwner: true,
    actorRole: 'owner',
    actorUserId: 'u-aina',
  })
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assertNoEnrollment(backend, denied)
})

test('invalid owner enrollment authorization is rejected', () => {
  const backend = ready()
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  const denied = call(backend, 'auth.bootstrapOwner', {
    username: 'aina@coolslurppy.my',
    password: 'OwnerPass12',
    ownerEnrollmentAuthorization: 'c'.repeat(64),
  })
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assertNoEnrollment(backend, denied)
  assert.ok(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'))
})

test('identity bootstrap secret cannot be reused for Owner enrollment', () => {
  const backend = ready()
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  const denied = call(backend, 'auth.bootstrapOwner', {
    username: 'aina@coolslurppy.my',
    password: 'OwnerPass12',
    ownerEnrollmentAuthorization: HARNESS_IDENTITY_BOOTSTRAP_SECRET,
  })
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assertNoEnrollment(backend, denied)
})

test('expired owner enrollment authorization is rejected', () => {
  const { backend, denied } = deniedEnroll({ AUTH_OWNER_ENROLL_EXPIRES_AT: '2000-01-01T00:00:00.000Z' })
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assert.ok(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'))
})

test('missing owner enrollment expiry property is rejected', () => {
  const { backend, denied } = deniedEnroll({ AUTH_OWNER_ENROLL_EXPIRES_AT: null })
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assert.ok(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'))
})

test('empty owner enrollment expiry property is rejected', () => {
  const { backend, denied } = deniedEnroll({ AUTH_OWNER_ENROLL_EXPIRES_AT: '' })
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assert.ok(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'))
})

test('malformed owner enrollment expiry is rejected', () => {
  const { backend, denied } = deniedEnroll({ AUTH_OWNER_ENROLL_EXPIRES_AT: 'not-a-timestamp' })
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assert.ok(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'))
})

test('invalid owner enrollment expiry date string is rejected', () => {
  const { backend, denied } = deniedEnroll({ AUTH_OWNER_ENROLL_EXPIRES_AT: '2026-13-40T99:99:99.000Z' })
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assert.ok(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'))
})

test('owner enrollment expiry equal to current time is rejected', () => {
  const now = Date.now()
  const { backend, denied } = deniedEnroll({ AUTH_OWNER_ENROLL_EXPIRES_AT: new Date(now).toISOString() })
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assert.ok(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'))
})

test('owner enrollment expiry beyond the 15-minute window is rejected', () => {
  const { backend, denied } = deniedEnroll({
    AUTH_OWNER_ENROLL_EXPIRES_AT: new Date(Date.now() + 16 * 60 * 1000).toISOString(),
  })
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assert.ok(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'))
})

test('wrong owner enrollment secret is rejected', () => {
  const { backend, denied } = deniedEnroll({}, { ownerEnrollmentAuthorization: 'c'.repeat(64) })
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assert.ok(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'))
})

test('wrong bound Owner user ID is rejected', () => {
  const { backend, denied } = deniedEnroll({ AUTH_OWNER_ENROLL_USER_ID: 'u-wrong' })
  assert.equal(denied.error.code, 'FORBIDDEN')
  assert.ok(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'))
})

test('inactive Owner cannot enroll even with a valid authorization', () => {
  const backend = ready()
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  setUserStatus(backend, 'u-aina', 'inactive')
  const denied = call(backend, 'auth.bootstrapOwner', enrollPayload())
  assert.equal(denied.error.code, 'FORBIDDEN')
  assertNoEnrollment(backend, denied)
  assert.ok(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'))
})

test('correct authorization for the wrong email is rejected', () => {
  const backend = ready()
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  const denied = call(backend, 'auth.bootstrapOwner', {
    username: 'mei@coolslurppy.my',
    password: 'StaffPass12',
    ownerEnrollmentAuthorization: HARNESS_OWNER_ENROLL_SECRET,
    isOwner: true,
    role: 'owner',
  })
  assert.equal(denied.error.code, 'UNAUTHORIZED')
  assertNoEnrollment(backend, denied)
  assert.ok(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'))
})

test('correct authorization for a non-Owner is rejected', () => {
  const backend = ready({
    AUTH_OWNER_ENROLL_USERNAME: 'mei@coolslurppy.my',
    AUTH_OWNER_ENROLL_USER_ID: 'u-mei',
  })
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  const denied = call(backend, 'auth.bootstrapOwner', {
    username: 'mei@coolslurppy.my',
    password: 'StaffPass12',
    ownerEnrollmentAuthorization: HARNESS_OWNER_ENROLL_SECRET,
  })
  assert.equal(denied.error.code, 'FORBIDDEN')
  assertNoEnrollment(backend, denied)
})

test('weak password does not consume enrollment authorization or mint a session', () => {
  const backend = ready()
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  const denied = call(backend, 'auth.bootstrapOwner', {
    username: 'aina@coolslurppy.my',
    password: 'short',
    ownerEnrollmentAuthorization: HARNESS_OWNER_ENROLL_SECRET,
  })
  assert.equal(denied.error.code, 'VALIDATION_ERROR')
  assertNoEnrollment(backend, denied)
  assert.ok(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'))
})

test('authorized Owner enrollment succeeds once, consumes the secret, and mints a session', () => {
  const backend = ready()
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  const boot = call(backend, 'auth.bootstrapOwner', {
    username: 'AINA@coolslurppy.my',
    password: 'OwnerPass12',
    ownerEnrollmentAuthorization: HARNESS_OWNER_ENROLL_SECRET,
  })
  assert.equal(boot.ok, true, boot.error && boot.error.message)
  assert.equal(boot.data.user.id, 'u-aina')
  assert.equal(boot.data.user.isOwner, true)
  assert.match(boot.data.sessionToken, /^[0-9a-f]{64}$/)
  assert.equal(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'), null)
  assert.equal(backend.properties.getProperty('AUTH_OWNER_ENROLL_USERNAME'), null)
  assert.equal(JSON.stringify(boot).includes(HARNESS_OWNER_ENROLL_SECRET), false)
  assert.equal(credentialRows(backend).length, 1)
})

test('reused owner enrollment authorization fails even if credentials are cleared', () => {
  const backend = ready()
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  const first = call(backend, 'auth.bootstrapOwner', {
    username: 'aina@coolslurppy.my',
    password: 'OwnerPass12',
    ownerEnrollmentAuthorization: HARNESS_OWNER_ENROLL_SECRET,
  })
  assert.equal(first.ok, true)
  backend.spreadsheet.store.AuthCredentials.splice(1)
  backend.spreadsheet.store.AuthSessions.splice(1)
  const reused = call(backend, 'auth.bootstrapOwner', {
    username: 'aina@coolslurppy.my',
    password: 'OwnerPass12',
    ownerEnrollmentAuthorization: HARNESS_OWNER_ENROLL_SECRET,
  })
  assert.equal(reused.ok, false)
  assert.equal(reused.error.code, 'UNAUTHORIZED')
  assert.equal(Boolean(reused.data && reused.data.sessionToken), false)
  assert.equal(credentialRows(backend).length, 0)
  assert.equal(sessionRows(backend).length, 0)
  assert.equal(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'), null)
})

test('second owner enrollment after the first succeeds is rejected', () => {
  const backend = ready()
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  const first = call(backend, 'auth.bootstrapOwner', enrollPayload(), { requestId: 'enroll-a' })
  const second = call(backend, 'auth.bootstrapOwner', enrollPayload({
    password: 'OwnerPass13x',
  }), { requestId: 'enroll-b' })
  assert.equal(first.ok, true)
  assert.equal(second.ok, false)
  assert.equal(second.error.code, 'FORBIDDEN')
  assert.equal(Boolean(second.data && second.data.sessionToken), false)
  assert.equal(credentialRows(backend).length, 1)
  assert.equal(sessionRows(backend).length, 1)
})

test('overlapping owner enrollment requests cannot both succeed', () => {
  const state = { held: false, events: [], onHold: null, nestedResult: null }
  const backend = ready({}, createHoldLock(state))
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  state.onHold = () => call(backend, 'auth.bootstrapOwner', enrollPayload({
    password: 'OwnerPass13x',
  }), { requestId: 'enroll-b' })
  const first = call(backend, 'auth.bootstrapOwner', enrollPayload(), { requestId: 'enroll-a' })
  assert.equal(first.ok, true, first.error && first.error.message)
  assert.equal(state.nestedResult && state.nestedResult.ok, false)
  assert.equal(state.nestedResult.error.code, 'CONFLICT')
  assert.ok(state.events.includes('acquired'))
  assert.ok(state.events.includes('blocked'))
  assert.ok(state.events.includes('released'))
  assert.equal(Boolean(state.nestedResult.data && state.nestedResult.data.sessionToken), false)
  assert.equal(credentialRows(backend).length, 1)
  assert.equal(sessionRows(backend).length, 1)
  assert.equal(backend.properties.getProperty('AUTH_OWNER_ENROLL_HASH'), null)
  const late = call(backend, 'auth.bootstrapOwner', enrollPayload({
    password: 'OwnerPass14x',
  }), { requestId: 'enroll-c' })
  assert.equal(late.ok, false)
  assert.equal(late.error.code, 'FORBIDDEN')
  assert.equal(Boolean(late.data && late.data.sessionToken), false)
  assert.equal(credentialRows(backend).length, 1)
  assert.equal(sessionRows(backend).length, 1)
})

test('leftover enrollment hash cannot mint a second Owner credential', () => {
  const backend = ready()
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  const first = call(backend, 'auth.bootstrapOwner', enrollPayload())
  assert.equal(first.ok, true)
  backend.properties.setProperty('AUTH_OWNER_ENROLL_HASH', harnessOwnerEnrollHash())
  backend.properties.setProperty('AUTH_OWNER_ENROLL_USERNAME', HARNESS_OWNER_ENROLL_USERNAME)
  backend.properties.setProperty('AUTH_OWNER_ENROLL_USER_ID', HARNESS_OWNER_ENROLL_USER_ID)
  backend.properties.setProperty('AUTH_OWNER_ENROLL_EXPIRES_AT', harnessOwnerEnrollExpiry())
  const second = call(backend, 'auth.bootstrapOwner', enrollPayload({
    password: 'OwnerPass99x',
  }))
  assert.equal(second.ok, false)
  assert.equal(second.error.code, 'FORBIDDEN')
  assert.equal(Boolean(second.data && second.data.sessionToken), false)
  assert.equal(credentialRows(backend).length, 1)
  assert.equal(sessionRows(backend).length, 1)
})

test('after credentials exist, bootstrapOwner stays unavailable on the public route', () => {
  const backend = ready()
  const first = call(backend, 'auth.bootstrapOwner', {
    username: 'aina@coolslurppy.my',
    password: 'OwnerPass12',
  })
  assert.equal(first.ok, true)
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  const anonymous = call(backend, 'auth.bootstrapOwner', {
    username: 'aina@coolslurppy.my',
    password: 'OwnerPass12',
  })
  assert.equal(anonymous.error.code, 'UNAUTHORIZED')
  assert.equal(backend.context.isPublicAuthAction('auth.bootstrapOwner'), false)
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = true
  const again = call(backend, 'auth.bootstrapOwner', {
    username: 'aina@coolslurppy.my',
    password: 'OwnerPass99x',
  })
  assert.equal(again.error.code, 'FORBIDDEN')
  assert.equal(Boolean(again.data && again.data.sessionToken), false)
})

test('normal Owner login works after authorized enrollment and staff cannot enroll Owner', () => {
  const backend = ready()
  backend.context.AUTH_INJECT_TEST_OWNER_ENROLL = false
  const boot = call(backend, 'auth.bootstrapOwner', {
    username: 'aina@coolslurppy.my',
    password: 'OwnerPass12',
    ownerEnrollmentAuthorization: HARNESS_OWNER_ENROLL_SECRET,
  })
  assert.equal(boot.ok, true)
  const login = loginWithPassword(backend, 'aina@coolslurppy.my', 'OwnerPass12')
  assert.equal(login.ok, true)
  assert.equal(login.data.user.id, 'u-aina')
  const me = call(backend, 'auth.me', { sessionToken: login.data.sessionToken })
  assert.equal(me.ok, true)
  const staffClaim = call(backend, 'auth.bootstrapOwner', {
    sessionToken: login.data.sessionToken,
    username: 'mei@coolslurppy.my',
    password: 'StaffPass12',
    ownerEnrollmentAuthorization: HARNESS_OWNER_ENROLL_SECRET,
    isOwner: true,
  })
  assert.equal(staffClaim.ok, false)
})
