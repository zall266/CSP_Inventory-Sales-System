import type { ImportBatch, ImportFile, Product, SalesImportAccount, SalesImportLine, SalesImportMapping, SalesImportOrder, SalesImportOrderStatus, SalesImportParsedLine, SalesImportShipment } from '@/types'
import { salesComponentsOf } from '@/features/products/salesComponents'
import { externalLabel, resolveLineProduct } from '@/features/salesImport/mapping'
import { round2 } from '@/utils/format'

export const SALES_IMPORT_WAREHOUSE_ID = 'wh-main'

export function saleReference(platform: string, accountName: string, externalOrderId: string) {
  return `${platform.trim().toUpperCase()}:${accountName.trim()}:${externalOrderId.trim()}`
}

export function takenOrderIds(input: {
  platform: ImportBatch['platform']
  accountId: string
  accountName: string
  exceptBatchId?: string
  orders: SalesImportOrder[]
  batches: ImportBatch[]
  sales: Array<{ id: string; status: string; reference?: string }>
}) {
  const taken = new Set<string>()
  for (const order of input.orders) {
    if (order.status !== 'confirmed' || !order.saleId) continue
    if (input.exceptBatchId && order.batchId === input.exceptBatchId) continue
    const batch = input.batches.find((item) => item.id === order.batchId)
    if (!batch || batch.platform !== input.platform || batch.accountId !== input.accountId) continue
    const sale = input.sales.find((item) => item.id === order.saleId)
    if (!sale || sale.status === 'voided') continue
    taken.add(order.externalOrderId)
  }
  const prefix = `${input.platform.toUpperCase()}:${input.accountName.trim()}:`
  for (const sale of input.sales) {
    if (sale.status === 'voided' || !sale.reference?.startsWith(prefix)) continue
    taken.add(sale.reference.slice(prefix.length))
  }
  return taken
}

export type DraftLine = {
  externalProductName: string
  variationText?: string
  parentSku?: string
  externalSku?: string
  quantity: number
  unallocated: boolean
  quantityReview?: boolean
  sharedOrderCount?: number
  mappedProductId?: string
  suggestionId?: string
}

export type DraftOrder = {
  externalOrderId: string
  customerMessage?: string
  status: SalesImportOrderStatus
  fileId?: string
  lines: DraftLine[]
}

export function materializeOrders(input: {
  files: ImportFile[]
  mappings: SalesImportMapping[]
  products: Product[]
  platform: ImportBatch['platform']
  accountId: string
  takenOrderIds: Set<string>
}): DraftOrder[] {
  const buckets = new Map<string, { fileId?: string; message?: string; lines: DraftLine[]; unallocated: boolean }>()
  const sharedIds = new Set<string>()
  for (const file of input.files) {
    if (file.parseError) continue
    for (const message of file.customerMessages ?? []) {
      const bucket = buckets.get(message.orderId) ?? { fileId: file.id, lines: [], unallocated: false }
      bucket.message = message.message
      buckets.set(message.orderId, bucket)
    }
    for (const parsed of file.parsedLines ?? []) {
      if (!parsed.orderIds.length) continue
      const shared = parsed.orderIds.length > 1
      if (shared) for (const id of parsed.orderIds) sharedIds.add(id)
      for (const orderId of parsed.orderIds) {
        const bucket = buckets.get(orderId) ?? { fileId: file.id, lines: [], unallocated: false }
        if (!bucket.fileId) bucket.fileId = file.id
        const resolved = resolveLineProduct(parsed, input.platform, input.accountId, input.mappings, input.products)
        bucket.lines.push(draftLine(parsed, shared, resolved.productId, resolved.suggestionId))
        buckets.set(orderId, bucket)
      }
    }
  }
  const drafts: DraftOrder[] = []
  for (const [externalOrderId, bucket] of buckets) {
    if (!bucket.lines.length) continue
    const unallocated = sharedIds.has(externalOrderId) || bucket.lines.some((line) => line.unallocated)
    const lines = bucket.lines.map((line) => (unallocated ? { ...line, unallocated: true } : line))
    drafts.push({
      externalOrderId,
      customerMessage: bucket.message,
      fileId: bucket.fileId,
      lines,
      status: draftStatus(externalOrderId, lines, input.takenOrderIds),
    })
  }
  return drafts.sort((a, b) => a.externalOrderId.localeCompare(b.externalOrderId))
}

