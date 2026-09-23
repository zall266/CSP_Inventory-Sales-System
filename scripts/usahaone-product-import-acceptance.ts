import { createSeedData } from '../src/data/seed'
import {
  USAHAONE_OPENING_QTY,
  USAHAONE_OPENING_REFERENCE,
  USAHAONE_SOURCE_PRODUCT_ROWS,
  USAHAONE_UAT_ROWS,
  USAHAONE_WAREHOUSE_ID,
  usahaonePreview,
  validateUsahaoneUatRows,
} from '../src/data/usahaoneProductImport'

let failed = 0
function check(label: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failed += 1
}

const preview = usahaonePreview()
console.log('')
console.log('TEST OPENING STOCK PREVIEW — 1000 is test data, not the Usahaone balance')
console.log('Product | SKU | Unit | Cost | Selling | Wholesale | Category | Active | Opening')
for (const row of preview) {
  console.log(
    `${row.name} | ${row.sku} | ${row.unit} | ${row.costPrice} | ${row.sellingPrice} | ${row.wholesalePrice} | ${row.category} | ${row.active} | ${row.openingStock}`,
  )
}
console.log('')

const data = createSeedData()
const imported = data.products.filter((product) => product.id.startsWith('p-uo-'))
const demo = data.products.filter((product) => !product.id.startsWith('p-uo-'))
const demoSkus = demo.map((product) => product.sku)
const errors = validateUsahaoneUatRows(demoSkus)

check('validation has no errors', errors.length === 0)
check(`selected ${USAHAONE_UAT_ROWS.length} of ${USAHAONE_SOURCE_PRODUCT_ROWS} source rows`, imported.length === USAHAONE_UAT_ROWS.length)
check('demo product count stays 32', demo.length === 32)
check('no duplicate SKUs', new Set(data.products.map((product) => product.sku.toLowerCase())).size === data.products.length)

const green = imported.find((product) => product.sku === '147547')
check('AB Green Apple keeps Usahaone SKU and PACKS unit', green?.name === 'AB Green Apple' && green.unit === 'PACKS' && green.sellingPrice === 17.99 && green.costPrice === 9.43)
const spread = imported.find((product) => product.sku === '148214')
check('chocolate spread uses KG from KILOGRAM', spread?.unit === 'KG' && spread.costPrice === 12.5)
const coffee = imported.find((product) => product.sku === '171441')
check('arabica uses G from GRAM', coffee?.unit === 'G')
const vanilla = imported.find((product) => product.sku === '148540')
check('blank unit falls back to PCS', vanilla?.unit === 'PCS')
check('wholesale stays 0 because the export has no wholesale column', imported.every((product) => product.wholesalePrice === 0))
check('imported products are active', imported.every((product) => product.status === 'active'))
check('no sales components were invented', imported.every((product) => !product.salesComponents?.length))

for (const product of imported) {
  const main = data.inventory.find((row) => row.productId === product.id && row.warehouseId === USAHAONE_WAREHOUSE_ID)
  const other = data.inventory.filter((row) => row.productId === product.id && row.warehouseId !== USAHAONE_WAREHOUSE_ID)
  const movements = data.stockMovements.filter((row) => row.productId === product.id && row.reference === USAHAONE_OPENING_REFERENCE)
  check(`${product.sku} main stock is 1000`, main?.qty === USAHAONE_OPENING_QTY)
  check(`${product.sku} other warehouses stay 0`, other.every((row) => row.qty === 0))
  check(`${product.sku} has one opening movement`, movements.length === 1 && movements[0]?.stockIn === 1000 && movements[0]?.type === 'opening_stock')
}

const demoMain = (id: string) => data.inventory.find((row) => row.productId === id && row.warehouseId === 'wh-main')?.qty
check('existing chocolate main stock unchanged', demoMain('p-cp') === 223)
check('existing matcha main stock unchanged', demoMain('p-mt') === 8)
check(
  'demo products have no Usahaone opening movements',
  data.stockMovements.every((row) => row.reference !== USAHAONE_OPENING_REFERENCE || row.productId.startsWith('p-uo-')),
)
check('existing BOMs remain', data.boms.length >= 9 && data.boms.some((bom) => bom.id === 'bom-cp'))
check('existing sales remain', data.sales.some((sale) => sale.invoiceNo === 'INV-001250'))
check('existing production sessions remain', data.productionSessions.length > 0)
check('users remain', data.users.some((user) => user.id === 'u-admin'))
check('main warehouse remains', data.warehouses.some((warehouse) => warehouse.id === 'wh-main'))

const referenced = new Set<string>()
for (const sale of data.sales) for (const line of sale.items) referenced.add(line.productId)
for (const bom of data.boms) {
  referenced.add(bom.productId)
  for (const item of bom.items) referenced.add(item.productId)
}
for (const order of data.productionOrders) referenced.add(order.productId)
const missingDemo = [...referenced].filter((id) => !id.startsWith('p-uo-') && !demo.some((product) => product.id === id))
check('referenced demo products were not removed', missingDemo.length === 0)

console.log(failed ? `\n${failed} failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
