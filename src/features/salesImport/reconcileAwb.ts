import type { SalesImportLine, SalesImportOrder, SalesImportShipment } from '@/types'

const GENERIC = new Set(['ready', 'stock', 'serbuk', 'premium', 'crispy', 'series', 'air', 'balang', 'pelbagai', 'perisa', 'viral', 'pack', 'minuman'])

function tokens(value: string) {
  return value
    .toLowerCase()
    .replace(/ready\s+stock/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 2 && !GENERIC.has(token))
}

function overlap(left: string[], right: string[]) {
  if (!left.length || !right.length) return 0
  let shared = 0
  for (const token of left) if (right.includes(token)) shared += 1
  return shared / Math.min(left.length, right.length)
}

function sameProduct(line: Pick<SalesImportLine, 'externalProductName' | 'variationText' | 'externalSku' | 'parentSku'>, packing: SalesImportShipment['packingLines'][number]) {
  const leftSku = line.externalSku?.trim()
  const rightSku = packing.externalSku?.trim()
  if (leftSku && rightSku) return leftSku === rightSku
  if (leftSku && packing.variationText?.includes(leftSku)) return true
  const leftVariation = tokens(line.variationText ?? '')
  const rightVariation = tokens(packing.variationText ?? '')
  if (leftVariation.length && rightVariation.length) return overlap(leftVariation, rightVariation) >= 0.6
  const left = tokens(`${line.externalProductName} ${line.variationText ?? ''}`)
  const right = tokens(`${packing.externalProductName} ${packing.variationText ?? ''}`)
  return overlap(left, right) >= 0.6
}

export function awbQuantityFor(line: SalesImportLine, orderId: string, shipments: SalesImportShipment[]) {
  const matches = shipments
    .filter((shipment) => shipment.externalOrderId === orderId)
    .flatMap((shipment) => shipment.packingLines)
    .filter((packing) => sameProduct(line, packing))
  if (!matches.length) return undefined
  return matches.reduce((sum, packing) => sum + packing.quantity, 0)
}

export function reconcileAwbLines(input: {
  orders: SalesImportOrder[]
  lines: SalesImportLine[]
  shipments: SalesImportShipment[]
}) {
  const openIds = new Set(input.orders.filter((order) => !(order.status === 'confirmed' && order.saleId)).map((order) => order.id))
  const orderNo = new Map(input.orders.map((order) => [order.id, order.externalOrderId]))
  const lines = input.lines.map((line) => ({ ...line }))
  const reviewOrderIds = new Set<string>()
  const groups = new Map<string, SalesImportLine[]>()
  for (const line of lines) {
    if (!openIds.has(line.orderId) || !line.unallocated || (line.sharedOrderCount ?? 0) < 2) continue
    const key = `${line.externalSku ?? ''}|${line.parentSku ?? ''}|${tokens(line.externalProductName).join('-')}|${tokens(line.variationText ?? '').join('-')}|${line.quantity}|${line.sharedOrderCount}`
    const group = groups.get(key) ?? []
    group.push(line)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    const expected = group[0]?.sharedOrderCount ?? 0
    const sharedQty = group[0]?.quantity ?? 0
    if (group.length !== expected) continue
    const allocated = group.map((line) => {
      const orderId = orderNo.get(line.orderId) ?? ''
      return { line, qty: awbQuantityFor(line, orderId, input.shipments) }
    })
    const sum = allocated.reduce((total, row) => total + (row.qty ?? 0), 0)
    const comparable = allocated.every((row) => row.qty !== undefined && row.qty > 0)
    if (!comparable || sum !== sharedQty) {
      if (comparable && sum !== sharedQty) {
        for (const row of allocated) {
          row.line.quantityReview = true
          reviewOrderIds.add(orderNo.get(row.line.orderId) ?? '')
        }
      }
      continue
    }
    for (const row of allocated) {
      row.line.pickingQuantity = sharedQty
      row.line.quantity = row.qty ?? row.line.quantity
      row.line.quantitySource = 'awb'
      row.line.unallocated = undefined
    }
  }
  for (const line of lines) {
    if (!openIds.has(line.orderId) || line.quantitySource === 'awb' || line.quantityReview) continue
    const orderId = orderNo.get(line.orderId) ?? ''
    const awbQty = awbQuantityFor(line, orderId, input.shipments)
    if (awbQty === undefined) continue
    const shared = (line.sharedOrderCount ?? 0) >= 2
    if (line.unallocated && shared) continue
    if (awbQty === line.quantity) {
      if (line.unallocated) {
        line.pickingQuantity = line.quantity
        line.quantitySource = 'awb'
        line.unallocated = undefined
      }
      continue
    }
    line.quantityReview = true
    reviewOrderIds.add(orderId)
  }
  return { lines, reviewOrderIds }
}

export function shipmentLinkStatus(input: {
  externalOrderId: string
  trackingNumber: string
  knownOrderIds: Set<string>
  siblingTrackings: string[]
  reviewOrderIds: Set<string>
}): SalesImportShipment['linkStatus'] {
  if (!input.knownOrderIds.has(input.externalOrderId)) return 'unmatched'
  const distinct = new Set(input.siblingTrackings)
  if (distinct.size > 1) return 'review'
  if (input.reviewOrderIds.has(input.externalOrderId)) return 'review'
  return 'matched'
}
