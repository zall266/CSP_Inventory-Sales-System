// CSP Auth V1 credential cryptography.
// Staff secrets are CSPRNG lookup secrets (>= 128 bits), not memorized passwords.
// OWASP ASVS 5.0 V6.5.2: a standard hash is allowed at >= 112 bits of entropy.
// Do not use PBKDF2-HMAC-SHA256 at 12,000 iterations. That work factor is not
// OWASP-compliant and is not used here.
// Apps Script V8 has no crypto.subtle / Argon2 / scrypt / native PBKDF2.

// 32 bytes: Node/WebCrypto is 256 bits; Apps Script Utilities.getUuid() is a
// RFC 4122 UUID (~122 bits), so two UUIDs (~244 bits) still clear 128 bits.
var AUTH_SECRET_BYTES = 32;
var AUTH_MIN_ENTROPY_BITS = 128;
var AUTH_ALGORITHM = 'hmac-sha256';
var AUTH_HASH_HEX_LENGTH = 64;
var AUTH_PEPPER_PROPERTY = 'AUTH_CREDENTIAL_PEPPER';
var AUTH_PEPPER_MIN_HEX = 32;
var AUTH_SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
var AUTH_SESSION_IDLE_MS = 2 * 60 * 60 * 1000;

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
  var text = String(value || '');
  if (typeof Buffer !== 'undefined' && Buffer.from) {
    return new Uint8Array(Buffer.from(text, 'utf8'));
  }
  var encoded = unescape(encodeURIComponent(text));
  var bytes = new Uint8Array(encoded.length);
  for (var i = 0; i < encoded.length; i += 1) bytes[i] = encoded.charCodeAt(i);
  return bytes;
}

function authByteList(bytes) {
  var source = authToBytes(bytes);
  var list = [];
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
  var text = String(hex || '').trim().toLowerCase();
  if (!text || text.length % 2) throw appError('INTERNAL_ERROR', 'Hash encoding is invalid.');
  if (!/^[0-9a-f]+$/.test(text)) throw appError('INTERNAL_ERROR', 'Hash encoding is invalid.');
  var out = new Uint8Array(text.length / 2);
  for (var i = 0; i < out.length; i += 1) out[i] = parseInt(text.substr(i * 2, 2), 16);
  return out;
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

function authHmacSha256(key, message) {
  if (typeof Utilities === 'undefined' || !Utilities.computeHmacSha256Signature) {
    throw appError('INTERNAL_ERROR', 'HMAC-SHA256 is unavailable.');
  }
  var signature = Utilities.computeHmacSha256Signature(authByteList(message), authByteList(key));
  return authUnsigned(signature);
}

function authSha256(value) {
  if (typeof Utilities === 'undefined' || !Utilities.computeDigest || !Utilities.DigestAlgorithm) {
    throw appError('INTERNAL_ERROR', 'SHA-256 is unavailable.');
  }
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, authByteList(value));
  return authUnsigned(digest);
}

function authTimingSafeEqual(left, right) {
  var a = authToBytes(left);
  var b = authToBytes(right);
  var mismatch = a.length === b.length ? 0 : 1;
  var length = a.length;
  for (var i = 0; i < length; i += 1) {
    mismatch |= a[i] ^ (i < b.length ? b[i] : 0);
  }
  return mismatch === 0;
}

function authReadPepper() {
  if (typeof PropertiesService === 'undefined' || !PropertiesService.getScriptProperties) {
    throw appError('INTERNAL_ERROR', 'Backend configuration is incomplete.');
  }
  var raw = PropertiesService.getScriptProperties().getProperty(AUTH_PEPPER_PROPERTY);
  var hex = String(raw || '').trim().toLowerCase();
  if (hex.length < AUTH_PEPPER_MIN_HEX || hex.length % 2 || !/^[0-9a-f]+$/.test(hex)) {
    throw appError('INTERNAL_ERROR', 'Backend configuration is incomplete.');
  }
  return authHexToBytes(hex);
}

function authGenerateSecret() {
  var raw = authRandomBytes(AUTH_SECRET_BYTES);
  return {
    plaintext: authBytesToHex(raw),
    raw: raw,
    entropyBits: AUTH_SECRET_BYTES * 8,
    minEntropyBits: AUTH_MIN_ENTROPY_BITS
  };
}

function authHashSecret(plaintext, pepperBytes) {
  var secret = authHexToBytes(String(plaintext || '').trim().toLowerCase());
  if (secret.length < AUTH_SECRET_BYTES) {
    throw appError('VALIDATION_ERROR', 'Credential is not valid.');
  }
  var pepper = pepperBytes || authReadPepper();
  return {
    algorithm: AUTH_ALGORITHM,
    secretHash: authBytesToHex(authHmacSha256(pepper, secret))
  };
}

function authVerifySecret(plaintext, record, pepperBytes) {
  if (!record || record.algorithm !== AUTH_ALGORITHM || !record.secretHash) return false;
  if (String(record.secretHash).length !== AUTH_HASH_HEX_LENGTH) return false;
  var computed;
  try {
    computed = authHashSecret(plaintext, pepperBytes);
  } catch (error) {
    return false;
  }
  return authTimingSafeEqual(authHexToBytes(computed.secretHash), authHexToBytes(record.secretHash));
}

function authHashToken(token) {
  return authBytesToHex(authSha256(String(token || '')));
}

function authRandomToken() {
  return authBytesToHex(authRandomBytes(32));
}
