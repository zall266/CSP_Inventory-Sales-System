import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createFakeDrive,
  createFakeSpreadsheet,
  devProperties,
  loadBackend,
} from './harness.js'

function mathContext() {
  return loadBackend({
    PropertiesService: { getScriptProperties: () => devProperties() },
    LockService: {
      getScriptLock() {
        return { tryLock: () => true, releaseLock() {} }
      },
    },
    SpreadsheetApp: { openById: () => createFakeSpreadsheet() },
    DriveApp: createFakeDrive('drive-id'),
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) {
        return { text, setMimeType() { return this } }
      },
    },
  })
}

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
    idempotencyKey: extra.idempotencyKey || `s12-date-${keySeq}`,
    requestId: extra.requestId || `req-date-${keySeq}`,
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
    warehouses: [{ id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', kind: 'company' }],
    categories: [{ id: 'cat-ing', name: 'Ingredients' }],
  }).ok, true)
  return backend
}

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function seedFinishedProduct(backend) {
  for (const row of [
    { id: 'p-s12date-raw', name: 'S12 Date Mix', sku: 'S12DR', unit: 'KG' },
    { id: 'p-s12date', name: 'S12 Date Pack', sku: 'S12D', unit: 'PCS' },
  ]) {
    const created = call(backend, 'products.create', {
      actorUserId: 'u-aina',
      categoryId: 'cat-ing',
      sellingPrice: 1,
      wholesalePrice: 1,
      purchaseCost: 1,
      purchaseUnit: row.unit,
      purchaseConversionQty: 1,
      ...row,
    })
    assert.equal(created.ok, true, created.error && created.error.message)
  }
  const bom = post(backend, 'boms.create', {
    actorUserId: 'u-aina',
    name: 'S12 date BOM',
    productId: 'p-s12date',
    outputQty: 1,
    outputUnit: 'PCS',
    notes: '',
    items: [{ productId: 'p-s12date-raw', qty: 1, unit: 'KG', wastagePct: 0, notes: '', consumptionMethod: 'MANUAL' }],
  })
  assert.equal(bom.ok, true, bom.error && bom.error.message)
}

function setSessionProductionDateCell(backend, sessionId, value) {
  const sheet = backend.spreadsheet.store.ProductionSessions
  const headers = sheet[0]
  const dateCol = headers.indexOf('productionDate')
  const idCol = headers.indexOf('id')
  const row = sheet.find((item, index) => index > 0 && item[idCol] === sessionId)
  assert.ok(row, 'session row exists')
  row[dateCol] = value
}

test('sessionDateKey accepts date-only, ISO+offset, historical Date strings, and Excel serials', () => {
  const ctx = mathContext()
  assert.equal(ctx.sessionDateKey('2026-11-09'), '2026-11-09')
  assert.equal(ctx.sessionDateKey('2026-11-09T00:00:00+08:00'), '2026-11-09')
  assert.equal(ctx.sessionDateKey('2026-11-08T16:00:00.000Z'), '2026-11-09')
  assert.equal(ctx.sessionDateKey('Mon Nov 09 2026 00:00:00 GMT+0800 (Malaysia Time)'), '2026-11-09')
  assert.equal(ctx.sessionDateKey(46335), '2026-11-09')
  assert.equal(ctx.sessionDateKey('46335.0'), '2026-11-09')
  assert.equal(ctx.sessionDateKey(new Date('2026-11-09T00:00:00+08:00')), '2026-11-09')
})

test('sessionDateKey does not replace missing or invalid values with today', () => {
  const ctx = mathContext()
  const today = ctx.businessDate(new Date())
  assert.equal(ctx.sessionDateKey(''), '')
  assert.equal(ctx.sessionDateKey(null), '')
  assert.equal(ctx.sessionDateKey(undefined), '')
  assert.equal(ctx.sessionDateKey('not-a-date'), '')
  assert.equal(ctx.sessionDateKey('2026-13-40'), '')
  assert.notEqual(ctx.sessionDateKey(''), today)
  assert.notEqual(ctx.sessionDateKey('not-a-date'), today)
})

test('sessionDateKey does not shift date-only values across timezone boundaries', () => {
  const ctx = mathContext()
  assert.equal(ctx.sessionDateKey('2026-11-09'), '2026-11-09')
  assert.equal(ctx.sessionDateKey(new Date('2026-11-08T16:00:00.000Z')), '2026-11-09')
  assert.equal(ctx.sessionDateKey(new Date('2026-11-09T16:00:00.000Z')), '2026-11-10')
})

