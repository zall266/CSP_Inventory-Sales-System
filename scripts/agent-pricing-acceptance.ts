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
const {
  belowAgentPriceMessage,
  calcAgentSaleEarnings,
  configuredAgentPrice,
  currentLinkedAgent,
  defaultAgentSellingPrice,
  saleEarningForAgentSale,
} = await import('@/features/agent/agentModel')
const { PRODUCT_PRICING_PATH, productOnPricingList } = await import('@/features/products/ProductPricingPage')
const { formFromProduct, toProductInput } = await import('@/features/products/ProductForm')
const { navGroups } = await import('@/components/layout/Sidebar')
const { hasPermission } = await import('@/features/settings/permissions')
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appSrc = readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
const sidebarSrc = readFileSync(path.join(root, 'src/components/layout/Sidebar.tsx'), 'utf8')
const agentsPageSrc = readFileSync(path.join(root, 'src/features/agent/AgentPages.tsx'), 'utf8')
const pricingPageSrc = readFileSync(path.join(root, 'src/features/products/ProductPricingPage.tsx'), 'utf8')

db.resetDemo()

const MT = 'p-pack-mt'
const ST = 'p-pack-st'
const CH = 'p-pack-ch'
const matchaSeed = product(MT)
const seedWholesale = matchaSeed?.wholesalePrice
check('1. Existing Product Selling Price is displayed (Matcha RM 8.50 seed)', matchaSeed?.sellingPrice === 8.5)
check('Existing Wholesale Price is left unchanged on load', seedWholesale === 7)

const productsNav = navGroups.find((group) => group.id === 'products')?.items ?? []
const salesNav = navGroups.find((group) => group.id === 'sales')?.items ?? []
check('Product Pricing route is registered', appSrc.includes('PRODUCT_PRICING_PATH') && appSrc.includes('ProductPricingPage'))
check('Product Pricing path is Products → Pricing', PRODUCT_PRICING_PATH === '/products/pricing')
check(
  'Pricing sits under Products',
  productsNav.filter((item) => item.to === PRODUCT_PRICING_PATH && item.label === 'Pricing').length === 1,
)
check('Sales nav has no Agent Pricing item', salesNav.every((item) => item.label !== 'Agent Pricing' && !item.to.includes('pricing')))
check('Sidebar does not add Sales → Agent Pricing', !sidebarSrc.includes('/sales/agents/pricing') && !sidebarSrc.includes("label: 'Agent Pricing'"))
check('Pricing menu is Owner/Admin only', sidebarSrc.includes("item.to === '/products/pricing'") && sidebarSrc.includes("'agent.manage'"))
check('Agents page no longer has an Agent Pricing button', !agentsPageSrc.includes('Agent Pricing') && !agentsPageSrc.includes('/sales/agents/pricing'))
check('Old Agent Pricing path redirects to Product Pricing', appSrc.includes('path="/sales/agents/pricing"') && appSrc.includes('Navigate to={PRODUCT_PRICING_PATH}'))
check('Page title is Product Pricing', pricingPageSrc.includes('title="Product Pricing"'))
check('Page subtitle names all three prices', pricingPageSrc.includes('Manage Selling Price, Agent Price and Wholesale Price'))
check('Table includes Wholesale Price', pricingPageSrc.includes('>Wholesale Price<') && pricingPageSrc.includes('Set Wholesale Price'))
check('UI does not use CSP Price', !pricingPageSrc.includes('CSP Price'))
check('Owner/Admin can open Product Pricing', hasPermission(db.getSnapshot(), 'agent.manage'))

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
  '2/3/4. Owner/Admin can save Selling Price and Agent Price from one list',
  db.saveAgentPrices([
    { productId: MT, sellingPrice: 18.99, agentPrice: 10 },
    { productId: ST, sellingPrice: 18.99, agentPrice: 10 },
    { productId: CH, sellingPrice: 19.99, agentPrice: 11 },
  ]) && lastToast()?.title === 'Prices saved',
)
check('2. Matcha Selling Price persisted', product(MT)?.sellingPrice === 18.99)
check('3. Matcha Agent Price persisted', configuredAgentPrice(product(MT)) === 10)
check('4. Strawberry both prices persisted', product(ST)?.sellingPrice === 18.99 && configuredAgentPrice(product(ST)) === 10)
check('4. Chocolate both prices persisted', product(CH)?.sellingPrice === 19.99 && configuredAgentPrice(product(CH)) === 11)
check('Wholesale Price is not invented when saving Selling/Agent Price', product(MT)?.wholesalePrice === seedWholesale)
check('5. New Agent Sale defaults to current Selling Price', defaultAgentSellingPrice(product(MT)) === 18.99)
check(
  'Wholesale Price can be saved from Product Pricing',
  db.saveAgentPrices([{ productId: MT, wholesalePrice: 12 }]) && product(MT)?.wholesalePrice === 12,
)
check('Saving Wholesale Price does not change Selling Price', product(MT)?.sellingPrice === 18.99)
check('Saving Wholesale Price does not change Agent Price', configuredAgentPrice(product(MT)) === 10)
check(
  'All three prices can be saved together',
  db.saveAgentPrices([{ productId: ST, sellingPrice: 18.99, agentPrice: 10, wholesalePrice: 13 }]) &&
    product(ST)?.sellingPrice === 18.99 &&
    configuredAgentPrice(product(ST)) === 10 &&
    product(ST)?.wholesalePrice === 13,
)
check(
  'Negative Selling Price is blocked',
  !db.saveAgentPrices([{ productId: CH, sellingPrice: -1 }]) && lastToast()?.title === 'Selling Price cannot be negative.',
)
check(
  'Negative Agent Price is blocked',
  !db.saveAgentPrices([{ productId: CH, agentPrice: -1 }]) && lastToast()?.title === 'Agent Price cannot be negative.',
)
check(
  'Negative Wholesale Price is blocked',
  !db.saveAgentPrices([{ productId: CH, wholesalePrice: -1 }]) && lastToast()?.title === 'Wholesale Price cannot be negative.',
)
check('Blocked negative Wholesale Price is not persisted', product(CH)?.wholesalePrice === 6.2)

