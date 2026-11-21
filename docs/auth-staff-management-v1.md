# Authentication & Staff Management V1

DEV only. Do not merge, deploy Pages, deploy Apps Script, or bootstrap production passwords until the owner approves.

This is not a login screen alone. Backend session validation is the security boundary.

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

Verified Apps Script V8 primitives:

- `Utilities.computeHmacSha256Signature`
- `Utilities.computeDigest(SHA_256)`
- `Utilities.getUuid`

Not available: bcrypt, scrypt, native PBKDF2, argon2.

Passwords are stored as **PBKDF2-HMAC-SHA256**, 12,000 iterations, 16-byte random salt, 32-byte derived key, hex encoding. Node harness hashes in about 80–120 ms; the auth test asserts under 2,000 ms. OWASP currently recommends a much higher PBKDF2 iteration count. 12,000 is the highest cost that stays inside Apps Script request time. That gap is a residual risk, not “equivalent to OWASP 2023”.

Plaintext, unsalted SHA-256, and a single fast hash are not used.

Password policy: 10–128 characters, at least one letter and one number, must not equal the username.

## Session transport

Google Apps Script `ContentService` cannot set a reliable browser `HttpOnly` / `Secure` / `SameSite` cookie for the GitHub Pages origin. The session token is returned in the JSON body and stored in `sessionStorage` (`csp.auth.session.v1`).

Residual XSS risk: any script that can read `sessionStorage` can steal the token. Tokens are stored server-side as SHA-256 hashes only. Absolute expiry is 12 hours. Idle timeout is 2 hours (sliding, persisted at most once per 60 seconds). Logout, password change, password reset, and account disable revoke sessions.

**Multiple-session policy:** concurrent sessions for the same user are allowed until revocation. Password change, password reset, and account disable revoke every session for that user.

Do not treat `localStorage` as a session. Prototype `switchUser` is a no-op when `VITE_CSP_API_URL` is set.

## Authorization

The router validates the session on every non-public action and **overwrites** `payload.actorUserId` from the session user. Client-supplied role, permission arrays, and `actorUserId` are not trusted.

Public actions: `system.health`, `system.ping`, `auth.status`, `auth.login`, `auth.bootstrapOwner`, `identity.bootstrap` (empty identity only; a second bootstrap still returns `CONFLICT`).

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
3. Open `/login`. If `needsOwnerBootstrap` is true, the Owner email from the Users sheet can set the first password.
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

## Residual risks

- Token in JSON / `sessionStorage` (XSS). This is **not** a fully cookie-secure session.
- PBKDF2 iteration count below current OWASP guidance.
- Google Sheets is not an ACID user store; script locks serialize writes.
- `identity.bootstrap` of a completely empty spreadsheet remains callable without a session (first writer). DEV identity is already initialized.
- Owner bootstrap is available only while the credentials sheet is empty. Anyone who knows the Owner email could race that one-time step.
- Web app access is still `ANYONE_ANONYMOUS`; authorization is the session, not Google accounts.
- Frontend hiding of menus is not the security boundary.
- Module `FORBIDDEN` denials are returned to the caller; they are not all copied into `AuthEvents` (login, expiry, revoke, password, account events are).
- Live login against DEV Apps Script was **not** executed in this PR because Apps Script must not be deployed until owner approval.

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
| `npm run test:backend` | 201 pass / 0 fail |
| `npm run test:ui` | 89 pass / 0 fail (after password-policy assertion fix) |
| `npx tsc --noEmit` / `npm run lint` | pass |
| `npm run build` | pass |

Auth-specific backend cases (in `apps-script/tests/auth.test.js`): hash/verify, policy, status, owner bootstrap, login (valid / unknown / wrong / disabled), lockout, forged `actorUserId`, missing session, staff cannot reset, first-login + logout, password-change / deactivate revocation, expired session + hashed tokens, events without secrets.

Not run: production migration, live DEV Apps Script deploy, live password bootstrap, GitHub Pages deploy, browser login against the undeployed backend.

## Files

Backend: `apps-script/auth/crypto.js`, `apps-script/auth/boundary.js`, `apps-script/repositories/authRepository.js`, `apps-script/services/authService.js`, `apps-script/app/router.js`, `apps-script/app/main.js`, `apps-script/services/foundationService.js`, `apps-script/services/identityService.js`, `apps-script/tests/harness.js`, `apps-script/tests/auth.test.js`, plus test expectation updates where unauthenticated calls now return `UNAUTHORIZED`.

Frontend: `src/auth/*`, `src/features/auth/*`, `src/App.tsx`, `src/api/identityApi.ts`, `src/store/db.ts`, all `*Sync.ts` hydrate gates, `src/components/layout/Header.tsx`, `src/components/layout/Sidebar.tsx`, `src/features/settings/UsersRolesPage.tsx`.

Docs: this file.
