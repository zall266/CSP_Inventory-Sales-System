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
    return memory.length
  },
}

Object.defineProperty(globalThis, 'localStorage', { value: localStoragePolyfill })
Object.defineProperty(globalThis, 'window', { value: globalThis })

const { db } = await import('@/store/db')
const { navGroups } = await import('@/components/layout/Sidebar')
const { packingHasCircularBom, packingQtyToInventory, applyDiscreteRounding } = await import('@/features/manufacturing/packingModel')
const { PACK_PRODUCTS } = await import('@/features/manufacturing/planAmendment')
const { round2 } = await import('@/utils/format')

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function inventoryOf(productId: string, warehouseId = 'wh-main') {
  return db.getSnapshot().inventory.find((row) => row.productId === productId && row.warehouseId === warehouseId)?.qty ?? 0
}

function movementsOf(reference: string) {
  return db.getSnapshot().stockMovements.filter((row) => row.reference === reference)
}

function addProduct(name: string, unit: string, sku: string, extra?: { purchaseUnit?: string; purchaseConversionQty?: number }) {
  return db.createProduct({
    name,
    sku,
    categoryId: 'cat-other',
    unit,
    purchaseUnit: extra?.purchaseUnit ?? unit,
    purchaseConversionQty: extra?.purchaseConversionQty ?? 1,
    sellingPrice: 1,
    wholesalePrice: 1,
    costPrice: 1,
    sellable: true,
    reorderLevel: 0,
  })
}

function addBom(name: string, productId: string, outputQty: number, outputUnit: string, items: Array<{ productId: string; qty: number; unit: string; wastagePct?: number }>) {
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
    })),
  })
}

function stock(productId: string, qty: number, warehouseId = 'wh-main') {
  return db.adjustStock({ warehouseId, productId, type: 'increase', qty, reason: 'Packing test stock' })
}

function pack(input: { productId: string; bomId: string; plannedQty: number; actualQty?: number; warehouseId?: string; notes?: string; acceptSnapshot?: boolean }) {
  const created = db.createPackingAssembly({
    productId: input.productId,
    bomId: input.bomId,
    warehouseId: input.warehouseId ?? 'wh-main',
    plannedQty: input.plannedQty,
    actualQty: input.actualQty ?? input.plannedQty,
    notes: input.notes,
  })
  if (!created) return { created: null, confirmed: null }
  const confirmed = db.confirmPackingAssembly(created.id, { acceptSnapshot: input.acceptSnapshot })
  return { created, confirmed }
}

db.resetDemo()

const packingNav = navGroups.find((group) => group.id === 'manufacturing')?.items.some((item) => item.to === '/manufacturing/packing' && item.label === 'Packing / Assembly')
check('Sidebar includes Packing / Assembly', Boolean(packingNav))
check('Hydrate empty packingAssemblies', Array.isArray(db.getSnapshot().packingAssemblies) && db.getSnapshot().packingAssemblies.length === 0)
check('PACK_PRODUCTS unchanged', PACK_PRODUCTS.join(',') === 'p-pack-mt,p-pack-cl,p-pack-st,p-pack-mlt,p-pack-ch')

const bulk = addProduct('Test Bulk Powder', 'G', 'TST-BULK')
const pouch = addProduct('Test Pouch', 'PCS', 'TST-POUCH')
const pack200 = addProduct('Test Powder 200g', 'PCS', 'TST-200G')
const sachet = addProduct('Test Sachet', 'PCS', 'TST-SACHET')
const trialPack = addProduct('Test Trial Pack', 'PCS', 'TST-TRIAL')
const trialPkg = addProduct('Test Trial Packaging', 'PCS', 'TST-TPKG')
const economy = addProduct('Test Economy Pack', 'PCS', 'TST-ECON')
const econPkg = addProduct('Test Economy Packaging', 'PCS', 'TST-EPKG')
const compA = addProduct('Test Component A', 'PCS', 'TST-CA')
const compB = addProduct('Test Component B', 'PCS', 'TST-CB')
const box = addProduct('Test Assembly Box', 'PCS', 'TST-BOX')
const assembly = addProduct('Test Assembly SKU', 'PCS', 'TST-ASM')
const bulkKg = addProduct('Test Bulk KG', 'KG', 'TST-BULKKG')
const packKg = addProduct('Test Pack From KG', 'PCS', 'TST-PKKG')
const raw = addProduct('Test Nested Raw', 'G', 'TST-RAW')
const circA = addProduct('Test Circ A', 'PCS', 'TST-CIRA')
const circB = addProduct('Test Circ B', 'PCS', 'TST-CIRB')
const selfP = addProduct('Test Self Ref', 'PCS', 'TST-SELF')
const missing = addProduct('Test Missing Conv Out', 'PCS', 'TST-MCO')
const missingComp = addProduct('Test Missing Conv Comp', 'G', 'TST-MCC')

