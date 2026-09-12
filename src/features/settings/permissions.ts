import type { AppState, PermissionKey, Role, RolePermissions, User, UserRole } from '@/types'

export const PERMISSION_KEYS: PermissionKey[] = [
  'dashboard.view',
  'sales.view',
  'sales.create',
  'sales.edit',
  'sales.void',
  'sales.quotation.view',
  'sales.quotation.create',
  'sales.quotation.edit',
  'sales.quotation.issue',
  'sales.quotation.cancel',
  'sales.quotation.print',
  'sales.invoice.view',
  'sales.invoice.create',
  'sales.invoice.edit',
  'sales.invoice.issue',
  'sales.invoice.cancel',
  'sales.invoice.print',
  'sales.delivery.view',
  'sales.delivery.create',
  'sales.delivery.edit',
  'sales.delivery.issue',
  'sales.delivery.cancel',
  'sales.delivery.print',
  'purchases.view',
  'purchases.create',
  'purchases.edit',
  'purchases.delete',
  'inventory.view',
  'inventory.adjust',
  'inventory.transfer',
  'inventory.count',
  'warehouse_map.view',
  'warehouse_map.putaway',
  'warehouse_map.move',
  'warehouse_map.layout.edit',
  'warehouse_map.location.manage',
  'warehouse_map.balance.use',
  'manufacturing.view',
  'manufacturing.create',
  'manufacturing.edit',
  'manufacturing.start',
  'manufacturing.complete',
  'manufacturing.completed.edit',
  'manufacturing.history.view',
  'reports.view',
  'reports.export',
  'finance.view',
  'payments.view',
  'receivables.view',
  'payables.view',
  'expenses.manage',
  'users.view',
  'users.create',
  'users.edit',
  'users.role.change',
  'users.deactivate',
  'roles.view',
  'roles.create',
  'roles.edit',
  'roles.deactivate',
  'roles.permissions.manage',
  'settings.view',
  'settings.edit',
]

