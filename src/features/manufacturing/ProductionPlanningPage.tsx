import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, FilterRow, Input, PageHeader, Select, StatusBadge } from '@/components/ui'
import { useLookups, useStore } from '@/store/hooks'
import { formatDate, formatQty } from '@/utils/format'
import { hasShortage, materialAvailability } from './helpers'

export function ProductionPlanningPage() {
  const state = useStore()
  const navigate = useNavigate()
  const { productName, warehouseName, product } = useLookups()
  const [from, setFrom] = useState('2026-09-10')
  const [to, setTo] = useState('2026-09-20')
  const [productId, setProductId] = useState('all')
  const [status, setStatus] = useState('open')

  const rows = useMemo(() => {
    return state.productionOrders
      .filter((order) => {
        if (state.ui.warehouseFilter !== 'all' && order.warehouseId !== state.ui.warehouseFilter) return false
        if (productId !== 'all' && order.productId !== productId) return false
        if (status === 'open' && (order.status === 'completed' || order.status === 'cancelled')) return false
        if (status !== 'all' && status !== 'open' && order.status !== status) return false
        const day = order.plannedStart.slice(0, 10)
        return day >= from && day <= to
      })
      .sort((a, b) => a.plannedStart.localeCompare(b.plannedStart))
  }, [state.productionOrders, state.ui.warehouseFilter, productId, status, from, to])

  const loadByDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const order of rows) {
      const day = order.plannedStart.slice(0, 10)
      map.set(day, (map.get(day) ?? 0) + 1)
    }
    return map
  }, [rows])

  const products = [...new Set(state.boms.map((b) => b.productId))]

  return (
    <div>
      <PageHeader
        title="Production Planning"
        subtitle="Upcoming runs, material coverage and suggested production dates."
      />
      <FilterRow>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="all">All products</option>
          {products.map((id) => <option key={id} value={id}>{productName(id)}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open (not completed)</option>
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="planned">Planned</option>
          <option value="in_progress">In progress</option>
        </Select>
      </FilterRow>
      <div className="mb-4 flex flex-wrap gap-2">
        {[...loadByDay.entries()].slice(0, 8).map(([day, n]) => (
          <div key={day} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
            <div className="font-semibold text-slate-800">{formatDate(day)}</div>
            <div className="text-slate-500">{n} run{n === 1 ? '' : 's'} scheduled</div>
          </div>
        ))}
      </div>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Suggested date</th>
                <th>Order</th>
                <th>Product</th>
                <th>Warehouse</th>
                <th>Planned qty</th>
                <th>Materials</th>
                <th>Shortage</th>
                <th>Load</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => {
                const checks = materialAvailability(state, order.warehouseId, order.consumptions)
                const shortageQty = checks.reduce((s, r) => s + r.shortage, 0)
                const overall = hasShortage(checks) ? 'shortage' : checks.some((r) => r.status === 'low') ? 'low' : 'enough'
                const day = order.plannedStart.slice(0, 10)
                return (
                  <tr key={order.id} onClick={() => navigate(`/manufacturing/orders/${order.id}`)}>
                    <td>
                      <div className="font-medium">{formatDate(order.plannedStart)}</div>
                      <div className="text-xs text-slate-400">to {formatDate(order.plannedEnd)}</div>
                    </td>
                    <td className="font-medium text-indigo-700">{order.orderNo}</td>
                    <td>{productName(order.productId)}</td>
                    <td>{warehouseName(order.warehouseId)}</td>
                    <td className="tabular">{formatQty(order.plannedQty)} {order.unit}</td>
                    <td>
                      <div className="space-y-1">
                        {checks.map((row) => (
                          <div key={row.productId} className="flex items-center gap-2 text-xs">
                            <span className={`h-2 w-2 rounded-full ${row.status === 'shortage' ? 'bg-rose-500' : row.status === 'low' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                            <span>{product(row.productId)?.name}</span>
                            <span className="tabular text-slate-500">{formatQty(row.available)}/{formatQty(row.required)} {row.unit}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className={`tabular ${shortageQty ? 'font-semibold text-rose-600' : 'text-slate-400'}`}>
                      {shortageQty ? formatQty(shortageQty) : '—'}
                    </td>
                    <td>{loadByDay.get(day) ?? 0}</td>
                    <td><StatusBadge status={overall} /></td>
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
