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
    parties: context.createPartyService({ sheetRepository: sheets }),
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
    ],
    categories: [{ id: 'cat-ing', name: 'Ingredients' }],
  }
}

function ready() {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(call(backend, 'identity.bootstrap', identityPayload()).ok, true)
  assert.equal(call(backend, 'masters.bootstrap', masterPayload()).ok, true)
  return backend
}

function customerInput(extra = {}) {
  return {
    actorUserId: 'u-mei',
    id: 'cus-uat',
    name: 'UAT Customer Module 4',
    phone: '012-300 4401',
    email: 'uat4@example.com',
    address: '1, Jalan UAT',
    ...extra,
  }
}

function supplierInput(extra = {}) {
  return {
    actorUserId: 'u-mei',
    id: 'sup-uat',
    name: 'UAT Supplier Module 4',
    contact: 'Encik UAT',
    phone: '03-4000 4401',
    email: 'supplier4@example.com',
    ...extra,
  }
}

function auditActions(backend) {
  return (backend.spreadsheet.store.AuditLogs || []).map((row) => row[3])
}

function byId(rows, id) {
  return rows.find((row) => row.id === id)
}

test('party sheets stay unread until the module is called and Sheet1 stays reserved', () => {
  const backend = app()
  backend.foundation.initialize()
  assert.equal(backend.spreadsheet.store.Customers, undefined)
  assert.equal(backend.spreadsheet.store.Suppliers, undefined)
  assert.equal(backend.spreadsheet.store.Agents, undefined)
  assert.equal(backend.spreadsheet.store.CustomerWholesalePrices, undefined)
  const health = call(backend, 'system.health', {})
  assert.equal(health.ok, true)
  assert.equal(backend.spreadsheet.store.Customers, undefined)
  assert.deepEqual(backend.spreadsheet.store.Sheet1, [['']])
})

test('customer and supplier create, list, and get persist the locked fields', () => {
  const backend = ready()
  const denied = call(backend, 'customers.create', customerInput({ actorUserId: '' }))
  assert.equal(denied.error.code, 'FORBIDDEN')
  assert.equal(denied.error.message, 'You cannot add customers.')
  const inactive = call(backend, 'suppliers.create', supplierInput({ actorUserId: 'u-off' }))
  assert.equal(inactive.error.code, 'FORBIDDEN')
  assert.equal(inactive.error.message, 'You cannot add suppliers.')
  assert.equal(auditActions(backend).includes('customers.create'), false)
  assert.equal(auditActions(backend).includes('suppliers.create'), false)

  const blank = call(backend, 'customers.create', customerInput({ name: '   ' }))
  assert.equal(blank.error.message, 'Customer name is required')
  const blankSupplier = call(backend, 'suppliers.create', supplierInput({ name: ' ' }))
  assert.equal(blankSupplier.error.message, 'Supplier name is required')
  assert.equal(auditActions(backend).includes('customers.create'), false)
  assert.equal(backend.spreadsheet.store.Customers, undefined)

  const customer = call(backend, 'customers.create', customerInput())
  assert.equal(customer.ok, true)
  const saved = byId(customer.data.customers, 'cus-uat')
  assert.equal(saved.name, 'UAT Customer Module 4')
  assert.equal(saved.phone, '012-300 4401')
  assert.equal(saved.email, 'uat4@example.com')
  assert.equal(saved.address, '1, Jalan UAT')
  assert.equal(saved.status, 'active')
  const sameName = call(backend, 'customers.create', customerInput({ id: 'cus-uat-2', phone: '019-1' }))
  assert.equal(sameName.ok, true)
  assert.equal(sameName.data.customers.filter((row) => row.name === 'UAT Customer Module 4').length, 2)
  const duplicateId = call(backend, 'customers.create', customerInput({ id: 'cus-uat', name: 'Other' }))
  assert.equal(duplicateId.error.code, 'CONFLICT')
  assert.equal(duplicateId.error.message, 'Customer already exists.')

  const supplier = call(backend, 'suppliers.create', supplierInput())
  assert.equal(byId(supplier.data.suppliers, 'sup-uat').contact, 'Encik UAT')
  assert.equal(byId(supplier.data.suppliers, 'sup-uat').status, 'active')
  const listed = call(backend, 'parties.get', { actorUserId: 'u-mei' })
  assert.equal(byId(listed.data.customers, 'cus-uat').address, '1, Jalan UAT')
  assert.equal(byId(listed.data.suppliers, 'sup-uat').email, 'supplier4@example.com')
  assert.equal(call(backend, 'customers.get', { id: 'cus-missing' }).error.message, 'Customer was not found.')
  assert.equal(call(backend, 'suppliers.get', { id: 'sup-missing' }).error.message, 'Supplier was not found.')
  assert.equal(call(backend, 'customers.list', {}).data.customers.length, 2)
  assert.deepEqual(backend.spreadsheet.store.Sheet1, [['']])
  assert.equal(call(backend, 'users.list', {}).data.users.find((user) => user.id === 'u-aina').status, 'active')
})

