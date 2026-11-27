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
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAlRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8fPz9/f4+fr/2gAIAQEAAT8Aov8A/9k='

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
    drive,
    driveStorage,
    system: context.createSystemService({ sheetRepository: sheets, driveStorage }),
    idempotency: context.createIdempotencyService(sheets),
    foundation: context.createFoundationService(sheets),
    identity: context.createIdentityService({ sheetRepository: sheets, driveStorage }),
    masters: context.createMasterService({ sheetRepository: sheets }),
    products: context.createProductService({ sheetRepository: sheets, driveStorage }),
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
      { id: 'role-cashier', name: 'Cashier', description: 'Front-of-house POS.', status: 'active', protected: false, legacyRole: 'cashier' },
      { id: 'role-agent', name: 'Agent', description: 'Linked agent POS.', status: 'active', protected: false, legacyRole: 'staff' },
      { id: 'role-warehouse', name: 'Warehouse', description: 'Warehouse ops.', status: 'active', protected: false, legacyRole: 'warehouse' },
    ],
    users: [
      { id: 'u-aina', name: 'Aina Rahman', email: 'aina@coolslurppy.my', roleId: 'role-owner', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-mei', name: 'Mei Ling', email: 'mei@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-siti', name: 'Siti', email: 'siti@coolslurppy.my', roleId: 'role-cashier', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-agent', name: 'Agent User', email: 'agent@coolslurppy.my', roleId: 'role-agent', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-wh', name: 'Warehouse User', email: 'wh@coolslurppy.my', roleId: 'role-warehouse', departmentId: 'dept-sales', status: 'active' },
      { id: 'u-off', name: 'Off Duty', email: 'off@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'inactive' },
    ],
    settings: {
      businessName: 'Cool Slurppy', legalName: 'Cool Slurppy Sdn Bhd', logoUrl: '', phone: '03',
      email: 'hello@coolslurppy.my', address: 'KL', website: '', registrationNo: '', bankName: '',
      bankAccount: '', paymentTerms: 'Net 7 days', documentTerms: 'Terms', currency: 'MYR',
      defaultWarehouseId: 'wh-main', allowNegativeStock: false, costingMethod: 'average',
      batchTracking: true, expiryTracking: true, defaultCustomerId: 'c-walkin', allowDiscount: true,
      allowReturns: true, enabledPaymentMethods: ['cash'],
      roleMatrix: {
        'role-staff': { 'products.edit': true, 'sales.create': true },
        'role-cashier': { 'sales.create': true, 'sales.view': true, 'sales.edit': true },
        'role-agent': { 'agent.sale.create': true, 'agent.sale.view': true },
        'role-warehouse': {},
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
    warehouses: [
      { id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', kind: 'company' },
      { id: 'wh-shop', name: 'Shop', code: 'SHOP', kind: 'company' },
    ],
    categories: [{ id: 'cat-ing', name: 'Ingredients' }],
  }).ok, true)
  return backend
}

function productInput(extra = {}) {
  return {
    actorUserId: 'u-mei',
    id: 'prd-sugar',
    name: 'UAT Sugar',
    categoryId: 'cat-ing',
    unit: 'KG',
    purchaseUnit: 'KG',
    purchaseConversionQty: 1,
    purchaseCost: 2,
    sellingPrice: 12,
    wholesalePrice: 10,
    ...extra,
  }
}

function byId(data, id) {
  return data.products.find((product) => product.id === id)
}

function pngBytes() {
  return Uint8Array.from(Buffer.from(PNG_DATA_URL.split(',')[1], 'base64'))
}

function childFolder(backend, name) {
  const existing = backend.drive.folder.getFoldersByName(name)
  if (existing.hasNext()) return existing.next()
  return backend.drive.folder.createFolder(name)
}

function putDriveFile(backend, mime, bytes, name, parent) {
  const folder = parent || childFolder(backend, 'ProductImages')
  const id = `planted${String(name).replace(/\W/g, '')}XXXXXXXXXX`
  const file = {
    getId: () => id,
    getName: () => name,
    getMimeType: () => mime,
    getBlob: () => ({
      getContentType: () => mime,
      getBytes: () => bytes,
    }),
    getParents: () => {
      let remaining = 1
      return {
        hasNext: () => remaining > 0,
        next: () => {
          remaining -= 1
          return folder
        },
      }
    },
    setTrashed(value) {
      if (value) backend.drive.trashed.push(id)
    },
  }
  const previous = backend.drive.getFileById.bind(backend.drive)
  backend.drive.getFileById = (wanted) => {
    if (wanted === id) return file
    return previous(wanted)
  }
  return { id, name, folder }
}

function setProductImageId(backend, productId, imageFileId) {
  const rows = backend.spreadsheet.store.Products
  const headers = rows[0]
  const idIdx = headers.indexOf('id')
  const imageIdx = headers.indexOf('imageFileId')
  for (let i = 1; i < rows.length; i += 1) {
    if (String(rows[i][idIdx]) === productId) rows[i][imageIdx] = imageFileId
  }
}

function oversizedDataUrl() {
  const bytes = Buffer.alloc((1024 * 1024) + 12, 1)
  return `data:image/png;base64,${bytes.toString('base64')}`
}

function productImageId(backend, productId) {
  const listed = call(backend, 'products.list', {})
  const product = byId(listed.data, productId)
  return product ? product.imageFileId : undefined
}

function sheetError(message) {
  const error = new Error(message)
  error.code = 'INTERNAL_ERROR'
  error.expose = true
  return error
}

function cloneSheet(backend, name) {
  return JSON.parse(JSON.stringify(backend.spreadsheet.store[name] || null))
}

function productFieldsWithoutImage(backend, productId) {
  const rows = backend.spreadsheet.store.Products || []
  const headers = rows[0] || []
  const idIdx = headers.indexOf('id')
  const imageIdx = headers.indexOf('imageFileId')
  const row = rows.find((item, index) => index > 0 && String(item[idIdx]) === productId)
  if (!row) return null
  return row.filter((_, index) => index !== imageIdx)
}

function trackImageOps(backend) {
  const ops = []
  const control = {
    failPersist: false,
    failTrashIds: new Set(),
    failAudit: false,
    failComponents: false,
    failBalances: false,
  }
  const replaceObjects = backend.sheets.replaceObjects.bind(backend.sheets)
  backend.sheets.replaceObjects = (sheet, records) => {
    const name = sheet.getName()
    ops.push({ op: 'sheet-write', sheet: name, via: 'replaceObjects' })
    if (name === 'SalesComponents' && control.failComponents) throw sheetError('SalesComponents write failed.')
    if (name === 'InventoryBalances' && control.failBalances) throw sheetError('InventoryBalances write failed.')
    if (name === 'Products') {
      const row = (records || []).find((item) => item && item.id === 'prd-sugar')
      ops.push({
        op: 'persist',
        imageFileId: row ? String(row.imageFileId || '') : '',
      })
      if (control.failPersist) throw sheetError('Sheet write failed.')
    }
    return replaceObjects(sheet, records)
  }
  const originalGetSheetByName = backend.spreadsheet.getSheetByName.bind(backend.spreadsheet)
  backend.spreadsheet.getSheetByName = (name) => {
    const sheet = originalGetSheetByName(name)
    if (!sheet) return sheet
    const originalGetRange = sheet.getRange.bind(sheet)
    sheet.getRange = (row, column, numRows = 1, numColumns = 1) => {
      const range = originalGetRange(row, column, numRows, numColumns)
      const originalSetValues = range.setValues.bind(range)
      range.setValues = (values) => {
        if (name === 'SalesComponents' || name === 'InventoryBalances') {
          ops.push({ op: 'sheet-write', sheet: name, via: 'setValues' })
          if (name === 'SalesComponents' && control.failComponents) throw sheetError('SalesComponents write failed.')
          if (name === 'InventoryBalances' && control.failBalances) throw sheetError('InventoryBalances write failed.')
        }
        if (name === 'Products' && row > 1) {
          const headers = backend.spreadsheet.store.Products[0] || []
          const imageIdx = headers.indexOf('imageFileId')
          const writesImage = imageIdx >= 0 && column <= imageIdx + 1 && column + numColumns - 1 >= imageIdx + 1
          if (writesImage) {
            const offset = imageIdx - (column - 1)
            ops.push({
              op: 'persist',
              imageFileId: String((values[0] && values[0][offset]) || ''),
            })
            ops.push({ op: 'sheet-write', sheet: 'Products', via: 'setValues' })
            if (control.failPersist) throw sheetError('Sheet write failed.')
          }
        }
        return originalSetValues(values)
      }
      return range
    }
    return sheet
  }
  const appendObject = backend.sheets.appendObject.bind(backend.sheets)
  backend.sheets.appendObject = (sheet, record) => {
    if (sheet.getName() === 'AuditLogs') {
      ops.push({ op: 'audit', action: record && record.action })
      if (control.failAudit) {
        const error = new Error('Audit write failed.')
        error.code = 'INTERNAL_ERROR'
        error.expose = true
        throw error
      }
    }
    return appendObject(sheet, record)
  }
  const deleteFile = backend.driveStorage.deleteFile.bind(backend.driveStorage)
  backend.driveStorage.deleteFile = (id) => {
    ops.push({ op: 'trash', id })
    if (control.failTrashIds.has(id) || control.failTrashIds.has('*')) {
      const error = new Error('Drive delete failed.')
      error.code = 'INTERNAL_ERROR'
      error.expose = true
      throw error
    }
    return deleteFile(id)
  }
  const uploadFile = backend.driveStorage.uploadFile.bind(backend.driveStorage)
  backend.driveStorage.uploadFile = (folder, blob, name) => {
    const uploaded = uploadFile(folder, blob, name)
    ops.push({ op: 'upload', id: uploaded.id, folder, name })
    return uploaded
  }
  return { ops, control }
}

function captureLogs(fn) {
  const lines = []
  const original = console.log
  console.log = (...args) => {
    lines.push(args.map((value) => String(value)).join(' '))
    original.apply(console, args)
  }
  try {
    return { result: fn(), lines }
  } finally {
    console.log = original
  }
}

function seedProductWithImage(backend) {
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  const uploaded = call(backend, 'products.uploadImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: PNG_DATA_URL, fileName: 'first.png',
  })
  assert.equal(uploaded.ok, true, uploaded.error && uploaded.error.message)
  return byId(uploaded.data, 'prd-sugar').imageFileId
}

