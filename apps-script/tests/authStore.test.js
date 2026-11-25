import assert from 'node:assert/strict'
import nodeCrypto from 'node:crypto'
import test from 'node:test'
import {
  authDevProperties,
  createFakeSpreadsheet,
  createNonReentrantScriptLock,
  gasUtilities,
  loadBackend,
  memoryProperties,
} from './harness.js'

function dummyLocks(lockFails = false, locks = [], state) {
  return createNonReentrantScriptLock({ lockFails, events: locks, state: state || { held: false } })
}

function backend(options = {}) {
  const spreadsheet = options.spreadsheet || createFakeSpreadsheet()
  const properties = options.properties || authDevProperties()
  const locks = options.locks || []
  const lockState = options.lockState || { held: false }
  const context = loadBackend({
    PropertiesService: { getScriptProperties: () => properties },
    LockService: dummyLocks(options.lockFails, locks, lockState),
    SpreadsheetApp: {
      openById() {
        return spreadsheet
      },
    },
    ...options.globals,
  })
  const sheets = context.createSheetRepository({ openSpreadsheet: () => spreadsheet })
  return {
    spreadsheet,
    locks,
    lockState,
    context,
    properties,
    store: context.createAuthStore({
      sheetRepository: sheets,
      now: options.now,
    }),
    repo: context.createAuthRepository(sheets),
  }
}

function keyedKdfBackend(options = {}) {
  return backend({
    ...options,
    globals: { crypto: {}, ...(options.globals || {}) },
  })
}

function hmacDrbgBackend(options = {}) {
  return keyedKdfBackend(options)
}

function persistError(message) {
  const error = new Error(message)
  error.code = 'INTERNAL_ERROR'
  error.expose = true
  return error
}

test('Phase 1 uses HMAC-SHA256 lookup-secret hashing, not PBKDF2-12k', () => {
  const app = backend()
  assert.equal(app.context.AUTH_ALGORITHM, 'hmac-sha256')
  assert.equal(app.context.AUTH_SECRET_BYTES, 32)
  assert.equal(app.context.AUTH_MIN_ENTROPY_BITS, 128)
  assert.equal(app.context.AUTH_PEPPER_MIN_BYTES, 32)
  assert.equal(app.context.AUTH_PEPPER_HEX_LENGTH, 64)
  assert.equal(app.context.AUTH_PEPPER_MIN_HEX, 64)
  assert.equal(app.context.AUTH_KDF_INITIALIZED_VALUE, '1')
  assert.equal(app.context.AUTH_SECRET_BYTES * 8 >= app.context.AUTH_MIN_ENTROPY_BITS, true)
  assert.equal(app.context.AUTH_PBKDF2_ITERATIONS, undefined)
  assert.equal(app.context.AUTH_NIST_800_90A_RBG, false)
  assert.equal(app.context.AUTH_KDF_PRF_BITS, 256)
  assert.equal(typeof app.context.authPbkdf2, 'undefined')
  assert.equal(typeof app.context.authHashSecret, 'function')
  assert.equal(typeof app.context.authHmacSha256, 'function')
})

test('getConfig still does not require AUTH_CREDENTIAL_PEPPER', () => {
  const context = loadBackend({
    PropertiesService: {
      getScriptProperties: () => memoryProperties({
        ENVIRONMENT: 'DEV',
        SPREADSHEET_ID: 'sheet-id',
        DRIVE_ROOT_ID: 'drive-id',
        TIMEZONE: 'Asia/Kuala_Lumpur',
      }),
    },
  })
  const config = context.getConfig()
  assert.equal(config.environment, 'DEV')
  assert.equal(config.AUTH_CREDENTIAL_PEPPER, undefined)
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'pepper'), false)
})

test('CSPRNG generates 32-byte secrets and fails closed without a secure source', () => {
  const app = backend()
  const first = app.context.authGenerateSecret()
  const second = app.context.authGenerateSecret()
  assert.equal(first.plaintext.length, 64)
  assert.match(first.plaintext, /^[0-9a-f]{64}$/)
  assert.equal(first.entropyBits, 256)
  assert.equal(first.minEntropyBits, 128)
  assert.equal(first.outputBits, 256)
  assert.equal(first.entropyMeasured, true)
  assert.equal(first.entropyAssumption, 'web-crypto-csprng')
  assert.equal(first.source, 'web-crypto')
  assert.notEqual(first.plaintext, second.plaintext)

  const closed = loadBackend({
    crypto: {},
    Utilities: {},
    LockService: dummyLocks(),
    PropertiesService: { getScriptProperties: () => authDevProperties() },
  })
  assert.throws(() => closed.authRandomBytes(32), (error) => {
    assert.equal(error.code, 'INTERNAL_ERROR')
    return true
  })
})

test('SP 800-108 KDF is used when Web Crypto is absent and getUuid is never consulted', () => {
  let uuidCalls = 0
  let mathCalls = 0
  const mathRandom = Math.random
  Math.random = () => {
    mathCalls += 1
    return mathRandom()
  }
  const properties = authDevProperties()
  const utilities = gasUtilities()
  try {
    const context = loadBackend({
      crypto: {},
      LockService: dummyLocks(),
      PropertiesService: { getScriptProperties: () => properties },
      Utilities: {
        ...utilities,
        getUuid() {
          uuidCalls += 1
          throw new Error('Utilities.getUuid must not be used for authentication secrets')
        },
      },
    })
    assert.equal(typeof context.authFillFromUuidString, 'undefined')
    const first = context.authGenerateSecret()
    const second = context.authGenerateSecret()
    assert.equal(uuidCalls, 0)
    assert.equal(mathCalls, 0)
    assert.equal(first.raw.length, 32)
    assert.match(first.plaintext, /^[0-9a-f]{64}$/)
    assert.equal(first.source, 'sp800-108-kdf')
    assert.equal(first.minEntropyBits, 128)
    assert.equal(first.pepperLengthBits, 256)
    assert.equal(first.securityBoundBits, 256)
    assert.equal(first.entropyBits, 256)
    assert.equal(first.entropyMeasured, false)
    assert.equal(first.entropyAssumption, 'pepper-length-if-csprng-provisioned')
    assert.equal(first.outputBits, 256)
    assert.notEqual(first.plaintext, second.plaintext)
    assert.equal(Number(properties.getProperty('AUTH_KDF_COUNTER')) >= 2, true)
  } finally {
    Math.random = mathRandom
  }
})

