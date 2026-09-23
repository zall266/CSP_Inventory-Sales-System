import { normalizeUnit } from '@/features/products/masterData'
import type { InventoryRow, Product, StockMovement } from '@/types'
import { round2, uid } from '@/utils/format'

/** Sheet1 header row of Products - Cool Slurppy Marketing.xlsx. Values below are copied from that export. */
export const USAHAONE_SOURCE_SHEET = 'Sheet1'
export const USAHAONE_SOURCE_PRODUCT_ROWS = 159
export const USAHAONE_OPENING_QTY = 1000
export const USAHAONE_OPENING_REFERENCE = 'OPENING-IMPORT-USAHAONE'
export const USAHAONE_WAREHOUSE_ID = 'wh-main'
export const USAHAONE_OPENING_NOTE =
  'Test opening stock for Usahaone sales-import UAT. Not the Usahaone stock balance.'
export const USAHAONE_OPENING_DATE = '2026-08-01T08:15:00+08:00'

const CATEGORY_IDS = {
  'AIR BALANG': 'cat-air',
  'ICE BLENDED': 'cat-ice',
  'TEPUNG WAFFLE': 'cat-waffle',
  TOPPING: 'cat-other',
  'HOME CAFE 3IN1': 'cat-other',
  'COMBO/MIX/DIY': 'cat-other',
  'RAW MATERIAL': 'cat-ing',
} as const

type SourceCategory = keyof typeof CATEGORY_IDS

type SourceRow = {
  name: string
  sku: string
  sourceCategory: SourceCategory
  /** Unit text from the Current stock column, such as PACK or KILOGRAM. Blank when the export has no unit. */
  sourceUnit: string
  costPrice: number
  sellingPrice: number
}

/**
 * Representative UAT subset copied from the Usahaone export.
 * sourceUnit blank means the export did not show a unit, so PCS is the fallback.
 */