test('health and product list do not create ProductImages or mix RecipePhotos', () => {
  const backend = app()
  backend.foundation.initialize()
  const health = call(backend, 'system.health', {})
  assert.equal(health.ok, true)
  assert.equal(backend.drive.created.includes('ProductImages'), false)
  assert.equal(backend.drive.created.includes('RecipePhotos'), false)
  const readyBackend = ready()
  assert.equal(call(readyBackend, 'products.create', productInput()).ok, true)
  const listed = call(readyBackend, 'products.list', {})
  assert.equal(listed.ok, true)
  assert.equal(byId(listed.data, 'prd-sugar').imageFileId, undefined)
  assert.equal(JSON.stringify(listed.data).includes('data:image'), false)
  assert.equal(readyBackend.drive.created.includes('ProductImages'), false)
  assert.equal(readyBackend.drive.created.includes('RecipePhotos'), false)
})

test('legacy Products headers gain an empty imageFileId column without rewriting rows', () => {
  const backend = ready()
  backend.spreadsheet.store.Products = [
    ['id', 'name', 'sku', 'barcode', 'categoryId', 'unit', 'purchaseUnit',
      'purchaseConversionQty', 'purchaseCost', 'costPrice', 'costSource',
      'sellingPrice', 'wholesalePrice', 'agentPrice', 'sellable', 'reorderLevel',
      'trackBatch', 'trackExpiry', 'status', 'accent'],
    ['prd-old', 'Old Sugar', 'OLD-1', '', 'cat-ing', 'KG', 'KG', 1, 2, 2, 'manual', 12, 10, '', true, 0, false, false, 'active', '#4F46E5'],
  ]
  const listed = call(backend, 'products.list', {})
  assert.equal(listed.ok, true, listed.error && listed.error.message)
  assert.deepEqual(backend.spreadsheet.store.Products[0].slice(-2), ['accent', 'imageFileId'])
  const product = byId(listed.data, 'prd-old')
  assert.equal(product.name, 'Old Sugar')
  assert.equal(product.sku, 'OLD-1')
  assert.equal(product.imageFileId, undefined)
  assert.equal(JSON.stringify(listed.data).includes('data:image'), false)
})

