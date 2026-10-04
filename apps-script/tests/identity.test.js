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
  const resolved = {
    sheets,
    drive,
    spreadsheet,
    context,
    system: context.createSystemService({ sheetRepository: sheets, driveStorage }),
    idempotency: context.createIdempotencyService(sheets),
    foundation: context.createFoundationService(sheets),
    identity: context.createIdentityService({ sheetRepository: sheets, driveStorage }),
  }
  return resolved
}

function request(action, payload, extra = {}) {
  return { v: 1, requestId: extra.requestId || action, action, payload, idempotencyKey: extra.idempotencyKey }
}

function settings() {
  return {
    businessName: 'Cool Slurppy',
    legalName: 'Cool Slurppy Sdn Bhd',
    logoUrl: '',
    phone: '03',
    email: 'hello@coolslurppy.my',
    address: 'KL',
    website: '',
    registrationNo: '',
    bankName: '',
    bankAccount: '',
    paymentTerms: 'Net 7 days',
    documentTerms: 'Terms',
    currency: 'MYR',
    defaultWarehouseId: 'wh-main',
    allowNegativeStock: false,
    costingMethod: 'average',
    batchTracking: true,
    expiryTracking: true,
    defaultCustomerId: 'c-walkin',
    allowDiscount: true,
    allowReturns: true,
    enabledPaymentMethods: ['cash', 'card'],
    roleMatrix: {},
  }
}

function bootstrapPayload() {
  return {
    departments: [
      { id: 'dept-sales', name: 'Sales', status: 'active' },
      { id: 'dept-management', name: 'Management', status: 'active' },
    ],
    roles: [
      { id: 'role-owner', name: 'Owner', description: 'Full system access. Protected account.', status: 'active', protected: true, legacyRole: 'owner', createdAt: '2026-08-01T01:15:00.000Z', updatedAt: '2026-08-01T01:15:00.000Z' },
      { id: 'role-staff', name: 'Staff', description: 'Day-to-day operations.', status: 'active', protected: false, legacyRole: 'staff', createdAt: '2026-08-01T01:15:00.000Z', updatedAt: '2026-08-01T01:15:00.000Z' },
    ],
    users: [
      { id: 'u-aina', name: 'Aina Rahman', email: 'aina@coolslurppy.my', roleId: 'role-owner', departmentId: 'dept-management', status: 'active', lastLogin: 'Never' },
      { id: 'u-mei', name: 'Mei Ling', email: 'mei@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales', status: 'active', lastLogin: 'Never' },
    ],
    settings: settings(),
    userAuditLogs: [],
  }
}

function ready() {
  const backend = app()
  backend.foundation.initialize()
  const boot = backend.context.handleRequest(request('identity.bootstrap', bootstrapPayload()), backend)
  assert.equal(boot.ok, true)
  return backend
}