function draftLine(parsed: SalesImportParsedLine, shared: boolean, productId?: string, suggestionId?: string): DraftLine {
  return {
    externalProductName: parsed.externalProductName,
    variationText: parsed.variationText,
    parentSku: parsed.parentSku,
    externalSku: parsed.externalSku,
    quantity: parsed.quantity,
    unallocated: shared,
    sharedOrderCount: shared ? parsed.orderIds.length : undefined,
    mappedProductId: productId,
    suggestionId,
  }
}

function draftStatus(externalOrderId: string, lines: DraftLine[], taken: Set<string>): SalesImportOrderStatus {
  if (taken.has(externalOrderId)) return 'duplicate'
  if (!lines.length || lines.some((line) => !(line.quantity > 0))) return 'error'
  if (lines.some((line) => line.unallocated)) return 'unallocated'
  if (lines.some((line) => line.quantityReview)) return 'error'
  if (lines.some((line) => !line.mappedProductId)) return 'unmapped'
  return 'new'
}

export function accountIssues(accountName: string, files: ImportFile[], acknowledged?: boolean) {
  const expected = accountName.trim().toLowerCase()
  const mismatchNames = new Set<string>()
  let unknown = false
  for (const file of files) {
    if (file.parseError) continue
    if (file.role === 'awb') {
      if (file.identityReliable && file.detectedUsername?.trim() && file.detectedUsername.trim().toLowerCase() !== expected) {
        mismatchNames.add(file.detectedUsername.trim())
      }
      continue
    }
    if (file.role !== 'picking' || !file.parsedLines?.length) continue
    if (file.identityReliable && file.detectedUsername?.trim()) {
      if (file.detectedUsername.trim().toLowerCase() !== expected) mismatchNames.add(file.detectedUsername.trim())
    } else unknown = true
  }
  return {
    mismatch: mismatchNames.size > 0,
    mismatchNames: [...mismatchNames],
    needsAcknowledgement: unknown && !acknowledged,
  }
}

export function liveOrderStatus(order: SalesImportOrder, lines: SalesImportLine[], takenOrderIds: Set<string>): SalesImportOrderStatus {
  if (order.status === 'confirmed' && order.saleId) return 'confirmed'
  const own = lines.filter((line) => line.orderId === order.id)
  return draftStatus(order.externalOrderId, own.map((line) => ({
    externalProductName: line.externalProductName,
    variationText: line.variationText,
    parentSku: line.parentSku,
    externalSku: line.externalSku,
    quantity: line.quantity,
    unallocated: Boolean(line.unallocated),
    quantityReview: Boolean(line.quantityReview),
    sharedOrderCount: line.sharedOrderCount,
    mappedProductId: line.mappedProductId,
  })), takenOrderIds)
}

export function deriveBatchStatus(orders: Array<{ status: SalesImportOrderStatus }>, fileCount: number): ImportBatch['status'] {
  if (!fileCount) return 'draft'
  const confirmed = orders.filter((order) => order.status === 'confirmed')
  const unresolved = orders.filter((order) => order.status !== 'confirmed' && order.status !== 'duplicate')
  if (confirmed.length && unresolved.length) return 'partial'
  if (confirmed.length && !unresolved.length) return 'confirmed'
  return 'ready'
}

export function requiredStock(lines: SalesImportLine[], products: Product[]) {
  const required = new Map<string, number>()
  for (const line of lines) {
    if (line.unallocated || !line.mappedProductId || !(line.quantity > 0)) continue
    const product = products.find((item) => item.id === line.mappedProductId)
    if (!product) continue
    const components = salesComponentsOf(product)
    if (components.length) {
      for (const component of components) {
        required.set(component.productId, round2((required.get(component.productId) ?? 0) + round2(line.quantity * component.qty)))
      }
    } else {
      required.set(product.id, round2((required.get(product.id) ?? 0) + line.quantity))
    }
  }
  return required
}

export type ImportAssessment = {
  fileCount: number
  orderCount: number
  newOrders: number
  duplicates: number
  unmapped: number
  unallocated: number
  errors: number
  mismatch: boolean
  mismatchNames: string[]
  needsAcknowledgement: boolean
  readyOrderIds: string[]
  shortages: Array<{ productId: string; name: string; required: number; available: number }>
  blockers: string[]
  canConfirm: boolean
  issues: Array<{ orderId: string; externalOrderId: string; label: string }>
}

