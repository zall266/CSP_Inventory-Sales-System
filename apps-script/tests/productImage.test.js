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
  assert.equal(pos.includes('<ProductMark product={p} size="xl" />'), true)
  assert.equal(pos.includes('products.getImage'), false)
  assert.equal(recipe.includes('sessions.getRecipePhoto'), true)
  assert.equal(db.includes("queueProductWrite('products.create'"), true)
  assert.equal(db.includes("queueProductWrite('products.uploadImage'"), false)
  assert.equal(db.includes('createSale'), true)
  assert.equal(db.includes('createAgentSale'), true)
})
