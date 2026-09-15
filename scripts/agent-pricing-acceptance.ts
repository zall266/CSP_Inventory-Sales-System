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
  belowAgentPriceMessage,
  calcAgentSaleEarnings,
  configuredAgentPrice,
  currentLinkedAgent,
  defaultAgentSellingPrice,
  saleEarningForAgentSale,
} = await import('@/features/agent/agentModel')
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

function product(id: string) {
  return db.getSnapshot().products.find((row) => row.id === id)
}

db.resetDemo()

const MT = 'p-pack-mt'
const ST = 'p-pack-st'
const CH = 'p-pack-ch'
const matchaSeed = product(MT)
check('1. Product CSP selling price is reused (Matcha RM 8.50 seed)', matchaSeed?.sellingPrice === 8.5)

const agent = db.createAgent({
  name: 'Agent JB',
  code: 'JB01',
  userId: 'u-mei',
  bankName: 'Maybank',
  accountHolder: 'Mei Ling',
  bankAccount: '1234567890',
})
check('Agent created for pricing tests', Boolean(agent), agent?.id)

check(
  '10. Owner/Admin can edit multiple Agent Prices from one list',
  db.saveAgentPrices([
    { productId: MT, agentPrice: 10 },
    { productId: ST, agentPrice: 10 },
    { productId: CH, agentPrice: 11 },
  ]),
)
check('2. Agent Price saved on Matcha', configuredAgentPrice(product(MT)) === 10)
check('2. Agent Price saved on Strawberry', configuredAgentPrice(product(ST)) === 10)
check('2. Agent Price saved on Chocolate', configuredAgentPrice(product(CH)) === 11)

check('CSP selling price unchanged after Agent Price save', product(MT)?.sellingPrice === 8.5)
check(
  'CSP below Agent Price defaults to Agent Price so the sale is not immediately invalid',
  defaultAgentSellingPrice(product(MT)) === 10,
)

check(
  'Owner can set CSP selling price used as the Agent Sale default',
  db.updateProduct(MT, { sellingPrice: 18.99 }),
)
check('1. Product CSP price = RM 18.99', product(MT)?.sellingPrice === 18.99)
check('3. New Agent Sale defaults to CSP RM 18.99', defaultAgentSellingPrice(product(MT)) === 18.99)

const transferred = [
  db.transferStockToAgent({ agentId: agent!.id, fromWarehouseId: 'wh-main', productId: MT, qty: 20 }),
  db.transferStockToAgent({ agentId: agent!.id, fromWarehouseId: 'wh-main', productId: ST, qty: 8 }),
]
check('12. Existing Agent stock transfer still works', transferred.every(Boolean), `MT ${qty(MT, agent!.warehouseId)}`)

db.switchUser('u-mei')
check('Agent context is the linked user', currentLinkedAgent(db.getSnapshot())?.id === agent!.id)

const historical = db.createAgentSale({
  agentId: agent!.id,
  items: [{ productId: MT, qty: 1, sellingPrice: 12 }],
  customerId: 'c-abc-ent',
  paymentMethod: 'cash',
})
check('Historical Agent Sale created at RM 12.00', Boolean(historical), historical?.invoiceNo)
const historicalAgentSale = db.getSnapshot().agentSales.find((row) => row.saleId === historical?.id)
check('9. Historical selling price stored on the Agent Sale', historicalAgentSale?.items[0]?.sellingPrice === 12)

const atFifteen = db.createAgentSale({
  agentId: agent!.id,
  items: [{ productId: MT, qty: 1, sellingPrice: 15 }],
  customerId: 'c-abc-ent',
  paymentMethod: 'cash',
})
check('4. Agent changes selling price to RM 15.00 → PASS', Boolean(atFifteen), atFifteen?.invoiceNo)
check('7. Customer invoice uses actual selling price RM 15.00', atFifteen?.items[0]?.price === 15)
check(
  '7. Customer invoice does not expose Agent Price',
  Boolean(atFifteen && !('agentPrice' in atFifteen) && atFifteen.items.every((line) => !('agentPrice' in line) && !('productMarkup' in line))),
)

