import { deriveHalalStatus, halalStatusLabel, isDateKey } from '@/features/halal/halalModel'
import { normalizeUnit } from '@/features/products/masterData'
import { gramsPerPack } from '@/features/manufacturing/sessionPlan'
import type {
  Bom,
  Category,
  HalalCertificate,
  Manufacturer,
  Product,
  ProductionSession,
  ProductionSessionItem,
  RawMaterialHalalCompliance,
} from '@/types'
import { formatQty, round2 } from '@/utils/format'

export const BMR_COMPANY = 'COOL SLURPPY MARKETING'
export const BMR_DOCUMENT = 'BATCH MANUFACTURING RECORD'
export const BMR_EFFECTIVE_DATE = '01st JUNE 2026'
export const BMR_TITLE = 'Batch Manufacturing Report (BMR)'
export const BMR_MULTIPLE_HALAL_REMARK = 'Multiple Halal records — confirm manually'

/** First page also carries the document header and, when the list fits, the process block. */
export const BMR_FIRST_PAGE_MATERIALS = 8
export const BMR_NEXT_PAGE_MATERIALS = 16

export const BMR_PROCESS_STEPS = [
  'Weighing of ingredients',
  'Mixing',
  'Filling / Packaging',
  'Grinding',
  'Cleaning',
] as const

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type BmrMaterialRow = {
  material: string
  manufacturer: string
  warehouseStockG: ''
  quantityUsedG: string
  /** Blank unless exactly one Halal record supplies the current certificate expiry. Material batch expiry is never copied. */
  expiryDate: string
  halalStatus: string
  remarks: string
}

export type BmrProcessRow = {
  step: number
  description: string
  timeStart: ''
  timeEnd: ''
  operatorName: ''
}

export type BmrPackagingRow = {
  flavour: string
  sizeWeightG: string
  quantityProducedG: string
  quantityReleasedPack: string
  quantityRejected: ''
  remarks: string
}

export type BmrDeviationRow = {
  issue: ''
  description: ''
  correctiveAction: ''
  responsiblePerson: ''
  date: ''
}

export type BmrApprovalRow = {
  department: string
  name: string
  signature: ''
  date: string
}

export type BmrPage = {
  materials: BmrMaterialRow[]
  showDocumentHeader: boolean
  showProcess: boolean
  showPackaging: boolean
  showDeviations: boolean
  showApproval: boolean
}

export type BmrDocument = {
  sessionId: string
  productName: string
  batchNo: string
  productionDate: string
  productionDateLabel: string
  expiryDate: string
  expiryDateLabel: string
  approvedBy: ''
  materials: BmrMaterialRow[]
  process: BmrProcessRow[]
  packaging: BmrPackagingRow[]
  deviations: BmrDeviationRow[]
  approval: BmrApprovalRow[]
  pages: BmrPage[]
}

export type BmrSource = {
  products: Product[]
  boms: Bom[]
  categories: Category[]
  manufacturers?: Manufacturer[]
  halalCertificates?: HalalCertificate[]
  halalCompliances?: RawMaterialHalalCompliance[]
}

/**
 * Finished-goods expiry is the production date plus one calendar year.
 * Uses UTC `setUTCFullYear`, the same Date roll as the rest of the app.
 * A leap day such as 2024-02-29 becomes 2025-03-01 because 2025 is not a leap year.
 * The batch day and month stay on the production date; only the year comes from the expiry date.
 */
export function addCalendarYears(dateKey: string, years: number) {
  if (!isDateKey(dateKey)) return ''
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCFullYear(date.getUTCFullYear() + years)
  const nextYear = date.getUTCFullYear()
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0')
  const nextDay = String(date.getUTCDate()).padStart(2, '0')
  return `${nextYear}-${nextMonth}-${nextDay}`
}

export function bmrExpiryDate(productionDate: string) {
  return addCalendarYears(productionDate, 1)
}

export function bmrBatchNo(productionDate: string) {
  const expiry = bmrExpiryDate(productionDate)
  if (!isDateKey(productionDate) || !expiry) return ''
  const day = productionDate.slice(8, 10)
  const month = productionDate.slice(5, 7)
  const year = expiry.slice(0, 4)
  return `${day}${month}${year}`
}

export function bmrDateLabel(dateKey: string) {
  if (!isDateKey(dateKey)) return ''
  const [year, month, day] = dateKey.split('-').map(Number)
  return `${day}-${MONTHS[month - 1]}-${year}`
}

export function canPrintBmr(session: Pick<ProductionSession, 'status' | 'posted'> | undefined) {
  return Boolean(session && session.status === 'completed' && session.posted)
}

export function weightToGrams(qty: number, unit: string | undefined) {
  if (!Number.isFinite(qty)) return null
  const code = normalizeUnit(unit)
  if (code === 'G') return round2(qty)
  if (code === 'KG') return round2(qty * 1000)
  return null
}

function productOf(products: Product[], productId: string) {
  return products.find((item) => item.id === productId)
}

function isPackagingMaterial(product: Product | undefined, categories: Category[]) {
  if (!product) return false
  if (normalizeUnit(product.unit) === 'PCS') return true
  const category = categories.find((item) => item.id === product.categoryId)
  return product.categoryId === 'cat-pack' || category?.name.trim().toLowerCase() === 'packaging'
}