test('keyed KDF fails closed without pepper or HMAC and does not use Math.random', () => {
  const noPepper = loadBackend({
    crypto: {},
    LockService: dummyLocks(),
    PropertiesService: {
      getScriptProperties: () => memoryProperties({
        ENVIRONMENT: 'DEV',
        SPREADSHEET_ID: 'sheet-id',
        DRIVE_ROOT_ID: 'drive-id',
        TIMEZONE: 'Asia/Kuala_Lumpur',
      }),
    },
  })
  assert.throws(() => noPepper.authGenerateSecret(), (error) => error.code === 'INTERNAL_ERROR')

  const noHmac = loadBackend({
    crypto: {},
    LockService: dummyLocks(),
    PropertiesService: { getScriptProperties: () => authDevProperties() },
    Utilities: {
      getUuid() {
        throw new Error('uuid')
      },
    },
  })
  assert.throws(() => noHmac.authGenerateSecret(), (error) => error.code === 'INTERNAL_ERROR')
})

test('pepper is required and fail-closed; hashes never store plaintext', () => {
  const missing = backend({
    properties: memoryProperties({
      ENVIRONMENT: 'DEV',
      SPREADSHEET_ID: 'sheet-id',
      DRIVE_ROOT_ID: 'drive-id',
      TIMEZONE: 'Asia/Kuala_Lumpur',
    }),
  })
  assert.throws(() => missing.store.issueCredential({ userId: 'u1', username: 'staff@example.com' }), (error) => {
    assert.equal(error.code, 'INTERNAL_ERROR')
    return true
  })

  const short = backend({
    properties: memoryProperties({
      ENVIRONMENT: 'DEV',
      SPREADSHEET_ID: 'sheet-id',
      DRIVE_ROOT_ID: 'drive-id',
      TIMEZONE: 'Asia/Kuala_Lumpur',
      AUTH_CREDENTIAL_PEPPER: 'abcd',
    }),
  })
  assert.throws(() => short.store.issueCredential({ userId: 'u1', username: 'staff@example.com' }), (error) => {
    assert.equal(error.code, 'INTERNAL_ERROR')
    return true
  })

  const app = backend()
  const issued = app.store.issueCredential({
    userId: 'user-1',
    username: 'staff@example.com',
    createdBy: 'owner-1',
    requestId: 'req-1',
  })
  assert.equal(issued.entropyBits >= 128, true)
  assert.equal(issued.record.algorithm, 'hmac-sha256')
  assert.equal(issued.record.secretHash.length, 64)
  assert.notEqual(issued.record.secretHash, issued.plaintext)
  const stored = JSON.stringify(app.spreadsheet.store.AuthCredentials)
  assert.equal(stored.includes(issued.plaintext), false)
  assert.equal(stored.toLowerCase().includes('password'), false)
  const rows = app.store.readCredentials()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].username, 'staff@example.com')
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'password'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'plaintext'), false)
})

test('ensureSheets creates AuthCredentials, AuthSessions, and AuthEvents on demand', () => {
  const app = backend()
  assert.deepEqual(Object.keys(app.spreadsheet.store), ['Sheet1'])
  app.store.ensureSheets()
  assert.deepEqual([...app.spreadsheet.store.AuthCredentials[0]], [...app.context.AUTH_CREDENTIAL_HEADERS])
  assert.deepEqual([...app.spreadsheet.store.AuthSessions[0]], [...app.context.AUTH_SESSION_HEADERS])
  assert.deepEqual([...app.spreadsheet.store.AuthEvents[0]], [...app.context.AUTH_EVENT_HEADERS])
  assert.deepEqual(app.spreadsheet.store.Sheet1, [['']])
  assert.equal(app.spreadsheet.store.AuditLogs, undefined)
})

test('issueCredential verifies the generated secret and rejects a wrong secret', () => {
  const app = backend()
  const issued = app.store.issueCredential({
    userId: 'user-1',
    username: 'Staff@Example.com',
    createdBy: 'owner-1',
  })
  const ok = app.store.verifyCredential('staff@example.com', issued.plaintext)
  assert.equal(ok.ok, true)
  assert.equal(ok.userId, 'user-1')
  const wrong = app.store.verifyCredential('staff@example.com', '00'.repeat(32))
  assert.equal(wrong.ok, false)
  assert.equal(app.locks.includes('acquired'), true)
  assert.equal(app.locks.at(-1), 'released')
})

test('rotateCredential invalidates the old secret and revokes existing sessions', () => {
  const app = backend()
  const issued = app.store.issueCredential({
    userId: 'user-1',
    username: 'staff@example.com',
    createdBy: 'owner-1',
  })
  const session = app.store.issueSession({ userId: 'user-1' })
  assert.equal(Boolean(app.store.validateSession(session.token)), true)
  const rotated = app.store.rotateCredential({ userId: 'user-1', createdBy: 'owner-1', requestId: 'rotate-1' })
  assert.notEqual(rotated.plaintext, issued.plaintext)
  assert.equal(app.store.verifyCredential('staff@example.com', issued.plaintext).ok, false)
  assert.equal(app.store.verifyCredential('staff@example.com', rotated.plaintext).ok, true)
  assert.equal(app.store.validateSession(session.token), null)
  const events = app.store.readEvents()
  assert.equal(events.some((item) => item.eventType === 'credential_rotated' && item.reason === 'previous_invalidated'), true)
  const sessions = JSON.stringify(app.spreadsheet.store.AuthSessions)
  assert.equal(sessions.includes(session.token), false)
})

