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
  agentPosItemAvailable,
  configuredAgentPrice,
  currentLinkedAgent,
  posSellingWarehouseId,
} = await import('@/features/agent/agentModel')
const { productIsSellable } = await import('@/features/products/masterData')

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function lastToast() {
  const toasts = db.getSnapshot().ui.toasts
  return toasts[toasts.length - 1]
}

function qty(productId: string, warehouseId: string) {
  return db.getProductQty(productId, warehouseId)
}

function posCatalog(warehouseId: string) {
  return db.getSnapshot().products.filter((product) => agentPosItemAvailable(product, qty(product.id, warehouseId)))
}

db.resetDemo()

const companyBefore = db.getSnapshot().products.filter((product) => productIsSellable(product)).length
const companySale = db.createSale({
  customerId: 'c-walkin',
  warehouseId: 'wh-main',
  items: [{ productId: 'p-pack-st', qty: 1, price: 8 }],
  paidAmount: 8,
  paymentMethod: 'cash',
})
check('Company POS still creates a company sale', Boolean(companySale && companySale.warehouseId === 'wh-main'))

const agent = db.createAgent({
  name: 'Agent JB',
  code: 'JB',
  userId: 'u-mei',
})
check('Agent JB warehouse is wh-agent-jb', agent?.warehouseId === 'wh-agent-jb', agent?.warehouseId)

const stocked = [
  { id: 'p-cm', qty: 20, name: 'Condensed Milk' },
  { id: 'p-pack-mt', qty: 15, name: 'Matcha' },
  { id: 'p-st', qty: 20, name: 'Strawberry Powder' },
  { id: 'p-wf', qty: 40, name: 'Waffle Premix' },
]
for (const row of stocked) {
  check(
    `Transfer ${row.name} without Agent Price`,
    db.transferStockToAgent({ agentId: agent!.id, fromWarehouseId: 'wh-main', productId: row.id, qty: row.qty }),
  )
  const product = db.getSnapshot().products.find((item) => item.id === row.id)
  check(`${row.name} Agent Price is unset`, configuredAgentPrice(product) === null)
  check(`${row.name} is sellable`, productIsSellable(product))
}

db.switchUser('u-mei')
const linked = currentLinkedAgent(db.getSnapshot())
const warehouseId = posSellingWarehouseId(db.getSnapshot())
check('Agent POS uses Agent JB warehouse', Boolean(linked && warehouseId === 'wh-agent-jb'))

const catalog = posCatalog(warehouseId)
for (const row of stocked) {
  check(
    `${row.name} appears in Agent POS with qty > 0 and no Agent Price`,
    catalog.some((product) => product.id === row.id),
  )
}

const blocked = db.createAgentSale({
  agentId: agent!.id,
  items: [{ productId: 'p-pack-mt', qty: 1, sellingPrice: 12 }],
  customerId: 'c-abc-ent',
})
const blockedToast = lastToast()
check('Sale without Agent Price is blocked', !blocked && qty('p-pack-mt', warehouseId) === 15)
check(
  'Blocked sale shows Agent Price missing message',
  blockedToast?.title === 'Agent Price has not been configured for this product.',
  blockedToast?.title,
)

db.switchUser('u-admin')
check('Configure Agent Price on Matcha', db.updateProduct('p-pack-mt', { agentPrice: 10 }))
db.switchUser('u-mei')

const allowed = db.createAgentSale({
  agentId: agent!.id,
  items: [{ productId: 'p-pack-mt', qty: 2, sellingPrice: 12 }],
  delivery: 5,
  customerId: 'c-abc-ent',
  paymentMethod: 'cash',
})
const agentSale = db.getSnapshot().agentSales.find((row) => row.saleId === allowed?.id)
const ledgers = db.getSnapshot().agentEarningLedgers.filter((row) => row.relatedAgentSaleId === agentSale?.id)
check('Sale proceeds after Agent Price is configured', Boolean(allowed), allowed?.invoiceNo)
check('Agent stock deducted after confirmed sale', qty('p-pack-mt', warehouseId) === 13, String(qty('p-pack-mt', warehouseId)))
check('Agent earnings unchanged: one ledger for markup + delivery', Boolean(agentSale && ledgers.length === 1 && agentSale.totalEarnings === 9), String(agentSale?.totalEarnings))

check('Zero-stock Chocolate Lava stays unavailable', !posCatalog(warehouseId).some((product) => product.id === 'p-pack-cl') && qty('p-pack-cl', warehouseId) === 0)

db.switchUser('u-admin')
db.updateProduct('p-sugar', { sellable: false, agentPrice: 3 })
db.transferStockToAgent({ agentId: agent!.id, fromWarehouseId: 'wh-main', productId: 'p-sugar', qty: 2 })
db.switchUser('u-mei')
check('Non-sellable item stays unavailable', !agentPosItemAvailable(db.getSnapshot().products.find((product) => product.id === 'p-sugar')!, qty('p-sugar', warehouseId)))

db.switchUser('u-admin')
const companyAfter = db.getSnapshot().products.filter((product) => productIsSellable(product)).length
check('Company POS catalogue still includes sellable items without Agent Price', companyAfter >= companyBefore - 1)
const companyAgain = db.createSale({
  customerId: 'c-walkin',
  warehouseId: 'wh-main',
  items: [{ productId: 'p-wf', qty: 1, price: 32 }],
  paidAmount: 32,
  paymentMethod: 'cash',
})
check('Company POS still sells without Agent Price', Boolean(companyAgain && companyAgain.warehouseId === 'wh-main'))

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => ` - ${row.name}${row.detail ? `: ${row.detail}` : ''}`).join('\n'))
  process.exit(1)
}
