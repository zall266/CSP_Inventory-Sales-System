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
import { parseAwb } from '@/features/salesImport/parseAwb'
import { extractPdfTextItems } from '@/features/salesImport/pdfText'

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const snap = () => db.getSnapshot()
const mainQty = (productId: string) => snap().inventory.find((row) => row.productId === productId && row.warehouseId === 'wh-main')?.qty ?? 0
const saleMoves = (productId: string) => snap().stockMovements.filter((row) => row.productId === productId && row.type === 'sale' && row.reference?.startsWith('INV-'))
function word(text: string, x: number, y: number, page = 1): TextItem {
  return { text, x, y, page }
}

function pickingShared(username: string, sku: string, name: string, qty: number, orders: string[]) {
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
    word('1', 15, 720),
    word(name, 152, 720),
    word(sku, 233, 720),
    word(String(qty), 376, 720),
    word(orders[0], 417, 720),
  ]
  orders.slice(1).forEach((orderId, index) => items.push(word(orderId, 417, 700 - index * 16)))
  return items
}

function pickingSingle(username: string, sku: string, name: string, qty: number, orderId: string) {
  return pickingShared(username, sku, name, qty, [orderId])
}

function awbPack(page: number, orderId: string, sku: string, name: string, qty: number, price = '7.90') {
  return [
    word('Packing', 8, 800, page),
    word('List', 54, 800, page),
    word('Order', 8, 780, page),
    word('ID:', 33, 780, page),
    word(orderId, 46, 780, page),
    word('package', 140, 780, page),
    word('1', 170, 780, page),
    word('#', 7, 740, page),
    word('Parent', 20, 740, page),
    word('Name', 57, 740, page),
    word('SKU', 115, 740, page),
    word('Variation', 163, 740, page),
    word('Qty', 211, 740, page),
    word('Unit', 237, 740, page),
    word('Total', 263, 740, page),
    word('1', 7, 700, page),
    word(name, 57, 700, page),
    word(sku, 115, 700, page),
    word(String(qty), 211, 700, page),
    word(price, 237, 700, page),
  ]
}

function awbLabel(page: number, orderId: string, tracking: string, username?: string) {
  const items = [
    word('Order', 7, 700, page),
    word('ID:', 28, 700, page),
    word(orderId, 66, 700, page),
    word(tracking, 150, 640, page),
    word('SPX', 8, 620, page),
    word('Express', 30, 620, page),
    word('Recipient', 7, 500, page),
    word('Details', 50, 500, page),
    word('Name:', 8, 470, page),
    word('Recipient', 40, 470, page),
    word('Person', 90, 470, page),
  ]
  if (username) items.push(word('Username:', 8, 760, page), word(username, 70, 760, page))
  return items
}

const real = [
  ['/home/ubuntu/.cursor/projects/workspace/uploads/230926_AWB1_584b.pdf', 'shopee-awb', 35, 17],
  ['/home/ubuntu/.cursor/projects/workspace/uploads/230926_AWB2_b9e5.pdf', 'shopee-awb', 15, 0],
  ['/home/ubuntu/.cursor/projects/workspace/uploads/230926_AWB3_d315.pdf', 'numeric-awb', 6, 13],
] as const

