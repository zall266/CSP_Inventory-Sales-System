import type { AppState, Bom, PickingLine, ProductionBalance, ProductionSession, ProductionSessionStatus, UserRole } from '@/types'
import { round2 } from '@/utils/format'
import { scaledRequiredQty } from './helpers'

export function roleLabel(role: UserRole) {
  if (role === 'manager') return 'Supervisor'
  if (role === 'warehouse') return 'Warehouse'
  return role.charAt(0).toUpperCase() + role.slice(1)
}

export function currentUser(state: AppState) {
  return state.users.find((user) => user.id === state.ui.currentUserId) ?? state.users[0]
}

export function canEditSession(role: UserRole, status: ProductionSessionStatus) {
  if (status === 'completed') return role === 'admin' || role === 'owner'
  return role === 'staff' || role === 'warehouse' || role === 'manager' || role === 'admin' || role === 'owner'
}

export function canEditCompleted(role: UserRole) {
  return role === 'admin' || role === 'owner'
}

export function canRunProduction(role: UserRole) {
  return role === 'staff' || role === 'warehouse' || role === 'manager' || role === 'admin' || role === 'owner'
}

export function sessionStatusLabel(status: string) {
  const map: Record<string, string> = {
    planned: 'Planned',
    accepted: 'Accepted',
    in_progress: 'In Progress',
    completed: 'Completed',
  }
  return map[status] ?? status
}

export function toDisplayQty(qty: number, unit: string) {
  if (unit === 'KG' || unit === 'kg') return { qty: round2(qty * 1000), unit: 'g' }
  return { qty: round2(qty), unit }
}

export function fromDisplayQty(qty: number, unit: string) {
  if (unit === 'g') return { qty: round2(qty / 1000), unit: 'KG' }
  return { qty: round2(qty), unit }
}

export function bomForProduct(state: AppState, productId: string) {
  return state.boms.find((bom) => bom.productId === productId && bom.status === 'active')
}

export function gramsPerPack(bom: Bom) {
  if (bom.bulkYieldGrams && bom.outputQty > 0) return bom.bulkYieldGrams / bom.outputQty
  return 0
}

export function bulkRequiredGrams(bom: Bom, packs: number) {
  return round2(gramsPerPack(bom) * packs)
}

export type BalanceAlloc = {
  balanceId: string
  qty: number
  location: string
  container: string
  date: string
  reference: string
}

export function allocateBalanceFifo(
  balances: ProductionBalance[],
  productId: string,
  requiredG: number,
): { used: BalanceAlloc[]; remainingRequired: number } {
  const available = balances
    .filter((row) => row.productId === productId && row.status === 'available' && row.quantity > 0)
    .slice()
    .sort((a, b) => a.productionDate.localeCompare(b.productionDate) || a.id.localeCompare(b.id))
  let need = requiredG
  const used: BalanceAlloc[] = []
  for (const row of available) {
    if (need <= 0) break
    const take = round2(Math.min(row.quantity, need))
    if (take <= 0) continue
    used.push({
      balanceId: row.id,
      qty: take,
      location: row.location,
      container: row.container,
      date: row.productionDate,
      reference: row.productionReference,
    })
    need = round2(need - take)
  }
  return { used, remainingRequired: need }
}

export function isPackagingLine(state: AppState, productId: string, unit: string) {
  const product = state.products.find((item) => item.id === productId)
  return unit === 'pcs' || product?.categoryId === 'cat-pack'
}

export type ProductRequirement = {
  productId: string
  bom: Bom
  targetQty: number
  bulkRequiredG: number
  balanceUsed: BalanceAlloc[]
  balanceUsedG: number
  freshBulkG: number
}

export type ConsolidatedRaw = {
  productId: string
  qty: number
  grossQty: number
  unit: string
  requiredG: number
  grossG: number
}

export type SessionPlan = {
  products: ProductRequirement[]
  consolidatedRaw: ConsolidatedRaw[]
  picking: PickingLine[]
}

