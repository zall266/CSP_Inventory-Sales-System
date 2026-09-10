import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, Card, FilterRow, KpiCard, PageHeader, Select, Tabs } from '@/components/ui'
import { filteredProductionOrders, useLookups, useStore } from '@/store/hooks'
import { downloadCsv, formatDate, formatMoney, formatQty, printPage } from '@/utils/format'
import { orderWastageQty, wastageKindLabel } from './helpers'

function ReportToolbar({ onExport }: { onExport: () => void }) {
  return (
    <div className="flex gap-2">
      <Button variant="secondary" onClick={onExport}>Export</Button>
      <Button variant="secondary" onClick={printPage}>Print</Button>
    </div>
  )
}

export function ManufacturingReportPage() {
  const [tab, setTab] = useState('production')
  return (
    <div>
      {tab === 'production' && <ProductionReport tab={tab} onTab={setTab} />}
      {tab === 'consumption' && <ConsumptionReport tab={tab} onTab={setTab} />}
      {tab === 'wastage' && <WastageReport tab={tab} onTab={setTab} />}
      {tab === 'finished' && <FinishedGoodsReport tab={tab} onTab={setTab} />}
      {tab === 'cost' && <CostSummaryReport tab={tab} onTab={setTab} />}
    </div>
  )
}

function ReportTabs({ tab, onTab }: { tab: string; onTab: (id: string) => void }) {
  return (
    <div className="mb-5">
      <Tabs
        value={tab}
        onChange={onTab}
        tabs={[
          { id: 'production', label: 'Production' },
          { id: 'consumption', label: 'Material Consumption' },
          { id: 'wastage', label: 'Wastage' },
          { id: 'finished', label: 'Finished Goods' },
          { id: 'cost', label: 'Cost Summary' },
        ]}
      />
    </div>
  )
}

