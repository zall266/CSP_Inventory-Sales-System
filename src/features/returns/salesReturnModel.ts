import { isAllowedReceivingPhotoFile, parseReceivingPhoto } from '@/features/receiving/receivingModel'
import { DEFAULT_STORAGE_BOXES, storageBoxOptions } from '@/features/openingBalance/openingBalanceModel'
import { companyWarehouses, isAgentWarehouseId, saleIsAgentSale } from '@/features/agent/agentModel'
import type {
  AppState,
  Product,
  ReturnReason,
  ReturnSource,
  SalesReturn,
  SalesReturnInput,
  SalesReturnLine,
} from '@/types'

export const SALES_RETURN_PERMISSION_KEYS = [
  'sales_return.view',
  'sales_return.create',
  'sales_return.manage',
  'return_source.manage',
  'return_reason.manage',
] as const

export const DISPOSITION_EQUALITY_ERROR = 'Good + Repack + Waste must equal Returned Quantity.'

export const DEFAULT_RETURN_SOURCE_NAMES = [
  'Shopee',
  'TikTok Shop',
  'Website',
  'WhatsApp',
  'Lazada',
  'Walk-in',
  'Courier',
  'Agent',
  'Wholesale',
  'Other',
] as const

export const DEFAULT_RETURN_REASON_NAMES = [
  'Customer changed mind',
  'Damaged',
  'Wrong item',
  'Defective',
  'Parcel damaged',
  'Expired',
  'Other',
] as const

const SOURCE_IDS: Record<(typeof DEFAULT_RETURN_SOURCE_NAMES)[number], string> = {
  Shopee: 'rs-shopee',
  'TikTok Shop': 'rs-tiktok',
  Website: 'rs-website',
  WhatsApp: 'rs-whatsapp',
  Lazada: 'rs-lazada',
  'Walk-in': 'rs-walkin',
  Courier: 'rs-courier',
  Agent: 'rs-agent',
  Wholesale: 'rs-wholesale',
  Other: 'rs-other',
}

const REASON_IDS: Record<(typeof DEFAULT_RETURN_REASON_NAMES)[number], string> = {
  'Customer changed mind': 'rr-changed-mind',
  Damaged: 'rr-damaged',
  'Wrong item': 'rr-wrong-item',
  Defective: 'rr-defective',
  'Parcel damaged': 'rr-parcel-damaged',
  Expired: 'rr-expired',
  Other: 'rr-other',
}

export function defaultReturnSources(now: string): ReturnSource[] {
  return DEFAULT_RETURN_SOURCE_NAMES.map((name) => ({
    id: SOURCE_IDS[name],
    name,
    active: true,
    createdAt: now,
    updatedAt: now,
  }))
}

export function defaultReturnReasons(now: string): ReturnReason[] {
  return DEFAULT_RETURN_REASON_NAMES.map((name) => ({
    id: REASON_IDS[name],
    name,
    active: true,
    createdAt: now,
    updatedAt: now,
  }))
}

export function slugifyMasterName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item'
}

export const isAllowedReturnPhotoFile = isAllowedReceivingPhotoFile

export function parseReturnPhoto(value: unknown, fileName?: string) {
  const parsed = parseReceivingPhoto(value, fileName)
  if (!parsed.ok) return parsed
  const name = fileName?.trim() || parsed.name.replace(/^receiving-photo\./, 'return-photo.')
  return { ...parsed, name }
}

export function returnStorageBoxOptions(state: Pick<AppState, 'productionBalances'>) {
  return [...new Set([...storageBoxOptions(state), ...DEFAULT_STORAGE_BOXES, 'BOX-03', 'Box 3'])]
}

export function returnableProducts(state: Pick<AppState, 'products'>) {
  return state.products.filter((product) => product.status === 'active')
}

export function emptyReturnLine(product: Product | undefined): SalesReturnInput['items'][number] {
  return {
    productId: product?.id ?? '',
    returnedQty: 1,
    unit: product?.unit || 'PACK',
    goodQty: 1,
    repackQty: 0,
    wasteQty: 0,
    repackRecoveredGrams: undefined,
    repackStorageBoxId: '',
    wasteReason: '',
    notes: '',
  }
}

