// Password hashing for the Apps Script V8 runtime.
//
// Apps Script has HMAC-SHA256 and SHA-256, but no bcrypt, scrypt, argon2, or
// native PBKDF2. A Java-bridge PBKDF2 loop cannot reach the OWASP 2023
// PBKDF2-HMAC-SHA256 work factor (600,000) inside a web-app request.
//
// Stored secret:
//   1. Unique 16-byte CSPRNG salt
//   2. PBKDF2-HMAC-SHA256, 600,000 iterations, 32-byte DK (official SPA Web
//      Crypto, or the Node test harness native stretcher)
//   3. HMAC-SHA256(server pepper, DK) stored in Sheets
//   4. wrappedVerifier = DK XOR HMAC(pepper, "wrap|" + salt) so login proofs
//      can be checked without accepting a reusable DK on the wire
// Login proof: HMAC-SHA256(DK, challengeId + "\n" + challenge + "\n" +
// username + "\n" + purpose). A stolen DK can still answer a fresh challenge.
//
// The pepper lives in Script Properties, not in the spreadsheet. A Sheets leak
// without the script does not yield an offline-guessable password hash.
// Apps Script never accepts a weaker iteration count and never falls back to
// unsalted SHA-256 or a short PBKDF2 loop.

var AUTH_PBKDF2_ITERATIONS = 600000;
var AUTH_PBKDF2_OWASP_SHA256_ITERATIONS = 600000;
var AUTH_PBKDF2_DKLEN = 32;
var AUTH_SALT_BYTES = 16;
var AUTH_PASSWORD_MIN = 10;
var AUTH_PASSWORD_MAX = 128;
var AUTH_PEPPER_PROPERTY = 'AUTH_PASSWORD_PEPPER';
var IDENTITY_BOOTSTRAP_HASH_PROPERTY = 'IDENTITY_BOOTSTRAP_HASH';
var IDENTITY_BOOTSTRAP_EXPIRES_PROPERTY = 'IDENTITY_BOOTSTRAP_EXPIRES_AT';
var AUTH_OWNER_ENROLL_HASH_PROPERTY = 'AUTH_OWNER_ENROLL_HASH';
var AUTH_OWNER_ENROLL_EXPIRES_PROPERTY = 'AUTH_OWNER_ENROLL_EXPIRES_AT';
var AUTH_OWNER_ENROLL_USERNAME_PROPERTY = 'AUTH_OWNER_ENROLL_USERNAME';
var AUTH_OWNER_ENROLL_USER_ID_PROPERTY = 'AUTH_OWNER_ENROLL_USER_ID';
// Owner enrollment expiry is mandatory and fail-closed. Remaining TTL must be
// greater than zero and at most 15 minutes. Date.now is supplied by the caller.
var AUTH_OWNER_ENROLL_MAX_MS = 15 * 60 * 1000;
var AUTH_OWNER_ENROLL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
var AUTH_SETUP_SECRET_MIN = 32;
var AUTH_CHALLENGE_TTL_MS = 2 * 60 * 1000;
var AUTH_LOGIN_PURPOSE = 'login';
var AUTH_PASSWORD_CHANGE_PURPOSE = 'password-change';

function authUtf8Bytes(value) {
  var text = String(value || '');
  if (typeof Buffer !== 'undefined' && Buffer.from) {
    return new Uint8Array(Buffer.from(text, 'utf8'));
  }
  var encoded = unescape(encodeURIComponent(text));
  var bytes = new Uint8Array(encoded.length);
  for (var i = 0; i < encoded.length; i += 1) bytes[i] = encoded.charCodeAt(i);
  return bytes;
}

function authToBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(value)) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    var copy = new Uint8Array(value.length);
    for (var i = 0; i < value.length; i += 1) copy[i] = value[i] & 255;
    return copy;
  }
  return authUtf8Bytes(value);
}

function authByteList(bytes) {
  var list = [];
  var source = authToBytes(bytes);
  for (var i = 0; i < source.length; i += 1) list.push(source[i]);
  return list;
}

