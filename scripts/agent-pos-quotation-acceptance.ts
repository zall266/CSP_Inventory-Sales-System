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
  currentLinkedAgent,
  posSellingWarehouseId,
  quotationsVisibleToUser,
  salesVisibleToUser,
  saleEarningForAgentSale,
  isAgentWarehouseId,
  isCompanyWarehouseId,
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

db.resetDemo()

const ST = 'p-pack-st'
const MT = 'p-pack-mt'
const CL = 'p-pack-cl'
const WF = 'p-wf'
const SUGAR = 'p-sugar'
const FLOUR = 'p-flour'

const companySale = db.createSale({
  customerId: 'c-walkin',
  warehouseId: 'wh-main',
  items: [{ productId: ST, qty: 1, price: 8 }],
  paidAmount: 8,
  paymentMethod: 'cash',
})
check('TEST 1 company POS creates a company sale', Boolean(companySale && isCompanyWarehouseId(db.getSnapshot().warehouses, companySale.warehouseId)), companySale?.invoiceNo)
check('TEST 1 company POS uses existing sale engine', Boolean(companySale && !companySale.invoiceNo.startsWith('SAL-')))

const agent = db.createAgent({
  name: 'Agent JB',
  code: 'JB01',
  userId: 'u-mei',
  bankName: 'Maybank',
  accountHolder: 'Mei Ling',
  bankAccount: '1234567890',
})
check('Agent linked to existing staff user', Boolean(agent?.userId === 'u-mei'), agent?.id)

for (const productId of [ST, MT, CL, WF, FLOUR]) {
  const ok = db.updateProduct(productId, { agentPrice: 10 })
  check(`Agent Price RM10 on ${productId}`, ok)
}

const transfers = [
  db.transferStockToAgent({ agentId: agent!.id, fromWarehouseId: 'wh-main', productId: ST, qty: 20 }),
  db.transferStockToAgent({ agentId: agent!.id, fromWarehouseId: 'wh-main', productId: MT, qty: 15 }),
  db.transferStockToAgent({ agentId: agent!.id, fromWarehouseId: 'wh-main', productId: WF, qty: 8 }),
]
check('Agent opening stock transferred', transfers.every(Boolean), `ST ${qty(ST, agent!.warehouseId)} MT ${qty(MT, agent!.warehouseId)} CL ${qty(CL, agent!.warehouseId)}`)

const companyAfterAgent = db.createSale({
  customerId: 'c-walkin',
  warehouseId: 'wh-main',
  items: [{ productId: ST, qty: 1, price: 8 }],
  paidAmount: 8,
  paymentMethod: 'cash',
})
check('TEST 25 company POS still sells from company warehouse', Boolean(companyAfterAgent && companyAfterAgent.warehouseId === 'wh-main'))
check('TEST 25 agent stock unchanged by company POS', qty(ST, agent!.warehouseId) === 20)

db.switchUser('u-mei')
const linked = currentLinkedAgent(db.getSnapshot())
check('TEST 2 Agent context from user linkage, not role name', Boolean(linked && linked.id === agent!.id && linked.userId === 'u-mei'))
check('TEST 2 POS warehouse is the Agent warehouse', posSellingWarehouseId(db.getSnapshot()) === agent!.warehouseId)

const snap = db.getSnapshot()
const posCatalog = snap.products.filter((product) => agentPosItemAvailable(product, qty(product.id, agent!.warehouseId)))
check('TEST 3 Strawberry selectable with stock', posCatalog.some((product) => product.id === ST))
check('TEST 3 Matcha selectable with stock', posCatalog.some((product) => product.id === MT))
check('TEST 3 Waffle Premix selectable with stock', posCatalog.some((product) => product.id === WF))
check('TEST 3 Chocolate Lava hidden at stock 0', !posCatalog.some((product) => product.id === CL) && qty(CL, agent!.warehouseId) === 0)

db.switchUser('u-admin')
check('Restock Chocolate Lava for sale tests', db.transferStockToAgent({ agentId: agent!.id, fromWarehouseId: 'wh-main', productId: CL, qty: 4 }))
db.switchUser('u-mei')