test('bootstrap is idempotent and keeps the existing demo parties', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', {
    actorUserId: 'u-mei',
    id: 'p-pack-mt',
    name: 'Milk Tea',
    sku: 'FG-MT45',
    categoryId: 'cat-ing',
    unit: 'PCS',
    purchaseUnit: 'PCS',
    purchaseCost: 1,
    sellingPrice: 8,
    wholesalePrice: 6,
    sellable: true,
  }).ok, true)
  const seeded = call(backend, 'parties.bootstrap', {
    actorUserId: 'u-aina',
    customers: [
      { id: 'c-walkin', name: 'Walk-in Customer', phone: '-', email: '', status: 'active' },
      { id: 'c-abc-ent', name: 'ABC Enterprise', phone: '03-7788 2210', email: 'purchasing@abcenterprise.my', address: '28, Jalan Kuchai Lama', status: 'active' },
    ],
    suppliers: [
      { id: 's-a', name: 'Supplier A', contact: 'Encik Razak', phone: '03-7788 2100', email: 'sales@suppliera.my', status: 'active' },
    ],
    customerWholesalePrices: [
      { id: 'cwp-abc-mt', customerId: 'c-abc-ent', productId: 'p-pack-mt', price: 11, active: true, createdBy: 'u-admin', updatedBy: 'u-admin' },
    ],
    agents: [],
  })
  assert.equal(seeded.ok, true)
  assert.equal(seeded.data.customers.length, 2)
  assert.equal(byId(seeded.data.customers, 'c-walkin').phone, '-')
  assert.equal(seeded.data.suppliers.length, 1)
  assert.equal(seeded.data.customerWholesalePrices.length, 1)
  assert.equal(seeded.data.customerWholesalePrices[0].price, 11)
  assert.equal(seeded.data.agents.length, 0)
  const again = call(backend, 'parties.bootstrap', {
    customers: [{ id: 'c-other', name: 'Other' }],
    suppliers: [{ id: 's-other', name: 'Other Supplier', contact: '', phone: '', email: '' }],
  })
  assert.equal(again.error.code, 'CONFLICT')
  assert.equal(again.error.message, 'Parties are already initialized.')
  assert.equal(call(backend, 'customers.list', {}).data.customers.length, 2)
  assert.equal(auditActions(backend).filter((action) => action === 'parties.bootstrap').length, 1)
})

