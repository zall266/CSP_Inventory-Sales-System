import type { AppState, Bom, Product } from '@/types'
import { round2 } from '@/utils/format'

export const AUTO_SKU_START = 100001
export const AUTO_SKU_MAX = 999999

export const BASE_UNITS = ['G', 'KG', 'ML', 'L', 'PCS'] as const
export const PURCHASE_UNITS = ['G', 'KG', 'ML', 'L', 'PCS', 'BAG', 'BOTTLE', 'BOX', 'CARTON', 'ROLL'] as const

export type UnitCode = (typeof PURCHASE_UNITS)[number] | 'PACKS' | 'TIN'

const UNIT_ALIASES: Record<string, string> = {
  g: 'G',
  gram: 'G',
  grams: 'G',
  kg: 'KG',
  kilo: 'KG',
  kilos: 'KG',
  kilogram: 'KG',
  kilograms: 'KG',
  ml: 'ML',
  millilitre: 'ML',
  milliliter: 'ML',
  millilitres: 'ML',
  milliliters: 'ML',
  l: 'L',
  litre: 'L',
  liter: 'L',
  litres: 'L',
  liters: 'L',
  pc: 'PCS',
  pcs: 'PCS',
  piece: 'PCS',
  pieces: 'PCS',
  bag: 'BAG',
  bags: 'BAG',
  bottle: 'BOTTLE',
  bottles: 'BOTTLE',
  box: 'BOX',
  boxes: 'BOX',
  carton: 'CARTON',
  cartons: 'CARTON',
  roll: 'ROLL',
  rolls: 'ROLL',
  pack: 'PACKS',
  packs: 'PACKS',
  tin: 'TIN',
  tins: 'TIN',
}

type UnitFamily = 'weight' | 'volume' | 'count' | 'pack'

const UNIT_META: Record<string, { family: UnitFamily; factor: number }> = {
  G: { family: 'weight', factor: 1 },
  KG: { family: 'weight', factor: 1000 },
  ML: { family: 'volume', factor: 1 },
  L: { family: 'volume', factor: 1000 },
  PCS: { family: 'count', factor: 1 },
  PACKS: { family: 'count', factor: 1 },
  TIN: { family: 'count', factor: 1 },
  BAG: { family: 'pack', factor: 1 },
  BOTTLE: { family: 'pack', factor: 1 },
  BOX: { family: 'pack', factor: 1 },
  CARTON: { family: 'pack', factor: 1 },
  ROLL: { family: 'pack', factor: 1 },
}

export function normalizeUnit(unit: string | undefined) {
  const raw = (unit ?? '').trim()
  if (!raw) return ''
  return UNIT_ALIASES[raw.toLowerCase()] ?? raw.toUpperCase()
}

export function unitOptions(current?: string) {
  const options = [...PURCHASE_UNITS] as string[]
  const extra = normalizeUnit(current)
  if (extra && !options.includes(extra)) options.push(extra)
  return options
}

export function baseUnitOptions(current?: string) {
  const options = [...BASE_UNITS] as string[]
  const extra = normalizeUnit(current)
  if (extra && !options.includes(extra)) options.push(extra)
  return options
}

export function unitsEqual(a: string | undefined, b: string | undefined) {
  const left = normalizeUnit(a)
  const right = normalizeUnit(b)
  return Boolean(left) && left === right
}

export function isAutoNumericSku(sku: string) {
  return /^\d{6}$/.test(sku.trim())
}

export function nextNumericSku(existingSkus: string[]) {
  const used = new Set(existingSkus.map((sku) => sku.trim().toLowerCase()).filter(Boolean))
  for (let n = AUTO_SKU_START; n <= AUTO_SKU_MAX; n += 1) {
    const sku = String(n).padStart(6, '0')
    if (!used.has(sku)) return sku
  }
  return null
}

export function resolveProductSku(inputSku: string | undefined, existingSkus: string[]) {
  const manual = (inputSku ?? '').trim()
  if (manual) return { ok: true as const, sku: manual, generated: false }
  const sku = nextNumericSku(existingSkus)
  if (!sku) return { ok: false as const, reason: 'No unique 6-digit SKU remaining.' }
  return { ok: true as const, sku, generated: true }
}

