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
    inventory: context.createInventoryService({ sheetRepository: sheets }),
    boms: context.createBomService({ sheetRepository: sheets }),
    manufacturing: context.createManufacturingService({ sheetRepository: sheets, driveStorage }),
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
    idempotencyKey: extra.idempotencyKey || `mfg-${keySeq}`,
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
    purchaseCost: 1,
    ...row,
  })
  assert.equal(result.ok, true, result.error && result.error.message)
  return result.data.find ? result.data : result.data
}

function createBom(backend, row) {
  const result = post(backend, 'boms.create', { actorUserId: 'u-aina', ...row })
  assert.equal(result.ok, true, result.error && result.error.message)
  return result.data.boms.find((bom) => bom.name === row.name) || result.data.boms[0]
}

function stock(backend, productId, qty) {
  const result = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId, type: 'increase', qty, reason: 'UAT manufacturing stock',
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

test('health does not create manufacturing sheets and Sheet1 stays reserved', () => {
  const backend = app()
  backend.foundation.initialize()
  const health = call(backend, 'system.health', {})
  assert.equal(health.ok, true)
  assert.equal(backend.spreadsheet.store.PackingAssemblies, undefined)
  assert.equal(backend.spreadsheet.store.ProductionOrders, undefined)
  assert.equal(backend.spreadsheet.store.Batches, undefined)
  assert.ok(backend.spreadsheet.store.Sheet1)
})

test('packing list is permissioned and cashier cannot confirm', () => {
  const backend = ready()
  const denied = call(backend, 'packing.list', { actorUserId: 'u-siti' })
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'FORBIDDEN')
  const listed = call(backend, 'packing.list', { actorUserId: 'u-aina' })
  assert.equal(listed.ok, true)
  assert.equal(listed.data.packingAssemblies.length, 0)
  assert.equal(listed.data.productionOrders.length, 0)
  assert.equal(listed.data.productionSessions.length, 0)
})

