import * as XLSX from 'xlsx'
import { downloadCsv } from '@/utils/format'

export type SpreadsheetMatrix = string[][]

export type SpreadsheetParseResult =
  | { ok: true; fileName: string; matrix: SpreadsheetMatrix }
  | { ok: false; reason: string }

const SPREADSHEET_EXTENSIONS = ['.xlsx', '.xls', '.csv']

export function spreadsheetExtension(fileName: string) {
  const match = fileName.trim().toLowerCase().match(/(\.[a-z0-9]+)$/)
  return match?.[1] ?? ''
}

export function isSpreadsheetFileName(fileName: string) {
  return SPREADSHEET_EXTENSIONS.includes(spreadsheetExtension(fileName))
}

function cellText(value: unknown) {
  if (value == null || value === '') return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return String(value).trim()
}

export function parseCsvText(text: string): SpreadsheetMatrix {
  const rows: SpreadsheetMatrix = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const source = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ',') {
      row.push(cell.trim())
      cell = ''
      continue
    }
    if (char === '\n') {
      row.push(cell.trim())
      cell = ''
      if (row.some((value) => value)) rows.push(row)
      row = []
      continue
    }
    if (char !== '\r') cell += char
  }
  row.push(cell.trim())
  if (row.some((value) => value)) rows.push(row)
  return rows
}

export function matrixFromWorkbook(workbook: XLSX.WorkBook): SpreadsheetMatrix {
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  const raw = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
    defval: '',
  })
  return raw
    .map((row) => (Array.isArray(row) ? row.map((cell) => cellText(cell)) : []))
    .filter((row) => row.some((cell) => cell))
}

export function parseSpreadsheetBytes(fileName: string, bytes: ArrayBuffer | Uint8Array): SpreadsheetParseResult {
  if (!isSpreadsheetFileName(fileName)) {
    return { ok: false, reason: 'Choose an Excel (.xlsx) or CSV file.' }
  }
  try {
    if (spreadsheetExtension(fileName) === '.csv') {
      const text = new TextDecoder('utf-8').decode(bytes)
      return { ok: true, fileName, matrix: parseCsvText(text) }
    }
    const workbook = XLSX.read(bytes, { type: 'array', cellDates: true })
    return { ok: true, fileName, matrix: matrixFromWorkbook(workbook) }
  } catch {
    return { ok: false, reason: 'The file could not be read. Use a valid Excel or CSV file.' }
  }
}

export function parseSpreadsheetText(fileName: string, text: string): SpreadsheetParseResult {
  if (!isSpreadsheetFileName(fileName)) {
    return { ok: false, reason: 'Choose an Excel (.xlsx) or CSV file.' }
  }
  if (spreadsheetExtension(fileName) !== '.csv') {
    return { ok: false, reason: 'The file could not be read. Use a valid Excel or CSV file.' }
  }
  return { ok: true, fileName, matrix: parseCsvText(text) }
}

export async function parseSpreadsheetFile(file: File): Promise<SpreadsheetParseResult> {
  if (!isSpreadsheetFileName(file.name)) {
    return { ok: false, reason: 'Choose an Excel (.xlsx) or CSV file.' }
  }
  const bytes = await file.arrayBuffer()
  return parseSpreadsheetBytes(file.name, bytes)
}

export function workbookFromMatrix(matrix: SpreadsheetMatrix, sheetName = 'Sheet1') {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet(matrix)
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
  return workbook
}

export function xlsxBytesFromMatrix(matrix: SpreadsheetMatrix, sheetName = 'Sheet1') {
  const workbook = workbookFromMatrix(matrix, sheetName)
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

export function downloadXlsx(filename: string, matrix: SpreadsheetMatrix, sheetName = 'Sheet1') {
  const bytes = xlsxBytesFromMatrix(matrix, sheetName)
  const copy = new Uint8Array(bytes)
  const blob = new Blob([copy], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadSpreadsheetCsv(filename: string, matrix: SpreadsheetMatrix) {
  downloadCsv(filename.endsWith('.csv') ? filename : `${filename}.csv`, matrix)
}