export const PERMISSION_GROUPS: Array<{ id: string; label: string; keys: PermissionKey[] }> = [
  { id: 'dashboard', label: 'Dashboard', keys: ['dashboard.view'] },
  {
    id: 'sales',
    label: 'Sales',
    keys: [
      'sales.view',
      'sales.create',
      'sales.edit',
      'sales.void',
      'sales.quotation.view',
      'sales.quotation.create',
      'sales.quotation.edit',
      'sales.quotation.issue',
      'sales.quotation.cancel',
      'sales.quotation.print',
      'sales.invoice.view',
      'sales.invoice.create',
      'sales.invoice.edit',
      'sales.invoice.issue',
      'sales.invoice.cancel',
      'sales.invoice.print',
      'sales.delivery.view',
      'sales.delivery.create',
      'sales.delivery.edit',
      'sales.delivery.issue',
      'sales.delivery.cancel',
      'sales.delivery.print',
    ],
  },
  { id: 'purchases', label: 'Purchases', keys: ['purchases.view', 'purchases.create', 'purchases.edit', 'purchases.delete'] },
  { id: 'inventory', label: 'Inventory', keys: ['inventory.view', 'inventory.adjust', 'inventory.transfer', 'inventory.count'] },
  {
    id: 'warehouse_map',
    label: 'Warehouse Map',
    keys: [
      'warehouse_map.view',
      'warehouse_map.putaway',
      'warehouse_map.move',
      'warehouse_map.layout.edit',
      'warehouse_map.location.manage',
      'warehouse_map.balance.use',
    ],
  },
  {
    id: 'manufacturing',
    label: 'Manufacturing',
    keys: [
      'manufacturing.view',
      'manufacturing.create',
      'manufacturing.edit',
      'manufacturing.start',
      'manufacturing.complete',
      'manufacturing.completed.edit',
      'manufacturing.history.view',
    ],
  },
  { id: 'reports', label: 'Reports', keys: ['reports.view', 'reports.export'] },
  { id: 'finance', label: 'Finance', keys: ['finance.view', 'payments.view', 'receivables.view', 'payables.view', 'expenses.manage'] },
  { id: 'users', label: 'Users', keys: ['users.view', 'users.create', 'users.edit', 'users.role.change', 'users.deactivate'] },
  { id: 'roles', label: 'Roles', keys: ['roles.view', 'roles.create', 'roles.edit', 'roles.deactivate', 'roles.permissions.manage'] },
  { id: 'settings', label: 'Settings', keys: ['settings.view', 'settings.edit'] },
]

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  'dashboard.view': 'View Dashboard',
  'sales.view': 'View Sales',
  'sales.create': 'Create Sale',
  'sales.edit': 'Edit Sale',
  'sales.void': 'Void Sale',
  'sales.quotation.view': 'View Quotations',
  'sales.quotation.create': 'Create Quotation',
  'sales.quotation.edit': 'Edit Quotation',
  'sales.quotation.issue': 'Issue Quotation',
  'sales.quotation.cancel': 'Cancel Quotation',
  'sales.quotation.print': 'Print Quotation',
  'sales.invoice.view': 'View Invoices',
  'sales.invoice.create': 'Create Invoice',
  'sales.invoice.edit': 'Edit Invoice',
  'sales.invoice.issue': 'Issue Invoice',
  'sales.invoice.cancel': 'Cancel Invoice',
  'sales.invoice.print': 'Print Invoice',
  'sales.delivery.view': 'View Delivery Orders',
  'sales.delivery.create': 'Create Delivery Order',
  'sales.delivery.edit': 'Edit Delivery Order',
  'sales.delivery.issue': 'Issue Delivery Order',
  'sales.delivery.cancel': 'Cancel Delivery Order',
  'sales.delivery.print': 'Print Delivery Order',
  'purchases.view': 'View Purchases',
  'purchases.create': 'Create Purchase',
  'purchases.edit': 'Edit Purchase',
  'purchases.delete': 'Delete Purchase',
  'inventory.view': 'View Inventory',
  'inventory.adjust': 'Adjust Stock',
  'inventory.transfer': 'Stock Transfer',
  'inventory.count': 'Stock Count',
  'warehouse_map.view': 'View Warehouse Map',
  'warehouse_map.putaway': 'Place Finished Goods',
  'warehouse_map.move': 'Move Warehouse Stock',
  'warehouse_map.layout.edit': 'Edit Warehouse Layout',
  'warehouse_map.location.manage': 'Manage Storage Locations',
  'warehouse_map.balance.use': 'Use Production Balance',
  'manufacturing.view': 'View Manufacturing',
  'manufacturing.create': 'Create Production',
  'manufacturing.edit': 'Edit Production',
  'manufacturing.start': 'Start Production',
  'manufacturing.complete': 'Complete Production',
  'manufacturing.completed.edit': 'Edit Completed Production',
  'manufacturing.history.view': 'View Production History',
  'reports.view': 'View Reports',
  'reports.export': 'Export Reports',
  'finance.view': 'View Finance',
  'payments.view': 'View Payments',
  'receivables.view': 'View Receivables',
  'payables.view': 'View Payables',
  'expenses.manage': 'Manage Expenses',
  'users.view': 'View Users',
  'users.create': 'Create User',
  'users.edit': 'Edit User',
  'users.role.change': 'Change User Role',
  'users.deactivate': 'Deactivate User',
  'roles.view': 'View Roles',
  'roles.create': 'Create Role',
  'roles.edit': 'Edit Role',
  'roles.deactivate': 'Deactivate Role',
  'roles.permissions.manage': 'Manage Permissions',
  'settings.view': 'View Settings',
  'settings.edit': 'Edit Settings',
}

export function emptyPermissions(): RolePermissions {
  return Object.fromEntries(PERMISSION_KEYS.map((key) => [key, false])) as RolePermissions
}

export function fullPermissions(): RolePermissions {
  return Object.fromEntries(PERMISSION_KEYS.map((key) => [key, true])) as RolePermissions
}

function withKeys(keys: PermissionKey[]): RolePermissions {
  const next = emptyPermissions()
  for (const key of keys) next[key] = true
  return next
}

const SALES_CORE: PermissionKey[] = ['sales.view', 'sales.create', 'sales.edit']
const DOCUMENT_KEYS: PermissionKey[] = [
  'sales.quotation.view',
  'sales.quotation.create',
  'sales.quotation.edit',
  'sales.quotation.issue',
  'sales.quotation.cancel',
  'sales.quotation.print',
  'sales.invoice.view',
  'sales.invoice.create',
  'sales.invoice.edit',
  'sales.invoice.issue',
  'sales.invoice.cancel',
  'sales.invoice.print',
  'sales.delivery.view',
  'sales.delivery.create',
  'sales.delivery.edit',
  'sales.delivery.issue',
  'sales.delivery.cancel',
  'sales.delivery.print',
]
const PURCHASES_ALL: PermissionKey[] = ['purchases.view', 'purchases.create', 'purchases.edit', 'purchases.delete']
const INVENTORY_ALL: PermissionKey[] = ['inventory.view', 'inventory.adjust', 'inventory.transfer', 'inventory.count']
const WAREHOUSE_MAP_STAFF: PermissionKey[] = ['warehouse_map.view', 'warehouse_map.putaway', 'warehouse_map.move', 'warehouse_map.balance.use']
const WAREHOUSE_MAP_ALL: PermissionKey[] = [
  'warehouse_map.view',
  'warehouse_map.putaway',
  'warehouse_map.move',
  'warehouse_map.layout.edit',
  'warehouse_map.location.manage',
  'warehouse_map.balance.use',
]
const MFG_RUN: PermissionKey[] = [
  'manufacturing.view',
  'manufacturing.create',
  'manufacturing.edit',
  'manufacturing.start',
  'manufacturing.complete',
  'manufacturing.history.view',
]
const FINANCE_VIEW: PermissionKey[] = ['finance.view', 'payments.view', 'receivables.view', 'payables.view']

