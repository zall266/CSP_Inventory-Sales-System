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
import { assessSalesImport, salesImportSummary } from '@/features/salesImport/review'
import type { ImportBatch, ImportFile, Product, SalesImportAccount, SalesImportLine, SalesImportOrder, SalesImportShipment } from '@/types'
import type { TextItem } from '@/features/salesImport/parsePickingList'

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function product(id: string, name: string, extra: Partial<Product> = {}): Product {
  return {
    id,
    name,
    sku: id,
    barcode: '',
    categoryId: 'cat',
    unit: 'PACK',
    costPrice: 1,
    sellingPrice: 2,
    wholesalePrice: 2,
    reorderLevel: 0,
    trackBatch: false,
    trackExpiry: false,
    status: 'active',
    accent: '',
    ...extra,
  }
}

const account: SalesImportAccount = { id: 'a1', platform: 'shopee', name: 'faizal266', active: true, createdAt: '' }
const batch: ImportBatch = { id: 'b1', platform: 'shopee', accountId: 'a1', status: 'ready', createdBy: 'Test', createdAt: '' }
const file: ImportFile = {
  id: 'f1',
  batchId: 'b1',
  role: 'picking',
  fileName: 'pick.pdf',
  fileHash: 'h',
  detectedLayout: 'shopee-picklist',
  identityReliable: true,
  detectedUsername: 'faizal266',
  parsedLines: [{ externalProductName: 'Item', quantity: 1, orderIds: ['260922P0000001'] }],
}

function order(id: string, externalOrderId: string, status: SalesImportOrder['status'] = 'new', saleId?: string): SalesImportOrder {
  return { id, batchId: 'b1', externalOrderId, status, saleId }
}

function line(id: string, orderId: string, qty: number, mappedProductId?: string, extra: Partial<SalesImportLine> = {}): SalesImportLine {
  return {
    id,
    orderId,
    externalProductName: extra.externalProductName ?? 'Item',
    quantity: qty,
    quantitySource: 'picking',
    mappedProductId,
    ...extra,
  }
}

function shipment(id: string, externalOrderId: string, linkStatus: SalesImportShipment['linkStatus']): SalesImportShipment {
  return {
    id,
    platform: 'shopee',
    accountId: 'a1',
    batchId: 'b1',
    externalOrderId,
    trackingNumber: id,
    courierText: 'SPX Express',
    sourceFileId: 'f1',
    linkStatus,
    packingLines: [],
    createdAt: '',
    updatedAt: '',
  }
}

function summarize(input: {
  orders: SalesImportOrder[]
  lines: SalesImportLine[]
  products: Product[]
  shipments?: SalesImportShipment[]
  taken?: string[]
  available?: Record<string, number>
  allowNegativeStock?: boolean
}) {
  const taken = new Set(input.taken ?? [])
  const assessment = assessSalesImport({
    account,
    batch,
    files: [file],
    orders: input.orders,
    lines: input.lines,
    products: input.products,
    takenOrderIds: taken,
    allowNegativeStock: input.allowNegativeStock ?? false,
    availableQty: (productId) => input.available?.[productId] ?? 1000,
  })
  return salesImportSummary({
    assessment,
    orders: input.orders,
    lines: input.lines,
    products: input.products,
    shipments: input.shipments ?? [],
    takenOrderIds: taken,
  })
}

const waffle = product('waffle', 'Tepung Waffle')
const blue = product('blue', 'AB Blue Ice Vanilla')
const chocolate = product('choc', 'IB Chocolate')
const vanilla = product('van', 'IB Vanilla')
const part = product('part', 'Cup')
const bundle = product('bundle', 'Starter Kit', { salesComponents: [{ productId: part.id, qty: 3 }] })

const full = summarize({
  orders: [order('o1', '260922P0000001'), order('o2', '260922P0000002')],
  lines: [line('l1', 'o1', 4, waffle.id), line('l2', 'o2', 5, blue.id)],
  products: [waffle, blue],
})
check('fully valid batch posts every ready order', full.ready === 2 && full.attention === 0 && full.postQty === 9 && full.heldQty === 0 && full.inventoryOk && full.mappingOk, `ready ${full.ready} post ${full.postQty}`)

const partialOrders = [order('p1', '260922P0000011'), order('p2', '260922P0000012'), order('p3', '260922P0000013')]
const partial = summarize({
  orders: partialOrders,
  lines: [
    line('pl1', 'p1', 5, blue.id),
    line('pl2', 'p2', 17, waffle.id, { unallocated: true, sharedOrderCount: 2, externalProductName: 'Tepung Waffle' }),
    line('pl3', 'p3', 17, waffle.id, { unallocated: true, sharedOrderCount: 2, externalProductName: 'Tepung Waffle' }),
  ],
  products: [waffle, blue],
})
check('partial batch posts only the ready quantity', partial.ready === 1 && partial.attention === 2 && partial.importedQty === 22 && partial.postQty === 5 && partial.heldQty === 17 && partial.products.map((item) => item.name).join(',') === 'AB Blue Ice Vanilla', `imported ${partial.importedQty} post ${partial.postQty} held ${partial.heldQty}`)

