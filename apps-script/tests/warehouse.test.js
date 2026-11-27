import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createFakeDrive,
  createFakeSpreadsheet,
  devProperties,
  loadBackend,
} from './harness.js'

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
    warehouse: context.createWarehouseService({ sheetRepository: sheets }),
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
    idempotencyKey: extra.idempotencyKey || payload.idempotencyKey || `map-${keySeq}`,
    requestId: extra.requestId || `req-${keySeq}`,
  })
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
    categories: [{ id: 'cat-pack', name: 'Packaging' }],
  }
}

function ready() {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(call(backend, 'identity.bootstrap', identityPayload()).ok, true)
  assert.equal(call(backend, 'masters.bootstrap', masterPayload()).ok, true)
  assert.equal(call(backend, 'products.create', {
    actorUserId: 'u-mei', id: 'prd-pack', name: 'UAT Pack', categoryId: 'cat-pack', unit: 'packs',
    purchaseUnit: 'CTN', purchaseConversionQty: 20, purchaseCost: 40, sellingPrice: 12,
  }).ok, true)
  return backend
}

function grant(backend, key) {
  backend.spreadsheet.store.RolePermissions.push(['role-staff', key, true])
}

function auditActions(backend) {
  return (backend.spreadsheet.store.AuditLogs || []).slice(1).map((row) => row[3])
}

function ledger(backend) {
  return {
    balances: JSON.stringify(backend.spreadsheet.store.InventoryBalances || []),
    movements: (backend.spreadsheet.store.StockMovements || []).length,
  }
}

function at(data, slotId) {
  return data.slotOccupancies.find((row) => row.slotId === slotId) || null
}

const SOURCE = 'loc-rack-1-l3-front-1'
const OTHER = 'loc-rack-1-l3-front-2'
const EMPTY = 'loc-rack-1-l3-front-3'

function mapped(backend) {
  const loaded = call(backend, 'warehouse.get', { actorUserId: 'u-aina' })
  assert.equal(loaded.ok, true)
  return loaded.data
}

test('warehouse sheets stay unread until the module is called and Sheet1 stays reserved', () => {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(backend.spreadsheet.store.StorageLocations, undefined)
  assert.equal(backend.spreadsheet.store.SlotOccupancies, undefined)
  const health = call(backend, 'system.health', {})
  assert.equal(health.ok, true)
  assert.equal(backend.spreadsheet.store.StorageLocations, undefined)
  assert.deepEqual(backend.spreadsheet.store.Sheet1, [['']])
})

test('map read, seed bootstrap, and warehouse isolation', () => {
  const backend = ready()
  const denied = call(backend, 'warehouse.get', { actorUserId: 'u-mei' })
  assert.equal(denied.error.code, 'FORBIDDEN')
  assert.equal(denied.error.message, 'You do not have permission to view the warehouse map.')
  const inactive = call(backend, 'warehouse.get', { actorUserId: 'u-off' })
  assert.equal(inactive.error.code, 'FORBIDDEN')
  const empty = call(backend, 'warehouse.get', { actorUserId: 'u-aina' })
  assert.equal(empty.ok, true)
  assert.equal(empty.data.storageLocations.length, 0)
  assert.equal(empty.data.slotOccupancies.length, 0)

  const seeded = call(backend, 'warehouse.bootstrap', { actorUserId: 'u-aina' })
  assert.equal(seeded.ok, true)
  assert.equal(seeded.data.storageLocations.length, 5)
  assert.equal(seeded.data.storageSlots.length, 77)
  assert.equal(seeded.data.slotOccupancies.length, 4)
  assert.equal(seeded.data.displayStocks.length, 3)
  assert.equal(seeded.data.placementLogs.length, 7)
  assert.equal(seeded.data.productionBalances.length, 3)
  const carton = at(seeded.data, SOURCE)
  assert.equal(carton.productId, 'p-pack-st')
  assert.equal(carton.quantityPacks, 20)
  assert.equal(carton.batchRef, 'PROD-20260908-001')
  assert.equal(carton.productionSessionRef, 'PROD-20260908-001')
  assert.equal(seeded.data.storageLocations.find((row) => row.id === 'loc-display').active, false)
  assert.equal(seeded.data.storageLocations.find((row) => row.id === 'loc-balance').type, 'BALANCE_AREA')
  assert.equal(seeded.data.storageLocations.filter((row) => row.warehouseId === 'wh-shop').length, 0)
  assert.equal(seeded.data.storageLocations.filter((row) => row.warehouseId === 'wh-outlet').length, 0)
  assert.equal(seeded.data.slotOccupancies.filter((row) => row.slotId.startsWith('loc-display')).length, 0)

  const again = call(backend, 'warehouse.bootstrap', { actorUserId: 'u-aina' })
  assert.equal(again.error.code, 'CONFLICT')
  assert.equal(again.error.message, 'Warehouse map is already initialized.')
  assert.equal(backend.spreadsheet.store.StorageLocations.length, 6)
  assert.equal(backend.spreadsheet.store.SlotOccupancies.length, 5)
  assert.equal(backend.spreadsheet.store.StorageSlots.length, 78)
})

