# Authentication security hardening V2

DEV only. PR #133 remains review-only. Do not merge, deploy Apps Script, deploy GitHub Pages, or bootstrap a production Owner.

This document records the bootstrap takeover fix, the password-verifier replay assessment, and residual risks. It does not approve the PR.

## Decision summary

| Finding | Decision | Meaning |
| --- | --- | --- |
| A. Public `identity.bootstrap` takeover | **FIXED** | Anonymous callers cannot create the initial Owner. Bootstrap requires a one-time Script Properties hash, consumed under the script lock. |
| B. Password verifier replay | **MITIGATED** | Captured login HTTP requests cannot be replayed. A stolen PBKDF2 derived key can still prove a fresh challenge. Not FIXED. |
| Session token in `sessionStorage` | **RESIDUAL** | GitHub Pages + Apps Script cannot issue an HttpOnly cookie for this SPA. XSS that can read `sessionStorage` steals the session. |
| Client-enforced PBKDF2 | **RESIDUAL** | Apps Script cannot re-run 600,000 PBKDF2 rounds. A modified client can send a DK stretched with fewer iterations. |

Final recommendation from this task: **READY FOR SECURITY RE-REVIEW**. Do not treat this file as approval.

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
6. Set the Owner password with `auth.bootstrapOwner` using the official SPA (still public only while `AuthCredentials` is empty).

If the hash is never provisioned, bootstrap fails closed.

### Residual bootstrap risk

Submitting the setup secret through `doPost` exposes that one value to anyone who can observe the request. The web app remains `ANYONE_ANONYMOUS`. The secret is single-use and not returned. `auth.bootstrapOwner` is still a public one-time password enrollment after identity exists; it cannot create identity.

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