export function inputLinesFromSalesReturn(doc: SalesReturn): SalesReturnInput['items'] {
  return doc.items.map((line) => ({
    productId: line.productId,
    returnedQty: line.returnedQty,
    unit: line.unit,
    goodQty: line.goodQty,
    repackQty: line.repackQty,
    repackRecoveredGrams: line.repackRecoveredGrams,
    repackStorageBoxId: line.repackStorageBoxId ?? '',
    wasteQty: line.wasteQty,
    wasteReason: line.wasteReason ?? '',
    notes: line.notes ?? '',
  }))
}

function n(value: unknown) {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : 0
}

export function dispositionIsBalanced(returnedQty: number, goodQty: number, repackQty: number, wasteQty: number) {
  return Math.abs(goodQty + repackQty + wasteQty - returnedQty) < 0.0001
}

export function salesReturnTotals(items: Array<{ returnedQty: number; goodQty: number; repackQty: number; wasteQty: number; repackRecoveredGrams?: number }>) {
  return {
    returnedQty: items.reduce((sum, line) => sum + n(line.returnedQty), 0),
    goodQty: items.reduce((sum, line) => sum + n(line.goodQty), 0),
    repackQty: items.reduce((sum, line) => sum + n(line.repackQty), 0),
    wasteQty: items.reduce((sum, line) => sum + n(line.wasteQty), 0),
    recoveredGrams: items.reduce((sum, line) => sum + n(line.repackRecoveredGrams), 0),
  }
}

export function sourceUsedByReturns(returns: SalesReturn[], sourceId: string) {
  return returns.some((row) => row.sourceId === sourceId)
}

export function reasonUsedByReturns(returns: SalesReturn[], reasonId: string) {
  return returns.some((row) => row.reasonId === reasonId)
}

export function remainingReturnableQty(
  state: Pick<AppState, 'sales' | 'salesReturns'>,
  saleId: string,
  productId: string,
  excludeReturnId?: string,
) {
  const sale = state.sales.find((row) => row.id === saleId)
  if (!sale) return null
  const line = sale.items.find((item) => item.productId === productId)
  if (!line) return null
  const confirmedElsewhere = (state.salesReturns ?? [])
    .filter((row) => row.id !== excludeReturnId && row.status === 'confirmed' && (row.originalSaleId ?? row.saleId) === saleId)
    .reduce((sum, row) => {
      const match = row.items.find((item) => item.productId === productId)
      return sum + n(match?.returnedQty ?? match?.qty)
    }, 0)
  const recordedOnSale = n(line.returnedQty)
  const already = Math.max(recordedOnSale, confirmedElsewhere)
  return Math.max(0, n(line.qty) - already)
}

function hydrateLine(docId: string, line: SalesReturnLine, index: number): SalesReturnLine {
  const returnedQty = n(line.returnedQty ?? line.qty)
  const hasDisposition = line.goodQty != null || line.repackQty != null || line.wasteQty != null
  const goodQty = n(hasDisposition ? line.goodQty : returnedQty)
  return {
    id: line.id || `${docId}-line-${index + 1}`,
    productId: line.productId,
    productNameSnapshot: line.productNameSnapshot ?? '',
    skuSnapshot: line.skuSnapshot ?? '',
    returnedQty,
    unit: line.unit || 'PACK',
    goodQty,
    repackQty: n(line.repackQty),
    repackRecoveredGrams: line.repackRecoveredGrams,
    repackStorageBoxId: line.repackStorageBoxId,
    wasteQty: n(line.wasteQty),
    wasteReason: line.wasteReason,
    notes: line.notes,
    qty: returnedQty,
    price: line.price ?? 0,
  }
}