test('upload stores a Drive file under ProductImages named by productId and list stays byte-free', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  const uploaded = call(backend, 'products.uploadImage', {
    actorUserId: 'u-mei',
    productId: 'prd-sugar',
    fileName: 'camera-roll.png',
    dataUrl: PNG_DATA_URL,
    imageFileId: 'client-supplied-must-be-ignored',
  })
  assert.equal(uploaded.ok, true, uploaded.error && uploaded.error.message)
  const product = byId(uploaded.data, 'prd-sugar')
  assert.ok(product.imageFileId)
  assert.notEqual(product.imageFileId, 'client-supplied-must-be-ignored')
  assert.equal(product.imageFileId.startsWith('data:'), false)
  assert.equal(backend.drive.created.includes('ProductImages'), true)
  assert.equal(backend.drive.created.includes('RecipePhotos'), false)
  const file = backend.drive.getFileById(product.imageFileId)
  assert.equal(file.getName(), 'prd-sugar.png')
  assert.equal(file.getParents().next().getName(), 'ProductImages')

  const listed = call(backend, 'products.list', {})
  const listedProduct = byId(listed.data, 'prd-sugar')
  assert.equal(listedProduct.imageFileId, product.imageFileId)
  assert.equal(listedProduct.dataUrl, undefined)
  const listedJson = JSON.stringify(listed.data)
  assert.equal(listedJson.includes('data:image'), false)
  assert.equal(listedJson.includes(PNG_DATA_URL.split(',')[1]), false)
  assert.ok(listedJson.length < 5000)

  const got = call(backend, 'products.getImage', { actorUserId: 'u-mei', productId: 'prd-sugar', fileId: 'ignored', imageFileId: 'ignored' })
  assert.equal(got.ok, true, got.error && got.error.message)
  assert.equal(got.data.productId, 'prd-sugar')
  assert.equal(got.data.mimeType, 'image/png')
  assert.equal(got.data.fileName, 'prd-sugar.png')
  assert.equal(got.data.dataUrl.startsWith('data:image/png;base64,'), true)
  assert.equal(got.data.dataUrl.includes(PNG_DATA_URL.split(',')[1]), true)
  assert.notEqual(JSON.stringify(listedProduct).includes('data:image'), true)
})

test('company POS cashier and linked-agent can get images but cannot mutate them', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  assert.equal(call(backend, 'products.uploadImage', {
    actorUserId: 'u-aina', productId: 'prd-sugar', dataUrl: PNG_DATA_URL, fileName: 'sugar.png',
  }).ok, true)

  const cashierGet = call(backend, 'products.getImage', { actorUserId: 'u-siti', productId: 'prd-sugar' })
  assert.equal(cashierGet.ok, true, cashierGet.error && cashierGet.error.message)
  const agentGet = call(backend, 'products.getImage', { actorUserId: 'u-agent', id: 'prd-sugar' })
  assert.equal(agentGet.ok, true, agentGet.error && agentGet.error.message)

  const cashierUpload = call(backend, 'products.uploadImage', {
    actorUserId: 'u-siti', productId: 'prd-sugar', dataUrl: JPEG_DATA_URL, fileName: 'nope.jpg',
  })
  assert.equal(cashierUpload.error.code, 'FORBIDDEN')
  assert.equal(cashierUpload.error.message, 'You cannot change product images.')
  const agentReplace = call(backend, 'products.replaceImage', {
    actorUserId: 'u-agent', productId: 'prd-sugar', dataUrl: JPEG_DATA_URL, fileName: 'nope.jpg',
  })
  assert.equal(agentReplace.error.code, 'FORBIDDEN')
  const cashierRemove = call(backend, 'products.removeImage', { actorUserId: 'u-siti', productId: 'prd-sugar' })
  assert.equal(cashierRemove.error.code, 'FORBIDDEN')
  assert.equal(call(backend, 'products.create', productInput({ id: 'prd-cashier', sku: 'CASH-1', actorUserId: 'u-siti' })).ok, true)
})

test('warehouse without POS or products.edit cannot get or mutate images', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  assert.equal(call(backend, 'products.uploadImage', {
    actorUserId: 'u-aina', productId: 'prd-sugar', dataUrl: PNG_DATA_URL,
  }).ok, true)
  const deniedGet = call(backend, 'products.getImage', { actorUserId: 'u-wh', productId: 'prd-sugar' })
  assert.equal(deniedGet.error.code, 'FORBIDDEN')
  assert.equal(deniedGet.error.message, 'You cannot view this product image.')
  const deniedUpload = call(backend, 'products.uploadImage', {
    actorUserId: 'u-wh', productId: 'prd-sugar', dataUrl: JPEG_DATA_URL,
  })
  assert.equal(deniedUpload.error.code, 'FORBIDDEN')
  const noActor = call(backend, 'products.getImage', { productId: 'prd-sugar' })
  assert.equal(noActor.error.code, 'FORBIDDEN')
  const inactive = call(backend, 'products.getImage', { actorUserId: 'u-off', productId: 'prd-sugar' })
  assert.equal(inactive.error.code, 'FORBIDDEN')
})

