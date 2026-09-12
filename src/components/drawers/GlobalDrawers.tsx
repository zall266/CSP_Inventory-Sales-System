import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Drawer, StatusBadge, Tabs, Button, Badge, Field, Input } from '@/components/ui'
import { ProductMark, movementLabel, paymentLabel } from '@/components/ProductMark'
import { useApi, useLookups, useStore, customerOutstanding, customerSalesTotal, supplierOutstanding, supplierPurchaseTotal } from '@/store/hooks'
import { formatDate, formatMoney, formatQty } from '@/utils/format'
import { BomDetail } from '@/features/manufacturing/BomPages'
import { ProductionOrderDetail } from '@/features/manufacturing/ProductionOrdersPage'
import { isCompanyWarehouseId, saleIsAgentSale } from '@/features/agent/agentModel'
import { hasPermission } from '@/features/settings/permissions'

export function GlobalDrawers() {
  const drawer = useStore().ui.drawer
  const api = useApi()
  if (!drawer) return null
  const close = () => api.closeDrawer()
  if (drawer.type === 'product') return <ProductDrawer id={drawer.id} onClose={close} />
  if (drawer.type === 'sale') return <SaleDrawer id={drawer.id} onClose={close} />
  if (drawer.type === 'purchase') return <PurchaseDrawer id={drawer.id} onClose={close} />
  if (drawer.type === 'customer') return <CustomerDrawer id={drawer.id} onClose={close} />
  if (drawer.type === 'supplier') return <SupplierDrawer id={drawer.id} onClose={close} />
  if (drawer.type === 'movement') return <MovementDrawer id={drawer.id} onClose={close} />
  if (drawer.type === 'bom') return <BomDrawer id={drawer.id} onClose={close} />
  if (drawer.type === 'production') return <ProductionDrawer id={drawer.id} onClose={close} />
  return null
}

function ProductDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { state, categoryName, warehouseName, product } = useLookups()
  const api = useApi()
  const item = product(id)
  const [tab, setTab] = useState('overview')
  if (!item) return null
  const rows = state.inventory.filter((row) => row.productId === id && isCompanyWarehouseId(state.warehouses, row.warehouseId))
  const qty = rows.reduce((sum, row) => sum + row.qty, 0)
  const value = qty * item.costPrice
  const movements = state.stockMovements
    .filter((m) => m.productId === id && isCompanyWarehouseId(state.warehouses, m.warehouseId))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const sales = state.sales.filter((s) => s.items.some((line) => line.productId === id))
  const purchases = state.purchases.filter((p) => p.items.some((line) => line.productId === id))
  const batches = state.batches.filter((b) => b.productId === id)
  const productions = state.productionOrders.filter((o) => o.productId === id)

  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={item.name} subtitle={`${item.sku} · ${item.barcode}`}>
      <div className="space-y-5 p-6">
        <div className="flex items-start gap-4">
          <ProductMark product={item} size="lg" />
          <div className="flex-1">
            <div className="text-sm text-slate-500">{categoryName(item.categoryId)}</div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Mini label="Current stock" value={`${formatQty(qty)} ${item.unit}`} />
              <Mini label="Inventory value" value={formatMoney(value)} />
              <Mini label="Average cost" value={`${formatMoney(item.costPrice)} / ${item.unit}`} />
              <Mini label="Selling price" value={`${formatMoney(item.sellingPrice)} / ${item.unit}`} />
              <Mini label="Agent price" value={item.agentPrice === undefined || item.agentPrice === null ? 'Not configured' : `${formatMoney(item.agentPrice)} / ${item.unit}`} />
            </div>
          </div>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'card', label: 'Stock Card' },
            { id: 'batches', label: 'Batches' },
            { id: 'production', label: 'Production' },
            { id: 'sales', label: 'Sales' },
            { id: 'purchases', label: 'Purchases' },
          ]}
        />
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="sf-table-wrap rounded-xl border border-slate-100">
            <table>
              <thead>
                <tr>
                  <th>Warehouse</th>
                  <th>Stock</th>
                  <th>Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.warehouseId} className="cursor-default">
                    <td>{warehouseName(row.warehouseId)}</td>
                    <td className="tabular">{formatQty(row.qty)} {item.unit}</td>
                    <td className="tabular">{formatMoney(row.qty * item.costPrice)}</td>
                    <td>
                      <StatusBadge status={row.qty <= 0 ? 'out_of_stock' : row.qty <= item.reorderLevel ? 'low_stock' : 'in_stock'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <AgentPriceEditor productId={item.id} agentPrice={item.agentPrice} />
          </div>
        )}
        {tab === 'card' && (
          <div className="sf-table-wrap rounded-xl border border-slate-100">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reference</th>
                  <th>Type</th>
                  <th>Warehouse</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="cursor-default">
                    <td>{formatDate(m.date, { short: true })}</td>
                    <td>{m.reference}</td>
                    <td>{movementLabel(m.type)}</td>
                    <td>{warehouseName(m.warehouseId)}</td>
                    <td className="tabular text-emerald-600">{m.stockIn ? `+${formatQty(m.stockIn)}` : '—'}</td>
                    <td className="tabular text-rose-600">{m.stockOut ? `-${formatQty(m.stockOut)}` : '—'}</td>
                    <td className="tabular">{formatQty(m.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === 'batches' && (
          batches.length ? (
            <div className="sf-table-wrap rounded-xl border border-slate-100">
              <table>
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Warehouse</th>
                    <th>Qty</th>
                    <th>Production date</th>
                    <th>Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => (
                    <tr key={batch.id} className="cursor-default">
                      <td>{batch.batchNo}</td>
                      <td>{warehouseName(batch.warehouseId)}</td>
                      <td>{formatQty(batch.qty)}</td>
                      <td>{batch.productionDate ? formatDate(batch.productionDate) : '—'}</td>
                      <td>{batch.expiry ? formatDate(batch.expiry) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-slate-500">No batch records for this product in the prototype data.</div>
          )
        )}
        {tab === 'production' && (
          productions.length ? (
            <div className="sf-table-wrap rounded-xl border border-slate-100">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Date</th>
                    <th>Qty</th>
                    <th>Batch</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {productions.map((order) => (
                    <tr key={order.id} onClick={() => api.openDrawer({ type: 'production', id: order.id })}>
                      <td className="font-medium text-indigo-700">{order.orderNo}</td>
                      <td>{formatDate(order.date)}</td>
                      <td className="tabular">{formatQty(order.actualQty || order.plannedQty)} {order.unit}</td>
                      <td>{order.batchNo || '—'}</td>
                      <td><StatusBadge status={order.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-slate-500">No production orders for this product.</div>
          )
        )}
        {tab === 'sales' && <DocList rows={sales.map((s) => ({ id: s.id, no: s.invoiceNo, date: s.date, total: s.total, status: s.status }))} />}
        {tab === 'purchases' && <DocList rows={purchases.map((p) => ({ id: p.id, no: p.purchaseNo, date: p.date, total: p.total, status: p.status }))} />}
      </div>
    </Drawer>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  )
}

function AgentPriceEditor({ productId, agentPrice }: { productId: string; agentPrice?: number }) {
  const state = useStore()
  const api = useApi()
  const canEdit = hasPermission(state, 'agent.manage')
  const [draft, setDraft] = useState(agentPrice === undefined || agentPrice === null ? '' : String(agentPrice))
  if (!canEdit) return null
  const save = () => {
    const next = draft === '' ? undefined : Number(draft)
    if (next !== undefined && (!Number.isFinite(next) || next < 0)) {
      api.toast('Agent Price cannot be negative.', undefined, 'warning')
      return
    }
    api.updateProduct(productId, { agentPrice: next })
  }
  return (
    <div className="rounded-xl border border-slate-100 p-4">
      <Field label="Agent price">
        <div className="flex gap-2">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Required for agent sales"
          />
          <Button type="button" variant="secondary" onClick={save}>Save</Button>
        </div>
      </Field>
    </div>
  )
}

function DocList({ rows }: { rows: Array<{ id: string; no: string; date: string; total: number; status: string }> }) {
  if (!rows.length) return <div className="text-sm text-slate-500">No documents yet.</div>
  return (
    <div className="sf-table-wrap rounded-xl border border-slate-100">
      <table>
        <thead>
          <tr>
            <th>Document</th>
            <th>Date</th>
            <th>Total</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="cursor-default">
              <td className="font-medium">{row.no}</td>
              <td>{formatDate(row.date)}</td>
              <td className="tabular">{formatMoney(row.total)}</td>
              <td><StatusBadge status={row.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SaleDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { customerName, warehouseName, productName } = useLookups()
  const sale = state.sales.find((item) => item.id === id)
  if (!sale) return null
  const customer = state.customers.find((c) => c.id === sale.customerId)
  const agentSale = saleIsAgentSale(state, sale)

  return (
    <Drawer open onClose={onClose} width="max-w-3xl">
      <div className="grid h-full lg:grid-cols-[1fr_220px]">
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-500">Invoice</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">{sale.invoiceNo}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge status={sale.status} />
                <Badge>{warehouseName(sale.warehouseId)}</Badge>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 lg:hidden">
              Close
            </button>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Mini label="Customer" value={customerName(sale.customerId)} />
            <Mini label="Date" value={formatDate(sale.date)} />
            <Mini label="Payment" value={paymentLabel(sale.paymentMethod)} />
          </div>
          {customer?.phone && customer.phone !== '-' && (
            <div className="mt-2 text-sm text-slate-500">{customer.phone}</div>
          )}
          <div className="sf-table-wrap mt-6 rounded-2xl border border-slate-100">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {sale.items.map((line) => (
                  <tr key={line.productId} className="cursor-default">
                    <td>{productName(line.productId)}</td>
                    <td className="tabular">{formatQty(line.qty)}</td>
                    <td className="tabular">{formatMoney(line.price)}</td>
                    <td className="tabular font-medium">{formatMoney(line.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ml-auto mt-5 w-full max-w-xs space-y-2 text-sm">
            <Row label="Subtotal" value={formatMoney(sale.subtotal)} />
            {sale.shipping > 0 && <Row label="Delivery" value={formatMoney(sale.shipping)} />}
            <Row label="Discount" value={formatMoney(sale.discount)} />
            <Row label="Tax" value={formatMoney(sale.tax)} />
            <Row label="Total" value={formatMoney(sale.total)} strong />
            <Row label="Paid" value={formatMoney(sale.paid)} />
            <Row label="Balance" value={formatMoney(sale.balance)} />
          </div>
        </div>
        <div className="space-y-2 border-t border-slate-100 bg-slate-50 p-4 lg:border-l lg:border-t-0">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Actions</div>
          <Button className="w-full" variant="secondary" onClick={() => { onClose(); navigate(`/sales/invoices/${sale.id}`) }}>Official invoice</Button>
          {hasPermission(state, 'sales.invoice.print') || hasPermission(state, 'sales.invoice.view') || hasPermission(state, 'sales.view') ? (
            <Button className="w-full" variant="secondary" onClick={() => { onClose(); navigate(`/print/invoice/${sale.id}`) }}>Preview / Print</Button>
          ) : null}
          {!agentSale && (
            <Button className="w-full" variant="secondary" onClick={() => { onClose(); navigate(`/sales-returns?invoice=${sale.invoiceNo}`) }}>Return</Button>
          )}
          {!agentSale && (
            <Button className="w-full" variant="danger" disabled={sale.status === 'voided'} onClick={() => { api.voidSale(sale.id); onClose() }}>Void</Button>
          )}
          {sale.balance > 0 && sale.status !== 'voided' && (
            <Button className="w-full" onClick={() => api.openPaymentForSale(sale.id)}>Record Payment</Button>
          )}
          {hasPermission(state, 'sales.delivery.create') && sale.status !== 'voided' && (
            <Button className="w-full" variant="secondary" onClick={() => { onClose(); navigate(`/sales/delivery-orders/new?invoice=${sale.id}`) }}>Create DO</Button>
          )}
        </div>
      </div>
    </Drawer>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? 'text-base font-semibold text-slate-900' : 'tabular text-slate-800'}>{value}</span>
    </div>
  )
}

function PurchaseDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { supplierName, warehouseName, productName } = useLookups()
  const purchase = state.purchases.find((item) => item.id === id)
  if (!purchase) return null
  return (
    <Drawer open onClose={onClose} width="max-w-3xl" title={purchase.purchaseNo} subtitle={supplierName(purchase.supplierId)}>
      <div className="space-y-5 p-6">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={purchase.status} />
          <Badge>{warehouseName(purchase.warehouseId)}</Badge>
          <Badge tone="slate">{formatDate(purchase.date)}</Badge>
        </div>
        <div className="sf-table-wrap rounded-xl border border-slate-100">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Qty</th>
                <th>Cost</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {purchase.items.map((line) => (
                <tr key={line.productId} className="cursor-default">
                  <td>{productName(line.productId)}</td>
                  <td>{formatQty(line.qty)}</td>
                  <td>{formatMoney(line.price)}</td>
                  <td>{formatMoney(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ml-auto w-full max-w-xs space-y-2 text-sm">
          <Row label="Subtotal" value={formatMoney(purchase.subtotal)} />
          <Row label="Discount" value={formatMoney(purchase.discount)} />
          <Row label="Tax" value={formatMoney(purchase.tax)} />
          <Row label="Shipping" value={formatMoney(purchase.shipping)} />
          <Row label="Grand total" value={formatMoney(purchase.total)} strong />
          <Row label="Paid" value={formatMoney(purchase.paid)} />
          <Row label="Balance" value={formatMoney(purchase.balance)} />
        </div>
        <div className="flex flex-wrap gap-2">
          {purchase.status === 'draft' && <Button onClick={() => api.receivePurchase(purchase.id)}>Receive Purchase</Button>}
          <Button variant="secondary" onClick={() => { onClose(); navigate(`/purchase-returns?purchase=${purchase.purchaseNo}`) }}>Return</Button>
          {purchase.balance > 0 && <Button variant="secondary" onClick={() => api.openModal('payment')}>Record Payment</Button>}
        </div>
      </div>
    </Drawer>
  )
}

function CustomerDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const state = useStore()
  const api = useApi()
  const [tab, setTab] = useState('overview')
  const customer = state.customers.find((item) => item.id === id)
  if (!customer) return null
  const sales = state.sales.filter((s) => s.customerId === id)
  const payments = state.payments.filter((p) => p.partyType === 'customer' && p.partyId === id)
  const returns = state.salesReturns.filter((r) => sales.some((s) => s.id === r.saleId))
  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={customer.name} subtitle={customer.phone}>
      <div className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-3">
          <Mini label="Total sales" value={formatMoney(customerSalesTotal(state, id), { compact: true })} />
          <Mini label="Outstanding" value={formatMoney(customerOutstanding(state, id))} />
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'sales', label: 'Sales' },
            { id: 'payments', label: 'Payments' },
            { id: 'returns', label: 'Returns' },
          ]}
        />
        {tab === 'overview' && (
          <div className="space-y-2 text-sm text-slate-600">
            <div>Email: {customer.email || '—'}</div>
            <div>Status: <StatusBadge status={customer.status} /></div>
            <div>Last sale: {sales[0] ? formatDate(sales.slice().sort((a, b) => b.date.localeCompare(a.date))[0].date) : '—'}</div>
          </div>
        )}
        {tab === 'sales' && (
          <DocList rows={sales.map((s) => ({ id: s.id, no: s.invoiceNo, date: s.date, total: s.total, status: s.status }))} />
        )}
        {tab === 'payments' && (
          payments.length ? (
            <div className="space-y-2">
              {payments.map((p) => (
                <div key={p.id} className="flex justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span>{p.paymentNo} · {p.invoiceNo}</span>
                  <span className="tabular">{formatMoney(p.amount)}</span>
                </div>
              ))}
            </div>
          ) : <div className="text-sm text-slate-500">No payments yet.</div>
        )}
        {tab === 'returns' && (
          returns.length ? (
            <div className="space-y-2">
              {returns.map((r) => (
                <div key={r.id} className="flex justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span>{r.returnNo}</span>
                  <span>{formatMoney(r.total)}</span>
                </div>
              ))}
            </div>
          ) : <div className="text-sm text-slate-500">No returns yet.</div>
        )}
        {customerOutstanding(state, id) > 0 && (
          <Button onClick={() => api.openModal('payment')}>Record Payment</Button>
        )}
      </div>
    </Drawer>
  )
}

function SupplierDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const state = useStore()
  const { productName } = useLookups()
  const supplier = state.suppliers.find((item) => item.id === id)
  if (!supplier) return null
  const purchases = state.purchases.filter((p) => p.supplierId === id)
  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={supplier.name} subtitle={supplier.contact}>
      <div className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-3">
          <Mini label="Purchases" value={formatMoney(supplierPurchaseTotal(state, id), { compact: true })} />
          <Mini label="Payables" value={formatMoney(supplierOutstanding(state, id))} />
        </div>
        <div className="text-sm text-slate-600">
          {supplier.phone} · {supplier.email}
        </div>
        <DocList rows={purchases.map((p) => ({ id: p.id, no: p.purchaseNo, date: p.date, total: p.total, status: p.status }))} />
        {purchases[0] && (
          <div className="text-xs text-slate-400">Recent lines include {productName(purchases[0].items[0]?.productId ?? '')}</div>
        )}
      </div>
    </Drawer>
  )
}

function MovementDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const state = useStore()
  const { productName, warehouseName } = useLookups()
  const movement = state.stockMovements.find((item) => item.id === id)
  if (!movement) return null
  return (
    <Drawer open onClose={onClose} width="max-w-md" title={movement.reference} subtitle={movementLabel(movement.type)}>
      <div className="space-y-3 p-6 text-sm">
        <Row label="Date" value={formatDate(movement.date)} />
        <Row label="Product" value={productName(movement.productId)} />
        <Row label="Warehouse" value={warehouseName(movement.warehouseId)} />
        <Row label="Stock in" value={formatQty(movement.stockIn)} />
        <Row label="Stock out" value={formatQty(movement.stockOut)} />
        <Row label="Balance" value={formatQty(movement.balance)} />
        <Row label="User" value={movement.user} />
        {movement.notes && <div className="rounded-xl bg-slate-50 p-3 text-slate-600">{movement.notes}</div>}
      </div>
    </Drawer>
  )
}

function BomDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const state = useStore()
  const bom = state.boms.find((item) => item.id === id)
  if (!bom) return null
  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={bom.name} subtitle="Bill of materials">
      <BomDetail id={id} />
    </Drawer>
  )
}

function ProductionDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const state = useStore()
  const order = state.productionOrders.find((item) => item.id === id)
  if (!order) return null
  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={order.orderNo} subtitle="Production order">
      <ProductionOrderDetail id={id} />
    </Drawer>
  )
}
