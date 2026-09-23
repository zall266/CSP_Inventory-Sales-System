const memory = new Map<string, string>()
const localStoragePolyfill = {
  getItem(key: string) {
    return memory.has(key) ? memory.get(key)! : null
  },
  setItem(key: string, value: string) {
    memory.set(key, String(value))
  },
  removeItem(key: string) {
    memory.delete(key)
  },
  clear() {
    memory.clear()
  },
  key(index: number) {
    return [...memory.keys()][index] ?? null
  },
  get length() {
    return memory.size
  },
}
Object.defineProperty(globalThis, 'localStorage', { value: localStoragePolyfill })
Object.defineProperty(globalThis, 'window', { value: globalThis })

import { existsSync, readFileSync } from 'node:fs'
import { db } from '@/store/db'
import type { TextItem } from '@/features/salesImport/parsePickingList'
import { parsePickingList } from '@/features/salesImport/parsePickingList'
import { extractPdfTextItems } from '@/features/salesImport/pdfText'

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const snap = () => db.getSnapshot()
const mainQty = (productId: string) => snap().inventory.find((row) => row.productId === productId && row.warehouseId === 'wh-main')?.qty ?? 0
const saleMoves = (productId: string) => snap().stockMovements.filter((row) => row.productId === productId && row.type === 'sale')

function word(text: string, x: number, y: number, page = 1): TextItem {
  return { text, x, y, page }
}

function orderNo(seed: string) {
  return `260922${seed}`.slice(0, 14).padEnd(14, 'A')
}

function shopeeItems(username: string, rows: Array<{ name: string; variation?: string; sku?: string; qty: number; orders: string[] }>) {
  const items: TextItem[] = [
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
  ]
  let y = 720
  rows.forEach((row, index) => {
    items.push(word(String(index + 1), 15, y), word(row.name, 152, y), word(String(row.qty), 376, y))
    if (row.sku) items.push(word(row.sku, 233, y))
    if (row.variation) items.push(word(row.variation, 295, y))
    if (row.orders[0]) items.push(word(row.orders[0], 417, y))
    row.orders.slice(1).forEach((orderId) => {
      y -= 14
      items.push(word(orderId, 417, y))
    })
    y -= 24
  })
  return items
}

function numericItems(rows: Array<{ name: string; seller: string; qty: number; order: string }>, user = 'f***6@yahoo.com') {
  const items: TextItem[] = [
    word('Picking List', 24, 820),
    word(`User: ${user}`, 24, 800),
    word('Order quantity: 6', 24, 780),
    word('Product quantity: 1', 140, 780),
    word('Item quantity: 1', 260, 780),
    word('No', 22, 740),
    word('Product name', 131, 740),
    word('SKU', 269, 740),
    word('Seller SKU', 340, 740),
    word('Qty', 406, 740),
    word('Order ID', 453, 740),
  ]
  let y = 700
  rows.forEach((row, index) => {
    items.push(word(String(index + 1), 22, y), word(row.name, 132, y), word(row.seller, 340, y), word(String(row.qty), 406, y), word(row.order, 453, y))
    y -= 28
  })
  return items
}

const shopeeDetect = parsePickingList(shopeeItems('coolslurppypowder', [{ name: 'IB GRAPE', qty: 2, orders: [orderNo('P0000001')] }]))
check('1. Shopee Picklist layout detection', shopeeDetect.layout === 'shopee-picklist' && shopeeDetect.identityReliable && shopeeDetect.detectedUsername === 'coolslurppypowder', shopeeDetect.layout)

const numericDetect = parsePickingList(numericItems([{ name: 'Serbuk', seller: 'Latte', qty: 1, order: '586197972997867346' }]))
check('2. Numeric Picklist layout detection', numericDetect.layout === 'numeric-picklist' && !numericDetect.identityReliable, numericDetect.layout)

const single = parsePickingList(shopeeItems('coolslurppypowder', [{ name: 'IB GRAPE', variation: 'GRAPE', qty: 4, orders: [orderNo('P0000002')] }]))
check('3. Parse single-order quantity', single.lines.length === 1 && single.lines[0]?.quantity === 4 && single.lines[0]?.orderIds.length === 1, JSON.stringify(single.lines[0]))