test('move copies placement metadata and leaves the inventory ledger unchanged', () => {
  const backend = ready()
  assert.equal(call(backend, 'warehouse.bootstrap', { actorUserId: 'u-aina' }).ok, true)
  const stocked = post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-pack', type: 'increase', qty: 40, reason: 'Found stock',
  })
  assert.equal(stocked.ok, true)
  const before = ledger(backend)
  const beforeAudits = auditActions(backend).filter((action) => action === 'warehouse.move').length
  const moved = post(backend, 'warehouse.move', {
    actorUserId: 'u-aina', fromSlotId: SOURCE, toSlotId: EMPTY, qty: 20,
  })
  assert.equal(moved.ok, true)
  assert.equal(at(moved.data, SOURCE), null)
  const dest = at(moved.data, EMPTY)
  assert.equal(dest.productId, 'p-pack-st')
  assert.equal(dest.quantityPacks, 20)
  assert.equal(dest.batchRef, 'PROD-20260908-001')
  assert.equal(dest.productionSessionRef, 'PROD-20260908-001')
  assert.notEqual(dest.id, 'occ-' + SOURCE)
  assert.deepEqual(ledger(backend), before)
  assert.equal(auditActions(backend).filter((action) => action === 'warehouse.move').length, beforeAudits + 1)
  const audit = backend.spreadsheet.store.AuditLogs[backend.spreadsheet.store.AuditLogs.length - 1]
  assert.equal(audit[2], 'u-aina')
  assert.equal(audit[3], 'warehouse.move')
  assert.equal(JSON.parse(audit[7]).slotId, SOURCE)
  assert.equal(JSON.parse(audit[8]).slotId, EMPTY)
  assert.equal(JSON.parse(audit[8]).quantityPacks, 20)
  assert.equal(JSON.parse(audit[8]).batchRef, 'PROD-20260908-001')
})

