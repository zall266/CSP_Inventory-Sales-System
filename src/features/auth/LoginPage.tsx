import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import { proofForUsername } from '@/auth/passwordRequest'
import { sessionFromLoginData, writeAuthSession } from '@/auth/session'
import { brand } from '@/brand'
import { Button, Field, Input } from '@/components/ui'

type Status = {
  identityReady: boolean
  needsOwnerBootstrap: boolean
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const expired = new URLSearchParams(location.search).get('reason') === 'expired'
  const configured = Boolean(identityApiUrl())
  const [status, setStatus] = useState<Status | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(expired ? 'Your session has expired. Please sign in again.' : '')

  useEffect(() => {
    if (!configured) return
    void postIdentityAction('auth.status', {}).then((result) => {
      if (!result.ok || !result.data) {
        setError(result.error?.message || 'Could not reach the server.')
        return
      }
      setStatus(result.data as Status)
    }).catch(() => {
      setError('Could not reach the server.')
    })
  }, [configured])

  const bootstrap = Boolean(status?.needsOwnerBootstrap)
  const blocked = Boolean(configured && status && (!status.identityReady || status.needsOwnerBootstrap))

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || blocked) return
    setError('')
    setBusy(true)
    try {
      const result = await postIdentityAction('auth.login', {
        username: username.trim(),
        ...(await proofForUsername(username.trim(), password)),
      })
      if (!result.ok || !result.data) {
        setError(result.error?.message || 'Sign in failed.')
        setPassword('')
        return
      }
      const session = sessionFromLoginData(result.data as Parameters<typeof sessionFromLoginData>[0])
      if (!session) {
        setError('Sign in failed.')
        return
      }
      writeAuthSession(session)
      navigate(session.mustChange ? '/login/first-password' : '/', { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setError(message.includes('hashing') || message.includes('work factor') ? message : 'Could not reach the server.')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f3f5f9] px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">
            {brand.productInitials}
          </div>
          <div>
            <div className="text-base font-semibold text-slate-900">{brand.name}</div>
            <div className="text-xs text-slate-400">{brand.subtitle}</div>
          </div>
        </div>
        <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Use your staff username and password.</p>
        {!configured && (
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This browser build is not connected to the DEV API. Local demo data is available without a server login.
          </p>
        )}
        {blocked && (
          <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {bootstrap
              ? 'Owner credentials are not initialized. Complete the owner-controlled enrollment procedure before signing in.'
              : 'Identity is not initialized. Ask the owner to complete identity setup before creating passwords.'}
          </p>
        )}
        {error && <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <form className="mt-5 space-y-4" onSubmit={onSubmit}>
          <Field label="Username">
            <Input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="name@company.com"
            />
          </Field>
          <Field label="Password">
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-2 text-xs font-medium text-indigo-600"
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>
          <Button className="w-full" type="submit" disabled={busy || Boolean(blocked) || !configured}>
            {busy ? 'Please wait…' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-4 text-xs text-slate-400">
          Password reset is Owner-controlled. There is no public email reset.{' '}
          <Link className="text-indigo-600" to="/login">Ask an Owner if you need a new password.</Link>
        </p>
      </div>
    </div>
  )
}
