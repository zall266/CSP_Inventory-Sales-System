import type { ImportBatch, ImportFile, Product, SalesImportAccount, SalesImportLine, SalesImportMapping, SalesImportOrder, SalesImportOrderStatus, SalesImportParsedLine, SalesImportShipment } from '@/types'
import { salesComponentsOf } from '@/features/products/salesComponents'
import { externalLabel, mappingIdentity, resolveLineProduct } from '@/features/salesImport/mapping'
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

export type ProductDisplayStatus = 'needs-mapping' | 'action-required' | 'ready'

export type ProductReviewRow = {
  key: string
  name: string
  mapped: boolean
  imported: number
  willPost: number
  needReview: number
  confirmed: number
  displayStatus: ProductDisplayStatus
  reasons: string[]
  details: string[]
  keyType?: 'sku' | 'text'
  mapKey?: string
}

export type AttentionItem = {
  id: 'quantity' | 'unallocated' | 'unmapped' | 'duplicate' | 'other' | 'inventory'
  label: string
  orders: number
  units: number
  ok: boolean
  details: string[]
}

export type SalesImportReconciliation = {
  imported: number
  willPost: number
  needReview: number
  alreadyConfirmed: number
  unaccounted: number
  ok: boolean
  products: ProductReviewRow[]
  attention: AttentionItem[]
}

type AccountBucket = 'post' | 'review' | 'confirmed' | 'unaccounted'

function accountKey(line: SalesImportLine) {
  const shared = Boolean(line.unallocated) && (line.sharedOrderCount ?? 0) > 1
  if (!shared) return `line:${line.id}`
  return `shared:${line.externalSku ?? ''}:${line.parentSku ?? ''}:${line.externalProductName}:${line.variationText ?? ''}:${line.quantity}:${line.sharedOrderCount}`
}

function productKey(line: SalesImportLine) {
  if (line.mappedProductId) return `mapped:${line.mappedProductId}`
  return `unmapped:${(line.externalSku ?? '').trim()}|${line.externalProductName}|${line.variationText ?? ''}`
}

function stableProductOrder(rows: ProductReviewRow[]) {
  const rank: Record<ProductDisplayStatus, number> = { 'needs-mapping': 0, 'action-required': 1, ready: 2 }
  return [...rows.filter((row) => rank[row.displayStatus] === 0), ...rows.filter((row) => rank[row.displayStatus] === 1), ...rows.filter((row) => rank[row.displayStatus] === 2)]
}

export function salesImportLinesForBatch(batchId: string, orders: SalesImportOrder[], lines: SalesImportLine[]) {
  const owner = new Map(orders.map((order) => [order.id, order.batchId]))
  return lines.filter((line) => {
    const ownerBatch = owner.get(line.orderId)
    return ownerBatch === undefined || ownerBatch === batchId
  })
}

function productName(line: SalesImportLine, products: Product[]) {
  if (line.mappedProductId) {
    return products.find((item) => item.id === line.mappedProductId)?.name || line.mappedProductSnapshot?.productName || 'Product'
  }
  const variation = line.variationText?.trim()
  if (variation && variation.toLowerCase() !== line.externalProductName.trim().toLowerCase()) return `${line.externalProductName} — ${variation}`
  return line.externalProductName || 'Unmapped product'
}

function rememberLineIssue(row: ProductReviewRow, lines: SalesImportLine[]) {
  for (const line of lines) {
    if (line.unallocated && !row.reasons.includes('Shared quantity is not ready to post.')) row.reasons.push('Shared quantity is not ready to post.')
    if (line.quantityReview && !row.reasons.includes('Quantity mismatch')) {
      row.reasons.push('Quantity mismatch')
      const picking = line.pickingQuantity ?? line.quantity
      const awb = line.quantitySource === 'awb' ? line.quantity : undefined
      if (!row.details.some((detail) => detail.startsWith('Picking:'))) {
        row.details.push(`Picking: ${picking}`)
        if (awb !== undefined) {
          row.details.push(`AWB: ${awb}`)
          row.details.push(`Difference: ${round2(awb - picking)}`)
        }
      }
    }
  }
}

