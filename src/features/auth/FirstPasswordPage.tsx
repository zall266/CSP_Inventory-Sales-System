import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { postIdentityAction } from '@/api/identityApi'
import { passwordPolicyMessage } from '@/auth/passwordPolicy'
import { clearAuthSession, readAuthSession, writeAuthSession } from '@/auth/session'
import { Button, Field, Input } from '@/components/ui'

export function FirstPasswordPage() {
  const navigate = useNavigate()
  const session = readAuthSession()
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const policy = passwordPolicyMessage(password, session?.username)
    if (policy) {
      setError(policy)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await postIdentityAction('auth.changePassword', {
        currentPassword,
        newPassword: password,
      })
      if (!result.ok) {
        setError(result.error?.message || 'Could not change password.')
        setCurrentPassword('')
        setPassword('')
        setConfirm('')
        return
      }
      if (session) writeAuthSession({ ...session, mustChange: false })
      setCurrentPassword('')
      setPassword('')
      setConfirm('')
      navigate('/', { replace: true })
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f3f5f9] px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold text-slate-900">Create your password</h1>
        <p className="mt-1 text-sm text-slate-500">
          Enter the temporary password from your Owner, then choose a new password. The temporary password is not stored in this browser.
        </p>
        {error && <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <form className="mt-5 space-y-4" onSubmit={onSubmit}>
          <Field label="Temporary password">
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>
          <Field label="New password">
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label="Confirm new password">
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </Field>
          <button type="button" className="text-xs font-medium text-indigo-600" onClick={() => setShowPassword((value) => !value)}>
            {showPassword ? 'Hide passwords' : 'Show passwords'}
          </button>
          <Button className="w-full" type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Save password'}</Button>
          <Button
            className="w-full"
            type="button"
            variant="secondary"
            onClick={() => {
              clearAuthSession()
              navigate('/login', { replace: true })
            }}
          >
            Cancel and sign out
          </Button>
        </form>
      </div>
    </div>
  )
}
