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

import { db } from '@/store/db'
import { assessSalesImport, salesImportProductReview } from '@/features/salesImport/review'
import { confirmSaleEnabled } from '@/features/salesImport/spotCheck'
import type { ImportBatch, ImportFile, Product, SalesImportAccount, SalesImportLine, SalesImportOrder } from '@/types'
import type { TextItem } from '@/features/salesImport/parsePickingList'

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function product(id: string, name: string, extra: Partial<Product> = {}): Product {
  return { id, name, sku: id, barcode: '', categoryId: 'cat', unit: 'PACK', costPrice: 1, sellingPrice: 2, wholesalePrice: 2, reorderLevel: 0, trackBatch: false, trackExpiry: false, status: 'active', accent: '', ...extra }
}
const account: SalesImportAccount = { id: 'a1', platform: 'shopee', name: 'faizal266', active: true, createdAt: '' }
const batch: ImportBatch = { id: 'b1', platform: 'shopee', accountId: 'a1', status: 'ready', createdBy: 'Test', createdAt: '' }
const file: ImportFile = { id: 'f1', batchId: 'b1', role: 'picking', fileName: 'pick.pdf', fileHash: 'h', detectedLayout: 'shopee-picklist', identityReliable: true, detectedUsername: 'faizal266', parsedLines: [] }
function order(id: string, externalOrderId: string, status: SalesImportOrder['status'] = 'new'): SalesImportOrder {
  return { id, batchId: 'b1', externalOrderId, status }
}
function line(id: string, orderId: string, qty: number, mappedProductId?: string, extra: Partial<SalesImportLine> = {}): SalesImportLine {
  return { id, orderId, externalProductName: extra.externalProductName ?? 'Item', quantity: qty, quantitySource: 'picking', mappedProductId, ...extra }
}
function reviewOf(orders: SalesImportOrder[], lines: SalesImportLine[], products: Product[], available: Record<string, number> = {}) {
  const assessment = assessSalesImport({
    account, batch, files: [file], orders, lines, products, takenOrderIds: new Set(), allowNegativeStock: false,
    availableQty: (productId) => available[productId] ?? 1000,
  })
  return { assessment, review: salesImportProductReview({ assessment, orders, lines, products, takenOrderIds: new Set() }) }
}

const yam = product('p-yam', 'AB Yam')
const waffle = product('p-waffle', 'Tepung Waffle', { salesComponents: [{ productId: 'p-flour', qty: 1 }] })
const readyLines = [
  line('l1', 'o1', 20, 'p-yam', { externalProductName: 'AB Yam' }),
  line('l2', 'o2', 27, 'p-waffle', { externalProductName: 'Tepung Waffle' }),
]
const reviewLines = [line('l3', 'o3', 19, undefined, { externalProductName: 'Mystery' })]
const balanced = reviewOf(
  [order('o1', '260922A0000001'), order('o2', '260922A0000002'), order('o3', '260922A0000003')],
  [...readyLines, ...reviewLines],
  [yam, waffle],
)
check('A. Balanced reconciliation', balanced.review.imported === 66 && balanced.review.willPost === 47 && balanced.review.needReview === 19 && balanced.review.unaccounted === 0 && balanced.review.ok, JSON.stringify(balanced.review))
check('A. Confirm allowed when reconciliation is clear and the system can confirm', confirmSaleEnabled({ canCreate: true, systemCanConfirm: balanced.assessment.canConfirm, samples: [], checkedKeys: [], reconciliationOk: balanced.review.ok }))

