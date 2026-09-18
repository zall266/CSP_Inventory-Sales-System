import { formatUnit, productHasBom, qtyToBaseUnit, validatePurchaseConversion } from '@/features/products/masterData'
import { isActiveBalanceStorageBox } from '@/features/warehouse/warehouseModel'
import type { AppState, OpeningBalance, OpeningBalanceInput, OpeningBalanceLine, OpeningBalanceType, Product } from '@/types'

export const OPENING_BALANCE_PERMISSION_KEYS = ['opening_balance.view', 'opening_balance.create'] as const

export const OPENING_BALANCE_TYPES: Array<{ id: OpeningBalanceType; label: string }> = [
  { id: 'stock_item', label: 'Stock Item' },
  { id: 'finished_goods', label: 'Finished Goods' },
  { id: 'production_balance', label: 'Production Balance' },
]

/** Older than seeded production dates so FIFO consumes opening balance first. */
export const OPENING_BALANCE_ORIGIN_DATE = '2000-01-01T00:00:00+08:00'

export function openingBalanceTypeLabel(type: OpeningBalanceType | undefined) {
  return OPENING_BALANCE_TYPES.find((item) => item.id === type)?.label ?? 'Stock Item'
}

export function isFinishedGoodsProduct(state: Pick<AppState, 'boms'>, product: Product | undefined) {
  if (!product || product.status !== 'active') return false
  return productHasBom(state.boms, product.id)
}

export function isStockItemProduct(state: Pick<AppState, 'boms'>, product: Product | undefined) {
  if (!product || product.status !== 'active') return false
  return !isFinishedGoodsProduct(state, product)
}

export function stockItemProducts(state: Pick<AppState, 'products' | 'boms'>) {
  return state.products.filter((product) => isStockItemProduct(state, product))
}

export function finishedGoodsProducts(state: Pick<AppState, 'products' | 'boms'>) {
  return state.products.filter((product) => isFinishedGoodsProduct(state, product))
}

export function productionBalanceProducts(state: Pick<AppState, 'products' | 'boms'>) {
  return state.products.filter((product) => isFinishedGoodsProduct(state, product))
}

export function unusedOpeningBalanceProducts(
  catalog: Product[],
  lines: Array<{ productId?: string; warehouseId?: string }>,
  options: { index: number; warehouseId: string },
) {
  const taken = new Set(
    lines
      .filter((line, index) => index !== options.index && Boolean(line.productId) && (line.warehouseId || '') === options.warehouseId)
      .map((line) => line.productId as string),
  )
  return catalog.filter((product) => !taken.has(product.id))
}

export function emptyOpeningLine(
  type: OpeningBalanceType,
  product: Product | undefined,
  warehouseId: string,
  container = '',
): OpeningBalanceInput['items'][number] {
  return {
    productId: product?.id ?? '',
    qty: type === 'production_balance' ? 2500 : 1,
    unit: type === 'production_balance' ? 'G' : product?.purchaseUnit || product?.unit || 'PCS',
    warehouseId,
    batchNo: '',
    expiry: '',
    notes: '',
    locationKind: type === 'finished_goods' ? 'inventory' : undefined,
    locationId: '',
    container: type === 'production_balance' ? container : '',
  }
}

export function lineUnitOptions(product: Product | undefined) {
  if (!product) return ['PCS']
  const units = [formatUnit(product.unit), formatUnit(product.purchaseUnit ?? product.unit)].filter(Boolean)
  return [...new Set(units)]
}

export function inputLinesFromOpeningBalance(doc: OpeningBalance): OpeningBalanceInput['items'] {
  return doc.items.map((line) => ({
    productId: line.productId,
    qty: line.qty,
    unit: line.unit,
    warehouseId: line.warehouseId,
    batchNo: line.batchNo ?? '',
    expiry: line.expiry ?? '',
    notes: line.notes ?? '',
    locationKind: line.locationKind,
    locationId: line.locationId ?? '',
    container: line.container ?? '',
  }))
}

export function conversionPreview(product: Product | undefined, qty: number, unit: string) {
  if (!product) return null
  const base = qtyToBaseUnit(qty, unit, product)
  if (base === null || !Number.isFinite(base)) return null
  return { baseQty: base, unit: formatUnit(product.unit) }
}

