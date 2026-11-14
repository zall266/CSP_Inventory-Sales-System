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
    inventory: context.createInventoryService({ sheetRepository: sheets }),
    reporting: context.createReportingService({ sheetRepository: sheets }),
  }
}

function request(action, payload, extra = {}) {
  return { v: 1, requestId: extra.requestId || action, action, payload, idempotencyKey: extra.idempotencyKey }
}

function call(backend, action, payload, extra) {
  return backend.context.handleRequest(request(action, payload, extra), backend)
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
        'role-staff': {
          'dashboard.view': true, 'reports.view': true, 'receiving.view': true, 'manufacturing.history.view': true,
        },
        'role-cashier': {},
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
    categories: [{ id: 'cat-ing', name: 'Ingredients' }],
  }).ok, true)
  return backend
}

const TODAY = '2026-09-10'

test('health does not create reporting sheets and Sheet1 stays reserved', () => {
  const backend = app()
  backend.foundation.initialize()
  const health = call(backend, 'system.health', {})
  assert.equal(health.ok, true)
  assert.equal(backend.spreadsheet.store.Dashboard, undefined)
  assert.equal(backend.spreadsheet.store.Reports, undefined)
  assert.equal(backend.spreadsheet.store.Pjkm, undefined)
  assert.equal(backend.spreadsheet.store.Bmr, undefined)
  assert.ok(backend.spreadsheet.store.Sheet1)
})

test('cashier cannot view dashboard, reports, PJKM, or BMR', () => {
  const backend = ready()
  const dashboard = call(backend, 'dashboard.get', { actorUserId: 'u-siti', today: TODAY, preset: '30d' })
  assert.equal(dashboard.error.code, 'FORBIDDEN')
  assert.equal(dashboard.error.message, 'You cannot view the dashboard.')
  const reports = call(backend, 'reports.sales', { actorUserId: 'u-siti', today: TODAY, preset: '30d' })
  assert.equal(reports.error.code, 'FORBIDDEN')
  assert.equal(reports.error.message, 'You cannot view reports.')
  const pjkm = call(backend, 'pjkm.511', { actorUserId: 'u-siti', month: '2026-09' })
  assert.equal(pjkm.error.code, 'FORBIDDEN')
  assert.equal(pjkm.error.message, 'You do not have permission to view receiving.')
  const bmr = call(backend, 'bmr.list', { actorUserId: 'u-siti', today: TODAY })
  assert.equal(bmr.error.code, 'FORBIDDEN')
  assert.equal(bmr.error.message, 'You do not have permission to view completed production.')
})

test('empty dashboard and reports are zeros and PJKM empty month has no rows', () => {
  const backend = ready()
  const dashboard = call(backend, 'dashboard.get', {
    actorUserId: 'u-aina', today: TODAY, preset: '30d', warehouseId: 'all',
  })
  assert.equal(dashboard.ok, true)
  assert.equal(dashboard.data.totalSales, 0)
  assert.equal(dashboard.data.cogs, 0)
  assert.equal(dashboard.data.grossProfit, 0)
  assert.equal(dashboard.data.totalPurchases, 0)
  assert.equal(dashboard.data.inventoryValue, 0)
  assert.equal(dashboard.data.receivables, 0)
  assert.equal(dashboard.data.payables, 0)
  assert.equal(dashboard.data.lowStockCount, 0)
  assert.equal(dashboard.data.outOfStockCount, 0)
  assert.equal(dashboard.data.salesCount, 0)
  assert.equal(dashboard.data.purchaseCount, 0)

  const sales = call(backend, 'reports.sales', { actorUserId: 'u-aina', today: TODAY, preset: '30d' })
  assert.equal(sales.ok, true)
  assert.equal(sales.data.invoices, 0)
  assert.equal(sales.data.revenue, 0)
  assert.equal(sales.data.averageTicket, 0)
  assert.equal(sales.data.sales.length, 0)

  const pjkm = call(backend, 'pjkm.511', { actorUserId: 'u-aina', month: '2026-01' })
  assert.equal(pjkm.ok, true)
  assert.equal(pjkm.data.rows.length, 0)
  assert.ok(pjkm.data.pages.length >= 1)
  assert.equal(backend.spreadsheet.store.Receivings, undefined)
  assert.equal(backend.spreadsheet.store.StockMovements, undefined)

  const listed = call(backend, 'bmr.list', { actorUserId: 'u-aina', today: TODAY, range: 'all' })
  assert.equal(listed.ok, true)
  assert.equal(listed.data.records.length, 0)
})

test('bmr missing session is not found and PJKM month is required', () => {
  const backend = ready()
  const missing = call(backend, 'bmr.get', { actorUserId: 'u-aina', id: 'sess-missing', today: TODAY })
  assert.equal(missing.error.code, 'NOT_FOUND')
  assert.equal(missing.error.message, 'Print BMR is available only for a completed and posted production session.')
  const noMonth = call(backend, 'pjkm.911', { actorUserId: 'u-aina' })
  assert.equal(noMonth.error.code, 'VALIDATION_ERROR')
  assert.equal(noMonth.error.message, 'Month is required.')
})

test('read APIs do not change inventory balances or movements', () => {
  const backend = ready()
  const before = call(backend, 'inventory.get', { actorUserId: 'u-aina' })
  assert.equal(before.ok, true)
  call(backend, 'dashboard.get', { actorUserId: 'u-aina', today: TODAY, preset: '7d' })
  call(backend, 'reports.inventory', { actorUserId: 'u-aina', today: TODAY, warehouseId: 'all' })
  call(backend, 'reports.profit', { actorUserId: 'u-aina', today: TODAY, preset: '90d' })
  call(backend, 'reports.manufacturing', { actorUserId: 'u-aina', today: TODAY, preset: 'custom', customFrom: '2026-09-01', customTo: '2026-09-10' })
  call(backend, 'pjkm.1011', { actorUserId: 'u-aina', month: '2026-09' })
  call(backend, 'bmr.list', { actorUserId: 'u-aina', today: TODAY })
  const after = call(backend, 'inventory.get', { actorUserId: 'u-aina' })
  assert.equal(after.data.inventory.length, before.data.inventory.length)
  assert.equal(after.data.stockMovements.length, before.data.stockMovements.length)
})

test('reportDateRange includes Malaysia end of day independent of host timezone', () => {
  const backend = app()
  const range = backend.context.reportDateRange({ today: '2026-11-14', preset: '30d' })
  const afternoonUtc = new Date('2026-11-14T13:25:03.266Z').getTime()
  assert.equal(afternoonUtc >= range.from.getTime(), true)
  assert.equal(afternoonUtc <= range.to.getTime(), true)
  const nextMalaysiaMidnight = new Date('2026-11-14T16:00:00.000Z').getTime()
  assert.equal(nextMalaysiaMidnight > range.to.getTime(), true)
  const fromKey = backend.context.reportDateKey(range.from)
  assert.equal(fromKey, '2026-10-16')
})

test('staff can read dashboard and reports', () => {
  const backend = ready()
  const dashboard = call(backend, 'dashboard.get', { actorUserId: 'u-mei', today: TODAY, preset: '30d' })
  assert.equal(dashboard.ok, true)
  const reports = call(backend, 'reports.purchases', { actorUserId: 'u-mei', today: TODAY, preset: '30d' })
  assert.equal(reports.ok, true)
  assert.equal(reports.data.documents, 0)
  const pjkm = call(backend, 'pjkm.911', { actorUserId: 'u-mei', month: '2026-09' })
  assert.equal(pjkm.ok, true)
  assert.equal(pjkm.data.blocks.length, 0)
})
