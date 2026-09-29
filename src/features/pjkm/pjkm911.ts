import { DISPATCH_COURIER_ORDER, dispatchAwbTotals, dispatchCourierKeys, inspectionCourierConflict } from '@/features/dispatch/dispatchModel'
import type { DispatchCourierKey, DispatchRecord, InspectionGroup } from '@/types'

export const PJKM_911 = {
  company: 'COOL SLURPPY MARKETING',
  manual: 'MANUAL PJKM',
  control: 'KAWALAN PENGEDARAN DAN PENGANGKUTAN',
  subtopic: 'SUB TOPIK : PEMERIKSAAN KENDERAAN',
  documentNo: 'MGT/09',
  effectiveDate: '1 Apr 2024',
  version: '1',
  title: 'REKOD 9.1.1 : REKOD PEMERIKSAAN KENDERAAN',
} as const

export const PJKM_911_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const

export const PJKM_911_DETAILS = [
  { key: 'parcel', lines: ['QUANTITI', 'PARCEL'] },
  { key: 'vehicle', lines: ['JENIS', 'KENDERAAN'] },
  { key: 'plate', lines: ['PLATE', 'NUMBER'] },
  { key: 'suhu', lines: ['SUHU', 'KENDERAAN'] },
  { key: 'condition', lines: ['KEADAAN'] },
] as const

export type Pjkm911DetailKey = (typeof PJKM_911_DETAILS)[number]['key']

const PAGE_INNER_MM = 297 - 14 - 18
const SHEET_PAD_MM = 8
const FIRST_CHROME_MM = 38
const NEXT_CHROME_MM = 0
const TABLE_HEAD_MM = 11
const LINE_MM = 3.3
const ROW_PAD_MM = 1.8
const FIXED_MM = { tarikh: 14, butiran: 22, total: 16 }

export type Pjkm911Cell = {
  parcelQty: number
  vehicleType: string
  plateNumber: string
}

export type Pjkm911Block = {
  id: string
  bil: number
  dateKey: string
  cells: Partial<Record<DispatchCourierKey, Pjkm911Cell>>
  totalAwb: number
  dispatchIds: string[]
}

export type Pjkm911Page = {
  page: number
  pages: number
  label: string
  blocks: Pjkm911Block[]
  columns: DispatchCourierKey[]
  bulan: string
  tahun: string
}

function wrappedLines(value: string, chars: number) {
  if (!value) return 1
  return Math.max(1, Math.ceil(value.length / Math.max(chars, 1)))
}

export function pjkm911Period(month: string) {
  const [year, monthNo] = month.split('-')
  return { bulan: PJKM_911_MONTHS[Number(monthNo) - 1] ?? '', tahun: year ?? '' }
}

export function pjkm911Widths(columnCount: number) {
  const count = Math.max(columnCount, 1)
  const courier = (186 - FIXED_MM.tarikh - FIXED_MM.butiran - FIXED_MM.total) / count
  return { tarikh: FIXED_MM.tarikh, butiran: FIXED_MM.butiran, courier, total: FIXED_MM.total, table: 186 }
}

export function pjkm911DetailValue(block: Pjkm911Block, column: DispatchCourierKey, detail: Pjkm911DetailKey) {
  const cell = block.cells[column]
  if (!cell) return ''
  if (detail === 'parcel') return String(cell.parcelQty)
  if (detail === 'vehicle') return cell.vehicleType
  if (detail === 'plate') return cell.plateNumber
  if (detail === 'suhu') return ''
  return 'BAIK'
}

function blockMm(block: Pjkm911Block, columns: DispatchCourierKey[]) {
  const widths = pjkm911Widths(columns.length)
  const chars = Math.max(1, Math.floor((widths.courier - 1.2) / 1.9))
  let vehicleLines = 2
  let plateLines = 2
  for (const column of columns) {
    const cell = block.cells[column]
    if (!cell) continue
    vehicleLines = Math.max(vehicleLines, wrappedLines(cell.vehicleType, chars))
    plateLines = Math.max(plateLines, wrappedLines(cell.plateNumber, chars))
  }
  const lines = [2, vehicleLines, plateLines, 2, 1]
  return lines.reduce((sum, count) => sum + count * LINE_MM + ROW_PAD_MM, 0)
}

