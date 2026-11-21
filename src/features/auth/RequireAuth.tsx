import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { identityApiUrl } from '@/api/identityApi'
import { readAuthSession, subscribeAuthSession } from '@/auth/session'
import { AccessDeniedPage } from '@/features/auth/AccessDeniedPage'
import { navGroups, navItemVisible } from '@/components/layout/Sidebar'
import { useStore } from '@/store/hooks'

function routeAllowed(pathname: string, state: ReturnType<typeof useStore>) {
  if (pathname === '/settings/password') return true
  const items = navGroups.flatMap((group) => group.items)
  const match = items
    .slice()
    .sort((left, right) => right.to.length - left.to.length)
    .find((item) => item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`))
  if (!match) return true
  return navItemVisible(state, match)
}

export function RequireAuth() {
  const location = useLocation()
  const state = useStore()
  const [, setTick] = useState(0)
  useEffect(() => subscribeAuthSession(() => setTick((value) => value + 1)), [])

  if (!identityApiUrl()) return <Outlet />
  const session = readAuthSession()
  if (!session) {
    const suffix = location.pathname !== '/login' ? '?reason=expired' : ''
    return <Navigate to={`/login${location.pathname === '/login' ? '' : suffix}`} replace />
  }
  if (session.mustChange && location.pathname !== '/login/first-password') {
    return <Navigate to="/login/first-password" replace />
  }
  if (!session.mustChange && location.pathname === '/login/first-password') {
    return <Navigate to="/" replace />
  }
  if (!routeAllowed(location.pathname, state)) return <AccessDeniedPage />
  return <Outlet />
}

export function RequireGuest() {
  const [, setTick] = useState(0)
  useEffect(() => subscribeAuthSession(() => setTick((value) => value + 1)), [])
  if (!identityApiUrl()) return <Outlet />
  const session = readAuthSession()
  if (session?.mustChange) return <Navigate to="/login/first-password" replace />
  if (session) return <Navigate to="/" replace />
  return <Outlet />
}
