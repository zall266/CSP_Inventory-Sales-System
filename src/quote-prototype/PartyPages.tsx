import { useEffect, useMemo, useState } from 'react'
import { Button, Card, ConfirmDialog, Field, FilterRow, Input, Modal, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui'
import { formatMoney } from '@/utils/format'
import { quoteApi, useQuoteStore } from './store'
import type { QuoteCustomer, QuoteProduct } from './types'

export function QuoteCustomersPage() {
  const { state } = useQuoteStore()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Partial<QuoteCustomer> | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const rows = useMemo(
    () =>
      state.customers.filter((item) => `${item.name} ${item.company} ${item.phone}`.toLowerCase().includes(query.toLowerCase())),
    [state.customers, query],
  )
  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Reuse these records on quotations. No duplicate customer list."
        actions={<Button onClick={() => setEditing({ name: '', company: '', address: '', phone: '', email: '' })}>+ Add Customer</Button>}
      />
      <FilterRow>
        <Input placeholder="Search customer" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div /><div /><div />
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Company</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Total Quotations</th>
                <th>Total Sales</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const quotes = state.quotations.filter((item) => item.customerId === row.id)
                const sales = quotes.filter((item) => item.status === 'accepted').reduce((sum, item) => sum + item.total, 0)
                return (
                  <tr key={row.id} className="cursor-default">
                    <td className="font-medium">{row.name}</td>
                    <td>{row.company}</td>
                    <td>{row.phone}</td>
                    <td>{row.email || '—'}</td>
                    <td>{quotes.length}</td>
                    <td className="tabular">{formatMoney(sales)}</td>
                    <td className="space-x-3 text-right text-xs">
                      <button type="button" className="text-indigo-700" onClick={() => setEditing(row)}>Edit</button>
                      <button type="button" className="text-rose-600" onClick={() => setDeleteId(row.id)}>Delete</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <CustomerModal value={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={Boolean(deleteId)}
        title="Delete customer?"
        message="This cannot be undone if the customer has no quotations."
        confirmLabel="Delete"
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) quoteApi.deleteCustomer(deleteId)
          setDeleteId(null)
        }}
      />
    </div>
  )
}