function ProductionReport({ tab, onTab }: { tab: string; onTab: (id: string) => void }) {
  const state = useStore()
  const { productName, warehouseName } = useLookups()
  const [status, setStatus] = useState('all')
  const orders = filteredProductionOrders(state).filter((o) => status === 'all' || o.status === status)
  const chart = useMemo(
    () => orders.map((o) => ({ name: o.orderNo, planned: o.plannedQty, actual: o.actualQty })),
    [orders],
  )
  return (
    <div>
      <PageHeader
        title="Manufacturing Reports"
        subtitle="Production, consumption, wastage and finished goods for the selected range."
        actions={<ReportToolbar onExport={() => downloadCsv('production-report.csv', [['Order', 'Date', 'Product', 'Planned', 'Actual', 'Status'], ...orders.map((o) => [o.orderNo, formatDate(o.date), productName(o.productId), o.plannedQty, o.actualQty, o.status])])} />}
      />
      <ReportTabs tab={tab} onTab={onTab} />
      <FilterRow>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="in_progress">In progress</option>
          <option value="planned">Planned</option>
        </Select>
        <div /><div /><div />
      </FilterRow>
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Orders" value={String(orders.length)} />
        <KpiCard label="Planned qty" value={formatQty(orders.reduce((s, o) => s + o.plannedQty, 0))} />
        <KpiCard label="Actual qty" value={formatQty(orders.reduce((s, o) => s + o.actualQty, 0))} />
      </div>
      <Card className="mb-4 p-5">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid stroke="#EEF2F7" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94A3B8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="planned" fill="#A5B4FC" radius={[6, 6, 0, 0]} />
              <Bar dataKey="actual" fill="#4F46E5" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Product</th>
                <th>Warehouse</th>
                <th>Planned</th>
                <th>Actual</th>
                <th>Wastage</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="cursor-default">
                  <td>{o.orderNo}</td>
                  <td>{formatDate(o.date)}</td>
                  <td>{productName(o.productId)}</td>
                  <td>{warehouseName(o.warehouseId)}</td>
                  <td className="tabular">{formatQty(o.plannedQty)}</td>
                  <td className="tabular">{formatQty(o.actualQty)}</td>
                  <td className="tabular">{formatQty(orderWastageQty(o))}</td>
                  <td>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function ConsumptionReport({ tab, onTab }: { tab: string; onTab: (id: string) => void }) {
  const state = useStore()
  const { productName } = useLookups()
  const orders = filteredProductionOrders(state)
  const lines = orders.flatMap((o) => o.consumptions.map((c) => ({ order: o, c })))
  return (
    <div>
      <PageHeader
        title="Manufacturing Reports"
        subtitle="Actual vs expected material usage."
        actions={<ReportToolbar onExport={() => downloadCsv('material-consumption.csv', [['Order', 'Material', 'Expected', 'Actual', 'Variance'], ...lines.map(({ order, c }) => [order.orderNo, productName(c.productId), c.expectedQty, c.actualQty, c.actualQty - c.expectedQty])])} />}
      />
      <ReportTabs tab={tab} onTab={onTab} />
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Material</th>
                <th>Expected</th>
                <th>Actual</th>
                <th>Variance</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ order, c }) => (
                <tr key={`${order.id}-${c.productId}`} className="cursor-default">
                  <td>{order.orderNo}</td>
                  <td>{productName(c.productId)}</td>
                  <td className="tabular">{formatQty(c.expectedQty)} {c.unit}</td>
                  <td className="tabular">{formatQty(c.actualQty)} {c.unit}</td>
                  <td className="tabular">{formatQty(c.actualQty - c.expectedQty)} {c.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function WastageReport({ tab, onTab }: { tab: string; onTab: (id: string) => void }) {
  const state = useStore()
  const { productName } = useLookups()
  const orders = filteredProductionOrders(state)
  const rows = orders.flatMap((o) => o.wastage.map((w) => ({ order: o, w })))
  const total = rows.reduce((s, r) => s + r.w.qty, 0)
  return (
    <div>
      <PageHeader
        title="Manufacturing Reports"
        subtitle="Material wastage, process loss and yield variance."
        actions={<ReportToolbar onExport={() => downloadCsv('production-wastage.csv', [['Order', 'Kind', 'Item', 'Qty', 'Reason'], ...rows.map(({ order, w }) => [order.orderNo, w.kind, w.productId ? productName(w.productId) : '', w.qty, w.reason])])} />}
      />
      <ReportTabs tab={tab} onTab={onTab} />
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <KpiCard label="Wastage records" value={String(rows.length)} />
        <KpiCard label="Total qty" value={formatQty(total)} />
      </div>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Kind</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Reason</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ order, w }) => (
                <tr key={w.id} className="cursor-default">
                  <td>{order.orderNo}</td>
                  <td>{wastageKindLabel(w.kind)}</td>
                  <td>{w.productId ? productName(w.productId) : '—'}</td>
                  <td className="tabular">{formatQty(w.qty)} {w.unit}</td>
                  <td>{w.reason}</td>
                  <td>{w.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function FinishedGoodsReport({ tab, onTab }: { tab: string; onTab: (id: string) => void }) {
  const state = useStore()
  const { productName, warehouseName } = useLookups()
  const orders = filteredProductionOrders(state).filter((o) => o.status === 'completed')
  return (
    <div>
      <PageHeader
        title="Manufacturing Reports"
        subtitle="Finished goods received from production."
        actions={<ReportToolbar onExport={() => downloadCsv('finished-goods.csv', [['Order', 'Product', 'Batch', 'Actual', 'Warehouse'], ...orders.map((o) => [o.orderNo, productName(o.productId), o.batchNo, o.actualQty, warehouseName(o.warehouseId)])])} />}
      />
      <ReportTabs tab={tab} onTab={onTab} />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Completed runs" value={String(orders.length)} />
        <KpiCard label="Finished qty" value={formatQty(orders.reduce((s, o) => s + o.actualQty, 0))} />
        <KpiCard label="Batches" value={String(new Set(orders.map((o) => o.batchNo)).size)} />
      </div>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Product</th>
                <th>Batch</th>
                <th>Date</th>
                <th>Actual</th>
                <th>Warehouse</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="cursor-default">
                  <td>{o.orderNo}</td>
                  <td>{productName(o.productId)}</td>
                  <td>{o.batchNo}</td>
                  <td>{formatDate(o.actualEnd ?? o.date)}</td>
                  <td className="tabular">{formatQty(o.actualQty)} {o.unit}</td>
                  <td>{warehouseName(o.warehouseId)}</td>
                  <td className="tabular">{formatMoney(o.costEstimate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function CostSummaryReport({ tab, onTab }: { tab: string; onTab: (id: string) => void }) {
  const state = useStore()
  const { productName, warehouseName } = useLookups()
  const orders = filteredProductionOrders(state).filter((o) => o.status === 'completed')
  const byProduct = useMemo(() => {
    const map = new Map<string, { qty: number; cost: number }>()
    for (const o of orders) {
      const cur = map.get(o.productId) ?? { qty: 0, cost: 0 }
      map.set(o.productId, { qty: cur.qty + o.actualQty, cost: cur.cost + o.costEstimate })
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v, unit: v.qty ? v.cost / v.qty : 0 }))
  }, [orders])
  return (
    <div>
      <PageHeader
        title="Manufacturing Reports"
        subtitle="Estimated production cost from consumed materials. Prototype values only — not a ledger."
        actions={<ReportToolbar onExport={() => downloadCsv('production-cost.csv', [['Product', 'Qty', 'Cost', 'Cost/unit'], ...byProduct.map((r) => [productName(r.id), r.qty, r.cost, r.unit])])} />}
      />
      <ReportTabs tab={tab} onTab={onTab} />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Total production cost" value={formatMoney(orders.reduce((s, o) => s + o.costEstimate, 0), { compact: true })} />
        <KpiCard label="Finished qty" value={formatQty(orders.reduce((s, o) => s + o.actualQty, 0))} />
        <KpiCard label="Avg cost / unit" value={formatMoney(orders.reduce((s, o) => s + o.actualQty, 0) ? orders.reduce((s, o) => s + o.costEstimate, 0) / orders.reduce((s, o) => s + o.actualQty, 0) : 0)} />
      </div>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Qty produced</th>
                <th>Material cost</th>
                <th>Cost per unit</th>
              </tr>
            </thead>
            <tbody>
              {byProduct.map((row) => (
                <tr key={row.id} className="cursor-default">
                  <td>{productName(row.id)}</td>
                  <td className="tabular">{formatQty(row.qty)}</td>
                  <td className="tabular">{formatMoney(row.cost)}</td>
                  <td className="tabular">{formatMoney(row.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-3 text-xs text-slate-400">Warehouse filter: {state.ui.warehouseFilter === 'all' ? 'All warehouses' : warehouseName(state.ui.warehouseFilter)}.</p>
    </div>
  )
}