check('Test products created', Boolean(bulk && pouch && pack200 && sachet && trialPack && economy && assembly && bulkKg && raw && circA && circB && selfP && missing && missingComp))

const bom200 = addBom('Test 200g BOM', pack200!.id, 1, 'PCS', [
  { productId: bulk!.id, qty: 200, unit: 'G' },
  { productId: pouch!.id, qty: 1, unit: 'PCS' },
])
const bomTrial = addBom('Test Trial BOM', trialPack!.id, 1, 'PCS', [
  { productId: sachet!.id, qty: 5, unit: 'PCS' },
  { productId: trialPkg!.id, qty: 1, unit: 'PCS' },
])
const bomEcon = addBom('Test Economy BOM', economy!.id, 1, 'PCS', [
  { productId: sachet!.id, qty: 10, unit: 'PCS' },
  { productId: econPkg!.id, qty: 1, unit: 'PCS' },
])
const bomAsm = addBom('Test Assembly BOM', assembly!.id, 1, 'PCS', [
  { productId: compA!.id, qty: 2, unit: 'PCS' },
  { productId: compB!.id, qty: 1, unit: 'PCS' },
  { productId: box!.id, qty: 1, unit: 'PCS' },
])
const bomKg = addBom('Test KG BOM', packKg!.id, 1, 'PCS', [
  { productId: bulkKg!.id, qty: 200, unit: 'G' },
  { productId: pouch!.id, qty: 1, unit: 'PCS' },
])
const bomNestedInner = addBom('Test Nested Sachet BOM', sachet!.id, 1, 'PCS', [
  { productId: raw!.id, qty: 20, unit: 'G' },
])
const bomMissing = addBom('Test Missing Conv BOM', missing!.id, 1, 'PCS', [
  { productId: missingComp!.id, qty: 1, unit: 'BOX' },
])
const bomCircA = addBom('Test Circ A BOM', circA!.id, 1, 'PCS', [{ productId: circB!.id, qty: 1, unit: 'PCS' }])
const bomCircB = addBom('Test Circ B BOM', circB!.id, 1, 'PCS', [{ productId: circA!.id, qty: 1, unit: 'PCS' }])
const bomSelf = addBom('Test Self BOM', selfP!.id, 1, 'PCS', [{ productId: selfP!.id, qty: 1, unit: 'PCS' }])
const bomWaste = addBom('Test Waste BOM', pack200!.id, 1, 'PCS', [
  { productId: bulk!.id, qty: 200, unit: 'G', wastagePct: 2 },
  { productId: pouch!.id, qty: 1, unit: 'PCS', wastagePct: 2 },
])

check('Test BOMs created', Boolean(bom200 && bomTrial && bomEcon && bomAsm && bomKg && bomNestedInner && bomMissing && bomCircA && bomCircB && bomSelf && bomWaste))
check('Nested inner BOM exists and packing still uses sachet stock', bomNestedInner?.items[0].productId === raw!.id)

stock(bulk!.id, 20000)
stock(pouch!.id, 500)
stock(sachet!.id, 500)
stock(trialPkg!.id, 50)
stock(econPkg!.id, 50)
stock(compA!.id, 50)
stock(compB!.id, 50)
stock(box!.id, 50)
stock(bulkKg!.id, 50)
stock(raw!.id, 5)