export function assessSalesImport(input: {
  account: SalesImportAccount
  batch: ImportBatch
  files: ImportFile[]
  orders: SalesImportOrder[]
  lines: SalesImportLine[]
  products: Product[]
  takenOrderIds: Set<string>
  allowNegativeStock: boolean
  availableQty: (productId: string) => number
}): ImportAssessment {
  const files = input.files.filter((file) => file.batchId === input.batch.id)
  const pickingFiles = files.filter((file) => file.role !== 'awb')
  const orders = input.orders.filter((order) => order.batchId === input.batch.id)
  const account = accountIssues(input.account.name, files, input.batch.accountAcknowledged)
  const statuses = orders.map((order) => ({ order, status: liveOrderStatus(order, input.lines, input.takenOrderIds) }))
  const ready = statuses.filter((row) => row.status === 'new').map((row) => row.order)
  const readyLines = input.lines.filter((line) => ready.some((order) => order.id === line.orderId) && !line.unallocated)
  const shortages: ImportAssessment['shortages'] = []
  if (!input.allowNegativeStock) {
    for (const [productId, qty] of requiredStock(readyLines, input.products)) {
      const available = input.availableQty(productId)
      if (qty > available) {
        const product = input.products.find((item) => item.id === productId)
        shortages.push({ productId, name: product?.name ?? 'Item', required: qty, available })
      }
    }
  }
  const blockers: string[] = []
  if (account.mismatch) blockers.push(`Account mismatch. File username ${account.mismatchNames.join(', ')} does not match ${input.account.name}.`)
  if (account.needsAcknowledgement) blockers.push('Acknowledge that these files belong to the selected platform and account.')
  if (shortages.length) blockers.push('Insufficient stock. Nothing will be posted until the full confirm set is available.')
  const issues = statuses
    .filter((row) => row.status !== 'new' && row.status !== 'confirmed')
    .map((row) => ({
      orderId: row.order.id,
      externalOrderId: row.order.externalOrderId,
      label: issueLabel(row.status, input.lines.filter((line) => line.orderId === row.order.id)),
    }))
  for (const file of files) {
    if (file.parseError) issues.push({ orderId: file.id, externalOrderId: file.fileName, label: `Parse error: ${file.parseError}` })
    for (const warning of file.warnings ?? []) issues.push({ orderId: file.id, externalOrderId: file.fileName, label: warning })
  }
  for (const shortage of shortages) {
    issues.push({ orderId: shortage.productId, externalOrderId: shortage.name, label: `Insufficient stock. ${shortage.name} has ${shortage.available} available. Required: ${shortage.required}.` })
  }
  const canConfirm = blockers.length === 0 && ready.length > 0
  return {
    fileCount: pickingFiles.length,
    orderCount: orders.length,
    newOrders: statuses.filter((row) => row.status === 'new').length,
    duplicates: statuses.filter((row) => row.status === 'duplicate').length,
    unmapped: statuses.filter((row) => row.status === 'unmapped').length,
    unallocated: statuses.filter((row) => row.status === 'unallocated').length,
    errors: statuses.filter((row) => row.status === 'error').length + files.filter((file) => file.parseError).length,
    mismatch: account.mismatch,
    mismatchNames: account.mismatchNames,
    needsAcknowledgement: account.needsAcknowledgement,
    readyOrderIds: canConfirm ? ready.map((order) => order.id) : [],
    shortages,
    blockers,
    canConfirm,
    issues,
  }
}

function issueLabel(status: SalesImportOrderStatus, lines: SalesImportLine[]) {
  if (status === 'duplicate') return 'Duplicate'
  if (status === 'unallocated') {
    const shared = lines.find((line) => (line.sharedOrderCount ?? 0) > 1)
    if (shared) return `Unallocated quantity. Qty ${shared.quantity} is shared by ${shared.sharedOrderCount} orders.`
    return 'Unallocated quantity'
  }
  if (status === 'unmapped') {
    const missing = lines.find((line) => !line.mappedProductId && !line.unallocated)
    return missing ? `Unmapped: ${externalLabel(missing)}` : 'Unmapped'
  }
  if (status === 'error') {
    if (lines.some((line) => line.quantityReview)) return 'Quantity review. Picking and AWB quantities differ.'
    return 'Validation error'
  }
  return status
}

export type SalesImportPostingSummary = {
  orders: number
  ready: number
  attention: number
  confirmed: number
  duplicates: number
  unmapped: number
  unallocated: number
  errors: number
  importedQty: number
  postQty: number
  heldQty: number
  products: Array<{ productId: string; name: string; qty: number }>
  reasons: Array<{ label: string; count: number }>
  mappingOk: boolean
  inventoryOk: boolean
  awb: { matched: number; pending: number; unmatched: number; review: number }
  postOrderIds: string[]
}