for (const [path, layout, orders, marker] of real) {
  if (!existsSync(path)) {
    check(`real awb ${layout}`, true, 'skipped')
    continue
  }
  const parsed = parseAwb(await extractPdfTextItems(new Uint8Array(readFileSync(path))))
  const ids = new Set(parsed.shipments.map((shipment) => shipment.externalOrderId))
  const units = parsed.shipments.reduce((sum, shipment) => sum + shipment.lines.reduce((inner, line) => inner + line.quantity, 0), 0)
  const tracked = parsed.shipments.filter((shipment) => shipment.trackingNumber).length
  const waffle = ['260922P4R5F8E3', '260922P69U7A48', '260922P9W51RE9', '260922PH8PV4GN', '260922PX00PUPB', '260922PX57MB5R', '260922PYPGY2MH', '260923Q3TFURAY', '260923QSR54TV2', '260923QU9M9HFF', '260923QUCPEYUV']
  const waffleSum = waffle.reduce((sum, id) => {
    const shipment = parsed.shipments.find((item) => item.externalOrderId === id)
    return sum + (shipment?.lines.filter((line) => /waffle/i.test(line.externalProductName)).reduce((inner, line) => inner + line.quantity, 0) ?? 0)
  }, 0)
  const ok = parsed.layout === layout && !parsed.identityReliable && ids.size === orders && (layout === 'numeric-awb' ? units === marker && tracked === 6 : true) && (marker === 17 ? waffleSum === 17 : true) && parsed.shipments.some((shipment) => shipment.trackingNumber || shipment.courierText)
  check(`AWB layout ${layout}`, ok, `orders ${ids.size} units ${units} tracked ${tracked} waffle ${waffleSum} courier ${parsed.shipments[0]?.courierText}`)
}

const account = db.createSalesImportAccount('shopee', 'coolslurppypowder')
const batch = account ? db.createSalesImportBatch('shopee', account.id) : null
if (!batch || !account) throw new Error('batch missing')
const orderA = '260922P4R5F8E3'
const orderB = '260922P69U7A48'
db.ingestSalesImportPicking(batch.id, {
  fileName: 'pick.pdf',
  fileHash: 'hash-pick',
  items: pickingShared('coolslurppypowder', '147822', 'Tepung Waffle', 17, [orderA, orderB]),
})
const beforeAwb = snap().salesImportOrders.filter((order) => order.batchId === batch.id)
check('shared picking stays unallocated before AWB', beforeAwb.length === 2 && beforeAwb.every((order) => order.status === 'unallocated'), beforeAwb.map((order) => order.status).join(','))

db.ingestSalesImportAwb(batch.id, {
  fileName: 'awb.pdf',
  fileHash: 'hash-awb',
  items: [
    ...awbPack(1, orderA, '147822', 'Tepung Waffle', 10),
    ...awbLabel(2, orderA, 'SPXMY000000000001'),
    ...awbPack(3, orderB, '147822', 'Tepung Waffle', 7),
    ...awbLabel(4, orderB, 'SPXMY000000000002'),
  ],
})
const reconciled = snap().salesImportOrders.filter((order) => order.batchId === batch.id)
const reconciledLines = snap().salesImportLines.filter((line) => reconciled.some((order) => order.id === line.orderId))
check(
  'unallocated order resolves from AWB quantities',
  reconciled.every((order) => order.status === 'new') && reconciledLines.map((line) => line.quantity).sort((a, b) => a - b).join(',') === '7,10' && reconciledLines.every((line) => line.quantitySource === 'awb'),
  reconciledLines.map((line) => `${line.quantity}:${line.quantitySource}:${line.unallocated}`).join(' '),
)
const shipments = () => snap().salesImportShipments.filter((shipment) => shipment.accountId === account.id)
check('order matching creates shipments', shipments().length === 2 && shipments().every((shipment) => shipment.linkStatus === 'matched'), shipments().map((shipment) => shipment.linkStatus).join(','))

const beforeSales = snap().sales.length
const beforeMoves = snap().stockMovements.length
const posted = db.confirmSalesImport(batch.id)
const saleCount = snap().sales.filter((sale) => sale.reference?.startsWith('SHOPEE:coolslurppypowder:')).length
check('confirm uses createSale once per reconciled order', posted.posted === 2 && saleCount === 2, `posted ${posted.posted} sales ${saleCount}`)
const afterConfirmSales = snap().sales.length
const afterConfirmMoves = snap().stockMovements.length
db.ingestSalesImportAwb(batch.id, {
  fileName: 'awb-later.pdf',
  fileHash: 'hash-awb-later',
  items: [...awbPack(1, orderA, '147822', 'Tepung Waffle', 10), ...awbLabel(2, orderA, 'SPXMY000000000001')],
})
check(
  'later AWB does not create a sale or inventory movement',
  snap().sales.length === afterConfirmSales && snap().stockMovements.length === afterConfirmMoves && shipments().filter((shipment) => shipment.trackingNumber === 'SPXMY000000000001').length === 1,
  `sales ${snap().sales.length - beforeSales} moves ${snap().stockMovements.length - beforeMoves}`,
)