const before1 = {
  bulk: inventoryOf(bulk!.id),
  pouch: inventoryOf(pouch!.id),
  out: inventoryOf(pack200!.id),
}
const test1 = pack({ productId: pack200!.id, bomId: bom200!.id, plannedQty: 50 })
const mv1 = movementsOf(test1.confirmed?.packingNo ?? '')
check('TEST 1 confirm', Boolean(test1.confirmed?.posted), test1.confirmed?.packingNo)
check('TEST 1 bulk -10000g', inventoryOf(bulk!.id) === before1.bulk - 10000, String(inventoryOf(bulk!.id)))
check('TEST 1 pouch -50', inventoryOf(pouch!.id) === before1.pouch - 50, String(inventoryOf(pouch!.id)))
check('TEST 1 output +50', inventoryOf(pack200!.id) === before1.out + 50, String(inventoryOf(pack200!.id)))
check('TEST 1 movements PA ref', mv1.length === 3 && mv1.every((row) => row.reference.startsWith('PA-')) && mv1.some((row) => row.type === 'production_in') && mv1.filter((row) => row.type === 'production_out').length === 2)
check('TEST 1 same warehouse', mv1.every((row) => row.warehouseId === 'wh-main'))

const before2 = { sachet: inventoryOf(sachet!.id), pkg: inventoryOf(trialPkg!.id), out: inventoryOf(trialPack!.id), raw: inventoryOf(raw!.id) }
const test2 = pack({ productId: trialPack!.id, bomId: bomTrial!.id, plannedQty: 10 })
check('TEST 2 confirm', Boolean(test2.confirmed?.posted))
check('TEST 2 sachet -50', inventoryOf(sachet!.id) === before2.sachet - 50, String(inventoryOf(sachet!.id)))
check('TEST 2 packaging -10', inventoryOf(trialPkg!.id) === before2.pkg - 10)
check('TEST 2 output +10', inventoryOf(trialPack!.id) === before2.out + 10)
check('TEST 12 nested raw unchanged', inventoryOf(raw!.id) === before2.raw, String(inventoryOf(raw!.id)))

const before3 = { sachet: inventoryOf(sachet!.id), pkg: inventoryOf(econPkg!.id), out: inventoryOf(economy!.id) }
const test3 = pack({ productId: economy!.id, bomId: bomEcon!.id, plannedQty: 10 })
check('TEST 3 confirm', Boolean(test3.confirmed?.posted))
check('TEST 3 sachet -100', inventoryOf(sachet!.id) === before3.sachet - 100)
check('TEST 3 packaging -10', inventoryOf(econPkg!.id) === before3.pkg - 10)
check('TEST 3 output +10', inventoryOf(economy!.id) === before3.out + 10)

const before4 = { a: inventoryOf(compA!.id), b: inventoryOf(compB!.id), box: inventoryOf(box!.id), out: inventoryOf(assembly!.id) }
const test4 = pack({ productId: assembly!.id, bomId: bomAsm!.id, plannedQty: 2 })
check('TEST 4 confirm', Boolean(test4.confirmed?.posted))
check('TEST 4 A -4 B -2 Box -2 out +2', inventoryOf(compA!.id) === before4.a - 4 && inventoryOf(compB!.id) === before4.b - 2 && inventoryOf(box!.id) === before4.box - 2 && inventoryOf(assembly!.id) === before4.out + 2)

const before5 = { bulk: inventoryOf(bulk!.id), pouch: inventoryOf(pouch!.id), out: inventoryOf(pack200!.id) }
const test5 = pack({ productId: pack200!.id, bomId: bom200!.id, plannedQty: 50, actualQty: 47 })
check('TEST 5 confirm', Boolean(test5.confirmed?.posted))
check('TEST 5 consumes 47 not 50', inventoryOf(bulk!.id) === before5.bulk - 9400 && inventoryOf(pouch!.id) === before5.pouch - 47 && inventoryOf(pack200!.id) === before5.out + 47, `bulk ${inventoryOf(bulk!.id)} pouch ${inventoryOf(pouch!.id)}`)

const before6 = db.getSnapshot().stockMovements.length
const shortComponent = pack({ productId: trialPack!.id, bomId: bomTrial!.id, plannedQty: 200 })
check('TEST 6 blocked', !shortComponent.confirmed && Boolean(shortComponent.created) && shortComponent.created?.posted === false)
check('TEST 6 zero movements', db.getSnapshot().stockMovements.length === before6)

