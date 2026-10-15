import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from '@/components/ui'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatMoney, formatQty } from '@/utils/format'

export function SalesReturnsPage() {
  const state = useStore()
  const api = useApi()
  const { productName } = useLookups()
  const [params] = useSearchParams()
  const [query, setQuery] = useState(params.get('invoice') ?? '')
  const sale = state.sales.find((s) => s.invoiceNo.toLowerCase() === query.trim().toLowerCase()) ?? state.sales.find((s) => s.invoiceNo.toLowerCase().includes(query.trim().toLowerCase()))
  const [qtys, setQtys] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('Customer return')

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Sales Returns" subtitle="Search an invoice, choose quantities, and restock." />
      <Card className="space-y-4 p-5">
        <Field label="Search invoice">
          <Input placeholder="INV-001245" value={query} onChange={(e) => { setQuery(e.target.value); setQtys({}) }} />
        </Field>
        {sale ? (
          <>
            <div className="text-sm text-slate-500">{sale.invoiceNo} · {formatMoney(sale.total)}</div>
            <div className="space-y-3">
              {sale.items.map((line) => {
                const available = line.qty - line.returnedQty
                return (
                  <div key={line.productId} className="grid items-center gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-4">
                    <div>
                      <div className="font-medium">{productName(line.productId)}</div>
                      <div className="text-xs text-slate-400">Original {formatQty(line.qty)} · Returned {formatQty(line.returnedQty)}</div>
                    </div>
                    <div className="text-sm text-slate-500">Available {formatQty(available)}</div>
                    <Input
                      type="number"
                      min={0}
                      max={available}
                      value={qtys[line.productId] ?? 0}
                      onChange={(e) => setQtys({ ...qtys, [line.productId]: Number(e.target.value) })}
                    />
                    <div className="text-sm">{formatMoney(line.price)}</div>
                  </div>
                )
              })}
            </div>
            <Field label="Reason"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Button onClick={() => api.createSalesReturn({ saleId: sale.id, items: sale.items.map((l) => ({ productId: l.productId, qty: qtys[l.productId] ?? 0 })), reason })}>
              Process return
            </Button>
          </>
        ) : (
          <div className="text-sm text-slate-500">Enter an invoice number to continue.</div>
        )}
      </Card>
      {state.salesReturns.length > 0 && (
        <Card className="mt-4">
          <div className="sf-table-wrap">
            <table>
              <thead><tr><th>Return</th><th>Date</th><th>Reason</th><th>Total</th></tr></thead>
              <tbody>
                {state.salesReturns.map((r) => (
                  <tr key={r.id} className="cursor-default">
                    <td>{r.returnNo}</td>
                    <td>{r.date.slice(0, 10)}</td>
                    <td>{r.reason}</td>
                    <td>{formatMoney(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

export function PurchaseReturnsPage() {
  const state = useStore()
  const api = useApi()
  const { productName } = useLookups()
  const [params] = useSearchParams()
  const [query, setQuery] = useState(params.get('purchase') ?? '')
  const purchase = state.purchases.find((p) => p.purchaseNo.toLowerCase().includes(query.trim().toLowerCase()))
  const [qtys, setQtys] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('Defective goods')

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Purchase Returns" subtitle="Return received goods to the supplier and reduce stock." />
      <Card className="space-y-4 p-5">
        <Field label="Search purchase">
          <Select value={purchase?.id ?? ''} onChange={(e) => {
            const p = state.purchases.find((x) => x.id === e.target.value)
            setQuery(p?.purchaseNo ?? '')
            setQtys({})
          }}>
            <option value="">Select purchase</option>
            {state.purchases.map((p) => <option key={p.id} value={p.id}>{p.purchaseNo}</option>)}
          </Select>
        </Field>
        {purchase ? (
          <>
            {purchase.items.map((line) => {
              const available = line.qty - line.returnedQty
              return (
                <div key={line.productId} className="grid items-center gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-4">
                  <div>
                    <div className="font-medium">{productName(line.productId)}</div>
                    <div className="text-xs text-slate-400">Original {formatQty(line.qty)}</div>
                  </div>
                  <div className="text-sm text-slate-500">Available {formatQty(available)}</div>
                  <Input type="number" value={qtys[line.productId] ?? 0} onChange={(e) => setQtys({ ...qtys, [line.productId]: Number(e.target.value) })} />
                  <div className="text-sm">{formatMoney(line.price)}</div>
                </div>
              )
            })}
            <Field label="Reason"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Button onClick={() => api.createPurchaseReturn({ purchaseId: purchase.id, items: purchase.items.map((l) => ({ productId: l.productId, qty: qtys[l.productId] ?? 0 })), reason })}>
              Process return
            </Button>
          </>
        ) : <div className="text-sm text-slate-500">Select a purchase document.</div>}
      </Card>
    </div>
  )
}