const sharedOrders = Array.from({ length: 11 }, (_, index) => orderNo(`P1${String(index).padStart(6, '0')}`))
const shared = parsePickingList(shopeeItems('coolslurppypowder', [{ name: 'Tepung Waffle', qty: 17, orders: sharedOrders }]))
check('4. Detect shared quantity across multiple Order IDs', shared.lines.length === 1 && shared.lines[0]?.quantity === 17 && shared.lines[0]?.orderIds.length === 11, `orders ${shared.lines[0]?.orderIds.length}`)

const categoryId = snap().categories[0]?.id ?? 'cat-ice'
function makeProduct(name: string, sku: string, sellingPrice = 10, salesComponents?: { productId: string; qty: number }[]) {
  const product = db.createProduct({ name, sku, categoryId, unit: 'PCS', sellingPrice, salesComponents })
  if (!product) throw new Error(`product ${sku} was not created`)
  return product
}

const skuProduct = makeProduct('Import SKU Blue', '900001', 12)
const textProduct = makeProduct('Import Text Apple', '900002', 8)
const manualProduct = makeProduct('Import Manual Mocha', '900003', 9)
const fuzzyProduct = makeProduct('Grape Special Syrup', '900004', 7)
const component = makeProduct('Import Component Powder', '900005', 4)
db.adjustStock({ warehouseId: 'wh-main', productId: component.id, type: 'increase', qty: 20, reason: 'import test' })
const bundle = makeProduct('Import Bundle Cup', '900006', 15, [{ productId: component.id, qty: 2 }])
const stockOk = makeProduct('Import Stock Ok', '900007', 6)
db.adjustStock({ warehouseId: 'wh-main', productId: stockOk.id, type: 'increase', qty: 5, reason: 'import test' })
const stockShort = makeProduct('Import Stock Short', '900008', 6)
const other = makeProduct('Import Other Line', '900009', 5)
db.adjustStock({ warehouseId: 'wh-main', productId: other.id, type: 'increase', qty: 10, reason: 'import test' })
db.adjustStock({ warehouseId: 'wh-main', productId: skuProduct.id, type: 'increase', qty: 30, reason: 'import test' })
db.adjustStock({ warehouseId: 'wh-main', productId: textProduct.id, type: 'increase', qty: 30, reason: 'import test' })
db.adjustStock({ warehouseId: 'wh-main', productId: manualProduct.id, type: 'increase', qty: 30, reason: 'import test' })
db.adjustStock({ warehouseId: 'wh-main', productId: bundle.id, type: 'increase', qty: 30, reason: 'import test' })

const shopeeCool = db.createSalesImportAccount('shopee', 'coolslurppypowder')
const shopeeFaizal = db.createSalesImportAccount('shopee', 'faizal266')
const tiktokFaizal = db.createSalesImportAccount('tiktok', 'faizal266')
if (!shopeeCool || !shopeeFaizal || !tiktokFaizal) throw new Error('accounts were not created')
check('accounts stay distinct for the same name on two platforms', shopeeFaizal.id !== tiktokFaizal.id)

const mismatchBatch = db.createSalesImportBatch('shopee', shopeeCool.id)
if (!mismatchBatch) throw new Error('mismatch batch missing')
db.ingestSalesImportPicking(mismatchBatch.id, {
  fileName: 'wrong-account.pdf',
  fileHash: 'hash-mismatch',
  items: shopeeItems('faizal266', [{ name: 'IB GRAPE', qty: 1, orders: [orderNo('P0000010')] }]),
})
const mismatchOrders = snap().salesImportOrders.filter((order) => order.batchId === mismatchBatch.id)
const salesBeforeMismatch = snap().sales.length
const mismatchConfirm = db.confirmSalesImport(mismatchBatch.id)
check('5. Account mismatch blocks confirmation', mismatchConfirm.ok === false && snap().sales.length === salesBeforeMismatch && mismatchOrders.length === 1, mismatchConfirm.error)

const ackBatch = db.createSalesImportBatch('tiktok', tiktokFaizal.id)
if (!ackBatch) throw new Error('ack batch missing')
const ackOrder = '586197972997867111'
db.ingestSalesImportPicking(ackBatch.id, {
  fileName: 'masked.pdf',
  fileHash: 'hash-ack',
  items: numericItems([{ name: 'Serbuk Air', seller: 'Latte', qty: 1, order: ackOrder }]),
})
const blockedAck = db.confirmSalesImport(ackBatch.id)
const acknowledged = db.acknowledgeSalesImportAccount(ackBatch.id)
const ackLine = snap().salesImportLines.find((line) => snap().salesImportOrders.some((order) => order.id === line.orderId && order.batchId === ackBatch.id))
if (ackLine) db.saveSalesImportMapping({ batchId: ackBatch.id, keyType: 'text', key: `${'serbuk air'}|${'latte'}`, productId: manualProduct.id })
const ackConfirm = db.confirmSalesImport(ackBatch.id)
const ackSale = snap().sales.find((sale) => sale.reference === `TIKTOK:faizal266:${ackOrder}`)
check('6. Account acknowledgement when identity unavailable', blockedAck.ok === false && acknowledged && ackConfirm.posted === 1 && Boolean(ackSale), `${blockedAck.error} / posted ${ackConfirm.posted}`)