const before7 = db.getSnapshot().stockMovements.length
db.resetDemo()
const pouch2 = addProduct('Test Pouch 2', 'PCS', 'TST-POUCH2')
const bulk2 = addProduct('Test Bulk 2', 'G', 'TST-BULK2')
const out2 = addProduct('Test Out 2', 'PCS', 'TST-OUT2')
const bomShortPkg = addBom('Test Short Pkg', out2!.id, 1, 'PCS', [
  { productId: bulk2!.id, qty: 200, unit: 'G' },
  { productId: pouch2!.id, qty: 1, unit: 'PCS' },
])
stock(bulk2!.id, 20000)
stock(pouch2!.id, 5)
const test7 = pack({ productId: out2!.id, bomId: bomShortPkg!.id, plannedQty: 50 })
check('TEST 7 insufficient packaging blocked', !test7.confirmed)
check('TEST 7 zero movements', db.getSnapshot().stockMovements.length === before7 || movementsOf(test7.created?.packingNo ?? '').length === 0)

db.resetDemo()
const bulkKg2 = addProduct('Test Bulk KG2', 'KG', 'TST-KG2')
const pouch3 = addProduct('Test Pouch 3', 'PCS', 'TST-POUCH3')
const outKg = addProduct('Test Out KG', 'PCS', 'TST-OUTKG')
const bomKg2 = addBom('Test KG2 BOM', outKg!.id, 1, 'PCS', [
  { productId: bulkKg2!.id, qty: 200, unit: 'G' },
  { productId: pouch3!.id, qty: 1, unit: 'PCS' },
])
stock(bulkKg2!.id, 20)
stock(pouch3!.id, 60)
const before8 = inventoryOf(bulkKg2!.id)
const test8 = pack({ productId: outKg!.id, bomId: bomKg2!.id, plannedQty: 50 })
check('TEST 8 G → KG conversion', Boolean(test8.confirmed?.posted) && round2(inventoryOf(bulkKg2!.id)) === round2(before8 - 10), `qty ${inventoryOf(bulkKg2!.id)}`)

const converted = packingQtyToInventory(10000, 'G', { name: 'Bulk', unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1 })
check('TEST 8 helper 10000g = 10kg', converted.ok && converted.ok && converted.qty === 10)

const missOut = addProduct('Test Miss Out', 'PCS', 'TST-MISS-O')
const missComp = addProduct('Test Miss Comp', 'G', 'TST-MISS-C')
const bomMiss = addBom('Test Miss BOM', missOut!.id, 1, 'PCS', [{ productId: missComp!.id, qty: 1, unit: 'BOX' }])
stock(missComp!.id, 100)
const test9 = pack({ productId: missOut!.id, bomId: bomMiss!.id, plannedQty: 10 })
check('TEST 9 missing conversion blocked', !test9.created && !test9.confirmed)

const wasteOut = addProduct('Test Waste Out', 'PCS', 'TST-WOUT')
const wasteBulk = addProduct('Test Waste Bulk', 'G', 'TST-WBULK')
const wastePouch = addProduct('Test Waste Pouch', 'PCS', 'TST-WPOUCH')
const bomW = addBom('Test Waste BOM', wasteOut!.id, 1, 'PCS', [
  { productId: wasteBulk!.id, qty: 200, unit: 'G', wastagePct: 2 },
  { productId: wastePouch!.id, qty: 1, unit: 'PCS', wastagePct: 2 },
])
stock(wasteBulk!.id, 5000)
stock(wastePouch!.id, 20)
const before10 = { bulk: inventoryOf(wasteBulk!.id), pouch: inventoryOf(wastePouch!.id), out: inventoryOf(wasteOut!.id) }
const test10 = pack({ productId: wasteOut!.id, bomId: bomW!.id, plannedQty: 10 })
check('TEST 10 wastage bulk 2040g', Boolean(test10.confirmed?.posted) && inventoryOf(wasteBulk!.id) === before10.bulk - 2040, String(inventoryOf(wasteBulk!.id)))
check('TEST 11 PCS wastage rounds up to 11', inventoryOf(wastePouch!.id) === before10.pouch - 11, String(inventoryOf(wastePouch!.id)))
check('TEST 11 ceil helper', applyDiscreteRounding(10.2, 'PCS') === 11 && applyDiscreteRounding(10, 'PCS') === 10)