const overQty = db.createAgentSale({
  agentId: agent!.id,
  items: [{ productId: MT, qty: 16, sellingPrice: 12 }],
  customerId: 'c-abc-ent',
})
const overToast = lastToast()
check('TEST 6 quantity over stock is blocked', !overQty && qty(MT, agent!.warehouseId) === 15)
check('TEST 6 shows available stock', overToast?.title === 'Insufficient Agent stock.' && (overToast.description ?? '').includes('15'), overToast?.description)

const underPrice = db.createAgentSale({
  agentId: agent!.id,
  items: [{ productId: ST, qty: 1, sellingPrice: 9 }],
  customerId: 'c-abc-ent',
})
check('TEST 7 selling below Agent Price is blocked', !underPrice && lastToast()?.title === 'Selling price cannot be lower than Agent Price.')

const sale = db.createAgentSale({
  agentId: agent!.id,
  items: [
    { productId: ST, qty: 2, sellingPrice: 12 },
    { productId: MT, qty: 2, sellingPrice: 12 },
    { productId: CL, qty: 4, sellingPrice: 13 },
  ],
  delivery: 5,
  customerId: 'c-abc-ent',
  paymentMethod: 'cash',
})
check('TEST 4 multi-item Agent POS sale created', Boolean(sale), sale?.invoiceNo)
check('TEST 4 customer total RM105', sale?.total === 105, String(sale?.total))
check('TEST 4 delivery recorded on sale', sale?.shipping === 5)
check('TEST 4 customer lines keep selling prices', Boolean(sale?.items.every((line) => {
  if (line.productId === ST) return line.qty === 2 && line.price === 12
  if (line.productId === MT) return line.qty === 2 && line.price === 12
  if (line.productId === CL) return line.qty === 4 && line.price === 13
  return false
})))

check('TEST 5 Strawberry deducted to 18', qty(ST, agent!.warehouseId) === 18, String(qty(ST, agent!.warehouseId)))
check('TEST 5 Matcha deducted to 13', qty(MT, agent!.warehouseId) === 13, String(qty(MT, agent!.warehouseId)))
check('TEST 5 Chocolate Lava deducted to 0', qty(CL, agent!.warehouseId) === 0, String(qty(CL, agent!.warehouseId)))

const agentSale = db.getSnapshot().agentSales.find((row) => row.saleId === sale?.id)
const ledgers = db.getSnapshot().agentEarningLedgers.filter((row) => row.relatedAgentSaleId === agentSale?.id)
check('TEST 9 delivery earnings RM5', agentSale?.deliveryEarnings === 5)
check('TEST 4/10 product markup RM20', agentSale?.productMarkup === 20, String(agentSale?.productMarkup))
check('TEST 4 total Agent earnings RM25', agentSale?.totalEarnings === 25, String(agentSale?.totalEarnings))
check('TEST 19 exactly one earning ledger for the sale', ledgers.length === 1 && ledgers[0]?.amount === 25, String(ledgers.length))

const equalSale = db.createAgentSale({
  agentId: agent!.id,
  items: [{ productId: ST, qty: 1, sellingPrice: 10 }],
  customerId: 'c-abc-ent',
})
const equalAgentSale = db.getSnapshot().agentSales.find((row) => row.saleId === equalSale?.id)
check('TEST 8 selling equal to Agent Price is allowed', Boolean(equalSale))
check('TEST 8 markup is RM0', equalAgentSale?.productMarkup === 0, String(equalAgentSale?.productMarkup))

db.switchUser('u-admin')
db.transferStockToAgent({ agentId: agent!.id, fromWarehouseId: 'wh-main', productId: CL, qty: 4 })
db.switchUser('u-mei')

const stockBeforeQuote = {
  st: qty(ST, agent!.warehouseId),
  mt: qty(MT, agent!.warehouseId),
  cl: qty(CL, agent!.warehouseId),
  ledgers: db.getSnapshot().agentEarningLedgers.length,
  movements: db.getSnapshot().stockMovements.length,
}

