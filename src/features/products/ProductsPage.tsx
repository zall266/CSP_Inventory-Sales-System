import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Card, FilterRow, Input, PageHeader, Select, StatusBadge } from '@/components/ui'
import { ProductMark } from '@/components/ProductMark'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatMoney, formatQty } from '@/utils/format'

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
