import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { clearAuthSession, readAuthSession, sessionFromLoginData, writeAuthSession } from './session.ts'

const memory = new Map<string, string>()

Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    getItem(key: string) {
      return memory.get(key) ?? null
    },
    setItem(key: string, value: string) {
      memory.set(key, value)
    },
    removeItem(key: string) {
      memory.delete(key)
    },
  },
})

test('session storage never keeps a password and can be cleared', () => {
  const session = sessionFromLoginData({
    sessionToken: 'a'.repeat(64),
    expiresAt: '2026-11-21T12:00:00.000Z',
    user: {
      id: 'u-aina',
      username: 'aina@coolslurppy.my',
      name: 'Aina Rahman',
      roleId: 'role-owner',
      roleName: 'Owner',
      isOwner: true,
      mustChange: false,
    },
  })
  assert.ok(session)
  writeAuthSession(session!)
  const stored = readAuthSession()
  assert.equal(stored?.userId, 'u-aina')
  assert.equal(stored?.token, 'a'.repeat(64))
  assert.equal(JSON.stringify(stored).includes('OwnerPass'), false)
  clearAuthSession()
  assert.equal(readAuthSession(), null)
})

test('session helper never writes localStorage or URL tokens', () => {
  const source = fs.readFileSync(new URL('./session.ts', import.meta.url), 'utf8')
  assert.equal(source.includes('localStorage'), false)
  assert.equal(source.includes('searchParams'), false)
  assert.equal(source.includes('location.hash'), false)
})
