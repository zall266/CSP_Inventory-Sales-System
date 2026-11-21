export type AuthSession = {
  token: string
  userId: string
  username: string
  name: string
  roleId: string
  roleName: string
  isOwner: boolean
  mustChange: boolean
  expiresAt: string
}

const STORAGE_KEY = 'csp.auth.session.v1'
const listeners = new Set<() => void>()

function canUseStorage() {
  return typeof sessionStorage !== 'undefined'
}

export function readAuthSession(): AuthSession | null {
  if (!canUseStorage()) return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AuthSession
    if (!parsed?.token || !parsed.userId) return null
    return parsed
  } catch {
    return null
  }
}

export function writeAuthSession(session: AuthSession) {
  if (!canUseStorage()) return
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    token: session.token,
    userId: session.userId,
    username: session.username,
    name: session.name,
    roleId: session.roleId,
    roleName: session.roleName,
    isOwner: Boolean(session.isOwner),
    mustChange: Boolean(session.mustChange),
    expiresAt: session.expiresAt,
  }))
  listeners.forEach((listener) => listener())
}

export function clearAuthSession() {
  if (!canUseStorage()) return
  sessionStorage.removeItem(STORAGE_KEY)
  listeners.forEach((listener) => listener())
}

export function subscribeAuthSession(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function sessionFromLoginData(data: {
  sessionToken?: string
  expiresAt?: string
  user?: {
    id?: string
    username?: string
    email?: string
    name?: string
    roleId?: string
    roleName?: string
    isOwner?: boolean
    mustChange?: boolean
  }
}): AuthSession | null {
  if (!data.sessionToken || !data.user?.id) return null
  return {
    token: data.sessionToken,
    userId: data.user.id,
    username: data.user.username || data.user.email || '',
    name: data.user.name || '',
    roleId: data.user.roleId || '',
    roleName: data.user.roleName || '',
    isOwner: Boolean(data.user.isOwner),
    mustChange: Boolean(data.user.mustChange),
    expiresAt: data.expiresAt || '',
  }
}
