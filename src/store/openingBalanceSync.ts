import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import type {
  DisplayStock,
  InventoryRow,
  OpeningBalance,
  PlacementLog,
  ProductionBalance,
  SlotOccupancy,
  StockMovement,
  StorageSlot,
} from '@/types'

export type OpeningBalanceSlice = {
  openingBalances: OpeningBalance[]
  inventory?: InventoryRow[]
  stockMovements?: StockMovement[]
  displayStocks?: DisplayStock[]
  productionBalances?: ProductionBalance[]
  storageSlots?: StorageSlot[]
  slotOccupancies?: SlotOccupancy[]
  placementLogs?: PlacementLog[]
}

type SyncOptions = {
  apply: (slice: OpeningBalanceSlice) => void
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
const confirmAfterSave = new Set<string>()

export function markOpeningBalanceConfirmAfterSave(clientId: string) {
  confirmAfterSave.add(clientId)
}

function sliceFrom(data: Partial<OpeningBalanceSlice> | null): OpeningBalanceSlice | null {
  if (!data || !Array.isArray(data.openingBalances)) return null
  return {
    openingBalances: data.openingBalances,
    inventory: data.inventory,
    stockMovements: data.stockMovements,
    displayStocks: data.displayStocks,
    productionBalances: data.productionBalances,
    storageSlots: data.storageSlots,
    slotOccupancies: data.slotOccupancies,
    placementLogs: data.placementLogs,
  }
}

export function startOpeningBalanceHydration(next: SyncOptions) {
  if (!identityApiUrl()) return
  options = next
  const seen = epoch
  void (async () => {
    try {
      const loaded = await postIdentityAction('openingBalances.list', { actorUserId: options?.actorId() })
      if (epoch !== seen) return
      if (!loaded.ok) {
        next.onError(loaded.error?.message || 'Could not load opening balance documents from the server.')
        return
      }
      const slice = sliceFrom(loaded.data as Partial<OpeningBalanceSlice> | null)
      if (slice) options?.apply(slice)
    } catch (error) {
      next.onError(error instanceof Error ? error.message : 'Could not load opening balance documents from the server.')
    } finally {
      if (epoch === seen) {
        ready = true
        const queued = pending.splice(0, pending.length)
        queued.forEach((item) => queueOpeningBalanceWrite(item.action, item.payload, item.idempotencyKey))
      }
    }
  })()
}

export function queueOpeningBalanceWrite(action: string, payload: Record<string, unknown>, idempotencyKey?: string) {
  if (!identityApiUrl() || !options) return
  if (!ready) {
    pending.push({ action, payload, idempotencyKey })
    return
  }
  epoch += 1
  const seen = epoch
  const actorUserId = options.actorId()
  const key = idempotencyKey || (action === 'openingBalances.confirm' ? crypto.randomUUID() : undefined)
  const body: Record<string, unknown> = { ...payload, actorUserId }
  void (async () => {
    try {
      const result = await postIdentityAction(action, body, key)
      if (epoch !== seen) return
      if (!result.ok || !result.data) {
        options?.onError(result.error?.message || 'Could not save opening balance to the server.')
        return
      }
      const data = result.data as Record<string, unknown>
      const slice = sliceFrom(data as Partial<OpeningBalanceSlice>)
      if (slice) options?.apply(slice)
      options?.onSaved(action, payload, data)
      if (action === 'openingBalances.save' || action === 'openingBalances.update') {
        const saved = data.openingBalance as OpeningBalance | undefined
        const clientId = text(payload.clientId)
        if (saved && clientId && confirmAfterSave.has(clientId)) {
          confirmAfterSave.delete(clientId)
          queueOpeningBalanceWrite('openingBalances.confirm', { id: saved.id }, crypto.randomUUID())
        }
      }
    } catch {
      if (epoch === seen) options?.onError('Could not save opening balance to the server.')
    } finally {
      if (epoch === seen) options?.onSettled()
    }
  })()
}

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value)
}
