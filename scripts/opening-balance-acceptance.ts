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
const { navGroups } = await import('@/components/layout/Sidebar')
const { OpeningBalancePage } = await import('@/features/openingBalance/OpeningBalancePages')
const { OPENING_BALANCE_ORIGIN_DATE, OPENING_BALANCE_TYPES, isStockItemProduct } = await import(
  '@/features/openingBalance/openingBalanceModel'
)
const { allocateBalanceFifo } = await import('@/features/manufacturing/sessionPlan')
const { qtyToBaseUnit } = await import('@/features/products/masterData')

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function inventoryOf(productId: string, warehouseId = 'wh-main') {
  return db.getSnapshot().inventory.find((row) => row.productId === productId && row.warehouseId === warehouseId)?.qty ?? 0
}

function movementCount(reference: string, type?: string) {
  return db.getSnapshot().stockMovements.filter((row) => row.reference === reference && (!type || row.type === type)).length
}

function userById(id: string) {
  return db.getSnapshot().users.find((user) => user.id === id)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appSrc = readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
const sidebarSrc = readFileSync(path.join(root, 'src/components/layout/Sidebar.tsx'), 'utf8')

db.resetDemo()
db.switchUser('u-admin')

check('Opening Balance page exists', typeof OpeningBalancePage === 'function')
check('Opening Balance route is registered', appSrc.includes('path="/inventory/opening-balance"') && appSrc.includes('OpeningBalancePage'))
check(
  'One Opening Balance sidebar item',
  navGroups
    .find((group) => group.id === 'inventory')
    ?.items.filter((item) => item.to === '/inventory/opening-balance' && item.label === 'Opening Balance').length === 1,
)
check('Sidebar does not split opening balance by category', !/Raw Material Opening Balance|Finished Goods Opening Balance/i.test(sidebarSrc))
check(
  'Three entry types exist',
  OPENING_BALANCE_TYPES.map((item) => item.id).join(',') === 'stock_item,finished_goods,production_balance',
)

const ownerCanView = hasPermission(db.getSnapshot(), 'opening_balance.view', userById('u-aina'))
const adminCanCreate = hasPermission(db.getSnapshot(), 'opening_balance.create', userById('u-admin'))
const staffCannotView = !hasPermission(db.getSnapshot(), 'opening_balance.view', userById('u-mei'))
const staffCannotCreate = !hasPermission(db.getSnapshot(), 'opening_balance.create', userById('u-mei'))
const warehouseCannot = !hasPermission(db.getSnapshot(), 'opening_balance.create', userById('u-kumar'))
check('Owner can view Opening Balance', ownerCanView)
check('Admin can create Opening Balance', adminCanCreate)
check('Staff without permission cannot view or create', staffCannotView && staffCannotCreate)
check('Warehouse role is off by default', warehouseCannot)

db.switchUser('u-mei')
const staffBlocked = db.createOpeningBalance({
  type: 'stock_item',
  items: [{ productId: 'p-sugar', qty: 1, unit: 'KG', warehouseId: 'wh-main' }],
})
check('Staff API cannot create Opening Balance', staffBlocked === null)

db.switchUser('u-admin')
const purchasesBefore = db.getSnapshot().purchases.length
const receivingsBefore = (db.getSnapshot().receivings ?? []).length
const sessionsBefore = db.getSnapshot().productionSessions.length
const sugarBefore = inventoryOf('p-sugar')
const pouchBefore = inventoryOf('p-pouch')
const matchaBefore = inventoryOf('p-pack-mt')
const chocolatePacksBefore = inventoryOf('p-pack-ch')

const paper = db.createProduct({
  name: 'A4 Paper',
  sku: 'ST-A4-001',
  categoryId: 'cat-other',
  unit: 'PACK',
  sellingPrice: 0,
  sellable: false,
})
const blade = db.createProduct({
  name: 'Blender Blade',
  sku: 'SP-BL-001',
  categoryId: 'cat-other',
  unit: 'PCS',
  sellingPrice: 0,
  sellable: false,
})
const pouchAlu = db.createProduct({
  name: 'Aluminium Pouch',
  sku: 'PK-ALU-001',
  categoryId: 'cat-pack',
  unit: 'PCS',
  sellingPrice: 0,
  sellable: false,
})
const cocoaBag = db.createProduct({
  name: 'Cocoa Opening Bag',
  sku: 'RW-CC-BAG',
  categoryId: 'cat-ing',
  unit: 'KG',
  purchaseUnit: 'BAG',
  purchaseConversionQty: 25,
  purchaseCost: 450,
  costPrice: 18,
  sellingPrice: 0,
  sellable: false,
})
const cleaner = db.createCategory('Cleaning')
const wipe = db.createProduct({
  name: 'Cleaning Wipes',
  sku: 'CL-WP-001',
  categoryId: cleaner.id,
  unit: 'PCS',
  sellingPrice: 0,
  sellable: false,
})
check('Stationery / spare part / other stock items can be created in item master', Boolean(paper?.id && blade?.id && wipe?.id && pouchAlu?.id))

const stockDoc = db.createOpeningBalance({
  type: 'stock_item',
  notes: 'Go-live stock items',
  items: [
    { productId: 'p-sugar', qty: 100, unit: 'KG', warehouseId: 'wh-main' },
    { productId: pouchAlu!.id, qty: 5000, unit: 'PCS', warehouseId: 'wh-main' },
    { productId: paper!.id, qty: 10, unit: 'PACK', warehouseId: 'wh-main' },
    { productId: blade!.id, qty: 5, unit: 'PCS', warehouseId: 'wh-main' },
    { productId: wipe!.id, qty: 20, unit: 'PCS', warehouseId: 'wh-main' },
  ],
})
check('Stock Item type posts a confirmed document', stockDoc?.status === 'confirmed' && stockDoc.type === 'stock_item', stockDoc?.documentNo)
check('Document number uses OB- prefix', Boolean(stockDoc?.documentNo.startsWith('OB-')))
check('Multi-line Stock Item', stockDoc?.items.length === 5)
check('Raw Material item posted', inventoryOf('p-sugar') === sugarBefore + 100)
check('Packaging item posted', inventoryOf(pouchAlu!.id) === 5000)
check('Stationery item posted', inventoryOf(paper!.id) === 10)
check('Spare Part item posted', inventoryOf(blade!.id) === 5)
check('Other / future category stock item posted without module change', inventoryOf(wipe!.id) === 20)
check('Warehouse assignment stored on stock lines', stockDoc?.items.every((line) => line.warehouseId === 'wh-main') === true)
check('Stock movements use OPENING_BALANCE type', Boolean(stockDoc) && movementCount(stockDoc!.documentNo, 'opening_balance') === 5)
check('Pouch packaging seed item remains a stock item', isStockItemProduct(db.getSnapshot(), db.getSnapshot().products.find((row) => row.id === 'p-pouch')))

const pouchSeedBefore = inventoryOf('p-pouch')
const pouchShopBefore = inventoryOf('p-pouch', 'wh-shop')
const pouchSeed = db.createOpeningBalance({
  type: 'stock_item',
  items: [{ productId: 'p-pouch', qty: 40, unit: 'pcs', warehouseId: 'wh-shop' }],
})
check(
  'Existing packaging SKU can be posted to another warehouse',
  pouchSeed?.status === 'confirmed' && inventoryOf('p-pouch', 'wh-shop') === pouchShopBefore + 40,
)
check('Shop warehouse posting does not change Main Warehouse pouch qty', inventoryOf('p-pouch') === pouchSeedBefore)

const cocoaBefore = inventoryOf(cocoaBag!.id)
const converted = qtyToBaseUnit(2, 'BAG', cocoaBag!)
const cocoaDoc = db.createOpeningBalance({
  type: 'stock_item',
  items: [{ productId: cocoaBag!.id, qty: 2, unit: 'BAG', warehouseId: 'wh-main' }],
})
check('Purchase unit conversion is used', converted === 50 && cocoaDoc?.items[0]?.baseQty === 50)
check('Normalized quantity posted in base unit KG', inventoryOf(cocoaBag!.id) === cocoaBefore + 50, `${cocoaBefore} → ${inventoryOf(cocoaBag!.id)}`)
check('Base unit posting still works', cocoaDoc?.items[0]?.unit === 'BAG' && cocoaDoc.items[0].baseQty === 50)

const fgDoc = db.createOpeningBalance({
  type: 'finished_goods',
  items: [
    { productId: 'p-pack-mt', qty: 90, unit: 'packs', warehouseId: 'wh-main', locationKind: 'inventory' },
    { productId: 'p-pack-cl', qty: 12, unit: 'packs', warehouseId: 'wh-main', locationKind: 'inventory' },
    { productId: 'p-pack-ch', qty: 8, unit: 'packs', warehouseId: 'wh-main', locationKind: 'inventory' },
  ],
})
check('Finished Goods type posts', fgDoc?.status === 'confirmed' && fgDoc.type === 'finished_goods')
check('Multi-line Finished Goods', fgDoc?.items.length === 3)
check('Finished Goods posting updates inventory', inventoryOf('p-pack-mt') === matchaBefore + 90)
check(
  'Finished Goods movements are opening_balance not production_in',
  (db.getSnapshot().stockMovements ?? []).some((row) => row.reference === fgDoc?.documentNo && row.type === 'opening_balance' && row.productId === 'p-pack-mt' && row.stockIn === 90) &&
    !(db.getSnapshot().stockMovements ?? []).some((row) => row.reference === fgDoc?.documentNo && row.type === 'production_in'),
)

const pbBeforeCount = db.getSnapshot().productionBalances.length
const chocolateGramsBefore =
  db.getSnapshot().productionBalances.filter((row) => row.productId === 'p-pack-ch').reduce((sum, row) => sum + row.quantity, 0)
const pbDoc = db.createOpeningBalance({
  type: 'production_balance',
  items: [
    { productId: 'p-pack-ch', qty: 2500, unit: 'G', warehouseId: 'wh-main', container: 'BOX-02' },
    { productId: 'p-pack-mt', qty: 1800, unit: 'G', warehouseId: 'wh-main', container: 'Box 2' },
  ],
})
check('Production Balance type posts', pbDoc?.status === 'confirmed' && pbDoc.type === 'production_balance')
check('Multi-line Production Balance', pbDoc?.items.length === 2)
check('Production Balance quantity is in grams', pbDoc?.items.every((line) => line.unit === 'G' && line.baseQty === line.qty) === true)
check(
  'Production Balance posting creates storage rows',
  db.getSnapshot().productionBalances.length === pbBeforeCount + 2 &&
    db.getSnapshot().productionBalances.some((row) => row.productId === 'p-pack-ch' && row.quantity === 2500 && row.container === 'BOX-02'),
)
check(
  'Production Balance does not add finished-goods pack stock',
  inventoryOf('p-pack-ch') === chocolatePacksBefore + 8,
)
check(
  'Storage Box is preserved on the balance record',
  db.getSnapshot().productionBalances.some(
    (row) => row.productionReference === pbDoc?.documentNo && row.container === 'BOX-02' && row.productionDate === OPENING_BALANCE_ORIGIN_DATE,
  ),
)
check(
  'Production Balance movement uses production_balance_in',
  movementCount(pbDoc!.documentNo, 'production_balance_in') === 2 && movementCount(pbDoc!.documentNo, 'opening_balance') === 0,
)

const missingBox = db.createOpeningBalance({
  type: 'production_balance',
  items: [{ productId: 'p-pack-ch', qty: 100, unit: 'G', warehouseId: 'wh-main', container: '' }],
})
check('Storage Box is required', missingBox === null)

const zeroPb = db.createOpeningBalance({
  type: 'production_balance',
  items: [{ productId: 'p-pack-ch', qty: 0, unit: 'G', warehouseId: 'wh-main', container: 'Box 1' }],
})
check('Production Balance grams must be greater than 0', zeroPb === null)

const mixedPb = db.createOpeningBalance({
  type: 'production_balance',
  items: [
    { productId: 'p-pack-ch', qty: 100, unit: 'G', warehouseId: 'wh-main', container: 'Box 3' },
    { productId: 'p-pack-ch', qty: 50, unit: 'G', warehouseId: 'wh-main', container: 'Box 3' },
  ],
})
check('Does not mix the same product into one balance record', mixedPb === null)

const fifo = allocateBalanceFifo(db.getSnapshot().productionBalances, 'p-pack-mt', 150)
check(
  'FIFO consumes opening balance first',
  fifo.used[0]?.container === 'Box 2' && fifo.used[0]?.date === OPENING_BALANCE_ORIGIN_DATE && fifo.used[0]?.qty === 150,
  fifo.used.map((row) => `${row.container}:${row.qty}:${row.date}`).join(' | '),
)
const fifoCh = allocateBalanceFifo(db.getSnapshot().productionBalances, 'p-pack-ch', 100)
check(
  'Chocolate opening balance is oldest available FIFO stock',
  fifoCh.used[0]?.container === 'BOX-02' && fifoCh.used[0]?.qty === 100 && chocolateGramsBefore === 0,
)

const zeroQty = db.createOpeningBalance({
  type: 'stock_item',
  items: [{ productId: 'p-sugar', qty: 0, unit: 'KG', warehouseId: 'wh-main' }],
})
check('Invalid quantity is rejected', zeroQty === null)

const badUnit = db.createOpeningBalance({
  type: 'stock_item',
  items: [{ productId: 'p-sugar', qty: 2, unit: 'BAG', warehouseId: 'wh-main' }],
})
check('Missing purchase-unit conversion is rejected', badUnit === null)

const inactive = db.createProduct({
  name: 'Inactive Spare Belt',
  sku: 'SP-INACT',
  categoryId: 'cat-other',
  unit: 'PCS',
  sellingPrice: 0,
  sellable: false,
})
db.setProductStatus(inactive!.id, 'inactive')
const inactiveDoc = db.createOpeningBalance({
  type: 'stock_item',
  items: [{ productId: inactive!.id, qty: 1, unit: 'PCS', warehouseId: 'wh-main' }],
})
check('Inactive product is rejected', inactiveDoc === null)

const fgAsStock = db.createOpeningBalance({
  type: 'stock_item',
  items: [{ productId: 'p-pack-mt', qty: 1, unit: 'packs', warehouseId: 'wh-main' }],
})
check('Finished goods cannot be posted as Stock Item', fgAsStock === null)

const matchaNoExpiry = db.createOpeningBalance({
  type: 'finished_goods',
  items: [{ productId: 'p-pack-mt', qty: 1, unit: 'packs', warehouseId: 'wh-main' }],
})
check('Finished goods expiry is optional even when the product tracks expiry', matchaNoExpiry?.status === 'confirmed')

const stockAsFg = db.createOpeningBalance({
  type: 'finished_goods',
  items: [{ productId: 'p-sugar', qty: 1, unit: 'KG', warehouseId: 'wh-main' }],
})
check('Stock items cannot be posted as Finished Goods', stockAsFg === null)

const badWarehouse = db.createOpeningBalance({
  type: 'stock_item',
  items: [{ productId: 'p-sugar', qty: 1, unit: 'KG', warehouseId: 'missing-wh' }],
})
check('Invalid warehouse is rejected', badWarehouse === null)

const duplicateLines = db.createOpeningBalance({
  type: 'stock_item',
  items: [
    { productId: 'p-sugar', qty: 1, unit: 'KG', warehouseId: 'wh-main' },
    { productId: 'p-sugar', qty: 2, unit: 'KG', warehouseId: 'wh-main' },
  ],
})
check('Duplicate stock lines in one document are rejected', duplicateLines === null)

const draft = db.saveOpeningBalance({
  type: 'stock_item',
  items: [{ productId: 'p-sugar', qty: 3, unit: 'KG', warehouseId: 'wh-main' }],
})
check('Draft can be saved without posting stock', draft?.status === 'draft' && movementCount(draft.documentNo) === 0)
const sugarMid = inventoryOf('p-sugar')
const updated = db.updateOpeningBalance(draft!.id, {
  type: 'stock_item',
  items: [{ productId: 'p-sugar', qty: 7, unit: 'KG', warehouseId: 'wh-main' }],
})
check('Draft remains editable', updated?.status === 'draft' && updated.items[0]?.baseQty === 7 && inventoryOf('p-sugar') === sugarMid)
const confirmedDraft = db.confirmOpeningBalance(draft!.id)
check('Draft can be confirmed once', confirmedDraft === true && db.getSnapshot().openingBalances.find((row) => row.id === draft!.id)?.status === 'confirmed')
const sugarAfterDraft = inventoryOf('p-sugar')
check('Confirming draft posts inventory once', sugarAfterDraft === sugarMid + 7)

const confirmAgain = db.confirmOpeningBalance(draft!.id)
check('Duplicate confirmation is blocked', confirmAgain === false && inventoryOf('p-sugar') === sugarAfterDraft)
const locked = db.updateOpeningBalance(draft!.id, {
  type: 'stock_item',
  items: [{ productId: 'p-sugar', qty: 99, unit: 'KG', warehouseId: 'wh-main' }],
})
check('Confirmed Opening Balance cannot be silently edited', locked === null && inventoryOf('p-sugar') === sugarAfterDraft)

const movementsForDraft = movementCount(draft!.documentNo, 'opening_balance')
db.confirmOpeningBalance(draft!.id)
check('Duplicate submit does not post inventory again', movementCount(draft!.documentNo, 'opening_balance') === movementsForDraft)

const history = db.getSnapshot().openingBalances
check(
  'Opening Balance history is stored',
  history.filter((row) => row.status === 'confirmed').length >= 4 && history.every((row) => row.documentNo.startsWith('OB-')),
)
check(
  'History includes all three types',
  ['stock_item', 'finished_goods', 'production_balance'].every((type) => history.some((row) => row.type === type)),
)

const audits = db.getSnapshot().documentAuditLogs ?? []
check(
  'Audit log records created and confirmed',
  audits.some((row) => row.action === 'opening_balance_created' && row.documentNo === stockDoc?.documentNo) &&
    audits.some((row) => row.action === 'opening_balance_confirmed' && row.documentNo === stockDoc?.documentNo && row.changedBy === 'Admin'),
)

check('No Purchase created by Opening Balance', db.getSnapshot().purchases.length === purchasesBefore)
check('No Receiving created by Opening Balance', (db.getSnapshot().receivings ?? []).length === receivingsBefore)
check('No Production Session created by Opening Balance', db.getSnapshot().productionSessions.length === sessionsBefore)

const inventoryAfter = inventoryOf('p-sugar')
const secondSameSugar = db.createOpeningBalance({
  type: 'stock_item',
  items: [{ productId: paper!.id, qty: 1, unit: 'PACK', warehouseId: 'wh-main' }],
})
check('A later distinct Opening Balance still posts', secondSameSugar?.status === 'confirmed')
check('Existing inventory totals remain consistent after later posting', inventoryOf('p-sugar') === inventoryAfter)

db.switchUser('u-admin')
check(
  'Existing seed purchases / sales / POS data remain after Opening Balance',
  db.getSnapshot().purchases.length > 0 && db.getSnapshot().sales.length > 0 && db.getSnapshot().productionSessions.length === sessionsBefore,
)

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => row.name).join('\n'))
  process.exit(1)
}
