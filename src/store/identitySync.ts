import { canHydrateFromServer, identityApiUrl, postIdentityAction, type IdentitySlice } from '@/api/identityApi'
import { canBootstrapFromRead, enqueueHydrate, hydrateRead, reportLoadError } from '@/store/hydrateQueue'
import type { Settings } from '@/types'

type SyncOptions = {
  apply: (slice: IdentitySlice) => void
  actorId: () => string
  settings: () => Settings
  onError: (message: string) => void
  onLoadError?: (message: string) => void
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
  options = next
  if (!canHydrateFromServer()) return
  const seen = epoch
  void enqueueHydrate(async () => {
    try {
      const loaded = await hydrateRead(postIdentityAction, 'identity.get', {})
      if (epoch !== seen) return
      if (!canBootstrapFromRead(loaded)) {
        if (!loaded.ok) reportLoadError(next, loaded.error?.message || 'Could not load identity from the server.')
        return
      }
      const payload = loaded.data as { empty?: boolean } | null
      if (payload?.empty) {
        reportLoadError(next, 'Identity is not initialized. Complete the owner-controlled setup procedure.')
        return
      }
      const slice = sliceFrom(loaded.data as Parameters<typeof sliceFrom>[0])
      if (slice) applyServerSlice(slice)
    } catch {
      reportLoadError(next, 'Could not load identity from the server.')
    }
  })
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
