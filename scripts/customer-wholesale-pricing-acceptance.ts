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
  configuredAgentPrice,
  currentLinkedAgent,
  defaultAgentSellingPrice,
  saleEarningForAgentSale,
} = await import('@/features/agent/agentModel')
const {
  activeCustomerWholesalePrice,
  isWholesaleSale,
  resolveWholesaleUnitPrice,
  sellableProductsForCustomerPricing,
} = await import('@/features/customers/customerPricingModel')
const { productIsSellable } = await import('@/features/products/masterData')
const { navGroups } = await import('@/components/layout/Sidebar')
const { hasPermission } = await import('@/features/settings/permissions')
const { PRODUCT_PRICING_PATH } = await import('@/features/products/ProductPricingPage')

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

function product(id: string) {
  return db.getSnapshot().products.find((row) => row.id === id)
}

function customRows(customerId: string, productId?: string) {
  return (db.getSnapshot().customerWholesalePrices ?? []).filter(
    (row) => row.customerId === customerId && (!productId || row.productId === productId),
  )
}

function audits(action?: string) {
  return (db.getSnapshot().documentAuditLogs ?? []).filter((row) =>
    row.documentType === 'customer_wholesale_price' && (!action || row.action === action),
  )
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sidebarSrc = readFileSync(path.join(root, 'src/components/layout/Sidebar.tsx'), 'utf8')
const partiesSrc = readFileSync(path.join(root, 'src/features/parties/PartiesPages.tsx'), 'utf8')
const pricingSrc = readFileSync(path.join(root, 'src/features/products/ProductPricingPage.tsx'), 'utf8')

db.resetDemo()

const MT = 'p-pack-mt'
const CH = 'p-pack-ch'
const WF = 'p-wf'
const COCOA = 'p-cocoa'
const ABC = 'c-abc-ent'
const XYZ = 'c-xyz'
const WALKIN = 'c-walkin'

check('Product Pricing screen is unchanged', PRODUCT_PRICING_PATH === '/products/pricing' && pricingSrc.includes('Wholesale Price') && !pricingSrc.includes('Custom Price'))
check('No Wholesale Pricing sidebar item', navGroups.every((group) => group.items.every((item) => item.label !== 'Wholesale Pricing' && item.to !== '/customers/pricing')))
check('Customers stay under Sales', navGroups.find((group) => group.id === 'sales')?.items.some((item) => item.to === '/customers' && item.label === 'Customers') === true)
check('Customers page has no nested wholesale nav', !partiesSrc.includes('Wholesale Pricing'))
check('Owner can manage customer pricing', hasPermission(db.getSnapshot(), 'customer.pricing.manage'))
check('Seed ABC Enterprise Matcha custom price is RM11', activeCustomerWholesalePrice(db.getSnapshot().customerWholesalePrices, ABC, MT) === 11)

check(
  'Master default prices can be set without a customer matrix',
  db.saveAgentPrices([
    { productId: MT, sellingPrice: 18.99, agentPrice: 10, wholesalePrice: 12 },
    { productId: CH, sellingPrice: 18.99, agentPrice: 10, wholesalePrice: 11 },
    { productId: WF, sellingPrice: 32, agentPrice: 20, wholesalePrice: 7.5 },
  ]),
)
check('Product Pricing still owns default Wholesale Price', product(MT)?.wholesalePrice === 12)

const seedCustomId = customRows(ABC, MT)[0]?.id
check(
  'CASE 1 fallback: deactivate ABC Matcha custom price',
  Boolean(seedCustomId) && db.deactivateCustomerWholesalePrice(seedCustomId!),
)
check('CASE 1 resolver uses default Wholesale Price', resolveWholesaleUnitPrice(db.getSnapshot(), ABC, MT) === 12)
const case1 = db.createWholesaleSale({ customerId: ABC, items: [{ productId: MT, qty: 1 }] })
check('CASE 1 wholesale invoice uses RM12.00', Boolean(case1) && case1?.items[0]?.price === 12 && isWholesaleSale(case1), case1?.invoiceNo)

const created = db.saveCustomerWholesalePrice({ customerId: ABC, productId: MT, price: 11 })
check('Create custom price ABC Matcha RM11', Boolean(created) && created?.price === 11 && created?.active === true)
check('Create writes audit', audits('customer_wholesale_price_created').some((row) => row.newValue === '11' && row.documentNo.includes('FG-MT45')))
check('CASE 2 resolver uses custom RM11', resolveWholesaleUnitPrice(db.getSnapshot(), ABC, MT) === 11)
const case2 = db.createWholesaleSale({ customerId: ABC, items: [{ productId: MT, qty: 1 }] })
check('CASE 2 wholesale invoice uses RM11.00', Boolean(case2) && case2?.items[0]?.price === 11 && case2?.items[0]?.total === 11, case2?.invoiceNo)

check('CASE 3 XYZ without custom uses default RM12', resolveWholesaleUnitPrice(db.getSnapshot(), XYZ, MT) === 12)
const case3 = db.createWholesaleSale({ customerId: XYZ, items: [{ productId: MT, qty: 1 }] })
check('CASE 3 XYZ invoice uses RM12.00', Boolean(case3) && case3?.items[0]?.price === 12)

const updated = db.saveCustomerWholesalePrice({ customerId: ABC, productId: MT, price: 11.5 })
check('Update custom price RM11 → RM11.50', Boolean(updated) && updated?.id === created?.id && updated?.price === 11.5)
check('One active row per customer/product after update', customRows(ABC, MT).filter((row) => row.active).length === 1)
check('Update writes audit old/new price', audits('customer_wholesale_price_updated').some((row) => row.oldValue === '11' && row.newValue === '11.5'))
const case4 = db.createWholesaleSale({ customerId: ABC, items: [{ productId: MT, qty: 1 }] })
check('CASE 4 new invoice uses RM11.50', Boolean(case4) && case4?.items[0]?.price === 11.5)
check('CASE 4 / CASE 9 historical invoice remains RM11', case2?.items[0]?.price === 11)
check('CASE 9 stored sale is not recalculated', db.getSnapshot().sales.find((row) => row.id === case2?.id)?.items[0]?.price === 11)

check('Duplicate save still keeps a single active row', db.saveCustomerWholesalePrice({ customerId: ABC, productId: MT, price: 11.5 }) && customRows(ABC, MT).filter((row) => row.active).length === 1)

check('Remove custom price', db.deactivateCustomerWholesalePrice(updated!.id))
check('Removed row is inactive, not deleted', customRows(ABC, MT).length === 1 && customRows(ABC, MT)[0]?.active === false)
check('Deactivate writes audit', audits('customer_wholesale_price_deactivated').some((row) => row.oldValue === '11.5'))
check('CASE 5 resolver falls back to RM12', resolveWholesaleUnitPrice(db.getSnapshot(), ABC, MT) === 12)
const case5 = db.createWholesaleSale({ customerId: ABC, items: [{ productId: MT, qty: 1 }] })
check('CASE 5 new invoice uses RM12.00', Boolean(case5) && case5?.items[0]?.price === 12)

check('Restore ABC Matcha RM11 and add Chocolate RM10.50', Boolean(db.saveCustomerWholesalePrice({ customerId: ABC, productId: MT, price: 11 })) && Boolean(db.saveCustomerWholesalePrice({ customerId: ABC, productId: CH, price: 10.5 })))
check('CASE 6 Matcha custom RM11', resolveWholesaleUnitPrice(db.getSnapshot(), ABC, MT) === 11)
check('CASE 6 Chocolate custom RM10.50', resolveWholesaleUnitPrice(db.getSnapshot(), ABC, CH) === 10.5)
check('CASE 6 Waffle uses default Wholesale Price', resolveWholesaleUnitPrice(db.getSnapshot(), ABC, WF) === 7.5)
const case6 = db.createWholesaleSale({
  customerId: ABC,
  items: [
    { productId: MT, qty: 1 },
    { productId: CH, qty: 1 },
    { productId: WF, qty: 1 },
  ],
})
check(
  'CASE 6 multi-product wholesale invoice prices',
  Boolean(case6) &&
    case6?.items.find((row) => row.productId === MT)?.price === 11 &&
    case6?.items.find((row) => row.productId === CH)?.price === 10.5 &&
    case6?.items.find((row) => row.productId === WF)?.price === 7.5,
  case6?.invoiceNo,
)

check('CASE 7 XYZ custom Matcha RM12.50', Boolean(db.saveCustomerWholesalePrice({ customerId: XYZ, productId: MT, price: 12.5 })))
check('CASE 7 ABC → RM11', resolveWholesaleUnitPrice(db.getSnapshot(), ABC, MT) === 11)
check('CASE 7 XYZ → RM12.50', resolveWholesaleUnitPrice(db.getSnapshot(), XYZ, MT) === 12.5)
check('CASE 7 other customer → RM12', resolveWholesaleUnitPrice(db.getSnapshot(), WALKIN, MT) === 12)

const retail = db.createSale({
  customerId: ABC,
  warehouseId: 'wh-main',
  items: [{ productId: MT, qty: 1, price: product(MT)!.sellingPrice }],
})
check('Retail/normal sale still uses Selling Price, not wholesale', Boolean(retail) && retail?.items[0]?.price === 18.99 && !isWholesaleSale(retail))

check('Negative custom price is blocked', !db.saveCustomerWholesalePrice({ customerId: ABC, productId: WF, price: -1 }) && lastToast()?.title === 'Custom Wholesale Price cannot be negative.')
check('Invalid custom price is blocked', !db.saveCustomerWholesalePrice({ customerId: ABC, productId: WF, price: 'abc' }))

check('Cocoa is selectable while sellable', sellableProductsForCustomerPricing(db.getSnapshot().products).some((row) => row.id === COCOA))
check('CASE 10 non-sellable Cocoa cannot be selected', db.updateProduct(COCOA, { sellable: false }) && !productIsSellable(product(COCOA)) && !sellableProductsForCustomerPricing(db.getSnapshot().products).some((row) => row.id === COCOA))
check('CASE 10 cannot create custom price for non-sellable Cocoa', !db.saveCustomerWholesalePrice({ customerId: ABC, productId: COCOA, price: 1 }))
check('Historical ABC Matcha custom price is preserved after unrelated product flag change', customRows(ABC, MT).some((row) => row.active && row.price === 11))

db.switchUser('u-mei')
check('Staff does not get customer pricing manage', !hasPermission(db.getSnapshot(), 'customer.pricing.manage'))
check('Permission guard blocks staff custom price edits', !db.saveCustomerWholesalePrice({ customerId: ABC, productId: MT, price: 1 }) && lastToast()?.title === 'Permission denied')
check('Custom prices unchanged after staff attempt', customRows(ABC, MT).some((row) => row.active && row.price === 11))

db.switchUser('u-admin')
const persisted = customRows(ABC, MT).find((row) => row.active)
check('Persistence/hydration keeps ABC Matcha custom RM11', persisted?.price === 11 && persisted?.customerId === ABC)

const agent = db.createAgent({
  name: 'Agent JB',
  code: 'JB01',
  userId: 'u-mei',
  bankName: 'Maybank',
  accountHolder: 'Mei Ling',
  bankAccount: '1234567890',
})
check('CASE 8 agent created', Boolean(agent))
check('CASE 8 stock transfer still works', db.transferStockToAgent({ agentId: agent!.id, fromWarehouseId: 'wh-main', productId: MT, qty: 5 }))
db.switchUser('u-mei')
check('CASE 8 Agent context', currentLinkedAgent(db.getSnapshot())?.id === agent!.id)
check('CASE 8 Agent Sale still defaults to Selling Price', defaultAgentSellingPrice(product(MT)) === 18.99)
const agentSale = db.createAgentSale({
  agentId: agent!.id,
  items: [{ productId: MT, qty: 1, sellingPrice: 15 }],
  customerId: ABC,
  paymentMethod: 'cash',
})
check('CASE 8 Agent can sell at RM15', Boolean(agentSale) && agentSale?.items[0]?.price === 15, agentSale?.invoiceNo)
check('CASE 8 Agent cannot sell below Agent Price', !db.createAgentSale({ agentId: agent!.id, items: [{ productId: MT, qty: 1, sellingPrice: 9 }], customerId: ABC }) && lastToast()?.title === belowAgentPriceMessage(10))
const agentRow = db.getSnapshot().agentSales.find((row) => row.saleId === agentSale?.id)
const earning = agentRow ? saleEarningForAgentSale(db.getSnapshot().agentEarningLedgers, agentRow.id) : undefined
check('CASE 8 Agent Earnings still use actual selling price', agentRow?.productMarkup === 5 && earning?.amount === 5)
check('CASE 8 Agent invoice does not become wholesale', !isWholesaleSale(agentSale) && configuredAgentPrice(product(MT)) === 10)

db.switchUser('u-admin')
check('Wholesale invoice numbering still uses INV-', Boolean(case2?.invoiceNo.startsWith('INV-')))
check('Product Pricing Agent Price unchanged by customer pricing', configuredAgentPrice(product(MT)) === 10)
check('Selling Price unchanged by customer pricing', product(MT)?.sellingPrice === 18.99)

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => ` - ${row.name}${row.detail ? `: ${row.detail}` : ''}`).join('\n'))
  process.exit(1)
}