const skuBatch = db.createSalesImportBatch('shopee', shopeeCool.id)
if (!skuBatch) throw new Error('sku batch missing')
const skuOrder = orderNo('P0000020')
db.ingestSalesImportPicking(skuBatch.id, {
  fileName: 'sku.pdf',
  fileHash: 'hash-sku',
  items: shopeeItems('coolslurppypowder', [{ name: 'Blue Ice', sku: '900001', qty: 2, orders: [skuOrder] }]),
})
const skuLine = snap().salesImportLines.find((line) => line.externalSku === '900001' && snap().salesImportOrders.some((order) => order.id === line.orderId && order.batchId === skuBatch.id))
check('7. SKU mapping', skuLine?.mappedProductId === skuProduct.id, skuLine?.mappedProductId)

const textBatch = db.createSalesImportBatch('shopee', shopeeCool.id)
if (!textBatch) throw new Error('text batch missing')
const textKeyOrder = orderNo('P0000021')
db.ingestSalesImportPicking(textBatch.id, {
  fileName: 'text.pdf',
  fileHash: 'hash-text',
  items: shopeeItems('coolslurppypowder', [{ name: 'Serbuk Air Balang', variation: 'Green Apple', qty: 1, orders: [textKeyOrder] }]),
})
const textLine = snap().salesImportLines.find((line) => line.variationText === 'Green Apple' && snap().salesImportOrders.some((order) => order.id === line.orderId && order.batchId === textBatch.id))
const textIdentity = 'serbuk air balang|green apple'
db.saveSalesImportMapping({ batchId: textBatch.id, keyType: 'text', key: textIdentity, productId: textProduct.id })
const textMapped = snap().salesImportLines.find((line) => line.variationText === 'Green Apple' && snap().salesImportOrders.some((order) => order.id === line.orderId && order.batchId === textBatch.id))
check('8. Text fallback mapping', !textLine?.externalSku && textMapped?.mappedProductId === textProduct.id, textMapped?.mappedProductId)

const manualBatch = db.createSalesImportBatch('shopee', shopeeCool.id)
if (!manualBatch) throw new Error('manual batch missing')
const manualOrder = orderNo('P0000022')
db.ingestSalesImportPicking(manualBatch.id, {
  fileName: 'manual.pdf',
  fileHash: 'hash-manual',
  items: shopeeItems('coolslurppypowder', [{ name: 'Mystery Powder', variation: 'Mocha Dust', qty: 1, orders: [manualOrder] }]),
})
const manualBefore = snap().salesImportLines.find((line) => line.variationText === 'Mocha Dust')
check('fuzzy suggestion is not applied as the mapping', Boolean(manualBefore) && !manualBefore?.mappedProductId && manualBefore?.externalProductName.includes('Mystery') && fuzzyProduct.id !== manualBefore?.mappedProductId)
db.saveSalesImportMapping({ batchId: manualBatch.id, keyType: 'text', key: 'mystery powder|mocha dust', productId: manualProduct.id })
const manualAfter = snap().salesImportLines.find((line) => line.variationText === 'Mocha Dust' && snap().salesImportOrders.some((order) => order.id === line.orderId && order.batchId === manualBatch.id))
check('9. Manual mapping', manualAfter?.mappedProductId === manualProduct.id)

const persistedBatch = db.createSalesImportBatch('shopee', shopeeCool.id)
if (!persistedBatch) throw new Error('persisted batch missing')
db.ingestSalesImportPicking(persistedBatch.id, {
  fileName: 'persist.pdf',
  fileHash: 'hash-persist',
  items: shopeeItems('coolslurppypowder', [{ name: 'Blue Ice', sku: '900001', qty: 1, orders: [orderNo('P0000023')] }]),
})
const persisted = snap().salesImportLines.find((line) => line.externalSku === '900001' && snap().salesImportOrders.some((order) => order.id === line.orderId && order.externalOrderId === orderNo('P0000023')))
const savedSku = snap().salesImportMappings.some((row) => row.platform === 'shopee' && row.accountId === shopeeCool.id && row.keyType === 'sku' && row.key === '900001' && row.productId === skuProduct.id)
check('10. Mapping persistence', persisted?.mappedProductId === skuProduct.id && savedSku)

