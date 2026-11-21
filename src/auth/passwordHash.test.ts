import assert from 'node:assert/strict'
import { pbkdf2Sync } from 'node:crypto'
import test from 'node:test'
import {
  AUTH_PBKDF2_ITERATIONS,
  newPasswordSalt,
  preparePasswordVerifier,
  stretchPassword,
} from './passwordHash.ts'

test('Web Crypto PBKDF2 matches Node native at 600,000 iterations', async () => {
  const salt = newPasswordSalt()
  assert.match(salt, /^[0-9a-f]{32}$/)
  const started = Date.now()
  const verifier = await stretchPassword('OwnerPass12', salt)
  const elapsed = Date.now() - started
  const expected = pbkdf2Sync('OwnerPass12', Buffer.from(salt, 'hex'), AUTH_PBKDF2_ITERATIONS, 32, 'sha256').toString('hex')
  assert.equal(verifier, expected)
  assert.equal(AUTH_PBKDF2_ITERATIONS, 600000)
  assert.ok(elapsed < 15000, `browser stretch took ${elapsed}ms`)
})

test('prepared verifier uses a unique salt and refuses a weak work factor', async () => {
  const first = await preparePasswordVerifier('OwnerPass12')
  const second = await preparePasswordVerifier('OwnerPass12')
  assert.notEqual(first.salt, second.salt)
  assert.notEqual(first.passwordVerifier, second.passwordVerifier)
  assert.equal(first.iterations, 600000)
  await assert.rejects(() => stretchPassword('OwnerPass12', first.salt, 12000))
})