function assignDisplayStatus(rows: ProductReviewRow[], assessment: ImportAssessment, products: Product[]) {
  const shortIds = new Set(assessment.shortages.map((row) => row.productId))
  for (const row of rows) {
    if (!row.mapped) {
      row.displayStatus = 'needs-mapping'
      row.reasons = row.reasons.filter((reason) => reason === 'Shared quantity is not ready to post.' || reason === 'Quantity mismatch')
      continue
    }
    const productId = row.key.startsWith('mapped:') ? row.key.slice('mapped:'.length) : ''
    const product = products.find((item) => item.id === productId)
    const componentShort = product ? salesComponentsOf(product).filter((component) => shortIds.has(component.productId)) : []
    const ownShort = assessment.shortages.find((item) => item.productId === productId)
    const reasons: string[] = row.reasons.filter((reason) => reason === 'Shared quantity is not ready to post.' || reason === 'Quantity mismatch')
    if (ownShort) {
      reasons.push('Stock shortage')
      row.details.push(`Required: ${ownShort.required}`, `Available: ${ownShort.available}`, `Short: ${round2(Math.max(0, ownShort.required - ownShort.available))}`)
    }
    for (const component of componentShort) {
      const shortage = assessment.shortages.find((item) => item.productId === component.productId)
      if (!shortage || reasons.includes('Stock shortage')) continue
      reasons.push('Stock shortage')
      row.details.push(`${shortage.name} required ${shortage.required}, available ${shortage.available}`)
    }
    if (!reasons.length && row.willPost > 0 && row.needReview > 0) reasons.push('Not all of this quantity can be imported yet.')
    row.reasons = reasons
    row.displayStatus = reasons.length ? 'action-required' : 'ready'
    if (row.displayStatus === 'ready') row.reasons = []
  }
}