const repeat = db.ingestSalesImportAwb(batch.id, { fileName: 'awb.pdf', fileHash: 'hash-awb', items: awbLabel(1, orderA, 'SPXMY000000000001') })
check('same AWB file is not imported twice', repeat.ok === false && shipments().length === 2, repeat.error)

db.ingestSalesImportAwb(batch.id, {
  fileName: 'awb-second.pdf',
  fileHash: 'hash-awb-second',
  items: awbLabel(1, orderA, 'SPXMY000000000099'),
})
const tracks = shipments().filter((shipment) => shipment.externalOrderId === orderA)
check('different tracking is review and does not overwrite', tracks.length === 2 && tracks.every((shipment) => shipment.linkStatus === 'review') && tracks.some((shipment) => shipment.trackingNumber === 'SPXMY000000000001'), tracks.map((shipment) => `${shipment.trackingNumber}:${shipment.linkStatus}`).join(' '))

const mismatchBatch = db.createSalesImportBatch('shopee', account.id)
if (!mismatchBatch) throw new Error('mismatch batch missing')
db.ingestSalesImportPicking(mismatchBatch.id, {
  fileName: 'pick-one.pdf',
  fileHash: 'hash-pick-one',
  items: pickingSingle('coolslurppypowder', '147822', 'Tepung Waffle', 1, '260922P80F9UNC'),
})
const beforeMismatch = shipments().length
db.ingestSalesImportAwb(mismatchBatch.id, {
  fileName: 'awb-wrong.pdf',
  fileHash: 'hash-wrong',
  items: [...awbPack(1, '260922P80F9UNC', '147822', 'Tepung Waffle', 1), ...awbLabel(2, '260922P80F9UNC', 'SPXMY000000000077', 'faizal266')],
})
check('wrong-account AWB does not link a shipment', shipments().length === beforeMismatch && shipments().every((shipment) => shipment.trackingNumber !== 'SPXMY000000000077'), `shipments ${shipments().length}`)

db.ingestSalesImportAwb(mismatchBatch.id, {
  fileName: 'awb-unknown.pdf',
  fileHash: 'hash-unknown',
  items: [...awbPack(1, '260922PZZZZZZZ', '147822', 'Tepung Waffle', 1), ...awbLabel(2, '260922PZZZZZZZ', 'SPXMY000000000055')],
})
const unmatched = snap().salesImportShipments.find((shipment) => shipment.trackingNumber === 'SPXMY000000000055')
const salesBeforeUnknown = snap().sales.length
check('unknown order stays unmatched and creates no sale', unmatched?.linkStatus === 'unmatched' && snap().sales.length === salesBeforeUnknown, unmatched?.linkStatus)

const reviewBatch = db.createSalesImportBatch('shopee', account.id)
if (!reviewBatch) throw new Error('review batch missing')
db.ingestSalesImportPicking(reviewBatch.id, {
  fileName: 'pick-review.pdf',
  fileHash: 'hash-pick-review',
  items: pickingSingle('coolslurppypowder', '147508', 'Vanilla', 4, '260922PX3H94H0'),
})
db.ingestSalesImportAwb(reviewBatch.id, {
  fileName: 'awb-review.pdf',
  fileHash: 'hash-review',
  items: [...awbPack(1, '260922PX3H94H0', '147508', 'Vanilla', 3, '15.99'), ...awbLabel(2, '260922PX3H94H0', 'SPXMY000000000033')],
})
const reviewOrder = snap().salesImportOrders.find((order) => order.externalOrderId === '260922PX3H94H0')
const reviewLine = snap().salesImportLines.find((line) => line.orderId === reviewOrder?.id)
const reviewShipment = snap().salesImportShipments.find((shipment) => shipment.trackingNumber === 'SPXMY000000000033')
const beforeReviewSales = snap().sales.length
const reviewConfirm = db.confirmSalesImport(reviewBatch.id)
check(
  'quantity mismatch stays in review and is not posted',
  reviewOrder?.status === 'error' && reviewLine?.quantity === 4 && reviewLine.quantityReview === true && reviewShipment?.linkStatus === 'review' && reviewConfirm.posted === 0 && snap().sales.length === beforeReviewSales,
  `${reviewOrder?.status} qty ${reviewLine?.quantity} shipment ${reviewShipment?.linkStatus} posted ${reviewConfirm.posted}`,
)

