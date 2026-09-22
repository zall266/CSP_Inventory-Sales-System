import type {
  AppState,
  Bom,
  PackingAssembly,
  PackingBomSnapshot,
  PackingConsumption,
  Product,
} from '@/types'
import { formatUnit, normalizeUnit, purchaseConversionQty } from '@/features/products/masterData'
import { consumptionCost } from '@/features/manufacturing/helpers'
import { isCompanyWarehouseId } from '@/features/agent/agentModel'
import { round2 } from '@/utils/format'

const WEIGHT_FACTOR: Record<string, number> = { G: 1, KG: 1000 }
const VOLUME_FACTOR: Record<string, number> = { ML: 1, L: 1000 }
const DISCRETE_UNITS = new Set(['PCS', 'PACKS', 'TIN', 'BAG', 'BOTTLE', 'BOX', 'CARTON', 'ROLL'])

export type PackingQtyError = { ok: false; reason: string }
export type PackingQtyOk = { ok: true; qty: number }

export function isDiscreteUnit(unit: string | undefined) {
  const code = normalizeUnit(unit)
  return Boolean(code) && DISCRETE_UNITS.has(code)
}

export function packingQtyToInventory(
  qty: number,
  fromUnit: string | undefined,
  product: Pick<Product, 'name' | 'unit' | 'purchaseUnit' | 'purchaseConversionQty'>,
): PackingQtyOk | PackingQtyError {
  if (!Number.isFinite(qty)) {
    return { ok: false, reason: `Cannot convert quantity for ${product.name}.` }
  }
  const from = normalizeUnit(fromUnit) || normalizeUnit(product.unit)
  const base = normalizeUnit(product.unit)
  if (!from || !base) {
    return { ok: false, reason: `Cannot convert ${fromUnit || 'unit'} to ${product.unit || 'inventory unit'} for ${product.name}.` }
  }
  if (from === base) return { ok: true, qty }

  if (WEIGHT_FACTOR[from] && WEIGHT_FACTOR[base]) {
    return { ok: true, qty: (qty * WEIGHT_FACTOR[from]) / WEIGHT_FACTOR[base] }
  }
  if (VOLUME_FACTOR[from] && VOLUME_FACTOR[base]) {
    return { ok: true, qty: (qty * VOLUME_FACTOR[from]) / VOLUME_FACTOR[base] }
  }

  const purchase = normalizeUnit(product.purchaseUnit ?? '')
  const conversion = purchaseConversionQty(product)
  if (purchase && from === purchase && conversion > 0 && from !== base) {
    return { ok: true, qty: qty * conversion }
  }

  return {
    ok: false,
    reason: `Cannot convert ${formatUnit(from)} to ${formatUnit(base)} for ${product.name}.`,
  }
}

export function applyDiscreteRounding(qty: number, unit: string | undefined) {
  const rounded = round2(qty)
  if (!isDiscreteUnit(unit)) return rounded
  const epsilon = 1e-9
  if (Math.abs(rounded - Math.round(rounded)) < epsilon) return Math.round(rounded)
  return Math.ceil(rounded - epsilon)
}

export function packingScaleFactor(outputQty: number, actualQty: number) {
  return outputQty > 0 ? actualQty / outputQty : 0
}

export function activeBomsForProduct(boms: Bom[], productId: string) {
  return boms.filter((bom) => bom.productId === productId && bom.status === 'active')
}

export function packingOutputProducts(state: Pick<AppState, 'products' | 'boms'>) {
  const ids = new Set(state.boms.filter((bom) => bom.status === 'active').map((bom) => bom.productId))
  return state.products.filter((product) => product.status === 'active' && ids.has(product.id))
}

export function captureBomSnapshot(bom: Bom, products: Product[], capturedAt: string): PackingBomSnapshot {
  return {
    bomId: bom.id,
    name: bom.name,
    outputQty: bom.outputQty,
    outputUnit: bom.outputUnit,
    capturedAt,
    items: bom.items.map((item) => {
      const product = products.find((row) => row.id === item.productId)
      return {
        productId: item.productId,
        productName: product?.name ?? 'Unknown',
        sku: product?.sku ?? '',
        qty: item.qty,
        unit: item.unit,
        wastagePct: item.wastagePct,
        notes: item.notes,
      }
    }),
  }
}