const brokenLines = [...readyLines, ...reviewLines, line('orphan', 'missing-order', 3, 'p-yam')]
const broken = reviewOf(
  [order('o1', '260922A0000001'), order('o2', '260922A0000002'), order('o3', '260922A0000003')],
  brokenLines,
  [yam, waffle],
)
check('B. Broken reconciliation finds the unaccounted units', broken.review.imported === 69 && broken.review.willPost === 47 && broken.review.needReview === 19 && broken.review.unaccounted === 3 && !broken.review.ok, JSON.stringify({ imported: broken.review.imported, willPost: broken.review.willPost, needReview: broken.review.needReview, unaccounted: broken.review.unaccounted }))
check('B. Confirm blocked when units are unaccounted', confirmSaleEnabled({ canCreate: true, systemCanConfirm: true, samples: [], checkedKeys: [], reconciliationOk: broken.review.ok }) === false)

const grouped = reviewOf(
  [order('g1', '260922B0000001'), order('g2', '260922B0000002')],
  [line('g1l', 'g1', 5, 'p-yam', { externalProductName: 'AB Yam' }), line('g2l', 'g2', 7, 'p-yam', { externalProductName: 'AB Yam' })],
  [yam],
)
check('E. Same mapped product is grouped', grouped.review.products.length === 1 && grouped.review.products[0].name === 'AB Yam' && grouped.review.products[0].imported === 12)

const repeated = reviewOf(
  [order('r1', '260922C0000001')],
  [line('r1a', 'r1', 2, 'p-yam', { externalProductName: 'AB Yam' }), line('r1b', 'r1', 4, 'p-waffle', { externalProductName: 'Tepung Waffle' })],
  [yam, waffle],
)
check('F. Repeated order keeps each product line', repeated.review.products.length === 2 && repeated.review.imported === 6)

const shared = reviewOf(
  [order('s1', '260922D0000001'), order('s2', '260922D0000002')],
  [
    line('s1l', 's1', 5, 'p-yam', { externalProductName: 'AB Yam', unallocated: true, sharedOrderCount: 2 }),
    line('s2l', 's2', 5, 'p-yam', { externalProductName: 'AB Yam', unallocated: true, sharedOrderCount: 2 }),
  ],
  [yam],
)
check('G. Unallocated quantity is attention and not will-post', shared.review.willPost === 0 && shared.review.needReview === 5 && shared.review.imported === 5 && shared.review.attention.find((item) => item.id === 'unallocated')?.orders === 2, JSON.stringify(shared.review.attention))

const qtyReview = reviewOf(
  [order('q1', '260922E0000001')],
  [line('q1l', 'q1', 8, 'p-waffle', { externalProductName: 'Tepung Waffle', quantityReview: true })],
  [waffle],
)
check('H. Quantity review is attention and not will-post', qtyReview.review.willPost === 0 && qtyReview.review.attention.find((item) => item.id === 'quantity')?.units === 8)

const unmapped = reviewOf([order('u1', '260922F0000001')], [line('u1l', 'u1', 3, undefined, { externalProductName: 'Loose Syrup' })], [yam])
check('I. Unmapped stays out of will-post', unmapped.review.willPost === 0 && unmapped.review.products[0].mapped === false && unmapped.review.attention.find((item) => item.id === 'unmapped')?.orders === 1)

const parent = reviewOf([order('c1', '260922G0000001')], [line('c1l', 'c1', 3, 'p-waffle', { externalProductName: 'Waffle Startup' })], [waffle, product('p-flour', 'Flour')])
check('J. Product summary shows the parent sale quantity', parent.review.products.length === 1 && parent.review.products[0].name === 'Tepung Waffle' && parent.review.products[0].imported === 3 && parent.review.willPost === 3)

const pending = reviewOf([order('p1', '260922H0000001')], [line('p1l', 'p1', 1, 'p-yam')], [yam])
check('K. Pending AWB does not block an otherwise ready order', pending.assessment.canConfirm && pending.review.ok && pending.review.willPost === 1)

