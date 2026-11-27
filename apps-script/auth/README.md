# Auth V1 credential store (DEV)

Phase 1 HMAC-SHA256 lookup-secret store plus AUTH-1 login/session HTTP actions for the DEV Apps Script + Sheets stack. This is not a login UI, registration flow, Owner bootstrap, or production deployment.

Do not merge, clasp-push, or change PROD from this document. Do not put a real pepper in git, logs, sheet cells, or chat.

## AUTH-1 login and sessions

Envelope field `sessionToken` (not `payload`). Actions:

| Action | Token required | Behaviour |
| --- | --- | --- |
| `auth.login` | no | Email + generated secret. Generic `UNAUTHORIZED` on failure. Returns `{ token, sessionId, expiresAt, idleExpiresAt, user: { id, name, email, roleId } }`. |
| `auth.logout` | yes | Revokes **this** session only. |
| `auth.session` | yes | Returns the authenticated user. No token, hashes, or pepper. |

`issueCredential`, `rotateCredential`, `readCredentials`, and sheet hashes are **not** HTTP actions.

AUTH-2 requires a session on every non-public action, including reads, exports, images, and Drive files. Missing, invalid, expired, idle, or revoked tokens fail closed except on the public allowlist: `auth.login`, `system.health`, and `system.ping`. `auth.logout` and `auth.session` require a valid session. Future `auth.register` / `auth.forgotPassword` / `auth.bootstrapOwner` actions are not public.

When a session is valid, the router overwrites `payload.actorUserId` from the session. Client role, department, and permissions are never read for authentication.

`auth.*` responses are never written to Idempotency (the login body contains the raw token). Request logs record only requestId, action, status, errorCode, durationMs.

Session lifetime: 12 hours absolute, 2 hours idle, sliding idle never extends absolute. Store SHA-256(token) only.

Client storage: AUTH-1 does not write `sessionToken` to `localStorage`. AUTH-4 will hold it in `sessionStorage` only.

Owner bootstrap secret must never enter frontend code, browser storage, logs, or ordinary API responses. There is no public Owner registration in AUTH-1.

## Secret generation

Two paths. Only the first is a CSPRNG.

