import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Field, FilterRow, Input, Modal, PageHeader, Select, StatusBadge } from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { companyWarehouses } from '@/features/agent/agentModel'
import { formatUnit } from '@/features/products/masterData'
import {
  OPENING_BALANCE_TYPES,
  conversionPreview,
  emptyOpeningLine,
  finishedGoodsProducts,
  inputLinesFromOpeningBalance,
  lineUnitOptions,
  openingBalanceTypeLabel,
  productionBalanceProducts,
  stockItemProducts,
  storageBoxOptions,
} from '@/features/openingBalance/openingBalanceModel'
import { CARTON_STORAGE_TYPES } from '@/features/warehouse/warehouseModel'
import { hasPermission } from '@/features/settings/permissions'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatQty } from '@/utils/format'
import type { OpeningBalance, OpeningBalanceInput, OpeningBalanceType, Product } from '@/types'

type DraftLine = OpeningBalanceInput['items'][number]

function itemPool(state: ReturnType<typeof useStore>, type: OpeningBalanceType) {
  if (type === 'finished_goods') return finishedGoodsProducts(state)
  if (type === 'production_balance') return productionBalanceProducts(state)
  return stockItemProducts(state)
}

function matchesQuery(product: Product, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${product.name} ${product.sku}`.toLowerCase().includes(q)
}

export function OpeningBalancePage() {
  const { id } = useParams()
  const state = useStore()
  if (id) {
    const row = (state.openingBalances ?? []).find((item) => item.id === id)
    if (row?.status === 'draft') return <OpeningBalanceHomePage draft={row} />
    return <OpeningBalanceDetailPage />
  }
  return <OpeningBalanceHomePage />
}

function OpeningBalanceHomePage({ draft }: { draft?: OpeningBalance }) {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { productName, warehouseName } = useLookups()
  const canView = hasPermission(state, 'opening_balance.view')
  const canCreate = hasPermission(state, 'opening_balance.create')
  const [type, setType] = useState<OpeningBalanceType>(draft?.type ?? 'stock_item')
  const [warehouseId, setWarehouseId] = useState(draft?.items[0]?.warehouseId ?? state.settings.defaultWarehouseId)
  const [notes, setNotes] = useState(draft?.notes ?? '')
  const products = itemPool(state, type)
  const [lines, setLines] = useState<DraftLine[]>(
    draft ? inputLinesFromOpeningBalance(draft) : [emptyOpeningLine(type, products[0], warehouseId)],
  )
  const [query, setQuery] = useState('')
  const [itemQuery, setItemQuery] = useState('')
  const [detailsIndex, setDetailsIndex] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const catalog = useMemo(
    () => products.filter((product) => matchesQuery(product, itemQuery)),
    [products, itemQuery],
  )

  const history = useMemo(
    () =>
      (state.openingBalances ?? []).filter((row) => {
        if (state.ui.warehouseFilter !== 'all' && !row.items.some((line) => line.warehouseId === state.ui.warehouseFilter)) return false
        if (query && !`${row.documentNo} ${openingBalanceTypeLabel(row.type)}`.toLowerCase().includes(query.toLowerCase())) return false
        return true
      }),
    [state.openingBalances, state.ui.warehouseFilter, query],
  )

  if (!canView) return <PermissionDenied title="Opening Balance" />

  const switchType = (next: OpeningBalanceType) => {
    const pool = itemPool(state, next)
    setType(next)
    setItemQuery('')
    setDetailsIndex(null)
    setLines([emptyOpeningLine(next, pool[0], warehouseId)])
  }

  const patchLine = (index: number, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const chooseProduct = (index: number, productId: string) => {
    const next = state.products.find((item) => item.id === productId)
    patchLine(index, {
      productId,
      unit: type === 'production_balance' ? 'G' : next?.purchaseUnit || next?.unit || '',
    })
  }

  const addLine = () => {
    setLines((current) => {
      const used = new Set(current.map((line) => line.productId))
      const nextProduct = catalog.find((product) => !used.has(product.id)) ?? catalog[0] ?? products[0]
      return [...current, emptyOpeningLine(type, nextProduct, warehouseId)]
    })
  }

  const submit = (confirm: boolean) => {
    if (busy) return
    setBusy(true)
    const payload: OpeningBalanceInput = { type, notes, items: lines }
    let created: OpeningBalance | null | undefined
    if (draft) {
      created = api.updateOpeningBalance(draft.id, payload)
      if (created && confirm) {
        const ok = api.confirmOpeningBalance(created.id)
        created = ok ? (api.getSnapshot().openingBalances ?? []).find((row) => row.id === created!.id) ?? created : null
      }
    } else {
      created = confirm ? api.createOpeningBalance(payload) : api.saveOpeningBalance(payload)
    }
    setBusy(false)
    if (created) {
      if (!draft) {
        setLines([emptyOpeningLine(type, products[0], warehouseId)])
        setNotes('')
      }
      navigate(`/inventory/opening-balance/${created.id}`)
    }
  }

  const detailsLine = detailsIndex === null ? null : lines[detailsIndex]
  const detailsProduct = detailsLine ? state.products.find((item) => item.id === detailsLine.productId) : undefined

  return (
    <div>
      <PageHeader
        title={draft ? `${draft.documentNo} · Draft` : 'Opening Balance'}
        subtitle="Record stock that existed before the system go-live."
      />
      {canCreate ? (
        <Card className="mb-5 p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            {OPENING_BALANCE_TYPES.map((item) => (
              <Button
                key={item.id}
                className="w-full sm:w-auto"
                variant={type === item.id ? 'primary' : 'secondary'}
                onClick={() => switchType(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <Field label="Warehouse">
              <Select
                value={warehouseId}
                onChange={(event) => {
                  setWarehouseId(event.target.value)
                  setLines((current) => current.map((line) => ({ ...line, warehouseId: event.target.value })))
                }}
              >
                {companyWarehouses(state.warehouses).map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notes (optional)">
              <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Go-live initialization" />
            </Field>
          </div>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <Field label="Search product or SKU" className="sm:max-w-sm sm:flex-1">
              <Input placeholder="Search product or SKU" value={itemQuery} onChange={(event) => setItemQuery(event.target.value)} />
            </Field>
            <Button variant="secondary" className="w-full sm:w-auto" onClick={addLine}>
              <Plus size={14} /> Add Item
            </Button>
          </div>
          <div className="hidden sm:block">
            <div className="sf-table-wrap rounded-xl border border-slate-100">
              <table>
                <thead>
                  <tr>
                    <th>{type === 'finished_goods' ? 'Product' : type === 'production_balance' ? 'Product' : 'Item'}</th>
                    <th>SKU</th>
                    <th>{type === 'production_balance' ? 'Balance (G)' : 'Qty'}</th>
                    {type !== 'production_balance' ? <th>Unit</th> : null}
                    {type === 'production_balance' ? <th>Storage Box</th> : <th>Batch</th>}
                    {type !== 'production_balance' ? <th>Expiry</th> : null}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <OpeningBalanceRow
                      key={index}
                      line={line}
                      index={index}
                      type={type}
                      state={state}
                      catalog={catalog}
                      products={products}
                      onProduct={(productId) => chooseProduct(index, productId)}
                      onPatch={(patch) => patchLine(index, patch)}
                      onDetails={() => setDetailsIndex(index)}
                      onRemove={() => setLines((current) => current.filter((_, i) => i !== index))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="space-y-3 sm:hidden">
            {lines.map((line, index) => {
              const product = state.products.find((item) => item.id === line.productId)
              const preview = product && type !== 'production_balance' ? conversionPreview(product, Number(line.qty) || 0, line.unit || product.unit) : null
              return (
                <div key={index} className="rounded-xl border border-slate-100 p-3">
                  <Field label={type === 'finished_goods' ? 'Product' : 'Item'}>
                    <ProductSelect
                      value={line.productId}
                      catalog={catalog}
                      current={product}
                      onChange={(productId) => chooseProduct(index, productId)}
                    />
                  </Field>
                  <div className="mt-2 text-xs text-slate-500">{product?.sku ?? '—'}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Field label={type === 'production_balance' ? 'Balance (G)' : 'Qty'}>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={line.qty}
                        onChange={(event) => patchLine(index, { qty: Number(event.target.value) })}
                      />
                    </Field>
                    {type === 'production_balance' ? (
                      <Field label="Storage Box">
                        <StorageBoxInput
                          index={index}
                          value={line.container ?? ''}
                          options={storageBoxOptions(state)}
                          onChange={(container) => patchLine(index, { container })}
                        />
                      </Field>
                    ) : (
                      <Field label="Unit">
                        <Select value={line.unit} onChange={(event) => patchLine(index, { unit: event.target.value })}>
                          {lineUnitOptions(product).map((unit) => (
                            <option key={unit} value={unit}>{unit}</option>
                          ))}
                        </Select>
                      </Field>
                    )}
                  </div>
                  {preview ? (
                    <div className="mt-2 text-xs text-slate-500">{formatQty(preview.baseQty)} {preview.unit} base quantity</div>
                  ) : null}
                  <div className="mt-3 flex items-center justify-between">
                    <button type="button" className="text-xs font-medium text-indigo-600" onClick={() => setDetailsIndex(index)}>
                      Details
                    </button>
                    <button type="button" className="text-xs font-medium text-rose-600" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <Card className="mt-4 bg-slate-50 p-4">
            <div className="text-sm font-semibold">Opening Balance Summary</div>
            <div className="mt-1 text-sm text-slate-600">
              {type === 'finished_goods'
                ? `Total: ${formatQty(lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0))} PACK`
                : type === 'production_balance'
                  ? `Total Balance: ${formatQty(lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0))} G`
                  : `Total Items: ${lines.length}`}
            </div>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {lines.map((line, index) => {
                const product = state.products.find((item) => item.id === line.productId)
                const preview = product && type !== 'production_balance' ? conversionPreview(product, Number(line.qty) || 0, line.unit || product.unit) : null
                return (
                  <li key={index}>
                    {productName(line.productId)} +{formatQty(preview?.baseQty ?? (Number(line.qty) || 0))} {type === 'production_balance' ? 'G' : (preview?.unit ?? line.unit)} · {warehouseName(line.warehouseId)}
                    {line.container ? ` · ${line.container}` : ''}
                  </li>
                )
              })}
            </ul>
          </Card>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" className="w-full sm:w-auto" disabled={busy} onClick={() => submit(false)}>
              Save Draft
            </Button>
            <Button className="w-full sm:w-auto" disabled={busy} onClick={() => submit(true)}>
              Confirm Opening Balance
            </Button>
          </div>
        </Card>
      ) : null}

      {detailsLine && detailsIndex !== null ? (
        <LineDetailsModal
          type={type}
          line={detailsLine}
          product={detailsProduct}
          state={state}
          index={detailsIndex}
          onPatch={(patch) => patchLine(detailsIndex, patch)}
          onClose={() => setDetailsIndex(null)}
        />
      ) : null}

      <PageHeader title="Opening Balance History" />
      <FilterRow>
        <Input placeholder="Search document no" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div />
        <div />
        <div />
      </FilterRow>
      <Card>
        {history.length ? (
          <div className="space-y-2 p-3 sm:p-0">
            <div className="hidden sf-table-wrap sm:block">
              <table>
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Lines</th>
                    <th>Created by</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id} onClick={() => navigate(`/inventory/opening-balance/${row.id}`)}>
                      <td className="font-medium text-indigo-700">{row.documentNo}</td>
                      <td>{formatDate(row.date)}</td>
                      <td>{openingBalanceTypeLabel(row.type)}</td>
                      <td>{row.items.length}</td>
                      <td>{row.createdByName}</td>
                      <td>
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 sm:hidden">
              {history.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="w-full rounded-xl border border-slate-100 p-3 text-left"
                  onClick={() => navigate(`/inventory/opening-balance/${row.id}`)}
                >
                  <div className="font-medium text-indigo-700">{row.documentNo}</div>
                  <div className="text-xs text-slate-500">
                    {formatDate(row.date)} · {openingBalanceTypeLabel(row.type)} · {row.items.length} items
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Created by: {row.createdByName}</div>
                  <StatusBadge status={row.status} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState title="No opening balance yet" hint="Confirmed go-live stock will appear here." />
        )}
      </Card>
    </div>
  )
}

function ProductSelect({
  value,
  catalog,
  current,
  onChange,
}: {
  value: string
  catalog: Product[]
  current?: Product
  onChange: (productId: string) => void
}) {
  const options = current && !catalog.some((item) => item.id === current.id) ? [current, ...catalog] : catalog
  return (
    <Select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </Select>
  )
}

function StorageBoxInput({
  index,
  value,
  options,
  onChange,
}: {
  index: number
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <>
      <Input
        list={`ob-storage-boxes-${index}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="BOX-02"
      />
      <datalist id={`ob-storage-boxes-${index}`}>
        {options.map((box) => (
          <option key={box} value={box} />
        ))}
      </datalist>
    </>
  )
}

