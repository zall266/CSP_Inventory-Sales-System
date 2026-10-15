import { Button, Card, Field, Input, PageHeader, Select, Toggle } from '@/components/ui'
import { useApi, useStore } from '@/store/hooks'
import type { PaymentMethod, PermissionKey, UserRole } from '@/types'
import { formatDateTime } from '@/utils/format'
import { StatusBadge } from '@/components/ui'

const permissionLabels: Record<PermissionKey, string> = {
  dashboard: 'View dashboard',
  pos: 'POS',
  create_sale: 'Create sale',
  void_sale: 'Void sale',
  create_purchase: 'Create purchase',
  adjust_stock: 'Adjust stock',
  transfer_stock: 'Transfer stock',
  view_reports: 'View reports',
  manage_settings: 'Manage settings',
  manage_users: 'Manage users',
}

const roles: UserRole[] = ['owner', 'admin', 'manager', 'staff', 'cashier', 'warehouse']
const permissions = Object.keys(permissionLabels) as PermissionKey[]

export function UsersSettingsPage() {
  const state = useStore()
  const api = useApi()
  return (
    <div>
      <PageHeader title="Users & Roles" subtitle="Prototype directory and permission matrix." actions={<Button onClick={() => api.openModal('user')}>Create user</Button>} />
      <Card className="mb-6">
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
              </tr>
            </thead>
            <tbody>
              {state.users.map((u) => (
                <tr key={u.id} className="cursor-default">
                  <td className="font-medium">{u.name}</td>
                  <td>{u.email}</td>
                  <td className="capitalize">{u.role}</td>
                  <td><StatusBadge status={u.status} /></td>
                  <td>{u.lastLogin === 'Never' ? 'Never' : formatDateTime(u.lastLogin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="overflow-x-auto p-5">
        <div className="mb-3 text-sm font-semibold">Role permission matrix</div>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="py-2 text-left text-slate-400">Permission</th>
              {roles.map((role) => (
                <th key={role} className="py-2 capitalize text-slate-400">{role}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {permissions.map((perm) => (
              <tr key={perm} className="border-t border-slate-100">
                <td className="py-2">{permissionLabels[perm]}</td>
                {roles.map((role) => (
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
        <div className="mt-3 text-xs text-slate-400">Visual only in this prototype — permissions are not enforced.</div>
      </Card>
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
