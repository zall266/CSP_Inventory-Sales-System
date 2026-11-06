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
      { id: 'wh-agent', name: 'Agent Shelf', code: 'AG1', kind: 'agent' },
    ],
    categories: [
      { id: 'cat-air', name: 'Air Balang' },
      { id: 'cat-ice', name: 'Ice Blended' },
      { id: 'cat-ing', name: 'Ingredients' },
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

function productInput(extra = {}) {
  return {
    actorUserId: 'u-mei',
    id: 'prd-sugar',
    name: 'UAT Sugar',
    categoryId: 'cat-ing',
    unit: 'KG',
    purchaseUnit: 'BAG',
    purchaseConversionQty: 25,
    purchaseCost: 50,
    sellingPrice: 12,
    wholesalePrice: 10,
    sellable: false,
    reorderLevel: 8,
    ...extra,
  }
}

function byId(data, id) {
  return data.products.find((product) => product.id === id)
}

function auditActions(backend) {
  return (backend.spreadsheet.store.AuditLogs || []).map((row) => row[3])
}

test('product sheets stay unread until the module is called and Sheet1 stays reserved', () => {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(backend.spreadsheet.store.Products, undefined)
  assert.equal(backend.spreadsheet.store.SalesComponents, undefined)
  assert.equal(backend.spreadsheet.store.InventoryBalances, undefined)
  const health = call(backend, 'system.health', {})
  assert.equal(health.ok, true)
  assert.equal(backend.spreadsheet.store.Products, undefined)
  assert.deepEqual(backend.spreadsheet.store.Sheet1, [['']])
})

test('product create stores the catalogue, conversion cost, category, and zero company balances', () => {
  const backend = ready()
  const denied = call(backend, 'products.create', productInput({ actorUserId: '' }))
  assert.equal(denied.error.code, 'FORBIDDEN')
  assert.equal(denied.error.message, 'You cannot add products.')
  const inactive = call(backend, 'products.create', productInput({ actorUserId: 'u-off' }))
  assert.equal(inactive.error.code, 'FORBIDDEN')
  assert.equal(auditActions(backend).includes('products.create'), false)

  const created = call(backend, 'products.create', productInput())
  assert.equal(created.ok, true)
  const product = byId(created.data, 'prd-sugar')
  assert.equal(product.name, 'UAT Sugar')
  assert.equal(product.sku, '100001')
  assert.equal(product.categoryId, 'cat-ing')
  assert.equal(product.unit, 'KG')
  assert.equal(product.purchaseUnit, 'BAG')
  assert.equal(product.purchaseConversionQty, 25)
  assert.equal(product.purchaseCost, 50)
  assert.equal(product.costPrice, 2)
  assert.equal(product.costSource, 'manual')
  assert.equal(product.sellable, false)
  assert.equal(product.reorderLevel, 8)
  assert.equal(product.status, 'active')
  const balances = created.data.inventoryBalances.filter((row) => row.productId === 'prd-sugar')
  assert.deepEqual(balances.map((row) => row.warehouseId).sort(), ['wh-main', 'wh-outlet', 'wh-shop'])
  assert.equal(balances.every((row) => row.qty === 0), true)
  assert.equal(created.data.inventoryBalances.some((row) => row.warehouseId === 'wh-agent'), false)

  const listed = call(backend, 'products.list', {})
  assert.equal(byId(listed.data, 'prd-sugar').sku, '100001')
  const one = call(backend, 'products.get', { id: 'prd-sugar' })
  assert.equal(one.data.product.costPrice, 2)
  assert.equal(one.data.inventoryBalances.length, 3)
  const missing = call(backend, 'products.get', { id: 'prd-missing' })
  assert.equal(missing.error.code, 'NOT_FOUND')
  assert.equal(missing.error.message, 'Product was not found.')
  assert.deepEqual(backend.spreadsheet.store.Products[0], [
    'id', 'name', 'sku', 'barcode', 'categoryId', 'unit', 'purchaseUnit',
    'purchaseConversionQty', 'purchaseCost', 'costPrice', 'costSource',
    'sellingPrice', 'wholesalePrice', 'agentPrice', 'sellable', 'reorderLevel',
    'trackBatch', 'trackExpiry', 'status', 'accent',
  ])
  assert.deepEqual(backend.spreadsheet.store.Sheet1, [['']])
  assert.equal(call(backend, 'users.list', {}).data.users[0].email, 'aina@coolslurppy.my')
  assert.equal(call(backend, 'warehouses.list', {}).data.warehouses.length, 4)
})

test('sku generation, manual sku, and duplicates follow the product form', () => {
  const backend = ready()
  const manual = call(backend, 'products.create', productInput({ id: 'prd-manual', sku: '  AbC-9  ' }))
  assert.equal(manual.ok, true)
  assert.equal(byId(manual.data, 'prd-manual').sku, 'AbC-9')
  const duplicate = call(backend, 'products.create', productInput({ id: 'prd-copy', sku: 'abc-9' }))
  assert.equal(duplicate.error.code, 'VALIDATION_ERROR')
  assert.equal(duplicate.error.message, 'SKU already exists')
  assert.equal(auditActions(backend).filter((action) => action === 'products.create').length, 1)
  const supplied = call(backend, 'products.create', productInput({ id: 'prd-fixed', sku: '100050', name: 'Fixed' }))
  assert.equal(byId(supplied.data, 'prd-fixed').sku, '100050')
  const generated = call(backend, 'products.create', productInput({ id: 'prd-next', name: 'Next', sku: '' }))
  assert.equal(byId(generated.data, 'prd-next').sku, '100001')
  const after = call(backend, 'products.create', productInput({ id: 'prd-after', name: 'After', sku: '   ' }))
  assert.equal(byId(after.data, 'prd-after').sku, '100002')
  const sameId = call(backend, 'products.create', productInput({ id: 'prd-manual', name: 'Other', sku: 'ZZ-1' }))
  assert.equal(sameId.error.code, 'CONFLICT')
  assert.equal(sameId.error.message, 'Product already exists.')
})

test('product validation rejects incomplete writes without an audit row', () => {
  const backend = ready()
  const blank = call(backend, 'products.create', productInput({ name: '   ' }))
  assert.equal(blank.error.message, 'Product name is required')
  const unit = call(backend, 'products.create', productInput({ unit: ' ' }))
  assert.equal(unit.error.message, 'Base Unit is required.')
  const conversion = call(backend, 'products.create', productInput({ purchaseConversionQty: 0 }))
  assert.equal(conversion.error.message, 'Conversion quantity must be greater than 0.')
  const selling = call(backend, 'products.create', productInput({ sellingPrice: -1 }))
  assert.equal(selling.error.message, 'Selling Price cannot be negative.')
  const wholesale = call(backend, 'products.create', productInput({ wholesalePrice: -2 }))
  assert.equal(wholesale.error.message, 'Wholesale price cannot be negative.')
  const cost = call(backend, 'products.create', productInput({ purchaseCost: -3 }))
  assert.equal(cost.error.message, 'Cost Price cannot be negative.')
  const category = call(backend, 'products.create', productInput({ categoryId: 'cat-missing' }))
  assert.equal(category.error.code, 'NOT_FOUND')
  assert.equal(category.error.message, 'Category was not found.')
  const agent = call(backend, 'products.create', productInput({ agentPrice: 4 }))
  assert.equal(agent.error.code, 'FORBIDDEN')
  assert.equal(agent.error.message, 'You cannot change Agent Price.')
  assert.equal(auditActions(backend).includes('products.create'), false)
  assert.equal((backend.spreadsheet.store.Products || []).length, 1)
})

test('product update, status, sales components, and sku lock persist', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput()).ok, true)
  assert.equal(call(backend, 'products.create', productInput({
    id: 'prd-cup', name: 'UAT Cup', sku: 'CUP-1', unit: 'PCS', purchaseUnit: 'PCS', purchaseCost: 1, sellingPrice: 2,
  })).ok, true)
  const component = call(backend, 'products.update', {
    actorUserId: 'u-mei',
    id: 'prd-sugar',
    salesComponents: [{ productId: 'prd-cup', qty: 2 }, { productId: 'prd-cup', qty: 1 }],
  })
  assert.equal(component.ok, true)
  const parts = byId(component.data, 'prd-sugar').salesComponents
  assert.equal(parts.length, 1)
  assert.equal(parts[0].productId, 'prd-cup')
  assert.equal(parts[0].qty, 3)
  const self = call(backend, 'products.update', {
    actorUserId: 'u-mei', id: 'prd-sugar', salesComponents: [{ productId: 'prd-sugar', qty: 1 }],
  })
  assert.equal(self.error.message, 'A product cannot include itself as a sales component.')
  assert.equal(call(backend, 'products.setStatus', { actorUserId: 'u-mei', id: 'prd-cup', status: 'inactive' }).ok, true)
  const inactiveComponent = call(backend, 'products.update', {
    actorUserId: 'u-mei', id: 'prd-sugar', salesComponents: [{ productId: 'prd-cup', qty: 1 }],
  })
  assert.equal(inactiveComponent.error.message, 'UAT Cup is inactive.')
  const renamed = call(backend, 'products.update', {
    actorUserId: 'u-mei', id: 'prd-sugar', name: 'UAT Sugar Fine', sku: 'SUG-2',
  })
  assert.equal(renamed.ok, true)
  assert.equal(byId(renamed.data, 'prd-sugar').name, 'UAT Sugar Fine')
  assert.equal(byId(renamed.data, 'prd-sugar').sku, 'SUG-2')
  assert.equal(byId(renamed.data, 'prd-sugar').costPrice, 2)
  const balanceRow = backend.spreadsheet.store.InventoryBalances.find((row) => row[0] === 'prd-sugar')
  balanceRow[2] = 5
  const locked = call(backend, 'products.update', { actorUserId: 'u-mei', id: 'prd-sugar', sku: 'SUG-3' })
  assert.equal(locked.error.message, 'SKU cannot be changed')
  assert.equal(auditActions(backend).filter((action) => action === 'products.update').length, 2)
  const still = call(backend, 'products.update', { actorUserId: 'u-mei', id: 'prd-sugar', name: 'UAT Sugar Kept' })
  assert.equal(still.ok, true)
  assert.equal(byId(still.data, 'prd-sugar').sku, 'SUG-2')
  assert.equal(byId(still.data, 'prd-sugar').name, 'UAT Sugar Kept')
  const activated = call(backend, 'products.setStatus', { actorUserId: 'u-aina', id: 'prd-cup', status: 'active' })
  assert.equal(byId(activated.data, 'prd-cup').status, 'active')
  const missing = call(backend, 'products.update', { actorUserId: 'u-mei', id: 'prd-missing', name: 'Nope' })
  assert.equal(missing.error.code, 'NOT_FOUND')
  const badStatus = call(backend, 'products.setStatus', { actorUserId: 'u-mei', id: 'prd-cup', status: 'archived' })
  assert.equal(badStatus.error.message, 'Product status is not valid.')
  assert.equal(call(backend, 'products.get', { id: 'prd-cup' }).data.product.status, 'active')
})