test('packing confirm posts AUTO out and finished goods in, skips MANUAL, and is retry-safe', () => {
  const backend = ready()
  addProduct(backend, { id: 'p-bulk', name: 'Bulk G', sku: 'BULK', unit: 'G', purchaseUnit: 'G', purchaseConversionQty: 1 })
  addProduct(backend, { id: 'p-pouch', name: 'Pouch', sku: 'POUCH', unit: 'PCS', purchaseUnit: 'PCS', purchaseConversionQty: 1 })
  addProduct(backend, { id: 'p-label', name: 'Label', sku: 'LABEL', unit: 'PCS', purchaseUnit: 'PCS', purchaseConversionQty: 1 })
  addProduct(backend, { id: 'p-out', name: 'Pack 200g', sku: 'P200', unit: 'PCS', purchaseUnit: 'PCS', purchaseConversionQty: 1 })
  const bom = createBom(backend, {
    name: '200g BOM',
    productId: 'p-out',
    outputQty: 1,
    outputUnit: 'PCS',
    notes: '',
    items: [
      { productId: 'p-bulk', qty: 200, unit: 'G', wastagePct: 0, notes: '', consumptionMethod: 'AUTO' },
      { productId: 'p-pouch', qty: 1, unit: 'PCS', wastagePct: 0, notes: '', consumptionMethod: 'AUTO' },
      { productId: 'p-label', qty: 1, unit: 'PCS', wastagePct: 0, notes: '', consumptionMethod: 'MANUAL' },
    ],
  })
  stock(backend, 'p-bulk', 20000)
  stock(backend, 'p-pouch', 500)
  stock(backend, 'p-label', 500)
  const created = post(backend, 'packing.create', {
    actorUserId: 'u-aina',
    clientId: 'pak_uat1',
    productId: 'p-out',
    bomId: bom.id,
    warehouseId: 'wh-main',
    plannedQty: 50,
    actualQty: 50,
    notes: 'UAT pack',
  })
  assert.equal(created.ok, true, created.error && created.error.message)
  assert.equal(created.data.packing.status, 'draft')
  assert.equal(created.data.packing.posted, false)
  assert.equal(qty(created.data, 'p-out'), 0)
  assert.equal(qty(created.data, 'p-label'), 500)

  const cashier = post(backend, 'packing.confirm', { actorUserId: 'u-siti', id: 'pak_uat1' })
  assert.equal(cashier.ok, false)
  assert.equal(cashier.error.code, 'FORBIDDEN')

  const agentWh = post(backend, 'packing.create', {
    actorUserId: 'u-aina',
    productId: 'p-out',
    bomId: bom.id,
    warehouseId: 'wh-agent',
    plannedQty: 1,
    actualQty: 1,
  })
  assert.equal(agentWh.ok, false)
  assert.equal(agentWh.error.message, 'Choose a company warehouse.')

  const zero = post(backend, 'packing.create', {
    actorUserId: 'u-aina',
    productId: 'p-out',
    bomId: bom.id,
    warehouseId: 'wh-main',
    plannedQty: 0,
    actualQty: 0,
  })
  assert.equal(zero.ok, false)

  const over = post(backend, 'packing.create', {
    actorUserId: 'u-aina',
    productId: 'p-out',
    bomId: bom.id,
    warehouseId: 'wh-main',
    plannedQty: 10,
    actualQty: 11,
  })
  assert.equal(over.ok, false)
  assert.equal(over.error.message, 'Actual quantity cannot exceed planned quantity.')

  const confirmKey = 'pack-confirm-1'
  const confirmed = post(backend, 'packing.confirm', { actorUserId: 'u-aina', id: 'pak_uat1' }, { idempotencyKey: confirmKey })
  assert.equal(confirmed.ok, true, confirmed.error && confirmed.error.message)
  assert.equal(confirmed.data.packing.status, 'confirmed')
  assert.equal(confirmed.data.packing.posted, true)
  assert.equal(qty(confirmed.data, 'p-bulk'), 10000)
  assert.equal(qty(confirmed.data, 'p-pouch'), 450)
  assert.equal(qty(confirmed.data, 'p-label'), 500)
  assert.equal(qty(confirmed.data, 'p-out'), 50)
  const mv = movements(confirmed.data, confirmed.data.packing.packingNo)
  assert.equal(mv.filter((row) => row.type === 'production_out').length, 2)
  assert.equal(mv.filter((row) => row.type === 'production_in').length, 1)
  assert.equal(mv.some((row) => row.productId === 'p-label'), false)

  const retry = post(backend, 'packing.confirm', { actorUserId: 'u-aina', id: 'pak_uat1' }, { idempotencyKey: confirmKey })
  assert.equal(retry.ok, true)
  assert.equal(qty(retry.data, 'p-out'), 50)
  assert.equal(movements(retry.data, retry.data.packing.packingNo).length, 3)
  assert.equal((backend.spreadsheet.store.AuditLogs || []).filter((row) => row[3] === 'packing.confirm').length, 1)

  const cancelConfirmed = call(backend, 'packing.cancel', { actorUserId: 'u-aina', id: 'pak_uat1' })
  assert.equal(cancelConfirmed.ok, false)
})

