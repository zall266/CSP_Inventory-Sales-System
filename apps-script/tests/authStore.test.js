import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authDevProperties,
  createFakeSpreadsheet,
  gasUtilities,
  loadBackend,
  memoryProperties,
} from './harness.js'

function backend(options = {}) {
  const spreadsheet = options.spreadsheet || createFakeSpreadsheet()
  const properties = options.properties || authDevProperties()
  const locks = []
  const context = loadBackend({
    PropertiesService: { getScriptProperties: () => properties },
    LockService: {
      getScriptLock() {
        return {
          tryLock() {
            if (options.lockFails) return false
            locks.push('acquired')
            return true
          },
          releaseLock() {
            locks.push('released')
          },
        }
      },
    },
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
    context,
    store: context.createAuthStore({ sheetRepository: sheets }),
    repo: context.createAuthRepository(sheets),
  }
}

test('Phase 1 uses HMAC-SHA256 lookup-secret hashing, not PBKDF2-12k', () => {
  const app = backend()
  assert.equal(app.context.AUTH_ALGORITHM, 'hmac-sha256')
  assert.equal(app.context.AUTH_SECRET_BYTES, 32)
  assert.equal(app.context.AUTH_MIN_ENTROPY_BITS, 128)
  assert.equal(app.context.AUTH_SECRET_BYTES * 8 >= app.context.AUTH_MIN_ENTROPY_BITS, true)
  assert.equal(app.context.AUTH_PBKDF2_ITERATIONS, undefined)
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
  assert.notEqual(first.plaintext, second.plaintext)

  const uuidOnly = loadBackend({ crypto: {} })
  const fromUuid = uuidOnly.authGenerateSecret()
  assert.equal(fromUuid.raw.length, 32)
  assert.match(fromUuid.plaintext, /^[0-9a-f]{64}$/)

  const closed = loadBackend({ crypto: {}, Utilities: {} })
  assert.throws(() => closed.authRandomBytes(32), (error) => {
    assert.equal(error.code, 'INTERNAL_ERROR')
    return true
  })
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

test('UUID-only CSPRNG still meets the 128-bit floor used in Apps Script', () => {
  const context = loadBackend({
    crypto: {},
    Utilities: gasUtilities(),
    PropertiesService: { getScriptProperties: () => authDevProperties() },
  })
  const secret = context.authGenerateSecret()
  assert.equal(secret.raw.length, 32)
  assert.equal(secret.entropyBits, 256)
  const bytes = secret.raw
  let nonzero = 0
  for (let i = 0; i < bytes.length; i += 1) if (bytes[i] !== 0) nonzero += 1
  assert.equal(nonzero > 8, true)
})
