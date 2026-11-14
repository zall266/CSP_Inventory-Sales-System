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

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
const PDF = 'data:application/pdf;base64,JVBERi0xLjAKMSAwIG9iago8PC9UeXBlL0NhdGFsb2c+PgplbmRvYmoKeHJlZgowIDEKdHJhaWxlcgo8PC9TaXplIDE+PgolJUVPRgo='

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
        return {
          bytes,
          mime,
          name,
          getContentType() { return mime },
          getBytes() { return bytes },
        }
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
    drive,
    context,
    system: context.createSystemService({ sheetRepository: sheets, driveStorage }),
    idempotency: context.createIdempotencyService(sheets),
    foundation: context.createFoundationService(sheets),
    identity: context.createIdentityService({ sheetRepository: sheets, driveStorage }),
    masters: context.createMasterService({ sheetRepository: sheets }),
    products: context.createProductService({ sheetRepository: sheets }),
    ops: context.createOpsService({ sheetRepository: sheets, driveStorage }),
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
    idempotencyKey: extra.idempotencyKey || `ops-${keySeq}`,
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
    warehouses: [{ id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', kind: 'company' }],
    categories: [{ id: 'cat-ing', name: 'Ingredients' }],
  }).ok, true)
  return backend
}

test('health does not create ops sheets and Sheet1 stays reserved', () => {
  const backend = app()
  backend.foundation.initialize()
  const health = call(backend, 'system.health', {})
  assert.equal(health.ok, true)
  assert.equal(backend.spreadsheet.store.Manufacturers, undefined)
  assert.equal(backend.spreadsheet.store.StaffTasks, undefined)
  assert.equal(backend.spreadsheet.store.Expenses, undefined)
  assert.ok(backend.spreadsheet.store.Sheet1)
})

test('staff cannot manage halal or expenses', () => {
  const backend = ready()
  const deniedHalal = call(backend, 'halal.saveManufacturer', { actorUserId: 'u-mei', name: 'Acme' })
  assert.equal(deniedHalal.error.code, 'FORBIDDEN')
  assert.equal(deniedHalal.error.message, 'You cannot manage Halal Compliance.')
  const deniedExp = call(backend, 'expenses.create', {
    actorUserId: 'u-mei', category: 'Rent', description: 'Office', amount: 10, paymentMethod: 'cash',
  })
  assert.equal(deniedExp.error.code, 'FORBIDDEN')
  assert.equal(deniedExp.error.message, 'You cannot manage expenses.')
})

test('halal manufacturer and compliance upload a Drive file', () => {
  const backend = ready()
  const product = call(backend, 'products.create', {
    actorUserId: 'u-aina',
    id: 'p-sugar',
    name: 'Sugar',
    sku: '900099',
    categoryId: 'cat-ing',
    sellingPrice: 1,
    wholesalePrice: 1,
    purchaseCost: 1,
    unit: 'KG',
    purchaseUnit: 'KG',
    purchaseConversionQty: 1,
    sellable: false,
  })
  assert.equal(product.ok, true, product.error && product.error.message)
  const manufacturer = call(backend, 'halal.saveManufacturer', {
    actorUserId: 'u-aina', clientId: 'mfr_acme', name: 'Acme Ingredients',
  })
  assert.equal(manufacturer.ok, true, manufacturer.error && manufacturer.error.message)
  const duplicate = call(backend, 'halal.saveManufacturer', {
    actorUserId: 'u-aina', name: 'acme ingredients',
  })
  assert.equal(duplicate.error.message, 'Manufacturer already exists')
  const saved = call(backend, 'halal.saveCompliance', {
    actorUserId: 'u-aina',
    clientId: 'hcomp_1',
    productId: 'p-sugar',
    manufacturerId: 'mfr_acme',
    certificateNo: 'JAKIM-1',
    issuingAuthority: 'JAKIM',
    expiryDate: '2027-12-31',
    verificationStatus: 'verified',
    documentDataUrl: PDF,
    documentName: 'cert.pdf',
    documentMime: 'application/pdf',
  })
  assert.equal(saved.ok, true, saved.error && saved.error.message)
  assert.equal(saved.data.compliance.productId, 'p-sugar')
  const cert = saved.data.halalCertificates.find((row) => row.id === saved.data.compliance.certificateId)
  assert.equal(cert.verificationStatus, 'verified')
  assert.ok(cert.documentFileId)
  assert.ok(backend.drive.created.includes('HalalCertificates'))
})

