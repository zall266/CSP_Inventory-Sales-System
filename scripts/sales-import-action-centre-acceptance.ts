const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, String(value)),
    removeItem: (key: string) => memory.delete(key),
    clear: () => memory.clear(),
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() { return memory.size },
  },
})
Object.defineProperty(globalThis, 'window', { value: globalThis })

import { assessSalesImport, salesImportActions, salesImportProductReview } from '@/features/salesImport/review'
import { confirmSaleEnabled } from '@/features/salesImport/spotCheck'
import type { ImportBatch, ImportFile, Product, SalesImportAccount, SalesImportLine, SalesImportOrder } from '@/types'

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function product(id: string, name: string): Product {
  return { id, name, sku: id, barcode: '', categoryId: 'cat', unit: 'PACK', costPrice: 1, sellingPrice: 2, wholesalePrice: 2, reorderLevel: 0, trackBatch: false, trackExpiry: false, status: 'active', accent: '' }
}
const account: SalesImportAccount = { id: 'a1', platform: 'shopee', name: 'faizal266', active: true, createdAt: '' }
const batch: ImportBatch = { id: 'b1', platform: 'shopee', accountId: 'a1', status: 'ready', createdBy: 'Test', createdAt: '' }
const file: ImportFile = { id: 'f1', batchId: 'b1', role: 'picking', fileName: 'pick.pdf', fileHash: 'h', detectedLayout: 'shopee-picklist', identityReliable: true, detectedUsername: 'faizal266', parsedLines: [] }
function order(id: string, externalOrderId: string): SalesImportOrder {
  return { id, batchId: 'b1', externalOrderId, status: 'new' }
}
function line(id: string, orderId: string, qty: number, mappedProductId?: string, extra: Partial<SalesImportLine> = {}): SalesImportLine {
  return { id, orderId, externalProductName: extra.externalProductName ?? 'Item', quantity: qty, quantitySource: 'picking', mappedProductId, ...extra }
}
function run(orders: SalesImportOrder[], lines: SalesImportLine[], products: Product[], available: Record<string, number> = {}, taken: string[] = []) {
  const takenOrderIds = new Set(taken)
  const assessment = assessSalesImport({ account, batch, files: [file], orders, lines, products, takenOrderIds, allowNegativeStock: false, availableQty: (id) => available[id] ?? 1000 })
  return {
    assessment,
    review: salesImportProductReview({ assessment, orders, lines, products, takenOrderIds }),
    actions: salesImportActions({ assessment, orders, lines, products, takenOrderIds }),
  }
}

const yam = product('p-yam', 'AB Yam')
const waffle = product('p-waffle', 'Tepung Waffle')
const orders = [order('o1', '260922A0000001'), order('o2', '260922A0000002'), order('o3', '260922A0000003'), order('o4', '260922A0000004')]
const lines = [
  line('m1', 'o1', 15, undefined, { externalProductName: 'Chocolat Piaw', variationText: 'LAVA' }),
  line('q1', 'o2', 17, 'p-waffle', { externalProductName: 'Tepung Waffle', quantityReview: true, pickingQuantity: 17 }),
  line('u1', 'o3', 5, 'p-yam', { externalProductName: 'AB Yam', unallocated: true, sharedOrderCount: 1 }),
  line('d1', 'o4', 2, 'p-yam', { externalProductName: 'AB Yam' }),
]
const view = run(orders, lines, [yam, waffle], { 'p-yam': 0 }, ['260922A0000004'])
const ids = view.actions.categories.map((item) => item.id)
check('1. Action Centre counts each open category', ids.includes('map') && ids.includes('quantity') && ids.includes('unallocated') && ids.includes('duplicate') && view.actions.issues >= 4, ids.join(','))
check('2. Unmapped list is one product, not one row per order', view.actions.categories.find((item) => item.id === 'map')?.rows[0]?.product === 'LAVA' && view.actions.categories.find((item) => item.id === 'map')?.count === 1)
check('3. Quantity review list keeps picking quantity', view.actions.categories.find((item) => item.id === 'quantity')?.rows[0]?.picking === 17 && view.actions.categories.find((item) => item.id === 'quantity')?.rows[0]?.orderRef === '260922A0000002')
check('4. Unallocated list shows the unallocated quantity', view.actions.categories.find((item) => item.id === 'unallocated')?.rows[0]?.unallocatedQty === 5 && view.actions.categories.find((item) => item.id === 'unallocated')?.rows[0]?.allocated === 0)
check('6. Duplicate list does not treat the order as new', view.actions.categories.find((item) => item.id === 'duplicate')?.rows[0]?.status === 'Already imported')
check('7. Product summary groups the mapped parent', view.review.products.some((row) => row.name === 'AB Yam'))
check('9. Full reconciliation accounts for every unit', view.review.unaccounted === 0 && view.review.imported === view.review.willPost + view.review.needReview + view.review.alreadyConfirmed)
check('11. Partial confirmation is visible from ready versus remaining units', view.review.willPost === 0 && view.review.needReview > 0)

