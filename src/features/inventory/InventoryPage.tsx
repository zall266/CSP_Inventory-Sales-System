import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, FilterRow, Input, KpiCard, PageHeader, Select, StatusBadge } from '@/components/ui'
import { ProductMark } from '@/components/ProductMark'
import { finishedGoodsBreakdown, isFinishedPack } from '@/features/warehouse/warehouseModel'
import { companyWarehouses, isCompanyWarehouseId } from '@/features/agent/agentModel'
import { inventoryValue, useApi, useLookups, useStore } from '@/store/hooks'
import { formatMoney, formatQty } from '@/utils/format'

export function InventoryPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { categoryName, warehouseName, product } = useLookups()
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [status, setStatus] = useState('all')
  const [displayQuery, setDisplayQuery] = useState('')
  const warehouse = state.ui.warehouseFilter

  const rows = useMemo(() => {
    return state.inventory
      .filter((row) =>
        warehouse === 'all'
          ? isCompanyWarehouseId(state.warehouses, row.warehouseId)
          : row.warehouseId === warehouse,
      )
      .map((row) => {
        const p = product(row.productId)
        return p ? { ...row, product: p, status: api.getProductStockStatus(p.id, row.warehouseId) } : null
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => {
        if (query && !`${row.product.name} ${row.product.sku}`.toLowerCase().includes(query.toLowerCase())) return false
        if (categoryId !== 'all' && row.product.categoryId !== categoryId) return false
        if (status !== 'all' && row.status !== status) return false
        return true
      })
  }, [state.inventory, warehouse, query, categoryId, status, product, api])

  const uniqueProducts = new Set(rows.map((r) => r.productId))
  const inStock = rows.filter((r) => r.status === 'in_stock').length
  const low = rows.filter((r) => r.status === 'low_stock').length
  const out = rows.filter((r) => r.status === 'out_of_stock').length

  const displayRows = useMemo(() => {
    const warehouses = warehouse === 'all' ? companyWarehouses(state.warehouses).map((row) => row.id) : [warehouse]
    return state.products
      .filter(isFinishedPack)
      .flatMap((p) =>
        warehouses.map((warehouseId) => {
          const breakdown = finishedGoodsBreakdown(state, p.id, warehouseId)
          if (breakdown.inventory <= 0 && breakdown.display <= 0 && breakdown.carton <= 0 && breakdown.ready <= 0) return null
          if (displayQuery && !`${p.name} ${p.sku}`.toLowerCase().includes(displayQuery.toLowerCase())) return null
          return { product: p, warehouseId, ...breakdown }
        }),
      )
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
  }, [state, warehouse, displayQuery])

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Manage your products and stock in one place."
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/inventory/warehouse-map')}>Warehouse map</Button>
            <Button variant="secondary" onClick={() => navigate('/stock-adjustment')}>Adjust stock</Button>
            <Button variant="secondary" onClick={() => navigate('/stock-transfer')}>Transfer stock</Button>
            <Button onClick={() => navigate('/stock-count')}>Stock count</Button>
          </>
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Total items" value={String(uniqueProducts.size)} />
        <KpiCard label="In stock" value={String(inStock)} tone="success" />
        <KpiCard label="Low stock" value={String(low)} tone="warning" />
        <KpiCard label="Out of stock" value={String(out)} tone="danger" />
        <KpiCard label="Inventory value" value={formatMoney(inventoryValue(state, warehouse), { compact: true })} />
      </div>
      <FilterRow>
        <Input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select value={warehouse} onChange={(e) => api.setWarehouseFilter(e.target.value)}>
          <option value="all">All warehouses</option>
          {companyWarehouses(state.warehouses).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="all">All categories</option>
          {state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All stock status</option>
          <option value="in_stock">In stock</option>
          <option value="low_stock">Low stock</option>
          <option value="out_of_stock">Out of stock</option>
        </Select>
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Warehouse</th>
                <th>Stock</th>
                <th>Unit</th>
                <th>Cost</th>
                <th>Inventory value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.productId}-${row.warehouseId}`} onClick={() => api.openDrawer({ type: 'product', id: row.productId })}>
                  <td>
                    <div className="flex items-center gap-3">
                      <ProductMark product={row.product} size="sm" />
                      <span className="font-medium">{row.product.name}</span>
                    </div>
                  </td>
                  <td>{row.product.sku}</td>
                  <td>{categoryName(row.product.categoryId)}</td>
                  <td>{warehouseName(row.warehouseId)}</td>
                  <td className="tabular">{formatQty(row.qty)}</td>
                  <td>{row.product.unit}</td>
                  <td className="tabular">{formatMoney(row.product.costPrice, { compact: true })}</td>
                  <td className="tabular">{formatMoney(row.qty * row.product.costPrice)}</td>
                  <td><StatusBadge status={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="mt-6">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Display stock</h2>
            <p className="text-sm text-slate-500">Loose finished goods. Inventory remains the total. CTN Rack and Pallet are carton locations only.</p>
          </div>
          <Input className="sm:max-w-xs" placeholder="Search product" value={displayQuery} onChange={(e) => setDisplayQuery(e.target.value)} />
        </div>
        <Card>
          <div className="sf-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Warehouse</th>
                  <th>Display</th>
                  <th>CTN Rack</th>
                  <th>Pallet</th>
                  <th>Ready to place</th>
                  <th>Inventory</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-sm text-slate-500">No finished-goods display or carton quantities.</td>
                  </tr>
                )}
                {displayRows.map((row) => (
                  <tr key={`${row.product.id}-${row.warehouseId}`}>
                    <td>
                      <div className="flex items-center gap-3">
                        <ProductMark product={row.product} size="sm" />
                        <span className="font-medium">{row.product.name}</span>
                      </div>
                    </td>
                    <td>{warehouseName(row.warehouseId)}</td>
                    <td className="tabular">{formatQty(row.display)} PACK</td>
                    <td className="tabular">{formatQty(row.rack)} PACK</td>
                    <td className="tabular">{formatQty(row.pallet)} PACK</td>
                    <td className="tabular">{formatQty(row.ready)} PACK</td>
                    <td className="tabular font-medium">{formatQty(row.inventory)} PACK</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