function OpeningBalanceRow({
  line,
  index,
  type,
  state,
  catalog,
  products,
  onProduct,
  onPatch,
  onDetails,
  onRemove,
}: {
  line: DraftLine
  index: number
  type: OpeningBalanceType
  state: ReturnType<typeof useStore>
  catalog: Product[]
  products: Product[]
  onProduct: (productId: string) => void
  onPatch: (patch: Partial<DraftLine>) => void
  onDetails: () => void
  onRemove: () => void
}) {
  const product = state.products.find((item) => item.id === line.productId) ?? products.find((item) => item.id === line.productId)
  const preview = product && type !== 'production_balance' ? conversionPreview(product, Number(line.qty) || 0, line.unit || product.unit) : null
  return (
    <tr className="cursor-default">
      <td>
        <ProductSelect value={line.productId} catalog={catalog} current={product} onChange={onProduct} />
      </td>
      <td className="text-slate-500">{product?.sku ?? '—'}</td>
      <td>
        <Input
          className="h-9 w-24"
          type="number"
          min={0}
          step="any"
          value={line.qty}
          onChange={(event) => onPatch({ qty: Number(event.target.value) })}
        />
        {preview ? (
          <div className="mt-1 text-[11px] text-slate-500">{formatQty(preview.baseQty)} {preview.unit}</div>
        ) : null}
      </td>
      {type !== 'production_balance' ? (
        <td>
          <Select value={line.unit} onChange={(event) => onPatch({ unit: event.target.value })}>
            {lineUnitOptions(product).map((unit) => (
              <option key={unit} value={unit}>{unit}</option>
            ))}
          </Select>
        </td>
      ) : null}
      {type === 'production_balance' ? (
        <td>
          <StorageBoxInput
            index={index}
            value={line.container ?? ''}
            options={storageBoxOptions(state)}
            onChange={(container) => onPatch({ container })}
          />
        </td>
      ) : (
        <td>
          <Input className="h-9 w-28" value={line.batchNo ?? ''} onChange={(event) => onPatch({ batchNo: event.target.value })} />
        </td>
      )}
      {type !== 'production_balance' ? (
        <td>
          <Input className="h-9 w-36" type="date" value={line.expiry ?? ''} onChange={(event) => onPatch({ expiry: event.target.value })} />
        </td>
      ) : null}
      <td>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="text-xs font-medium text-indigo-600" onClick={onDetails}>
            Details
          </button>
          <Button size="sm" variant="ghost" onClick={onRemove} aria-label="Remove item">
            <Trash2 size={14} />
          </Button>
        </div>
      </td>
    </tr>
  )
}