test('HMAC verification is timing-safe and rejects a truncated secret', () => {
  const app = backend()
  const pepper = app.context.authHexToBytes('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
  const hashed = app.context.authHashSecret('ab'.repeat(32), pepper)
  assert.equal(app.context.authVerifySecret('ab'.repeat(32), hashed, pepper), true)
  assert.equal(app.context.authVerifySecret('cd'.repeat(32), hashed, pepper), false)
  assert.equal(app.context.authVerifySecret('ab'.repeat(16), hashed, pepper), false)
  assert.equal(app.context.authTimingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true)
  assert.equal(app.context.authTimingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false)
})

test('repository refuses to persist plaintext password, secret, or token fields', () => {
  const app = backend()
  app.store.ensureSheets()
  assert.throws(
    () => app.repo.writeCredentials(app.spreadsheet, [{
      id: 'c1',
      userId: 'user-1',
      username: 'staff@example.com',
      algorithm: 'hmac-sha256',
      secretHash: '00'.repeat(32),
      status: 'active',
      password: 'should-not-store',
    }]),
    (error) => error.code === 'INTERNAL_ERROR',
  )
  assert.throws(
    () => app.repo.writeSessions(app.spreadsheet, [{
      id: 's1',
      userId: 'user-1',
      tokenHash: '00'.repeat(32),
      token: 'raw-session-token',
    }]),
    (error) => error.code === 'INTERNAL_ERROR',
  )
  assert.throws(
    () => app.repo.writeCredentials(app.spreadsheet, [{
      id: 'c2',
      userId: 'user-1',
      username: 'staff@example.com',
      algorithm: 'hmac-sha256',
      secretHash: '00'.repeat(32),
      status: 'active',
      pepper: 'should-not-store',
    }]),
    (error) => error.code === 'INTERNAL_ERROR',
  )
})

test('issueCredential holds the script lock and fails closed when the lock is busy', () => {
  const app = backend()
  app.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' })
  assert.equal(app.locks.filter((item) => item === 'acquired').length > 0, true)
  const blocked = backend({ lockFails: true, spreadsheet: app.spreadsheet })
  assert.throws(
    () => blocked.store.issueCredential({ userId: 'user-2', username: 'other@example.com' }),
    (error) => error.code === 'CONFLICT',
  )
})

test('issueCredential replacement revokes that user sessions and leaves other users valid', () => {
  const app = backend()
  app.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' })
  app.store.issueCredential({ userId: 'user-2', username: 'other@example.com', createdBy: 'owner-1' })
  const firstSession = app.store.issueSession({ userId: 'user-1' })
  const otherSession = app.store.issueSession({ userId: 'user-2' })
  assert.equal(Boolean(app.store.validateSession(firstSession.token)), true)
  assert.equal(Boolean(app.store.validateSession(otherSession.token)), true)

  const replacement = app.store.issueCredential({
    userId: 'user-1',
    username: 'staff@example.com',
    createdBy: 'owner-1',
    requestId: 'replace-1',
  })
  assert.equal(app.store.validateSession(firstSession.token), null)
  assert.equal(Boolean(app.store.validateSession(otherSession.token)), true)
  assert.equal(app.store.verifyCredential('staff@example.com', replacement.plaintext).ok, true)
  const rows = app.repo.readSessions(app.spreadsheet)
  const revoked = rows.find((item) => item.userId === 'user-1' && item.tokenHash === app.context.authHashToken(firstSession.token))
  assert.equal(revoked.revokedReason, 'credential_replaced')
  assert.equal(String(revoked.revokedAt).length > 0, true)
  assert.equal(app.locks.filter((item) => item === 'acquired').length > 0, true)
  const serialized = JSON.stringify(app.spreadsheet.store)
  assert.equal(serialized.includes(firstSession.token), false)
  assert.equal(serialized.includes(replacement.plaintext), false)
})

test('validateSession slides idle expiry, never extends absolute expiry, and keeps expired or revoked sessions invalid', () => {
  let current = Date.parse('2026-01-01T00:00:00.000Z')
  const app = backend({ now: () => new Date(current) })
  app.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' })
  const session = app.store.issueSession({ userId: 'user-1' })
  const issued = app.repo.readSessions(app.spreadsheet)[0]
  const originalExpiry = issued.expiresAt
  assert.equal(Date.parse(originalExpiry) - current, app.context.AUTH_SESSION_ABSOLUTE_MS)
  assert.equal(Date.parse(issued.idleExpiresAt) - current, app.context.AUTH_SESSION_IDLE_MS)

  current += 60 * 60 * 1000
  const active = app.store.validateSession(session.token)
  assert.equal(Boolean(active), true)
  assert.equal(active.expiresAt, originalExpiry)
  assert.equal(active.lastSeenAt, new Date(current).toISOString())
  assert.equal(Date.parse(active.idleExpiresAt) - current, app.context.AUTH_SESSION_IDLE_MS)
  assert.equal(app.locks.includes('acquired'), true)

  current += 60 * 60 * 1000
  const again = app.store.validateSession(session.token)
  assert.equal(again.expiresAt, originalExpiry)
  assert.equal(Date.parse(again.idleExpiresAt) - current, app.context.AUTH_SESSION_IDLE_MS)

  const idleApp = backend({ now: () => new Date(current) })
  idleApp.store.issueCredential({ userId: 'idle-user', username: 'idle@example.com', createdBy: 'owner-1' })
  const idleSession = idleApp.store.issueSession({ userId: 'idle-user' })
  current += app.context.AUTH_SESSION_IDLE_MS
  assert.equal(idleApp.store.validateSession(idleSession.token), null)
  const idleRow = idleApp.repo.readSessions(idleApp.spreadsheet)[0]
  assert.equal(idleRow.lastSeenAt, idleSession.record.lastSeenAt)
  assert.equal(idleRow.expiresAt, idleSession.record.expiresAt)

  current = Date.parse('2026-01-01T00:00:00.000Z')
  const absoluteApp = backend({ now: () => new Date(current) })
  absoluteApp.store.issueCredential({ userId: 'abs-user', username: 'abs@example.com', createdBy: 'owner-1' })
  const absoluteSession = absoluteApp.store.issueSession({ userId: 'abs-user' })
  const originalAbsExpiry = absoluteSession.record.expiresAt
  for (let hour = 1; hour <= 11; hour += 1) {
    current += 60 * 60 * 1000
    const live = absoluteApp.store.validateSession(absoluteSession.token)
    assert.equal(Boolean(live), true, 'session should stay valid while idle is refreshed before 12h')
    assert.equal(live.expiresAt, originalAbsExpiry)
    assert.equal(Date.parse(live.idleExpiresAt) <= Date.parse(originalAbsExpiry), true)
  }
  current += 60 * 60 * 1000
  assert.equal(absoluteApp.store.validateSession(absoluteSession.token), null)

  current = Date.parse('2026-01-01T00:00:00.000Z')
  const revokedApp = backend({ now: () => new Date(current) })
  revokedApp.store.issueCredential({ userId: 'rev-user', username: 'rev@example.com', createdBy: 'owner-1' })
  const revokedSession = revokedApp.store.issueSession({ userId: 'rev-user' })
  revokedApp.store.revokeUserSessions('rev-user', 'manual')
  current += 60 * 1000
  assert.equal(revokedApp.store.validateSession(revokedSession.token), null)
  const revokedRow = revokedApp.repo.readSessions(revokedApp.spreadsheet)[0]
  assert.equal(revokedRow.lastSeenAt, revokedSession.record.lastSeenAt)
})

test('validateSession concurrent updates take the script lock and fail closed when the lock is busy', () => {
  let current = Date.parse('2026-02-01T00:00:00.000Z')
  const app = backend({ now: () => new Date(current) })
  app.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' })
  const session = app.store.issueSession({ userId: 'user-1' })
  const originalExpiry = session.record.expiresAt
  const first = app.store.validateSession(session.token)
  current += 30 * 60 * 1000
  const second = app.store.validateSession(session.token)
  assert.equal(first.expiresAt, originalExpiry)
  assert.equal(second.expiresAt, originalExpiry)
  assert.equal(Date.parse(second.lastSeenAt) > Date.parse(first.lastSeenAt), true)
  assert.equal(Date.parse(second.idleExpiresAt) > Date.parse(first.idleExpiresAt), true)
  assert.equal(app.locks.filter((item) => item === 'acquired').length >= 3, true)

  const blocked = backend({ lockFails: true, spreadsheet: app.spreadsheet, now: () => new Date(current) })
  assert.throws(() => blocked.store.validateSession(session.token), (error) => error.code === 'CONFLICT')
  const still = app.store.validateSession(session.token)
  assert.equal(Boolean(still), true)
  assert.equal(still.expiresAt, originalExpiry)
})

test('Apps Script script lock rejects nested tryLock in the same execution', () => {
  const app = hmacDrbgBackend()
  const lock = app.context.LockService.getScriptLock()
  assert.equal(lock.tryLock(), true)
  assert.equal(lock.tryLock(), false)
  assert.equal(app.locks.includes('nested-rejected'), true)
  lock.releaseLock()
  assert.equal(lock.tryLock(), true)
  lock.releaseLock()
})

test('keyed KDF never reacquires the caller lock during issue, rotate, and session', () => {
  const app = hmacDrbgBackend()
  const issued = app.store.issueCredential({
    userId: 'user-1',
    username: 'staff@example.com',
    createdBy: 'owner-1',
  })
  assert.equal(issued.plaintext.length, 64)
  assert.equal(app.store.verifyCredential('staff@example.com', issued.plaintext).ok, true)
  assert.equal(app.locks.filter((item) => item === 'acquired').length, 1)
  assert.equal(app.locks.filter((item) => item === 'nested-rejected').length, 0)
  assert.equal(app.lockState.held, false)

  const session = app.store.issueSession({ userId: 'user-1' })
  assert.equal(Boolean(app.store.validateSession(session.token)), true)
  assert.equal(app.locks.includes('nested-rejected'), false)

  const rotated = app.store.rotateCredential({ userId: 'user-1', createdBy: 'owner-1' })
  assert.notEqual(rotated.plaintext, issued.plaintext)
  assert.equal(app.store.verifyCredential('staff@example.com', issued.plaintext).ok, false)
  assert.equal(app.store.verifyCredential('staff@example.com', rotated.plaintext).ok, true)
  assert.equal(app.store.validateSession(session.token), null)
  assert.equal(app.locks.filter((item) => item === 'nested-rejected').length, 0)
  assert.equal(JSON.stringify(app.spreadsheet.store).includes(issued.plaintext), false)
  assert.equal(JSON.stringify(app.spreadsheet.store).includes(session.token), false)
})

test('keyed KDF refuses to mint secrets unless a script lock is already held', () => {
  const app = hmacDrbgBackend()
  assert.equal(app.context.scriptLockDepth, 0)
  assert.throws(() => app.context.authKeyedKdfBytes(32), (error) => error.code === 'INTERNAL_ERROR')
  assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), null)

  const generated = app.context.withScriptLock(() => app.context.authKeyedKdfBytes(32))
  assert.equal(generated.length, 32)
  assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), '1')
  assert.equal(app.properties.getProperty('AUTH_KDF_INITIALIZED'), '1')
})

