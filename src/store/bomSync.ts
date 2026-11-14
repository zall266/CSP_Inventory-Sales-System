import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import type { Bom, CostSource } from '@/types'

export type BomCostRow = {
  id: string
  costPrice: number
  costSource: CostSource
}

export type BomSlice = {
  boms: Bom[]
  productCosts: BomCostRow[]
}

type SyncOptions = {
  apply: (slice: BomSlice) => void
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
let costsReady = false
const pending: PendingWrite[] = []

export function bomCostsReady() {
  return costsReady
}

export function markBomCostsReady() {
  costsReady = true
}

function sliceFrom(data: Partial<BomSlice> | null): BomSlice | null {
  if (!data || !Array.isArray(data.boms) || !Array.isArray(data.productCosts)) return null
  return { boms: data.boms, productCosts: data.productCosts }
}

async function loadBoms(actorUserId: string) {
  const loaded = await postIdentityAction('boms.list', { actorUserId })
  if (!loaded.ok || !loaded.data) return loaded
  const first = sliceFrom(loaded.data as Partial<BomSlice>)
  if (first && first.boms.length > 0) return loaded
  const boot = await postIdentityAction('boms.bootstrap', { actorUserId })
  if (!boot.ok && boot.error?.code !== 'CONFLICT') return boot
  return postIdentityAction('boms.list', { actorUserId })
}

export function startBomHydration(next: SyncOptions) {
  if (!identityApiUrl()) return
  options = next
  const seen = epoch
  void (async () => {
    try {
      const loaded = await loadBoms(options?.actorId() || '')
      if (epoch !== seen) return
      if (!loaded.ok) {
        next.onError(loaded.error?.message || 'Could not load recipes from the server.')
        return
      }
      const slice = sliceFrom(loaded.data as Partial<BomSlice> | null)
      if (slice) options?.apply(slice)
    } catch (error) {
      next.onError(error instanceof Error ? error.message : 'Could not load recipes from the server.')
    } finally {
      if (epoch === seen) {
        ready = true
        const queued = pending.splice(0, pending.length)
        queued.forEach((item) => queueBomWrite(item.action, item.payload))
      }
    }
  })()
}

export function queueBomWrite(action: string, payload: Record<string, unknown>) {
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
      const data = result.data as unknown as BomSlice & Record<string, unknown>
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