test('replace and remove stay inside ProductImages and update persists through product edits', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  const first = call(backend, 'products.uploadImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: PNG_DATA_URL, fileName: 'first.png',
  })
  const firstId = byId(first.data, 'prd-sugar').imageFileId
  const duplicate = call(backend, 'products.uploadImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: JPEG_DATA_URL, fileName: 'second.jpg',
  })
  assert.equal(duplicate.error.code, 'VALIDATION_ERROR')
  assert.equal(duplicate.error.message, 'Product already has an image.')

  const replaced = call(backend, 'products.replaceImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: JPEG_DATA_URL, fileName: 'second.jpg',
  })
  assert.equal(replaced.ok, true, replaced.error && replaced.error.message)
  const nextId = byId(replaced.data, 'prd-sugar').imageFileId
  assert.ok(nextId)
  assert.notEqual(nextId, firstId)
  assert.equal(backend.drive.trashed.includes(firstId), true)
  assert.equal(backend.drive.getFileById(nextId).getName(), 'prd-sugar.jpg')
  assert.equal(backend.drive.getFileById(nextId).getParents().next().getName(), 'ProductImages')

  const stolenWrite = call(backend, 'products.update', {
    actorUserId: 'u-mei',
    id: 'prd-sugar',
    name: 'UAT Sugar Fine',
    imageFileId: 'stolen-file',
  })
  assert.equal(stolenWrite.ok, true)
  assert.equal(byId(stolenWrite.data, 'prd-sugar').name, 'UAT Sugar Fine')
  assert.equal(byId(stolenWrite.data, 'prd-sugar').imageFileId, nextId)

  const status = call(backend, 'products.setStatus', { actorUserId: 'u-mei', id: 'prd-sugar', status: 'inactive' })
  assert.equal(byId(status.data, 'prd-sugar').imageFileId, nextId)

  const removed = call(backend, 'products.removeImage', { actorUserId: 'u-mei', productId: 'prd-sugar' })
  assert.equal(removed.ok, true, removed.error && removed.error.message)
  assert.equal(byId(removed.data, 'prd-sugar').imageFileId, undefined)
  assert.equal(backend.drive.trashed.includes(nextId), true)
  const missing = call(backend, 'products.getImage', { actorUserId: 'u-siti', productId: 'prd-sugar' })
  assert.equal(missing.error.code, 'NOT_FOUND')
  assert.equal(missing.error.message, 'Product image was not found.')
  const removeAgain = call(backend, 'products.removeImage', { actorUserId: 'u-mei', productId: 'prd-sugar' })
  assert.equal(removeAgain.error.code, 'NOT_FOUND')
  const replaceMissing = call(backend, 'products.replaceImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: PNG_DATA_URL,
  })
  assert.equal(replaceMissing.error.code, 'NOT_FOUND')
})

test('get and mutate reject RecipePhotos files, missing files, and invalid payloads', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  const recipe = putDriveFile(backend, 'image/png', pngBytes(), 'recipe.png', childFolder(backend, 'RecipePhotos'))
  const planted = putDriveFile(backend, 'image/png', pngBytes(), 'ok.png')
  setProductImageId(backend, 'prd-sugar', planted.id)

  const ok = call(backend, 'products.getImage', {
    actorUserId: 'u-siti', productId: 'prd-sugar', fileId: recipe.id, imageFileId: recipe.id,
  })
  assert.equal(ok.ok, true, ok.error && ok.error.message)
  assert.equal(ok.data.dataUrl.startsWith('data:image/png;base64,'), true)

  setProductImageId(backend, 'prd-sugar', recipe.id)
  const stolen = call(backend, 'products.getImage', { actorUserId: 'u-siti', productId: 'prd-sugar' })
  assert.equal(stolen.error.code, 'NOT_FOUND')
  assert.equal(stolen.error.message, 'Product image was not found.')
  assert.equal(backend.drive.trashed.includes(recipe.id), false)

  const replaceStolen = call(backend, 'products.replaceImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: PNG_DATA_URL,
  })
  assert.equal(replaceStolen.ok, true, replaceStolen.error && replaceStolen.error.message)
  assert.equal(backend.drive.trashed.includes(recipe.id), false)
  assert.notEqual(byId(replaceStolen.data, 'prd-sugar').imageFileId, recipe.id)
  assert.equal(backend.drive.getFileById(byId(replaceStolen.data, 'prd-sugar').imageFileId).getParents().next().getName(), 'ProductImages')

  const missingProduct = call(backend, 'products.getImage', { actorUserId: 'u-siti', productId: 'prd-missing' })
  assert.equal(missingProduct.error.code, 'NOT_FOUND')
  const heic = call(backend, 'products.uploadImage', {
    actorUserId: 'u-mei',
    productId: 'prd-sugar',
    dataUrl: 'data:image/heic;base64,AAAA',
    fileName: 'phone.heic',
  })
  assert.equal(heic.error.code, 'VALIDATION_ERROR')
  const svg = call(backend, 'products.uploadImage', {
    actorUserId: 'u-aina',
    id: 'prd-sugar',
    dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
  })
  assert.equal(svg.error.code, 'VALIDATION_ERROR')
  const huge = call(backend, 'products.uploadImage', {
    actorUserId: 'u-aina',
    productId: 'prd-sugar',
    dataUrl: oversizedDataUrl(),
  })
  assert.equal(huge.error.code, 'VALIDATION_ERROR')
  const createIgnores = call(backend, 'products.create', productInput({
    id: 'prd-plain', sku: 'PLAIN-1', imageFileId: recipe.id, dataUrl: PNG_DATA_URL,
  }))
  assert.equal(createIgnores.ok, true)
  assert.equal(byId(createIgnores.data, 'prd-plain').imageFileId, undefined)
})

test('product image code stays isolated from recipe photos, POS, sales, and ProductMark', () => {
  const service = fs.readFileSync(path.join(root, 'apps-script/services/productService.js'), 'utf8')
  const manufacturing = fs.readFileSync(path.join(root, 'apps-script/services/manufacturingService.js'), 'utf8')
  const sales = fs.readFileSync(path.join(root, 'apps-script/services/salesService.js'), 'utf8')
  const mark = fs.readFileSync(path.join(root, 'src/components/ProductMark.tsx'), 'utf8')
  const pos = fs.readFileSync(path.join(root, 'src/features/pos/PosPage.tsx'), 'utf8')
  const recipe = fs.readFileSync(path.join(root, 'src/features/manufacturing/recipePhoto.ts'), 'utf8')
  const db = fs.readFileSync(path.join(root, 'src/store/db.ts'), 'utf8')

  assert.equal(service.includes("PRODUCT_IMAGE_FOLDER = 'ProductImages'"), true)
  assert.equal(service.includes('RecipePhotos'), false)
  assert.equal(service.includes('sessions.getRecipePhoto'), false)
  assert.equal(service.includes('imageUrl'), false)
  assert.equal(manufacturing.includes("SESSION_PHOTO_FOLDER = 'RecipePhotos'"), true)
  assert.equal(manufacturing.includes('ProductImages'), false)
  assert.equal(sales.includes('products.uploadImage'), false)
  assert.equal(sales.includes('products.getImage'), false)
  assert.equal(mark.includes('getImage'), false)
  assert.equal(mark.includes('imageFileId'), false)
  assert.equal(mark.includes('initials(product.name)'), true)
  assert.equal(pos.includes('<ProductImageThumb'), true)
  assert.equal(pos.includes('size="xl"'), true)
  assert.equal(pos.includes('<ProductMark product={product} size="md" />'), true)
  assert.equal(pos.includes('products.getImage'), false)
  assert.equal(recipe.includes('sessions.getRecipePhoto'), true)
  assert.equal(db.includes("queueProductWrite('products.create'"), true)
  assert.equal(db.includes("queueProductWrite('products.uploadImage'"), false)
  assert.equal(db.includes('createSale'), true)
  assert.equal(db.includes('createAgentSale'), true)
})

