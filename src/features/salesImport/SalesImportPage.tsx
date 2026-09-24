import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Upload } from 'lucide-react'
import { Button, Card, EmptyState, Input, Modal, PageHeader, Select } from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { externalLabel, mappingIdentity, suggestProduct } from '@/features/salesImport/mapping'
import { awbQuantityFor } from '@/features/salesImport/reconcileAwb'
import { hashBytes, extractPdfTextItems } from '@/features/salesImport/pdfText'
import {
  SALES_IMPORT_WAREHOUSE_ID,
  assessSalesImport,
  batchStatusLabel,
  liveOrderStatus,
  salesImportSummary,
  takenOrderIds,
  type SalesImportPostingSummary,
} from '@/features/salesImport/review'
import { buildSpotSamples, confirmSaleEnabled, spotCheckProgress, spotOrderLabel, type SpotSample } from '@/features/salesImport/spotCheck'
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
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summarySort, setSummarySort] = useState<'name' | 'qty'>('name')
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
  const shipments = (state.salesImportShipments ?? []).filter((shipment) => shipment.batchId === batch.id)
  const shipmentFor = (orderId: string) => shipments.find((shipment) => shipment.externalOrderId === orderId)
  const pendingShipments = orders.filter((order) => !shipments.some((shipment) => shipment.externalOrderId === order.externalOrderId)).length

  const samples = buildSpotSamples({
    orders,
    lines: lines.filter((line) => orders.some((order) => order.id === line.orderId)),
    products: state.products,
    categories: state.categories,
  })
  const checkedKeys = batch.spotCheckedKeys ?? []
  const spot = spotCheckProgress(samples, checkedKeys)
  const saleEnabled = confirmSaleEnabled({ canCreate, systemCanConfirm: assessment.canConfirm, busy, samples, checkedKeys })
  const orderIdsOk = !files.some((file) => file.role !== 'awb' && !file.parseError && (file.warnings ?? []).some((warning) => /order id/i.test(warning)))

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
          <Summary label="Sales" value={String(orders.filter((order) => order.status === 'confirmed' && order.saleId).length)} />
          <Summary label="New" value={String(assessment.newOrders)} />
          <Summary label="Duplicate" value={String(assessment.duplicates)} />
          <Summary label="Unmapped" value={String(assessment.unmapped)} />
          <Summary label="Unallocated" value={String(assessment.unallocated)} />
          <Summary label="Errors" value={String(assessment.errors)} />
          <Summary label="Status" value={assessment.canConfirm ? (spot.complete ? 'READY TO CONFIRM' : 'SPOT CHECK') : batchStatusLabel(batch.status)} />
        </div>
      </Card>
      {assessment.mismatch && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Account mismatch. A file username ({assessment.mismatchNames.join(', ')}) does not match {account.name}. Confirmation is blocked.
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
      {samples.length > 0 && !summaryOpen && (
        <Card className="mb-4 p-4">
          <SpotCheckPanel
            domId="sales-import-spot-check"
            samples={samples}
            checkedKeys={checkedKeys}
            canEdit={canCreate && batch.status !== 'confirmed'}
            onToggle={(key, checked) => api.setSalesImportSpotCheck(batch.id, key, checked)}
            onViewAll={() => document.getElementById('sales-import-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          />
        </Card>
      )}
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
                  void upload(event.target.files, 'picking')
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
      <div id="sales-import-detail">
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
                            {line.mappedProductSnapshot
                              ? ` · ${line.mappedProductSnapshot.productName}`
                              : line.mappedProductId
                                ? ` · ${state.products.find((product) => product.id === line.mappedProductId)?.name ?? ''}`
                                : ''}
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
      </div>
      <Card className="mb-4 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-slate-800">AWB / shipments</div>
              <div className="text-sm text-slate-500">Upload before or after confirmation. AWB links shipments and does not create another sale.</div>
            </div>
            {canCreate && (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700">
              <Upload size={16} />
              {busy ? 'Processing…' : 'Upload AWB'}
              <input
                className="sr-only"
                type="file"
                accept="application/pdf,.pdf"
                multiple
                disabled={busy}
                onChange={(event) => {
                  void upload(event.target.files, 'awb')
                  event.target.value = ''
                }}
              />
            </label>
            )}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Summary label="Shipments" value={String(shipments.length)} />
            <Summary label="Matched" value={String(shipments.filter((shipment) => shipment.linkStatus === 'matched').length)} />
            <Summary label="Unmatched" value={String(shipments.filter((shipment) => shipment.linkStatus === 'unmatched').length)} />
            <Summary label="Review" value={String(shipments.filter((shipment) => shipment.linkStatus === 'review').length)} />
            <Summary label="Pending" value={String(pendingShipments)} />
          </div>
          {pendingShipments > 0 && shipments.length === 0 && (
            <div className="mt-3 text-sm text-slate-500">AWB: {pendingShipments} pending. Pending is not an error.</div>
          )}
        </Card>
      {shipments.length > 0 && (
        <Card className="mb-4">
          <div className="sf-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Product</th>
                  <th>Picking Qty</th>
                  <th>AWB Qty</th>
                  <th>Difference</th>
                  <th>Tracking</th>
                  <th>Courier</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const own = lines.filter((line) => line.orderId === order.id)
                  const shipment = shipmentFor(order.externalOrderId)
                  const rows = own.length ? own : [undefined]
                  return rows.map((line, index) => {
                    const awbQty = line ? awbQuantityFor(line, order.externalOrderId, shipments) : undefined
                    const shownAwb = line?.quantitySource === 'awb' ? line.quantity : awbQty
                    const pickingQty = line?.quantitySource === 'awb' ? line.quantity : line?.unallocated ? undefined : line?.quantity
                    const difference = pickingQty !== undefined && shownAwb !== undefined ? shownAwb - pickingQty : undefined
                    return (
                      <tr key={`${order.id}-${line?.id ?? index}`}>
                        <td className="align-top font-medium">{index === 0 ? order.externalOrderId : ''}</td>
                        <td className="align-top">{line ? externalLabel(line) : '—'}</td>
                        <td className="align-top">{line?.unallocated ? `shared ${line.quantity}` : pickingQty ?? '—'}</td>
                        <td className="align-top">{shownAwb ?? '—'}</td>
                        <td className="align-top">{difference === undefined ? '—' : String(difference)}</td>
                        <td className="align-top">{index === 0 ? shipment?.trackingNumber || '—' : ''}</td>
                        <td className="align-top">{index === 0 ? shipment?.courierText || '—' : ''}</td>
                        <td className="align-top">{index === 0 ? (shipment ? shipment.linkStatus[0].toUpperCase() + shipment.linkStatus.slice(1) : 'Pending') : ''}</td>
                      </tr>
                    )
                  })
                })}
                {shipments.filter((shipment) => !orders.some((order) => order.externalOrderId === shipment.externalOrderId)).map((shipment) => (
                  <tr key={shipment.id}>
                    <td className="font-medium">{shipment.externalOrderId}</td>
                    <td>{shipment.packingLines.map((line) => line.externalProductName).join(', ') || '—'}</td>
                    <td>—</td>
                    <td>{shipment.packingLines.reduce((sum, line) => sum + line.quantity, 0) || '—'}</td>
                    <td>—</td>
                    <td>{shipment.trackingNumber || '—'}</td>
                    <td>{shipment.courierText || '—'}</td>
                    <td>{shipment.linkStatus[0].toUpperCase() + shipment.linkStatus.slice(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
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
        <Button variant="secondary" onClick={() => setSummaryOpen(true)}>View Sales Summary</Button>
        <Button disabled={!saleEnabled} onClick={() => api.confirmSalesImport(batch.id)}>
          Confirm Sale
        </Button>
        <div className="text-sm text-slate-500">
          {!assessment.canConfirm
            ? 'Confirm stays off until blocking issues for the ready orders are cleared. Duplicates and missing AWB do not block valid orders.'
            : !spot.complete
              ? `Spot check ${spot.done}/${spot.required}. Confirm stays off until each selected product is checked.`
              : `${assessment.readyOrderIds.length} order${assessment.readyOrderIds.length === 1 ? '' : 's'} will be posted to Main Warehouse.`}
        </div>
      </div>
      <SalesSummaryModal
        open={summaryOpen}
        sort={summarySort}
        onSort={setSummarySort}
        onClose={() => setSummaryOpen(false)}
        onDetails={() => {
          setSummaryOpen(false)
          document.getElementById('sales-import-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}
        onConfirm={() => api.confirmSalesImport(batch.id)}
        canConfirm={saleEnabled}
        samples={samples}
        checkedKeys={checkedKeys}
        canEditSpotCheck={canCreate && batch.status !== 'confirmed'}
        onToggleSpotCheck={(key, checked) => api.setSalesImportSpotCheck(batch.id, key, checked)}
        orderIdsOk={orderIdsOk}
        platform={platformLabel(batch.platform)}
        account={account.name}
        summary={salesImportSummary({
          assessment,
          orders,
          lines,
          products: state.products,
          shipments,
          takenOrderIds: taken,
        })}
      />
    </div>
  )
}

function formatQty(qty: number) {
  return Number.isInteger(qty) ? String(qty) : String(qty)
}

function SpotCheckPanel({
  domId,
  samples,
  checkedKeys,
  canEdit,
  onToggle,
  onViewAll,
}: {
  domId?: string
  samples: SpotSample[]
  checkedKeys: string[]
  canEdit: boolean
  onToggle: (key: string, checked: boolean) => void
  onViewAll: () => void
}) {
  const progress = spotCheckProgress(samples, checkedKeys)
  const checked = new Set(checkedKeys)
  if (!samples.length) return null
  return (
    <div id={domId}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Spot Check</div>
      <p className="mt-1 text-sm text-slate-600">Compare these products with your uploaded Picking List.</p>
      <p className="mt-1 text-sm text-slate-600">System checks all imported data. Please spot-check these {progress.required} products against your Picking List.</p>
      <p className="mt-2 text-sm font-medium text-slate-800">System-selected {progress.required} products</p>
      <p className="mt-1 text-sm text-slate-600">Check these {progress.required} products against the uploaded Picking List. If they match, mark each as checked.</p>
      <ol className="mt-3 space-y-3">
        {samples.map((sample, index) => {
          const isChecked = checked.has(sample.key)
          return (
            <li key={sample.key} className="rounded-xl border border-slate-200 p-3">
              <div className="break-words text-sm font-medium text-slate-900">{index + 1}. {sample.name}</div>
              <div className="mt-1 text-sm text-slate-600">Picking List: {formatQty(sample.quantity)} units</div>
              <div className="text-sm text-slate-600">System: {formatQty(sample.quantity)} units</div>
              <div className="break-words text-sm text-slate-600">Mapping: {sample.mappingStatus === 'Mapped' ? sample.mappedName || 'Mapped' : 'Unmapped'}</div>
              <div className="break-words text-sm text-slate-600">Orders: {spotOrderLabel(sample.orderIds)}</div>
              <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={isChecked}
                  disabled={!canEdit}
                  aria-label={`Checked ${sample.name}`}
                  onChange={(event) => onToggle(sample.key, event.target.checked)}
                />
                <span>{isChecked ? 'Checked' : 'Not checked'}</span>
              </label>
            </li>
          )
        })}
      </ol>
      <div className={`mt-3 text-sm font-medium ${progress.complete ? 'text-emerald-800' : 'text-slate-800'}`}>
        {progress.complete ? `✓ Spot Check Complete — ${progress.required}/${progress.required}` : `${progress.done} / ${progress.required} checked`}
      </div>
      <Button variant="secondary" className="mt-3 w-full sm:w-auto" onClick={onViewAll}>View All Imported Data</Button>
    </div>
  )
}

function SalesSummaryModal({
  open,
  sort,
  onSort,
  onClose,
  onDetails,
  onConfirm,
  canConfirm,
  samples,
  checkedKeys,
  canEditSpotCheck,
  onToggleSpotCheck,
  orderIdsOk,
  platform,
  account,
  summary,
}: {
  open: boolean
  sort: 'name' | 'qty'
  onSort: (sort: 'name' | 'qty') => void
  onClose: () => void
  onDetails: () => void
  onConfirm: () => void
  canConfirm: boolean
  samples: SpotSample[]
  checkedKeys: string[]
  canEditSpotCheck: boolean
  onToggleSpotCheck: (key: string, checked: boolean) => void
  orderIdsOk: boolean
  platform: string
  account: string
  summary: SalesImportPostingSummary
}) {
  const products = [...summary.products].sort((a, b) => sort === 'qty' ? b.qty - a.qty || a.name.localeCompare(b.name) : a.name.localeCompare(b.name))
  const awbOk = summary.awb.review === 0 && summary.awb.unmatched === 0
  const awbClass = !awbOk ? 'text-amber-700' : summary.awb.matched === summary.orders ? 'text-emerald-700' : 'text-slate-700'
  const awbLabel = [
    `${summary.awb.matched} / ${summary.orders} matched`,
    summary.awb.pending ? `${summary.awb.pending} pending` : '',
    summary.awb.review ? `${summary.awb.review} review` : '',
    summary.awb.unmatched ? `${summary.awb.unmatched} unmatched` : '',
  ].filter(Boolean).join(' · ')
  const quantityOk = summary.unallocated === 0 && summary.errors === 0
  const checks = [
    { label: 'Product Mapping', ok: summary.mappingOk, detail: summary.mappingOk ? 'Complete' : `${summary.unmapped} unmapped` },
    { label: 'Order IDs', ok: orderIdsOk, detail: orderIdsOk ? 'Present' : 'Review warnings' },
    { label: 'Quantity Allocation', ok: quantityOk, detail: summary.unallocated ? `${summary.unallocated} unallocated` : summary.errors ? `${summary.errors} quantity review` : 'Complete' },
    { label: 'Duplicate Check', ok: summary.duplicates === 0, detail: summary.duplicates ? `${summary.duplicates} already imported` : 'Passed' },
    { label: 'Inventory', ok: summary.inventoryOk, detail: summary.inventoryOk ? 'OK' : 'Attention' },
  ]
  return (
    <Modal open={open} onClose={onClose} title="Sales Summary" width="max-w-xl">
      <div className="text-sm text-slate-500">{platform} · {account}</div>
      <p className="mt-3 text-base font-medium text-slate-900">{summary.orders} Orders · {formatQty(summary.importedQty)} Units</p>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-50 px-2 py-3">
          <div className="text-xs text-slate-500">Orders</div>
          <div className="text-xl font-semibold text-slate-900">{summary.orders}</div>
        </div>
        <div className="rounded-xl bg-emerald-50 px-2 py-3">
          <div className="text-xs text-emerald-700">Ready to Confirm</div>
          <div className="text-xl font-semibold text-emerald-800">{summary.ready}</div>
        </div>
        <div className={summary.attention ? 'rounded-xl bg-amber-50 px-2 py-3' : 'rounded-xl bg-slate-50 px-2 py-3'}>
          <div className={summary.attention ? 'text-xs text-amber-700' : 'text-xs text-slate-500'}>Need Attention</div>
          <div className={summary.attention ? 'text-xl font-semibold text-amber-800' : 'text-xl font-semibold text-slate-900'}>{summary.attention}</div>
        </div>
      </div>
      <div className="mt-5 border-t border-slate-100 pt-4">
        <SpotCheckPanel
          samples={samples}
          checkedKeys={checkedKeys}
          canEdit={canEditSpotCheck}
          onToggle={onToggleSpotCheck}
          onViewAll={onDetails}
        />
      </div>
      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">System Validation</div>
        <div className="mt-2 space-y-1 text-sm text-slate-700">
          {checks.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3">
              <span>{row.ok ? '✓' : '⚠'} {row.label}</span>
              <span className="font-medium">{row.detail}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Final Posting</div>
        <p className="mt-2 text-sm font-medium text-slate-900">
          {summary.ready === 0 ? 'No orders will be posted.' : `${summary.ready} order${summary.ready === 1 ? '' : 's'} will be posted.`}
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-slate-400">Imported</div>
            <div className="font-medium text-slate-800">{formatQty(summary.importedQty)} units</div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-emerald-700">Will be posted</div>
            <div className="font-semibold text-emerald-900">{formatQty(summary.postQty)} units</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-amber-700">Not posted</div>
            <div className="font-semibold text-amber-900">{formatQty(summary.heldQty)} units</div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Will be posted</div>
          {products.length > 1 && (
            <div className="flex gap-2 text-xs">
              <button type="button" className={sort === 'name' ? 'font-semibold text-indigo-700' : 'text-slate-500'} onClick={() => onSort('name')}>Name</button>
              <button type="button" className={sort === 'qty' ? 'font-semibold text-indigo-700' : 'text-slate-500'} onClick={() => onSort('qty')}>Quantity</button>
            </div>
          )}
        </div>
        {products.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nothing in this batch will be sent to a sale.</p>
        ) : (
          <div className="mt-1 max-h-52 overflow-y-auto">
            {products.map((product) => (
              <div key={product.productId} className="border-b border-slate-100 py-2 sm:flex sm:items-baseline sm:justify-between sm:gap-4">
                <div className="text-sm text-slate-800">{product.name}</div>
                <div className="text-sm font-semibold text-slate-900">{formatQty(product.qty)}</div>
              </div>
            ))}
            <div className="flex items-baseline justify-between py-2 text-sm font-semibold text-slate-900">
              <span>Total quantity</span>
              <span>{formatQty(summary.postQty)}</span>
            </div>
          </div>
        )}
        {summary.attention > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
            <div className="font-medium">{summary.attention} order{summary.attention === 1 ? '' : 's'} will not be posted.</div>
            <ul className="mt-2 space-y-1">
              {summary.reasons.map((reason) => (
                <li key={reason.label}>{reason.count} {reason.label}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">AWB</div>
        <div className={`mt-2 text-sm ${awbClass}`}>{awbLabel}</div>
        <p className="mt-2 text-xs text-slate-500">Pending AWB is not an error. Missing shipments do not block confirmation.</p>
      </div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button className="w-full sm:w-auto" disabled={!canConfirm} onClick={onConfirm}>Confirm Sale</Button>
      </div>
    </Modal>
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
