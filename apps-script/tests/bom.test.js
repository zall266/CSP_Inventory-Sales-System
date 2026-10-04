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
    boms: context.createBomService({ sheetRepository: sheets }),
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
    idempotencyKey: extra.idempotencyKey || `bom-${keySeq}`,
    requestId: extra.requestId || `req-${keySeq}`,
  })
}

function ready() {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(call(backend, 'identity.bootstrap', {
    departments: [{ id: 'dept-sales', name: 'Sales', status: 'active' }],
    roles: [
      { id: 'role-owner', name: 'Owner', description: 'Full system access. Protected account.', status: 'active', protected: true, legacyRole: 'owner' },
      { id: 'role-staff', name: 'Staff', description: 'Day-to-day operations.', status: 'active', protected: false, legacyRole: 'staff' },
    ],
    users: [
      { id: 'u-aina', name: 'Aina Rahman', email: 'aina@coolslurppy.my', roleId: 'role-owner', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-mei', name: 'Mei Ling', email: 'mei@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-off', name: 'Off Duty', email: 'off@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'inactive' },
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
  }).ok, true)
  assert.equal(call(backend, 'masters.bootstrap', {
    warehouses: [{ id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', kind: 'company' }],
    categories: [{ id: 'cat-ing', name: 'Ingredients' }],
  }).ok, true)
  return backend
}

function addProduct(backend, row) {
  const result = call(backend, 'products.create', {
    actorUserId: 'u-aina',
    categoryId: 'cat-ing',
    sellingPrice: 1,
    wholesalePrice: 1,
    ...row,
  })
  assert.equal(result.ok, true, result.error && result.error.message)
  return result
}

function costOf(data, id) {
  const row = data.productCosts.find((item) => item.id === id)
  if (!row) return null
  return { id: String(row.id), costPrice: Number(row.costPrice), costSource: String(row.costSource) }
}

function ledger(backend) {
  return JSON.stringify({
    balances: backend.spreadsheet.store.InventoryBalances || [],
    movements: backend.spreadsheet.store.StockMovements || [],
    display: backend.spreadsheet.store.DisplayStocks || [],
    production: backend.spreadsheet.store.ProductionBalances || [],
    occupancies: backend.spreadsheet.store.SlotOccupancies || [],
  })
}

test('health does not create BOM sheets and Sheet1 stays reserved', () => {
  const backend = app()
  backend.foundation.initialize()
  const health = call(backend, 'system.health', {})
  assert.equal(health.ok, true)
  assert.equal(backend.spreadsheet.store.Boms, undefined)
  assert.equal(backend.spreadsheet.store.BomItems, undefined)
  assert.ok(backend.spreadsheet.store.Sheet1)
})

test('BOM list is permissioned and bootstrap is idempotent', () => {
  const backend = ready()
  const denied = call(backend, 'boms.list', { actorUserId: 'u-mei' })
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'FORBIDDEN')
  const inactive = call(backend, 'boms.list', { actorUserId: 'u-off' })
  assert.equal(inactive.ok, false)
  const first = call(backend, 'boms.bootstrap', { actorUserId: 'u-aina' })
  assert.equal(first.ok, true)
  assert.equal(first.data.boms.length, 9)
  assert.equal(first.data.boms.find((row) => row.id === 'bom-cp').items.length, 5)
  assert.equal(first.data.boms.find((row) => row.id === 'bom-pack-cl').bulkYieldGrams, 2000)
  const second = call(backend, 'boms.bootstrap', { actorUserId: 'u-aina' })
  assert.equal(second.ok, false)
  assert.equal(second.error.code, 'CONFLICT')
  assert.equal(backend.spreadsheet.store.Boms.length, 10)
})

test('bootstrap prices an active BOM from stored component cost and does not explode the child recipe', () => {
  const backend = ready()
  ;[
    ['p-cocoa', 'Cocoa', 'KG', 10],
    ['p-milkpw', 'Milk powder', 'KG', 4],
    ['p-sugar', 'Sugar', 'KG', 2],
    ['p-other', 'Other', 'KG', 1],
    ['p-pouch', 'Pouch', 'PCS', 0.5],
    ['p-cp', 'Chocolate Powder', 'KG', 99],
    ['p-pack-cl', 'Chocolate Lava', 'PACKS', 1],
  ].forEach(([id, name, unit, cost]) => {
    addProduct(backend, { id, name, sku: id.toUpperCase(), unit, purchaseUnit: unit, purchaseConversionQty: 1, purchaseCost: cost })
  })
  const before = ledger(backend)
  const booted = call(backend, 'boms.bootstrap', { actorUserId: 'u-aina' })
  assert.equal(booted.ok, true, booted.error && booted.error.message)
  assert.deepEqual(costOf(booted.data, 'p-cp'), { id: 'p-cp', costPrice: 3.8, costSource: 'bom' })
  assert.deepEqual(costOf(booted.data, 'p-pack-cl'), { id: 'p-pack-cl', costPrice: 1.48, costSource: 'bom' })
  assert.deepEqual(costOf(booted.data, 'p-sugar'), { id: 'p-sugar', costPrice: 2, costSource: 'manual' })
  const lava = booted.data.boms.find((row) => row.id === 'bom-pack-cl')
  assert.equal(lava.items.length, 5)
  assert.equal(JSON.stringify(lava.items).includes('p-cocoa'), false)
  assert.equal(ledger(backend), before)
  assert.equal(backend.spreadsheet.store.StockMovements, undefined)
})

test('create, update, and status keep AUTO and MANUAL and ignore wastage in product cost', () => {
  const backend = ready()
  addProduct(backend, {
    id: 'mat-bag', name: 'Bagged cocoa', sku: 'BAG1', unit: 'KG', purchaseUnit: 'BAG', purchaseConversionQty: 25, purchaseCost: 50,
  })
  addProduct(backend, {
    id: 'mat-g', name: 'Gram sugar', sku: 'GR1', unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1, purchaseCost: 4,
  })
  addProduct(backend, {
    id: 'out-1', name: 'UAT Blend', sku: 'UATB', unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1, purchaseCost: 9,
  })
  addProduct(backend, {
    id: 'out-replay', name: 'Replay Blend', sku: 'UATR', unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1, purchaseCost: 1,
  })
  const missing = post(backend, 'boms.create', { actorUserId: 'u-aina', productId: 'missing', items: [{ productId: 'mat-g', qty: 1, unit: 'KG' }] })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.message, 'Product was not found.')
  const empty = post(backend, 'boms.create', { actorUserId: 'u-aina', productId: 'out-1', items: [] })
  assert.equal(empty.ok, false)
  assert.equal(empty.error.message, 'A BOM needs a finished product and at least one material.')
  assert.equal((backend.spreadsheet.store.AuditLogs || []).filter((row) => row[3] === 'boms.create').length, 0)
  const staff = post(backend, 'boms.create', {
    actorUserId: 'u-mei',
    name: 'Denied',
    productId: 'out-1',
    outputQty: 1,
    outputUnit: 'KG',
    items: [{ productId: 'mat-g', qty: 1, unit: 'KG', consumptionMethod: 'AUTO' }],
  })
  assert.equal(staff.ok, false)
  assert.equal(staff.error.code, 'FORBIDDEN')
  const created = post(backend, 'boms.create', {
    actorUserId: 'u-aina',
    name: 'UAT Blend BOM',
    productId: 'out-1',
    outputQty: 10,
    outputUnit: 'KG',
    notes: 'controlled',
    items: [
      { productId: 'mat-bag', qty: 2, unit: 'BAG', wastagePct: 100, notes: 'bags', consumptionMethod: 'AUTO' },
      { productId: 'mat-g', qty: 500, unit: 'G', wastagePct: 0, notes: 'grams', consumptionMethod: 'MANUAL' },
    ],
  })
  assert.equal(created.ok, true, created.error && created.error.message)
  assert.equal(created.data.bom.items[0].consumptionMethod, 'AUTO')
  assert.equal(created.data.bom.items[1].consumptionMethod, 'MANUAL')
  assert.deepEqual(costOf(created.data, 'out-1'), { id: 'out-1', costPrice: 10.2, costSource: 'bom' })
  const key = 'bom-replay'
  const replayPayload = {
    actorUserId: 'u-aina',
    name: 'Replay BOM',
    productId: 'out-replay',
    outputQty: 1,
    outputUnit: 'KG',
    items: [{ productId: 'mat-g', qty: 1, unit: 'KG', consumptionMethod: 'MANUAL' }],
  }
  const once = post(backend, 'boms.create', replayPayload, { idempotencyKey: key, requestId: 'once' })
  const twice = post(backend, 'boms.create', replayPayload, { idempotencyKey: key, requestId: 'twice' })
  assert.equal(once.ok, true)
  assert.equal(twice.ok, true)
  assert.equal(twice.meta.idempotentReplay, true)
  assert.equal(once.data.bom.id, twice.data.bom.id)
  const beforeRows = backend.spreadsheet.store.Boms.length
  const updated = post(backend, 'boms.update', {
    actorUserId: 'u-aina',
    id: created.data.bom.id,
    name: 'UAT Blend BOM edited',
    productId: 'out-1',
    outputQty: 10,
    outputUnit: 'KG',
    notes: 'edited',
    items: [{ productId: 'mat-g', qty: 1, unit: 'KG', wastagePct: 50, consumptionMethod: 'MANUAL' }],
  })
  assert.equal(updated.ok, true, updated.error && updated.error.message)
  assert.equal(updated.data.bom.name, 'UAT Blend BOM edited')
  assert.equal(updated.data.bom.items.length, 1)
  assert.equal(updated.data.bom.items[0].consumptionMethod, 'MANUAL')
  assert.notEqual(updated.data.bom.items[0].id, created.data.bom.items[1].id)
  assert.deepEqual(costOf(updated.data, 'out-1'), { id: 'out-1', costPrice: 0.4, costSource: 'bom' })
  assert.equal(backend.spreadsheet.store.Boms.length, beforeRows)
  const off = post(backend, 'boms.setStatus', { actorUserId: 'u-aina', id: created.data.bom.id, status: 'inactive' })
  assert.equal(off.ok, true)
  assert.equal(off.data.bom.status, 'inactive')
  assert.deepEqual(costOf(off.data, 'out-1'), { id: 'out-1', costPrice: 0.4, costSource: 'manual' })
  const audits = (backend.spreadsheet.store.AuditLogs || []).slice(1).map((row) => row[3])
  assert.ok(audits.includes('boms.create'))
  assert.ok(audits.includes('boms.update'))
  assert.ok(audits.includes('boms.setStatus'))
  const costAudit = (backend.spreadsheet.store.AuditLogs || []).slice(1).filter((row) => row[3] === 'boms.create' && String(row[8]).includes('out-1'))
  assert.ok(costAudit.length >= 1)
})

test('a lock refusal writes no BOM and a second status of a missing BOM does not audit', () => {
  const backend = ready()
  addProduct(backend, { id: 'out-2', name: 'Other blend', sku: 'UAT2', unit: 'KG', purchaseUnit: 'KG', purchaseCost: 1 })
  const blocked = app(() => false)
  blocked.foundation.initialize()
  blocked.spreadsheet.store = backend.spreadsheet.store
  blocked.idempotency = blocked.context.createIdempotencyService(blocked.sheets)
  blocked.boms = blocked.context.createBomService({ sheetRepository: blocked.sheets })
  const refused = post(blocked, 'boms.create', {
    actorUserId: 'u-aina',
    name: 'Locked',
    productId: 'out-2',
    outputQty: 1,
    outputUnit: 'KG',
    items: [{ productId: 'out-2', qty: 1, unit: 'KG' }],
  })
  assert.equal(refused.ok, false)
  assert.equal(refused.error.message, 'The request could not get a lock in time.')
  assert.equal(backend.spreadsheet.store.Boms, undefined)
  const missing = post(backend, 'boms.setStatus', { actorUserId: 'u-aina', id: 'bom-missing', status: 'inactive' })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.message, 'BOM not found.')
  assert.equal((backend.spreadsheet.store.AuditLogs || []).some((row) => row[3] === 'boms.setStatus'), false)
})
