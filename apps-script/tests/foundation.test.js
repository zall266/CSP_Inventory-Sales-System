import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createFakeDrive,
  createFakeSpreadsheet,
  devProperties,
  loadBackend,
  memoryProperties,
} from './harness.js'

function backend(options = {}) {
  const spreadsheet = options.spreadsheet || createFakeSpreadsheet()
  const drive = options.drive || createFakeDrive('drive-id')
  const properties = options.properties || devProperties()
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
      openById(id) {
        if (id !== 'sheet-id') throw new Error('Spreadsheet not found')
        return spreadsheet
      },
    },
    DriveApp: drive,
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) {
        return {
          text,
          setMimeType(mime) {
            this.mime = mime
            return this
          },
        }
      },
    },
  })
  const sheets = context.createSheetRepository({ openSpreadsheet: () => spreadsheet })
  const driveStorage = context.createDriveStorage({
    getRoot: () => drive.getFolderById('drive-id'),
    getFileById: (id) => drive.getFileById(id),
  })
  const resolved = {
    sheets,
    drive,
    driveStorage,
    system: context.createSystemService({
      sheetRepository: sheets,
      driveStorage,
      config: () => context.getConfig(),
    }),
    idempotency: context.createIdempotencyService(sheets),
    foundation: context.createFoundationService(sheets),
    locks,
    context,
    spreadsheet,
  }
  return resolved
}

test('configuration rejects missing properties without echoing values', () => {
  const context = loadBackend({
    PropertiesService: { getScriptProperties: () => memoryProperties({ SPREADSHEET_ID: 'secret-sheet' }) },
  })
  assert.throws(() => context.getConfig(), (error) => {
    assert.equal(error.code, 'INTERNAL_ERROR')
    assert.equal(error.message.includes('secret-sheet'), false)
    return true
  })
})

test('configuration accepts DEV Kuala Lumpur settings and rejects PROD', () => {
  const ready = loadBackend({ PropertiesService: { getScriptProperties: () => devProperties() } })
  const config = ready.getConfig()
  assert.equal(config.environment, 'DEV')
  assert.equal(config.timezone, 'Asia/Kuala_Lumpur')
  const prod = loadBackend({
    PropertiesService: {
      getScriptProperties: () => memoryProperties({
        ENVIRONMENT: 'PROD',
        SPREADSHEET_ID: 'sheet-id',
        DRIVE_ROOT_ID: 'drive-id',
        TIMEZONE: 'Asia/Kuala_Lumpur',
      }),
    },
  })
  assert.throws(() => prod.getConfig(), (error) => error.code === 'FORBIDDEN')
})

test('business dates use Asia/Kuala_Lumpur', () => {
  const context = loadBackend()
  assert.equal(context.businessDate(new Date('2026-09-30T16:30:00.000Z')), '2026-10-01')
  assert.equal(context.businessDate(new Date('2026-09-30T15:30:00.000Z')), '2026-09-30')
  assert.equal(context.nowIso(new Date('2026-09-30T16:30:00.000Z')), '2026-09-30T16:30:00.000Z')
  assert.equal(context.normalizeBusinessDate('2026-10-01'), '2026-10-01')
  assert.throws(() => context.normalizeBusinessDate('2026-02-31'), (error) => error.code === 'VALIDATION_ERROR')
})

test('ids are uuids and unsafe errors hide internals', () => {
  const context = loadBackend()
  assert.match(context.createId(), /^[0-9a-f-]{36}$/i)
  const safe = context.toSafeError(new Error('token=abc /tmp/secret'))
  assert.equal(safe.code, 'INTERNAL_ERROR')
  assert.equal(safe.message.includes('token'), false)
  const envelope = context.errorEnvelope('UNKNOWN_ACTION', 'The action is not available.', { requestId: 'r1' })
  assert.equal(envelope.ok, false)
  assert.equal(envelope.data, null)
  assert.equal(envelope.error.code, 'UNKNOWN_ACTION')
  assert.equal(envelope.error.stack, undefined)
})

test('health and ping stay read-only and unknown actions are rejected', () => {
  const app = backend()
  const health = app.context.handleRequest({
    v: 1,
    requestId: 'health-1',
    action: 'system.health',
    payload: {},
  }, app)
  assert.equal(health.ok, true)
  assert.equal(health.data.service, 'CSP Inventory Backend')
  assert.equal(health.data.environment, 'DEV')
  assert.equal(health.data.spreadsheetAccessible, true)
  assert.equal(health.data.driveAccessible, true)
  assert.equal(health.data.foundationReady, false)
  assert.deepEqual(Object.keys(app.spreadsheet.store), ['Sheet1'])
  assert.deepEqual(app.drive.created, [])
  const ping = app.context.handleRequest({ v: 1, requestId: 'ping-1', action: 'system.ping', payload: {} }, app)
  assert.equal(ping.data.pong, true)
  assert.equal(ping.data.environment, 'DEV')
  assert.equal(typeof ping.data.serverTimestamp, 'string')
  const unknown = app.context.handleRequest({ v: 1, requestId: 'x', action: 'sales.create', payload: {} }, app)
  assert.equal(unknown.error.code, 'UNKNOWN_ACTION')
  const invalid = app.context.handleRequest({ action: 'system.ping' }, app)
  assert.equal(invalid.error.code, 'INVALID_REQUEST')
})

