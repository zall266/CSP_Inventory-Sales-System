import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createFakeDrive,
  createFakeSpreadsheet,
  devProperties,
  loadBackend,
} from './harness.js'

const SKIP_BALANCE_TYPES = new Set([
  'sales_return_repack',
  'sales_return_waste',
  'production_balance_in',
  'production_balance_out',
  'production_wastage',
])

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
    warehouse: context.createWarehouseService({ sheetRepository: sheets }),
    purchases: context.createPurchaseService({ sheetRepository: sheets }),
    sales: context.createSalesService({ sheetRepository: sheets }),
    salesReturns: context.createSalesReturnService({ sheetRepository: sheets }),
    ops: context.createOpsService({ sheetRepository: sheets, driveStorage }),
    reporting: context.createReportingService({ sheetRepository: sheets }),
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
    idempotencyKey: extra.idempotencyKey || `int-${keySeq}`,
    requestId: extra.requestId || `req-int-${keySeq}`,
  })
}

function malaysiaToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const pick = (type) => parts.find((part) => part.type === type).value
  return `${pick('year')}-${pick('month')}-${pick('day')}`
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
        },
      },
    },
    userAuditLogs: [],
  }
}

function ready() {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(call(backend, 'identity.bootstrap', identityPayload()).ok, true)
  assert.equal(call(backend, 'masters.bootstrap', {
    warehouses: [{ id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', kind: 'company' }],
    categories: [
      { id: 'cat-ing', name: 'Ingredients' },
      { id: 'cat-pack', name: 'Packs' },
    ],
  }).ok, true)
  assert.equal(call(backend, 'parties.bootstrap', {
    suppliers: [{ id: 'sup-1', name: 'Sugar Supplier', code: 'SUP1', status: 'active' }],
    customers: [
      { id: 'c-walkin', name: 'Walk-in', phone: '-', email: '', address: '', status: 'active' },
      { id: 'c-cafe', name: 'Cafe One', phone: '03-1', email: 'cafe@x.my', address: 'PJ', status: 'active' },
    ],
    agents: [],
    customerWholesalePrices: [],
  }).ok, true)
  assert.equal(call(backend, 'products.create', {
    actorUserId: 'u-aina', id: 'p-int-sugar', name: 'INT Sugar', categoryId: 'cat-ing',
    unit: 'KG', purchaseUnit: 'BAG', purchaseConversionQty: 25, purchaseCost: 50, sellingPrice: 12,
  }).ok, true)
  assert.equal(call(backend, 'products.create', {
    actorUserId: 'u-aina', id: 'p-int-pack', name: 'INT Pack', sku: 'INT001', categoryId: 'cat-pack',
    unit: 'PCS', purchaseUnit: 'PCS', purchaseConversionQty: 1, purchaseCost: 4, sellingPrice: 12,
    wholesalePrice: 9, sellable: true,
  }).ok, true)
  return backend
}

function qty(data, productId, warehouseId = 'wh-main') {
  const row = (data.inventory || []).find((item) => item.productId === productId && item.warehouseId === warehouseId)
  return row ? row.qty : 0
}

function expectedQty(data, productId, warehouseId = 'wh-main') {
  let stockIn = 0
  let stockOut = 0
  for (const row of data.stockMovements || []) {
    if (row.productId !== productId || row.warehouseId !== warehouseId) continue
    if (SKIP_BALANCE_TYPES.has(row.type)) continue
    stockIn += Number(row.stockIn || 0)
    stockOut += Number(row.stockOut || 0)
  }
  return Math.round((stockIn - stockOut) * 100) / 100
}

function assertLedger(data, productId, warehouseId = 'wh-main') {
  assert.equal(qty(data, productId, warehouseId), expectedQty(data, productId, warehouseId))
}

test('health does not create business sheets and Sheet1 stays reserved', () => {
  const backend = app()
  backend.foundation.initialize()
  const health = call(backend, 'system.health', {})
  assert.equal(health.ok, true)
  assert.equal(backend.spreadsheet.store.Purchases, undefined)
  assert.equal(backend.spreadsheet.store.Sales, undefined)
  assert.equal(backend.spreadsheet.store.SalesReturns, undefined)
  assert.equal(backend.spreadsheet.store.Expenses, undefined)
  assert.ok(backend.spreadsheet.store.Sheet1)
})

test('procurement to sales return to dashboard reconciles and denies cashier writes', () => {
  const backend = ready()
  const today = malaysiaToday()

  const cashierPurchase = call(backend, 'purchases.create', {
    actorUserId: 'u-siti',
    supplierId: 'sup-1',
    warehouseId: 'wh-main',
    invoiceNumber: 'INT-PUR-1',
    items: [{ productId: 'p-int-sugar', qty: 2, price: 50 }],
    receive: false,
  })
  assert.equal(cashierPurchase.error.code, 'FORBIDDEN')

  const cashierExpense = call(backend, 'expenses.create', {
    actorUserId: 'u-siti', category: 'Rent', description: 'INT rent', amount: 10, paymentMethod: 'cash',
  })
  assert.equal(cashierExpense.error.code, 'FORBIDDEN')
  assert.equal(cashierExpense.error.message, 'You cannot manage expenses.')

  const draft = call(backend, 'purchases.create', {
    actorUserId: 'u-aina',
    clientId: 'pur_int_1',
    supplierId: 'sup-1',
    warehouseId: 'wh-main',
    invoiceNumber: 'INT-PUR-1',
    items: [{ productId: 'p-int-sugar', qty: 2, price: 50 }],
    receive: false,
  })
  assert.equal(draft.ok, true, draft.error && draft.error.message)
  assert.equal(draft.data.purchase.status, 'draft')
  assert.equal(qty(draft.data, 'p-int-sugar'), 0)

  const received = post(backend, 'purchases.receive', { actorUserId: 'u-aina', id: draft.data.purchase.id }, { idempotencyKey: 'recv-int-1' })
  assert.equal(received.ok, true, received.error && received.error.message)
  assert.equal(received.data.purchase.status, 'received')
  assert.equal(qty(received.data, 'p-int-sugar'), 50)
  assertLedger(received.data, 'p-int-sugar')

  const replayReceive = post(backend, 'purchases.receive', { actorUserId: 'u-aina', id: draft.data.purchase.id }, { idempotencyKey: 'recv-int-1' })
  assert.equal(replayReceive.ok, true)
  assert.equal(replayReceive.meta.idempotentReplay, true)
  assert.equal(qty(replayReceive.data, 'p-int-sugar'), 50)

  const paid = post(backend, 'purchases.recordPayment', {
    actorUserId: 'u-aina',
    invoiceId: draft.data.purchase.id,
    method: 'bank_transfer',
    amount: 100,
  })
  assert.equal(paid.ok, true, paid.error && paid.error.message)
  assert.equal(paid.data.purchase.status, 'paid')
  assert.equal(paid.data.purchase.balance, 0)

  const returned = post(backend, 'purchaseReturns.create', {
    actorUserId: 'u-aina',
    purchaseId: draft.data.purchase.id,
    items: [{ productId: 'p-int-sugar', qty: 1 }],
    reason: 'INT damaged',
  })
  assert.equal(returned.ok, true, returned.error && returned.error.message)
  assert.equal(qty(returned.data, 'p-int-sugar'), 49)
  assertLedger(returned.data, 'p-int-sugar')

  const stocked = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'p-int-pack', type: 'increase', qty: 10, reason: 'INT pack stock',
  })
  assert.equal(stocked.ok, true, stocked.error && stocked.error.message)
  assert.equal(qty(stocked.data, 'p-int-pack'), 10)
  assertLedger(stocked.data, 'p-int-pack')

  const sale = post(backend, 'sales.create', {
    actorUserId: 'u-aina',
    clientId: 'sal_int_1',
    customerId: 'c-cafe',
    warehouseId: 'wh-main',
    items: [{ productId: 'p-int-pack', qty: 4, price: 12 }],
    paidAmount: 0,
  })
  assert.equal(sale.ok, true, sale.error && sale.error.message)
  assert.equal(qty(sale.data, 'p-int-pack'), 6)
  assertLedger(sale.data, 'p-int-pack')
  assert.equal(sale.data.sale.status, 'unpaid')
  assert.equal(sale.data.sale.balance, 48)

  const collected = post(backend, 'sales.recordPayment', {
    actorUserId: 'u-aina',
    invoiceId: sale.data.sale.id,
    method: 'cash',
    amount: 48,
  })
  assert.equal(collected.ok, true, collected.error && collected.error.message)
  assert.equal(collected.data.sale.balance, 0)
  assert.equal(qty(collected.data, 'p-int-pack'), 6)

  const listedReturns = call(backend, 'salesReturns.list', { actorUserId: 'u-aina' })
  assert.equal(listedReturns.ok, true)
  const source = listedReturns.data.returnSources.find((row) => row.id === 'rs-shopee')
  const reason = listedReturns.data.returnReasons.find((row) => row.id === 'rr-changed-mind')
  assert.ok(source)
  assert.ok(reason)

  const savedReturn = call(backend, 'salesReturns.save', {
    actorUserId: 'u-aina',
    clientId: 'sret_int_cross',
    sourceId: source.id,
    reasonId: reason.id,
    originalSaleId: sale.data.sale.id,
    items: [{ productId: 'p-int-pack', returnedQty: 2, unit: 'PCS', goodQty: 2, repackQty: 0, wasteQty: 0 }],
  })
  assert.equal(savedReturn.ok, true, savedReturn.error && savedReturn.error.message)
  assert.equal(qty(savedReturn.data, 'p-int-pack'), 6)

  const confirmed = post(backend, 'salesReturns.confirm', { actorUserId: 'u-aina', id: savedReturn.data.salesReturn.id })
  assert.equal(confirmed.ok, true, confirmed.error && confirmed.error.message)
  assert.equal(confirmed.data.salesReturn.status, 'confirmed')
  assert.equal(qty(confirmed.data, 'p-int-pack'), 8)
  assertLedger(confirmed.data, 'p-int-pack')
  assertLedger(confirmed.data, 'p-int-sugar')

  const dashboard = call(backend, 'dashboard.get', {
    actorUserId: 'u-aina', today, preset: '30d', warehouseId: 'all',
  })
  assert.equal(dashboard.ok, true, dashboard.error && dashboard.error.message)
  assert.equal(dashboard.data.salesCount >= 1, true)
  assert.equal(dashboard.data.purchaseCount >= 1, true)
  assert.ok(dashboard.data.totalSales >= 48)
  assert.ok(dashboard.data.totalPurchases >= 100)

  const cashierDash = call(backend, 'dashboard.get', { actorUserId: 'u-siti', today, preset: '30d' })
  assert.equal(cashierDash.error.code, 'FORBIDDEN')

  const reports = call(backend, 'reports.sales', { actorUserId: 'u-aina', today, preset: '30d' })
  assert.equal(reports.ok, true)
  assert.equal(reports.data.sales.some((row) => row.id === sale.data.sale.id), true)

  const inventory = call(backend, 'inventory.get', { actorUserId: 'u-aina' })
  assert.equal(inventory.ok, true)
  assertLedger(inventory.data, 'p-int-sugar')
  assertLedger(inventory.data, 'p-int-pack')
  assert.equal(qty(inventory.data, 'p-int-sugar'), 49)
  assert.equal(qty(inventory.data, 'p-int-pack'), 8)
})