test('agent create links a warehouse, update keeps the warehouse id, and status is audited', () => {
  const backend = ready()
  const staff = call(backend, 'agents.create', {
    actorUserId: 'u-mei', id: 'agt-uat', name: 'UAT Agent Module 4', code: 'ag-jb',
  })
  assert.equal(staff.error.code, 'FORBIDDEN')
  assert.equal(staff.error.message, 'You cannot manage agents.')
  assert.equal(auditActions(backend).includes('agents.create'), false)

  const missingName = call(backend, 'agents.create', { actorUserId: 'u-aina', name: ' ', code: 'AG-1' })
  assert.equal(missingName.error.message, 'Agent name is required')
  const missingCode = call(backend, 'agents.create', { actorUserId: 'u-aina', name: 'Agent', code: ' ' })
  assert.equal(missingCode.error.message, 'Agent code is required')
  const companyCode = call(backend, 'agents.create', { actorUserId: 'u-aina', id: 'agt-main', name: 'Main', code: 'main' })
  assert.equal(companyCode.error.message, 'Warehouse code already exists')
  assert.equal(auditActions(backend).includes('agents.create'), false)

  const created = call(backend, 'agents.create', {
    actorUserId: 'u-aina',
    id: 'agt-uat',
    name: 'UAT Agent Module 4',
    code: ' ag-jb ',
    userId: 'u-mei',
    bankName: 'Maybank',
    accountHolder: 'UAT Agent',
    bankAccount: '1234567890',
  })
  assert.equal(created.ok, true)
  const agent = byId(created.data.agents, 'agt-uat')
  assert.equal(agent.code, 'AG-JB')
  assert.equal(agent.warehouseId, 'wh-agent-jb')
  assert.equal(agent.userId, 'u-mei')
  assert.equal(agent.bankAccount, '1234567890')
  assert.equal(agent.status, 'active')
  const warehouse = created.data.warehouses.find((row) => row.id === 'wh-agent-jb')
  assert.equal(warehouse.kind, 'agent')
  assert.equal(warehouse.code, 'AG-JB')
  assert.equal(warehouse.name, 'Agent UAT Agent Module 4')
  assert.equal(created.data.warehouses.filter((row) => row.kind === 'company').length, 2)

  const duplicate = call(backend, 'agents.create', { actorUserId: 'u-aina', id: 'agt-2', name: 'Other', code: 'AG-JB' })
  assert.equal(duplicate.error.message, 'Agent code already exists')
  const linked = call(backend, 'agents.create', { actorUserId: 'u-aina', id: 'agt-3', name: 'Other', code: 'AG-2', userId: 'u-mei' })
  assert.equal(linked.error.message, 'User already linked to an agent')
  const missingUser = call(backend, 'agents.create', { actorUserId: 'u-aina', id: 'agt-4', name: 'Other', code: 'AG-3', userId: 'u-missing' })
  assert.equal(missingUser.error.message, 'User not found')
  assert.equal(auditActions(backend).filter((action) => action === 'agents.create').length, 1)

  const updated = call(backend, 'agents.update', {
    actorUserId: 'u-aina',
    id: 'agt-uat',
    name: 'UAT Agent Edited',
    code: 'AG-JB2',
    userId: '',
    bankName: 'CIMB',
    accountHolder: 'Edited',
    bankAccount: '999',
  })
  assert.equal(updated.ok, true)
  const next = byId(updated.data.agents, 'agt-uat')
  assert.equal(next.name, 'UAT Agent Edited')
  assert.equal(next.code, 'AG-JB2')
  assert.equal(next.warehouseId, 'wh-agent-jb')
  assert.equal(next.userId, undefined)
  assert.equal(next.bankName, 'CIMB')
  const renamed = updated.data.warehouses.find((row) => row.id === 'wh-agent-jb')
  assert.equal(renamed.name, 'Agent UAT Agent Edited')
  assert.equal(renamed.code, 'AG-JB')
  const hidden = call(backend, 'agents.get', { actorUserId: 'u-mei', id: 'agt-uat' })
  assert.equal(hidden.error.code, 'NOT_FOUND')
  const ownerView = call(backend, 'agents.get', { actorUserId: 'u-aina', id: 'agt-uat' })
  assert.equal(ownerView.data.agent.code, 'AG-JB2')
  assert.equal(ownerView.data.warehouse.code, 'AG-JB')

  const deactivated = call(backend, 'agents.setStatus', { actorUserId: 'u-aina', id: 'agt-uat', status: 'inactive' })
  assert.equal(byId(deactivated.data.agents, 'agt-uat').status, 'inactive')
  const same = call(backend, 'agents.setStatus', { actorUserId: 'u-aina', id: 'agt-uat', status: 'inactive' })
  assert.equal(same.ok, true)
  assert.equal(auditActions(backend).filter((action) => action === 'agents.setStatus').length, 1)
  const activated = call(backend, 'agents.setStatus', { actorUserId: 'u-aina', id: 'agt-uat', status: 'active' })
  assert.equal(byId(activated.data.agents, 'agt-uat').status, 'active')
  const bad = call(backend, 'agents.setStatus', { actorUserId: 'u-aina', id: 'agt-uat', status: 'archived' })
  assert.equal(bad.error.message, 'Agent status is not valid.')
  const missing = call(backend, 'agents.update', { actorUserId: 'u-aina', id: 'agt-missing', name: 'Nope', code: 'NOPE' })
  assert.equal(missing.error.code, 'NOT_FOUND')
  assert.equal(call(backend, 'agents.get', { id: 'agt-uat' }).error.code, 'NOT_FOUND')
  assert.equal(call(backend, 'warehouses.list', {}).data.warehouses.some((row) => row.id === 'wh-main'), true)
  assert.equal(call(backend, 'users.list', {}).data.users.find((user) => user.id === 'u-aina').name, 'Aina Rahman')
})