test('packing confirm refuses shortage, circular BOM, and changed BOM unless acceptSnapshot', () => {
  const backend = ready()
  addProduct(backend, { id: 'p-a', name: 'Circ A', sku: 'CA', unit: 'PCS', purchaseUnit: 'PCS', purchaseConversionQty: 1 })
  addProduct(backend, { id: 'p-b', name: 'Circ B', sku: 'CB', unit: 'PCS', purchaseUnit: 'PCS', purchaseConversionQty: 1 })
  addProduct(backend, { id: 'p-comp', name: 'Comp', sku: 'CMP', unit: 'PCS', purchaseUnit: 'PCS', purchaseConversionQty: 1 })
  addProduct(backend, { id: 'p-fg', name: 'FG', sku: 'FG1', unit: 'PCS', purchaseUnit: 'PCS', purchaseConversionQty: 1 })
  createBom(backend, {
    name: 'Circ A', productId: 'p-a', outputQty: 1, outputUnit: 'PCS', notes: '',
    items: [{ productId: 'p-b', qty: 1, unit: 'PCS', wastagePct: 0, notes: '', consumptionMethod: 'AUTO' }],
  })
  createBom(backend, {
    name: 'Circ B', productId: 'p-b', outputQty: 1, outputUnit: 'PCS', notes: '',
    items: [{ productId: 'p-a', qty: 1, unit: 'PCS', wastagePct: 0, notes: '', consumptionMethod: 'AUTO' }],
  })
  const circular = post(backend, 'packing.create', {
    actorUserId: 'u-aina', productId: 'p-a', bomId: (call(backend, 'boms.list', { actorUserId: 'u-aina' }).data.boms.find((row) => row.productId === 'p-a') || {}).id,
    warehouseId: 'wh-main', plannedQty: 1, actualQty: 1,
  })
  assert.equal(circular.ok, false)
  assert.match(circular.error.message, /circular/i)

  const bom = createBom(backend, {
    name: 'FG BOM', productId: 'p-fg', outputQty: 1, outputUnit: 'PCS', notes: '',
    items: [{ productId: 'p-comp', qty: 2, unit: 'PCS', wastagePct: 0, notes: '', consumptionMethod: 'AUTO' }],
  })
  stock(backend, 'p-comp', 2)
  const draft = post(backend, 'packing.create', {
    actorUserId: 'u-aina', clientId: 'pak_short', productId: 'p-fg', bomId: bom.id,
    warehouseId: 'wh-main', plannedQty: 5, actualQty: 5,
  })
  assert.equal(draft.ok, true, draft.error && draft.error.message)
  const before = (backend.spreadsheet.store.StockMovements || []).length
  const blocked = post(backend, 'packing.confirm', { actorUserId: 'u-aina', id: 'pak_short' })
  assert.equal(blocked.ok, false)
  assert.match(blocked.error.message, /Insufficient stock/)
  assert.equal((backend.spreadsheet.store.StockMovements || []).length, before)

  const okDraft = post(backend, 'packing.create', {
    actorUserId: 'u-aina', clientId: 'pak_snap', productId: 'p-fg', bomId: bom.id,
    warehouseId: 'wh-main', plannedQty: 1, actualQty: 1,
  })
  assert.equal(okDraft.ok, true)
  const updated = post(backend, 'boms.update', {
    actorUserId: 'u-aina',
    id: bom.id,
    name: 'FG BOM v2',
    productId: 'p-fg',
    outputQty: 1,
    outputUnit: 'PCS',
    notes: '',
    items: [{ productId: 'p-comp', qty: 3, unit: 'PCS', wastagePct: 0, notes: '', consumptionMethod: 'AUTO' }],
  })
  assert.equal(updated.ok, true, updated.error && updated.error.message)
  const changed = post(backend, 'packing.confirm', { actorUserId: 'u-aina', id: 'pak_snap' })
  assert.equal(changed.ok, false)
  assert.match(changed.error.message, /BOM has changed/)
  const accepted = post(backend, 'packing.confirm', { actorUserId: 'u-aina', id: 'pak_snap', acceptSnapshot: true })
  assert.equal(accepted.ok, true, accepted.error && accepted.error.message)
  assert.equal(accepted.data.packing.posted, true)
  assert.equal(qty(accepted.data, 'p-comp'), 0)
  assert.equal(qty(accepted.data, 'p-fg'), 1)
})

