import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState, Field, FilterRow, Input, PageHeader } from '@/components/ui'
import { ProductMark } from '@/components/ProductMark'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { parseAgentPriceWrite } from '@/features/agent/agentModel'
import { hasPermission } from '@/features/settings/permissions'
import { productIsSellable } from '@/features/products/masterData'
import { useApi, useStore } from '@/store/hooks'
import { formatMoney } from '@/utils/format'
import type { Product } from '@/types'

function currentAgentPriceDraft(product: Product) {
  return product.agentPrice === undefined || product.agentPrice === null ? '' : String(product.agentPrice)
}

export function AgentPricingPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const canManage = hasPermission(state, 'agent.manage')
  const [query, setQuery] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [bulkPrice, setBulkPrice] = useState('')

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

  const valueFor = (product: Product) => (Object.prototype.hasOwnProperty.call(drafts, product.id) ? drafts[product.id] : currentAgentPriceDraft(product))

  const dirtyRows = catalog.filter((product) => valueFor(product) !== currentAgentPriceDraft(product))
  const selectedIds = products.filter((product) => selected[product.id]).map((product) => product.id)
  const allVisibleSelected = products.length > 0 && products.every((product) => selected[product.id])

  const setDraft = (productId: string, value: string) => {
    setDrafts((current) => ({ ...current, [productId]: value }))
  }

  const toggleAll = (checked: boolean) => {
    setSelected((current) => {
      const next = { ...current }
      for (const product of products) next[product.id] = checked
      return next
    })
  }

  const applyBulk = () => {
    if (!selectedIds.length) {
      api.toast('Select at least one product.', undefined, 'warning')
      return
    }
    const parsed = parseAgentPriceWrite(bulkPrice)
    if (!parsed.ok) {
      api.toast('Agent Price cannot be negative.', undefined, 'warning')
      return
    }
    const nextValue = parsed.value === undefined ? '' : String(parsed.value)
    setDrafts((current) => {
      const next = { ...current }
      for (const id of selectedIds) next[id] = nextValue
      return next
    })
  }

  const save = () => {
    const rows = dirtyRows.map((product) => ({ productId: product.id, agentPrice: valueFor(product) }))
    if (!rows.length) {
      api.toast('No Agent Price changes to save.', undefined, 'info')
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
        subtitle="Set Agent Price for sellable products. CSP selling price stays the customer default."
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/sales/agents')}>Back to Agents</Button>
            <Button onClick={save} disabled={!dirtyRows.length}>Save Changes</Button>
          </>
        }
      />
      <FilterRow>
        <Input placeholder="Search product or SKU" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Field label="Set Agent Price">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={bulkPrice}
            onChange={(event) => setBulkPrice(event.target.value)}
            placeholder="RM"
          />
        </Field>
        <div className="flex items-end">
          <Button type="button" variant="secondary" onClick={applyBulk}>Apply</Button>
        </div>
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
                  <th>CSP Price</th>
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
                    <td className="tabular">{formatMoney(product.sellingPrice)}</td>
                    <td>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="h-9 w-28"
                        value={valueFor(product)}
                        onChange={(event) => setDraft(product.id, event.target.value)}
                        placeholder="Not set"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No sellable products" hint="Active sellable products will appear here for Agent Price editing." />
        )}
      </Card>
    </div>
  )
}
