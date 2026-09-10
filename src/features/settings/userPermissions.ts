import type { AppState, Role, User } from '@/types'
import {
  actorUser,
  hasPermission,
  isOwnerRole,
  isOwnerUser,
  roleById,
} from './permissions'

export { actorUser, hasPermission, isOwnerRole, isOwnerUser }

export function canManageUsers(state: AppState, user = actorUser(state)) {
  return (
    hasPermission(state, 'users.view', user) ||
    hasPermission(state, 'users.create', user) ||
    hasPermission(state, 'users.edit', user) ||
    hasPermission(state, 'roles.view', user)
  )
}

export function canCreateUser(state: AppState, user = actorUser(state)) {
  return hasPermission(state, 'users.create', user)
}

export function canEditUserRecord(state: AppState, user = actorUser(state)) {
  return hasPermission(state, 'users.edit', user)
}

export function canChangeRoles(state: AppState, user = actorUser(state)) {
  return hasPermission(state, 'users.role.change', user)
}

export function canDeactivateUsers(state: AppState, user = actorUser(state)) {
  return hasPermission(state, 'users.deactivate', user)
}

export function canCreateRole(state: AppState, user = actorUser(state)) {
  return hasPermission(state, 'roles.create', user)
}

export function canEditRoleRecord(state: AppState, user = actorUser(state)) {
  return hasPermission(state, 'roles.edit', user)
}

export function canDeactivateRoles(state: AppState, user = actorUser(state)) {
  return hasPermission(state, 'roles.deactivate', user)
}

export function canManagePermissions(state: AppState, user = actorUser(state)) {
  return hasPermission(state, 'roles.permissions.manage', user)
}

export function canAssignRole(state: AppState, actor: User, role: Role | undefined, currentRoleId?: string) {
  if (!role) return false
  const mayChoose =
    hasPermission(state, 'users.role.change', actor) ||
    hasPermission(state, 'users.create', actor) ||
    role.id === currentRoleId
  if (!mayChoose) return false
  if (isOwnerRole(role) && !isOwnerUser(state, actor)) return false
  if (isOwnerRole(role) && currentRoleId !== role.id) return false
  if (role.status !== 'active' && role.id !== currentRoleId) return false
  return true
}

export function canChangeUserRole(state: AppState, actor: User, target: User, nextRole: Role | undefined) {
  if (!nextRole) return false
  if (isOwnerUser(state, target) && !isOwnerUser(state, actor)) return false
  if (isOwnerUser(state, target) && nextRole.id !== target.roleId) return false
  if (target.roleId === nextRole.id) return true
  if (!hasPermission(state, 'users.role.change', actor)) return false
  return canAssignRole(state, actor, nextRole, target.roleId)
}

export function canDeactivateUser(state: AppState, actor: User, target: User) {
  if (!hasPermission(state, 'users.deactivate', actor)) return false
  if (target.id === actor.id) return false
  if (isOwnerUser(state, target) && !isOwnerUser(state, actor)) return false
  if (isOwnerUser(state, target)) {
    const otherOwners = state.users.filter(
      (user) => user.id !== target.id && user.status === 'active' && isOwnerUser(state, user),
    )
    if (!otherOwners.length) return false
  }
  return true
}

export function canRenameRole(state: AppState, actor: User, role: Role) {
  if (!hasPermission(state, 'roles.edit', actor)) return false
  if (isOwnerRole(role)) return false
  return true
}

export function canDeactivateRole(state: AppState, actor: User, role: Role) {
  if (!hasPermission(state, 'roles.deactivate', actor)) return false
  if (isOwnerRole(role)) return false
  return true
}

export function roleForUser(state: AppState, user: User) {
  return roleById(state, user.roleId)
}
