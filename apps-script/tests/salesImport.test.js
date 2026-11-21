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
    salesImport: context.createSalesImportService({ sheetRepository: sheets }),
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
    idempotencyKey: extra.idempotencyKey || `simp-${keySeq}`,
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
    ],
    suppliers: [],
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
    sellable: true,
    ...row,
  })
  assert.equal(result.ok, true, result.error && result.error.message)
}

function stock(backend, productId, qty) {
  const result = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId, type: 'increase', qty, reason: 'UAT import stock',
  })
  assert.equal(result.ok, true, result.error && result.error.message)
}

function qty(data, productId, warehouseId = 'wh-main') {
  const row = (data.inventory || []).find((item) => item.productId === productId && item.warehouseId === warehouseId)
  return row ? row.qty : 0
}

function word(text, x, y, page = 1) {
  return { text, x, y, page }
}

function orderNo(seed) {
  return `260922${seed}`.slice(0, 14).padEnd(14, 'A')
}

function shopeeItems(username, rows) {
  const items = [
    word('Picklist', 17, 820),
    word('Username:', 17, 800),
    word(username, 96, 800),
    word('#', 15, 760),
    word('Parent SKU', 28, 760),
    word('Name', 152, 760),
    word('SKU', 233, 760),
    word('Variation Name', 295, 760),
    word('Qty', 376, 760),
    word('Order ID', 417, 760),
  ]
  let y = 720
  rows.forEach((row, index) => {
    items.push(word(String(index + 1), 15, y), word(row.name, 152, y), word(String(row.qty), 376, y))
    if (row.sku) items.push(word(row.sku, 233, y))
    if (row.variation) items.push(word(row.variation, 295, y))
    if (row.orders[0]) items.push(word(row.orders[0], 417, y))
    row.orders.slice(1).forEach((id) => {
      y -= 14
      items.push(word(id, 417, y))
    })
    y -= 24
  })
  return items
}

function seedImport(backend, options = {}) {
  addProduct(backend, { id: 'p-grape', name: 'IB Grape', sku: '900001', sellingPrice: 8 })
  if (options.component) {
    addProduct(backend, { id: 'p-powder', name: 'Grape Powder', sku: '900010', sellingPrice: 2 })
    addProduct(backend, {
      id: 'p-bundle',
      name: 'Grape Bundle',
      sku: '900011',
      sellingPrice: 15,
      salesComponents: [{ productId: 'p-powder', qty: 2 }],
    })
  }
  if (options.stock !== false) stock(backend, options.component ? 'p-powder' : 'p-grape', options.stockQty ?? 10)
  const account = call(backend, 'salesImport.createAccount', {
    actorUserId: 'u-aina',
    clientId: 'sia_shopee',
    platform: 'shopee',
    name: 'coolslurppypowder',
  })
  assert.equal(account.ok, true, account.error && account.error.message)
  const batch = call(backend, 'salesImport.createBatch', {
    actorUserId: 'u-aina',
    clientId: 'sib_1',
    platform: 'shopee',
    accountId: account.data.account.id,
  })
  assert.equal(batch.ok, true, batch.error && batch.error.message)
  return { account: account.data.account, batch: batch.data.batch }
}

test('health does not create sales import sheets and Sheet1 stays reserved', () => {
  const backend = app()
  backend.foundation.initialize()
  const health = call(backend, 'system.health', {})
  assert.equal(health.ok, true)
  assert.equal(backend.spreadsheet.store.SalesImportAccounts, undefined)
  assert.equal(backend.spreadsheet.store.SalesImportBatches, undefined)
  assert.ok(backend.spreadsheet.store.Sheet1)
})

test('cashier cannot import sales', () => {
  const backend = ready()
  const denied = call(backend, 'salesImport.createAccount', {
    actorUserId: 'u-mei',
    platform: 'shopee',
    name: 'coolslurppypowder',
  })
  assert.equal(denied.error.code, 'FORBIDDEN')
  assert.equal(denied.error.message, 'You cannot import sales.')
})

