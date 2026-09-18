import { companyWarehouses } from '@/features/agent/agentModel'
import {
  buildOpeningBalanceLines,
  isFinishedGoodsProduct,
  isStockItemProduct,
  lineUnitOptions,
  openingBalanceTypeLabel,
} from '@/features/openingBalance/openingBalanceModel'
import { CARTON_STORAGE_TYPES, isActiveBalanceStorageBox } from '@/features/warehouse/warehouseModel'
import { formatUnit, normalizeUnit } from '@/features/products/masterData'
import { formatDate } from '@/utils/format'
import type { AppState, OpeningBalance, OpeningBalanceInput, OpeningBalanceType, Product, Warehouse } from '@/types'
import { downloadXlsx, parseSpreadsheetBytes, parseSpreadsheetText, type SpreadsheetMatrix } from '@/features/importexport/workbook'

export const OPENING_BALANCE_IMPORT_HEADERS = [
  'Type',
  'Product / Item',
  'SKU',
  'Quantity',
  'Unit',
  'Batch / Lot',
  'Expiry',
  'Warehouse',
  'Location',
  'Storage Box',
  'Notes',
] as const

export const OPENING_BALANCE_EXPORT_HEADERS = [
  'Document No',
  'Date',
  'Type',
  'Product / Item',
  'SKU',
  'Quantity',
  'Unit',
  'Batch / Lot',
  'Expiry',
  'Warehouse',
  'Location',
  'Storage Box',
  'Status',
  'Notes',
] as const

const HEADER_ALIASES: Record<string, string> = {
  type: 'type',
  'product / item': 'product',
  product: 'product',
  item: 'product',
  name: 'product',
  'product name': 'product',
  sku: 'sku',
  quantity: 'qty',
  qty: 'qty',
  balance: 'qty',
  'balance (g)': 'qty',
  unit: 'unit',
  'batch / lot': 'batch',
  batch: 'batch',
  lot: 'batch',
  'batch/lot': 'batch',
  expiry: 'expiry',
  'expiry date': 'expiry',
  warehouse: 'warehouse',
  'warehouse / location': 'warehouse',
  location: 'location',
  'physical location': 'location',
  'storage box': 'container',
  box: 'container',
  container: 'container',
  notes: 'notes',
  note: 'notes',
}

const FORBIDDEN_PRODUCTION_BALANCE_UNITS = new Set(['PACK', 'PACKS', 'BAG', 'KG'])

export type OpeningBalanceImportIssue = {
  row: number
  message: string
}

export type OpeningBalanceImportPreviewRow = {
  row: number
  typeLabel: string
  productName: string
  sku: string
  qty: string
  unit: string
  warehouse: string
  batch: string
  expiry: string
  location: string
  container: string
  notes: string
  errors: string[]
  type?: OpeningBalanceType
  item?: OpeningBalanceInput['items'][number]
}

export type OpeningBalanceImportPreview = {
  fileName: string
  issues: OpeningBalanceImportIssue[]
  rows: OpeningBalanceImportPreviewRow[]
  validCount: number
  errorCount: number
  canImport: boolean
  drafts: OpeningBalanceInput[]
}

function headerKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function columnMap(headers: string[]) {
  const map: Record<string, number> = {}
  headers.forEach((header, index) => {
    const alias = HEADER_ALIASES[headerKey(header)]
    if (alias && map[alias] == null) map[alias] = index
  })
  return map
}

function cell(row: string[], index: number | undefined) {
  if (index == null) return ''
  return String(row[index] ?? '').trim()
}

export function parseOpeningBalanceType(value: string): OpeningBalanceType | null {
  const key = value.trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (key === 'stock item' || key === 'stock' || key === 'item' || key === 'stock_item') return 'stock_item'
  if (key === 'finished goods' || key === 'finished good' || key === 'fg' || key === 'finished_goods') return 'finished_goods'
  if (key === 'production balance' || key === 'production' || key === 'pb' || key === 'production_balance') return 'production_balance'
  return null
}