function authUnsigned(bytes) {
  var source = authToBytes(bytes);
  var out = new Uint8Array(source.length);
  for (var i = 0; i < source.length; i += 1) {
    var value = source[i];
    out[i] = value < 0 ? value + 256 : value & 255;
  }
  return out;
}

function authBytesToHex(bytes) {
  var source = authUnsigned(bytes);
  var hex = '';
  for (var i = 0; i < source.length; i += 1) {
    var part = source[i].toString(16);
    hex += part.length === 1 ? '0' + part : part;
  }
  return hex;
}

function authHexToBytes(hex) {
  var text = String(hex || '');
  if (text.length % 2) throw appError('INTERNAL_ERROR', 'Hash encoding is invalid.');
  var out = new Uint8Array(text.length / 2);
  for (var i = 0; i < out.length; i += 1) {
    var value = parseInt(text.substr(i * 2, 2), 16);
    if (isNaN(value)) throw appError('INTERNAL_ERROR', 'Hash encoding is invalid.');
    out[i] = value;
  }
  return out;
}

function authHmacSha256(key, message) {
  if (typeof Utilities === 'undefined' || !Utilities.computeHmacSha256Signature) {
    throw appError('INTERNAL_ERROR', 'HMAC-SHA256 is unavailable.');
  }
  var signature = Utilities.computeHmacSha256Signature(authByteList(message), authByteList(key));
  return authUnsigned(signature);
}

function authSha256(value) {
  if (typeof Utilities !== 'undefined' && Utilities.computeDigest && Utilities.DigestAlgorithm) {
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, authByteList(value));
    return authUnsigned(digest);
  }
  throw appError('INTERNAL_ERROR', 'SHA-256 is unavailable.');
}

function authFillFromUuidString(uuid, out, offset) {
  var hex = String(uuid || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw appError('INTERNAL_ERROR', 'Secure random source returned an invalid UUID.');
  }
  var i = 0;
  while (i + 1 < hex.length && offset < out.length) {
    out[offset] = parseInt(hex.substr(i, 2), 16);
    offset += 1;
    i += 2;
  }
  return offset;
}

function authRandomBytes(size) {
  var needed = Number(size) || 0;
  if (needed < 1 || needed > 1024) throw appError('INTERNAL_ERROR', 'Random size is invalid.');
  var out = new Uint8Array(needed);
  var offset = 0;
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    while (offset < needed) {
      var slice = out.subarray(offset, Math.min(offset + 65536, needed));
      crypto.getRandomValues(slice);
      offset += slice.length;
    }
    return out;
  }
  if (typeof Utilities !== 'undefined' && typeof Utilities.getUuid === 'function') {
    while (offset < needed) offset = authFillFromUuidString(Utilities.getUuid(), out, offset);
    return out;
  }
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    while (offset < needed) offset = authFillFromUuidString(crypto.randomUUID(), out, offset);
    return out;
  }
  throw appError('INTERNAL_ERROR', 'A cryptographically secure random source is unavailable.');
}

function authRandomToken() {
  return authBytesToHex(authRandomBytes(32));
}

function authTimingSafeEqual(left, right) {
  var a = authToBytes(left);
  var b = authToBytes(right);
  var length = a.length;
  var mismatch = a.length === b.length ? 0 : 1;
  for (var i = 0; i < length; i += 1) {
    mismatch |= a[i] ^ (i < b.length ? b[i] : 0);
  }
  return mismatch === 0;
}

function authValidatePasswordPolicy(password, username) {
  var value = String(password || '');
  if (value.length < AUTH_PASSWORD_MIN || value.length > AUTH_PASSWORD_MAX) {
    throw appError('VALIDATION_ERROR', 'Password must be 10 to 128 characters.');
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    throw appError('VALIDATION_ERROR', 'Password must include a letter and a number.');
  }
  var user = String(username || '').trim().toLowerCase();
  if (user && value.trim().toLowerCase() === user) {
    throw appError('VALIDATION_ERROR', 'Password cannot match the username.');
  }
}

function authIsHex(value, bytes) {
  return new RegExp('^[0-9a-f]{' + String(bytes * 2) + '}$').test(String(value || ''));
}