test('ingest picking, map by SKU, confirm posts once through sales.create', () => {
  const backend = ready()
  const seeded = seedImport(backend)
  const ingest = call(backend, 'salesImport.ingestPicking', {
    actorUserId: 'u-aina',
    batchId: seeded.batch.id,
    clientId: 'sif_pick_1',
    fileName: 'pick.pdf',
    fileHash: 'hash-pick-1',
    items: shopeeItems('coolslurppypowder', [{ name: 'IB GRAPE', sku: '900001', qty: 2, orders: [orderNo('P0000001')] }]),
  })
  assert.equal(ingest.ok, true, ingest.error && ingest.error.message)
  assert.equal(ingest.data.file.parseError, undefined)
  const order = ingest.data.salesImportOrders.find((row) => row.batchId === seeded.batch.id)
  assert.ok(order)
  assert.equal(order.status, 'new')
  assert.equal(order.externalOrderId, orderNo('P0000001'))

  const duplicateFile = call(backend, 'salesImport.ingestPicking', {
    actorUserId: 'u-aina',
    batchId: seeded.batch.id,
    fileName: 'pick.pdf',
    fileHash: 'hash-pick-1',
    items: [],
  })
  assert.equal(duplicateFile.error.message, 'This file is already in the batch.')

  const spot = call(backend, 'salesImport.spotCheck', {
    actorUserId: 'u-aina',
    batchId: seeded.batch.id,
    key: 'sample-1',
    checked: true,
  })
  assert.equal(spot.ok, true)
  assert.deepEqual(spot.data.batch.spotCheckedKeys, ['sample-1'])

  const missingKey = call(backend, 'salesImport.confirm', { actorUserId: 'u-aina', batchId: seeded.batch.id })
  assert.equal(missingKey.error.message, 'Idempotency key is required.')

  const confirmed = post(backend, 'salesImport.confirm', { actorUserId: 'u-aina', batchId: seeded.batch.id }, { idempotencyKey: 'import-confirm-1' })
  assert.equal(confirmed.ok, true, confirmed.error && confirmed.error.message)
  assert.equal(confirmed.data.posted, 1)
  assert.equal(confirmed.data.sales.length, 1)
  assert.equal(confirmed.data.sales[0].reference, `SHOPEE:coolslurppypowder:${orderNo('P0000001')}`)
  assert.equal(confirmed.data.sales[0].warehouseId, 'wh-main')
  assert.equal(confirmed.data.sales[0].paid, 0)
  assert.equal(qty(confirmed.data, 'p-grape'), 8)
  const saleMoves = (confirmed.data.stockMovements || []).filter((row) => row.type === 'sale' && row.productId === 'p-grape')
  assert.equal(saleMoves.length, 1)
  assert.equal(saleMoves[0].stockOut, 2)
  const confirmedOrder = confirmed.data.salesImportOrders.find((row) => row.id === order.id)
  assert.equal(confirmedOrder.status, 'confirmed')
  assert.equal(confirmedOrder.saleId, confirmed.data.sales[0].id)
  assert.equal(confirmed.data.batch.status, 'confirmed')

  const replay = post(backend, 'salesImport.confirm', { actorUserId: 'u-aina', batchId: seeded.batch.id }, { idempotencyKey: 'import-confirm-1' })
  assert.equal(replay.ok, true)
  assert.equal(replay.meta.idempotentReplay, true)
  assert.equal(qty(replay.data, 'p-grape'), 8)
  assert.equal(replay.data.sales.length, 1)

  const again = post(backend, 'salesImport.confirm', { actorUserId: 'u-aina', batchId: seeded.batch.id }, { idempotencyKey: 'import-confirm-2' })
  assert.equal(again.ok, true, again.error && again.error.message)
  assert.equal(again.data.posted, 0)
  assert.equal(again.data.already, 1)
  assert.equal(again.data.sales.length, 1)
  assert.equal(qty(again.data, 'p-grape'), 8)
})

test('duplicate sale reference does not double-post across batches', () => {
  const backend = ready()
  const first = seedImport(backend)
  const ingest = call(backend, 'salesImport.ingestPicking', {
    actorUserId: 'u-aina',
    batchId: first.batch.id,
    fileName: 'pick.pdf',
    fileHash: 'hash-pick-dup-1',
    items: shopeeItems('coolslurppypowder', [{ name: 'IB GRAPE', sku: '900001', qty: 2, orders: [orderNo('P0000009')] }]),
  })
  assert.equal(ingest.ok, true, ingest.error && ingest.error.message)
  const confirmed = post(backend, 'salesImport.confirm', { actorUserId: 'u-aina', batchId: first.batch.id })
  assert.equal(confirmed.ok, true, confirmed.error && confirmed.error.message)
  assert.equal(confirmed.data.posted, 1)
  const afterFirst = qty(confirmed.data, 'p-grape')

  const second = call(backend, 'salesImport.createBatch', {
    actorUserId: 'u-aina',
    clientId: 'sib_2',
    platform: 'shopee',
    accountId: first.account.id,
  })
  assert.equal(second.ok, true, second.error && second.error.message)
  const ingestTwo = call(backend, 'salesImport.ingestPicking', {
    actorUserId: 'u-aina',
    batchId: second.data.batch.id,
    fileName: 'pick-2.pdf',
    fileHash: 'hash-pick-dup-2',
    items: shopeeItems('coolslurppypowder', [{ name: 'IB GRAPE', sku: '900001', qty: 2, orders: [orderNo('P0000009')] }]),
  })
  assert.equal(ingestTwo.ok, true, ingestTwo.error && ingestTwo.error.message)
  const dupOrder = ingestTwo.data.salesImportOrders.find((row) => row.batchId === second.data.batch.id)
  assert.equal(dupOrder.status, 'duplicate')
  const again = post(backend, 'salesImport.confirm', { actorUserId: 'u-aina', batchId: second.data.batch.id })
  assert.equal(again.ok, false)
  assert.equal(again.error.message, 'Nothing to confirm.')
  const listed = call(backend, 'salesImport.list', { actorUserId: 'u-aina' })
  assert.equal(listed.data.sales.length, 1)
  assert.equal(qty(listed.data, 'p-grape'), afterFirst)
})

