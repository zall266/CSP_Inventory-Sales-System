import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import type {
  BalanceUsageLog,
  DisplayStock,
  PlacementLog,
  ProductionBalance,
  SlotOccupancy,
  StorageLocation,
  StorageSlot,
} from '@/types'

export type WarehouseSlice = {
  storageLocations: StorageLocation[]
  storageSlots: StorageSlot[]
  slotOccupancies: SlotOccupancy[]
  displayStocks: DisplayStock[]
  placementLogs: PlacementLog[]
  productionBalances: ProductionBalance[]
  balanceUsageLogs: BalanceUsageLog[]
}

type SyncOptions = {
  apply: (slice: WarehouseSlice) => void
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

function sliceFrom(data: Partial<WarehouseSlice> | null): WarehouseSlice | null {
  if (!data) return null
  if (!Array.isArray(data.storageLocations) || !Array.isArray(data.storageSlots)) return null
  if (!Array.isArray(data.slotOccupancies) || !Array.isArray(data.displayStocks)) return null
  if (!Array.isArray(data.placementLogs) || !Array.isArray(data.productionBalances)) return null
  if (!Array.isArray(data.balanceUsageLogs)) return null
  return {
    storageLocations: data.storageLocations,
    storageSlots: data.storageSlots,
    slotOccupancies: data.slotOccupancies,
    displayStocks: data.displayStocks,
    placementLogs: data.placementLogs,
    productionBalances: data.productionBalances,
    balanceUsageLogs: data.balanceUsageLogs,
  }
}

async function loadMap(actorUserId: string) {
  const loaded = await postIdentityAction('warehouse.get', { actorUserId })
  if (!loaded.ok || !loaded.data) return loaded
  const first = sliceFrom(loaded.data as Partial<WarehouseSlice>)
  if (first && first.storageLocations.length > 0) return loaded
  const boot = await postIdentityAction('warehouse.bootstrap', { actorUserId })
  if (!boot.ok && boot.error?.code !== 'CONFLICT') return boot
  return postIdentityAction('warehouse.get', { actorUserId })
}

export function startWarehouseHydration(next: SyncOptions) {
  if (!identityApiUrl()) return
  options = next
  const seen = epoch
  void (async () => {
    try {
      const loaded = await loadMap(options?.actorId() || '')
      if (epoch !== seen) return
      if (!loaded.ok) {
        next.onError(loaded.error?.message || 'Could not load the warehouse map from the server.')
        return
      }
      const slice = sliceFrom(loaded.data as Partial<WarehouseSlice> | null)
      if (slice) options?.apply(slice)
    } catch (error) {
      next.onError(error instanceof Error ? error.message : 'Could not load the warehouse map from the server.')
    } finally {
      if (epoch === seen) {
        ready = true
        const queued = pending.splice(0, pending.length)
        queued.forEach((item) => queueWarehouseWrite(item.action, item.payload))
      }
    }
  })()
}

export function refreshWarehouse() {
  if (!identityApiUrl() || !options || !ready) return
  epoch += 1
  const seen = epoch
  void (async () => {
    try {
      const loaded = await postIdentityAction('warehouse.get', { actorUserId: options?.actorId() })
      if (epoch !== seen || !loaded.ok) return
      const slice = sliceFrom(loaded.data as Partial<WarehouseSlice> | null)
      if (slice) options?.apply(slice)
    } catch {
      /* Keep the last server snapshot when a refresh fails. */
    }
  })()
}

export function queueWarehouseWrite(action: string, payload: Record<string, unknown>) {
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
      const data = result.data as unknown as WarehouseSlice & Record<string, unknown>
      const slice = sliceFrom(data)
      if (slice) options?.apply(slice)
      options?.onSaved(action, payload, data as unknown as Record<string, unknown>)
    } catch {
      if (epoch === seen) options?.onError('Could not save to the server.')
    } finally {
      if (epoch === seen) options?.onSettled()
    }
  })()
}
