import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Upload } from 'lucide-react'
import { Button, Card, EmptyState, Input, PageHeader, Select } from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { externalLabel, mappingIdentity, suggestProduct } from '@/features/salesImport/mapping'
import { hashBytes, extractPdfTextItems } from '@/features/salesImport/pdfText'
import {
  SALES_IMPORT_WAREHOUSE_ID,
  assessSalesImport,
  batchStatusLabel,
  liveOrderStatus,
  takenOrderIds,
} from '@/features/salesImport/review'
import { hasPermission } from '@/features/settings/permissions'
import { useApi, useStore } from '@/store/hooks'
import type { SalesImportPlatform } from '@/types'

const PLATFORMS: Array<{ id: SalesImportPlatform; label: string }> = [
  { id: 'shopee', label: 'Shopee' },
  { id: 'tiktok', label: 'TikTok' },
]

function platformLabel(platform: string) {
  return PLATFORMS.find((item) => item.id === platform)?.label ?? platform
}

function statusLabel(status: string) {
  if (status === 'new') return 'New'
  if (status === 'duplicate') return 'Duplicate'
  if (status === 'unmapped') return 'Unmapped'
  if (status === 'unallocated') return 'Unallocated quantity'
  if (status === 'confirmed') return 'Confirmed'
  if (status === 'error') return 'Validation error'
  return status
}

export function SalesImportPage() {
  const { batchId } = useParams()
  const state = useStore()
  const canView = hasPermission(state, 'sales.view') || hasPermission(state, 'sales.create')
  if (!canView) return <PermissionDenied title="Sales Import" subtitle="You do not have permission to view sales." />
  if (batchId) return <SalesImportReview batchId={batchId} />
  return <SalesImportList />
}