const firstDup = db.confirmSalesImport(skuBatch.id)
const dupSale = snap().sales.find((sale) => sale.reference === `SHOPEE:coolslurppypowder:${skuOrder}`)
check('11. Duplicate Order ID is detected before a second sale', firstDup.posted === 1 && Boolean(dupSale))
const repeatBatch = db.createSalesImportBatch('shopee', shopeeCool.id)
if (!repeatBatch) throw new Error('repeat batch missing')
db.ingestSalesImportPicking(repeatBatch.id, {
  fileName: 'repeat.pdf',
  fileHash: 'hash-repeat',
  items: shopeeItems('coolslurppypowder', [{ name: 'Blue Ice', sku: '900001', qty: 2, orders: [skuOrder] }]),
})
const repeatOrder = snap().salesImportOrders.find((order) => order.batchId === repeatBatch.id && order.externalOrderId === skuOrder)
const salesBeforeRepeat = snap().sales.length
const repeatConfirm = db.confirmSalesImport(repeatBatch.id)
check('12. Duplicate across repeated upload', repeatOrder?.status === 'duplicate' && repeatConfirm.posted === 0 && snap().sales.length === salesBeforeRepeat, repeatOrder?.status)

const sharedIdentity = '586197972997860013'
const shopeeCross = db.createSalesImportBatch('shopee', shopeeCool.id)
if (!shopeeCross) throw new Error('shopee cross batch missing')
db.acknowledgeSalesImportAccount(shopeeCross.id)
db.ingestSalesImportPicking(shopeeCross.id, {
  fileName: 'shopee-cross.pdf',
  fileHash: 'hash-shopee-cross',
  items: numericItems([{ name: 'Blue Ice', seller: '900001', qty: 1, order: sharedIdentity }]),
})
const shopeeCrossConfirm = db.confirmSalesImport(shopeeCross.id)
const tiktokSame = db.createSalesImportBatch('tiktok', tiktokFaizal.id)
if (!tiktokSame) throw new Error('tiktok batch missing')
db.acknowledgeSalesImportAccount(tiktokSame.id)
db.ingestSalesImportPicking(tiktokSame.id, {
  fileName: 'tiktok-same.pdf',
  fileHash: 'hash-tiktok-same',
  items: numericItems([{ name: 'Blue Ice', seller: '900001', qty: 1, order: sharedIdentity }]),
})
const cross = db.confirmSalesImport(tiktokSame.id)
const crossSale = snap().sales.find((sale) => sale.reference === `TIKTOK:faizal266:${sharedIdentity}`)
const shopeeCrossSale = snap().sales.find((sale) => sale.reference === `SHOPEE:coolslurppypowder:${sharedIdentity}`)
check('13. Same Order ID on different platforms remains distinct', shopeeCrossConfirm.posted === 1 && cross.posted === 1 && Boolean(crossSale) && crossSale?.id !== shopeeCrossSale?.id, cross.error)

const sharedBatch = db.createSalesImportBatch('shopee', shopeeCool.id)
if (!sharedBatch) throw new Error('shared batch missing')
const clearOrder = orderNo('P0000030')
const beforeSharedSales = snap().sales.length
const beforeSkuQty = mainQty(skuProduct.id)
db.ingestSalesImportPicking(sharedBatch.id, {
  fileName: 'shared.pdf',
  fileHash: 'hash-shared',
  items: shopeeItems('coolslurppypowder', [
    { name: 'Tepung Waffle', qty: 17, orders: sharedOrders },
    { name: 'Blue Ice', sku: '900001', qty: 2, orders: [clearOrder] },
  ]),
})
const sharedState = snap().salesImportOrders.filter((order) => order.batchId === sharedBatch.id)
const sharedConfirm = db.confirmSalesImport(sharedBatch.id)
check(
  '14. Unallocated quantity blocks that order',
  sharedState.filter((order) => sharedOrders.includes(order.externalOrderId)).every((order) => order.status === 'unallocated') &&
    sharedConfirm.posted === 1 &&
    snap().sales.length === beforeSharedSales + 1 &&
    mainQty(skuProduct.id) === beforeSkuQty - 2,
  `posted ${sharedConfirm.posted} unallocated ${sharedState.filter((order) => order.status === 'unallocated').length}`,
)