test('uploadImage persists the new file id and does not leave an orphan on success', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  const tracked = trackImageOps(backend)
  const uploaded = call(backend, 'products.uploadImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: PNG_DATA_URL, fileName: 'first.png',
  })
  assert.equal(uploaded.ok, true, uploaded.error && uploaded.error.message)
  const imageFileId = byId(uploaded.data, 'prd-sugar').imageFileId
  assert.ok(imageFileId)
  const persistIdx = tracked.ops.findIndex((item) => item.op === 'persist' && item.imageFileId === imageFileId)
  const uploadIdx = tracked.ops.findIndex((item) => item.op === 'upload' && item.id === imageFileId)
  const trashIdx = tracked.ops.findIndex((item) => item.op === 'trash' && item.id === imageFileId)
  assert.ok(uploadIdx >= 0)
  assert.ok(persistIdx >= 0)
  assert.ok(uploadIdx < persistIdx)
  assert.equal(trashIdx, -1)
  assert.equal(backend.drive.getFileById(imageFileId).getParents().next().getName(), 'ProductImages')
  assert.equal(productImageId(backend, 'prd-sugar'), imageFileId)
})

test('uploadImage Sheets failure cleans up only the new ProductImages file', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  assert.equal(call(backend, 'products.create', productInput({ id: 'prd-flour', sku: 'FLOUR-1', name: 'UAT Flour' })).ok, true)
  const otherId = (() => {
    const uploaded = call(backend, 'products.uploadImage', {
      actorUserId: 'u-mei', productId: 'prd-flour', dataUrl: PNG_DATA_URL, fileName: 'flour.png',
    })
    assert.equal(uploaded.ok, true, uploaded.error && uploaded.error.message)
    return byId(uploaded.data, 'prd-flour').imageFileId
  })()
  const recipe = putDriveFile(backend, 'image/png', pngBytes(), 'recipe.png', childFolder(backend, 'RecipePhotos'))
  const tracked = trackImageOps(backend)
  tracked.ops.length = 0
  tracked.control.failPersist = true
  const failed = call(backend, 'products.uploadImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: JPEG_DATA_URL, fileName: 'first.jpg',
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'INTERNAL_ERROR')
  const uploaded = tracked.ops.find((item) => item.op === 'upload')
  assert.ok(uploaded)
  const persistIdx = tracked.ops.findIndex((item) => item.op === 'persist')
  const newTrashIdx = tracked.ops.findIndex((item) => item.op === 'trash' && item.id === uploaded.id)
  assert.ok(persistIdx >= 0)
  assert.ok(newTrashIdx >= 0)
  assert.ok(persistIdx < newTrashIdx)
  assert.equal(productImageId(backend, 'prd-sugar'), undefined)
  assert.equal(productImageId(backend, 'prd-flour'), otherId)
  assert.equal(backend.drive.trashed.includes(otherId), false)
  assert.equal(backend.drive.trashed.includes(recipe.id), false)
  assert.equal(backend.drive.trashed.includes(uploaded.id), true)
  assert.equal(tracked.ops.some((item) => item.op === 'trash' && item.id === otherId), false)
  assert.equal(tracked.ops.some((item) => item.op === 'trash' && item.id === recipe.id), false)
})

test('uploadImage preserves the persist error when new-file cleanup also fails', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  const tracked = trackImageOps(backend)
  tracked.control.failPersist = true
  tracked.control.failTrashIds.add('*')
  const captured = captureLogs(() => call(backend, 'products.uploadImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: JPEG_DATA_URL, fileName: 'first.jpg',
  }))
  const failed = captured.result
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'INTERNAL_ERROR')
  assert.equal(failed.error.message, 'The request could not be completed.')
  assert.equal(productImageId(backend, 'prd-sugar'), undefined)
  const uploaded = tracked.ops.find((item) => item.op === 'upload')
  assert.ok(uploaded)
  assert.equal(backend.drive.trashed.includes(uploaded.id), false)
  assert.ok(captured.lines.some((line) => line.includes('"status":"cleanup_failed"') && line.includes(uploaded.id)))
})

test('uploadImage never trashes a file outside ProductImages', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  const recipe = putDriveFile(backend, 'image/png', pngBytes(), 'recipe.png', childFolder(backend, 'RecipePhotos'))
  const tracked = trackImageOps(backend)
  const uploaded = call(backend, 'products.uploadImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: PNG_DATA_URL, fileName: 'first.png',
  })
  assert.equal(uploaded.ok, true, uploaded.error && uploaded.error.message)
  assert.equal(tracked.ops.some((item) => item.op === 'trash' && item.id === recipe.id), false)
  assert.equal(backend.drive.trashed.includes(recipe.id), false)
})

test('image mutation stays successful when audit writing fails after persist', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  const tracked = trackImageOps(backend)
  tracked.control.failAudit = true
  const capturedUpload = captureLogs(() => call(backend, 'products.uploadImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: PNG_DATA_URL, fileName: 'first.png',
  }))
  const uploaded = capturedUpload.result
  assert.equal(uploaded.ok, true, uploaded.error && uploaded.error.message)
  const firstId = byId(uploaded.data, 'prd-sugar').imageFileId
  assert.ok(firstId)
  assert.equal(productImageId(backend, 'prd-sugar'), firstId)
  assert.ok(capturedUpload.lines.some((line) => line.includes('"status":"audit_failed"') && line.includes('products.uploadImage')))

  tracked.ops.length = 0
  const capturedReplace = captureLogs(() => call(backend, 'products.replaceImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: JPEG_DATA_URL, fileName: 'second.jpg',
  }))
  const replaced = capturedReplace.result
  assert.equal(replaced.ok, true, replaced.error && replaced.error.message)
  const nextId = byId(replaced.data, 'prd-sugar').imageFileId
  assert.ok(nextId)
  assert.notEqual(nextId, firstId)
  assert.equal(productImageId(backend, 'prd-sugar'), nextId)
  assert.equal(backend.drive.trashed.includes(firstId), true)
  assert.ok(capturedReplace.lines.some((line) => line.includes('"status":"audit_failed"') && line.includes('products.replaceImage')))

  tracked.ops.length = 0
  const capturedRemove = captureLogs(() => call(backend, 'products.removeImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar',
  }))
  const removed = capturedRemove.result
  assert.equal(removed.ok, true, removed.error && removed.error.message)
  assert.equal(byId(removed.data, 'prd-sugar').imageFileId, undefined)
  assert.equal(productImageId(backend, 'prd-sugar'), undefined)
  assert.equal(backend.drive.trashed.includes(nextId), true)
  assert.ok(capturedRemove.lines.some((line) => line.includes('"status":"audit_failed"') && line.includes('products.removeImage')))
})

