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
    inventory: context.createInventoryService({ sheetRepository: sheets }),
  }
}

function request(action, payload, extra = {}) {
  return { v: 1, requestId: extra.requestId || action, action, payload, idempotencyKey: extra.idempotencyKey }
}

function call(backend, action, payload, extra) {
  return backend.context.handleRequest(request(action, payload, extra), backend)
}

let keySeq = 0
function post(backend, action, payload) {
  keySeq += 1
  return call(backend, action, payload, { idempotencyKey: payload.idempotencyKey || `inv-${keySeq}`, requestId: `req-${keySeq}` })
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
    categories: [{ id: 'cat-ing', name: 'Ingredients' }],
  }
}

function ready() {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(call(backend, 'identity.bootstrap', identityPayload()).ok, true)
  assert.equal(call(backend, 'masters.bootstrap', masterPayload()).ok, true)
  assert.equal(call(backend, 'products.create', {
    actorUserId: 'u-mei', id: 'prd-sugar', name: 'UAT Sugar', categoryId: 'cat-ing', unit: 'KG',
    purchaseUnit: 'BAG', purchaseConversionQty: 25, purchaseCost: 50, sellingPrice: 12,
  }).ok, true)
  return backend
}

function qty(data, productId, warehouseId) {
  const row = data.inventory.find((item) => item.productId === productId && item.warehouseId === warehouseId)
  return row ? row.qty : 0
}

function auditActions(backend) {
  return (backend.spreadsheet.store.AuditLogs || []).slice(1).map((row) => row[3])
}

function movementRows(backend) {
  return (backend.spreadsheet.store.StockMovements || []).slice(1)
}

test('inventory sheets stay unread until the module is called and Sheet1 stays reserved', () => {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(backend.spreadsheet.store.StockMovements, undefined)
  const health = call(backend, 'system.health', {})
  assert.equal(health.ok, true)
  assert.equal(backend.spreadsheet.store.StockMovements, undefined)
  assert.deepEqual(backend.spreadsheet.store.Sheet1, [['']])
})

