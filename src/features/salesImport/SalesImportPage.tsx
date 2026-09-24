import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Upload } from 'lucide-react'
import { Button, Card, EmptyState, Input, Modal, PageHeader, Select } from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { hashBytes, extractPdfTextItems } from '@/features/salesImport/pdfText'
import {
  SALES_IMPORT_WAREHOUSE_ID,
  assessSalesImport,
  batchStatusLabel,
  salesImportLinesForBatch,
  salesImportProductReview,
  takenOrderIds,
  type ProductReviewRow,
  type SalesImportReconciliation,
} from '@/features/salesImport/review'
import { confirmSaleEnabled } from '@/features/salesImport/spotCheck'
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
  const [mappingRow, setMappingRow] = useState<ProductReviewRow | null>(null)
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

  const upload = async (list: FileList | null, role: 'picking' | 'awb') => {
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
        if (role === 'awb') api.ingestSalesImportAwb(batch.id, { fileName: file.name, fileHash: hash, items })
        else api.ingestSalesImportPicking(batch.id, { fileName: file.name, fileHash: hash, items })
      }
    } finally {
      setBusy(false)
    }
  }
  const batchLines = salesImportLinesForBatch(batch.id, state.salesImportOrders ?? [], lines)
  const review = salesImportProductReview({ assessment, orders, lines: batchLines, products: state.products, takenOrderIds: taken })
  const saleEnabled = confirmSaleEnabled({ canCreate, systemCanConfirm: assessment.canConfirm, busy, reconciliationOk: review.ok })
  return (
    <div>
      <PageHeader
        title="Sales Import Review"
        subtitle="Upload, check, fix unmapped products, then confirm. Missing AWB does not block confirmation."
        actions={<Link className="text-sm text-indigo-600" to="/sales/import">All batches</Link>}
      />
      <Card className="mb-4 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Import Summary</div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Summary label="Platform" value={platformLabel(batch.platform)} />
          <Summary label="Account" value={account.name} />
          <Summary label="Orders" value={String(assessment.orderCount)} />
          <Summary label="Units" value={formatQty(review.imported)} />
        </div>
      </Card>
      {assessment.blockers.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {assessment.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}
          {assessment.needsAcknowledgement && canCreate && (
            <Button className="mt-3" variant="secondary" onClick={() => api.acknowledgeSalesImportAccount(batch.id)}>Acknowledge account</Button>
          )}
        </div>
      )}
      {assessment.shortages.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Some items are blocked by stock shortage. Ready items will remain unposted until the stock issue is resolved.
        </div>
      )}
      {canCreate && batch.status !== 'confirmed' && (
        <Card className="mb-4 p-4">
          <div className="text-sm font-medium text-slate-800">Import Files</div>
          <p className="mt-1 text-sm text-slate-500">Upload the picking list for this account. AWB is a separate shipment file.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">
              <Upload size={16} />
              {busy ? 'Processing…' : 'Upload Picking List'}
              <input className="sr-only" type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={(event) => { void upload(event.target.files, 'picking'); event.target.value = '' }} />
            </label>
            <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700">
              <Upload size={16} />
              {busy ? 'Processing…' : 'Upload AWB'}
              <input className="sr-only" type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={(event) => { void upload(event.target.files, 'awb'); event.target.value = '' }} />
            </label>
          </div>
          {files.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-slate-600">Import Files</summary>
            <ul className="mt-2 space-y-2 text-sm">
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
            </details>
          )}
        </Card>
      )}
      {orders.length > 0 && <ProductSummaryCard review={review} canMap={canCreate} onMap={setMappingRow} />}
      {review.willPost > 0 && assessment.canConfirm && (
        <p className="mb-3 text-sm text-slate-700">{formatQty(review.willPost)} units are ready to import.</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button disabled={!saleEnabled} onClick={() => api.confirmSalesImport(batch.id)}>
          Confirm Sale
        </Button>
      </div>
      {mappingRow && (
        <Modal open title="Select CSP Product" onClose={() => setMappingRow(null)}>
          <p className="text-sm text-slate-600">{mappingRow.name}</p>
          <Input className="mt-3" value={productQuery} placeholder="Filter CSP products" onChange={(event) => setProductQuery(event.target.value)} />
          <label className="mt-3 block text-sm text-slate-600">
            CSP Product
            <Select className="mt-1" value={choices[mappingRow.key] ?? ''} onChange={(event) => setChoices((current) => ({ ...current, [mappingRow.key]: event.target.value }))}>
              <option value="">Select product</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
            </Select>
          </label>
          <Button className="mt-3" disabled={!mappingRow.mapKey || !choices[mappingRow.key]} onClick={() => {
            const productId = choices[mappingRow.key]
            if (!productId || !mappingRow.mapKey || !mappingRow.keyType) return
            api.saveSalesImportMapping({ batchId: batch.id, keyType: mappingRow.keyType, key: mappingRow.mapKey, productId })
            setMappingRow(null)
            setProductQuery('')
          }}>Save</Button>
        </Modal>
      )}
    </div>
  )
}