export function buildSessionPlan(state: AppState, session: ProductionSession): SessionPlan {
  const products: ProductRequirement[] = []
  const rawMap = new Map<string, { productId: string; qty: number; grossQty: number; unit: string }>()

  for (const item of session.items) {
    const bom = state.boms.find((row) => row.id === item.bomId) ?? bomForProduct(state, item.productId)
    if (!bom) continue
    const bulkRequiredG = bulkRequiredGrams(bom, item.targetQty)
    const { used, remainingRequired } = allocateBalanceFifo(state.productionBalances, item.productId, bulkRequiredG)
    const balanceUsedG = round2(used.reduce((sum, row) => sum + row.qty, 0))
    const freshBulkG = remainingRequired
    products.push({
      productId: item.productId,
      bom,
      targetQty: item.targetQty,
      bulkRequiredG,
      balanceUsed: used,
      balanceUsedG,
      freshBulkG,
    })

    const yieldG = bom.bulkYieldGrams || bulkRequiredG || 1
    for (const line of bom.items) {
      const packaging = isPackagingLine(state, line.productId, line.unit)
      const factor = bom.outputQty > 0 ? item.targetQty / bom.outputQty : 0
      const grossQty = packaging
        ? scaledRequiredQty(line, factor, true)
        : round2(line.qty * (bulkRequiredG / yieldG) * (1 + line.wastagePct / 100))
      const qty = packaging
        ? grossQty
        : round2(line.qty * (freshBulkG / yieldG) * (1 + line.wastagePct / 100))
      const existing = rawMap.get(line.productId)
      if (existing) {
        existing.qty = round2(existing.qty + qty)
        existing.grossQty = round2(existing.grossQty + grossQty)
      } else {
        rawMap.set(line.productId, { productId: line.productId, qty, grossQty, unit: line.unit })
      }
    }
  }

  const consolidatedRaw = [...rawMap.values()].map((row) => {
    const display = toDisplayQty(row.qty, row.unit)
    const gross = toDisplayQty(row.grossQty, row.unit)
    return {
      ...row,
      requiredG: display.unit === 'g' ? display.qty : row.qty,
      grossG: gross.unit === 'g' ? gross.qty : row.grossQty,
    }
  })

  const picking: PickingLine[] = []
  for (const req of products) {
    const product = state.products.find((item) => item.id === req.productId)
    for (const alloc of req.balanceUsed) {
      picking.push({
        id: `bal-${req.productId}-${alloc.balanceId}`,
        kind: 'balance',
        productId: req.productId,
        label: `${product?.name ?? 'Product'} production balance`,
        requiredQty: req.bulkRequiredG,
        existingBalanceQty: alloc.qty,
        freshQty: req.freshBulkG,
        qtyToPick: alloc.qty,
        unit: 'g',
        source: `${alloc.location} / ${alloc.container}`,
        location: alloc.location,
        container: alloc.container,
        balanceId: alloc.balanceId,
        picked: false,
      })
    }
    if (req.freshBulkG > 0) {
      picking.push({
        id: `fresh-bulk-${req.productId}`,
        kind: 'raw',
        productId: req.productId,
        label: `Fresh ${product?.name ?? 'product'} to produce`,
        requiredQty: req.bulkRequiredG,
        existingBalanceQty: req.balanceUsedG,
        freshQty: req.freshBulkG,
        qtyToPick: req.freshBulkG,
        unit: 'g',
        source: 'From BOM materials in this list (not a store pick of finished goods)',
        location: 'Process room',
        container: '',
        picked: false,
      })
    }
  }

  for (const row of consolidatedRaw) {
    const product = state.products.find((item) => item.id === row.productId)
    const fresh = toDisplayQty(row.qty, row.unit)
    const gross = toDisplayQty(row.grossQty, row.unit)
    picking.push({
      id: `raw-${row.productId}`,
      kind: 'raw',
      productId: row.productId,
      label: product?.name ?? 'Material',
      requiredQty: gross.qty,
      existingBalanceQty: 0,
      freshQty: fresh.qty,
      qtyToPick: fresh.qty,
      unit: fresh.unit,
      source: 'Raw Material Store',
      location: 'Raw Material Store',
      container: '',
      picked: false,
    })
  }

  return { products, consolidatedRaw, picking }
}

export function mergePicking(previous: PickingLine[], next: PickingLine[]): { picking: PickingLine[]; excess: Array<{ productId: string; qty: number; unit: string }> } {
  const prevById = new Map(previous.map((line) => [line.id, line]))
  const picking = next.map((line) => {
    const old = prevById.get(line.id)
    return {
      ...line,
      picked: old?.picked ?? false,
      previousPickedQty: old?.picked ? old.qtyToPick : undefined,
    }
  })
  const excess: Array<{ productId: string; qty: number; unit: string }> = []
  for (const old of previous) {
    if (!old.picked) continue
    const updated = picking.find((line) => line.id === old.id)
    const newQty = updated?.qtyToPick ?? 0
    const extra = round2(old.qtyToPick - newQty)
    if (extra > 0.001) excess.push({ productId: old.productId, qty: extra, unit: old.unit })
  }
  return { picking, excess }
}

export function sessionTotals(session: ProductionSession) {
  const planned = session.items.reduce((sum, item) => sum + item.targetQty, 0)
  const original = session.items.reduce((sum, item) => sum + item.originalTargetQty, 0)
  const actual = session.items.reduce((sum, item) => sum + (item.actualQty || 0), 0)
  const balance = session.items.reduce((sum, item) => sum + (item.productionBalanceQty || 0), 0)
  const waste = session.items.reduce((sum, item) => sum + (item.wasteQty || 0), 0)
  return { planned, original, actual, balance, waste, products: session.items.length }
}
