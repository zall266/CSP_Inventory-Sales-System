import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState, Field, FilterRow, Input, PageHeader } from '@/components/ui'
import { ProductMark } from '@/components/ProductMark'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { agentPriceAboveSellingMessage, agentPriceExceedsSellingPrice, parseAgentPriceWrite } from '@/features/agent/agentModel'
import { parseNonNegativeMoney, productIsSellable } from '@/features/products/masterData'
import { hasPermission } from '@/features/settings/permissions'
import { useApi, useStore } from '@/store/hooks'
import type { Product } from '@/types'

type PriceDraft = { sellingPrice?: string; agentPrice?: string }

function currentAgentPriceDraft(product: Product) {
  return product.agentPrice === undefined || product.agentPrice === null ? '' : String(product.agentPrice)
}

function currentSellingPriceDraft(product: Product) {
  return String(product.sellingPrice)
}

export function AgentPricingPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const canManage = hasPermission(state, 'agent.manage')
  const [query, setQuery] = useState('')
  const [drafts, setDrafts] = useState<Record<string, PriceDraft>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [bulkAgentPrice, setBulkAgentPrice] = useState('')
  const [bulkSellingPrice, setBulkSellingPrice] = useState('')

  const catalog = useMemo(
    () =>
      state.products
        .filter((product) => productIsSellable(product) && product.status === 'active')
        .sort((a, b) => a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku)),
    [state.products],
  )
  const products = useMemo(() => {
    const q = query.trim().toLowerCase()
    return catalog.filter((product) => !q || `${product.name} ${product.sku}`.toLowerCase().includes(q))
  }, [catalog, query])

  if (!canManage) return <PermissionDenied subtitle="You do not have access to Agent Pricing." />

  const sellingValueFor = (product: Product) =>
    Object.prototype.hasOwnProperty.call(drafts[product.id] ?? {}, 'sellingPrice')
      ? drafts[product.id].sellingPrice ?? ''
      : currentSellingPriceDraft(product)

  const agentValueFor = (product: Product) =>
    Object.prototype.hasOwnProperty.call(drafts[product.id] ?? {}, 'agentPrice')
      ? drafts[product.id].agentPrice ?? ''
      : currentAgentPriceDraft(product)

  const dirtyRows = catalog.filter(
    (product) =>
      sellingValueFor(product) !== currentSellingPriceDraft(product) ||
      agentValueFor(product) !== currentAgentPriceDraft(product),
  )
  const selectedIds = products.filter((product) => selected[product.id]).map((product) => product.id)
  const allVisibleSelected = products.length > 0 && products.every((product) => selected[product.id])

  const patchDraft = (productId: string, patch: PriceDraft) => {
    setDrafts((current) => ({ ...current, [productId]: { ...current[productId], ...patch } }))
  }

  const toggleAll = (checked: boolean) => {
    setSelected((current) => {
      const next = { ...current }
      for (const product of products) next[product.id] = checked
      return next
    })
  }

  const applyBulk = (kind: 'sellingPrice' | 'agentPrice', raw: string) => {
    if (!selectedIds.length) {
      api.toast('Select at least one product.', undefined, 'warning')
      return
    }
    if (kind === 'agentPrice') {
      const parsed = parseAgentPriceWrite(raw)
      if (!parsed.ok) {
        api.toast('Agent Price cannot be negative.', undefined, 'warning')
        return
      }
      const nextValue = parsed.value === undefined ? '' : String(parsed.value)
      setDrafts((current) => {
        const next = { ...current }
        for (const id of selectedIds) next[id] = { ...next[id], agentPrice: nextValue }
        return next
      })
      return
    }
    const parsed = parseNonNegativeMoney(raw)
    if (!parsed.ok) {
      api.toast('Selling Price cannot be negative.', undefined, 'warning')
      return
    }
    const nextValue = String(parsed.value)
    setDrafts((current) => {
      const next = { ...current }
      for (const id of selectedIds) next[id] = { ...next[id], sellingPrice: nextValue }
      return next
    })
  }

  const save = () => {
    const rows = dirtyRows.map((product) => {
      const row: { productId: string; sellingPrice?: string; agentPrice?: string } = { productId: product.id }
      if (sellingValueFor(product) !== currentSellingPriceDraft(product)) row.sellingPrice = sellingValueFor(product)
      if (agentValueFor(product) !== currentAgentPriceDraft(product)) row.agentPrice = agentValueFor(product)
      return row
    })
    if (!rows.length) {
      api.toast('No price changes to save.', undefined, 'info')
      return
    }
    if (api.saveAgentPrices(rows)) {
      setDrafts({})
      setSelected({})
    }
  }

  return (
    <div>
      <PageHeader
        title="Agent Pricing"
        subtitle="Set Selling Price and Agent Price for sellable products from one list."
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/sales/agents')}>Back to Agents</Button>
            <Button onClick={save} disabled={!dirtyRows.length}>Save Changes</Button>
          </>
        }
      />
      <FilterRow>
        <Input placeholder="Search product or SKU" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Field label="Set Selling Price">
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={bulkSellingPrice}
              onChange={(event) => setBulkSellingPrice(event.target.value)}
              placeholder="RM"
            />
            <Button type="button" variant="secondary" onClick={() => applyBulk('sellingPrice', bulkSellingPrice)}>Apply</Button>
          </div>
        </Field>
        <Field label="Set Agent Price">
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={bulkAgentPrice}
              onChange={(event) => setBulkAgentPrice(event.target.value)}
              placeholder="RM"
            />
            <Button type="button" variant="secondary" onClick={() => applyBulk('agentPrice', bulkAgentPrice)}>Apply</Button>
          </div>
        </Field>
        <div />
      </FilterRow>
      <Card>
        {products.length ? (
          <div className="sf-table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(event) => toggleAll(event.target.checked)}
                      aria-label="Select all products"
                    />
                  </th>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Selling Price</th>
                  <th>Agent Price</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} className="cursor-default">
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(selected[product.id])}
                        onChange={(event) => setSelected((current) => ({ ...current, [product.id]: event.target.checked }))}
                        aria-label={`Select ${product.name}`}
                      />
                    </td>
                    <td>
                      <div className="flex items-center gap-3">
                        <ProductMark product={product} size="sm" />
                        <span className="font-medium">{product.name}</span>
                      </div>
                    </td>
                    <td>{product.sku}</td>
                    <td>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="h-9 w-28"
                        value={sellingValueFor(product)}
                        onChange={(event) => patchDraft(product.id, { sellingPrice: event.target.value })}
                      />
                    </td>
                    <td>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="h-9 w-28"
                        value={agentValueFor(product)}
                        onChange={(event) => patchDraft(product.id, { agentPrice: event.target.value })}
                        placeholder="Not set"
                      />
                      {agentPriceExceedsSellingPrice(
                        agentValueFor(product) === '' ? undefined : Number(agentValueFor(product)),
                        Number(sellingValueFor(product)),
                      ) && (
                        <div className="mt-1 text-[11px] text-amber-700">{agentPriceAboveSellingMessage()}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No sellable products" hint="Active sellable products will appear here for Selling Price and Agent Price editing." />
        )}
      </Card>
    </div>
  )
}
