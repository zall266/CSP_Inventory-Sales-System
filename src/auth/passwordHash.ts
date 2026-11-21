export const AUTH_PBKDF2_ITERATIONS = 600_000
export const AUTH_PBKDF2_DKLEN = 32
export const AUTH_SALT_BYTES = 16

function bytesToHex(bytes: Uint8Array) {
  let hex = ''
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

function hexToBytes(hex: string) {
  const text = String(hex || '').trim().toLowerCase()
  if (!/^[0-9a-f]+$/.test(text) || text.length % 2) {
    throw new Error('Secure password hashing is unavailable in this browser.')
  }
  const out = new Uint8Array(text.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function newPasswordSalt() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure password hashing is unavailable in this browser.')
  }
  const bytes = new Uint8Array(AUTH_SALT_BYTES)
  globalThis.crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

export async function stretchPassword(
  password: string,
  saltHex: string,
  iterations = AUTH_PBKDF2_ITERATIONS,
): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure password hashing is unavailable in this browser.')
  }
  if (iterations < AUTH_PBKDF2_ITERATIONS) {
    throw new Error('Password work factor is below the required minimum.')
  }
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBytes(saltHex),
      iterations,
    },
    key,
    AUTH_PBKDF2_DKLEN * 8,
  )
  return bytesToHex(new Uint8Array(bits))
}

export async function preparePasswordVerifier(password: string) {
  const salt = newPasswordSalt()
  return {
    salt,
    iterations: AUTH_PBKDF2_ITERATIONS,
    passwordVerifier: await stretchPassword(password, salt, AUTH_PBKDF2_ITERATIONS),
  }
}