function halalForProduct(
  productId: string,
  source: BmrSource,
): { manufacturer: string; expiry: string; status: string; remarks: string } {
  const rows = (source.halalCompliances ?? []).filter((item) => item.productId === productId)
  if (rows.length === 0) return { manufacturer: '', expiry: '', status: 'Not Registered', remarks: '' }
  if (rows.length > 1) return { manufacturer: '', expiry: '', status: '', remarks: BMR_MULTIPLE_HALAL_REMARK }
  const compliance = rows[0]
  const manufacturer = (source.manufacturers ?? []).find((item) => item.id === compliance.manufacturerId)
  const certificate = (source.halalCertificates ?? []).find((item) => item.id === compliance.certificateId)
  return {
    manufacturer: manufacturer?.name ?? '',
    expiry: certificate?.expiryDate && isDateKey(certificate.expiryDate) ? bmrDateLabel(certificate.expiryDate) : '',
    status: halalStatusLabel(deriveHalalStatus(certificate)),
    remarks: '',
  }
}

function materialRows(session: ProductionSession, source: BmrSource): BmrMaterialRow[] {
  const lines = session.materialClosing?.lines ?? []
  const rows: BmrMaterialRow[] = []
  for (const line of lines) {
    const product = productOf(source.products, line.productId)
    if (isPackagingMaterial(product, source.categories)) continue
    const grams = weightToGrams(line.actualUsedQty, product?.unit)
    const halal = halalForProduct(line.productId, source)
    rows.push({
      material: product?.name ?? 'Unknown material',
      manufacturer: halal.manufacturer,
      warehouseStockG: '',
      quantityUsedG: grams == null ? '' : formatQty(grams),
      expiryDate: halal.expiry,
      halalStatus: halal.status,
      remarks: halal.remarks,
    })
  }
  return rows
}

function packagingRows(session: ProductionSession, source: BmrSource): BmrPackagingRow[] {
  return session.items.map((item) => packagingRow(item, source))
}

function packagingRow(item: ProductionSessionItem, source: BmrSource): BmrPackagingRow {
  const product = productOf(source.products, item.productId)
  const bom = source.boms.find((row) => row.id === item.bomId)
  const grams = bom ? gramsPerPack(bom) : 0
  const released = item.actualQty
  const produced = grams > 0 ? round2(released * grams) : null
  const balance = item.productionBalanceQty > 0 ? `Production balance ${formatQty(item.productionBalanceQty)} g` : ''
  return {
    flavour: product?.name ?? 'Unknown product',
    sizeWeightG: grams > 0 ? formatQty(round2(grams)) : '',
    quantityProducedG: produced == null ? '' : formatQty(produced),
    quantityReleasedPack: formatQty(released),
    quantityRejected: '',
    remarks: balance,
  }
}

export function bmrProcessRows(): BmrProcessRow[] {
  return BMR_PROCESS_STEPS.map((description, index) => ({
    step: index + 1,
    description,
    timeStart: '',
    timeEnd: '',
    operatorName: '',
  }))
}

export function bmrDeviationRows(): BmrDeviationRow[] {
  return [{ issue: '', description: '', correctiveAction: '', responsiblePerson: '', date: '' }]
}

export function bmrApprovalRows(session: ProductionSession): BmrApprovalRow[] {
  return [
    { department: 'Production', name: session.completedBy || '', signature: '', date: bmrDateLabel(session.productionDate) },
    { department: 'QC / QA', name: '', signature: '', date: '' },
    { department: 'Halal Compliance', name: '', signature: '', date: '' },
  ]
}

export function paginateBmr(
  materials: BmrMaterialRow[],
  budgets: { first: number; next: number } = { first: BMR_FIRST_PAGE_MATERIALS, next: BMR_NEXT_PAGE_MATERIALS },
): BmrPage[] {
  const firstBudget = Math.max(1, budgets.first)
  const nextBudget = Math.max(1, budgets.next)
  const chunks: BmrMaterialRow[][] = []
  if (materials.length === 0) chunks.push([])
  else {
    chunks.push(materials.slice(0, firstBudget))
    for (let index = firstBudget; index < materials.length; index += nextBudget) {
      chunks.push(materials.slice(index, index + nextBudget))
    }
  }
  const materialPages: BmrPage[] = chunks.map((rows, index) => ({
    materials: rows,
    showDocumentHeader: index === 0,
    showProcess: false,
    showPackaging: false,
    showDeviations: false,
    showApproval: false,
  }))
  const last = materialPages[materialPages.length - 1]
  const processFits = materials.length <= firstBudget
  if (processFits) last.showProcess = true
  else {
    materialPages.push({
      materials: [],
      showDocumentHeader: false,
      showProcess: true,
      showPackaging: false,
      showDeviations: false,
      showApproval: false,
    })
  }
  materialPages.push({
    materials: [],
    showDocumentHeader: false,
    showProcess: false,
    showPackaging: true,
    showDeviations: true,
    showApproval: true,
  })
  return materialPages
}

export function buildBmr(session: ProductionSession | undefined, source: BmrSource): BmrDocument | null {
  if (!session || !canPrintBmr(session)) return null
  const expiryDate = bmrExpiryDate(session.productionDate)
  const materials = materialRows(session, source)
  const names = session.items.map((item) => productOf(source.products, item.productId)?.name ?? 'Unknown product')
  return {
    sessionId: session.id,
    productName: names.join(', '),
    batchNo: bmrBatchNo(session.productionDate),
    productionDate: session.productionDate,
    productionDateLabel: bmrDateLabel(session.productionDate),
    expiryDate,
    expiryDateLabel: bmrDateLabel(expiryDate),
    approvedBy: '',
    materials,
    process: bmrProcessRows(),
    packaging: packagingRows(session, source),
    deviations: bmrDeviationRows(),
    approval: bmrApprovalRows(session),
    pages: paginateBmr(materials),
  }
}