export function defaultPermissionsForLegacy(role: UserRole): RolePermissions {
  if (role === 'owner' || role === 'admin') return fullPermissions()
  if (role === 'manager') {
    return withKeys([
      'dashboard.view',
      ...SALES_CORE,
      'sales.void',
      ...DOCUMENT_KEYS,
      ...PURCHASES_ALL,
      ...INVENTORY_ALL,
      ...WAREHOUSE_MAP_ALL,
      ...MFG_RUN,
      'reports.view',
      ...FINANCE_VIEW,
      'settings.view',
    ])
  }
  if (role === 'staff') {
    return withKeys([
      'dashboard.view',
      ...SALES_CORE,
      ...DOCUMENT_KEYS,
      'inventory.view',
      ...WAREHOUSE_MAP_STAFF,
      ...MFG_RUN,
      'reports.view',
    ])
  }
  if (role === 'cashier') {
    return withKeys([
      ...SALES_CORE,
      'sales.invoice.view',
      'sales.invoice.print',
      'sales.quotation.view',
      'sales.quotation.print',
    ])
  }
  return withKeys([
    'dashboard.view',
    ...PURCHASES_ALL,
    ...INVENTORY_ALL,
    ...WAREHOUSE_MAP_ALL,
    ...MFG_RUN,
    'sales.delivery.view',
    'sales.delivery.create',
    'sales.delivery.edit',
    'sales.delivery.issue',
    'sales.delivery.print',
  ])
}

export function normalizePermissions(input?: Partial<RolePermissions>): RolePermissions {
  const next = emptyPermissions()
  if (!input) return next
  for (const key of PERMISSION_KEYS) {
    next[key] = Boolean(input[key])
  }
  return next
}

export function roleById(state: AppState, roleId: string | undefined): Role | undefined {
  if (!roleId) return undefined
  return state.roles.find((role) => role.id === roleId)
}

export function departmentName(state: AppState, departmentId: string | undefined) {
  if (!departmentId) return '—'
  return state.departments.find((item) => item.id === departmentId)?.name ?? '—'
}

export function roleName(state: AppState, roleId: string | undefined) {
  return roleById(state, roleId)?.name ?? '—'
}

export function displayRoleName(state: AppState, user: User) {
  return roleById(state, user.roleId)?.name ?? user.role
}

export function isOwnerRole(role: Role | undefined) {
  return Boolean(role?.protected || role?.legacyRole === 'owner')
}

export function isOwnerUser(state: AppState, user: User) {
  return isOwnerRole(roleById(state, user.roleId)) || user.role === 'owner'
}

export function actorUser(state: AppState): User {
  return state.users.find((user) => user.id === state.ui.currentUserId) ?? state.users[0]
}

export function hasPermission(state: AppState, key: PermissionKey, user = actorUser(state)) {
  if (user.status !== 'active') return false
  if (isOwnerUser(state, user)) return true
  const role = roleById(state, user.roleId)
  if (!role) return false
  return Boolean(state.settings.roleMatrix[role.id]?.[key])
}

export function effectivePermissions(state: AppState, user = actorUser(state)): RolePermissions {
  if (isOwnerUser(state, user)) return fullPermissions()
  return normalizePermissions(state.settings.roleMatrix[user.roleId])
}

export function canAccessUsersAndRoles(state: AppState, user = actorUser(state)) {
  return (
    hasPermission(state, 'users.view', user) ||
    hasPermission(state, 'roles.view', user) ||
    hasPermission(state, 'roles.permissions.manage', user)
  )
}

export function activeRoles(state: AppState) {
  return state.roles.filter((role) => role.status === 'active')
}

export function activeDepartments(state: AppState) {
  return state.departments.filter((item) => item.status === 'active')
}

export function usersForRole(state: AppState, roleId: string) {
  return state.users.filter((user) => user.roleId === roleId)
}

export function assignableRoles(state: AppState, currentRoleId?: string) {
  return state.roles.filter((role) => {
    if (isOwnerRole(role)) return role.id === currentRoleId
    if (role.status === 'active') return true
    return role.id === currentRoleId
  })
}
