# Auth V1 credential store (DEV)

Phase 1 HMAC-SHA256 lookup-secret store for the DEV Apps Script + Sheets stack. This is not a login UI, registration flow, or production deployment.

Do not merge, clasp-push, or change PROD from this document. Do not put a real pepper in git, logs, sheet cells, or chat.

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

The result must be exactly 64 hexadecimal characters (`[0-9a-f]{64}`). Shorter values, odd-length hex, and non-hex are rejected.

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
- Missing `INITIALIZED` after any credential/session rows or sheet high-water fails closed.
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

## Residual Apps Script limits

- No Web Crypto in production GAS, so the live path is the pepper-keyed KDF.
- No atomic commit across Script Properties and Sheets.
- No live entropy source for an SP 800-90A DRBG.
- Script editors can read Script Properties.
- Execution kill after a property write can leave a skipped counter; that is fail-closed, not reuse.