test('products.edit defaults stay owner/admin/manager/staff/warehouse, not cashier', () => {
  const catalog = fs.readFileSync(path.join(root, 'apps-script/identity/permissionCatalog.js'), 'utf8')
  const frontend = fs.readFileSync(path.join(root, 'src/features/settings/permissions.ts'), 'utf8')
  assert.equal(catalog.includes("if (role === 'owner' || role === 'admin') return fullPermissions();"), true)
  assert.equal(catalog.includes("['products.edit'], WAREHOUSE_MAP_STAFF"), true)
  assert.equal(catalog.includes("['products.edit'], AGENT_STOCK_OPS"), true)
  assert.equal(catalog.includes("if (role === 'cashier')"), true)
  const cashierBlock = catalog.slice(catalog.indexOf("if (role === 'cashier')"), catalog.indexOf('return withPermissionKeys', catalog.indexOf("if (role === 'cashier')")))
  assert.equal(cashierBlock.includes('products.edit'), false)
  assert.equal(frontend.includes("if (role === 'owner' || role === 'admin') return fullPermissions()"), true)
  assert.equal(frontend.includes("'products.edit'"), true)
  const frontendCashier = frontend.slice(frontend.indexOf("if (role === 'cashier')"), frontend.indexOf('return withKeys', frontend.indexOf("if (role === 'cashier')")))
  assert.equal(frontendCashier.includes('products.edit'), false)
})

test('replaceImage persists the new file id before trashing the old image', () => {
  const backend = ready()
  const firstId = seedProductWithImage(backend)
  const tracked = trackImageOps(backend)
  tracked.ops.length = 0
  const replaced = call(backend, 'products.replaceImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: JPEG_DATA_URL, fileName: 'second.jpg',
  })
  assert.equal(replaced.ok, true, replaced.error && replaced.error.message)
  const nextId = byId(replaced.data, 'prd-sugar').imageFileId
  assert.ok(nextId)
  assert.notEqual(nextId, firstId)
  const persistIdx = tracked.ops.findIndex((item) => item.op === 'persist' && item.imageFileId === nextId)
  const trashIdx = tracked.ops.findIndex((item) => item.op === 'trash' && item.id === firstId)
  assert.ok(persistIdx >= 0)
  assert.ok(trashIdx >= 0)
  assert.ok(persistIdx < trashIdx)
  assert.equal(backend.drive.trashed.includes(firstId), true)
  assert.equal(productImageId(backend, 'prd-sugar'), nextId)
})

test('replaceImage upload failure leaves the old image reachable', () => {
  const backend = ready()
  const firstId = seedProductWithImage(backend)
  const tracked = trackImageOps(backend)
  tracked.ops.length = 0
  const failed = call(backend, 'products.replaceImage', {
    actorUserId: 'u-mei',
    productId: 'prd-sugar',
    dataUrl: 'data:image/heic;base64,AAAA',
    fileName: 'phone.heic',
  })
  assert.equal(failed.error.code, 'VALIDATION_ERROR')
  assert.equal(productImageId(backend, 'prd-sugar'), firstId)
  assert.equal(tracked.ops.some((item) => item.op === 'trash'), false)
  assert.equal(backend.drive.trashed.includes(firstId), false)
  const still = call(backend, 'products.getImage', { actorUserId: 'u-siti', productId: 'prd-sugar' })
  assert.equal(still.ok, true, still.error && still.error.message)
})

test('replaceImage Sheets failure keeps the old image and cleans up the new upload', () => {
  const backend = ready()
  const firstId = seedProductWithImage(backend)
  const tracked = trackImageOps(backend)
  tracked.ops.length = 0
  tracked.control.failPersist = true
  const failed = call(backend, 'products.replaceImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: JPEG_DATA_URL, fileName: 'second.jpg',
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'INTERNAL_ERROR')
  const uploaded = tracked.ops.find((item) => item.op === 'upload')
  assert.ok(uploaded)
  const persistIdx = tracked.ops.findIndex((item) => item.op === 'persist')
  const newTrashIdx = tracked.ops.findIndex((item) => item.op === 'trash' && item.id === uploaded.id)
  const oldTrashIdx = tracked.ops.findIndex((item) => item.op === 'trash' && item.id === firstId)
  assert.ok(persistIdx >= 0)
  assert.ok(newTrashIdx >= 0)
  assert.ok(persistIdx < newTrashIdx)
  assert.equal(oldTrashIdx, -1)
  assert.equal(productImageId(backend, 'prd-sugar'), firstId)
  assert.equal(backend.drive.trashed.includes(firstId), false)
  assert.equal(backend.drive.trashed.includes(uploaded.id), true)
  const still = call(backend, 'products.getImage', { actorUserId: 'u-siti', productId: 'prd-sugar' })
  assert.equal(still.ok, true, still.error && still.error.message)
})

test('replaceImage preserves the persist error when new-file cleanup also fails', () => {
  const backend = ready()
  const firstId = seedProductWithImage(backend)
  const tracked = trackImageOps(backend)
  tracked.ops.length = 0
  tracked.control.failPersist = true
  tracked.control.failTrashIds.add('*')
  const captured = captureLogs(() => call(backend, 'products.replaceImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: JPEG_DATA_URL, fileName: 'second.jpg',
  }))
  const failed = captured.result
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'INTERNAL_ERROR')
  assert.equal(failed.error.message, 'The request could not be completed.')
  assert.equal(productImageId(backend, 'prd-sugar'), firstId)
  assert.equal(backend.drive.trashed.includes(firstId), false)
  const uploaded = tracked.ops.find((item) => item.op === 'upload')
  assert.ok(uploaded)
  assert.equal(tracked.ops.some((item) => item.op === 'trash' && item.id === firstId), false)
  assert.ok(captured.lines.some((line) => line.includes('"status":"cleanup_failed"') && line.includes(uploaded.id)))
})