test('reads, adjustment, shortage, permissions, audit, and balance stay consistent', () => {
  const backend = ready()
  const before = call(backend, 'inventory.get', {})
  assert.equal(before.ok, true)
  assert.equal(qty(before.data, 'prd-sugar', 'wh-main'), 0)
  assert.equal(before.data.stockMovements.length, 0)
  const again = call(backend, 'inventory.get', {})
  assert.equal(again.data.inventory.length, before.data.inventory.length)
  assert.equal(again.data.stockMovements.length, 0)

  const denied = post(backend, 'inventory.adjust', {
    actorUserId: 'u-mei', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'increase', qty: 5, reason: 'Found stock',
  })
  assert.equal(denied.error.code, 'FORBIDDEN')
  assert.equal(denied.error.message, 'You cannot adjust stock.')
  const inactive = post(backend, 'inventory.adjust', {
    actorUserId: 'u-off', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'increase', qty: 5, reason: 'Found stock',
  })
  assert.equal(inactive.error.code, 'FORBIDDEN')
  const missingKey = call(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'increase', qty: 5, reason: 'Found stock',
  })
  assert.equal(missingKey.error.message, 'Idempotency key is required.')
  assert.equal(auditActions(backend).includes('inventory.adjust'), false)
  assert.equal(movementRows(backend).length, 0)

  const increased = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'increase', qty: 100, reason: 'Found stock', notes: 'UAT',
  })
  assert.equal(increased.ok, true)
  assert.equal(increased.data.reference, 'ADJ-0001')
  assert.equal(qty(increased.data, 'prd-sugar', 'wh-main'), 100)
  assert.equal(qty(increased.data, 'prd-sugar', 'wh-outlet'), 0)
  const line = increased.data.stockMovements[0]
  assert.equal(line.type, 'adjustment')
  assert.equal(line.stockIn, 100)
  assert.equal(line.stockOut, 0)
  assert.equal(line.balance, 100)
  assert.equal(line.user, 'Aina Rahman')
  assert.equal(line.notes, 'Found stock — UAT')
  assert.equal(auditActions(backend).includes('inventory.adjust'), true)

  const badQty = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'increase', qty: 0, reason: 'Correction',
  })
  assert.equal(badQty.error.message, 'Enter a quantity')
  const badType = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'set', qty: 1, reason: 'Correction',
  })
  assert.equal(badType.error.message, 'Adjustment type is not valid.')
  const missingProduct = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-missing', type: 'increase', qty: 1, reason: 'Correction',
  })
  assert.equal(missingProduct.error.code, 'NOT_FOUND')
  assert.equal(missingProduct.error.message, 'Product was not found.')
  const missingWarehouse = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-nope', productId: 'prd-sugar', type: 'increase', qty: 1, reason: 'Correction',
  })
  assert.equal(missingWarehouse.error.message, 'Warehouse was not found.')
  const agentWarehouse = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-agent', productId: 'prd-sugar', type: 'increase', qty: 1, reason: 'Correction',
  })
  assert.equal(agentWarehouse.error.message, 'Choose a company warehouse')
  assert.equal(auditActions(backend).filter((action) => action === 'inventory.adjust').length, 1)

  const shortage = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'decrease', qty: 150, reason: 'Damage',
  })
  assert.equal(shortage.error.message, 'Not enough stock. Current stock is 100.')
  assert.equal(qty(call(backend, 'inventory.get', {}).data, 'prd-sugar', 'wh-main'), 100)
  assert.equal(movementRows(backend).length, 1)

  const decreased = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'decrease', qty: 20, reason: 'Damage',
  })
  assert.equal(decreased.ok, true)
  assert.equal(decreased.data.reference, 'ADJ-0002')
  assert.equal(qty(decreased.data, 'prd-sugar', 'wh-main'), 80)
  const first = decreased.data.stockMovements.find((row) => row.reference === 'ADJ-0001')
  assert.equal(first.balance, 100)
  assert.equal(first.stockIn, 100)
  const product = call(backend, 'products.get', { id: 'prd-sugar' }).data.product
  assert.equal(product.sku, '100001')
  assert.equal(product.costPrice, 2)
  const owner = call(backend, 'users.list', {}).data.users.find((user) => user.id === 'u-aina')
  assert.equal(owner.status, 'active')
  const main = call(backend, 'warehouses.list', {}).data.warehouses.find((row) => row.id === 'wh-main')
  assert.equal(main.kind, 'company')
  assert.equal(main.name, 'Main Warehouse')
})

test('the same idempotency key posts one adjustment and a lock refusal writes nothing', () => {
  const backend = ready()
  const payload = {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'increase', qty: 10, reason: 'Found stock',
  }
  const first = call(backend, 'inventory.adjust', payload, { idempotencyKey: 'adj-once', requestId: 'once' })
  const second = call(backend, 'inventory.adjust', payload, { idempotencyKey: 'adj-once', requestId: 'twice' })
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(second.meta.idempotentReplay, true)
  assert.equal(qty(second.data, 'prd-sugar', 'wh-main'), 10)
  assert.equal(second.data.stockMovements.length, 1)

  let blocked = false
  const locked = app(() => {
    if (blocked) return false
    return true
  })
  locked.foundation.initialize()
  assert.equal(call(locked, 'identity.bootstrap', identityPayload()).ok, true)
  assert.equal(call(locked, 'masters.bootstrap', masterPayload()).ok, true)
  assert.equal(call(locked, 'products.create', {
    actorUserId: 'u-aina', id: 'prd-sugar', name: 'UAT Sugar', categoryId: 'cat-ing', unit: 'KG',
    purchaseUnit: 'BAG', purchaseConversionQty: 25, purchaseCost: 50, sellingPrice: 12,
  }).ok, true)
  blocked = true
  const refused = post(locked, 'inventory.adjust', payload)
  assert.equal(refused.error.code, 'CONFLICT')
  blocked = false
  const untouched = call(locked, 'inventory.get', {})
  assert.equal(qty(untouched.data, 'prd-sugar', 'wh-main'), 0)
  assert.equal(untouched.data.stockMovements.length, 0)
})