const mixNew = orderNo('P0000040')
const mixDup = orderNo('P0000041')
const mixUnmapped = orderNo('P0000042')
const mixSharedA = orderNo('P0000043')
const mixSharedB = orderNo('P0000044')
const seedDup = db.createSalesImportBatch('shopee', shopeeFaizal.id)
if (!seedDup) throw new Error('seed dup missing')
db.ingestSalesImportPicking(seedDup.id, {
  fileName: 'seed-dup.pdf',
  fileHash: 'hash-seed-dup',
  items: shopeeItems('faizal266', [{ name: 'Blue Ice', sku: '900001', qty: 1, orders: [mixDup] }]),
})
db.confirmSalesImport(seedDup.id)
const mixed = db.createSalesImportBatch('shopee', shopeeFaizal.id)
if (!mixed) throw new Error('mixed missing')
db.ingestSalesImportPicking(mixed.id, {
  fileName: 'mixed.pdf',
  fileHash: 'hash-mixed',
  items: shopeeItems('faizal266', [
    { name: 'Blue Ice', sku: '900001', qty: 1, orders: [mixNew] },
    { name: 'Blue Ice', sku: '900001', qty: 1, orders: [mixDup] },
    { name: 'Unknown Powder', variation: 'No Match', qty: 1, orders: [mixUnmapped] },
    { name: 'Tepung Waffle', qty: 9, orders: [mixSharedA, mixSharedB] },
  ]),
})
const beforeMixed = snap().sales.length
const mixedConfirm = db.confirmSalesImport(mixed.id)
const mixedOrders = snap().salesImportOrders.filter((order) => order.batchId === mixed.id)
const mixedBatch = snap().salesImportBatches.find((batch) => batch.id === mixed.id)
check(
  '15. Mixed batch partial confirmation',
  mixedConfirm.posted === 1 &&
    snap().sales.length === beforeMixed + 1 &&
    mixedOrders.find((order) => order.externalOrderId === mixNew)?.status === 'confirmed' &&
    mixedOrders.find((order) => order.externalOrderId === mixDup)?.status === 'duplicate' &&
    mixedOrders.find((order) => order.externalOrderId === mixUnmapped)?.status === 'unmapped' &&
    mixedOrders.find((order) => order.externalOrderId === mixSharedA)?.status === 'unallocated' &&
    mixedBatch?.status === 'partial',
  mixedOrders.map((order) => `${order.externalOrderId}:${order.status}`).join(', '),
)

const shortA = orderNo('P0000050')
const shortB = orderNo('P0000051')
const shortBatch = db.createSalesImportBatch('shopee', shopeeCool.id)
if (!shortBatch) throw new Error('short batch missing')
db.ingestSalesImportPicking(shortBatch.id, {
  fileName: 'short.pdf',
  fileHash: 'hash-short',
  items: shopeeItems('coolslurppypowder', [
    { name: 'Ok', sku: '900007', qty: 3, orders: [shortA] },
    { name: 'Short', sku: '900008', qty: 1, orders: [shortB] },
  ]),
})
const beforeShortSales = snap().sales.length
const beforeShortMoves = snap().stockMovements.filter((row) => row.type === 'sale').length
const beforeOk = mainQty(stockOk.id)
const shortConfirm = db.confirmSalesImport(shortBatch.id)
check('16. Insufficient stock blocks posting', shortConfirm.ok === false && snap().sales.length === beforeShortSales && mainQty(stockOk.id) === beforeOk, shortConfirm.error)
check('17. No partial inventory movement', snap().stockMovements.filter((row) => row.type === 'sale').length === beforeShortMoves && snap().salesImportOrders.filter((order) => order.batchId === shortBatch.id).every((order) => order.status !== 'confirmed'))

