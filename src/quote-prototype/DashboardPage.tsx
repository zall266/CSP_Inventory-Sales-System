import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Card, KpiCard, PageHeader, StatusBadge } from '@/components/ui'
import { formatMoney, inRange, PROTOTYPE_TODAY } from '@/utils/format'
import { formatQuoteDay } from './calc'
import { useQuoteStore } from './store'

export function QuoteDashboardPage() {
  const { state } = useQuoteStore()
  const monthStart = new Date(PROTOTYPE_TODAY.getFullYear(), PROTOTYPE_TODAY.getMonth(), 1)
  const monthEnd = new Date(PROTOTYPE_TODAY.getFullYear(), PROTOTYPE_TODAY.getMonth() + 1, 1)
  const thisMonth = state.quotations.filter((row) => row.status === 'accepted' && inRange(row.date, monthStart, monthEnd))
  const recent = [...state.quotations].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)
  const customerName = useMemo(() => {
    const map = Object.fromEntries(state.customers.map((item) => [item.id, item.company || item.name]))
    return (id: string) => map[id] ?? '—'
  }, [state.customers])

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Quotation activity for Cool Slurppy Marketing." />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Total Quotations" value={String(state.quotations.length)} />
        <KpiCard label="Draft" value={String(state.quotations.filter((row) => row.status === 'draft').length)} />
        <KpiCard label="Sent" value={String(state.quotations.filter((row) => row.status === 'sent').length)} tone="warning" />
        <KpiCard label="Accepted" value={String(state.quotations.filter((row) => row.status === 'accepted').length)} tone="success" />
        <KpiCard label="This Month" value={formatMoney(thisMonth.reduce((sum, row) => sum + row.total, 0), { compact: true })} />
      </div>
      <Card>
        <div className="border-b border-slate-100 px-5 py-4 text-sm font-semibold">Recent Quotations</div>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quotation No</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium text-indigo-700">
                    <Link to={`/quotations/${row.id}`}>{row.quotationNo}</Link>
                  </td>
                  <td>{customerName(row.customerId)}</td>
                  <td>{formatQuoteDay(row.date)}</td>
                  <td className="tabular">{formatMoney(row.total)}</td>
                  <td><StatusBadge status={row.status} /></td>
                  <td className="text-right">
                    <Link className="text-xs text-indigo-700" to={`/quotations/${row.id}/preview`}>View</Link>
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