test('concurrent keyed KDF generation serializes on the script lock and never duplicates output', () => {
  const properties = authDevProperties()
  const lockState = { held: false }
  const firstLocks = []
  const secondLocks = []
  const first = hmacDrbgBackend({ properties, lockState, locks: firstLocks })
  const second = hmacDrbgBackend({ properties, lockState, locks: secondLocks })

  const one = first.store.issueCredential({ userId: 'user-1', username: 'one@example.com', createdBy: 'owner-1' })
  const two = second.store.issueCredential({ userId: 'user-2', username: 'two@example.com', createdBy: 'owner-1' })
  assert.notEqual(one.plaintext, two.plaintext)
  assert.equal(properties.getProperty('AUTH_KDF_COUNTER'), '2')

  const held = first.context.LockService.getScriptLock()
  assert.equal(held.tryLock(), true)
  const before = properties.getProperty('AUTH_KDF_COUNTER')
  assert.throws(
    () => second.store.issueCredential({ userId: 'user-3', username: 'three@example.com', createdBy: 'owner-1' }),
    (error) => error.code === 'CONFLICT',
  )
  assert.equal(properties.getProperty('AUTH_KDF_COUNTER'), before)
  assert.equal(secondLocks.includes('nested-rejected'), true)
  held.releaseLock()

  const three = second.store.issueCredential({ userId: 'user-3', username: 'three@example.com', createdBy: 'owner-1' })
  assert.notEqual(three.plaintext, one.plaintext)
  assert.notEqual(three.plaintext, two.plaintext)
  assert.equal(properties.getProperty('AUTH_KDF_COUNTER'), '3')
})

function rangeBytes(start, length) {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) out[i] = (start + i) & 255
  return out
}