test('shortage blocks confirm and missing AWB does not', () => {
  const backend = ready()
  const seeded = seedImport(backend, { stock: false })
  const ingest = call(backend, 'salesImport.ingestPicking', {
    actorUserId: 'u-aina',
    batchId: seeded.batch.id,
    fileName: 'pick.pdf',
    fileHash: 'hash-short',
    items: shopeeItems('coolslurppypowder', [{ name: 'IB GRAPE', sku: '900001', qty: 4, orders: [orderNo('P0000003')] }]),
  })
  assert.equal(ingest.ok, true)
  const blocked = post(backend, 'salesImport.confirm', { actorUserId: 'u-aina', batchId: seeded.batch.id })
  assert.equal(blocked.ok, false)
  assert.match(blocked.error.message, /Insufficient stock/)
  stock(backend, 'p-grape', 4)
  const confirmed = post(backend, 'salesImport.confirm', { actorUserId: 'u-aina', batchId: seeded.batch.id })
  assert.equal(confirmed.ok, true, confirmed.error && confirmed.error.message)
  assert.equal(confirmed.data.posted, 1)
  assert.equal(qty(confirmed.data, 'p-grape'), 0)
})

test('component SKUs are posted on import confirm, not the bundle', () => {
  const backend = ready()
  const seeded = seedImport(backend, { component: true, stockQty: 10 })
  const ingest = call(backend, 'salesImport.ingestPicking', {
    actorUserId: 'u-aina',
    batchId: seeded.batch.id,
    fileName: 'pick.pdf',
    fileHash: 'hash-bundle',
    items: shopeeItems('coolslurppypowder', [{ name: 'Bundle', sku: '900011', qty: 2, orders: [orderNo('P0000004')] }]),
  })
  assert.equal(ingest.ok, true, ingest.error && ingest.error.message)
  const confirmed = post(backend, 'salesImport.confirm', { actorUserId: 'u-aina', batchId: seeded.batch.id })
  assert.equal(confirmed.ok, true, confirmed.error && confirmed.error.message)
  assert.equal(qty(confirmed.data, 'p-powder'), 6)
  assert.equal(qty(confirmed.data, 'p-bundle'), 0)
  const powderMoves = (confirmed.data.stockMovements || []).filter((row) => row.productId === 'p-powder' && row.type === 'sale')
  assert.equal(powderMoves.length, 1)
  assert.equal(powderMoves[0].stockOut, 4)
  const bundleMoves = (confirmed.data.stockMovements || []).filter((row) => row.productId === 'p-bundle' && row.type === 'sale')
  assert.equal(bundleMoves.length, 0)
})

test('unknown platform is rejected and parser errors stay on the file', () => {
  const backend = ready()
  const platform = call(backend, 'salesImport.createAccount', {
    actorUserId: 'u-aina',
    platform: 'lazada',
    name: 'shop',
  })
  assert.equal(platform.error.message, 'Choose a platform')
  const seeded = seedImport(backend)
  const bad = call(backend, 'salesImport.ingestPicking', {
    actorUserId: 'u-aina',
    batchId: seeded.batch.id,
    fileName: 'blank.pdf',
    fileHash: 'hash-blank',
    items: [word('Hello', 10, 10)],
  })
  assert.equal(bad.ok, true, bad.error && bad.error.message)
  assert.ok(bad.data.file.parseError)
  assert.equal(bad.data.salesImportOrders.filter((row) => row.batchId === seeded.batch.id).length, 0)
})
