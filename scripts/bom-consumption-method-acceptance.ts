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
const { bomConsumptionMethod, bomMaterialCost, hydrateBoms } = await import('@/features/manufacturing/helpers')
const { packingBomChanged, packingLinesFromSnapshot } = await import('@/features/manufacturing/packingModel')
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

function outs(reference: string, productId: string) {
  return db.getSnapshot().stockMovements.filter(
    (row) => row.reference === reference && row.productId === productId && row.stockOut > 0,
  )
}

function addProduct(name: string, unit: string, sku: string, costPrice: number) {
  return db.createProduct({
    name,
    sku,
    categoryId: 'cat-other',
    unit,
    purchaseUnit: unit,
    purchaseConversionQty: 1,
    sellingPrice: costPrice,
    wholesalePrice: costPrice,
    costPrice,
    sellable: true,
    reorderLevel: 0,
  })
}

function addBom(
  name: string,
  productId: string,
  outputQty: number,
  outputUnit: string,
  items: Array<{ productId: string; qty: number; unit: string; wastagePct?: number; consumptionMethod?: 'AUTO' | 'MANUAL' }>,
) {
  return db.createBom({
    name,
    productId,
    outputQty,
    outputUnit,
    notes: '',
    items: items.map((item) => ({
      productId: item.productId,
      qty: item.qty,
      unit: item.unit,
      wastagePct: item.wastagePct ?? 0,
      notes: '',
      consumptionMethod: item.consumptionMethod,
    })),
  })
}