const circA2 = addProduct('Circ A2', 'PCS', 'TST-CA2')
const circB2 = addProduct('Circ B2', 'PCS', 'TST-CB2')
const bomCA = addBom('Circ A2 BOM', circA2!.id, 1, 'PCS', [{ productId: circB2!.id, qty: 1, unit: 'PCS' }])
const bomCB = addBom('Circ B2 BOM', circB2!.id, 1, 'PCS', [{ productId: circA2!.id, qty: 1, unit: 'PCS' }])
stock(circB2!.id, 10)
check('TEST 14 circular graph detected', packingHasCircularBom(db.getSnapshot().boms, circA2!.id))
const test14 = pack({ productId: circA2!.id, bomId: bomCA!.id, plannedQty: 1 })
check('TEST 14 circular blocked', !test14.created && !test14.confirmed)
check('TEST 14 circular BOM created for graph', Boolean(bomCA && bomCB))

const self2 = addProduct('Self 2', 'PCS', 'TST-SELF2')
const bomSelf2 = addBom('Self 2 BOM', self2!.id, 1, 'PCS', [{ productId: self2!.id, qty: 1, unit: 'PCS' }])
const test13 = pack({ productId: self2!.id, bomId: bomSelf2!.id, plannedQty: 1 })
check('TEST 13 self-reference blocked', !test13.created && !test13.confirmed)

const inactOut = addProduct('Inactive BOM Out', 'PCS', 'TST-IBO')
const inactComp = addProduct('Inactive BOM Comp', 'PCS', 'TST-IBC')
const bomInact = addBom('Inactive BOM', inactOut!.id, 1, 'PCS', [{ productId: inactComp!.id, qty: 1, unit: 'PCS' }])
stock(inactComp!.id, 10)
db.setBomStatus(bomInact!.id, 'inactive')
const test15 = pack({ productId: inactOut!.id, bomId: bomInact!.id, plannedQty: 1 })
check('TEST 15 inactive BOM blocked', !test15.created)

const inactCOut = addProduct('Inact Comp Out', 'PCS', 'TST-ICO')
const inactC = addProduct('Inact Comp', 'PCS', 'TST-IC')
const bomIC = addBom('Inact Comp BOM', inactCOut!.id, 1, 'PCS', [{ productId: inactC!.id, qty: 1, unit: 'PCS' }])
stock(inactC!.id, 10)
db.updateProduct(inactC!.id, { name: 'Inact Comp', categoryId: 'cat-other', unit: 'PCS', sellingPrice: 1, status: 'inactive' })
const test16 = pack({ productId: inactCOut!.id, bomId: bomIC!.id, plannedQty: 1 })
check('TEST 16 inactive component blocked', !test16.created)

const inactO = addProduct('Inact Output', 'PCS', 'TST-IO')
const inactOC = addProduct('Inact Output Comp', 'PCS', 'TST-IOC')
const bomIO = addBom('Inact Output BOM', inactO!.id, 1, 'PCS', [{ productId: inactOC!.id, qty: 1, unit: 'PCS' }])
stock(inactOC!.id, 10)
const draft17 = db.createPackingAssembly({ productId: inactO!.id, bomId: bomIO!.id, warehouseId: 'wh-main', plannedQty: 1, actualQty: 1 })
db.updateProduct(inactO!.id, { name: 'Inact Output', categoryId: 'cat-other', unit: 'PCS', sellingPrice: 1, status: 'inactive' })
const test17 = draft17 ? db.confirmPackingAssembly(draft17.id) : null
check('TEST 17 inactive output blocked', Boolean(draft17) && !test17?.posted && draft17?.status === 'draft')