test('HMAC_DRBG Update and Generate match the published SHA-256 known-answer vector', () => {
  const app = hmacDrbgBackend()
  const entropy = rangeBytes(0x00, 32)
  const nonce = rangeBytes(0x20, 16)
  const state = app.context.authHmacDrbgInstantiate(entropy, nonce, new Uint8Array(0))
  assert.equal(app.context.authBytesToHex(state.key), '345c7f099d0c4adce91379b6e2e03edfd4c2fa0b874e7a5b3cf24fb11f6ed4f1')
  assert.equal(app.context.authBytesToHex(state.value), '976b4836a5b3d828293e26900371f2d49e5a11754c0a45c9cc4c8fe921014a03')
  const first = app.context.authHmacDrbgGenerate(state, 32, new Uint8Array(0))
  assert.equal(app.context.authBytesToHex(first.bytes), '0ffb80875a3e9022a4941a3fa1b0d3611df14e1cf651a73ce9229b9f3ad56887')
  assert.equal(first.reseedCounter, 2)
  assert.notEqual(app.context.authBytesToHex(first.key), app.context.authBytesToHex(state.key))
  const second = app.context.authHmacDrbgGenerate(first, 32, new Uint8Array(0))
  assert.equal(app.context.authBytesToHex(second.bytes), '08767656d3e9669eb668d1e1f5b80d27bb1aee12ff719eeb83e3dce006718c16')
  assert.equal(app.context.AUTH_NIST_800_90A_RBG, false)
})

test('keyed KDF fails closed on counter reset, property deletion, and reinitialization after use', () => {
  const app = hmacDrbgBackend()
  const first = app.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' })
  const second = app.store.issueCredential({ userId: 'user-2', username: 'other@example.com', createdBy: 'owner-1' })
  assert.notEqual(first.plaintext, second.plaintext)
  const counter = app.properties.getProperty('AUTH_KDF_COUNTER')
  assert.equal(Number(counter) >= 2, true)

  app.properties.setProperty('AUTH_KDF_COUNTER', '1')
  assert.throws(
    () => app.store.issueCredential({ userId: 'user-3', username: 'third@example.com', createdBy: 'owner-1' }),
    (error) => error.code === 'INTERNAL_ERROR',
  )
  assert.equal(app.store.verifyCredential('staff@example.com', first.plaintext).ok, true)

  app.properties.setProperty('AUTH_KDF_COUNTER', counter)
  app.properties.deleteProperty('AUTH_KDF_INITIALIZED')
  assert.throws(
    () => app.store.issueCredential({ userId: 'user-3', username: 'third@example.com', createdBy: 'owner-1' }),
    (error) => error.code === 'INTERNAL_ERROR',
  )

  app.properties.deleteProperty('AUTH_KDF_COUNTER')
  app.properties.deleteProperty('AUTH_KDF_INITIALIZED')
  assert.throws(
    () => app.store.issueCredential({ userId: 'user-3', username: 'third@example.com', createdBy: 'owner-1' }),
    (error) => error.code === 'INTERNAL_ERROR',
  )
  assert.equal(app.store.verifyCredential('other@example.com', second.plaintext).ok, true)
})

test('keyed KDF reports a length-based security bound, not measured entropy', () => {
  const app = keyedKdfBackend()
  const issued = app.store.issueCredential({
    userId: 'user-1',
    username: 'staff@example.com',
    createdBy: 'owner-1',
  })
  assert.equal(issued.source, 'sp800-108-kdf')
  assert.equal(issued.entropyMeasured, false)
  assert.equal(issued.entropyAssumption, 'pepper-length-if-csprng-provisioned')
  assert.equal(issued.securityBoundBits, 256)
  assert.equal(issued.entropyBits, 256)
  const secret = app.context.withScriptLock(() => app.context.authGenerateSecret())
  assert.equal(secret.pepperLengthBits, 256)
  assert.equal(secret.outputBits, 256)
  assert.equal(secret.minEntropyBits, 128)
  assert.equal(secret.entropyMeasured, false)
  assert.notEqual(secret.source, 'csprng')
})

test('SP 800-108 counter-mode PRF input is [i] || Label || 0x00 || Context || [L]', () => {
  const app = keyedKdfBackend()
  const label = 'csp.auth.lookup-secret.v1'
  const labelBytes = Buffer.from(label, 'utf8')
  const message = app.context.authConcatBytes(
    app.context.authU32be(1),
    app.context.authToBytes(label),
    new Uint8Array([0]),
    app.context.authU64be(1),
    app.context.authU32be(256),
  )
  assert.equal(message.length, 4 + labelBytes.length + 1 + 8 + 4)
  assert.deepEqual([...message.slice(0, 4)], [0, 0, 0, 1])
  assert.deepEqual([...message.slice(4, 4 + labelBytes.length)], [...labelBytes])
  assert.equal(message[4 + labelBytes.length], 0)
  const afterSep = 4 + labelBytes.length + 1
  assert.deepEqual([...message.slice(afterSep, afterSep + 8)], [0, 0, 0, 0, 0, 0, 0, 1])
  assert.deepEqual([...message.slice(afterSep + 8)], [0, 0, 1, 0])

  const prk = app.context.authHmacSha256(
    app.context.authReadPepper(),
    app.context.authToBytes('csp.auth.kdf.key.v1'),
  )
  const expected = app.context.authSp800108Block(
    prk,
    1,
    label,
    app.context.authU64be(1),
    256,
  )
  const actual = app.context.withScriptLock(() => app.context.authKeyedKdfBytes(32))
  assert.deepEqual([...actual], [...expected])
})

test('keyed KDF rejects malformed counters and fails closed at MAX_SAFE_INTEGER', () => {
  const malformed = ['0', '01', '1e2', '1.5', '1abc', '-1', '+1', '0x10', '1 ', ' 1', '1.0', '9007199254740992', '9007199254740993']
  for (const value of malformed) {
    const app = keyedKdfBackend()
    app.properties.setProperty('AUTH_KDF_INITIALIZED', '1')
    app.properties.setProperty('AUTH_KDF_COUNTER', value)
    assert.throws(
      () => app.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' }),
      (error) => error.code === 'INTERNAL_ERROR',
      `should reject ${JSON.stringify(value)}`,
    )
    assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), value)
  }

  const missing = keyedKdfBackend()
  missing.properties.setProperty('AUTH_KDF_INITIALIZED', '1')
  assert.throws(
    () => missing.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' }),
    (error) => error.code === 'INTERNAL_ERROR',
  )

  const atMax = keyedKdfBackend()
  atMax.properties.setProperty('AUTH_KDF_INITIALIZED', '1')
  atMax.properties.setProperty('AUTH_KDF_COUNTER', String(Number.MAX_SAFE_INTEGER))
  assert.throws(
    () => atMax.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' }),
    (error) => error.code === 'INTERNAL_ERROR',
  )
  assert.equal(atMax.properties.getProperty('AUTH_KDF_COUNTER'), String(Number.MAX_SAFE_INTEGER))

  const last = keyedKdfBackend()
  last.properties.setProperty('AUTH_KDF_INITIALIZED', '1')
  last.properties.setProperty('AUTH_KDF_COUNTER', String(Number.MAX_SAFE_INTEGER - 1))
  const issued = last.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' })
  assert.equal(issued.plaintext.length, 64)
  assert.equal(last.properties.getProperty('AUTH_KDF_COUNTER'), String(Number.MAX_SAFE_INTEGER))
  assert.throws(
    () => last.store.issueCredential({ userId: 'user-2', username: 'other@example.com', createdBy: 'owner-1' }),
    (error) => error.code === 'INTERNAL_ERROR',
  )
  assert.equal(last.store.verifyCredential('staff@example.com', issued.plaintext).ok, true)
})

