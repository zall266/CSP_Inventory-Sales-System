import assert from 'node:assert/strict'
import { createHmac, pbkdf2Sync } from 'node:crypto'
import test from 'node:test'
import {
  AUTH_PBKDF2_ITERATIONS,
  hmacLoginProof,
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

test('login proof is HMAC-SHA256 of the challenge binding over the stretched verifier', async () => {
  const salt = newPasswordSalt()
  const verifier = await stretchPassword('OwnerPass12', salt)
  const proof = await hmacLoginProof(verifier, 'cid-1', 'aa'.repeat(32), 'Aina@coolslurppy.my', 'login')
  const expected = createHmac('sha256', Buffer.from(verifier, 'hex'))
    .update('cid-1\n' + 'aa'.repeat(32) + '\naina@coolslurppy.my\nlogin')
    .digest('hex')
  assert.equal(proof, expected)
})