const component = snap().products.find((product) => product.sku === '147547')
const part = snap().products.find((product) => product.sku === '147529')
if (component && part) {
  db.updateProduct(component.id, { salesComponents: [{ productId: part.id, qty: 1 }] })
  const componentBatch = db.createSalesImportBatch('shopee', account.id)
  if (!componentBatch) throw new Error('component batch missing')
  const beforePart = mainQty(part.id)
  const beforeComponent = mainQty(component.id)
  db.ingestSalesImportPicking(componentBatch.id, {
    fileName: 'pick-component.pdf',
    fileHash: 'hash-component',
    items: pickingSingle('coolslurppypowder', '147547', 'AB Green Apple', 2, '260922PG9N4FKN'),
  })
  db.ingestSalesImportAwb(componentBatch.id, {
    fileName: 'awb-component.pdf',
    fileHash: 'hash-component-awb',
    items: [...awbPack(1, '260922PG9N4FKN', '147547', 'AB Green Apple', 2, '17.99'), ...awbLabel(2, '260922PG9N4FKN', 'SPXMY000000000044')],
  })
  const componentConfirm = db.confirmSalesImport(componentBatch.id)
  const partMoves = saleMoves(part.id).length
  check(
    'sales components still post once through createSale',
    componentConfirm.posted === 1 && mainQty(part.id) === beforePart - 2 && mainQty(component.id) === beforeComponent && partMoves >= 1,
    `part ${mainQty(part.id)} parent ${mainQty(component.id)} posted ${componentConfirm.posted}`,
  )
}

async function realBatch(platform: 'shopee' | 'tiktok', accountName: string, picking: string, awb: string) {
  const owned = db.createSalesImportAccount(platform, accountName)
  const created = owned ? db.createSalesImportBatch(platform, owned.id) : null
  if (!owned || !created) throw new Error(`batch ${platform} ${accountName}`)
  db.ingestSalesImportPicking(created.id, { fileName: 'picking.pdf', fileHash: `real-pick-${platform}-${accountName}`, items: await extractPdfTextItems(new Uint8Array(readFileSync(picking))) })
  db.ingestSalesImportAwb(created.id, { fileName: 'awb.pdf', fileHash: `real-awb-${platform}-${accountName}`, items: await extractPdfTextItems(new Uint8Array(readFileSync(awb))) })
  const current = snap()
  return {
    account: owned,
    batch: created,
    orders: current.salesImportOrders.filter((order) => order.batchId === created.id),
    lines: current.salesImportLines,
    shipments: current.salesImportShipments.filter((shipment) => shipment.accountId === owned.id && shipment.batchId === created.id),
  }
}