test('occupied, invalid, and cross-warehouse moves do not change placement or inventory', () => {
  const backend = ready()
  assert.equal(call(backend, 'warehouse.bootstrap', { actorUserId: 'u-aina' }).ok, true)
  const before = ledger(backend)
  const beforeMoveAudits = auditActions(backend).filter((action) => action === 'warehouse.move').length
  const snapshot = mapped(backend)
  const occupied = post(backend, 'warehouse.move', {
    actorUserId: 'u-aina', fromSlotId: SOURCE, toSlotId: OTHER, qty: 20,
  })
  assert.equal(occupied.error.message, 'Slot has another product')
  const missingSource = post(backend, 'warehouse.move', {
    actorUserId: 'u-aina', fromSlotId: 'loc-rack-1-l1-front-1', toSlotId: EMPTY, qty: 20,
  })
  assert.equal(missingSource.error.message, 'Choose valid positions')
  const missingDest = post(backend, 'warehouse.move', {
    actorUserId: 'u-aina', fromSlotId: SOURCE, toSlotId: 'missing-slot', qty: 20,
  })
  assert.equal(missingDest.error.message, 'Choose valid positions')
  const badQty = post(backend, 'warehouse.move', {
    actorUserId: 'u-aina', fromSlotId: SOURCE, toSlotId: EMPTY, qty: 0,
  })
  assert.equal(badQty.error.message, 'Enter a quantity')
  const tooMuch = post(backend, 'warehouse.move', {
    actorUserId: 'u-aina', fromSlotId: SOURCE, toSlotId: EMPTY, qty: 21,
  })
  assert.equal(tooMuch.error.message, 'Not enough in that position')
  const balanceDest = post(backend, 'warehouse.move', {
    actorUserId: 'u-aina', fromSlotId: SOURCE, toSlotId: 'loc-balance-l0-none-1', qty: 20,
  })
  assert.equal(balanceDest.error.message, 'Choose valid positions')
  const same = post(backend, 'warehouse.move', {
    actorUserId: 'u-aina', fromSlotId: SOURCE, toSlotId: SOURCE, qty: 20,
  })
  assert.equal(same.error.message, 'Choose a different position')
  const rack = post(backend, 'warehouse.createRack', {
    actorUserId: 'u-aina', name: 'Shop Rack', warehouseId: 'wh-shop', levels: 1, frontCount: 1, backCount: 0,
  })
  assert.equal(rack.ok, true)
  const shopLocation = rack.data.storageLocations.find((row) => row.name === 'Shop Rack')
  const shopSlot = rack.data.storageSlots.find((row) => row.locationId === shopLocation.id)
  const leaked = post(backend, 'warehouse.move', {
    actorUserId: 'u-aina', fromSlotId: SOURCE, toSlotId: shopSlot.id, qty: 20,
  })
  assert.equal(leaked.error.message, 'Choose valid positions')
  const after = mapped(backend)
  assert.equal(at(after, SOURCE).productId, 'p-pack-st')
  assert.equal(at(after, SOURCE).quantityPacks, 20)
  assert.equal(at(after, OTHER).productId, 'p-pack-mt')
  assert.equal(at(after, EMPTY), null)
  assert.equal(after.slotOccupancies.filter((row) => row.slotId === shopSlot.id).length, 0)
  assert.deepEqual(ledger(backend), before)
  assert.equal(auditActions(backend).filter((action) => action === 'warehouse.move').length, beforeMoveAudits)
  assert.deepEqual(snapshot.slotOccupancies, after.slotOccupancies)
})

test('same production reference can merge and a different reference cannot', () => {
  const backend = ready()
  assert.equal(call(backend, 'warehouse.bootstrap', { actorUserId: 'u-aina' }).ok, true)
  assert.equal(post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-pack', type: 'increase', qty: 40, reason: 'Found stock',
  }).ok, true)
  const first = post(backend, 'warehouse.place', {
    actorUserId: 'u-aina', slotId: 'loc-rack-2-l4-front-1', productId: 'prd-pack', qty: 20,
    batchRef: 'PROD-20260908-001', productionSessionRef: 'PROD-20260908-001',
  })
  const second = post(backend, 'warehouse.place', {
    actorUserId: 'u-aina', slotId: 'loc-rack-2-l4-front-2', productId: 'prd-pack', qty: 20,
    batchRef: 'PROD-20260909-001', productionSessionRef: 'PROD-20260909-001',
  })
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  const split = post(backend, 'warehouse.move', {
    actorUserId: 'u-aina', fromSlotId: 'loc-rack-2-l4-front-1', toSlotId: 'loc-rack-2-l4-front-2', qty: 20,
  })
  assert.equal(split.error.message, 'Keep cartons separate')
  assert.equal(at(mapped(backend), 'loc-rack-2-l4-front-1').quantityPacks, 20)
  assert.equal(at(mapped(backend), 'loc-rack-2-l4-front-2').quantityPacks, 20)

  const partial = post(backend, 'warehouse.move', {
    actorUserId: 'u-aina', fromSlotId: SOURCE, toSlotId: EMPTY, qty: 10,
  })
  assert.equal(partial.ok, true)
  assert.equal(at(partial.data, SOURCE).quantityPacks, 10)
  assert.equal(at(partial.data, SOURCE).batchRef, 'PROD-20260908-001')
  assert.equal(at(partial.data, EMPTY).quantityPacks, 10)
  assert.equal(at(partial.data, EMPTY).productionSessionRef, 'PROD-20260908-001')
  const merged = post(backend, 'warehouse.move', {
    actorUserId: 'u-aina', fromSlotId: SOURCE, toSlotId: EMPTY, qty: 10,
  })
  assert.equal(merged.ok, true)
  assert.equal(at(merged.data, SOURCE), null)
  assert.equal(at(merged.data, EMPTY).quantityPacks, 20)
  assert.equal(at(merged.data, EMPTY).batchRef, 'PROD-20260908-001')
  assert.equal(at(merged.data, EMPTY).productionSessionRef, 'PROD-20260908-001')
  assert.equal(merged.data.slotOccupancies.filter((row) => row.slotId === EMPTY).length, 1)
})

