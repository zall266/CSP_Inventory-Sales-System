import { useMemo, useState } from 'react'
import { Button, Card, Field, Input, PageHeader, Select, StatusBadge } from '@/components/ui'
import { ProductMark } from '@/components/ProductMark'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatMoney, formatQty, round2 } from '@/utils/format'
import { orderWastageQty } from './helpers'

export function FinishedGoodsPage() {
  const state = useStore()
  const api = useApi()
  const { product, warehouseName } = useLookups()
  const ready = state.productionOrders.filter((o) => o.status === 'in_progress' || o.status === 'paused')
  const completed = useMemo(
    () => state.productionOrders.filter((o) => o.status === 'completed').sort((a, b) => (b.actualEnd ?? b.date).localeCompare(a.actualEnd ?? a.date)),
    [state.productionOrders],
  )
  const [selectedId, setSelectedId] = useState(ready[0]?.id ?? '')
  const order = state.productionOrders.find((o) => o.id === selectedId) ?? ready[0]
  const [actualQty, setActualQty] = useState(order?.plannedQty ?? 0)
  const [batchNo, setBatchNo] = useState(order?.batchNo ?? '')
  const [expiryDate, setExpiryDate] = useState(order?.expiryDate ?? '2027-03-10')

  const pick = (id: string) => {
    const next = state.productionOrders.find((o) => o.id === id)
    setSelectedId(id)
    setActualQty(next?.plannedQty ?? 0)
    setBatchNo(next?.batchNo ?? '')
    setExpiryDate(next?.expiryDate ?? '2027-03-10')
  }

  const p = order ? product(order.productId) : undefined
  const variance = order ? round2(order.plannedQty - actualQty) : 0

  return (
    <div>
      <PageHeader
        title="Finished Goods"
        subtitle="Complete a run to receive finished stock, generate a batch, and post inventory."
      />
      {order && (order.status === 'in_progress' || order.status === 'paused') ? (
        <Card className="mb-6 p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              {p && <ProductMark product={p} size="lg" />}
              <div>
                <div className="text-lg font-semibold">{p?.name}</div>
                <div className="text-sm text-slate-500">{order.orderNo} · {warehouseName(order.warehouseId)}</div>
                <div className="mt-2"><StatusBadge status={order.status} /></div>
              </div>
            </div>
            <Select value={order.id} onChange={(e) => pick(e.target.value)}>
              {ready.map((o) => <option key={o.id} value={o.id}>{o.orderNo} · {product(o.productId)?.name}</option>)}
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Planned quantity"><Input disabled value={`${formatQty(order.plannedQty)} ${order.unit}`} /></Field>
            <Field label="Actual quantity">
              <Input type="number" min={0.01} step="0.01" value={actualQty} onChange={(e) => setActualQty(Number(e.target.value))} />
            </Field>
            <Field label="Unit"><Input disabled value={order.unit} /></Field>
            <Field label="Batch number"><Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} /></Field>
            <Field label="Production date"><Input disabled value={formatDate(order.actualStart ?? order.date)} /></Field>
            <Field label="Expiry date"><Input type="date" value={expiryDate.slice(0, 10)} onChange={(e) => setExpiryDate(e.target.value)} /></Field>
            <Field label="Warehouse"><Input disabled value={warehouseName(order.warehouseId)} /></Field>
            <Field label="Production cost estimate"><Input disabled value={formatMoney(order.costEstimate)} /></Field>
          </div>
          <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Yield variance: <span className="font-semibold tabular text-slate-900">{variance > 0 ? `${formatQty(variance)} ${order.unit} wastage` : 'On target'}</span>
            {!order.consumptionConfirmed && <span className="ml-2 text-amber-700">Confirm material consumption before posting if actuals changed.</span>}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="success"
              onClick={() => {
                const ok = api.completeProduction(order.id, { actualQty, batchNo, expiryDate })
                if (ok) pick(ready.find((o) => o.id !== order.id)?.id ?? '')
              }}
            >
              Complete production
            </Button>
            <Button variant="secondary" onClick={() => api.openDrawer({ type: 'production', id: order.id })}>Record production variance</Button>
          </div>
        </Card>
      ) : (
        <Card className="mb-6 p-6 text-sm text-slate-500">No in-progress orders. Start a production order to add finished goods.</Card>
      )}
      <div className="mb-3 text-sm font-semibold text-slate-900">Recently completed</div>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Product</th>
                <th>Batch</th>
                <th>Planned</th>
                <th>Actual</th>
                <th>Wastage</th>
                <th>Expiry</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {completed.map((o) => {
                const item = product(o.productId)
                return (
                  <tr key={o.id} onClick={() => api.openDrawer({ type: 'production', id: o.id })}>
                    <td className="font-medium text-indigo-700">{o.orderNo}</td>
                    <td>{item?.name}</td>
                    <td>{o.batchNo}</td>
                    <td className="tabular">{formatQty(o.plannedQty)} {o.unit}</td>
                    <td className="tabular">{formatQty(o.actualQty)} {o.unit}</td>
                    <td className="tabular">{formatQty(orderWastageQty(o))} {o.unit}</td>
                    <td>{o.expiryDate ? formatDate(o.expiryDate) : '—'}</td>
                    <td className="tabular">{formatMoney(o.costEstimate)}</td>
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
