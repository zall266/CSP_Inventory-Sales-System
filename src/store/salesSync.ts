import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import type { DeliveryOrder, DocumentAuditLog, InventoryRow, Payment, Quotation, Sale, StockMovement } from '@/types'

export type SalesSlice = {
  sales: Sale[]
  quotations: Quotation[]
  deliveryOrders: DeliveryOrder[]
  documentAuditLogs: DocumentAuditLog[]
  payments: Payment[]
  inventory?: InventoryRow[]
  stockMovements?: StockMovement[]
}

type SyncOptions = {
  apply: (slice: SalesSlice) => void
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

function sliceFrom(data: Partial<SalesSlice> | null): SalesSlice | null {
  if (!data || !Array.isArray(data.sales)) return null
  return {
    sales: data.sales,
    quotations: Array.isArray(data.quotations) ? data.quotations : [],
    deliveryOrders: Array.isArray(data.deliveryOrders) ? data.deliveryOrders : [],
    documentAuditLogs: Array.isArray(data.documentAuditLogs) ? data.documentAuditLogs : [],
    payments: Array.isArray(data.payments) ? data.payments : [],
    inventory: data.inventory,
    stockMovements: data.stockMovements,
  }
}

const POSTING_ACTIONS = new Set([
  'sales.create',
  'sales.createWholesale',
  'sales.void',
  'sales.recordPayment',
  'quotations.convert',
])

function needsIdempotency(action: string) {
  return POSTING_ACTIONS.has(action)
}

export function startSalesHydration(next: SyncOptions) {
  if (!identityApiUrl()) return
  options = next
  const seen = epoch
  void (async () => {
    try {
      const loaded = await postIdentityAction('sales.list', { actorUserId: options?.actorId() })
      if (epoch !== seen) return
      if (!loaded.ok) {
        next.onError(loaded.error?.message || 'Could not load sales from the server.')
        return
      }
      const slice = sliceFrom(loaded.data as Partial<SalesSlice> | null)
      if (slice) options?.apply(slice)
    } catch (error) {
      next.onError(error instanceof Error ? error.message : 'Could not load sales from the server.')
    } finally {
      if (epoch === seen) {
        ready = true
        const queued = pending.splice(0, pending.length)
        queued.forEach((item) => queueSalesWrite(item.action, item.payload, item.idempotencyKey))
      }
    }
  })()
}

export function queueSalesWrite(action: string, payload: Record<string, unknown>, idempotencyKey?: string) {
  if (!identityApiUrl() || !options) return
  if (!ready) {
    pending.push({ action, payload, idempotencyKey })
    return
  }
  epoch += 1
  const seen = epoch
  const actorUserId = options.actorId()
  const key = idempotencyKey || (needsIdempotency(action) ? crypto.randomUUID() : undefined)
  const body: Record<string, unknown> = { ...payload, actorUserId }
  void (async () => {
    try {
      const result = await postIdentityAction(action, body, key)
      if (epoch !== seen) return
      if (!result.ok || !result.data) {
        options?.onError(result.error?.message || 'Could not save the sales document to the server.')
        return
      }
      const data = result.data as Record<string, unknown>
      const slice = sliceFrom(data as Partial<SalesSlice>)
      if (slice) options?.apply(slice)
      options?.onSaved(action, payload, data)
    } catch {
      if (epoch === seen) options?.onError('Could not save the sales document to the server.')
    } finally {
      if (epoch === seen) options?.onSettled()
    }
  })()
}