function LineDetailsModal({
  type,
  line,
  product,
  state,
  index,
  onPatch,
  onClose,
}: {
  type: OpeningBalanceType
  line: DraftLine
  product: Product | undefined
  state: ReturnType<typeof useStore>
  index: number
  onPatch: (patch: Partial<DraftLine>) => void
  onClose: () => void
}) {
  const preview = product && type !== 'production_balance' ? conversionPreview(product, Number(line.qty) || 0, line.unit || product.unit) : null
  return (
    <Modal open onClose={onClose} title="Line details" width="max-w-lg">
      <div className="grid gap-4">
        {product ? (
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <div className="font-medium text-slate-800">{product.name}</div>
            <div>SKU: {product.sku}</div>
            {type !== 'production_balance' ? (
              <>
                <div>Base unit: {formatUnit(product.unit)}</div>
                <div>
                  Purchase unit: {formatUnit(product.purchaseUnit ?? product.unit)}
                  {product.purchaseUnit && product.purchaseUnit !== product.unit
                    ? ` · 1 ${formatUnit(product.purchaseUnit)} = ${product.purchaseConversionQty ?? 1} ${formatUnit(product.unit)}`
                    : ''}
                </div>
                {preview ? <div>{formatQty(Number(line.qty) || 0)} {line.unit} = {formatQty(preview.baseQty)} {preview.unit}</div> : null}
              </>
            ) : (
              <div>{formatQty(Number(line.qty) || 0)} G in {line.container || 'storage box'}</div>
            )}
          </div>
        ) : null}
        <Field label="Warehouse">
          <Select value={line.warehouseId} onChange={(event) => onPatch({ warehouseId: event.target.value })}>
            {companyWarehouses(state.warehouses).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
            ))}
          </Select>
        </Field>
        {type === 'finished_goods' ? (
          <Field label="Physical location">
            <Select
              value={line.locationKind === 'display' ? 'display' : line.locationId || 'inventory'}
              onChange={(event) => {
                const value = event.target.value
                onPatch({
                  locationKind: value === 'display' ? 'display' : value === 'inventory' ? 'inventory' : undefined,
                  locationId: value === 'display' || value === 'inventory' ? '' : value,
                })
              }}
            >
              <option value="inventory">Warehouse inventory (unplaced)</option>
              <option value="display">Display</option>
              {state.storageLocations
                .filter((location) => location.active && location.warehouseId === line.warehouseId && CARTON_STORAGE_TYPES.includes(location.type))
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </Select>
          </Field>
        ) : null}
        {type === 'production_balance' ? (
          <Field label="Storage box">
            <StorageBoxInput
              index={index}
              value={line.container ?? ''}
              options={storageBoxOptions(state)}
              onChange={(container) => onPatch({ container })}
            />
          </Field>
        ) : (
          <>
            <Field label="Batch / lot (optional)">
              <Input value={line.batchNo ?? ''} onChange={(event) => onPatch({ batchNo: event.target.value })} />
            </Field>
            <Field label={product?.trackExpiry ? 'Expiry' : 'Expiry (optional)'}>
              <Input type="date" value={line.expiry ?? ''} onChange={(event) => onPatch({ expiry: event.target.value })} />
            </Field>
          </>
        )}
        <Field label="Notes (optional)">
          <Input value={line.notes ?? ''} onChange={(event) => onPatch({ notes: event.target.value })} />
        </Field>
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  )
}

function OpeningBalanceDetailPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { id } = useParams()
  const { productName, warehouseName } = useLookups()
  const row = (state.openingBalances ?? []).find((item) => item.id === id)
  if (!hasPermission(state, 'opening_balance.view')) return <PermissionDenied title="Opening Balance" />
  if (!row) {
    return (
      <div>
        <PageHeader title="Opening Balance" subtitle="This document was not found." />
        <Button variant="secondary" onClick={() => navigate('/inventory/opening-balance')}>
          Back
        </Button>
      </div>
    )
  }
  return (
    <div>
      <PageHeader
        title={row.documentNo}
        subtitle="Historical initialization. Confirmed documents are locked."
        actions={
          <Button variant="secondary" onClick={() => navigate('/inventory/opening-balance')}>
            Back
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusBadge status={row.status} />
        <Badge>{openingBalanceTypeLabel(row.type)}</Badge>
        <Badge tone="slate">{formatDate(row.date)}</Badge>
      </div>
      <Card className="mb-4 p-5">
        <div className="mb-3 text-sm font-semibold">Lines</div>
        <div className="space-y-2 sm:hidden">
          {row.items.map((line, index) => (
            <div key={index} className="rounded-xl border border-slate-100 p-3 text-sm">
              <div className="font-medium">{productName(line.productId)}</div>
              <div className="text-slate-500">
                +{formatQty(line.baseQty)} {line.unit} · {warehouseName(line.warehouseId)}
                {line.container ? ` · ${line.container}` : ''}
              </div>
            </div>
          ))}
        </div>
        <div className="hidden sf-table-wrap sm:block">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Posted</th>
                <th>Warehouse</th>
                <th>Batch / box</th>
              </tr>
            </thead>
            <tbody>
              {row.items.map((line, index) => (
                <tr key={index} className="cursor-default">
                  <td>{productName(line.productId)}</td>
                  <td className="tabular">
                    {formatQty(line.qty)} {line.unit}
                  </td>
                  <td className="tabular">{formatQty(line.baseQty)}</td>
                  <td>{warehouseName(line.warehouseId)}</td>
                  <td>{line.container || line.batchNo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-sm text-slate-500">Created by: {row.createdByName}</div>
        {row.notes ? <div className="mt-1 text-sm">{row.notes}</div> : null}
      </Card>
      {row.status === 'draft' && hasPermission(state, 'opening_balance.create') ? (
        <Button onClick={() => api.confirmOpeningBalance(row.id)}>Confirm Opening Balance</Button>
      ) : (
        <div className="text-sm text-slate-500">Confirmed opening balance cannot be edited.</div>
      )}
    </div>
  )
}