test('replaceImage stays successful when old-file cleanup fails after persist', () => {
  const backend = ready()
  const firstId = seedProductWithImage(backend)
  const tracked = trackImageOps(backend)
  tracked.ops.length = 0
  tracked.control.failTrashIds.add(firstId)
  const captured = captureLogs(() => call(backend, 'products.replaceImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: JPEG_DATA_URL, fileName: 'second.jpg',
  }))
  const replaced = captured.result
  assert.equal(replaced.ok, true, replaced.error && replaced.error.message)
  const nextId = byId(replaced.data, 'prd-sugar').imageFileId
  assert.ok(nextId)
  assert.notEqual(nextId, firstId)
  const persistIdx = tracked.ops.findIndex((item) => item.op === 'persist' && item.imageFileId === nextId)
  const trashIdx = tracked.ops.findIndex((item) => item.op === 'trash' && item.id === firstId)
  assert.ok(persistIdx >= 0)
  assert.ok(trashIdx >= 0)
  assert.ok(persistIdx < trashIdx)
  assert.equal(productImageId(backend, 'prd-sugar'), nextId)
  assert.equal(backend.drive.trashed.includes(firstId), false)
  assert.ok(captured.lines.some((line) => line.includes('"status":"cleanup_failed"') && line.includes(firstId)))
})

test('replaceImage never trashes a file outside ProductImages', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  const recipe = putDriveFile(backend, 'image/png', pngBytes(), 'recipe.png', childFolder(backend, 'RecipePhotos'))
  setProductImageId(backend, 'prd-sugar', recipe.id)
  const tracked = trackImageOps(backend)
  tracked.ops.length = 0
  const replaced = call(backend, 'products.replaceImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: PNG_DATA_URL,
  })
  assert.equal(replaced.ok, true, replaced.error && replaced.error.message)
  assert.equal(tracked.ops.some((item) => item.op === 'trash' && item.id === recipe.id), false)
  assert.equal(backend.drive.trashed.includes(recipe.id), false)
  assert.notEqual(productImageId(backend, 'prd-sugar'), recipe.id)
})

test('removeImage clears the product reference before trashing Drive', () => {
  const backend = ready()
  const firstId = seedProductWithImage(backend)
  const tracked = trackImageOps(backend)
  tracked.ops.length = 0
  const removed = call(backend, 'products.removeImage', { actorUserId: 'u-mei', productId: 'prd-sugar' })
  assert.equal(removed.ok, true, removed.error && removed.error.message)
  assert.equal(byId(removed.data, 'prd-sugar').imageFileId, undefined)
  const persistIdx = tracked.ops.findIndex((item) => item.op === 'persist' && item.imageFileId === '')
  const trashIdx = tracked.ops.findIndex((item) => item.op === 'trash' && item.id === firstId)
  assert.ok(persistIdx >= 0)
  assert.ok(trashIdx >= 0)
  assert.ok(persistIdx < trashIdx)
  assert.equal(backend.drive.trashed.includes(firstId), true)
})

test('removeImage Sheets failure keeps the original image', () => {
  const backend = ready()
  const firstId = seedProductWithImage(backend)
  const tracked = trackImageOps(backend)
  tracked.ops.length = 0
  tracked.control.failPersist = true
  const failed = call(backend, 'products.removeImage', { actorUserId: 'u-mei', productId: 'prd-sugar' })
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'INTERNAL_ERROR')
  assert.equal(tracked.ops.some((item) => item.op === 'trash'), false)
  assert.equal(productImageId(backend, 'prd-sugar'), firstId)
  assert.equal(backend.drive.trashed.includes(firstId), false)
  const still = call(backend, 'products.getImage', { actorUserId: 'u-siti', productId: 'prd-sugar' })
  assert.equal(still.ok, true, still.error && still.error.message)
})

test('removeImage stays successful when Drive cleanup fails after persist', () => {
  const backend = ready()
  const firstId = seedProductWithImage(backend)
  const tracked = trackImageOps(backend)
  tracked.ops.length = 0
  tracked.control.failTrashIds.add(firstId)
  const captured = captureLogs(() => call(backend, 'products.removeImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar',
  }))
  const removed = captured.result
  assert.equal(removed.ok, true, removed.error && removed.error.message)
  assert.equal(byId(removed.data, 'prd-sugar').imageFileId, undefined)
  const persistIdx = tracked.ops.findIndex((item) => item.op === 'persist' && item.imageFileId === '')
  const trashIdx = tracked.ops.findIndex((item) => item.op === 'trash' && item.id === firstId)
  assert.ok(persistIdx >= 0)
  assert.ok(trashIdx >= 0)
  assert.ok(persistIdx < trashIdx)
  assert.equal(productImageId(backend, 'prd-sugar'), undefined)
  assert.equal(backend.drive.trashed.includes(firstId), false)
  assert.ok(captured.lines.some((line) => line.includes('"status":"cleanup_failed"') && line.includes(firstId)))
})

test('removeImage never trashes a file outside ProductImages', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  const recipe = putDriveFile(backend, 'image/png', pngBytes(), 'recipe.png', childFolder(backend, 'RecipePhotos'))
  setProductImageId(backend, 'prd-sugar', recipe.id)
  const tracked = trackImageOps(backend)
  tracked.ops.length = 0
  const removed = call(backend, 'products.removeImage', { actorUserId: 'u-mei', productId: 'prd-sugar' })
  assert.equal(removed.ok, true, removed.error && removed.error.message)
  assert.equal(byId(removed.data, 'prd-sugar').imageFileId, undefined)
  const persistIdx = tracked.ops.findIndex((item) => item.op === 'persist' && item.imageFileId === '')
  assert.ok(persistIdx >= 0)
  assert.equal(tracked.ops.some((item) => item.op === 'trash' && item.id === recipe.id), false)
  assert.equal(backend.drive.trashed.includes(recipe.id), false)
})