test('transfer is one atomic pair and sequential outs cannot both spend the same stock', () => {
  const backend = ready()
  assert.equal(post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'increase', qty: 100, reason: 'Found stock',
  }).ok, true)
  const same = post(backend, 'inventory.transfer', {
    actorUserId: 'u-aina', fromWarehouseId: 'wh-main', toWarehouseId: 'wh-main', productId: 'prd-sugar', qty: 20,
  })
  assert.equal(same.error.message, 'Choose different warehouses')
  const denied = post(backend, 'inventory.transfer', {
    actorUserId: 'u-mei', fromWarehouseId: 'wh-main', toWarehouseId: 'wh-outlet', productId: 'prd-sugar', qty: 20,
  })
  assert.equal(denied.error.message, 'You cannot transfer stock.')
  const badDest = post(backend, 'inventory.transfer', {
    actorUserId: 'u-aina', fromWarehouseId: 'wh-main', toWarehouseId: 'wh-missing', productId: 'prd-sugar', qty: 20,
  })
  assert.equal(badDest.error.message, 'Warehouse was not found.')
  assert.equal(qty(call(backend, 'inventory.get', {}).data, 'prd-sugar', 'wh-main'), 100)
  assert.equal(movementRows(backend).length, 1)

  const moved = post(backend, 'inventory.transfer', {
    actorUserId: 'u-aina', fromWarehouseId: 'wh-main', toWarehouseId: 'wh-outlet', productId: 'prd-sugar', qty: 20,
  })
  assert.equal(moved.ok, true)
  assert.equal(moved.data.reference, 'TRF-0001')
  assert.equal(qty(moved.data, 'prd-sugar', 'wh-main'), 80)
  assert.equal(qty(moved.data, 'prd-sugar', 'wh-outlet'), 20)
  const pair = moved.data.stockMovements.filter((row) => row.reference === 'TRF-0001')
  assert.equal(pair.length, 2)
  assert.equal(pair.find((row) => row.type === 'transfer_out').balance, 80)
  assert.equal(pair.find((row) => row.type === 'transfer_in').balance, 20)
  assert.equal(pair[0].reference, pair[1].reference)

  const firstOut = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'decrease', qty: 70, reason: 'Damage',
  })
  assert.equal(firstOut.ok, true)
  assert.equal(qty(firstOut.data, 'prd-sugar', 'wh-main'), 10)
  const secondOut = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'decrease', qty: 50, reason: 'Damage',
  })
  assert.equal(secondOut.error.message, 'Not enough stock. Current stock is 10.')
  assert.equal(qty(call(backend, 'inventory.get', {}).data, 'prd-sugar', 'wh-main'), 10)
  assert.equal(auditActions(backend).filter((action) => action === 'inventory.transfer').length, 1)
})