test('agent prices require agent.manage and do not change the owner', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', productInput({ id: 'prd-price', sku: 'PR-1', sellingPrice: 20, sellable: true })).ok, true)
  const staff = call(backend, 'products.saveAgentPrices', {
    actorUserId: 'u-mei',
    rows: [{ productId: 'prd-price', agentPrice: 5, sellingPrice: 18 }],
  })
  assert.equal(staff.error.code, 'FORBIDDEN')
  assert.equal(staff.error.message, 'You cannot change product prices.')
  assert.equal(auditActions(backend).includes('products.saveAgentPrices'), false)
  const negative = call(backend, 'products.saveAgentPrices', {
    actorUserId: 'u-aina',
    rows: [{ productId: 'prd-price', wholesalePrice: -1 }],
  })
  assert.equal(negative.error.message, 'Wholesale Price cannot be negative.')
  const above = call(backend, 'products.saveAgentPrices', {
    actorUserId: 'u-aina',
    rows: [{ productId: 'prd-price', agentPrice: 30, sellingPrice: 18 }],
  })
  assert.equal(above.error.message, 'Agent Price cannot be higher than Selling Price.')
  const empty = call(backend, 'products.saveAgentPrices', { actorUserId: 'u-aina', rows: [] })
  assert.equal(empty.error.message, 'No price changes to save.')
  const saved = call(backend, 'products.saveAgentPrices', {
    actorUserId: 'u-aina',
    rows: [{ productId: 'prd-price', agentPrice: 9, sellingPrice: 18, wholesalePrice: 14 }],
  })
  assert.equal(saved.ok, true)
  const priced = byId(saved.data, 'prd-price')
  assert.equal(priced.agentPrice, 9)
  assert.equal(priced.sellingPrice, 18)
  assert.equal(priced.wholesalePrice, 14)
  const owner = call(backend, 'users.list', {}).data.users.find((user) => user.id === 'u-aina')
  assert.equal(owner.name, 'Aina Rahman')
  assert.equal(owner.status, 'active')
  assert.equal(owner.email, 'aina@coolslurppy.my')
  assert.equal(auditActions(backend).filter((action) => action === 'products.saveAgentPrices').length, 1)
})

