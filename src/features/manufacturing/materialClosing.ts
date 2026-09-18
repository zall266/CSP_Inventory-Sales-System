import type { AppState, MaterialClosingLine, Product, ProductionSession } from '@/types'
import { formatUnit, qtyToBaseUnit, unitsEqual, validatePurchaseConversion } from '@/features/products/masterData'
import { round2 } from '@/utils/format'
import { buildSessionPlan } from './sessionPlan'

export const SIGNIFICANT_VARIANCE_PCT = 10

export type ClosingDraftMaterial = {
  productId: string
  plannedQty: number
  availableQty: number
  unit: string
}

export type ClosingInput = {
  productId: string
  fullUnits: number
  looseQty: number
}

export function usesPurchaseUnitSplit(product: Pick<Product, 'unit' | 'purchaseUnit'> | undefined) {
  if (!product) return false
  return !unitsEqual(product.unit, product.purchaseUnit ?? product.unit)
}

export function conversionNote(product: Pick<Product, 'unit' | 'purchaseUnit' | 'purchaseConversionQty'> | undefined) {
  if (!product || !usesPurchaseUnitSplit(product)) return ''
  const conversion = Number(product.purchaseConversionQty)
  if (!Number.isFinite(conversion) || conversion <= 0) return ''
  return `1 ${formatUnit(product.purchaseUnit)} = ${conversion} ${formatUnit(product.unit)}`
}

export function materialAvailableQty(state: Pick<AppState, 'inventory'>, productId: string, warehouseId: string) {
  return state.inventory.find((row) => row.productId === productId && row.warehouseId === warehouseId)?.qty ?? 0
}

export function plannedClosingMaterials(state: AppState, session: ProductionSession): ClosingDraftMaterial[] {
  const plan = buildSessionPlan(state, session)
  return plan.consolidatedRaw
    .filter((row) => row.qty > 0)
    .map((row) => {
      const product = state.products.find((item) => item.id === row.productId)
      const plannedQty = product ? qtyToBaseUnit(row.qty, row.unit, product) ?? row.qty : row.qty
      return {
        productId: row.productId,
        plannedQty: round2(plannedQty),
        availableQty: round2(materialAvailableQty(state, row.productId, session.warehouseId)),
        unit: product?.unit || row.unit,
      }
    })
}

export function physicalRemainingBaseQty(
  product: Pick<Product, 'unit' | 'purchaseUnit' | 'purchaseConversionQty'>,
  fullUnits: number,
  looseQty: number,
): { ok: true; remaining: number } | { ok: false; reason: string } {
  if (!Number.isFinite(fullUnits) || !Number.isFinite(looseQty)) {
    return { ok: false, reason: 'Enter a valid remaining quantity.' }
  }
  if (fullUnits < 0 || looseQty < 0) {
    return { ok: false, reason: 'Quantity cannot be negative.' }
  }
  const conversion = validatePurchaseConversion({
    baseUnit: product.unit,
    purchaseUnit: product.purchaseUnit ?? product.unit,
    conversionQty: product.purchaseConversionQty,
  })
  if (!conversion.ok) return { ok: false, reason: conversion.reason }
  if (usesPurchaseUnitSplit(product)) {
    return { ok: true, remaining: round2(fullUnits * conversion.value + looseQty) }
  }
  if (fullUnits !== 0) {
    return { ok: false, reason: 'Full purchase units are only used when Purchase Unit differs from Base Unit.' }
  }
  return { ok: true, remaining: round2(looseQty) }
}

export function closingLineFromInput(
  product: Pick<Product, 'id' | 'unit' | 'purchaseUnit' | 'purchaseConversionQty'>,
  plannedQty: number,
  availableQty: number,
  input: { fullUnits: number; looseQty: number },
): { ok: true; line: MaterialClosingLine } | { ok: false; reason: string } {
  const remaining = physicalRemainingBaseQty(product, input.fullUnits, input.looseQty)
  if (!remaining.ok) return remaining
  if (remaining.remaining > availableQty) {
    return { ok: false, reason: 'Remaining cannot exceed available.' }
  }
  const actualUsedQty = round2(availableQty - remaining.remaining)
  const varianceQty = round2(actualUsedQty - plannedQty)
  const variancePercent = plannedQty === 0 ? (actualUsedQty === 0 ? 0 : 100) : round2((varianceQty / Math.abs(plannedQty)) * 100)
  return {
    ok: true,
    line: {
      productId: product.id,
      plannedQty: round2(plannedQty),
      availableQty: round2(availableQty),
      remainingQty: remaining.remaining,
      actualUsedQty,
      varianceQty,
      variancePercent,
      fullUnits: usesPurchaseUnitSplit(product) ? input.fullUnits : undefined,
      looseQty: input.looseQty,
    },
  }
}

export function isSignificantVariance(line: Pick<MaterialClosingLine, 'variancePercent'>) {
  return Math.abs(line.variancePercent) > SIGNIFICANT_VARIANCE_PCT
}

export function varianceTone(line: Pick<MaterialClosingLine, 'varianceQty' | 'variancePercent'>) {
  if (line.varianceQty === 0) return 'ok' as const
  if (isSignificantVariance(line)) return line.varianceQty > 0 ? 'high' as const : 'low' as const
  return line.varianceQty > 0 ? 'high' as const : 'low' as const
}

export function varianceLabel(line: Pick<MaterialClosingLine, 'varianceQty'>) {
  if (line.varianceQty === 0) return 'Within expected usage'
  if (line.varianceQty > 0) return 'Higher than planned'
  return 'Lower than planned'
}

export function buildSessionMaterialClosing(
  state: AppState,
  session: ProductionSession,
  inputs: ClosingInput[],
): { ok: true; lines: MaterialClosingLine[] } | { ok: false; reason: string } {
  const drafts = plannedClosingMaterials(state, session)
  const lines: MaterialClosingLine[] = []
  for (const draft of drafts) {
    const product = state.products.find((item) => item.id === draft.productId)
    if (!product) return { ok: false, reason: 'Material is missing from Product Master.' }
    const input = inputs.find((row) => row.productId === draft.productId)
    if (!input) return { ok: false, reason: `Enter remaining quantity for ${product.name}.` }
    const built = closingLineFromInput(product, draft.plannedQty, draft.availableQty, input)
    if (!built.ok) return { ok: false, reason: `${product.name}: ${built.reason}` }
    lines.push(built.line)
  }
  return { ok: true, lines }
}