const quotation = db.createQuotation({
  customerId: 'c-abc-ent',
  items: [
    { productId: ST, qty: 2, price: 12 },
    { productId: MT, qty: 2, price: 12 },
    { productId: CL, qty: 4, price: 13 },
  ],
  shipping: 5,
  notes: 'Customer offer',
})
check('TEST 10 Agent quotation created', Boolean(quotation?.quotationNo.startsWith('QT-')), quotation?.quotationNo)
check('TEST 10 quotation does not deduct stock', qty(ST, agent!.warehouseId) === stockBeforeQuote.st && qty(MT, agent!.warehouseId) === stockBeforeQuote.mt && qty(CL, agent!.warehouseId) === stockBeforeQuote.cl)
check('TEST 10 quotation creates no Agent earnings', db.getSnapshot().agentEarningLedgers.length === stockBeforeQuote.ledgers)
check('TEST 10 quotation creates no stock movement', db.getSnapshot().stockMovements.length === stockBeforeQuote.movements)
check('TEST 11 quotation total RM105', quotation?.total === 105, String(quotation?.total))
check('TEST 11 quotation delivery RM5', quotation?.shipping === 5)
check('TEST 12 customer sees selling prices only', Boolean(quotation && !('agentPrice' in quotation) && quotation.items.every((line) => !('agentPrice' in line) && !('productMarkup' in line))))
check('TEST 12/18 quotation tagged to this Agent', quotation?.agentId === agent!.id)

const otherQuotes = quotationsVisibleToUser(db.getSnapshot(), db.getSnapshot().quotations)
check('TEST 18 Agent quotations are own-only', otherQuotes.every((row) => row.agentId === agent!.id))

const converted = db.convertQuotationToInvoice(quotation!.id)
const convertedAgentSale = db.getSnapshot().agentSales.find((row) => row.saleId === converted?.id)
check('TEST 14 quotation converts to Agent sale', Boolean(converted && converted.invoiceNo.startsWith('SAL-')))
check('TEST 14 convert deducts current Agent stock', qty(ST, agent!.warehouseId) === stockBeforeQuote.st - 2 && qty(CL, agent!.warehouseId) === 0)
check('TEST 14 convert creates earnings once', convertedAgentSale?.totalEarnings === 25 && Boolean(saleEarningForAgentSale(db.getSnapshot().agentEarningLedgers, convertedAgentSale!.id)))
check('TEST 16 invoice hides Agent internals', Boolean(converted && !('agentPrice' in converted) && !('productMarkup' in converted) && !('totalEarnings' in converted) && converted.items.every((line) => line.price >= 12)))
check('TEST 16 invoice keeps selling prices and delivery', converted?.shipping === 5 && converted?.total === 105)

const shortQuote = db.createQuotation({
  customerId: 'c-abc-ent',
  items: [{ productId: ST, qty: 10, price: 12 }],
  shipping: 0,
})
check('TEST 15 quotation saved while stock is sufficient', Boolean(shortQuote) && qty(ST, agent!.warehouseId) >= 10)

const drain = db.createAgentSale({
  agentId: agent!.id,
  items: [{ productId: ST, qty: qty(ST, agent!.warehouseId) - 6, sellingPrice: 12 }],
  customerId: 'c-abc-ent',
})
check('TEST 15 later stock reduced below quoted qty', Boolean(drain) && qty(ST, agent!.warehouseId) === 6, String(qty(ST, agent!.warehouseId)))

const blockedConvert = db.convertQuotationToInvoice(shortQuote!.id)
const blockedToast = lastToast()
check('TEST 15 conversion blocked when current stock is insufficient', !blockedConvert && qty(ST, agent!.warehouseId) === 6)
check('TEST 15 conversion shows available stock', blockedToast?.title === 'Insufficient Agent stock.' && (blockedToast.description ?? '').includes('6'), blockedToast?.description)

const ownSales = salesVisibleToUser(db.getSnapshot(), db.getSnapshot().sales)
check('TEST 18 Agent sales history is own warehouse only', ownSales.every((row) => row.warehouseId === agent!.warehouseId))