test('tasks seed categories, require a photo, and complete once', () => {
  const backend = ready()
  const listed = call(backend, 'tasks.list', { actorUserId: 'u-aina' })
  assert.equal(listed.ok, true)
  assert.equal(listed.data.staffTaskCategories.length, 5)
  const created = call(backend, 'tasks.create', {
    actorUserId: 'u-aina',
    clientId: 'tsk_clean',
    title: 'Sweep floor',
    categoryId: 'tcat-cleaning',
    assignedTo: 'u-mei',
    frequency: 'daily',
    time: '09:00',
    photoRequirement: 'required',
  })
  assert.equal(created.ok, true, created.error && created.error.message)
  const occurrence = created.data.staffTaskOccurrences.find((row) => row.taskId === 'tsk_clean')
  assert.ok(occurrence)
  const started = call(backend, 'tasks.start', { actorUserId: 'u-aina', id: occurrence.id })
  assert.equal(started.ok, true, started.error && started.error.message)
  assert.equal(started.data.occurrence.status, 'in_progress')
  const missingKey = call(backend, 'tasks.complete', { actorUserId: 'u-aina', id: occurrence.id })
  assert.equal(missingKey.error.message, 'Idempotency key is required.')
  const blocked = post(backend, 'tasks.complete', { actorUserId: 'u-aina', id: occurrence.id })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error.message, 'Please upload a photo before completing this task.')
  const photo = call(backend, 'tasks.attachPhoto', {
    actorUserId: 'u-aina', id: occurrence.id, photoUrl: JPEG, photoName: 'floor.jpg',
  })
  assert.equal(photo.ok, true, photo.error && photo.error.message)
  assert.ok(photo.data.occurrence.completionPhotoUrl)
  const completed = post(backend, 'tasks.complete', { actorUserId: 'u-aina', id: occurrence.id }, { idempotencyKey: 'task-1' })
  assert.equal(completed.ok, true, completed.error && completed.error.message)
  assert.equal(completed.data.occurrence.status, 'completed')
  const replay = post(backend, 'tasks.complete', { actorUserId: 'u-aina', id: occurrence.id }, { idempotencyKey: 'task-1' })
  assert.equal(replay.meta.idempotentReplay, true)
  const again = post(backend, 'tasks.complete', { actorUserId: 'u-aina', id: occurrence.id }, { idempotencyKey: 'task-2' })
  assert.equal(again.error.message, 'Task already completed')
})

test('owner can create an expense and staff cannot complete an unassigned task', () => {
  const backend = ready()
  const beforeInv = JSON.stringify(backend.spreadsheet.store.InventoryBalances || [])
  const beforeMov = JSON.stringify(backend.spreadsheet.store.StockMovements || [])
  const expense = call(backend, 'expenses.create', {
    actorUserId: 'u-aina',
    clientId: 'exp_1',
    date: '2026-11-14',
    category: 'Rent',
    description: 'Shop rent',
    amount: 1200,
    paymentMethod: 'bank_transfer',
  })
  assert.equal(expense.ok, true, expense.error && expense.error.message)
  assert.equal(expense.data.expense.amount, 1200)
  const created = call(backend, 'tasks.create', {
    actorUserId: 'u-aina',
    clientId: 'tsk_owner',
    title: 'Owner only',
    categoryId: 'tcat-general',
    assignedTo: 'u-aina',
    frequency: 'daily',
  })
  assert.equal(created.ok, true, created.error && created.error.message)
  const occurrence = created.data.staffTaskOccurrences.find((row) => row.taskId === 'tsk_owner')
  const denied = call(backend, 'tasks.start', { actorUserId: 'u-mei', id: occurrence.id })
  assert.equal(denied.error.code, 'FORBIDDEN')
  assert.equal(JSON.stringify(backend.spreadsheet.store.InventoryBalances || []), beforeInv)
  assert.equal(JSON.stringify(backend.spreadsheet.store.StockMovements || []), beforeMov)
})

test('frontend ops calls stay on the existing db methods', () => {
  const source = fs.readFileSync(path.join(root, 'src/store/db.ts'), 'utf8')
  assert.equal(source.includes("queueHalalWrite('halal.saveManufacturer'"), true)
  assert.equal(source.includes("queueHalalWrite('halal.saveCompliance'"), true)
  assert.equal(source.includes("queueTaskWrite('tasks.create'"), true)
  assert.equal(source.includes("queueTaskWrite('tasks.complete'"), true)
  assert.equal(source.includes("queueExpenseWrite('expenses.create'"), true)
  assert.equal(source.includes('createManufacturer'), true)
  assert.equal(source.includes('createExpense'), true)
  assert.equal(source.includes("hasPermission(state, 'expenses.manage')"), true)
  assert.equal(source.includes('You cannot manage expenses.'), true)
})
