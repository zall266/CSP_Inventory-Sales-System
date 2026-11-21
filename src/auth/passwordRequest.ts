import { postIdentityAction } from '@/api/identityApi'
import { AUTH_PBKDF2_ITERATIONS, stretchPassword } from '@/auth/passwordHash'

export async function verifierForUsername(username: string, password: string) {
  const challenge = await postIdentityAction('auth.challenge', { username: username.trim().toLowerCase() })
  if (!challenge.ok || !challenge.data || typeof challenge.data !== 'object') {
    throw new Error(challenge.error?.message || 'Could not reach the server.')
  }
  const data = challenge.data as { salt?: string; iterations?: number }
  if (!data.salt) throw new Error('Could not reach the server.')
  return stretchPassword(password, data.salt, Number(data.iterations) || AUTH_PBKDF2_ITERATIONS)
}
