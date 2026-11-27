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
    warehouse: context.createWarehouseService({ sheetRepository: sheets }),
    sales: context.createSalesService({ sheetRepository: sheets }),
    salesReturns: context.createSalesReturnService({ sheetRepository: sheets }),
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
    idempotencyKey: extra.idempotencyKey || `sret-${keySeq}`,
    requestId: extra.requestId || `req-${keySeq}`,
  })
}

function identityPayload() {
  return {
    departments: [{ id: 'dept-sales', name: 'Sales', status: 'active' }],
    roles: [
      { id: 'role-owner', name: 'Owner', description: 'Owner', status: 'active', protected: true, legacyRole: 'owner' },
      { id: 'role-staff', name: 'Staff', description: 'Staff', status: 'active', protected: false, legacyRole: 'staff' },
    ],
    users: [
      { id: 'u-aina', name: 'Aina Rahman', email: 'aina@coolslurppy.my', roleId: 'role-owner', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-mei', name: 'Mei Ling', email: 'mei@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'active' },
    ],
    settings: {
      businessName: 'Cool Slurppy', legalName: 'Cool Slurppy Sdn Bhd', logoUrl: '', phone: '03',
      email: 'hello@coolslurppy.my', address: 'KL', website: '', registrationNo: '', bankName: '',
      bankAccount: '', paymentTerms: 'Net 7 days', documentTerms: 'Terms', currency: 'MYR',
      defaultWarehouseId: 'wh-main', allowNegativeStock: false, costingMethod: 'average',
      batchTracking: true, expiryTracking: true, defaultCustomerId: 'c-walkin', allowDiscount: true,
      allowReturns: true, enabledPaymentMethods: ['cash'], roleMatrix: {},
    },
    userAuditLogs: [],
  }
}

function ready() {
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
    customers: [
      { id: 'c-walkin', name: 'Walk-in', phone: '-', email: '', address: '', status: 'active' },
      { id: 'c-cafe', name: 'Cafe One', phone: '03-1', email: 'cafe@x.my', address: 'PJ', status: 'active' },
    ],
    suppliers: [],
    agents: [],
    customerWholesalePrices: [],
  }).ok, true)
  assert.equal(call(backend, 'warehouse.bootstrap', { actorUserId: 'u-aina' }).ok, true)
  return backend
}

function addProduct(backend, row) {
  const result = call(backend, 'products.create', {
    actorUserId: 'u-aina',
    categoryId: 'cat-pack',
    sellingPrice: 12,
    wholesalePrice: 9,
    purchaseCost: 4,
    unit: 'PACK',
    purchaseUnit: 'PACK',
    purchaseConversionQty: 1,
    sellable: true,
    ...row,
  })
  assert.equal(result.ok, true, result.error && result.error.message)
}

function stock(backend, productId, qty) {
  const result = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId, type: 'increase', qty, reason: 'UAT return stock',
  })
  assert.equal(result.ok, true, result.error && result.error.message)
}

function qty(data, productId, warehouseId = 'wh-main') {
  const row = (data.inventory || []).find((item) => item.productId === productId && item.warehouseId === warehouseId)
  return row ? row.qty : 0
}

function pbQty(data, productId) {
  return (data.productionBalances || [])
    .filter((row) => row.productId === productId && row.status === 'available')
    .reduce((sum, row) => sum + Number(row.quantity || 0), 0)
}

test('health does not create sales return sheets and Sheet1 stays reserved', () => {
  const backend = app()
  backend.foundation.initialize()
  const health = call(backend, 'system.health', {})
  assert.equal(health.ok, true)
  assert.equal(backend.spreadsheet.store.SalesReturns, undefined)
  assert.equal(backend.spreadsheet.store.ReturnSources, undefined)
  assert.ok(backend.spreadsheet.store.Sheet1)
})

