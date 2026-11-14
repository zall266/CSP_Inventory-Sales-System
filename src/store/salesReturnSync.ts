import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import type {
  DocumentAuditLog,
  InventoryRow,
  ProductionBalance,
  ReturnReason,
  ReturnSource,
  Sale,
  SalesReturn,
  StockMovement,
} from '@/types'

export type SalesReturnSlice = {
  salesReturns: SalesReturn[]
  returnSources: ReturnSource[]
  returnReasons: ReturnReason[]
  sales?: Sale[]
  documentAuditLogs?: DocumentAuditLog[]
  inventory?: InventoryRow[]
  stockMovements?: StockMovement[]
  productionBalances?: ProductionBalance[]
}

type SyncOptions = {
  apply: (slice: SalesReturnSlice) => void
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

function sliceFrom(data: Partial<SalesReturnSlice> | null): SalesReturnSlice | null {
  if (!data || !Array.isArray(data.salesReturns)) return null
  return {
    salesReturns: data.salesReturns,
    returnSources: Array.isArray(data.returnSources) ? data.returnSources : [],
    returnReasons: Array.isArray(data.returnReasons) ? data.returnReasons : [],
    sales: data.sales,
    documentAuditLogs: data.documentAuditLogs,
    inventory: data.inventory,
    stockMovements: data.stockMovements,
    productionBalances: data.productionBalances,
  }
}

const POSTING_ACTIONS = new Set(['salesReturns.confirm'])

function needsIdempotency(action: string) {
  return POSTING_ACTIONS.has(action)
}

export function startSalesReturnHydration(next: SyncOptions) {
  if (!identityApiUrl()) return
  options = next
  const seen = epoch
  void (async () => {
    try {
      const loaded = await postIdentityAction('salesReturns.list', { actorUserId: options?.actorId() })
      if (epoch !== seen) return
      if (!loaded.ok) {
        next.onError(loaded.error?.message || 'Could not load sales returns from the server.')
        return
      }
      const slice = sliceFrom(loaded.data as Partial<SalesReturnSlice> | null)
      if (slice) options?.apply(slice)
    } catch (error) {
      next.onError(error instanceof Error ? error.message : 'Could not load sales returns from the server.')
    } finally {
      if (epoch === seen) {
        ready = true
        const queued = pending.splice(0, pending.length)
        queued.forEach((item) => queueSalesReturnWrite(item.action, item.payload, item.idempotencyKey))
      }
    }
  })()
}

export function queueSalesReturnWrite(action: string, payload: Record<string, unknown>, idempotencyKey?: string) {
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
        options?.onError(result.error?.message || 'Could not save the sales return to the server.')
        return
      }
      const data = result.data as Record<string, unknown>
      const slice = sliceFrom(data as Partial<SalesReturnSlice>)
      if (slice) options?.apply(slice)
      options?.onSaved(action, payload, data)
    } catch {
      if (epoch === seen) options?.onError('Could not save the sales return to the server.')
    } finally {
      if (epoch === seen) options?.onSettled()
    }
  })()
}
