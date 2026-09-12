import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Minus, Plus, Trash2, Search } from 'lucide-react'
import { Button, Card, Modal, Select, StatusBadge } from '@/components/ui'
import { ProductMark, paymentLabel } from '@/components/ProductMark'
import { agentPosItemAvailable, configuredAgentPrice, currentLinkedAgent, posSellingWarehouseId } from '@/features/agent/agentModel'
import { productIsSellable } from '@/features/products/masterData'
import { useApi, useStore } from '@/store/hooks'
import type { PaymentMethod, Product, Sale } from '@/types'
import { formatMoney, formatQty, round2 } from '@/utils/format'

type CartLine = { productId: string; qty: number; price: number }

export function PosPage() {
  const state = useStore()
  const api = useApi()
  const linkedAgent = currentLinkedAgent(state)
  const warehouseId = posSellingWarehouseId(state)
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [cart, setCart] = useState<CartLine[]>([])
  const [customerId, setCustomerId] = useState(state.settings.defaultCustomerId)
  const [discount, setDiscount] = useState(0)
  const [delivery, setDelivery] = useState(0)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [completed, setCompleted] = useState<Sale | null>(null)
  const [mobileCart, setMobileCart] = useState(false)

  const products = useMemo(() => {
    return state.products.filter((p) => {
      if (!productIsSellable(p)) return false
      if (categoryId !== 'all' && p.categoryId !== categoryId) return false
      const q = query.trim().toLowerCase()
      if (q && !`${p.name} ${p.sku} ${p.barcode}`.toLowerCase().includes(q)) return false
      if (linkedAgent && !agentPosItemAvailable(p, api.getProductQty(p.id, warehouseId))) return false
      return true
    })
  }, [state.products, categoryId, query, linkedAgent, warehouseId, api])

  const addProduct = (product: Product) => {
    const available = api.getProductQty(product.id, warehouseId)
    if (linkedAgent && available <= 0) return
    const agentPrice = configuredAgentPrice(product)
    const unitPrice = linkedAgent && agentPrice !== null ? Math.max(product.sellingPrice, agentPrice) : product.sellingPrice
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id)
      if (existing) {
        const nextQty = existing.qty + 1
        if (linkedAgent && nextQty > available) return current
        return current.map((line) => (line.productId === product.id ? { ...line, qty: nextQty } : line))
      }
      return [...current, { productId: product.id, qty: 1, price: unitPrice }]
    })
  }

  const setQty = (productId: string, qty: number) => {
    const available = api.getProductQty(productId, warehouseId)
    setCart((current) =>
      current
        .map((line) => {
          if (line.productId !== productId) return line
          const next = linkedAgent ? Math.min(qty, available) : qty
          return { ...line, qty: next }
        })
        .filter((line) => line.qty > 0),
    )
  }

  const setPrice = (productId: string, price: number) => {
    setCart((current) => current.map((line) => (line.productId === productId ? { ...line, price } : line)))
  }

  const subtotal = round2(cart.reduce((sum, line) => sum + line.qty * line.price, 0))
  const tax = 0
  const deliveryCharge = linkedAgent ? round2(Math.max(0, delivery)) : 0
  const total = round2(Math.max(0, subtotal - discount + tax + deliveryCharge))
  const count = cart.reduce((sum, line) => sum + line.qty, 0)

  const complete = () => {
    const sale = linkedAgent
      ? api.createAgentSale({
          agentId: linkedAgent.id,
          items: cart.map((line) => ({ productId: line.productId, qty: line.qty, sellingPrice: line.price })),
          delivery: deliveryCharge,
          customerId,
          paymentMethod: method,
        })
      : api.createSale({
          customerId,
          warehouseId,
          items: cart.map((line) => ({ productId: line.productId, qty: line.qty, price: line.price })),
          discount,
          tax,
          paymentMethod: method,
          paidAmount: total,
        })
    if (sale) {
      setCompleted(sale)
      setCart([])
      setDiscount(0)
      setDelivery(0)
    }
  }

  const cartPanel = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">Current sale</div>
          <div className="text-xs text-slate-400">
            {count} items{linkedAgent ? ` · ${linkedAgent.name}` : ''}
          </div>
        </div>
        <Select className="w-44" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          {state.customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </div>
      <div className="mt-4 flex-1 space-y-2 overflow-y-auto">
        {cart.length === 0 && <div className="rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">Tap a product to add it to the cart.</div>}
        {cart.map((line) => {
          const product = state.products.find((p) => p.id === line.productId)
          if (!product) return null
          return (
            <div key={line.productId} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
              <ProductMark product={product} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{product.name}</div>
                {linkedAgent ? (
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="mt-1 h-8 w-24 rounded-lg border border-slate-200 px-2 text-xs"
                    value={line.price}
                    onChange={(e) => setPrice(line.productId, Number(e.target.value))}
                  />
                ) : (
                  <div className="text-xs text-slate-400">{formatQty(line.qty)} × {formatMoney(line.price)}</div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button type="button" className="rounded-lg p-1 hover:bg-slate-100" onClick={() => setQty(line.productId, line.qty - 1)}><Minus size={14} /></button>
                <span className="w-6 text-center text-sm tabular">{line.qty}</span>
                <button type="button" className="rounded-lg p-1 hover:bg-slate-100" onClick={() => setQty(line.productId, line.qty + 1)}><Plus size={14} /></button>
              </div>
              <div className="w-16 text-right text-sm font-medium tabular">{formatMoney(line.qty * line.price)}</div>
              <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => setQty(line.productId, 0)}><Trash2 size={14} /></button>
            </div>
          )
        })}
      </div>
      <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
        <div className="flex justify-between text-slate-500"><span>Subtotal</span><span className="tabular">{formatMoney(subtotal)}</span></div>
        {!linkedAgent && (
          <label className="flex items-center justify-between gap-3 text-slate-500">
            Discount
            <input
              type="number"
              className="h-9 w-28 rounded-lg border border-slate-200 px-2 text-right text-sm"
              value={discount}
              disabled={!state.settings.allowDiscount}
              onChange={(e) => setDiscount(Number(e.target.value))}
            />
          </label>
        )}
        {linkedAgent && (
          <label className="flex items-center justify-between gap-3 text-slate-500">
            Delivery
            <input
              type="number"
              min={0}
              step="0.01"
              className="h-9 w-28 rounded-lg border border-slate-200 px-2 text-right text-sm"
              value={delivery}
              onChange={(e) => setDelivery(Number(e.target.value))}
            />
          </label>
        )}
        <div className="flex justify-between text-slate-500"><span>Tax</span><span>RM 0.00</span></div>
        <div className="flex justify-between text-lg font-semibold"><span>Total</span><span className="tabular">{formatMoney(total)}</span></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {(['cash', 'bank_transfer', 'duitnow', 'card'] as PaymentMethod[]).filter((m) => state.settings.enabledPaymentMethods.includes(m)).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={`rounded-xl border px-3 py-2 text-sm font-medium ${method === m ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'}`}
          >
            {paymentLabel(m)}
          </button>
        ))}
      </div>
      <Button className="mt-4 w-full" size="lg" disabled={!cart.length} onClick={complete}>
        Complete sale
      </Button>
    </div>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div>
        <div className="relative mb-4">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, SKU or barcode"
            className="h-11 w-full rounded-2xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
          />
        </div>
        <div className="mb-4 flex gap-2 overflow-x-auto">
          <CatChip active={categoryId === 'all'} onClick={() => setCategoryId('all')} label="All" />
          {state.categories.map((c) => (
            <CatChip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)} label={c.name} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => {
            const qty = api.getProductQty(p.id, warehouseId)
            const status = api.getProductStockStatus(p.id, warehouseId)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => addProduct(p)}
                className="sf-card p-3 text-left transition hover:-translate-y-0.5 hover:border-indigo-200"
              >
                <ProductMark product={p} />
                <div className="mt-3 truncate text-sm font-semibold text-slate-900">{p.name}</div>
                <div className="text-xs text-slate-400">{p.sku}</div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-indigo-700">
                    {formatMoney(
                      linkedAgent
                        ? Math.max(p.sellingPrice, configuredAgentPrice(p) ?? p.sellingPrice)
                        : p.sellingPrice,
                    )}
                  </div>
                  <StatusBadge status={status} />
                </div>
                <div className="mt-1 text-[11px] text-slate-400">{formatQty(qty)} {p.unit} on hand</div>
              </button>
            )
          })}
        </div>
      </div>
      <Card className="hidden p-5 lg:block">{cartPanel}</Card>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white p-3 lg:hidden">
        <Button className="w-full" onClick={() => setMobileCart(true)}>
          Cart · {count} · {formatMoney(total)}
        </Button>
      </div>
      <Modal open={mobileCart} onClose={() => setMobileCart(false)} title="Cart" width="max-w-lg">
        <div className="h-[70vh]">{cartPanel}</div>
      </Modal>
      <Modal open={Boolean(completed)} onClose={() => setCompleted(null)} title="Sale completed">
        {completed && (
          <div className="space-y-4 text-center">
            <div className="text-sm text-slate-500">Invoice</div>
            <div className="text-2xl font-semibold">{completed.invoiceNo}</div>
            <div className="text-sm text-slate-500">Total</div>
            <div className="text-xl font-semibold tabular">{formatMoney(completed.total)}</div>
            <div className="text-sm text-slate-500">Payment</div>
            <div className="font-medium">{paymentLabel(completed.paymentMethod)}</div>
            <div className="flex justify-center gap-2 pt-2">
              <Link to={`/print/invoice/${completed.id}`}><Button variant="secondary">Preview / PDF</Button></Link>
              <Button variant="secondary" onClick={() => window.print()}>Print receipt</Button>
              <Button onClick={() => setCompleted(null)}>New sale</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function CatChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${active ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
    >
      {label}
    </button>
  )
}
