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

const { db } = await import('@/store/db')
const { stockItemProducts, unusedOpeningBalanceProducts } = await import('@/features/openingBalance/openingBalanceModel')
const pagesSrc = readFileSync(new URL('../src/features/openingBalance/OpeningBalancePages.tsx', import.meta.url), 'utf8')

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

db.resetDemo()
db.switchUser('u-admin')
const products = stockItemProducts(db.getSnapshot())

check(
  'Opening Balance table filters used products from other row selectors',
  pagesSrc.includes('unusedOpeningBalanceProducts(catalog, lines'),
)

const rowTwo = unusedOpeningBalanceProducts(
  products,
  [
    { productId: 'p-cocoa', warehouseId: 'wh-main' },
    { productId: 'p-milkpw', warehouseId: 'wh-main' },
  ],
  { index: 1, warehouseId: 'wh-main' },
)
check('Selected Cocoa is hidden from another row in the same warehouse', !rowTwo.some((product) => product.id === 'p-cocoa'))
check('Current row still shows its own Milk Powder', rowTwo.some((product) => product.id === 'p-milkpw'))
check('Unselected Sugar remains available', rowTwo.some((product) => product.id === 'p-sugar'))

const otherWarehouse = unusedOpeningBalanceProducts(
  products,
  [
    { productId: 'p-cocoa', warehouseId: 'wh-main' },
    { productId: 'p-sugar', warehouseId: 'wh-shop' },
  ],
  { index: 1, warehouseId: 'wh-shop' },
)
check(
  'Same product stays available in a different warehouse',
  otherWarehouse.some((product) => product.id === 'p-cocoa'),
)

const nextLine = unusedOpeningBalanceProducts(
  products,
  [{ productId: 'p-cocoa', warehouseId: 'wh-main' }],
  { index: 1, warehouseId: 'wh-main' },
)
check('Add Item can pick the next unused product', nextLine[0]?.id !== 'p-cocoa' && nextLine.some((product) => product.id === 'p-sugar' || product.id === 'p-milkpw'))

const duplicate = db.saveOpeningBalance({
  type: 'stock_item',
  items: [
    { productId: 'p-cocoa', qty: 1, unit: 'KG', warehouseId: 'wh-main' },
    { productId: 'p-cocoa', qty: 2, unit: 'KG', warehouseId: 'wh-main' },
  ],
})
check('Existing duplicate-product save guard still blocks the document', duplicate === null)

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => row.name).join('\n'))
  process.exit(1)
}
