import type { AppState, MaterialClosingLine, Product, ProductionMaterialAllocation, ProductionSession } from '@/types'
import { formatUnit, qtyToBaseUnit, unitsEqual, validatePurchaseConversion } from '@/features/products/masterData'
import { formatQty, round2 } from '@/utils/format'
import { buildSessionPlan, isRawStorePickingLine, suggestPurchasePick } from './sessionPlan'

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

/** Raw-material picking lines allocated to this session. Excludes fresh-bulk and production-balance lines. */
export function sessionRawPickingLines(session: Pick<ProductionSession, 'picking'>, productId: string) {
  return (session.picking ?? []).filter((line) => line.productId === productId && isRawStorePickingLine(line))
}

export function usesAllocationLedger(session: Pick<ProductionSession, 'materialAllocations'>) {
  return Array.isArray(session.materialAllocations)
}

export function allocationsForProduct(
  session: Pick<ProductionSession, 'materialAllocations'>,
  productId: string,
): ProductionMaterialAllocation[] {
  return (session.materialAllocations ?? []).filter((row) => row.productId === productId)
}

export function allocationLabel(row: Pick<ProductionMaterialAllocation, 'source' | 'purchaseQty' | 'purchaseUnit' | 'baseQty' | 'baseUnit' | 'containerType'>) {
  if (row.source === 'loose') {
    const container = row.containerType ? ` · ${row.containerType}` : ''
    return `${formatQty(row.baseQty)} ${formatUnit(row.baseUnit)}${container}`
  }
  if (row.purchaseQty != null && row.purchaseUnit) {
    return `${formatQty(row.purchaseQty)} ${formatUnit(row.purchaseUnit)} (${formatQty(row.baseQty)} ${formatUnit(row.baseUnit)})`
  }
  return `${formatQty(row.baseQty)} ${formatUnit(row.baseUnit)}`
}

/**
 * Quantity allocated to this production session.
 * New sessions (materialAllocations is an array) sum the session ledger.
 * Legacy sessions without a ledger fall back to stored raw-* picking qtyToPick.
 */
export function sessionAllocatedQty(
  session: Pick<ProductionSession, 'picking' | 'materialAllocations'>,
  product: Pick<Product, 'unit' | 'purchaseUnit' | 'purchaseConversionQty'> | undefined,
  productId: string,
) {
  if (usesAllocationLedger(session)) {
    return round2(allocationsForProduct(session, productId).reduce((sum, row) => sum + row.baseQty, 0))
  }
  const lines = sessionRawPickingLines(session, productId)
  if (!lines.length) return null
  return round2(
    lines.reduce((sum, line) => {
      const qty = product ? qtyToBaseUnit(line.qtyToPick, line.unit, product) ?? line.qtyToPick : line.qtyToPick
      return sum + qty
    }, 0),
  )
}

export function additionalRequiredPick(
  session: Pick<ProductionSession, 'picking' | 'materialAllocations'>,
  product: Pick<Product, 'id' | 'unit' | 'purchaseUnit' | 'purchaseConversionQty'> | undefined,
  productId: string,
  plannedBaseQty: number,
) {
  const allocated = sessionAllocatedQty(session, product, productId) ?? 0
  const shortfall = round2(Math.max(0, plannedBaseQty - allocated))
  const suggestion = suggestPurchasePick(product, shortfall)
  return { ...suggestion, allocated, shortfall }
}

export function plannedClosingMaterials(state: AppState, session: ProductionSession): ClosingDraftMaterial[] {
  const plan = buildSessionPlan(state, session)
  return plan.consolidatedRaw
    .filter((row) => row.qty > 0)
    .map((row) => {
      const product = state.products.find((item) => item.id === row.productId)
      const plannedQty = product ? qtyToBaseUnit(row.qty, row.unit, product) ?? row.qty : row.qty
      const allocated = sessionAllocatedQty(session, product, row.productId)
      return {
        productId: row.productId,
        plannedQty: round2(plannedQty),
        availableQty: round2(allocated == null ? plannedQty : allocated),
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

export function expectedRemainingQty(allocatedQty: number, plannedQty: number) {
  return round2(allocatedQty - plannedQty)
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
    return { ok: false, reason: 'Physical remaining cannot exceed material allocated to this production session.' }
  }
  const actualUsedQty = round2(availableQty - remaining.remaining)
  if (actualUsedQty < 0) {
    return { ok: false, reason: 'Actual used cannot be negative.' }
  }
  const varianceQty = round2(actualUsedQty - plannedQty)
  const variancePercent = plannedQty === 0 ? (actualUsedQty === 0 ? 0 : 100) : round2((varianceQty / Math.abs(plannedQty)) * 100)
  return {
    ok: true,
    line: {
      productId: product.id,
      plannedQty: round2(plannedQty),
      availableQty: round2(availableQty),
      expectedRemainingQty: expectedRemainingQty(availableQty, plannedQty),
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
  if (isSignificantVariance(line)) return 'significant' as const
  return line.varianceQty > 0 ? 'high' as const : 'low' as const
}

export function varianceLabel(line: Pick<MaterialClosingLine, 'varianceQty' | 'variancePercent'>) {
  if (line.varianceQty === 0) return 'Within expected usage'
  if (isSignificantVariance(line)) return 'Significant material variance'
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