test('production complete posts AUTO consumption and a batch, MANUAL does not auto-out, retry does not double', () => {
  const backend = ready()
  addProduct(backend, { id: 'p-sugar', name: 'Sugar', sku: 'SUG', unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1, purchaseCost: 2 })
  addProduct(backend, { id: 'p-cocoa', name: 'Cocoa', sku: 'COC', unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1, purchaseCost: 10 })
  addProduct(backend, { id: 'p-cp', name: 'Chocolate Powder', sku: 'CP', unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1, purchaseCost: 1 })
  const bom = createBom(backend, {
    name: 'CP BOM',
    productId: 'p-cp',
    outputQty: 1,
    outputUnit: 'KG',
    notes: '',
    items: [
      { productId: 'p-sugar', qty: 0.4, unit: 'KG', wastagePct: 0, notes: '', consumptionMethod: 'AUTO' },
      { productId: 'p-cocoa', qty: 0.2, unit: 'KG', wastagePct: 0, notes: '', consumptionMethod: 'MANUAL' },
    ],
  })
  stock(backend, 'p-sugar', 10)
  stock(backend, 'p-cocoa', 10)
  const cashier = post(backend, 'productionOrders.create', {
    actorUserId: 'u-siti', productId: 'p-cp', bomId: bom.id, warehouseId: 'wh-main',
    plannedQty: 5, plannedStart: '2026-09-10', plannedEnd: '2026-09-10', operator: 'Aina', notes: '',
  })
  assert.equal(cashier.ok, false)
  assert.equal(cashier.error.code, 'FORBIDDEN')

  const created = post(backend, 'productionOrders.create', {
    actorUserId: 'u-aina', clientId: 'po_uat1', productId: 'p-cp', bomId: bom.id, warehouseId: 'wh-main',
    plannedQty: 5, plannedStart: '2026-09-10', plannedEnd: '2026-09-10', operator: 'Aina', notes: 'UAT PO',
  })
  assert.equal(created.ok, true, created.error && created.error.message)
  assert.equal(created.data.productionOrder.status, 'planned')
  const tooSoon = post(backend, 'productionOrders.complete', {
    actorUserId: 'u-aina', id: 'po_uat1', actualQty: 5, batchNo: 'CP-TEST',
  })
  assert.equal(tooSoon.ok, false)
  assert.equal(tooSoon.error.message, 'Start production first')

  const started = call(backend, 'productionOrders.start', { actorUserId: 'u-aina', id: 'po_uat1' })
  assert.equal(started.ok, true, started.error && started.error.message)
  assert.equal(started.data.productionOrder.status, 'in_progress')

  const completeKey = 'po-complete-1'
  const completed = post(backend, 'productionOrders.complete', {
    actorUserId: 'u-aina', id: 'po_uat1', actualQty: 4, batchNo: 'CP-TEST', expiryDate: '2027-03-10',
  }, { idempotencyKey: completeKey })
  assert.equal(completed.ok, true, completed.error && completed.error.message)
  assert.equal(completed.data.productionOrder.status, 'completed')
  assert.equal(completed.data.productionOrder.posted, true)
  assert.equal(qty(completed.data, 'p-sugar'), 8)
  assert.equal(qty(completed.data, 'p-cocoa'), 10)
  assert.equal(qty(completed.data, 'p-cp'), 4)
  const mv = movements(completed.data, completed.data.productionOrder.orderNo)
  assert.equal(mv.filter((row) => row.type === 'production_out' && row.productId === 'p-sugar').length, 1)
  assert.equal(mv.some((row) => row.productId === 'p-cocoa'), false)
  assert.equal(completed.data.batches.length, 1)
  assert.equal(completed.data.batches[0].batchNo, 'CP-TEST')
  assert.equal(completed.data.batches[0].qty, 4)
  assert.equal(completed.data.productionOrder.wastage.some((row) => row.kind === 'yield_variance' && row.qty === 1), true)

  const retry = post(backend, 'productionOrders.complete', {
    actorUserId: 'u-aina', id: 'po_uat1', actualQty: 4, batchNo: 'CP-TEST',
  }, { idempotencyKey: completeKey })
  assert.equal(retry.ok, true)
  assert.equal(qty(retry.data, 'p-cp'), 4)
  assert.equal(movements(retry.data, retry.data.productionOrder.orderNo).length, 2)
  assert.equal(retry.data.batches.length, 1)

  const requestPr = call(backend, 'productionOrders.createPurchaseRequest', { actorUserId: 'u-aina', id: 'po_uat1' })
  assert.equal(requestPr.ok, true)
  assert.equal(requestPr.data.purchaseRequest.created, false)
  assert.equal(requestPr.data.purchaseRequest.preview, true)
})

