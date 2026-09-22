import type { AppState, Bom, BomConsumptionMethod, BomItem, ProductionConsumption, ProductionOrder } from '@/types'
import { bomMaterialCostFromProducts, qtyToBaseUnit, baseUnitCost } from '@/features/products/masterData'
import { round2 } from '@/utils/format'

export function bomConsumptionMethod(
  item?: { consumptionMethod?: string | BomConsumptionMethod } | null,
): BomConsumptionMethod {
  return item?.consumptionMethod === 'MANUAL' ? 'MANUAL' : 'AUTO'
}

export function isManualBomItem(item?: { consumptionMethod?: string | BomConsumptionMethod } | null) {
  return bomConsumptionMethod(item) === 'MANUAL'
}

export function hydrateBomItem<T extends { consumptionMethod?: string | BomConsumptionMethod }>(item: T): T & { consumptionMethod: BomConsumptionMethod } {
  return { ...item, consumptionMethod: bomConsumptionMethod(item) }
}

export function hydrateBoms(boms: Bom[] | undefined): Bom[] {
  return (boms ?? []).map((bom) => ({
    ...bom,
    items: (bom.items ?? []).map((item) => hydrateBomItem(item)),
  }))
}

export function bomComponentIsManual(bom: Bom | undefined, productId: string) {
  const item = bom?.items.find((row) => row.productId === productId)
  return Boolean(item) && isManualBomItem(item)
}

export function autoConsumptions(bom: Bom | undefined, consumptions: ProductionConsumption[]) {
  return consumptions.filter((line) => {
    if (isManualBomItem(line)) return false
    return !bomComponentIsManual(bom, line.productId)
  })
}

export function sessionComponentIsManual(
  boms: Bom[],
  sessionItems: Array<{ productId: string; bomId: string }>,
  productId: string,
) {
  const methods: BomConsumptionMethod[] = []
  for (const item of sessionItems) {
    const bom = boms.find((row) => row.id === item.bomId)
      ?? boms.find((row) => row.productId === item.productId && row.status === 'active')
    const line = bom?.items.find((row) => row.productId === productId)
    if (line) methods.push(bomConsumptionMethod(line))
  }
  return methods.length > 0 && methods.every((method) => method === 'MANUAL')
}

export function scaleFactor(bom: Bom, plannedQty: number) {
  return bom.outputQty > 0 ? plannedQty / bom.outputQty : 0
}

export function scaledRequiredQty(item: BomItem, factor: number, withWastage = false) {
  const base = item.qty * factor
  return round2(withWastage ? base * (1 + item.wastagePct / 100) : base)
}

export function bomLinesForQty(bom: Bom, plannedQty: number): ProductionConsumption[] {
  const factor = scaleFactor(bom, plannedQty)
  return bom.items.map((item) => {
    const expectedQty = scaledRequiredQty(item, factor, true)
    return {
      productId: item.productId,
      expectedQty,
      actualQty: expectedQty,
      unit: item.unit,
      notes: item.notes,
      consumptionMethod: bomConsumptionMethod(item),
    }
  })
}

export function bomMaterialCost(state: AppState, bom: Bom, qty = bom.outputQty) {
  return bomMaterialCostFromProducts(state.products, bom, qty, true)
}

export function consumptionCost(state: AppState, consumptions: ProductionConsumption[]) {
  return round2(
    consumptions.reduce((sum, line) => {
      const product = state.products.find((p) => p.id === line.productId)
      const qty = product ? qtyToBaseUnit(line.actualQty, line.unit, product) ?? line.actualQty : line.actualQty
      return sum + qty * baseUnitCost(product ?? { costPrice: 0, unit: line.unit })
    }, 0),
  )
}

export type MaterialCheckRow = {
  productId: string
  required: number
  available: number
  shortage: number
  unit: string
  status: 'enough' | 'low' | 'shortage'
}

export function materialAvailability(
  state: AppState,
  warehouseId: string,
  consumptions: ProductionConsumption[],
): MaterialCheckRow[] {
  return consumptions.map((line) => {
    const product = state.products.find((p) => p.id === line.productId)
    const available = state.inventory.find((row) => row.productId === line.productId && row.warehouseId === warehouseId)?.qty ?? 0
    const required = line.expectedQty
    const shortage = round2(Math.max(0, required - available))
    const status: MaterialCheckRow['status'] =
      available < required ? 'shortage' : available <= (product?.reorderLevel ?? 0) ? 'low' : 'enough'
    return {
      productId: line.productId,
      required,
      available: round2(available),
      shortage,
      unit: line.unit || product?.unit || 'KG',
      status,
    }
  })
}

export function hasShortage(rows: MaterialCheckRow[]) {
  return rows.some((row) => row.status === 'shortage')
}

export function orderWastageQty(order: ProductionOrder) {
  const yieldLoss = Math.max(0, order.plannedQty - (order.actualQty || 0))
  const recorded = order.wastage.reduce((sum, row) => sum + row.qty, 0)
  if (order.status === 'completed') return round2(Math.max(yieldLoss, recorded) || recorded)
  return round2(recorded)
}

export function productionStatusLabel(status: string) {
  const map: Record<string, string> = {
    draft: 'Draft',
    planned: 'Planned',
    accepted: 'Accepted',
    in_progress: 'In Progress',
    paused: 'Paused',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }
  return map[status] ?? status
}

export function wastageKindLabel(kind: string) {
  const map: Record<string, string> = {
    material: 'Material wastage',
    process_loss: 'Process loss',
    damaged_fg: 'Damaged finished goods',
    yield_variance: 'Yield variance',
  }
  return map[kind] ?? kind
}

export function finishedProductIds(state: AppState) {
  return [...new Set(state.boms.map((bom) => bom.productId))]
}

export function rawMaterialIds(state: AppState) {
  return [...new Set(state.boms.flatMap((bom) => bom.items.map((item) => item.productId)))]
}

export function dateInputValue(iso: string) {
  return iso.slice(0, 10)
}

export function toLocalIso(date: string, hour = 8) {
  return `${date}T${String(hour).padStart(2, '0')}:00:00+08:00`
}
