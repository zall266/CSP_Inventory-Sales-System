# Authentication & Staff Management V1

DEV only. Do not merge, deploy Pages, deploy Apps Script, or bootstrap production passwords until the owner approves.

This is not a login screen alone. Backend session validation is the security boundary.

## Security review status (PR #131)

| Finding | Status |
| --- | --- |
| CSPRNG for salts and session tokens | **Remediated.** `crypto.getRandomValues` in tests; Apps Script uses `Utilities.getUuid()` = `java.util.UUID.randomUUID()` / `SecureRandom`. Fail closed. No `Date.now` / `Math.random`. |
| PBKDF2 work factor vs OWASP 600,000 | **Remediated for this architecture.** Official SPA uses Web Crypto PBKDF2-HMAC-SHA256 at 600,000 iterations. Apps Script stores HMAC-SHA256(server pepper, DK) and refuses weaker iteration counts. Plain SHA-256 and the previous 12,000-iteration loop are gone. |
| Session token in `sessionStorage` | **Residual XSS risk.** Not equivalent to HttpOnly / Secure / SameSite cookies. CSP added as defense-in-depth. |
| Owner bootstrap / public actions | **Remediated in tests.** One-time, locked, non-Owner `FORBIDDEN`. Harness test sessions are not minted on production routing. |
| Authorization regression | **Pass.** Forged actor/role/permissions, missing/expired/revoked sessions, Supervisor/Staff Owner-only denials. |

Owner must still accept the `sessionStorage` XSS residual and the client-enforced stretch residual (Apps Script cannot re-run 600,000 PBKDF2 rounds itself) before any DEV deploy. Wait for owner review. Do not merge.

## Architecture compatibility

The existing SPA remains: React + Vite → `postIdentityAction` → Apps Script `/exec` → Controller → Service → Repository → Google Sheets / Drive.

Preserved:

- React + Vite SPA, routing, Tailwind UI, GitHub Pages DEV workflow
- Controller → Service → Repository → Sheets / Drive
- Envelope `{ v:1, requestId, action, payload }`
- `doPost` JSON as `text/plain`
- Existing permission keys, roles, Users/Staff records, business APIs
- WordPress / public URLs (not changed in this PR)

Not introduced:

- Firebase, Supabase, MySQL, or another database
- External identity provider
- Production spreadsheet, Drive, Script Properties, DNS, or deployment changes

## Selected cryptography

### CSPRNG (remediated)

`createId()` is **not** used for salts or session tokens. It is `Utilities.getUuid()` or `crypto.randomUUID()` and exists for entity IDs only.

Previous salt/token code hashed `createId() + Date.now()` with SHA-256. That is not a CSPRNG. It was removed.

`authRandomBytes()` / `authRandomToken()` now fail closed and use, in order:

1. `crypto.getRandomValues` when present (Web Crypto / Node tests)
2. `Utilities.getUuid()`, which Google documents as equivalent to `java.util.UUID.randomUUID()`. OpenJDK fills 16 bytes from **`SecureRandom`** (CSPRNG) and then sets RFC 4122 version/variant bits
3. `crypto.randomUUID()` if present
4. Otherwise throw `INTERNAL_ERROR`. No `Date.now`, `Math.random`, or identifier concatenation

64 salts and 64 tokens were generated in tests; all unique. Missing sources throw.