test('production start shortage, pause/resume, cancel, and extra consumption line', () => {
  const backend = ready()
  addProduct(backend, { id: 'p-mat', name: 'Mat', sku: 'MAT', unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1 })
  addProduct(backend, { id: 'p-fg2', name: 'FG2', sku: 'FG2', unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1 })
  const bom = createBom(backend, {
    name: 'FG2 BOM', productId: 'p-fg2', outputQty: 1, outputUnit: 'KG', notes: '',
    items: [{ productId: 'p-mat', qty: 1, unit: 'KG', wastagePct: 0, notes: '', consumptionMethod: 'AUTO' }],
  })
  const created = post(backend, 'productionOrders.create', {
    actorUserId: 'u-aina', clientId: 'po_short', productId: 'p-fg2', bomId: bom.id, warehouseId: 'wh-main',
    plannedQty: 3, plannedStart: '2026-09-10', plannedEnd: '2026-09-10', operator: 'Aina', notes: '',
  })
  assert.equal(created.ok, true)
  const blocked = call(backend, 'productionOrders.start', { actorUserId: 'u-aina', id: 'po_short' })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error.message, 'Material shortage')
  const forced = call(backend, 'productionOrders.start', { actorUserId: 'u-aina', id: 'po_short', ignoreShortage: true })
  assert.equal(forced.ok, true)
  const paused = call(backend, 'productionOrders.pause', { actorUserId: 'u-aina', id: 'po_short' })
  assert.equal(paused.data.productionOrder.status, 'paused')
  const resumed = call(backend, 'productionOrders.resume', { actorUserId: 'u-aina', id: 'po_short' })
  assert.equal(resumed.data.productionOrder.status, 'in_progress')
  const cancelled = call(backend, 'productionOrders.cancel', { actorUserId: 'u-aina', id: 'po_short' })
  assert.equal(cancelled.data.productionOrder.status, 'cancelled')

  stock(backend, 'p-mat', 20)
  const second = post(backend, 'productionOrders.create', {
    actorUserId: 'u-aina', clientId: 'po_extra', productId: 'p-fg2', bomId: bom.id, warehouseId: 'wh-main',
    plannedQty: 1, plannedStart: '2026-09-10', plannedEnd: '2026-09-10', operator: 'Aina', notes: '',
  })
  assert.equal(second.ok, true)
  addProduct(backend, { id: 'p-extra', name: 'Extra', sku: 'EXT', unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1 })
  stock(backend, 'p-extra', 5)
  const added = call(backend, 'productionOrders.addLine', { actorUserId: 'u-aina', id: 'po_extra', productId: 'p-extra', qty: 1 })
  assert.equal(added.ok, true, added.error && added.error.message)
  assert.equal(added.data.productionOrder.consumptions.some((line) => line.productId === 'p-extra'), true)
  const started = call(backend, 'productionOrders.start', { actorUserId: 'u-aina', id: 'po_extra' })
  assert.equal(started.ok, true)
  const done = post(backend, 'productionOrders.complete', {
    actorUserId: 'u-aina', id: 'po_extra', actualQty: 1, batchNo: 'FG2-1',
  })
  assert.equal(done.ok, true, done.error && done.error.message)
  assert.equal(qty(done.data, 'p-mat'), 19)
  assert.equal(qty(done.data, 'p-extra'), 4)
})

test('packing and production do not rewrite receiving sheets', () => {
  const backend = ready()
  addProduct(backend, { id: 'p-x', name: 'X', sku: 'X1', unit: 'PCS', purchaseUnit: 'PCS', purchaseConversionQty: 1 })
  addProduct(backend, { id: 'p-y', name: 'Y', sku: 'Y1', unit: 'PCS', purchaseUnit: 'PCS', purchaseConversionQty: 1 })
  const bom = createBom(backend, {
    name: 'Y BOM', productId: 'p-y', outputQty: 1, outputUnit: 'PCS', notes: '',
    items: [{ productId: 'p-x', qty: 1, unit: 'PCS', wastagePct: 0, notes: '', consumptionMethod: 'AUTO' }],
  })
  stock(backend, 'p-x', 5)
  const created = post(backend, 'packing.create', {
    actorUserId: 'u-aina', productId: 'p-y', bomId: bom.id, warehouseId: 'wh-main', plannedQty: 1, actualQty: 1,
  })
  assert.equal(created.ok, true)
  const confirmed = post(backend, 'packing.confirm', { actorUserId: 'u-aina', id: created.data.packing.id })
  assert.equal(confirmed.ok, true, confirmed.error && confirmed.error.message)
  assert.equal((backend.spreadsheet.store.Receivings || []).length <= 1, true)
  assert.equal((backend.spreadsheet.store.ReceivingLines || []).length <= 1, true)
  assert.equal((backend.spreadsheet.store.Purchases || []).length, 0)
  assert.equal((confirmed.data.stockMovements || []).every((row) => row.type !== 'receiving'), true)
})

