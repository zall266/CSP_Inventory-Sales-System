// Password hashing for the Apps Script V8 runtime.
// Algorithm: PBKDF2-HMAC-SHA256 (RFC 8018).
// Utilities.computeHmacSha256Signature is the vetted primitive. There is no
// bcrypt, scrypt, or native PBKDF2 in Apps Script.
//
// Iteration count is 12_000. OWASP Password Storage Cheat Sheet (2023+)
// recommends 600_000 PBKDF2-HMAC-SHA256 iterations. That work factor is not
// achievable here: each round is Utilities.computeHmacSha256Signature, a
// Java/native bridge call with high per-call overhead on Apps Script.
// This is NOT OWASP-compliant. Do not describe 12_000 as equivalent.

var AUTH_PBKDF2_ITERATIONS = 12000;
var AUTH_PBKDF2_OWASP_SHA256_ITERATIONS = 600000;
var AUTH_PBKDF2_DKLEN = 32;
var AUTH_SALT_BYTES = 16;
var AUTH_PASSWORD_MIN = 10;
var AUTH_PASSWORD_MAX = 128;

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

function authConcatBytes(left, right) {
  var a = authToBytes(left);
  var b = authToBytes(right);
  var out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
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

function authPbkdf2Block(passwordBytes, saltBytes, iterations, index) {
  var blockIndex = new Uint8Array(4);
  blockIndex[0] = (index >>> 24) & 255;
  blockIndex[1] = (index >>> 16) & 255;
  blockIndex[2] = (index >>> 8) & 255;
  blockIndex[3] = index & 255;
  var u = authHmacSha256(passwordBytes, authConcatBytes(saltBytes, blockIndex));
  var out = new Uint8Array(u.length);
  out.set(u);
  for (var round = 1; round < iterations; round += 1) {
    u = authHmacSha256(passwordBytes, u);
    for (var i = 0; i < out.length; i += 1) out[i] ^= u[i];
  }
  return out;
}

function authPbkdf2HmacSha256(password, salt, iterations, dkLen) {
  var passwordBytes = authToBytes(password);
  var saltBytes = authToBytes(salt);
  var length = dkLen || AUTH_PBKDF2_DKLEN;
  var rounds = iterations || AUTH_PBKDF2_ITERATIONS;
  if (rounds < 1 || length < 1) throw appError('INTERNAL_ERROR', 'Password hash parameters are invalid.');
  var blockCount = Math.ceil(length / 32);
  var derived = new Uint8Array(blockCount * 32);
  for (var i = 1; i <= blockCount; i += 1) {
    derived.set(authPbkdf2Block(passwordBytes, saltBytes, rounds, i), (i - 1) * 32);
  }
  return derived.subarray(0, length);
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
    // Google documents getUuid() as equivalent to java.util.UUID.randomUUID(),
    // which fills 16 bytes from SecureRandom (CSPRNG) and then sets RFC 4122
    // version/variant bits. Do not mix wall-clock time or a non-crypto PRNG.
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

function authHashPassword(password, saltHex, iterations) {
  var salt = saltHex ? authHexToBytes(saltHex) : authRandomBytes(AUTH_SALT_BYTES);
  var rounds = iterations || AUTH_PBKDF2_ITERATIONS;
  var hash = authPbkdf2HmacSha256(authUtf8Bytes(password), salt, rounds, AUTH_PBKDF2_DKLEN);
  return {
    algorithm: 'pbkdf2-hmac-sha256',
    iterations: rounds,
    salt: authBytesToHex(salt),
    hash: authBytesToHex(hash)
  };
}

function authVerifyPassword(password, record) {
  var stored = record && (record.hash || record.passwordHash);
  if (!record || record.algorithm !== 'pbkdf2-hmac-sha256' || !record.salt || !stored) return false;
  var iterations = Number(record.iterations) || AUTH_PBKDF2_ITERATIONS;
  var computed = authHashPassword(password, record.salt, iterations);
  return authTimingSafeEqual(authHexToBytes(computed.hash), authHexToBytes(stored));
}

function authHashToken(token) {
  return authBytesToHex(authSha256(String(token || '')));
}
