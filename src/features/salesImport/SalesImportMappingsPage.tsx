import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, EmptyState, Input, Modal, PageHeader, Select } from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { filterSalesImportMappings, mappingIsActive, mappingSourceTexts } from '@/features/salesImport/mapping'
import { hasPermission } from '@/features/settings/permissions'
import { useApi, useStore } from '@/store/hooks'
import type { SalesImportMapping } from '@/types'
import { formatDateTime } from '@/utils/format'

function platformLabel(platform: string) {
  if (platform === 'shopee') return 'Shopee'
  if (platform === 'tiktok') return 'TikTok'
  return platform
}

export function SalesImportMappingsPage() {
  const state = useStore()
  const api = useApi()
  const canView = hasPermission(state, 'sales.view') || hasPermission(state, 'sales.create')
  const canManage = hasPermission(state, 'sales.create')
  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState('')
  const [accountId, setAccountId] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [editing, setEditing] = useState<SalesImportMapping | null>(null)
  const [productId, setProductId] = useState('')
  const [productQuery, setProductQuery] = useState('')

  const mappings = state.salesImportMappings ?? []
  const accounts = state.salesImportAccounts ?? []
  const platforms = [...new Set(mappings.map((row) => row.platform))]
  const accountOptions = accounts.filter((account) => mappings.some((row) => row.accountId === account.id))

  const visible = useMemo(
    () =>
      filterSalesImportMappings({
        mappings,
        products: state.products,
        lines: state.salesImportLines ?? [],
        orders: state.salesImportOrders ?? [],
        batches: state.salesImportBatches ?? [],
        search,
        platform,
        accountId,
        status,
      }),
    [accountId, mappings, platform, search, state.products, state.salesImportBatches, state.salesImportLines, state.salesImportOrders, status],
  )

  if (!canView) return <PermissionDenied title="Product Mappings" subtitle="You do not have permission to view sales." />

  const openEdit = (mapping: SalesImportMapping) => {
    setEditing(mapping)
    setProductId(mapping.productId)
    setProductQuery('')
  }

  const products = state.products.filter(
    (product) => product.status === 'active' && (!productQuery || `${product.name} ${product.sku}`.toLowerCase().includes(productQuery.toLowerCase())),
  )
  const editingAccount = editing ? accounts.find((account) => account.id === editing.accountId) : undefined
  const editingSource = editing
    ? mappingSourceTexts(editing, state.salesImportLines ?? [], state.salesImportOrders ?? [], state.salesImportBatches ?? [])
    : []

  return (
    <div className="min-w-0 overflow-x-hidden">
      <PageHeader
        title="Product Mappings"
        subtitle="Saved Sales Import mappings. Changes apply to future imports."
        actions={<Link className="text-sm text-indigo-600" to="/sales/import">Back to Sales Import</Link>}
      />
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <label className="block text-sm text-slate-600 md:col-span-1">
          Search
          <Input className="mt-1" value={search} placeholder="Search SKU / Source Product / CSP Product" onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label className="block text-sm text-slate-600">
          Platform
          <Select className="mt-1" value={platform} onChange={(event) => setPlatform(event.target.value)}>
            <option value="">All</option>
            {platforms.map((item) => <option key={item} value={item}>{platformLabel(item)}</option>)}
          </Select>
        </label>
        <label className="block text-sm text-slate-600">
          Account
          <Select className="mt-1" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            <option value="">All</option>
            {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </Select>
        </label>
        <label className="block text-sm text-slate-600">
          Status
          <Select className="mt-1" value={status} onChange={(event) => setStatus(event.target.value as 'all' | 'active' | 'inactive')}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </label>
      </div>
      <Card>
        {visible.length === 0 ? (
          <EmptyState title="No mappings found." />
        ) : (
          <>
            <div className="space-y-2 p-3 sm:hidden">
              {visible.map((mapping) => (
                <MappingCard
                  key={mapping.id}
                  mapping={mapping}
                  accountName={accounts.find((account) => account.id === mapping.accountId)?.name}
                  productName={state.products.find((product) => product.id === mapping.productId)?.name}
                  source={mappingSourceTexts(mapping, state.salesImportLines ?? [], state.salesImportOrders ?? [], state.salesImportBatches ?? [])}
                  canManage={canManage}
                  onEdit={() => openEdit(mapping)}
                  onActive={(active) => api.setSalesImportMappingActive({ id: mapping.id, active })}
                />
              ))}
            </div>
            <div className="hidden sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2 font-medium">External SKU</th>
                    <th className="px-3 py-2 font-medium">Source Product</th>
                    <th className="px-3 py-2 font-medium">CSP Product</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((mapping) => {
                    const product = state.products.find((item) => item.id === mapping.productId)
                    const account = accounts.find((item) => item.id === mapping.accountId)
                    const source = mappingSourceTexts(mapping, state.salesImportLines ?? [], state.salesImportOrders ?? [], state.salesImportBatches ?? [])
                    const active = mappingIsActive(mapping)
                    return (
                      <tr key={mapping.id} className="border-t border-slate-100 align-top">
                        <td className="max-w-[10rem] break-words px-3 py-3">
                          <div className="font-medium text-slate-900">{mapping.keyType === 'sku' ? mapping.key : '—'}</div>
                          <div className="text-xs text-slate-500">{platformLabel(mapping.platform)} · {account?.name ?? '—'}</div>
                        </td>
                        <td className="max-w-[14rem] break-words px-3 py-3 text-slate-700">{source[0] ?? (mapping.keyType === 'text' ? mapping.key : '—')}</td>
                        <td className="max-w-[14rem] break-words px-3 py-3 text-slate-800">{product ? product.name : '—'}</td>
                        <td className="px-3 py-3">{active ? 'Active' : 'Inactive'}</td>
                        <td className="px-3 py-3">
                          {canManage && (
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="secondary" onClick={() => openEdit(mapping)}>Edit</Button>
                              <Button size="sm" variant="ghost" onClick={() => api.setSalesImportMappingActive({ id: mapping.id, active: !active })}>
                                {active ? 'Deactivate' : 'Activate'}
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      {editing && (
        <Modal open title="Edit Mapping" onClose={() => setEditing(null)}>
          <Field label="Platform" value={platformLabel(editing.platform)} />
          <Field label="Account" value={editingAccount?.name ?? '—'} />
          <Field label="External SKU" value={editing.keyType === 'sku' ? editing.key : '—'} />
          <Field label="Source Product" value={editingSource[0] ?? (editing.keyType === 'text' ? editing.key : '—')} />
          <Input className="mt-3" value={productQuery} placeholder="Filter CSP products" onChange={(event) => setProductQuery(event.target.value)} />
          <label className="mt-3 block text-sm text-slate-600">
            CSP Product
            <Select className="mt-1" value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">Select product</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name} · SKU {product.sku}</option>)}
            </Select>
          </label>
          {editing.createdAt && <p className="mt-3 text-xs text-slate-500">Saved {formatDateTime(editing.createdAt)}</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={!productId}
              onClick={() => {
                if (!productId) return
                const ok = api.updateSalesImportMapping({ id: editing.id, productId })
                if (ok) setEditing(null)
              }}
            >
              Save Mapping
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function MappingCard({
  mapping,
  accountName,
  productName,
  source,
  canManage,
  onEdit,
  onActive,
}: {
  mapping: SalesImportMapping
  accountName?: string
  productName?: string
  source: string[]
  canManage: boolean
  onEdit: () => void
  onActive: (active: boolean) => void
}) {
  const active = mappingIsActive(mapping)
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 px-3 py-3 text-sm">
      <div className="break-words font-medium text-slate-900">{mapping.keyType === 'sku' ? mapping.key : 'No SKU'}</div>
      <div className="mt-1 break-words text-xs text-slate-500">{platformLabel(mapping.platform)} · {accountName ?? '—'}</div>
      <div className="mt-2 break-words text-slate-700">{source[0] ?? (mapping.keyType === 'text' ? mapping.key : '—')}</div>
      <div className="mt-1 break-words text-slate-900">{productName ?? '—'}</div>
      <div className="mt-1 text-xs text-slate-500">{active ? 'Active' : 'Inactive'}</div>
      {canManage && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => onActive(!active)}>{active ? 'Deactivate' : 'Activate'}</Button>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="break-words text-sm text-slate-800">{value}</div>
    </div>
  )
}
