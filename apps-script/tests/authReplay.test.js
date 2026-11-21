import assert from 'node:assert/strict'
import { pbkdf2Sync } from 'node:crypto'
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

function ready() {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(call(backend, 'identity.bootstrap', identityPayload()).ok, true)
  const boot = call(backend, 'auth.bootstrapOwner', {
    username: 'aina@coolslurppy.my',
    password: 'OwnerPass12',
  })
  assert.equal(boot.ok, true)
  return backend
}

function stretch(password, saltHex) {
  return pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), 600000, 32, 'sha256').toString('hex')
}

function proofFor(backend, verifier, challenge, username, purpose = 'login') {
  return backend.context.authLoginProof(
    verifier,
    challenge.challengeId,
    challenge.challenge,
    username,
    purpose,
  )
}

function issue(backend, username, purpose = 'login') {
  const result = call(backend, 'auth.challenge', { username, purpose })
  assert.equal(result.ok, true, result.error && result.error.message)
  return result.data
}

test('captured login request cannot be replayed unchanged (HTTP request replay)', () => {
  const backend = ready()
  const challenge = issue(backend, 'aina@coolslurppy.my')
  const verifier = stretch('OwnerPass12', challenge.salt)
  const payload = {
    username: 'aina@coolslurppy.my',
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
    loginProof: proofFor(backend, verifier, challenge, 'aina@coolslurppy.my'),
  }
  const first = call(backend, 'auth.login', payload)
  assert.equal(first.ok, true)
  const replay = call(backend, 'auth.login', payload, { requestId: 'replay-1' })
  assert.equal(replay.ok, false)
  assert.equal(replay.error.message, 'Username or password is incorrect.')
})

test('reuse of an old challenge is rejected', () => {
  const backend = ready()
  const challenge = issue(backend, 'aina@coolslurppy.my')
  const verifier = stretch('OwnerPass12', challenge.salt)
  const first = call(backend, 'auth.login', {
    username: 'aina@coolslurppy.my',
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
    loginProof: proofFor(backend, verifier, challenge, 'aina@coolslurppy.my'),
  })
  assert.equal(first.ok, true)
  const next = issue(backend, 'aina@coolslurppy.my')
  const reused = call(backend, 'auth.login', {
    username: 'aina@coolslurppy.my',
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
    loginProof: proofFor(backend, verifier, next, 'aina@coolslurppy.my'),
  })
  assert.equal(reused.ok, false)
})

test('reuse of an old proof against a fresh challenge is rejected', () => {
  const backend = ready()
  const firstChallenge = issue(backend, 'aina@coolslurppy.my')
  const verifier = stretch('OwnerPass12', firstChallenge.salt)
  const oldProof = proofFor(backend, verifier, firstChallenge, 'aina@coolslurppy.my')
  assert.equal(call(backend, 'auth.login', {
    username: 'aina@coolslurppy.my',
    challengeId: firstChallenge.challengeId,
    challenge: firstChallenge.challenge,
    loginProof: oldProof,
  }).ok, true)
  const fresh = issue(backend, 'aina@coolslurppy.my')
  const replayProof = call(backend, 'auth.login', {
    username: 'aina@coolslurppy.my',
    challengeId: fresh.challengeId,
    challenge: fresh.challenge,
    loginProof: oldProof,
  })
  assert.equal(replayProof.ok, false)
})

test('expired challenge is rejected', () => {
  const backend = ready()
  const challenge = issue(backend, 'aina@coolslurppy.my')
  const rows = backend.spreadsheet.store.AuthChallenges
  const expiresIdx = rows[0].indexOf('expiresAt')
  rows[1][expiresIdx] = '2000-01-01T00:00:00.000Z'
  const verifier = stretch('OwnerPass12', challenge.salt)
  const expired = call(backend, 'auth.login', {
    username: 'aina@coolslurppy.my',
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
    loginProof: proofFor(backend, verifier, challenge, 'aina@coolslurppy.my'),
  })
  assert.equal(expired.ok, false)
})

test('challenge bound to a different username is rejected', () => {
  const backend = ready()
  const challenge = issue(backend, 'mei@coolslurppy.my')
  const verifier = stretch('OwnerPass12', challenge.salt)
  const stolen = call(backend, 'auth.login', {
    username: 'aina@coolslurppy.my',
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
    loginProof: proofFor(backend, verifier, challenge, 'aina@coolslurppy.my'),
  })
  assert.equal(stolen.ok, false)
})

