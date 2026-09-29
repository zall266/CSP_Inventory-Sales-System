import { activeCourierColumns, dispatchAwbTotals } from '@/features/dispatch/dispatchModel'
import { pjkmDate } from '@/features/pjkm/pjkm511'
import type { DispatchCourierKey, DispatchRecord } from '@/types'

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

const PAGE_INNER_MM = 297 - 14 - 18
const SHEET_PAD_MM = 8
const FIRST_CHROME_MM = 28
const NEXT_CHROME_MM = 6
const TABLE_HEAD_MM = 12
const LINE_MM = 3.05

const FIXED_MM = { tarikh: 13, total: 9, parcel: 11, jenis: 14, plate: 12, suhu: 16, keadaan: 12 }

export type Pjkm911Row = {
  dispatchId: string
  dateKey: string
  dateLabel: string
  counts: Partial<Record<DispatchCourierKey, number>>
  totalAwb: number
  parcelQty: number
  vehicleType: string
  plateNumber: string
  condition: 'BAIK'
}

export type Pjkm911Page = {
  page: number
  pages: number
  label: string
  rows: Pjkm911Row[]
  columns: DispatchCourierKey[]
}

function wrappedLines(value: string, chars: number) {
  if (!value) return 1
  return Math.max(1, Math.ceil(value.length / Math.max(chars, 1)))
}

export function pjkm911Widths(columnCount: number) {
  const fixedTotal = Object.values(FIXED_MM).reduce((sum, value) => sum + value, 0)
  const leftover = 186 - fixedTotal
  const courier = columnCount ? Math.min(18, leftover / columnCount) : 0
  const spare = leftover - courier * columnCount
  return {
    tarikh: FIXED_MM.tarikh,
    courier,
    total: FIXED_MM.total,
    parcel: FIXED_MM.parcel,
    jenis: FIXED_MM.jenis + spare / 2,
    plate: FIXED_MM.plate + spare / 2,
    suhu: FIXED_MM.suhu,
    keadaan: FIXED_MM.keadaan,
  }
}

function pageHeight(rows: Pjkm911Row[], columnCount: number) {
  return rows.reduce((sum, row) => sum + rowLines(row, columnCount) * LINE_MM, 0)
}

function balanceSingleRowTail(pages: Pjkm911Row[][], columnCount: number, firstMm: number, nextMm: number) {
  if (pages.length < 2 || pages[pages.length - 1].length !== 1) return pages
  const previousIndex = pages.length - 2
  const previousBudget = previousIndex === 0 ? firstMm : nextMm
  const pool = [...pages[previousIndex], ...pages[pages.length - 1]]
  let splitAt = pages[previousIndex].length
  let closest = Number.POSITIVE_INFINITY
  for (let split = 1; split < pool.length; split += 1) {
    const left = pool.slice(0, split)
    const right = pool.slice(split)
    if (right.length < 2) continue
    if (pageHeight(left, columnCount) > previousBudget) continue
    if (pageHeight(right, columnCount) > nextMm) continue
    const gap = Math.abs(left.length - right.length)
    if (gap < closest) {
      closest = gap
      splitAt = split
    }
  }
  if (splitAt === pages[previousIndex].length) return pages
  const next = pages.slice()
  next[previousIndex] = pool.slice(0, splitAt)
  next[next.length - 1] = pool.slice(splitAt)
  return next
}

function rowLines(row: Pjkm911Row, columnCount: number) {
  const widths = pjkm911Widths(columnCount)
  return Math.max(
    1,
    wrappedLines(row.dateLabel, Math.floor(widths.tarikh * 0.85)),
    wrappedLines(row.vehicleType, Math.floor(widths.jenis * 0.85)),
    wrappedLines(row.plateNumber, Math.floor(widths.plate * 0.85)),
  )
}

export function paginatePjkm911(
  rows: Pjkm911Row[],
  columns: DispatchCourierKey[],
  limits?: { firstMm?: number; nextMm?: number },
): Pjkm911Page[] {
  const firstMm = limits?.firstMm ?? PAGE_INNER_MM - SHEET_PAD_MM - FIRST_CHROME_MM - TABLE_HEAD_MM
  const nextMm = limits?.nextMm ?? PAGE_INNER_MM - SHEET_PAD_MM - NEXT_CHROME_MM - TABLE_HEAD_MM
  const pages: Pjkm911Row[][] = []
  let current: Pjkm911Row[] = []
  let used = 0
  let budget = firstMm
  for (const row of rows) {
    const height = rowLines(row, columns.length) * LINE_MM
    if (current.length && used + height > budget) {
      pages.push(current)
      current = []
      used = 0
      budget = nextMm
    }
    current.push(row)
    used += height
  }
  if (current.length || pages.length === 0) pages.push(current)
  const balanced = balanceSingleRowTail(pages, columns.length, firstMm, nextMm)
  const count = Math.max(balanced.length, 1)
  return balanced.map((pageRows, index) => ({
    page: index + 1,
    pages: count,
    label: `${index + 1} of ${count}`,
    rows: pageRows,
    columns,
  }))
}

export function buildPjkm911(input: { month: string; dispatches: DispatchRecord[] }) {
  const confirmed = input.dispatches
    .filter((row) => row.status === 'confirmed' && row.dispatchDate.startsWith(`${input.month}-`))
    .sort((a, b) => a.dispatchDate.localeCompare(b.dispatchDate) || a.vehicleCode.localeCompare(b.vehicleCode) || a.id.localeCompare(b.id))
  const rows: Pjkm911Row[] = confirmed.map((row) => {
    const totals = dispatchAwbTotals(row.lines)
    return {
      dispatchId: row.id,
      dateKey: row.dispatchDate,
      dateLabel: pjkmDate(`${row.dispatchDate}T12:00:00+08:00`),
      counts: totals.counts,
      totalAwb: totals.totalAwb,
      parcelQty: totals.parcelQty,
      vehicleType: row.vehicleType,
      plateNumber: row.plateNumber,
      condition: 'BAIK',
    }
  })
  const columns = activeCourierColumns(rows)
  return {
    rows,
    columns,
    pages: paginatePjkm911(rows, columns),
    unknown: rows.some((row) => (row.counts.UNKNOWN ?? 0) > 0),
  }
}