const RECIPE_PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function seedDailySession(backend) {
  addProduct(backend, { id: 'p-s12auto', name: 'S12 Auto Mix', sku: 'S12A', unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1 })
  addProduct(backend, { id: 'p-s12pouch', name: 'S12 Pouch', sku: 'S12P', unit: 'PCS', purchaseUnit: 'PCS', purchaseConversionQty: 1 })
  addProduct(backend, { id: 'p-s12fg', name: 'S12 Pack', sku: 'S12F', unit: 'PCS', purchaseUnit: 'PCS', purchaseConversionQty: 1 })
  const bom = createBom(backend, {
    name: 'S12 daily BOM',
    productId: 'p-s12fg',
    outputQty: 10,
    outputUnit: 'PCS',
    bulkYieldGrams: 2000,
    notes: '',
    items: [
      { productId: 'p-s12auto', qty: 2, unit: 'KG', wastagePct: 0, notes: '', consumptionMethod: 'AUTO' },
      { productId: 'p-s12pouch', qty: 10, unit: 'PCS', wastagePct: 0, notes: '', consumptionMethod: 'MANUAL' },
    ],
  })
  stock(backend, 'p-s12auto', 20)
  stock(backend, 'p-s12pouch', 50)
  const created = post(backend, 'sessions.create', {
    actorUserId: 'u-aina',
    clientId: 'ps_s12',
    productionDate: todayKey(),
    warehouseId: 'wh-main',
    items: [{ productId: 'p-s12fg', targetQty: 10 }],
    notes: 'Step 12 UAT',
  })
  assert.equal(created.ok, true, created.error && created.error.message)
  return { bom, session: created.data.productionSession, snapshot: created.data }
}

function closingInputs(remainingAuto = 0, remainingPouch = 0) {
  return [
    { productId: 'p-s12auto', fullUnits: 0, looseQty: remainingAuto },
    { productId: 'p-s12pouch', fullUnits: 0, looseQty: remainingPouch },
  ]
}

function resultLine(overrides = {}) {
  return {
    productId: 'p-s12fg',
    actualQty: 10,
    productionBalanceQty: 0,
    balanceLocation: '',
    balanceContainer: '',
    wasteQty: 0,
    shortProductionReason: '',
    notes: '',
    displayQty: 2,
    cartonQty: 8,
    ...overrides,
  }
}

test('daily session create is permissioned and does not post stock', () => {
  const backend = ready()
  const { snapshot } = seedDailySession(backend)
  assert.equal(snapshot.productionSession.status, 'planned')
  assert.equal(snapshot.productionSession.posted, false)
  assert.match(snapshot.productionSession.reference, /^PROD-\d{8}-001$/)
  assert.equal(qty(snapshot, 'p-s12auto'), 20)
  assert.equal(qty(snapshot, 'p-s12fg'), 0)
  const cashier = post(backend, 'sessions.create', {
    actorUserId: 'u-siti',
    clientId: 'ps_s12_cashier',
    productionDate: todayKey(),
    items: [{ productId: 'p-s12fg', targetQty: 1 }],
  })
  assert.equal(cashier.ok, false)
  assert.equal(cashier.error.code, 'FORBIDDEN')
  const listed = call(backend, 'sessions.list', { actorUserId: 'u-siti' })
  assert.equal(listed.ok, false)
  assert.equal(listed.error.code, 'FORBIDDEN')
})

