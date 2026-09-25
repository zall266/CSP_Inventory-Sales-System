import type { Product, ProductionSession, Sale, StockMovement, Warehouse } from '@/types'
import { round2, systemDateKey } from '@/utils/format'
import { pjkmDate } from '@/features/pjkm/pjkm511'

export const PJKM_1011 = {
  company: 'COOL SLURPPY MARKETING',
  manual: 'MANUAL PJKM',
  control: 'KAWALAN KEBOLEHKESANAN',
  documentNo: 'MGT/10',
  effectiveDate: '1 Apr 2024',
  version: '1',
  subtopic: 'SUB TOPIK : REKOD PENGEDAR / PENJUAL',
  title: 'REKOD 10.1.1 : REKOD PENGEDAR / PENJUAL',
} as const

/** Landscape rows are taller than 5.1.1. Budget is weighted lines, not a fixed page count. */
export const PJKM_1011_ROW_BUDGET = 14

const FINISHED_CATEGORIES = new Set(['cat-air', 'cat-ice', 'cat-waffle'])
const IN_TYPES = new Set(['production_in', 'receiving', 'opening_balance', 'opening_stock', 'sales_return', 'sales_return_good'])
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export type Pjkm1011Warning = 'seller' | 'warehouse'

export type Pjkm1011Row = {
  key: string
  bil: number
  productId: string
  product: string
  warehouseId: string
  dateKey: string
  tarikhBuat: string
  tarikhLuput: string
  qtyIn: number | null
  qtyOut: number | null
  tempatSimpan: string
  seller: string
  tarikhEdar: string
  batchNo: ''
  baki: number
  warnings: Pjkm1011Warning[]
}

export type Pjkm1011Page = {
  page: number
  pages: number
  label: string
  rows: Pjkm1011Row[]
}

type LedgerEvent = {
  dateKey: string
  productId: string
  warehouseId: string
  qtyIn: number
  qtyOut: number
  seller: string
  tarikhBuat: string
  reference: string
}

function dateKeyOf(iso: string) {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 10)
  return systemDateKey(parsed)
}

function displayDate(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return ''
  return pjkmDate(`${dateKey}T12:00:00+08:00`)
}

export function pjkm1011MonthLabel(month: string) {
  const [year, raw] = month.split('-')
  const index = Number(raw) - 1
  if (!year || index < 0 || index > 11) return month
  return `BULAN : ${MONTHS[index]} TAHUN : ${year}`
}

/** Marketplace channel is stored on the sale reference. Customer name is not a distributor. */
export function pjkm1011Seller(reference?: string) {
  const match = /^(SHOPEE|TIKTOK):([^:]+):/.exec(reference?.trim() ?? '')
  if (!match) return ''
  const platform = match[1] === 'SHOPEE' ? 'Shopee' : 'TikTok'
  const account = match[2].trim()
  return account ? `${platform} / ${account}` : platform
}

export function pjkm1011FinishedIds(products: Product[], sessions: ProductionSession[], movements: StockMovement[]) {
  const output = new Set<string>()
  for (const session of sessions) {
    if (!session.posted || session.status !== 'completed') continue
    for (const item of session.items) {
      if (item.actualQty > 0) output.add(item.productId)
    }
  }
  for (const movement of movements) {
    if (movement.type === 'production_in' && movement.stockIn > 0) output.add(movement.productId)
  }
  const ids = new Set<string>()
  for (const product of products) {
    if (product.categoryId === 'cat-pack') continue
    const unit = product.unit.trim().toLowerCase()
    if (FINISHED_CATEGORIES.has(product.categoryId) || output.has(product.id) || unit === 'packs') ids.add(product.id)
  }
  return ids
}

function sessionProductionDate(sessions: ProductionSession[], reference: string) {
  const session = sessions.find((item) => item.reference === reference && item.posted && item.status === 'completed')
  return session?.productionDate ? dateKeyOf(session.productionDate) : ''
}

function pushEvent(events: LedgerEvent[], event: LedgerEvent) {
  if (event.qtyIn <= 0 && event.qtyOut <= 0) return
  events.push(event)
}

