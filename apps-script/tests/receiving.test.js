import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createFakeDrive,
  createFakeSpreadsheet,
  devProperties,
  loadBackend,
} from './harness.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

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
    Utilities: {
      base64Decode(value) {
        return Buffer.from(String(value), 'base64')
      },
      newBlob(bytes, mime, name) {
        return { bytes, mime, name }
      },
    },
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
    receivings: context.createReceivingService({ sheetRepository: sheets, driveStorage }),
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
    idempotencyKey: extra.idempotencyKey || `rcv-${keySeq}`,
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

function masterPayload() {
  return {
    warehouses: [
      { id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', kind: 'company' },
      { id: 'wh-shop', name: 'Shop', code: 'SHOP', kind: 'company' },
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
    purchaseUnit: 'BAG', purchaseConversionQty: 25, purchaseCost: 50, sellingPrice: 12, trackExpiry: false,
  }).ok, true)
  return backend
}

function qty(data, productId, warehouseId) {
  const row = data.inventory.find((item) => item.productId === productId && item.warehouseId === warehouseId)
  return row ? row.qty : 0
}

test('receiving create posts stock, idempotency, link purchase without double post', () => {
  const backend = ready()
  const denied = post(backend, 'receivings.create', {
    actorUserId: 'u-siti',
    warehouseId: 'wh-main',
    items: [{ productId: 'prd-sugar', qty: 1, condition: 'Baik' }],
  }, { idempotencyKey: 'staff-denied' })
  assert.equal(denied.error?.code, 'FORBIDDEN')

  const missingKey = call(backend, 'receivings.create', {
    actorUserId: 'u-aina',
    warehouseId: 'wh-main',
    items: [{ productId: 'prd-sugar', qty: 1, condition: 'Baik' }],
  })
  assert.equal(missingKey.error.message, 'Idempotency key is required.')

  const created = post(backend, 'receivings.create', {
    actorUserId: 'u-aina',
    clientId: 'rcv_uat_1',
    warehouseId: 'wh-main',
    source: 'shopee',
    items: [{ productId: 'prd-sugar', qty: 2, condition: 'Baik' }],
  }, { idempotencyKey: 'rcv-create-1' })
  assert.equal(created.ok, true)
  assert.equal(created.data.receiving.id, 'rcv_uat_1')
  assert.equal(created.data.receiving.receivingNo, 'RCV-000001')
  assert.equal(qty(created.data, 'prd-sugar', 'wh-main'), 50)
  assert.equal(created.data.stockMovements.some((row) => row.type === 'receiving' && row.stockIn === 50), true)

  const replay = post(backend, 'receivings.create', {
    actorUserId: 'u-aina',
    clientId: 'rcv_uat_1',
    warehouseId: 'wh-main',
    items: [{ productId: 'prd-sugar', qty: 2, condition: 'Baik' }],
  }, { idempotencyKey: 'rcv-create-1' })
  assert.equal(replay.meta.idempotentReplay, true)
  assert.equal(qty(replay.data, 'prd-sugar', 'wh-main'), 50)

  const draft = call(backend, 'purchases.create', {
    actorUserId: 'u-aina',
    clientId: 'pur_link',
    supplierId: 'sup-1',
    warehouseId: 'wh-main',
    invoiceNumber: 'INV-LINK',
    items: [{ productId: 'prd-sugar', qty: 2, price: 50 }],
    receive: false,
  })
  assert.equal(draft.ok, true)

  const linked = post(backend, 'receivings.linkPurchase', {
    actorUserId: 'u-aina',
    receivingId: 'rcv_uat_1',
    purchaseId: 'pur_link',
  }, { idempotencyKey: 'link-1' })
  assert.equal(linked.ok, true)
  assert.equal(linked.data.purchase.receivingId, 'rcv_uat_1')
  assert.equal(qty(linked.data, 'prd-sugar', 'wh-main'), 50)

  const received = post(backend, 'purchases.receive', { actorUserId: 'u-aina', id: 'pur_link' }, { idempotencyKey: 'pur-recv-link' })
  assert.equal(received.ok, true)
  assert.equal(qty(received.data, 'prd-sugar', 'wh-main'), 50)
})

