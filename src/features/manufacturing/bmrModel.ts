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

export const BMR_PROCESS_RULES = {
  weighingUpTo5: 30,
  weighingUpTo10: 45,
  weighingAbove10: 60,
  mixing: 60,
  fillingPacks: 45,
  fillingMinutes: 30,
  grinding: 45,
  cleaning: 60,
} as const

export const BMR_PROCESS_NOTE = 'Process times are system-calculated estimates; verify actual time before signing.'
export const BMR_PROCESS_UNAVAILABLE_NOTE = 'Process times were not calculated. A start time, material closing, and released packs are required.'

export type BmrProcessRow = {
  step: number
  description: string
  timeStart: string
  timeEnd: string
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
  processNote: string
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

export type BmrRecordRange = 'all' | 'today' | 'week' | 'month' | 'custom'

export type BmrRecordListItem = {
  sessionId: string
  productionDate: string
  dateLabel: string
  batchNo: string
  productName: string
  warehouseId: string
  warehouseName: string
  reference: string
  status: 'Completed'
  completedAt: string
  printPath: string
  viewPath: string
}

export function listBmrRecords(
  sessions: ProductionSession[],
  products: Product[],
  warehouses: Array<{ id: string; name: string }>,
): BmrRecordListItem[] {
  return sessions
    .filter((session) => canPrintBmr(session))
    .map((session) => ({
      sessionId: session.id,
      productionDate: session.productionDate,
      dateLabel: bmrDateLabel(session.productionDate),
      batchNo: bmrBatchNo(session.productionDate),
      productName: session.items.map((item) => productOf(products, item.productId)?.name ?? 'Unknown product').join(', '),
      warehouseId: session.warehouseId,
      warehouseName: warehouses.find((item) => item.id === session.warehouseId)?.name ?? '',
      reference: session.reference,
      status: 'Completed' as const,
      completedAt: session.completedAt || '',
      printPath: `/manufacturing/bmr/${session.id}`,
      viewPath: `/manufacturing/history/${session.id}`,
    }))
    .sort((a, b) => b.productionDate.localeCompare(a.productionDate) || b.completedAt.localeCompare(a.completedAt) || b.sessionId.localeCompare(a.sessionId))
}

function dateKeyFromUtc(date: Date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function bmrWeekBounds(today: string) {
  if (!isDateKey(today)) return { from: '', to: '' }
  const [year, month, day] = today.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const weekday = date.getUTCDay()
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday
  const start = new Date(date)
  start.setUTCDate(date.getUTCDate() + mondayOffset)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 6)
  return { from: dateKeyFromUtc(start), to: dateKeyFromUtc(end) }
}

export function filterBmrRecords(
  rows: BmrRecordListItem[],
  input: { query?: string; range?: BmrRecordRange; from?: string; to?: string; warehouseId?: string; today?: string },
) {
  const today = input.today && isDateKey(input.today) ? input.today : ''
  const range = input.range ?? 'all'
  const week = today ? bmrWeekBounds(today) : { from: '', to: '' }
  const month = today.slice(0, 7)
  const needle = (input.query ?? '').trim().toLowerCase()
  return rows.filter((row) => {
    if (input.warehouseId && input.warehouseId !== 'all' && row.warehouseId !== input.warehouseId) return false
    if (range === 'today' && row.productionDate !== today) return false
    if (range === 'week' && (row.productionDate < week.from || row.productionDate > week.to)) return false
    if (range === 'month' && !row.productionDate.startsWith(month)) return false
    if (range === 'custom') {
      if (input.from && row.productionDate < input.from) return false
      if (input.to && row.productionDate > input.to) return false
    }
    if (!needle) return true
    return [row.batchNo, row.productName, row.reference].some((value) => value.toLowerCase().includes(needle))
  })
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

export function blankProcessRows(): BmrProcessRow[] {
  return BMR_PROCESS_STEPS.map((description, index) => ({
    step: index + 1,
    description,
    timeStart: '',
    timeEnd: '',
    operatorName: '',
  }))
}

export function weighingMinutes(materialLines: number) {
  if (materialLines <= 0) return null
  if (materialLines <= 5) return BMR_PROCESS_RULES.weighingUpTo5
  if (materialLines <= 10) return BMR_PROCESS_RULES.weighingUpTo10
  return BMR_PROCESS_RULES.weighingAbove10
}

export function fillingMinutes(totalPacks: number) {
  if (!Number.isFinite(totalPacks) || totalPacks <= 0) return null
  return Math.ceil(totalPacks / BMR_PROCESS_RULES.fillingPacks) * BMR_PROCESS_RULES.fillingMinutes
}

export function formatProcessClock(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(date)
}

function countableMaterialLines(session: ProductionSession, source: BmrSource) {
  return (session.materialClosing?.lines ?? []).filter((line) => {
    const product = productOf(source.products, line.productId)
    return !isPackagingMaterial(product, source.categories)
  }).length
}

export function buildProcessSchedule(input: {
  startedAt: string
  materialLines: number
  totalPacks: number
}): { rows: BmrProcessRow[]; note: string } {
  const start = new Date(input.startedAt)
  const weighing = weighingMinutes(input.materialLines)
  const filling = fillingMinutes(input.totalPacks)
  if (!input.startedAt || Number.isNaN(start.getTime()) || weighing == null || filling == null) {
    return { rows: blankProcessRows(), note: BMR_PROCESS_UNAVAILABLE_NOTE }
  }
  const durations = [
    weighing,
    BMR_PROCESS_RULES.mixing,
    filling,
    BMR_PROCESS_RULES.grinding,
    BMR_PROCESS_RULES.cleaning,
  ]
  let cursor = start.getTime()
  const rows = BMR_PROCESS_STEPS.map((description, index) => {
    const timeStart = formatProcessClock(new Date(cursor))
    cursor += durations[index] * 60_000
    return {
      step: index + 1,
      description,
      timeStart,
      timeEnd: formatProcessClock(new Date(cursor)),
      operatorName: '' as const,
    }
  })
  return { rows, note: BMR_PROCESS_NOTE }
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

export function buildBmr(session: ProductionSession | undefined, source: BmrSource): BmrDocument | null {
  if (!session || !canPrintBmr(session)) return null
  const expiryDate = bmrExpiryDate(session.productionDate)
  const materials = materialRows(session, source)
  const names = session.items.map((item) => productOf(source.products, item.productId)?.name ?? 'Unknown product')
  const schedule = buildProcessSchedule({
    startedAt: session.startedAt,
    materialLines: countableMaterialLines(session, source),
    totalPacks: session.items.reduce((sum, item) => sum + Math.max(0, item.actualQty || 0), 0),
  })
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
    process: schedule.rows,
    packaging: packagingRows(session, source),
    deviations: bmrDeviationRows(),
    approval: bmrApprovalRows(session),
    processNote: schedule.note,
  }
}
