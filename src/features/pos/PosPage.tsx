import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Minus, Plus, Trash2, Search } from 'lucide-react'
import { Button, Card, Modal, Select, StatusBadge } from '@/components/ui'
import { ProductMark, paymentLabel } from '@/components/ProductMark'
import { ProductImageThumb } from '@/features/products/ProductImageThumb'
import { agentPosItemAvailable, belowAgentPriceMessage, configuredAgentPrice, currentLinkedAgent, defaultAgentSellingPrice, posSellingWarehouseId } from '@/features/agent/agentModel'
import { productIsSellable } from '@/features/products/masterData'
import { useApi, useStore } from '@/store/hooks'
import type { PaymentMethod, Product, Sale } from '@/types'
import { formatMoney, formatQty, round2 } from '@/utils/format'
import {
  addProductToCart,
  beginPosSubmit,
  cartCount,
  cartSubtotal,
  endPosSubmit,
  productMatchesQuery,
  setCartQty,
  type CartLine,
} from './posCart'
import { parsePosImageAbVariant, posImageAbPreviewUrl } from './posImageAb'

export function PosPage() {
  const state = useStore()
  const api = useApi()
  const [searchParams] = useSearchParams()
  const posImageAb = parsePosImageAbVariant(searchParams.get('posImage'))
  const posImagePresentation = posImageAb === 'a' ? 'square-contain' : posImageAb === 'b' ? 'square-cover' : undefined
  const linkedAgent = currentLinkedAgent(state)
  const warehouseId = posSellingWarehouseId(state)
  const submittingRef = useRef(false)
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [cart, setCart] = useState<CartLine[]>([])
  const [customerId, setCustomerId] = useState(state.settings.defaultCustomerId)
  const [discount, setDiscount] = useState(0)
  const [delivery, setDelivery] = useState(0)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [completed, setCompleted] = useState<Sale | null>(null)
  const [mobileCart, setMobileCart] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const products = useMemo(() => {
    return state.products.filter((p) => {
      if (!productIsSellable(p)) return false
      if (categoryId !== 'all' && p.categoryId !== categoryId) return false
      if (!productMatchesQuery(p, query)) return false
      if (linkedAgent && !agentPosItemAvailable(p, api.getProductQty(p.id, warehouseId))) return false
      return true
    })
  }, [state.products, categoryId, query, linkedAgent, warehouseId, api])

  const addProduct = (product: Product) => {
    const available = api.getProductQty(product.id, warehouseId)
    const unitPrice = linkedAgent ? defaultAgentSellingPrice(product) : product.sellingPrice
    setCart((current) =>
      addProductToCart(current, product.id, unitPrice, { capToAvailable: Boolean(linkedAgent), available }),
    )
  }

  const setQty = (productId: string, qty: number) => {
    const available = api.getProductQty(productId, warehouseId)
    setCart((current) => setCartQty(current, productId, qty, { capToAvailable: Boolean(linkedAgent), available }))
  }

  const setPrice = (productId: string, price: number) => {
    setCart((current) => current.map((line) => (line.productId === productId ? { ...line, price } : line)))
  }

  const subtotal = round2(cartSubtotal(cart))
  const tax = 0
  const deliveryCharge = linkedAgent ? round2(Math.max(0, delivery)) : 0
  const total = round2(Math.max(0, subtotal - discount + tax + deliveryCharge))
  const count = cartCount(cart)
  const agentPriceViolation = Boolean(
    linkedAgent &&
      cart.some((line) => {
        const product = state.products.find((item) => item.id === line.productId)
        const min = configuredAgentPrice(product)
        return min !== null && round2(line.price) < min
      }),
  )

  const complete = () => {
    if (!beginPosSubmit(submittingRef)) return
    setSubmitting(true)
    try {
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
        setMobileCart(false)
      }
    } finally {
      endPosSubmit(submittingRef)
      setSubmitting(false)
    }
  }

  const cartPanel = (
    <div className="flex h-full min-h-0 min-w-0 max-w-full flex-col" data-pos-cart-panel>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">Current sale</div>
          <div className="text-xs text-slate-500" data-pos-cart-count>
            {count} {count === 1 ? 'item' : 'items'}
            {linkedAgent ? ` · ${linkedAgent.name}` : ''}
          </div>
        </div>
        <Select className="w-full sm:w-44" value={customerId} onChange={(e) => setCustomerId(e.target.value)} data-pos-customer>
          {state.customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </div>
      <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
        {cart.length === 0 && <div className="rounded-2xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">Tap a product to add it to the cart.</div>}
        {cart.map((line) => {
          const product = state.products.find((p) => p.id === line.productId)
          if (!product) return null
          const agentMin = linkedAgent ? configuredAgentPrice(product) : null
          const belowMin = agentMin !== null && round2(line.price) < agentMin
          return (
            <div key={line.productId} className="rounded-2xl border border-slate-200 p-3" data-pos-cart-line={line.productId}>
              <div className="flex items-start gap-3">
                <ProductMark product={product} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">{product.name}</div>
                  {linkedAgent ? (
                    <>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="mt-1.5 h-10 w-28 rounded-xl border border-slate-200 px-2 text-sm"
                        value={line.price}
                        onChange={(e) => setPrice(line.productId, Number(e.target.value))}
                      />
                      {belowMin && agentMin !== null && (
                        <div className="mt-1 text-[11px] text-amber-700">{belowAgentPriceMessage(agentMin)}</div>
                      )}
                    </>
                  ) : (
                    <div className="mt-0.5 text-xs text-slate-400">{formatQty(line.qty)} × {formatMoney(line.price)}</div>
                  )}
                </div>
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  aria-label={`Remove ${product.name}`}
                  onClick={() => setQty(line.productId, 0)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <QtyControl
                  qty={line.qty}
                  onDecrease={() => setQty(line.productId, line.qty - 1)}
                  onIncrease={() => setQty(line.productId, line.qty + 1)}
                  testId={line.productId}
                />
                <div className="text-base font-semibold tabular text-slate-900">{formatMoney(line.qty * line.price)}</div>
              </div>
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
              className="h-10 w-28 rounded-xl border border-slate-200 px-2 text-right text-sm"
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
              className="h-10 w-28 rounded-xl border border-slate-200 px-2 text-right text-sm"
              value={delivery}
              onChange={(e) => setDelivery(Number(e.target.value))}
            />
          </label>
        )}
        <div className="flex justify-between text-slate-500"><span>Tax</span><span>RM 0.00</span></div>
        <div className="flex justify-between text-lg font-semibold"><span>Total</span><span className="tabular" data-pos-cart-total>{formatMoney(total)}</span></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {(['cash', 'bank_transfer', 'duitnow', 'card'] as PaymentMethod[]).filter((m) => state.settings.enabledPaymentMethods.includes(m)).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={`min-h-11 rounded-xl border px-3 py-2.5 text-sm font-medium ${method === m ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'}`}
          >
            {paymentLabel(m)}
          </button>
        ))}
      </div>
      <Button
        className="mt-4 h-12 w-full text-base"
        size="lg"
        disabled={!cart.length || agentPriceViolation || submitting}
        onClick={complete}
        data-pos-complete
      >
        {submitting ? 'Completing…' : cart.length ? `Complete sale · ${formatMoney(total)}` : 'Complete sale'}
      </Button>
    </div>
  )

  return (
    <div
      className="grid min-w-0 max-w-full grid-cols-1 gap-4 overflow-x-clip lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_26rem]"
      data-pos-page
    >
      <div className="min-w-0 max-w-full pb-[calc(8.75rem+env(safe-area-inset-bottom))] lg:pb-0">
        <div className="relative mb-4 min-w-0">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, SKU or barcode"
            data-pos-search
            className="h-12 w-full min-w-0 rounded-2xl border border-slate-200 bg-white pl-10 pr-3 text-base outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 md:text-sm"
          />
        </div>
        <div className="mb-4 flex max-w-full gap-2 overflow-x-auto pb-1">
          <CatChip active={categoryId === 'all'} onClick={() => setCategoryId('all')} label="All" />
          {state.categories.map((c) => (
            <CatChip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)} label={c.name} />
          ))}
        </div>
        <div
          className="grid min-w-0 grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4"
          data-pos-image-ab={posImageAb || 'default'}
        >
          {products.map((p) => {
            const qty = api.getProductQty(p.id, warehouseId)
            const status = api.getProductStockStatus(p.id, warehouseId)
            const line = cart.find((item) => item.productId === p.id)
            return (
              <article
                key={p.id}
                className="sf-card flex min-w-0 flex-col overflow-hidden p-2.5 text-left sm:p-3"
                data-pos-product={p.id}
              >
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => addProduct(p)}>
                  <ProductImageThumb
                    product={p}
                    size="xl"
                    presentation={posImagePresentation}
                    previewDataUrl={posImageAb && import.meta.env.DEV ? posImageAbPreviewUrl(p.id) : undefined}
                  />
                  <div className="mt-3 truncate text-[15px] font-semibold leading-snug text-slate-900">{p.name}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-400">{p.sku}</div>
                  <div className="mt-2.5 flex min-w-0 flex-col gap-1">
                    <div className="truncate text-base font-semibold tabular text-indigo-700">
                      {formatMoney(linkedAgent ? defaultAgentSellingPrice(p) : p.sellingPrice)}
                    </div>
                    <StatusBadge status={status} />
                  </div>
                  <div className="mt-1 truncate text-[11px] text-slate-400">{formatQty(qty)} {p.unit} on hand</div>
                </button>
                <div className="mt-3 min-w-0">
                  {line ? (
                    <QtyControl
                      qty={line.qty}
                      onDecrease={() => setQty(p.id, line.qty - 1)}
                      onIncrease={() => setQty(p.id, line.qty + 1)}
                      testId={`card-${p.id}`}
                      compact
                    />
                  ) : (
                    <button
                      type="button"
                      className="flex h-10 w-full min-w-0 items-center justify-center rounded-xl bg-indigo-50 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-100 hover:bg-indigo-100"
                      onClick={() => addProduct(p)}
                    >
                      Add
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </div>
      <Card className="hidden min-w-0 p-5 lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100vh-5.5rem)] lg:flex-col lg:overflow-hidden">{cartPanel}</Card>
      <div
        className="fixed inset-x-0 bottom-0 z-20 max-w-full overflow-hidden border-t border-slate-200 bg-white/95 px-3 pt-2.5 backdrop-blur lg:hidden"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        data-pos-mobile-summary
      >
        <div className="mx-auto flex min-w-0 max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {count} {count === 1 ? 'item' : 'items'}
            </div>
            <div className="truncate text-lg font-semibold tabular text-slate-900">{formatMoney(total)}</div>
          </div>
          <Button variant="secondary" size="lg" className="h-11 shrink-0 px-4 sm:px-5" onClick={() => setMobileCart(true)} data-pos-view-cart>
            View cart
          </Button>
        </div>
      </div>
      <Modal open={mobileCart} onClose={() => setMobileCart(false)} title="Cart" width="max-w-full sm:max-w-lg">
        <div className="flex h-[min(78dvh,36rem)] min-w-0 max-w-full flex-col">{cartPanel}</div>
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

function QtyControl({
  qty,
  onDecrease,
  onIncrease,
  testId,
  compact = false,
}: {
  qty: number
  onDecrease: () => void
  onIncrease: () => void
  testId?: string
  compact?: boolean
}) {
  const btn = compact
    ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-white'
    : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-white'
  return (
    <div
      className={compact ? 'flex w-full min-w-0 items-center justify-between rounded-xl bg-slate-100 p-0.5' : 'inline-flex items-center rounded-xl bg-slate-100 p-0.5'}
      data-pos-qty-control={testId}
    >
      <button type="button" className={btn} aria-label="Decrease quantity" onClick={onDecrease}>
        <Minus size={16} />
      </button>
      <span className={compact ? 'min-w-0 flex-1 px-1 text-center text-sm font-semibold tabular' : 'min-w-[1.75rem] px-1 text-center text-sm font-semibold tabular'} data-pos-qty>{qty}</span>
      <button type="button" className={btn} aria-label="Increase quantity" onClick={onIncrease}>
        <Plus size={16} />
      </button>
    </div>
  )
}

function CatChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 whitespace-nowrap rounded-full px-4 py-2 text-sm ${active ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
    >
      {label}
    </button>
  )
}
