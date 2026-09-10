import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, KpiCard, Card, StatusBadge, Button, EmptyState, FilterRow, Select, Input } from '@/components/ui'
import { ProductMark } from '@/components/ProductMark'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatMoney, formatQty, PROTOTYPE_TODAY } from '@/utils/format'
import { orderWastageQty } from './helpers'
import type { ProductionStatus } from '@/types'

const STATUSES: ProductionStatus[] = ['draft', 'planned', 'in_progress', 'paused', 'completed', 'cancelled']

export function ManufacturingDashboardPage() {
  const state = useStore()
  const api = useApi()
  const { product, warehouseName } = useLookups()
  const [from, setFrom] = useState('2026-09-01')
  const [to, setTo] = useState(PROTOTYPE_TODAY.toISOString().slice(0, 10))
  const warehouse = state.ui.warehouseFilter

  const scoped = useMemo(() => {
    return state.productionOrders.filter((order) => {
      if (warehouse !== 'all' && order.warehouseId !== warehouse) return false
      const day = order.date.slice(0, 10)
      return day >= from && day <= to
    }).sort((a, b) => b.date.localeCompare(a.date) || b.orderNo.localeCompare(a.orderNo))
  }, [state.productionOrders, from, to, warehouse])

  const todayKey = PROTOTYPE_TODAY.toISOString().slice(0, 10)
  const inWarehouse = (id: string) => warehouse === 'all' || id === warehouse
  const today = state.productionOrders.filter((o) => o.date.slice(0, 10) === todayKey && inWarehouse(o.warehouseId))
  const planned = state.productionOrders.filter((o) => (o.status === 'planned' || o.status === 'draft') && inWarehouse(o.warehouseId))
  const inProg = state.productionOrders.filter((o) => (o.status === 'in_progress' || o.status === 'paused') && inWarehouse(o.warehouseId))
  const completedToday = state.productionOrders.filter((o) => o.status === 'completed' && o.actualEnd?.slice(0, 10) === todayKey && inWarehouse(o.warehouseId))
  const requiredToday = today
    .filter((o) => o.status !== 'cancelled' && o.status !== 'completed')
    .reduce((sum, o) => sum + o.consumptions.reduce((a, c) => a + c.expectedQty, 0), 0)
  const rawIds = new Set(state.boms.flatMap((bom) => bom.items.map((item) => item.productId)))
  const lowAlerts = state.inventory.filter((row) => {
    if (!inWarehouse(row.warehouseId)) return false
    const p = product(row.productId)
    return p && rawIds.has(row.productId) && row.qty > 0 && row.qty <= p.reorderLevel
  }).length
  const fgProduced = scoped.filter((o) => o.status === 'completed').reduce((s, o) => s + o.actualQty, 0)
  const wastage = scoped.reduce((s, o) => s + orderWastageQty(o), 0)

  return (
    <div>
      <PageHeader
        title="Manufacturing Dashboard"
        subtitle="Production load, materials, finished goods and wastage."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/manufacturing/orders/new"><Button>New production order</Button></Link>
            <Link to="/manufacturing/bom"><Button variant="secondary">Bill of materials</Button></Link>
          </div>
        }
      />
      <FilterRow>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select value={warehouse} onChange={(e) => api.setWarehouseFilter(e.target.value)}>
          <option value="all">All warehouses</option>
          {state.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <div />
      </FilterRow>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Production orders today" value={String(today.length)} hint={formatDate(PROTOTYPE_TODAY.toISOString())} />
        <KpiCard label="Planned production" value={String(planned.length)} hint="Draft + planned" />
        <KpiCard label="In progress" value={String(inProg.length)} hint="Includes paused" />
        <KpiCard label="Completed today" value={String(completedToday.length)} tone="success" />
        <KpiCard label="Raw materials required" value={formatQty(requiredToday)} hint="Open orders dated today" />
        <KpiCard label="Low material alerts" value={String(lowAlerts)} tone={lowAlerts ? 'warning' : 'default'} />
        <KpiCard label="Finished goods produced" value={formatQty(fgProduced)} hint="Selected range" />
        <KpiCard label="Production wastage" value={formatQty(wastage)} hint="Materials + yield" />
      </div>
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-900">Production status</h3>
          <ul className="mt-3 space-y-2">
            {STATUSES.map((st) => (
              <li key={st} className="flex items-center justify-between text-sm">
                <StatusBadge status={st} />
                <span className="tabular font-semibold text-slate-800">
                  {state.productionOrders.filter((o) => o.status === st && inWarehouse(o.warehouseId)).length}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Recent production orders</h3>
            <Link to="/manufacturing/orders" className="text-xs font-semibold text-indigo-700 hover:underline">View all</Link>
          </div>
          {scoped.length === 0 ? (
            <EmptyState title="No orders in this range" />
          ) : (
            <div className="sf-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Product</th>
                    <th>Warehouse</th>
                    <th>Qty</th>
                    <th>Status</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {scoped.slice(0, 8).map((o) => {
                    const p = product(o.productId)
                    return (
                      <tr key={o.id} onClick={() => api.openDrawer({ type: 'production', id: o.id })}>
                        <td>
                          <div className="font-medium text-indigo-700">{o.orderNo}</div>
                          <div className="text-xs text-slate-400">{formatDate(o.date)}</div>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            {p && <ProductMark product={p} size="sm" />}
                            <span>{p?.name}</span>
                          </div>
                        </td>
                        <td>{warehouseName(o.warehouseId)}</td>
                        <td className="tabular">{formatQty(o.plannedQty)} {o.unit}</td>
                        <td><StatusBadge status={o.status} /></td>
                        <td className="tabular">{formatMoney(o.costEstimate)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
