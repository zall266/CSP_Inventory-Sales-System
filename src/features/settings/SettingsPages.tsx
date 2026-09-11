import { useRef, useState } from 'react'
import { Button, Card, Field, Input, PageHeader, Select, Textarea, Toggle } from '@/components/ui'
import { useApi, useStore } from '@/store/hooks'
import type { PaymentMethod } from '@/types'

export { UsersSettingsPage } from './UsersRolesPage'

const LOGO_MAX_BYTES = 5 * 1024 * 1024
const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'])
const LOGO_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.svg']

function isAllowedLogo(file: File) {
  const name = file.name.toLowerCase()
  const extOk = LOGO_EXTENSIONS.some((ext) => name.endsWith(ext))
  if (LOGO_TYPES.has(file.type)) return true
  if (!file.type || file.type === 'application/octet-stream') return extOk
  return false
}

function CompanyLogoField({ value, onChange }: { value: string; onChange: (logoUrl: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')

  const pick = (file: File | undefined) => {
    setError('')
    if (!file) return
    if (!isAllowedLogo(file)) {
      setError('Use a PNG, JPG, WebP or SVG image.')
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      setError('Logo must be 5 MB or smaller.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      if (!result.startsWith('data:image/')) {
        setError('That file could not be read as an image.')
        return
      }
      onChange(result)
    }
    reader.onerror = () => setError('That file could not be read as an image.')
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-slate-900">Company Branding</div>
      <div className="text-xs font-medium text-slate-500">Company Logo</div>
      {value ? (
        <div className="flex max-w-full flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex h-[100px] w-[240px] max-w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-3">
            <img src={value} alt="Company logo" className="max-h-[100px] max-w-[240px] object-contain" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-slate-700">Uploaded</div>
            <p className="mt-1 text-xs text-slate-400">Recommended: PNG with transparent background.</p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-400">
          No company logo uploaded
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
          {value ? 'Replace Logo' : 'Upload Logo'}
        </Button>
        {value ? (
          <Button type="button" variant="ghost" onClick={() => { setError(''); onChange('') }}>
            Remove Logo
          </Button>
        ) : null}
      </div>
      {!value ? <p className="text-xs text-slate-400">Recommended: PNG with transparent background.</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
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
        <CompanyLogoField value={s.logoUrl ?? ''} onChange={(logoUrl) => api.updateSettings({ logoUrl })} />
        <Field label="Business name"><Input value={s.businessName} onChange={(e) => api.updateSettings({ businessName: e.target.value })} /></Field>
        <Field label="Legal name"><Input value={s.legalName ?? ''} onChange={(e) => api.updateSettings({ legalName: e.target.value })} /></Field>
        <Field label="Phone"><Input value={s.phone} onChange={(e) => api.updateSettings({ phone: e.target.value })} /></Field>
        <Field label="Email"><Input value={s.email} onChange={(e) => api.updateSettings({ email: e.target.value })} /></Field>
        <Field label="Website"><Input value={s.website ?? ''} placeholder="Optional" onChange={(e) => api.updateSettings({ website: e.target.value })} /></Field>
        <Field label="Registration number"><Input value={s.registrationNo ?? ''} placeholder="Leave blank if not configured" onChange={(e) => api.updateSettings({ registrationNo: e.target.value })} /></Field>
        <Field label="Address"><Input value={s.address} onChange={(e) => api.updateSettings({ address: e.target.value })} /></Field>
        <Field label="Payment terms"><Input value={s.paymentTerms ?? ''} onChange={(e) => api.updateSettings({ paymentTerms: e.target.value })} /></Field>
        <Field label="Bank name"><Input value={s.bankName ?? ''} placeholder="Optional" onChange={(e) => api.updateSettings({ bankName: e.target.value })} /></Field>
        <Field label="Bank account"><Input value={s.bankAccount ?? ''} placeholder="Optional" onChange={(e) => api.updateSettings({ bankAccount: e.target.value })} /></Field>
        <Field label="Document terms"><Textarea rows={4} value={s.documentTerms ?? ''} onChange={(e) => api.updateSettings({ documentTerms: e.target.value })} /></Field>
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