function authNormalizeVerifier(value) {
  var hex = String(value || '').trim().toLowerCase();
  if (!authIsHex(hex, AUTH_PBKDF2_DKLEN)) {
    throw appError('VALIDATION_ERROR', 'Password is invalid.');
  }
  return hex;
}

function authNormalizeSalt(value) {
  var hex = String(value || '').trim().toLowerCase();
  if (!authIsHex(hex, AUTH_SALT_BYTES)) {
    throw appError('VALIDATION_ERROR', 'Password is invalid.');
  }
  return hex;
}

function authRequireIterations(value) {
  var rounds = Number(value);
  if (rounds !== AUTH_PBKDF2_ITERATIONS) {
    throw appError('VALIDATION_ERROR', 'Password work factor is invalid.');
  }
  return rounds;
}

function authPasswordPepperHex() {
  if (typeof PropertiesService === 'undefined' || !PropertiesService.getScriptProperties) {
    throw appError('INTERNAL_ERROR', 'Password pepper storage is unavailable.');
  }
  var props = PropertiesService.getScriptProperties();
  var existing = String(props.getProperty(AUTH_PEPPER_PROPERTY) || '').trim().toLowerCase();
  if (authIsHex(existing, 32)) return existing;
  var generated = authBytesToHex(authRandomBytes(32));
  props.setProperty(AUTH_PEPPER_PROPERTY, generated);
  return generated;
}

function authSealVerifier(verifierHex) {
  var verifier = authHexToBytes(authNormalizeVerifier(verifierHex));
  var pepper = authHexToBytes(authPasswordPepperHex());
  return authBytesToHex(authHmacSha256(pepper, verifier));
}

function authHasNativeStretcher() {
  return typeof authNativePbkdf2HmacSha256 === 'function';
}

function authStretchPassword(password, saltBytes, iterations) {
  var rounds = Number(iterations) || AUTH_PBKDF2_ITERATIONS;
  if (rounds < AUTH_PBKDF2_ITERATIONS) {
    throw appError('INTERNAL_ERROR', 'Password work factor is below the required minimum.');
  }
  if (!authHasNativeStretcher()) {
    throw appError('INTERNAL_ERROR', 'Password stretching is not available in Apps Script. Send a PBKDF2 verifier.');
  }
  return authUnsigned(authNativePbkdf2HmacSha256(
    authUtf8Bytes(password),
    authToBytes(saltBytes),
    rounds,
    AUTH_PBKDF2_DKLEN
  ));
}

function authWrapVerifier(verifierHex, saltHex) {
  var dk = authHexToBytes(authNormalizeVerifier(verifierHex));
  var salt = authNormalizeSalt(saltHex);
  var pad = authHmacSha256(authHexToBytes(authPasswordPepperHex()), authUtf8Bytes('wrap|' + salt));
  var out = new Uint8Array(AUTH_PBKDF2_DKLEN);
  var i;
  for (i = 0; i < AUTH_PBKDF2_DKLEN; i += 1) out[i] = dk[i] ^ pad[i];
  return authBytesToHex(out);
}

function authUnwrapVerifier(wrappedHex, saltHex) {
  return authWrapVerifier(wrappedHex, saltHex);
}

function authProofMessage(challengeId, challenge, username, purpose) {
  return String(challengeId || '') + '\n' + String(challenge || '') + '\n' + String(username || '').trim().toLowerCase() + '\n' + String(purpose || '');
}

function authLoginProof(verifierHex, challengeId, challenge, username, purpose) {
  var dk = authHexToBytes(authNormalizeVerifier(verifierHex));
  return authBytesToHex(authHmacSha256(dk, authUtf8Bytes(authProofMessage(challengeId, challenge, username, purpose))));
}

function authHashPassword(password, saltHex, iterations) {
  var salt = saltHex ? authHexToBytes(authNormalizeSalt(saltHex)) : authRandomBytes(AUTH_SALT_BYTES);
  var rounds = authRequireIterations(iterations || AUTH_PBKDF2_ITERATIONS);
  var stretched = authStretchPassword(password, salt, rounds);
  var saltHexOut = authBytesToHex(salt);
  var dkHex = authBytesToHex(stretched);
  return {
    algorithm: 'pbkdf2-hmac-sha256',
    iterations: rounds,
    salt: saltHexOut,
    hash: authSealVerifier(dkHex),
    wrappedVerifier: authWrapVerifier(dkHex, saltHexOut)
  };
}

