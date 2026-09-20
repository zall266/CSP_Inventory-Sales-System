import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Field, FilterRow, Input, PageHeader, Select, StatusBadge } from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { companyWarehouses, isCompanyWarehouseId } from '@/features/agent/agentModel'
import { formatUnit } from '@/features/products/masterData'
import {
  RECEIVING_SOURCES,
  emptyReceivingLine,
  isAllowedReceivingPhotoFile,
  receivableRawMaterials,
  receivingQtyHint,
  receivingSourceLabel,
} from '@/features/receiving/receivingModel'
import { orderChannelToReceivingSource } from '@/features/inventory/toOrderModel'
import { hasPermission } from '@/features/settings/permissions'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatQty } from '@/utils/format'

function readPhotoFile(file: File): Promise<{ url: string; name: string } | { error: string }> {
  if (!isAllowedReceivingPhotoFile(file)) return Promise.resolve({ error: 'Use a JPG, PNG, or WebP image up to 5 MB.' })
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      if (!result.startsWith('data:image/')) {
        resolve({ error: 'That file could not be read as an image.' })
        return
      }
      resolve({ url: result, name: file.name })
    }
    reader.onerror = () => resolve({ error: 'That file could not be read as an image.' })
    reader.readAsDataURL(file)
  })
}

export function ReceivingListPage() {
  const state = useStore()
  const navigate = useNavigate()
  const { warehouseName, supplierName, productName } = useLookups()
  const [query, setQuery] = useState('')
  const canView = hasPermission(state, 'receiving.view')
  const canCreate = hasPermission(state, 'receiving.create')
  const rows = useMemo(
    () =>
      (state.receivings ?? []).filter((row) => {
        if (state.ui.warehouseFilter === 'all') {
          if (!isCompanyWarehouseId(state.warehouses, row.warehouseId)) return false
        } else if (row.warehouseId !== state.ui.warehouseFilter) {
          return false
        }
        const haystack = `${row.receivingNo} ${row.supplierNote ?? ''} ${supplierName(row.supplierId ?? '')} ${row.items.map((line) => productName(line.productId)).join(' ')}`.toLowerCase()
        if (query && !haystack.includes(query.toLowerCase())) return false
        return true
      }),
    [state.receivings, state.ui.warehouseFilter, state.warehouses, query, supplierName, productName],
  )

  if (!canView) return <PermissionDenied title="Receiving" />

  return (
    <div>
      <PageHeader
        title="Receiving"
        subtitle="Record physical raw material arrivals. Purchase can be linked later."
        actions={
          canCreate ? (
            <Button onClick={() => navigate('/receiving/new')}>
              <Plus size={16} /> New receiving
            </Button>
          ) : null
        }
      />
      <FilterRow>
        <Input placeholder="Search receiving no or material" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div />
        <div />
        <div />
      </FilterRow>
      <Card>
        {rows.length ? (
          <div className="sf-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Receiving no</th>
                  <th>Date</th>
                  <th>Source</th>
                  <th>Warehouse</th>
                  <th>Items</th>
                  <th>Received by</th>
                  <th>Purchase</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} onClick={() => navigate(`/receiving/${row.id}`)}>
                    <td className="font-medium text-indigo-700">{row.receivingNo}</td>
                    <td>{formatDate(row.date)}</td>
                    <td>
                      {receivingSourceLabel(row.source)}
                      {row.supplierId ? ` · ${supplierName(row.supplierId)}` : row.supplierNote ? ` · ${row.supplierNote}` : ''}
                    </td>
                    <td>{warehouseName(row.warehouseId)}</td>
                    <td>{row.items.length}</td>
                    <td>{row.receivedByName}</td>
                    <td>{row.purchaseNo ?? 'Not linked'}</td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No receiving records"
            hint="Staff can receive incoming raw materials here without a purchase."
          />
        )}
      </Card>
    </div>
  )
}

type DraftLine = { productId: string; qty: number; batchNo: string; expiry: string; notes: string }