const set1 = await realBatch(
  'shopee',
  'coolslurppypowder-real',
  '/home/ubuntu/.cursor/projects/workspace/uploads/230926_Picking_List_Shopee1_2174.pdf',
  '/home/ubuntu/.cursor/projects/workspace/uploads/230926_AWB1_584b.pdf',
)
const waffleIds = ['260922P4R5F8E3', '260922P69U7A48', '260922P9W51RE9', '260922PH8PV4GN', '260922PX00PUPB', '260922PX57MB5R', '260922PYPGY2MH', '260923Q3TFURAY', '260923QSR54TV2', '260923QU9M9HFF', '260923QUCPEYUV']
const waffleLines = waffleIds.map((id) => {
  const order = set1.orders.find((item) => item.externalOrderId === id)
  return set1.lines.find((line) => line.orderId === order?.id && /waffle/i.test(line.externalProductName))
})
check(
  'set 1 waffle quantities reconcile to 17',
  waffleLines.length === 11 && waffleLines.every((line) => line && line.quantitySource === 'awb' && !line.unallocated) && waffleLines.reduce((sum, line) => sum + (line?.quantity ?? 0), 0) === 17,
  waffleLines.map((line) => line?.quantity).join('+'),
)
check(
  'set 1 matches every picking order without a second sale',
  set1.orders.length === 35 && set1.shipments.length === 35 && set1.shipments.every((shipment) => shipment.linkStatus === 'matched') && set1.orders.every((order) => order.status !== 'confirmed'),
  `orders ${set1.orders.length} ships ${set1.shipments.length} review ${set1.shipments.filter((shipment) => shipment.linkStatus === 'review').length}`,
)

const set2 = await realBatch(
  'shopee',
  'faizal266-real',
  '/home/ubuntu/.cursor/projects/workspace/uploads/230926_Picking_List_Shopee2_f9fd.pdf',
  '/home/ubuntu/.cursor/projects/workspace/uploads/230926_AWB2_b9e5.pdf',
)
check(
  'set 2 matches all 15 order ids',
  set2.orders.length === 15 && set2.shipments.length === 15 && set2.shipments.every((shipment) => shipment.linkStatus === 'matched') && set2.orders.every((order) => set2.shipments.some((shipment) => shipment.externalOrderId === order.externalOrderId)),
  `orders ${set2.orders.length} ships ${set2.shipments.length} new ${set2.orders.filter((order) => order.status === 'new').length}`,
)

const set3 = await realBatch(
  'tiktok',
  'faizal266-real',
  '/home/ubuntu/.cursor/projects/workspace/uploads/230926_Picking_List_Shopee3_7e26.pdf',
  '/home/ubuntu/.cursor/projects/workspace/uploads/230926_AWB3_d315.pdf',
)
const set3Review = set3.lines.filter((line) => set3.orders.some((order) => order.id === line.orderId) && line.quantityReview)
check(
  'set 3 matches 6 orders without inferring the account',
  set3.orders.length === 6 && set3.shipments.length === 6 && set3.shipments.every((shipment) => shipment.linkStatus === 'matched') && set3Review.length === 0 && set3.shipments.some((shipment) => shipment.trackingNumber === '680070982575013'),
  `orders ${set3.orders.length} reviewLines ${set3Review.length}`,
)
const set3Files = snap().salesImportFiles.filter((file) => file.batchId === set3.batch.id && file.role === 'awb')
check('set 3 AWB does not invent a printed username', set3Files.length === 1 && set3Files[0]?.identityReliable !== true, set3Files[0]?.detectedUsername ?? 'none')

const wrongFile = db.ingestSalesImportAwb(set1.batch.id, {
  fileName: 'awb2.pdf',
  fileHash: 'real-awb2-on-set1',
  items: await extractPdfTextItems(new Uint8Array(readFileSync('/home/ubuntu/.cursor/projects/workspace/uploads/230926_AWB2_b9e5.pdf'))),
})
const set1AfterWrong = snap().salesImportShipments.filter((shipment) => shipment.batchId === set1.batch.id)
const mismatchFile = snap().salesImportFiles.find((file) => file.batchId === set1.batch.id && file.fileHash === 'real-awb2-on-set1')
check(
  'AWB without a printed username uses the selected account and leaves foreign orders unmatched',
  wrongFile.ok === true && mismatchFile?.identityReliable !== true && set1AfterWrong.filter((shipment) => shipment.linkStatus === 'unmatched').length === 15 && set1.orders.every((order) => order.status !== 'confirmed'),
  `unmatched ${set1AfterWrong.filter((shipment) => shipment.linkStatus === 'unmatched').length}`,
)

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