test('mark ordered and cancel stock order', () => {
  const backend = ready()
  const marked = call(backend, 'inventory.markOrdered', {
    actorUserId: 'u-aina',
    productId: 'prd-sugar',
    warehouseId: 'wh-main',
    channel: 'Shopee',
    remark: 'Test cart',
  })
  assert.equal(marked.ok, true)
  assert.equal(marked.data.stockOrders.length, 1)
  assert.equal(marked.data.stockOrders[0].status, 'ordered')
  const orderId = marked.data.stockOrders[0].id

  const dup = call(backend, 'inventory.markOrdered', {
    actorUserId: 'u-aina',
    productId: 'prd-sugar',
    warehouseId: 'wh-main',
  })
  assert.equal(dup.error.message, 'This item is already awaiting receiving.')

  const cancelled = call(backend, 'inventory.cancelOrder', {
    actorUserId: 'u-aina',
    id: orderId,
    reason: 'Supplier cancelled',
  })
  assert.equal(cancelled.ok, true)
  assert.equal(cancelled.data.stockOrders.find((row) => row.id === orderId)?.status, 'cancelled')
})

function twoLinePayload(overrides = {}) {
  return {
    actorUserId: 'u-aina',
    clientId: 'rcv_fault',
    warehouseId: 'wh-main',
    source: 'shopee',
    stockOrderId: 'ORDER_ID',
    items: [
      { productId: 'prd-sugar', qty: 2, condition: 'Baik' },
      { productId: 'prd-flour', qty: 3, condition: 'Baik' },
    ],
    ...overrides,
  }
}

function faultReady() {
  const backend = ready()
  assert.equal(call(backend, 'products.create', {
    actorUserId: 'u-aina', id: 'prd-flour', name: 'UAT Flour', categoryId: 'cat-ing', unit: 'KG',
    purchaseUnit: 'BAG', purchaseConversionQty: 10, purchaseCost: 20, sellingPrice: 5, trackExpiry: false,
  }).ok, true)
  const marked = call(backend, 'inventory.markOrdered', {
    actorUserId: 'u-aina', productId: 'prd-sugar', warehouseId: 'wh-main', channel: 'Shopee',
  })
  assert.equal(marked.ok, true)
  backend.orderId = marked.data.stockOrders[0].id
  assert.equal(call(backend, 'receivings.list', { actorUserId: 'u-aina' }).ok, true)
  return backend
}

function countWrites(backend, failAt) {
  const state = { writes: 0, failed: false }
  for (const name of ['appendObject', 'replaceObjects']) {
    const original = backend.sheets[name]
    backend.sheets[name] = (...args) => {
      state.writes += 1
      if (failAt && state.writes === failAt && !state.failed) {
        state.failed = true
        throw new Error('simulated write failure')
      }
      return original(...args)
    }
  }
  return state
}

function receivingState(backend, payload) {
  const inv = call(backend, 'inventory.get', { actorUserId: 'u-aina' })
  const listed = call(backend, 'receivings.list', { actorUserId: 'u-aina' })
  const audits = backend.sheets.readObjects(backend.spreadsheet.getSheetByName('AuditLogs'))
    .filter((row) => row.action === 'receivings.create' && row.entityId === payload.clientId)
  const idem = backend.sheets.readObjects(backend.spreadsheet.getSheetByName('Idempotency'))
    .filter((row) => row.idempotencyKey === 'rcv-fault-key')
  const lineRows = backend.sheets.readObjects(backend.spreadsheet.getSheetByName('ReceivingLines'))
    .filter((row) => row.receivingId === payload.clientId)
  return {
    sugar: qty(inv.data, 'prd-sugar', 'wh-main'),
    flour: qty(inv.data, 'prd-flour', 'wh-main'),
    movements: inv.data.stockMovements
      .filter((row) => row.type === 'receiving')
      .map((row) => `${row.id}|${row.reference}|${row.productId}|${row.stockIn}|${row.balance}`)
      .sort(),
    receivings: listed.data.receivings.filter((row) => row.id === payload.clientId).length,
    receivingNos: listed.data.receivings.map((row) => row.receivingNo),
    lines: lineRows.length,
    audits: audits.length,
    idempotency: idem.length,
    orderStatus: listed.data.stockOrders.find((row) => row.productId === 'prd-sugar')?.status,
  }
}

