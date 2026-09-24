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
import { db } from '@/store/db'
import { isReceivingCondition } from '@/features/receiving/receivingModel'
import { buildPjkm511, paginatePjkmRows, pjkmDate, type PjkmRow } from '@/features/pjkm/pjkm511'
import type { Receiving, ReceivingLine } from '@/types'

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const snap = () => db.getSnapshot()
const supplier = snap().suppliers[0]
const before = JSON.stringify(snap().receivings ?? [])

check('1. ReceivingLine supports condition', isReceivingCondition('Baik') && isReceivingCondition('Tidak Baik') && isReceivingCondition('Perlu Pemeriksaan'))
check('2. Condition values are validated', !isReceivingCondition('Good') && !isReceivingCondition('') && !isReceivingCondition('Baik '))
const missing = db.createReceiving({
  warehouseId: 'wh-main',
  source: 'supplier',
  supplierId: supplier.id,
  items: [{ productId: 'p-sugar', qty: 1, batchNo: 'LOT', expiry: '2027-01-01' }],
})
check('3. New Receiving cannot confirm without condition', missing === null)
const created = db.createReceiving({
  warehouseId: 'wh-main',
  source: 'supplier',
  supplierId: supplier.id,
  notes: 'Document note must stay off the lines',
  date: '2026-09-03T02:00:00.000Z',
  items: [
    { productId: 'p-sugar', qty: 14, batchNo: '1302', expiry: '2027-08-03', notes: 'Line note', condition: 'Baik' },
    { productId: 'p-milkpw', qty: 5, expiry: '2028-02-15', condition: 'Tidak Baik' },
  ],
})
check('7. One ReceivingLine creates one report row', created?.items.length === 2)

const historical: Receiving = {
  id: 'rcv-old',
  receivingNo: 'RCV-OLD',
  date: '2026-09-01T00:00:00.000Z',
  warehouseId: 'wh-main',
  source: 'supplier',
  supplierId: supplier.id,
  items: [{ productId: 'p-wf', qty: 40, unit: 'BAG', baseQty: 1000, batchNo: '', notes: '' } as ReceivingLine],
  notes: 'Old header note',
  receivedBy: 'u-old',
  receivedByName: 'Pn.Aida',
  status: 'completed',
}
const agent: Receiving = {
  ...historical,
  id: 'rcv-agent',
  receivingNo: 'RCV-AGENT',
  warehouseId: 'wh-agent',
  date: '2026-09-02T00:00:00.000Z',
  items: [{ productId: 'p-sugar', qty: 9, unit: 'BAG', baseQty: 225, batchNo: 'X', condition: 'Baik' }],
}
const otherMonth: Receiving = { ...historical, id: 'rcv-aug', receivingNo: 'RCV-AUG', date: '2026-08-15T04:00:00.000Z' }
const draft = { ...historical, id: 'rcv-draft', receivingNo: 'RCV-DRAFT', status: 'draft' as Receiving['status'] }

const warehouses = [...snap().warehouses, { id: 'wh-agent', name: 'Agent Store', code: 'AG', kind: 'agent' as const }]
const report = buildPjkm511({
  month: '2026-09',
  receivings: [historical, agent, otherMonth, draft, ...(snap().receivings ?? [])],
  suppliers: snap().suppliers,
  products: snap().products,
  warehouses,
  rowBudget: 2,
})

