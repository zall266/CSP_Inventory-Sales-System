import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import { createSeedData } from '@/data/seed'
import { canBootstrapFromRead, enqueueHydrate, hydrateRead, reportLoadError } from '@/store/hydrateQueue'
import type { Product } from '@/types'

type ProductSlice = {
  products: Product[]
}

type SyncOptions = {
  apply: (slice: ProductSlice) => void
  actorId: () => string
  onError: (message: string) => void
  onLoadError?: (message: string) => void
  onSaved: (action: string, payload: Record<string, unknown>, products: Product[]) => void
}

type PendingWrite = {
  action: string
  payload: Record<string, unknown>
}

let options: SyncOptions | null = null
let epoch = 0
let ready = false
const pending: PendingWrite[] = []

function sliceFrom(data: { products?: Product[] } | null): ProductSlice | null {
  if (!data || !Array.isArray(data.products)) return null
  return { products: data.products }
}

async function ensureMasters() {
  const loaded = await hydrateRead(postIdentityAction, 'masters.get', {})
  const data = loaded.data as { warehouses?: unknown[]; categories?: unknown[] } | null
  if (canBootstrapFromRead(loaded) && data?.warehouses?.length && data?.categories?.length) return
  if (!canBootstrapFromRead(loaded)) {
    throw new Error(loaded.error?.message || 'Could not load warehouses and categories from the server.')
  }
  const seed = createSeedData()
  const boot = await postIdentityAction('masters.bootstrap', {
    warehouses: seed.warehouses,
    categories: seed.categories,
  })
  if (boot.ok) return
  const again = await hydrateRead(postIdentityAction, 'masters.get', {})
  const next = again.data as { warehouses?: unknown[]; categories?: unknown[] } | null
  if (!again.ok || !next?.warehouses?.length || !next?.categories?.length) {
    throw new Error(boot.error?.message || 'Could not load warehouses and categories from the server.')
  }
}

export function startProductHydration(next: SyncOptions) {
  if (!identityApiUrl()) return
  options = next
  const seen = epoch
  void enqueueHydrate(async () => {
    try {
      await ensureMasters()
      if (epoch !== seen) return
      const loaded = await hydrateRead(postIdentityAction, 'products.list', {})
      if (epoch !== seen) return
      if (!canBootstrapFromRead(loaded)) {
        reportLoadError(next, loaded.error?.message || 'Could not load products from the server.')
        return
      }
      const data = loaded.data as { products?: Product[] } | null
      if (!data?.products?.length) {
        const seed = createSeedData()
        const boot = await postIdentityAction('products.bootstrap', {
          products: seed.products,
          actorUserId: options?.actorId(),
        })
        if (epoch !== seen) return
        const slice = sliceFrom((boot.ok ? boot.data : null) as { products?: Product[] } | null)
        if (slice) {
          options?.apply(slice)
          return
        }
        const again = await hydrateRead(postIdentityAction, 'products.list', {})
        if (epoch !== seen) return
        const existing = sliceFrom(again.ok ? (again.data as { products?: Product[] } | null) : null)
        if (existing) options?.apply(existing)
        else if (!boot.ok) reportLoadError(next, boot.error?.message || 'Could not load products from the server.')
      } else {
        const slice = sliceFrom(data)
        if (slice) options?.apply(slice)
      }
    } catch (error) {
      reportLoadError(next, error instanceof Error ? error.message : 'Could not load products from the server.')
    } finally {
      if (epoch === seen) {
        ready = true
        const queued = pending.splice(0, pending.length)
        queued.forEach((item) => queueProductWrite(item.action, item.payload))
      }
    }
  })
}

export function queueProductWrite(action: string, payload: Record<string, unknown>) {
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
      const slice = sliceFrom(result.data as { products?: Product[] } | null)
      if (slice) options?.apply(slice)
      if (slice) options?.onSaved(action, payload, slice.products)
    } catch {
      if (epoch === seen) options?.onError('Could not save to the server.')
    }
  })()
}
