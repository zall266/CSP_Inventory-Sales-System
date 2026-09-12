import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button, Card, ConfirmDialog, Field, FilterRow, Input, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui'
import { ProductMark } from '@/components/ProductMark'
import { companyWarehouses, isCompanyWarehouseId } from '@/features/agent/agentModel'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatDateTime, formatMoney, formatQty, round2 } from '@/utils/format'
import type { ProductionOrder, ProductionStatus, WastageKind } from '@/types'
import { AvailabilityPanel } from './AvailabilityPanel'
import {
  bomLinesForQty,
  dateInputValue,
  hasShortage,
  materialAvailability,
  orderWastageQty,
  toLocalIso,
  wastageKindLabel,
} from './helpers'

const STATUSES: ProductionStatus[] = ['draft', 'planned', 'in_progress', 'paused', 'completed', 'cancelled']

export function ProductionOrdersPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { productName, warehouseName } = useLookups()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [productId, setProductId] = useState('all')

  const rows = useMemo(() => {
    return state.productionOrders.filter((order) => {
      if (state.ui.warehouseFilter === 'all') {
        if (!isCompanyWarehouseId(state.warehouses, order.warehouseId)) return false
      } else if (order.warehouseId !== state.ui.warehouseFilter) {
        return false
      }
      if (status !== 'all' && order.status !== status) return false
      if (productId !== 'all' && order.productId !== productId) return false
      if (query && !`${order.orderNo} ${order.batchNo} ${productName(order.productId)} ${order.operator}`.toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
  }, [state.productionOrders, state.ui.warehouseFilter, status, productId, query, productName])

  const products = [...new Set(state.productionOrders.map((o) => o.productId))]

  return (
    <div>
      <PageHeader
        title="Production Orders"
        subtitle="Plan, start and complete manufacturing runs."
        actions={<Button onClick={() => navigate('/manufacturing/orders/new')}><Plus size={16} /> New production order</Button>}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STATUSES.filter((s) => s !== 'paused').slice(0, 4).map((s) => (
          <Card key={s} className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{s.replace('_', ' ')}</div>
            <div className="mt-1 text-2xl font-semibold tabular">{state.productionOrders.filter((o) => o.status === s).length}</div>
          </Card>
        ))}
      </div>
      <FilterRow>
        <Input placeholder="Search order, batch or product" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
        <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="all">All products</option>
          {products.map((id) => <option key={id} value={id}>{productName(id)}</option>)}
        </Select>
        <Select value={state.ui.warehouseFilter} onChange={(e) => api.setWarehouseFilter(e.target.value)}>
          <option value="all">All warehouses</option>
          {companyWarehouses(state.warehouses).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Product</th>
                <th>BOM</th>
                <th>Warehouse</th>
                <th>Planned</th>
                <th>Actual</th>
                <th>Batch</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id} onClick={() => api.openDrawer({ type: 'production', id: order.id })}>
                  <td className="font-medium text-indigo-700">{order.orderNo}</td>
                  <td>{formatDate(order.date)}</td>
                  <td>{productName(order.productId)}</td>
                  <td>{state.boms.find((b) => b.id === order.bomId)?.name}</td>
                  <td>{warehouseName(order.warehouseId)}</td>
                  <td className="tabular">{formatQty(order.plannedQty)} {order.unit}</td>
                  <td className="tabular">{order.actualQty ? `${formatQty(order.actualQty)} ${order.unit}` : '—'}</td>
                  <td>{order.batchNo || '—'}</td>
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

export function NewProductionOrderPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const fgIds = [...new Set(state.boms.filter((b) => b.status === 'active').map((b) => b.productId))]
  const [productId, setProductId] = useState(fgIds[0] ?? '')
  const boms = state.boms.filter((b) => b.productId === productId && b.status === 'active')
  const [bomId, setBomId] = useState(boms[0]?.id ?? '')
  const [warehouseId, setWarehouseId] = useState(state.settings.defaultWarehouseId)
  const [plannedQty, setPlannedQty] = useState(boms[0]?.outputQty ?? 100)
  const [plannedStart, setPlannedStart] = useState('2026-09-10')
  const [plannedEnd, setPlannedEnd] = useState('2026-09-10')
  const [operator, setOperator] = useState(state.users.find((u) => u.role === 'warehouse')?.name ?? '')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<'draft' | 'planned'>('planned')

  const bom = state.boms.find((b) => b.id === bomId)
  const product = state.products.find((p) => p.id === productId)
  const rows = bom ? materialAvailability(state, warehouseId, bomLinesForQty(bom, plannedQty)) : []

  const changeProduct = (id: string) => {
    const nextBoms = state.boms.filter((b) => b.productId === id && b.status === 'active')
    setProductId(id)
    setBomId(nextBoms[0]?.id ?? '')
    setPlannedQty(nextBoms[0]?.outputQty ?? 100)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const created = api.createProductionOrder({
      productId,
      bomId,
      warehouseId,
      plannedQty,
      plannedStart: toLocalIso(plannedStart, 8),
      plannedEnd: toLocalIso(plannedEnd, 17),
      operator,
      notes,
      status,
    })
    if (created) navigate(`/manufacturing/orders/${created.id}`)
  }

  return (
    <div>
      <PageHeader title="New Production Order" subtitle="Select a product and BOM, then check material availability before saving." />
      <form onSubmit={submit} className="space-y-4">
        <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Finished product">
            <Select value={productId} onChange={(e) => changeProduct(e.target.value)}>
              {fgIds.map((id) => {
                const p = state.products.find((item) => item.id === id)
                return p ? <option key={id} value={id}>{p.name}</option> : null
              })}
            </Select>
          </Field>
          <Field label="Bill of materials">
            <Select value={bomId} onChange={(e) => {
              const next = state.boms.find((b) => b.id === e.target.value)
              setBomId(e.target.value)
              if (next) setPlannedQty(next.outputQty)
            }}>
              {boms.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="Warehouse">
            <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {companyWarehouses(state.warehouses).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Planned quantity">
            <Input type="number" min={0.01} step="0.01" value={plannedQty} onChange={(e) => setPlannedQty(Number(e.target.value))} />
          </Field>
          <Field label="Unit"><Input disabled value={product?.unit ?? 'KG'} /></Field>
          <Field label="Planned start"><Input type="date" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} /></Field>
          <Field label="Planned end"><Input type="date" value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} /></Field>
          <Field label="Assigned operator">
            <Select value={operator} onChange={(e) => setOperator(e.target.value)}>
              {state.users.filter((u) => u.status === 'active').map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as 'draft' | 'planned')}>
              <option value="planned">Planned</option>
              <option value="draft">Draft</option>
            </Select>
          </Field>
          <Field label="Notes" className="sm:col-span-2 lg:col-span-3">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
        </Card>
        <Card className="p-5">
          <div className="mb-3 text-sm font-semibold">Raw material availability</div>
          {rows.length > 0 ? (
            <AvailabilityPanel rows={rows} />
          ) : (
            <div className="text-sm text-slate-500">Select a BOM to check materials.</div>
          )}
        </Card>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/manufacturing/orders')}>Cancel</Button>
          <Button type="submit">Create production order</Button>
        </div>
      </form>
    </div>
  )
}

export function ProductionOrderDetailPage() {
  const { id } = useParams()
  const state = useStore()
  const order = state.productionOrders.find((item) => item.id === id)
  if (!order) {
    return (
      <div>
        <PageHeader title="Production order" subtitle="Not found." />
        <Link to="/manufacturing/orders" className="text-sm font-medium text-indigo-700">Back to orders</Link>
      </div>
    )
  }
  return (
    <div>
      <PageHeader title={order.orderNo} subtitle="Production order detail" />
      <Card>
        <ProductionOrderDetail id={order.id} />
      </Card>
    </div>
  )
}

export function ProductionOrderDetail({ id }: { id: string }) {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { product, warehouseName } = useLookups()
  const order = state.productionOrders.find((item) => item.id === id)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [actualQty, setActualQty] = useState(order?.plannedQty ?? 0)
  const [batchNo, setBatchNo] = useState(order?.batchNo ?? '')
  const [expiryDate, setExpiryDate] = useState(order?.expiryDate ?? '2027-03-10')
  const [wastageQty, setWastageQty] = useState(0)
  const [wastageKind, setWastageKind] = useState<WastageKind>('material')
  const [wastageReason, setWastageReason] = useState('')
  const [wastageNotes, setWastageNotes] = useState('')
  const [wastageProductId, setWastageProductId] = useState(order?.consumptions[0]?.productId ?? '')

  if (!order) return <div className="p-6 text-sm text-slate-500">Order not found.</div>
  const p = product(order.productId)
  const bom = state.boms.find((item) => item.id === order.bomId)
  const rows = materialAvailability(state, order.warehouseId, order.consumptions)
  const shortage = hasShortage(rows)
  const canStart = order.status === 'draft' || order.status === 'planned'
  const canPause = order.status === 'in_progress'
  const canResume = order.status === 'paused'
  const canComplete = order.status === 'in_progress' || order.status === 'paused'
  const canEdit = !order.posted && order.status !== 'completed' && order.status !== 'cancelled'

  const start = (ignoreShortage = false) => {
    const ok = api.startProduction(order.id, { ignoreShortage })
    if (ok) {
      api.closeDrawer()
      navigate(`/manufacturing/consumption?order=${order.id}`)
    }
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {p && <ProductMark product={p} size="lg" />}
          <div>
            <div className="text-sm text-slate-500">{p?.name} · {p?.sku}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge status={order.status} />
              {order.posted && <StatusBadge status="completed" />}
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {canStart && <Button size="sm" onClick={() => start(false)}>Start production</Button>}
        {canStart && shortage && <Button size="sm" variant="secondary" onClick={() => start(true)}>Start anyway</Button>}
        {canPause && <Button size="sm" variant="secondary" onClick={() => api.pauseProduction(order.id)}>Pause</Button>}
        {canResume && <Button size="sm" onClick={() => api.resumeProduction(order.id)}>Resume</Button>}
        {canComplete && <Button size="sm" variant="success" onClick={() => { setActualQty(order.plannedQty); setBatchNo(order.batchNo); setCompleteOpen(true) }}>Complete</Button>}
        {canEdit && <Button size="sm" variant="danger" onClick={() => setCancelOpen(true)}>Cancel</Button>}
        {(order.status === 'in_progress' || order.status === 'paused' || order.status === 'completed') && (
          <Button size="sm" variant="secondary" onClick={() => navigate(`/manufacturing/consumption?order=${order.id}`)}>Material consumption</Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="Planned qty" value={`${formatQty(order.plannedQty)} ${order.unit}`} />
        <Mini label="Actual qty" value={order.actualQty ? `${formatQty(order.actualQty)} ${order.unit}` : '—'} />
        <Mini label="Warehouse" value={warehouseName(order.warehouseId)} />
        <Mini label="Operator" value={order.operator} />
        <Mini label="Planned start" value={formatDateTime(order.plannedStart)} />
        <Mini label="Planned end" value={formatDateTime(order.plannedEnd)} />
        <Mini label="Batch" value={order.batchNo || '—'} />
        <Mini label="Cost estimate" value={formatMoney(order.costEstimate)} />
      </div>
      {order.notes && <p className="text-sm text-slate-600">{order.notes}</p>}
      {canEdit && (order.status === 'draft' || order.status === 'planned') && (
        <EditOrderFields order={order} />
      )}
      <div>
        <div className="mb-2 text-sm font-semibold">Material availability</div>
        <AvailabilityPanel
          rows={rows}
          onPurchaseRequest={shortage && canStart ? () => api.createPurchaseRequest(order.id) : undefined}
        />
      </div>
      <ConsumptionTable order={order} />
      <div>
        <div className="mb-2 text-sm font-semibold">Wastage / yield variance</div>
        {order.wastage.length === 0 ? (
          <p className="text-sm text-slate-500">No wastage recorded yet.</p>
        ) : (
          <div className="sf-table-wrap rounded-xl border border-slate-100">
            <table>
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Reason</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {order.wastage.map((row) => (
                  <tr key={row.id} className="cursor-default">
                    <td>{wastageKindLabel(row.kind)}</td>
                    <td>{row.productId ? product(row.productId)?.name : p?.name}</td>
                    <td className="tabular">{formatQty(row.qty)} {row.unit}</td>
                    <td>{row.reason}</td>
                    <td>{row.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <div className="mt-3 grid gap-2 rounded-xl border border-slate-100 p-3 sm:grid-cols-6">
            <Select value={wastageKind} onChange={(e) => setWastageKind(e.target.value as WastageKind)}>
              <option value="material">Material wastage</option>
              <option value="process_loss">Process loss</option>
              <option value="damaged_fg">Damaged finished goods</option>
              <option value="yield_variance">Yield variance</option>
            </Select>
            <Select value={wastageProductId} onChange={(e) => setWastageProductId(e.target.value)}>
              {order.consumptions.map((line) => (
                <option key={line.productId} value={line.productId}>{product(line.productId)?.name}</option>
              ))}
              <option value={order.productId}>{p?.name} (FG)</option>
            </Select>
            <Input type="number" min={0} step="0.01" value={wastageQty} onChange={(e) => setWastageQty(Number(e.target.value))} placeholder="Qty" />
            <Input value={wastageReason} onChange={(e) => setWastageReason(e.target.value)} placeholder="Reason" />
            <Input value={wastageNotes} onChange={(e) => setWastageNotes(e.target.value)} placeholder="Notes" />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const mat = product(wastageProductId)
                api.recordWastage(order.id, {
                  kind: wastageKind,
                  productId: wastageProductId,
                  qty: wastageQty,
                  unit: mat?.unit ?? order.unit,
                  reason: wastageReason || wastageKindLabel(wastageKind),
                  notes: wastageNotes,
                })
                setWastageQty(0)
                setWastageReason('')
                setWastageNotes('')
              }}
            >
              Record wastage
            </Button>
          </div>
        )}
      </div>
      <div className="text-xs text-slate-400">
        BOM {bom?.name} · Wastage {formatQty(orderWastageQty(order))} {order.unit}
        {order.expiryDate ? ` · Expiry ${formatDate(order.expiryDate)}` : ''}
        {order.actualStart ? ` · Started ${formatDateTime(order.actualStart)}` : ''}
      </div>
      <ConfirmDialog
        open={cancelOpen}
        title="Cancel production order"
        message={`Cancel ${order.orderNo}? This cannot be posted afterwards.`}
        confirmLabel="Cancel order"
        tone="danger"
        onClose={() => setCancelOpen(false)}
        onConfirm={() => {
          api.cancelProduction(order.id)
          setCancelOpen(false)
        }}
      />
      {completeOpen && (
        <CompleteProductionForm
          order={order}
          actualQty={actualQty}
          batchNo={batchNo}
          expiryDate={expiryDate}
          onActualQty={setActualQty}
          onBatchNo={setBatchNo}
          onExpiry={setExpiryDate}
          onClose={() => setCompleteOpen(false)}
          onSubmit={() => {
            const ok = api.completeProduction(order.id, { actualQty, batchNo, expiryDate })
            if (ok) {
              setCompleteOpen(false)
              api.closeDrawer()
              navigate('/manufacturing/finished-goods')
            }
          }}
        />
      )}
    </div>
  )
}

function EditOrderFields({ order }: { order: ProductionOrder }) {
  const api = useApi()
  const state = useStore()
  const [plannedQty, setPlannedQty] = useState(order.plannedQty)
  const [plannedStart, setPlannedStart] = useState(dateInputValue(order.plannedStart))
  const [plannedEnd, setPlannedEnd] = useState(dateInputValue(order.plannedEnd))
  const [operator, setOperator] = useState(order.operator)
  const [notes, setNotes] = useState(order.notes)
  return (
    <div className="rounded-xl border border-slate-100 p-4">
      <div className="mb-3 text-sm font-semibold">Edit order</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Planned quantity">
          <Input type="number" min={0.01} step="0.01" value={plannedQty} onChange={(e) => setPlannedQty(Number(e.target.value))} />
        </Field>
        <Field label="Operator">
          <Select value={operator} onChange={(e) => setOperator(e.target.value)}>
            {state.users.filter((u) => u.status === 'active').map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
          </Select>
        </Field>
        <Field label="Planned start"><Input type="date" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} /></Field>
        <Field label="Planned end"><Input type="date" value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} /></Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </div>
      <Button
        className="mt-3"
        size="sm"
        variant="secondary"
        onClick={() => api.updateProductionOrder(order.id, {
          plannedQty,
          plannedStart: toLocalIso(plannedStart, 8),
          plannedEnd: toLocalIso(plannedEnd, 17),
          operator,
          notes,
        })}
      >
        Save changes
      </Button>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  )
}

export function ConsumptionTable({ order }: { order: ProductionOrder }) {
  const { product } = useLookups()
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Expected consumption</div>
        {order.consumptionConfirmed && <StatusBadge status="completed" />}
      </div>
      <div className="sf-table-wrap rounded-xl border border-slate-100">
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>Expected</th>
              <th>Actual</th>
              <th>Variance</th>
            </tr>
          </thead>
          <tbody>
            {order.consumptions.map((line) => {
              const variance = round2(line.actualQty - line.expectedQty)
              return (
                <tr key={line.productId} className="cursor-default">
                  <td>{product(line.productId)?.name}</td>
                  <td className="tabular">{formatQty(line.expectedQty)} {line.unit}</td>
                  <td className="tabular">{formatQty(line.actualQty)} {line.unit}</td>
                  <td className={`tabular ${variance > 0 ? 'text-amber-600' : variance < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {variance > 0 ? '+' : ''}{formatQty(variance)} {line.unit}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CompleteProductionForm({
  order,
  actualQty,
  batchNo,
  expiryDate,
  onActualQty,
  onBatchNo,
  onExpiry,
  onClose,
  onSubmit,
}: {
  order: ProductionOrder
  actualQty: number
  batchNo: string
  expiryDate: string
  onActualQty: (n: number) => void
  onBatchNo: (s: string) => void
  onExpiry: (s: string) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const variance = round2(order.plannedQty - actualQty)
  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
      <div className="text-sm font-semibold text-slate-900">Complete production</div>
      <p className="mt-1 text-sm text-slate-600">Posts material consumption and finished goods into inventory.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Actual quantity">
          <Input type="number" min={0.01} step="0.01" value={actualQty} onChange={(e) => onActualQty(Number(e.target.value))} />
        </Field>
        <Field label="Batch number">
          <Input value={batchNo} onChange={(e) => onBatchNo(e.target.value)} />
        </Field>
        <Field label="Expiry date">
          <Input type="date" value={dateInputValue(expiryDate)} onChange={(e) => onExpiry(e.target.value)} />
        </Field>
        <Field label="Yield variance">
          <Input disabled value={`${variance > 0 ? '+' : ''}${formatQty(variance)} ${order.unit}`} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Back</Button>
        <Button variant="success" onClick={onSubmit}>Add finished goods</Button>
      </div>
    </div>
  )
}