function authHashFromVerifier(verifierHex, saltHex, iterations) {
  var rounds = authRequireIterations(iterations || AUTH_PBKDF2_ITERATIONS);
  var salt = authNormalizeSalt(saltHex);
  var dkHex = authNormalizeVerifier(verifierHex);
  return {
    algorithm: 'pbkdf2-hmac-sha256',
    iterations: rounds,
    salt: salt,
    hash: authSealVerifier(dkHex),
    wrappedVerifier: authWrapVerifier(dkHex, salt)
  };
}

function authVerifyLoginProof(record, proofHex, challengeId, challenge, username, purpose) {
  if (!authCredentialWorkFactorOk(record) || !record.wrappedVerifier) return false;
  try {
    var dkHex = authUnwrapVerifier(record.wrappedVerifier, record.salt);
    if (!authVerifyVerifier(dkHex, record)) return false;
    var expected = authLoginProof(dkHex, challengeId, challenge, username, purpose);
    return authTimingSafeEqual(authHexToBytes(authNormalizeVerifier(proofHex)), authHexToBytes(expected));
  } catch (error) {
    return false;
  }
}

function authIdentityBootstrapConfigured() {
  if (typeof PropertiesService === 'undefined' || !PropertiesService.getScriptProperties) return false;
  var hash = String(PropertiesService.getScriptProperties().getProperty(IDENTITY_BOOTSTRAP_HASH_PROPERTY) || '').trim().toLowerCase();
  return authIsHex(hash, 32);
}

function authIdentityBootstrapExpired(nowMs) {
  if (typeof PropertiesService === 'undefined' || !PropertiesService.getScriptProperties) return true;
  var expires = String(PropertiesService.getScriptProperties().getProperty(IDENTITY_BOOTSTRAP_EXPIRES_PROPERTY) || '').trim();
  if (!expires) return false;
  var at = Date.parse(expires);
  return isFinite(at) && at <= Number(nowMs);
}

function authVerifyIdentityBootstrapSecret(secret, nowMs) {
  if (!authIdentityBootstrapConfigured()) return false;
  if (authIdentityBootstrapExpired(nowMs)) return false;
  var value = String(secret || '');
  if (value.length < AUTH_SETUP_SECRET_MIN) return false;
  var stored = String(PropertiesService.getScriptProperties().getProperty(IDENTITY_BOOTSTRAP_HASH_PROPERTY) || '').trim().toLowerCase();
  var computed = authBytesToHex(authSha256(authUtf8Bytes(value)));
  return authTimingSafeEqual(authHexToBytes(computed), authHexToBytes(stored));
}

function authConsumeIdentityBootstrapSecret() {
  authDeleteScriptProperties([
    IDENTITY_BOOTSTRAP_HASH_PROPERTY,
    IDENTITY_BOOTSTRAP_EXPIRES_PROPERTY
  ]);
}

function authDeleteScriptProperties(keys) {
  if (typeof PropertiesService === 'undefined' || !PropertiesService.getScriptProperties) return;
  var props = PropertiesService.getScriptProperties();
  var i;
  for (i = 0; i < keys.length; i += 1) {
    if (typeof props.deleteProperty === 'function') props.deleteProperty(keys[i]);
    else props.setProperty(keys[i], '');
  }
}

function authOwnerEnrollBinding() {
  if (typeof PropertiesService === 'undefined' || !PropertiesService.getScriptProperties) {
    return { username: '', userId: '' };
  }
  var props = PropertiesService.getScriptProperties();
  return {
    username: String(props.getProperty(AUTH_OWNER_ENROLL_USERNAME_PROPERTY) || '').trim().toLowerCase(),
    userId: String(props.getProperty(AUTH_OWNER_ENROLL_USER_ID_PROPERTY) || '').trim()
  };
}

