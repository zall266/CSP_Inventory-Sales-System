# Authentication security hardening V2

DEV only. PR #133 remains review-only. Do not merge, deploy Apps Script, deploy GitHub Pages, or bootstrap a production Owner.

This document records the bootstrap takeover fix, the password-verifier replay assessment, and residual risks. It does not approve the PR.

## Decision summary

| Finding | Decision | Meaning |
| --- | --- | --- |
| A. Public `identity.bootstrap` takeover | **FIXED** | Anonymous callers cannot create the initial Owner. Bootstrap requires a one-time Script Properties hash, consumed under the script lock. |
| C. Public `auth.bootstrapOwner` takeover | **FIXED** | Knowing the Owner email is not enough. First credential enrollment requires a separate one-time Script Properties hash bound to that Owner, with a mandatory 15-minute expiry. |
| B. Password verifier replay | **MITIGATED** | Captured login HTTP requests cannot be replayed. A stolen PBKDF2 derived key can still prove a fresh challenge. Not FIXED. |
| Session token in `sessionStorage` | **RESIDUAL** | GitHub Pages + Apps Script cannot issue an HttpOnly cookie for this SPA. XSS that can read `sessionStorage` steals the session. Not fixed. |
| Anonymous Apps Script `/exec` | **RESIDUAL** | The web app remains `ANYONE_ANONYMOUS`. Authorization is the session or a one-time setup secret, not a Google account. Not fixed. |
| Google Sheets non-ACID | **RESIDUAL** | Script locks serialize writers; they do not make sheet writes atomic. Crash windows remain. Not fixed. |
| Client-enforced PBKDF2 | **RESIDUAL** | Apps Script cannot re-run 600,000 PBKDF2 rounds. A modified client can send a DK stretched with fewer iterations. |

Final recommendation from this task: **READY FOR FINAL OWNER REVIEW**. Do not treat this file as approval. Do not call the system production-ready.

## Finding A — identity bootstrap

### Previous path

`identity.bootstrap` was listed in `AUTH_PUBLIC_ACTIONS`. An unauthenticated `doPost` with a first identity payload could create the Owner while the Users sheet was empty.

### Implemented control (Option B)

1. Remove `identity.bootstrap` from public actions.
2. Treat it as a setup action. The router rejects the request unless `payload.setupAuthorization` is present. No session is minted for this action.
3. Store only `SHA-256(setup secret)` in Script Properties as `IDENTITY_BOOTSTRAP_HASH`. Optional `IDENTITY_BOOTSTRAP_EXPIRES_AT`.
4. Never store the setup secret in Sheets, API responses, or logs.
5. Under `withScriptLock`: reject if identity is not empty; reject if the hash is missing, expired, reused, or wrong; validate the full payload in memory; write; confirm an active Owner exists; then delete the hash.
6. The SPA no longer auto-posts `identity.bootstrap` when `identity.get` is empty.

### Administrator procedure

Do this only for a new DEV spreadsheet, out of band, from an owner-controlled machine. Do not put the secret in git, chat, or the identity spreadsheet.

1. Generate 32 random bytes. Encode as 64 hex characters. This is the setup secret.
2. SHA-256 the UTF-8 secret. Store that 64-hex digest in Script Properties `IDENTITY_BOOTSTRAP_HASH`.
3. Optionally set `IDENTITY_BOOTSTRAP_EXPIRES_AT` to an ISO timestamp.
4. Call `identity.bootstrap` once with the identity payload and `setupAuthorization` set to the secret. Use clasp / a trusted Apps Script execution, not the public login page.
5. Confirm `IDENTITY_BOOTSTRAP_HASH` was deleted.
6. Provision a **separate** Owner enrollment secret (Finding C). Do not reuse this identity bootstrap secret.

If the hash is never provisioned, bootstrap fails closed.

### Residual bootstrap risk

Submitting the setup secret through `doPost` exposes that one value to anyone who can observe the request. The web app remains `ANYONE_ANONYMOUS`. The secret is single-use and not returned. It cannot enroll an Owner password.

Google Sheets writes are not ACID. Validation runs before any identity write. A crash after a partial write could leave departments/roles without users (`empty` is `users.length === 0`) and would not consume the hash. Manual sheet cleanup may be required. A crash after users are written consumes on the success path only if the Owner confirmation passes; otherwise the leftover hash must be deleted by the administrator.

## Finding B — verifier replay

### Protocol (unchanged stretch parameters)

1. Unique 16-byte CSPRNG salt.
2. Official SPA: Web Crypto PBKDF2-HMAC-SHA256, 600,000 iterations, 32-byte DK. Fail closed without Web Crypto. No weaker fallback.
3. Apps Script stores:
   - `passwordHash` = HMAC-SHA256(pepper, DK)
   - `wrappedVerifier` = DK XOR HMAC-SHA256(pepper, `"wrap|" + salt`)
   - pepper in Script Properties `AUTH_PASSWORD_PEPPER`
4. Login no longer accepts the static DK.

### Login