function buildEvents(input: {
  movements: StockMovement[]
  sales: Sale[]
  sessions: ProductionSession[]
  finished: Set<string>
}) {
  const events: LedgerEvent[] = []
  const voidDates = new Map<string, string>()
  for (const movement of input.movements) {
    if (!movement.reference.endsWith('-VOID')) continue
    const invoice = movement.reference.slice(0, -'-VOID'.length)
    if (!voidDates.has(invoice)) voidDates.set(invoice, dateKeyOf(movement.date))
  }

  for (const movement of input.movements) {
    if (!input.finished.has(movement.productId)) continue
    if (movement.notes?.startsWith('Sales component')) continue
    const dateKey = dateKeyOf(movement.date)
    if (movement.type === 'sale' && movement.stockOut > 0) {
      pushEvent(events, {
        dateKey,
        productId: movement.productId,
        warehouseId: movement.warehouseId,
        qtyIn: 0,
        qtyOut: movement.stockOut,
        seller: '',
        tarikhBuat: '',
        reference: movement.reference,
      })
      continue
    }
    if (movement.type === 'sales_return' && movement.notes === 'Voided sale') {
      const invoice = movement.reference.endsWith('-VOID') ? movement.reference.slice(0, -5) : ''
      const sale = input.sales.find((item) => item.invoiceNo === invoice)
      const restoredComponent = sale?.items.some((line) =>
        line.salesComponentsSnapshot?.some((row) => row.productId === movement.productId),
      )
      if (restoredComponent) continue
    }
    if (!IN_TYPES.has(movement.type) || movement.stockIn <= 0) continue
    const produced = movement.type === 'production_in' ? sessionProductionDate(input.sessions, movement.reference) : ''
    pushEvent(events, {
      dateKey,
      productId: movement.productId,
      warehouseId: movement.warehouseId,
      qtyIn: movement.stockIn,
      qtyOut: 0,
      seller: '',
      tarikhBuat: produced || (movement.type === 'production_in' || movement.type === 'receiving' ? dateKey : ''),
      reference: movement.reference,
    })
  }

  for (const sale of input.sales) {
    for (const line of sale.items) {
      if (!line.salesComponentsSnapshot?.length) continue
      if (!input.finished.has(line.productId)) continue
      const seller = pjkm1011Seller(sale.reference)
      pushEvent(events, {
        dateKey: dateKeyOf(sale.date),
        productId: line.productId,
        warehouseId: sale.warehouseId,
        qtyIn: 0,
        qtyOut: line.qty,
        seller,
        tarikhBuat: '',
        reference: sale.invoiceNo,
      })
      if (sale.status !== 'voided') continue
      const restored = round2(line.qty - line.returnedQty)
      const voidDate = voidDates.get(sale.invoiceNo)
      if (!(restored > 0) || !voidDate) continue
      pushEvent(events, {
        dateKey: voidDate,
        productId: line.productId,
        warehouseId: sale.warehouseId,
        qtyIn: restored,
        qtyOut: 0,
        seller: '',
        tarikhBuat: '',
        reference: `${sale.invoiceNo}-VOID`,
      })
    }
  }

  const sellerByInvoice = new Map<string, string>()
  for (const sale of input.sales) {
    const seller = pjkm1011Seller(sale.reference)
    if (seller) sellerByInvoice.set(sale.invoiceNo, seller)
  }
  for (const event of events) {
    if (event.qtyOut > 0 && !event.seller) event.seller = sellerByInvoice.get(event.reference) ?? ''
  }
  return events
}

function qtyText(value: number | null) {
  if (value == null) return ''
  return Number.isInteger(value) ? String(value) : String(round2(value))
}

export function pjkm1011QtyText(value: number | null) {
  return qtyText(value)
}

