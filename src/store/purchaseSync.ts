import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import type { InventoryRow, Payment, Purchase, PurchaseReturn, StockMovement } from '@/types'

export type PurchaseSlice = {
  purchases: Purchase[]
  purchaseReturns: PurchaseReturn[]
  payments: Payment[]
  inventory?: InventoryRow[]
  stockMovements?: StockMovement[]
}

type SyncOptions = {
  apply: (slice: PurchaseSlice) => void
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

function sliceFrom(data: Partial<PurchaseSlice> | null): PurchaseSlice | null {
  if (!data || !Array.isArray(data.purchases)) return null
  return {
    purchases: data.purchases,
    purchaseReturns: Array.isArray(data.purchaseReturns) ? data.purchaseReturns : [],
    payments: Array.isArray(data.payments) ? data.payments : [],
    inventory: data.inventory,
    stockMovements: data.stockMovements,
  }
}

const POSTING_ACTIONS = new Set([
  'purchases.create',
  'purchases.receive',
  'purchases.recordPayment',
  'purchaseReturns.create',
])

function needsIdempotency(action: string, payload: Record<string, unknown>) {
  if (action === 'purchases.create') return Boolean(payload.receive)
  return POSTING_ACTIONS.has(action)
}

export function startPurchaseHydration(next: SyncOptions) {
  if (!identityApiUrl()) return
  options = next
  const seen = epoch
  void (async () => {
    try {
      const loaded = await postIdentityAction('purchases.list', { actorUserId: options?.actorId() })
      if (epoch !== seen) return
      if (!loaded.ok) {
        next.onError(loaded.error?.message || 'Could not load purchases from the server.')
        return
      }
      const slice = sliceFrom(loaded.data as Partial<PurchaseSlice> | null)
      if (slice) options?.apply(slice)
    } catch (error) {
      next.onError(error instanceof Error ? error.message : 'Could not load purchases from the server.')
    } finally {
      if (epoch === seen) {
        ready = true
        const queued = pending.splice(0, pending.length)
        queued.forEach((item) => queuePurchaseWrite(item.action, item.payload, item.idempotencyKey))
      }
    }
  })()
}

export function queuePurchaseWrite(action: string, payload: Record<string, unknown>, idempotencyKey?: string) {
  if (!identityApiUrl() || !options) return
  if (!ready) {
    pending.push({ action, payload, idempotencyKey })
    return
  }
  epoch += 1
  const seen = epoch
  const actorUserId = options.actorId()
  const key = idempotencyKey || (needsIdempotency(action, payload) ? crypto.randomUUID() : undefined)
  const body: Record<string, unknown> = { ...payload, actorUserId }
  void (async () => {
    try {
      const result = await postIdentityAction(action, body, key)
      if (epoch !== seen) return
      if (!result.ok || !result.data) {
        options?.onError(result.error?.message || 'Could not save purchase to the server.')
        return
      }
      const data = result.data as Record<string, unknown>
      const slice = sliceFrom(data as Partial<PurchaseSlice>)
      if (slice) options?.apply(slice)
      options?.onSaved(action, payload, data)
    } catch {
      if (epoch === seen) options?.onError('Could not save purchase to the server.')
    } finally {
      if (epoch === seen) options?.onSettled()
    }
  })()
}
