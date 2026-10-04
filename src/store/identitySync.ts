import { identityApiUrl, postIdentityAction, type IdentitySlice } from '@/api/identityApi'
import { createSeedData } from '@/data/seed'
import type { Settings } from '@/types'

type SyncOptions = {
  apply: (slice: IdentitySlice) => void
  actorId: () => string
  settings: () => Settings
  onError: (message: string) => void
}

let options: SyncOptions | null = null
let epoch = 0
let settingsTimer: ReturnType<typeof setTimeout> | undefined
let settingsPatch: Partial<Settings> = {}
let settingsBusy = false

function sliceFrom(data: { users?: IdentitySlice['users']; roles?: IdentitySlice['roles']; departments?: IdentitySlice['departments']; settings?: Settings | null; userAuditLogs?: IdentitySlice['userAuditLogs']; empty?: boolean } | null): IdentitySlice | null {
  if (!data || data.empty || !data.settings || !data.users || !data.roles || !data.departments) return null
  return {
    users: data.users,
    roles: data.roles,
    departments: data.departments,
    settings: data.settings,
    userAuditLogs: data.userAuditLogs ?? [],
  }
}

function applyServerSlice(slice: IdentitySlice) {
  if (!options) return
  const pendingSettings = settingsBusy || Object.keys(settingsPatch).length > 0
  options.apply(pendingSettings ? { ...slice, settings: options.settings() } : slice)
}

export function startIdentityHydration(next: SyncOptions) {
  if (!identityApiUrl()) return
  options = next
  const seen = epoch
  void (async () => {
    try {
      const loaded = await postIdentityAction('identity.get', {})
      if (epoch !== seen || !loaded.ok) return
      if (loaded.data?.empty) {
        const seed = createSeedData()
        const boot = await postIdentityAction('identity.bootstrap', {
          users: seed.users,
          roles: seed.roles,
          departments: seed.departments,
          settings: seed.settings,
          userAuditLogs: seed.userAuditLogs ?? [],
        })
        if (epoch !== seen || !boot.ok) return
        const slice = sliceFrom(boot.data)
        if (slice) applyServerSlice(slice)
        return
      }
      const slice = sliceFrom(loaded.data)
      if (slice) applyServerSlice(slice)
    } catch {
      next.onError('Could not load identity from the server.')
    }
  })()
}

export function queueIdentityWrite(action: string, payload: Record<string, unknown>) {
  if (!identityApiUrl() || !options) return
  epoch += 1
  const seen = epoch
  const actorUserId = options.actorId()
  void (async () => {
    try {
      const result = await postIdentityAction(action, { ...payload, actorUserId })
      if (epoch !== seen) return
      if (!result.ok || !result.data) {
        options?.onError(result.error?.message || 'Could not save to the server.')
        return
      }
      const slice = sliceFrom(result.data)
      if (slice) applyServerSlice(slice)
    } catch {
      if (epoch === seen) options?.onError('Could not save to the server.')
    }
  })()
}

export function queueSettingsPatch(patch: Partial<Settings>) {
  if (!identityApiUrl() || !options) return
  epoch += 1
  settingsPatch = { ...settingsPatch, ...patch }
  if (settingsTimer) clearTimeout(settingsTimer)
  settingsTimer = setTimeout(() => {
    const body = settingsPatch
    settingsPatch = {}
    settingsBusy = true
    const actorUserId = options?.actorId() ?? ''
    void postIdentityAction('settings.update', { actorUserId, patch: body })
      .then((result) => {
        if (!result.ok) options?.onError(result.error?.message || 'Could not save to the server.')
      })
      .catch(() => {
        options?.onError('Could not save to the server.')
      })
      .finally(() => {
        settingsBusy = false
      })
  }, 400)
}