test('kdf_advance high-water rejects malformed reasons fail-closed', () => {
  const app = keyedKdfBackend()
  app.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' })
  const row = app.spreadsheet.store.AuthEvents.find((item, index) => index > 0 && item[4] === 'kdf_advance')
  assert.equal(Boolean(row), true)
  row[6] = '01'
  assert.throws(
    () => app.store.issueCredential({ userId: 'user-2', username: 'other@example.com', createdBy: 'owner-1' }),
    (error) => error.code === 'INTERNAL_ERROR',
  )
  assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), '1')
})

test('partial failure after counter persist skips the used counter and recovers', () => {
  let failAdvance = true
  const spreadsheet = createFakeSpreadsheet({}, {
    beforeAppendRow(name, row) {
      if (failAdvance && name === 'AuthEvents' && row[4] === 'kdf_advance') {
        failAdvance = false
        throw persistError('AuthEvents append failed')
      }
    },
  })
  const app = keyedKdfBackend({ spreadsheet })
  assert.throws(
    () => app.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' }),
    (error) => error.code === 'INTERNAL_ERROR',
  )
  assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), '1')
  assert.equal(app.properties.getProperty('AUTH_KDF_INITIALIZED'), '1')
  const firstEvents = app.spreadsheet.store.AuthEvents || [['']]
  assert.equal(firstEvents.filter((row, index) => index > 0 && row[4] === 'kdf_advance').length, 0)

  const issued = app.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' })
  assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), '2')
  assert.equal(app.store.verifyCredential('staff@example.com', issued.plaintext).ok, true)
  const recovered = app.store.readEvents().filter((item) => item.eventType === 'kdf_advance')
  assert.deepEqual(recovered.map((item) => item.reason), ['2'])
})

test('partial failure after kdf_advance before credential persist recovers without repeating the counter', () => {
  let failWrite = false
  const spreadsheet = createFakeSpreadsheet({}, {
    beforeClearContent(name, row) {
      if (failWrite && name === 'AuthCredentials' && row === 2) {
        failWrite = false
        throw persistError('credential write failed')
      }
    },
  })
  const app = keyedKdfBackend({ spreadsheet })
  const first = app.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' })
  failWrite = true
  assert.throws(
    () => app.store.issueCredential({ userId: 'user-2', username: 'other@example.com', createdBy: 'owner-1' }),
    (error) => error.code === 'INTERNAL_ERROR',
  )
  assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), '2')
  const advances = app.store.readEvents().filter((item) => item.eventType === 'kdf_advance').map((item) => item.reason)
  assert.deepEqual(advances, ['1', '2'])
  assert.equal(app.store.verifyCredential('staff@example.com', first.plaintext).ok, true)
  assert.equal(app.store.verifyCredential('other@example.com', first.plaintext).ok, false)

  const recovered = app.store.issueCredential({ userId: 'user-2', username: 'other@example.com', createdBy: 'owner-1' })
  assert.notEqual(recovered.plaintext, first.plaintext)
  assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), '3')
  assert.equal(app.store.verifyCredential('other@example.com', recovered.plaintext).ok, true)
  assert.equal(app.store.verifyCredential('staff@example.com', first.plaintext).ok, true)
})

test('AUTH_CREDENTIAL_PEPPER must be exactly 64 hex characters with no trim or repair', () => {
  const base = {
    ENVIRONMENT: 'DEV',
    SPREADSHEET_ID: 'sheet-id',
    DRIVE_ROOT_ID: 'drive-id',
    TIMEZONE: 'Asia/Kuala_Lumpur',
  }
  const exact64 = 'ab'.repeat(32)
  assert.equal(exact64.length, 64)

  const valid = keyedKdfBackend({
    properties: memoryProperties({ ...base, AUTH_CREDENTIAL_PEPPER: exact64 }),
  })
  const issued = valid.store.issueCredential({ userId: 'u1', username: 'staff@example.com', createdBy: 'owner-1' })
  assert.equal(issued.plaintext.length, 64)
  assert.equal(valid.properties.getProperty('AUTH_CREDENTIAL_PEPPER'), exact64)

  const upper = keyedKdfBackend({
    properties: memoryProperties({ ...base, AUTH_CREDENTIAL_PEPPER: exact64.toUpperCase() }),
  })
  assert.equal(upper.store.issueCredential({
    userId: 'u2',
    username: 'upper@example.com',
    createdBy: 'owner-1',
  }).plaintext.length, 64)

  const missing = keyedKdfBackend({ properties: memoryProperties(base) })
  assert.throws(
    () => missing.store.issueCredential({ userId: 'u1', username: 'staff@example.com' }),
    (error) => error.code === 'INTERNAL_ERROR',
  )
  assert.equal(missing.properties.getProperty('AUTH_CREDENTIAL_PEPPER'), null)
  assert.equal(missing.properties.getProperty('AUTH_KDF_COUNTER'), null)

  const rejected = {
    chars32: 'ab'.repeat(16),
    chars66: `${exact64}ab`,
    chars96: 'ab'.repeat(48),
    oddLength: `${'ab'.repeat(31)}a`,
    leadingSpace: ` ${exact64}`,
    trailingSpace: `${exact64} `,
    wrappedSpace: ` ${exact64} `,
    nonHex: 'g'.repeat(64),
  }
  for (const [label, value] of Object.entries(rejected)) {
    const app = keyedKdfBackend({
      properties: memoryProperties({ ...base, AUTH_CREDENTIAL_PEPPER: value }),
    })
    assert.throws(
      () => app.store.issueCredential({ userId: 'u1', username: 'staff@example.com' }),
      (error) => error.code === 'INTERNAL_ERROR',
      `should reject ${label}`,
    )
    assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), null, `must not mint after ${label}`)
    assert.equal(app.properties.getProperty('AUTH_CREDENTIAL_PEPPER'), value)
  }
})