test('custom wholesale prices require customer.pricing.manage and do not replace agent prices', () => {
  const backend = ready()
  assert.equal(call(backend, 'products.create', {
    actorUserId: 'u-aina',
    id: 'prd-price',
    name: 'Priced',
    sku: 'PR-1',
    categoryId: 'cat-ing',
    unit: 'PCS',
    purchaseUnit: 'PCS',
    purchaseCost: 1,
    sellingPrice: 20,
    wholesalePrice: 15,
    sellable: true,
    agentPrice: 9,
  }).ok, true)
  assert.equal(call(backend, 'customers.create', customerInput()).ok, true)
  const staff = call(backend, 'customers.saveWholesalePrice', {
    actorUserId: 'u-mei', customerId: 'cus-uat', productId: 'prd-price', price: 12,
  })
  assert.equal(staff.error.code, 'FORBIDDEN')
  assert.equal(staff.error.message, 'You cannot manage customer pricing.')
  assert.equal(auditActions(backend).includes('customers.saveWholesalePrice'), false)
  const negative = call(backend, 'customers.saveWholesalePrice', {
    actorUserId: 'u-aina', customerId: 'cus-uat', productId: 'prd-price', price: -1,
  })
  assert.equal(negative.error.message, 'Custom Wholesale Price cannot be negative.')
  const missingCustomer = call(backend, 'customers.saveWholesalePrice', {
    actorUserId: 'u-aina', customerId: 'cus-missing', productId: 'prd-price', price: 12,
  })
  assert.equal(missingCustomer.error.message, 'Customer not found')
  const saved = call(backend, 'customers.saveWholesalePrice', {
    actorUserId: 'u-aina', id: 'cwp-uat', customerId: 'cus-uat', productId: 'prd-price', price: 12.5, active: true,
  })
  assert.equal(saved.ok, true)
  assert.equal(saved.data.customerWholesalePrices.length, 1)
  assert.equal(saved.data.customerWholesalePrices[0].id, 'cwp-uat')
  assert.equal(saved.data.customerWholesalePrices[0].price, 12.5)
  assert.equal(saved.data.customerWholesalePrices[0].active, true)
  const edited = call(backend, 'customers.saveWholesalePrice', {
    actorUserId: 'u-aina', id: 'cwp-other', customerId: 'cus-uat', productId: 'prd-price', price: 10,
  })
  assert.equal(edited.data.customerWholesalePrices.length, 1)
  assert.equal(edited.data.customerWholesalePrices[0].id, 'cwp-uat')
  assert.equal(edited.data.customerWholesalePrices[0].price, 10)
  const removed = call(backend, 'customers.deactivateWholesalePrice', { actorUserId: 'u-aina', id: 'cwp-uat' })
  assert.equal(removed.data.customerWholesalePrices[0].active, false)
  const twice = call(backend, 'customers.deactivateWholesalePrice', { actorUserId: 'u-aina', id: 'cwp-uat' })
  assert.equal(twice.ok, true)
  assert.equal(auditActions(backend).filter((action) => action === 'customers.deactivateWholesalePrice').length, 1)
  assert.equal(call(backend, 'products.get', { id: 'prd-price' }).data.product.agentPrice, 9)
  assert.equal(call(backend, 'customers.deactivateWholesalePrice', { actorUserId: 'u-aina', id: 'cwp-missing' }).error.message, 'Custom price not found')
})

test('a rejected party write does not audit, and a replay does not duplicate the customer', () => {
  const backend = ready()
  const body = request('customers.create', customerInput({ id: 'cus-once' }), {
    idempotencyKey: 'cus-once', requestId: 'once',
  })
  const first = backend.context.handleRequest(body, backend)
  const second = backend.context.handleRequest(body, backend)
  assert.equal(first.ok, true)
  assert.equal(second.meta.idempotentReplay, true)
  assert.equal(backend.spreadsheet.store.Customers.filter((row) => row[0] === 'cus-once').length, 1)
  const blocked = app(() => false)
  blocked.spreadsheet = backend.spreadsheet
  blocked.sheets = blocked.context.createSheetRepository({ openSpreadsheet: () => backend.spreadsheet })
  blocked.parties = blocked.context.createPartyService({ sheetRepository: blocked.sheets })
  blocked.idempotency = blocked.context.createIdempotencyService(blocked.sheets)
  const denied = call(blocked, 'customers.create', customerInput({ id: 'cus-lock' }))
  assert.equal(denied.error.code, 'CONFLICT')
  assert.equal(backend.spreadsheet.store.Customers.filter((row) => row[0] === 'cus-lock').length, 0)
})

test('frontend party calls stay on the existing db methods', () => {
  const source = fs.readFileSync(path.join(root, 'src/store/db.ts'), 'utf8')
  assert.equal(source.includes("queuePartyWrite('customers.create'"), true)
  assert.equal(source.includes("queuePartyWrite('suppliers.create'"), true)
  assert.equal(source.includes("queuePartyWrite('agents.create'"), true)
  assert.equal(source.includes("queuePartyWrite('agents.update'"), true)
  assert.equal(source.includes("queuePartyWrite('agents.setStatus'"), true)
  assert.equal(source.includes("queuePartyWrite('customers.saveWholesalePrice'"), true)
  assert.equal(source.includes("queuePartyWrite('customers.deactivateWholesalePrice'"), true)
  assert.equal(source.includes('createCustomer(input:'), true)
  assert.equal(source.includes('createAgent(input: AgentInput)'), true)
  assert.equal(source.includes("queueProductWrite('products.saveAgentPrices'"), true)
})