function authParseOwnerEnrollExpiryMs(value) {
  var text = String(value || '').trim();
  if (!text || !AUTH_OWNER_ENROLL_ISO.test(text)) return NaN;
  var at = Date.parse(text);
  return isFinite(at) ? at : NaN;
}

function authOwnerEnrollExpiryMs() {
  if (typeof PropertiesService === 'undefined' || !PropertiesService.getScriptProperties) return NaN;
  return authParseOwnerEnrollExpiryMs(PropertiesService.getScriptProperties().getProperty(AUTH_OWNER_ENROLL_EXPIRES_PROPERTY));
}

function authOwnerEnrollConfigured() {
  if (typeof PropertiesService === 'undefined' || !PropertiesService.getScriptProperties) return false;
  var hash = String(PropertiesService.getScriptProperties().getProperty(AUTH_OWNER_ENROLL_HASH_PROPERTY) || '').trim().toLowerCase();
  var bound = authOwnerEnrollBinding();
  return authIsHex(hash, 32) && Boolean(bound.username) && Boolean(bound.userId) && isFinite(authOwnerEnrollExpiryMs());
}

function authOwnerEnrollExpired(nowMs) {
  var at = authOwnerEnrollExpiryMs();
  var now = Number(nowMs);
  if (!isFinite(at) || !isFinite(now)) return true;
  if (at <= now) return true;
  if (at - now > AUTH_OWNER_ENROLL_MAX_MS) return true;
  return false;
}

function authVerifyOwnerEnrollSecret(secret, username, nowMs) {
  if (!authOwnerEnrollConfigured()) return false;
  if (authOwnerEnrollExpired(nowMs)) return false;
  var value = String(secret || '');
  if (value.length < AUTH_SETUP_SECRET_MIN) return false;
  var bound = authOwnerEnrollBinding();
  if (bound.username !== String(username || '').trim().toLowerCase()) return false;
  var stored = String(PropertiesService.getScriptProperties().getProperty(AUTH_OWNER_ENROLL_HASH_PROPERTY) || '').trim().toLowerCase();
  var computed = authBytesToHex(authSha256(authUtf8Bytes(value)));
  return authTimingSafeEqual(authHexToBytes(computed), authHexToBytes(stored));
}

function authConsumeOwnerEnrollSecret() {
  authDeleteScriptProperties([
    AUTH_OWNER_ENROLL_HASH_PROPERTY,
    AUTH_OWNER_ENROLL_EXPIRES_PROPERTY,
    AUTH_OWNER_ENROLL_USERNAME_PROPERTY,
    AUTH_OWNER_ENROLL_USER_ID_PROPERTY
  ]);
}

function authCredentialWorkFactorOk(record) {
  return Boolean(
    record &&
    record.algorithm === 'pbkdf2-hmac-sha256' &&
    Number(record.iterations) >= AUTH_PBKDF2_ITERATIONS &&
    record.salt &&
    (record.hash || record.passwordHash)
  );
}

function authVerifyVerifier(verifierHex, record) {
  if (!authCredentialWorkFactorOk(record)) return false;
  try {
    var sealed = authSealVerifier(verifierHex);
    var stored = record.hash || record.passwordHash;
    return authTimingSafeEqual(authHexToBytes(sealed), authHexToBytes(stored));
  } catch (error) {
    return false;
  }
}

function authVerifyPassword(password, record) {
  if (!authCredentialWorkFactorOk(record) || typeof password !== 'string' || !password) return false;
  if (!authHasNativeStretcher()) return false;
  try {
    var stretched = authStretchPassword(password, authHexToBytes(record.salt), Number(record.iterations));
    return authVerifyVerifier(authBytesToHex(stretched), record);
  } catch (error) {
    return false;
  }
}

function authDummyChallengeSalt(username) {
  var pepper = authHexToBytes(authPasswordPepperHex());
  var material = authUtf8Bytes('csp-auth-challenge|' + String(username || '').trim().toLowerCase());
  return authBytesToHex(authHmacSha256(pepper, material).subarray(0, AUTH_SALT_BYTES));
}

function authHashToken(token) {
  return authBytesToHex(authSha256(String(token || '')));
}