function resolveProduct(state: Pick<AppState, 'products'>, name: string, sku: string): { ok: true; product: Product } | { ok: false; reason: string } {
  const skuKey = sku.trim().toLowerCase()
  const nameKey = name.trim().toLowerCase()
  if (skuKey) {
    const product = state.products.find((item) => item.sku.toLowerCase() === skuKey)
    if (!product) return { ok: false, reason: `SKU ${sku} was not found.` }
    if (nameKey && product.name.toLowerCase() !== nameKey) {
      return { ok: false, reason: `SKU ${product.sku} does not match ${name}.` }
    }
    return { ok: true, product }
  }
  if (!nameKey) return { ok: false, reason: 'Product / Item or SKU is required.' }
  const matches = state.products.filter((item) => item.name.toLowerCase() === nameKey)
  if (matches.length === 1) return { ok: true, product: matches[0] }
  if (matches.length > 1) return { ok: false, reason: `Product name ${name} is ambiguous. Use SKU.` }
  return { ok: false, reason: `Product ${name} was not found.` }
}

function resolveWarehouse(
  state: Pick<AppState, 'warehouses'>,
  value: string,
  fallbackId: string,
): { ok: true; warehouse: Warehouse } | { ok: false; reason: string } {
  const company = companyWarehouses(state.warehouses)
  const key = value.trim().toLowerCase()
  if (!key) {
    const fallback = company.find((item) => item.id === fallbackId) ?? company[0]
    if (!fallback) return { ok: false, reason: 'Choose a valid company warehouse.' }
    return { ok: true, warehouse: fallback }
  }
  const warehouse = state.warehouses.find(
    (item) => item.id.toLowerCase() === key || item.name.toLowerCase() === key || item.code.toLowerCase() === key,
  )
  if (!warehouse) return { ok: false, reason: `Warehouse ${value} was not found.` }
  if (warehouse.kind === 'agent') return { ok: false, reason: 'Choose a valid company warehouse.' }
  return { ok: true, warehouse }
}

function resolveFinishedGoodsLocation(
  state: Pick<AppState, 'storageLocations'>,
  warehouseId: string,
  value: string,
): { locationKind?: OpeningBalanceInput['items'][number]['locationKind']; locationId?: string; error?: string } {
  const key = value.trim().toLowerCase()
  if (!key || key === 'inventory' || key === 'warehouse inventory' || key === 'unplaced') {
    return { locationKind: 'inventory', locationId: '' }
  }
  if (key === 'display') return { locationKind: 'display', locationId: '' }
  const location = state.storageLocations.find(
    (item) =>
      item.active &&
      item.warehouseId === warehouseId &&
      (item.id.toLowerCase() === key || item.name.toLowerCase() === key),
  )
  if (!location) return { error: `Location ${value} was not found.` }
  if (location.type === 'DISPLAY') return { locationKind: 'display', locationId: '' }
  if (!CARTON_STORAGE_TYPES.includes(location.type)) return { error: 'Choose a valid storage location.' }
  return { locationKind: undefined, locationId: location.id }
}

function parseExpiry(value: string) {
  const raw = value.trim()
  if (!raw) return { ok: true as const, value: '' }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ok: true as const, value: raw }
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return { ok: false as const, reason: `Expiry ${value} is not a valid date.` }
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return { ok: true as const, value: `${year}-${month}-${day}` }
}

export function openingBalanceImportTemplateMatrix(): SpreadsheetMatrix {
  return [
    [...OPENING_BALANCE_IMPORT_HEADERS],
    ['Stock Item', 'Cocoa Powder', 'RW-CC001', '2', 'KG', '', '', 'Main Warehouse', '', '', 'Go-live stock'],
    ['Finished Goods', 'Matcha', 'FG-MT45', '40', 'PACKS', '', '', 'Main Warehouse', 'inventory', '', ''],
    ['Production Balance', 'Matcha', 'FG-MT45', '5000', 'G', '', '', 'Main Warehouse', '', 'Box 1', ''],
  ]
}

