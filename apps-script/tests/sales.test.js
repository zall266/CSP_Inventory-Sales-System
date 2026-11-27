import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createFakeDrive,
  createFakeSpreadsheet,
  devProperties,
  loadBackend,
} from './harness.js'

function app() {
  const spreadsheet = createFakeSpreadsheet()
  const drive = createFakeDrive('drive-id')
  const properties = devProperties()
  const context = loadBackend({
    PropertiesService: { getScriptProperties: () => properties },
    LockService: {
      getScriptLock() {
        return { tryLock: () => true, releaseLock() {} }
      },
    },
    SpreadsheetApp: { openById: () => spreadsheet },
    DriveApp: drive,
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) {
        return { text, setMimeType() { return this } }
      },
    },
  })
  const sheets = context.createSheetRepository({ openSpreadsheet: () => spreadsheet })
  const driveStorage = context.createDriveStorage({
    getRoot: () => drive.getFolderById('drive-id'),
    getFileById: (id) => drive.getFileById(id),
  })
  return {
    sheets,
    spreadsheet,
    context,
    system: context.createSystemService({ sheetRepository: sheets, driveStorage }),
    idempotency: context.createIdempotencyService(sheets),
    foundation: context.createFoundationService(sheets),
    identity: context.createIdentityService({ sheetRepository: sheets, driveStorage }),
    masters: context.createMasterService({ sheetRepository: sheets }),
    products: context.createProductService({ sheetRepository: sheets }),
    parties: context.createPartyService({ sheetRepository: sheets }),
    inventory: context.createInventoryService({ sheetRepository: sheets }),
    purchases: context.createPurchaseService({ sheetRepository: sheets }),
    sales: context.createSalesService({ sheetRepository: sheets }),
  }
}

function request(action, payload, extra = {}) {
  return { v: 1, requestId: extra.requestId || action, action, payload, idempotencyKey: extra.idempotencyKey }
}

function call(backend, action, payload, extra) {
  return backend.context.handleRequest(request(action, payload, extra), backend)
}

let keySeq = 0
function post(backend, action, payload, extra = {}) {
  keySeq += 1
  return call(backend, action, payload, {
    idempotencyKey: extra.idempotencyKey || `sal-${keySeq}`,
    requestId: extra.requestId || `req-${keySeq}`,
  })
}

function identityPayload() {
  return {
    departments: [{ id: 'dept-sales', name: 'Sales', status: 'active' }],
    roles: [
      { id: 'role-owner', name: 'Owner', description: 'Owner', status: 'active', protected: true, legacyRole: 'owner' },
      { id: 'role-staff', name: 'Staff', description: 'Staff', status: 'active', protected: false, legacyRole: 'staff' },
      { id: 'role-cashier', name: 'Cashier', description: 'Cashier', status: 'active', protected: false, legacyRole: 'cashier' },
    ],
    users: [
      { id: 'u-aina', name: 'Aina Rahman', email: 'aina@coolslurppy.my', roleId: 'role-owner', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-mei', name: 'Mei Ling', email: 'mei@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-siti', name: 'Siti', email: 'siti@coolslurppy.my', roleId: 'role-cashier', departmentId: 'dept-sales', status: 'active' },
    ],
    settings: {
      businessName: 'Cool Slurppy', legalName: 'Cool Slurppy Sdn Bhd', logoUrl: '', phone: '03',
      email: 'hello@coolslurppy.my', address: 'KL', website: '', registrationNo: '', bankName: '',
      bankAccount: '', paymentTerms: 'Net 7 days', documentTerms: 'Terms', currency: 'MYR',
      defaultWarehouseId: 'wh-main', allowNegativeStock: false, costingMethod: 'average',
      batchTracking: true, expiryTracking: true, defaultCustomerId: 'c-walkin', allowDiscount: true,
      allowReturns: true, enabledPaymentMethods: ['cash'], roleMatrix: {
        'role-cashier': {
          'sales.view': true, 'sales.create': true, 'sales.edit': true,
          'sales.invoice.view': true, 'sales.invoice.print': true,
          'sales.quotation.view': true, 'sales.quotation.print': true,
        },
      },
    },
    userAuditLogs: [],
  }
}

function ready(options = {}) {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(call(backend, 'identity.bootstrap', identityPayload()).ok, true)
  assert.equal(call(backend, 'masters.bootstrap', {
    warehouses: [
      { id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', kind: 'company' },
      { id: 'wh-agent', name: 'Agent Shelf', code: 'AG1', kind: 'agent' },
    ],
    categories: [{ id: 'cat-pack', name: 'Packs' }],
  }).ok, true)
  assert.equal(call(backend, 'parties.bootstrap', {
    suppliers: options.suppliers
      ? [{ id: 'sup-1', name: 'Sugar Supplier', contact: '', phone: '', email: '', status: 'active' }]
      : [],
    customers: [
      { id: 'c-walkin', name: 'Walk-in', phone: '-', email: '', address: '', status: 'active' },
      { id: 'c-cafe', name: 'Cafe One', phone: '03-1', email: 'cafe@x.my', address: 'PJ', status: 'active' },
    ],
    agents: [],
    customerWholesalePrices: [],
  }).ok, true)
  return backend
}

function addProduct(backend, row) {
  const result = call(backend, 'products.create', {
    actorUserId: 'u-aina',
    categoryId: 'cat-pack',
    sellingPrice: 12,
    wholesalePrice: 9,
    purchaseCost: 4,
    unit: 'PCS',
    purchaseUnit: 'PCS',
    purchaseConversionQty: 1,
    ...row,
  })
  assert.equal(result.ok, true, result.error && result.error.message)
}

function stock(backend, productId, qty, warehouseId = 'wh-main') {
  const result = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId, productId, type: 'increase', qty, reason: 'UAT sales stock',
  })
  assert.equal(result.ok, true, result.error && result.error.message)
}