const duplicate = summarize({
  orders: [order('d1', '260922P0000021'), order('d2', '260922P0000022')],
  lines: [line('dl1', 'd1', 3, waffle.id), line('dl2', 'd2', 4, waffle.id)],
  products: [waffle],
  taken: ['260922P0000022'],
})
check('duplicate orders are excluded from will be posted', duplicate.ready === 1 && duplicate.duplicates === 1 && duplicate.postQty === 3 && duplicate.reasons.some((reason) => reason.label === 'Duplicate'), `post ${duplicate.postQty} dup ${duplicate.duplicates}`)

const unmapped = summarize({
  orders: [order('u1', '260922P0000031')],
  lines: [line('ul1', 'u1', 8)],
  products: [waffle],
})
check('unmapped orders are attention and not posted', unmapped.ready === 0 && unmapped.unmapped === 1 && unmapped.postQty === 0 && unmapped.mappingOk === false && unmapped.reasons[0]?.label === 'Unmapped product', unmapped.reasons.map((reason) => reason.label).join(','))

const unallocated = summarize({
  orders: [order('s1', '260922P0000041'), order('s2', '260922P0000042')],
  lines: [
    line('sl1', 's1', 17, waffle.id, { unallocated: true, sharedOrderCount: 2 }),
    line('sl2', 's2', 17, waffle.id, { unallocated: true, sharedOrderCount: 2 }),
  ],
  products: [waffle],
})
check('shared unallocated quantity is counted once and not posted', unallocated.ready === 0 && unallocated.unallocated === 2 && unallocated.importedQty === 17 && unallocated.postQty === 0 && unallocated.heldQty === 17, `imported ${unallocated.importedQty}`)

const shortage = summarize({
  orders: [order('h1', '260922P0000051')],
  lines: [line('hl1', 'h1', 4, blue.id)],
  products: [blue],
  available: { blue: 1 },
})
check('inventory shortage posts nothing', shortage.ready === 0 && shortage.inventoryOk === false && shortage.postQty === 0 && shortage.reasons.some((reason) => reason.label === 'Inventory'), shortage.reasons.map((reason) => reason.label).join(','))

const pending = summarize({
  orders: [order('a1', '260922P0000061')],
  lines: [line('al1', 'a1', 2, vanilla.id)],
  products: [vanilla],
})
check('AWB pending does not block a ready order', pending.ready === 1 && pending.postQty === 2 && pending.awb.pending === 1 && pending.awb.matched === 0, `ready ${pending.ready}`)

const matched = summarize({
  orders: [order('m1', '260922P0000071'), order('m2', '260922P0000072')],
  lines: [line('ml1', 'm1', 1, chocolate.id), line('ml2', 'm2', 6, blue.id)],
  products: [chocolate, blue],
  shipments: [shipment('sp1', '260922P0000071', 'matched'), shipment('sp2', '260922P0000072', 'matched')],
})
check('AWB matched keeps both orders ready', matched.ready === 2 && matched.awb.matched === 2 && matched.awb.pending === 0 && matched.postQty === 7, `matched ${matched.awb.matched}`)

const reviewed = summarize({
  orders: [order('r1', '260922P0000081')],
  lines: [line('rl1', 'r1', 3, waffle.id)],
  products: [waffle],
  shipments: [shipment('sp3', '260922P0000081', 'review')],
})
check('shipment review is reported and does not remove a ready order', reviewed.ready === 1 && reviewed.postQty === 3 && reviewed.awb.review === 1, `ready ${reviewed.ready} review ${reviewed.awb.review}`)

const quantityReview = summarize({
  orders: [order('q1', '260922P0000091')],
  lines: [line('ql1', 'q1', 4, waffle.id, { quantityReview: true })],
  products: [waffle],
  shipments: [shipment('sp4', '260922P0000091', 'review')],
})
check('quantity review is excluded from will be posted', quantityReview.ready === 0 && quantityReview.errors === 1 && quantityReview.postQty === 0 && quantityReview.heldQty === 4, `post ${quantityReview.postQty}`)

const aggregated = summarize({
  orders: [order('g1', '260922P0000101'), order('g2', '260922P0000102'), order('g3', '260922P0000103')],
  lines: [line('gl1', 'g1', 4, waffle.id), line('gl2', 'g2', 5, waffle.id), line('gl3', 'g3', 1, chocolate.id)],
  products: [waffle, chocolate],
})
check('product quantities aggregate by mapped product', aggregated.products.find((item) => item.productId === waffle.id)?.qty === 9 && aggregated.products.find((item) => item.productId === chocolate.id)?.qty === 1 && aggregated.postQty === 10, aggregated.products.map((item) => `${item.name}:${item.qty}`).join(','))

const blocked = summarize({
  orders: [order('b1o', '260922P0000111'), order('b2o', '260922P0000112')],
  lines: [line('bl1', 'b1o', 9, blue.id), line('bl2', 'b2o', 12, waffle.id, { unallocated: true, sharedOrderCount: 1 })],
  products: [blue, waffle],
})
check('blocked quantities are excluded from will be posted', blocked.postQty === 9 && blocked.products.every((item) => item.productId !== waffle.id) && blocked.heldQty === 12, `post ${blocked.postQty} held ${blocked.heldQty}`)