export function salesImportSummary(input: {
  assessment: ImportAssessment
  orders: SalesImportOrder[]
  lines: SalesImportLine[]
  products: Product[]
  shipments: SalesImportShipment[]
  takenOrderIds: Set<string>
}): SalesImportPostingSummary {
  const postOrderIds = input.assessment.canConfirm ? input.assessment.readyOrderIds : []
  const postIds = new Set(postOrderIds)
  const statuses = input.orders.map((order) => ({ order, status: liveOrderStatus(order, input.lines, input.takenOrderIds) }))
  const seenImported = new Set<string>()
  let importedQty = 0
  for (const row of statuses) {
    if (row.status === 'confirmed') continue
    for (const line of input.lines.filter((item) => item.orderId === row.order.id)) {
      const shared = Boolean(line.unallocated) && (line.sharedOrderCount ?? 0) > 1
      const key = shared
        ? `shared:${line.externalSku ?? ''}:${line.parentSku ?? ''}:${line.externalProductName}:${line.variationText ?? ''}:${line.quantity}:${line.sharedOrderCount}`
        : line.id
      if (seenImported.has(key)) continue
      seenImported.add(key)
      importedQty = round2(importedQty + line.quantity)
    }
  }
  const postLines = input.lines.filter((line) => postIds.has(line.orderId) && !line.unallocated && line.mappedProductId && line.quantity > 0)
  const products = new Map<string, { productId: string; name: string; qty: number }>()
  let postQty = 0
  for (const line of postLines) {
    const productId = line.mappedProductId!
    const product = input.products.find((item) => item.id === productId)
    const current = products.get(productId) ?? { productId, name: product?.name || line.mappedProductSnapshot?.productName || 'Product', qty: 0 }
    current.qty = round2(current.qty + line.quantity)
    products.set(productId, current)
    postQty = round2(postQty + line.quantity)
  }
  const reasons = new Map<string, number>()
  for (const row of statuses) {
    if (row.status === 'confirmed' || postIds.has(row.order.id)) continue
    const label = attentionReason(row.status, input.assessment)
    reasons.set(label, (reasons.get(label) ?? 0) + 1)
  }
  const pending = input.orders.filter((order) => !input.shipments.some((shipment) => shipment.externalOrderId === order.externalOrderId)).length
  return {
    orders: input.assessment.orderCount,
    ready: postOrderIds.length,
    attention: statuses.filter((row) => row.status !== 'confirmed' && !postIds.has(row.order.id)).length,
    confirmed: statuses.filter((row) => row.status === 'confirmed').length,
    duplicates: input.assessment.duplicates,
    unmapped: input.assessment.unmapped,
    unallocated: input.assessment.unallocated,
    errors: statuses.filter((row) => row.status === 'error').length,
    importedQty,
    postQty,
    heldQty: round2(importedQty - postQty),
    products: [...products.values()],
    reasons: [...reasons.entries()].map(([label, count]) => ({ label, count })),
    mappingOk: input.assessment.unmapped === 0,
    inventoryOk: input.assessment.shortages.length === 0,
    awb: {
      matched: input.shipments.filter((shipment) => shipment.linkStatus === 'matched').length,
      pending,
      unmatched: input.shipments.filter((shipment) => shipment.linkStatus === 'unmatched').length,
      review: input.shipments.filter((shipment) => shipment.linkStatus === 'review').length,
    },
    postOrderIds,
  }
}

function attentionReason(status: SalesImportOrderStatus, assessment: ImportAssessment) {
  if (status === 'duplicate') return 'Duplicate'
  if (status === 'unallocated') return 'Unallocated quantity'
  if (status === 'unmapped') return 'Unmapped product'
  if (status === 'error') return 'Quantity review'
  if (assessment.mismatch) return 'Account mismatch'
  if (assessment.needsAcknowledgement) return 'Acknowledgement required'
  if (assessment.shortages.length) return 'Inventory'
  return 'Needs attention'
}

export function batchStatusLabel(status: ImportBatch['status']) {
  if (status === 'draft') return 'Draft'
  if (status === 'ready') return 'Ready to Review'
  if (status === 'partial') return 'Partially Confirmed'
  return 'Confirmed'
}
