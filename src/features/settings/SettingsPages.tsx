import { useState } from 'react'
import { Badge, Button, Card, ConfirmDialog, Field, Input, Modal, PageHeader, Select, StatusBadge, Toggle } from '@/components/ui'
import { useApi, useStore } from '@/store/hooks'
import type { PaymentMethod, PermissionKey, User, UserRole, UserStatus } from '@/types'
import { formatDateTime } from '@/utils/format'
import {
  actorUser,
  canDeactivateUser,
  canManageUsers,
  managedRoleLabel,
  MANAGED_ROLES,
} from './userPermissions'

const permissionLabels: Record<PermissionKey, string> = {
  dashboard: 'View dashboard',
  pos: 'POS',
  create_sale: 'Create sale',
  void_sale: 'Void sale',
  create_purchase: 'Create purchase',
  create_production: 'Create production',
  edit_completed_production: 'Edit completed production',
  adjust_stock: 'Adjust stock',
  transfer_stock: 'Transfer stock',
  view_reports: 'View reports',
  manage_settings: 'Manage settings',
  manage_users: 'Manage users',
}

const matrixRoles: UserRole[] = ['staff', 'manager', 'admin', 'owner']
const permissions = Object.keys(permissionLabels) as PermissionKey[]

function prettyAuditValue(field: string, value: string) {
  if (field === 'role') return managedRoleLabel(value as UserRole)
  if (field === 'status' && value === 'active') return 'Active'
  if (field === 'status' && value === 'inactive') return 'Inactive'
  return value
}

const auditActionLabel: Record<string, string> = {
  user_created: 'User Created',
  user_updated: 'User Updated',
  role_changed: 'Role Changed',
  user_deactivated: 'User Deactivated',
  user_reactivated: 'User Reactivated',
}

function RoleBadge({ role }: { role: UserRole }) {
  const tone = role === 'owner' || role === 'admin' ? 'indigo' : role === 'manager' ? 'sky' : 'slate'
  return <Badge tone={tone}>{managedRoleLabel(role)}</Badge>
}

type UserForm = { name: string; email: string; role: UserRole; status: UserStatus }

