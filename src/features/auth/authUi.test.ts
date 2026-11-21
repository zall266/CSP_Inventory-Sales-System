import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

test('login and staff management screens exist and do not store passwords', () => {
  const login = fs.readFileSync(path.join(root, 'src/features/auth/LoginPage.tsx'), 'utf8')
  const users = fs.readFileSync(path.join(root, 'src/features/settings/UsersRolesPage.tsx'), 'utf8')
  const header = fs.readFileSync(path.join(root, 'src/components/layout/Header.tsx'), 'utf8')
  const db = fs.readFileSync(path.join(root, 'src/store/db.ts'), 'utf8')
  const api = fs.readFileSync(path.join(root, 'src/api/identityApi.ts'), 'utf8')
  assert.match(login, /Username/)
  assert.match(login, /Password/)
  assert.match(login, /Show/)
  assert.match(login, /auth\.login/)
  assert.match(users, /Reset password/)
  assert.match(users, /auth\.resetPassword/)
  assert.match(header, /Sign out/)
  assert.match(db, /if \(identityApiUrl\(\)\) return/)
  assert.match(api, /sessionToken/)
  assert.equal(login.includes('localStorage.setItem'), false)
  assert.equal(login.includes('dangerouslySetInnerHTML'), false)
})

test('SPA does not render untrusted HTML and does not keep tokens in localStorage', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  const session = fs.readFileSync(path.join(root, 'src/auth/session.ts'), 'utf8')
  const crypto = fs.readFileSync(path.join(root, 'apps-script/auth/crypto.js'), 'utf8')
  assert.match(html, /Content-Security-Policy/)
  assert.equal(session.includes('localStorage'), false)
  assert.equal(crypto.includes('Math.random'), false)
  assert.equal(/authRandomBytes[\s\S]{0,800}Date\.now\(/.test(crypto), false)
})

test('backend auth stack hashes passwords and overwrites actorUserId', () => {
  const crypto = fs.readFileSync(path.join(root, 'apps-script/auth/crypto.js'), 'utf8')
  const router = fs.readFileSync(path.join(root, 'apps-script/app/router.js'), 'utf8')
  const auth = fs.readFileSync(path.join(root, 'apps-script/services/authService.js'), 'utf8')
  assert.match(crypto, /pbkdf2-hmac-sha256/)
  assert.match(crypto, /AUTH_PBKDF2_ITERATIONS = 12000/)
  assert.match(router, /authenticateRequest/)
  assert.match(auth, /payload\.actorUserId = resolved\.user\.id/)
  assert.equal(auth.includes('plaintext'), false)
})
