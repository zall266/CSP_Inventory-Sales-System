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
import type { TextItem } from '@/features/salesImport/parsePickingList'
import { assessSalesImport, salesImportSummary } from '@/features/salesImport/review'
import { buildSpotSamples, confirmSaleEnabled, type SpotCheckLine, type SpotSample } from '@/features/salesImport/spotCheck'

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const categories = [
  { id: 'flour', name: 'Flour' },
  { id: 'ice', name: 'Ice' },
  { id: 'powder', name: 'Powder' },
  { id: 'other', name: 'Other' },
]
const catalog = [
  { id: 'p-w', name: 'Tepung Waffle', categoryId: 'flour' },
  { id: 'p-m', name: 'AB Mango', categoryId: 'ice' },
  { id: 'p-y', name: 'AB Yam', categoryId: 'ice' },
  { id: 'p-s', name: 'IB Strawberry', categoryId: 'ice' },
  { id: 'p-p', name: 'Serbuk Powder', categoryId: 'powder' },
  { id: 'p-o', name: 'Single Cup', categoryId: 'other' },
]
const rows: Array<[string, string, number]> = [
  ['o-w', 'Tepung Waffle', 25],
  ['o-m', 'AB Mango', 6],
  ['o-y', 'AB Yam', 5],
  ['o-s', 'IB Strawberry', 3],
  ['o-p', 'Serbuk Powder', 2],
  ['o-c', 'Single Cup', 1],
]

function fixture(count: number) {
  const picked = rows.slice(0, count)
  const orders = picked.map(([id, name]) => ({ id, externalOrderId: `260922${name.replace(/[^A-Z0-9]/gi, '').slice(0, 8).toUpperCase().padEnd(8, 'X')}` }))
  const lines: SpotCheckLine[] = picked.map(([id, name, quantity]) => ({
    orderId: id,
    externalProductName: name,
    quantity,
    mappedProductId: catalog.find((product) => product.name === name)?.id,
  }))
  return buildSpotSamples({ orders, lines, products: catalog, categories })
}

const four = fixture(4)
check('1. Exactly 4 distinct products selects 4 samples', four.length === 4 && rows.slice(0, 4).every((row) => four.some((sample) => sample.name === row[1])), four.map((sample) => sample.name).join(', '))

const many = fixture(6)
const manyNames = many.map((sample) => sample.name).sort()
check('2. More than 4 products selects exactly 4 samples', many.length === 4 && manyNames.join('|') === ['AB Yam', 'Serbuk Powder', 'Single Cup', 'Tepung Waffle'].join('|'), manyNames.join(', '))

const few = fixture(3)
check('3. Fewer than 4 products selects every product', few.length === 3 && rows.slice(0, 3).every((row) => few.some((sample) => sample.name === row[1])), few.map((sample) => sample.name).join(', '))

const shuffled = buildSpotSamples({
  orders: [...rows].reverse().map(([id, name]) => ({ id, externalOrderId: name })),
  lines: [...rows].reverse().map(([id, name, quantity]) => ({
    orderId: id,
    externalProductName: name,
    quantity,
    mappedProductId: catalog.find((product) => product.name === name)?.id,
  })),
  products: catalog,
  categories,
})
check('4. Samples stay deterministic', JSON.stringify(many) === JSON.stringify(fixture(6)) && shuffled.map((sample) => sample.key).join('|') === many.map((sample) => sample.key).join('|'), shuffled.map((sample) => sample.name).join(', '))

const keys = (samples: SpotSample[]) => samples.map((sample) => sample.key)
check('5. Spot check no longer gates Confirm', confirmSaleEnabled({ canCreate: true, systemCanConfirm: true, samples: four, checkedKeys: keys(four).slice(0, 3) }) === true)
check('6. Spot check complete and a clear system check enables Confirm', confirmSaleEnabled({ canCreate: true, systemCanConfirm: true, samples: four, checkedKeys: keys(four) }) === true)
check('7. Spot check complete does not override a system blocker', confirmSaleEnabled({ canCreate: true, systemCanConfirm: false, samples: four, checkedKeys: keys(four) }) === false && confirmSaleEnabled({ canCreate: false, systemCanConfirm: true, samples: four, checkedKeys: keys(four) }) === false)

const sharedOrders = ['o1', 'o2', 'o3'].map((id, index) => ({ id, externalOrderId: `260922SHARE00${index + 1}` }))
const sharedLines = sharedOrders.map((order) => ({
  orderId: order.id,
  externalProductName: 'Tepung Waffle',
  variationText: 'ORIGINAL',
  quantity: 17,
  unallocated: true,
  sharedOrderCount: 3,
}))
const beforeShared = JSON.stringify(sharedLines)
const sharedSample = buildSpotSamples({ orders: sharedOrders, lines: sharedLines, products: catalog, categories })
check('9. Viewing sample data does not modify imported lines', beforeShared === JSON.stringify(sharedLines) && sharedSample.length === 1 && sharedSample[0]?.quantity === 17, `qty ${sharedSample[0]?.quantity}`)