function SalesImportList() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const canCreate = hasPermission(state, 'sales.create')
  const [platform, setPlatform] = useState<SalesImportPlatform>('shopee')
  const [accountId, setAccountId] = useState('')
  const [accountName, setAccountName] = useState('')
  const accounts = (state.salesImportAccounts ?? []).filter((account) => account.active && account.platform === platform)
  const batches = [...(state.salesImportBatches ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div>
      <PageHeader
        title="Sales Import"
        subtitle="Upload picking lists for one platform and account, check the orders, then confirm through the normal sales flow."
      />
      {canCreate && (
        <Card className="mb-5 p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="block text-sm text-slate-600">
              Platform
              <Select className="mt-1" value={platform} onChange={(event) => { setPlatform(event.target.value as SalesImportPlatform); setAccountId('') }}>
                {PLATFORMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </Select>
            </label>
            <label className="block text-sm text-slate-600">
              Account
              <Select className="mt-1" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                <option value="">Select account</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </Select>
            </label>
            <label className="block text-sm text-slate-600">
              New account
              <Input className="mt-1" value={accountName} placeholder="Account name" onChange={(event) => setAccountName(event.target.value)} />
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  const account = api.createSalesImportAccount(platform, accountName)
                  if (!account) return
                  setAccountId(account.id)
                  setAccountName('')
                }}
              >
                Add account
              </Button>
              <Button
                onClick={() => {
                  const batch = api.createSalesImportBatch(platform, accountId)
                  if (batch) navigate(`/sales/import/${batch.id}`)
                }}
                disabled={!accountId}
              >
                New Import Batch
              </Button>
            </div>
          </div>
        </Card>
      )}
      <Card>
        {batches.length === 0 ? (
          <EmptyState title="No import batches" hint="Create a batch for one platform and account, then upload its picking lists." />
        ) : (
          <div className="sf-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Account</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const account = (state.salesImportAccounts ?? []).find((item) => item.id === batch.accountId)
                  return (
                    <tr key={batch.id}>
                      <td>{platformLabel(batch.platform)}</td>
                      <td>{account?.name ?? '—'}</td>
                      <td>{batchStatusLabel(batch.status)}</td>
                      <td>{batch.createdBy}</td>
                      <td><Link className="text-indigo-600" to={`/sales/import/${batch.id}`}>Open</Link></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function SalesImportReview({ batchId }: { batchId: string }) {
  const state = useStore()
  const api = useApi()
  const canCreate = hasPermission(state, 'sales.create')
  const batch = (state.salesImportBatches ?? []).find((item) => item.id === batchId)
  const account = (state.salesImportAccounts ?? []).find((item) => item.id === batch?.accountId)
  const [productQuery, setProductQuery] = useState('')
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const files = (state.salesImportFiles ?? []).filter((file) => file.batchId === batchId)
  const orders = (state.salesImportOrders ?? []).filter((order) => order.batchId === batchId)
  const lines = state.salesImportLines ?? []
  const taken = useMemo(() => {
    if (!batch || !account) return new Set<string>()
    return takenOrderIds({
      platform: batch.platform,
      accountId: batch.accountId,
      accountName: account.name,
      exceptBatchId: batch.id,
      orders: state.salesImportOrders ?? [],
      batches: state.salesImportBatches ?? [],
      sales: state.sales,
    })
  }, [account, batch, state.sales, state.salesImportBatches, state.salesImportOrders])
  const assessment = useMemo(() => {
    if (!batch || !account) return null
    return assessSalesImport({
      account,
      batch,
      files,
      orders: state.salesImportOrders ?? [],
      lines,
      products: state.products,
      takenOrderIds: taken,
      allowNegativeStock: state.settings.allowNegativeStock,
      availableQty: (productId) => state.inventory.find((row) => row.productId === productId && row.warehouseId === SALES_IMPORT_WAREHOUSE_ID)?.qty ?? 0,
    })
  }, [account, batch, files, lines, state.inventory, state.products, state.salesImportOrders, state.settings.allowNegativeStock, taken])

  if (!batch || !account || !assessment) {
    return (
      <div>
        <PageHeader title="Sales Import" subtitle="This batch is no longer available." />
        <Link className="text-sm text-indigo-600" to="/sales/import">Back to Sales Import</Link>
      </div>
    )
  }

  const products = state.products.filter((product) => product.status === 'active' && (!productQuery || `${product.name} ${product.sku}`.toLowerCase().includes(productQuery.toLowerCase())))
  const unmapped = new Map<string, { keyType: 'sku' | 'text'; key: string; label: string; suggestion?: string }>()
  for (const order of orders) {
    if (liveOrderStatus(order, lines, taken) !== 'unmapped') continue
    for (const line of lines.filter((item) => item.orderId === order.id && !item.unallocated && !item.mappedProductId)) {
      const identity = mappingIdentity(line)
      const id = `${identity.keyType}:${identity.key}`
      if (unmapped.has(id)) continue
      unmapped.set(id, { ...identity, label: externalLabel(line), suggestion: suggestProduct(line, state.products) })
    }
  }

  const upload = async (list: FileList | null) => {
    if (!list?.length) return
    setBusy(true)
    try {
      for (const file of [...list]) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const hash = await hashBytes(bytes)
        let items: Awaited<ReturnType<typeof extractPdfTextItems>> = []
        try {
          items = await extractPdfTextItems(bytes)
        } catch {
          items = []
        }
        api.ingestSalesImportPicking(batch.id, { fileName: file.name, fileHash: hash, items })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Sales Import Review"
        subtitle="Upload, check, fix unmapped products, then confirm. Missing AWB does not block confirmation."
        actions={<Link className="text-sm text-indigo-600" to="/sales/import">All batches</Link>}
      />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Summary label="Platform" value={platformLabel(batch.platform)} />
          <Summary label="Account" value={account.name} />
          <Summary label="Files" value={String(assessment.fileCount)} />
          <Summary label="Orders" value={String(assessment.orderCount)} />
          <Summary label="New" value={String(assessment.newOrders)} />
          <Summary label="Duplicate" value={String(assessment.duplicates)} />
          <Summary label="Unmapped" value={String(assessment.unmapped)} />
          <Summary label="Unallocated" value={String(assessment.unallocated)} />
          <Summary label="Errors" value={String(assessment.errors)} />
          <Summary label="Status" value={assessment.canConfirm ? 'READY TO CONFIRM' : batchStatusLabel(batch.status)} />
        </div>
      </Card>
      {assessment.mismatch && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Account mismatch. A picking list username ({assessment.mismatchNames.join(', ')}) does not match {account.name}. Confirmation is blocked.
        </div>
      )}
      {!assessment.needsAcknowledgement && batch.accountAcknowledged && files.some((file) => !file.parseError && !file.identityReliable) && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Acknowledged by {batch.accountAcknowledgedBy || 'staff'}. The picking list did not print a reliable account name.
        </div>
      )}
      {assessment.needsAcknowledgement && (
        <label className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <input
            type="checkbox"
            className="mt-1"
            checked={Boolean(batch.accountAcknowledged)}
            disabled={!canCreate || Boolean(batch.accountAcknowledged)}
            onChange={() => api.acknowledgeSalesImportAccount(batch.id)}
          />
          <span>This file belongs to the selected platform/account. The picking list does not print a reliable account name, so confirmation stays blocked until you acknowledge it.</span>
        </label>
      )}
      {assessment.blockers.filter((item) => !item.startsWith('Acknowledge') && !item.startsWith('Account mismatch')).map((item) => (
        <div key={item} className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{item}</div>
      ))}
      {canCreate && batch.status !== 'confirmed' && (
        <Card className="mb-4 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-slate-800">Picking lists</div>
              <div className="text-sm text-slate-500">Upload one or more text-based picking list PDFs for this account only.</div>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">
              <Upload size={16} />
              {busy ? 'Processing…' : 'Upload'}
              <input
                className="sr-only"
                type="file"
                accept="application/pdf,.pdf"
                multiple
                disabled={busy}
                onChange={(event) => {
                  void upload(event.target.files)
                  event.target.value = ''
                }}
              />
            </label>
          </div>
          {files.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {files.map((file) => (
                <li key={file.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="font-medium text-slate-800">{file.fileName}</div>
                  <div className="text-slate-500">
                    {file.parseError ? `Parse error: ${file.parseError}` : `Layout ${file.detectedLayout}`}
                    {file.detectedUsername ? ` · username ${file.detectedUsername}` : ''}
                    {file.identityReliable ? '' : file.parseError ? '' : ' · account not printed'}
                  </div>
                  {(file.warnings ?? []).map((warning) => <div key={warning} className="text-amber-700">{warning}</div>)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {unmapped.size > 0 && canCreate && (
        <Card className="mb-4 p-4">
          <div className="mb-3 text-sm font-medium text-slate-800">Unmapped products</div>
          <Input className="mb-3" placeholder="Filter CSP products" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} />
          <div className="space-y-4">
            {[...unmapped.entries()].map(([id, row]) => {
              const suggestion = state.products.find((product) => product.id === row.suggestion)
              return (
                <div key={id} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="text-xs font-semibold tracking-wide text-amber-800">UNMAPPED PRODUCT</div>
                  <div className="mt-1 text-sm text-slate-800">External: {row.label}</div>
                  {suggestion && <div className="mt-1 text-xs text-slate-500">Suggestion only: {suggestion.name} ({suggestion.sku}). It is not applied until you save.</div>}
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Select value={choices[id] ?? ''} onChange={(event) => setChoices((current) => ({ ...current, [id]: event.target.value }))}>
                      <option value="">Select CSP Product</option>
                      {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
                    </Select>
                    <Button
                      onClick={() => {
                        const productId = choices[id]
                        if (!productId) return
                        api.saveSalesImportMapping({ batchId: batch.id, keyType: row.keyType, key: row.key, productId })
                      }}
                      disabled={!choices[id]}
                    >
                      Save Mapping
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}
      <Card className="mb-4">
        {orders.length === 0 ? (
          <EmptyState title="No orders yet" hint="Upload a picking list to build the review." />
        ) : (
          <div className="sf-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Status</th>
                  <th>Lines</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const status = liveOrderStatus(order, lines, taken)
                  const own = lines.filter((line) => line.orderId === order.id)
                  return (
                    <tr key={order.id}>
                      <td className="align-top font-medium">{order.externalOrderId}</td>
                      <td className="align-top">{statusLabel(status)}</td>
                      <td className="align-top">
                        {own.map((line) => (
                          <div key={line.id} className="text-sm text-slate-600">
                            {externalLabel(line)}
                            {line.unallocated && line.sharedOrderCount ? ` · shared qty ${line.quantity} across ${line.sharedOrderCount} orders` : ` · qty ${line.quantity}`}
                            {line.mappedProductSnapshot ? ` · ${line.mappedProductSnapshot.productName}` : ''}
                          </div>
                        ))}
                        {order.customerMessage && <div className="text-xs text-slate-400">{order.customerMessage}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {assessment.issues.length > 0 && (
        <Card className="mb-4 p-4">
          <div className="mb-2 text-sm font-medium text-slate-800">Needs attention</div>
          <ul className="space-y-1 text-sm text-slate-700">
            {assessment.issues.slice(0, 40).map((issue) => (
              <li key={`${issue.orderId}-${issue.label}`}>{issue.externalOrderId}: {issue.label}</li>
            ))}
          </ul>
        </Card>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button disabled={!canCreate || !assessment.canConfirm || busy} onClick={() => api.confirmSalesImport(batch.id)}>
          Confirm Sale
        </Button>
        <div className="text-sm text-slate-500">
          {assessment.canConfirm ? `${assessment.readyOrderIds.length} order${assessment.readyOrderIds.length === 1 ? '' : 's'} will be posted to Main Warehouse.` : 'Confirm stays off until blocking issues for the ready orders are cleared. Duplicates and missing AWB do not block valid orders.'}
        </div>
      </div>
    </div>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-medium text-slate-900">{value}</div>
    </div>
  )
}