export function previewOpeningBalanceImport(
  state: Pick<AppState, 'products' | 'boms' | 'warehouses' | 'storageLocations' | 'storageSlots' | 'settings'>,
  fileName: string,
  matrix: SpreadsheetMatrix,
): OpeningBalanceImportPreview {
  const issues: OpeningBalanceImportIssue[] = []
  const rows: OpeningBalanceImportPreviewRow[] = []
  const empty = (): OpeningBalanceImportPreview => ({
    fileName,
    issues,
    rows,
    validCount: 0,
    errorCount: issues.length,
    canImport: false,
    drafts: [],
  })

  if (!matrix.length) {
    issues.push({ row: 0, message: 'The file is empty.' })
    return empty()
  }

  const headers = matrix[0] ?? []
  const columns = columnMap(headers)
  if (columns.type == null || columns.qty == null || (columns.product == null && columns.sku == null)) {
    issues.push({
      row: 1,
      message: 'Header mismatch. Required columns: Type, Product / Item or SKU, Quantity.',
    })
    return empty()
  }

  const dataRows = matrix.slice(1)
  if (!dataRows.length) {
    issues.push({ row: 0, message: 'The file is empty.' })
    return empty()
  }

  const defaultWarehouseId = state.settings.defaultWarehouseId
  const mappedByType: Record<OpeningBalanceType, OpeningBalanceInput['items']> = {
    stock_item: [],
    finished_goods: [],
    production_balance: [],
  }

  dataRows.forEach((source, index) => {
    const rowNumber = index + 2
    const errors: string[] = []
    const typeLabel = cell(source, columns.type)
    const productName = cell(source, columns.product)
    const sku = cell(source, columns.sku)
    const qtyText = cell(source, columns.qty)
    const unitText = cell(source, columns.unit)
    const warehouseText = cell(source, columns.warehouse)
    const batch = cell(source, columns.batch)
    const expiryText = cell(source, columns.expiry)
    const locationText = cell(source, columns.location)
    const container = cell(source, columns.container)
    const notes = cell(source, columns.notes)
    const preview: OpeningBalanceImportPreviewRow = {
      row: rowNumber,
      typeLabel,
      productName,
      sku,
      qty: qtyText,
      unit: unitText,
      warehouse: warehouseText,
      batch,
      expiry: expiryText,
      location: locationText,
      container,
      notes,
      errors,
    }

    const type = parseOpeningBalanceType(typeLabel)
    if (!type) errors.push('Type must be Stock Item, Finished Goods, or Production Balance.')

    const qty = Number(qtyText)
    if (!Number.isFinite(qty) || !(qty > 0)) errors.push('Quantity must be greater than 0.')

    const productResult = resolveProduct(state, productName, sku)
    if (!productResult.ok) errors.push(productResult.reason)

    const warehouseResult = resolveWarehouse(state, warehouseText, defaultWarehouseId)
    if (!warehouseResult.ok) errors.push(warehouseResult.reason)

    const expiry = parseExpiry(expiryText)
    if (!expiry.ok) errors.push(expiry.reason)

    if (type && productResult.ok) {
      if (type === 'stock_item' && !isStockItemProduct(state, productResult.product)) {
        errors.push(`${productResult.product.name} is finished goods. Use the Finished Goods type.`)
      }
      if (type === 'finished_goods' && !isFinishedGoodsProduct(state, productResult.product)) {
        errors.push(`${productResult.product.name} is not a finished product.`)
      }
      if (type === 'production_balance' && !isFinishedGoodsProduct(state, productResult.product)) {
        errors.push(`${productResult.product.name} is not valid for production balance.`)
      }
    }

    let unit = unitText
    if (type === 'production_balance') {
      const normalized = normalizeUnit(unitText) || 'G'
      if (FORBIDDEN_PRODUCTION_BALANCE_UNITS.has(normalized) || normalized !== 'G') {
        errors.push('Production Balance unit must be G.')
      }
      unit = 'G'
      if (!container) errors.push('Storage Box is required.')
      else if (warehouseResult.ok && !isActiveBalanceStorageBox(state, warehouseResult.warehouse.id, container)) {
        errors.push('Storage Box is not an active Warehouse Map balance box.')
      }
    } else if (productResult.ok) {
      unit = unitText
        ? formatUnit(unitText)
        : formatUnit(productResult.product.purchaseUnit || productResult.product.unit)
      const allowed = lineUnitOptions(productResult.product)
      if (!allowed.includes(unit)) {
        errors.push(`Unit ${unitText || unit} is not valid for ${productResult.product.name}.`)
      }
    }

    let locationKind: OpeningBalanceInput['items'][number]['locationKind']
    let locationId = ''
    if (type === 'finished_goods' && warehouseResult.ok) {
      const location = resolveFinishedGoodsLocation(state, warehouseResult.warehouse.id, locationText)
      if (location.error) errors.push(location.error)
      locationKind = location.locationKind ?? 'inventory'
      locationId = location.locationId ?? ''
    }

    if (!errors.length && type && productResult.ok && warehouseResult.ok && expiry.ok) {
      const item: OpeningBalanceInput['items'][number] = {
        productId: productResult.product.id,
        qty,
        unit,
        warehouseId: warehouseResult.warehouse.id,
        batchNo: batch,
        expiry: expiry.value,
        notes,
        locationKind,
        locationId,
        container,
      }
      preview.type = type
      preview.item = item
      mappedByType[type].push(item)
    }

    preview.errors = errors
    rows.push(preview)
    errors.forEach((message) => issues.push({ row: rowNumber, message }))
  })

  const drafts: OpeningBalanceInput[] = []
  ;(['stock_item', 'finished_goods', 'production_balance'] as OpeningBalanceType[]).forEach((type) => {
    const items = mappedByType[type]
    if (!items.length) return
    const built = buildOpeningBalanceLines(state, type, items)
    if (!built.ok) {
      issues.push({ row: 0, message: built.reason })
      return
    }
    drafts.push({ type, items, notes: 'Imported opening balance' })
  })

  const errorCount = issues.length
  const validCount = rows.filter((row) => row.errors.length === 0).length
  return {
    fileName,
    issues,
    rows,
    validCount,
    errorCount,
    canImport: errorCount === 0 && validCount > 0 && drafts.length > 0,
    drafts,
  }
}