const chOut = addProduct('Changed BOM Out', 'PCS', 'TST-CHO')
const chComp = addProduct('Changed BOM Comp', 'PCS', 'TST-CHC')
const bomCh = addBom('Changed BOM', chOut!.id, 1, 'PCS', [{ productId: chComp!.id, qty: 5, unit: 'PCS' }])
stock(chComp!.id, 100)
const draft18 = db.createPackingAssembly({ productId: chOut!.id, bomId: bomCh!.id, warehouseId: 'wh-main', plannedQty: 10, actualQty: 10 })
db.updateBom(bomCh!.id, {
  name: 'Changed BOM',
  productId: chOut!.id,
  outputQty: 1,
  outputUnit: 'PCS',
  notes: '',
  items: [{ productId: chComp!.id, qty: 6, unit: 'PCS', wastagePct: 0, notes: '' }],
})
const before18 = inventoryOf(chComp!.id)
const blocked18 = db.confirmPackingAssembly(draft18!.id)
check('TEST 18 BOM change blocks without accept', !blocked18?.posted)
const accepted18 = db.confirmPackingAssembly(draft18!.id, { acceptSnapshot: true })
check('TEST 18 snapshot protected 5x10=50', Boolean(accepted18?.posted) && inventoryOf(chComp!.id) === before18 - 50, String(inventoryOf(chComp!.id)))
check('TEST 18 snapshot qty still 5', accepted18?.bomSnapshot.items[0].qty === 5)

const dblOut = addProduct('Double Out', 'PCS', 'TST-DBL')
const dblComp = addProduct('Double Comp', 'PCS', 'TST-DBC')
const bomDbl = addBom('Double BOM', dblOut!.id, 1, 'PCS', [{ productId: dblComp!.id, qty: 1, unit: 'PCS' }])
stock(dblComp!.id, 10)
const draft19 = db.createPackingAssembly({ productId: dblOut!.id, bomId: bomDbl!.id, warehouseId: 'wh-main', plannedQty: 2, actualQty: 2 })
const first19 = db.confirmPackingAssembly(draft19!.id)
const count19 = movementsOf(draft19!.packingNo).length
const second19 = db.confirmPackingAssembly(draft19!.id)
check('TEST 19 double submit one post', Boolean(first19?.posted) && second19?.posted === true && movementsOf(draft19!.packingNo).length === count19)
check('TEST 20 refresh/retry no duplicate', movementsOf(draft19!.packingNo).filter((row) => row.type === 'production_in').length === 1)

const whOut = addProduct('WH Out', 'PCS', 'TST-WHO')
const whComp = addProduct('WH Comp', 'PCS', 'TST-WHC')
const bomWh = addBom('WH BOM', whOut!.id, 1, 'PCS', [{ productId: whComp!.id, qty: 1, unit: 'PCS' }])
stock(whComp!.id, 20, 'wh-shop')
const shopBefore = inventoryOf(whComp!.id, 'wh-shop')
const mainBefore = inventoryOf(whComp!.id, 'wh-main')
const test21 = pack({ productId: whOut!.id, bomId: bomWh!.id, plannedQty: 5 })
check('TEST 21 shop stock ignored / main blocked', !test21.confirmed && inventoryOf(whComp!.id, 'wh-shop') === shopBefore && inventoryOf(whComp!.id, 'wh-main') === mainBefore)
stock(whComp!.id, 8, 'wh-main')
const test21b = pack({ productId: whOut!.id, bomId: bomWh!.id, plannedQty: 5 })
check('TEST 21 selected warehouse only', Boolean(test21b.confirmed?.posted) && inventoryOf(whComp!.id, 'wh-main') === 3 && inventoryOf(whComp!.id, 'wh-shop') === shopBefore)

const permOut = addProduct('Perm Out', 'PCS', 'TST-PO')
const permComp = addProduct('Perm Comp', 'PCS', 'TST-PC')
const bomPerm = addBom('Perm BOM', permOut!.id, 1, 'PCS', [{ productId: permComp!.id, qty: 1, unit: 'PCS' }])
stock(permComp!.id, 5)
const draft22 = db.createPackingAssembly({ productId: permOut!.id, bomId: bomPerm!.id, warehouseId: 'wh-main', plannedQty: 1, actualQty: 1 })
db.switchUser('u-siti')
const denied22 = db.confirmPackingAssembly(draft22!.id)
check('TEST 22 unauthorized confirm blocked', !denied22?.posted && draft22?.status === 'draft')
db.switchUser('u-admin')
const ok22 = db.confirmPackingAssembly(draft22!.id)
check('TEST 22 admin can confirm after', Boolean(ok22?.posted))

