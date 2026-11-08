import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import type {
  Batch,
  DisplayStock,
  InventoryRow,
  PackingAssembly,
  ProductionBalance,
  ProductionOrder,
  ProductionSession,
  StockMovement,
} from '@/types'
import { hydratePackingAssemblies } from '@/features/manufacturing/packingModel'

export type ManufacturingSlice = {
  packingAssemblies: PackingAssembly[]
  productionOrders: ProductionOrder[]
  batches: Batch[]
  inventory?: InventoryRow[]
  stockMovements?: StockMovement[]
  productionSessions?: ProductionSession[]
  displayStocks?: DisplayStock[]
  productionBalances?: ProductionBalance[]
}

type SyncOptions = {
  apply: (slice: ManufacturingSlice) => void
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
let ready = false
let inflight = false
const pending: PendingWrite[] = []

const IDEMPOTENT_ACTIONS = new Set([
  'packing.create',
  'packing.confirm',
  'productionOrders.create',
  'productionOrders.complete',
  'sessions.create',
  'sessions.complete',
  'sessions.editCompleted',
  'sessions.editCompletedClosing',
])

function sliceFrom(data: Partial<ManufacturingSlice> | null): ManufacturingSlice | null {
  if (!data || !Array.isArray(data.packingAssemblies) || !Array.isArray(data.productionOrders)) return null
  return {
    packingAssemblies: hydratePackingAssemblies(data.packingAssemblies),
    productionOrders: data.productionOrders,
    batches: Array.isArray(data.batches) ? data.batches : [],
    inventory: data.inventory,
    stockMovements: data.stockMovements,
    productionSessions: Array.isArray(data.productionSessions) ? data.productionSessions : undefined,
    displayStocks: Array.isArray(data.displayStocks) ? data.displayStocks : undefined,
    productionBalances: Array.isArray(data.productionBalances) ? data.productionBalances : undefined,
  }
}

function pump() {
  if (!options || !ready || inflight) return
  const item = pending.shift()
  if (!item) return
  inflight = true
  const actorUserId = options.actorId()
  const rawKey = item.idempotencyKey ?? item.payload.idempotencyKey
  const key = typeof rawKey === 'string' ? rawKey : IDEMPOTENT_ACTIONS.has(item.action) ? crypto.randomUUID() : undefined
  const body: Record<string, unknown> = { ...item.payload, actorUserId }
  delete body.idempotencyKey
  void (async () => {
    try {
      const result = await postIdentityAction(item.action, body, key)
      if (!result.ok || !result.data) {
        options?.onError(result.error?.message || 'Could not save manufacturing to the server.')
        return
      }
      const data = result.data as Record<string, unknown>
      const slice = sliceFrom(data as Partial<ManufacturingSlice>)
      if (slice) options?.apply(slice)
      options?.onSaved(item.action, item.payload, data)
    } catch {
      options?.onError('Could not save manufacturing to the server.')
    } finally {
      inflight = false
      options?.onSettled()
      pump()
    }
  })()
}

export function startManufacturingHydration(next: SyncOptions) {
  if (!identityApiUrl()) return
  options = next
  void (async () => {
    try {
      const loaded = await postIdentityAction('packing.list', { actorUserId: options?.actorId() })
      if (!loaded.ok) {
        next.onError(loaded.error?.message || 'Could not load manufacturing from the server.')
        return
      }
      const slice = sliceFrom(loaded.data as Partial<ManufacturingSlice> | null)
      if (slice) options?.apply(slice)
    } catch (error) {
      next.onError(error instanceof Error ? error.message : 'Could not load manufacturing from the server.')
    } finally {
      ready = true
      pump()
    }
  })()
}

export function queueManufacturingWrite(action: string, payload: Record<string, unknown>, idempotencyKey?: string) {
  if (!identityApiUrl() || !options) return
  pending.push({ action, payload, idempotencyKey })
  pump()
}