function qty(data, productId, warehouseId = 'wh-main') {
  const row = (data.inventory || []).find((item) => item.productId === productId && item.warehouseId === warehouseId)
  return row ? row.qty : 0
}

function movements(data, reference) {
  return (data.stockMovements || []).filter((row) => row.reference === reference)
}

test('health does not create sales sheets and Sheet1 stays reserved', () => {
  const backend = app()
  backend.foundation.initialize()
  const health = call(backend, 'system.health', {})
  assert.equal(health.ok, true)
  assert.equal(backend.spreadsheet.store.Sales, undefined)
  assert.equal(backend.spreadsheet.store.Quotations, undefined)
  assert.equal(backend.spreadsheet.store.DeliveryOrders, undefined)
  assert.ok(backend.spreadsheet.store.Sheet1)
})

test('cashier can create a POS sale and cannot void or quote', () => {
  const backend = ready()
  addProduct(backend, { id: 'p-pack', name: 'Matcha Pack', sku: 'MT001', sellable: true })
  stock(backend, 'p-pack', 10)

  const listed = call(backend, 'sales.list', { actorUserId: 'u-siti' })
  assert.equal(listed.ok, true)

  const missingKey = call(backend, 'sales.create', {
    actorUserId: 'u-siti',
    customerId: 'c-walkin',
    warehouseId: 'wh-main',
    items: [{ productId: 'p-pack', qty: 2, price: 12 }],
    paymentMethod: 'cash',
    paidAmount: 24,
  })
  assert.equal(missingKey.error.message, 'Idempotency key is required.')

  const sale = post(backend, 'sales.create', {
    actorUserId: 'u-siti',
    clientId: 'sal_pos_1',
    customerId: 'c-walkin',
    warehouseId: 'wh-main',
    items: [{ productId: 'p-pack', qty: 2, price: 12 }],
    paymentMethod: 'cash',
    paidAmount: 24,
  })
  assert.equal(sale.ok, true, sale.error && sale.error.message)
  assert.equal(sale.data.sale.status, 'paid')
  assert.equal(sale.data.sale.invoiceNo, 'INV-000001')
  assert.equal(qty(sale.data, 'p-pack'), 8)
  assert.equal(movements(sale.data, 'INV-000001').length, 1)
  assert.equal(movements(sale.data, 'INV-000001')[0].type, 'sale')
  assert.equal(movements(sale.data, 'INV-000001')[0].stockOut, 2)
  assert.equal(sale.data.payments[0].partyType, 'customer')
  assert.equal(sale.data.payments[0].paymentNo, 'PAY-000001')

  const firstKeyed = post(backend, 'sales.create', {
    actorUserId: 'u-siti',
    clientId: 'sal_pos_replay',
    customerId: 'c-walkin',
    warehouseId: 'wh-main',
    items: [{ productId: 'p-pack', qty: 1, price: 12 }],
    paymentMethod: 'cash',
    paidAmount: 12,
  }, { idempotencyKey: 'pos-replay' })
  assert.equal(firstKeyed.ok, true)
  const replayKeyed = post(backend, 'sales.create', {
    actorUserId: 'u-siti',
    clientId: 'sal_pos_replay',
    customerId: 'c-walkin',
    warehouseId: 'wh-main',
    items: [{ productId: 'p-pack', qty: 1, price: 12 }],
    paymentMethod: 'cash',
    paidAmount: 12,
  }, { idempotencyKey: 'pos-replay' })
  assert.equal(replayKeyed.ok, true)
  assert.equal(replayKeyed.meta.idempotentReplay, true)
  assert.equal(qty(replayKeyed.data, 'p-pack'), qty(firstKeyed.data, 'p-pack'))

  const voidDenied = post(backend, 'sales.void', { actorUserId: 'u-siti', id: sale.data.sale.id })
  assert.equal(voidDenied.error.code, 'FORBIDDEN')

  const quoteDenied = call(backend, 'quotations.create', {
    actorUserId: 'u-siti',
    customerId: 'c-cafe',
    items: [{ productId: 'p-pack', qty: 1, price: 12 }],
  })
  assert.equal(quoteDenied.error.code, 'FORBIDDEN')
})