const components = summarize({
  orders: [order('c1', '260922P0000121')],
  lines: [line('cl1', 'c1', 2, bundle.id)],
  products: [bundle, part],
  available: { part: 100, bundle: 0 },
})
check('sales components keep the parent quantity', components.ready === 1 && components.postQty === 2 && components.products.length === 1 && components.products[0]?.name === 'Starter Kit' && components.products[0]?.qty === 2, components.products.map((item) => `${item.name}:${item.qty}`).join(','))

const confirmed = summarize({
  orders: [order('k1', '260922P0000131', 'confirmed', 'sale-1'), order('k2', '260922P0000132')],
  lines: [line('kl1', 'k1', 7, waffle.id), line('kl2', 'k2', 1, chocolate.id)],
  products: [waffle, chocolate],
})
check('confirmed orders are not counted again', confirmed.confirmed === 1 && confirmed.ready === 1 && confirmed.postQty === 1 && confirmed.importedQty === 1 && !confirmed.postOrderIds.includes('k1'), `post ${confirmed.postQty} imported ${confirmed.importedQty}`)

check('will be posted ids are the confirmation set', full.postOrderIds.join(',') === 'o1,o2' && shortage.postOrderIds.length === 0 && duplicate.postOrderIds.join(',') === 'd1')

function word(text: string, x: number, y: number): TextItem {
  return { text, x, y, page: 1 }
}
function picking(username: string, sku: string, name: string, qty: number, orderId: string): TextItem[] {
  return [
    word('Picklist', 17, 820),
    word('Username:', 17, 800),
    word(username, 96, 800),
    word('#', 15, 760),
    word('Parent SKU', 28, 760),
    word('Name', 152, 760),
    word('SKU', 233, 760),
    word('Variation Name', 295, 760),
    word('Qty', 376, 760),
    word('Order ID', 417, 760),
    word('1', 15, 720),
    word(name, 152, 720),
    word(sku, 233, 720),
    word(String(qty), 376, 720),
    word(orderId, 417, 720),
  ]
}

const liveAccount = db.createSalesImportAccount('shopee', 'coolslurppypowder')
const liveBatch = liveAccount ? db.createSalesImportBatch('shopee', liveAccount.id) : null
if (!liveBatch || !liveAccount) throw new Error('batch missing')
db.ingestSalesImportPicking(liveBatch.id, { fileName: 'a.pdf', fileHash: 'sum-a', items: picking('coolslurppypowder', '147539', 'AB Blue Ice Vanilla', 5, '260922P1000001') })
db.ingestSalesImportPicking(liveBatch.id, { fileName: 'b.pdf', fileHash: 'sum-b', items: picking('coolslurppypowder', '147509', 'IB Chocolate', 1, '260922P1000002') })
db.ingestSalesImportPicking(liveBatch.id, { fileName: 'c.pdf', fileHash: 'sum-c', items: picking('coolslurppypowder', 'NOSUCHSKU', 'Unknown Powder', 2, '260922P1000003') })
const snap = () => db.getSnapshot()
const liveOrders = () => snap().salesImportOrders.filter((item) => item.batchId === liveBatch.id)
const liveLines = () => snap().salesImportLines.filter((item) => liveOrders().some((order) => order.id === item.orderId))
const liveSummary = () => {
  const current = snap()
  const orders = liveOrders()
  const assessment = assessSalesImport({
    account: liveAccount,
    batch: current.salesImportBatches.find((item) => item.id === liveBatch.id) ?? liveBatch,
    files: current.salesImportFiles.filter((item) => item.batchId === liveBatch.id),
    orders,
    lines: liveLines(),
    products: current.products,
    takenOrderIds: new Set(),
    allowNegativeStock: current.settings.allowNegativeStock,
    availableQty: (productId) => current.inventory.find((row) => row.productId === productId && row.warehouseId === 'wh-main')?.qty ?? 0,
  })
  return salesImportSummary({
    assessment,
    orders,
    lines: liveLines(),
    products: current.products,
    shipments: current.salesImportShipments.filter((item) => item.batchId === liveBatch.id),
    takenOrderIds: new Set(),
  })
}
const before = liveSummary()
const posted = db.confirmSalesImport(liveBatch.id)
const after = liveSummary()
const names = before.products.map((item) => `${item.name}:${item.qty}`).sort().join(',')
check(
  'summary matches the orders createSale posts',
  before.ready === 2 && before.postQty === 6 && names === 'AB Blue Ice Vanilla:5,IB Chocolate:1' && posted.posted === before.ready && after.ready === 0 && after.confirmed === 2 && after.postQty === 0,
  `before ${names} posted ${posted.posted} after ready ${after.ready}`,
)
const again = db.confirmSalesImport(liveBatch.id)
check('summary confirm does not post the same orders twice', again.posted === 0 && snap().sales.filter((sale) => sale.reference?.startsWith('SHOPEE:coolslurppypowder:')).length === 2, `again ${again.posted}`)

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