test('retry after a failure at every write boundary never double posts', () => {
  const clean = faultReady()
  const payload = twoLinePayload({ stockOrderId: clean.orderId })
  const counter = countWrites(clean, 0)
  const ok = post(clean, 'receivings.create', payload, { idempotencyKey: 'rcv-fault-key' })
  assert.equal(ok.ok, true)
  const total = counter.writes
  assert.ok(total >= 8, `expected several write boundaries, got ${total}`)
  const expected = receivingState(clean, payload)
  assert.equal(expected.movements.length, 2)
  assert.equal(expected.receivings, 1)
  assert.equal(expected.lines, 2)
  assert.equal(expected.audits, 1)
  assert.equal(expected.idempotency, 1)
  assert.equal(expected.orderStatus, 'received')

  for (let failAt = 1; failAt <= total; failAt += 1) {
    const backend = faultReady()
    const livePayload = twoLinePayload({ stockOrderId: backend.orderId })
    const fault = countWrites(backend, failAt)
    const first = post(backend, 'receivings.create', livePayload, { idempotencyKey: 'rcv-fault-key' })
    assert.equal(first.ok, false, `write ${failAt} should have failed the first attempt`)
    assert.equal(fault.failed, true)
    const retry = post(backend, 'receivings.create', livePayload, { idempotencyKey: 'rcv-fault-key' })
    assert.equal(retry.ok, true, `retry after failing write ${failAt}: ${retry.error?.message}`)
    assert.deepEqual(receivingState(backend, livePayload), expected, `state after failing write ${failAt}`)
    const replay = post(backend, 'receivings.create', livePayload, { idempotencyKey: 'rcv-fault-key' })
    assert.equal(replay.ok, true)
    assert.equal(replay.meta.idempotentReplay, true)
    assert.deepEqual(receivingState(backend, livePayload), expected, `state after replay following write ${failAt}`)
  }
})

test('a retry with a new idempotency key resumes the same client id without double posting', () => {
  const backend = faultReady()
  const payload = twoLinePayload({ stockOrderId: backend.orderId })
  countWrites(backend, 2)
  assert.equal(post(backend, 'receivings.create', payload, { idempotencyKey: 'first-key' }).ok, false)
  const retry = post(backend, 'receivings.create', payload, { idempotencyKey: 'second-key' })
  assert.equal(retry.ok, true)
  const state = receivingState(backend, payload)
  assert.equal(state.movements.length, 2)
  assert.equal(state.receivings, 1)
  assert.equal(state.audits, 1)
})

test('a retry that changes the receiving after a partial failure is refused', () => {
  const backend = faultReady()
  const payload = twoLinePayload({ stockOrderId: backend.orderId })
  countWrites(backend, 2)
  assert.equal(post(backend, 'receivings.create', payload, { idempotencyKey: 'rcv-fault-key' }).ok, false)
  const changed = post(backend, 'receivings.create', {
    ...payload,
    items: [{ productId: 'prd-sugar', qty: 9, condition: 'Baik' }, payload.items[1]],
  }, { idempotencyKey: 'rcv-fault-key' })
  assert.equal(changed.error?.code, 'CONFLICT')
  const state = receivingState(backend, payload)
  assert.equal(state.movements.length, 1)
  assert.equal(state.receivings, 0)
})

function failOnceOnAudit(backend) {
  const original = backend.sheets.appendObject
  let failed = false
  backend.sheets.appendObject = (sheet, record) => {
    if (!failed && record && record.action === 'receivings.create') {
      failed = true
      throw new Error('simulated write failure')
    }
    return original(sheet, record)
  }
}

function sheetSnapshot(backend) {
  return JSON.parse(JSON.stringify({
    StockMovements: backend.spreadsheet.store.StockMovements || [],
    InventoryBalances: backend.spreadsheet.store.InventoryBalances || [],
    Receivings: backend.spreadsheet.store.Receivings || [],
    ReceivingLines: backend.spreadsheet.store.ReceivingLines || [],
    StockOrders: backend.spreadsheet.store.StockOrders || [],
    AuditLogs: backend.spreadsheet.store.AuditLogs || [],
  }))
}