const multiBatch = db.createSalesImportBatch('shopee', shopeeCool.id)
if (!multiBatch) throw new Error('multi batch missing')
const multiOrder = orderNo('P0000060')
const beforeMulti = snap().sales.length
db.ingestSalesImportPicking(multiBatch.id, {
  fileName: 'multi.pdf',
  fileHash: 'hash-multi',
  items: shopeeItems('coolslurppypowder', [
    { name: 'Blue Ice', sku: '900001', qty: 1, orders: [multiOrder] },
    { name: 'Apple', sku: '900002', qty: 2, orders: [multiOrder] },
  ]),
})
const multiConfirm = db.confirmSalesImport(multiBatch.id)
const multiSale = snap().sales.find((sale) => sale.reference === `SHOPEE:coolslurppypowder:${multiOrder}`)
check('18. createSale() called once per confirmed order', multiConfirm.posted === 1 && snap().sales.length === beforeMulti + 1 && multiSale?.items.length === 2 && multiSale.warehouseId === 'wh-main', `items ${multiSale?.items.length}`)

const bundleBatch = db.createSalesImportBatch('shopee', shopeeCool.id)
if (!bundleBatch) throw new Error('bundle batch missing')
const bundleOrder = orderNo('P0000070')
const beforeComponent = mainQty(component.id)
const beforeBundle = mainQty(bundle.id)
const beforeBundleMoves = saleMoves(bundle.id).length
db.ingestSalesImportPicking(bundleBatch.id, {
  fileName: 'bundle.pdf',
  fileHash: 'hash-bundle',
  items: shopeeItems('coolslurppypowder', [{ name: 'Bundle Cup', sku: '900006', qty: 3, orders: [bundleOrder] }]),
})
const bundleConfirm = db.confirmSalesImport(bundleBatch.id)
const componentMoves = saleMoves(component.id)
check(
  '19. Sales Components continue working',
  bundleConfirm.posted === 1 && mainQty(component.id) === beforeComponent - 6 && mainQty(bundle.id) === beforeBundle && saleMoves(bundle.id).length === beforeBundleMoves && componentMoves.some((row) => row.type === 'sale' && row.stockOut === 6),
  `component ${mainQty(component.id)} parent ${mainQty(bundle.id)}`,
)

const beforeIdempotentSales = snap().sales.length
const beforeIdempotentMoves = snap().stockMovements.length
const second = db.confirmSalesImport(bundleBatch.id)
check('20. Confirm is idempotent', second.posted === 0 && snap().sales.length === beforeIdempotentSales && snap().stockMovements.length === beforeIdempotentMoves, `posted ${second.posted}`)

const snapshotLine = snap().salesImportLines.find((line) => line.externalSku === '900006' && line.mappedProductSnapshot)
const originalName = snapshotLine?.mappedProductSnapshot?.productName
db.updateProduct(bundle.id, { name: 'Import Bundle Cup Renamed' })
const afterRename = snap().salesImportLines.find((line) => line.id === snapshotLine?.id)
const bundleSale = snap().sales.find((sale) => sale.reference === `SHOPEE:coolslurppypowder:${bundleOrder}`)
check(
  '21. Historical mapping snapshot preserved',
  Boolean(originalName) && afterRename?.mappedProductSnapshot?.productName === originalName && afterRename?.mappedProductSnapshot?.sku === '900006' && bundleSale?.items[0]?.productId === bundle.id,
  afterRename?.mappedProductSnapshot?.productName,
)

const realFiles = [
  ['/home/ubuntu/.cursor/projects/workspace/uploads/230926_Picking_List_Shopee1_2174.pdf', 'shopee-picklist', 'coolslurppypowder', 35],
  ['/home/ubuntu/.cursor/projects/workspace/uploads/230926_Picking_List_Shopee2_f9fd.pdf', 'shopee-picklist', 'faizal266', 15],
  ['/home/ubuntu/.cursor/projects/workspace/uploads/230926_Picking_List_Shopee3_7e26.pdf', 'numeric-picklist', 'f***6@yahoo.com', 6],
] as const
for (const [path, layout, user, count] of realFiles) {
  if (!existsSync(path)) {
    check(`real pdf ${path}`, true, 'skipped, file not in this environment')
    continue
  }
  const parsed = parsePickingList(await extractPdfTextItems(new Uint8Array(readFileSync(path))))
  const ids = new Set(parsed.lines.flatMap((line) => line.orderIds))
  const units = parsed.lines.reduce((sum, line) => sum + (line.orderIds.length === 1 ? line.quantity : 0), 0)
  const ok = parsed.layout === layout && parsed.detectedUsername === user && ids.size === count && (count !== 6 || units === 13)
  check(`real pdf ${layout} ${user}`, ok, `orders ${ids.size} units ${units} user ${parsed.detectedUsername}`)
}

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
