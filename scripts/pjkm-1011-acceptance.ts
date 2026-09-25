const memory = new Map<string, string>()
const localStoragePolyfill = {
  getItem(key: string) { return memory.has(key) ? memory.get(key)! : null },
  setItem(key: string, value: string) { memory.set(key, String(value)) },
  removeItem(key: string) { memory.delete(key) },
  clear() { memory.clear() },
  key(index: number) { return [...memory.keys()][index] ?? null },
  get length() { return memory.size },
}
Object.defineProperty(globalThis, 'localStorage', { value: localStoragePolyfill })
Object.defineProperty(globalThis, 'window', { value: globalThis })

import { readFileSync } from 'node:fs'
import { buildPjkm1011, paginatePjkm1011, pjkm1011Seller } from '@/features/pjkm/pjkm1011'
import type { Product, ProductionSession, Sale, StockMovement, Warehouse } from '@/types'

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const page = readFileSync('src/features/pjkm/PjkmPages.tsx', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')
check('1. PJKM Records can open 10.1.1', page.includes('10.1.1 — Pengedar / Penjual') && app.includes('/pjkm/10.1.1') && page.includes('Pjkm1011PreviewPage'))

const products = [
  { id: 'p-ab', name: 'Air Balang Premix', categoryId: 'cat-air', unit: 'KG' },
  { id: 'p-ib', name: 'Ice Blended Powder', categoryId: 'cat-ice', unit: 'KG' },
  { id: 'p-sugar', name: 'Sugar', categoryId: 'cat-ing', unit: 'KG' },
  { id: 'p-pack', name: 'Matcha', categoryId: 'cat-ing', unit: 'packs' },
  { id: 'p-cup', name: 'Plastic Cup', categoryId: 'cat-pack', unit: 'pcs' },
] as Product[]
const warehouses = [
  { id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', kind: 'company' },
  { id: 'wh-shop', name: 'Shop', code: 'SHOP', kind: 'company' },
] as Warehouse[]
const sessions = [{
  id: 'ps1',
  reference: 'PROD-1',
  productionDate: '2026-09-01T00:00:00+08:00',
  status: 'completed',
  posted: true,
  items: [{ productId: 'p-pack', actualQty: 80, targetQty: 500 }],
}] as unknown as ProductionSession[]

function move(partial: Partial<StockMovement> & Pick<StockMovement, 'id' | 'date' | 'productId' | 'warehouseId' | 'type' | 'stockIn' | 'stockOut'>): StockMovement {
  return {
    reference: partial.reference ?? partial.id,
    balance: 9999,
    user: 'Tester',
    ...partial,
  }
}

const movements = [
  move({ id: 'open', date: '2026-08-31T04:00:00.000Z', productId: 'p-ab', warehouseId: 'wh-main', type: 'opening_balance', stockIn: 100, stockOut: 0 }),
  move({ id: 'prod', date: '2026-09-02T02:00:00.000Z', reference: 'PROD-1', productId: 'p-pack', warehouseId: 'wh-main', type: 'production_in', stockIn: 80, stockOut: 0, notes: 'Finished goods packs' }),
  move({ id: 'plan-noise', date: '2026-09-02T02:00:00.000Z', productId: 'p-pack', warehouseId: 'wh-main', type: 'production_out', stockIn: 0, stockOut: 500 }),
  move({ id: 'recv-fg', date: '2026-09-03T02:00:00.000Z', productId: 'p-ab', warehouseId: 'wh-main', type: 'receiving', stockIn: 40, stockOut: 0 }),
  move({ id: 'recv-raw', date: '2026-09-03T02:00:00.000Z', productId: 'p-sugar', warehouseId: 'wh-main', type: 'receiving', stockIn: 900, stockOut: 0 }),
  move({ id: 'sale-ab', date: '2026-09-04T03:00:00.000Z', reference: 'INV-AB', productId: 'p-ab', warehouseId: 'wh-main', type: 'sale', stockIn: 0, stockOut: 25 }),
  move({ id: 'sale-shop', date: '2026-09-05T03:00:00.000Z', reference: 'INV-SHOP', productId: 'p-ib', warehouseId: 'wh-shop', type: 'sale', stockIn: 0, stockOut: 4 }),
  move({ id: 'usage', date: '2026-09-05T03:00:00.000Z', productId: 'p-ab', warehouseId: 'wh-main', type: 'stock_usage', stockIn: 0, stockOut: 70 }),
  move({ id: 'comp', date: '2026-09-06T03:00:00.000Z', reference: 'INV-PARENT', productId: 'p-sugar', warehouseId: 'wh-main', type: 'sale', stockIn: 0, stockOut: 12, notes: 'Sales component · Matcha' }),
  move({ id: 'void-out', date: '2026-09-07T03:00:00.000Z', reference: 'INV-VOID', productId: 'p-ib', warehouseId: 'wh-main', type: 'sale', stockIn: 0, stockOut: 6 }),
  move({ id: 'void-in', date: '2026-09-08T03:00:00.000Z', reference: 'INV-VOID-VOID', productId: 'p-ib', warehouseId: 'wh-main', type: 'sales_return', stockIn: 6, stockOut: 0, notes: 'Voided sale' }),
  move({ id: 'good', date: '2026-09-09T03:00:00.000Z', reference: 'SR-1', productId: 'p-ab', warehouseId: 'wh-main', type: 'sales_return_good', stockIn: 5, stockOut: 0 }),
  move({ id: 'aug-sale', date: '2026-08-15T03:00:00.000Z', reference: 'INV-AUG', productId: 'p-ab', warehouseId: 'wh-main', type: 'sale', stockIn: 0, stockOut: 10 }),
  move({ id: 'oct', date: '2026-10-01T03:00:00.000Z', reference: 'INV-OCT', productId: 'p-ab', warehouseId: 'wh-main', type: 'sale', stockIn: 0, stockOut: 3 }),
  move({ id: 'cup', date: '2026-09-04T03:00:00.000Z', productId: 'p-cup', warehouseId: 'wh-main', type: 'sale', stockIn: 0, stockOut: 50 }),
]

const sales = [
  { invoiceNo: 'INV-AB', date: '2026-09-04T03:00:00.000Z', warehouseId: 'wh-main', reference: 'SHOPEE:Cool Official:260904ABC', status: 'unpaid', items: [{ productId: 'p-ab', qty: 25, returnedQty: 0 }] },
  { invoiceNo: 'INV-SHOP', date: '2026-09-05T03:00:00.000Z', warehouseId: 'wh-shop', reference: 'TIKTOK:Shop Live:99', status: 'unpaid', items: [{ productId: 'p-ib', qty: 4, returnedQty: 0 }] },
  { invoiceNo: 'INV-PARENT', date: '2026-09-06T03:00:00.000Z', warehouseId: 'wh-main', reference: 'SHOPEE:Cool Official:PARENT', status: 'unpaid', items: [{ productId: 'p-pack', qty: 2, returnedQty: 0, salesComponentsSnapshot: [{ productId: 'p-sugar', qty: 12 }] }] },
  { invoiceNo: 'INV-POS', date: '2026-09-04T08:00:00.000Z', warehouseId: 'wh-main', status: 'paid', items: [{ productId: 'p-ab', qty: 1, returnedQty: 0 }] },
  { invoiceNo: 'INV-VOID', date: '2026-09-07T03:00:00.000Z', warehouseId: 'wh-main', status: 'voided', items: [{ productId: 'p-ib', qty: 6, returnedQty: 0 }] },
] as unknown as Sale[]

const posMove = move({ id: 'pos', date: '2026-09-04T08:00:00.000Z', reference: 'INV-POS', productId: 'p-ab', warehouseId: 'wh-main', type: 'sale', stockIn: 0, stockOut: 1 })
const report = buildPjkm1011({
  month: '2026-09',
  movements: [...movements, posMove],
  sales,
  products,
  warehouses,
  sessions,
})

check('2. Month filter keeps September only', report.rows.every((row) => row.dateKey === '' || row.dateKey.startsWith('2026-09')) && !report.rows.some((row) => row.product === 'Sugar'))
const ab = report.rows.filter((row) => row.productId === 'p-ab' && row.warehouseId === 'wh-main')
check('15. Opening balance comes from the ledger before the month', ab[0]?.dateKey === '' && ab[0]?.baki === 90)
check('16. Sequential Baki follows in and out', ab.map((row) => row.baki).join(',') === '90,130,104,109')
check('3. Production-in contributes to quantity in', report.rows.some((row) => row.productId === 'p-pack' && row.qtyIn === 80))
check('4. Actual production quantity is used', report.rows.find((row) => row.productId === 'p-pack')?.qtyIn === 80)
check('5. Planned quantity is not used', !report.rows.some((row) => row.qtyIn === 500 || row.qtyOut === 500))
check('6. Finished receiving is in; raw receiving is out', report.rows.some((row) => row.productId === 'p-ab' && row.qtyIn === 40) && !report.rows.some((row) => row.productId === 'p-sugar'))
check('7. Sales contribute to quantity out', ab.some((row) => row.qtyOut === 26))
check('8. Sale date is the CSP sale date', ab.some((row) => row.tarikhEdar === '4-Sep-2026'))
check('9. Warehouse name is Tempat Simpan', ab.every((row) => row.tempatSimpan === 'Main Warehouse') && report.rows.some((row) => row.productId === 'p-ib' && row.tempatSimpan === 'Shop'))
check('10. Seller resolves from the sale reference', ab.some((row) => row.seller === 'Shopee / Cool Official') && report.rows.some((row) => row.seller === 'TikTok / Shop Live'))
check('11. Unknown seller stays blank', ab.some((row) => row.qtyOut === 26 && row.warnings.includes('seller')))
check('12. Batch No stays blank', report.rows.every((row) => row.batchNo === ''))
check('13. Expiry stays blank', report.rows.every((row) => row.tarikhLuput === ''))
check('14. Current stock is not used as Baki', report.rows.every((row) => row.baki !== 9999))
check('17. Sales components do not add a duplicate raw row', report.rows.some((row) => row.productId === 'p-pack' && row.qtyOut === 2) && !report.rows.some((row) => row.productId === 'p-sugar' || row.qtyOut === 12))
const ibMain = report.rows.filter((row) => row.productId === 'p-ib' && row.warehouseId === 'wh-main')
check('18. Void reversal comes back in on the void date', ibMain.some((row) => row.qtyOut === 6) && ibMain.some((row) => row.qtyIn === 6 && row.baki === 0))
check('19. Multiple products are separate rows', new Set(report.rows.map((row) => row.productId)).size >= 3)
check('20. Multiple warehouses stay separate', report.rows.some((row) => row.warehouseId === 'wh-shop' && row.baki === -4) && !ab.some((row) => row.warehouseId === 'wh-shop'))
check('21. October and unused packaging are excluded', !report.rows.some((row) => row.dateKey.startsWith('2026-10') || row.productId === 'p-cup'))
const pages = paginatePjkm1011(report.rows, 2)
check('22. Dynamic pagination grows with the row count', pages.length > 1 && pages[0].label === `1 of ${pages.length}` && pages.at(-1)?.label === `${pages.length} of ${pages.length}`)
check('23. Print layout uses the official landscape record', readFileSync('src/features/pjkm/pjkm1011.css', 'utf8').includes('size: A4 landscape') && readFileSync('src/features/pjkm/pjkm1011.ts', 'utf8').includes('KAWALAN KEBOLEHKESANAN') && readFileSync('src/features/pjkm/pjkm1011.ts', 'utf8').includes('MGT/10'))
check('Tarikh Buat uses the production date', report.rows.find((row) => row.productId === 'p-pack' && row.qtyIn === 80)?.tarikhBuat === '1-Sep-2026')
check('Seller helper does not invent a customer', pjkm1011Seller('WALKIN') === '' && pjkm1011Seller('SHOPEE:Official:1') === 'Shopee / Official')
check('Stock usage is not a keluar', !ab.some((row) => row.qtyOut === 70))

const failed = results.filter((row) => !row.ok)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
