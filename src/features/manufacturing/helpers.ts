import type { AppState, Bom, BomItem, ProductionConsumption, ProductionOrder } from '@/types'
import { round2 } from '@/utils/format'

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
    }
  })
}

export function bomMaterialCost(state: AppState, bom: Bom, qty = bom.outputQty) {
  const factor = scaleFactor(bom, qty)
  return round2(
    bom.items.reduce((sum, item) => {
      const cost = state.products.find((p) => p.id === item.productId)?.costPrice ?? 0
      return sum + scaledRequiredQty(item, factor, true) * cost
    }, 0),
  )
}

export function consumptionCost(state: AppState, consumptions: ProductionConsumption[]) {
  return round2(
    consumptions.reduce((sum, line) => {
      const cost = state.products.find((p) => p.id === line.productId)?.costPrice ?? 0
      return sum + line.actualQty * cost
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
