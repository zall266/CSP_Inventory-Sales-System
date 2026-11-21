import { postIdentityAction } from '@/api/identityApi'
import { AUTH_PBKDF2_ITERATIONS, hmacLoginProof, stretchPassword } from '@/auth/passwordHash'

export type LoginProofPayload = {
  challengeId: string
  challenge: string
  loginProof: string
}

export async function proofForUsername(
  username: string,
  password: string,
  purpose: 'login' | 'password-change' = 'login',
): Promise<LoginProofPayload> {
  const needle = username.trim().toLowerCase()
  const challenge = await postIdentityAction('auth.challenge', { username: needle, purpose })
  if (!challenge.ok || !challenge.data || typeof challenge.data !== 'object') {
    throw new Error(challenge.error?.message || 'Could not reach the server.')
  }
  const data = challenge.data as {
    salt?: string
    iterations?: number
    challengeId?: string
    challenge?: string
  }
  if (!data.salt || !data.challengeId || !data.challenge) throw new Error('Could not reach the server.')
  const verifier = await stretchPassword(password, data.salt, Number(data.iterations) || AUTH_PBKDF2_ITERATIONS)
  return {
    challengeId: data.challengeId,
    challenge: data.challenge,
    loginProof: await hmacLoginProof(verifier, data.challengeId, data.challenge, needle, purpose),
  }
}
