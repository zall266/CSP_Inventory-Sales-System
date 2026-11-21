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
  }
}

function masterPayload() {
  return {
    warehouses: [
      { id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', kind: 'company' },
      { id: 'wh-shop', name: 'Shop', code: 'SHOP', kind: 'company' },
      { id: 'wh-outlet', name: 'Outlet 1', code: 'OUT1', kind: 'company' },
    ],
    categories: [
      { id: 'cat-air', name: 'Air Balang' },
      { id: 'cat-ice', name: 'Ice Blended' },
    ],
  }
}

function ready() {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(call(backend, 'identity.bootstrap', identityPayload()).ok, true)
  assert.equal(call(backend, 'masters.bootstrap', masterPayload()).ok, true)
  return backend
}

test('masters stay unread until the module is called and Sheet1 stays reserved', () => {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(backend.spreadsheet.store.Warehouses, undefined)
  assert.equal(backend.spreadsheet.store.Categories, undefined)
  const health = call(backend, 'system.health', {})
  assert.equal(health.ok, true)
  assert.equal(backend.spreadsheet.store.Warehouses, undefined)
  assert.deepEqual(backend.spreadsheet.store.Sheet1, [['']])
})

test('bootstrap persists warehouses and categories once', () => {
  const backend = ready()
  const listed = call(backend, 'masters.get', {})
  assert.equal(listed.ok, true)
  assert.equal(listed.data.empty, false)
  assert.equal(listed.data.warehouses.length, 3)
  assert.equal(listed.data.warehouses[0].id, 'wh-main')
  assert.equal(listed.data.warehouses[0].kind, 'company')
  assert.equal(listed.data.categories[0].name, 'Air Balang')
  const again = call(backend, 'masters.bootstrap', masterPayload())
  assert.equal(again.error.code, 'CONFLICT')
  assert.equal(backend.spreadsheet.store.Warehouses.filter((row) => row[0] === 'wh-main').length, 1)
  const audit = backend.spreadsheet.store.AuditLogs.map((row) => row[3])
  assert.equal(audit.includes('masters.bootstrap'), true)
})

test('warehouse and category reads use the stored ids', () => {
  const backend = ready()
  const warehouses = call(backend, 'warehouses.list', {})
  const one = call(backend, 'warehouses.get', { id: 'wh-shop' })
  const missing = call(backend, 'warehouses.get', { id: 'wh-missing' })
  const categories = call(backend, 'categories.list', {})
  const category = call(backend, 'categories.get', { id: 'cat-ice' })
  assert.equal(warehouses.data.warehouses.length, 3)
  assert.equal(one.data.warehouse.name, 'Shop')
  assert.equal(one.data.warehouse.code, 'SHOP')
  assert.equal(missing.error.code, 'NOT_FOUND')
  assert.equal(categories.data.categories.length, 2)
  assert.equal(category.data.category.name, 'Ice Blended')
  assert.equal(listedUsers(backend), 3)
})

function listedUsers(backend) {
  return call(backend, 'users.list', {}).data.users.length
}

test('category create, duplicate, and rename persist one audit each', () => {
  const backend = ready()
  const denied = call(backend, 'categories.create', { name: 'Syrup' })
  assert.equal(denied.error.code, 'FORBIDDEN')
  const inactive = call(backend, 'categories.create', { actorUserId: 'u-off', id: 'cat-syrup', name: 'Syrup' })
  assert.equal(inactive.error.code, 'FORBIDDEN')
  const created = call(backend, 'categories.create', { actorUserId: 'u-mei', id: 'cat-syrup', name: 'Syrup' })
  assert.equal(created.ok, true)
  assert.equal(created.data.categories.some((item) => item.name === 'Syrup'), true)
  const duplicate = call(backend, 'categories.create', { actorUserId: 'u-aina', id: 'cat-other', name: 'syrup' })
  assert.equal(duplicate.error.code, 'VALIDATION_ERROR')
  assert.equal(duplicate.error.message, 'Category name already exists')
  const blank = call(backend, 'categories.create', { actorUserId: 'u-aina', name: '   ' })
  assert.equal(blank.error.code, 'VALIDATION_ERROR')
  const renamed = call(backend, 'categories.rename', { actorUserId: 'u-aina', id: 'cat-syrup', name: 'Syrup Mix' })
  assert.equal(renamed.ok, true)
  assert.equal(renamed.data.categories.find((item) => item.id === 'cat-syrup').name, 'Syrup Mix')
  const clash = call(backend, 'categories.rename', { actorUserId: 'u-aina', id: 'cat-syrup', name: 'Air Balang' })
  assert.equal(clash.error.code, 'VALIDATION_ERROR')
  const missing = call(backend, 'categories.rename', { actorUserId: 'u-aina', id: 'cat-missing', name: 'Nope' })
  assert.equal(missing.error.code, 'NOT_FOUND')
  const sameId = call(backend, 'categories.create', { actorUserId: 'u-aina', id: 'cat-syrup', name: 'Another' })
  assert.equal(sameId.error.code, 'CONFLICT')
  const names = backend.spreadsheet.store.Categories.map((row) => row[1])
  assert.equal(names.filter((name) => name === 'Syrup').length, 0)
  assert.equal(names.filter((name) => name === 'Syrup Mix').length, 1)
  const actions = backend.spreadsheet.store.AuditLogs.map((row) => row[3])
  assert.equal(actions.filter((action) => action === 'categories.create').length, 1)
  assert.equal(actions.filter((action) => action === 'categories.rename').length, 1)
  assert.deepEqual(backend.spreadsheet.store.Sheet1, [['']])
  assert.equal(call(backend, 'users.list', {}).data.users[0].email, 'aina@coolslurppy.my')
})

test('invalid warehouse bootstrap does not create a row', () => {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(call(backend, 'identity.bootstrap', identityPayload()).ok, true)
  const bad = call(backend, 'masters.bootstrap', {
    warehouses: [{ id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', kind: 'store' }],
    categories: [{ id: 'cat-air', name: 'Air Balang' }],
  })
  assert.equal(bad.error.code, 'VALIDATION_ERROR')
  assert.equal(backend.spreadsheet.store.Warehouses.length, 1)
  const duplicateCode = call(backend, 'masters.bootstrap', {
    warehouses: [
      { id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', kind: 'company' },
      { id: 'wh-shop', name: 'Shop', code: 'main', kind: 'company' },
    ],
    categories: [{ id: 'cat-air', name: 'Air Balang' }],
  })
  assert.equal(duplicateCode.error.code, 'VALIDATION_ERROR')
  assert.equal(backend.spreadsheet.store.Warehouses.length, 1)
})

test('the same idempotency key replays a category create', () => {
  const backend = ready()
  const body = request('categories.create', {
    actorUserId: 'u-aina', id: 'cat-once', name: 'Once',
  }, { idempotencyKey: 'cat-once', requestId: 'once' })
  const first = backend.context.handleRequest(body, backend)
  const second = backend.context.handleRequest(body, backend)
  assert.equal(first.ok, true)
  assert.equal(second.meta.idempotentReplay, true)
  assert.equal(backend.spreadsheet.store.Categories.filter((row) => row[0] === 'cat-once').length, 1)
})

test('frontend category calls stay on the existing db methods', () => {
  const source = fs.readFileSync(path.join(root, 'src/store/db.ts'), 'utf8')
  assert.equal(source.includes("queueMasterWrite('categories.create'"), true)
  assert.equal(source.includes("queueMasterWrite('categories.rename'"), true)
  assert.equal(source.includes('renameCategory(id: string, name: string)'), true)
})