function CustomerModal({ value, onClose }: { value: Partial<QuoteCustomer> | null; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', company: '', address: '', phone: '', email: '' })
  const open = Boolean(value)
  useEffect(() => {
    if (value) setForm({ name: value.name ?? '', company: value.company ?? '', address: value.address ?? '', phone: value.phone ?? '', email: value.email ?? '' })
  }, [value])
  return (
    <Modal open={open} onClose={onClose} title={value?.id ? 'Edit Customer' : 'Add Customer'}>
      <div className="space-y-3">
        <Field label="Customer Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Company"><Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
        <Field label="Address"><Textarea rows={3} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!form.name.trim()) return
              quoteApi.saveCustomer({ ...form, id: value?.id, company: form.company || form.name })
              onClose()
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function QuoteProductsPage() {
  const { state } = useQuoteStore()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Partial<QuoteProduct> | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const rows = state.products.filter((item) => `${item.name} ${item.code}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Catalog used on quotation line items."
        actions={<Button onClick={() => setEditing({ name: '', code: '', description: '', unit: 'PCS', sellingPrice: 0, taxRate: 0, status: 'active' })}>+ Add Product</Button>}
      />
      <FilterRow>
        <Input placeholder="Search product or code" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div /><div /><div />
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Code</th>
                <th>Unit</th>
                <th>Selling Price</th>
                <th>Tax</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="cursor-default">
                  <td>
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-slate-400">{row.description}</div>
                  </td>
                  <td>{row.code}</td>
                  <td>{row.unit}</td>
                  <td className="tabular">{formatMoney(row.sellingPrice)}</td>
                  <td>{row.taxRate}%</td>
                  <td><StatusBadge status={row.status} /></td>
                  <td className="space-x-3 text-right text-xs">
                    <button type="button" className="text-indigo-700" onClick={() => setEditing(row)}>Edit</button>
                    <button type="button" className="text-rose-600" onClick={() => setDeleteId(row.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <ProductModal value={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={Boolean(deleteId)}
        title="Delete product?"
        message="Existing quotations keep the saved product name."
        confirmLabel="Delete"
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) quoteApi.deleteProduct(deleteId)
          setDeleteId(null)
        }}
      />
    </div>
  )
}

function ProductModal({ value, onClose }: { value: Partial<QuoteProduct> | null; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', code: '', description: '', unit: 'PCS', sellingPrice: 0, taxRate: 0, status: 'active' as 'active' | 'inactive' })
  const open = Boolean(value)
  useEffect(() => {
    if (value) {
      setForm({
        name: value.name ?? '',
        code: value.code ?? '',
        description: value.description ?? '',
        unit: value.unit ?? 'PCS',
        sellingPrice: value.sellingPrice ?? 0,
        taxRate: value.taxRate ?? 0,
        status: value.status ?? 'active',
      })
    }
  }, [value])
  return (
    <Modal open={open} onClose={onClose} title={value?.id ? 'Edit Product' : 'Add Product'}>
      <div className="space-y-3">
        <Field label="Product Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Product Code / SKU"><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
        <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit"><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field>
          <Field label="Selling Price"><Input type="number" step="0.01" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: Number(e.target.value) })} /></Field>
          <Field label="Tax %"><Input type="number" step="0.01" value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: Number(e.target.value) })} /></Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!form.name.trim()) return
              quoteApi.saveProduct({ ...form, id: value?.id })
              onClose()
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function QuoteSettingsPage() {
  const { state } = useQuoteStore()
  const s = state.settings
  const readFile = (file: File | undefined, key: 'logoDataUrl' | 'duitNowQrDataUrl') => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => quoteApi.updateSettings({ [key]: String(reader.result ?? '') })
    reader.readAsDataURL(file)
  }
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" subtitle="Company, numbering, payment and default terms. Changes appear on the next preview." />
      <Card className="mb-4 space-y-3 p-5">
        <div className="text-sm font-semibold">Company Information</div>
        <Field label="Company Name"><Input value={s.companyName} onChange={(e) => quoteApi.updateSettings({ companyName: e.target.value })} /></Field>
        <Field label="Registration No"><Input value={s.registrationNo} onChange={(e) => quoteApi.updateSettings({ registrationNo: e.target.value })} /></Field>
        <Field label="Address"><Textarea rows={3} value={s.address} onChange={(e) => quoteApi.updateSettings({ address: e.target.value })} /></Field>
        <Field label="Phone"><Input value={s.phone} onChange={(e) => quoteApi.updateSettings({ phone: e.target.value })} /></Field>
        <Field label="Email"><Input value={s.email} onChange={(e) => quoteApi.updateSettings({ email: e.target.value })} /></Field>
        <Field label="Website"><Input value={s.website} onChange={(e) => quoteApi.updateSettings({ website: e.target.value })} /></Field>
        <Field label="Logo">
          <input type="file" accept="image/*" onChange={(e) => readFile(e.target.files?.[0], 'logoDataUrl')} />
        </Field>
      </Card>
      <Card className="mb-4 space-y-3 p-5">
        <div className="text-sm font-semibold">Quotation Settings</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quotation Prefix"><Input value={s.quotationPrefix} onChange={(e) => quoteApi.updateSettings({ quotationPrefix: e.target.value })} /></Field>
          <Field label="Next Number"><Input type="number" value={s.nextNumber} onChange={(e) => quoteApi.updateSettings({ nextNumber: Number(e.target.value) })} /></Field>
          <Field label="Default Validity Days"><Input type="number" value={s.validityDays} onChange={(e) => quoteApi.updateSettings({ validityDays: Number(e.target.value) })} /></Field>
        </div>
      </Card>
      <Card className="mb-4 space-y-3 p-5">
        <div className="text-sm font-semibold">Payment Information</div>
        <Field label="Payment Method"><Textarea rows={2} value={s.paymentMethod} onChange={(e) => quoteApi.updateSettings({ paymentMethod: e.target.value })} /></Field>
        <Field label="Bank Name"><Input value={s.bankName} onChange={(e) => quoteApi.updateSettings({ bankName: e.target.value })} /></Field>
        <Field label="Account Holder"><Input value={s.accountHolder} onChange={(e) => quoteApi.updateSettings({ accountHolder: e.target.value })} /></Field>
        <Field label="Account Number"><Input value={s.accountNumber} onChange={(e) => quoteApi.updateSettings({ accountNumber: e.target.value })} /></Field>
        <Field label="DuitNow QR">
          <input type="file" accept="image/*" onChange={(e) => readFile(e.target.files?.[0], 'duitNowQrDataUrl')} />
        </Field>
      </Card>
      <Card className="space-y-3 p-5">
        <div className="text-sm font-semibold">Default Terms & Conditions</div>
        <Field label="Default Notes"><Textarea rows={3} value={s.defaultNotes} onChange={(e) => quoteApi.updateSettings({ defaultNotes: e.target.value })} /></Field>
        <Field label="Default Terms & Conditions"><Textarea rows={3} value={s.defaultTerms} onChange={(e) => quoteApi.updateSettings({ defaultTerms: e.target.value })} /></Field>
        <Button variant="secondary" onClick={() => quoteApi.reset()}>Reset prototype data</Button>
      </Card>
    </div>
  )
}
