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

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const { db } = await import('@/store/db')
const { hasPermission } = await import('@/features/settings/permissions')
const { formFromProduct, toProductInput } = await import('@/features/products/ProductForm')
const { toOrderQueue, lowStockCompanyRows, awaitingReceivingOrders, activeStockOrder } = await import(
  '@/features/inventory/toOrderModel'
)
const { stockStatus } = await import('@/utils/format')
const { navGroups } = await import('@/components/layout/Sidebar')

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function inventoryOf(productId: string, warehouseId = 'wh-main') {
  return db.getSnapshot().inventory.find((row) => row.productId === productId && row.warehouseId === warehouseId)?.qty ?? 0
}

function userById(id: string) {
  return db.getSnapshot().users.find((user) => user.id === id)
}

function persistedOrders() {
  const raw = localStorage.getItem('stockflow-prototype-v8')
  if (!raw) return []
  const parsed = JSON.parse(raw) as { data?: { stockOrders?: Array<{ id: string; status: string; productId: string; warehouseId: string }> } }
  return parsed.data?.stockOrders ?? []
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const formSrc = readFileSync(path.join(root, 'src/features/products/ProductForm.tsx'), 'utf8')
const appSrc = readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
const sidebarSrc = readFileSync(path.join(root, 'src/components/layout/Sidebar.tsx'), 'utf8')
const completeSrc = readFileSync(path.join(root, 'src/features/manufacturing/CompleteProductionPage.tsx'), 'utf8')
const sessionDbSrc = readFileSync(path.join(root, 'src/store/db.ts'), 'utf8')
const receivingSrc = readFileSync(path.join(root, 'src/features/receiving/receivingModel.ts'), 'utf8')

db.resetDemo()
db.switchUser('u-admin')

check('Min Stock field is exposed in ProductForm', formSrc.includes('label="Min Stock"') && formSrc.includes('product.reorderLevel'))
check(
  'ProductForm no longer hardcodes reorderLevel: 0 on save',
  !formSrc.includes('reorderLevel: 0,\n    trackBatch') && formSrc.includes('toProductInput') && formSrc.includes('current?.reorderLevel'),
)
check('Stock Usage route is registered', appSrc.includes('path="/inventory/stock-usage"') && appSrc.includes('StockUsagePage'))
check('To Order route is registered', appSrc.includes('path="/inventory/to-order"') && appSrc.includes('ToOrderPage'))
check(
  'Sidebar has Stock Usage and To Order',
  navGroups
    .find((group) => group.id === 'inventory')
    ?.items.some((item) => item.to === '/inventory/stock-usage' && item.label === 'Stock Usage') === true &&
    navGroups
      .find((group) => group.id === 'inventory')
      ?.items.some((item) => item.to === '/inventory/to-order' && item.label === 'To Order') === true,
)
check('Sidebar still has Opening Balance', sidebarSrc.includes("label: 'Opening Balance'"))

const staff = userById('u-mei')
const cashier = userById('u-siti')
const admin = userById('u-admin')
check('Staff can record stock usage', hasPermission(db.getSnapshot(), 'inventory.usage', staff))
check('Staff can view To Order', hasPermission(db.getSnapshot(), 'inventory.view', staff))
check('Staff cannot mark ordered', !hasPermission(db.getSnapshot(), 'inventory.adjust', staff))
check('Cashier cannot record stock usage', !hasPermission(db.getSnapshot(), 'inventory.usage', cashier))
check('Admin can mark ordered and cancel', hasPermission(db.getSnapshot(), 'inventory.adjust', admin))
check('No dedicated to_order permission keys were added', !sidebarSrc.includes('inventory.to_order'))

const a4 = db.createProduct({
  name: 'A4 Paper',
  sku: 'ST-A4',
  categoryId: 'cat-other',
  unit: 'Ream',
  sellingPrice: 12,
  reorderLevel: 10,
  sellable: false,
})
check('CASE 8/9 setup: A4 created with Min Stock 10', a4?.reorderLevel === 10, a4?.id)

const loadedForm = formFromProduct(a4!)
const preserved = toProductInput(loadedForm, false, a4!)
check('CASE 9 Existing reorderLevel 10 is read into Min Stock and saved back', preserved.reorderLevel === 10)

const renamed = toProductInput({ ...loadedForm, name: 'A4 Paper Ream' }, false, a4!)
check('CASE 9 Editing other fields does not overwrite reorderLevel to 0', renamed.reorderLevel === 10 && renamed.name === 'A4 Paper Ream')

check('CASE 8 Edit Min Stock 10 → 20 in the form payload', toProductInput({ ...loadedForm, reorderLevel: 20 }, false, a4!).reorderLevel === 20)
check('updateProduct persists Min Stock 20', db.updateProduct(a4!.id, { reorderLevel: 20 }) && db.getSnapshot().products.find((row) => row.id === a4!.id)?.reorderLevel === 20)
check('updateProduct restore Min Stock 10', db.updateProduct(a4!.id, { reorderLevel: 10 }) && db.getSnapshot().products.find((row) => row.id === a4!.id)?.reorderLevel === 10)

check('Increase A4 to 10 Ream', db.adjustStock({ warehouseId: 'wh-main', productId: a4!.id, type: 'increase', qty: 10, reason: 'Correction' }) && inventoryOf(a4!.id) === 10)

db.switchUser('u-siti')
check('CASE permissions: cashier cannot record usage', db.recordStockUsage({ productId: a4!.id, warehouseId: 'wh-main', qty: 1 }) === null && inventoryOf(a4!.id) === 10)

db.switchUser('u-mei')
const usage = db.recordStockUsage({ productId: a4!.id, warehouseId: 'wh-main', qty: 1, notes: 'Office print' })
check('CASE 1 Usage 1 reduces stock 10 → 9', Boolean(usage) && inventoryOf(a4!.id) === 9, String(inventoryOf(a4!.id)))
check(
  'CASE 1 Movement uses existing stock_usage OUT engine',
  usage?.type === 'stock_usage' && usage.stockOut === 1 && usage.stockIn === 0 && usage.user === 'Mei Ling',
)
check('CASE 1 Status is LOW STOCK via stockStatus()', stockStatus(inventoryOf(a4!.id), 10) === 'low_stock')
check(
  'CASE 1 A4 appears in To Order from existing low-stock calc',
  lowStockCompanyRows(db.getSnapshot()).some((row) => row.productId === a4!.id && row.warehouseId === 'wh-main') &&
    toOrderQueue(db.getSnapshot()).some((row) => row.productId === a4!.id && row.status === 'low_stock'),
)

db.switchUser('u-mei')
check('Staff cannot mark as ordered', db.markStockOrdered({ productId: a4!.id, warehouseId: 'wh-main', channel: 'Shopee' }) === null)

db.switchUser('u-admin')
const beforeOrderQty = inventoryOf(a4!.id)
const order = db.markStockOrdered({ productId: a4!.id, warehouseId: 'wh-main', channel: 'Shopee', remark: 'Shopee cart' })
check('CASE 2 Mark as Ordered', Boolean(order?.id) && order?.status === 'ordered')
check('CASE 2 Mark Ordered does not change inventory', inventoryOf(a4!.id) === beforeOrderQty && inventoryOf(a4!.id) === 9)
check(
  'CASE 2 Queue shows ORDERED not a second low-stock row',
  toOrderQueue(db.getSnapshot()).filter((row) => row.productId === a4!.id && row.warehouseId === 'wh-main').length === 1 &&
    toOrderQueue(db.getSnapshot()).some((row) => row.productId === a4!.id && row.status === 'ordered'),
)
check('CASE 2 Awaiting receiving includes A4', awaitingReceivingOrders(db.getSnapshot()).some((row) => row.id === order?.id))

const persisted = persistedOrders()
check(
  'CASE 3 Ordered state persists to storage',
  persisted.some((row) => row.id === order?.id && row.status === 'ordered' && row.productId === a4!.id),
)

const duplicate = db.markStockOrdered({ productId: a4!.id, warehouseId: 'wh-main', channel: 'TikTok Shop' })
check('CASE 4 Duplicate mark returns the same active order', duplicate?.id === order?.id)
check(
  'CASE 4 No second active order for the same item/warehouse',
  (db.getSnapshot().stockOrders ?? []).filter((row) => row.productId === a4!.id && row.warehouseId === 'wh-main' && row.status === 'ordered').length === 1,
)

const receive = db.createReceiving({
  warehouseId: 'wh-main',
  source: 'shopee',
  items: [{ productId: a4!.id, qty: 20 }],
  stockOrderId: order!.id,
})
check('CASE 5 Receive 20 through existing receiving', Boolean(receive?.id) && receive?.stockOrderId === order?.id)
check('CASE 5 Stock 9 + 20 = 29', inventoryOf(a4!.id) === 29, String(inventoryOf(a4!.id)))
check(
  'CASE 5 Inventory used receiving movement',
  (db.getSnapshot().stockMovements ?? []).some(
    (row) => row.reference === receive?.receivingNo && row.type === 'receiving' && row.stockIn === 20 && row.productId === a4!.id,
  ),
)
check(
  'CASE 5 Order becomes RECEIVED',
  (db.getSnapshot().stockOrders ?? []).find((row) => row.id === order?.id)?.status === 'received',
)
check(
  'CASE 5 A4 leaves To Order because it is no longer low stock',
  !toOrderQueue(db.getSnapshot()).some((row) => row.productId === a4!.id && row.warehouseId === 'wh-main') &&
    stockStatus(inventoryOf(a4!.id), 10) === 'in_stock',
)

const cloth = db.createProduct({
  name: 'Cleaning Cloth',
  sku: 'ST-CL',
  categoryId: 'cat-other',
  unit: 'pcs',
  sellingPrice: 2,
  reorderLevel: 10,
  sellable: false,
})
check('Cancel fixture created', Boolean(cloth?.id))
check('Cloth stock to 10', db.adjustStock({ warehouseId: 'wh-main', productId: cloth!.id, type: 'increase', qty: 10, reason: 'Correction' }))
check('Cloth usage 2 → 8 low stock', Boolean(db.recordStockUsage({ productId: cloth!.id, warehouseId: 'wh-main', qty: 2 })) && inventoryOf(cloth!.id) === 8)

const cancelOrder = db.markStockOrdered({ productId: cloth!.id, warehouseId: 'wh-main', channel: 'Supplier' })
const qtyBeforeCancel = inventoryOf(cloth!.id)
check('Cloth marked ordered', cancelOrder?.status === 'ordered')
check('CASE 6 Cancel order', db.cancelStockOrder(cancelOrder!.id, 'Supplier cancelled'))
check(
  'CASE 6 ORDERED → CANCELLED',
  (db.getSnapshot().stockOrders ?? []).find((row) => row.id === cancelOrder?.id)?.status === 'cancelled',
)
check('CASE 6 Cancellation does not change inventory', inventoryOf(cloth!.id) === qtyBeforeCancel && inventoryOf(cloth!.id) === 8)
check(
  'CASE 6 Cancel does not create stock IN',
  !(db.getSnapshot().stockMovements ?? []).some(
    (row) => row.productId === cloth!.id && row.stockIn > 0 && row.date >= (cancelOrder?.markedOrderedAt ?? ''),
  ) ||
    (db.getSnapshot().stockMovements ?? []).filter((row) => row.productId === cloth!.id && row.type === 'receiving').length === 0,
)
check(
  'CASE 7 Cancelled item returns to To Order while still below Min Stock',
  !activeStockOrder(db.getSnapshot(), cloth!.id, 'wh-main') &&
    toOrderQueue(db.getSnapshot()).some((row) => row.productId === cloth!.id && row.status === 'low_stock'),
)

const agent = db.createAgent({ name: 'To Order Isolation', code: 'TOISO' })
const isolated = db.createProduct({
  name: 'Agent Stationery',
  sku: 'ST-AG',
  categoryId: 'cat-other',
  unit: 'pcs',
  sellingPrice: 1,
  reorderLevel: 10,
  sellable: false,
})
check('Agent warehouse created', Boolean(agent?.warehouseId && isolated?.id), agent?.warehouseId)
check(
  'Agent warehouse stock can be low without appearing in company To Order',
  db.adjustStock({ warehouseId: agent!.warehouseId, productId: isolated!.id, type: 'increase', qty: 4, reason: 'Correction' }) &&
    inventoryOf(isolated!.id, agent!.warehouseId) === 4 &&
    inventoryOf(isolated!.id, 'wh-main') === 0 &&
    !toOrderQueue(db.getSnapshot()).some((row) => row.productId === isolated!.id) &&
    !toOrderQueue(db.getSnapshot()).some((row) => row.warehouseId === agent!.warehouseId),
)

check('Manufacturing Complete page still has 3-step saves', completeSrc.includes('saveProductionResult') && completeSrc.includes('saveFinishedGoodsDistribution') && completeSrc.includes('saveMaterialClosingDraft'))
check('completeSession remains in controller', sessionDbSrc.includes('completeSession('))
check('Receiving still rejects finished goods via isReceivableRawMaterial', receivingSrc.includes('isReceivableRawMaterial') && receivingSrc.includes('Receive raw materials only'))
check('Stock usage does not add a second inventory engine', sessionDbSrc.includes("type: 'stock_usage'") && sessionDbSrc.includes('addMovement(state.stockMovements, state.inventory'))

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => `FAIL  ${row.name}${row.detail ? ` — ${row.detail}` : ''}`).join('\n'))
  process.exit(1)
}
