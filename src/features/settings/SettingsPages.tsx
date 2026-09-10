import { Button, Card, Field, Input, PageHeader, Select, Toggle } from '@/components/ui'
import { useApi, useStore } from '@/store/hooks'
import type { PaymentMethod } from '@/types'

export { UsersSettingsPage } from './UsersRolesPage'

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