Apps Script V8 does **not** expose `crypto.getRandomValues` (Google issue 235538670, Won't Fix). Production therefore uses `Utilities.getUuid()` / `SecureRandom`. That is the strongest CSPRNG available inside the locked GAS runtime without calling an external entropy HTTP service.

RFC 4122 version-4 UUIDs overwrite 6 bits (version + variant), so each 16-byte UUID contributes **122 bits** of CSPRNG entropy, not 128. A 16-byte salt therefore has 122 bits; a 32-byte token concatenates two UUIDs (~244 bits). That is still a CSPRNG, not a hash of a timestamp.

### Password hashing

Apps Script V8 has HMAC-SHA256 and SHA-256 only. It does not have bcrypt, scrypt, argon2, native PBKDF2, or Web Crypto. A Java-bridge PBKDF2 loop at 600,000 rounds would exceed web-app request time, which is why PR #131 stopped at 12,000. That configuration is **not reused**.

Current stored secret:

1. Unique 16-byte CSPRNG salt
2. PBKDF2-HMAC-SHA256, **600,000** iterations, 32-byte DK, computed in the official SPA with Web Crypto (OWASP Password Storage Cheat Sheet for PBKDF2-SHA256)
3. HMAC-SHA256(server pepper, DK) stored in `AuthCredentials`

The pepper is generated with CSPRNG and stored in Script Properties (`AUTH_PASSWORD_PEPPER`), not in the spreadsheet. A Sheets leak without the script does not yield an offline-guessable password hash. The SPA never sends the plaintext password to Apps Script. Login uses `auth.challenge` then a 64-hex verifier.

Apps Script refuses iteration counts below 600,000 and does not fall back to unsalted SHA-256 or a short PBKDF2 loop. Browsers without `crypto.subtle` fail closed. Node tests use native `pbkdf2Sync` at the same work factor.

Residual: Apps Script cannot independently prove that a modified client performed 600,000 rounds. A stolen verifier is password-equivalent on the wire (HTTPS), same class as a stolen plaintext password. Owner-created passwords are stretched in the official Users & Roles screen.

Password policy: 10–128 characters, letter + number, must not equal the username.

## Session transport

Google Apps Script `ContentService` cannot set a reliable browser `HttpOnly` / `Secure` / `SameSite` cookie for the GitHub Pages origin. The session token is returned in the JSON body and stored in `sessionStorage` (`csp.auth.session.v1`).

Residual XSS risk: any script that can read `sessionStorage` can steal the token. Tokens are stored server-side as SHA-256 hashes only. Absolute expiry is 12 hours. Idle timeout is 2 hours (sliding, persisted at most once per 60 seconds). Logout, password change, password reset, and account disable revoke sessions.

**Multiple-session policy:** concurrent sessions for the same user are allowed until revocation. Password change, password reset, and account disable revoke every session for that user.

Do not treat `localStorage` as a session. Prototype `switchUser` is a no-op when `VITE_CSP_API_URL` is set.

## Authorization

The router validates the session on every non-public action and **overwrites** `payload.actorUserId` from the session user. Client-supplied role, permission arrays, and `actorUserId` are not trusted.

Public actions: `system.health`, `system.ping`, `auth.status`, `auth.challenge`, `auth.login`. `identity.bootstrap` and `auth.bootstrapOwner` are one-time setup actions and require separate out-of-band authorizations. They are not public SPA actions.

Username is the existing unique email. Owner / Supervisor / Staff map onto the existing role matrix (`legacyRole` owner / manager / staff). Permission keys are unchanged. Owner-only actions remain Owner-only (`users.*` admin, `roles.manage`, `auth.resetPassword`, `auth.events`, `auth.accounts`).

## Staff account management

Owner UI: Settings → Users & Roles.

- Search staff, add, edit, assign role / permissions, activate / deactivate
- Reset password (Owner-controlled, temporary, `mustChange`)
- Security tab: credential status and auth events (connected API + Owner only)
- Last login column
- Access denied page for unauthorized routes

There is no public email reset and no default password.

## Prototype migration (DEV, non-destructive)

Existing User IDs, staff records, and business documents are not deleted. No passwords are assigned automatically.

1. Deploy this Apps Script to **DEV only** after owner approval. Do not deploy from this PR.
2. Confirm identity already exists (`auth.status.identityReady`).
3. If `needsOwnerBootstrap` is true, provision the four Owner enrollment Script Properties (`AUTH_OWNER_ENROLL_HASH`, mandatory `AUTH_OWNER_ENROLL_EXPIRES_AT` within 15 minutes, `AUTH_OWNER_ENROLL_USERNAME`, `AUTH_OWNER_ENROLL_USER_ID`) and call `auth.bootstrapOwner` out of band. `/login` cannot enroll the first Owner password.
4. Other prototype users (`u-admin`, supervisors, staff) cannot sign in until the Owner uses **Reset password** and hands the temporary password out of band.
5. Temporary passwords force a change at next login. They are not committed to git.

Migration is resumable: credentials are created on bootstrap / reset; existing Users rows are left in place. Repeat bootstrap after credentials exist returns `CONFLICT`.

Do not run this against production. Do not create real staff passwords in this PR.

## DEV setup

Known DEV infrastructure (unchanged by this PR):

- Spreadsheet ID: `1TPmkASdzlGssGyAisklf4QkLcxWYbHHhUSxntgLha94`
- Drive root: `14vIYpPSNQafvMnWgSEd1EGounerNjK3S`
- Local Vite: `.env.development` `VITE_CSP_API_URL` (DEV web app only; `npm run build` does not load it)

After owner-approved DEV Apps Script deploy:

1. `npm run dev`
2. Open `/login`
3. Owner bootstrap if `needsOwnerBootstrap`
4. UAT checklist below

## Threat model

| Threat | Control |
| --- | --- |
| Client `actorUserId` impersonation | Router overwrites from validated session |
| Role / permission arrays from browser | Ignored; permissions loaded from Sheets |
| Prototype role switching | Header switcher removed; `switchUser` no-op when API URL set |
| Brute-force login | 5 failures → 15 minute lockout; generic error; `login_failed` events |
| Password disclosure | Hash + salt only; never logged; cleared from login form on failure |
| Session theft / XSS | Residual: token in `sessionStorage`. Server stores hash. Logout/revoke. |
| Session replay after logout | Token hash marked revoked |
| Disabled user | Login blocked; existing sessions revoked |
| Expired session | Absolute 12h and idle 2h |
| Unauthorized account create / reset | Owner permission + session |
| Direct `/exec` without session | `UNAUTHORIZED` |
| Frontend route bypass | Backend still requires session + permission |
| Race on permission change | Script lock on writes; session re-reads Users status |

## XSS audit

`sessionStorage` is **not** equivalent to HttpOnly / Secure / SameSite cookies. GAS `ContentService` cannot set those cookies for GitHub Pages.

Findings:

- No `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, or `eval` in `src/`
- Session token is written only to `sessionStorage` (`csp.auth.session.v1`). Not `localStorage`, not URL query, not hash
- API body includes `sessionToken` over HTTPS to `/exec`; it is not logged in `AuthEvents`
- User-controlled names/emails render as React text (escaped)
- `index.html` now has a CSP: `default-src 'self'`; scripts `'self'`; connect-src includes `script.google.com` / `script.googleusercontent.com`; Google Fonts allowed; `object-src 'none'`
- CSP is a defense-in-depth header via `<meta>`; GitHub Pages cannot set `HttpOnly` cookies either
- Remaining XSS token-theft risk: any injected script that can read `sessionStorage` can steal the session. Treat XSS as session compromise.

## Bootstrap and test-session isolation

- `auth.bootstrapOwner` is not public. It requires `AUTH_OWNER_ENROLL_HASH` bound to the Owner email and user ID, plus a mandatory `AUTH_OWNER_ENROLL_EXPIRES_AT` no more than 15 minutes in the future. Consumed after a successful credential write. Second call `FORBIDDEN`. See `docs/auth-security-hardening-v2.md`.
- `identity.bootstrap` is not public. It requires `IDENTITY_BOOTSTRAP_HASH` in Script Properties and consumes that hash after a successful write. Second call `CONFLICT`. See `docs/auth-security-hardening-v2.md`.
- `auth.status` does not list users or emails.
- `issueHarnessSession` was removed from production Apps Script. `issueTestSession` returns empty unless `AUTH_ALLOW_TEST_SESSION === true` (Node harness only).

## Residual risks

- Token in JSON / `sessionStorage` (XSS). This is **not** a fully cookie-secure session.
- Password stretch is enforced by the official SPA and stored peppered hash. Apps Script does not re-run 600,000 PBKDF2 rounds. Login now requires a single-use challenge-bound HMAC proof, so a captured HTTP login request cannot be replayed. A captured PBKDF2 DK can still answer a fresh challenge (MITIGATED, not FIXED).
- Google Sheets is not an ACID user store; script locks serialize writes.
- Empty identity no longer allows anonymous `identity.bootstrap`. First-time init requires the owner-provisioned setup hash. Residual: a secret submitted through `/exec` is visible to anyone who can read that one request.
- Owner enrollment is available only while the credentials sheet is empty and only with a one-time `AUTH_OWNER_ENROLL_HASH` bound to that Owner, with mandatory 15-minute expiry. Knowing the Owner email is not enough.
- Node overlapping-lock tests serialize two `auth.bootstrapOwner` requests through `withScriptLock`. They do not prove live Google Apps Script multi-execution concurrency. Sheets writes remain non-ACID.
- Web app access is still `ANYONE_ANONYMOUS`; authorization is the session, not Google accounts.
- Frontend hiding of menus is not the security boundary.
- Module `FORBIDDEN` denials are returned to the caller; they are not all copied into `AuthEvents`.
- Live login against DEV Apps Script was **not** executed because Apps Script must not be deployed until owner approval.
- Live GAS PBKDF2 timing was **not** measured for the same reason.

## Owner UAT checklist

- [ ] Sign in with Owner username + password after bootstrap.
- [ ] Wrong password and unknown username show the same generic error.
- [ ] Disabled account cannot sign in.
- [ ] Sign out, then a previous tab cannot keep calling APIs.
- [ ] Change password signs out other sessions.
- [ ] Reset a staff password, first login, then forced password change.
- [ ] Staff cannot open Users & Roles or call `users.create` / `auth.resetPassword`.
- [ ] Changing `actorUserId` in the browser does not impersonate Owner.
- [ ] Dashboard, POS, sales, products, inventory, purchases, manufacturing still load for a permitted user.
- [ ] Production spreadsheet and production deployment were not touched.

## Automated tests (executed)

| Command | Result |
| --- | --- |
| `npm run test:backend` | **260 pass / 0 fail** |
| `npm run test:ui` | **94 pass / 0 fail** |
| `npx tsc --noEmit` / `npm run lint` | pass |
| `npm run build` | pass |

Auth-specific backend cases (`apps-script/tests/auth.test.js`, 24 tests): hash/verify at 600,000 iterations, policy, status, owner bootstrap, login (valid / unknown / wrong / disabled / unknown status), lockout, forged `actorUserId`, missing session, staff cannot reset, first-login + logout, password-change / deactivate revocation, expired hashed tokens, CSPRNG uniqueness, UUID CSPRNG fallback, fail-closed entropy, OWASP work-factor constant, verifier-only login without plaintext, harness session gated off, forged role/permissions, supervisor cannot reset/bootstrap/create, owner-created temp password + duplicate email, events without secrets.

Not run: production migration, live DEV Apps Script deploy, live password bootstrap, GitHub Pages deploy, browser login against the undeployed backend.

## Files

Backend: `apps-script/auth/crypto.js`, `apps-script/auth/boundary.js`, `apps-script/repositories/authRepository.js`, `apps-script/services/authService.js`, `apps-script/app/router.js`, `apps-script/app/main.js`, `apps-script/services/foundationService.js`, `apps-script/services/identityService.js`, `apps-script/tests/harness.js`, `apps-script/tests/auth.test.js`, plus test expectation updates where unauthenticated calls now return `UNAUTHORIZED`.

Frontend: `src/auth/*`, `src/features/auth/*`, `src/App.tsx`, `src/api/identityApi.ts`, `src/store/db.ts`, all `*Sync.ts` hydrate gates, `src/components/layout/Header.tsx`, `src/components/layout/Sidebar.tsx`, `src/features/settings/UsersRolesPage.tsx`.

Docs: this file.