1. **Web Crypto** `crypto.getRandomValues()`, when present. 32-byte outputs have 256 bits of CSPRNG entropy. Google Issue 235538670 (Won't Fix) states this API is not available in Apps Script.
2. **NIST SP 800-108 HMAC-SHA256 KDF in counter mode**, keyed by `AUTH_CREDENTIAL_PEPPER`. Deterministic and pepper-keyed. **Not** a CSPRNG. **Not** an SP 800-90A HMAC_DRBG. `AUTH_NIST_800_90A_RBG = false`. This implementation is not NIST-validated or certified.

PRF input is `[i]_32 || Label || 0x00 || Context || [L]_32`. `i` and `L` are 32-bit big-endian. `L` is the total derived length in bits. Context is the 64-bit big-endian KDF invocation counter. Key derivation uses label `csp.auth.kdf.key.v1`. Output derivation uses label `csp.auth.lookup-secret.v1`. Credential hashes are `HMAC-SHA256(pepper, secret)` and do not use those labels.

HMAC_DRBG Update / Instantiate / Generate exist only for known-answer tests. Production generation never calls them.

`Math.random()`, `Utilities.getUuid()`, and timestamps are not used for secrets.

## Pepper provisioning

`AUTH_CREDENTIAL_PEPPER` is a Script Property. The backend **never** generates it, never replaces a missing value, and never logs it.

A 64-character hexadecimal string has **256 bits of length**. Length is not entropy. Entropy exists only if the bytes were produced by a trusted CSPRNG.

### Generate (outside Apps Script)

On a trusted machine, generate 32 random bytes and encode as lowercase hex. Examples (run locally, not in this repo's Apps Script project):

```bash
openssl rand -hex 32
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Do not use `Math.random()`, `Utilities.getUuid()`, wall-clock timestamps, or a typed passphrase.

The result must be exactly 64 hexadecimal characters (`[0-9a-fA-F]{64}`). Shorter values, longer values, odd-length hex, whitespace (including padded 64-hex), and non-hex are rejected. The backend does not trim or otherwise normalize invalid input.

### Install on DEV

1. Open the existing DEV Apps Script project.
2. Project Settings → Script Properties.
3. Add `AUTH_CREDENTIAL_PEPPER` with the 64-hex value.
4. Do not add it to `getConfig`, `.env`, React, sheet cells, clasp credentials, or this repository.
5. Do not print it in logs, test output, or Cursor.

`ENVIRONMENT`, `SPREADSHEET_ID`, `DRIVE_ROOT_ID`, and `TIMEZONE` remain the `getConfig` keys. Pepper is fail-closed at first credential or session mint if missing.

Protect the value the same way as other Script Properties: limit script editors. Anyone who can edit the script can read Script Properties.

## Length-based security bound

`securityBoundBits` / `entropyBits` on the KDF path equal:

`min(pepper length in bits, 256-bit HMAC-SHA256 PRF, 256-bit output)`

That is a **theoretical bound from configured length**, assuming the pepper was CSPRNG-provisioned as above. Apps Script cannot measure actual entropy. All-zero 64-hex, a repeated pattern, or a passphrase encoded as hex would still have 256 bits of length and almost no entropy. The operator procedure is the guarantee, not the length check.

`AUTH_MIN_ENTROPY_BITS` stays **128**. It is the minimum accepted bound, not proof that a given pepper has 128 bits of entropy.

On the Web Crypto path, `entropyBits` is 256 and `entropyMeasured` is true because `getRandomValues` is a CSPRNG.

## Counters and high-water

Under the script lock, persistence order is:

1. Write `AUTH_KDF_COUNTER` and `AUTH_KDF_INITIALIZED`.
2. Append AuthEvents `kdf_advance` (reason = canonical decimal counter).
3. Persist credential or session rows.
4. Append `credential_issued` / `credential_rotated`.

Script Properties and Sheets are **not** one transaction.

- Canonical counters only (`/^[1-9][0-9]*$/` that round-trip through `Number`). Reject `01`, `1e2`, floats, hex, whitespace, negatives.
- `AUTH_KDF_INITIALIZED` must be empty/missing or the exact string `1`. Any other non-empty value (`0`, `true`, `invalid`, padded `1`) fails closed.
- Empty/missing `INITIALIZED` is first boot only when the counter property is genuinely absent (not an empty string), and there is no sheet high-water, credential, or session. An existing `AUTH_KDF_COUNTER` key, including `''`, fails closed.
- Missing counter after initialization fails closed.
- Property counter below sheet high-water fails closed.
- Malformed `kdf_advance` reasons fail closed.
- Fail closed at `Number.MAX_SAFE_INTEGER` (cannot increment).
- Partial failure after step 1 or 2 **skips** the used counter. It does not reuse it. Holes are acceptable.
- First boot is allowed only when there is no previous KDF state and no keyed outputs.

`LockService.getScriptLock().tryLock(ms)` is not reentrant in the same Apps Script execution. Nested minting reuses `scriptLockDepth` instead of calling `tryLock` again. The lock is released in `finally` after success or throw.

## Full-wipe limitation

A wipe of **both** Script Properties **and** the AuthCredentials / AuthSessions / AuthEvents sheets, while keeping the same pepper, looks like first boot and can repeat KDF counter 1. Rotate the pepper after disaster recovery. Script editors who can perform that wipe already hold the pepper.

## Pepper rotation (disaster recovery)

1. Generate a new 32-byte CSPRNG pepper (64 hex) outside Apps Script.
2. Replace `AUTH_CREDENTIAL_PEPPER` in DEV Script Properties.
3. **Do not** reset `AUTH_KDF_COUNTER` or `AUTH_KDF_INITIALIZED`. This code will not reset them automatically.
4. Existing credential hashes become unverifiable (HMAC key changed). Re-issue every staff credential.
5. Session token hashes are SHA-256 of the opaque token and are not peppered. Revoke sessions after rotation.
6. Old plaintext secrets must be treated as compromised if the old pepper leaked.

## AUTH-2 authorization gate

The router classifies every dispatched action in `auth/actionPermissions.js`. Unlisted actions are rejected. Public access is never inferred from an action-name prefix.

| Classification | Meaning |
| --- | --- |
| public | `system.health`, `system.ping`, `auth.login` only |
| authenticated | Valid session, active user. Used where the existing service only required a known actor (product/category/customer/supplier writes, master reads). |
| permission | At least one existing catalog key from `permissionCatalog.js` |
| owner | Bootstrap/seed only: `identity.bootstrap`, `masters.bootstrap`, `products.bootstrap`, `parties.bootstrap`, `warehouse.bootstrap`, `boms.bootstrap` |
| disabled | None in AUTH-2 |

The session is the only identity source. The router overwrites `payload.actorUserId` and ignores client `role`, `roleId` (as actor role), `departmentId`, `permissions`, and `isOwner`. Target `roleId` on `users.create` is still a field of the new user and is authorized with `users.create` plus `canAssignRole`.

`identity.get` is session-only. The response is filtered from the existing permission keys; AUTH-2 does not grant extra catalog permissions so that staff can hydrate:

| Permission | Users | Roles catalog | `roleMatrix` | Bank name/account | Other settings | User audit logs |
| --- | --- | --- | --- | --- | --- | --- |
| none of the three | self only | own role | own role only | omitted | operational fields | omitted |
| `users.view` | all users | all roles (names; needed to label users) | own role only | omitted | operational fields | included |
| `roles.view` | self only | all roles | full matrix | omitted | operational fields | included |
| `settings.view` | self only | own role | own role only | included | full settings | omitted |
| Owner / Admin | full snapshot | full | full | included | full | included |

`settings.get` still requires `settings.view` and redacts `roleMatrix` unless the caller also has `roles.view` or `roles.permissions.manage`. `users.list` still requires `users.view`.

## Session-only writes (existing business design)

These actions stay **session-only** because the existing services only required a known active actor. AUTH-2 did not add catalog keys or change the role matrix. Any **active** authenticated user (Owner, Admin, Supervisor, Staff, Cashier, Warehouse) may:

- create, update, and set status on products (`products.create` / `update` / `setStatus`)
- create and rename categories (`categories.create` / `categories.rename`)
- create customers and suppliers (`customers.create` / `suppliers.create`)
- list/get those records, plus `masters.get`, warehouse/category reads, `parties.get`, and `agents.list` / `agents.get` (agent get still hides unlinked agents in the service)

Image mutation, agent prices, and agent writes still use their existing permission keys. Cashier still cannot administer users, roles, or settings.

Inactive, pending, rejected, or missing users cannot keep using a previously issued session.

Initialization: anonymous bootstrap is rejected. Owner-only bootstrap remains available so tests and a signed-in Owner can seed empty DEV sheets. It cannot run twice on already-initialized data. Owner bootstrap UI and first-user HTTP registration belong to AUTH-3. Seed names such as Aina Rahman do not become authenticated users until AUTH-3 issues credentials.

## Login abuse protection

`AuthLoginAttempts` stores SHA-256 of the normalized email, a failed-count window (15 minutes), and a cooldown (1–15 minutes, doubling after the 5th failure). Rows are pruned to 200 / 24 hours. Messages stay generic (`Email or password is incorrect.`). Plaintext email and password are not stored. Apps Script does not provide a trustworthy client IP, so throttling is per email hash only. `auth.login` holds `LockService.getScriptLock()` for the whole attempt so throttle check, credential verify, failure increment, and cooldown cannot interleave across executions. Nested auth-store writes reuse that lock (`scriptLockDepth`). A failure recorded while a cooldown is already active does not reset the counter. This is not an account lockout: a successful login after cooldown clears the row.

## Residual Apps Script limits

- No Web Crypto in production GAS, so the live path is the pepper-keyed KDF.
- No atomic commit across Script Properties and Sheets.
- No live entropy source for an SP 800-90A DRBG.
- Script editors can read Script Properties.
- Execution kill after a property write can leave a skipped counter; that is fail-closed, not reuse.