export function buildOpeningBalanceLines(
  state: Pick<AppState, 'products' | 'boms' | 'warehouses' | 'storageLocations' | 'storageSlots'>,
  type: OpeningBalanceType,
  items: OpeningBalanceInput['items'],
): { ok: true; lines: OpeningBalanceLine[] } | { ok: false; reason: string } {
  const lines: OpeningBalanceLine[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const product = state.products.find((row) => row.id === item.productId)
    if (!product) return { ok: false, reason: 'Choose a valid item for every line.' }
    if (product.status !== 'active') return { ok: false, reason: `${product.name} is inactive.` }
    if (type === 'stock_item' && !isStockItemProduct(state, product)) {
      return { ok: false, reason: `${product.name} is finished goods. Use the Finished Goods tab.` }
    }
    if (type === 'finished_goods' && !isFinishedGoodsProduct(state, product)) {
      return { ok: false, reason: `${product.name} is not a finished product.` }
    }
    if (type === 'production_balance' && !isFinishedGoodsProduct(state, product)) {
      return { ok: false, reason: `${product.name} is not valid for production balance.` }
    }
    const qty = Number(item.qty)
    if (!Number.isFinite(qty) || !(qty > 0)) return { ok: false, reason: 'Enter a quantity greater than 0.' }
    const warehouse = state.warehouses.find((row) => row.id === item.warehouseId)
    if (!warehouse || warehouse.kind === 'agent') return { ok: false, reason: 'Choose a valid company warehouse.' }

    const unit = (item.unit || (type === 'production_balance' ? 'G' : product.purchaseUnit || product.unit)).trim()
    if (type === 'production_balance') {
      const grams = qty
      if (!(grams > 0)) return { ok: false, reason: 'Production balance quantity must be in grams and greater than 0.' }
      const container = item.container?.trim()
      if (!container) return { ok: false, reason: 'Storage Box is required.' }
      if (!isActiveBalanceStorageBox(state, warehouse.id, container)) {
        return { ok: false, reason: `Select a valid Storage Box for ${product.name}.` }
      }
      const key = `${product.id}:${container}`
      if (seen.has(key)) return { ok: false, reason: `Duplicate ${product.name} in ${container}.` }
      seen.add(key)
      lines.push({
        productId: product.id,
        qty,
        unit: 'G',
        baseQty: grams,
        warehouseId: warehouse.id,
        notes: item.notes?.trim() || undefined,
        container,
      })
      continue
    }

    const conversion = validatePurchaseConversion({
      baseUnit: product.unit,
      purchaseUnit: product.purchaseUnit || product.unit,
      conversionQty: product.purchaseConversionQty ?? 1,
    })
    if (!conversion.ok) return { ok: false, reason: conversion.reason }
    const baseQty = qtyToBaseUnit(qty, unit, product)
    if (baseQty === null || !Number.isFinite(baseQty) || !(baseQty > 0)) {
      return { ok: false, reason: `Cannot convert ${qty} ${unit} for ${product.name}.` }
    }
    const key = `${product.id}:${warehouse.id}`
    if (seen.has(key)) return { ok: false, reason: `Duplicate ${product.name} in the same warehouse.` }
    seen.add(key)
    let locationKind = item.locationKind
    const locationId = item.locationId?.trim() || undefined
    if (type === 'finished_goods' && locationId) {
      const location = state.storageLocations.find((row) => row.id === locationId)
      if (!location || !location.active) return { ok: false, reason: 'Choose a valid storage location.' }
      if (location.warehouseId !== warehouse.id) return { ok: false, reason: 'Location must belong to the selected warehouse.' }
      locationKind = location.type === 'DISPLAY' ? 'display' : location.type === 'PALLET' ? 'pallet' : location.type === 'FLOOR' ? 'floor' : 'rack'
    }
    lines.push({
      productId: product.id,
      qty,
      unit,
      baseQty,
      warehouseId: warehouse.id,
      batchNo: item.batchNo?.trim() || undefined,
      expiry: item.expiry?.trim() || undefined,
      notes: item.notes?.trim() || undefined,
      locationKind: type === 'finished_goods' ? locationKind || 'inventory' : undefined,
      locationId,
    })
  }
  if (!lines.length) return { ok: false, reason: 'Add at least one line.' }
  return { ok: true, lines }
}
