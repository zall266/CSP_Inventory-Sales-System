import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import type { InventoryRow, Purchase, Receiving, StockMovement, StockOrder } from '@/types'

export type ReceivingSlice = {
  receivings: Receiving[]
  stockOrders: StockOrder[]
  inventory?: InventoryRow[]
  stockMovements?: StockMovement[]
  purchases?: Purchase[]
}

type SyncOptions = {
  apply: (slice: ReceivingSlice) => void
  actorId: () => string
  onError: (message: string) => void
  onSaved: (action: string, payload: Record<string, unknown>, data: Record<string, unknown>) => void
  onSettled: () => void
}

type PendingWrite = {
  action: string
  payload: Record<string, unknown>
  idempotencyKey?: string
}

let options: SyncOptions | null = null
let epoch = 0
let ready = false
const pending: PendingWrite[] = []

function sliceFrom(data: Partial<ReceivingSlice> | null): ReceivingSlice | null {
  if (!data || !Array.isArray(data.receivings)) return null
  return {
    receivings: data.receivings,
    stockOrders: Array.isArray(data.stockOrders) ? data.stockOrders : [],
    inventory: data.inventory,
    stockMovements: data.stockMovements,
    purchases: data.purchases,
  }
}

const IDEMPOTENT_ACTIONS = new Set(['receivings.create', 'receivings.linkPurchase'])

export function startReceivingHydration(next: SyncOptions) {
  if (!identityApiUrl()) return
  options = next
  const seen = epoch
  void (async () => {
    try {
      const loaded = await postIdentityAction('receivings.list', { actorUserId: options?.actorId() })
      if (epoch !== seen) return
      if (!loaded.ok) {
        next.onError(loaded.error?.message || 'Could not load receiving from the server.')
        return
      }
      const slice = sliceFrom(loaded.data as Partial<ReceivingSlice> | null)
      if (slice) options?.apply(slice)
    } catch (error) {
      next.onError(error instanceof Error ? error.message : 'Could not load receiving from the server.')
    } finally {
      if (epoch === seen) {
        ready = true
        const queued = pending.splice(0, pending.length)
        queued.forEach((item) => queueReceivingWrite(item.action, item.payload, item.idempotencyKey))
      }
    }
  })()
}

export function queueReceivingWrite(action: string, payload: Record<string, unknown>, idempotencyKey?: string) {
  if (!identityApiUrl() || !options) return
  if (!ready) {
    pending.push({ action, payload, idempotencyKey })
    return
  }
  epoch += 1
  const seen = epoch
  const actorUserId = options.actorId()
  const rawKey = idempotencyKey ?? payload.idempotencyKey
  const key = typeof rawKey === 'string' ? rawKey : IDEMPOTENT_ACTIONS.has(action) ? crypto.randomUUID() : undefined
  const body: Record<string, unknown> = { ...payload, actorUserId }
  delete body.idempotencyKey
  void (async () => {
    try {
      const result = await postIdentityAction(action, body, key)
      if (epoch !== seen) return
      if (!result.ok || !result.data) {
        options?.onError(result.error?.message || 'Could not save receiving to the server.')
        return
      }
      const data = result.data as Record<string, unknown>
      const slice = sliceFrom(data as Partial<ReceivingSlice>)
      if (slice) options?.apply(slice)
      options?.onSaved(action, payload, data)
    } catch {
      if (epoch === seen) options?.onError('Could not save receiving to the server.')
    } finally {
      if (epoch === seen) options?.onSettled()
    }
  })()
}