function stock(productId: string, qty: number) {
  return db.adjustStock({ warehouseId: 'wh-main', productId, type: 'increase', qty, reason: 'Consumption method test' })
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const typesSrc = readFileSync(path.join(root, 'src/types/index.ts'), 'utf8')
const bomUiSrc = readFileSync(path.join(root, 'src/features/manufacturing/BomPages.tsx'), 'utf8')
const packingModelSrc = readFileSync(path.join(root, 'src/features/manufacturing/packingModel.ts'), 'utf8')
const dbSrc = readFileSync(path.join(root, 'src/store/db.ts'), 'utf8')
const stockUsageSrc = readFileSync(path.join(root, 'src/features/inventory/ToOrderPages.tsx'), 'utf8')
const helpersSrc = readFileSync(path.join(root, 'src/features/manufacturing/helpers.ts'), 'utf8')
const masterSrc = readFileSync(path.join(root, 'src/features/products/masterData.ts'), 'utf8')

db.resetDemo()
db.switchUser('u-admin')

check(
  '1. Seed BOM items without consumptionMethod hydrate to AUTO',
  db.getSnapshot().boms.length > 0
    && db.getSnapshot().boms.every((bom) => bom.items.every((item) => bomConsumptionMethod(item) === 'AUTO')),
)
const missingHydrated = hydrateBoms([
  {
    id: 'bom-legacy',
    name: 'Legacy',
    productId: 'p-x',
    outputQty: 1,
    outputUnit: 'PCS',
    status: 'active',
    notes: '',
    items: [{ id: 'bi-1', productId: 'p-c', qty: 1, unit: 'PCS', wastagePct: 0, notes: '' }],
  },
])
check('1. hydrateBoms missing field → AUTO', missingHydrated[0].items[0].consumptionMethod === 'AUTO')

const powder = addProduct('CM Powder', 'KG', 'CM-PWD', 2)
const packaging = addProduct('CM Packaging', 'PCS', 'CM-PKG', 0.3)
const sticker = addProduct('CM Sticker', 'PCS', 'CM-STK', 0.1)
const finished = addProduct('CM Finished', 'PCS', 'CM-FG', 0)
check('Fixtures created', Boolean(powder && packaging && sticker && finished))

const bomMissing = addBom('CM Missing Method', finished!.id, 1, 'PCS', [
  { productId: powder!.id, qty: 1, unit: 'KG' },
])
check('1. New BOM without method stores AUTO', bomMissing?.items[0].consumptionMethod === 'AUTO')

const costBom = addBom('CM Cost BOM', finished!.id, 1, 'PCS', [
  { productId: powder!.id, qty: 1, unit: 'KG', consumptionMethod: 'AUTO' },
  { productId: packaging!.id, qty: 1, unit: 'PCS', consumptionMethod: 'AUTO' },
  { productId: sticker!.id, qty: 1, unit: 'PCS', consumptionMethod: 'MANUAL' },
])
const cost = costBom ? bomMaterialCost(db.getSnapshot(), costBom, 1) : 0
check('6. MANUAL component still in BOM costing', Boolean(costBom) && cost === 2.4, String(cost))

const autoOut = addProduct('CM Auto Out', 'PCS', 'CM-AOUT', 1)
const autoComp = addProduct('CM Auto Comp', 'PCS', 'CM-ACMP', 1)
const bomAuto = addBom('CM Auto BOM', autoOut!.id, 1, 'PCS', [
  { productId: autoComp!.id, qty: 2, unit: 'PCS', consumptionMethod: 'AUTO' },
])
stock(autoComp!.id, 20)
const beforeAuto = inventoryOf(autoComp!.id)
const orderAuto = db.createProductionOrder({
  productId: autoOut!.id,
  bomId: bomAuto!.id,
  warehouseId: 'wh-main',
  plannedQty: 3,
  plannedStart: '2026-09-10T08:00:00+08:00',
  plannedEnd: '2026-09-10T18:00:00+08:00',
  operator: 'Admin',
  notes: '',
})
check('2. Production order created', Boolean(orderAuto?.id) && orderAuto?.consumptions[0].consumptionMethod === 'AUTO')
check('2. Start AUTO production', Boolean(orderAuto && db.startProduction(orderAuto.id)))
check('2. Complete AUTO production', Boolean(orderAuto && db.completeProduction(orderAuto.id, { actualQty: 3, batchNo: 'CM-AUTO-1' })))
check(
  '2. AUTO component posts OUT at production completion',
  inventoryOf(autoComp!.id) === beforeAuto - 6
    && outs(orderAuto!.orderNo, autoComp!.id).length === 1
    && outs(orderAuto!.orderNo, autoComp!.id)[0].stockOut === 6,
  String(inventoryOf(autoComp!.id)),
)
check(
  '2. Finished product IN unchanged',
  db.getSnapshot().stockMovements.some(
    (row) => row.reference === orderAuto!.orderNo && row.productId === autoOut!.id && row.type === 'production_in' && row.stockIn === 3,
  ),
)

const manOut = addProduct('CM Manual Out', 'PCS', 'CM-MOUT', 1)
const manAuto = addProduct('CM Manual Auto Comp', 'PCS', 'CM-MAC', 1)
const manComp = addProduct('CM Manual Comp', 'PCS', 'CM-MMC', 1)
const bomManual = addBom('CM Manual BOM', manOut!.id, 1, 'PCS', [
  { productId: manAuto!.id, qty: 1, unit: 'PCS', consumptionMethod: 'AUTO' },
  { productId: manComp!.id, qty: 100, unit: 'PCS', consumptionMethod: 'MANUAL' },
])
stock(manAuto!.id, 10)
stock(manComp!.id, 80)
const beforeManAuto = inventoryOf(manAuto!.id)
const beforeManComp = inventoryOf(manComp!.id)
const orderMan = db.createProductionOrder({
  productId: manOut!.id,
  bomId: bomManual!.id,
  warehouseId: 'wh-main',
  plannedQty: 1,
  plannedStart: '2026-09-10T08:00:00+08:00',
  plannedEnd: '2026-09-10T18:00:00+08:00',
  operator: 'Admin',
  notes: '',
})
check('3. Start MANUAL production', Boolean(orderMan && db.startProduction(orderMan.id)))
check('3. Complete MANUAL production', Boolean(orderMan && db.completeProduction(orderMan.id, { actualQty: 1, batchNo: 'CM-MAN-1' })))
check('3. AUTO sibling still posts OUT', inventoryOf(manAuto!.id) === beforeManAuto - 1)
check(
  '3. MANUAL component does NOT post OUT at production completion',
  inventoryOf(manComp!.id) === beforeManComp && outs(orderMan!.orderNo, manComp!.id).length === 0,
  String(inventoryOf(manComp!.id)),
)
check(
  '3. Output IN still posted',
  db.getSnapshot().stockMovements.some(
    (row) => row.reference === orderMan!.orderNo && row.productId === manOut!.id && row.type === 'production_in' && row.stockIn === 1,
  ),
)

const packOut = addProduct('CM Pack Out', 'PCS', 'CM-POUT', 1)
const packAuto = addProduct('CM Pack Auto', 'PCS', 'CM-PA', 1)
const packMan = addProduct('CM Pack Manual', 'PCS', 'CM-PM', 1)
const bomPack = addBom('CM Pack BOM', packOut!.id, 1, 'PCS', [
  { productId: packAuto!.id, qty: 1, unit: 'PCS', consumptionMethod: 'AUTO' },
  { productId: packMan!.id, qty: 100, unit: 'PCS', consumptionMethod: 'MANUAL' },
])
stock(packAuto!.id, 10)
stock(packMan!.id, 5)
const beforePackAuto = inventoryOf(packAuto!.id)
const beforePackMan = inventoryOf(packMan!.id)
const createdPack = db.createPackingAssembly({
  productId: packOut!.id,
  bomId: bomPack!.id,
  warehouseId: 'wh-main',
  plannedQty: 2,
  actualQty: 2,
})
check(
  '18. Packing BOM snapshot stores consumptionMethod',
  createdPack?.bomSnapshot.items.find((item) => item.productId === packAuto!.id)?.consumptionMethod === 'AUTO'
    && createdPack?.bomSnapshot.items.find((item) => item.productId === packMan!.id)?.consumptionMethod === 'MANUAL',
)
const previewPack = packingLinesFromSnapshot(
  createdPack!.bomSnapshot,
  2,
  db.getSnapshot().products,
  db.getSnapshot().inventory,
  'wh-main',
)
const manLine = previewPack.lines.find((line) => line.productId === packMan!.id)
check(
  '5. MANUAL shortage does not block packing preview',
  manLine?.consumptionMethod === 'MANUAL' && manLine.shortage === 0 && manLine.onHand === 5 && !previewPack.hasShortage,
  JSON.stringify({ shortage: manLine?.shortage, hasShortage: previewPack.hasShortage, method: manLine?.consumptionMethod }),
)

db.updateBom(bomPack!.id, {
  name: bomPack!.name,
  productId: packOut!.id,
  outputQty: 1,
  outputUnit: 'PCS',
  notes: '',
  items: [
    { productId: packAuto!.id, qty: 1, unit: 'PCS', wastagePct: 0, notes: '', consumptionMethod: 'AUTO' },
    { productId: packMan!.id, qty: 100, unit: 'PCS', wastagePct: 0, notes: '', consumptionMethod: 'AUTO' },
  ],
})
const liveBom = db.getSnapshot().boms.find((row) => row.id === bomPack!.id)
const draftAfterEdit = db.getSnapshot().packingAssemblies.find((row) => row.id === createdPack!.id)
check(
  '19. Live BOM change does not alter saved snapshot method',
  liveBom?.items.find((item) => item.productId === packMan!.id)?.consumptionMethod === 'AUTO'
    && draftAfterEdit?.bomSnapshot.items.find((item) => item.productId === packMan!.id)?.consumptionMethod === 'MANUAL'
    && packingBomChanged(draftAfterEdit!.bomSnapshot, liveBom),
)
check('19. Confirm without acceptSnapshot blocked', !db.confirmPackingAssembly(createdPack!.id))
const confirmedPack = db.confirmPackingAssembly(createdPack!.id, { acceptSnapshot: true })
check('4. Packing confirmed using snapshot', Boolean(confirmedPack?.posted))
check(
  '4. AUTO component posts OUT at packing confirmation',
  inventoryOf(packAuto!.id) === beforePackAuto - 2 && outs(confirmedPack!.packingNo, packAuto!.id).length === 1,
)
check(
  '5. MANUAL component does NOT post OUT at packing confirmation',
  inventoryOf(packMan!.id) === beforePackMan && outs(confirmedPack!.packingNo, packMan!.id).length === 0,
  String(inventoryOf(packMan!.id)),
)
check(
  '4. Packing output IN unchanged',
  db.getSnapshot().stockMovements.some(
    (row) => row.reference === confirmedPack!.packingNo && row.productId === packOut!.id && row.type === 'production_in' && row.stockIn === 2,
  ),
)
const again = db.confirmPackingAssembly(createdPack!.id, { acceptSnapshot: true })
check(
  '20. No duplicate packing inventory posting',
  again?.posted === true
    && outs(confirmedPack!.packingNo, packAuto!.id).length === 1
    && inventoryOf(packAuto!.id) === beforePackAuto - 2
    && inventoryOf(packMan!.id) === beforePackMan,
)

const extraStock = stock(packMan!.id, 50)
const usageBefore = inventoryOf(packMan!.id)
const usage = db.recordStockUsage({
  productId: packMan!.id,
  warehouseId: 'wh-main',
  qty: 37,
  date: '2026-09-22',
  reason: 'Customer orders',
  notes: 'Actual sticker usage',
})
check('7. Manual Material Usage posts normal inventory OUT', Boolean(extraStock && usage?.id) && usage?.type === 'stock_usage' && usage.stockOut === 37)
check('8. Manual usage quantity can differ from BOM quantity', inventoryOf(packMan!.id) === usageBefore - 37, String(inventoryOf(packMan!.id)))
check('8. Did not post BOM qty 100', inventoryOf(packMan!.id) === usageBefore - 37)
check(
  '7. USE- reference and stock_usage type',
  Boolean(usage?.reference.startsWith('USE-')) && usage?.type === 'stock_usage',
)
check(
  '11. Manual usage creates audit entry',
  db.getSnapshot().documentAuditLogs.some(
    (row) => row.action === 'stock_usage_recorded' && row.documentNo === usage?.reference && row.documentType === 'stock_usage',
  ),
)

const blocked = db.recordStockUsage({ productId: packMan!.id, warehouseId: 'wh-main', qty: 9999 })
check('9. Manual usage respects negative stock policy', blocked === null && inventoryOf(packMan!.id) === usageBefore - 37)

db.switchUser('u-siti')
check('10. Cashier lacks inventory.usage', !hasPermission(db.getSnapshot(), 'inventory.usage'))
const denied = db.recordStockUsage({ productId: packMan!.id, warehouseId: 'wh-main', qty: 1 })
check('10. Manual usage respects permissions', denied === null)
db.switchUser('u-admin')

const zero = db.recordStockUsage({ productId: packMan!.id, warehouseId: 'wh-main', qty: 0 })
check('Validation: quantity must be > 0', zero === null)

check(
  'Stock Usage remains Inventory nav item',
  Boolean(navGroups.find((group) => group.id === 'inventory')?.items.some((item) => item.to === '/inventory/stock-usage')),
)
check('Types include BomConsumptionMethod', typesSrc.includes("export type BomConsumptionMethod = 'AUTO' | 'MANUAL'"))
check('BOM UI has Consumption AUTO/MANUAL select', bomUiSrc.includes('Consumption') && bomUiSrc.includes('<option value="AUTO">AUTO</option>') && bomUiSrc.includes('<option value="MANUAL">MANUAL</option>'))
check('Packing snapshot captures consumptionMethod', packingModelSrc.includes('consumptionMethod: bomConsumptionMethod(item)'))
check('Production completeSession skips MANUAL OUT', dbSrc.includes('sessionComponentIsManual(state.boms, session.items, raw.productId)'))
check('Packing posts only non-MANUAL components', dbSrc.includes("filter((line) => line.consumptionMethod !== 'MANUAL')"))
check('Costing engine still sums all BOM items', masterSrc.includes('bom.items.reduce') && !helpersSrc.includes('includeInCosting'))
check('Stock Usage reuses recordStockUsage', stockUsageSrc.includes('api.recordStockUsage') && stockUsageSrc.includes('Component / Product'))
check('No sticker-specific module', !dbSrc.includes('stickerMovement') && !typesSrc.includes('StickerItem'))

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => `FAIL  ${row.name}${row.detail ? ` — ${row.detail}` : ''}`).join('\n'))
  process.exit(1)
}
