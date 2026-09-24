import { isCompanyWarehouseId } from '@/features/agent/agentModel'
import type { Product, Receiving, ReceivingCondition, Supplier, Warehouse } from '@/types'
import { systemDateKey } from '@/utils/format'

export const PJKM_511 = {
  company: 'COOL SLURPPY MARKETING',
  manual: 'MANUAL PJKM',
  control: 'KAWALAN OPERASI',
  documentNo: 'MGT/05',
  effectiveDate: '1 Apr 2024',
  version: '1',
  subtopic: 'SUB TOPIK : PENERIMAAN BAHAN MENTAH',
  title: 'REKOD 5.1.1 : PENERIMAAN BAHAN MENTAH',
} as const

export const PJKM_ROW_BUDGET = 12

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type PjkmWarningCode = 'supplier' | 'batch' | 'condition'

export type PjkmRow = {
  receivingId: string
  receivingNo: string
  date: string
  supplier: string
  product: string
  batchCell: string
  qtyText: string
  condition: ReceivingCondition | ''
  notes: string
  preparedBy: string
  verifiedBy: ''
  warnings: PjkmWarningCode[]
}

export type PjkmPage = {
  page: number
  pages: number
  label: string
  rows: PjkmRow[]
}

export function pjkmDate(iso: string) {
  const key = systemDateKey(new Date(iso))
  const [year, month, day] = key.split('-')
  return `${Number(day)}-${MONTHS[Number(month) - 1]}-${year}`
}

export function pjkmMonthKey(iso: string) {
  return systemDateKey(new Date(iso)).slice(0, 7)
}

export function pjkmQtyText(qty: number, unit: string) {
  const amount = Number.isInteger(qty) ? String(qty) : String(qty)
  const raw = unit.trim()
  const label = raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : ''
  return label ? `${amount} ${label}` : amount
}

function expiryText(value: string | undefined) {
  if (!value?.trim()) return ''
  const parsed = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!parsed) return value.trim()
  return `${Number(parsed[3])}-${MONTHS[Number(parsed[2]) - 1]}-${parsed[1]}`
}

export function pjkmBatchCell(batchNo?: string, expiry?: string) {
  const batch = batchNo?.trim() ?? ''
  const exp = expiryText(expiry)
  if (batch && exp) return `${batch}\n${exp}`
  return batch || exp
}

function rowWeight(row: PjkmRow) {
  const longest = Math.max(row.supplier.length, row.product.length, row.notes.length, row.batchCell.length, 1)
  return Math.max(1, Math.ceil(longest / 22))
}

export function paginatePjkmRows(rows: PjkmRow[], rowBudget = PJKM_ROW_BUDGET): PjkmPage[] {
  const pages: PjkmRow[][] = []
  let current: PjkmRow[] = []
  let used = 0
  for (const row of rows) {
    const weight = Math.min(rowWeight(row), rowBudget)
    if (current.length && used + weight > rowBudget) {
      pages.push(current)
      current = []
      used = 0
    }
    current.push(row)
    used += weight
  }
  if (current.length || pages.length === 0) pages.push(current)
  const count = Math.max(pages.length, 1)
  return pages.map((pageRows, index) => ({
    page: index + 1,
    pages: count,
    label: `${index + 1} of ${count}`,
    rows: pageRows,
  }))
}

export function buildPjkm511(input: {
  month: string
  receivings: Receiving[]
  suppliers: Supplier[]
  products: Product[]
  warehouses: Warehouse[]
  rowBudget?: number
}) {
  const rows: PjkmRow[] = []
  const ordered = [...input.receivings].sort((a, b) => a.date.localeCompare(b.date) || a.receivingNo.localeCompare(b.receivingNo))
  for (const receiving of ordered) {
    if (receiving.status !== 'completed') continue
    if (pjkmMonthKey(receiving.date) !== input.month) continue
    if (!isCompanyWarehouseId(input.warehouses, receiving.warehouseId)) continue
    const supplier = receiving.supplierId ? input.suppliers.find((item) => item.id === receiving.supplierId) : undefined
    receiving.items.forEach((line) => {
      const product = input.products.find((item) => item.id === line.productId)
      const warnings: PjkmWarningCode[] = []
      if (!supplier) warnings.push('supplier')
      if (!line.batchNo?.trim() && !line.expiry?.trim()) warnings.push('batch')
      if (!line.condition) warnings.push('condition')
      rows.push({
        receivingId: receiving.id,
        receivingNo: receiving.receivingNo,
        date: pjkmDate(receiving.date),
        supplier: supplier?.name ?? '',
        product: product?.name ?? '',
        batchCell: pjkmBatchCell(line.batchNo, line.expiry),
        qtyText: pjkmQtyText(line.qty, line.unit),
        condition: line.condition ?? '',
        notes: line.notes?.trim() ?? '',
        preparedBy: receiving.receivedByName,
        verifiedBy: '',
        warnings,
      })
    })
  }
  return {
    rows,
    pages: paginatePjkmRows(rows, input.rowBudget),
    attention: rows.filter((row) => row.warnings.length > 0),
  }
}
