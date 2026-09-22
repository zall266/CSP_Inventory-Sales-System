import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button, Card, ConfirmDialog, EmptyState, Field, FilterRow, Input, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui'
import { ProductMark } from '@/components/ProductMark'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { companyWarehouses } from '@/features/agent/agentModel'
import { formatUnit } from '@/features/products/masterData'
import { hasPermission } from '@/features/settings/permissions'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDateTime, formatMoney, formatQty } from '@/utils/format'
import type { PackingAssembly, PackingInput } from '@/types'
import {
  activeBomsForProduct,
  packingBomChanged,
  packingLinesFromSnapshot,
  packingOutputProducts,
  packingWarehouseError,
  validatePackingQuantities,
} from './packingModel'

export function PackingListPage() {
  const state = useStore()
  const navigate = useNavigate()
  const { productName, warehouseName } = useLookups()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const canView = hasPermission(state, 'manufacturing.view')
  const canCreate = hasPermission(state, 'manufacturing.create')
  const rows = useMemo(() => {
    return (state.packingAssemblies ?? [])
      .filter((row) => {
        if (status !== 'all' && row.status !== status) return false
        if (query && !`${row.packingNo} ${productName(row.productId)} ${row.createdBy}`.toLowerCase().includes(query.toLowerCase())) return false
        return true
      })
      .slice()
      .sort((a, b) => (b.confirmedAt ?? b.createdAt).localeCompare(a.confirmedAt ?? a.createdAt))
  }, [state.packingAssemblies, query, status, productName])

  if (!canView) return <PermissionDenied title="Packing / Assembly" />

  return (
    <div>
      <PageHeader
        title="Packing / Assembly"
        subtitle="Convert existing stock into another SKU using an active BOM."
        actions={canCreate ? <Button onClick={() => navigate('/manufacturing/packing/new')}><Plus size={16} /> New Packing / Assembly</Button> : undefined}
      />
      <FilterRow>
        <Input placeholder="Search packing no or product" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <div /><div />
      </FilterRow>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No packing records" hint="Create a packing / assembly to convert existing stock into another SKU." />
        ) : (
          <div className="sf-table-wrap">
            <table className="min-w-[52rem]">
              <thead>
                <tr>
                  <th>Packing No</th>
                  <th>Date</th>
                  <th>Output</th>
                  <th>Planned</th>
                  <th>Actual</th>
                  <th>Warehouse</th>
                  <th>Status</th>
                  <th>Created by</th>
                  <th>Confirmed by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} onClick={() => navigate(`/manufacturing/packing/${row.id}`)}>
                    <td className="font-medium text-indigo-700">{row.packingNo}</td>
                    <td>{formatDateTime(row.confirmedAt ?? row.createdAt)}</td>
                    <td>{productName(row.productId)}</td>
                    <td className="tabular">{formatQty(row.plannedQty)} {formatUnit(row.unit)}</td>
                    <td className="tabular">{formatQty(row.actualQty)} {formatUnit(row.unit)}</td>
                    <td>{warehouseName(row.warehouseId)}</td>
                    <td><StatusBadge status={row.status} /></td>
                    <td>{row.createdBy}</td>
                    <td>{row.confirmedBy || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

export function NewPackingPage() {
  return <PackingEditorPage />
}

export function PackingDetailPage() {
  const { id } = useParams()
  const state = useStore()
  const packing = (state.packingAssemblies ?? []).find((row) => row.id === id)
  if (!hasPermission(state, 'manufacturing.view')) return <PermissionDenied title="Packing / Assembly" />
  if (!packing) {
    return (
      <div>
        <PageHeader title="Packing / Assembly" subtitle="Not found." />
        <Link to="/manufacturing/packing" className="text-sm font-medium text-indigo-700">Back to packing</Link>
      </div>
    )
  }
  if (packing.status === 'draft') return <PackingEditorPage packing={packing} />
  return <PackingReadPage packing={packing} />
}

function PackingEditorPage({ packing }: { packing?: PackingAssembly }) {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const outputs = packingOutputProducts(state)
  const [productId, setProductId] = useState(packing?.productId ?? '')
  const activeBoms = activeBomsForProduct(state.boms, productId)
  const [bomId, setBomId] = useState(packing?.bomId ?? (activeBoms.length === 1 ? activeBoms[0].id : ''))
  const [warehouseId, setWarehouseId] = useState(packing?.warehouseId ?? state.settings.defaultWarehouseId)
  const [plannedQty, setPlannedQty] = useState(packing?.plannedQty ?? 1)
  const [actualQty, setActualQty] = useState(packing?.actualQty ?? packing?.plannedQty ?? 1)
  const [notes, setNotes] = useState(packing?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [changedOpen, setChangedOpen] = useState(false)

  const canCreate = hasPermission(state, 'manufacturing.create')
  const canEdit = hasPermission(state, 'manufacturing.edit')
  const canConfirm = hasPermission(state, 'manufacturing.complete')
  const product = state.products.find((row) => row.id === productId)
  const bom = state.boms.find((row) => row.id === bomId)
  const snapshot = packing && packing.bomId === bomId
    ? packing.bomSnapshot
    : bom
      ? {
          bomId: bom.id,
          name: bom.name,
          outputQty: bom.outputQty,
          outputUnit: bom.outputUnit,
          capturedAt: packing?.bomSnapshot.capturedAt ?? '',
          items: bom.items.map((item) => {
            const component = state.products.find((row) => row.id === item.productId)
            return {
              productId: item.productId,
              productName: component?.name ?? 'Unknown',
              sku: component?.sku ?? '',
              qty: item.qty,
              unit: item.unit,
              wastagePct: item.wastagePct,
              notes: item.notes,
            }
          }),
        }
      : null
  const preview = snapshot && actualQty > 0
    ? packingLinesFromSnapshot(snapshot, actualQty, state.products, state.inventory, warehouseId)
    : null
  const liveChanged = Boolean(packing && bom && packingBomChanged(packing.bomSnapshot, bom))
  const qtyError = product ? validatePackingQuantities(plannedQty, actualQty, product.unit) : 'Select an output product.'
  const warehouseError = packingWarehouseError(state, warehouseId)
  const noActiveBom = Boolean(productId) && activeBoms.length === 0
  const needBomSelect = activeBoms.length > 1 && !bomId
  const shortageBlocked = Boolean(preview?.hasShortage) && !state.settings.allowNegativeStock
  const blockedReason = !productId
    ? 'Select an output product.'
    : noActiveBom
      ? 'This product has no active BOM.'
      : needBomSelect
        ? 'Select a BOM. This product has more than one active BOM.'
        : warehouseError
          ?? qtyError
          ?? preview?.conversionError
          ?? (shortageBlocked
            ? `Insufficient stock for ${preview?.lines.find((line) => line.shortage > 0)?.name ?? 'component'}. Required: ${preview?.lines.find((line) => line.shortage > 0)?.requiredQty}. Available: ${preview?.lines.find((line) => line.shortage > 0)?.onHand}.`
            : null)
  const canSave = packing ? canEdit : canCreate

  useEffect(() => {
    if (!packing) return
    setProductId(packing.productId)
    setBomId(packing.bomId)
    setWarehouseId(packing.warehouseId)
    setPlannedQty(packing.plannedQty)
    setActualQty(packing.actualQty)
    setNotes(packing.notes)
  }, [packing?.id])

  const changeProduct = (id: string) => {
    const next = activeBomsForProduct(state.boms, id)
    setProductId(id)
    setBomId(next.length === 1 ? next[0].id : '')
    const output = next[0]?.outputQty
    if (output && output > 0 && !packing) {
      setPlannedQty(output)
      setActualQty(output)
    }
  }

  const input = (): PackingInput => ({
    productId,
    bomId,
    warehouseId,
    plannedQty,
    actualQty,
    notes,
  })

  const saveDraft = () => {
    if (blockedReason && (noActiveBom || needBomSelect || warehouseError || qtyError || !productId)) {
      return
    }
    setBusy(true)
    const saved = packing ? api.updatePackingAssembly(packing.id, input()) : api.createPackingAssembly(input())
    setBusy(false)
    if (saved) navigate(`/manufacturing/packing/${saved.id}`)
  }

  const confirm = (acceptSnapshot = false) => {
    if (blockedReason) return
    setBusy(true)
    let id = packing?.id
    if (packing) {
      const updated = api.updatePackingAssembly(packing.id, input())
      if (!updated) {
        setBusy(false)
        return
      }
      id = updated.id
    } else {
      const created = api.createPackingAssembly(input())
      if (!created) {
        setBusy(false)
        return
      }
      id = created.id
    }
    const confirmed = api.confirmPackingAssembly(id, { acceptSnapshot })
    setBusy(false)
    setConfirmOpen(false)
    setChangedOpen(false)
    if (confirmed?.posted) navigate(`/manufacturing/packing/${confirmed.id}`)
    else navigate(`/manufacturing/packing/${id}`)
  }

  const startConfirm = () => {
    if (blockedReason) return
    if (liveChanged) {
      setChangedOpen(true)
      return
    }
    setConfirmOpen(true)
  }

  return (
    <div>
      <PageHeader
        title={packing ? packing.packingNo : 'New Packing / Assembly'}
        subtitle="Select an output product, active BOM and actual quantity. Consumption is calculated from actual output."
        actions={<Link to="/manufacturing/packing"><Button variant="secondary">Back</Button></Link>}
      />
      <div className="space-y-4">
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="1. Output product">
            <Select value={productId} onChange={(event) => changeProduct(event.target.value)}>
              <option value="">Select product</option>
              {outputs.map((item) => (
                <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>
              ))}
            </Select>
          </Field>
          <Field label="2. Bill of materials" hint={activeBoms.length > 1 ? 'This product has more than one active BOM. Select one.' : undefined}>
            <Select value={bomId} onChange={(event) => setBomId(event.target.value)} disabled={!productId || activeBoms.length === 0}>
              <option value="">{activeBoms.length > 1 ? 'Select BOM' : 'No active BOM'}</option>
              {activeBoms.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="3. Warehouse">
            <Select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
              {companyWarehouses(state.warehouses).map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="SKU">
            <Input disabled value={product?.sku ?? ''} />
          </Field>
          <Field label="4. Planned quantity">
            <Input
              type="number"
              min={0.01}
              step={product && ['PCS', 'PACKS'].includes(formatUnit(product.unit)) ? 1 : 0.01}
              value={plannedQty}
              onChange={(event) => {
                const next = Number(event.target.value)
                setPlannedQty(next)
                if (actualQty === plannedQty || actualQty > next) setActualQty(next)
              }}
            />
          </Field>
          <Field label="Actual quantity" hint="Consumption uses actual quantity, not planned.">
            <Input
              type="number"
              min={0.01}
              step={product && ['PCS', 'PACKS'].includes(formatUnit(product.unit)) ? 1 : 0.01}
              value={actualQty}
              onChange={(event) => setActualQty(Number(event.target.value))}
            />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </Card>

        {liveChanged && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-semibold">The BOM has changed since this packing was created.</div>
            <p className="mt-1">Refresh the BOM to use the latest recipe, or confirm using the saved snapshot.</p>
            <Button size="sm" variant="secondary" className="mt-3" disabled={busy || !canEdit} onClick={() => packing && api.refreshPackingBom(packing.id)}>
              Refresh BOM
            </Button>
          </div>
        )}

        {blockedReason && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <div className="font-semibold">Cannot confirm</div>
            <p className="mt-1">{blockedReason}</p>
          </div>
        )}

        {preview && (
          <Card className="p-5">
            <div className="mb-3 text-sm font-semibold">5. Review</div>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Mini label="Output" value={`${product?.name ?? '—'} ${formatQty(actualQty)} ${formatUnit(product?.unit)}`} />
              <Mini label="BOM" value={bom?.name ?? packing?.bomSnapshot.name ?? '—'} />
              <Mini label="Warehouse" value={state.warehouses.find((row) => row.id === warehouseId)?.name ?? '—'} />
              <Mini label="Cost estimate" value={formatMoney(preview.costEstimate)} />
            </div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Output</div>
            <p className="mb-4 text-sm">{product?.name} · {product?.sku} · +{formatQty(actualQty)} {formatUnit(product?.unit)}</p>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Consumption</div>
            <div className="sf-table-wrap rounded-xl border border-slate-100">
              <table className="min-w-[40rem]">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Base</th>
                    <th>Wastage</th>
                    <th>Total</th>
                    <th>Consumption</th>
                    <th>On hand</th>
                    <th>After</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((line) => (
                    <tr key={line.productId} className="cursor-default">
                      <td>
                        <div className="font-medium">{line.name}</div>
                        <div className="text-xs text-slate-400">{line.sku}</div>
                        {line.conversionError && <div className="text-xs text-rose-600">{line.conversionError}</div>}
                      </td>
                      <td className="tabular">{formatQty(line.baseQty)} {formatUnit(line.unit)}</td>
                      <td className="tabular">{formatQty(line.wastagePct)}% · {formatQty(line.wastageQty)}</td>
                      <td className="tabular">{formatQty(line.requiredQty)} {formatUnit(line.unit)}</td>
                      <td>{line.consumptionMethod}</td>
                      <td className="tabular">{formatQty(line.onHand)} {formatUnit(line.unit)}</td>
                      <td className={`tabular ${line.shortage > 0 ? 'font-semibold text-rose-600' : ''}`}>{formatQty(line.afterPosting)} {formatUnit(line.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {packing && canEdit && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (api.cancelPackingAssembly(packing.id)) navigate('/manufacturing/packing')
              }}
            >
              Cancel draft
            </Button>
          )}
          <Button variant="secondary" disabled={busy || !canSave} onClick={saveDraft}>Save draft</Button>
          <Button disabled={busy || !canConfirm || Boolean(blockedReason)} onClick={startConfirm}>
            Confirm packing
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirm packing / assembly"
        message={`Post ${formatQty(actualQty)} ${formatUnit(product?.unit)} of ${product?.name ?? 'output'} and consume BOM components in the selected warehouse?`}
        confirmLabel="Confirm"
        confirmDisabled={busy}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => confirm(false)}
      />
      <ConfirmDialog
        open={changedOpen}
        title="BOM has changed"
        message="The BOM has changed since this packing was created. Confirm using the saved snapshot, or cancel and refresh the BOM."
        confirmLabel="Use saved snapshot"
        confirmDisabled={busy}
        onClose={() => setChangedOpen(false)}
        onConfirm={() => confirm(true)}
      />
    </div>
  )
}

function PackingReadPage({ packing }: { packing: PackingAssembly }) {
  const state = useStore()
  const { product, warehouseName } = useLookups()
  const output = product(packing.productId)
  const movements = state.stockMovements.filter((row) => row.reference === packing.packingNo)
  return (
    <div>
      <PageHeader
        title={packing.packingNo}
        subtitle={
          packing.status === 'confirmed'
            ? 'Confirmed packing / assembly. Inventory has been posted and this record is read-only.'
            : 'This packing / assembly was cancelled. No inventory was posted.'
        }
        actions={<Link to="/manufacturing/packing"><Button variant="secondary">Back</Button></Link>}
      />
      <div className="space-y-4">
        <Card className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Mini label="Status" value="" badge={packing.status} />
          <Mini label="Output" value={`${output?.name ?? '—'} · ${output?.sku ?? ''}`} />
          <Mini label="Planned" value={`${formatQty(packing.plannedQty)} ${formatUnit(packing.unit)}`} />
          <Mini label="Actual" value={`${formatQty(packing.actualQty)} ${formatUnit(packing.unit)}`} />
          <Mini label="Warehouse" value={warehouseName(packing.warehouseId)} />
          <Mini label="BOM" value={packing.bomSnapshot.name} />
          <Mini label="Created" value={`${packing.createdBy} · ${formatDateTime(packing.createdAt)}`} />
          <Mini label="Confirmed" value={packing.confirmedBy && packing.confirmedAt ? `${packing.confirmedBy} · ${formatDateTime(packing.confirmedAt)}` : '—'} />
          <Mini label="Cost estimate" value={formatMoney(packing.costEstimate)} />
        </Card>
        {packing.notes && <Card className="p-5 text-sm text-slate-600">{packing.notes}</Card>}
        <Card className="p-5">
          <div className="mb-2 text-sm font-semibold">Output</div>
          <div className="flex items-center gap-2 text-sm">
            {output && <ProductMark product={output} size="sm" />}
            <span>{output?.name} · +{formatQty(packing.actualQty)} {formatUnit(packing.unit)}</span>
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-2 text-sm font-semibold">BOM snapshot</div>
          <p className="mb-3 text-xs text-slate-500">{packing.bomSnapshot.name} · output {formatQty(packing.bomSnapshot.outputQty)} {formatUnit(packing.bomSnapshot.outputUnit)} · captured {formatDateTime(packing.bomSnapshot.capturedAt)}</p>
          <div className="sf-table-wrap rounded-xl border border-slate-100">
            <table className="min-w-[36rem]">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>SKU</th>
                  <th>BOM qty</th>
                  <th>Wastage</th>
                  <th>Consumed</th>
                  <th>Consumption</th>
                </tr>
              </thead>
              <tbody>
                {packing.consumptions.map((line) => {
                  const snapshot = packing.bomSnapshot.items.find((item) => item.productId === line.productId)
                  return (
                    <tr key={line.productId} className="cursor-default">
                      <td>{snapshot?.productName ?? product(line.productId)?.name}</td>
                      <td>{snapshot?.sku ?? product(line.productId)?.sku}</td>
                      <td className="tabular">{formatQty(snapshot?.qty ?? 0)} {formatUnit(snapshot?.unit ?? line.bomUnit)}</td>
                      <td className="tabular">{formatQty(line.wastagePct)}% · {formatQty(line.wastageQty)} {formatUnit(line.unit)}</td>
                      <td className="tabular">{formatQty(line.actualQty)} {formatUnit(line.unit)}</td>
                      <td>{snapshot?.consumptionMethod ?? 'AUTO'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-2 text-sm font-semibold">Inventory movements</div>
          {movements.length === 0 ? (
            <p className="text-sm text-slate-500">No movements found for {packing.packingNo}.</p>
          ) : (
            <div className="sf-table-wrap rounded-xl border border-slate-100">
              <table className="min-w-[36rem]">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Product</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>User</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((row) => (
                    <tr key={row.id} className="cursor-default">
                      <td>{row.type}</td>
                      <td>{product(row.productId)?.name}</td>
                      <td className="tabular">{row.stockIn ? formatQty(row.stockIn) : '—'}</td>
                      <td className="tabular">{row.stockOut ? formatQty(row.stockOut) : '—'}</td>
                      <td>{row.user}</td>
                      <td>{formatDateTime(row.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function Mini({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">
        {badge ? <StatusBadge status={badge} /> : value}
      </div>
    </div>
  )
}