export function NewReceivingPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const materials = receivableRawMaterials(state)
  const orderId = searchParams.get('orderId') ?? ''
  const order = (state.stockOrders ?? []).find((row) => row.id === orderId && row.status === 'ordered')
  const [warehouseId, setWarehouseId] = useState(order?.warehouseId ?? state.settings.defaultWarehouseId)
  const [source, setSource] = useState<(typeof RECEIVING_SOURCES)[number]['id']>(orderChannelToReceivingSource(order?.channel))
  const [supplierId, setSupplierId] = useState('')
  const [supplierNote, setSupplierNote] = useState(order?.channel && order.channel !== 'Supplier' ? String(order.channel) : '')
  const [notes, setNotes] = useState(order?.remark ?? '')
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoName, setPhotoName] = useState('')
  const [photoError, setPhotoError] = useState('')
  const orderedProduct = order ? state.products.find((item) => item.id === order.productId) : undefined
  const [lines, setLines] = useState<DraftLine[]>([emptyReceivingLine(orderedProduct ?? materials[0])])

  useEffect(() => {
    if (!order) return
    setWarehouseId(order.warehouseId)
    setSource(orderChannelToReceivingSource(order.channel))
    setSupplierNote(order.channel && order.channel !== 'Supplier' ? String(order.channel) : '')
    setNotes(order.remark ?? '')
    const product = state.products.find((item) => item.id === order.productId)
    setLines([emptyReceivingLine(product)])
  }, [order?.id])

  const lineProducts = useMemo(() => {
    const list = [...materials]
    if (orderedProduct && !list.some((item) => item.id === orderedProduct.id)) list.unshift(orderedProduct)
    return list
  }, [materials, orderedProduct])

  if (!hasPermission(state, 'receiving.create')) {
    return <PermissionDenied title="New receiving" subtitle="You do not have permission to receive raw materials." />
  }

  const onUpload = async (file?: File) => {
    if (!file) return
    const result = await readPhotoFile(file)
    if ('error' in result) {
      setPhotoError(result.error)
      return
    }
    setPhotoError('')
    setPhotoUrl(result.url)
    setPhotoName(result.name)
  }

  const submit = () => {
    const created = api.createReceiving({
      warehouseId,
      source,
      supplierId: source === 'supplier' ? supplierId : undefined,
      supplierNote: source === 'supplier' ? undefined : supplierNote,
      notes,
      photoUrl: photoUrl || undefined,
      photoName: photoName || undefined,
      items: lines,
      stockOrderId: order?.id,
    })
    if (created) navigate(`/receiving/${created.id}`)
  }

  return (
    <div>
      <PageHeader
        title="New receiving"
        subtitle="Confirm physical arrival. Stock increases immediately. Price is not required."
      />
      {order && orderedProduct ? (
        <Card className="mb-4 p-4 text-sm text-slate-600">
          Awaiting receiving for <span className="font-medium text-slate-900">{orderedProduct.name}</span>
          {order.channel ? ` · ordered via ${order.channel}` : ''}
          {order.markedOrderedBy ? ` · ${order.markedOrderedBy}` : ''}
          . Enter the actual quantity received.
        </Card>
      ) : null}
      <Card className="mb-4 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Source">
          <Select value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
            {RECEIVING_SOURCES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>
        {source === 'supplier' ? (
          <Field label="Supplier (optional)">
            <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">Not selected</option>
              {state.suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label={source === 'shopee' ? 'Shopee seller / order (optional)' : 'Source note (optional)'}>
            <Input value={supplierNote} onChange={(event) => setSupplierNote(event.target.value)} placeholder="Optional" />
          </Field>
        )}
        <Field label="Warehouse">
          <Select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} disabled={Boolean(order)}>
            {companyWarehouses(state.warehouses).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes (optional)">
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="DO number, remarks" />
        </Field>
      </Card>
      <Card className="mb-4 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Raw materials</div>
            <div className="text-xs text-slate-500">Quantity, batch/lot and expiry. Purchase price is not shown.</div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setLines([...lines, emptyReceivingLine(lineProducts[0] ?? materials[0])])}
          >
            <Plus size={14} /> Add line
          </Button>
        </div>
        <div className="space-y-3">
          {lines.map((line, index) => {
            const product = state.products.find((item) => item.id === line.productId)
            return (
              <div key={index} className="grid items-start gap-2 rounded-xl border border-slate-100 p-3 lg:grid-cols-8">
                <Field label="Raw material" className="lg:col-span-2">
                  <Select
                    value={line.productId}
                    onChange={(event) =>
                      setLines(lines.map((item, i) => (i === index ? { ...item, productId: event.target.value } : item)))
                    }
                  >
                    {lineProducts.map((material) => (
                      <option key={material.id} value={material.id}>
                        {material.name} · {material.sku}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Qty" hint={receivingQtyHint(product)}>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={line.qty}
                    onChange={(event) =>
                      setLines(lines.map((item, i) => (i === index ? { ...item, qty: Number(event.target.value) } : item)))
                    }
                  />
                </Field>
                <Field label="Unit">
                  <Input value={formatUnit(product?.purchaseUnit ?? product?.unit)} readOnly />
                </Field>
                <Field label="Batch / lot">
                  <Input
                    placeholder="If available"
                    value={line.batchNo}
                    onChange={(event) =>
                      setLines(lines.map((item, i) => (i === index ? { ...item, batchNo: event.target.value } : item)))
                    }
                  />
                </Field>
                <Field label={product?.trackExpiry ? 'Expiry date' : 'Expiry (optional)'}>
                  <Input
                    type="date"
                    value={line.expiry}
                    onChange={(event) =>
                      setLines(lines.map((item, i) => (i === index ? { ...item, expiry: event.target.value } : item)))
                    }
                  />
                </Field>
                <div className="flex min-w-0 items-end gap-2 lg:col-span-2">
                  <Field label="Line note" className="min-w-0 flex-1">
                    <Input
                      value={line.notes}
                      onChange={(event) =>
                        setLines(lines.map((item, i) => (i === index ? { ...item, notes: event.target.value } : item)))
                      }
                    />
                  </Field>
                  <button
                    type="button"
                    aria-label="Remove line"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                    onClick={() => setLines(lines.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
      <Card className="p-5">
        <Field label="Photo of DO / receipt (optional)" hint={photoError || 'JPG, PNG or WebP up to 5 MB.'}>
          <Input
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            onChange={(event) => void onUpload(event.target.files?.[0])}
          />
        </Field>
        {photoUrl ? (
          <img src={photoUrl} alt={photoName || 'Delivery document'} className="mt-3 max-h-56 rounded-lg object-contain" />
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate('/receiving')}>
            Cancel
          </Button>
          <Button onClick={submit}>Confirm receiving</Button>
        </div>
      </Card>
    </div>
  )
}

export function ReceivingDetailPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { id } = useParams()
  const { warehouseName, supplierName, productName } = useLookups()
  const row = (state.receivings ?? []).find((item) => item.id === id)
  const [purchaseId, setPurchaseId] = useState('')
  const canView = hasPermission(state, 'receiving.view')
  const canLink = hasPermission(state, 'receiving.link_purchase')
  const draftPurchases = state.purchases.filter((purchase) => purchase.status === 'draft' && !purchase.receivingId)

  if (!canView) return <PermissionDenied title="Receiving" />
  if (!row) {
    return (
      <div>
        <PageHeader title="Receiving" subtitle="This receiving record was not found." />
        <Button variant="secondary" onClick={() => navigate('/receiving')}>
          Back to receiving
        </Button>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={row.receivingNo}
        subtitle="Physical arrival. Inventory was updated when this receiving was confirmed."
        actions={
          <Button variant="secondary" onClick={() => navigate('/receiving')}>
            Back
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusBadge status={row.status} />
        <Badge>{warehouseName(row.warehouseId)}</Badge>
        <Badge tone="slate">{receivingSourceLabel(row.source)}</Badge>
        {row.purchaseNo ? <Badge tone="emerald">Linked {row.purchaseNo}</Badge> : <Badge tone="amber">Purchase not linked</Badge>}
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 text-sm font-semibold">Received items</div>
          <div className="sf-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Raw material</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Stock in (base)</th>
                  <th>Batch / lot</th>
                  <th>Expiry</th>
                </tr>
              </thead>
              <tbody>
                {row.items.map((line, index) => (
                  <tr key={`${line.productId}-${index}`} className="cursor-default">
                    <td className="font-medium">{productName(line.productId)}</td>
                    <td className="tabular">{formatQty(line.qty)}</td>
                    <td>{formatUnit(line.unit)}</td>
                    <td className="tabular">{formatQty(line.baseQty)}</td>
                    <td>{line.batchNo || '—'}</td>
                    <td>{line.expiry || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="space-y-3 p-5 text-sm">
          <div>
            <div className="text-xs text-slate-400">Received by</div>
            <div className="font-medium">{row.receivedByName}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Date</div>
            <div className="font-medium">{formatDate(row.date)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Supplier / source</div>
            <div className="font-medium">
              {row.supplierId ? supplierName(row.supplierId) : row.supplierNote || receivingSourceLabel(row.source)}
            </div>
          </div>
          {row.notes ? (
            <div>
              <div className="text-xs text-slate-400">Notes</div>
              <div>{row.notes}</div>
            </div>
          ) : null}
          {row.photoUrl ? (
            <div>
              <div className="text-xs text-slate-400">DO / receipt photo</div>
              <img src={row.photoUrl} alt={row.photoName || 'Delivery document'} className="mt-2 max-h-56 w-full rounded-lg object-contain" />
            </div>
          ) : (
            <div className="text-xs text-slate-400">No DO / receipt photo attached.</div>
          )}
        </Card>
      </div>
      {canLink ? (
        <Card className="p-5">
          <div className="text-sm font-semibold">Link purchase later</div>
          <p className="mt-1 text-sm text-slate-500">
            Linking does not change stock. Use this after the owner enters the purchase invoice.
          </p>
          {row.purchaseId ? (
            <div className="mt-3">
              <Link className="text-sm font-medium text-indigo-700" to="/purchases">
                Linked to {row.purchaseNo}
              </Link>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <Select className="min-w-56" value={purchaseId} onChange={(event) => setPurchaseId(event.target.value)}>
                <option value="">Select a draft purchase</option>
                {draftPurchases.map((purchase) => (
                  <option key={purchase.id} value={purchase.id}>
                    {purchase.purchaseNo}
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                disabled={!purchaseId}
                onClick={() => api.linkReceivingToPurchase(row.id, purchaseId)}
              >
                Link selected purchase
              </Button>
              <Button onClick={() => navigate(`/purchases/new?receivingId=${row.id}`)}>Create purchase from this receiving</Button>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  )
}
