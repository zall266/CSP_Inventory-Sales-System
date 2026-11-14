import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import type {
  DispatchRecord,
  DocumentAuditLog,
  InspectionGroup,
  InventoryRow,
  StockMovement,
  Vehicle,
} from '@/types'

export type DispatchSlice = {
  vehicles: Vehicle[]
  dispatches: DispatchRecord[]
  inspectionGroups: InspectionGroup[]
  documentAuditLogs?: DocumentAuditLog[]
  inventory?: InventoryRow[]
  stockMovements?: StockMovement[]
}

type SyncOptions = {
  apply: (slice: DispatchSlice) => void
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

function sliceFrom(data: Partial<DispatchSlice> | null): DispatchSlice | null {
  if (!data || !Array.isArray(data.vehicles) || !Array.isArray(data.dispatches)) return null
  return {
    vehicles: data.vehicles,
    dispatches: data.dispatches,
    inspectionGroups: Array.isArray(data.inspectionGroups) ? data.inspectionGroups : [],
    documentAuditLogs: data.documentAuditLogs,
    inventory: data.inventory,
    stockMovements: data.stockMovements,
  }
}

const POSTING_ACTIONS = new Set([
  'dispatch.confirm',
  'dispatch.void',
  'dispatch.createInspectionGroup',
  'dispatch.release',
])

function needsIdempotency(action: string) {
  return POSTING_ACTIONS.has(action)
}

export function startDispatchHydration(next: SyncOptions) {
  if (!identityApiUrl()) return
  options = next
  const seen = epoch
  void (async () => {
    try {
      const loaded = await postIdentityAction('dispatch.list', { actorUserId: options?.actorId() })
      if (epoch !== seen) return
      if (!loaded.ok) {
        next.onError(loaded.error?.message || 'Could not load dispatch from the server.')
        return
      }
      const slice = sliceFrom(loaded.data as Partial<DispatchSlice> | null)
      if (slice) options?.apply(slice)
    } catch (error) {
      next.onError(error instanceof Error ? error.message : 'Could not load dispatch from the server.')
    } finally {
      if (epoch === seen) {
        ready = true
        const queued = pending.splice(0, pending.length)
        queued.forEach((item) => queueDispatchWrite(item.action, item.payload, item.idempotencyKey))
      }
    }
  })()
}

export function queueDispatchWrite(action: string, payload: Record<string, unknown>, idempotencyKey?: string) {
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
        options?.onError(result.error?.message || 'Could not save the dispatch to the server.')
        return
      }
      const data = result.data as Record<string, unknown>
      const slice = sliceFrom(data as Partial<DispatchSlice>)
      if (slice) options?.apply(slice)
      options?.onSaved(action, payload, data)
    } catch {
      if (epoch === seen) options?.onError('Could not save the dispatch to the server.')
    } finally {
      if (epoch === seen) options?.onSettled()
    }
  })()
}
