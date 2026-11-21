import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { postIdentityAction } from '@/api/identityApi'
import { passwordPolicyMessage } from '@/auth/passwordPolicy'
import { readAuthSession } from '@/auth/session'
import { Button, Field, Input, PageHeader } from '@/components/ui'

export function ChangePasswordPage() {
  const navigate = useNavigate()
  const session = readAuthSession()
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

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
        return
      }
      setCurrentPassword('')
      setPassword('')
      setConfirm('')
      setDone(true)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="Change password" subtitle="Use a unique password. Other sessions on this account will be signed out." />
      {done && <div className="mb-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Password updated.</div>}
      {error && <div className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      <form className="max-w-md space-y-4" onSubmit={onSubmit}>
        <Field label="Current password">
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
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Update password'}</Button>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>Back</Button>
        </div>
      </form>
    </div>
  )
}
