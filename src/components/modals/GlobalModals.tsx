import { useEffect, useState } from 'react'
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui'
import { useApi, useStore } from '@/store/hooks'
import { ProductForm } from '@/features/products/ProductForm'
import { paymentLabel } from '@/components/ProductMark'
import { BomModal } from '@/features/manufacturing/BomPages'
import { assignableRoles, isOwnerRole } from '@/features/settings/permissions'
import type { ExpenseCategory, PaymentMethod, UserStatus } from '@/types'

const methods: PaymentMethod[] = ['cash', 'bank_transfer', 'duitnow', 'card', 'ewallet']
const expenseCats: ExpenseCategory[] = ['Rent', 'Utilities', 'Salary', 'Transport', 'Packaging', 'Marketing', 'Maintenance', 'Office', 'Other']

export function GlobalModals() {
  const modal = useStore().ui.quickModal
  const api = useApi()
  const close = () => api.closeModal()
  return (
    <>
      <ProductModal open={modal === 'product'} onClose={close} />
      <CustomerModal open={modal === 'customer'} onClose={close} />
      <SupplierModal open={modal === 'supplier'} onClose={close} />
      <ExpenseModal open={modal === 'expense'} onClose={close} />
      <UserModal open={modal === 'user'} onClose={close} />
      <PaymentModal open={modal === 'payment'} onClose={close} />
      <BomModal open={modal === 'bom'} onClose={close} />
    </>
  )
}

export function ProductModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi()
  if (!open) return null
  return (
    <Modal open={open} onClose={onClose} title="Add Product" width="max-w-2xl">
      <ProductForm
        submitLabel="Save product"
        onCancel={onClose}
        onSubmit={(input) => {
          const created = api.createProduct(input)
          if (!created) return false
          onClose()
        }}
      />
    </Modal>
  )
}

function CustomerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi()
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '' })
  return (
    <Modal open={open} onClose={onClose} title="Add Customer">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          api.createCustomer(form)
          setForm({ name: '', phone: '', email: '', address: '' })
          onClose()
        }}
      >
        <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Address"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save customer</Button>
        </div>
      </form>
    </Modal>
  )
}

function SupplierModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi()
  const [form, setForm] = useState({ name: '', contact: '', phone: '', email: '' })
  return (
    <Modal open={open} onClose={onClose} title="Add Supplier">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          api.createSupplier(form)
          setForm({ name: '', contact: '', phone: '', email: '' })
          onClose()
        }}
      >
        <Field label="Supplier"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Contact"><Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save supplier</Button>
        </div>
      </form>
    </Modal>
  )
}

function ExpenseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi()
  const [form, setForm] = useState({
    date: '2026-09-10',
    category: 'Other' as ExpenseCategory,
    description: '',
    amount: 0,
    paymentMethod: 'cash' as PaymentMethod,
    notes: '',
  })
  return (
    <Modal open={open} onClose={onClose} title="Add Expense">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          const created = api.createExpense({ ...form, date: `${form.date}T12:00:00+08:00` })
          if (created) onClose()
        }}
      >
        <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label="Category">
          <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })}>
            {expenseCats.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Description"><Input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Amount"><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></Field>
        <Field label="Payment method">
          <Select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value as PaymentMethod })}>
            {methods.map((m) => <option key={m} value={m}>{paymentLabel(m)}</option>)}
          </Select>
        </Field>
        <Field label="Notes"><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save expense</Button>
        </div>
      </form>
    </Modal>
  )
}

function UserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useStore()
  const api = useApi()
  const roles = assignableRoles(state).filter((role) => !isOwnerRole(role))
  const departments = state.departments.filter((item) => item.status === 'active')
  const [form, setForm] = useState({
    name: '',
    email: '',
    roleId: roles[0]?.id ?? '',
    departmentId: departments[0]?.id ?? '',
    status: 'active' as UserStatus,
  })
  return (
    <Modal open={open} onClose={onClose} title="Add User">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          const created = api.createUser(form)
          if (created) onClose()
        }}
      >
        <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Email"><Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Role">
          <Select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Department">
          <Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            {departments.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
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
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Add User</Button>
        </div>
      </form>
    </Modal>
  )
}

function PaymentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useStore()
  const api = useApi()
  const receivables = state.sales.filter((s) => s.balance > 0 && s.status !== 'voided')
  const payables = state.purchases.filter((p) => p.balance > 0)
  const [kind, setKind] = useState<'customer' | 'supplier'>('customer')
  const [invoiceId, setInvoiceId] = useState(receivables[0]?.id ?? '')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [amount, setAmount] = useState(0)
  useEffect(() => {
    if (!open) return
    if (state.ui.payInvoiceId) {
      setKind('customer')
      setInvoiceId(state.ui.payInvoiceId)
    }
  }, [open, state.ui.payInvoiceId])
  const options = kind === 'customer' ? receivables : payables
  const selected = kind === 'customer'
    ? receivables.find((s) => s.id === invoiceId)
    : payables.find((p) => p.id === invoiceId)

  return (
    <Modal open={open} onClose={onClose} title="Record payment">
      <div className="space-y-4">
        <Field label="Type">
          <Select
            value={kind}
            onChange={(e) => {
              const next = e.target.value as 'customer' | 'supplier'
              setKind(next)
              setInvoiceId(next === 'customer' ? receivables[0]?.id ?? '' : payables[0]?.id ?? '')
            }}
          >
            <option value="customer">Customer payment</option>
            <option value="supplier">Supplier payment</option>
          </Select>
        </Field>
        <Field label="Invoice">
          <Select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            {options.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {'invoiceNo' in doc ? doc.invoiceNo : doc.purchaseNo} · balance {doc.balance}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {methods.map((m) => <option key={m} value={m}>{paymentLabel(m)}</option>)}
          </Select>
        </Field>
        <Field label="Amount">
          <Input
            type="number"
            step="0.01"
            value={amount || selected?.balance || ''}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              const ok = api.recordPayment({
                kind,
                invoiceId,
                method,
                amount: amount || selected?.balance || 0,
              })
              if (ok) onClose()
            }}
          >
            Record payment
          </Button>
        </div>
      </div>
    </Modal>
  )
}
