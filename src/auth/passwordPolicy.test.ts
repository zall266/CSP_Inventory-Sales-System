import assert from 'node:assert/strict'
import test from 'node:test'
import { passwordPolicyMessage } from './passwordPolicy.ts'

test('password policy accepts a mixed 10+ character secret', () => {
  assert.equal(passwordPolicyMessage('OwnerPass12', 'aina@coolslurppy.my'), '')
})

test('password policy rejects short, letter-only, and username matches', () => {
  assert.match(passwordPolicyMessage('short1'), /10 to 128/)
  assert.match(passwordPolicyMessage('NoDigitsHere'), /letter and a number/)
  assert.match(passwordPolicyMessage('12345678901'), /letter and a number/)
  assert.match(passwordPolicyMessage('OwnerUser12', 'OwnerUser12'), /username/)
})