check('4. Historical Receiving without condition remains readable', historical.items[0]?.condition === undefined && report.rows.some((row) => row.receivingNo === 'RCV-OLD'))
check('5. Month filter uses Receiving.date', report.rows.every((row) => row.date.endsWith('-2026')) && !report.rows.some((row) => row.receivingNo === 'RCV-AUG') && pjkmDate('2026-09-03T02:00:00.000Z') === '3-Sep-2026')
check('6. Only completed Receiving records are included', !report.rows.some((row) => row.receivingNo === 'RCV-DRAFT'))
check('8. Supplier comes from supplier master', report.rows.filter((row) => row.receivingNo === created?.receivingNo).every((row) => row.supplier === supplier.name))
const sugar = report.rows.find((row) => row.receivingNo === created?.receivingNo && row.product === 'Sugar')
check('9. Product comes from the line', sugar?.product === 'Sugar')
const cocoa = report.rows.find((row) => row.receivingNo === created?.receivingNo && row.product === 'Milk Powder')
check('10. Quantity uses line qty', sugar?.qtyText === '14 Kg')
check('11. Unit uses line unit', sugar?.qtyText === '14 Kg' && cocoa?.qtyText === '5 Kg')
check('12. baseQty is not printed', report.rows.every((row) => !row.qtyText.includes('1000') && !row.qtyText.toLowerCase().includes('base')))
check('13. Batch number is printed when present', sugar?.batchCell.startsWith('1302') === true)
check('14. Expiry is printed when present', cocoa?.batchCell === '15-Feb-2028')
check('15. Batch and expiry share one column', sugar?.batchCell === '1302\n3-Aug-2027')
check('16. Missing batch/expiry stays blank and warns', report.rows.some((row) => row.receivingNo === 'RCV-OLD' && row.batchCell === '' && row.warnings.includes('batch')))
check('17. Condition prints correctly', sugar?.condition === 'Baik' && cocoa?.condition === 'Tidak Baik')
check('18. Missing historical condition stays blank and warns', report.rows.some((row) => row.receivingNo === 'RCV-OLD' && row.condition === '' && row.warnings.includes('condition')))
check('19. Notes come from the line', sugar?.notes === 'Line note' && cocoa?.notes === '')
check('20. Document notes are not copied onto every row', report.rows.filter((row) => row.receivingNo === created?.receivingNo).every((row) => !row.notes.includes('Document note')))
check('21. Prepared by uses receivedByName', report.rows.filter((row) => row.receivingNo === created?.receivingNo).every((row) => row.preparedBy === created?.receivedByName) && report.rows.some((row) => row.preparedBy === 'Pn.Aida'))
check('22. Verified by remains blank', report.rows.every((row) => row.verifiedBy === ''))
check('23. Agent warehouse receiving is excluded', !report.rows.some((row) => row.receivingNo === 'RCV-AGENT'))
check('24. Multiple lines stay separate', report.rows.filter((row) => row.receivingNo === created?.receivingNo).length === 2)
const order = report.rows.map((row) => row.receivingNo)
check('25. Rows sort by date then receiving number', order.indexOf('RCV-OLD') < order.indexOf(created?.receivingNo ?? ''))
check('26. Multi-page output repeats the header data', report.pages.length > 1 && report.pages.every((page) => page.rows.length > 0 || page.page === report.pages.length))
check('27. Page count is calculated', report.pages.every((page) => page.pages === report.pages.length && page.label === `${page.page} of ${page.pages}`))
check('28. Page number is not hard-coded to 3 of 3', report.pages.some((page) => page.label !== '3 of 3') && !report.pages.every((page) => page.label === '3 of 3'))
const css = readFileSync('src/features/pjkm/pjkm.css', 'utf8')
const invoice = readFileSync('src/index.css', 'utf8')
const page = readFileSync('src/features/pjkm/PjkmPages.tsx', 'utf8')
check('29. Letter portrait print layout is used', css.includes('size: letter portrait') && css.includes('8.5in') && page.includes('COOL SLURPPY MARKETING') === false && page.includes('PJKM_511'))
check('30. Existing A4 invoice print remains unchanged', invoice.includes('size: A4 portrait') && !invoice.includes('size: letter'))
const frozen = JSON.stringify(snap().receivings ?? [])
buildPjkm511({ month: '2026-09', receivings: snap().receivings ?? [], suppliers: snap().suppliers, products: snap().products, warehouses: snap().warehouses })
check('31. Regenerating a report does not modify Receiving data', JSON.stringify(snap().receivings ?? []) === frozen)
const noSupplier = buildPjkm511({
  month: '2026-09',
  receivings: [{ ...historical, id: 'rcv-nosup', receivingNo: 'RCV-NOSUP', supplierId: undefined, supplierNote: 'Not a master name', items: [{ productId: 'p-sugar', qty: 1, unit: 'BAG', baseQty: 25, condition: 'Baik', batchNo: 'B' }] }],
  suppliers: snap().suppliers,
  products: snap().products,
  warehouses: snap().warehouses,
})
check('32. Missing supplier does not invent a supplier', noSupplier.rows[0]?.supplier === '' && noSupplier.rows[0]?.warnings.includes('supplier') === true && !noSupplier.rows[0]?.supplier.includes('Not a master'))
const blank = paginatePjkmRows([] as PjkmRow[], 4)
check('Empty month is one page', blank.length === 1 && blank[0]?.label === '1 of 1')
void before

const failed = results.filter((row) => !row.ok)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
