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

const { db } = await import('@/store/db')
const {
  baseUnitCost,
  bomLineCost,
  qtyToBaseUnit,
  validatePurchaseConversion,
} = await import('@/features/products/masterData')

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function eq(actual: unknown, expected: unknown) {
  return Object.is(actual, expected) || actual === expected
}

db.resetDemo()
const categoryId = db.getSnapshot().categories.find((row) => row.id === 'cat-ice')?.id ?? db.getSnapshot().categories[0].id

const matchaManual = db.createProduct({
  name: 'Matcha',
  sku: 'ABC-001',
  categoryId,
  unit: 'PCS',
  sellingPrice: 12,
  costPrice: 5,
})
check('TEST 1 manual SKU ABC-001', matchaManual?.sku === 'ABC-001', matchaManual?.sku)

const autoOne = db.createProduct({
  name: 'Matcha Ice Blended',
  sku: '',
  categoryId,
  unit: 'PCS',
  sellingPrice: 10,
  costPrice: 4,
})
check('TEST 2 empty SKU is 6 digits', Boolean(autoOne && /^\d{6}$/.test(autoOne.sku)), autoOne?.sku)
check('TEST 2 empty SKU is 100001-style numeric', autoOne?.sku === '100001', autoOne?.sku)

const autoTwo = db.createProduct({
  name: 'Chocolate Ice Blended',
  sku: '',
  categoryId,
  unit: 'PCS',
  sellingPrice: 10,
  costPrice: 4,
})
check('TEST 3 second auto SKU is different 6-digit', Boolean(autoTwo && /^\d{6}$/.test(autoTwo.sku) && autoTwo.sku !== autoOne?.sku), `${autoOne?.sku} vs ${autoTwo?.sku}`)

const duplicate = db.createProduct({
  name: 'Duplicate SKU',
  sku: 'ABC-001',
  categoryId,
  unit: 'PCS',
  sellingPrice: 1,
  costPrice: 1,
})
check('TEST 4 duplicate manual SKU blocked', duplicate === null)

const cho = db.createProduct({
  name: 'Chocolate Ice Blended CHO',
  sku: 'CHO-01',
  categoryId,
  unit: 'PCS',
  sellingPrice: 9,
  costPrice: 3,
})
check('CHO-01 kept as-is', cho?.sku === 'CHO-01', cho?.sku)

const cocoa = db.createProduct({
  name: 'Cocoa Powder Test',
  sku: 'COCOA-TEST',
  categoryId: 'cat-ing',
  unit: 'KG',
  purchaseUnit: 'BAG',
  purchaseConversionQty: 25,
  purchaseCost: 980,
  sellingPrice: 50,
})
check('TEST 5 cocoa base cost RM39.20/KG', cocoa?.costPrice === 39.2 && baseUnitCost(cocoa!) === 39.2, String(cocoa?.costPrice))

const cocoaLine = bomLineCost(
  [cocoa!],
  { productId: cocoa!.id, qty: 500, unit: 'G' },
  false,
)
check('TEST 6 BOM 500G cocoa = RM19.60', eq(Number(cocoaLine.toFixed(2)), 19.6), String(cocoaLine))

const cup = db.createProduct({
  name: 'Cup Test',
  sku: 'CUP-TEST',
  categoryId: 'cat-pack',
  unit: 'PCS',
  purchaseUnit: 'CARTON',
  purchaseConversionQty: 100,
  purchaseCost: 50,
  sellingPrice: 1,
})
check('TEST 7 cup RM0.50/PCS', cup?.costPrice === 0.5, String(cup?.costPrice))

const sugar = db.createProduct({
  name: 'Sugar Same Unit',
  sku: 'SUGAR-11',
  categoryId: 'cat-ing',
  unit: 'KG',
  purchaseUnit: 'KG',
  purchaseConversionQty: 1,
  purchaseCost: 2.85,
  sellingPrice: 4,
})
check('TEST 8 1:1 conversion RM2.85/KG', sugar?.costPrice === 2.85 && sugar.purchaseConversionQty === 1, String(sugar?.costPrice))

const invalidZero = db.createProduct({
  name: 'Bad Conversion',
  sku: 'BAD-ZERO',
  categoryId: 'cat-ing',
  unit: 'KG',
  purchaseUnit: 'BAG',
  purchaseConversionQty: 0,
  purchaseCost: 10,
  sellingPrice: 1,
})
check('TEST 9 conversion 0 blocked', invalidZero === null)
check(
  'TEST 9 helper rejects 0',
  !validatePurchaseConversion({ baseUnit: 'KG', purchaseUnit: 'BAG', conversionQty: 0 }).ok,
)

const negative = db.createProduct({
  name: 'Negative Cost',
  sku: 'NEG-COST',
  categoryId: 'cat-ing',
  unit: 'KG',
  purchaseCost: -1,
  sellingPrice: 1,
})
check('TEST 10 negative cost blocked', negative === null)

const packMt = db.getSnapshot().products.find((product) => product.id === 'p-pack-mt')
check('TEST 11 seeded Matcha pack uses BOM cost', packMt?.costSource === 'bom' && packMt.costPrice === 0.9, `${packMt?.costSource} ${packMt?.costPrice}`)

const nestle = db.createProduct({
  name: 'Nestle Ice Cream',
  sku: '',
  categoryId,
  unit: 'PCS',
  costPrice: 8.5,
  sellingPrice: 12,
})
check('TEST 12 create manual cost RM8.50', nestle?.costPrice === 8.5 && nestle.costSource === 'manual', `${nestle?.sku} ${nestle?.costPrice}`)
const nestleUpdated = nestle ? db.updateProduct(nestle.id, { costPrice: 8.5 }) : false
const nestleAfter = db.getSnapshot().products.find((product) => product.id === nestle?.id)
check('TEST 12 update keeps manual cost', Boolean(nestleUpdated) && nestleAfter?.costPrice === 8.5 && nestleAfter.costSource === 'manual')

const halfKg = qtyToBaseUnit(0.5, 'KG', { unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1 })
check('TEST 13 decimal 0.5 KG accepted', halfKg === 0.5, String(halfKg))

const gramsToKg = qtyToBaseUnit(500, 'G', cocoa!)
check('TEST 13 500 G = 0.5 KG', gramsToKg === 0.5, String(gramsToKg))

const beforeQty = db.getProductQty(cocoa!.id, 'wh-main')
db.createPurchase({
  supplierId: 's-ing',
  warehouseId: 'wh-main',
  invoiceNumber: 'INV-COCOA-BAG',
  items: [{ productId: cocoa!.id, qty: 1, price: 980 }],
  receive: true,
})
const afterQty = db.getProductQty(cocoa!.id, 'wh-main')
check('Purchase 1 BAG cocoa adds 25 KG', eq(Number((afterQty - beforeQty).toFixed(4)), 25), `${beforeQty} → ${afterQty}`)

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => ` - ${row.name}${row.detail ? `: ${row.detail}` : ''}`).join('\n'))
  process.exit(1)
}
