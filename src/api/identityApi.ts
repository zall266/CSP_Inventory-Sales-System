import { clearAuthSession, readAuthSession } from '@/auth/session'
import type { Department, Role, Settings, User, UserAuditLog } from '@/types'

export type IdentitySlice = {
  users: User[]
  roles: Role[]
  departments: Department[]
  settings: Settings
  userAuditLogs: UserAuditLog[]
}

type IdentityPayload = IdentitySlice & { empty?: boolean; settings: Settings | null }

type Envelope = {
  ok: boolean
  data: IdentityPayload | Record<string, unknown> | null
  error: { code: string; message: string } | null
}

const AUTH_PUBLIC_ACTIONS = new Set([
  'auth.login',
  'auth.challenge',
  'auth.status',
])

export function identityApiUrl() {
  return String(import.meta.env.VITE_CSP_API_URL ?? '').trim()
}

export function canHydrateFromServer() {
  if (!identityApiUrl()) return false
  const session = readAuthSession()
  return Boolean(session?.token && !session.mustChange)
}

export async function postIdentityAction(
  action: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Envelope> {
  const url = identityApiUrl()
  const session = readAuthSession()
  const nextPayload = { ...payload }
  if (session?.token && !AUTH_PUBLIC_ACTIONS.has(action) && nextPayload.sessionToken === undefined) {
    nextPayload.sessionToken = session.token
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      v: 1,
      requestId: crypto.randomUUID(),
      action,
      payload: nextPayload,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    }),
  })
  const body = (await response.json()) as Envelope
  if (
    !AUTH_PUBLIC_ACTIONS.has(action) &&
    body.error?.code === 'UNAUTHORIZED' &&
    session?.token
  ) {
    clearAuthSession()
  }
  return body
}
