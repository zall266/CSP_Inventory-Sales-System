import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  canBootstrapFromRead,
  enqueueHydrate,
  isLockContention,
  isPermissionDeniedLoad,
  reportLoadError,
  resetHydrateQueue,
  withConflictRetry,
} from './hydrateQueue.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function conflict() {
  return { ok: false, data: null, error: { code: 'CONFLICT', message: 'The request could not get a lock in time.' } }
}

function ok(data: unknown = { rows: [1] }) {
  return { ok: true, data, error: null }
}

test('isLockContention matches CONFLICT and lock timeout text', () => {
  assert.equal(isLockContention({ code: 'CONFLICT', message: 'busy' }), true)
  assert.equal(isLockContention({ code: 'VALIDATION_ERROR', message: 'The request could not get a lock in time.' }), true)
  assert.equal(isLockContention({ code: 'FORBIDDEN', message: 'You cannot view the dashboard.' }), false)
  assert.equal(isLockContention(null), false)
})

test('canBootstrapFromRead is false after CONFLICT or any failed get', () => {
  assert.equal(canBootstrapFromRead(conflict()), false)
  assert.equal(canBootstrapFromRead({ ok: false, error: { code: 'FORBIDDEN', message: 'no' } }), false)
  assert.equal(canBootstrapFromRead(ok()), true)
})

test('enqueueHydrate runs tasks one at a time', async () => {
  resetHydrateQueue()
  const order: number[] = []
  const started: number[] = []
  const tasks = [0, 1, 2].map((id) =>
    enqueueHydrate(async () => {
      started.push(id)
      order.push(id)
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push(id + 10)
      return id
    }),
  )
  const results = await Promise.all(tasks)
  assert.deepEqual(results, [0, 1, 2])
  assert.deepEqual(started, [0, 1, 2])
  assert.deepEqual(order, [0, 10, 1, 11, 2, 12])
})

test('withConflictRetry retries lock timeouts then succeeds', async () => {
  const sleeps: number[] = []
  let calls = 0
  const result = await withConflictRetry(
    async () => {
      calls += 1
      return calls < 3 ? conflict() : ok({ ready: true })
    },
    { retries: 3, backoffMs: 10, sleep: async (ms) => { sleeps.push(ms) } },
  )
  assert.equal(result.ok, true)
  assert.equal(calls, 3)
  assert.deepEqual(sleeps, [10, 20])
})

test('withConflictRetry stops after retries and does not look like a bootstrapable empty read', async () => {
  let calls = 0
  const result = await withConflictRetry(
    async () => {
      calls += 1
      return conflict()
    },
    { retries: 3, backoffMs: 1, sleep: async () => undefined },
  )
  assert.equal(calls, 4)
  assert.equal(result.ok, false)
  assert.equal(canBootstrapFromRead(result), false)
})

test('bootstrap paths require a successful get before writing seed data', () => {
  const files = [
    'src/store/productSync.ts',
    'src/store/masterSync.ts',
    'src/store/partySync.ts',
    'src/store/warehouseSync.ts',
    'src/store/bomSync.ts',
    'src/store/identitySync.ts',
  ]
  for (const relative of files) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8')
    assert.equal(source.includes('canBootstrapFromRead'), true, relative)
    assert.equal(source.includes('enqueueHydrate'), true, relative)
  }
  const db = fs.readFileSync(path.join(root, 'src/store/db.ts'), 'utf8')
  assert.equal(db.includes("toast('Could not load from the server'"), true)
  assert.equal(db.includes("toast('Could not save to the server'"), true)
  const salesReturns = fs.readFileSync(path.join(root, 'src/store/salesReturnSync.ts'), 'utf8')
  const opening = fs.readFileSync(path.join(root, 'src/store/openingBalanceSync.ts'), 'utf8')
  assert.equal(salesReturns.includes('reportLoadError'), true)
  assert.equal(opening.includes('reportLoadError'), true)
})

test('permission-denied hydrations do not toast on unrelated pages', () => {
  const loads: string[] = []
  const saves: string[] = []
  reportLoadError(
    { onError: (message) => saves.push(message), onLoadError: (message) => loads.push(message) },
    'You do not have permission to view sales returns.',
  )
  reportLoadError(
    { onError: (message) => saves.push(message), onLoadError: (message) => loads.push(message) },
    'You do not have permission to view opening balance.',
  )
  reportLoadError(
    { onError: (message) => saves.push(message), onLoadError: (message) => loads.push(message) },
    'Could not load manufacturing from the server.',
  )
  assert.equal(isPermissionDeniedLoad('You do not have permission to view sales returns.'), true)
  assert.deepEqual(loads, ['Could not load manufacturing from the server.'])
  assert.deepEqual(saves, [])
})

test('withConflictRetry does not retry FORBIDDEN', async () => {
  let calls = 0
  const result = await withConflictRetry(async () => {
    calls += 1
    return { ok: false, error: { code: 'FORBIDDEN', message: 'You cannot view the dashboard.' } }
  })
  assert.equal(calls, 1)
  assert.equal(result.error?.code, 'FORBIDDEN')
  assert.equal(canBootstrapFromRead(result), false)
})
