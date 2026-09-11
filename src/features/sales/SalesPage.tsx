import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button, Card, FilterRow, Input, KpiCard, PageHeader, Select, StatusBadge } from '@/components/ui'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { addDays, formatDate, formatMoney, inRange, PROTOTYPE_TODAY, round2, startOfDay } from '@/utils/format'

export function SalesPage() {
  const state = useStore()
  const api = useApi()
  const { customerName } = useLookups()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [customerId, setCustomerId] = useState('all')
  const [status, setStatus] = useState('all')
  const [salesperson, setSalesperson] = useState('all')
  const todayStart = startOfDay(PROTOTYPE_TODAY)
  const todayEnd = addDays(todayStart, 1)

  const todaySales = state.sales.filter((s) => s.status !== 'voided' && inRange(s.date, todayStart, todayEnd))
  const rows = useMemo(() => {
    return state.sales.filter((sale) => {
      if (query && !sale.invoiceNo.toLowerCase().includes(query.toLowerCase()) && !customerName(sale.customerId).toLowerCase().includes(query.toLowerCase())) return false
      if (customerId !== 'all' && sale.customerId !== customerId) return false
      if (status !== 'all' && sale.status !== status) return false
      if (salesperson !== 'all' && sale.salesperson !== salesperson) return false
      if (state.ui.warehouseFilter !== 'all' && sale.warehouseId !== state.ui.warehouseFilter) return false
      return true
    })
  }, [state.sales, query, customerId, status, salesperson, state.ui.warehouseFilter, customerName])

  const people = [...new Set(state.sales.map((s) => s.salesperson))]

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle="Invoices, payments and outstanding balances. Use Preview for the official A4 invoice."
        actions={<Button onClick={() => navigate('/pos')}><Plus size={16} /> New sale</Button>}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Today's sales" value={formatMoney(round2(todaySales.reduce((s, x) => s + x.total, 0)), { compact: true })} />
        <KpiCard label="Paid" value={String(state.sales.filter((s) => s.status === 'paid').length)} tone="success" />
        <KpiCard label="Unpaid" value={String(state.sales.filter((s) => s.status === 'unpaid' || s.status === 'partial').length)} tone="warning" />
        <KpiCard label="Returns" value={String(state.salesReturns.length)} />
      </div>
      <FilterRow>
        <Input placeholder="Search invoice or customer" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="all">All customers</option>
          {state.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All payment status</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="voided">Voided</option>
        </Select>
        <Select value={salesperson} onChange={(e) => setSalesperson(e.target.value)}>
          <option value="all">All salespeople</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((sale) => (
                <tr key={sale.id} onClick={() => api.openDrawer({ type: 'sale', id: sale.id })}>
                  <td className="font-medium text-indigo-700" onClick={(e) => { e.stopPropagation(); navigate(`/sales/invoices/${sale.id}`) }}>{sale.invoiceNo}</td>
                  <td>{formatDate(sale.date)}</td>
                  <td>{customerName(sale.customerId)}</td>
                  <td>{sale.items.reduce((s, i) => s + i.qty, 0)}</td>
                  <td className="tabular">{formatMoney(sale.total)}</td>
                  <td className="tabular">{formatMoney(sale.paid)}</td>
                  <td className="tabular">{formatMoney(sale.balance)}</td>
                  <td><StatusBadge status={sale.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
