import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createFakeDrive,
  createFakeSpreadsheet,
  devProperties,
  loadBackend,
} from './harness.js'

function app(lock) {
  const spreadsheet = createFakeSpreadsheet()
  const drive = createFakeDrive('drive-id')
  const properties = devProperties()
  const context = loadBackend({
    PropertiesService: { getScriptProperties: () => properties },
    LockService: {
      getScriptLock() {
        return { tryLock: () => (lock ? lock() : true), releaseLock() {} }
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
    inventory: context.createInventoryService({ sheetRepository: sheets }),
    warehouse: context.createWarehouseService({ sheetRepository: sheets }),
    boms: context.createBomService({ sheetRepository: sheets }),
    openingBalances: context.createOpeningBalanceService({ sheetRepository: sheets }),
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
    idempotencyKey: extra.idempotencyKey || payload.idempotencyKey || `ob-${keySeq}`,
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
      { id: 'wh-shop', name: 'Shop', code: 'SHOP', kind: 'company' },
    ],
    categories: [{ id: 'cat-ing', name: 'Ingredients' }],
  }
}

function ready() {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(call(backend, 'identity.bootstrap', identityPayload()).ok, true)
  assert.equal(call(backend, 'masters.bootstrap', masterPayload()).ok, true)
  assert.equal(call(backend, 'products.create', {
    actorUserId: 'u-aina', id: 'prd-sugar', name: 'UAT Sugar', categoryId: 'cat-ing', unit: 'KG',
    purchaseUnit: 'BAG', purchaseConversionQty: 25, purchaseCost: 50, sellingPrice: 12,
  }).ok, true)
  assert.equal(call(backend, 'products.create', {
    actorUserId: 'u-aina', id: 'prd-fg', name: 'UAT Blend', categoryId: 'cat-ing', unit: 'KG',
    purchaseUnit: 'KG', purchaseConversionQty: 1, purchaseCost: 9, sellingPrice: 20,
  }).ok, true)
  assert.equal(call(backend, 'products.create', {
    actorUserId: 'u-aina', id: 'prd-mat', name: 'UAT Cocoa', categoryId: 'cat-ing', unit: 'KG',
    purchaseUnit: 'KG', purchaseConversionQty: 1, purchaseCost: 5, sellingPrice: 8,
  }).ok, true)
  post(backend, 'boms.create', {
    actorUserId: 'u-aina',
    name: 'UAT Blend BOM',
    productId: 'prd-fg',
    outputQty: 1,
    outputUnit: 'KG',
    items: [{ productId: 'prd-mat', qty: 1, unit: 'KG', wastagePct: 0, consumptionMethod: 'AUTO' }],
  })
  post(backend, 'warehouse.bootstrap', { actorUserId: 'u-aina' })
  return backend
}

function qty(data, productId, warehouseId) {
  const row = data.inventory.find((item) => item.productId === productId && item.warehouseId === warehouseId)
  return row ? row.qty : 0
}

function auditActions(backend) {
  return (backend.spreadsheet.store.AuditLogs || []).slice(1).map((row) => row[3])
}

test('opening balance draft save, confirm once, idempotency, conflict, and audit', () => {
  const backend = ready()
  const denied = call(backend, 'openingBalances.save', {
    actorUserId: 'u-mei',
    type: 'stock_item',
    items: [{ productId: 'prd-sugar', qty: 2, unit: 'BAG', warehouseId: 'wh-main' }],
  })
  assert.equal(denied.error.code, 'FORBIDDEN')

  const saved = call(backend, 'openingBalances.save', {
    actorUserId: 'u-aina',
    type: 'stock_item',
    items: [{ productId: 'prd-sugar', qty: 2, unit: 'BAG', warehouseId: 'wh-main' }],
  })
  assert.equal(saved.ok, true)
  const doc = saved.data.openingBalance
  assert.equal(doc.status, 'draft')
  assert.equal(doc.documentNo, 'OB-0001')
  assert.equal(qty(saved.data, 'prd-sugar', 'wh-main'), 0)
  assert.equal(saved.data.stockMovements.length, 0)

  const badLine = call(backend, 'openingBalances.save', {
    actorUserId: 'u-aina',
    type: 'stock_item',
    items: [{ productId: 'prd-sugar', qty: 0, unit: 'BAG', warehouseId: 'wh-main' }],
  })
  assert.equal(badLine.error.message, 'Enter a quantity greater than 0.')
  assert.equal(auditActions(backend).includes('openingBalances.confirm'), false)

  const missingKey = call(backend, 'openingBalances.confirm', { actorUserId: 'u-aina', id: doc.id })
  assert.equal(missingKey.error.message, 'Idempotency key is required.')

  const confirmed = post(backend, 'openingBalances.confirm', { actorUserId: 'u-aina', id: doc.id }, { idempotencyKey: 'confirm-1' })
  assert.equal(confirmed.ok, true)
  assert.equal(confirmed.data.openingBalance.status, 'confirmed')
  assert.equal(qty(confirmed.data, 'prd-sugar', 'wh-main'), 50)
  assert.equal(confirmed.data.stockMovements.length, 1)
  assert.equal(confirmed.data.stockMovements[0].type, 'opening_balance')
  assert.equal(confirmed.data.stockMovements[0].reference, 'OB-0001')
  assert.equal(auditActions(backend).filter((row) => row === 'openingBalances.confirm').length, 1)

  const replay = post(backend, 'openingBalances.confirm', { actorUserId: 'u-aina', id: doc.id }, { idempotencyKey: 'confirm-1' })
  assert.equal(replay.ok, true)
  assert.equal(replay.meta.idempotentReplay, true)
  assert.equal(confirmed.data.stockMovements.length, 1)
  assert.equal(qty(replay.data, 'prd-sugar', 'wh-main'), 50)

  const conflict = post(backend, 'openingBalances.confirm', { actorUserId: 'u-aina', id: doc.id }, { idempotencyKey: 'confirm-2' })
  assert.equal(conflict.error.code, 'CONFLICT')
  assert.equal(qty(confirmed.data, 'prd-sugar', 'wh-main'), 50)
  assert.equal(auditActions(backend).filter((row) => row === 'openingBalances.confirm').length, 1)

  const mapBefore = {
    slots: confirmed.data.storageSlots.length,
    occ: confirmed.data.slotOccupancies.length,
  }
  assert.equal(mapBefore.slots, confirmed.data.storageSlots.length)
  assert.equal(mapBefore.occ, confirmed.data.slotOccupancies.length)
})

test('invalid mixed lines reject without partial posting', () => {
  const backend = ready()
  const saved = call(backend, 'openingBalances.save', {
    actorUserId: 'u-aina',
    type: 'stock_item',
    items: [
      { productId: 'prd-sugar', qty: 1, unit: 'BAG', warehouseId: 'wh-main' },
      { productId: 'prd-sugar', qty: 1, unit: 'BAG', warehouseId: 'wh-main' },
    ],
  })
  assert.equal(saved.error.message, 'Duplicate UAT Sugar in the same warehouse.')
  assert.equal((backend.spreadsheet.store.OpeningBalanceLines || []).length, 0)
})