export function previewOpeningBalanceFile(
  state: Pick<AppState, 'products' | 'boms' | 'warehouses' | 'storageLocations' | 'storageSlots' | 'settings'>,
  fileName: string,
  source: { text?: string; bytes?: ArrayBuffer | Uint8Array },
) {
  const parsed = source.bytes
    ? parseSpreadsheetBytes(fileName, source.bytes)
    : parseSpreadsheetText(fileName, source.text ?? '')
  if (!parsed.ok) {
    return {
      fileName,
      issues: [{ row: 0, message: parsed.reason }],
      rows: [],
      validCount: 0,
      errorCount: 1,
      canImport: false,
      drafts: [],
    } satisfies OpeningBalanceImportPreview
  }
  return previewOpeningBalanceImport(state, fileName, parsed.matrix)
}

export function exportOpeningBalanceMatrix(
  state: Pick<AppState, 'products' | 'warehouses' | 'storageLocations' | 'openingBalances' | 'ui'>,
): SpreadsheetMatrix {
  const rows: SpreadsheetMatrix = [[...OPENING_BALANCE_EXPORT_HEADERS]]
  const documents = (state.openingBalances ?? []).filter((doc) => {
    if (state.ui.warehouseFilter !== 'all' && !doc.items.some((line) => line.warehouseId === state.ui.warehouseFilter)) return false
    return true
  })
  documents.forEach((doc) => {
    doc.items.forEach((line) => {
      const product = state.products.find((item) => item.id === line.productId)
      const warehouse = state.warehouses.find((item) => item.id === line.warehouseId)
      const location = line.locationId
        ? state.storageLocations.find((item) => item.id === line.locationId)?.name ?? line.locationId
        : line.locationKind === 'display'
          ? 'Display'
          : line.locationKind === 'inventory'
            ? 'Inventory'
            : ''
      rows.push([
        doc.documentNo,
        formatDate(doc.date),
        openingBalanceTypeLabel(doc.type),
        product?.name ?? line.productId,
        product?.sku ?? '',
        String(line.qty),
        line.unit,
        line.batchNo ?? '',
        line.expiry ?? '',
        warehouse?.name ?? line.warehouseId,
        location,
        line.container ?? '',
        doc.status,
        line.notes || doc.notes || '',
      ])
    })
  })
  return rows
}

export function downloadOpeningBalanceTemplate() {
  downloadXlsx('opening-balance-import-template.xlsx', openingBalanceImportTemplateMatrix(), 'Opening Balance')
}

export function downloadOpeningBalanceExport(
  state: Pick<AppState, 'products' | 'warehouses' | 'storageLocations' | 'openingBalances' | 'ui'>,
) {
  downloadXlsx('opening-balance-export.xlsx', exportOpeningBalanceMatrix(state), 'Opening Balance')
}

export function commitOpeningBalanceImport(
  saveDraft: (input: OpeningBalanceInput) => OpeningBalance | null | undefined,
  drafts: OpeningBalanceInput[],
) {
  const documents: OpeningBalance[] = []
  for (const draft of drafts) {
    const saved = saveDraft(draft)
    if (!saved) {
      return { ok: false as const, reason: 'Opening Balance draft could not be saved.', documents }
    }
    documents.push(saved)
  }
  return { ok: true as const, documents }
}
