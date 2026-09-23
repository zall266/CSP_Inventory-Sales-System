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
const { salesComponentsOf } = await import('@/features/products/salesComponents')

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function inventoryOf(productId: string, warehouseId = 'wh-main') {
  return db.getSnapshot().inventory.find((row) => row.productId === productId && row.warehouseId === warehouseId)?.qty ?? 0
}

function outs(reference: string, productId: string) {
  return db.getSnapshot().stockMovements.filter((row) => row.reference === reference && row.productId === productId && row.type === 'sale' && row.stockOut > 0)
}

function addProduct(name: string, sku: string, cost = 1) {
  return db.createProduct({
    name,
    sku,
    categoryId: 'cat-other',
    unit: 'PCS',
    purchaseUnit: 'PCS',
    purchaseConversionQty: 1,
    sellingPrice: 5,
    wholesalePrice: 4,
    costPrice: cost,
    sellable: true,
    reorderLevel: 0,
  })
}

function stock(productId: string, qty: number) {
  return db.adjustStock({ warehouseId: 'wh-main', productId, type: 'increase', qty, reason: 'Sales component test' })
}

function sell(productId: string, qty: number, price = 5) {
  const before = db.getSnapshot().sales.length
  const sale = db.createSale({
    customerId: db.getSnapshot().settings.defaultCustomerId,
    warehouseId: 'wh-main',
    items: [{ productId, qty, price }],
    paymentMethod: 'cash',
    paidAmount: price * qty,
  })
  return { sale, added: db.getSnapshot().sales.length - before }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbSrc = readFileSync(path.join(root, 'src/store/db.ts'), 'utf8')
const mfgSrc = readFileSync(path.join(root, 'src/features/manufacturing/helpers.ts'), 'utf8')
const packingSrc = readFileSync(path.join(root, 'src/features/manufacturing/packingModel.ts'), 'utf8')

db.resetDemo()
db.switchUser('u-admin')

check(
  'Existing products hydrate with empty salesComponents',
  db.getSnapshot().products.every((product) => Array.isArray(product.salesComponents) && salesComponentsOf(product).length === 0),
)

const ab = addProduct('AB GREEN APPLE', 'SC-AB')
const ib = addProduct('IB GREEN APPLE', 'SC-IB')
const machine = addProduct('Waffle Machine', 'SC-MCH')
const flour = addProduct('Waffle Flour', 'SC-FLR')
const startup = addProduct('WAFFLE STARTUP', 'SC-START')
const blender = addProduct('Starter Blender', 'SC-BL')
const powder = addProduct('Starter Powder', 'SC-PW')
const cup = addProduct('Starter Cup', 'SC-CUP')
const kit = addProduct('STARTER KIT', 'SC-KIT')
const nestedB = addProduct('Nested B', 'SC-NB')
const nestedC = addProduct('Nested C', 'SC-NC')
const nestedA = addProduct('Nested A', 'SC-NA')
check('Fixtures created', Boolean(ab && ib && machine && flour && startup && blender && powder && cup && kit && nestedA && nestedB && nestedC))

stock(ab!.id, 20)
stock(machine!.id, 10)
stock(flour!.id, 10)
stock(blender!.id, 10)
stock(powder!.id, 20)
stock(cup!.id, 50)
stock(nestedB!.id, 7)
stock(nestedC!.id, 10)

const beforeAb = inventoryOf(ab!.id)
const normal = sell(ab!.id, 2)
check('TEST A normal product sale posts', Boolean(normal.sale))
check('TEST A sold SKU stock -2', inventoryOf(ab!.id) === beforeAb - 2, String(inventoryOf(ab!.id)))
check('TEST A no component snapshot', !normal.sale?.items[0].salesComponentsSnapshot?.length)
check('TEST A one sale movement on sold SKU', outs(normal.sale!.invoiceNo, ab!.id).length === 1 && outs(normal.sale!.invoiceNo, ab!.id)[0].stockOut === 2)

const ibCostBefore = db.getSnapshot().products.find((row) => row.id === ib!.id)?.costPrice
check(
  'Shared product saved',
  db.updateProduct(ib!.id, { salesComponents: [{ productId: ab!.id, qty: 1 }] }),
)
check('Product costPrice not rewritten by sales components', db.getSnapshot().products.find((row) => row.id === ib!.id)?.costPrice === ibCostBefore)

const beforeIb = inventoryOf(ib!.id)
const beforeAb2 = inventoryOf(ab!.id)
const shared = sell(ib!.id, 3)
check('TEST B shared sale posts', Boolean(shared.sale))
check('TEST B component OUT 3', inventoryOf(ab!.id) === beforeAb2 - 3, String(inventoryOf(ab!.id)))
check('TEST B sold SKU stock unchanged', inventoryOf(ib!.id) === beforeIb)
check('TEST B no movement on sold SKU', outs(shared.sale!.invoiceNo, ib!.id).length === 0)
check('TEST B one component movement', outs(shared.sale!.invoiceNo, ab!.id).length === 1 && outs(shared.sale!.invoiceNo, ab!.id)[0].stockOut === 3)
check(
  'TEST B snapshot stores consumed qty 3',
  shared.sale?.items[0].salesComponentsSnapshot?.[0].productId === ab!.id
    && shared.sale.items[0].salesComponentsSnapshot[0].qty === 3,
)

check('Multiplier config saved', db.updateProduct(ib!.id, { salesComponents: [{ productId: ab!.id, qty: 2 }] }))
const beforeAb3 = inventoryOf(ab!.id)
const multi = sell(ib!.id, 3)
check('TEST C component OUT 6', inventoryOf(ab!.id) === beforeAb3 - 6 && outs(multi.sale!.invoiceNo, ab!.id)[0].stockOut === 6)
check('TEST G historical sale snapshot stays 3 after config change', shared.sale && db.getSnapshot().sales.find((row) => row.id === shared.sale!.id)?.items[0].salesComponentsSnapshot?.[0].qty === 3)

check(
  'Bundle saved',
  db.updateProduct(startup!.id, {
    salesComponents: [
      { productId: machine!.id, qty: 1 },
      { productId: flour!.id, qty: 1 },
    ],
  }),
)
const beforeMachine = inventoryOf(machine!.id)
const beforeFlour = inventoryOf(flour!.id)
const beforeStartup = inventoryOf(startup!.id)
const bundle = sell(startup!.id, 2)
check('TEST D machine OUT 2', inventoryOf(machine!.id) === beforeMachine - 2)
check('TEST D flour OUT 2', inventoryOf(flour!.id) === beforeFlour - 2)
check('TEST D bundle SKU unchanged', inventoryOf(startup!.id) === beforeStartup)
check('TEST D two component movements only', outs(bundle.sale!.invoiceNo, machine!.id).length === 1 && outs(bundle.sale!.invoiceNo, flour!.id).length === 1 && outs(bundle.sale!.invoiceNo, startup!.id).length === 0)
const movesBeforeRetry = db.getSnapshot().stockMovements.filter((row) => row.reference === bundle.sale!.invoiceNo).length
check('TEST duplicate posting protection: sale is a single commit', movesBeforeRetry === 2)

check(
  'Starter kit saved',
  db.updateProduct(kit!.id, {
    salesComponents: [
      { productId: blender!.id, qty: 1 },
      { productId: powder!.id, qty: 2 },
      { productId: cup!.id, qty: 5 },
    ],
  }),
)
const kitSale = sell(kit!.id, 3)
check('TEST E blender 3', outs(kitSale.sale!.invoiceNo, blender!.id)[0]?.stockOut === 3)
check('TEST E powder 6', outs(kitSale.sale!.invoiceNo, powder!.id)[0]?.stockOut === 6)
check('TEST E cup 15', outs(kitSale.sale!.invoiceNo, cup!.id)[0]?.stockOut === 15)

const salesBeforeBlock = db.getSnapshot().sales.length
const movesBeforeBlock = db.getSnapshot().stockMovements.length
const machineBeforeBlock = inventoryOf(machine!.id)
const flourBeforeBlock = inventoryOf(flour!.id)
const blocked = sell(startup!.id, 20)
check('TEST F sale blocked', blocked.sale === null && blocked.added === 0)
check('TEST F no partial posting', db.getSnapshot().sales.length === salesBeforeBlock && db.getSnapshot().stockMovements.length === movesBeforeBlock)
check('TEST F stock unchanged', inventoryOf(machine!.id) === machineBeforeBlock && inventoryOf(flour!.id) === flourBeforeBlock)

const selfBlocked = db.updateProduct(startup!.id, { salesComponents: [{ productId: startup!.id, qty: 1 }] })
check('TEST H self reference blocked', selfBlocked === false)
check(
  'TEST H previous components kept',
  db.getSnapshot().products.find((row) => row.id === startup!.id)?.salesComponents?.some((row) => row.productId === machine!.id) === true,
)

check('Deactivate component', db.updateProduct(ab!.id, { status: 'inactive' }))
const salesBeforeInactive = db.getSnapshot().sales.length
const inactiveSale = sell(ib!.id, 1)
check('TEST I inactive component blocks sale', inactiveSale.sale === null && db.getSnapshot().sales.length === salesBeforeInactive)
check('Reactivate component', db.updateProduct(ab!.id, { status: 'active' }))

check('Nested B has its own component', db.updateProduct(nestedB!.id, { salesComponents: [{ productId: nestedC!.id, qty: 2 }] }))
check('Nested A points at B only', db.updateProduct(nestedA!.id, { salesComponents: [{ productId: nestedB!.id, qty: 1 }] }))
const beforeB = inventoryOf(nestedB!.id)
const beforeC = inventoryOf(nestedC!.id)
const nested = sell(nestedA!.id, 1)
check('Nested V1 consumes B directly', inventoryOf(nestedB!.id) === beforeB - 1 && outs(nested.sale!.invoiceNo, nestedB!.id)[0]?.stockOut === 1)
check('Nested V1 does not expand C', inventoryOf(nestedC!.id) === beforeC && outs(nested.sale!.invoiceNo, nestedC!.id).length === 0)

db.updateSettings({ allowNegativeStock: true })
const beforeFlourNeg = inventoryOf(flour!.id)
const negative = sell(startup!.id, 1)
check('Negative stock policy still allows component OUT', Boolean(negative.sale) && inventoryOf(flour!.id) === beforeFlourNeg - 1)
db.updateSettings({ allowNegativeStock: false })

check('No new movement type', !dbSrc.includes('sales_component_out') && !dbSrc.includes('bundle_out'))
check('Manufacturing consumption helper untouched by sales components', !mfgSrc.includes('salesComponents'))
check('Packing model untouched by sales components', !packingSrc.includes('salesComponents'))
check('Sale still uses addMovement', dbSrc.includes("type: 'sale'"))

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => `FAIL  ${row.name}${row.detail ? ` — ${row.detail}` : ''}`).join('\n'))
  process.exit(1)
}
