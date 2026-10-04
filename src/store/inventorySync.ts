import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import type { InventoryRow, StockMovement } from '@/types'

type InventorySlice = {
  inventory: InventoryRow[]
  stockMovements: StockMovement[]
}

type SyncOptions = {
  apply: (slice: InventorySlice) => void
  actorId: () => string
  onError: (message: string) => void
  onSaved: (action: string, payload: Record<string, unknown>, data: Record<string, unknown>) => void
  onSettled: () => void
}

type PendingWrite = {
  action: string
  payload: Record<string, unknown>
}

let options: SyncOptions | null = null
let epoch = 0
let ready = false
const pending: PendingWrite[] = []

function sliceFrom(data: { inventory?: InventoryRow[]; stockMovements?: StockMovement[] } | null): InventorySlice | null {
  if (!data || !Array.isArray(data.inventory) || !Array.isArray(data.stockMovements)) return null
  return { inventory: data.inventory, stockMovements: data.stockMovements }
}

export function startInventoryHydration(next: SyncOptions) {
  if (!identityApiUrl()) return
  options = next
  const seen = epoch
  void (async () => {
    try {
      const loaded = await postIdentityAction('inventory.get', { actorUserId: options?.actorId() })
      if (epoch !== seen) return
      if (!loaded.ok) {
        next.onError(loaded.error?.message || 'Could not load inventory from the server.')
        return
      }
      const slice = sliceFrom(loaded.data as InventorySlice | null)
      if (slice) options?.apply(slice)
    } catch (error) {
      next.onError(error instanceof Error ? error.message : 'Could not load inventory from the server.')
    } finally {
      if (epoch === seen) {
        ready = true
        const queued = pending.splice(0, pending.length)
        queued.forEach((item) => queueInventoryWrite(item.action, item.payload))
      }
    }
  })()
}

export function refreshInventory() {
  if (!identityApiUrl() || !options || !ready) return
  epoch += 1
  const seen = epoch
  void (async () => {
    try {
      const loaded = await postIdentityAction('inventory.get', { actorUserId: options?.actorId() })
      if (epoch !== seen || !loaded.ok) return
      const slice = sliceFrom(loaded.data as InventorySlice | null)
      if (slice) options?.apply(slice)
    } catch {
      /* Keep the last server snapshot when a refresh fails. */
    }
  })()
}

export function queueInventoryWrite(action: string, payload: Record<string, unknown>) {
  if (!identityApiUrl() || !options) return
  if (!ready) {
    pending.push({ action, payload })
    return
  }
  epoch += 1
  const seen = epoch
  const actorUserId = options.actorId()
  const rawKey = payload.idempotencyKey
  const idempotencyKey = typeof rawKey === 'string' ? rawKey : crypto.randomUUID()
  const body: Record<string, unknown> = { ...payload, actorUserId }
  delete body.idempotencyKey
  void (async () => {
    try {
      const result = await postIdentityAction(action, body, idempotencyKey)
      if (epoch !== seen) return
      if (!result.ok || !result.data) {
        options?.onError(result.error?.message || 'Could not save to the server.')
        return
      }
      const data = result.data as unknown as InventorySlice & Record<string, unknown>
      const slice = sliceFrom(data)
      if (slice) options?.apply(slice)
      options?.onSaved(action, payload, data)
    } catch {
      if (epoch === seen) options?.onError('Could not save to the server.')
    } finally {
      if (epoch === seen) options?.onSettled()
    }
  })()
}