test('sale posts component SKUs only, void restores remaining qty, and payment status matches the UI', () => {
  const backend = ready()
  addProduct(backend, { id: 'p-cup', name: 'Cup', sku: 'CUP001', sellable: true })
  addProduct(backend, {
    id: 'p-pack',
    name: 'Pack',
    sku: 'PCK001',
    sellable: true,
    salesComponents: [{ productId: 'p-cup', qty: 2 }],
  })
  stock(backend, 'p-cup', 10)
  stock(backend, 'p-pack', 5)

  const unpaid = post(backend, 'sales.create', {
    actorUserId: 'u-aina',
    clientId: 'sal_comp_1',
    customerId: 'c-cafe',
    warehouseId: 'wh-main',
    items: [{ productId: 'p-pack', qty: 2, price: 12 }],
    paidAmount: 0,
  })
  assert.equal(unpaid.ok, true, unpaid.error && unpaid.error.message)
  assert.equal(unpaid.data.sale.status, 'unpaid')
  assert.equal(unpaid.data.sale.balance, 24)
  assert.equal(qty(unpaid.data, 'p-pack'), 5)
  assert.equal(qty(unpaid.data, 'p-cup'), 6)
  const saleMoves = movements(unpaid.data, unpaid.data.sale.invoiceNo)
  assert.equal(saleMoves.length, 1)
  assert.equal(saleMoves[0].productId, 'p-cup')
  assert.equal(saleMoves[0].stockOut, 4)
  assert.equal(unpaid.data.sale.items[0].salesComponentsSnapshot[0].qty, 4)

  const pay = post(backend, 'sales.recordPayment', {
    actorUserId: 'u-aina',
    invoiceId: unpaid.data.sale.id,
    method: 'cash',
    amount: 10,
  })
  assert.equal(pay.ok, true, pay.error && pay.error.message)
  assert.equal(pay.data.sale.status, 'partial')
  assert.equal(pay.data.sale.paid, 10)
  assert.equal(pay.data.sale.balance, 14)
  assert.equal(pay.data.payment.partyType, 'customer')

  const payRest = post(backend, 'sales.recordPayment', {
    actorUserId: 'u-aina',
    invoiceId: unpaid.data.sale.id,
    method: 'cash',
    amount: 20,
  })
  assert.equal(payRest.data.sale.status, 'paid')
  assert.equal(payRest.data.sale.balance, 0)

  const nothing = post(backend, 'sales.recordPayment', {
    actorUserId: 'u-aina',
    invoiceId: unpaid.data.sale.id,
    method: 'cash',
    amount: 1,
  })
  assert.equal(nothing.error.message, 'Nothing to collect')

  const voided = post(backend, 'sales.void', { actorUserId: 'u-aina', id: unpaid.data.sale.id }, { idempotencyKey: 'void-1' })
  assert.equal(voided.ok, true, voided.error && voided.error.message)
  assert.equal(voided.data.sale.status, 'voided')
  assert.equal(voided.data.sale.balance, 0)
  assert.equal(qty(voided.data, 'p-cup'), 10)
  assert.equal(qty(voided.data, 'p-pack'), 5)
  const voidMoves = movements(voided.data, `${unpaid.data.sale.invoiceNo}-VOID`)
  assert.equal(voidMoves.length, 1)
  assert.equal(voidMoves[0].type, 'sales_return')
  assert.equal(voidMoves[0].stockIn, 4)
  assert.equal(voided.data.documentAuditLogs[0].action, 'invoice_cancelled')
  assert.equal(voided.data.documentAuditLogs[0].newValue, 'cancelled')

  const replayVoid = post(backend, 'sales.void', { actorUserId: 'u-aina', id: unpaid.data.sale.id }, { idempotencyKey: 'void-1' })
  assert.equal(replayVoid.meta.idempotentReplay, true)
  assert.equal(qty(replayVoid.data, 'p-cup'), 10)

  const secondVoid = post(backend, 'sales.void', { actorUserId: 'u-aina', id: unpaid.data.sale.id }, { idempotencyKey: 'void-2' })
  assert.equal(secondVoid.error.code, 'CONFLICT')
})