test('AUTH_KDF_INITIALIZED accepts only missing/empty or exact 1 and fail-closes otherwise', () => {
  const invalidFlags = ['0', 'true', 'invalid', ' 1', '1 ', 'yes']
  for (const flag of invalidFlags) {
    const app = keyedKdfBackend()
    app.properties.setProperty('AUTH_KDF_INITIALIZED', flag)
    assert.throws(
      () => app.store.issueCredential({ userId: 'u1', username: 'staff@example.com', createdBy: 'owner-1' }),
      (error) => error.code === 'INTERNAL_ERROR',
      `should reject initialized=${JSON.stringify(flag)}`,
    )
    assert.equal(app.properties.getProperty('AUTH_KDF_INITIALIZED'), flag)
    assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), null)
  }

  const withOutputs = keyedKdfBackend()
  const first = withOutputs.store.issueCredential({
    userId: 'user-1',
    username: 'staff@example.com',
    createdBy: 'owner-1',
  })
  withOutputs.properties.deleteProperty('AUTH_KDF_INITIALIZED')
  assert.throws(
    () => withOutputs.store.issueCredential({ userId: 'user-2', username: 'other@example.com', createdBy: 'owner-1' }),
    (error) => error.code === 'INTERNAL_ERROR',
  )
  assert.equal(withOutputs.store.verifyCredential('staff@example.com', first.plaintext).ok, true)
  assert.equal(withOutputs.properties.getProperty('AUTH_KDF_INITIALIZED'), null)

  const leftoverCounter = keyedKdfBackend()
  leftoverCounter.properties.setProperty('AUTH_KDF_COUNTER', '4')
  assert.throws(
    () => leftoverCounter.store.issueCredential({ userId: 'u3', username: 'third@example.com', createdBy: 'owner-1' }),
    (error) => error.code === 'INTERNAL_ERROR',
  )
  assert.equal(leftoverCounter.properties.getProperty('AUTH_KDF_INITIALIZED'), null)
  assert.equal(leftoverCounter.properties.getProperty('AUTH_KDF_COUNTER'), '4')

  const firstBoot = keyedKdfBackend()
  assert.equal(firstBoot.properties.getProperty('AUTH_KDF_INITIALIZED'), null)
  assert.equal(firstBoot.properties.getProperty('AUTH_KDF_COUNTER'), null)
  const minted = firstBoot.store.issueCredential({
    userId: 'user-1',
    username: 'fresh@example.com',
    createdBy: 'owner-1',
  })
  assert.equal(minted.plaintext.length, 64)
  assert.equal(firstBoot.properties.getProperty('AUTH_KDF_INITIALIZED'), '1')
  assert.equal(firstBoot.properties.getProperty('AUTH_KDF_COUNTER'), '1')
  assert.equal(firstBoot.store.verifyCredential('fresh@example.com', minted.plaintext).ok, true)
})

test('a 32-byte CSPRNG pepper is accepted and never leaks into sheets, events, or errors', () => {
  const pepper = nodeCrypto.randomBytes(32).toString('hex')
  assert.equal(pepper.length, 64)
  const properties = memoryProperties({
    ENVIRONMENT: 'DEV',
    SPREADSHEET_ID: 'sheet-id',
    DRIVE_ROOT_ID: 'drive-id',
    TIMEZONE: 'Asia/Kuala_Lumpur',
    AUTH_CREDENTIAL_PEPPER: pepper,
  })
  const app = keyedKdfBackend({ properties })
  const issued = app.store.issueCredential({
    userId: 'user-1',
    username: 'staff@example.com',
    createdBy: 'owner-1',
    requestId: 'req-pepper',
  })
  assert.equal(issued.plaintext.length, 64)
  assert.equal(issued.entropyMeasured, false)
  const dump = JSON.stringify(app.spreadsheet.store)
  assert.equal(dump.includes(pepper), false)
  assert.equal(dump.toLowerCase().includes(pepper), false)
  const events = JSON.stringify(app.store.readEvents())
  assert.equal(events.includes(pepper), false)
  assert.equal(events.includes(issued.plaintext), false)
  let failed
  try {
    app.store.issueCredential({ userId: '', username: '' })
  } catch (error) {
    failed = error
  }
  assert.equal(Boolean(failed), true)
  assert.equal(String(failed && failed.message || '').includes(pepper), false)
  assert.equal(JSON.stringify(failed).includes(pepper), false)
})

test('SP 800-108 key and output labels are domain-separated from credential HMAC', () => {
  const app = keyedKdfBackend()
  const pepper = app.context.authReadPepper()
  const prk = app.context.authHmacSha256(pepper, app.context.authToBytes(app.context.AUTH_KDF_KEY_LABEL))
  const other = app.context.authHmacSha256(pepper, app.context.authToBytes(app.context.AUTH_KDF_LABEL))
  const secret = app.context.withScriptLock(() => app.context.authGenerateSecret())
  const cred = app.context.authHmacSha256(pepper, secret.raw)
  const block = app.context.authSp800108Block(
    prk,
    1,
    app.context.AUTH_KDF_LABEL,
    app.context.authU64be(secret.counter),
    256,
  )
  assert.notEqual(app.context.authBytesToHex(prk), app.context.authBytesToHex(other))
  assert.notEqual(app.context.authBytesToHex(prk), app.context.authBytesToHex(cred))
  assert.notEqual(app.context.authBytesToHex(block), app.context.authBytesToHex(cred))
  assert.deepEqual([...block], [...secret.raw])
  assert.equal(app.context.AUTH_KDF_KEY_LABEL === app.context.AUTH_KDF_LABEL, false)
})

test('SP 800-108 multi-block output uses incrementing i and total L in bits', () => {
  const app = keyedKdfBackend()
  const prk = app.context.authHmacSha256(
    app.context.authReadPepper(),
    app.context.authToBytes(app.context.AUTH_KDF_KEY_LABEL),
  )
  const actual = app.context.withScriptLock(() => app.context.authKeyedKdfBytes(40))
  const context = app.context.authU64be(1)
  const first = app.context.authSp800108Block(prk, 1, app.context.AUTH_KDF_LABEL, context, 320)
  const second = app.context.authSp800108Block(prk, 2, app.context.AUTH_KDF_LABEL, context, 320)
  const expected = app.context.authConcatBytes(first, second).slice(0, 40)
  assert.equal(actual.length, 40)
  assert.deepEqual([...actual], [...expected])
  assert.notEqual(app.context.authBytesToHex(first), app.context.authBytesToHex(second))
})