test('daily session complete posts AUTO out, skips MANUAL, requires display+carton=actual, and is retry-safe', () => {
  const backend = ready()
  const { session } = seedDailySession(backend)
  const accepted = call(backend, 'sessions.accept', { actorUserId: 'u-aina', id: session.id })
  assert.equal(accepted.ok, true, accepted.error && accepted.error.message)
  assert.equal(accepted.data.productionSession.status, 'accepted')

  const started = call(backend, 'sessions.start', {
    actorUserId: 'u-aina',
    id: session.id,
    recipePhoto: RECIPE_PHOTO,
    recipePhotoName: 'recipe.png',
  })
  assert.equal(started.ok, true, started.error && started.error.message)
  assert.equal(started.data.productionSession.status, 'in_progress')
  assert.ok(started.data.productionSession.recipePhoto)
  const autoLine = started.data.productionSession.picking.find((row) => row.id === 'raw-p-s12auto')
  assert.ok(autoLine)
  const picked = call(backend, 'sessions.togglePicking', {
    actorUserId: 'u-aina',
    id: session.id,
    lineId: autoLine.id,
    picked: true,
  })
  assert.equal(picked.ok, true, picked.error && picked.error.message)
  assert.equal(picked.data.productionSession.materialAllocations.some((row) => row.productId === 'p-s12auto' && row.source === 'picking'), true)

  const savedResult = call(backend, 'sessions.saveResult', {
    actorUserId: 'u-aina',
    id: session.id,
    results: [resultLine()],
  })
  assert.equal(savedResult.ok, true, savedResult.error && savedResult.error.message)

  const mismatch = call(backend, 'sessions.saveDistribution', {
    actorUserId: 'u-aina',
    id: session.id,
    results: [resultLine({ displayQty: 1, cartonQty: 1 })],
  })
  assert.equal(mismatch.ok, false)
  assert.match(mismatch.error.message, /Display \+ Carton must equal Actual/)

  const savedDist = call(backend, 'sessions.saveDistribution', {
    actorUserId: 'u-aina',
    id: session.id,
    results: [resultLine()],
  })
  assert.equal(savedDist.ok, true, savedDist.error && savedDist.error.message)

  const savedClose = call(backend, 'sessions.saveMaterialClosing', {
    actorUserId: 'u-aina',
    id: session.id,
    acknowledged: true,
    inputs: closingInputs(0, 0),
  })
  assert.equal(savedClose.ok, true, savedClose.error && savedClose.error.message)

  const noAck = post(backend, 'sessions.complete', {
    actorUserId: 'u-aina',
    id: session.id,
    results: [resultLine()],
    closing: { acknowledged: false, inputs: closingInputs(0, 0) },
  })
  assert.equal(noAck.ok, false)

  const done = post(backend, 'sessions.complete', {
    actorUserId: 'u-aina',
    id: session.id,
    results: [resultLine()],
    closing: { acknowledged: true, inputs: closingInputs(0, 0) },
  }, { idempotencyKey: 's12-complete' })
  assert.equal(done.ok, true, done.error && done.error.message)
  const completed = done.data.productionSession
  assert.equal(completed.status, 'completed')
  assert.equal(completed.posted, true)
  assert.equal(completed.items[0].displayQty, 2)
  assert.equal(completed.items[0].cartonQty, 8)
  assert.equal(qty(done.data, 'p-s12auto'), 18)
  assert.equal(qty(done.data, 'p-s12pouch'), 50)
  assert.equal(qty(done.data, 'p-s12fg'), 10)
  const autoMoves = movements(done.data, completed.reference).filter((row) => row.productId === 'p-s12auto')
  const pouchMoves = movements(done.data, completed.reference).filter((row) => row.productId === 'p-s12pouch')
  const fgMoves = movements(done.data, completed.reference).filter((row) => row.productId === 'p-s12fg' && row.type === 'production_in')
  assert.equal(autoMoves.length, 1)
  assert.equal(autoMoves[0].type, 'production_out')
  assert.equal(autoMoves[0].stockOut, 2)
  assert.equal(pouchMoves.length, 0)
  assert.equal(fgMoves.length, 1)
  assert.equal(fgMoves[0].stockIn, 10)
  const display = (done.data.displayStocks || []).find((row) => row.productId === 'p-s12fg' && row.warehouseId === 'wh-main')
  assert.equal(display && display.qty, 2)

  const retry = post(backend, 'sessions.complete', {
    actorUserId: 'u-aina',
    id: session.id,
    results: [resultLine()],
    closing: { acknowledged: true, inputs: closingInputs(0, 0) },
  }, { idempotencyKey: 's12-complete' })
  assert.equal(retry.ok, true, retry.error && retry.error.message)
  assert.equal(qty(retry.data, 'p-s12auto'), 18)
  assert.equal(qty(retry.data, 'p-s12fg'), 10)
  assert.equal(movements(retry.data, completed.reference).filter((row) => row.type === 'production_in').length, 1)

  const otherKey = post(backend, 'sessions.complete', {
    actorUserId: 'u-aina',
    id: session.id,
    results: [resultLine()],
    closing: { acknowledged: true, inputs: closingInputs(0, 0) },
  }, { idempotencyKey: 's12-complete-other' })
  assert.equal(otherKey.ok, false)
  assert.equal(otherKey.error.code, 'CONFLICT')
})