test('wholesale uses customer price, agent warehouse is rejected, and shortage is blocked', () => {
  const backend = ready()
  addProduct(backend, { id: 'p-pack', name: 'Pack', sku: 'PCK001', sellingPrice: 12, wholesalePrice: 9 })
  assert.equal(call(backend, 'customers.saveWholesalePrice', {
    actorUserId: 'u-aina',
    id: 'cwp-1',
    customerId: 'c-cafe',
    productId: 'p-pack',
    price: 8,
    active: true,
  }).ok, true)
  stock(backend, 'p-pack', 3)

  const wholesale = post(backend, 'sales.createWholesale', {
    actorUserId: 'u-aina',
    customerId: 'c-cafe',
    warehouseId: 'wh-main',
    items: [{ productId: 'p-pack', qty: 1 }],
  })
  assert.equal(wholesale.ok, true, wholesale.error && wholesale.error.message)
  assert.equal(wholesale.data.sale.pricingMode, 'wholesale')
  assert.equal(wholesale.data.sale.items[0].price, 8)
  assert.equal(wholesale.data.sale.status, 'unpaid')

  const agentWh = post(backend, 'sales.create', {
    actorUserId: 'u-aina',
    customerId: 'c-walkin',
    warehouseId: 'wh-agent',
    items: [{ productId: 'p-pack', qty: 1, price: 12 }],
  })
  assert.equal(agentWh.error.message, 'Agent stock sales must use the Agent sale flow.')

  const short = post(backend, 'sales.create', {
    actorUserId: 'u-aina',
    customerId: 'c-walkin',
    warehouseId: 'wh-main',
    items: [{ productId: 'p-pack', qty: 5, price: 12 }],
  })
  assert.equal(short.error.message, 'Pack has 2 available.')
})