const fifteenAgentSale = db.getSnapshot().agentSales.find((row) => row.saleId === atFifteen?.id)
const fifteenEarning = fifteenAgentSale ? saleEarningForAgentSale(db.getSnapshot().agentEarningLedgers, fifteenAgentSale.id) : undefined
const expectedMarkup = calcAgentSaleEarnings({ agentPrice: 10, sellingPrice: 15, qty: 1, delivery: 0 })
check('8. Agent Earnings markup uses actual selling price', fifteenAgentSale?.productMarkup === 5 && fifteenAgentSale?.productMarkup === expectedMarkup.productMarkup)
check('8. Agent Earnings ledger uses actual selling price', fifteenEarning?.amount === expectedMarkup.totalEarnings)

const atFloor = db.createAgentSale({
  agentId: agent!.id,
  items: [{ productId: MT, qty: 1, sellingPrice: 10 }],
  customerId: 'c-abc-ent',
  paymentMethod: 'cash',
})
check('5. Agent changes selling price to RM 10.00 → PASS', Boolean(atFloor), atFloor?.invoiceNo)
check('5. Floor sale markup is RM 0.00', db.getSnapshot().agentSales.find((row) => row.saleId === atFloor?.id)?.productMarkup === 0)

const blocked = db.createAgentSale({
  agentId: agent!.id,
  items: [{ productId: MT, qty: 1, sellingPrice: 9 }],
  customerId: 'c-abc-ent',
})
check('6. Agent changes selling price to RM 9.00 → BLOCKED', !blocked)
check('6. Validation names the Agent Price', lastToast()?.title === belowAgentPriceMessage(10), lastToast()?.title)
check('6. Blocked sale does not consume stock', qty(MT, agent!.warehouseId) === 17)

check(
  '11. Agent cannot edit Agent Price via product update',
  !db.updateProduct(MT, { agentPrice: 1 }) && lastToast()?.title === 'Permission denied' && lastToast()?.description === 'You cannot change Agent Price.',
)
check(
  '11. Agent cannot edit Agent Price via pricing list',
  !db.saveAgentPrices([{ productId: ST, agentPrice: 1 }]) && lastToast()?.title === 'Permission denied',
)
check('11. Agent Price unchanged after Agent attempt', configuredAgentPrice(product(MT)) === 10 && configuredAgentPrice(product(ST)) === 10)

db.switchUser('u-admin')
check(
  '9. Changing CSP later does not rewrite historical Agent Sales',
  db.updateProduct(MT, { sellingPrice: 20 }),
)
check('9. Existing Agent Sale remains RM 12.00', db.getSnapshot().agentSales.find((row) => row.saleId === historical?.id)?.items[0]?.sellingPrice === 12)
check('9. Invoice line for historical sale remains RM 12.00', historical && db.getSnapshot().sales.find((row) => row.id === historical.id)?.items[0]?.price === 12)
check('3. New sales now default to the updated CSP', defaultAgentSellingPrice(product(MT)) === 20)

const restock = db.transferStockToAgent({ agentId: agent!.id, fromWarehouseId: 'wh-main', productId: ST, qty: 2 })
check('12. Agent stock transfer still works after pricing changes', restock)

db.switchUser('u-mei')
const laterSale = db.createAgentSale({
  agentId: agent!.id,
  items: [{ productId: MT, qty: 1, sellingPrice: 18.99 }],
  customerId: 'c-abc-ent',
})
check('New Agent Sale can still use the original CSP amount', Boolean(laterSale) && laterSale?.items[0]?.price === 18.99)

db.switchUser('u-admin')
const earningBeforeWithdraw = saleEarningForAgentSale(
  db.getSnapshot().agentEarningLedgers,
  db.getSnapshot().agentSales.find((row) => row.saleId === atFifteen?.id)!.id,
)
const withdrawal = db.requestAgentWithdrawal({ agentId: agent!.id, amount: 5 })
check('12. Existing Agent withdrawal still works', Boolean(withdrawal && withdrawal.status === 'requested'), withdrawal?.id)
check('12. Withdrawal does not rewrite sale earnings', earningBeforeWithdraw?.amount === 5)

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => ` - ${row.name}${row.detail ? `: ${row.detail}` : ''}`).join('\n'))
  process.exit(1)
}