export function paginatePjkm1011(rows: Pjkm1011Row[], rowBudget = PJKM_1011_ROW_BUDGET): Pjkm1011Page[] {
  const pages: Pjkm1011Row[][] = []
  let current: Pjkm1011Row[] = []
  for (const row of rows) {
    if (current.length >= rowBudget) {
      pages.push(current)
      current = []
    }
    current.push(row)
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

export function buildPjkm1011(input: {
  month: string
  movements: StockMovement[]
  sales: Sale[]
  products: Product[]
  warehouses: Warehouse[]
  sessions: ProductionSession[]
  rowBudget?: number
}) {
  const finished = pjkm1011FinishedIds(input.products, input.sessions, input.movements)
  const events = buildEvents({
    movements: input.movements,
    sales: input.sales,
    sessions: input.sessions,
    finished,
  })
  const productName = new Map(input.products.map((product) => [product.id, product.name]))
  const warehouseName = new Map(input.warehouses.map((warehouse) => [warehouse.id, warehouse.name]))
  const groups = new Map<string, LedgerEvent[]>()
  for (const event of events) {
    const key = `${event.productId}|${event.warehouseId}|${event.dateKey}`
    const list = groups.get(key) ?? []
    list.push(event)
    groups.set(key, list)
  }

  type Draft = {
    productId: string
    warehouseId: string
    dateKey: string
    qtyIn: number
    qtyOut: number
    sellers: Set<string>
    buat: Set<string>
    missingSeller: boolean
    opening: boolean
  }
  const timelines = new Map<string, Draft[]>()
  const ensure = (productId: string, warehouseId: string) => {
    const key = `${productId}|${warehouseId}`
    const list = timelines.get(key) ?? []
    timelines.set(key, list)
    return list
  }

  for (const [key, list] of groups) {
    const [productId, warehouseId, dateKey] = key.split('|')
    const draft: Draft = {
      productId,
      warehouseId,
      dateKey,
      qtyIn: round2(list.reduce((sum, event) => sum + event.qtyIn, 0)),
      qtyOut: round2(list.reduce((sum, event) => sum + event.qtyOut, 0)),
      sellers: new Set(list.map((event) => event.seller).filter(Boolean)),
      buat: new Set(list.map((event) => event.tarikhBuat).filter(Boolean)),
      missingSeller: list.some((event) => event.qtyOut > 0 && !event.seller),
      opening: false,
    }
    if (dateKey < `${input.month}-01`) {
      const timeline = ensure(productId, warehouseId)
      const prior = timeline.find((row) => row.opening)
      if (prior) {
        prior.qtyIn = round2(prior.qtyIn + draft.qtyIn)
        prior.qtyOut = round2(prior.qtyOut + draft.qtyOut)
      } else {
        timeline.push({ ...draft, opening: true, sellers: new Set(), buat: new Set(), missingSeller: false })
      }
      continue
    }
    if (dateKey.slice(0, 7) !== input.month) continue
    ensure(productId, warehouseId).push(draft)
  }

  const rows: Pjkm1011Row[] = []
  const ordered = [...timelines.entries()].sort((a, b) => {
    const [aProduct, aWarehouse] = a[0].split('|')
    const [bProduct, bWarehouse] = b[0].split('|')
    const byName = (productName.get(aProduct) ?? '').localeCompare(productName.get(bProduct) ?? '')
    if (byName !== 0) return byName
    return (warehouseName.get(aWarehouse) ?? '').localeCompare(warehouseName.get(bWarehouse) ?? '')
  })

  for (const [, timeline] of ordered) {
    if (!timeline.some((row) => !row.opening)) continue
    timeline.sort((a, b) => Number(b.opening) - Number(a.opening) || a.dateKey.localeCompare(b.dateKey))
    let balance = 0
    const monthRows: Pjkm1011Row[] = []
    for (const draft of timeline) {
      balance = round2(balance + draft.qtyIn - draft.qtyOut)
      if (draft.opening) {
        if (balance === 0) continue
        const warehouse = warehouseName.get(draft.warehouseId) ?? ''
        monthRows.push({
          key: `open-${draft.productId}-${draft.warehouseId}`,
          bil: 0,
          productId: draft.productId,
          product: productName.get(draft.productId) ?? '',
          warehouseId: draft.warehouseId,
          dateKey: '',
          tarikhBuat: '',
          tarikhLuput: '',
          qtyIn: null,
          qtyOut: null,
          tempatSimpan: warehouse,
          seller: '',
          tarikhEdar: '',
          batchNo: '',
          baki: balance,
          warnings: warehouse ? [] : ['warehouse'],
        })
        continue
      }
      const warehouse = warehouseName.get(draft.warehouseId) ?? ''
      const sellers = [...draft.sellers]
      const warnings: Pjkm1011Warning[] = []
      if (!warehouse) warnings.push('warehouse')
      if (draft.missingSeller) warnings.push('seller')
      const buat = [...draft.buat].sort()
      monthRows.push({
        key: `${draft.productId}-${draft.warehouseId}-${draft.dateKey}`,
        bil: 0,
        productId: draft.productId,
        product: productName.get(draft.productId) ?? '',
        warehouseId: draft.warehouseId,
        dateKey: draft.dateKey,
        tarikhBuat: buat.length ? displayDate(buat[0]) : '',
        tarikhLuput: '',
        qtyIn: draft.qtyIn,
        qtyOut: draft.qtyOut,
        tempatSimpan: warehouse,
        seller: sellers.join(', '),
        tarikhEdar: draft.qtyOut > 0 ? displayDate(draft.dateKey) : '',
        batchNo: '',
        baki: balance,
        warnings,
      })
    }
    rows.push(...monthRows)
  }

  rows.forEach((row, index) => {
    row.bil = index + 1
  })
  const pages = paginatePjkm1011(rows, input.rowBudget)
  return {
    rows,
    pages,
    attention: rows.filter((row) => row.warnings.length > 0),
    monthLabel: pjkm1011MonthLabel(input.month),
  }
}
