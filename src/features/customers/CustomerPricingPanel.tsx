import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  StatusBadge,
  Toggle,
} from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { emptyLine, LineEditor, lineTotals, type DraftLine } from '@/features/documents/LineEditor'
import {
  customPriceLabel,
  defaultWholesalePrice,
  resolveWholesaleUnitPrice,
  sellableProductsForCustomerPricing,
} from '@/features/customers/customerPricingModel'
import { companyWarehouses, currentLinkedAgent } from '@/features/agent/agentModel'
import { hasPermission } from '@/features/settings/permissions'
import { useApi, useStore } from '@/store/hooks'
import { formatMoney } from '@/utils/format'
import type { Customer, CustomerWholesalePrice, Product } from '@/types'

export function CustomerPricingPanel({ customer }: { customer: Customer }) {
  const state = useStore()
  const api = useApi()
  const canView = hasPermission(state, 'customer.pricing.view') || hasPermission(state, 'customer.pricing.manage')
  const canManage = hasPermission(state, 'customer.pricing.manage')
  const canInvoice = !currentLinkedAgent(state) && (hasPermission(state, 'sales.create') || hasPermission(state, 'sales.invoice.create'))
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [editing, setEditing] = useState<CustomerWholesalePrice | 'new' | null>(null)
  const [removeId, setRemoveId] = useState('')
  const [invoiceOpen, setInvoiceOpen] = useState(false)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (state.customerWholesalePrices ?? [])
      .filter((row) => row.customerId === customer.id)
      .filter((row) => status === 'all' || (status === 'active' ? row.active : !row.active))
      .map((row) => ({ row, product: state.products.find((item) => item.id === row.productId) }))
      .filter((item) => {
        if (!q) return true
        const product = item.product
        return `${product?.name ?? ''} ${product?.sku ?? ''}`.toLowerCase().includes(q)
      })
      .sort((a, b) => (a.product?.name ?? '').localeCompare(b.product?.name ?? '') || (a.product?.sku ?? '').localeCompare(b.product?.sku ?? ''))
  }, [state.customerWholesalePrices, state.products, customer.id, query, status])

  if (!canView) return <PermissionDenied subtitle="You do not have access to Custom Pricing." />

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-800">Custom Wholesale Pricing</div>
          <div className="text-xs text-slate-500">Overrides the default Wholesale Price for this customer only.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canInvoice && <Button variant="secondary" onClick={() => setInvoiceOpen(true)}>Create Wholesale Invoice</Button>}
          {canManage && <Button onClick={() => setEditing('new')}>+ Add Custom Price</Button>}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input placeholder="Search product or SKU" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Select value={status} onChange={(event) => setStatus(event.target.value as 'all' | 'active' | 'inactive')}>
          <option value="all">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      </div>
      {rows.length ? (
        <>
          <div className="hidden sm:block">
            <div className="sf-table-wrap rounded-xl border border-slate-100">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Default Wholesale</th>
                    <th>Custom Price</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ row, product }) => (
                    <tr key={row.id} className="cursor-default">
                      <td className="font-medium">{product?.name ?? row.productId}</td>
                      <td>{product?.sku ?? '—'}</td>
                      <td className="tabular">{customPriceLabel(defaultWholesalePrice(product))}</td>
                      <td className="tabular">{row.active ? formatMoney(row.price) : '—'}</td>
                      <td><StatusBadge status={row.active ? 'active' : 'inactive'} /></td>
                      <td>
                        {canManage && (
                          <div className="flex flex-wrap gap-2">
                            <button type="button" className="text-xs font-medium text-indigo-600" onClick={() => setEditing(row)}>
                              {row.active ? 'Edit' : 'Set Price'}
                            </button>
                            {row.active && (
                              <button type="button" className="text-xs font-medium text-rose-600" onClick={() => setRemoveId(row.id)}>
                                Remove Custom Price
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="space-y-3 sm:hidden">
            {rows.map(({ row, product }) => (
              <div key={row.id} className="rounded-xl border border-slate-100 p-3">
                <div className="font-medium text-slate-800">{product?.name ?? row.productId}</div>
                <div className="text-xs text-slate-500">{product?.sku ?? '—'}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div>Default: {customPriceLabel(defaultWholesalePrice(product))}</div>
                  <div>Custom: {row.active ? formatMoney(row.price) : '—'}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <StatusBadge status={row.active ? 'active' : 'inactive'} />
                  {canManage && (
                    <div className="flex gap-2">
                      <button type="button" className="text-xs font-medium text-indigo-600" onClick={() => setEditing(row)}>
                        {row.active ? 'Edit' : 'Set Price'}
                      </button>
                      {row.active && (
                        <button type="button" className="text-xs font-medium text-rose-600" onClick={() => setRemoveId(row.id)}>
                          Remove Custom Price
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <EmptyState title="No custom prices" hint="Add a custom wholesale price to override the product default for this customer." />
      )}
      {editing && (
        <CustomPriceForm
          customer={customer}
          current={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(removeId)}
        onClose={() => setRemoveId('')}
        title="Remove custom price?"
        message="New wholesale invoices will use the default Wholesale Price. Existing invoices stay unchanged."
        confirmLabel="Remove Custom Price"
        tone="danger"
        onConfirm={() => {
          if (removeId) api.deactivateCustomerWholesalePrice(removeId)
          setRemoveId('')
        }}
      />
      {invoiceOpen && (
        <WholesaleInvoiceModal customer={customer} onClose={() => setInvoiceOpen(false)} />
      )}
    </div>
  )
}

function CustomPriceForm({
  customer,
  current,
  onClose,
}: {
  customer: Customer
  current?: CustomerWholesalePrice
  onClose: () => void
}) {
  const state = useStore()
  const api = useApi()
  const used = new Set(
    (state.customerWholesalePrices ?? [])
      .filter((row) => row.customerId === customer.id && row.active && row.id !== current?.id)
      .map((row) => row.productId),
  )
  const options = sellableProductsForCustomerPricing(state.products).filter((product) => {
    if (current?.productId === product.id) return true
    return !used.has(product.id)
  })
  const fallbackProduct = current
    ? state.products.find((item) => item.id === current.productId)
    : options[0]
  const [productId, setProductId] = useState(current?.productId ?? fallbackProduct?.id ?? '')
  const [price, setPrice] = useState(current ? String(current.price) : '')
  const [active, setActive] = useState(current?.active ?? true)
  const product = state.products.find((item) => item.id === productId)
  const locked = Boolean(current)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!productId) {
      api.toast('Select a product.', undefined, 'warning')
      return
    }
    const saved = api.saveCustomerWholesalePrice({ customerId: customer.id, productId, price, active })
    if (saved) onClose()
  }

  return (
    <Modal open onClose={onClose} title={current ? 'Edit Custom Price' : 'Add Custom Price'} width="max-w-md">
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="Product">
          <Select value={productId} onChange={(event) => setProductId(event.target.value)} disabled={locked}>
            <option value="">Select product</option>
            {options.map((item) => (
              <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>
            ))}
            {locked && product && !options.some((item) => item.id === product.id) && (
              <option value={product.id}>{product.name} · {product.sku}</option>
            )}
          </Select>
        </Field>
        <Field label="Default Wholesale Price">
          <Input disabled value={customPriceLabel(defaultWholesalePrice(product))} />
        </Field>
        <Field label="Custom Wholesale Price">
          <Input type="number" min={0} step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="RM" required />
        </Field>
        <Field label="Status">
          <Toggle checked={active} onChange={setActive} label={active ? 'ON' : 'OFF'} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Modal>
  )
}

function WholesaleInvoiceModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const companies = companyWarehouses(state.warehouses)
  const catalog = sellableProductsForCustomerPricing(state.products)
  const priceForProduct = (product: Product) => resolveWholesaleUnitPrice(state, customer.id, product.id)
  const [warehouseId, setWarehouseId] = useState(state.settings.defaultWarehouseId || companies[0]?.id || '')
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(state, catalog, priceForProduct)])
  const totals = lineTotals(lines)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const sale = api.createWholesaleSale({
      customerId: customer.id,
      warehouseId,
      items: lines
        .filter((line) => line.productId && line.qty > 0)
        .map((line) => ({ productId: line.productId, qty: line.qty, price: line.price, discount: line.discount })),
    })
    if (sale) {
      onClose()
      api.closeDrawer()
      navigate(`/sales/invoices/${sale.id}`)
    }
  }

  return (
    <Modal open onClose={onClose} title="Create Wholesale Invoice" width="max-w-3xl">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer">
            <Input disabled value={customer.name} />
          </Field>
          <Field label="Warehouse">
            <Select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
              {companies.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <LineEditor
          state={state}
          lines={lines}
          onChange={setLines}
          products={catalog}
          priceForProduct={priceForProduct}
        />
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Total</span>
          <span className="font-semibold tabular">{formatMoney(totals.total)}</span>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Create Invoice</Button>
        </div>
      </form>
    </Modal>
  )
}