test('bootstrap runs once and a replayed create does not duplicate rows', () => {
  const backend = ready()
  const seeded = call(backend, 'products.bootstrap', {
    actorUserId: 'u-aina',
    products: [
      { id: 'p-cp', name: 'Chocolate Powder', sku: 'CP001', categoryId: 'cat-ing', unit: 'KG', costPrice: 22, sellingPrice: 35, wholesalePrice: 30, reorderLevel: 20, status: 'active', accent: '#7C4A1E' },
      { id: 'p-cup', name: 'Cup', sku: 'CUP001', categoryId: 'cat-air', unit: 'pcs', costPrice: 0.15, sellingPrice: 0.4, wholesalePrice: 0.28, salesComponents: [{ productId: 'p-cp', qty: 1 }] },
    ],
  })
  assert.equal(seeded.ok, true)
  assert.equal(seeded.data.products.length, 2)
  assert.equal(byId(seeded.data, 'p-cp').sku, 'CP001')
  assert.equal(byId(seeded.data, 'p-cup').unit, 'PCS')
  assert.equal(byId(seeded.data, 'p-cup').salesComponents[0].productId, 'p-cp')
  assert.equal(seeded.data.inventoryBalances.length, 6)
  const again = call(backend, 'products.bootstrap', {
    products: [{ id: 'p-other', name: 'Other', sku: 'OT001', categoryId: 'cat-ing', unit: 'KG', costPrice: 1, sellingPrice: 1 }],
  })
  assert.equal(again.error.code, 'CONFLICT')
  assert.equal(again.error.message, 'Products are already initialized.')
  assert.equal(backend.spreadsheet.store.Products.filter((row) => row[0] === 'p-cp').length, 1)
  assert.equal(auditActions(backend).filter((action) => action === 'products.bootstrap').length, 1)

  const body = request('products.create', productInput({ id: 'prd-once', sku: 'ONCE-1' }), {
    idempotencyKey: 'prd-once', requestId: 'once',
  })
  const first = backend.context.handleRequest(body, backend)
  const second = backend.context.handleRequest(body, backend)
  assert.equal(first.ok, true)
  assert.equal(second.meta.idempotentReplay, true)
  assert.equal(backend.spreadsheet.store.Products.filter((row) => row[0] === 'prd-once').length, 1)
})

