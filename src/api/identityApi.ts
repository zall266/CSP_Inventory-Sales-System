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
  data: IdentityPayload | null
  error: { code: string; message: string } | null
}

export function identityApiUrl() {
  return String(import.meta.env.VITE_CSP_API_URL ?? '').trim()
}

export async function postIdentityAction(
  action: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Envelope> {
  const url = identityApiUrl()
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      v: 1,
      requestId: crypto.randomUUID(),
      action,
      payload,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    }),
  })
  const body = (await response.json()) as Envelope
  return body
}