export const USAHAONE_UAT_ROWS: SourceRow[] = [
  { name: 'AB Green Apple', sku: '147547', sourceCategory: 'AIR BALANG', sourceUnit: 'PACK', costPrice: 9.43, sellingPrice: 17.99 },
  { name: 'AB Matcha', sku: '147552', sourceCategory: 'AIR BALANG', sourceUnit: 'PACK', costPrice: 8.92, sellingPrice: 20.99 },
  { name: 'AB Chocolate Lava', sku: '147540', sourceCategory: 'AIR BALANG', sourceUnit: 'PACK', costPrice: 12.13, sellingPrice: 23.99 },
  { name: 'AB Blue Ice Vanilla', sku: '147539', sourceCategory: 'AIR BALANG', sourceUnit: 'PACK', costPrice: 9.06, sellingPrice: 17.99 },
  { name: 'AB Strawbbery / Yogurt', sku: '147549', sourceCategory: 'AIR BALANG', sourceUnit: 'PACK', costPrice: 9.45, sellingPrice: 17.99 },
  { name: 'AB Chocolate Hazelnut', sku: '147561', sourceCategory: 'AIR BALANG', sourceUnit: 'PACK', costPrice: 13.21, sellingPrice: 20.99 },
  { name: 'AB Vanilla', sku: '148540', sourceCategory: 'AIR BALANG', sourceUnit: '', costPrice: 7.88, sellingPrice: 17.99 },
  { name: 'IB Chocolate', sku: '147509', sourceCategory: 'ICE BLENDED', sourceUnit: 'PACK', costPrice: 9.83, sellingPrice: 17.99 },
  { name: 'IB Green Apple / Yogurt', sku: '147529', sourceCategory: 'ICE BLENDED', sourceUnit: '', costPrice: 9.43, sellingPrice: 17.99 },
  { name: 'IB Matcha - New 2026', sku: '171458', sourceCategory: 'ICE BLENDED', sourceUnit: 'PACK', costPrice: 7.26, sellingPrice: 15.99 },
  { name: 'Vanilla', sku: '147508', sourceCategory: 'ICE BLENDED', sourceUnit: 'PACK', costPrice: 7.88, sellingPrice: 15.99 },
  { name: 'Vanilla Oreo', sku: '147795', sourceCategory: 'ICE BLENDED', sourceUnit: 'PACK', costPrice: 8.14, sellingPrice: 15.99 },
  { name: 'White Coffee', sku: '147516', sourceCategory: 'ICE BLENDED', sourceUnit: 'PACK', costPrice: 7.99, sellingPrice: 15.99 },
  { name: 'Tiramisu', sku: '147514', sourceCategory: 'ICE BLENDED', sourceUnit: 'PACK', costPrice: 7.99, sellingPrice: 15.99 },
  { name: 'IB Blueberry', sku: '147524', sourceCategory: 'ICE BLENDED', sourceUnit: 'PACK', costPrice: 7.59, sellingPrice: 15.99 },
  { name: 'Tepung Waffle', sku: '147822', sourceCategory: 'TEPUNG WAFFLE', sourceUnit: 'PACK', costPrice: 4.22, sellingPrice: 7.49 },
  { name: 'CHOCOLATE SPREAD 1kg', sku: '148214', sourceCategory: 'TOPPING', sourceUnit: 'KILOGRAM', costPrice: 12.5, sellingPrice: 17.99 },
  { name: 'STRAWBERRY SPREAD 1kg', sku: '156529', sourceCategory: 'TOPPING', sourceUnit: 'KILOGRAM', costPrice: 9.5, sellingPrice: 14.99 },
  { name: 'BLUEBERRY SPREAD 1kg', sku: '156530', sourceCategory: 'TOPPING', sourceUnit: 'KILOGRAM', costPrice: 9.5, sellingPrice: 14.99 },
  { name: 'PEANUT BUTTER SPREAD 1kg', sku: '156527', sourceCategory: 'TOPPING', sourceUnit: 'KILOGRAM', costPrice: 11.2, sellingPrice: 16.99 },
  { name: 'SACHET MATCHA LATTE', sku: '171958', sourceCategory: 'HOME CAFE 3IN1', sourceUnit: '', costPrice: 0.65, sellingPrice: 1.5 },
  { name: 'SACHET SPANISH LATTE', sku: '171448', sourceCategory: 'HOME CAFE 3IN1', sourceUnit: '', costPrice: 0.65, sellingPrice: 1.5 },
  { name: 'SACHET MILK TEA', sku: '171453', sourceCategory: 'HOME CAFE 3IN1', sourceUnit: '', costPrice: 0.7, sellingPrice: 1.5 },
  { name: 'SACHET LEMON TEA', sku: '171970', sourceCategory: 'HOME CAFE 3IN1', sourceUnit: '', costPrice: 0.65, sellingPrice: 1.5 },
  { name: 'COMBO (Double Tepung Waffle + Chocolate)', sku: '148222', sourceCategory: 'COMBO/MIX/DIY', sourceUnit: '', costPrice: 20.94, sellingPrice: 29.99 },
  { name: 'RAW ARABICA COFFEE (FD)', sku: '171441', sourceCategory: 'RAW MATERIAL', sourceUnit: 'GRAM', costPrice: 0.08, sellingPrice: 0 },
  { name: 'RAW FOAMER', sku: '171443', sourceCategory: 'RAW MATERIAL', sourceUnit: 'GRAM', costPrice: 0.02, sellingPrice: 0 },
]

const ACCENT: Record<string, string> = {
  'cat-air': '#2563EB',
  'cat-ice': '#4C7C8C',
  'cat-waffle': '#C9852A',
  'cat-other': '#64748B',
  'cat-ing': '#78716C',
}

export type UsahaonePreviewRow = {
  name: string
  sku: string
  unit: string
  sourceUnit: string
  unitFallback: boolean
  costPrice: number
  sellingPrice: number
  wholesalePrice: number
  category: string
  active: 'active'
  openingStock: string
}

const KNOWN_UNITS = new Set(['G', 'KG', 'ML', 'L', 'PCS', 'PACKS', 'TIN', 'BAG', 'BOTTLE', 'BOX', 'CARTON', 'ROLL'])

export function usahaoneStoredUnit(sourceUnit: string) {
  const raw = sourceUnit.trim()
  if (!raw) return { unit: 'PCS', fallback: true }
  const unit = normalizeUnit(raw)
  if (!KNOWN_UNITS.has(unit)) return { unit: 'PCS', fallback: true }
  return { unit, fallback: false }
}

