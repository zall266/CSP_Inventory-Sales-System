import type { AppState, User, UserRole } from '@/types'

export const MANAGED_ROLES: Array<{ value: UserRole; label: string }> = [
  { value: 'staff', label: 'Staff' },
  { value: 'manager', label: 'Supervisor' },
  { value: 'admin', label: 'Admin' },
  { value: 'owner', label: 'Owner' },
]

export function managedRoleLabel(role: UserRole) {
  if (role === 'manager') return 'Supervisor'
  if (role === 'owner') return 'Owner'
  if (role === 'admin') return 'Admin'
  if (role === 'staff') return 'Staff'
  if (role === 'warehouse') return 'Warehouse'
  if (role === 'cashier') return 'Cashier'
  return role
}

export function actorUser(state: AppState): User {
  return state.users.find((user) => user.id === state.ui.currentUserId) ?? state.users[0]
}

export function canManageUsers(role: UserRole) {
  return role === 'admin' || role === 'owner'
}

export function canEditCompletedProduction(role: UserRole) {
  return role === 'admin' || role === 'owner'
}

export function isManagedRole(role: UserRole) {
  return role === 'staff' || role === 'manager' || role === 'admin' || role === 'owner'
}

export function canAssignRole(actor: User, role: UserRole) {
  if (!canManageUsers(actor.role)) return false
  if (!isManagedRole(role)) return false
  if (actor.role === 'admin' && role === 'owner') return false
  return true
}

export function canChangeUserRole(actor: User, target: User, nextRole: UserRole) {
  if (!canAssignRole(actor, nextRole)) return false
  if (target.role === 'owner' && actor.role !== 'owner') return false
  return true
}

export function canDeactivateUser(actor: User, target: User, users: User[]) {
  if (!canManageUsers(actor.role)) return false
  if (target.id === actor.id) return false
  if (target.role === 'owner' && actor.role !== 'owner') return false
  if (target.role === 'owner') {
    const otherOwners = users.filter((user) => user.id !== target.id && user.role === 'owner' && user.status === 'active')
    if (!otherOwners.length) return false
  }
  return true
}