function rejectAlteredRetryAfterPartialCreate(label, mutateItems) {
  const backend = faultReady()
  const payload = twoLinePayload({ stockOrderId: backend.orderId })
  failOnceOnAudit(backend)
  assert.equal(post(backend, 'receivings.create', payload, { idempotencyKey: 'rcv-fault-key' }).ok, false)
  const before = sheetSnapshot(backend)
  assert.ok(before.Receivings.length > 1, `${label}: receiving header should exist after the partial write`)
  assert.equal(before.ReceivingLines.filter((row) => row[1] === payload.clientId).length, 2, `${label}: both lines should exist after the partial write`)
  const rejected = post(backend, 'receivings.create', {
    ...payload,
    items: mutateItems(payload.items),
  }, { idempotencyKey: 'rcv-fault-key' })
  assert.equal(rejected.error?.code, 'CONFLICT', label)
  assert.deepEqual(sheetSnapshot(backend), before, `${label}: rejected retry must not write`)
}

test('a retry that removes an item after a partial failure is refused', () => {
  rejectAlteredRetryAfterPartialCreate('remove item', (items) => [items[0]])
})

test('a retry that adds an item after a partial failure is refused', () => {
  rejectAlteredRetryAfterPartialCreate('add item', (items) => [
    ...items,
    { productId: 'prd-sugar', qty: 1, condition: 'Baik' },
  ])
})

test('a retry that reorders items after a partial failure is refused', () => {
  rejectAlteredRetryAfterPartialCreate('reorder items', (items) => [items[1], items[0]])
})

test('a completed receiving is returned for its own key and refused for another key', () => {
  const backend = faultReady()
  const payload = twoLinePayload({ stockOrderId: backend.orderId })
  const created = post(backend, 'receivings.create', payload, { idempotencyKey: 'rcv-fault-key' })
  assert.equal(created.ok, true)
  const before = receivingState(backend, payload)
  const direct = (key) => {
    try {
      return backend.receivings.dispatch({
        v: 1, requestId: 'direct', action: 'receivings.create', payload, idempotencyKey: key,
      })
    } catch (error) {
      return { ok: false, error: { code: error.code } }
    }
  }
  const same = direct('rcv-fault-key')
  assert.equal(same.ok, true)
  assert.equal(same.data.receiving.receivingNo, created.data.receiving.receivingNo)
  const other = direct('another-key')
  assert.equal(other.error?.code, 'CONFLICT')
  assert.deepEqual(receivingState(backend, payload), before)
})

test('a reused receiving number after a failed attempt is refused instead of duplicated', () => {
  const backend = faultReady()
  const payload = twoLinePayload({ stockOrderId: backend.orderId, clientId: 'rcv_a' })
  countWrites(backend, 2)
  assert.equal(post(backend, 'receivings.create', payload, { idempotencyKey: 'key-a' }).ok, false)
  const other = post(backend, 'receivings.create', {
    actorUserId: 'u-aina', clientId: 'rcv_b', warehouseId: 'wh-main',
    items: [{ productId: 'prd-flour', qty: 1, condition: 'Baik' }],
  }, { idempotencyKey: 'key-b' })
  assert.equal(other.ok, true)
  const retry = post(backend, 'receivings.create', payload, { idempotencyKey: 'key-a' })
  assert.equal(retry.error?.code, 'CONFLICT')
  const nos = call(backend, 'receivings.list', { actorUserId: 'u-aina' }).data.receivings.map((row) => row.receivingNo)
  assert.equal(new Set(nos).size, nos.length)
})

const PROTOTYPE_DATE = '2026-09-10T04:00:00.000Z'
const SERVER_DATE = '2026-11-06T05:30:00.000Z'
const LATER_DATE = '2026-11-06T08:00:00.000Z'

function setClock(backend, iso) {
  backend.context.nowIso = () => iso
}

function receivingDates(backend, payload) {
  const listed = call(backend, 'receivings.list', { actorUserId: 'u-aina' })
  const receiving = listed.data.receivings.find((row) => row.id === payload.clientId)
  const movements = (listed.data.stockMovements || [])
    .filter((row) => row.type === 'receiving' && row.reference === receiving?.receivingNo)
    .map((row) => row.date)
  return { receivingDate: receiving?.date, movementDates: movements }
}

