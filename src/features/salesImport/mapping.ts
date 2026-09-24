import type { Product, SalesImportLine, SalesImportMapping, SalesImportParsedLine, SalesImportPlatform } from '@/types'

export type MappingIdentity = { keyType: 'sku' | 'text'; key: string }

export function normalizeTextKey(name: string, variation?: string) {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${norm(name)}|${norm(variation ?? '')}`
}

export function mappingIdentity(line: Pick<SalesImportParsedLine, 'externalProductName' | 'variationText' | 'parentSku' | 'externalSku'>): MappingIdentity {
  const sku = line.externalSku?.trim()
  if (sku) return { keyType: 'sku', key: sku }
  const parent = line.parentSku?.trim()
  if (parent && !line.variationText?.trim()) return { keyType: 'sku', key: parent }
  return { keyType: 'text', key: normalizeTextKey(line.externalProductName, line.variationText) }
}

export function mappingKeyLabel(identity: MappingIdentity) {
  return identity.keyType === 'sku' ? `sku:${identity.key}` : `text:${identity.key}`
}

export function externalLabel(line: Pick<SalesImportLine, 'externalSku' | 'variationText' | 'externalProductName'>) {
  const sku = line.externalSku?.trim()
  const variation = line.variationText?.trim()
  if (sku && variation) return `${sku} · ${variation}`
  if (sku) return sku
  if (variation) return variation
  return line.externalProductName
}

function tokens(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2)
}

export function suggestProduct(line: Pick<SalesImportParsedLine, 'externalProductName' | 'variationText' | 'externalSku'>, products: Product[]) {
  const source = tokens(`${line.variationText ?? ''} ${line.externalSku ?? ''}`)
  const fallback = source.length ? source : tokens(line.externalProductName)
  if (!fallback.length) return undefined
  let best: { id: string; score: number } | undefined
  for (const product of products) {
    if (product.status !== 'active') continue
    const nameTokens = tokens(product.name)
    if (!nameTokens.length) continue
    const overlap = fallback.filter((token) => nameTokens.includes(token)).length
    const score = overlap / fallback.length
    if (overlap < 1 || score < 0.5) continue
    if (!best || score > best.score) best = { id: product.id, score }
  }
  return best?.id
}

export function mappingIsActive(mapping: Pick<SalesImportMapping, 'active'>) {
  return mapping.active !== false
}

export function mappingSourceTexts(
  mapping: Pick<SalesImportMapping, 'platform' | 'accountId' | 'keyType' | 'key'>,
  lines: SalesImportLine[],
  orders: Array<{ id: string; batchId: string }>,
  batches: Array<{ id: string; platform: SalesImportPlatform; accountId: string }>,
) {
  const batchIds = new Set(
    batches.filter((batch) => batch.platform === mapping.platform && batch.accountId === mapping.accountId).map((batch) => batch.id),
  )
  const orderIds = new Set(orders.filter((order) => batchIds.has(order.batchId)).map((order) => order.id))
  const texts: string[] = []
  for (const line of lines) {
    if (!orderIds.has(line.orderId)) continue
    const identity = mappingIdentity(line)
    if (identity.keyType !== mapping.keyType || identity.key !== mapping.key) continue
    const name = line.externalProductName?.trim()
    const variation = line.variationText?.trim()
    if (name && !texts.includes(name)) texts.push(name)
    if (variation && !texts.includes(variation)) texts.push(variation)
  }
  return texts
}

export function filterSalesImportMappings(input: {
  mappings: SalesImportMapping[]
  products: Product[]
  lines: SalesImportLine[]
  orders: Array<{ id: string; batchId: string }>
  batches: Array<{ id: string; platform: SalesImportPlatform; accountId: string }>
  search: string
  platform: string
  accountId: string
  status: 'all' | 'active' | 'inactive'
}) {
  const query = input.search.trim().toLowerCase()
  return input.mappings.filter((mapping) => {
    if (input.platform && mapping.platform !== input.platform) return false
    if (input.accountId && mapping.accountId !== input.accountId) return false
    const active = mappingIsActive(mapping)
    if (input.status === 'active' && !active) return false
    if (input.status === 'inactive' && active) return false
    if (!query) return true
    const product = input.products.find((item) => item.id === mapping.productId)
    const source = mappingSourceTexts(mapping, input.lines, input.orders, input.batches)
    const haystack = [mapping.key, product?.name, product?.sku, ...source].join(' ').toLowerCase()
    return haystack.includes(query)
  })
}

export function resolveLineProduct(
  line: Pick<SalesImportParsedLine, 'externalProductName' | 'variationText' | 'parentSku' | 'externalSku'>,
  platform: SalesImportPlatform,
  accountId: string,
  mappings: SalesImportMapping[],
  products: Product[],
) {
  const identity = mappingIdentity(line)
  const saved = mappings.find((row) => row.platform === platform && row.accountId === accountId && row.keyType === identity.keyType && row.key === identity.key && mappingIsActive(row))
  if (saved) {
    const savedProduct = products.find((product) => product.id === saved.productId && product.status === 'active')
    if (savedProduct) return { productId: savedProduct.id, identity, exactSku: false }
    return { productId: undefined, identity, exactSku: false }
  }
  if (identity.keyType === 'sku') {
    const exact = products.find((product) => product.status === 'active' && product.sku.trim() === identity.key)
    if (exact) return { productId: exact.id, identity, exactSku: true }
    return { productId: undefined, identity, exactSku: false, suggestionId: suggestProduct(line, products) }
  }
  return { productId: undefined, identity, exactSku: false, suggestionId: suggestProduct(line, products) }
}