export function UsersSettingsPage() {
  const state = useStore()
  const api = useApi()
  const actor = actorUser(state)
  const allowed = canManageUsers(actor.role)
  const [mode, setMode] = useState<'add' | 'edit' | 'view' | null>(null)
  const [selected, setSelected] = useState<User | null>(null)
  const [form, setForm] = useState<UserForm>({ name: '', email: '', role: 'staff', status: 'active' })
  const [deactivate, setDeactivate] = useState<User | null>(null)

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Permission denied" subtitle="Staff and Supervisor cannot manage users. Ask an Admin or Owner." />
      </div>
    )
  }

  const openAdd = () => {
    setSelected(null)
    setForm({ name: '', email: '', role: 'staff', status: 'active' })
    setMode('add')
  }
  const openEdit = (user: User) => {
    setSelected(user)
    setForm({ name: user.name, email: user.email, role: user.role, status: user.status })
    setMode('edit')
  }
  const openView = (user: User) => {
    setSelected(user)
    setMode('view')
  }
  const save = () => {
    if (mode === 'add') {
      const created = api.createUser(form)
      if (created) setMode(null)
      return
    }
    if (mode === 'edit' && selected) {
      if (form.status === 'inactive' && selected.status === 'active') {
        setDeactivate(selected)
        return
      }
      const ok = api.updateUser(selected.id, form)
      if (ok) setMode(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Users & Roles"
        subtitle="Directory, roles, and user-management audit. Names on historical records stay unchanged."
        actions={<Button onClick={openAdd}>Add User</Button>}
      />
      <Card className="mb-6">
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {state.users.map((u) => (
                <tr key={u.id} className="cursor-default">
                  <td>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-slate-400">{u.email}</div>
                  </td>
                  <td><RoleBadge role={u.role} /></td>
                  <td><StatusBadge status={u.status} /></td>
                  <td>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => openView(u)}>View</Button>
                      <Button size="sm" variant="secondary" onClick={() => openEdit(u)}>Edit</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="mb-6 overflow-x-auto p-5">
        <div className="mb-3 text-sm font-semibold">Role permission matrix</div>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="py-2 text-left text-slate-400">Permission</th>
              {matrixRoles.map((role) => (
                <th key={role} className="py-2 text-slate-400">{managedRoleLabel(role)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {permissions.map((perm) => (
              <tr key={perm} className="border-t border-slate-100">
                <td className="py-2">{permissionLabels[perm]}</td>
                {matrixRoles.map((role) => (
                  <td key={role} className="py-2">
                    <input
                      type="checkbox"
                      checked={state.settings.roleMatrix[role][perm]}
                      onChange={(e) => {
                        const matrix = structuredClone(state.settings.roleMatrix)
                        matrix[role][perm] = e.target.checked
                        api.updateRoleMatrix(matrix)
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="p-5">
        <div className="mb-3 text-sm font-semibold">User management audit</div>
        {state.userAuditLogs?.length ? (
          <div className="space-y-2 text-sm text-slate-600">
            {state.userAuditLogs.slice(0, 40).map((row) => (
              <div key={row.id}>
                <span className="font-medium">{auditActionLabel[row.action] ?? row.action}</span>
                {' · '}{row.userName}
                {row.oldValue ? ` · ${prettyAuditValue(row.field, row.oldValue)} → ${prettyAuditValue(row.field, row.newValue)}` : ` · ${prettyAuditValue(row.field, row.newValue)}`}
                {' · '}{row.changedBy}
                {' · '}{formatDateTime(row.changedAt)}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No user-management actions yet.</p>
        )}
      </Card>

      <Modal open={mode === 'add' || mode === 'edit'} onClose={() => setMode(null)} title={mode === 'add' ? 'Add User' : 'Edit User'}>
        <div className="space-y-4">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
              {MANAGED_ROLES.filter((role) => actor.role === 'owner' || role.value !== 'owner' || form.role === 'owner')
                .concat(
                  form.role === 'cashier' || form.role === 'warehouse'
                    ? [{ value: form.role, label: managedRoleLabel(form.role) }]
                    : [],
                )
                .map((role) => (
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as UserStatus })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode(null)}>Cancel</Button>
            <Button onClick={save}>{mode === 'add' ? 'Add User' : 'Save'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={mode === 'view'} onClose={() => setMode(null)} title="User">
        {selected && (
          <div className="space-y-2 text-sm">
            <div><span className="text-slate-400">Name</span><div className="font-medium">{selected.name}</div></div>
            <div><span className="text-slate-400">Email</span><div>{selected.email}</div></div>
            <div><span className="text-slate-400">Role</span><div><RoleBadge role={selected.role} /></div></div>
            <div><span className="text-slate-400">Status</span><div><StatusBadge status={selected.status} /></div></div>
            <div><span className="text-slate-400">Created</span><div>{formatDateTime(selected.createdAt)}</div></div>
            <div><span className="text-slate-400">Updated</span><div>{formatDateTime(selected.updatedAt)}</div></div>
            <div className="flex justify-end gap-2 pt-3">
              {selected.status === 'active' && canDeactivateUser(actor, selected, state.users) && (
                <Button variant="danger" onClick={() => setDeactivate(selected)}>Deactivate</Button>
              )}
              <Button variant="secondary" onClick={() => setMode(null)}>Close</Button>
              <Button onClick={() => openEdit(selected)}>Edit</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivate)}
        title="Deactivate this user?"
        message={deactivate ? `${deactivate.name} will become Inactive. Historical production and stock records keep this name.` : ''}
        confirmLabel="Deactivate"
        tone="danger"
        onClose={() => setDeactivate(null)}
        onConfirm={() => {
          if (!deactivate) return
          const patch = mode === 'edit' ? { ...form, status: 'inactive' as const } : { status: 'inactive' as const }
          const ok = api.updateUser(deactivate.id, patch)
          if (ok) {
            setDeactivate(null)
            setMode(null)
          }
        }}
      />
    </div>
  )
}

export function BusinessSettingsPage() {
  const state = useStore()
  const api = useApi()
  const s = state.settings
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Business Settings" subtitle="Branding and company profile for documents." />
      <Card className="space-y-4 p-6">
        <Field label="Business name"><Input value={s.businessName} onChange={(e) => api.updateSettings({ businessName: e.target.value })} /></Field>
        <Field label="Logo"><div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-400">Preview only — logo upload will be enabled in production.</div></Field>
        <Field label="Phone"><Input value={s.phone} onChange={(e) => api.updateSettings({ phone: e.target.value })} /></Field>
        <Field label="Email"><Input value={s.email} onChange={(e) => api.updateSettings({ email: e.target.value })} /></Field>
        <Field label="Address"><Input value={s.address} onChange={(e) => api.updateSettings({ address: e.target.value })} /></Field>
        <Field label="Currency">
          <Select value={s.currency} onChange={(e) => api.updateSettings({ currency: e.target.value })}>
            <option value="MYR">MYR (RM)</option>
            <option value="SGD">SGD</option>
            <option value="USD">USD</option>
          </Select>
        </Field>
        <Button variant="secondary" onClick={() => api.resetDemo()}>Reset demo data</Button>
      </Card>
    </div>
  )
}

export function InventorySettingsPage() {
  const state = useStore()
  const api = useApi()
  const s = state.settings
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Inventory Settings" subtitle="Default warehouse, costing and tracking." />
      <Card className="space-y-5 p-6">
        <Field label="Default warehouse">
          <Select value={s.defaultWarehouseId} onChange={(e) => api.updateSettings({ defaultWarehouseId: e.target.value })}>
            {state.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        <Toggle checked={s.allowNegativeStock} onChange={(allowNegativeStock) => api.updateSettings({ allowNegativeStock })} label="Allow negative stock" />
        <Field label="Costing method">
          <Select value={s.costingMethod} onChange={(e) => api.updateSettings({ costingMethod: e.target.value as 'average' | 'fifo' })}>
            <option value="average">Average cost</option>
            <option value="fifo">FIFO</option>
          </Select>
        </Field>
        <Toggle checked={s.batchTracking} onChange={(batchTracking) => api.updateSettings({ batchTracking })} label="Batch tracking" />
        <Toggle checked={s.expiryTracking} onChange={(expiryTracking) => api.updateSettings({ expiryTracking })} label="Expiry tracking" />
      </Card>
    </div>
  )
}

export function SalesSettingsPage() {
  const state = useStore()
  const api = useApi()
  const s = state.settings
  const methods: PaymentMethod[] = ['cash', 'bank_transfer', 'duitnow', 'card', 'ewallet']
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Sales Settings" subtitle="POS defaults, discounts, returns and payments." />
      <Card className="space-y-5 p-6">
        <Field label="Default customer">
          <Select value={s.defaultCustomerId} onChange={(e) => api.updateSettings({ defaultCustomerId: e.target.value })}>
            {state.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Toggle checked={s.allowDiscount} onChange={(allowDiscount) => api.updateSettings({ allowDiscount })} label="Allow discount" />
        <Toggle checked={s.allowReturns} onChange={(allowReturns) => api.updateSettings({ allowReturns })} label="Allow returns" />
        <div>
          <div className="mb-2 text-xs font-medium text-slate-500">Enabled payment methods</div>
          <div className="space-y-2">
            {methods.map((m) => (
              <Toggle
                key={m}
                checked={s.enabledPaymentMethods.includes(m)}
                label={m.replace('_', ' ')}
                onChange={(checked) => {
                  const enabled = checked
                    ? [...s.enabledPaymentMethods, m]
                    : s.enabledPaymentMethods.filter((x) => x !== m)
                  api.updateSettings({ enabledPaymentMethods: enabled })
                }}
              />
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}