export function salesImportProductReview(input: {
  assessment: ImportAssessment
  orders: SalesImportOrder[]
  lines: SalesImportLine[]
  products: Product[]
  takenOrderIds: Set<string>
}): SalesImportReconciliation {
  const postIds = new Set(input.assessment.canConfirm ? input.assessment.readyOrderIds : [])
  const orders = new Map(input.orders.map((order) => [order.id, order]))
  const statusOf = new Map(input.orders.map((order) => [order.id, liveOrderStatus(order, input.lines, input.takenOrderIds)]))
  const groups = new Map<string, { qty: number; buckets: Set<AccountBucket>; lines: SalesImportLine[] }>()
  for (const line of input.lines) {
    if (!(line.quantity > 0)) continue
    const order = orders.get(line.orderId)
    const bucket: AccountBucket = !order
      ? 'unaccounted'
      : statusOf.get(order.id) === 'confirmed'
        ? 'confirmed'
        : postIds.has(order.id)
          ? 'post'
          : 'review'
    const key = accountKey(line)
    const group = groups.get(key) ?? { qty: line.quantity, buckets: new Set<AccountBucket>(), lines: [] }
    group.buckets.add(bucket)
    group.lines.push(line)
    if (group.qty !== line.quantity) group.buckets.add('unaccounted')
    groups.set(key, group)
  }
  const totals = { post: 0, review: 0, confirmed: 0, unaccounted: 0, imported: 0 }
  const products = new Map<string, ProductReviewRow>()
  for (const group of groups.values()) {
    totals.imported = round2(totals.imported + group.qty)
    const bucket: AccountBucket = group.buckets.size === 1 ? [...group.buckets][0] : 'unaccounted'
    totals[bucket] = round2(totals[bucket] + group.qty)
    const line = group.lines.find((item) => item.mappedProductId) ?? group.lines[0]
    const key = productKey(line)
    const identity = mappingIdentity(line)
    const row = products.get(key) ?? {
      key,
      name: productName(line, input.products),
      mapped: Boolean(line.mappedProductId),
      imported: 0,
      willPost: 0,
      needReview: 0,
      confirmed: 0,
      displayStatus: line.mappedProductId ? 'ready' : 'needs-mapping',
      reasons: [],
      details: [],
      keyType: line.mappedProductId ? undefined : identity.keyType,
      mapKey: line.mappedProductId ? undefined : identity.key,
    }
    row.imported = round2(row.imported + group.qty)
    if (bucket === 'post') row.willPost = round2(row.willPost + group.qty)
    if (bucket === 'review') row.needReview = round2(row.needReview + group.qty)
    if (bucket === 'confirmed') row.confirmed = round2(row.confirmed + group.qty)
    if (!row.mapped && !line.mappedProductId && !row.mapKey) {
      row.keyType = identity.keyType
      row.mapKey = identity.key
    }
    rememberLineIssue(row, group.lines)
    products.set(key, row)
  }
  assignDisplayStatus([...products.values()], input.assessment, input.products)
  const unaccounted = round2(totals.imported - totals.post - totals.review - totals.confirmed)
  const attentionOrders = (status: SalesImportOrderStatus) => input.orders.filter((order) => statusOf.get(order.id) === status)
  const unitsFor = (orderIds: Set<string>) => {
    const seen = new Set<string>()
    let qty = 0
    for (const line of input.lines) {
      if (!orderIds.has(line.orderId) || !(line.quantity > 0)) continue
      const key = accountKey(line)
      if (seen.has(key)) continue
      seen.add(key)
      qty = round2(qty + line.quantity)
    }
    return qty
  }
  const quantityOrders = attentionOrders('error').filter((order) => input.lines.some((line) => line.orderId === order.id && line.quantityReview))
  const otherOrders = attentionOrders('error').filter((order) => !quantityOrders.some((item) => item.id === order.id))
  const detailFor = (list: SalesImportOrder[], kind: 'quantity' | 'unallocated') => {
    const rows = new Map<string, { name: string; qty: number }>()
    const seen = new Set<string>()
    for (const order of list) {
      for (const line of input.lines.filter((item) => item.orderId === order.id)) {
        if (kind === 'quantity' && !line.quantityReview) continue
        if (kind === 'unallocated' && !line.unallocated) continue
        const key = `${productKey(line)}|${accountKey(line)}`
        if (seen.has(key)) continue
        seen.add(key)
        const current = rows.get(productKey(line)) ?? { name: productName(line, input.products), qty: 0 }
        current.qty = round2(current.qty + line.quantity)
        rows.set(productKey(line), current)
      }
    }
    return [...rows.values()].map((row) => kind === 'unallocated'
      ? `${row.name} — ${row.qty} imported / 0 allocated / ${row.qty} unallocated`
      : `${row.name} — ${row.qty} in quantity review`)
  }
  const quantityIds = new Set(quantityOrders.map((order) => order.id))
  const unallocatedIds = new Set(attentionOrders('unallocated').map((order) => order.id))
  const unmappedIds = new Set(attentionOrders('unmapped').map((order) => order.id))
  const duplicateIds = new Set(attentionOrders('duplicate').map((order) => order.id))
  const otherIds = new Set(otherOrders.map((order) => order.id))
  const attention: AttentionItem[] = [
    { id: 'quantity', label: 'Quantity Review', orders: quantityOrders.length, units: unitsFor(quantityIds), ok: quantityOrders.length === 0, details: detailFor(quantityOrders, 'quantity') },
    { id: 'unallocated', label: 'Unallocated Quantity', orders: unallocatedIds.size, units: unitsFor(unallocatedIds), ok: unallocatedIds.size === 0, details: detailFor(attentionOrders('unallocated'), 'unallocated') },
    { id: 'unmapped', label: 'Unmapped', orders: unmappedIds.size, units: unitsFor(unmappedIds), ok: unmappedIds.size === 0, details: [] },
    { id: 'duplicate', label: 'Duplicate', orders: duplicateIds.size, units: unitsFor(duplicateIds), ok: duplicateIds.size === 0, details: [] },
    { id: 'other', label: 'Other Errors', orders: otherIds.size, units: unitsFor(otherIds), ok: otherIds.size === 0 && input.assessment.blockers.length === 0, details: input.assessment.blockers },
    { id: 'inventory', label: 'Inventory', orders: input.assessment.shortages.length, units: input.assessment.shortages.reduce((sum, row) => round2(sum + Math.max(0, row.required - row.available)), 0), ok: input.assessment.shortages.length === 0, details: input.assessment.shortages.map((row) => `${row.name} — required ${row.required}, available ${row.available}`) },
  ]
  return {
    imported: totals.imported,
    willPost: totals.post,
    needReview: totals.review,
    alreadyConfirmed: totals.confirmed,
    unaccounted,
    ok: unaccounted === 0,
    products: stableProductOrder([...products.values()]),
    attention,
  }
}