test('a new receiving ignores a frozen client date and uses server nowIso', () => {
  const backend = faultReady()
  setClock(backend, SERVER_DATE)
  const payload = {
    ...twoLinePayload({ stockOrderId: backend.orderId, clientId: 'rcv_date' }),
    date: PROTOTYPE_DATE,
  }
  const created = post(backend, 'receivings.create', payload, { idempotencyKey: 'date-key' })
  assert.equal(created.ok, true)
  assert.equal(created.data.receiving.date, SERVER_DATE)
  assert.notEqual(created.data.receiving.date, PROTOTYPE_DATE)
  const dates = receivingDates(backend, payload)
  assert.equal(dates.receivingDate, SERVER_DATE)
  assert.ok(dates.movementDates.length === 2)
  dates.movementDates.forEach((date) => assert.equal(date, SERVER_DATE))
})

test('Receivings.date matches StockMovements.date on a new receiving', () => {
  const backend = faultReady()
  setClock(backend, SERVER_DATE)
  const payload = twoLinePayload({ stockOrderId: backend.orderId, clientId: 'rcv_match' })
  const created = post(backend, 'receivings.create', payload, { idempotencyKey: 'match-key' })
  assert.equal(created.ok, true)
  const dates = receivingDates(backend, payload)
  assert.equal(dates.receivingDate, SERVER_DATE)
  assert.deepEqual(dates.movementDates, [SERVER_DATE, SERVER_DATE])
})

test('a retry after a partial write keeps the original server date', () => {
  const backend = faultReady()
  setClock(backend, SERVER_DATE)
  const payload = twoLinePayload({ stockOrderId: backend.orderId, clientId: 'rcv_retry_date' })
  countWrites(backend, 2)
  assert.equal(post(backend, 'receivings.create', payload, { idempotencyKey: 'retry-date-key' }).ok, false)
  const retry = post(backend, 'receivings.create', payload, { idempotencyKey: 'retry-date-key' })
  assert.equal(retry.ok, true)
  const dates = receivingDates(backend, payload)
  assert.equal(dates.receivingDate, SERVER_DATE)
  assert.deepEqual(dates.movementDates, [SERVER_DATE, SERVER_DATE])
  assert.equal(receivingState(backend, payload).movements.length, 2)
})

test('a retry does not replace the original date with a later server time', () => {
  const backend = faultReady()
  setClock(backend, SERVER_DATE)
  const payload = twoLinePayload({ stockOrderId: backend.orderId, clientId: 'rcv_later' })
  countWrites(backend, 2)
  assert.equal(post(backend, 'receivings.create', payload, { idempotencyKey: 'later-key' }).ok, false)
  setClock(backend, LATER_DATE)
  const retry = post(backend, 'receivings.create', { ...payload, date: LATER_DATE }, { idempotencyKey: 'later-key' })
  assert.equal(retry.ok, true)
  const dates = receivingDates(backend, payload)
  assert.equal(dates.receivingDate, SERVER_DATE)
  assert.notEqual(dates.receivingDate, LATER_DATE)
  dates.movementDates.forEach((date) => assert.equal(date, SERVER_DATE))
})

test('a completed replay keeps the original timestamp', () => {
  const backend = faultReady()
  setClock(backend, SERVER_DATE)
  const payload = twoLinePayload({ stockOrderId: backend.orderId, clientId: 'rcv_replay_date' })
  const created = post(backend, 'receivings.create', payload, { idempotencyKey: 'replay-date-key' })
  assert.equal(created.ok, true)
  setClock(backend, LATER_DATE)
  const replay = post(backend, 'receivings.create', { ...payload, date: LATER_DATE }, { idempotencyKey: 'replay-date-key' })
  assert.equal(replay.ok, true)
  assert.equal(replay.meta.idempotentReplay, true)
  assert.equal(replay.data.receiving.date, SERVER_DATE)
  const dates = receivingDates(backend, payload)
  assert.equal(dates.receivingDate, SERVER_DATE)
  dates.movementDates.forEach((date) => assert.equal(date, SERVER_DATE))
})

function addKgProduct(backend, id, name) {
  assert.equal(call(backend, 'products.create', {
    actorUserId: 'u-aina', id, name, categoryId: 'cat-ing', unit: 'KG',
    purchaseUnit: 'KG', purchaseConversionQty: 1, purchaseCost: 22, sellingPrice: 35, trackExpiry: false,
  }).ok, true)
}