export function skuIsUnique(sku: string, products: Array<{ id: string; sku: string }>, excludeId?: string) {
  const needle = sku.trim().toLowerCase()
  if (!needle) return false
  return !products.some((product) => product.id !== excludeId && product.sku.trim().toLowerCase() === needle)
}

export function parseNonNegativeMoney(value: unknown) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return { ok: false as const }
  return { ok: true as const, value: round2(amount) }
}

export function parseConversionQty(value: unknown) {
  const qty = Number(value)
  if (!Number.isFinite(qty) || !(qty > 0)) return { ok: false as const }
  return { ok: true as const, value: qty }
}

export function purchaseConversionQty(product: Pick<Product, 'unit' | 'purchaseUnit' | 'purchaseConversionQty'>) {
  if (unitsEqual(product.unit, product.purchaseUnit ?? product.unit)) return 1
  const qty = Number(product.purchaseConversionQty)
  return Number.isFinite(qty) && qty > 0 ? qty : 0
}

export function validatePurchaseConversion(input: {
  baseUnit: string
  purchaseUnit: string
  conversionQty: unknown
}) {
  const baseUnit = normalizeUnit(input.baseUnit)
  const purchaseUnit = normalizeUnit(input.purchaseUnit)
  if (!baseUnit) return { ok: false as const, reason: 'Base Unit is required.' }
  if (!purchaseUnit) return { ok: false as const, reason: 'Purchase Unit is required.' }
  if (unitsEqual(baseUnit, purchaseUnit)) return { ok: true as const, value: 1 }
  const parsed = parseConversionQty(input.conversionQty)
  if (!parsed.ok) return { ok: false as const, reason: 'Conversion quantity must be greater than 0.' }
  return { ok: true as const, value: parsed.value }
}

export function baseUnitCost(product: Pick<Product, 'costPrice' | 'purchaseCost' | 'unit' | 'purchaseUnit' | 'purchaseConversionQty'>) {
  const conversion = purchaseConversionQty(product)
  const purchaseCost = product.purchaseCost
  if (purchaseCost !== undefined && purchaseCost !== null && Number.isFinite(purchaseCost) && conversion > 0) {
    return round2(purchaseCost / conversion)
  }
  return round2(product.costPrice ?? 0)
}

export function qtyToBaseUnit(
  qty: number,
  fromUnit: string | undefined,
  product: Pick<Product, 'unit' | 'purchaseUnit' | 'purchaseConversionQty'>,
) {
  if (!Number.isFinite(qty)) return null
  const from = normalizeUnit(fromUnit) || normalizeUnit(product.unit)
  const base = normalizeUnit(product.unit)
  if (!from || !base) return null
  if (from === base) return qty

  const fromMeta = UNIT_META[from]
  const baseMeta = UNIT_META[base]
  if (fromMeta && baseMeta && fromMeta.family === baseMeta.family && fromMeta.family !== 'pack') {
    return (qty * fromMeta.factor) / baseMeta.factor
  }

  const purchase = normalizeUnit(product.purchaseUnit ?? '')
  const conversion = purchaseConversionQty(product)
  if (purchase && from === purchase && conversion > 0) return qty * conversion
  if (purchase && from === base && purchase === from) return qty
  return null
}

export function purchaseQtyToBaseQty(
  qty: number,
  product: Pick<Product, 'unit' | 'purchaseUnit' | 'purchaseConversionQty'>,
) {
  const converted = qtyToBaseUnit(qty, product.purchaseUnit ?? product.unit, product)
  return converted ?? qty
}

export function bomLineQtyInBase(
  item: { qty: number; unit: string },
  material: Pick<Product, 'unit' | 'purchaseUnit' | 'purchaseConversionQty'> | undefined,
) {
  if (!material) return item.qty
  return qtyToBaseUnit(item.qty, item.unit, material) ?? item.qty
}

export function bomLineCost(
  products: Product[],
  item: { productId: string; qty: number; unit: string; wastagePct?: number },
  withWastage = false,
) {
  const material = products.find((product) => product.id === item.productId)
  const qty = bomLineQtyInBase(item, material)
  const used = withWastage ? qty * (1 + (item.wastagePct ?? 0) / 100) : qty
  const cost = baseUnitCost(material ?? { costPrice: 0, unit: item.unit })
  return used * cost
}