function formatQty(qty: number) {
  return Number.isInteger(qty) ? String(qty) : String(qty)
}


function displayStatusLabel(status: ProductReviewRow['displayStatus']) {
  if (status === 'needs-mapping') return 'Needs Mapping'
  if (status === 'action-required') return 'Action Required'
  return 'Ready to Import'
}

function ProductStatusCell({ row, canMap, onMap }: { row: ProductReviewRow; canMap: boolean; onMap: (row: ProductReviewRow) => void }) {
  const label = displayStatusLabel(row.displayStatus)
  return (
    <div>
      {row.displayStatus === 'needs-mapping' && canMap ? (
        <button type="button" className="min-h-11 text-left text-sm font-semibold text-amber-800 underline" onClick={() => onMap(row)}>{label}</button>
      ) : (
        <div className="text-sm font-medium text-slate-800">{label}</div>
      )}
      {row.reasons.map((reason) => <div key={reason} className="text-xs text-slate-600">{reason}</div>)}
      {row.details.map((detail) => <div key={detail} className="text-xs text-slate-500">{detail}</div>)}
    </div>
  )
}

function ProductSummaryCard({ review, canMap, onMap }: { review: SalesImportReconciliation; canMap: boolean; onMap: (row: ProductReviewRow) => void }) {
  const needsMapping = review.products.filter((row) => row.displayStatus === 'needs-mapping').length
  return (
    <Card className="mb-4 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Product Summary</div>
      <p className="mt-1 text-sm text-slate-600">Review product names, quantities and status before importing.</p>
      {needsMapping > 0 && <p className="mt-1 text-sm text-slate-600">{needsMapping} product{needsMapping === 1 ? '' : 's'} need mapping</p>}
      <div className="mt-3 space-y-2 sm:hidden">
        {review.products.map((row) => (
          <div key={row.key} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <div className="break-words font-medium text-slate-900">{row.name}</div>
            <div className="mt-1 text-xs uppercase text-slate-400">Qty <span className="ml-1 text-sm font-semibold normal-case text-slate-900">{formatQty(row.imported)}</span></div>
            <ProductStatusCell row={row} canMap={canMap} onMap={onMap} />
          </div>
        ))}
      </div>
      <div className="mt-3 hidden sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="py-1 pr-3 font-medium">Product</th>
              <th className="py-1 pr-3 text-right font-medium">Qty</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {review.products.map((row) => (
              <tr key={row.key} className="border-t border-slate-100 align-top">
                <td className="max-w-[16rem] break-words py-2 pr-3 text-slate-800">{row.name}</td>
                <td className="py-2 pr-3 text-right font-medium">{formatQty(row.imported)}</td>
                <td className="py-2"><ProductStatusCell row={row} canMap={canMap} onMap={onMap} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
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
