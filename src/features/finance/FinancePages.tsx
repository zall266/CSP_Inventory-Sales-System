import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Card, FilterRow, KpiCard, PageHeader, Select, StatusBadge, Tabs } from '@/components/ui'
import { paymentLabel } from '@/components/ProductMark'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatMoney, round2, addDays, PROTOTYPE_TODAY, startOfDay } from '@/utils/format'

export function PaymentsPage() {
  const state = useStore()
  const { customerName, supplierName } = useLookups()
  const [tab, setTab] = useState('customer')
  const rows = state.payments.filter((p) => (tab === 'customer' ? p.partyType === 'customer' : p.partyType === 'supplier'))
  return (
    <div>
      <PageHeader title="Payments" subtitle="Customer collections and supplier payments." />
      <div className="mb-5 max-w-md">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'customer', label: 'Customer payments' }, { id: 'supplier', label: 'Supplier payments' }]} />
      </div>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Payment no</th>
                <th>Date</th>
                <th>Party</th>
                <th>Invoice</th>
                <th>Method</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="cursor-default">
                  <td className="font-medium">{p.paymentNo}</td>
                  <td>{formatDate(p.date)}</td>
                  <td>{p.partyType === 'customer' ? customerName(p.partyId) : supplierName(p.partyId)}</td>
                  <td>{p.invoiceNo}</td>
                  <td>{paymentLabel(p.method)}</td>
                  <td className="tabular">{formatMoney(p.amount)}</td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export function ReceivablesPage() {
  const state = useStore()
  const api = useApi()
  const { customerName } = useLookups()
  const rows = state.sales.filter((s) => s.balance > 0 && s.status !== 'voided')
  const today = startOfDay(PROTOTYPE_TODAY)
  const dueToday = rows.filter((s) => s.date.slice(0, 10) === '2026-09-10')
  const overdue = rows.filter((s) => new Date(s.date) < addDays(today, -7))
  const collected = round2(state.payments.filter((p) => p.partyType === 'customer').reduce((s, p) => s + p.amount, 0))
  return (
    <div>
      <PageHeader title="Accounts Receivable" subtitle="Outstanding customer invoices." actions={<Button onClick={() => api.openModal('payment')}>Record payment</Button>} />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total outstanding" value={formatMoney(rows.reduce((s, r) => s + r.balance, 0), { compact: true })} />
        <KpiCard label="Due today" value={formatMoney(dueToday.reduce((s, r) => s + r.balance, 0), { compact: true })} />
        <KpiCard label="Overdue" value={formatMoney(overdue.reduce((s, r) => s + r.balance, 0), { compact: true })} tone="danger" />
        <KpiCard label="Collected" value={formatMoney(collected, { compact: true })} tone="success" />
      </div>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Invoice</th>
                <th>Date</th>
                <th>Due date</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} onClick={() => api.openDrawer({ type: 'sale', id: s.id })}>
                  <td>{customerName(s.customerId)}</td>
                  <td className="font-medium">{s.invoiceNo}</td>
                  <td>{formatDate(s.date)}</td>
                  <td>{formatDate(addDays(new Date(s.date), 14).toISOString())}</td>
                  <td>{formatMoney(s.total)}</td>
                  <td>{formatMoney(s.paid)}</td>
                  <td className="font-medium">{formatMoney(s.balance)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={s.status} />
                      <Button size="sm" variant="soft" onClick={(e) => { e.stopPropagation(); api.openModal('payment') }}>Record payment</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export function PayablesPage() {
  const state = useStore()
  const api = useApi()
  const { supplierName } = useLookups()
  const rows = state.purchases.filter((p) => p.balance > 0)
  return (
    <div>
      <PageHeader title="Accounts Payable" subtitle="Outstanding supplier bills." actions={<Button onClick={() => api.openModal('payment')}>Record payment</Button>} />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total outstanding" value={formatMoney(rows.reduce((s, r) => s + r.balance, 0), { compact: true })} />
        <KpiCard label="Open bills" value={String(rows.length)} />
        <KpiCard label="Paid this period" value={formatMoney(state.payments.filter((p) => p.partyType === 'supplier').reduce((s, p) => s + p.amount, 0), { compact: true })} />
        <KpiCard label="Suppliers" value={String(new Set(rows.map((r) => r.supplierId)).size)} />
      </div>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Purchase</th>
                <th>Date</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} onClick={() => api.openDrawer({ type: 'purchase', id: p.id })}>
                  <td>{supplierName(p.supplierId)}</td>
                  <td className="font-medium">{p.purchaseNo}</td>
                  <td>{formatDate(p.date)}</td>
                  <td>{formatMoney(p.total)}</td>
                  <td>{formatMoney(p.paid)}</td>
                  <td className="font-medium">{formatMoney(p.balance)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={p.status} />
                      <Button size="sm" variant="soft" onClick={(e) => { e.stopPropagation(); api.openModal('payment') }}>Record payment</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export function ExpensesPage() {
  const state = useStore()
  const api = useApi()
  const [category, setCategory] = useState('all')
  const rows = useMemo(
    () => state.expenses.filter((e) => category === 'all' || e.category === category),
    [state.expenses, category],
  )
  return (
    <div>
      <PageHeader title="Expenses" subtitle="Operating costs outside inventory purchases." actions={<Button onClick={() => api.openModal('expense')}><Plus size={16} /> Add expense</Button>} />
      <FilterRow>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {['Rent','Utilities','Salary','Transport','Packaging','Marketing','Maintenance','Office','Other'].map((c) => <option key={c}>{c}</option>)}
        </Select>
        <div /><div /><div />
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Description</th>
                <th>Method</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="cursor-default">
                  <td>{formatDate(e.date)}</td>
                  <td>{e.category}</td>
                  <td>{e.description}</td>
                  <td>{paymentLabel(e.paymentMethod)}</td>
                  <td className="tabular">{formatMoney(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