test('a product write that cannot get the lock does not add a row', () => {
  const backend = ready()
  let open = true
  const blocked = app(() => {
    const allowed = open
    open = false
    return allowed
  })
  blocked.spreadsheet = backend.spreadsheet
  blocked.sheets = blocked.context.createSheetRepository({ openSpreadsheet: () => backend.spreadsheet })
  blocked.products = blocked.context.createProductService({ sheetRepository: blocked.sheets })
  blocked.idempotency = blocked.context.createIdempotencyService(blocked.sheets)
  const created = call(blocked, 'products.create', productInput({ id: 'prd-lock', sku: 'LOCK-1' }))
  assert.equal(created.ok, true)
  const denied = call(blocked, 'products.create', productInput({ id: 'prd-lock-2', sku: 'LOCK-2' }))
  assert.equal(denied.error.code, 'CONFLICT')
  assert.equal(backend.spreadsheet.store.Products.filter((row) => row[0] === 'prd-lock-2').length, 0)
  assert.equal(backend.spreadsheet.store.Products.filter((row) => row[0] === 'prd-lock').length, 1)
})

test('frontend product calls stay on the existing db methods', () => {
  const source = fs.readFileSync(path.join(root, 'src/store/db.ts'), 'utf8')
  assert.equal(source.includes("queueProductWrite('products.create'"), true)
  assert.equal(source.includes("queueProductWrite('products.update'"), true)
  assert.equal(source.includes("queueProductWrite('products.setStatus'"), true)
  assert.equal(source.includes("queueProductWrite('products.saveAgentPrices'"), true)
  assert.equal(source.includes('createProduct(input: ProductInput)'), true)
  assert.equal(source.includes('setProductStatus(id: string, status: ProductStatus)'), true)
})