function word(text: string, x: number, y: number): TextItem {
  return { text, x, y, page: 1 }
}
function orderNo(seed: string) {
  return `260922${seed}`.slice(0, 14).padEnd(14, 'A')
}
function shopeeItems(rows: Array<{ name: string; sku?: string; qty: number; orders: string[] }>) {
  const items: TextItem[] = [
    word('Picklist', 17, 820),
    word('Username:', 17, 800),
    word('coolslurppypowder', 96, 800),
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
    if (row.orders[0]) items.push(word(row.orders[0], 417, y))
    y -= 24
  })
  return items
}

const snap = () => db.getSnapshot()
const categoryId = snap().categories[0]?.id ?? 'cat-ice'
const mapped = db.createProduct({ name: 'Spot Check Powder', sku: '910001', categoryId, unit: 'PCS', sellingPrice: 8 })
if (!mapped) throw new Error('product missing')
db.adjustStock({ warehouseId: 'wh-main', productId: mapped.id, type: 'increase', qty: 20, reason: 'spot check test' })
const account = db.createSalesImportAccount('shopee', 'coolslurppypowder')
const batch = account ? db.createSalesImportBatch('shopee', account.id) : null
if (!batch || !account) throw new Error('batch missing')
const readyOrder = orderNo('SPOT0001')
const heldOrder = orderNo('SPOT0002')
db.ingestSalesImportPicking(batch.id, {
  fileName: 'spot.pdf',
  fileHash: 'hash-spot-check',
  items: shopeeItems([
    { name: 'Spot Powder', sku: '910001', qty: 2, orders: [readyOrder] },
    { name: 'Mystery Syrup', qty: 1, orders: [heldOrder] },
  ]),
})

function review() {
  const state = snap()
  const orders = (state.salesImportOrders ?? []).filter((order) => order.batchId === batch!.id)
  const lines = (state.salesImportLines ?? []).filter((line) => orders.some((order) => order.id === line.orderId))
  const assessment = assessSalesImport({
    account: account!,
    batch: (state.salesImportBatches ?? []).find((item) => item.id === batch!.id) ?? batch!,
    files: state.salesImportFiles ?? [],
    orders: state.salesImportOrders ?? [],
    lines: state.salesImportLines ?? [],
    products: state.products,
    takenOrderIds: new Set(),
    allowNegativeStock: state.settings.allowNegativeStock,
    availableQty: (productId) => state.inventory.find((row) => row.productId === productId && row.warehouseId === 'wh-main')?.qty ?? 0,
  })
  const summary = salesImportSummary({
    assessment,
    orders,
    lines,
    products: state.products,
    shipments: [],
    takenOrderIds: new Set(),
  })
  const samples = buildSpotSamples({ orders, lines, products: state.products, categories: state.categories })
  return { orders, lines, assessment, summary, samples, batch: (state.salesImportBatches ?? []).find((item) => item.id === batch!.id) }
}

const first = review()
for (const sample of first.samples) db.setSalesImportSpotCheck(batch.id, sample.key, true)
const remembered = review()
check('8. Checked state survives a later read of the same batch', first.samples.length === 2 && first.samples.every((sample) => (remembered.batch?.spotCheckedKeys ?? []).includes(sample.key)) && remembered.samples.map((sample) => sample.key).join('|') === first.samples.map((sample) => sample.key).join('|'), remembered.batch?.spotCheckedKeys?.join(', '))
const qtyBefore = first.lines.map((line) => line.quantity).join(',')
const qtyAfter = remembered.lines.map((line) => line.quantity).join(',')
check('11. Spot check does not change imported quantity', first.summary.importedQty === remembered.summary.importedQty && qtyBefore === qtyAfter, `${first.summary.importedQty} -> ${remembered.summary.importedQty}`)
check('12. Spot check does not change readyOrderIds', first.assessment.readyOrderIds.join('|') === remembered.assessment.readyOrderIds.join('|') && remembered.assessment.readyOrderIds.length === 1, remembered.assessment.readyOrderIds.join('|'))

const salesBefore = snap().sales.length
const posted = db.confirmSalesImport(batch.id)
const afterPost = review()
const postedAgain = db.confirmSalesImport(batch.id)
const held = afterPost.orders.find((order) => order.externalOrderId === heldOrder)
check('10. Confirm still posts once and does not duplicate because of spot check', posted.posted === 1 && postedAgain.posted === 0 && snap().sales.length === salesBefore + 1, `posted ${posted.posted} again ${postedAgain.posted}`)
check('13. Partial confirmation still leaves the blocked order unposted', held?.status !== 'confirmed' && afterPost.orders.filter((order) => order.status === 'confirmed').length === 1, held?.status)

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