export function hydrateSalesReturn(row: SalesReturn): SalesReturn {
  const returnDate = row.returnDate || row.date
  const originalSaleId = row.originalSaleId || row.saleId
  const items = (row.items ?? []).map((line, index) => hydrateLine(row.id, line, index))
  const total = row.total ?? items.reduce((sum, line) => sum + n(line.qty) * n(line.price), 0)
  return {
    ...row,
    returnDate,
    date: returnDate,
    sourceId: row.sourceId || 'rs-other',
    sourceNameSnapshot: row.sourceNameSnapshot || 'Other',
    originalSaleId,
    originalDocumentNo: row.originalDocumentNo,
    saleId: originalSaleId,
    customerId: row.customerId,
    customerNameSnapshot: row.customerNameSnapshot,
    reasonId: row.reasonId || '',
    reasonNameSnapshot: row.reasonNameSnapshot || row.reason || '',
    reason: row.reasonNameSnapshot || row.reason || '',
    warehouseId: row.warehouseId,
    items,
    status: row.status ?? 'confirmed',
    notes: row.notes,
    createdBy: row.createdBy || '',
    createdByName: row.createdByName || '',
    createdAt: row.createdAt || returnDate,
    total,
  }
}

export function hydrateSalesReturns(rows: SalesReturn[] | undefined) {
  return (rows ?? []).map(hydrateSalesReturn)
}

export function buildSalesReturnLines(
  state: Pick<AppState, 'products' | 'sales' | 'salesReturns' | 'productionBalances'>,
  items: SalesReturnInput['items'],
  originalSaleId?: string,
  excludeReturnId?: string,
): { ok: true; lines: SalesReturnLine[] } | { ok: false; reason: string } {
  if (!items.length) return { ok: false, reason: 'Add at least one return item.' }
  const seen = new Set<string>()
  const lines: SalesReturnLine[] = []
  const boxes = returnStorageBoxOptions(state)

  for (const [index, item] of items.entries()) {
    const product = state.products.find((row) => row.id === item.productId)
    if (!product) return { ok: false, reason: 'Choose a product for every line.' }
    if (product.status !== 'active') return { ok: false, reason: `${product.name} is inactive and cannot be returned.` }
    if (seen.has(product.id)) return { ok: false, reason: 'Each product can appear only once on a return.' }
    seen.add(product.id)

    const returnedQty = n(item.returnedQty)
    const goodQty = n(item.goodQty)
    const repackQty = n(item.repackQty)
    const wasteQty = n(item.wasteQty)
    if (returnedQty <= 0) return { ok: false, reason: `Returned quantity for ${product.name} must be greater than 0.` }
    if (goodQty < 0 || repackQty < 0 || wasteQty < 0) return { ok: false, reason: 'Good, Repack, and Waste quantities cannot be negative.' }
    if (!dispositionIsBalanced(returnedQty, goodQty, repackQty, wasteQty)) return { ok: false, reason: DISPOSITION_EQUALITY_ERROR }
    if (goodQty + repackQty + wasteQty <= 0) return { ok: false, reason: DISPOSITION_EQUALITY_ERROR }

    let recovered: number | undefined
    let box: string | undefined
    if (repackQty > 0) {
      recovered = n(item.repackRecoveredGrams)
      if (!(recovered > 0)) return { ok: false, reason: `Enter actual recoverable grams for ${product.name}.` }
      box = (item.repackStorageBoxId ?? '').trim()
      if (!box) return { ok: false, reason: `Select a Storage Box for ${product.name}.` }
      if (!boxes.includes(box) && !box) return { ok: false, reason: `Select a Storage Box for ${product.name}.` }
    }

    if (originalSaleId) {
      const remaining = remainingReturnableQty(state, originalSaleId, product.id, excludeReturnId)
      if (remaining != null && returnedQty > remaining) {
        return { ok: false, reason: `Returned quantity for ${product.name} exceeds the original sold quantity.` }
      }
    }

    lines.push({
      id: `srl-${index + 1}`,
      productId: product.id,
      productNameSnapshot: product.name,
      skuSnapshot: product.sku,
      returnedQty,
      unit: (item.unit || product.unit || 'PACK').trim() || 'PACK',
      goodQty,
      repackQty,
      repackRecoveredGrams: repackQty > 0 ? recovered : undefined,
      repackStorageBoxId: repackQty > 0 ? box : undefined,
      wasteQty,
      wasteReason: item.wasteReason?.trim() || undefined,
      notes: item.notes?.trim() || undefined,
      qty: returnedQty,
      price: 0,
    })
  }

  return { ok: true, lines }
}