function snapshotItemKey(item: { productId: string; qty: number; unit: string; wastagePct: number }) {
  return `${item.productId}|${item.qty}|${normalizeUnit(item.unit)}|${item.wastagePct}`
}

export function packingBomChanged(snapshot: PackingBomSnapshot, bom: Bom | undefined) {
  if (!bom) return true
  if (snapshot.bomId !== bom.id) return true
  if (snapshot.name !== bom.name) return true
  if (snapshot.outputQty !== bom.outputQty) return true
  if (normalizeUnit(snapshot.outputUnit) !== normalizeUnit(bom.outputUnit)) return true
  if (snapshot.items.length !== bom.items.length) return true
  const live = bom.items.map(snapshotItemKey).sort()
  const saved = snapshot.items.map(snapshotItemKey).sort()
  return live.some((key, index) => key !== saved[index])
}

export function packingHasSelfReference(outputProductId: string, items: Array<{ productId: string }>) {
  return items.some((item) => item.productId === outputProductId)
}

export function packingHasCircularBom(boms: Bom[], outputProductId: string, snapshotItems?: Array<{ productId: string }>) {
  if (snapshotItems && packingHasSelfReference(outputProductId, snapshotItems)) return true
  const children = new Map<string, string[]>()
  for (const bom of boms) {
    if (bom.status !== 'active') continue
    const next = children.get(bom.productId) ?? []
    for (const item of bom.items) {
      if (!next.includes(item.productId)) next.push(item.productId)
    }
    children.set(bom.productId, next)
  }
  const stack = new Set<string>()
  const seen = new Set<string>()
  const visit = (id: string): boolean => {
    if (stack.has(id)) return true
    if (seen.has(id)) return false
    stack.add(id)
    for (const child of children.get(id) ?? []) {
      if (visit(child)) return true
    }
    stack.delete(id)
    seen.add(id)
    return false
  }
  return visit(outputProductId)
}

export type PackingLinePreview = {
  productId: string
  name: string
  sku: string
  bomQty: number
  bomUnit: string
  baseQty: number
  wastagePct: number
  wastageQty: number
  requiredQty: number
  unit: string
  notes: string
  onHand: number
  afterPosting: number
  shortage: number
  conversionError?: string
}

export type PackingPreview = {
  ok: boolean
  factor: number
  lines: PackingLinePreview[]
  conversionError?: string
  hasShortage: boolean
  costEstimate: number
}