export function bomMaterialCostFromProducts(products: Product[], bom: Bom, qty = bom.outputQty, withWastage = true) {
  const factor = bom.outputQty > 0 ? qty / bom.outputQty : 0
  return round2(
    bom.items.reduce((sum, item) => {
      return sum + bomLineCost(products, { ...item, qty: item.qty * factor }, withWastage)
    }, 0),
  )
}

export function bomUnitCost(products: Product[], bom: Bom) {
  if (!(bom.outputQty > 0)) return 0
  return round2(bomMaterialCostFromProducts(products, bom, bom.outputQty, false) / bom.outputQty)
}

export function activeBomForProduct(boms: Bom[], productId: string) {
  return boms.find((bom) => bom.productId === productId && bom.status === 'active')
}

export function productHasBom(boms: Bom[], productId: string) {
  return Boolean(activeBomForProduct(boms, productId))
}

export function applyBomCosts(products: Product[], boms: Bom[]) {
  const next = new Map(products.map((product) => [product.id, product]))
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false
    for (const bom of boms) {
      if (bom.status !== 'active') continue
      const current = next.get(bom.productId)
      if (!current) continue
      const costPrice = bomUnitCost([...next.values()], bom)
      if (current.costSource !== 'bom' || current.costPrice !== costPrice) {
        next.set(current.id, { ...current, costSource: 'bom', costPrice })
        changed = true
      }
    }
    if (!changed) break
  }
  for (const product of products) {
    if (productHasBom(boms, product.id)) continue
    const current = next.get(product.id)
    if (current && current.costSource === 'bom') {
      next.set(product.id, { ...current, costSource: 'manual' })
    }
  }
  return products.map((product) => next.get(product.id) ?? product)
}

export function hydrateProduct(product: Product, boms: Bom[]): Product {
  const unit = product.unit || 'PCS'
  const purchaseUnit = product.purchaseUnit || unit
  const same = unitsEqual(unit, purchaseUnit)
  const conversion = same ? 1 : product.purchaseConversionQty && product.purchaseConversionQty > 0 ? product.purchaseConversionQty : 1
  const purchaseCost =
    product.purchaseCost !== undefined && product.purchaseCost !== null && Number.isFinite(product.purchaseCost)
      ? product.purchaseCost
      : same
        ? product.costPrice
        : round2(product.costPrice * conversion)
  const costSource = productHasBom(boms, product.id) ? 'bom' : product.costSource === 'bom' ? 'manual' : product.costSource ?? 'manual'
  return {
    ...product,
    unit,
    purchaseUnit,
    purchaseConversionQty: conversion,
    purchaseCost,
    costSource,
  }
}

export function hydrateProducts(products: Product[], boms: Bom[]) {
  return applyBomCosts(
    products.map((product) => hydrateProduct(product, boms)),
    boms,
  )
}

export function productIsUsed(
  state: Pick<AppState, 'sales' | 'purchases' | 'stockMovements' | 'productionOrders' | 'agentSales' | 'quotations' | 'deliveryOrders' | 'boms' | 'inventory'>,
  productId: string,
) {
  if ((state.sales ?? []).some((sale) => sale.items.some((line) => line.productId === productId))) return true
  if ((state.purchases ?? []).some((purchase) => purchase.items.some((line) => line.productId === productId))) return true
  if ((state.stockMovements ?? []).some((row) => row.productId === productId)) return true
  if ((state.productionOrders ?? []).some((order) => order.productId === productId || order.consumptions?.some((line) => line.productId === productId))) return true
  if ((state.agentSales ?? []).some((sale) => sale.items.some((line) => line.productId === productId))) return true
  if ((state.quotations ?? []).some((row) => row.items.some((line) => line.productId === productId))) return true
  if ((state.deliveryOrders ?? []).some((row) => row.items.some((line) => line.productId === productId))) return true
  if ((state.boms ?? []).some((bom) => bom.productId === productId || bom.items.some((item) => item.productId === productId))) return true
  if ((state.inventory ?? []).some((row) => row.productId === productId && row.qty !== 0)) return true
  return false
}

export function formatUnit(unit: string | undefined) {
  return normalizeUnit(unit) || unit || '—'
}
