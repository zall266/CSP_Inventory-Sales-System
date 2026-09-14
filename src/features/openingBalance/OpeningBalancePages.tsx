import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Field, FilterRow, Input, PageHeader, Select, StatusBadge } from '@/components/ui'
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
import type { OpeningBalance, OpeningBalanceInput, OpeningBalanceType } from '@/types'

function itemPool(state: ReturnType<typeof useStore>, type: OpeningBalanceType) {
  if (type === 'finished_goods') return finishedGoodsProducts(state)
  if (type === 'production_balance') return productionBalanceProducts(state)
  return stockItemProducts(state)
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
  const { productName, warehouseName, categoryName } = useLookups()
  const canView = hasPermission(state, 'opening_balance.view')
  const canCreate = hasPermission(state, 'opening_balance.create')
  const [type, setType] = useState<OpeningBalanceType>(draft?.type ?? 'stock_item')
  const [warehouseId, setWarehouseId] = useState(draft?.items[0]?.warehouseId ?? state.settings.defaultWarehouseId)
  const [notes, setNotes] = useState(draft?.notes ?? '')
  const products = itemPool(state, type)
  const [lines, setLines] = useState<OpeningBalanceInput['items']>(
    draft ? inputLinesFromOpeningBalance(draft) : [emptyOpeningLine(type, products[0], warehouseId)],
  )
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

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
    setLines([emptyOpeningLine(next, pool[0], warehouseId)])
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
            <Field label="Default warehouse">
              <Select
                value={warehouseId}
                onChange={(event) => {
                  setWarehouseId(event.target.value)
                  setLines(lines.map((line) => ({ ...line, warehouseId: event.target.value })))
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
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Lines</div>
            <Button size="sm" variant="secondary" onClick={() => setLines([...lines, emptyOpeningLine(type, products[0], warehouseId)])}>
              <Plus size={14} /> Add item
            </Button>
          </div>
          <div className="space-y-3">
            {lines.map((line, index) => {
              const product = state.products.find((item) => item.id === line.productId)
              const preview = product && type !== 'production_balance' ? conversionPreview(product, Number(line.qty) || 0, line.unit || product.unit) : null
              return (
                <div key={index} className="space-y-3 rounded-xl border border-slate-100 p-3">
                  <Field label={type === 'finished_goods' ? 'Finished product' : type === 'production_balance' ? 'Product' : 'Item'}>
                    <Select
                      value={line.productId}
                      onChange={(event) => {
                        const next = state.products.find((item) => item.id === event.target.value)
                        setLines(
                          lines.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  productId: event.target.value,
                                  unit: type === 'production_balance' ? 'G' : next?.purchaseUnit || next?.unit || item.unit,
                                }
                              : item,
                          ),
                        )
                      }}
                    >
                      {products.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.sku}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {product && type !== 'production_balance' ? (
                    <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                      <div>SKU: {product.sku}</div>
                      <div>Category: {categoryName(product.categoryId)}</div>
                      <div>Base unit: {formatUnit(product.unit)}</div>
                      <div>
                        Purchase unit: {formatUnit(product.purchaseUnit ?? product.unit)}
                        {product.purchaseUnit && product.purchaseUnit !== product.unit
                          ? ` · 1 ${formatUnit(product.purchaseUnit)} = ${product.purchaseConversionQty ?? 1} ${formatUnit(product.unit)}`
                          : ''}
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={type === 'production_balance' ? 'Balance quantity (GRAM)' : 'Quantity'}>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={line.qty}
                        onChange={(event) => setLines(lines.map((item, i) => (i === index ? { ...item, qty: Number(event.target.value) } : item)))}
                      />
                    </Field>
                    {type === 'production_balance' ? (
                      <Field label="Unit">
                        <Input value="G" readOnly />
                      </Field>
                    ) : (
                      <Field label="Unit">
                        <Select
                          value={line.unit}
                          onChange={(event) => setLines(lines.map((item, i) => (i === index ? { ...item, unit: event.target.value } : item)))}
                        >
                          {lineUnitOptions(product).map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    )}
                    <Field label="Warehouse">
                      <Select
                        value={line.warehouseId}
                        onChange={(event) => setLines(lines.map((item, i) => (i === index ? { ...item, warehouseId: event.target.value } : item)))}
                      >
                        {companyWarehouses(state.warehouses).map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>
                            {warehouse.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {type === 'production_balance' ? (
                      <Field label="Storage box">
                        <Input
                          list={`ob-storage-boxes-${index}`}
                          value={line.container ?? ''}
                          onChange={(event) => setLines(lines.map((item, i) => (i === index ? { ...item, container: event.target.value } : item)))}
                          placeholder="BOX-02"
                        />
                        <datalist id={`ob-storage-boxes-${index}`}>
                          {storageBoxOptions(state).map((box) => (
                            <option key={box} value={box} />
                          ))}
                        </datalist>
                      </Field>
                    ) : (
                      <Field label="Batch / lot (optional)">
                        <Input
                          value={line.batchNo ?? ''}
                          onChange={(event) => setLines(lines.map((item, i) => (i === index ? { ...item, batchNo: event.target.value } : item)))}
                        />
                      </Field>
                    )}
                    {type !== 'production_balance' ? (
                      <Field label={product?.trackExpiry ? 'Expiry' : 'Expiry (optional)'}>
                        <Input
                          type="date"
                          value={line.expiry ?? ''}
                          onChange={(event) => setLines(lines.map((item, i) => (i === index ? { ...item, expiry: event.target.value } : item)))}
                        />
                      </Field>
                    ) : null}
                    {type === 'finished_goods' ? (
                      <Field label="Physical location">
                        <Select
                          value={line.locationKind === 'display' ? 'display' : line.locationId || 'inventory'}
                          onChange={(event) => {
                            const value = event.target.value
                            setLines(
                              lines.map((item, i) =>
                                i === index
                                  ? {
                                      ...item,
                                      locationKind: value === 'display' ? 'display' : value === 'inventory' ? 'inventory' : undefined,
                                      locationId: value === 'display' || value === 'inventory' ? '' : value,
                                    }
                                  : item,
                              ),
                            )
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
                    <Field label="Notes (optional)">
                      <Input
                        value={line.notes ?? ''}
                        onChange={(event) => setLines(lines.map((item, i) => (i === index ? { ...item, notes: event.target.value } : item)))}
                      />
                    </Field>
                  </div>
                  {preview ? (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      Opening balance {formatQty(Number(line.qty) || 0)} {line.unit} = {formatQty(preview.baseQty)} {preview.unit}. Inventory posted: +{formatQty(preview.baseQty)} {preview.unit}
                    </div>
                  ) : type === 'production_balance' ? (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      {formatQty(Number(line.qty) || 0)} G in {line.container || 'storage box'}
                    </div>
                  ) : null}
                  <button type="button" className="text-xs text-rose-600" onClick={() => setLines(lines.filter((_, i) => i !== index))}>
                    <Trash2 size={12} className="inline" /> Remove item
                  </button>
                </div>
              )
            })}
          </div>
          <Card className="mt-4 bg-slate-50 p-4">
            <div className="text-sm font-semibold">Opening Balance Summary</div>
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
            <div className="mt-2 text-xs text-slate-500">Total lines: {lines.length}</div>
          </Card>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" className="w-full sm:w-auto" disabled={busy} onClick={() => submit(false)}>
              Save draft
            </Button>
            <Button className="w-full sm:w-auto" disabled={busy} onClick={() => submit(true)}>
              Confirm opening balance
            </Button>
          </div>
        </Card>
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
        <Button onClick={() => api.confirmOpeningBalance(row.id)}>Confirm opening balance</Button>
      ) : (
        <div className="text-sm text-slate-500">Confirmed opening balance cannot be edited.</div>
      )}
    </div>
  )
}
