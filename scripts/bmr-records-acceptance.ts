import { readFileSync } from 'node:fs'
import { bmrBatchNo, filterBmrRecords, listBmrRecords } from '../src/features/manufacturing/bmrModel'
import type { Product, ProductionSession, ProductionSessionItem } from '../src/types'

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function item(productId: string): ProductionSessionItem {
  return {
    id: productId,
    sessionId: 'ps',
    productId,
    bomId: '',
    originalTargetQty: 1,
    targetQty: 1,
    actualQty: 1,
    shortProductionQty: 0,
    shortProductionReason: '',
    productionBalanceQty: 0,
    balanceLocation: '',
    balanceContainer: '',
    wasteQty: 0,
    wasteReason: '',
    notes: '',
    displayQty: 1,
    cartonQty: 0,
  }
}

function session(partial: Partial<ProductionSession> & Pick<ProductionSession, 'id' | 'productionDate' | 'status' | 'posted' | 'items'>): ProductionSession {
  return {
    reference: `PROD-${partial.id}`,
    warehouseId: 'wh-main',
    createdBy: '',
    createdAt: '',
    acceptedBy: '',
    acceptedAt: '',
    startedBy: '',
    startedAt: '',
    completedBy: 'Mei Ling',
    completedAt: `${partial.productionDate}T10:00:00.000Z`,
    recipePhoto: '',
    recipePhotoName: '',
    uploadedBy: '',
    uploadedAt: '',
    notes: '',
    picking: [],
    excessReturns: [],
    targetChanges: [],
    completedEdits: [],
    ...partial,
  }
}

const products: Product[] = [
  { id: 'p-mt', name: 'Matcha', sku: '', barcode: '', categoryId: '', unit: 'packs', costPrice: 0, sellingPrice: 0, wholesalePrice: 0, reorderLevel: 0, trackBatch: false, trackExpiry: false, status: 'active', accent: '' },
  { id: 'p-cl', name: 'Chocolate Lava', sku: '', barcode: '', categoryId: '', unit: 'packs', costPrice: 0, sellingPrice: 0, wholesalePrice: 0, reorderLevel: 0, trackBatch: false, trackExpiry: false, status: 'active', accent: '' },
]
const warehouses = [{ id: 'wh-main', name: 'Main Warehouse' }, { id: 'wh-shop', name: 'Shop' }]
const completed = session({
  id: 'ps-24',
  productionDate: '2026-09-24',
  status: 'completed',
  posted: true,
  reference: 'PROD-20260924-001',
  completedAt: '2026-09-24T12:00:00.000Z',
  items: [item('p-mt'), item('p-cl')],
})
const earlier = session({
  id: 'ps-08',
  productionDate: '2026-09-08',
  status: 'completed',
  posted: true,
  reference: 'PROD-20260908-001',
  completedAt: '2026-09-08T08:00:00.000Z',
  items: [item('p-mt')],
})
const sameDayLater = session({
  id: 'ps-24b',
  productionDate: '2026-09-24',
  status: 'completed',
  posted: true,
  warehouseId: 'wh-shop',
  reference: 'PROD-20260924-002',
  completedAt: '2026-09-24T18:00:00.000Z',
  items: [item('p-cl')],
})
const open = session({ id: 'ps-open', productionDate: '2026-09-24', status: 'in_progress', posted: false, items: [item('p-mt')] })
const unposted = session({ id: 'ps-draft', productionDate: '2026-09-24', status: 'completed', posted: false, items: [item('p-mt')] })

const rows = listBmrRecords([open, unposted, earlier, completed, sameDayLater], products, warehouses)
check('completed posted sessions are listed', rows.length === 3)
check('incomplete production is excluded', !rows.some((row) => row.sessionId === 'ps-open'))
check('unposted production is excluded', !rows.some((row) => row.sessionId === 'ps-draft'))
check('one session is one row', rows.filter((row) => row.sessionId === 'ps-24').length === 1)
check('multi-product session stays one row', rows.find((row) => row.sessionId === 'ps-24')?.productName === 'Matcha, Chocolate Lava')
check('batch number follows the locked rule', rows.find((row) => row.sessionId === 'ps-24')?.batchNo === '24092027' && bmrBatchNo('2026-09-24') === '24092027')
check('production reference is not the batch number', rows.every((row) => row.batchNo !== row.reference && !row.batchNo.startsWith('PROD-')))
check('newest production date is first', rows.map((row) => row.sessionId).join(',') === 'ps-24b,ps-24,ps-08')
check('print path uses the existing BMR route', rows.find((row) => row.sessionId === 'ps-24')?.printPath === '/manufacturing/bmr/ps-24')

const today = '2026-09-10'
check('today filter uses the production date', filterBmrRecords(rows, { range: 'today', today }).length === 0)
check('this month keeps September records', filterBmrRecords(rows, { range: 'month', today }).length === 3)
check('this week keeps the prototype week', filterBmrRecords(rows, { range: 'week', today }).map((row) => row.sessionId).join(',') === 'ps-08')
check('custom range keeps one day', filterBmrRecords(rows, { range: 'custom', from: '2026-09-08', to: '2026-09-08', today }).map((row) => row.sessionId).join(',') === 'ps-08')
check('batch search finds 24092027', filterBmrRecords(rows, { query: '24092027', today }).length === 2)
check('product search finds Matcha', filterBmrRecords(rows, { query: 'matcha', today }).map((row) => row.sessionId).join(',') === 'ps-24,ps-08')
check('reference search finds PROD-20260908-001', filterBmrRecords(rows, { query: 'PROD-20260908-001', today }).map((row) => row.sessionId).join(',') === 'ps-08')
check('warehouse filter', filterBmrRecords(rows, { warehouseId: 'wh-shop', today }).map((row) => row.sessionId).join(',') === 'ps-24b')

const sidebar = readFileSync(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8')
const compliance = sidebar.slice(sidebar.indexOf("id: 'compliance'"), sidebar.indexOf("id: 'inventory'"))
check('compliance menu lists Halal, PJKM, then BMR', compliance.includes('Halal Compliance') && compliance.includes('PJKM Records') && compliance.includes('BMR Records') && compliance.indexOf('Halal Compliance') < compliance.indexOf('PJKM Records') && compliance.indexOf('PJKM Records') < compliance.indexOf('BMR Records'))
check('PJKM is not duplicated under purchases', !sidebar.slice(sidebar.indexOf("id: 'purchases'"), sidebar.indexOf("id: 'compliance'")).includes('PJKM Records'))
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
check('Halal route remains', app.includes('/compliance/halal'))
check('PJKM route remains', app.includes('/pjkm'))
check('BMR records route is registered', app.includes('/compliance/bmr'))
const print = readFileSync(new URL('../src/features/manufacturing/BmrPrintPage.tsx', import.meta.url), 'utf8')
check('process heading is 2. Process', print.includes('2. Process'))
check('estimate note is absent', !print.includes('system-calculated estimates'))

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
