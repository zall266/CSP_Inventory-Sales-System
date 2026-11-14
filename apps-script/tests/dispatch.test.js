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
    products: context.createProductService({ sheetRepository: sheets }),
    parties: context.createPartyService({ sheetRepository: sheets }),
    inventory: context.createInventoryService({ sheetRepository: sheets }),
    sales: context.createSalesService({ sheetRepository: sheets }),
    salesImport: context.createSalesImportService({ sheetRepository: sheets }),
    dispatch: context.createDispatchService({ sheetRepository: sheets }),
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
    idempotencyKey: extra.idempotencyKey || `dsp-${keySeq}`,
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

function ready() {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(call(backend, 'identity.bootstrap', identityPayload()).ok, true)
  assert.equal(call(backend, 'masters.bootstrap', {
    warehouses: [
      { id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', kind: 'company' },
    ],
    categories: [{ id: 'cat-pack', name: 'Packs' }],
  }).ok, true)
  return backend
}

function seedShipment(backend, row) {
  const repo = backend.context.createSalesImportRepository(backend.sheets)
  const existing = repo.readShipments(backend.spreadsheet)
  repo.writeShipments(backend.spreadsheet, existing.concat([{
    platform: 'shopee',
    accountId: 'sia_test',
    batchId: 'sib_test',
    courierText: row.courierKey || 'SPX',
    sourceFileId: 'sif_test',
    linkStatus: 'pending',
    packingLines: [],
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
    ...row,
  }]))
}

function qtySum(data) {
  return (data.inventory || []).reduce((sum, row) => sum + Number(row.qty || 0), 0)
}

test('health does not create dispatch sheets and Sheet1 stays reserved', () => {
  const backend = app()
  backend.foundation.initialize()
  const health = call(backend, 'system.health', {})
  assert.equal(health.ok, true)
  assert.equal(backend.spreadsheet.store.Vehicles, undefined)
  assert.equal(backend.spreadsheet.store.Dispatches, undefined)
  assert.equal(backend.spreadsheet.store.DispatchLines, undefined)
  assert.equal(backend.spreadsheet.store.InspectionGroups, undefined)
  assert.ok(backend.spreadsheet.store.Sheet1)
})

test('staff cannot maintain vehicles or create a dispatch', () => {
  const backend = ready()
  const vehicle = call(backend, 'vehicles.create', {
    actorUserId: 'u-siti',
    code: 'V001',
    vehicleType: 'LORI',
    plateNumber: 'WWW 1234',
  })
  assert.equal(vehicle.error.code, 'FORBIDDEN')
  assert.equal(vehicle.error.message, 'You cannot maintain vehicles.')
  const created = call(backend, 'dispatch.create', {
    actorUserId: 'u-mei',
    dispatchDate: '2026-11-12',
  })
  assert.equal(created.error.code, 'FORBIDDEN')
  assert.equal(created.error.message, 'You cannot create a dispatch.')
})

test('confirm snapshots the vehicle, posts no stock, and rejects a second claim on the shipment', () => {
  const backend = ready()
  const vehicle = call(backend, 'vehicles.create', {
    actorUserId: 'u-aina',
    clientId: 'veh_v001',
    code: 'V001',
    vehicleType: 'LORI',
    plateNumber: 'WWW 1234',
  })
  assert.equal(vehicle.ok, true, vehicle.error && vehicle.error.message)
  const other = call(backend, 'vehicles.create', {
    actorUserId: 'u-aina',
    clientId: 'veh_v002',
    code: 'V002',
    vehicleType: 'VAN',
    plateNumber: 'ABC 8888',
  })
  assert.equal(other.ok, true)
  seedShipment(backend, { id: 'shp_1', externalOrderId: 'A1', trackingNumber: 'SPX111', courierKey: 'SPX' })
  seedShipment(backend, { id: 'shp_2', externalOrderId: 'A2', trackingNumber: 'GDX222', courierKey: 'GDEX' })
  const draft = call(backend, 'dispatch.create', {
    actorUserId: 'u-aina',
    clientId: 'dsp_1',
    dispatchDate: '2026-11-12',
    vehicleId: 'veh_v001',
  })
  assert.equal(draft.ok, true, draft.error && draft.error.message)
  assert.equal(draft.data.dispatch.status, 'draft')
  assert.equal(draft.data.dispatch.vehicleCode, '')
  const saved = call(backend, 'dispatch.update', {
    actorUserId: 'u-aina',
    id: 'dsp_1',
    lines: [{ shipmentId: 'shp_1', courierKey: 'SPX', parcelQty: 2 }],
  })
  assert.equal(saved.ok, true, saved.error && saved.error.message)
  const beforeMoves = (saved.data.stockMovements || []).length
  const beforeQty = qtySum(saved.data)
  const missingKey = call(backend, 'dispatch.confirm', { actorUserId: 'u-aina', id: 'dsp_1' })
  assert.equal(missingKey.error.code, 'VALIDATION_ERROR')
  assert.equal(missingKey.error.message, 'Idempotency key is required.')
  const confirmed = post(backend, 'dispatch.confirm', { actorUserId: 'u-aina', id: 'dsp_1' }, { idempotencyKey: 'confirm-1' })
  assert.equal(confirmed.ok, true, confirmed.error && confirmed.error.message)
  assert.equal(confirmed.data.dispatch.status, 'confirmed')
  assert.equal(confirmed.data.dispatch.vehicleCode, 'V001')
  assert.equal(confirmed.data.dispatch.condition, 'BAIK')
  assert.equal(confirmed.data.dispatch.lines[0].trackingNumber, 'SPX111')
  assert.equal((confirmed.data.stockMovements || []).length, beforeMoves)
  assert.equal(qtySum(confirmed.data), beforeQty)
  const replay = post(backend, 'dispatch.confirm', { actorUserId: 'u-aina', id: 'dsp_1' }, { idempotencyKey: 'confirm-1' })
  assert.equal(replay.ok, true)
  assert.equal(replay.meta.idempotentReplay, true)
  const locked = post(backend, 'dispatch.confirm', { actorUserId: 'u-aina', id: 'dsp_1' }, { idempotencyKey: 'confirm-2' })
  assert.equal(locked.ok, false)
  assert.equal(locked.error.message, 'Confirmed dispatch is locked')
  const second = call(backend, 'dispatch.create', {
    actorUserId: 'u-aina',
    clientId: 'dsp_2',
    dispatchDate: '2026-11-12',
    vehicleId: 'veh_v002',
  })
  assert.equal(second.ok, true)
  const steal = call(backend, 'dispatch.update', {
    actorUserId: 'u-aina',
    id: 'dsp_2',
    lines: [{ shipmentId: 'shp_1', courierKey: 'GDEX', parcelQty: 1 }],
  })
  assert.equal(steal.ok, false)
  assert.equal(steal.error.message, 'That shipment is already on a confirmed dispatch.')
  const otherLine = call(backend, 'dispatch.update', {
    actorUserId: 'u-aina',
    id: 'dsp_2',
    lines: [{ shipmentId: 'shp_2', courierKey: 'GDEX', parcelQty: 4 }],
  })
  assert.equal(otherLine.ok, true, otherLine.error && otherLine.error.message)
  const secondConfirm = post(backend, 'dispatch.confirm', { actorUserId: 'u-aina', id: 'dsp_2' })
  assert.equal(secondConfirm.ok, true, secondConfirm.error && secondConfirm.error.message)
})

test('void releases the shipment and inactive vehicles cannot be confirmed', () => {
  const backend = ready()
  call(backend, 'vehicles.create', {
    actorUserId: 'u-aina', clientId: 'veh_a', code: 'VA', vehicleType: 'LORI', plateNumber: 'AAA 1111',
  })
  call(backend, 'vehicles.create', {
    actorUserId: 'u-aina', clientId: 'veh_b', code: 'VB', vehicleType: 'VAN', plateNumber: 'BBB 2222',
  })
  seedShipment(backend, { id: 'shp_free', externalOrderId: 'B1', trackingNumber: 'POS1', courierKey: 'POS' })
  const draft = call(backend, 'dispatch.create', {
    actorUserId: 'u-aina', clientId: 'dsp_void', dispatchDate: '2026-11-12', vehicleId: 'veh_a',
  })
  assert.equal(draft.ok, true)
  assert.equal(call(backend, 'dispatch.update', {
    actorUserId: 'u-aina',
    id: 'dsp_void',
    lines: [{ shipmentId: 'shp_free', courierKey: 'POS', parcelQty: 1 }],
  }).ok, true)
  assert.equal(post(backend, 'dispatch.confirm', { actorUserId: 'u-aina', id: 'dsp_void' }).ok, true)
  const voided = post(backend, 'dispatch.void', { actorUserId: 'u-aina', id: 'dsp_void' }, { idempotencyKey: 'void-1' })
  assert.equal(voided.ok, true, voided.error && voided.error.message)
  assert.equal(voided.data.dispatch.status, 'void')
  const replay = post(backend, 'dispatch.void', { actorUserId: 'u-aina', id: 'dsp_void' }, { idempotencyKey: 'void-1' })
  assert.equal(replay.meta.idempotentReplay, true)
  const reused = call(backend, 'dispatch.create', {
    actorUserId: 'u-aina', clientId: 'dsp_reuse', dispatchDate: '2026-11-20', vehicleId: 'veh_b',
  })
  assert.equal(reused.ok, true)
  const saved = call(backend, 'dispatch.update', {
    actorUserId: 'u-aina',
    id: 'dsp_reuse',
    lines: [{ shipmentId: 'shp_free', courierKey: 'POS', parcelQty: 1 }],
  })
  assert.equal(saved.ok, true, saved.error && saved.error.message)
  assert.equal(post(backend, 'dispatch.confirm', { actorUserId: 'u-aina', id: 'dsp_reuse' }).ok, true)
  call(backend, 'vehicles.setActive', { actorUserId: 'u-aina', id: 'veh_a', active: false })
  const blocked = call(backend, 'dispatch.create', {
    actorUserId: 'u-aina', dispatchDate: '2026-11-21', vehicleId: 'veh_a',
  })
  assert.equal(blocked.error.message, 'Choose an active vehicle')
  const duplicate = call(backend, 'vehicles.create', {
    actorUserId: 'u-aina', code: 'va', vehicleType: 'LORI', plateNumber: 'CCC 3333',
  })
  assert.equal(duplicate.error.message, 'Vehicle code already exists')
})

test('inspection groups number IG-0001, reject courier overlap, and release clears membership', () => {
  const backend = ready()
  call(backend, 'vehicles.create', {
    actorUserId: 'u-aina', clientId: 'veh_g1', code: 'G1', vehicleType: 'LORI', plateNumber: 'GGG 1111',
  })
  call(backend, 'vehicles.create', {
    actorUserId: 'u-aina', clientId: 'veh_g2', code: 'G2', vehicleType: 'VAN', plateNumber: 'GGG 2222',
  })
  seedShipment(backend, { id: 'shp_jnt', externalOrderId: 'J1', trackingNumber: 'JNT1', courierKey: 'JNT' })
  seedShipment(backend, { id: 'shp_spx', externalOrderId: 'S1', trackingNumber: 'SPX1', courierKey: 'SPX' })
  seedShipment(backend, { id: 'shp_jnt2', externalOrderId: 'J2', trackingNumber: 'JNT2', courierKey: 'JNT' })
  function confirmOne(id, vehicleId, shipmentId, courierKey) {
    assert.equal(call(backend, 'dispatch.create', {
      actorUserId: 'u-aina', clientId: id, dispatchDate: '2026-11-12', vehicleId,
    }).ok, true)
    assert.equal(call(backend, 'dispatch.update', {
      actorUserId: 'u-aina', id, lines: [{ shipmentId, courierKey, parcelQty: 1 }],
    }).ok, true)
    const confirmed = post(backend, 'dispatch.confirm', { actorUserId: 'u-aina', id })
    assert.equal(confirmed.ok, true, confirmed.error && confirmed.error.message)
  }
  confirmOne('dsp_jnt', 'veh_g1', 'shp_jnt', 'JNT')
  confirmOne('dsp_spx', 'veh_g2', 'shp_spx', 'SPX')
  const missingKey = call(backend, 'dispatch.createInspectionGroup', {
    actorUserId: 'u-aina',
    dispatchIds: ['dsp_jnt', 'dsp_spx'],
  })
  assert.equal(missingKey.error.message, 'Idempotency key is required.')
  const group = post(backend, 'dispatch.createInspectionGroup', {
    actorUserId: 'u-aina',
    clientId: 'ig_1',
    dispatchIds: ['dsp_jnt', 'dsp_spx'],
  }, { idempotencyKey: 'ig-1' })
  assert.equal(group.ok, true, group.error && group.error.message)
  assert.equal(group.data.group.groupNo, 'IG-0001')
  assert.equal(group.data.group.status, 'confirmed')
  const jnt = group.data.dispatches.find((row) => row.id === 'dsp_jnt')
  assert.equal(jnt.inspectionGroupId, 'ig_1')
  const again = post(backend, 'dispatch.createInspectionGroup', {
    actorUserId: 'u-aina',
    dispatchIds: ['dsp_jnt', 'dsp_spx'],
  }, { idempotencyKey: 'ig-1' })
  assert.equal(again.meta.idempotentReplay, true)
  call(backend, 'vehicles.create', {
    actorUserId: 'u-aina', clientId: 'veh_g3', code: 'G3', vehicleType: 'VAN', plateNumber: 'GGG 3333',
  })
  confirmOne('dsp_jnt2', 'veh_g3', 'shp_jnt2', 'JNT')
  const alreadyGrouped = post(backend, 'dispatch.createInspectionGroup', {
    actorUserId: 'u-aina',
    dispatchIds: ['dsp_jnt', 'dsp_jnt2'],
  })
  assert.equal(alreadyGrouped.ok, false)
  assert.equal(alreadyGrouped.error.message, 'That dispatch is already in an inspection group.')
  const released = post(backend, 'dispatch.release', { actorUserId: 'u-aina', id: 'ig_1' }, { idempotencyKey: 'ig-rel' })
  assert.equal(released.ok, true, released.error && released.error.message)
  assert.equal(released.data.group.status, 'released')
  const cleared = released.data.dispatches.find((row) => row.id === 'dsp_jnt')
  assert.equal(cleared.inspectionGroupId, undefined)
  const overlap = post(backend, 'dispatch.createInspectionGroup', {
    actorUserId: 'u-aina',
    dispatchIds: ['dsp_jnt', 'dsp_jnt2'],
  })
  assert.equal(overlap.ok, false)
  assert.match(overlap.error.message, /Courier JNT already exists/)
})

test('draft update removes the shipment from other drafts and empty confirm is allowed', () => {
  const backend = ready()
  call(backend, 'vehicles.create', {
    actorUserId: 'u-aina', clientId: 'veh_d1', code: 'D1', vehicleType: 'LORI', plateNumber: 'DDD 1111',
  })
  seedShipment(backend, { id: 'shp_shared', externalOrderId: 'C1', trackingNumber: 'FLASH1', courierKey: 'FLASH' })
  call(backend, 'dispatch.create', {
    actorUserId: 'u-aina', clientId: 'dsp_a', dispatchDate: '2026-11-12', vehicleId: 'veh_d1',
  })
  call(backend, 'dispatch.create', {
    actorUserId: 'u-aina', clientId: 'dsp_b', dispatchDate: '2026-11-12', vehicleId: 'veh_d1',
  })
  assert.equal(call(backend, 'dispatch.update', {
    actorUserId: 'u-aina',
    id: 'dsp_a',
    lines: [{ shipmentId: 'shp_shared', courierKey: 'FLASH', parcelQty: 1 }],
  }).ok, true)
  const stolen = call(backend, 'dispatch.update', {
    actorUserId: 'u-aina',
    id: 'dsp_b',
    lines: [{ shipmentId: 'shp_shared', courierKey: 'FLASH', parcelQty: 3 }],
  })
  assert.equal(stolen.ok, true, stolen.error && stolen.error.message)
  const first = stolen.data.dispatches.find((row) => row.id === 'dsp_a')
  assert.equal(first.lines.length, 0)
  const empty = post(backend, 'dispatch.confirm', { actorUserId: 'u-aina', id: 'dsp_a' })
  assert.equal(empty.ok, true, empty.error && empty.error.message)
  assert.equal(empty.data.dispatch.status, 'confirmed')
  assert.equal(empty.data.dispatch.lines.length, 0)
})
