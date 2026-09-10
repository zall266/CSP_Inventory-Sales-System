import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button, Card, Field, Input, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatQty, round2 } from '@/utils/format'
import type { WastageKind } from '@/types'
import { wastageKindLabel } from './helpers'

export function MaterialConsumptionPage() {
  const state = useStore()
  const api = useApi()
  const { productName, product } = useLookups()
  const [params, setParams] = useSearchParams()
  const openOrders = state.productionOrders.filter((o) => o.status === 'in_progress' || o.status === 'paused' || o.status === 'completed')
  const selectedId = params.get('order') ?? openOrders.find((o) => o.status === 'in_progress')?.id ?? openOrders[0]?.id ?? ''
  const order = state.productionOrders.find((o) => o.id === selectedId)
  const [extraId, setExtraId] = useState('')
  const [extraQty, setExtraQty] = useState(1)
  const [note, setNote] = useState('')
  const [wastageQty, setWastageQty] = useState(0)
  const [wastageKind, setWastageKind] = useState<WastageKind>('material')
  const [wastageReason, setWastageReason] = useState('')

  const lines = useMemo(() => order?.consumptions ?? [], [order])
  const extras = state.products.filter((p) => p.status === 'active' && !lines.some((l) => l.productId === p.id))

  if (!order) {
    return (
      <div>
        <PageHeader title="Material Consumption" subtitle="No production orders are in progress." />
      </div>
    )
  }

  const locked = order.posted

  return (
    <div>
      <PageHeader
        title="Material Consumption"
        subtitle="Confirm BOM expected usage, adjust actuals, and record wastage."
        actions={
          <Select
            value={order.id}
            onChange={(e) => setParams({ order: e.target.value })}
          >
            {openOrders.map((o) => (
              <option key={o.id} value={o.id}>{o.orderNo} · {productName(o.productId)}</option>
            ))}
          </Select>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge status={order.status} />
        {order.consumptionConfirmed && <StatusBadge status="completed" />}
        <span className="text-sm text-slate-500">Planned {formatQty(order.plannedQty)} {order.unit} · {productName(order.productId)}</span>
      </div>
      <Card className="mb-4">
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Material</th>
                <th>SKU</th>
                <th>Expected</th>
                <th>Actual</th>
                <th>Variance</th>
                <th>Wastage</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const variance = round2(line.actualQty - line.expectedQty)
                const wastageForLine = order.wastage.filter((w) => w.productId === line.productId).reduce((s, w) => s + w.qty, 0)
                const p = product(line.productId)
                return (
                  <tr key={line.productId} className="cursor-default">
                    <td className="font-medium">{p?.name}</td>
                    <td>{p?.sku}</td>
                    <td className="tabular">{formatQty(line.expectedQty)} {line.unit}</td>
                    <td>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={locked}
                        value={line.actualQty}
                        onChange={(e) => {
                          api.updateConsumption(order.id, [
                            { productId: line.productId, actualQty: Number(e.target.value), notes: line.notes },
                          ])
                        }}
                      />
                    </td>
                    <td className={`tabular ${variance > 0 ? 'text-amber-600' : variance < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {variance > 0 ? '+' : ''}{formatQty(variance)} {line.unit}
                    </td>
                    <td className="tabular">{wastageForLine ? `${formatQty(wastageForLine)} ${line.unit}` : '—'}</td>
                    <td>
                      <Input
                        disabled={locked}
                        value={line.notes}
                        onChange={(e) => api.updateConsumption(order.id, [{ productId: line.productId, actualQty: line.actualQty, notes: e.target.value }])}
                        placeholder="Note"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {!locked && (
        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <div className="mb-3 text-sm font-semibold">Add extra material</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Material" className="sm:col-span-2">
                <Select value={extraId} onChange={(e) => setExtraId(e.target.value)}>
                  <option value="">Select material</option>
                  {extras.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="Qty">
                <Input type="number" min={0.01} step="0.01" value={extraQty} onChange={(e) => setExtraQty(Number(e.target.value))} />
              </Field>
            </div>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              onClick={() => {
                if (!extraId) return
                api.addConsumptionLine(order.id, extraId, extraQty)
                setExtraId('')
              }}
            >
              <Plus size={14} /> Add extra material
            </Button>
          </Card>
          <Card className="p-5">
            <div className="mb-3 text-sm font-semibold">Record wastage</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Kind">
                <Select value={wastageKind} onChange={(e) => setWastageKind(e.target.value as WastageKind)}>
                  <option value="material">Material wastage</option>
                  <option value="process_loss">Process loss</option>
                  <option value="damaged_fg">Damaged finished goods</option>
                  <option value="yield_variance">Yield variance</option>
                </Select>
              </Field>
              <Field label="Quantity">
                <Input type="number" min={0} step="0.01" value={wastageQty} onChange={(e) => setWastageQty(Number(e.target.value))} />
              </Field>
              <Field label="Reason" className="sm:col-span-2">
                <Input value={wastageReason} onChange={(e) => setWastageReason(e.target.value)} placeholder={wastageKindLabel(wastageKind)} />
              </Field>
            </div>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              onClick={() => {
                api.recordWastage(order.id, {
                  kind: wastageKind,
                  productId: lines[0]?.productId,
                  qty: wastageQty,
                  unit: lines[0]?.unit ?? order.unit,
                  reason: wastageReason || wastageKindLabel(wastageKind),
                  notes: note,
                })
                setWastageQty(0)
                setWastageReason('')
              }}
            >
              Record wastage
            </Button>
          </Card>
        </div>
      )}
      <Card className="p-5">
        <Field label="Order note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional production note" />
        </Field>
        <div className="mt-4 flex flex-wrap gap-2">
          {!locked && <Button onClick={() => api.confirmConsumption(order.id)}>Confirm consumption</Button>}
          {!locked && (order.status === 'in_progress' || order.status === 'paused') && (
            <Button variant="success" onClick={() => api.openDrawer({ type: 'production', id: order.id })}>Continue to complete</Button>
          )}
        </div>
      </Card>
    </div>
  )
}