export function packingLinesFromSnapshot(
  snapshot: PackingBomSnapshot,
  actualQty: number,
  products: Product[],
  inventory: AppState['inventory'],
  warehouseId: string,
): PackingPreview {
  const factor = packingScaleFactor(snapshot.outputQty, actualQty)
  const lines: PackingLinePreview[] = snapshot.items.map((item) => {
    const product = products.find((row) => row.id === item.productId)
    const name = product?.name ?? item.productName
    const sku = product?.sku ?? item.sku
    const inventoryUnit = product?.unit || item.unit
    const onHand = inventory.find((row) => row.productId === item.productId && row.warehouseId === warehouseId)?.qty ?? 0
    const baseBomQty = item.qty * factor
    const wastageBomQty = baseBomQty * ((item.wastagePct || 0) / 100)
    if (!product) {
      return {
        productId: item.productId,
        name,
        sku,
        bomQty: item.qty,
        bomUnit: item.unit,
        baseQty: 0,
        wastagePct: item.wastagePct || 0,
        wastageQty: 0,
        requiredQty: 0,
        unit: inventoryUnit,
        notes: item.notes,
        onHand: round2(onHand),
        afterPosting: round2(onHand),
        shortage: 0,
        conversionError: `Component ${name} is missing.`,
      }
    }
    const convertedBase = packingQtyToInventory(baseBomQty, item.unit, product)
    if (!convertedBase.ok) {
      return {
        productId: item.productId,
        name,
        sku,
        bomQty: item.qty,
        bomUnit: item.unit,
        baseQty: 0,
        wastagePct: item.wastagePct || 0,
        wastageQty: 0,
        requiredQty: 0,
        unit: inventoryUnit,
        notes: item.notes,
        onHand: round2(onHand),
        afterPosting: round2(onHand),
        shortage: 0,
        conversionError: convertedBase.reason,
      }
    }
    const convertedTotal = packingQtyToInventory(baseBomQty + wastageBomQty, item.unit, product)
    if (!convertedTotal.ok) {
      return {
        productId: item.productId,
        name,
        sku,
        bomQty: item.qty,
        bomUnit: item.unit,
        baseQty: 0,
        wastagePct: item.wastagePct || 0,
        wastageQty: 0,
        requiredQty: 0,
        unit: inventoryUnit,
        notes: item.notes,
        onHand: round2(onHand),
        afterPosting: round2(onHand),
        shortage: 0,
        conversionError: convertedTotal.reason,
      }
    }
    const baseQty = applyDiscreteRounding(convertedBase.qty, inventoryUnit)
    const requiredQty = applyDiscreteRounding(convertedTotal.qty, inventoryUnit)
    const wastageQty = round2(Math.max(0, requiredQty - baseQty))
    const shortage = round2(Math.max(0, requiredQty - onHand))
    return {
      productId: item.productId,
      name,
      sku,
      bomQty: item.qty,
      bomUnit: item.unit,
      baseQty,
      wastagePct: item.wastagePct || 0,
      wastageQty,
      requiredQty,
      unit: inventoryUnit,
      notes: item.notes,
      onHand: round2(onHand),
      afterPosting: round2(onHand - requiredQty),
      shortage,
    }
  })
  const conversionError = lines.find((line) => line.conversionError)?.conversionError
  const costEstimate = consumptionCost(
    { products } as AppState,
    lines.map((line) => ({
      productId: line.productId,
      expectedQty: line.requiredQty,
      actualQty: line.requiredQty,
      unit: line.unit,
      notes: line.notes,
    })),
  )
  return {
    ok: !conversionError,
    factor,
    lines,
    conversionError,
    hasShortage: lines.some((line) => line.shortage > 0),
    costEstimate,
  }
}

export function packingConsumptionsFromPreview(preview: PackingPreview): PackingConsumption[] {
  return preview.lines.map((line) => ({
    productId: line.productId,
    expectedQty: line.requiredQty,
    actualQty: line.requiredQty,
    unit: line.unit,
    notes: line.notes,
    baseQty: line.baseQty,
    wastagePct: line.wastagePct,
    wastageQty: line.wastageQty,
    bomUnit: line.bomUnit,
  }))
}

export function validatePackingQuantities(plannedQty: number, actualQty: number, outputUnit?: string) {
  if (!Number.isFinite(plannedQty) || plannedQty <= 0) return 'Enter a planned quantity greater than 0.'
  if (!Number.isFinite(actualQty) || actualQty <= 0) return 'Enter an actual quantity greater than 0.'
  if (actualQty > plannedQty) return 'Actual quantity cannot exceed planned quantity.'
  if (isDiscreteUnit(outputUnit)) {
    if (!Number.isInteger(plannedQty)) return 'Planned quantity must be a whole number for this unit.'
    if (!Number.isInteger(actualQty)) return 'Actual quantity must be a whole number for this unit.'
  }
  return null
}

export function packingWarehouseError(state: Pick<AppState, 'warehouses'>, warehouseId: string) {
  if (!warehouseId) return 'Select a warehouse.'
  if (!isCompanyWarehouseId(state.warehouses, warehouseId)) return 'Choose a company warehouse.'
  return null
}

export function hydratePackingAssemblies(rows: PackingAssembly[] | undefined): PackingAssembly[] {
  return (rows ?? []).map((row) => ({
    ...row,
    notes: row.notes ?? '',
    posted: Boolean(row.posted),
    consumptions: row.consumptions ?? [],
    bomSnapshot: row.bomSnapshot ?? {
      bomId: row.bomId,
      name: '',
      outputQty: 1,
      outputUnit: row.unit,
      capturedAt: row.createdAt,
      items: [],
    },
  }))
}
