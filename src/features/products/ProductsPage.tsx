import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Card, FilterRow, Input, Modal, PageHeader, Select, StatusBadge } from '@/components/ui'
import { ProductMark } from '@/components/ProductMark'
import { ProductForm } from '@/features/products/ProductForm'
import { baseUnitCost, formatUnit, productHasBom } from '@/features/products/masterData'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatMoney, formatQty } from '@/utils/format'
import type { Product } from '@/types'

export function ProductsPage() {
  const state = useStore()
  const api = useApi()
  const { categoryName } = useLookups()
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [status, setStatus] = useState('all')

  const rows = useMemo(() => {
    return state.products.filter((p) => {
      if (query && !`${p.name} ${p.sku}`.toLowerCase().includes(query.toLowerCase())) return false
      if (categoryId !== 'all' && p.categoryId !== categoryId) return false
      if (status !== 'all' && p.status !== status) return false
      return true
    })
  }, [state.products, query, categoryId, status])

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Catalogue, pricing and stock status."
        actions={<Button onClick={() => api.openModal('product')}><Plus size={16} /> Add product</Button>}
      />
      <FilterRow>
        <Input placeholder="Search product or SKU" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="all">All categories</option>
          {state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <div />
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Cost</th>
                <th>Source</th>
                <th>Selling price</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} onClick={() => api.openDrawer({ type: 'product', id: p.id })}>
                  <td>
                    <div className="flex items-center gap-3">
                      <ProductMark product={p} size="sm" />
                      <span className="font-medium">{p.name}</span>
                    </div>
                  </td>
                  <td>{p.sku}</td>
                  <td>{categoryName(p.categoryId)}</td>
                  <td className="tabular">{formatMoney(p.costPrice)}</td>
                  <td>{productHasBom(state.boms, p.id) ? 'BOM' : 'Manual'}</td>
                  <td className="tabular">{formatMoney(p.sellingPrice)}</td>
                  <td className="tabular">{formatQty(api.getProductQty(p.id))} {p.unit}</td>
                  <td><StatusBadge status={api.getProductStockStatus(p.id) === 'out_of_stock' && p.status === 'active' ? api.getProductStockStatus(p.id) : p.status} /></td>
                  <td>
                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="text-xs font-medium text-indigo-600" onClick={() => api.openDrawer({ type: 'product', id: p.id })}>View</button>
                      <button type="button" className="text-xs font-medium text-slate-500" onClick={() => api.openDrawer({ type: 'product', id: p.id })}>Edit</button>
                      <button
                        type="button"
                        className="text-xs font-medium text-rose-600"
                        onClick={() => api.setProductStatus(p.id, p.status === 'active' ? 'inactive' : 'active')}
                      >
                        {p.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export function RawMaterialsPage() {
  const state = useStore()
  const api = useApi()
  const { categoryName } = useLookups()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)

  const rows = useMemo(
    () =>
      state.products.filter((product) => {
        if (productHasBom(state.boms, product.id)) return false
        if (query && !`${product.name} ${product.sku}`.toLowerCase().includes(query.toLowerCase())) return false
        return true
      }),
    [state.products, state.boms, query],
  )

  return (
    <div>
      <PageHeader
        title="Raw Materials"
        subtitle="Base unit, purchase unit, conversion and current cost."
        actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> Add raw material</Button>}
      />
      <FilterRow>
        <Input placeholder="Search material or SKU" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div /><div /><div />
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Material</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Base unit</th>
                <th>Purchase unit</th>
                <th>Conversion</th>
                <th>Purchase cost</th>
                <th>Base cost</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => (
                <tr key={product.id} onClick={() => setEditing(product)}>
                  <td>
                    <div className="flex items-center gap-3">
                      <ProductMark product={product} size="sm" />
                      <span className="font-medium">{product.name}</span>
                    </div>
                  </td>
                  <td>{product.sku}</td>
                  <td>{categoryName(product.categoryId)}</td>
                  <td>{formatUnit(product.unit)}</td>
                  <td>{formatUnit(product.purchaseUnit ?? product.unit)}</td>
                  <td className="tabular">1 {formatUnit(product.purchaseUnit ?? product.unit)} = {product.purchaseConversionQty ?? 1} {formatUnit(product.unit)}</td>
                  <td className="tabular">{formatMoney(product.purchaseCost ?? product.costPrice)}</td>
                  <td className="tabular">{formatMoney(baseUnitCost(product))} / {formatUnit(product.unit)}</td>
                  <td><StatusBadge status={product.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Add Raw Material" width="max-w-2xl">
        <ProductForm
          material
          submitLabel="Save raw material"
          onCancel={() => setCreating(false)}
          onSubmit={(input) => {
            const created = api.createProduct(input)
            if (!created) return false
            setCreating(false)
          }}
        />
      </Modal>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit Raw Material" width="max-w-2xl">
        {editing && (
          <ProductForm
            material
            product={editing}
            submitLabel="Save changes"
            onCancel={() => setEditing(null)}
            onSubmit={(input) => {
              const ok = api.updateProduct(editing.id, input)
              if (!ok) return false
              setEditing(null)
            }}
          />
        )}
      </Modal>
    </div>
  )
}

export function CategoriesPage() {
  const state = useStore()
  const api = useApi()
  const [name, setName] = useState('')
  return (
    <div>
      <PageHeader title="Categories" subtitle="Keep the catalogue organised." />
      <Card className="mb-4 p-4">
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            api.createCategory(name.trim())
            setName('')
          }}
        >
          <Input placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit">Add category</Button>
        </form>
      </Card>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Products</th>
              </tr>
            </thead>
            <tbody>
              {state.categories.map((c) => (
                <tr key={c.id} className="cursor-default">
                  <td className="font-medium">{c.name}</td>
                  <td>{state.products.filter((p) => p.categoryId === c.id).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
