import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import { createSeedData } from '@/data/seed'
import type { Category, Warehouse } from '@/types'

type MasterSlice = {
  warehouses: Warehouse[]
  categories: Category[]
}

type SyncOptions = {
  apply: (slice: MasterSlice) => void
  actorId: () => string
  onError: (message: string) => void
  onSaved: (action: string, payload: Record<string, unknown>) => void
}

type PendingWrite = {
  action: string
  payload: Record<string, unknown>
}

let options: SyncOptions | null = null
let epoch = 0
let ready = false
const pending: PendingWrite[] = []

function sliceFrom(data: { warehouses?: Warehouse[]; categories?: Category[] } | null): MasterSlice | null {
  if (!data || !Array.isArray(data.warehouses) || !Array.isArray(data.categories)) return null
  return { warehouses: data.warehouses, categories: data.categories }
}

export function startMasterHydration(next: SyncOptions) {
  if (!identityApiUrl()) return
  options = next
  const seen = epoch
  void (async () => {
    try {
      const loaded = await postIdentityAction('masters.get', {})
      if (epoch !== seen || !loaded.ok) return
      const data = loaded.data as { warehouses?: Warehouse[]; categories?: Category[] } | null
      const needsWarehouses = !data?.warehouses?.length
      const needsCategories = !data?.categories?.length
      if (needsWarehouses || needsCategories) {
        const seed = createSeedData()
        const boot = await postIdentityAction('masters.bootstrap', {
          warehouses: seed.warehouses,
          categories: seed.categories,
        })
        if (epoch !== seen) return
        const slice = sliceFrom((boot.ok ? boot.data : data) as { warehouses?: Warehouse[]; categories?: Category[] } | null)
        if (slice) options?.apply(slice)
      } else {
        const slice = sliceFrom(data)
        if (slice) options?.apply(slice)
      }
    } catch {
      next.onError('Could not load warehouses and categories from the server.')
    } finally {
      if (epoch === seen) {
        ready = true
        const queued = pending.splice(0, pending.length)
        queued.forEach((item) => queueMasterWrite(item.action, item.payload))
      }
    }
  })()
}

export function queueMasterWrite(action: string, payload: Record<string, unknown>) {
  if (!identityApiUrl() || !options) return
  if (!ready) {
    pending.push({ action, payload })
    return
  }
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
      const slice = sliceFrom(result.data as { warehouses?: Warehouse[]; categories?: Category[] } | null)
      if (slice) options?.apply(slice)
      options?.onSaved(action, payload)
    } catch {
      if (epoch === seen) options?.onError('Could not save to the server.')
    }
  })()
}
