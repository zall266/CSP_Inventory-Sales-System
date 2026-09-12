import { useMemo, useState } from 'react'
import { Button, Card, ConfirmDialog, Field, FilterRow, Input, PageHeader, Select } from '@/components/ui'
import { movementLabel } from '@/components/ProductMark'
import { companyWarehouses, isCompanyWarehouseId } from '@/features/agent/agentModel'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatQty } from '@/utils/format'
import type { AdjustmentType } from '@/types'

export function StockMovementsPage() {
  const state = useStore()
  const api = useApi()
  const { productName, warehouseName } = useLookups()
  const [query, setQuery] = useState('')
  const [type, setType] = useState('all')
  const [user, setUser] = useState('all')
  const users = [...new Set(state.stockMovements.map((m) => m.user))]
  const rows = useMemo(() => {
    return state.stockMovements.filter((m) => {
      if (state.ui.warehouseFilter === 'all') {
        if (!isCompanyWarehouseId(state.warehouses, m.warehouseId)) return false
      } else if (m.warehouseId !== state.ui.warehouseFilter) {
        return false
      }
      if (type !== 'all' && m.type !== type) return false
      if (user !== 'all' && m.user !== user) return false
      if (query && !`${m.reference} ${productName(m.productId)}`.toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
  }, [state.stockMovements, state.ui.warehouseFilter, type, user, query, productName])

  return (
    <div>
      <PageHeader title="Stock Movements" subtitle="A complete ledger of every stock in and stock out." />
      <FilterRow>
        <Input placeholder="Search product or reference" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All movement types</option>
          {['purchase','sale','sales_return','purchase_return','adjustment','transfer_in','transfer_out','opening_stock','stock_count','production_in','production_out','production_wastage','production_balance_in','production_balance_out'].map((t) => (
            <option key={t} value={t}>{movementLabel(t)}</option>
          ))}
        </Select>
        <Select value={state.ui.warehouseFilter} onChange={(e) => api.setWarehouseFilter(e.target.value)}>
          <option value="all">All warehouses</option>
          {companyWarehouses(state.warehouses).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <Select value={user} onChange={(e) => setUser(e.target.value)}>
          <option value="all">All users</option>
          {users.map((u) => <option key={u} value={u}>{u}</option>)}
        </Select>
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference</th>
                <th>Product</th>
                <th>Warehouse</th>
                <th>Type</th>
                <th>Stock in</th>
                <th>Stock out</th>
                <th>Balance</th>
                <th>User</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 250).map((m) => (
                <tr key={m.id} onClick={() => api.openDrawer({ type: 'movement', id: m.id })}>
                  <td>{formatDate(m.date)}</td>
                  <td className="font-medium">{m.reference}</td>
                  <td>{productName(m.productId)}</td>
                  <td>{warehouseName(m.warehouseId)}</td>
                  <td>{movementLabel(m.type)}</td>
                  <td className="tabular text-emerald-600">{m.stockIn ? formatQty(m.stockIn) : '—'}</td>
                  <td className="tabular text-rose-600">{m.stockOut ? formatQty(m.stockOut) : '—'}</td>
                  <td className="tabular">{formatQty(m.balance)}</td>
                  <td>{m.user}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export function StockAdjustmentPage() {
  const state = useStore()
  const api = useApi()
  const [warehouseId, setWarehouseId] = useState(state.settings.defaultWarehouseId)
  const [productId, setProductId] = useState(state.products[0]?.id ?? '')
  const [type, setType] = useState<AdjustmentType>('decrease')
  const [qty, setQty] = useState(5)
  const [reason, setReason] = useState('Damage')
  const [notes, setNotes] = useState('')
  const [confirm, setConfirm] = useState(false)
  const current = api.getProductQty(productId, warehouseId)
  const next = type === 'increase' ? current + qty : current - qty
  const unit = state.products.find((p) => p.id === productId)?.unit ?? ''

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Stock Adjustment" subtitle="Increase or decrease on-hand quantity with a reason." />
      <Card className="space-y-4 p-6">
        <Field label="Warehouse">
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {companyWarehouses(state.warehouses).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        <Field label="Product">
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            {state.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-3 rounded-2xl bg-slate-50 p-4 text-center">
          <div><div className="text-xs text-slate-400">Current</div><div className="text-lg font-semibold">{formatQty(current)} {unit}</div></div>
          <div><div className="text-xs text-slate-400">Adjustment</div><div className="text-lg font-semibold">{type === 'increase' ? '+' : '-'}{formatQty(qty)} {unit}</div></div>
          <div><div className="text-xs text-slate-400">New</div><div className="text-lg font-semibold">{formatQty(next)} {unit}</div></div>
        </div>
        <Field label="Adjustment type">
          <Select value={type} onChange={(e) => setType(e.target.value as AdjustmentType)}>
            <option value="increase">Increase</option>
            <option value="decrease">Decrease</option>
          </Select>
        </Field>
        <Field label="Quantity"><Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option>Damage</option>
            <option>Expired</option>
            <option>Found stock</option>
            <option>Theft / loss</option>
            <option>Correction</option>
          </Select>
        </Field>
        <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Button className="w-full" onClick={() => setConfirm(true)}>Confirm adjustment</Button>
      </Card>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Confirm stock adjustment"
        message={`Update ${state.products.find((p) => p.id === productId)?.name} from ${formatQty(current)} to ${formatQty(next)} ${unit}?`}
        confirmLabel="Confirm adjustment"
        onConfirm={() => {
          api.adjustStock({ warehouseId, productId, type, qty, reason, notes })
          setConfirm(false)
        }}
      />
    </div>
  )
}

export function StockTransferPage() {
  const state = useStore()
  const api = useApi()
  const [fromWarehouseId, setFrom] = useState('wh-main')
  const [toWarehouseId, setTo] = useState('wh-outlet')
  const [productId, setProductId] = useState('p-cp')
  const [qty, setQty] = useState(20)
  const [confirm, setConfirm] = useState(false)
  const product = state.products.find((p) => p.id === productId)
  const source = api.getProductQty(productId, fromWarehouseId)
  const dest = api.getProductQty(productId, toWarehouseId)

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Transfer Stock" subtitle="Move quantity between warehouses." />
      <Card className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From warehouse">
            <Select value={fromWarehouseId} onChange={(e) => setFrom(e.target.value)}>
              {companyWarehouses(state.warehouses).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="To warehouse">
            <Select value={toWarehouseId} onChange={(e) => setTo(e.target.value)}>
              {companyWarehouses(state.warehouses).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Product">
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            {state.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Quantity"><Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>
        <div className="space-y-3 rounded-2xl bg-slate-50 p-5 text-center">
          <div className="font-medium">{state.warehouses.find((w) => w.id === fromWarehouseId)?.name}</div>
          <div className="text-slate-500">{formatQty(source)} {product?.unit}</div>
          <div className="text-indigo-600">↓ Transfer {formatQty(qty)} {product?.unit}</div>
          <div className="font-medium">{state.warehouses.find((w) => w.id === toWarehouseId)?.name}</div>
          <div className="text-slate-500">{formatQty(dest)} {product?.unit} current · {formatQty(dest + qty)} after</div>
        </div>
        <Button className="w-full" onClick={() => setConfirm(true)}>Confirm transfer</Button>
      </Card>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Confirm transfer"
        message={`Move ${qty} ${product?.unit} of ${product?.name}?`}
        confirmLabel="Confirm transfer"
        onConfirm={() => {
          api.transferStock({ fromWarehouseId, toWarehouseId, productId, qty })
          setConfirm(false)
        }}
      />
    </div>
  )
}

export function StockCountPage() {
  const state = useStore()
  const api = useApi()
  const [warehouseId, setWarehouseId] = useState(state.settings.defaultWarehouseId)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [confirm, setConfirm] = useState(false)
  const rows = state.products.filter((p) => p.status === 'active').map((p) => {
    const system = api.getProductQty(p.id, warehouseId)
    const counted = counts[p.id] ?? system
    return { product: p, system, counted, diff: counted - system }
  })

  return (
    <div>
      <PageHeader
        title="Stock Count"
        subtitle="Compare physical counts against system quantity."
        actions={<Button onClick={() => setConfirm(true)}>Complete stock count</Button>}
      />
      <div className="mb-4 max-w-xs">
        <Select value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setCounts({}) }}>
          {companyWarehouses(state.warehouses).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      </div>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>System qty</th>
                <th>Counted qty</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.product.id} className="cursor-default">
                  <td className="font-medium">{row.product.name}</td>
                  <td className="tabular">{formatQty(row.system)}</td>
                  <td>
                    <Input
                      type="number"
                      className="h-9 w-28"
                      value={row.counted}
                      onChange={(e) => setCounts((c) => ({ ...c, [row.product.id]: Number(e.target.value) }))}
                    />
                  </td>
                  <td className={row.diff === 0 ? 'text-slate-400' : row.diff < 0 ? 'text-rose-600' : 'text-emerald-600'}>
                    {row.diff > 0 ? '+' : ''}{formatQty(row.diff)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Complete stock count"
        message="Differences will be posted as stock count adjustments."
        confirmLabel="Complete stock count"
        onConfirm={() => {
          api.completeStockCount({
            warehouseId,
            counts: rows.map((row) => ({ productId: row.product.id, countedQty: row.counted })),
          })
          setConfirm(false)
        }}
      />
    </div>
  )
}