export function validateUsahaoneUatRows(existingSkus: string[] = []) {
  const errors: string[] = []
  const seen = new Set<string>()
  const existing = new Set(existingSkus.map((sku) => sku.trim().toLowerCase()))
  for (const row of USAHAONE_UAT_ROWS) {
    if (!row.name.trim()) errors.push('Product name is required.')
    const sku = row.sku.trim()
    if (!sku) errors.push(`${row.name || 'Product'} is missing a SKU.`)
    const key = sku.toLowerCase()
    if (seen.has(key)) errors.push(`Duplicate SKU in the import: ${sku}`)
    if (existing.has(key)) errors.push(`SKU ${sku} already exists.`)
    seen.add(key)
    if (!Number.isFinite(row.costPrice) || row.costPrice < 0) errors.push(`${row.name} has an invalid cost price.`)
    if (!Number.isFinite(row.sellingPrice) || row.sellingPrice < 0) errors.push(`${row.name} has an invalid selling price.`)
    const stored = usahaoneStoredUnit(row.sourceUnit)
    if (!stored.unit) errors.push(`${row.name} has an invalid unit.`)
    if (!(USAHAONE_OPENING_QTY > 0)) errors.push('Opening stock must be greater than 0.')
  }
  return errors
}

export function usahaoneUatProducts(): Product[] {
  const errors = validateUsahaoneUatRows()
  if (errors.length) throw new Error(errors.join('\n'))
  return USAHAONE_UAT_ROWS.map((row) => {
    const stored = usahaoneStoredUnit(row.sourceUnit)
    const categoryId = CATEGORY_IDS[row.sourceCategory]
    return {
      id: `p-uo-${row.sku}`,
      name: row.name,
      sku: row.sku,
      barcode: '',
      categoryId,
      unit: stored.unit,
      purchaseUnit: stored.unit,
      purchaseConversionQty: 1,
      purchaseCost: row.costPrice,
      costPrice: row.costPrice,
      costSource: 'manual' as const,
      sellingPrice: row.sellingPrice,
      wholesalePrice: 0,
      sellable: true,
      reorderLevel: 0,
      trackBatch: false,
      trackExpiry: false,
      status: 'active' as const,
      accent: ACCENT[categoryId] ?? '#64748B',
      salesComponents: [],
    }
  })
}

export function usahaonePreview(): UsahaonePreviewRow[] {
  return USAHAONE_UAT_ROWS.map((row) => {
    const stored = usahaoneStoredUnit(row.sourceUnit)
    return {
      name: row.name,
      sku: row.sku,
      unit: stored.unit,
      sourceUnit: row.sourceUnit || '(blank)',
      unitFallback: stored.fallback,
      costPrice: row.costPrice,
      sellingPrice: row.sellingPrice,
      wholesalePrice: 0,
      category: row.sourceCategory,
      active: 'active',
      openingStock: `${USAHAONE_OPENING_QTY} ${stored.unit} TEST OPENING STOCK`,
    }
  })
}

export function isUsahaoneUatProductId(productId: string) {
  return productId.startsWith('p-uo-')
}

export function usahaoneOpeningMovement(product: Product, movementId = uid('mv')): StockMovement {
  return {
    id: movementId,
    date: USAHAONE_OPENING_DATE,
    reference: USAHAONE_OPENING_REFERENCE,
    productId: product.id,
    warehouseId: USAHAONE_WAREHOUSE_ID,
    type: 'opening_stock',
    stockIn: USAHAONE_OPENING_QTY,
    stockOut: 0,
    balance: USAHAONE_OPENING_QTY,
    user: 'Kumar Raj',
    notes: USAHAONE_OPENING_NOTE,
  }
}

export function mergeUsahaoneUatProducts<T extends { products: Product[]; inventory: InventoryRow[]; stockMovements: StockMovement[] }>(data: T): T {
  const existing = new Set(data.products.map((product) => product.sku.trim().toLowerCase()))
  const additions = usahaoneUatProducts().filter((product) => !existing.has(product.sku.trim().toLowerCase()))
  if (!additions.length) return data
  const inventory = data.inventory.map((row) => ({ ...row }))
  const stockMovements = [...data.stockMovements]
  for (const product of additions) {
    stockMovements.unshift(usahaoneOpeningMovement(product))
    const row = inventory.find((item) => item.productId === product.id && item.warehouseId === USAHAONE_WAREHOUSE_ID)
    if (row) row.qty = round2(row.qty + USAHAONE_OPENING_QTY)
    else inventory.push({ productId: product.id, warehouseId: USAHAONE_WAREHOUSE_ID, qty: USAHAONE_OPENING_QTY })
  }
  return {
    ...data,
    products: [...data.products, ...additions],
    inventory,
    stockMovements,
  }
}
