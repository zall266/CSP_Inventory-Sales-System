import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Field, FilterRow, Input, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { companyWarehouses, saleIsAgentSale } from '@/features/agent/agentModel'
import { hasPermission } from '@/features/settings/permissions'
import {
  DISPOSITION_EQUALITY_ERROR,
  emptyReturnLine,
  inputLinesFromSalesReturn,
  isAllowedReturnPhotoFile,
  remainingReturnableQty,
  returnStorageBoxOptions,
  returnableProducts,
  salesReturnTotals,
} from '@/features/returns/salesReturnModel'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatQty, PROTOTYPE_TODAY } from '@/utils/format'
import type { SalesReturn, SalesReturnInput } from '@/types'

function dateInputValue(iso?: string) {
  return (iso || PROTOTYPE_TODAY.toISOString()).slice(0, 10)
}

function toReturnDate(value: string) {
  return value ? `${value}T12:00:00+08:00` : PROTOTYPE_TODAY.toISOString()
}

function readPhotoFile(file: File): Promise<{ url: string; name: string } | { error: string }> {
  if (!isAllowedReturnPhotoFile(file)) return Promise.resolve({ error: 'Use a JPG, PNG, or WebP image up to 5 MB.' })
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

function createdByName(state: ReturnType<typeof useStore>, row: SalesReturn) {
  if (row.createdByName) return row.createdByName
  return state.users.find((user) => user.id === row.createdBy)?.name ?? row.createdBy ?? '—'
}

export function LegacySalesReturnsRedirect() {
  const [params] = useSearchParams()
  const invoice = params.get('invoice')
  return <Navigate to={invoice ? `/sales/returns/new?invoice=${encodeURIComponent(invoice)}` : '/sales/returns'} replace />
}

export function SalesReturnsListPage() {
  const state = useStore()
  const navigate = useNavigate()
  const { customerName, productName } = useLookups()
  const [query, setQuery] = useState('')
  const canView = hasPermission(state, 'sales_return.view')
  const canCreate = hasPermission(state, 'sales_return.create')
  const rows = useMemo(
    () =>
      (state.salesReturns ?? []).filter((row) => {
        const haystack = `${row.returnNo} ${row.sourceNameSnapshot} ${row.customerNameSnapshot ?? customerName(row.customerId ?? '')} ${row.originalDocumentNo ?? ''} ${row.items.map((line) => line.productNameSnapshot || productName(line.productId)).join(' ')}`.toLowerCase()
        if (query && !haystack.includes(query.toLowerCase())) return false
        return true
      }),
    [state.salesReturns, query, customerName, productName],
  )

  if (!canView) return <PermissionDenied title="Returns" />

  return (
    <div>
      <PageHeader
        title="Returns"
        subtitle="Inspect returned products. Good, Repack, and Waste are independent."
        actions={
          canCreate ? (
            <Button className="w-full sm:w-auto" onClick={() => navigate('/sales/returns/new')}>
              <Plus size={16} /> New Return
            </Button>
          ) : null
        }
      />
      <FilterRow>
        <Input placeholder="Search return no, source, customer" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div />
        <div />
        <div />
      </FilterRow>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No sales returns yet" hint="Create a return from Sales → Returns." />
        ) : (
          <>
            <div className="space-y-3 p-4 sm:hidden">
              {rows.map((row) => (
                <button
                  key={row.id}
                  className="w-full rounded-xl border border-slate-100 p-4 text-left"
                  onClick={() => navigate(`/sales/returns/${row.id}`)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold">{row.returnNo}</div>
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {formatDate(row.returnDate || row.date)} · {row.sourceNameSnapshot}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {row.customerNameSnapshot || customerName(row.customerId ?? '') || '—'}
                    {row.originalDocumentNo ? ` · ${row.originalDocumentNo}` : ''}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{row.items.length} items · {createdByName(state, row)}</div>
                </button>
              ))}
            </div>
            <div className="hidden sf-table-wrap sm:block">
              <table>
                <thead>
                  <tr>
                    <th>Return No</th>
                    <th>Date</th>
                    <th>Source</th>
                    <th>Customer</th>
                    <th>Original Invoice/Order</th>
                    <th>Items</th>
                    <th>Status</th>
                    <th>Created By</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} onClick={() => navigate(`/sales/returns/${row.id}`)}>
                      <td className="font-medium">{row.returnNo}</td>
                      <td>{formatDate(row.returnDate || row.date)}</td>
                      <td>{row.sourceNameSnapshot}</td>
                      <td>{row.customerNameSnapshot || customerName(row.customerId ?? '') || '—'}</td>
                      <td>{row.originalDocumentNo || '—'}</td>
                      <td>{row.items.length} items</td>
                      <td>
                        <StatusBadge status={row.status} />
                      </td>
                      <td>{createdByName(state, row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

export function SalesReturnEditorPage({ draft }: { draft?: SalesReturn }) {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const products = returnableProducts(state)
  const boxes = returnStorageBoxOptions(state)
  const sources = (state.returnSources ?? []).filter((row) => row.active || row.id === draft?.sourceId)
  const reasons = (state.returnReasons ?? []).filter((row) => row.active || row.id === draft?.reasonId)
  const invoiceQuery = params.get('invoice') ?? ''

  const [sourceId, setSourceId] = useState(draft?.sourceId || sources.find((row) => row.id === 'rs-shopee')?.id || sources[0]?.id || '')
  const [returnDate, setReturnDate] = useState(dateInputValue(draft?.returnDate))
  const [reasonId, setReasonId] = useState(draft?.reasonId || reasons.find((row) => row.id === 'rr-changed-mind')?.id || reasons[0]?.id || '')
  const initialSale =
    state.sales.find((sale) => sale.id === draft?.originalSaleId) ??
    state.sales.find((sale) => sale.invoiceNo.toLowerCase() === (draft?.originalDocumentNo || invoiceQuery).trim().toLowerCase())
  const [customerId, setCustomerId] = useState(draft?.customerId || initialSale?.customerId || '')
  const [saleId, setSaleId] = useState(draft?.originalSaleId || initialSale?.id || '')
  const [invoiceSearch, setInvoiceSearch] = useState(draft?.originalDocumentNo || initialSale?.invoiceNo || invoiceQuery)
  const [notes, setNotes] = useState(draft?.notes ?? '')
  const [photoUrl, setPhotoUrl] = useState(draft?.photoUrl ?? '')
  const [photoName, setPhotoName] = useState(draft?.photoName ?? '')
  const [photoError, setPhotoError] = useState('')
  const [lines, setLines] = useState<SalesReturnInput['items']>(
    draft ? inputLinesFromSalesReturn(draft) : [emptyReturnLine(products.find((row) => row.id === 'p-pack-mt') ?? products[0])],
  )
  const [busy, setBusy] = useState(false)

  if (!hasPermission(state, 'sales_return.create')) {
    return <PermissionDenied title="New Sales Return" subtitle="You do not have permission to create returns." />
  }

  const matchedSale =
    state.sales.find((sale) => sale.id === saleId) ??
    state.sales.find((sale) => sale.invoiceNo.toLowerCase() === invoiceSearch.trim().toLowerCase()) ??
    state.sales.find((sale) => invoiceSearch.trim() && sale.invoiceNo.toLowerCase().includes(invoiceSearch.trim().toLowerCase()))

  const applySale = (id: string, loadItems = false) => {
    const sale = state.sales.find((row) => row.id === id)
    setSaleId(id)
    if (!sale) return
    setInvoiceSearch(sale.invoiceNo)
    setCustomerId(sale.customerId)
    if (saleIsAgentSale(state, sale) || !loadItems) return
    setLines(
      sale.items.map((line) => {
        const product = state.products.find((item) => item.id === line.productId)
        return {
          ...emptyReturnLine(product),
          productId: line.productId,
          returnedQty: 0,
          goodQty: 0,
          unit: product?.unit || 'PACK',
        }
      }),
    )
  }

  const submit = (confirm: boolean) => {
    if (busy) return
    setBusy(true)
    const body: SalesReturnInput = {
      returnDate: toReturnDate(returnDate),
      sourceId,
      originalSaleId: matchedSale && !saleIsAgentSale(state, matchedSale) ? matchedSale.id : undefined,
      originalDocumentNo: matchedSale?.invoiceNo || invoiceSearch || undefined,
      customerId: customerId || undefined,
      reasonId,
      warehouseId: matchedSale && !saleIsAgentSale(state, matchedSale) ? matchedSale.warehouseId : state.settings.defaultWarehouseId,
      notes,
      photoUrl: photoUrl || undefined,
      photoName: photoName || undefined,
      items: lines.filter((line) => Number(line.returnedQty) > 0),
    }
    let created: SalesReturn | null | undefined
    if (draft) {
      created = api.updateSalesReturn(draft.id, body)
      if (created && confirm) {
        const ok = api.confirmSalesReturn(created.id)
        created = ok ? (api.getSnapshot().salesReturns ?? []).find((row) => row.id === created!.id) ?? created : null
      }
    } else {
      created = confirm ? api.createSalesReturn(body) : api.saveSalesReturn(body)
    }
    setBusy(false)
    if (created) navigate(`/sales/returns/${created.id}`)
  }

  const totals = salesReturnTotals(lines)

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={draft ? `${draft.returnNo} · Draft` : 'New Sales Return'}
        subtitle="Returned packs are inspected. Only Good quantity returns to Finished Goods."
        actions={
          <Button variant="secondary" className="w-full sm:w-auto" onClick={() => navigate('/sales/returns')}>
            Back
          </Button>
        }
      />
      <Card className="mb-4 space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Return Source">
            <Select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
              <option value="">Select source</option>
              {sources.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Return Date">
            <Input type="date" value={returnDate} onChange={(event) => setReturnDate(event.target.value)} />
          </Field>
          <Field label="Original Invoice / Order">
            <Input
              placeholder="Optional · INV-001234"
              value={invoiceSearch}
              onChange={(event) => {
                setInvoiceSearch(event.target.value)
                const sale = state.sales.find((row) => row.invoiceNo.toLowerCase() === event.target.value.trim().toLowerCase())
                if (sale) applySale(sale.id, false)
                else setSaleId('')
              }}
            />
          </Field>
          <Field label="Customer">
            <Select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Optional</option>
              {state.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Return Reason">
            <Select value={reasonId} onChange={(event) => setReasonId(event.target.value)}>
              <option value="">Select reason</option>
              {reasons.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional" />
          </Field>
        </div>
        {matchedSale && saleIsAgentSale(state, matchedSale) ? (
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Agent sales cannot be returned in this version. Clear the invoice to continue with a company return.
          </div>
        ) : matchedSale ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-500">
              Linked {matchedSale.invoiceNo}. Original quantities are shown on each item where available.
            </div>
            <Button variant="secondary" className="w-full sm:w-auto" onClick={() => applySale(matchedSale.id, true)}>
              Load invoice items
            </Button>
          </div>
        ) : null}
        <Field label="Photo evidence">
          <Input
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              const result = await readPhotoFile(file)
              if ('error' in result) {
                setPhotoError(result.error)
                return
              }
              setPhotoError('')
              setPhotoUrl(result.url)
              setPhotoName(result.name)
            }}
          />
          {photoName ? <div className="mt-1 text-xs text-slate-500">{photoName}</div> : <div className="mt-1 text-xs text-slate-400">Optional · JPG, PNG or WebP up to 5 MB</div>}
          {photoError ? <div className="mt-1 text-xs text-rose-600">{photoError}</div> : null}
        </Field>
      </Card>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">Return items</div>
          <div className="text-xs text-slate-500">{DISPOSITION_EQUALITY_ERROR}</div>
        </div>
        <Button
          className="w-full sm:w-auto"
          variant="secondary"
          onClick={() => setLines([...lines, emptyReturnLine(products[0])])}
        >
          <Plus size={16} /> Add Item
        </Button>
      </div>

      <div className="space-y-3">
        {lines.map((line, index) => {
          const product = state.products.find((item) => item.id === line.productId)
          const remaining = matchedSale && !saleIsAgentSale(state, matchedSale) ? remainingReturnableQty(state, matchedSale.id, line.productId, draft?.id) : null
          const original = matchedSale?.items.find((item) => item.productId === line.productId)
          const balanced =
            Number(line.goodQty) + Number(line.repackQty) + Number(line.wasteQty) === Number(line.returnedQty)
          return (
            <Card key={index} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold">Item {index + 1}</div>
                {lines.length > 1 ? (
                  <Button size="sm" variant="ghost" onClick={() => setLines(lines.filter((_, i) => i !== index))}>
                    <Trash2 size={14} /> Remove
                  </Button>
                ) : null}
              </div>
              <Field label="Product">
                <Select
                  value={line.productId}
                  onChange={(event) => {
                    const next = state.products.find((item) => item.id === event.target.value)
                    setLines(lines.map((item, i) => (i === index ? { ...emptyReturnLine(next), productId: event.target.value } : item)))
                  }}
                >
                  <option value="">Select product</option>
                  {products.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.sku}
                    </option>
                  ))}
                </Select>
              </Field>
              {original ? (
                <div className="text-xs text-slate-500">
                  Original {formatQty(original.qty)} {product?.unit} · already returned {formatQty(original.returnedQty)}
                  {remaining != null ? ` · remaining ${formatQty(remaining)}` : ''}
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Returned qty">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={line.returnedQty}
                    onChange={(event) =>
                      setLines(lines.map((item, i) => (i === index ? { ...item, returnedQty: Number(event.target.value) } : item)))
                    }
                  />
                </Field>
                <Field label="Unit">
                  <Input value={line.unit || product?.unit || 'PACK'} readOnly />
                </Field>
                <Field label="Good">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={line.goodQty}
                    onChange={(event) =>
                      setLines(lines.map((item, i) => (i === index ? { ...item, goodQty: Number(event.target.value) } : item)))
                    }
                  />
                </Field>
                <Field label="Repack">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={line.repackQty}
                    onChange={(event) =>
                      setLines(lines.map((item, i) => (i === index ? { ...item, repackQty: Number(event.target.value) } : item)))
                    }
                  />
                </Field>
                <Field label="Waste">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={line.wasteQty}
                    onChange={(event) =>
                      setLines(lines.map((item, i) => (i === index ? { ...item, wasteQty: Number(event.target.value) } : item)))
                    }
                  />
                </Field>
                <div className={`self-end text-xs ${balanced ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {balanced ? 'Disposition matches returned qty' : DISPOSITION_EQUALITY_ERROR}
                </div>
              </div>
              {Number(line.repackQty) > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Actual recoverable (G)">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={line.repackRecoveredGrams ?? ''}
                      onChange={(event) =>
                        setLines(
                          lines.map((item, i) =>
                            i === index ? { ...item, repackRecoveredGrams: event.target.value === '' ? undefined : Number(event.target.value) } : item,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="Storage Box">
                    <Select
                      value={line.repackStorageBoxId ?? ''}
                      onChange={(event) =>
                        setLines(lines.map((item, i) => (i === index ? { ...item, repackStorageBoxId: event.target.value } : item)))
                      }
                    >
                      <option value="">Select box</option>
                      {boxes.map((box) => (
                        <option key={box} value={box}>
                          {box}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              ) : null}
              {Number(line.wasteQty) > 0 ? (
                <Field label="Waste note">
                  <Input
                    value={line.wasteReason ?? ''}
                    onChange={(event) =>
                      setLines(lines.map((item, i) => (i === index ? { ...item, wasteReason: event.target.value } : item)))
                    }
                    placeholder="Optional"
                  />
                </Field>
              ) : null}
              <Field label="Line notes">
                <Textarea
                  rows={2}
                  value={line.notes ?? ''}
                  onChange={(event) => setLines(lines.map((item, i) => (i === index ? { ...item, notes: event.target.value } : item)))}
                  placeholder="Optional"
                />
              </Field>
            </Card>
          )
        })}
      </div>

      <Card className="mt-4 p-4 text-sm text-slate-600">
        Returned {formatQty(totals.returnedQty)} · Good {formatQty(totals.goodQty)} · Repack {formatQty(totals.repackQty)} · Waste{' '}
        {formatQty(totals.wasteQty)}
        {totals.recoveredGrams ? ` · Recovered ${formatQty(totals.recoveredGrams)} G` : ''}
      </Card>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button className="w-full sm:w-auto" variant="secondary" disabled={busy} onClick={() => submit(false)}>
          Save Draft
        </Button>
        <Button className="w-full sm:w-auto" disabled={busy} onClick={() => submit(true)}>
          Confirm Return
        </Button>
      </div>
    </div>
  )
}

export function SalesReturnDetailPage() {
  const state = useStore()
  const navigate = useNavigate()
  const { id } = useParams()
  const { customerName, productName } = useLookups()
  const row = (state.salesReturns ?? []).find((item) => item.id === id)
  const canView = hasPermission(state, 'sales_return.view')

  if (!canView) return <PermissionDenied title="Returns" />
  if (!row) {
    return (
      <div>
        <PageHeader title="Return" subtitle="This document was not found." />
        <Button variant="secondary" onClick={() => navigate('/sales/returns')}>
          Back
        </Button>
      </div>
    )
  }
  if (row.status === 'draft') return <SalesReturnEditorPage draft={row} />

  const totals = salesReturnTotals(row.items)
  const warehouses = companyWarehouses(state.warehouses)
  const warehouseName = warehouses.find((item) => item.id === row.warehouseId)?.name ?? row.warehouseId

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={row.returnNo}
        subtitle="Confirmed returns are locked. Inventory has already been posted."
        actions={
          <Button variant="secondary" className="w-full sm:w-auto" onClick={() => navigate('/sales/returns')}>
            Back
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusBadge status={row.status} />
        <Badge>{row.sourceNameSnapshot}</Badge>
        <Badge tone="slate">{formatDate(row.returnDate || row.date)}</Badge>
      </div>
      <Card className="mb-4 grid gap-3 p-4 text-sm sm:grid-cols-2">
        <div>
          <div className="text-xs text-slate-400">Return No</div>
          <div className="font-medium">{row.returnNo}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Date</div>
          <div>{formatDate(row.returnDate || row.date)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Source</div>
          <div>{row.sourceNameSnapshot}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Reason</div>
          <div>{row.reasonNameSnapshot || row.reason || '—'}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Customer</div>
          <div>{row.customerNameSnapshot || customerName(row.customerId ?? '') || '—'}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Original Invoice/Order</div>
          <div>{row.originalDocumentNo || '—'}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Created By</div>
          <div>{createdByName(state, row)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Warehouse</div>
          <div>{warehouseName}</div>
        </div>
        {row.notes ? (
          <div className="sm:col-span-2">
            <div className="text-xs text-slate-400">Notes</div>
            <div>{row.notes}</div>
          </div>
        ) : null}
      </Card>
      {row.photoUrl ? (
        <Card className="mb-4 p-4">
          <div className="mb-2 text-sm font-semibold">Photo evidence</div>
          <img src={row.photoUrl} alt={row.photoName || 'Return evidence'} className="max-h-64 rounded-xl object-contain" />
        </Card>
      ) : null}
      <Card className="p-4">
        <div className="mb-3 text-sm font-semibold">Items</div>
        <div className="space-y-3">
          {row.items.map((line) => (
            <div key={line.id} className="rounded-xl border border-slate-100 p-3 text-sm">
              <div className="font-medium">{line.productNameSnapshot || productName(line.productId)}</div>
              <div className="mt-1 grid gap-1 text-slate-600 sm:grid-cols-2">
                <div>Returned: {formatQty(line.returnedQty)} {line.unit}</div>
                <div>Good: {formatQty(line.goodQty)} {line.unit}</div>
                <div>Repack: {formatQty(line.repackQty)} {line.unit}</div>
                <div>Waste: {formatQty(line.wasteQty)} {line.unit}</div>
                {line.repackQty > 0 ? <div>Recovered: {formatQty(line.repackRecoveredGrams ?? 0)} G</div> : null}
                {line.repackQty > 0 ? <div>Storage Box: {line.repackStorageBoxId || '—'}</div> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 text-sm text-slate-500">
          Total returned {formatQty(totals.returnedQty)} · Good {formatQty(totals.goodQty)} · Repack {formatQty(totals.repackQty)} ·
          Waste {formatQty(totals.wasteQty)}
          {totals.recoveredGrams ? ` · Recovered ${formatQty(totals.recoveredGrams)} G` : ''}
        </div>
      </Card>
    </div>
  )
}
