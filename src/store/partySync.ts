import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import { createSeedData } from '@/data/seed'
import type { Agent, Customer, CustomerWholesalePrice, Supplier, Warehouse } from '@/types'

type PartySlice = {
  customers?: Customer[]
  suppliers?: Supplier[]
  agents?: Agent[]
  customerWholesalePrices?: CustomerWholesalePrice[]
  warehouses?: Warehouse[]
}

type SyncOptions = {
  apply: (slice: PartySlice) => void
  actorId: () => string
  onError: (message: string) => void
  onSaved: (action: string, payload: Record<string, unknown>) => void
}

type PendingWrite = {
  action: string
  payload: Record<string, unknown>
}

let options: SyncOptions | null = null
let epoch = 0
let ready = false
const pending: PendingWrite[] = []

function sliceFrom(data: PartySlice | null): PartySlice | null {
  if (!data) return null
  const slice: PartySlice = {}
  if (Array.isArray(data.customers)) slice.customers = data.customers
  if (Array.isArray(data.suppliers)) slice.suppliers = data.suppliers
  if (Array.isArray(data.agents)) slice.agents = data.agents
  if (Array.isArray(data.customerWholesalePrices)) slice.customerWholesalePrices = data.customerWholesalePrices
  if (Array.isArray(data.warehouses)) slice.warehouses = data.warehouses
  return Object.keys(slice).length ? slice : null
}

export function startPartyHydration(next: SyncOptions) {
  if (!identityApiUrl()) return
  options = next
  const seen = epoch
  void (async () => {
    try {
      const loaded = await postIdentityAction('parties.get', { actorUserId: options?.actorId() })
      if (epoch !== seen || !loaded.ok) return
      const data = loaded.data as PartySlice | null
      const needsCustomers = !data?.customers?.length
      const needsSuppliers = !data?.suppliers?.length
      const needsPrices = !data?.customerWholesalePrices?.length
      if (needsCustomers || needsSuppliers || needsPrices) {
        const seed = createSeedData()
        const boot = await postIdentityAction('parties.bootstrap', {
          customers: needsCustomers ? seed.customers : [],
          suppliers: needsSuppliers ? seed.suppliers : [],
          customerWholesalePrices: needsPrices ? seed.customerWholesalePrices : [],
          agents: seed.agents,
          actorUserId: options?.actorId(),
        })
        if (epoch !== seen) return
        const slice = sliceFrom((boot.ok ? boot.data : null) as PartySlice | null)
        if (slice) {
          options?.apply(slice)
          return
        }
        const again = await postIdentityAction('parties.get', { actorUserId: options?.actorId() })
        if (epoch !== seen) return
        const existing = sliceFrom(again.ok ? (again.data as PartySlice | null) : null)
        if (existing) options?.apply(existing)
        else if (!boot.ok && boot.error?.code !== 'CONFLICT') {
          next.onError(boot.error?.message || 'Could not load customers and suppliers from the server.')
        }
      } else {
        const slice = sliceFrom(data)
        if (slice) options?.apply(slice)
      }
    } catch (error) {
      next.onError(error instanceof Error ? error.message : 'Could not load customers and suppliers from the server.')
    } finally {
      if (epoch === seen) {
        ready = true
        const queued = pending.splice(0, pending.length)
        queued.forEach((item) => queuePartyWrite(item.action, item.payload))
      }
    }
  })()
}

export function queuePartyWrite(action: string, payload: Record<string, unknown>) {
  if (!identityApiUrl() || !options) return
  if (!ready) {
    pending.push({ action, payload })
    return
  }
  epoch += 1
  const seen = epoch
  const actorUserId = options.actorId()
  void (async () => {
    try {
      const result = await postIdentityAction(action, { ...payload, actorUserId })
      if (epoch !== seen) return
      if (!result.ok || !result.data) {
        options?.onError(result.error?.message || 'Could not save to the server.')
        return
      }
      const slice = sliceFrom(result.data as PartySlice | null)
      if (slice) options?.apply(slice)
      options?.onSaved(action, payload)
    } catch {
      if (epoch === seen) options?.onError('Could not save to the server.')
    }
  })()
}