test('quotation convert posts a dated invoice once and delivery does not move stock', () => {
  const backend = ready()
  addProduct(backend, { id: 'p-pack', name: 'Pack', sku: 'PCK001', sellingPrice: 12 })
  stock(backend, 'p-pack', 10)

  const quote = call(backend, 'quotations.create', {
    actorUserId: 'u-aina',
    clientId: 'qt_1',
    customerId: 'c-cafe',
    items: [{ productId: 'p-pack', qty: 2, price: 11, discount: 0 }],
    shipping: 3,
  })
  assert.equal(quote.ok, true, quote.error && quote.error.message)
  assert.match(quote.data.quotation.quotationNo, /^QT-\d{8}-001$/)
  assert.equal(quote.data.quotation.status, 'draft')
  assert.equal(qty(quote.data, 'p-pack'), 10)

  const issued = call(backend, 'quotations.setStatus', {
    actorUserId: 'u-aina',
    id: quote.data.quotation.id,
    status: 'sent',
  })
  assert.equal(issued.data.quotation.status, 'sent')

  const converted = post(backend, 'quotations.convert', {
    actorUserId: 'u-aina',
    id: quote.data.quotation.id,
    clientSaleId: 'sal_from_qt',
  }, { idempotencyKey: 'convert-1' })
  assert.equal(converted.ok, true, converted.error && converted.error.message)
  assert.match(converted.data.sale.invoiceNo, /^INV-\d{8}-001$/)
  assert.equal(converted.data.sale.status, 'unpaid')
  assert.equal(converted.data.sale.quotationId, quote.data.quotation.id)
  assert.equal(converted.data.sale.shipping, 3)
  assert.equal(qty(converted.data, 'p-pack'), 8)
  const convertedQuote = converted.data.quotations.find((row) => row.id === quote.data.quotation.id)
  assert.equal(convertedQuote.status, 'accepted')
  assert.equal(convertedQuote.convertedSaleId, converted.data.sale.id)

  const replay = post(backend, 'quotations.convert', {
    actorUserId: 'u-aina',
    id: quote.data.quotation.id,
  }, { idempotencyKey: 'convert-1' })
  assert.equal(replay.meta.idempotentReplay, true)
  assert.equal(qty(replay.data, 'p-pack'), 8)

  const again = post(backend, 'quotations.convert', {
    actorUserId: 'u-aina',
    id: quote.data.quotation.id,
  }, { idempotencyKey: 'convert-2' })
  assert.equal(again.ok, true)
  assert.equal(again.data.sale.id, converted.data.sale.id)
  assert.equal(qty(again.data, 'p-pack'), 8)

  const agentQuote = call(backend, 'quotations.create', {
    actorUserId: 'u-aina',
    customerId: 'c-cafe',
    agentId: 'ag-1',
    items: [{ productId: 'p-pack', qty: 1, price: 12 }],
  })
  const agentConvert = post(backend, 'quotations.convert', { actorUserId: 'u-aina', id: agentQuote.data.quotation.id })
  assert.equal(agentConvert.error.message, 'Agent stock sales must use the Agent sale flow.')

  const delivery = call(backend, 'deliveries.create', {
    actorUserId: 'u-aina',
    customerId: 'c-cafe',
    saleId: converted.data.sale.id,
    items: [],
  })
  assert.equal(delivery.ok, true, delivery.error && delivery.error.message)
  assert.match(delivery.data.deliveryOrder.doNo, /^DO-\d{8}-001$/)
  assert.equal(delivery.data.deliveryOrder.saleId, converted.data.sale.id)
  assert.equal(delivery.data.deliveryOrder.quotationId, quote.data.quotation.id)
  assert.equal(qty(delivery.data, 'p-pack'), 8)

  const issuedDo = call(backend, 'deliveries.setStatus', {
    actorUserId: 'u-aina',
    id: delivery.data.deliveryOrder.id,
    status: 'issued',
  })
  assert.equal(issuedDo.data.deliveryOrder.status, 'issued')
  assert.equal(qty(issuedDo.data, 'p-pack'), 8)

  const printed = call(backend, 'documents.recordPrint', {
    actorUserId: 'u-aina',
    type: 'invoice',
    id: converted.data.sale.id,
  })
  assert.equal(printed.ok, true)
  assert.equal(printed.data.documentAuditLogs[0].action, 'invoice_printed')

  const cashierPrint = call(backend, 'documents.recordPrint', {
    actorUserId: 'u-siti',
    type: 'delivery',
    id: delivery.data.deliveryOrder.id,
  })
  assert.equal(cashierPrint.error.code, 'FORBIDDEN')
})

test('customer payments share PAY numbers with supplier payments and do not rewrite purchases', () => {
  const backend = ready({ suppliers: true })
  addProduct(backend, { id: 'p-pack', name: 'Pack', sku: 'PCK001' })
  stock(backend, 'p-pack', 5)
  const bought = post(backend, 'purchases.create', {
    actorUserId: 'u-aina',
    supplierId: 'sup-1',
    warehouseId: 'wh-main',
    items: [{ productId: 'p-pack', qty: 1, price: 4 }],
    receive: true,
    paidAmount: 4,
  })
  assert.equal(bought.ok, true, bought.error && bought.error.message)
  assert.equal(bought.data.payments[0].paymentNo, 'PAY-000001')

  const sale = post(backend, 'sales.create', {
    actorUserId: 'u-aina',
    customerId: 'c-walkin',
    warehouseId: 'wh-main',
    items: [{ productId: 'p-pack', qty: 1, price: 12 }],
    paymentMethod: 'cash',
    paidAmount: 12,
  })
  assert.equal(sale.ok, true, sale.error && sale.error.message)
  const payNos = sale.data.payments.map((row) => row.paymentNo).sort()
  assert.deepEqual(payNos, ['PAY-000001', 'PAY-000002'])
  assert.equal(sale.data.payments.filter((row) => row.partyType === 'supplier').length, 1)
  assert.equal(sale.data.payments.filter((row) => row.partyType === 'customer').length, 1)
  assert.equal(sale.data.purchases, undefined)
})