function storeFingerprint(backend) {
  return JSON.stringify(backend.spreadsheet.store)
}

function createReceivingDoc(backend, overrides = {}) {
  const payload = {
    actorUserId: 'u-aina',
    clientId: overrides.clientId || `rcv_${Math.random().toString(36).slice(2, 10)}`,
    warehouseId: overrides.warehouseId || 'wh-main',
    source: 'other',
    items: overrides.items || [{ productId: 'prd-sugar', qty: 1, condition: 'Baik' }],
  }
  const created = post(backend, 'receivings.create', payload, { idempotencyKey: overrides.key || `key-${payload.clientId}` })
  assert.equal(created.ok, true, created.error?.message)
  return created.data.receiving
}

function createDraftPurchase(backend, overrides = {}) {
  const payload = {
    actorUserId: 'u-aina',
    clientId: overrides.clientId || `pur_${Math.random().toString(36).slice(2, 10)}`,
    supplierId: 'sup-1',
    warehouseId: overrides.warehouseId || 'wh-main',
    invoiceNumber: overrides.invoiceNumber || 'INV-LINK',
    items: overrides.items || [{ productId: 'prd-sugar', qty: 1, price: 50 }],
    receive: overrides.receive ?? false,
  }
  const created = overrides.receive
    ? post(backend, 'purchases.create', payload, { idempotencyKey: overrides.key || `pur-${payload.clientId}` })
    : call(backend, 'purchases.create', payload)
  assert.equal(created.ok, true, created.error?.message)
  return created.data.purchase
}

test('linkPurchase accepts a matching product id', () => {
  const backend = ready()
  const receiving = createReceivingDoc(backend, { clientId: 'rcv_match' })
  const purchase = createDraftPurchase(backend, { clientId: 'pur_match', items: [{ productId: 'prd-sugar', qty: 1, price: 50 }] })
  const linked = post(backend, 'receivings.linkPurchase', {
    actorUserId: 'u-aina', receivingId: receiving.id, purchaseId: purchase.id,
  }, { idempotencyKey: 'link-match' })
  assert.equal(linked.ok, true)
  assert.equal(linked.data.purchase.receivingId, receiving.id)
  assert.equal(linked.data.receiving.purchaseId, purchase.id)
  assert.equal(linked.data.purchase.status, 'draft')
})

test('linkPurchase rejects different product ids with PRODUCT_MISMATCH and writes nothing', () => {
  const backend = ready()
  addKgProduct(backend, 'prd-choc', 'UAT Chocolate')
  const receiving = createReceivingDoc(backend, { clientId: 'rcv_sugar' })
  const purchase = createDraftPurchase(backend, {
    clientId: 'pur_choc',
    items: [{ productId: 'prd-choc', qty: 1, price: 22 }],
  })
  const before = storeFingerprint(backend)
  const sugarQty = qty(call(backend, 'inventory.get', { actorUserId: 'u-aina' }).data, 'prd-sugar', 'wh-main')
  const denied = post(backend, 'receivings.linkPurchase', {
    actorUserId: 'u-aina', receivingId: receiving.id, purchaseId: purchase.id,
  }, { idempotencyKey: 'link-mismatch' })
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'PRODUCT_MISMATCH')
  assert.equal(denied.error.message, 'Receiving and purchase must share at least one product.')
  assert.equal(storeFingerprint(backend), before)
  const listed = call(backend, 'receivings.list', { actorUserId: 'u-aina' }).data
  assert.equal(listed.receivings.find((row) => row.id === receiving.id)?.purchaseId, undefined)
  const purchases = call(backend, 'purchases.list', { actorUserId: 'u-aina' }).data.purchases
  assert.equal(purchases.find((row) => row.id === purchase.id)?.receivingId, undefined)
  assert.equal(qty(call(backend, 'inventory.get', { actorUserId: 'u-aina' }).data, 'prd-sugar', 'wh-main'), sugarQty)
})