const stocked = run(
  [order('s1', '260922B0000001')],
  [line('s1l', 's1', 10, 'p-yam', { externalProductName: 'AB Yam' })],
  [yam],
  { 'p-yam': 7 },
)
check('5. Inventory shortage list shows required, available, and short', stocked.actions.categories.find((item) => item.id === 'stock')?.rows[0]?.required === 10 && stocked.actions.categories.find((item) => item.id === 'stock')?.rows[0]?.available === 7 && stocked.actions.categories.find((item) => item.id === 'stock')?.rows[0]?.short === 3)
check('10. Failed reconciliation blocks confirm', (() => {
  const broken = run(
    [order('b1', '260922C0000001')],
    [line('b1l', 'b1', 4, 'p-yam'), line('orphan', 'missing', 3, 'p-yam')],
    [yam],
  )
  return broken.review.unaccounted === 3 && confirmSaleEnabled({ canCreate: true, systemCanConfirm: true, samples: [], checkedKeys: [], reconciliationOk: broken.review.ok }) === false
})())
check('12. Confirmed quantity is already confirmed, not will post', (() => {
  const confirmedOrder = { ...order('c1', '260922D0000001'), status: 'confirmed' as const, saleId: 'sale-1' }
  const confirmed = run([confirmedOrder], [line('c1l', 'c1', 6, 'p-yam')], [yam])
  return confirmed.review.alreadyConfirmed === 6 && confirmed.review.willPost === 0
})())
check('8. Order detail columns stay product, qty, status, order id', ['Product', 'Qty', 'Status', 'Order ID'].join('|') === 'Product|Qty|Status|Order ID')

const workIds = (categories: Array<{ id: string }>) => categories.filter((item) => item.id !== 'duplicate').map((item) => item.id)
check('D. Quantity category is Review Quantity and stays read-only data', view.actions.categories.find((item) => item.id === 'quantity')?.title === 'Review Quantity' && view.actions.categories.find((item) => item.id === 'quantity')?.rows[0]?.difference === undefined)
check('E. Unallocated category is Review Unallocated', view.actions.categories.find((item) => item.id === 'unallocated')?.title === 'Review Unallocated')
check('G. Numbered steps follow map, quantity, unallocated and hide empty stock', workIds(view.actions.categories).join(',') === 'map,quantity,unallocated', workIds(view.actions.categories).join(','))
check('I. Duplicates stay out of the numbered list', !workIds(view.actions.categories).includes('duplicate'))

const mapOnly = run([order('mo', '260922E0000001')], [line('mol', 'mo', 2, undefined, { externalProductName: 'Loose', variationText: 'CUP' })], [yam])
check('B. Mapping only is step 1', workIds(mapOnly.actions.categories)[0] === 'map' && workIds(mapOnly.actions.categories).length === 1)
const quantityOnly = run([order('qo', '260922E0000002')], [line('qol', 'qo', 3, 'p-waffle', { quantityReview: true, pickingQuantity: 3 })], [waffle])
check('C. After mapping is gone the next category is step 1', workIds(quantityOnly.actions.categories)[0] === 'quantity')

const sharedName = run(
  [order('h1', '260922F0000001'), order('h2', '260922F0000002')],
  [line('h1l', 'h1', 1, undefined, { variationText: 'SAME' }), line('h2l', 'h2', 1, undefined, { variationText: 'SAME' })],
  [yam],
)
const mapStep = sharedName.actions.categories.find((item) => item.id === 'map')
check('H. Map count is products, not orders', mapStep?.count === 1 && mapStep.orderIds.length === 2, `products ${mapStep?.count} orders ${mapStep?.orderIds.length}`)

const ready = run([order('r1', '260922G0000001')], [line('r1l', 'r1', 4, 'p-yam')], [yam])
check('A. No work items when the order is ready', workIds(ready.actions.categories).length === 0 && ready.review.ok && ready.assessment.canConfirm)
check('J. AWB pending does not block a ready order', ready.assessment.canConfirm && ready.review.willPost === 4)
check('F. Stock shortage blocks confirm for the ready set', stocked.assessment.canConfirm === false && stocked.actions.categories.some((item) => item.id === 'stock'))
check('M. Spot check incomplete keeps confirm off', confirmSaleEnabled({ canCreate: true, systemCanConfirm: true, samples: [{ key: 'a', name: 'A', productName: 'A', quantity: 1, mappingStatus: 'Mapped', orderIds: [], categoryName: '' }], checkedKeys: [], reconciliationOk: true }) === false)

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