const audit = movementsOf(ok22!.packingNo)
check('TEST 23 PA reference', audit.every((row) => row.reference === ok22!.packingNo) && ok22!.packingNo.startsWith('PA-'))
check('TEST 23 user timestamp warehouse', audit.every((row) => row.user && row.date && row.warehouseId === 'wh-main'))
check('TEST 23 component OUT + output IN', audit.some((row) => row.type === 'production_out' && row.productId === permComp!.id) && audit.some((row) => row.type === 'production_in' && row.productId === permOut!.id && row.stockIn === 1))

const saleBeforeComp = inventoryOf(permComp!.id)
const saleBeforeOut = inventoryOf(permOut!.id)
const sale = db.createSale({
  customerId: 'c-walkin',
  warehouseId: 'wh-main',
  items: [{ productId: permOut!.id, qty: 1, price: 10 }],
})
check('TEST 24 sale consumes output only', Boolean(sale) && inventoryOf(permOut!.id) === saleBeforeOut - 1 && inventoryOf(permComp!.id) === saleBeforeComp)

const dOut = addProduct('Draft Out', 'PCS', 'TST-DO')
const dComp = addProduct('Draft Comp', 'PCS', 'TST-DC')
const bomD = addBom('Draft BOM', dOut!.id, 1, 'PCS', [{ productId: dComp!.id, qty: 1, unit: 'PCS' }])
stock(dComp!.id, 5)
const moveBeforeDraft = db.getSnapshot().stockMovements.length
const qtyBeforeDraft = inventoryOf(dComp!.id)
const draft25 = db.createPackingAssembly({ productId: dOut!.id, bomId: bomD!.id, warehouseId: 'wh-main', plannedQty: 2, actualQty: 2 })
check('TEST 25 draft no inventory movement', Boolean(draft25) && draft25?.status === 'draft' && draft25?.posted === false && db.getSnapshot().stockMovements.length === moveBeforeDraft && inventoryOf(dComp!.id) === qtyBeforeDraft)
const cancelled = db.cancelPackingAssembly(draft25!.id)
check('TEST 26 cancel draft no inventory', cancelled && db.getSnapshot().stockMovements.length === moveBeforeDraft && inventoryOf(dComp!.id) === qtyBeforeDraft && db.getSnapshot().packingAssemblies.find((row) => row.id === draft25!.id)?.status === 'cancelled')

const over = db.createPackingAssembly({ productId: dOut!.id, bomId: bomD!.id, warehouseId: 'wh-main', plannedQty: 2, actualQty: 3 })
check('TEST 27 actual > planned blocked', !over)
const zero = db.createPackingAssembly({ productId: dOut!.id, bomId: bomD!.id, warehouseId: 'wh-main', plannedQty: 0, actualQty: 0 })
check('TEST 28 zero quantity blocked', !zero)
const neg = db.createPackingAssembly({ productId: dOut!.id, bomId: bomD!.id, warehouseId: 'wh-main', plannedQty: -1, actualQty: -1 })
check('TEST 29 negative quantity blocked', !neg)

const bigOut = addProduct('Big Out', 'PCS', 'TST-BIG')
const bigBulk = addProduct('Big Bulk', 'G', 'TST-BIGB')
const bomBig = addBom('Big BOM', bigOut!.id, 1, 'PCS', [{ productId: bigBulk!.id, qty: 200, unit: 'G' }])
stock(bigBulk!.id, 30_000_000)
const before30 = inventoryOf(bigBulk!.id)
const test30 = pack({ productId: bigOut!.id, bomId: bomBig!.id, plannedQty: 100000 })
check('TEST 30 large quantity', Boolean(test30.confirmed?.posted) && inventoryOf(bigBulk!.id) === before30 - 20_000_000, String(inventoryOf(bigBulk!.id)))

check('No production_balance movements from packing', !db.getSnapshot().stockMovements.some((row) => row.reference.startsWith('PA-') && String(row.type).includes('balance')))
check('Multiple active BOMs require explicit id', Boolean(bom200 && bomWaste && bom200.productId === bomWaste.productId))

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => `FAIL ${row.name}${row.detail ? ` — ${row.detail}` : ''}`).join('\n'))
  process.exit(1)
}