test('place rejects invalid product, quantity, occupancy, and unplaced stock without touching inventory', () => {
  const backend = ready()
  assert.equal(call(backend, 'warehouse.bootstrap', { actorUserId: 'u-aina' }).ok, true)
  const before = ledger(backend)
  const missingKey = call(backend, 'warehouse.place', {
    actorUserId: 'u-aina', slotId: EMPTY, productId: 'prd-pack', qty: 1,
  })
  assert.equal(missingKey.error.message, 'Idempotency key is required.')
  const missingProduct = post(backend, 'warehouse.place', {
    actorUserId: 'u-aina', slotId: EMPTY, productId: 'prd-missing', qty: 1,
  })
  assert.equal(missingProduct.error.message, 'Product was not found.')
  const badQty = post(backend, 'warehouse.place', {
    actorUserId: 'u-aina', slotId: EMPTY, productId: 'prd-pack', qty: -1,
  })
  assert.equal(badQty.error.message, 'Enter a quantity')
  const occupied = post(backend, 'warehouse.place', {
    actorUserId: 'u-aina', slotId: SOURCE, productId: 'prd-pack', qty: 1,
  })
  assert.equal(occupied.error.message, 'Slot occupied')
  const unplaced = post(backend, 'warehouse.place', {
    actorUserId: 'u-aina', slotId: EMPTY, productId: 'prd-pack', qty: 1,
  })
  assert.equal(unplaced.error.message, 'Not enough unplaced stock')
  const display = post(backend, 'warehouse.place', {
    actorUserId: 'u-aina', slotId: 'loc-display-l0-none-1', productId: 'prd-pack', qty: 1,
  })
  assert.equal(display.error.message, 'Choose a storage position')
  assert.equal(auditActions(backend).includes('warehouse.place'), false)
  assert.deepEqual(ledger(backend), before)
  assert.equal(at(mapped(backend), SOURCE).quantityPacks, 20)

  assert.equal(post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-pack', type: 'increase', qty: 20, reason: 'Found stock',
  }).ok, true)
  const stocked = ledger(backend)
  const placed = post(backend, 'warehouse.place', {
    actorUserId: 'u-aina', slotId: EMPTY, productId: 'prd-pack', qty: 20, batchRef: 'BATCH-1', productionSessionRef: 'PROD-20260910-001',
  })
  assert.equal(placed.ok, true)
  const row = at(placed.data, EMPTY)
  assert.equal(row.productId, 'prd-pack')
  assert.equal(row.quantityPacks, 20)
  assert.equal(row.batchRef, 'BATCH-1')
  assert.equal(row.productionSessionRef, 'PROD-20260910-001')
  assert.deepEqual(ledger(backend), stocked)
  assert.equal(auditActions(backend).includes('warehouse.place'), true)
})

test('permissions, inactive actors, idempotency, and lock failure', () => {
  const backend = ready()
  assert.equal(call(backend, 'warehouse.bootstrap', { actorUserId: 'u-aina' }).ok, true)
  const staff = post(backend, 'warehouse.move', {
    actorUserId: 'u-mei', fromSlotId: SOURCE, toSlotId: EMPTY, qty: 20,
  })
  assert.equal(staff.error.message, 'You cannot move warehouse stock.')
  const inactive = post(backend, 'warehouse.move', {
    actorUserId: 'u-off', fromSlotId: SOURCE, toSlotId: EMPTY, qty: 20,
  })
  assert.equal(inactive.error.code, 'FORBIDDEN')
  const agent = post(backend, 'warehouse.createTemporary', {
    actorUserId: 'u-aina', name: 'Agent Floor', type: 'FLOOR', warehouseId: 'wh-agent', slotCount: 1,
  })
  assert.equal(agent.error.message, 'Agent warehouses cannot have storage locations')
  assert.equal(auditActions(backend).includes('warehouse.move'), false)

  grant(backend, 'warehouse_map.move')
  const key = 'move-once'
  const first = post(backend, 'warehouse.move', {
    actorUserId: 'u-mei', fromSlotId: SOURCE, toSlotId: EMPTY, qty: 20,
  }, { idempotencyKey: key })
  assert.equal(first.ok, true)
  const replay = post(backend, 'warehouse.move', {
    actorUserId: 'u-mei', fromSlotId: SOURCE, toSlotId: EMPTY, qty: 20,
  }, { idempotencyKey: key })
  assert.equal(replay.ok, true)
  assert.equal(replay.meta.idempotentReplay, true)
  assert.equal(replay.data.slotOccupancies.filter((row) => row.slotId === EMPTY).length, 1)
  assert.equal(at(replay.data, SOURCE), null)
  assert.equal(auditActions(backend).filter((action) => action === 'warehouse.move').length, 1)

  const second = post(backend, 'warehouse.move', {
    actorUserId: 'u-mei', fromSlotId: SOURCE, toSlotId: 'loc-rack-1-l2-front-1', qty: 20,
  })
  assert.equal(second.error.message, 'Choose valid positions')
  assert.equal(at(mapped(backend), EMPTY).quantityPacks, 20)
})

