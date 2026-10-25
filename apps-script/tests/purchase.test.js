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
    boms: context.createBomService({ sheetRepository: sheets }),
    openingBalances: context.createOpeningBalanceService({ sheetRepository: sheets }),
    purchases: context.createPurchaseService({ sheetRepository: sheets }),
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
    idempotencyKey: extra.idempotencyKey || `pur-${keySeq}`,
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

function masterPayload() {
  return {
    warehouses: [
      { id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', kind: 'company' },
    ],
    categories: [{ id: 'cat-ing', name: 'Ingredients' }],
  }
}

function partyPayload() {
  return {
    suppliers: [{ id: 'sup-1', name: 'Sugar Supplier', code: 'SUP1', status: 'active' }],
    customers: [],
    agents: [],
    customerWholesalePrices: [],
  }
}

function ready() {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(call(backend, 'identity.bootstrap', identityPayload()).ok, true)
  assert.equal(call(backend, 'masters.bootstrap', masterPayload()).ok, true)
  assert.equal(call(backend, 'parties.bootstrap', partyPayload()).ok, true)
  assert.equal(call(backend, 'products.create', {
    actorUserId: 'u-aina', id: 'prd-sugar', name: 'UAT Sugar', categoryId: 'cat-ing', unit: 'KG',
    purchaseUnit: 'BAG', purchaseConversionQty: 25, purchaseCost: 50, sellingPrice: 12,
  }).ok, true)
  return backend
}

function qty(data, productId, warehouseId) {
  const row = data.inventory.find((item) => item.productId === productId && item.warehouseId === warehouseId)
  return row ? row.qty : 0
}

test('purchase draft, receive once, idempotency, conflict, payment, and return', () => {
  const backend = ready()
  const denied = call(backend, 'purchases.create', {
    actorUserId: 'u-mei',
    supplierId: 'sup-1',
    warehouseId: 'wh-main',
    invoiceNumber: 'INV-1',
    items: [{ productId: 'prd-sugar', qty: 2, price: 50 }],
    receive: false,
  })
  assert.equal(denied.error.code, 'FORBIDDEN')

  const draft = call(backend, 'purchases.create', {
    actorUserId: 'u-aina',
    clientId: 'pur_uat_1',
    supplierId: 'sup-1',
    warehouseId: 'wh-main',
    invoiceNumber: 'INV-1',
    items: [{ productId: 'prd-sugar', qty: 2, price: 50 }],
    receive: false,
  })
  assert.equal(draft.ok, true)
  assert.equal(draft.data.purchase.id, 'pur_uat_1')
  assert.equal(draft.data.purchase.status, 'draft')
  assert.equal(qty(draft.data, 'prd-sugar', 'wh-main'), 0)

  const missingKey = call(backend, 'purchases.receive', { actorUserId: 'u-aina', id: draft.data.purchase.id })
  assert.equal(missingKey.error.message, 'Idempotency key is required.')

  const received = post(backend, 'purchases.receive', { actorUserId: 'u-aina', id: draft.data.purchase.id }, { idempotencyKey: 'recv-1' })
  assert.equal(received.ok, true)
  assert.equal(received.data.purchase.status, 'received')
  assert.equal(qty(received.data, 'prd-sugar', 'wh-main'), 50)
  assert.equal(received.data.stockMovements.filter((row) => row.type === 'purchase').length, 1)

  const replay = post(backend, 'purchases.receive', { actorUserId: 'u-aina', id: draft.data.purchase.id }, { idempotencyKey: 'recv-1' })
  assert.equal(replay.ok, true)
  assert.equal(replay.meta.idempotentReplay, true)
  assert.equal(qty(replay.data, 'prd-sugar', 'wh-main'), 50)

  const conflict = post(backend, 'purchases.receive', { actorUserId: 'u-aina', id: draft.data.purchase.id }, { idempotencyKey: 'recv-2' })
  assert.equal(conflict.error.code, 'CONFLICT')

  const paid = post(backend, 'purchases.recordPayment', {
    actorUserId: 'u-aina',
    invoiceId: draft.data.purchase.id,
    method: 'bank_transfer',
    amount: 100,
  }, { idempotencyKey: 'pay-1' })
  assert.equal(paid.ok, true)
  assert.equal(paid.data.purchase.status, 'paid')
  assert.equal(paid.data.purchase.balance, 0)

  const returned = post(backend, 'purchaseReturns.create', {
    actorUserId: 'u-aina',
    purchaseId: draft.data.purchase.id,
    items: [{ productId: 'prd-sugar', qty: 1 }],
    reason: 'Damaged bags',
  }, { idempotencyKey: 'ret-1' })
  assert.equal(returned.ok, true)
  assert.equal(returned.data.purchaseReturn.returnNo, 'PR-000001')
  assert.equal(qty(returned.data, 'prd-sugar', 'wh-main'), 49)
})

test('create with receive posts stock once and honors clientId', () => {
  const backend = ready()
  const created = post(backend, 'purchases.create', {
    actorUserId: 'u-aina',
    clientId: 'pur_recv_1',
    supplierId: 'sup-1',
    warehouseId: 'wh-main',
    invoiceNumber: 'INV-2',
    items: [{ productId: 'prd-sugar', qty: 1, price: 50 }],
    receive: true,
  }, { idempotencyKey: 'create-recv-1' })
  assert.equal(created.ok, true)
  assert.equal(created.data.purchase.id, 'pur_recv_1')
  assert.equal(created.data.purchase.status, 'received')
  assert.equal(qty(created.data, 'prd-sugar', 'wh-main'), 25)
})

test('receivingId skips stock posting', () => {
  const backend = ready()
  backend.spreadsheet.store.Receivings = [
    ['id', 'receivingNo', 'purchaseId', 'purchaseNo'],
    ['rcv-1', 'RCV-000001', '', ''],
  ]
  const created = post(backend, 'purchases.create', {
    actorUserId: 'u-aina',
    clientId: 'pur_linked',
    supplierId: 'sup-1',
    warehouseId: 'wh-main',
    invoiceNumber: 'INV-3',
    receivingId: 'rcv-1',
    items: [{ productId: 'prd-sugar', qty: 3, price: 50 }],
    receive: true,
  }, { idempotencyKey: 'create-linked-1' })
  assert.equal(created.ok, true)
  assert.equal(qty(created.data, 'prd-sugar', 'wh-main'), 0)
  assert.equal(created.data.purchase.receivingId, 'rcv-1')
})

test('return qty too high is rejected', () => {
  const backend = ready()
  const draft = call(backend, 'purchases.create', {
    actorUserId: 'u-aina',
    supplierId: 'sup-1',
    warehouseId: 'wh-main',
    invoiceNumber: 'INV-4',
    items: [{ productId: 'prd-sugar', qty: 1, price: 50 }],
    receive: false,
  })
  post(backend, 'purchases.receive', { actorUserId: 'u-aina', id: draft.data.purchase.id })
  const bad = post(backend, 'purchaseReturns.create', {
    actorUserId: 'u-aina',
    purchaseId: draft.data.purchase.id,
    items: [{ productId: 'prd-sugar', qty: 99 }],
    reason: 'Too much',
  })
  assert.equal(bad.error.message, 'Return qty too high')
})
