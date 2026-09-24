import { round2 } from '@/utils/format'

export type SpotCheckLine = {
  orderId: string
  externalProductName: string
  variationText?: string
  parentSku?: string
  externalSku?: string
  quantity: number
  unallocated?: boolean
  sharedOrderCount?: number
  mappedProductId?: string
}

export type SpotCheckOrder = {
  id: string
  externalOrderId: string
}

export type SpotCheckProduct = {
  id: string
  name: string
  categoryId?: string
}

export type SpotSample = {
  key: string
  name: string
  productName: string
  quantity: number
  mappedName?: string
  mappingStatus: 'Mapped' | 'Unmapped'
  orderIds: string[]
  categoryName: string
}

const SAMPLE_LIMIT = 4

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function sampleKey(line: SpotCheckLine) {
  return [line.externalSku?.trim() ?? '', line.parentSku?.trim() ?? '', norm(line.externalProductName), norm(line.variationText ?? '')].join('|')
}

function displayName(line: SpotCheckLine) {
  const product = clean(line.externalProductName)
  const variation = clean(line.variationText ?? '')
  if (variation && variation.toLowerCase() !== product.toLowerCase()) return `${product} — ${variation}`
  return product || variation || 'Product'
}

function byQtyThenName(a: SpotSample, b: SpotSample) {
  if (b.quantity !== a.quantity) return b.quantity - a.quantity
  return a.name.localeCompare(b.name) || a.key.localeCompare(b.key)
}

function productType(sample: SpotSample) {
  return sample.categoryName || sample.productName.split(/[^A-Za-z0-9]+/).find(Boolean)?.toLowerCase() || sample.key
}

export function spotOrderLabel(orderIds: string[]) {
  if (orderIds.length === 0) return 'No order id'
  if (orderIds.length === 1) return orderIds[0]
  if (orderIds.length === 2) return orderIds.join(', ')
  return `${orderIds.length} orders`
}

export function buildSpotSamples(input: {
  orders: SpotCheckOrder[]
  lines: SpotCheckLine[]
  products: SpotCheckProduct[]
  categories?: Array<{ id: string; name: string }>
}): SpotSample[] {
  const orders = new Map(input.orders.map((order) => [order.id, order]))
  const products = new Map(input.products.map((product) => [product.id, product]))
  const categories = new Map((input.categories ?? []).map((category) => [category.id, category.name]))
  const groups = new Map<string, SpotSample & { mappedIds: string[]; unmapped: boolean }>()
  const seenShared = new Set<string>()
  for (const line of input.lines) {
    const order = orders.get(line.orderId)
    if (!order || !(line.quantity > 0)) continue
    const key = sampleKey(line)
    const current = groups.get(key) ?? {
      key,
      name: displayName(line),
      productName: clean(line.externalProductName) || displayName(line),
      quantity: 0,
      mappingStatus: 'Unmapped' as const,
      orderIds: [],
      categoryName: '',
      mappedIds: [],
      unmapped: false,
    }
    if (!current.orderIds.includes(order.externalOrderId)) current.orderIds.push(order.externalOrderId)
    if (line.mappedProductId) {
      if (!current.mappedIds.includes(line.mappedProductId)) current.mappedIds.push(line.mappedProductId)
    } else current.unmapped = true
    const shared = Boolean(line.unallocated) && (line.sharedOrderCount ?? 0) > 1
    const shareKey = `${key}|${line.quantity}|${line.sharedOrderCount ?? 0}`
    if (!shared || !seenShared.has(shareKey)) {
      if (shared) seenShared.add(shareKey)
      current.quantity = round2(current.quantity + line.quantity)
    }
    groups.set(key, current)
  }
  const samples: SpotSample[] = [...groups.values()].map((group) => {
    const mapped = !group.unmapped && group.mappedIds.length > 0
    const product = group.mappedIds.length === 1 ? products.get(group.mappedIds[0]) : undefined
    const mappedName = group.mappedIds.length > 1 ? 'Multiple products' : product?.name
    return {
      key: group.key,
      name: group.name,
      productName: group.productName,
      quantity: group.quantity,
      mappedName,
      mappingStatus: mapped ? 'Mapped' : 'Unmapped',
      orderIds: [...group.orderIds].sort(),
      categoryName: product?.categoryId ? categories.get(product.categoryId) ?? '' : '',
    }
  })
  return chooseSamples(samples)
}

function chooseSamples(samples: SpotSample[]) {
  const ranked = [...samples].sort(byQtyThenName)
  if (ranked.length <= SAMPLE_LIMIT) return ranked
  const chosen: SpotSample[] = []
  const taken = (sample?: SpotSample) => {
    if (!sample || chosen.some((item) => item.key === sample.key)) return
    chosen.push(sample)
  }
  taken(ranked[0])
  taken(ranked[Math.floor((ranked.length - 1) / 2)])
  const usedTypes = new Set(chosen.map(productType))
  taken(ranked.find((sample) => !chosen.some((item) => item.key === sample.key) && !usedTypes.has(productType(sample))))
  taken([...ranked].reverse().find((sample) => !chosen.some((item) => item.key === sample.key)))
  for (const sample of ranked) {
    if (chosen.length >= SAMPLE_LIMIT) break
    taken(sample)
  }
  return chosen.slice(0, SAMPLE_LIMIT)
}

export function spotCheckProgress(samples: SpotSample[], checkedKeys: readonly string[]) {
  const checked = new Set(checkedKeys)
  const done = samples.filter((sample) => checked.has(sample.key)).length
  return { done, required: samples.length, complete: samples.length === 0 || done === samples.length }
}

export function confirmSaleEnabled(input: { canCreate: boolean; systemCanConfirm: boolean; busy?: boolean; samples: SpotSample[]; checkedKeys: readonly string[]; reconciliationOk?: boolean }) {
  return Boolean(input.canCreate && input.systemCanConfirm && !input.busy && input.reconciliationOk !== false && spotCheckProgress(input.samples, input.checkedKeys).complete)
}
