import { Trash2 } from 'lucide-react'
import { Button, Select } from '@/components/ui'
import type { AppState, Product } from '@/types'
import { lineAmount } from './documentModel'
import { formatMoney, round2 } from '@/utils/format'
import { productIsSellable } from '@/features/products/masterData'
import { configuredAgentPrice, currentLinkedAgent } from '@/features/agent/agentModel'

export type DraftLine = { productId: string; description: string; qty: number; unit: string; price: number; discount: number }

export function catalogProducts(state: AppState, extra?: Product[]) {
  const list = extra ?? state.products.filter((item) => productIsSellable(item))
  return list
}

export function emptyLine(state: AppState, extra?: Product[]): DraftLine {
  const product = catalogProducts(state, extra)[0] ?? state.products[0]
  const agentPrice = currentLinkedAgent(state) ? configuredAgentPrice(product) : null
  return {
    productId: product?.id ?? '',
    description: product?.name ?? '',
    qty: 1,
    unit: product?.unit ?? 'pcs',
    price: product ? (agentPrice !== null ? Math.max(product.sellingPrice, agentPrice) : product.sellingPrice) : 0,
    discount: 0,
  }
}

export function LineEditor({
  state,
  lines,
  onChange,
  withPrices = true,
  products,
}: {
  state: AppState
  lines: DraftLine[]
  onChange: (lines: DraftLine[]) => void
  withPrices?: boolean
  products?: Product[]
}) {
  const options = catalogProducts(state, products)
  const showDiscount = withPrices && !currentLinkedAgent(state)
  const patch = (index: number, next: Partial<DraftLine>) => {
    onChange(
      lines.map((line, i) => {
        if (i !== index) return line
        const merged = { ...line, ...next }
        if (next.productId) {
          const product = state.products.find((item) => item.id === next.productId)
          if (product) {
            merged.description = merged.description && merged.description !== line.description ? merged.description : product.name
            merged.unit = product.unit
            if (withPrices && next.price === undefined) {
              const agentPrice = currentLinkedAgent(state) ? configuredAgentPrice(product) : null
              merged.price = agentPrice !== null ? Math.max(product.sellingPrice, agentPrice) : product.sellingPrice
            }
          }
        }
        return merged
      }),
    )
  }
  return (
    <div className="space-y-3">
      <div className="sf-table-wrap rounded-xl border border-slate-100">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit</th>
              {withPrices && (
                <>
                  <th>Unit price</th>
                  {showDiscount && <th>Discount</th>}
                  <th>Amount</th>
                </>
              )}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="cursor-default">
                <td>
                  <Select value={line.productId} onChange={(e) => patch(index, { productId: e.target.value, description: '' })}>
                    {options.map((product) => (
                      <option key={product.id} value={product.id}>{product.name}</option>
                    ))}
                  </Select>
                </td>
                <td>
                  <input className="h-10 w-full rounded-xl border border-slate-200 px-2 text-sm" value={line.description} onChange={(e) => patch(index, { description: e.target.value })} />
                </td>
                <td>
                  <input type="number" min={0} step="0.01" className="h-10 w-20 rounded-xl border border-slate-200 px-2 text-sm" value={line.qty} onChange={(e) => patch(index, { qty: Number(e.target.value) })} />
                </td>
                <td>
                  <input className="h-10 w-20 rounded-xl border border-slate-200 px-2 text-sm" value={line.unit} onChange={(e) => patch(index, { unit: e.target.value })} />
                </td>
                {withPrices && (
                  <>
                    <td>
                      <input type="number" min={0} step="0.01" className="h-10 w-24 rounded-xl border border-slate-200 px-2 text-sm" value={line.price} onChange={(e) => patch(index, { price: Number(e.target.value) })} />
                    </td>
                    {showDiscount && (
                      <td>
                        <input type="number" min={0} step="0.01" className="h-10 w-20 rounded-xl border border-slate-200 px-2 text-sm" value={line.discount} onChange={(e) => patch(index, { discount: Number(e.target.value) })} />
                      </td>
                    )}
                    <td className="tabular">{formatMoney(lineAmount(line.qty, line.price, showDiscount ? line.discount : 0))}</td>
                  </>
                )}
                <td>
                  <Button size="sm" variant="ghost" onClick={() => onChange(lines.filter((_, i) => i !== index))}><Trash2 size={14} /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button variant="secondary" onClick={() => onChange([...lines, emptyLine(state, options)])}>+ Add Item</Button>
    </div>
  )
}

export function lineTotals(lines: DraftLine[], extraDiscount = 0, tax = 0, shipping = 0) {
  const subtotal = round2(lines.reduce((sum, line) => sum + lineAmount(line.qty, line.price, line.discount), 0))
  const discount = round2(extraDiscount)
  const delivery = round2(shipping)
  const total = round2(Math.max(0, subtotal - discount + tax + delivery))
  return { subtotal, discount, tax, shipping: delivery, total }
}