test('permission keys match the locked frontend vocabulary', () => {
  const source = fs.readFileSync(path.join(root, 'src/features/settings/permissions.ts'), 'utf8')
  const match = source.match(/export const PERMISSION_KEYS: PermissionKey\[] = \[([\s\S]*?)\]/)
  assert.ok(match)
  const keys = [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
  const context = loadBackend()
  assert.equal([...context.PERMISSION_KEYS].join('|'), keys.join('|'))
})

test('identity reads do not run before the module is called and Sheet1 stays reserved', () => {
  const backend = app()
  const health = backend.context.handleRequest(request('system.health', {}), backend)
  assert.equal(health.ok, true)
  assert.equal(backend.spreadsheet.store.Users, undefined)
  assert.deepEqual(backend.spreadsheet.store.Sheet1, [['']])
  const unknown = backend.context.handleRequest(request('sales.create', {}), backend)
  assert.equal(unknown.error.code, 'UNKNOWN_ACTION')
})

test('bootstrap persists identity once and rejects a second copy', () => {
  const backend = ready()
  assert.equal(backend.spreadsheet.store.Users.length, 3)
  assert.equal(backend.spreadsheet.store.Roles[1][0], 'role-owner')
  assert.equal(backend.spreadsheet.store.Settings[1][0], 'settings')
  assert.deepEqual(backend.spreadsheet.store.Sheet1, [['']])
  const again = backend.context.handleRequest(request('identity.bootstrap', bootstrapPayload(), { requestId: 'boot-2' }), backend)
  assert.equal(again.ok, false)
  assert.equal(again.error.code, 'CONFLICT')
  assert.equal(again.error.message, 'Identity is already initialized.')
  assert.equal(backend.spreadsheet.store.Users.length, 3)
  const loaded = backend.context.handleRequest(request('identity.get', {}), backend)
  assert.equal(loaded.data.empty, false)
  assert.equal(loaded.data.users[0].email, 'aina@coolslurppy.my')
  assert.equal(loaded.data.users[0].role, 'owner')
  assert.equal(loaded.data.departments.length, 2)
})

test('owner keeps full access and staff cannot create a user', () => {
  const backend = ready()
  const denied = backend.context.handleRequest(request('users.create', {
    actorUserId: 'u-mei',
    name: 'New Staff',
    email: 'new@coolslurppy.my',
    roleId: 'role-staff',
    departmentId: 'dept-sales',
  }), backend)
  assert.equal(denied.error.code, 'FORBIDDEN')
  assert.equal(denied.error.message, 'You cannot add users.')
  const created = backend.context.handleRequest(request('users.create', {
    actorUserId: 'u-aina',
    id: 'u-new',
    name: 'New Staff',
    email: 'New@CoolSlurppy.my',
    roleId: 'role-staff',
    departmentId: 'dept-sales',
  }), backend)
  assert.equal(created.ok, true)
  assert.equal(created.data.users[0].id, 'u-new')
  assert.equal(created.data.users[0].email, 'new@coolslurppy.my')
  assert.equal(created.data.users[0].role, 'staff')
  assert.equal(created.data.userAuditLogs[0].action, 'user_created')
  assert.equal(created.data.userAuditLogs[0].changedBy, 'Aina Rahman')
  const auditRows = backend.spreadsheet.store.AuditLogs.map((row) => row[3])
  assert.ok(auditRows.includes('users.create'))
  const duplicate = backend.context.handleRequest(request('users.create', {
    actorUserId: 'u-aina',
    name: 'Other',
    email: 'new@coolslurppy.my',
    roleId: 'role-staff',
    departmentId: 'dept-sales',
  }, { requestId: 'dup-email' }), backend)
  assert.equal(duplicate.error.code, 'VALIDATION_ERROR')
  assert.equal(duplicate.error.message, 'Email already in use')
})

test('user validation, not found, self deactivation, and last owner are enforced', () => {
  const backend = ready()
  const missingName = backend.context.handleRequest(request('users.create', {
    actorUserId: 'u-aina', name: ' ', email: '', roleId: 'role-staff', departmentId: 'dept-sales',
  }), backend)
  assert.equal(missingName.error.message, 'Name and email are required')
  const missingDepartment = backend.context.handleRequest(request('users.create', {
    actorUserId: 'u-aina', name: 'Nur', email: 'nur@coolslurppy.my', roleId: 'role-staff', departmentId: 'missing',
  }), backend)
  assert.equal(missingDepartment.error.message, 'Department is required')
  const missingUser = backend.context.handleRequest(request('users.update', {
    actorUserId: 'u-aina', id: 'missing', patch: { name: 'Nope' },
  }), backend)
  assert.equal(missingUser.error.code, 'NOT_FOUND')
  const self = backend.context.handleRequest(request('users.update', {
    actorUserId: 'u-aina', id: 'u-aina', patch: { status: 'inactive' },
  }), backend)
  assert.equal(self.error.code, 'FORBIDDEN')
  assert.equal(self.error.message, 'You cannot deactivate this user.')
  const roleChange = backend.context.handleRequest(request('users.update', {
    actorUserId: 'u-aina', id: 'u-aina', patch: { roleId: 'role-staff' },
  }), backend)
  assert.equal(roleChange.error.message, 'You cannot change that user\'s role.')
  const renamed = backend.context.handleRequest(request('users.update', {
    actorUserId: 'u-aina', id: 'u-mei', patch: { name: 'Mei Tan' },
  }), backend)
  assert.equal(renamed.ok, true)
  assert.equal(renamed.data.users.find((user) => user.id === 'u-mei').name, 'Mei Tan')
  assert.equal(renamed.data.userAuditLogs[0].field, 'name')
  const noop = backend.context.handleRequest(request('users.update', {
    actorUserId: 'u-aina', id: 'u-mei', patch: { name: 'Mei Tan' },
  }, { requestId: 'noop' }), backend)
  assert.equal(noop.ok, true)
  assert.equal(noop.data.userAuditLogs.length, renamed.data.userAuditLogs.length)
})

test('roles, owner protection, and permission rows persist', () => {
  const backend = ready()
  const denied = backend.context.handleRequest(request('roles.create', {
    actorUserId: 'u-mei', name: 'Picker', description: 'Picks orders',
  }), backend)
  assert.equal(denied.error.message, 'You cannot create roles.')
  const created = backend.context.handleRequest(request('roles.create', {
    actorUserId: 'u-aina', id: 'role-picker', name: 'Picker', description: 'Picks orders',
  }), backend)
  assert.equal(created.ok, true)
  assert.equal(created.data.roles.at(-1).legacyRole, 'staff')
  assert.equal(created.data.roles.at(-1).protected, false)
  assert.equal(created.data.settings.roleMatrix['role-picker']['dashboard.view'], false)
  const duplicate = backend.context.handleRequest(request('roles.create', {
    actorUserId: 'u-aina', name: 'picker', description: '',
  }, { requestId: 'dup-role' }), backend)
  assert.equal(duplicate.error.message, 'Role name already exists')
  const renameOwner = backend.context.handleRequest(request('roles.update', {
    actorUserId: 'u-aina', id: 'role-owner', patch: { name: 'Super Owner' },
  }), backend)
  assert.equal(renameOwner.error.message, 'The Owner role cannot be renamed.')
  const deactivateOwner = backend.context.handleRequest(request('roles.setStatus', {
    actorUserId: 'u-aina', id: 'role-owner', status: 'inactive',
  }), backend)
  assert.equal(deactivateOwner.error.message, 'You cannot deactivate this role.')
  const reduceOwner = backend.context.handleRequest(request('roles.savePermissions', {
    actorUserId: 'u-aina', roleId: 'role-owner', permissions: { 'dashboard.view': true },
  }), backend)
  assert.equal(reduceOwner.error.message, 'Owner always has full access. Permissions cannot be reduced.')
  const saved = backend.context.handleRequest(request('roles.savePermissions', {
    actorUserId: 'u-aina', roleId: 'role-picker', permissions: { 'dashboard.view': true, 'users.create': false },
  }), backend)
  assert.equal(saved.ok, true)
  assert.equal(saved.data.settings.roleMatrix['role-picker']['dashboard.view'], true)
  assert.equal(saved.data.settings.roleMatrix['role-picker']['users.create'], false)
  assert.equal(saved.data.userAuditLogs[0].action, 'role_permissions_changed')
  assert.equal(saved.data.userAuditLogs[0].newValue, 'ON')
  const row = backend.spreadsheet.store.RolePermissions.find((item) => item[0] === 'role-picker' && item[1] === 'dashboard.view')
  assert.equal(row[2], true)
  const missingRole = backend.context.handleRequest(request('roles.update', {
    actorUserId: 'u-aina', id: 'missing', patch: { name: 'Nope' },
  }), backend)
  assert.equal(missingRole.error.code, 'NOT_FOUND')
  const deactivated = backend.context.handleRequest(request('roles.setStatus', {
    actorUserId: 'u-aina', id: 'role-picker', status: 'inactive',
  }), backend)
  assert.equal(deactivated.data.roles.find((role) => role.id === 'role-picker').status, 'inactive')
  const ownerStill = backend.context.handleRequest(request('users.create', {
    actorUserId: 'u-aina', name: 'After Matrix', email: 'after@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales',
  }, { requestId: 'after-matrix' }), backend)
  assert.equal(ownerStill.ok, true)
})

test('settings update does not require settings.edit and keeps the permission matrix', () => {
  const backend = ready()
  const before = backend.spreadsheet.store.RolePermissions.length
  const updated = backend.context.handleRequest(request('settings.update', {
    actorUserId: 'u-mei',
    patch: { businessName: 'Cool Slurppy Updated', costingMethod: 'fifo', allowDiscount: false },
  }), backend)
  assert.equal(updated.ok, true)
  assert.equal(updated.data.settings.businessName, 'Cool Slurppy Updated')
  assert.equal(updated.data.settings.costingMethod, 'fifo')
  assert.equal(updated.data.settings.allowDiscount, false)
  assert.equal(updated.data.settings.currency, 'MYR')
  assert.equal(backend.spreadsheet.store.RolePermissions.length, before)
  const bad = backend.context.handleRequest(request('settings.update', {
    actorUserId: 'u-mei', patch: { costingMethod: 'lifo' },
  }, { requestId: 'bad-cost' }), backend)
  assert.equal(bad.error.code, 'VALIDATION_ERROR')
  assert.equal(bad.error.message, 'Costing method is not valid.')
  const reread = backend.context.handleRequest(request('settings.get', {}), backend)
  assert.equal(reread.data.settings.businessName, 'Cool Slurppy Updated')
  assert.equal(reread.data.settings.costingMethod, 'fifo')
})

test('company logo is stored under the existing Drive root and read back as a data URL', () => {
  const backend = ready()
  const logo = `data:image/png;base64,${Buffer.from([1, 2, 3, 4]).toString('base64')}`
  const updated = backend.context.handleRequest(request('settings.update', {
    actorUserId: 'u-aina', patch: { logoUrl: logo },
  }), backend)
  assert.equal(updated.ok, true)
  assert.equal(updated.data.settings.logoUrl, logo)
  assert.equal(backend.spreadsheet.store.Settings[1][3], '')
  assert.ok(backend.spreadsheet.store.Settings[1][4])
  assert.deepEqual(backend.drive.created, ['CompanyLogo'])
  const bad = backend.context.handleRequest(request('settings.update', {
    actorUserId: 'u-aina', patch: { logoUrl: 'data:text/plain;base64,QQ==' },
  }, { requestId: 'bad-logo' }), backend)
  assert.equal(bad.error.message, 'Use a PNG, JPG, WebP or SVG image.')
  const oversized = `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')}`
  const tooBig = backend.context.handleRequest(request('settings.update', {
    actorUserId: 'u-aina', patch: { logoUrl: oversized },
  }, { requestId: 'big-logo' }), backend)
  assert.equal(tooBig.error.message, 'Logo must be 5 MB or smaller.')
})

test('the same idempotency key replays a user create and does not duplicate the row', () => {
  const backend = ready()
  const body = request('users.create', {
    actorUserId: 'u-aina', id: 'u-once', name: 'Once', email: 'once@coolslurppy.my', roleId: 'role-staff', departmentId: 'dept-sales',
  }, { idempotencyKey: 'user-once', requestId: 'once' })
  const first = backend.context.handleRequest(body, backend)
  const second = backend.context.handleRequest(body, backend)
  assert.equal(first.ok, true)
  assert.equal(second.meta.idempotentReplay, true)
  assert.equal(backend.spreadsheet.store.Users.filter((row) => row[0] === 'u-once').length, 1)
  const other = backend.context.handleRequest({ ...body, action: 'roles.create' }, backend)
  assert.equal(other.error.code, 'DUPLICATE_REQUEST')
})

test('a mismatched identity header is a conflict and does not overwrite Sheet1', () => {
  const backend = app()
  backend.spreadsheet.store.Users = [['not-id']]
  const loaded = backend.context.handleRequest(request('identity.get', {}), backend)
  assert.equal(loaded.error.code, 'CONFLICT')
  assert.deepEqual(backend.spreadsheet.store.Sheet1, [['']])
  assert.deepEqual(backend.spreadsheet.store.Users, [['not-id']])
})

test('frontend identity calls stay on the existing db methods', () => {
  const source = fs.readFileSync(path.join(root, 'src/store/db.ts'), 'utf8')
  for (const action of ['users.create', 'users.update', 'roles.create', 'roles.update', 'roles.setStatus', 'roles.savePermissions', 'roles.updateMatrix']) {
    assert.equal(source.includes(`queueIdentityWrite('${action}'`), true)
  }
  assert.equal(source.includes('queueSettingsPatch(patch)'), true)
  assert.equal(source.includes('switchUser(currentUserId: string)'), true)
  assert.equal(source.includes('resetDemo()'), true)
})
