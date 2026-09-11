import { Fragment, useMemo, useState } from 'react'
import { Badge, Button, Card, Checkbox, ConfirmDialog, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui'
import { useApi, useStore } from '@/store/hooks'
import type { PermissionKey, Role, RolePermissions, RoleStatus, User, UserStatus } from '@/types'
import { formatDateTime } from '@/utils/format'
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  activeDepartments,
  activeRoles,
  assignableRoles,
  canAccessUsersAndRoles,
  departmentName,
  displayRoleName,
  effectivePermissions,
  fullPermissions,
  isOwnerRole,
  isOwnerUser,
  normalizePermissions,
  roleById,
  usersForRole,
} from './permissions'
import {
  actorUser,
  canCreateRole,
  canCreateUser,
  canDeactivateRole,
  canDeactivateUser,
  canDeactivateUsers,
  canEditRoleRecord,
  canEditUserRecord,
  canManagePermissions,
} from './userPermissions'

const auditActionLabel: Record<string, string> = {
  user_created: 'User Created',
  user_updated: 'User Updated',
  role_changed: 'Role Changed',
  department_changed: 'Department Changed',
  user_deactivated: 'User Deactivated',
  user_reactivated: 'User Reactivated',
  role_created: 'Role Created',
  role_renamed: 'Role Renamed',
  role_updated: 'Role Updated',
  role_deactivated: 'Role Deactivated',
  role_reactivated: 'Role Reactivated',
  role_permissions_changed: 'Role Permissions Changed',
}

function prettyAuditValue(field: string, value: string) {
  if (field === 'status' && value === 'active') return 'Active'
  if (field === 'status' && value === 'inactive') return 'Inactive'
  if (PERMISSION_LABELS[field as PermissionKey]) return PERMISSION_LABELS[field as PermissionKey]
  return value
}

function RoleBadge({ name, protectedRole }: { name: string; protectedRole?: boolean }) {
  const tone = protectedRole ? 'indigo' : 'slate'
  return <Badge tone={tone}>{name}</Badge>
}

function PermissionDenied() {
  return (
    <div>
      <PageHeader title="Permission Denied" subtitle="You do not have access to Users & Roles." />
    </div>
  )
}

type Tab = 'users' | 'roles' | 'matrix'
type UserForm = { name: string; email: string; roleId: string; departmentId: string; status: UserStatus }
type RoleForm = { name: string; description: string; status: RoleStatus }

function PermissionList({ permissions, enabledOnly = false }: { permissions: RolePermissions; enabledOnly?: boolean }) {
  const groups = PERMISSION_GROUPS.map((group) => ({
    ...group,
    keys: enabledOnly ? group.keys.filter((key) => permissions[key]) : group.keys,
  })).filter((group) => group.keys.length)
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.id}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.label}</div>
          <div className="space-y-1 text-sm">
            {group.keys.map((key) => (
              <div key={key} className="flex items-center gap-2 text-slate-700">
                <span className={permissions[key] ? 'text-emerald-600' : 'text-slate-400'}>{permissions[key] ? '✓' : '✗'}</span>
                {PERMISSION_LABELS[key]}
              </div>
            ))}
          </div>
        </div>
      ))}
      {enabledOnly && !groups.length && <p className="text-sm text-slate-500">No permissions assigned to this role.</p>}
    </div>
  )
}