test('HMAC_DRBG helpers are test-only and unused by production generation', () => {
  const app = keyedKdfBackend()
  let calls = 0
  app.context.authHmacDrbgUpdate = function () {
    calls += 1
    throw new Error('drbg update')
  }
  app.context.authHmacDrbgInstantiate = function () {
    calls += 1
    throw new Error('drbg instantiate')
  }
  app.context.authHmacDrbgGenerate = function () {
    calls += 1
    throw new Error('drbg generate')
  }
  const issued = app.store.issueCredential({
    userId: 'user-1',
    username: 'staff@example.com',
    createdBy: 'owner-1',
  })
  assert.equal(issued.plaintext.length, 64)
  assert.equal(calls, 0)
  assert.equal(app.context.AUTH_NIST_800_90A_RBG, false)
  assert.equal(app.store.verifyCredential('staff@example.com', issued.plaintext).ok, true)
})

test('script lock is released after a fail-closed counter error', () => {
  const app = keyedKdfBackend()
  app.properties.setProperty('AUTH_KDF_INITIALIZED', '1')
  app.properties.setProperty('AUTH_KDF_COUNTER', '01')
  assert.throws(
    () => app.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' }),
    (error) => error.code === 'INTERNAL_ERROR',
  )
  assert.equal(app.lockState.held, false)
  assert.equal(app.locks.at(-1), 'released')
})

test('partial failure during session persist recovers without repeating the counter', () => {
  let failWrite = false
  const spreadsheet = createFakeSpreadsheet({}, {
    beforeClearContent(name, row) {
      if (failWrite && name === 'AuthSessions' && row === 2) {
        failWrite = false
        throw persistError('session write failed')
      }
    },
  })
  const app = keyedKdfBackend({ spreadsheet })
  app.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' })
  const firstSession = app.store.issueSession({ userId: 'user-1' })
  failWrite = true
  assert.throws(() => app.store.issueSession({ userId: 'user-1' }), (error) => error.code === 'INTERNAL_ERROR')
  assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), '3')
  assert.equal(Boolean(app.store.validateSession(firstSession.token)), true)
  const recovered = app.store.issueSession({ userId: 'user-1' })
  assert.notEqual(recovered.token, firstSession.token)
  assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), '4')
  assert.equal(Boolean(app.store.validateSession(firstSession.token)), true)
  assert.equal(Boolean(app.store.validateSession(recovered.token)), true)
  const dump = JSON.stringify(app.spreadsheet.store)
  assert.equal(dump.includes(firstSession.token), false)
  assert.equal(dump.includes(recovered.token), false)
})

test('partial failure after credential persist during audit append does not reuse the counter', () => {
  let failIssued = false
  const spreadsheet = createFakeSpreadsheet({}, {
    beforeAppendRow(name, row) {
      if (failIssued && name === 'AuthEvents' && row[4] === 'credential_issued') {
        failIssued = false
        throw persistError('audit append failed')
      }
    },
  })
  const app = keyedKdfBackend({ spreadsheet })
  const first = app.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' })
  failIssued = true
  assert.throws(
    () => app.store.issueCredential({ userId: 'user-2', username: 'other@example.com', createdBy: 'owner-1' }),
    (error) => error.code === 'INTERNAL_ERROR',
  )
  assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), '2')
  assert.equal(app.store.verifyCredential('staff@example.com', first.plaintext).ok, true)
  const recovered = app.store.issueCredential({ userId: 'user-2', username: 'other@example.com', createdBy: 'owner-1' })
  assert.notEqual(recovered.plaintext, first.plaintext)
  assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), '3')
  assert.equal(app.store.verifyCredential('other@example.com', recovered.plaintext).ok, true)
})

test('pepper rotation does not reset the KDF counter and invalidates previous hashes', () => {
  const firstPepper = `${'ab'.repeat(32)}`
  const secondPepper = `${'cd'.repeat(32)}`
  const properties = memoryProperties({
    ENVIRONMENT: 'DEV',
    SPREADSHEET_ID: 'sheet-id',
    DRIVE_ROOT_ID: 'drive-id',
    TIMEZONE: 'Asia/Kuala_Lumpur',
    AUTH_CREDENTIAL_PEPPER: firstPepper,
  })
  const app = keyedKdfBackend({ properties })
  const first = app.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' })
  const counter = app.properties.getProperty('AUTH_KDF_COUNTER')
  assert.equal(counter, '1')
  properties.setProperty('AUTH_CREDENTIAL_PEPPER', secondPepper)
  assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), counter)
  assert.equal(app.properties.getProperty('AUTH_KDF_INITIALIZED'), '1')
  assert.equal(app.store.verifyCredential('staff@example.com', first.plaintext).ok, false)
  const rotated = app.store.issueCredential({ userId: 'user-1', username: 'staff@example.com', createdBy: 'owner-1' })
  assert.notEqual(rotated.plaintext, first.plaintext)
  assert.equal(app.properties.getProperty('AUTH_KDF_COUNTER'), '2')
  assert.equal(app.store.verifyCredential('staff@example.com', rotated.plaintext).ok, true)
  assert.equal(app.store.verifyCredential('staff@example.com', first.plaintext).ok, false)
})

test('audit event reasons that look like secrets or pepper are redacted', () => {
  const app = keyedKdfBackend()
  app.store.ensureSheets()
  app.repo.appendEvent(app.spreadsheet, {
    id: 'e1',
    timestamp: '2026-01-01T00:00:00.000Z',
    actorUserId: '',
    targetUserId: '',
    eventType: 'test',
    result: 'ok',
    reason: 'pepper-material',
    requestId: '',
  })
  app.repo.appendEvent(app.spreadsheet, {
    id: 'e2',
    timestamp: '2026-01-01T00:00:00.000Z',
    actorUserId: '',
    targetUserId: '',
    eventType: 'test',
    result: 'ok',
    reason: 'ab'.repeat(32),
    requestId: '',
  })
  const events = app.repo.readEvents(app.spreadsheet)
  assert.equal(events[0].reason, 'redacted')
  assert.equal(events[1].reason, 'redacted')
})


