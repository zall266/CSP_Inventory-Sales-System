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
  salesImportActions,
  salesImportProductReview,
  salesImportSummary,
  takenOrderIds,
  type ActionKind,
  type ActionCentre,
  type SalesImportReconciliation,
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
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [actionOpen, setActionOpen] = useState<ActionKind | null>(null)
  const [mapIndex, setMapIndex] = useState(0)
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
  const review = salesImportProductReview({ assessment, orders, lines, products: state.products, takenOrderIds: taken })
  const actions = salesImportActions({ assessment, orders, lines, products: state.products, takenOrderIds: taken })
  const saleEnabled = confirmSaleEnabled({ canCreate, systemCanConfirm: assessment.canConfirm, busy, samples, checkedKeys, reconciliationOk: review.ok })
  const unconfirmedOrders = orders.filter((order) => liveOrderStatus(order, lines, taken) !== 'confirmed')
  const partial = assessment.readyOrderIds.length > 0 && assessment.readyOrderIds.length < unconfirmedOrders.length
  const orderIdsOk = !files.some((file) => file.role !== 'awb' && !file.parseError && (file.warnings ?? []).some((warning) => /order id/i.test(warning)))

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
        {orders.length > 0 && actions.issues === 0 && review.ok && review.needReview === 0 ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <div className="font-semibold">✓ Ready to post</div>
            <div className="mt-1">{formatQty(review.willPost)} / {formatQty(review.imported)} units</div>
            <div>{assessment.readyOrderIds.length} / {unconfirmedOrders.length} orders</div>
            <div className="mt-1">Everything is ready.</div>
          </div>
        ) : orders.length > 0 && actions.issues > 0 ? (
          <button type="button" className="mt-4 w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-950" onClick={() => document.getElementById('sales-import-actions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            <div className="font-semibold">🟠 {actions.issues} item{actions.issues === 1 ? '' : 's'} need your action</div>
            <div className="mt-1 text-amber-800">{actions.orders > 0 && actions.orders !== actions.issues ? `${actions.issues} issues across ${actions.orders} orders. ` : ''}Fix Issues →</div>
          </button>
        ) : null}
      </Card>
      {orders.length > 0 && <ActionCentre actions={actions} onOpen={(kind) => { setMapIndex(0); setActionOpen(kind) }} />}
      {orders.length > 0 && <ProductSummaryCard review={review} />}
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
      <div id="sales-import-detail">
      <Card className="mb-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order Details</div>
            <div className="text-sm text-slate-600">{orders.length} order{orders.length === 1 ? '' : 's'}</div>
          </div>
          <Button variant="secondary" onClick={() => setDetailsOpen((open) => !open)}>{detailsOpen ? 'Hide Order Details' : 'Show Order Details'}</Button>
        </div>
        {orders.length === 0 ? (
          <EmptyState title="No orders yet" hint="Upload a picking list to build the review." />
        ) : detailsOpen ? (
          <div className="sf-table-wrap mt-3">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-right">Qty</th>
                  <th>Status</th>
                  <th>Order ID</th>
                </tr>
              </thead>
              <tbody>
                {orders.flatMap((order) => {
                  const status = liveOrderStatus(order, lines, taken)
                  const own = lines.filter((line) => line.orderId === order.id)
                  const rows = own.length ? own : []
                  return rows.map((line) => (
                    <tr key={line.id}>
                      <td className="max-w-[14rem] break-words align-top text-sm text-slate-800">
                        {line.mappedProductId ? (state.products.find((product) => product.id === line.mappedProductId)?.name ?? line.mappedProductSnapshot?.productName ?? externalLabel(line)) : externalLabel(line)}
                      </td>
                      <td className="align-top text-right text-sm font-medium">{formatQty(line.quantity)}</td>
                      <td className="align-top text-sm">{statusLabel(status)}</td>
                      <td className="align-top text-right text-xs text-slate-500">{order.externalOrderId}</td>
                    </tr>
                  ))
                })}
              </tbody>
            </table>
          </div>
        ) : null}
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
      <ReconciliationCard review={review} />
      {actions.issues === 0 && review.ok && review.needReview === 0 && orders.length > 0 && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <div className="font-semibold">✓ Ready to confirm</div>
          <p className="mt-1">{formatQty(review.willPost)} / {formatQty(review.imported)} units ready</p>
          <p>{assessment.readyOrderIds.length} / {unconfirmedOrders.length} orders ready</p>
          <p className="mt-1">All imported quantity is accounted for.</p>
        </div>
      )}
      {partial && review.ok && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div className="font-semibold">⚠ Partial confirmation</div>
          <p className="mt-1">{formatQty(review.willPost)} units will be posted.</p>
          <p>{formatQty(review.needReview)} units will remain unposted.</p>
          <p>{unconfirmedOrders.length - assessment.readyOrderIds.length} orders still need action.</p>
        </div>
      )}
      {!review.ok && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Cannot confirm because {formatQty(review.unaccounted)} units are not accounted for.
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button variant="secondary" onClick={() => { setDetailsOpen(true); document.getElementById('sales-import-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>View Details</Button>
        <Button disabled={!saleEnabled} onClick={() => api.confirmSalesImport(batch.id)}>
          Confirm Sale
        </Button>
        <div className="text-sm text-slate-500">
          {!review.ok
            ? `Cannot confirm because ${formatQty(review.unaccounted)} units are not accounted for.`
            : !assessment.canConfirm
            ? 'Confirm stays off until the items that need action are fixed. Missing AWB does not block valid orders.'
            : !spot.complete
              ? `Spot check ${spot.done}/${spot.required}. Confirm stays off until each selected product is checked.`
              : partial
                ? `${formatQty(review.willPost)} units from ready orders will be posted. ${formatQty(review.needReview)} units will remain unposted.`
                : `${formatQty(review.willPost)} units from ${assessment.readyOrderIds.length} orders will be posted.`}
        </div>
      </div>
      <ActionPanel
        kind={actionOpen}
        actions={actions}
        onClose={() => setActionOpen(null)}
        onViewOrder={() => { setActionOpen(null); setDetailsOpen(true); document.getElementById('sales-import-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
        mapIndex={mapIndex}
        productQuery={productQuery}
        onProductQuery={setProductQuery}
        choices={choices}
        onChoice={(id, productId) => setChoices((current) => ({ ...current, [id]: productId }))}
        products={products}
        suggestions={state.products}
        unmapped={[...unmapped.entries()]}
        canMap={canCreate}
        onSaveMap={(row) => {
          const productId = choices[row.id]
          if (!productId) return
          api.saveSalesImportMapping({ batchId: batch.id, keyType: row.keyType, key: row.key, productId })
          setMapIndex(0)
        }}
      />
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
        review={review}
        partialOrders={partial ? unconfirmedOrders.length - assessment.readyOrderIds.length : 0}
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

function ProductSummaryCard({ review }: { review: SalesImportReconciliation }) {
  return (
    <Card className="mb-4 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Product Summary</div>
      <div className="mt-2 space-y-2 sm:hidden">
        {review.products.map((row) => (
          <div key={row.key} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <div className="break-words font-medium text-slate-900">{row.name}</div>
            <div className="text-xs text-slate-500">{row.mapped ? 'Mapped' : 'Needs mapping'}</div>
            <div className="mt-1 grid grid-cols-3 gap-2 text-right">
              <div><div className="text-[11px] uppercase text-slate-400">Imported</div><div className="font-semibold">{formatQty(row.imported)}</div></div>
              <div><div className="text-[11px] uppercase text-slate-400">Will Post</div><div>{formatQty(row.willPost)}</div></div>
              <div><div className="text-[11px] uppercase text-slate-400">Need Review</div><div>{formatQty(row.needReview)}</div></div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 hidden sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="py-1 pr-3 font-medium">Product</th>
              <th className="py-1 pr-3 font-medium">Status</th>
              <th className="py-1 text-right font-medium">Imported</th>
              <th className="py-1 text-right font-medium">Will Post</th>
              <th className="py-1 text-right font-medium">Need Review</th>
            </tr>
          </thead>
          <tbody>
            {review.products.map((row) => (
              <tr key={row.key} className="border-t border-slate-100">
                <td className="max-w-[16rem] break-words py-1.5 pr-3 text-slate-800">{row.name}</td>
                <td className="py-1.5 pr-3 text-slate-600">{row.mapped ? 'Mapped' : 'Needs mapping'}</td>
                <td className="py-1.5 text-right font-medium">{formatQty(row.imported)}</td>
                <td className="py-1.5 text-right">{formatQty(row.willPost)}</td>
                <td className="py-1.5 text-right">{formatQty(row.needReview)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 font-semibold text-slate-900">
              <td className="py-1.5" colSpan={2}>Total</td>
              <td className="py-1.5 text-right">{formatQty(review.imported)}</td>
              <td className="py-1.5 text-right">{formatQty(review.willPost)}</td>
              <td className="py-1.5 text-right">{formatQty(review.needReview)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function ActionCentre({ actions, onOpen }: { actions: ActionCentre; onOpen: (kind: ActionKind) => void }) {
  return (
    <Card className="mb-4 p-4" >
      <div id="sales-import-actions">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Needs Action</div>
        <p className="mt-1 text-sm text-slate-600">Fix these items before confirming the sale.</p>
        {actions.categories.length === 0 ? (
          <p className="mt-3 text-sm text-emerald-800">No open actions.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {actions.issues !== actions.orders && actions.orders > 0 && (
              <p className="text-sm text-slate-600">{actions.issues} issues across {actions.orders} orders</p>
            )}
            {actions.categories.map((category) => (
              <button key={category.id} type="button" className="flex w-full items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-left" onClick={() => onOpen(category.id)}>
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{category.title}</span>
                  <span className="block text-sm text-slate-600">{category.hint}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-amber-900">{category.count} →</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function ActionPanel({
  kind,
  actions,
  onClose,
  onViewOrder,
  mapIndex,
  productQuery,
  onProductQuery,
  choices,
  onChoice,
  products,
  suggestions,
  unmapped,
  canMap,
  onSaveMap,
}: {
  kind: ActionKind | null
  actions: ActionCentre
  onClose: () => void
  onViewOrder: () => void
  mapIndex: number
  productQuery: string
  onProductQuery: (value: string) => void
  choices: Record<string, string>
  onChoice: (id: string, productId: string) => void
  products: Array<{ id: string; name: string; sku: string }>
  suggestions: Array<{ id: string; name: string; sku: string }>
  unmapped: Array<[string, { keyType: 'sku' | 'text'; key: string; label: string; suggestion?: string }]>
  canMap: boolean
  onSaveMap: (row: { id: string; keyType: 'sku' | 'text'; key: string }) => void
}) {
  const category = actions.categories.find((item) => item.id === kind)
  const currentMap = unmapped[Math.min(mapIndex, Math.max(unmapped.length - 1, 0))]
  return (
    <Modal open={Boolean(kind)} onClose={onClose} title={category?.title ?? 'Needs Action'} width="max-w-xl">
      {!category ? null : category.id === 'map' ? (
        <div>
          <p className="text-sm text-slate-600">{unmapped.length} product{unmapped.length === 1 ? '' : 's'} need mapping</p>
          {currentMap ? (
            <div className="mt-3 rounded-xl border border-slate-200 p-3">
              <div className="break-words text-sm font-medium text-slate-900">{currentMap[1].label}</div>
              <div className="text-sm text-slate-600">{formatQty(category.rows.find((row) => row.id === currentMap[0])?.units ?? 0)} units</div>
              {currentMap[1].suggestion && <div className="mt-1 text-xs text-slate-500">Suggestion only: {suggestions.find((product) => product.id === currentMap[1].suggestion)?.name}. It is not applied until you save.</div>}
              <label className="mt-3 block text-sm text-slate-600">
                CSP Product
                <Input className="mb-2 mt-1" placeholder="Filter CSP products" value={productQuery} onChange={(event) => onProductQuery(event.target.value)} />
                <Select value={choices[currentMap[0]] ?? ''} onChange={(event) => onChoice(currentMap[0], event.target.value)}>
                  <option value="">Select product</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
                </Select>
              </label>
              <Button className="mt-3" disabled={!canMap || !choices[currentMap[0]]} onClick={() => onSaveMap({ id: currentMap[0], keyType: currentMap[1].keyType, key: currentMap[1].key })}>Save & Next</Button>
            </div>
          ) : <p className="mt-3 text-sm text-emerald-800">All listed products are mapped.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{category.count} {category.id === 'stock' ? 'product' : 'item'}{category.count === 1 ? '' : 's'}{category.units ? ` · ${formatQty(category.units)} units` : ''}</p>
          {category.rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <div className="break-words font-medium text-slate-900">{row.product}</div>
              {category.id === 'quantity' && (
                <div className="mt-1 grid grid-cols-3 gap-2 text-right">
                  <div><div className="text-[11px] uppercase text-slate-400">Picking</div><div className="font-semibold">{formatQty(row.picking ?? 0)}</div></div>
                  <div><div className="text-[11px] uppercase text-slate-400">AWB</div><div className="font-semibold">{row.awb === undefined ? '—' : formatQty(row.awb)}</div></div>
                  <div><div className="text-[11px] uppercase text-slate-400">Diff</div><div className="font-semibold">{row.difference === undefined ? '—' : formatQty(row.difference)}</div></div>
                </div>
              )}
              {category.id === 'unallocated' && <p className="mt-1 text-slate-600">Imported {formatQty(row.imported ?? 0)} · Allocated {formatQty(row.allocated ?? 0)} · Unallocated {formatQty(row.unallocatedQty ?? 0)}</p>}
              {category.id === 'stock' && <p className="mt-1 text-slate-600">Required {formatQty(row.required ?? 0)} · Available {formatQty(row.available ?? 0)} · Short {formatQty(row.short ?? 0)}</p>}
              {category.id === 'duplicate' && <p className="mt-1 text-slate-600">{row.status}</p>}
              {row.orderRef && <p className="mt-1 break-all text-xs text-slate-500">Order ID: {row.orderRef}</p>}
              {category.id !== 'stock' && category.id !== 'other' && <Button variant="secondary" className="mt-2" onClick={onViewOrder}>View Order</Button>}
              {category.id === 'stock' && <Link className="mt-2 inline-block text-sm text-indigo-600" to="/products">View Product</Link>}
            </div>
          ))}
          {category.id === 'quantity' && <p className="text-sm text-slate-600">Quantity is not changed from this list. Compare the picking list and AWB, then review the order.</p>}
        </div>
      )}
    </Modal>
  )
}

function ReconciliationCard({ review }: { review: SalesImportReconciliation }) {
  const rows = [
    ['Imported', review.imported],
    ['Will Post', review.willPost],
    ['Need Review', review.needReview],
    ['Already Confirmed', review.alreadyConfirmed],
  ] as const
  return (
    <Card className="mb-4 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Final Check</div>
      <div className="mt-2 space-y-1 text-sm">
        {rows.map(([label, qty]) => (
          <div key={label} className="flex justify-between gap-3">
            <span className="text-slate-600">{label}</span>
            <span className="font-medium text-slate-900">{formatQty(qty)}</span>
          </div>
        ))}
        <div className={`flex justify-between gap-3 border-t border-slate-200 pt-1 font-semibold ${review.ok ? 'text-emerald-800' : 'text-rose-800'}`}>
          <span>Unaccounted</span>
          <span>{formatQty(review.unaccounted)} {review.ok ? '✓' : '⚠'}</span>
        </div>
      </div>
      <p className={`mt-2 text-sm ${review.ok ? 'text-emerald-800' : 'text-rose-800'}`}>{review.ok ? 'All imported quantity is accounted for.' : `${formatQty(review.unaccounted)} units are not accounted for.`}</p>
    </Card>
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
  review,
  partialOrders,
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
  review: SalesImportReconciliation
  partialOrders: number
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
      <div className="mt-5 border-t border-slate-100 pt-4">
        <ReconciliationCard review={review} />
        {partialOrders > 0 && review.ok && (
          <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <div className="font-semibold">⚠ Partial confirmation</div>
            <p>{summary.ready} orders will be posted. {partialOrders} orders will NOT be posted.</p>
            <p>{formatQty(review.needReview)} units will remain unposted.</p>
          </div>
        )}
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