test('challenge issued for a different purpose is rejected', () => {
  const backend = ready()
  const challenge = issue(backend, 'aina@coolslurppy.my', 'password-change')
  const verifier = stretch('OwnerPass12', challenge.salt)
  const wrongPurpose = call(backend, 'auth.login', {
    username: 'aina@coolslurppy.my',
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
    loginProof: proofFor(backend, verifier, challenge, 'aina@coolslurppy.my', 'login'),
  })
  assert.equal(wrongPurpose.ok, false)
})

test('two concurrent attempts using the same challenge cannot both succeed', () => {
  const backend = ready()
  const challenge = issue(backend, 'aina@coolslurppy.my')
  const verifier = stretch('OwnerPass12', challenge.salt)
  const payload = {
    username: 'aina@coolslurppy.my',
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
    loginProof: proofFor(backend, verifier, challenge, 'aina@coolslurppy.my'),
  }
  const first = call(backend, 'auth.login', payload, { requestId: 'race-a' })
  const second = call(backend, 'auth.login', payload, { requestId: 'race-b' })
  assert.equal(first.ok, true)
  assert.equal(second.ok, false)
})

test('captured password verifier can still answer a fresh challenge (residual verifier-equivalence)', () => {
  const backend = ready()
  const first = issue(backend, 'aina@coolslurppy.my')
  const stolenVerifier = stretch('OwnerPass12', first.salt)
  const fresh = issue(backend, 'aina@coolslurppy.my')
  const stolenLogin = call(backend, 'auth.login', {
    username: 'aina@coolslurppy.my',
    challengeId: fresh.challengeId,
    challenge: fresh.challenge,
    loginProof: proofFor(backend, stolenVerifier, fresh, 'aina@coolslurppy.my'),
  })
  assert.equal(stolenLogin.ok, true)
  assert.equal(stolenLogin.data.user.id, 'u-aina')
})

test('unknown username login fails with the generic error and does not mint a session', () => {
  const backend = ready()
  const challenge = issue(backend, 'nobody@coolslurppy.my')
  const verifier = stretch('OwnerPass12', challenge.salt)
  const unknown = call(backend, 'auth.login', {
    username: 'nobody@coolslurppy.my',
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
    loginProof: proofFor(backend, verifier, challenge, 'nobody@coolslurppy.my'),
  })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.message, 'Username or password is incorrect.')
  assert.equal(unknown.data, null)
})

test('failed logins lock the account and do not create a session', () => {
  const backend = ready()
  for (let i = 0; i < 5; i += 1) {
    const challenge = issue(backend, 'aina@coolslurppy.my')
    const verifier = stretch('wrong-password', challenge.salt)
    const failed = call(backend, 'auth.login', {
      username: 'aina@coolslurppy.my',
      challengeId: challenge.challengeId,
      challenge: challenge.challenge,
      loginProof: proofFor(backend, verifier, challenge, 'aina@coolslurppy.my'),
    }, { requestId: `lock-${i}` })
    assert.equal(failed.ok, false)
  }
  const challenge = issue(backend, 'aina@coolslurppy.my')
  const verifier = stretch('OwnerPass12', challenge.salt)
  const locked = call(backend, 'auth.login', {
    username: 'aina@coolslurppy.my',
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
    loginProof: proofFor(backend, verifier, challenge, 'aina@coolslurppy.my'),
  })
  assert.equal(locked.ok, false)
  assert.equal(locked.error.message, 'Username or password is incorrect.')
})

test('normal successful login mints a session only after a valid proof', () => {
  const backend = ready()
  const before = call(backend, 'auth.me', { sessionToken: '' })
  assert.equal(before.ok, false)
  assert.equal(before.error.code, 'UNAUTHORIZED')
  const challenge = issue(backend, 'aina@coolslurppy.my')
  const verifier = stretch('OwnerPass12', challenge.salt)
  const ok = call(backend, 'auth.login', {
    username: 'aina@coolslurppy.my',
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
    loginProof: proofFor(backend, verifier, challenge, 'aina@coolslurppy.my'),
  })
  assert.equal(ok.ok, true)
  assert.match(ok.data.sessionToken, /^[0-9a-f]{64}$/)
  const me = call(backend, 'auth.me', { sessionToken: ok.data.sessionToken })
  assert.equal(me.ok, true)
  assert.equal(me.data.user.id, 'u-aina')
  const rows = backend.spreadsheet.store.AuthSessions
  assert.equal(rows[1].includes(ok.data.sessionToken), false)
})