export function UsersSettingsPage() {
  const state = useStore()
  const api = useApi()
  const actor = actorUser(state)
  const [tab, setTab] = useState<Tab>('users')
  const [userMode, setUserMode] = useState<'add' | 'edit' | 'view' | null>(null)
  const [roleMode, setRoleMode] = useState<'add' | 'edit' | 'view' | 'permissions' | null>(null)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)
  const [userForm, setUserForm] = useState<UserForm>({ name: '', email: '', roleId: 'role-staff', departmentId: 'dept-production', status: 'active' })
  const [roleForm, setRoleForm] = useState<RoleForm>({ name: '', description: '', status: 'active' })
  const [permDraft, setPermDraft] = useState<RolePermissions>(normalizePermissions())
  const [userError, setUserError] = useState('')
  const [roleError, setRoleError] = useState('')
  const [deactivateUser, setDeactivateUser] = useState<User | null>(null)
  const [deactivateRole, setDeactivateRole] = useState<Role | null>(null)
  const auditRows = useMemo(() => state.userAuditLogs ?? [], [state.userAuditLogs])
  const allowed = canAccessUsersAndRoles(state, actor)

  const firstActiveRole = assignableRoles(state)[0]?.id ?? ''
  const firstActiveDept = activeDepartments(state)[0]?.id ?? ''
  const matrixRoles = activeRoles(state)
  const canUsersCreate = canCreateUser(state, actor)
  const canUsersEdit = canEditUserRecord(state, actor)
  const canRolesCreate = canCreateRole(state, actor)
  const canRolesEdit = canEditRoleRecord(state, actor)
  const canPerms = canManagePermissions(state, actor)

  if (!allowed) return <PermissionDenied />

  const openAddUser = () => {
    setSelectedUser(null)
    setUserError('')
    setUserForm({ name: '', email: '', roleId: firstActiveRole, departmentId: firstActiveDept, status: 'active' })
    setUserMode('add')
  }
  const openEditUser = (user: User) => {
    setSelectedUser(user)
    setUserError('')
    setUserForm({ name: user.name, email: user.email, roleId: user.roleId, departmentId: user.departmentId, status: user.status })
    setUserMode('edit')
  }
  const openViewUser = (user: User) => {
    setSelectedUser(user)
    setUserMode('view')
  }
  const saveUser = () => {
    const name = userForm.name.trim()
    const email = userForm.email.trim()
    if (!name || !email) {
      setUserError('Name and email are required.')
      return
    }
    if (userMode === 'add') {
      const created = api.createUser(userForm)
      if (created) setUserMode(null)
      return
    }
    if (userMode === 'edit' && selectedUser) {
      if (userForm.status === 'inactive' && selectedUser.status === 'active') {
        setDeactivateUser(selectedUser)
        return
      }
      const ok = api.updateUser(selectedUser.id, userForm)
      if (ok) setUserMode(null)
    }
  }

  const openAddRole = () => {
    setSelectedRole(null)
    setRoleError('')
    setRoleForm({ name: '', description: '', status: 'active' })
    setRoleMode('add')
  }
  const openEditRole = (role: Role) => {
    setSelectedRole(role)
    setRoleError('')
    setRoleForm({ name: role.name, description: role.description, status: role.status })
    setRoleMode('edit')
  }
  const openViewRole = (role: Role) => {
    setSelectedRole(role)
    setRoleMode('view')
  }
  const openPermissions = (role: Role) => {
    setSelectedRole(role)
    setPermDraft(normalizePermissions(state.settings.roleMatrix[role.id]))
    setRoleMode('permissions')
  }
  const saveRole = () => {
    const name = roleForm.name.trim()
    if (!name) {
      setRoleError('Role name is required.')
      return
    }
    const duplicate = state.roles.some(
      (role) => role.id !== selectedRole?.id && role.name.trim().toLowerCase() === name.toLowerCase(),
    )
    if (duplicate) {
      setRoleError('Role name must be unique.')
      return
    }
    setRoleError('')
    if (roleMode === 'add') {
      const created = api.createRole(roleForm)
      if (created) setRoleMode(null)
      return
    }
    if (roleMode === 'edit' && selectedRole) {
      const ok = api.updateRole(selectedRole.id, roleForm)
      if (ok) setRoleMode(null)
    }
  }
  const savePermissions = () => {
    if (!selectedRole) return
    const ok = api.saveRolePermissions(selectedRole.id, permDraft)
    if (ok) setRoleMode(null)
  }

  const userRoleOptions = (currentRoleId?: string) =>
    assignableRoles(state, currentRoleId).filter((role) => !isOwnerRole(role) || currentRoleId === role.id || isOwnerUser(state, actor))

  return (
    <div>
      <PageHeader
        title="Users & Roles"
        subtitle="Users, dynamic roles, and permission inheritance. Departments are organisational only."
      />
      <div className="mb-5 flex flex-wrap gap-2">
        {([
          ['users', 'Users'],
          ['roles', 'Roles'],
          ['matrix', 'Permission Matrix'],
        ] as const).map(([id, label]) => (
          <Button key={id} variant={tab === id ? 'primary' : 'secondary'} onClick={() => setTab(id)}>
            {label}
          </Button>
        ))}
      </div>

      {tab === 'users' && (
        <Card className="mb-6">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <div className="text-sm font-semibold">Users</div>
            {canUsersCreate && <Button onClick={openAddUser}>+ Add User</Button>}
          </div>
          <div className="sf-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {state.users.map((user) => {
                  const role = roleById(state, user.roleId)
                  return (
                    <tr key={user.id}>
                      <td>
                        <button type="button" className="text-left" onClick={() => openViewUser(user)}>
                          <div className="font-medium">{user.name}</div>
                          <div className="text-xs text-slate-400">{user.email}</div>
                        </button>
                      </td>
                      <td><RoleBadge name={displayRoleName(state, user)} protectedRole={isOwnerRole(role)} /></td>
                      <td>{departmentName(state, user.departmentId)}</td>
                      <td><StatusBadge status={user.status} /></td>
                      <td>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => openViewUser(user)}>View</Button>
                          {canUsersEdit && <Button size="sm" variant="secondary" onClick={() => openEditUser(user)}>Edit</Button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'roles' && (
        <Card className="mb-6">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <div className="text-sm font-semibold">Roles</div>
            {canRolesCreate && <Button onClick={openAddRole}>+ Add Role</Button>}
          </div>
          <div className="sf-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Description</th>
                  <th>Users</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {state.roles.map((role) => (
                  <tr key={role.id}>
                    <td>
                      <button type="button" className="text-left font-medium" onClick={() => openViewRole(role)}>
                        {role.name}
                        {role.protected && <span className="ml-2 text-xs font-normal text-slate-400">Protected</span>}
                      </button>
                    </td>
                    <td className="max-w-sm text-slate-500">{role.description || '—'}</td>
                    <td>{usersForRole(state, role.id).length}</td>
                    <td><StatusBadge status={role.status} /></td>
                    <td>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => openViewRole(role)}>View</Button>
                        {canRolesEdit && !role.protected && <Button size="sm" variant="secondary" onClick={() => openEditRole(role)}>Edit</Button>}
                        {canPerms && <Button size="sm" variant="secondary" onClick={() => openPermissions(role)}>Permissions</Button>}
                        {role.status === 'active' && canDeactivateRole(state, actor, role) && (
                          <Button size="sm" variant="danger" onClick={() => setDeactivateRole(role)}>Deactivate</Button>
                        )}
                        {role.status === 'inactive' && canRolesEdit && (
                          <Button size="sm" variant="secondary" onClick={() => api.setRoleStatus(role.id, 'active')}>Reactivate</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'matrix' && (
        <Card className="mb-6 overflow-x-auto p-5">
          <div className="mb-3 text-sm font-semibold">Permission matrix</div>
          <p className="mb-4 text-sm text-slate-500">Columns are active roles. Owner always has full access. Changes apply immediately to users assigned to that role.</p>
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr>
                <th className="py-2 text-left text-slate-400">Permission</th>
                {matrixRoles.map((role) => (
                  <th key={role.id} className="py-2 text-slate-400">{role.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((group) => (
                <Fragment key={group.id}>
                  <tr className="border-t border-slate-100 bg-slate-50/80">
                    <td className="py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500" colSpan={matrixRoles.length + 1}>
                      {group.label}
                    </td>
                  </tr>
                  {group.keys.map((perm) => (
                    <tr key={perm} className="border-t border-slate-100">
                      <td className="py-2">{PERMISSION_LABELS[perm]}</td>
                      {matrixRoles.map((role) => {
                        const locked = isOwnerRole(role) || !canPerms
                        const checked = isOwnerRole(role) ? true : Boolean(state.settings.roleMatrix[role.id]?.[perm])
                        return (
                          <td key={role.id} className="py-2">
                            <input
                              type="checkbox"
                              disabled={locked}
                              checked={checked}
                              onChange={(event) => {
                                const matrix = structuredClone(state.settings.roleMatrix)
                                matrix[role.id] = { ...normalizePermissions(matrix[role.id]), [perm]: event.target.checked }
                                api.updateRoleMatrix(matrix)
                              }}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="p-5">
        <div className="mb-3 text-sm font-semibold">Audit log</div>
        {auditRows.length ? (
          <div className="space-y-2 text-sm text-slate-600">
            {auditRows.slice(0, 50).map((row) => (
              <div key={row.id}>
                <span className="font-medium">{auditActionLabel[row.action] ?? row.action}</span>
                {' · '}{row.userName}
                {row.field && row.field !== 'user' && row.field !== 'role' ? ` · ${prettyAuditValue(row.field, row.field)}` : ''}
                {row.oldValue
                  ? ` · ${prettyAuditValue(row.field, row.oldValue)} → ${prettyAuditValue(row.field, row.newValue)}`
                  : row.newValue
                    ? ` · ${prettyAuditValue(row.field, row.newValue)}`
                    : ''}
                {' · '}{row.changedBy}
                {' · '}{formatDateTime(row.changedAt)}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No user or role changes yet.</p>
        )}
      </Card>

      <Modal open={userMode === 'add' || userMode === 'edit'} onClose={() => setUserMode(null)} title={userMode === 'add' ? 'Add User' : 'Edit User'}>
        <div className="space-y-4">
          {userError && <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{userError}</div>}
          <Field label="Name"><Input value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} /></Field>
          <Field label="Email / Username"><Input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} /></Field>
          <Field label="Role">
            <Select
              value={userForm.roleId}
              disabled={selectedUser ? isOwnerUser(state, selectedUser) : false}
              onChange={(e) => setUserForm({ ...userForm, roleId: e.target.value })}
            >
              {userRoleOptions(userForm.roleId).map((role) => (
                <option key={role.id} value={role.id} disabled={role.status !== 'active' && role.id !== userForm.roleId}>
                  {role.name}{role.status !== 'active' ? ' (Inactive)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Department">
            <Select value={userForm.departmentId} onChange={(e) => setUserForm({ ...userForm, departmentId: e.target.value })}>
              {activeDepartments(state)
                .concat(
                  userForm.departmentId && !activeDepartments(state).some((item) => item.id === userForm.departmentId)
                    ? state.departments.filter((item) => item.id === userForm.departmentId)
                    : [],
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={userForm.status} onChange={(e) => setUserForm({ ...userForm, status: e.target.value as UserStatus })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setUserMode(null)}>Cancel</Button>
            <Button onClick={saveUser}>{userMode === 'add' ? 'Add User' : 'Save'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={userMode === 'view'} onClose={() => setUserMode(null)} title="User" width="max-w-xl">
        {selectedUser && (
          <div className="space-y-3 text-sm">
            <div><span className="text-slate-400">Name</span><div className="font-medium">{selectedUser.name}</div></div>
            <div><span className="text-slate-400">Email</span><div>{selectedUser.email}</div></div>
            <div><span className="text-slate-400">Role</span><div><RoleBadge name={displayRoleName(state, selectedUser)} protectedRole={isOwnerUser(state, selectedUser)} /></div></div>
            <div><span className="text-slate-400">Department</span><div>{departmentName(state, selectedUser.departmentId)}</div></div>
            <div><span className="text-slate-400">Status</span><div><StatusBadge status={selectedUser.status} /></div></div>
            <div><span className="text-slate-400">Created</span><div>{formatDateTime(selectedUser.createdAt)}</div></div>
            <div><span className="text-slate-400">Updated</span><div>{formatDateTime(selectedUser.updatedAt)}</div></div>
            <div>
              <div className="mb-2 font-medium">Effective permissions</div>
              <p className="mb-3 text-xs text-slate-400">Inherited from {displayRoleName(state, selectedUser)}. Not stored on the user.</p>
              <PermissionList permissions={effectivePermissions(state, selectedUser)} enabledOnly />
            </div>
            <div className="flex justify-end gap-2 pt-3">
              {selectedUser.status === 'active' && canDeactivateUser(state, actor, selectedUser) && (
                <Button variant="danger" onClick={() => setDeactivateUser(selectedUser)}>Deactivate</Button>
              )}
              {selectedUser.status === 'inactive' && canDeactivateUsers(state, actor) && (
                <Button variant="secondary" onClick={() => { api.updateUser(selectedUser.id, { status: 'active' }); setUserMode(null) }}>Reactivate</Button>
              )}
              <Button variant="secondary" onClick={() => setUserMode(null)}>Close</Button>
              {canUsersEdit && <Button onClick={() => openEditUser(selectedUser)}>Edit</Button>}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={roleMode === 'add' || roleMode === 'edit'} onClose={() => setRoleMode(null)} title={roleMode === 'add' ? 'Add Role' : 'Edit Role'}>
        <div className="space-y-4">
          {roleError && <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{roleError}</div>}
          <Field label="Role Name"><Input value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} /></Field>
          <Field label="Description"><Textarea rows={3} value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} /></Field>
          {roleMode === 'add' && (
            <Field label="Status">
              <Select value={roleForm.status} onChange={(e) => setRoleForm({ ...roleForm, status: e.target.value as RoleStatus })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRoleMode(null)}>Cancel</Button>
            <Button onClick={saveRole}>{roleMode === 'add' ? 'Save' : 'Save'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={roleMode === 'view'} onClose={() => setRoleMode(null)} title={selectedRole?.name ?? 'Role'} width="max-w-xl">
        {selectedRole && (
          <div className="space-y-3 text-sm">
            <div><span className="text-slate-400">Role Name</span><div className="font-medium">{selectedRole.name}</div></div>
            <div><span className="text-slate-400">Description</span><div>{selectedRole.description || '—'}</div></div>
            <div><span className="text-slate-400">Status</span><div><StatusBadge status={selectedRole.status} /></div></div>
            <div><span className="text-slate-400">Users</span><div>{usersForRole(state, selectedRole.id).length}</div></div>
            {usersForRole(state, selectedRole.id).length > 0 && (
              <div className="text-slate-600">{usersForRole(state, selectedRole.id).map((user) => user.name).join(', ')}</div>
            )}
            <div>
              <div className="mb-2 font-medium">Permissions</div>
              <PermissionList permissions={isOwnerRole(selectedRole) ? fullPermissions() : normalizePermissions(state.settings.roleMatrix[selectedRole.id])} />
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <Button variant="secondary" onClick={() => setRoleMode(null)}>Close</Button>
              {canRolesEdit && !selectedRole.protected && <Button onClick={() => openEditRole(selectedRole)}>Edit</Button>}
              {canPerms && <Button onClick={() => openPermissions(selectedRole)}>Permissions</Button>}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={roleMode === 'permissions'} onClose={() => setRoleMode(null)} title={selectedRole ? `Permissions · ${selectedRole.name}` : 'Permissions'} width="max-w-xl">
        {selectedRole && (
          <div className="space-y-4">
            {isOwnerRole(selectedRole) ? (
              <p className="text-sm text-slate-600">Owner always has full access. These permissions cannot be reduced.</p>
            ) : (
              PERMISSION_GROUPS.map((group) => (
                <div key={group.id}>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.label}</div>
                  <div className="space-y-2">
                    {group.keys.map((key) => (
                      <Checkbox
                        key={key}
                        checked={Boolean(permDraft[key])}
                        label={PERMISSION_LABELS[key]}
                        onChange={(value) => setPermDraft({ ...permDraft, [key]: value })}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRoleMode(null)}>Cancel</Button>
              {!isOwnerRole(selectedRole) && canPerms && <Button onClick={savePermissions}>Save Permissions</Button>}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivateUser)}
        title="Deactivate this user?"
        message={deactivateUser ? `${deactivateUser.name} will become Inactive. Historical records keep this name.` : ''}
        confirmLabel="Deactivate"
        tone="danger"
        onClose={() => setDeactivateUser(null)}
        onConfirm={() => {
          if (!deactivateUser) return
          const patch = userMode === 'edit' ? { ...userForm, status: 'inactive' as const } : { status: 'inactive' as const }
          const ok = api.updateUser(deactivateUser.id, patch)
          if (ok) {
            setDeactivateUser(null)
            setUserMode(null)
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(deactivateRole)}
        title={deactivateRole ? `Deactivate ${deactivateRole.name}?` : 'Deactivate role?'}
        message={
          deactivateRole
            ? (usersForRole(state, deactivateRole.id).length
              ? `This role is currently assigned to ${usersForRole(state, deactivateRole.id).length} users. They will keep this role. It cannot be assigned to new users until reactivated.`
              : `${deactivateRole.name} will become Inactive and cannot be assigned to new users.`)
            : ''
        }
        confirmLabel="Deactivate"
        tone="danger"
        onClose={() => setDeactivateRole(null)}
        onConfirm={() => {
          if (!deactivateRole) return
          const ok = api.setRoleStatus(deactivateRole.id, 'inactive')
          if (ok) setDeactivateRole(null)
        }}
      />
    </div>
  )
}