test('a lock failure does not move the carton', () => {
  let open = true
  const backend = app(() => open)
  backend.foundation.initialize()
  assert.equal(call(backend, 'identity.bootstrap', identityPayload()).ok, true)
  assert.equal(call(backend, 'masters.bootstrap', masterPayload()).ok, true)
  assert.equal(call(backend, 'warehouse.bootstrap', { actorUserId: 'u-aina' }).ok, true)
  const before = JSON.stringify(backend.spreadsheet.store.SlotOccupancies)
  open = false
  const denied = post(backend, 'warehouse.move', {
    actorUserId: 'u-aina', fromSlotId: SOURCE, toSlotId: EMPTY, qty: 20,
  })
  assert.equal(denied.error.code, 'CONFLICT')
  assert.equal(denied.error.message, 'The request could not get a lock in time.')
  assert.equal(JSON.stringify(backend.spreadsheet.store.SlotOccupancies), before)
  assert.equal(auditActions(backend).includes('warehouse.move'), false)
})

test('top up, empty, and balance use do not post inventory movements', () => {
  const backend = ready()
  assert.equal(call(backend, 'warehouse.bootstrap', { actorUserId: 'u-aina' }).ok, true)
  assert.equal(post(backend, 'inventory.adjust', {
    actorUserId: 'u-aina', warehouseId: 'wh-main', productId: 'prd-pack', type: 'increase', qty: 5, reason: 'Found stock',
  }).ok, true)
  const before = ledger(backend)
  const topped = post(backend, 'warehouse.topUp', {
    actorUserId: 'u-aina', fromSlotId: SOURCE, qty: 5,
  })
  assert.equal(topped.ok, true)
  assert.equal(at(topped.data, SOURCE).quantityPacks, 15)
  assert.equal(at(topped.data, SOURCE).batchRef, 'PROD-20260908-001')
  assert.equal(topped.data.displayStocks.find((row) => row.productId === 'p-pack-st').qty, 10)
  const emptied = post(backend, 'warehouse.empty', {
    actorUserId: 'u-aina', slotId: 'loc-rack-1-l4-back-3',
  })
  assert.equal(emptied.ok, true)
  assert.equal(at(emptied.data, 'loc-rack-1-l4-back-3'), null)
  const used = post(backend, 'warehouse.useBalance', {
    actorUserId: 'u-aina', balanceId: 'pb-st-1', qty: 10, reason: 'Sample', notes: 'UAT',
  })
  assert.equal(used.ok, true)
  const balance = used.data.productionBalances.find((row) => row.id === 'pb-st-1')
  assert.equal(balance.quantity, 857)
  assert.equal(balance.productionReference, 'PROD-20260908-001')
  assert.equal(balance.status, 'available')
  assert.equal(used.data.balanceUsageLogs[0].quantity, 10)
  assert.deepEqual(ledger(backend), before)
  const blocked = post(backend, 'warehouse.deactivate', { actorUserId: 'u-aina', id: 'loc-rack-1' })
  assert.equal(blocked.error.message, 'Location still has stock')
  assert.equal(mapped(backend).storageLocations.find((row) => row.id === 'loc-rack-1').active, true)
})