export function paginatePjkm911(
  blocks: Pjkm911Block[],
  columns: DispatchCourierKey[],
  period: { bulan: string; tahun: string },
  limits?: { firstMm?: number; nextMm?: number },
): Pjkm911Page[] {
  const firstMm = limits?.firstMm ?? PAGE_INNER_MM - SHEET_PAD_MM - FIRST_CHROME_MM - TABLE_HEAD_MM
  const nextMm = limits?.nextMm ?? PAGE_INNER_MM - SHEET_PAD_MM - NEXT_CHROME_MM - TABLE_HEAD_MM
  const pages: Pjkm911Block[][] = []
  let current: Pjkm911Block[] = []
  let used = 0
  let budget = firstMm
  for (const block of blocks) {
    const height = blockMm(block, columns)
    if (current.length && used + height > budget) {
      pages.push(current)
      current = []
      used = 0
      budget = nextMm
    }
    current.push(block)
    used += height
    if (height > budget) {
      pages.push(current)
      current = []
      used = 0
      budget = nextMm
    }
  }
  if (current.length || pages.length === 0) pages.push(current)
  const count = Math.max(pages.length, 1)
  return pages.map((pageBlocks, index) => ({
    page: index + 1,
    pages: count,
    label: `${index + 1} of ${count}`,
    blocks: pageBlocks,
    columns,
    bulan: period.bulan,
    tahun: period.tahun,
  }))
}

function cellsFor(dispatches: DispatchRecord[]) {
  const cells: Pjkm911Block['cells'] = {}
  const lines = dispatches.flatMap((row) => row.lines)
  for (const key of DISPATCH_COURIER_ORDER) {
    const owners = dispatches.filter((row) => dispatchCourierKeys(row).includes(key))
    if (owners.length !== 1) continue
    const parcelQty = lines.filter((line) => line.courierKey === key).reduce((sum, line) => sum + line.parcelQty, 0)
    cells[key] = { parcelQty, vehicleType: owners[0].vehicleType, plateNumber: owners[0].plateNumber }
  }
  return { cells, totalAwb: dispatchAwbTotals(lines).totalAwb }
}

function clusters(dispatches: DispatchRecord[], groups?: InspectionGroup[]) {
  const confirmedIds = groups ? new Set(groups.filter((group) => group.status === 'confirmed').map((group) => group.id)) : null
  const buckets = new Map<string, DispatchRecord[]>()
  const singles: DispatchRecord[] = []
  for (const row of dispatches) {
    const groupId = row.inspectionGroupId
    if (groupId && (confirmedIds == null || confirmedIds.has(groupId))) {
      buckets.set(groupId, [...(buckets.get(groupId) ?? []), row])
    } else singles.push(row)
  }
  const result: Array<{ id: string; dateKey: string; confirmedAt: string; dispatches: DispatchRecord[] }> = []
  for (const [id, rows] of buckets) {
    const dates = new Set(rows.map((row) => row.dispatchDate))
    if (dates.size !== 1 || inspectionCourierConflict(rows)) {
      singles.push(...rows)
      continue
    }
    const confirmedAt = rows.map((row) => row.confirmedAt || row.createdAt).sort()[0]
    result.push({ id, dateKey: rows[0].dispatchDate, confirmedAt, dispatches: rows })
  }
  for (const row of singles) {
    result.push({ id: row.id, dateKey: row.dispatchDate, confirmedAt: row.confirmedAt || row.createdAt, dispatches: [row] })
  }
  return result.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.confirmedAt.localeCompare(b.confirmedAt) || a.id.localeCompare(b.id))
}

export function buildPjkm911(input: { month: string; dispatches: DispatchRecord[]; groups?: InspectionGroup[] }) {
  const confirmed = input.dispatches.filter((row) => row.status === 'confirmed' && row.dispatchDate.startsWith(`${input.month}-`))
  const period = pjkm911Period(input.month)
  const blocks: Pjkm911Block[] = clusters(confirmed, input.groups).map((cluster, index) => {
    const built = cellsFor(cluster.dispatches)
    return {
      id: cluster.id,
      bil: index + 1,
      dateKey: cluster.dateKey,
      cells: built.cells,
      totalAwb: built.totalAwb,
      dispatchIds: cluster.dispatches.map((row) => row.id),
    }
  })
  const columns = DISPATCH_COURIER_ORDER.filter((key) => blocks.some((block) => block.cells[key]))
  return {
    month: input.month,
    bulan: period.bulan,
    tahun: period.tahun,
    columns,
    blocks,
    pages: paginatePjkm911(blocks, columns, period),
    unknown: columns.includes('UNKNOWN'),
  }
}
