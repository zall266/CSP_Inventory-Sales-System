import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Card, Field, FilterRow, Input, KpiCard, PageHeader, Select, StatusBadge } from '@/components/ui'
import { companyWarehouses, isCompanyWarehouseId } from '@/features/agent/agentModel'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatMoney, round2 } from '@/utils/format'

export function PurchasesPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { supplierName } = useLookups()
  const [query, setQuery] = useState('')
  const rows = useMemo(
    () =>
      state.purchases.filter((p) => {
        if (state.ui.warehouseFilter === 'all') {
          if (!isCompanyWarehouseId(state.warehouses, p.warehouseId)) return false
        } else if (p.warehouseId !== state.ui.warehouseFilter) {
          return false
        }
        if (query && !`${p.purchaseNo} ${p.invoiceNumber} ${supplierName(p.supplierId)}`.toLowerCase().includes(query.toLowerCase())) return false
        return true
      }),
    [state.purchases, state.ui.warehouseFilter, query, supplierName],
  )
  return (
    <div>
      <PageHeader title="Purchases" subtitle="Receive stock and track supplier invoices." actions={<Button onClick={() => navigate('/purchases/new')}><Plus size={16} /> New purchase</Button>} />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total purchases" value={formatMoney(state.purchases.reduce((s, p) => s + p.total, 0), { compact: true })} />
        <KpiCard label="Received" value={String(state.purchases.filter((p) => p.status === 'received' || p.status === 'paid' || p.status === 'partial').length)} />
        <KpiCard label="Pending" value={String(state.purchases.filter((p) => p.status === 'draft' || p.status === 'pending').length)} />
        <KpiCard label="Payables" value={formatMoney(state.purchases.reduce((s, p) => s + p.balance, 0), { compact: true })} />
      </div>
      <FilterRow>
        <Input placeholder="Search purchase no or supplier" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div /><div /><div />
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Purchase no</th>
                <th>Date</th>
                <th>Supplier</th>
                <th>Warehouse</th>
                <th>Items</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} onClick={() => api.openDrawer({ type: 'purchase', id: p.id })}>
                  <td className="font-medium text-indigo-700">{p.purchaseNo}</td>
                  <td>{formatDate(p.date)}</td>
                  <td>{supplierName(p.supplierId)}</td>
                  <td>{state.warehouses.find((w) => w.id === p.warehouseId)?.name}</td>
                  <td>{p.items.length}</td>
                  <td className="tabular">{formatMoney(p.total)}</td>
                  <td className="tabular">{formatMoney(p.paid)}</td>
                  <td className="tabular">{formatMoney(p.balance)}</td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

type DraftLine = { productId: string; qty: number; price: number; discount: number; batchNo: string; expiry: string }

export function NewPurchasePage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const [supplierId, setSupplierId] = useState(state.suppliers[0]?.id ?? '')
  const [warehouseId, setWarehouseId] = useState(state.settings.defaultWarehouseId)
  const [date, setDate] = useState('2026-09-10')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([
    { productId: 'p-cp', qty: 10, price: 22, discount: 0, batchNo: '', expiry: '' },
  ])
  const [discount, setDiscount] = useState(0)
  const [tax, setTax] = useState(0)
  const [shipping, setShipping] = useState(0)

  const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.price - l.discount, 0))
  const total = round2(subtotal - discount + tax + shipping)

  const addLine = () => {
    const p = state.products[0]
    setLines([...lines, { productId: p.id, qty: 1, price: p.costPrice, discount: 0, batchNo: '', expiry: '' }])
  }

  const submit = (receive: boolean) => {
    const created = api.createPurchase({
      supplierId,
      warehouseId,
      invoiceNumber,
      date: `${date}T12:00:00+08:00`,
      items: lines.map((l) => ({ productId: l.productId, qty: l.qty, price: l.price, discount: l.discount, batchNo: l.batchNo, expiry: l.expiry })),
      discount,
      tax,
      shipping,
      receive,
      paidAmount: 0,
    })
    if (created) navigate('/purchases')
  }

  return (
    <div>
      <PageHeader title="New Purchase" subtitle="Add lines, then save a draft or receive into stock." />
      <Card className="mb-4 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Supplier">
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            {state.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Purchase date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Warehouse">
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {companyWarehouses(state.warehouses).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        <Field label="Invoice number"><Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Supplier invoice" /></Field>
      </Card>
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">Products</div>
          <Button size="sm" variant="secondary" onClick={addLine}><Plus size={14} /> Add line</Button>
        </div>
        <div className="space-y-3">
          {lines.map((line, index) => {
            const p = state.products.find((x) => x.id === line.productId)
            return (
              <div key={index} className="grid gap-2 rounded-xl border border-slate-100 p-3 lg:grid-cols-8">
                <Select
                  className="lg:col-span-2"
                  value={line.productId}
                  onChange={(e) => {
                    const next = state.products.find((x) => x.id === e.target.value)
                    setLines(lines.map((l, i) => i === index ? { ...l, productId: e.target.value, price: next?.costPrice ?? l.price } : l))
                  }}
                >
                  {state.products.map((prod) => <option key={prod.id} value={prod.id}>{prod.name}</option>)}
                </Select>
                <Input placeholder="Batch" value={line.batchNo} onChange={(e) => setLines(lines.map((l, i) => i === index ? { ...l, batchNo: e.target.value } : l))} />
                <Input type="date" value={line.expiry} onChange={(e) => setLines(lines.map((l, i) => i === index ? { ...l, expiry: e.target.value } : l))} />
                <Input type="number" value={line.qty} onChange={(e) => setLines(lines.map((l, i) => i === index ? { ...l, qty: Number(e.target.value) } : l))} />
                <Input value={p?.unit ?? ''} readOnly />
                <Input type="number" step="0.01" value={line.price} onChange={(e) => setLines(lines.map((l, i) => i === index ? { ...l, price: Number(e.target.value) } : l))} />
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm tabular">{formatMoney(line.qty * line.price - line.discount)}</div>
                  <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))}><Trash2 size={14} className="text-slate-400" /></button>
                </div>
              </div>
            )
          })}
        </div>
        <div className="ml-auto mt-6 w-full max-w-xs space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{formatMoney(subtotal)}</span></div>
          <label className="flex justify-between gap-3">Discount <Input className="h-9 w-28" type="number" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} /></label>
          <label className="flex justify-between gap-3">Tax <Input className="h-9 w-28" type="number" value={tax} onChange={(e) => setTax(Number(e.target.value))} /></label>
          <label className="flex justify-between gap-3">Shipping <Input className="h-9 w-28" type="number" value={shipping} onChange={(e) => setShipping(Number(e.target.value))} /></label>
          <div className="flex justify-between text-base font-semibold"><span>Grand total</span><span>{formatMoney(total)}</span></div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => submit(false)}>Save draft</Button>
          <Button onClick={() => submit(true)}>Receive purchase</Button>
        </div>
      </Card>
    </div>
  )
}
