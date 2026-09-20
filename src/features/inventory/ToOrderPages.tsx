import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState, Field, FilterRow, Input, KpiCard, Modal, PageHeader, Select, StatusBadge, Tabs } from '@/components/ui'
import { ProductMark } from '@/components/ProductMark'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { companyWarehouses, isCompanyWarehouseId } from '@/features/agent/agentModel'
import {
  STOCK_ORDER_CANCEL_REASONS,
  STOCK_ORDER_CHANNELS,
  toOrderQueue,
} from '@/features/inventory/toOrderModel'
import { hasPermission } from '@/features/settings/permissions'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatQty } from '@/utils/format'

export function StockUsagePage() {
  const state = useStore()
  const api = useApi()
  const [warehouseId, setWarehouseId] = useState(state.settings.defaultWarehouseId)
  const [productId, setProductId] = useState(state.products.find((product) => product.status === 'active')?.id ?? '')
  const [qty, setQty] = useState<number | ''>(1)
  const [notes, setNotes] = useState('')
  const canUse = hasPermission(state, 'inventory.usage')
  const product = state.products.find((item) => item.id === productId)
  const current = api.getProductQty(productId, warehouseId)
  const used = Number(qty)
  const next = Number.isFinite(used) && used > 0 ? current - used : current

  if (!canUse) return <PermissionDenied title="Stock Usage" />

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Stock Usage" subtitle="Record items that were actually used. Stock decreases immediately." />
      <Card className="space-y-4 p-6">
        <Field label="Warehouse">
          <Select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
            {companyWarehouses(state.warehouses).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Product">
          <Select value={productId} onChange={(event) => setProductId(event.target.value)}>
            {state.products.filter((item) => item.status === 'active').map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-3 rounded-2xl bg-slate-50 p-4 text-center">
          <div>
            <div className="text-xs text-slate-400">Current</div>
            <div className="text-lg font-semibold">{formatQty(current)} {product?.unit}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Qty used</div>
            <div className="text-lg font-semibold">−{Number.isFinite(used) && used > 0 ? formatQty(used) : '—'} {product?.unit}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">New</div>
            <div className="text-lg font-semibold">{formatQty(next)} {product?.unit}</div>
          </div>
        </div>
        <Field label="Quantity used">
          <Input
            type="number"
            min={0}
            step="any"
            value={qty}
            onChange={(event) => setQty(event.target.value === '' ? '' : Number(event.target.value))}
          />
        </Field>
        <Field label="Reason / note (optional)">
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Office use, cleaning, sample…" />
        </Field>
        <Button
          className="w-full"
          onClick={() => {
            const recorded = api.recordStockUsage({ warehouseId, productId, qty: Number(qty), notes })
            if (recorded) {
              setQty(1)
              setNotes('')
            }
          }}
        >
          Submit usage
        </Button>
      </Card>
    </div>
  )
}

export function ToOrderPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { product, warehouseName } = useLookups()
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const [orderRow, setOrderRow] = useState<{ productId: string; warehouseId: string } | null>(null)
  const [channel, setChannel] = useState<(typeof STOCK_ORDER_CHANNELS)[number]>('Shopee')
  const [remark, setRemark] = useState('')
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState<(typeof STOCK_ORDER_CANCEL_REASONS)[number]>('Supplier cancelled')
  const canView = hasPermission(state, 'inventory.view')
  const canOrder = hasPermission(state, 'inventory.adjust')
  const canReceive = hasPermission(state, 'receiving.create')

  const rows = useMemo(() => {
    return toOrderQueue(state).filter((row) => {
      if (state.ui.warehouseFilter !== 'all' && row.warehouseId !== state.ui.warehouseFilter) return false
      if (state.ui.warehouseFilter === 'all' && !isCompanyWarehouseId(state.warehouses, row.warehouseId)) return false
      if (tab === 'low_stock' && row.status !== 'low_stock') return false
      if (tab === 'ordered' && row.status !== 'ordered') return false
      const item = product(row.productId)
      if (query && !`${item?.name ?? ''} ${item?.sku ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
  }, [state, tab, query, product])

  const allRows = toOrderQueue(state).filter((row) =>
    state.ui.warehouseFilter === 'all'
      ? isCompanyWarehouseId(state.warehouses, row.warehouseId)
      : row.warehouseId === state.ui.warehouseFilter,
  )

  if (!canView) return <PermissionDenied title="To Order" />

  return (
    <div>
      <PageHeader title="To Order" subtitle="Items that need purchasing attention. The system does not decide how much to buy." />
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <KpiCard label="Low stock" value={String(allRows.filter((row) => row.status === 'low_stock').length)} tone="warning" />
        <KpiCard label="Awaiting receiving" value={String(allRows.filter((row) => row.status === 'ordered').length)} tone="default" />
      </div>
      <div className="mb-4">
        <Tabs
          tabs={[
            { id: 'all', label: 'All' },
            { id: 'low_stock', label: 'Low Stock' },
            { id: 'ordered', label: 'Ordered' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === 'ordered' && (
        <p className="mb-3 text-sm text-slate-500">Awaiting Receiving — ordered items waiting for the actual quantity to arrive.</p>
      )}
      <FilterRow>
        <Input placeholder="Search product or SKU" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Select value={state.ui.warehouseFilter} onChange={(event) => api.setWarehouseFilter(event.target.value)}>
          <option value="all">All warehouses</option>
          {companyWarehouses(state.warehouses).map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
          ))}
        </Select>
        <div />
        <div />
      </FilterRow>
      <Card>
        {rows.length ? (
          <div className="sf-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Warehouse</th>
                  <th>Current Stock</th>
                  <th>Min Stock</th>
                  <th>Unit</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const item = product(row.productId)
                  if (!item) return null
                  return (
                    <tr key={`${row.productId}-${row.warehouseId}-${row.order?.id ?? 'low'}`}>
                      <td>
                        <div className="flex items-center gap-3">
                          <ProductMark product={item} size="sm" />
                          <div>
                            <div className="font-medium">{item.name}</div>
                            {row.status === 'ordered' && row.order && (
                              <div className="text-xs text-slate-500">
                                {row.order.channel ? `Ordered via ${row.order.channel}` : 'Ordered'}
                                {row.order.markedOrderedBy ? ` · ${row.order.markedOrderedBy}` : ''}
                                {row.order.markedOrderedAt ? ` · ${formatDate(row.order.markedOrderedAt)}` : ''}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>{item.sku || '—'}</td>
                      <td>{warehouseName(row.warehouseId)}</td>
                      <td className="tabular">{formatQty(row.qty)}</td>
                      <td className="tabular">{formatQty(row.minStock)}</td>
                      <td>{item.unit}</td>
                      <td><StatusBadge status={row.status} /></td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          {row.status === 'low_stock' && canOrder && (
                            <Button size="sm" onClick={() => { setOrderRow({ productId: row.productId, warehouseId: row.warehouseId }); setChannel('Shopee'); setRemark('') }}>
                              Mark as Ordered
                            </Button>
                          )}
                          {row.status === 'ordered' && row.order && (
                            <>
                              {canReceive && (
                                <Button size="sm" onClick={() => navigate(`/receiving/new?orderId=${row.order!.id}`)}>
                                  Receive
                                </Button>
                              )}
                              {canOrder && (
                                <Button size="sm" variant="secondary" onClick={() => { setCancelId(row.order!.id); setCancelReason('Supplier cancelled') }}>
                                  Cancel Order
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={tab === 'ordered' ? 'Nothing awaiting receiving' : 'No items to order'}
            hint="Items appear here when current stock is at or below Min Stock."
          />
        )}
      </Card>

      <Modal open={Boolean(orderRow)} onClose={() => setOrderRow(null)} title="Mark as Ordered">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Record that the external order has been placed. Stock does not change.</p>
          <Field label="Channel (optional)">
            <Select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}>
              {STOCK_ORDER_CHANNELS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </Select>
          </Field>
          <Field label="Remark (optional)">
            <Input value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="Order number or note" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOrderRow(null)}>Back</Button>
            <Button
              onClick={() => {
                if (!orderRow) return
                const saved = api.markStockOrdered({ ...orderRow, channel, remark })
                if (saved) setOrderRow(null)
              }}
            >
              Mark as Ordered
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(cancelId)} onClose={() => setCancelId(null)} title="Cancel Order">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Cancellation does not add stock or change inventory quantity.</p>
          <Field label="Reason">
            <Select value={cancelReason} onChange={(event) => setCancelReason(event.target.value as typeof cancelReason)}>
              {STOCK_ORDER_CANCEL_REASONS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelId(null)}>Back</Button>
            <Button
              onClick={() => {
                if (!cancelId) return
                if (api.cancelStockOrder(cancelId, cancelReason)) setCancelId(null)
              }}
            >
              Cancel Order
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