test('sessionIsOperationalToday uses canonical dates and ignores the frozen prototype day', () => {
  const ctx = mathContext()
  const today = ctx.businessDate(new Date())
  assert.equal(ctx.sessionIsOperationalToday({ productionDate: today }, today), true)
  assert.equal(ctx.sessionIsOperationalToday({ productionDate: '2026-09-10' }, today), today === '2026-09-10')
  assert.equal(ctx.sessionIsOperationalToday({ productionDate: 'Mon Nov 09 2026 00:00:00 GMT+0800 (Malaysia Time)' }, '2026-11-09'), true)
  assert.equal(ctx.sessionIsOperationalToday({ productionDate: '' }, today), false)
})

test('sessions.list canonicalizes stored Date, GMT string, and Excel serial without rewriting other fields', () => {
  const backend = ready()
  seedFinishedProduct(backend)
  const created = post(backend, 'sessions.create', {
    actorUserId: 'u-aina',
    clientId: 'ps_date_uat',
    productionDate: '2026-11-09',
    warehouseId: 'wh-main',
    items: [{ productId: 'p-s12date', targetQty: 45 }],
    notes: 'STEP12-DATE-CONTRACT',
  })
  assert.equal(created.ok, true, created.error && created.error.message)
  assert.equal(created.data.productionSession.productionDate, '2026-11-09')
  assert.equal(created.data.productionSession.reference, 'PROD-20261109-001')
  assert.equal(created.data.productionSession.status, 'planned')
  assert.equal(created.data.productionSession.notes, 'STEP12-DATE-CONTRACT')
  assert.equal(created.data.productionSession.items[0].targetQty, 45)
  assert.equal(created.data.productionSession.posted, false)

  const cases = [
    new Date('2026-11-09T00:00:00+08:00'),
    'Mon Nov 09 2026 00:00:00 GMT+0800 (Malaysia Time)',
    46335,
    '46335.0',
    '2026-11-09',
  ]
  for (const stored of cases) {
    setSessionProductionDateCell(backend, 'ps_date_uat', stored)
    const listed = call(backend, 'sessions.list', { actorUserId: 'u-aina' })
    assert.equal(listed.ok, true, listed.error && listed.error.message)
    const session = listed.data.productionSessions.find((row) => row.id === 'ps_date_uat')
    assert.ok(session)
    assert.equal(session.productionDate, '2026-11-09', String(stored))
    assert.equal(session.reference, 'PROD-20261109-001')
    assert.equal(session.status, 'planned')
    assert.equal(session.notes, 'STEP12-DATE-CONTRACT')
    assert.equal(session.items[0].targetQty, 45)
    assert.equal(session.posted, false)
    const detail = call(backend, 'sessions.get', { actorUserId: 'u-aina', id: 'ps_date_uat' })
    assert.equal(detail.ok, true)
    assert.equal(detail.data.productionSession.productionDate, '2026-11-09')
  }

  setSessionProductionDateCell(backend, 'ps_date_uat', '')
  const missing = call(backend, 'sessions.list', { actorUserId: 'u-aina' })
  assert.equal(missing.data.productionSessions.find((row) => row.id === 'ps_date_uat').productionDate, '')
  setSessionProductionDateCell(backend, 'ps_date_uat', 'not-a-date')
  const invalid = call(backend, 'sessions.list', { actorUserId: 'u-aina' })
  assert.equal(invalid.data.productionSessions.find((row) => row.id === 'ps_date_uat').productionDate, '')
  assert.notEqual(invalid.data.productionSessions.find((row) => row.id === 'ps_date_uat').productionDate, todayKey())
})

test('sessions.create uses the requested Malaysia date, not the frozen prototype date', () => {
  const backend = ready()
  seedFinishedProduct(backend)
  const created = post(backend, 'sessions.create', {
    actorUserId: 'u-aina',
    clientId: 'ps_live_today',
    productionDate: todayKey(),
    warehouseId: 'wh-main',
    items: [{ productId: 'p-s12date', targetQty: 10 }],
  })
  assert.equal(created.ok, true, created.error && created.error.message)
  assert.equal(created.data.productionSession.productionDate, todayKey())
  assert.notEqual(created.data.productionSession.productionDate, '2026-09-10')
  const other = post(backend, 'sessions.create', {
    actorUserId: 'u-aina',
    clientId: 'ps_other_day',
    productionDate: '2026-09-11',
    warehouseId: 'wh-main',
    items: [{ productId: 'p-s12date', targetQty: 10 }],
  })
  assert.equal(other.ok, true, other.error && other.error.message)
  const listed = call(backend, 'sessions.list', { actorUserId: 'u-aina' })
  const todays = listed.data.productionSessions.filter((row) => row.productionDate === todayKey())
  assert.equal(todays.some((row) => row.id === 'ps_live_today'), true)
  assert.equal(todays.some((row) => row.id === 'ps_other_day'), false)
})