check(
  '1. Agent Price < Selling Price → PASS',
  db.saveAgentPrices([{ productId: CH, sellingPrice: 19.99, agentPrice: 11 }]) &&
    product(CH)?.sellingPrice === 19.99 &&
    configuredAgentPrice(product(CH)) === 11,
)
check(
  '2. Agent Price = Selling Price → PASS',
  db.saveAgentPrices([{ productId: CH, sellingPrice: 19.99, agentPrice: 19.99 }]) &&
    product(CH)?.sellingPrice === 19.99 &&
    configuredAgentPrice(product(CH)) === 19.99,
)
check(
  '3. Agent Price > Selling Price → BLOCK',
  !db.saveAgentPrices([{ productId: CH, sellingPrice: 18.99, agentPrice: 20 }]) &&
    lastToast()?.title === 'Agent Price cannot be higher than Selling Price.',
)
check('3. Invalid pair is not persisted', product(CH)?.sellingPrice === 19.99 && configuredAgentPrice(product(CH)) === 19.99)
check(
  '3. Lowering Selling Price below Agent Price is blocked',
  !db.saveAgentPrices([{ productId: MT, sellingPrice: 9 }]) &&
    product(MT)?.sellingPrice === 18.99 &&
    configuredAgentPrice(product(MT)) === 10,
)
check(
  'Restore Chocolate prices for later checks',
  db.saveAgentPrices([{ productId: CH, sellingPrice: 19.99, agentPrice: 11 }]),
)

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
  '14. Agent cannot edit Agent Price via product update',
  !db.updateProduct(MT, { agentPrice: 1 }) && lastToast()?.title === 'Permission denied' && lastToast()?.description === 'You cannot change Agent Price.',
)
check(
  '14. Agent cannot edit Agent Price via pricing list',
  !db.saveAgentPrices([{ productId: ST, agentPrice: 1 }]) && lastToast()?.title === 'Permission denied',
)
check(
  '14. Agent cannot edit Selling Price via pricing list',
  !db.saveAgentPrices([{ productId: MT, sellingPrice: 1 }]) && lastToast()?.title === 'Permission denied',
)
check(
  '14. Agent cannot edit Wholesale Price via pricing list',
  !db.saveAgentPrices([{ productId: MT, wholesalePrice: 1 }]) && lastToast()?.title === 'Permission denied',
)
check(
  '14. Product prices unchanged after Agent attempt',
  product(MT)?.sellingPrice === 18.99 &&
    configuredAgentPrice(product(MT)) === 10 &&
    product(MT)?.wholesalePrice === 12 &&
    configuredAgentPrice(product(ST)) === 10,
)
check('Agent users do not have pricing permission', !hasPermission(db.getSnapshot(), 'agent.manage'))

