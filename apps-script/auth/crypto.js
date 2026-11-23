// CSP Auth V1 credential cryptography.
// Staff secrets are CSPRNG lookup secrets (>= 128 bits), not memorized passwords.
// OWASP ASVS 5.0 V6.5.2: a standard hash is allowed at >= 112 bits of entropy.
// Do not use PBKDF2-HMAC-SHA256 at 12,000 iterations. That work factor is not
// OWASP-compliant and is not used here.
// Apps Script V8 has no crypto.subtle / Argon2 / scrypt / native PBKDF2.
//
// Randomness (fail-closed):
// 1. Web Crypto crypto.getRandomValues, when present. W3C Web Cryptography and
//    MDN document this as a CSPRNG. Google Issue 235538670 (Won't Fix) states
//    the Web Crypto API is not available in Apps Script.
// 2. Otherwise NIST SP 800-90A Rev. 1 HMAC-DRBG with HMAC-SHA256 from
//    Utilities.computeHmacSha256Signature, seeded by AUTH_CREDENTIAL_PEPPER
//    (operator-supplied entropy, >= 128 bits). Domain-separated from the
//    credential HMAC key. The DRBG counter is advanced only while the caller
//    already holds withScriptLock. HMAC-DRBG itself never calls tryLock.
// Utilities.getUuid() is not used for authentication secrets. Google documents
// it as an identifier ("equivalent to java.util.UUID.randomUUID()") and warns
// it is not guaranteed unique. Google does not document it as a CSPRNG.

var AUTH_SECRET_BYTES = 32;
var AUTH_MIN_ENTROPY_BITS = 128;
var AUTH_ALGORITHM = 'hmac-sha256';
var AUTH_HASH_HEX_LENGTH = 64;
var AUTH_PEPPER_PROPERTY = 'AUTH_CREDENTIAL_PEPPER';
var AUTH_PEPPER_MIN_HEX = 32;
var AUTH_CSPRNG_COUNTER_PROPERTY = 'AUTH_CSPRNG_COUNTER';
var AUTH_DRBG_PERSONALIZATION = 'csp.auth.hmac-drbg.v1';
var AUTH_DRBG_ENTROPY_LABEL = 'csp.auth.drbg.entropy.v1';
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

function authConcatBytes() {
  var total = 0;
  var parts = [];
  var i;
  for (i = 0; i < arguments.length; i += 1) {
    parts.push(authToBytes(arguments[i]));
    total += parts[i].length;
  }
  var out = new Uint8Array(total);
  var offset = 0;
  for (i = 0; i < parts.length; i += 1) {
    var part = parts[i];
    var j;
    for (j = 0; j < part.length; j += 1) {
      out[offset] = part[j];
      offset += 1;
    }
  }
  return out;
}

function authRepeatByte(value, length) {
  var out = new Uint8Array(length);
  var i;
  for (i = 0; i < length; i += 1) out[i] = value & 255;
  return out;
}

function authU64be(value) {
  var out = new Uint8Array(8);
  var remaining = Number(value) || 0;
  var i;
  for (i = 7; i >= 0; i -= 1) {
    out[i] = remaining & 255;
    remaining = Math.floor(remaining / 256);
  }
  return out;
}

function authHmacDrbgUpdate(key, value, data) {
  var provided = data && data.length ? data : new Uint8Array(0);
  var nextKey = authHmacSha256(key, authConcatBytes(value, new Uint8Array([0]), provided));
  var nextValue = authHmacSha256(nextKey, value);
  if (provided.length) {
    nextKey = authHmacSha256(nextKey, authConcatBytes(nextValue, new Uint8Array([1]), provided));
    nextValue = authHmacSha256(nextKey, nextValue);
  }
  return { key: nextKey, value: nextValue };
}

function authUnderHeldScriptLock(fn) {
  if (typeof scriptLockDepth === 'number' && scriptLockDepth > 0) return fn();
  return withScriptLock(fn);
}

function authHmacDrbgBytes(size) {
  if (typeof scriptLockDepth !== 'number' || scriptLockDepth < 1) {
    throw appError('INTERNAL_ERROR', 'A cryptographically secure random source is unavailable.');
  }
  var pepper = authReadPepper();
  var entropy = authHmacSha256(pepper, authToBytes(AUTH_DRBG_ENTROPY_LABEL));
  if (typeof PropertiesService === 'undefined' || !PropertiesService.getScriptProperties) {
    throw appError('INTERNAL_ERROR', 'A cryptographically secure random source is unavailable.');
  }
  var props = PropertiesService.getScriptProperties();
  var seq = parseInt(props.getProperty(AUTH_CSPRNG_COUNTER_PROPERTY) || '0', 10);
  if (!isFinite(seq) || seq < 0) seq = 0;
  seq += 1;
  props.setProperty(AUTH_CSPRNG_COUNTER_PROPERTY, String(seq));
  var nonce = authConcatBytes(authU64be(seq), authU64be(Date.now()));
  var seed = authConcatBytes(entropy, nonce, authToBytes(AUTH_DRBG_PERSONALIZATION));
  var state = authHmacDrbgUpdate(authRepeatByte(0, 32), authRepeatByte(1, 32), seed);
  var out = new Uint8Array(size);
  var offset = 0;
  while (offset < size) {
    state.value = authHmacSha256(state.key, state.value);
    var i = 0;
    while (i < state.value.length && offset < size) {
      out[offset] = state.value[i];
      offset += 1;
      i += 1;
    }
  }
  return out;
}

function authRandomBytes(size) {
  var needed = Number(size) || 0;
  if (needed < 1 || needed > 1024) throw appError('INTERNAL_ERROR', 'Random size is invalid.');
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    try {
      var out = new Uint8Array(needed);
      var offset = 0;
      while (offset < needed) {
        var slice = out.subarray(offset, Math.min(offset + 65536, needed));
        crypto.getRandomValues(slice);
        offset += slice.length;
      }
      return out;
    } catch (error) {
      throw appError('INTERNAL_ERROR', 'A cryptographically secure random source is unavailable.');
    }
  }
  try {
    return authUnderHeldScriptLock(function () {
      return authHmacDrbgBytes(needed);
    });
  } catch (error) {
    if (error && error.expose && error.code) throw error;
    throw appError('INTERNAL_ERROR', 'A cryptographically secure random source is unavailable.');
  }
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
