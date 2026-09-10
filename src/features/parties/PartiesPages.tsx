import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Card, FilterRow, Input, KpiCard, PageHeader, StatusBadge } from '@/components/ui'
import {
  customerOutstanding,
  customerSalesTotal,
  supplierOutstanding,
  supplierPurchaseTotal,
  useApi,
  useStore,
} from '@/store/hooks'
import { formatDate, formatMoney } from '@/utils/format'

export function CustomersPage() {
  const state = useStore()
  const api = useApi()
  const [query, setQuery] = useState('')
  const rows = useMemo(
    () => state.customers.filter((c) => `${c.name} ${c.phone}`.toLowerCase().includes(query.toLowerCase())),
    [state.customers, query],
  )
  const outstanding = rows.reduce((s, c) => s + customerOutstanding(state, c.id), 0)
  return (
    <div>
      <PageHeader title="Customers" subtitle="Accounts, outstanding balances and sales history." actions={<Button onClick={() => api.openModal('customer')}><Plus size={16} /> Add customer</Button>} />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total customers" value={String(state.customers.length)} />
        <KpiCard label="Active" value={String(state.customers.filter((c) => c.status === 'active').length)} />
        <KpiCard label="Outstanding" value={formatMoney(outstanding, { compact: true })} tone="warning" />
        <KpiCard label="Total sales" value={formatMoney(state.sales.filter((s) => s.status !== 'voided').reduce((s, x) => s + x.total, 0), { compact: true })} />
      </div>
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
                <th>Phone</th>
                <th>Sales</th>
                <th>Outstanding</th>
                <th>Last sale</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const sales = state.sales.filter((s) => s.customerId === c.id)
                const last = sales.slice().sort((a, b) => b.date.localeCompare(a.date))[0]
                return (
                  <tr key={c.id} onClick={() => api.openDrawer({ type: 'customer', id: c.id })}>
                    <td className="font-medium">{c.name}</td>
                    <td>{c.phone}</td>
                    <td className="tabular">{formatMoney(customerSalesTotal(state, c.id))}</td>
                    <td className="tabular">{formatMoney(customerOutstanding(state, c.id))}</td>
                    <td>{last ? formatDate(last.date) : '—'}</td>
                    <td><StatusBadge status={c.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export function SuppliersPage() {
  const state = useStore()
  const api = useApi()
  const [query, setQuery] = useState('')
  const rows = useMemo(
    () => state.suppliers.filter((s) => `${s.name} ${s.contact}`.toLowerCase().includes(query.toLowerCase())),
    [state.suppliers, query],
  )
  const overdue = state.purchases.filter((p) => p.balance > 0).length
  return (
    <div>
      <PageHeader title="Suppliers" subtitle="Vendor accounts and payables." actions={<Button onClick={() => api.openModal('supplier')}><Plus size={16} /> Add supplier</Button>} />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Suppliers" value={String(state.suppliers.length)} />
        <KpiCard label="Purchases" value={formatMoney(state.purchases.reduce((s, p) => s + p.total, 0), { compact: true })} />
        <KpiCard label="Payables" value={formatMoney(state.purchases.reduce((s, p) => s + p.balance, 0), { compact: true })} />
        <KpiCard label="Overdue" value={String(overdue)} tone={overdue ? 'warning' : 'default'} />
      </div>
      <FilterRow>
        <Input placeholder="Search supplier" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div /><div /><div />
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Contact</th>
                <th>Purchases</th>
                <th>Payable</th>
                <th>Last purchase</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const purchases = state.purchases.filter((p) => p.supplierId === s.id)
                const last = purchases.slice().sort((a, b) => b.date.localeCompare(a.date))[0]
                return (
                  <tr key={s.id} onClick={() => api.openDrawer({ type: 'supplier', id: s.id })}>
                    <td className="font-medium">{s.name}</td>
                    <td>{s.contact}</td>
                    <td className="tabular">{formatMoney(supplierPurchaseTotal(state, s.id))}</td>
                    <td className="tabular">{formatMoney(supplierOutstanding(state, s.id))}</td>
                    <td>{last ? formatDate(last.date) : '—'}</td>
                    <td><StatusBadge status={s.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