test('staff cannot save a return and owner draft does not move stock', () => {
  const backend = ready()
  addProduct(backend, { id: 'p-pack-mt', name: 'Matcha Pack', sku: 'MT001' })
  stock(backend, 'p-pack-mt', 10)
  const listed = call(backend, 'salesReturns.list', { actorUserId: 'u-aina' })
  assert.equal(listed.ok, true)
  assert.equal(listed.data.returnSources.some((row) => row.name === 'Shopee' && row.active), true)
  const shopee = listed.data.returnSources.find((row) => row.id === 'rs-shopee')
  const reason = listed.data.returnReasons.find((row) => row.id === 'rr-changed-mind')

  const staff = call(backend, 'salesReturns.save', {
    actorUserId: 'u-mei',
    sourceId: shopee.id,
    reasonId: reason.id,
    items: [{ productId: 'p-pack-mt', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
  })
  assert.equal(staff.error.code, 'FORBIDDEN')

  const draft = call(backend, 'salesReturns.save', {
    actorUserId: 'u-aina',
    clientId: 'sret_draft_1',
    sourceId: shopee.id,
    reasonId: reason.id,
    items: [{ productId: 'p-pack-mt', returnedQty: 2, goodQty: 2, repackQty: 0, wasteQty: 0 }],
  })
  assert.equal(draft.ok, true, draft.error && draft.error.message)
  assert.equal(draft.data.salesReturn.status, 'draft')
  assert.equal(draft.data.salesReturn.returnNo, 'RT-000001')
  assert.equal(qty(draft.data, 'p-pack-mt'), 10)
  assert.equal(pbQty(draft.data, 'p-pack-mt'), 100)
})

test('confirm posts good, repack grams, and waste without double-counting finished goods', () => {
  const backend = ready()
  addProduct(backend, { id: 'p-pack-mt', name: 'Matcha Pack', sku: 'MT001' })
  addProduct(backend, { id: 'p-pack-st', name: 'Strawberry Pack', sku: 'ST001' })
  addProduct(backend, { id: 'p-pack-ch', name: 'Chocolate Pack', sku: 'CH001' })
  stock(backend, 'p-pack-mt', 20)
  stock(backend, 'p-pack-st', 20)
  stock(backend, 'p-pack-ch', 20)
  const sale = post(backend, 'sales.create', {
    actorUserId: 'u-aina',
    clientId: 'sal_ret_1',
    customerId: 'c-cafe',
    warehouseId: 'wh-main',
    items: [
      { productId: 'p-pack-mt', qty: 10, price: 12 },
      { productId: 'p-pack-st', qty: 5, price: 12 },
      { productId: 'p-pack-ch', qty: 8, price: 12 },
    ],
    paidAmount: 0,
  })
  assert.equal(sale.ok, true, sale.error && sale.error.message)
  const listed = call(backend, 'salesReturns.list', { actorUserId: 'u-aina' })
  const matchaBefore = qty(sale.data, 'p-pack-mt')
  const strawberryBefore = qty(sale.data, 'p-pack-st')
  const chocolateBefore = qty(sale.data, 'p-pack-ch')
  const matchaPbBefore = pbQty(listed.data, 'p-pack-mt')
  const chocolatePbBefore = pbQty(listed.data, 'p-pack-ch')

  const saved = call(backend, 'salesReturns.save', {
    actorUserId: 'u-aina',
    clientId: 'sret_int_1',
    sourceId: 'rs-shopee',
    reasonId: 'rr-changed-mind',
    originalSaleId: sale.data.sale.id,
    items: [
      { productId: 'p-pack-mt', returnedQty: 10, unit: 'PACK', goodQty: 3, repackQty: 5, wasteQty: 2, repackRecoveredGrams: 470, repackStorageBoxId: 'Box 3' },
      { productId: 'p-pack-st', returnedQty: 5, unit: 'PACK', goodQty: 5, repackQty: 0, wasteQty: 0 },
      { productId: 'p-pack-ch', returnedQty: 8, unit: 'PACK', goodQty: 0, repackQty: 6, wasteQty: 2, repackRecoveredGrams: 560, repackStorageBoxId: 'Box 1' },
    ],
  })
  assert.equal(saved.ok, true, saved.error && saved.error.message)

  const missingKey = call(backend, 'salesReturns.confirm', { actorUserId: 'u-aina', id: saved.data.salesReturn.id })
  assert.equal(missingKey.error.message, 'Idempotency key is required.')

  const confirmed = post(backend, 'salesReturns.confirm', { actorUserId: 'u-aina', id: saved.data.salesReturn.id }, { idempotencyKey: 'confirm-1' })
  assert.equal(confirmed.ok, true, confirmed.error && confirmed.error.message)
  assert.equal(confirmed.data.salesReturn.status, 'confirmed')
  assert.equal(qty(confirmed.data, 'p-pack-mt'), matchaBefore + 3)
  assert.equal(qty(confirmed.data, 'p-pack-st'), strawberryBefore + 5)
  assert.equal(qty(confirmed.data, 'p-pack-ch'), chocolateBefore)
  assert.equal(pbQty(confirmed.data, 'p-pack-mt'), matchaPbBefore + 470)
  assert.equal(pbQty(confirmed.data, 'p-pack-ch'), chocolatePbBefore + 560)
  const movements = (confirmed.data.stockMovements || []).filter((row) => row.reference === confirmed.data.salesReturn.returnNo)
  assert.equal(movements.some((row) => row.type === 'sales_return_good' && row.productId === 'p-pack-mt' && row.stockIn === 3), true)
  assert.equal(movements.some((row) => row.type === 'sales_return_repack' && row.productId === 'p-pack-mt' && row.stockIn === 0), true)
  assert.equal(movements.filter((row) => row.type === 'sales_return_waste').reduce((sum, row) => sum + row.stockOut, 0), 4)
  const matchaBox = (confirmed.data.productionBalances || []).find((row) => row.productionReference === confirmed.data.salesReturn.returnNo && row.productId === 'p-pack-mt')
  const chocolateBox = (confirmed.data.productionBalances || []).find((row) => row.productionReference === confirmed.data.salesReturn.returnNo && row.productId === 'p-pack-ch')
  assert.equal(matchaBox.container, 'Box 3')
  assert.equal(matchaBox.quantity, 470)
  assert.equal(chocolateBox.container, 'Box 1')
  const saleAfter = confirmed.data.sales.find((row) => row.id === sale.data.sale.id)
  assert.equal(saleAfter.items.find((row) => row.productId === 'p-pack-mt').returnedQty, 10)
  assert.equal(saleAfter.status, 'returned')
  assert.equal((confirmed.data.documentAuditLogs || []).some((row) => row.action === 'sales_return_confirmed'), true)

  const replay = post(backend, 'salesReturns.confirm', { actorUserId: 'u-aina', id: saved.data.salesReturn.id }, { idempotencyKey: 'confirm-1' })
  assert.equal(replay.meta.idempotentReplay, true)
  assert.equal(qty(replay.data, 'p-pack-mt'), matchaBefore + 3)

  const again = post(backend, 'salesReturns.confirm', { actorUserId: 'u-aina', id: saved.data.salesReturn.id }, { idempotencyKey: 'confirm-2' })
  assert.equal(again.error.code, 'CONFLICT')
  const afterConflict = call(backend, 'salesReturns.get', { actorUserId: 'u-aina', id: saved.data.salesReturn.id })
  assert.equal(qty(afterConflict.data, 'p-pack-mt'), matchaBefore + 3)

  const locked = call(backend, 'salesReturns.update', {
    actorUserId: 'u-aina',
    id: saved.data.salesReturn.id,
    sourceId: 'rs-shopee',
    reasonId: 'rr-changed-mind',
    items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
  })
  assert.equal(locked.ok, false)
})

test('agent warehouse, unbalanced disposition, and lookup deactivate are rejected', () => {
  const backend = ready()
  addProduct(backend, { id: 'p-pack-mt', name: 'Matcha Pack', sku: 'MT001' })
  stock(backend, 'p-pack-mt', 5)
  const unbalanced = call(backend, 'salesReturns.save', {
    actorUserId: 'u-aina',
    sourceId: 'rs-shopee',
    reasonId: 'rr-damaged',
    items: [{ productId: 'p-pack-mt', returnedQty: 2, goodQty: 1, repackQty: 0, wasteQty: 0 }],
  })
  assert.equal(unbalanced.error.message, 'Good + Repack + Waste must equal Returned Quantity.')

  const agentWh = call(backend, 'salesReturns.save', {
    actorUserId: 'u-aina',
    sourceId: 'rs-shopee',
    reasonId: 'rr-damaged',
    warehouseId: 'wh-agent',
    items: [{ productId: 'p-pack-mt', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
  })
  assert.equal(agentWh.error.message, 'Sales Return cannot post into an Agent warehouse.')

  const custom = call(backend, 'returnSources.upsert', { actorUserId: 'u-aina', name: 'Night Market' })
  assert.equal(custom.ok, true)
  assert.equal(custom.data.returnSource.active, true)
  const off = call(backend, 'returnSources.setActive', { actorUserId: 'u-aina', id: custom.data.returnSource.id, active: false })
  assert.equal(off.data.returnSource.active, false)
  const usingOff = call(backend, 'salesReturns.save', {
    actorUserId: 'u-aina',
    sourceId: custom.data.returnSource.id,
    reasonId: 'rr-damaged',
    items: [{ productId: 'p-pack-mt', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
  })
  assert.equal(usingOff.error.message, 'This Return Source is inactive.')

  const draft = call(backend, 'salesReturns.save', {
    actorUserId: 'u-aina',
    sourceId: 'rs-walkin',
    reasonId: 'rr-damaged',
    items: [{ productId: 'p-pack-mt', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
  })
  const cancelled = call(backend, 'salesReturns.cancel', { actorUserId: 'u-aina', id: draft.data.salesReturn.id })
  assert.equal(cancelled.data.salesReturn.status, 'cancelled')
  const confirmCancelled = post(backend, 'salesReturns.confirm', { actorUserId: 'u-aina', id: draft.data.salesReturn.id })
  assert.equal(confirmCancelled.ok, false)
})