test('foundation sheets are created beside an empty Sheet1', () => {
  const app = backend()
  const result = app.foundation.initialize()
  assert.equal(result.ok, true)
  assert.equal(result.data.sheet1Preserved, true)
  assert.deepEqual(app.spreadsheet.store.Sheet1, [['']])
  assert.deepEqual([...app.spreadsheet.store.AuditLogs[0]], [...app.context.AUDIT_HEADERS])
  assert.deepEqual([...app.spreadsheet.store.Idempotency[0]], [...app.context.IDEMPOTENCY_HEADERS])
  assert.deepEqual([...app.spreadsheet.store.Counters[0]], [...app.context.COUNTER_HEADERS])
  assert.equal(app.spreadsheet.store.AuditLogs.length, 2)
  assert.equal(app.drive.created.length, 0)
  const health = app.system.health({ requestId: 'health-2', payload: {} })
  assert.equal(health.data.foundationReady, true)
  assert.equal(app.spreadsheet.store.AuditLogs.length, 2)
})

test('idempotency replays one response and rejects a reused key', () => {
  const app = backend()
  app.foundation.initialize()
  let calls = 0
  const request = { v: 1, requestId: 'idem-1', action: 'system.ping', payload: {}, idempotencyKey: 'same-key' }
  const first = app.idempotency.execute('same-key', request, () => {
    calls += 1
    return app.system.ping(request)
  })
  const second = app.idempotency.execute('same-key', request, () => {
    calls += 1
    return app.system.ping(request)
  })
  assert.equal(calls, 1)
  assert.equal(first.data.pong, true)
  assert.equal(second.meta.idempotentReplay, true)
  assert.throws(
    () => app.idempotency.execute('same-key', { ...request, action: 'system.health' }, () => app.system.health(request)),
    (error) => error.code === 'DUPLICATE_REQUEST',
  )
  assert.deepEqual(app.locks.filter((item) => item === 'acquired').length > 0, true)
})

test('counter allocation is ordered inside the script lock', () => {
  const app = backend()
  app.foundation.initialize()
  const counters = app.context.createCounterService(app.sheets)
  assert.equal(counters.allocate('foundation', 'CSP').value, 1)
  assert.equal(counters.allocate('foundation', 'CSP').value, 2)
  assert.equal(app.locks.at(-1), 'released')
  const blocked = backend({ lockFails: true, spreadsheet: app.spreadsheet })
  assert.throws(() => blocked.context.createCounterService(blocked.sheets).allocate('foundation', 'CSP'), (error) => error.code === 'CONFLICT')
})

test('drive storage can address a later child without creating one during health', () => {
  const app = backend()
  assert.equal(app.driveStorage.getChildFolder('ProductImages'), null)
  assert.equal(app.driveStorage.verifyFileExists('missing'), false)
  assert.equal(app.driveStorage.verifyFileExists('file-1'), true)
  const created = app.driveStorage.createChildFolder('ProductImages')
  assert.equal(created.created, true)
  assert.deepEqual(app.drive.created, ['ProductImages'])
  app.drive.folder.createFile = () => {
    let name = 'a.txt'
    return {
      getId: () => 'uploaded',
      getName: () => name,
      setName(next) {
        name = next
      },
    }
  }
  app.drive.folder.getFoldersByName = () => ({ hasNext: () => true, next: () => app.drive.folder })
  const uploaded = app.driveStorage.uploadFile('ProductImages', {}, 'a.txt')
  assert.equal(uploaded.id, 'uploaded')
  const replaced = app.driveStorage.replaceFile('file-1', {}, 'b.txt')
  assert.equal(replaced.name, 'b.txt')
  assert.deepEqual(app.drive.trashed, ['file-1'])
})

test('http entry points return the json envelope', () => {
  const app = backend()
  const health = app.context.doGet()
  const body = JSON.parse(health.text)
  assert.equal(health.mime, 'application/json')
  assert.equal(body.data.status, 'healthy')
  const invalid = app.context.doPost({})
  assert.equal(JSON.parse(invalid.text).error.code, 'INVALID_REQUEST')
  const ping = app.context.doPost({
    postData: { contents: JSON.stringify({ v: 1, requestId: 'post-1', action: 'system.ping', payload: {} }) },
  })
  assert.equal(JSON.parse(ping.text).data.pong, true)
})