test('linkPurchase allows partial delivery, quantity difference, and extra lines when one product matches', () => {
  const backend = ready()
  addKgProduct(backend, 'prd-flour', 'UAT Flour')
  addKgProduct(backend, 'prd-choc', 'UAT Chocolate')
  const receiving = createReceivingDoc(backend, {
    clientId: 'rcv_partial',
    items: [
      { productId: 'prd-sugar', qty: 1, condition: 'Baik' },
      { productId: 'prd-flour', qty: 2, condition: 'Baik' },
    ],
  })
  const purchase = createDraftPurchase(backend, {
    clientId: 'pur_partial',
    items: [
      { productId: 'prd-sugar', qty: 9, price: 50 },
      { productId: 'prd-choc', qty: 1, price: 22 },
    ],
  })
  const linked = post(backend, 'receivings.linkPurchase', {
    actorUserId: 'u-aina', receivingId: receiving.id, purchaseId: purchase.id,
  }, { idempotencyKey: 'link-partial' })
  assert.equal(linked.ok, true)
  assert.equal(linked.data.purchase.receivingId, receiving.id)
})

test('linkPurchase rejects a warehouse mismatch before writes', () => {
  const backend = ready()
  const receiving = createReceivingDoc(backend, { clientId: 'rcv_wh', warehouseId: 'wh-main' })
  const purchase = createDraftPurchase(backend, {
    clientId: 'pur_wh',
    warehouseId: 'wh-shop',
    items: [{ productId: 'prd-sugar', qty: 1, price: 50 }],
  })
  const before = storeFingerprint(backend)
  const denied = post(backend, 'receivings.linkPurchase', {
    actorUserId: 'u-aina', receivingId: receiving.id, purchaseId: purchase.id,
  }, { idempotencyKey: 'link-wh' })
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'VALIDATION_ERROR')
  assert.equal(denied.error.message, 'Receiving and purchase must use the same warehouse.')
  assert.equal(storeFingerprint(backend), before)
})

test('linkPurchase keeps duplicate-link and draft guards', () => {
  const backend = ready()
  const receiving = createReceivingDoc(backend, { clientId: 'rcv_dup' })
  const purchase = createDraftPurchase(backend, { clientId: 'pur_dup' })
  assert.equal(post(backend, 'receivings.linkPurchase', {
    actorUserId: 'u-aina', receivingId: receiving.id, purchaseId: purchase.id,
  }, { idempotencyKey: 'link-dup-1' }).ok, true)

  const otherPurchase = createDraftPurchase(backend, { clientId: 'pur_dup_2' })
  const relinkReceiving = post(backend, 'receivings.linkPurchase', {
    actorUserId: 'u-aina', receivingId: receiving.id, purchaseId: otherPurchase.id,
  }, { idempotencyKey: 'link-dup-2' })
  assert.equal(relinkReceiving.error.message, 'Receiving already linked')

  const otherReceiving = createReceivingDoc(backend, { clientId: 'rcv_dup_2' })
  const relinkPurchase = post(backend, 'receivings.linkPurchase', {
    actorUserId: 'u-aina', receivingId: otherReceiving.id, purchaseId: purchase.id,
  }, { idempotencyKey: 'link-dup-3' })
  assert.equal(relinkPurchase.error.message, 'Purchase already linked')

  const posted = createDraftPurchase(backend, {
    clientId: 'pur_received',
    receive: true,
    items: [{ productId: 'prd-sugar', qty: 1, price: 50 }],
  })
  const againstReceived = post(backend, 'receivings.linkPurchase', {
    actorUserId: 'u-aina', receivingId: otherReceiving.id, purchaseId: posted.id,
  }, { idempotencyKey: 'link-dup-4' })
  assert.equal(againstReceived.error.message, 'Link a draft purchase')
})

test('frontend link picker and adapters guard product overlap and hydrate purchase status', () => {
  const db = fs.readFileSync(path.join(root, 'src/store/db.ts'), 'utf8')
  assert.equal(db.includes('receivingPurchaseMismatchMessage'), true)
  assert.equal(db.includes('purchases: slice.purchases'), true)
  const pages = fs.readFileSync(path.join(root, 'src/features/receiving/ReceivingPages.tsx'), 'utf8')
  assert.equal(pages.includes('isCompatibleReceivingPurchase'), true)
  assert.equal(pages.includes('incompatibleDraftCount'), true)
  const drawers = fs.readFileSync(path.join(root, 'src/components/drawers/GlobalDrawers.tsx'), 'utf8')
  assert.equal(drawers.includes('<StatusBadge status={purchase.status} />'), true)
})

