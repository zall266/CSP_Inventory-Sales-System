import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import type {
  DocumentAuditLog,
  ImportBatch,
  ImportFile,
  InventoryRow,
  Sale,
  SalesImportAccount,
  SalesImportLine,
  SalesImportMapping,
  SalesImportOrder,
  SalesImportShipment,
  StockMovement,
} from '@/types'

export type SalesImportSlice = {
  salesImportAccounts: SalesImportAccount[]
  salesImportBatches: ImportBatch[]
  salesImportFiles: ImportFile[]
  salesImportOrders: SalesImportOrder[]
  salesImportLines: SalesImportLine[]
  salesImportMappings: SalesImportMapping[]
  salesImportShipments: SalesImportShipment[]
  sales?: Sale[]
  documentAuditLogs?: DocumentAuditLog[]
  inventory?: InventoryRow[]
  stockMovements?: StockMovement[]
}

type SyncOptions = {
  apply: (slice: SalesImportSlice) => void
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

function sliceFrom(data: Partial<SalesImportSlice> | null): SalesImportSlice | null {
  if (!data || !Array.isArray(data.salesImportAccounts) || !Array.isArray(data.salesImportBatches)) return null
  return {
    salesImportAccounts: data.salesImportAccounts,
    salesImportBatches: data.salesImportBatches,
    salesImportFiles: Array.isArray(data.salesImportFiles) ? data.salesImportFiles : [],
    salesImportOrders: Array.isArray(data.salesImportOrders) ? data.salesImportOrders : [],
    salesImportLines: Array.isArray(data.salesImportLines) ? data.salesImportLines : [],
    salesImportMappings: Array.isArray(data.salesImportMappings) ? data.salesImportMappings : [],
    salesImportShipments: Array.isArray(data.salesImportShipments) ? data.salesImportShipments : [],
    sales: data.sales,
    documentAuditLogs: data.documentAuditLogs,
    inventory: data.inventory,
    stockMovements: data.stockMovements,
  }
}

const POSTING_ACTIONS = new Set(['salesImport.confirm'])

function needsIdempotency(action: string) {
  return POSTING_ACTIONS.has(action)
}

export function startSalesImportHydration(next: SyncOptions) {
  if (!identityApiUrl()) return
  options = next
  const seen = epoch
  void (async () => {
    try {
      const loaded = await postIdentityAction('salesImport.list', { actorUserId: options?.actorId() })
      if (epoch !== seen) return
      if (!loaded.ok) {
        next.onError(loaded.error?.message || 'Could not load sales import from the server.')
        return
      }
      const slice = sliceFrom(loaded.data as Partial<SalesImportSlice> | null)
      if (slice) options?.apply(slice)
    } catch (error) {
      next.onError(error instanceof Error ? error.message : 'Could not load sales import from the server.')
    } finally {
      if (epoch === seen) {
        ready = true
        const queued = pending.splice(0, pending.length)
        queued.forEach((item) => queueSalesImportWrite(item.action, item.payload, item.idempotencyKey))
      }
    }
  })()
}

export function queueSalesImportWrite(action: string, payload: Record<string, unknown>, idempotencyKey?: string) {
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
        options?.onError(result.error?.message || 'Could not save the sales import to the server.')
        return
      }
      const data = result.data as Record<string, unknown>
      const slice = sliceFrom(data as Partial<SalesImportSlice>)
      if (slice) options?.apply(slice)
      options?.onSaved(action, payload, data)
    } catch {
      if (epoch === seen) options?.onError('Could not save the sales import to the server.')
    } finally {
      if (epoch === seen) options?.onSettled()
    }
  })()
}