db.switchUser('u-admin')
const second = db.createAgent({
  name: 'Agent KL',
  code: 'KL01',
  userId: 'u-siti',
  bankName: 'CIMB',
  accountHolder: 'Siti Nurhaliza',
  bankAccount: '99887766',
})
db.transferStockToAgent({ agentId: second!.id, fromWarehouseId: 'wh-main', productId: ST, qty: 5 })
db.switchUser('u-siti')
const otherSale = db.createAgentSale({
  agentId: second!.id,
  items: [{ productId: ST, qty: 1, sellingPrice: 12 }],
  customerId: 'c-walkin',
})
db.switchUser('u-mei')
const meiSales = salesVisibleToUser(db.getSnapshot(), db.getSnapshot().sales)
const meiQuotes = quotationsVisibleToUser(db.getSnapshot(), db.getSnapshot().quotations)
check('TEST 18 Agent cannot see another Agent sale', Boolean(otherSale) && !meiSales.some((row) => row.id === otherSale?.id))
check('TEST 18 Agent cannot see another Agent quotation', !meiQuotes.some((row) => row.agentId === second!.id))

db.switchUser('u-admin')
db.updateProduct(SUGAR, { sellable: false, agentPrice: 3 })
db.updateProduct(FLOUR, { sellable: true, agentPrice: 10 })
db.transferStockToAgent({ agentId: agent!.id, fromWarehouseId: 'wh-main', productId: FLOUR, qty: 2 })
db.transferStockToAgent({ agentId: agent!.id, fromWarehouseId: 'wh-main', productId: SUGAR, qty: 2 })
db.switchUser('u-mei')
check('TEST 21 Raw Material Sellable OFF cannot be sold', !productIsSellable(db.getSnapshot().products.find((product) => product.id === SUGAR)))
const sugarSale = db.createAgentSale({
  agentId: agent!.id,
  items: [{ productId: SUGAR, qty: 1, sellingPrice: 6 }],
  customerId: 'c-abc-ent',
})
check('TEST 21 unsellable raw material blocked in Agent POS', !sugarSale)
const flourSale = db.createAgentSale({
  agentId: agent!.id,
  items: [{ productId: FLOUR, qty: 1, sellingPrice: 12 }],
  customerId: 'c-abc-ent',
})
check('TEST 20 Raw Material Sellable ON can be sold without duplicating the SKU', Boolean(flourSale) && db.getSnapshot().products.filter((product) => product.id === FLOUR).length === 1)

db.switchUser('u-admin')
const companyQuote = db.createQuotation({
  customerId: 'c-abc-ent',
  items: [{ productId: ST, qty: 1, price: 8 }],
})
check('TEST 26 company quotation has no Agent id', Boolean(companyQuote) && !companyQuote?.agentId)
const companyInvoice = db.convertQuotationToInvoice(companyQuote!.id)
check('TEST 26 company quotation converts through existing invoice sale', Boolean(companyInvoice && companyInvoice.invoiceNo.startsWith('INV-') && isCompanyWarehouseId(db.getSnapshot().warehouses, companyInvoice.warehouseId)))

const withdrawal = db.requestAgentWithdrawal({ agentId: agent!.id, amount: 10 })
check('TEST 22 existing Agent withdrawal still works', Boolean(withdrawal && withdrawal.status === 'requested'), withdrawal?.id)

const after = db.getSnapshot()
check('TEST 23 Warehouse Map data still present', (after.storageLocations?.length ?? 0) > 0 && (after.storageSlots?.length ?? 0) > 0)
check('TEST 24 Manufacturing sessions still present', (after.productionSessions?.length ?? 0) > 0)
check('TEST 21/25 company catalogue still includes unsellable-off only when flagged', productIsSellable(after.products.find((product) => product.id === ST)))
check('Agent warehouses stay hidden from company warehouse kind', after.warehouses.filter((warehouse) => warehouse.kind === 'agent').every((warehouse) => isAgentWarehouseId(after.warehouses, warehouse.id)))

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => ` - ${row.name}${detailLine(row)}`).join('\n'))
  process.exit(1)
}

function detailLine(row: Check) {
  return row.detail ? `: ${row.detail}` : ''
}