test('negative stock follows the inventory setting and usage posts stock out', () => {
  const backend = ready()
  assert.equal(post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'increase', qty: 5, reason: 'Found stock',
  }).ok, true)
  const blocked = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'decrease', qty: 8, reason: 'Damage',
  })
  assert.equal(blocked.ok, false)
  const updated = call(backend, 'settings.update', { actorUserId: 'u-aina', patch: { allowNegativeStock: true } })
  assert.equal(updated.ok, true)
  const allowed = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'decrease', qty: 8, reason: 'Damage',
  })
  assert.equal(allowed.ok, true)
  assert.equal(qty(allowed.data, 'prd-sugar', 'wh-main'), -3)

  call(backend, 'settings.update', { actorUserId: 'u-aina', patch: { allowNegativeStock: false } })
  const staffUsage = post(backend, 'inventory.usage', {
    actorUserId: 'u-mei', warehouseId: 'wh-main', productId: 'prd-sugar', qty: 1, reason: 'Sample',
  })
  assert.equal(staffUsage.error.message, 'You cannot record stock usage.')
  assert.equal(call(backend, 'products.setStatus', { actorUserId: 'u-aina', id: 'prd-sugar', status: 'inactive' }).ok, true)
  const inactiveProduct = post(backend, 'inventory.usage', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-sugar', qty: 1, reason: 'Sample', date: '2026-10-04',
  })
  assert.equal(inactiveProduct.error.message, 'Choose a product')
  const stillAdjusted = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-shop', productId: 'prd-sugar', type: 'increase', qty: 2, reason: 'Correction',
  })
  assert.equal(stillAdjusted.ok, true)
  assert.equal(qty(stillAdjusted.data, 'prd-sugar', 'wh-shop'), 2)
  assert.equal(call(backend, 'products.setStatus', { actorUserId: 'u-aina', id: 'prd-sugar', status: 'active' }).ok, true)
  const used = post(backend, 'inventory.usage', {
    actorUserId: 'u-aina', warehouseId: 'wh-shop', productId: 'prd-sugar', qty: 1, reason: 'Sample', notes: 'Bench', date: '2026-10-04',
  })
  assert.equal(used.ok, true)
  assert.equal(used.data.reference, 'USE-0001')
  assert.equal(qty(used.data, 'prd-sugar', 'wh-shop'), 1)
  const usage = used.data.stockMovements.find((row) => row.reference === 'USE-0001')
  assert.equal(usage.type, 'stock_usage')
  assert.equal(usage.stockOut, 1)
  assert.equal(usage.date, '2026-10-04T08:00:00.000+08:00')
  assert.equal(usage.notes, 'Sample — Bench')
})

test('stock count posts the difference once and a rejected count does not audit', () => {
  const backend = ready()
  assert.equal(post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-sugar', type: 'increase', qty: 10, reason: 'Found stock',
  }).ok, true)
  const denied = post(backend, 'inventory.count', {
    actorUserId: 'u-mei', warehouseId: 'wh-main', counts: [{ productId: 'prd-sugar', countedQty: 7 }],
  })
  assert.equal(denied.error.message, 'You cannot complete a stock count.')
  const broken = post(backend, 'inventory.count', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', counts: [
      { productId: 'prd-sugar', countedQty: 7 },
      { productId: 'prd-missing', countedQty: 1 },
    ],
  })
  assert.equal(broken.error.message, 'Product was not found.')
  assert.equal(qty(call(backend, 'inventory.get', {}).data, 'prd-sugar', 'wh-main'), 10)
  assert.equal(auditActions(backend).includes('inventory.count'), false)

  const counted = post(backend, 'inventory.count', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', counts: [
      { productId: 'prd-sugar', countedQty: 7 },
      { productId: 'prd-sugar', countedQty: 7 },
    ],
  })
  assert.equal(counted.ok, true)
  assert.equal(counted.data.changes, 1)
  assert.equal(counted.data.reference, 'CNT-0001')
  assert.equal(qty(counted.data, 'prd-sugar', 'wh-main'), 7)
  const countLine = counted.data.stockMovements.find((row) => row.type === 'stock_count')
  assert.equal(countLine.stockOut, 3)
  assert.equal(countLine.balance, 7)
  assert.equal(countLine.notes, 'Physical count')
  const same = post(backend, 'inventory.count', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', counts: [{ productId: 'prd-sugar', countedQty: 7 }],
  })
  assert.equal(same.ok, true)
  assert.equal(same.data.changes, 0)
  assert.equal(auditActions(backend).filter((action) => action === 'inventory.count').length, 1)
  assert.equal(movementRows(backend).filter((row) => row[5] === 'stock_count').length, 1)
})

test('the inventory screens queue the ledger actions', () => {
  const source = fs.readFileSync(path.join(root, 'src/store/db.ts'), 'utf8')
  assert.equal(source.includes("queueInventoryWrite('inventory.adjust'"), true)
  assert.equal(source.includes("queueInventoryWrite('inventory.transfer'"), true)
  assert.equal(source.includes("queueInventoryWrite('inventory.count'"), true)
  assert.equal(source.includes("queueInventoryWrite('inventory.usage'"), true)
  assert.equal(source.includes("queueProductWrite('products.saveAgentPrices'"), true)
})