function word(text: string, x: number, y: number): TextItem {
  return { text, x, y, page: 1 }
}
function orderNo(suffix: string) {
  return `260922${suffix}`.slice(0, 14).padEnd(14, 'A')
}
function shopeeItems(rows: Array<{ name: string; sku?: string; qty: number; orders: string[] }>): TextItem[] {
  const items: TextItem[] = [
    word('Picklist', 17, 820), word('Username:', 17, 800), word('reviewpowder', 96, 800),
    word('#', 15, 760), word('Parent SKU', 28, 760), word('Name', 152, 760), word('SKU', 233, 760), word('Variation Name', 295, 760), word('Qty', 376, 760), word('Order ID', 417, 760),
  ]
  let y = 720
  rows.forEach((row, index) => {
    items.push(word(String(index + 1), 15, y), word(row.name, 152, y), word(String(row.qty), 376, y))
    if (row.sku) items.push(word(row.sku, 233, y))
    if (row.orders[0]) items.push(word(row.orders[0], 417, y))
    y -= 24
  })
  return items
}

const snap = () => db.getSnapshot()
const categoryId = snap().categories[0]?.id ?? 'cat-ice'
const mapped = db.createProduct({ name: 'Review Powder', sku: '910101', categoryId, unit: 'PCS', sellingPrice: 8 })
if (!mapped) throw new Error('product missing')
db.adjustStock({ warehouseId: 'wh-main', productId: mapped.id, type: 'increase', qty: 20, reason: 'product review test' })
const liveAccount = db.createSalesImportAccount('shopee', 'reviewpowder')
const liveBatch = liveAccount ? db.createSalesImportBatch('shopee', liveAccount.id) : null
if (!liveBatch || !liveAccount) throw new Error('batch missing')
const readyIds = Array.from({ length: 3 }, (_, index) => orderNo(`R000000${index + 1}`))
const heldIds = [orderNo('H0000001')]
db.ingestSalesImportPicking(liveBatch.id, {
  fileName: 'review.pdf',
  fileHash: 'hash-product-review',
  items: shopeeItems([
    ...readyIds.map((id, index) => ({ name: 'Review Powder', sku: '910101', qty: 1, orders: [id] })),
    { name: 'Held Syrup', qty: 4, orders: heldIds },
  ]),
})
function live() {
  const state = snap()
  const orders = (state.salesImportOrders ?? []).filter((item) => item.batchId === liveBatch!.id)
  const lines = (state.salesImportLines ?? []).filter((item) => orders.some((order) => order.id === item.orderId))
  const currentBatch = (state.salesImportBatches ?? []).find((item) => item.id === liveBatch!.id) ?? liveBatch!
  const assessment = assessSalesImport({
    account: liveAccount!, batch: currentBatch, files: state.salesImportFiles ?? [], orders: state.salesImportOrders ?? [], lines: state.salesImportLines ?? [],
    products: state.products, takenOrderIds: new Set(), allowNegativeStock: state.settings.allowNegativeStock,
    availableQty: (productId) => state.inventory.find((row) => row.productId === productId && row.warehouseId === 'wh-main')?.qty ?? 0,
  })
  const review = salesImportProductReview({ assessment, orders, lines, products: state.products, takenOrderIds: new Set() })
  return { orders, assessment, review }
}
const before = live()
const salesBefore = snap().sales.length
const posted = db.confirmSalesImport(liveBatch.id)
const after = live()
const postedAgain = db.confirmSalesImport(liveBatch.id)
check('C. Partial confirmation posts only ready orders', posted.posted === before.assessment.readyOrderIds.length && after.orders.filter((item) => item.status !== 'confirmed').length === 1, `posted ${posted.posted} held ${after.orders.filter((item) => item.status !== 'confirmed').length}`)
check('D. Already confirmed is excluded from the next will-post and is not duplicated', after.review.alreadyConfirmed === 3 && after.review.willPost === 0 && postedAgain.posted === 0 && snap().sales.length === salesBefore + posted.posted, `confirmed ${after.review.alreadyConfirmed} will ${after.review.willPost}`)
check('L. Multi-line picking import still reconciles', before.review.ok && before.review.imported === before.review.willPost + before.review.needReview)

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