test('daily session carry-forward continues remaining target once', () => {
  const backend = ready()
  addProduct(backend, { id: 'p-s12auto', name: 'S12 Auto Mix', sku: 'S12A', unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1 })
  addProduct(backend, { id: 'p-s12pouch', name: 'S12 Pouch', sku: 'S12P', unit: 'PCS', purchaseUnit: 'PCS', purchaseConversionQty: 1 })
  addProduct(backend, { id: 'p-s12fg', name: 'S12 Pack', sku: 'S12F', unit: 'PCS', purchaseUnit: 'PCS', purchaseConversionQty: 1 })
  createBom(backend, {
    name: 'S12 daily BOM',
    productId: 'p-s12fg',
    outputQty: 10,
    outputUnit: 'PCS',
    bulkYieldGrams: 2000,
    notes: '',
    items: [
      { productId: 'p-s12auto', qty: 2, unit: 'KG', wastagePct: 0, notes: '', consumptionMethod: 'AUTO' },
      { productId: 'p-s12pouch', qty: 10, unit: 'PCS', wastagePct: 0, notes: '', consumptionMethod: 'MANUAL' },
    ],
  })
  stock(backend, 'p-s12auto', 20)
  stock(backend, 'p-s12pouch', 50)
  const created = post(backend, 'sessions.create', {
    actorUserId: 'u-aina',
    clientId: 'ps_s12cf',
    productionDate: todayKey(),
    items: [{ productId: 'p-s12fg', targetQty: 10 }],
  })
  assert.equal(created.ok, true, created.error && created.error.message)
  const id = created.data.productionSession.id
  assert.equal(call(backend, 'sessions.accept', { actorUserId: 'u-aina', id }).ok, true)
  const started = call(backend, 'sessions.start', {
    actorUserId: 'u-aina', id, recipePhoto: RECIPE_PHOTO, recipePhotoName: 'recipe.png',
  })
  assert.equal(started.ok, true, started.error && started.error.message)
  const autoLine = started.data.productionSession.picking.find((row) => row.id === 'raw-p-s12auto')
  assert.equal(call(backend, 'sessions.togglePicking', { actorUserId: 'u-aina', id, lineId: autoLine.id, picked: true }).ok, true)
  const short = resultLine({ actualQty: 6, displayQty: 2, cartonQty: 4, carryForward: true })
  const done = post(backend, 'sessions.complete', {
    actorUserId: 'u-aina',
    id,
    results: [short],
    closing: { acknowledged: true, inputs: closingInputs(0, 0) },
  })
  assert.equal(done.ok, true, done.error && done.error.message)
  const originItem = done.data.productionSession.items[0]
  assert.equal(originItem.carryForward, true)
  assert.equal(originItem.actualQty, 6)
  const continued = call(backend, 'sessions.continueCarryForward', {
    actorUserId: 'u-aina',
    originSessionId: id,
    originItemId: originItem.id,
    clientId: 'ps_s12cf2',
  })
  assert.equal(continued.ok, true, continued.error && continued.error.message)
  const next = continued.data.productionSession
  assert.equal(next.status, 'planned')
  assert.equal(next.id, 'ps_s12cf2')
  assert.equal(next.items[0].targetQty, 4)
  assert.equal(next.items[0].carriedFromSessionId, id)
  const again = call(backend, 'sessions.continueCarryForward', {
    actorUserId: 'u-aina',
    originSessionId: id,
    originItemId: originItem.id,
  })
  assert.equal(again.ok, false)
})