export function resolveReturnWarehouse(
  state: Pick<AppState, 'warehouses' | 'settings' | 'sales'>,
  warehouseId: string | undefined,
  originalSaleId?: string,
): { ok: true; warehouseId: string } | { ok: false; reason: string } {
  const sale = originalSaleId ? state.sales.find((row) => row.id === originalSaleId) : undefined
  const candidate = warehouseId || sale?.warehouseId || state.settings.defaultWarehouseId
  if (!candidate) return { ok: false, reason: 'Select a warehouse.' }
  if (isAgentWarehouseId(state.warehouses, candidate)) {
    return { ok: false, reason: 'Sales Return cannot post into an Agent warehouse.' }
  }
  const warehouse = companyWarehouses(state.warehouses).find((row) => row.id === candidate)
  if (!warehouse) return { ok: false, reason: 'Select a company warehouse.' }
  return { ok: true, warehouseId: warehouse.id }
}

export function validateSalesReturnInput(
  state: Pick<AppState, 'products' | 'sales' | 'salesReturns' | 'productionBalances' | 'returnSources' | 'returnReasons' | 'customers' | 'warehouses' | 'settings'>,
  input: SalesReturnInput,
  existing?: SalesReturn,
): { ok: true; lines: SalesReturnLine[]; warehouseId: string; source: ReturnSource; reason: ReturnReason; saleId?: string; documentNo?: string; customerId?: string; customerName?: string } | { ok: false; reason: string } {
  if (!input.sourceId) return { ok: false, reason: 'Select a Return Source.' }
  if (!input.reasonId) return { ok: false, reason: 'Select a Return Reason.' }
  if (!input.returnDate && !existing?.returnDate) return { ok: false, reason: 'Select a Return Date.' }

  const source = (state.returnSources ?? []).find((row) => row.id === input.sourceId)
  if (!source) return { ok: false, reason: 'Select a valid Return Source.' }
  if (!source.active) return { ok: false, reason: 'This Return Source is inactive.' }

  const reason = (state.returnReasons ?? []).find((row) => row.id === input.reasonId)
  if (!reason) return { ok: false, reason: 'Select a valid Return Reason.' }
  if (!reason.active) return { ok: false, reason: 'This Return Reason is inactive.' }

  const originalSaleId = input.originalSaleId?.trim() || undefined
  let documentNo = input.originalDocumentNo?.trim() || undefined
  if (originalSaleId) {
    const sale = state.sales.find((row) => row.id === originalSaleId)
    if (!sale) return { ok: false, reason: 'Original invoice / order was not found.' }
    if (saleIsAgentSale(state as AppState, sale)) {
      return { ok: false, reason: 'Agent sales cannot be returned in this version.' }
    }
    documentNo = sale.invoiceNo
  }

  const warehouse = resolveReturnWarehouse(state, input.warehouseId, originalSaleId)
  if (!warehouse.ok) return warehouse

  const built = buildSalesReturnLines(state, input.items, originalSaleId, existing?.id)
  if (!built.ok) return built

  let customerId = input.customerId?.trim() || undefined
  let customerName: string | undefined
  if (originalSaleId) {
    const sale = state.sales.find((row) => row.id === originalSaleId)
    customerId = customerId || sale?.customerId
  }
  if (customerId) {
    const customer = state.customers.find((row) => row.id === customerId)
    if (!customer) return { ok: false, reason: 'Customer was not found.' }
    customerName = customer.name
  }

  return {
    ok: true,
    lines: built.lines,
    warehouseId: warehouse.warehouseId,
    source,
    reason,
    saleId: originalSaleId,
    documentNo,
    customerId,
    customerName,
  }
}