db.switchUser('u-admin')
check(
  '13. Changing Selling Price later does not rewrite historical Agent Sales',
  db.saveAgentPrices([{ productId: MT, sellingPrice: 20 }]),
)
check('13. Existing Agent Sale remains RM 12.00', db.getSnapshot().agentSales.find((row) => row.saleId === historical?.id)?.items[0]?.sellingPrice === 12)
check('13. Invoice line for historical sale remains RM 12.00', historical && db.getSnapshot().sales.find((row) => row.id === historical.id)?.items[0]?.price === 12)
check('5. New sales now default to the updated Selling Price', defaultAgentSellingPrice(product(MT)) === 20)
check('13. Agent Price unchanged when only Selling Price is saved', configuredAgentPrice(product(MT)) === 10)
check('13. Wholesale Price unchanged when only Selling Price is saved', product(MT)?.wholesalePrice === 12)
check(
  'Product Master edit preserves Wholesale Price',
  toProductInput(formFromProduct(product(MT)!), false, product(MT)).wholesalePrice === 12,
)

const restock = db.transferStockToAgent({ agentId: agent!.id, fromWarehouseId: 'wh-main', productId: ST, qty: 2 })
check('12. Agent stock transfer still works after pricing changes', restock)

db.switchUser('u-mei')
const laterSale = db.createAgentSale({
  agentId: agent!.id,
  items: [{ productId: MT, qty: 1, sellingPrice: 18.99 }],
  customerId: 'c-abc-ent',
})
check('New Agent Sale can still use a previously listed Selling Price', Boolean(laterSale) && laterSale?.items[0]?.price === 18.99)

db.switchUser('u-admin')
const earningBeforeWithdraw = saleEarningForAgentSale(
  db.getSnapshot().agentEarningLedgers,
  db.getSnapshot().agentSales.find((row) => row.saleId === atFifteen?.id)!.id,
)
const withdrawal = db.requestAgentWithdrawal({ agentId: agent!.id, amount: 5 })
check('12. Existing Agent withdrawal still works', Boolean(withdrawal && withdrawal.status === 'requested'), withdrawal?.id)
check('12. Withdrawal does not rewrite sale earnings', earningBeforeWithdraw?.amount === 5)
check('15. Existing Agent stock remains after price edits', qty(MT, agent!.warehouseId) === 16)
check('16. Existing Agent withdrawal remains requested', withdrawal?.status === 'requested')

const sugar = product('p-sugar')
check('Sellable seed product appears on Product Pricing', Boolean(sugar && productOnPricingList(sugar)))
check('Non-sellable products are hidden after Product Master flag is off', db.updateProduct('p-sugar', { sellable: false }) && !productOnPricingList(product('p-sugar')!))
check('Inactive products are hidden from Product Pricing', db.updateProduct(CH, { status: 'inactive' }) && !productOnPricingList(product(CH)!))
check('Sellable finished goods remain on Product Pricing', productOnPricingList(product(MT)!))

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => ` - ${row.name}${row.detail ? `: ${row.detail}` : ''}`).join('\n'))
  process.exit(1)
}
