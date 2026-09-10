import { useMemo, useState } from 'react'
import { Card, FilterRow, Input, PageHeader, Select, StatusBadge } from '@/components/ui'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatMoney, formatQty } from '@/utils/format'
import { orderWastageQty } from './helpers'
import type { ProductionStatus } from '@/types'

const STATUSES: ProductionStatus[] = ['draft', 'planned', 'in_progress', 'paused', 'completed', 'cancelled']

export function ProductionHistoryPage() {
  const state = useStore()
  const api = useApi()
  const { productName, warehouseName } = useLookups()
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('2026-09-01')
  const [to, setTo] = useState('2026-09-10')
  const [productId, setProductId] = useState('all')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('date-desc')

  const products = [...new Set(state.productionOrders.map((o) => o.productId))]

  const rows = useMemo(() => {
    const list = state.productionOrders.filter((order) => {
      if (state.ui.warehouseFilter !== 'all' && order.warehouseId !== state.ui.warehouseFilter) return false
      if (productId !== 'all' && order.productId !== productId) return false
      if (status !== 'all' && order.status !== status) return false
      const day = (order.actualEnd ?? order.date).slice(0, 10)
      if (day < from || day > to) return false
      if (query && !`${order.orderNo} ${order.batchNo} ${productName(order.productId)}`.toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
    list.sort((a, b) => {
      if (sort === 'date-asc') return (a.actualEnd ?? a.date).localeCompare(b.actualEnd ?? b.date)
      if (sort === 'qty') return b.actualQty - a.actualQty
      if (sort === 'cost') return b.costEstimate - a.costEstimate
      return (b.actualEnd ?? b.date).localeCompare(a.actualEnd ?? a.date)
    })
    return list
  }, [state.productionOrders, state.ui.warehouseFilter, productId, status, from, to, query, productName, sort])

  return (
    <div>
      <PageHeader title="Production History" subtitle="Posted and historical manufacturing runs with yield, cost and batch." />
      <FilterRow>
        <Input placeholder="Search order, batch or product" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="all">All products</option>
          {products.map((id) => <option key={id} value={id}>{productName(id)}</option>)}
        </Select>
      </FilterRow>
      <FilterRow>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
        <Select value={state.ui.warehouseFilter} onChange={(e) => api.setWarehouseFilter(e.target.value)}>
          <option value="all">All warehouses</option>
          {state.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="date-desc">Newest first</option>
          <option value="date-asc">Oldest first</option>
          <option value="qty">Actual qty</option>
          <option value="cost">Cost</option>
        </Select>
        <div />
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Production order</th>
                <th>Date</th>
                <th>Product</th>
                <th>Batch</th>
                <th>Planned qty</th>
                <th>Actual qty</th>
                <th>Wastage</th>
                <th>Cost</th>
                <th>Warehouse</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id} onClick={() => api.openDrawer({ type: 'production', id: order.id })}>
                  <td className="font-medium text-indigo-700">{order.orderNo}</td>
                  <td>{formatDate(order.actualEnd ?? order.date)}</td>
                  <td>{productName(order.productId)}</td>
                  <td>{order.batchNo || '—'}</td>
                  <td className="tabular">{formatQty(order.plannedQty)} {order.unit}</td>
                  <td className="tabular">{order.actualQty ? `${formatQty(order.actualQty)} ${order.unit}` : '—'}</td>
                  <td className="tabular">{formatQty(orderWastageQty(order))} {order.unit}</td>
                  <td className="tabular">{formatMoney(order.costEstimate)}</td>
                  <td>{warehouseName(order.warehouseId)}</td>
                  <td><StatusBadge status={order.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