export type ActionKind = 'map' | 'quantity' | 'unallocated' | 'stock' | 'duplicate' | 'other'

export type ActionRow = {
  id: string
  product: string
  units: number
  orders: number
  orderRef: string
  picking?: number
  awb?: number
  difference?: number
  imported?: number
  allocated?: number
  unallocatedQty?: number
  required?: number
  available?: number
  short?: number
  status?: string
  keyType?: 'sku' | 'text'
  mapKey?: string
}

export type ActionCategory = {
  id: ActionKind
  title: string
  hint: string
  count: number
  units: number
  orderIds: string[]
  rows: ActionRow[]
}

export type ActionCentre = {
  issues: number
  orders: number
  categories: ActionCategory[]
}

export function salesImportActions(input: {
  assessment: ImportAssessment
  orders: SalesImportOrder[]
  lines: SalesImportLine[]
  products: Product[]
  takenOrderIds: Set<string>
}): ActionCentre {
  const statusOf = new Map(input.orders.map((order) => [order.id, liveOrderStatus(order, input.lines, input.takenOrderIds)]))
  const withStatus = (status: SalesImportOrderStatus) => input.orders.filter((order) => statusOf.get(order.id) === status)
  const seenQty = (lines: SalesImportLine[]) => {
    const seen = new Set<string>()
    let qty = 0
    for (const line of lines) {
      if (!(line.quantity > 0)) continue
      const key = accountKey(line)
      if (seen.has(key)) continue
      seen.add(key)
      qty = round2(qty + line.quantity)
    }
    return qty
  }
  const orderRef = (list: SalesImportOrder[]) => list.length === 1 ? list[0].externalOrderId : `${list.length} orders`
  const categories: ActionCategory[] = []

  const unmappedOrders = withStatus('unmapped')
  const mapGroups = new Map<string, { row: ActionRow; orders: SalesImportOrder[]; lines: SalesImportLine[] }>()
  for (const order of unmappedOrders) {
    for (const line of input.lines.filter((item) => item.orderId === order.id && !item.mappedProductId && !item.unallocated)) {
      const identity = mappingIdentity(line)
      const id = `${identity.keyType}:${identity.key}`
      const group = mapGroups.get(id) ?? {
        row: { id, product: externalLabel(line), units: 0, orders: 0, orderRef: '', keyType: identity.keyType, mapKey: identity.key },
        orders: [],
        lines: [],
      }
      if (!group.orders.some((item) => item.id === order.id)) group.orders.push(order)
      group.lines.push(line)
      mapGroups.set(id, group)
    }
  }
  const mapRows = [...mapGroups.values()].map((group) => ({
    ...group.row,
    units: seenQty(group.lines),
    orders: group.orders.length,
    orderRef: orderRef(group.orders),
  }))
  if (mapRows.length) {
    categories.push({
      id: 'map',
      title: 'Map Products',
      hint: 'Products still need to be mapped',
      count: mapRows.length,
      units: seenQty(mapRows.flatMap(() => [])),
      orderIds: unmappedOrders.map((order) => order.id),
      rows: mapRows,
    })
    categories[categories.length - 1].units = seenQty(input.lines.filter((line) => unmappedOrders.some((order) => order.id === line.orderId) && !line.mappedProductId && !line.unallocated))
  }

  const quantityOrders = withStatus('error').filter((order) => input.lines.some((line) => line.orderId === order.id && line.quantityReview))
  const quantityRows: ActionRow[] = []
  for (const order of quantityOrders) {
    for (const line of input.lines.filter((item) => item.orderId === order.id && item.quantityReview)) {
      const picking = line.pickingQuantity ?? line.quantity
      const awb = line.quantitySource === 'awb' ? line.quantity : undefined
      quantityRows.push({
        id: line.id,
        product: line.mappedProductId ? productName(line, input.products) : externalLabel(line),
        units: line.quantity,
        orders: 1,
        orderRef: order.externalOrderId,
        picking,
        awb,
        difference: awb === undefined ? undefined : round2(awb - picking),
      })
    }
  }
  if (quantityRows.length) {
    categories.push({
      id: 'quantity',
      title: 'Review Quantity',
      hint: 'Picking and AWB quantities disagree',
      count: quantityOrders.length,
      units: seenQty(input.lines.filter((line) => quantityOrders.some((order) => order.id === line.orderId) && line.quantityReview)),
      orderIds: quantityOrders.map((order) => order.id),
      rows: quantityRows,
    })
  }

  const unallocatedOrders = withStatus('unallocated')
  const unallocatedRows: ActionRow[] = []
  const seenUnallocated = new Set<string>()
  for (const order of unallocatedOrders) {
    for (const line of input.lines.filter((item) => item.orderId === order.id && item.unallocated)) {
      const key = `${order.id}:${accountKey(line)}`
      if (seenUnallocated.has(key)) continue
      seenUnallocated.add(key)
      unallocatedRows.push({
        id: `${order.id}:${line.id}`,
        product: line.mappedProductId ? productName(line, input.products) : externalLabel(line),
        units: line.quantity,
        orders: 1,
        orderRef: order.externalOrderId,
        imported: line.quantity,
        allocated: 0,
        unallocatedQty: line.quantity,
      })
    }
  }
  if (unallocatedRows.length) {
    categories.push({
      id: 'unallocated',
      title: 'Review Unallocated',
      hint: 'This shared quantity is not allocated yet',
      count: unallocatedOrders.length,
      units: seenQty(input.lines.filter((line) => unallocatedOrders.some((order) => order.id === line.orderId) && line.unallocated)),
      orderIds: unallocatedOrders.map((order) => order.id),
      rows: unallocatedRows,
    })
  }

  if (input.assessment.shortages.length) {
    categories.push({
      id: 'stock',
      title: 'Check Stock',
      hint: 'Ready orders stay unposted until stock is sufficient',
      count: input.assessment.shortages.length,
      units: input.assessment.shortages.reduce((sum, row) => round2(sum + Math.max(0, row.required - row.available)), 0),
      orderIds: [],
      rows: input.assessment.shortages.map((row) => ({
        id: row.productId,
        product: row.name,
        units: round2(Math.max(0, row.required - row.available)),
        orders: 0,
        orderRef: '',
        required: row.required,
        available: row.available,
        short: round2(Math.max(0, row.required - row.available)),
      })),
    })
  }

  const duplicateOrders = withStatus('duplicate')
  if (duplicateOrders.length) {
    categories.push({
      id: 'duplicate',
      title: 'Review Duplicates',
      hint: 'These orders were already imported',
      count: duplicateOrders.length,
      units: seenQty(input.lines.filter((line) => duplicateOrders.some((order) => order.id === line.orderId))),
      orderIds: duplicateOrders.map((order) => order.id),
      rows: duplicateOrders.map((order) => ({
        id: order.id,
        product: order.externalOrderId,
        units: seenQty(input.lines.filter((line) => line.orderId === order.id)),
        orders: 1,
        orderRef: order.externalOrderId,
        status: order.saleId ? 'Already confirmed' : 'Already imported',
      })),
    })
  }

  const otherOrders = withStatus('error').filter((order) => !quantityOrders.some((item) => item.id === order.id))
  const otherNotes = [
    ...input.assessment.blockers,
    ...otherOrders.map((order) => `${order.externalOrderId}: needs a check`),
  ]
  if (otherNotes.length) {
    categories.push({
      id: 'other',
      title: input.assessment.blockers.length ? 'Account or file check' : 'Needs a check',
      hint: 'These checks apply before any orders can be posted',
      count: otherNotes.length,
      units: 0,
      orderIds: otherOrders.map((order) => order.id),
      rows: otherNotes.map((note, index) => ({ id: `other-${index}`, product: note, units: 0, orders: 0, orderRef: '' })),
    })
  }

  const rank: Record<ActionKind, number> = { other: input.assessment.blockers.length ? 0 : 5, map: 1, quantity: 2, unallocated: 3, stock: 4, duplicate: 6 }
  categories.sort((a, b) => rank[a.id] - rank[b.id])
  const orderIds = new Set(categories.flatMap((category) => category.orderIds))
  return {
    issues: categories.reduce((sum, category) => sum + category.count, 0),
    orders: orderIds.size,
    categories,
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