function assertImageWriteTouchedOnlyProducts(backend, tracked, before) {
  assert.deepEqual(cloneSheet(backend, 'SalesComponents'), before.components)
  assert.deepEqual(cloneSheet(backend, 'InventoryBalances'), before.balances)
  assert.deepEqual(productFieldsWithoutImage(backend, 'prd-sugar'), before.productFields)
  assert.equal(tracked.ops.some((item) => item.op === 'sheet-write' && item.sheet === 'SalesComponents'), false)
  assert.equal(tracked.ops.some((item) => item.op === 'sheet-write' && item.sheet === 'InventoryBalances'), false)
  assert.equal(tracked.ops.some((item) => item.op === 'persist'), true)
}

test('successful upload changes only the Products imageFileId', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  const before = {
    components: cloneSheet(backend, 'SalesComponents'),
    balances: cloneSheet(backend, 'InventoryBalances'),
    productFields: productFieldsWithoutImage(backend, 'prd-sugar'),
  }
  const tracked = trackImageOps(backend)
  const uploaded = call(backend, 'products.uploadImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: PNG_DATA_URL, fileName: 'first.png',
  })
  assert.equal(uploaded.ok, true, uploaded.error && uploaded.error.message)
  const imageFileId = byId(uploaded.data, 'prd-sugar').imageFileId
  assert.ok(imageFileId)
  assert.equal(productImageId(backend, 'prd-sugar'), imageFileId)
  assertImageWriteTouchedOnlyProducts(backend, tracked, before)
})

test('successful replace changes only the Products imageFileId', () => {
  const backend = ready()
  const firstId = seedProductWithImage(backend)
  const before = {
    components: cloneSheet(backend, 'SalesComponents'),
    balances: cloneSheet(backend, 'InventoryBalances'),
    productFields: productFieldsWithoutImage(backend, 'prd-sugar'),
  }
  const tracked = trackImageOps(backend)
  tracked.ops.length = 0
  const replaced = call(backend, 'products.replaceImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: JPEG_DATA_URL, fileName: 'second.jpg',
  })
  assert.equal(replaced.ok, true, replaced.error && replaced.error.message)
  const nextId = byId(replaced.data, 'prd-sugar').imageFileId
  assert.ok(nextId)
  assert.notEqual(nextId, firstId)
  assert.equal(productImageId(backend, 'prd-sugar'), nextId)
  assertImageWriteTouchedOnlyProducts(backend, tracked, before)
})

test('successful remove changes only the Products imageFileId', () => {
  const backend = ready()
  seedProductWithImage(backend)
  const before = {
    components: cloneSheet(backend, 'SalesComponents'),
    balances: cloneSheet(backend, 'InventoryBalances'),
    productFields: productFieldsWithoutImage(backend, 'prd-sugar'),
  }
  const tracked = trackImageOps(backend)
  tracked.ops.length = 0
  const removed = call(backend, 'products.removeImage', { actorUserId: 'u-mei', productId: 'prd-sugar' })
  assert.equal(removed.ok, true, removed.error && removed.error.message)
  assert.equal(byId(removed.data, 'prd-sugar').imageFileId, undefined)
  assert.equal(productImageId(backend, 'prd-sugar'), undefined)
  assertImageWriteTouchedOnlyProducts(backend, tracked, before)
})

test('SalesComponents and InventoryBalances write failures cannot affect image operations', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  const tracked = trackImageOps(backend)
  tracked.control.failComponents = true
  tracked.control.failBalances = true
  const uploaded = call(backend, 'products.uploadImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: PNG_DATA_URL, fileName: 'first.png',
  })
  assert.equal(uploaded.ok, true, uploaded.error && uploaded.error.message)
  const firstId = byId(uploaded.data, 'prd-sugar').imageFileId
  assert.ok(firstId)
  assert.equal(tracked.ops.some((item) => item.op === 'sheet-write' && item.sheet === 'SalesComponents'), false)
  assert.equal(tracked.ops.some((item) => item.op === 'sheet-write' && item.sheet === 'InventoryBalances'), false)

  tracked.ops.length = 0
  const replaced = call(backend, 'products.replaceImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: JPEG_DATA_URL, fileName: 'second.jpg',
  })
  assert.equal(replaced.ok, true, replaced.error && replaced.error.message)
  const nextId = byId(replaced.data, 'prd-sugar').imageFileId
  assert.ok(nextId)
  assert.notEqual(nextId, firstId)
  assert.equal(tracked.ops.some((item) => item.op === 'sheet-write' && item.sheet === 'SalesComponents'), false)
  assert.equal(tracked.ops.some((item) => item.op === 'sheet-write' && item.sheet === 'InventoryBalances'), false)

  tracked.ops.length = 0
  const removed = call(backend, 'products.removeImage', { actorUserId: 'u-mei', productId: 'prd-sugar' })
  assert.equal(removed.ok, true, removed.error && removed.error.message)
  assert.equal(productImageId(backend, 'prd-sugar'), undefined)
  assert.equal(tracked.ops.some((item) => item.op === 'sheet-write' && item.sheet === 'SalesComponents'), false)
  assert.equal(tracked.ops.some((item) => item.op === 'sheet-write' && item.sheet === 'InventoryBalances'), false)
})

test('Products persistence failure preserves the previous valid image and does not delete it', () => {
  const backend = ready()
  const firstId = seedProductWithImage(backend)
  const tracked = trackImageOps(backend)
  tracked.ops.length = 0
  tracked.control.failPersist = true
  const failed = call(backend, 'products.replaceImage', {
    actorUserId: 'u-mei', productId: 'prd-sugar', dataUrl: JPEG_DATA_URL, fileName: 'second.jpg',
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'INTERNAL_ERROR')
  const uploaded = tracked.ops.find((item) => item.op === 'upload')
  assert.ok(uploaded)
  assert.equal(productImageId(backend, 'prd-sugar'), firstId)
  assert.equal(backend.drive.trashed.includes(firstId), false)
  assert.equal(backend.drive.trashed.includes(uploaded.id), true)
  assert.equal(tracked.ops.some((item) => item.op === 'trash' && item.id === firstId), false)
  const still = call(backend, 'products.getImage', { actorUserId: 'u-siti', productId: 'prd-sugar' })
  assert.equal(still.ok, true, still.error && still.error.message)
})