1. `auth.challenge` returns `challengeId`, a 32-byte CSPRNG `challenge`, salt, iterations, and purpose. The server stores SHA-256(challenge), username, purpose, and a 2-minute expiry.
2. Browser: DK = PBKDF2(password, salt, 600000). `loginProof` = HMAC-SHA256(DK, `challengeId + "\n" + challenge + "\n" + username + "\n" + purpose`).
3. `auth.login` consumes the challenge under the script lock (single-use), unwraps DK, checks `passwordHash`, then constant-time compares the proof. Session is minted only after that succeeds.

Wire material for login: username, challengeId, challenge, loginProof. Not the password. Not the static DK.

Enrollment (`auth.bootstrapOwner`, Owner reset, staff create, password change new secret) still sends a fresh salt + DK so the server can wrap it. That enrollment DK is password-equivalent for that salt and must travel on HTTPS.

### Attack scenarios

| Attack | Result |
| --- | --- |
| Replay of a captured `auth.login` HTTP request | Prevented. Challenge is single-use and expired after 2 minutes. |
| Reuse of an old challenge, old proof, wrong username, or wrong purpose | Prevented. |
| Two callers using the same challenge | One succeeds; the other fails. Serialized by script lock. |
| Stolen DK used against a fresh challenge | **Still succeeds.** The proof key is the DK. This is verifier-equivalence. |
| Stolen session token | Independent issue. Token is a bearer credential in `sessionStorage`. |
| Browser XSS | Can read the password as typed, the DK, the proof, and the session token. Challenge-response does not stop XSS. |
| Sheets-only leak | Peppered hash + wrapped DK. Without Script Properties pepper, neither unwraps nor offline-guesses cheaply. |
| Sheets + Script Properties leak | Attacker unwraps DK and can login as that user until password change. Same class as stealing the stored verifier. |
| Modified client / skipped 600k | Apps Script cannot prove the work factor. Residual. |

### Options not implemented

- **Pure challenge-response without wrapping DK:** the server only had HMAC(pepper, DK) and could not verify HMAC(DK, nonce).
- **Asymmetric password-derived keys / WebAuthn:** larger enrollment, recovery, and device model. Not in scope. WebAuthn would not remove XSS-on-sessionStorage by itself.
- **Claiming FIXED because a nonce exists:** rejected. A stolen DK answers a new nonce.

Finding B is **MITIGATED**: HTTP replay of login is closed; stolen-verifier login is not.

## Finding C — first Owner credential enrollment (V3)

### Original vulnerability

After identity existed and `AuthCredentials` was empty, `auth.bootstrapOwner` was a public action. An unauthenticated caller who knew the active Owner email could register the first password and receive a session.

### Chosen implementation (Option A)

Keep identity bootstrap and Owner enrollment as **two independent** one-time authorizations.

Option B (combine both into `identity.bootstrap`) was rejected: it would mix identity seed writes with password enrollment, enlarge the identity bootstrap payload, and leave a worse recovery case if Sheets wrote users but not credentials (or the reverse). Separate secrets also prevent the identity bootstrap secret from being reused as a password-enrollment secret.

### Router-level enforcement

`auth.bootstrapOwner` is not in `AUTH_PUBLIC_ACTIONS`. It is a setup action. The router rejects the request unless `payload.ownerEnrollmentAuthorization` is present. The login page does not call this action and does not collect the enrollment secret.

### One-time authorization lifecycle

All four Script Properties are **mandatory**. Missing any of them fails closed. Never store the raw secret in Sheets, API responses, or logs.

- `AUTH_OWNER_ENROLL_HASH` = SHA-256 of the enrollment secret
- `AUTH_OWNER_ENROLL_EXPIRES_AT` mandatory ISO-8601 UTC timestamp (`YYYY-MM-DDTHH:mm:ss.sssZ` or `YYYY-MM-DDTHH:mm:ssZ`)
- `AUTH_OWNER_ENROLL_USERNAME` exact normalized Owner email
- `AUTH_OWNER_ENROLL_USER_ID` exact Owner user ID

Expiry policy:

- Missing, empty, malformed, or unparseable `AUTH_OWNER_ENROLL_EXPIRES_AT` is rejected.
- Expiry equal to now, earlier than now, or more than 15 minutes after now is rejected.
- The server does not silently extend an expired authorization and does not generate a new secret on a failed request.

Under `withScriptLock`:

1. Reject if identity is empty or if any credential already exists (do not consume).
2. Reject if the secret is missing, wrong, expired, reused, or bound to a different username (do not consume).
3. Reject if the user is not that bound ID, not Owner, or not active (do not consume).
4. Reject recoverable password-policy failures (do not consume).
5. Write the credential, re-read it, confirm it belongs to that Owner.
6. Delete the hash, expiry, and bindings.
7. Mint a session only after that confirmation.

The official SPA sign-in form cannot perform this enrollment.

### Administrator procedure

Out of band, owner-controlled machine, DEV only:

1. Confirm identity bootstrap already succeeded and `auth.status.needsOwnerBootstrap` is true.
2. Generate 32 random bytes as 64 hex characters. This is the **Owner enrollment** secret, not the identity bootstrap secret.
3. Store SHA-256(UTF-8 secret) in `AUTH_OWNER_ENROLL_HASH`.
4. Store the existing Owner email in `AUTH_OWNER_ENROLL_USERNAME` and the Owner user ID in `AUTH_OWNER_ENROLL_USER_ID`.
5. Set `AUTH_OWNER_ENROLL_EXPIRES_AT` to `new Date(Date.now() + 15 * 60 * 1000).toISOString()`. Do not omit this property. Do not set a timestamp more than 15 minutes in the future.
6. Call `auth.bootstrapOwner` once with `username`, a stretched verifier or test password, and `ownerEnrollmentAuthorization`. Use clasp / a trusted Apps Script execution, not `/login`.
7. Confirm `AUTH_OWNER_ENROLL_HASH` was deleted.
8. Sign in at `/login` with the Owner password.

### Recovery

Google Sheets is not ACID.

- Recoverable validation failure (wrong secret, wrong email, non-Owner, inactive Owner, weak password) while the authorization is still valid: hash and expiry remain. Correct the request and retry before expiry.
- Expired, missing, empty, malformed, unparseable, or beyond-window expiry: fail closed, do not consume, do not mint. Do not reuse the leftover timestamp. Delete the four enrollment properties and provision a **new** secret with a new expiry no more than 15 minutes in the future.
- Crash after credential write and before consume: `AuthCredentials` has the Owner row, leftover hash is inert because a second enroll is `FORBIDDEN`. Delete leftover properties. Sign in with the password that was written.
- Crash after consume and before session mint: credential exists. Sign in normally. No session was issued from the failed request.
- Credential write failed: no session, hash remains if still unexpired. Retry before expiry, or rotate as above if expired.
- Need to start over after a bad credential write: Owner deletes `AuthCredentials` data rows, reprovisions a **new** enrollment hash and expiry (the old secret was consumed or must be rotated), then retries.

There is no default Owner password and no hardcoded production secret.

### Concurrency

`auth.bootstrapOwner` runs under `withScriptLock`. Nested calls in the **same** Apps Script execution reuse the held lock (`scriptLockDepth`). Distinct executions are serialized by `LockService`.

Automated test methodology (`apps-script/tests/authOwnerEnroll.test.js`):

1. **Overlapping hold (simulated).** A test lock runs the second `handleRequest` from inside the first request's `tryLock`, before `scriptLockDepth` increments. The second independent request therefore hits the real `withScriptLock` path, sees the lock held, and returns `CONFLICT`. The first request then writes one credential, consumes the authorization, and mints one session. This is deterministic overlapping execution in Node. It is **not** two live Google Apps Script executions.
2. **Waiter-resume analogue (sequential).** After the first request completes, a later request with the same authorization sees existing credentials and is `FORBIDDEN`. No second session is minted.
3. **Consume-before-session crash analogue.** Restoring a leftover hash after a successful write still cannot create a second credential; enrollment stays `FORBIDDEN`.

This does **not** prove live Apps Script multi-execution concurrency. Node is single-threaded; the overlapping test injects the second request during the first `tryLock`. Real GAS `LockService.tryLock` would wait up to 10 seconds, then the waiter would enter after release and fail `FORBIDDEN` because credentials already exist.

Manual DEV concurrency procedure (do not run until the owner approves a DEV deploy):

1. Provision a valid Owner enrollment authorization (all four properties, expiry ≤ 15 minutes).
2. From two separate clasp / trusted executions, post `auth.bootstrapOwner` with the same secret at the same time.
3. Expect exactly one success and one `FORBIDDEN` or `CONFLICT`.
4. Confirm one `AuthCredentials` row, deleted enrollment properties, and at most one session from enrollment.
5. Do not use production. Do not leave a live enrollment secret in Script Properties.

### Test evidence

`apps-script/tests/authOwnerEnroll.test.js` drives `handleRequest` (the router): anonymous/missing/invalid/expired/missing-expiry/empty-expiry/malformed-expiry/invalid-date/equal-to-now/beyond-15-minute-window/wrong-email/wrong-user-id/inactive-Owner/non-Owner/identity-secret-reuse are rejected with no credential and no session; first authorized enroll with a valid future expiry succeeds once; reuse, leftover hash, sequential second writer, and overlapping lock-hold second writer fail; normal Owner login works afterward.

## Session security

Intended behavior is unchanged and still required:

- CSPRNG session token; SHA-256 hash stored in `AuthSessions`
- 12-hour absolute expiry; 2-hour idle expiry
- Revoke on logout, password change, password reset, deactivation
- Router overwrites `actorUserId` and strips client role / permission / `isOwner` fields
- Unknown user status is treated as inactive

`sessionStorage` is not an HttpOnly cookie. Do not move the token to `localStorage`. Do not invent a cookie transport this architecture cannot set.

## Authorization

Owner-only: create users, reset passwords, change roles/permissions, security events. Staff sessions cannot escalate by sending `actorRole` or `isOwner`. Forced password change blocks protected modules. Business modules still receive the session-derived actor.

## Future improvement

The smallest defensible next step for Finding B is WebAuthn/passkeys or an external IdP that performs server-verifiable challenge-response without a replayable password-equivalent DK. That is an architecture change and is not part of this PR.
