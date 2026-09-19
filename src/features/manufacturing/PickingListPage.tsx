import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Field, Input, Modal, PageHeader, Select, StatusBadge } from '@/components/ui'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatQty } from '@/utils/format'
import { formatUnit, qtyToBaseUnit } from '@/features/products/masterData'
import type { PickingLine } from '@/types'
import {
  additionalRequiredPick,
  allocationLabel,
  allocationsForProduct,
  conversionNote,
  sessionAllocatedQty,
} from './materialClosing'
import { currentUser, isRawStorePickingLine, suggestPurchasePick, systemProductionDate, todayOperationalSession } from './sessionPlan'

const LOOSE_CONTAINERS = ['TONG', 'BIN', 'CONTAINER', 'OTHER']

/** Presentation grouping only. Does not change stored picking order or quantities. */
export function groupPickingListForDisplay(picking: PickingLine[]) {
  return {
    fresh: picking.filter((line) => line.kind !== 'balance'),
    balance: picking.filter((line) => line.kind === 'balance'),
  }
}

export function PickingListPage() {
  const state = useStore()
  const api = useApi()
  const { product } = useLookups()
  const user = currentUser(state)
  const session = todayOperationalSession(state.productionSessions)
    ?? (state.productionSessions.find((item) => item.status === 'in_progress' && item.productionDate === systemProductionDate()))

  const [addOpen, setAddOpen] = useState(false)
  const [addMode, setAddMode] = useState<'purchase' | 'loose'>('purchase')
  const [addProductId, setAddProductId] = useState('')
  const [purchaseQty, setPurchaseQty] = useState(1)
  const [looseQty, setLooseQty] = useState('')
  const [containerType, setContainerType] = useState('TONG')

  const rawMaterials = useMemo(() => {
    if (!session) return []
    const seen = new Set<string>()
    return session.picking.filter((line) => {
      if (!isRawStorePickingLine(line) || seen.has(line.productId)) return false
      seen.add(line.productId)
      return true
    })
  }, [session])

  if (!session) {
    return (
      <div>
        <PageHeader title="Picking List" subtitle="No production session found." />
      </div>
    )
  }

  const locked = session.status !== 'in_progress'
  const picked = session.picking.filter((line) => line.picked).length
  const { fresh: freshLines, balance: balanceLines } = groupPickingListForDisplay(session.picking)
  const freshPicked = freshLines.filter((line) => line.picked).length
  const balancePicked = balanceLines.filter((line) => line.picked).length
  const defaultMaterial = addProductId || rawMaterials[0]?.productId || ''

  const openAdd = (mode: 'purchase' | 'loose') => {
    setAddMode(mode)
    setAddProductId(rawMaterials[0]?.productId || '')
    setPurchaseQty(1)
    setLooseQty('')
    setContainerType('TONG')
    setAddOpen(true)
  }

  const submitAdd = () => {
    const ok = api.addSessionMaterial(session.id, {
      productId: defaultMaterial,
      mode: addMode,
      purchaseQty: addMode === 'purchase' ? purchaseQty : undefined,
      looseQty: addMode === 'loose' ? Number(looseQty) : undefined,
      containerType: addMode === 'loose' ? containerType : undefined,
    })
    if (ok) setAddOpen(false)
  }

  const addProduct = product(defaultMaterial)
  const addNote = conversionNote(addProduct)
  const addBase = addProduct && addMode === 'purchase'
    ? qtyToBaseUnit(purchaseQty, addProduct.purchaseUnit || addProduct.unit, addProduct) ?? purchaseQty
    : Number(looseQty)

  const renderLine = (line: PickingLine) => {
    const p = product(line.productId)
    const rawStore = isRawStorePickingLine(line)
    const note = rawStore ? conversionNote(p) : ''
    const suggestion = rawStore ? suggestPurchasePick(p, line.requiredQty) : null
    const allocated = rawStore ? sessionAllocatedQty(session, p, line.productId) ?? 0 : 0
    const extra = rawStore && p ? additionalRequiredPick(session, p, line.productId, line.requiredQty) : null
    const rows = rawStore ? allocationsForProduct(session, line.productId) : []
    return (
      <Card key={line.id} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">{line.label}</div>
            <div className="mt-1 text-xs uppercase tracking-wide text-slate-400">{line.kind === 'balance' ? 'Production balance' : rawStore ? 'Raw material store' : 'Pick'}</div>
          </div>
          {line.picked ? <StatusBadge status="picked" /> : <StatusBadge status="pending" />}
        </div>
        {rawStore ? (
          <div className="mt-3 space-y-2 text-sm">
            <div>Required: <span className="tabular font-medium">{formatQty(line.requiredQty)} {formatUnit(p?.unit || line.unit)}</span></div>
            <div>
              Pick: <span className="tabular font-semibold">{formatQty(line.qtyToPick)} {formatUnit(line.unit)}</span>
              {suggestion && suggestion.note ? (
                <span className="ml-2 text-slate-500">({formatQty(suggestion.baseQty)} {suggestion.baseUnit})</span>
              ) : null}
            </div>
            {allocated > 0 && (
              <div>
                Allocated: <span className="tabular font-semibold">{formatQty(allocated)} {formatUnit(p?.unit)}</span>
                <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                  {rows.map((row) => (
                    <div key={row.id}>{allocationLabel(row)} · {row.source}</div>
                  ))}
                </div>
              </div>
            )}
            {extra && extra.shortfall > 0 && allocated > 0 && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                Current BOM: {formatQty(line.requiredQty)} {formatUnit(p?.unit)}. Already allocated: {formatQty(extra.allocated)} {formatUnit(p?.unit)}.
                Additional requirement: {formatQty(extra.shortfall)} {formatUnit(p?.unit)}
                {extra.purchaseQty > 0 ? ` · Suggested +${formatQty(extra.purchaseQty)} ${extra.purchaseUnit}` : ''}
              </div>
            )}
            {note ? <p className="text-xs text-slate-500">ⓘ {note}</p> : null}
            {line.previousPickedQty != null && line.previousPickedQty !== line.qtyToPick && (
              <div className="text-amber-700">Previously picked {formatQty(line.previousPickedQty)} {line.unit} · suggestion is now {formatQty(line.qtyToPick)} {line.unit}</div>
            )}
            <div className="text-xs text-slate-400">Source: {line.source} · {p?.sku}</div>
          </div>
        ) : (
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>Required: <span className="tabular font-medium">{formatQty(line.requiredQty)} {line.unit}</span></div>
            <div>Existing balance: <span className="tabular font-medium">{line.existingBalanceQty ? `${formatQty(line.existingBalanceQty)} ${line.unit}` : '—'}</span></div>
            <div>Fresh: <span className="tabular font-medium">{formatQty(line.freshQty)} {line.unit}</span></div>
            <div>Pick: <span className="tabular font-semibold">{formatQty(line.qtyToPick)} {line.unit}</span></div>
            {line.previousPickedQty != null && line.previousPickedQty !== line.qtyToPick && (
              <div className="sm:col-span-2 text-amber-700">Previously picked {formatQty(line.previousPickedQty)} {line.unit} · difference {formatQty(line.qtyToPick - line.previousPickedQty)} {line.unit}</div>
            )}
            <div>Source: {line.source}</div>
            <div>Location: {line.location}</div>
            <div>Box: {line.container || '—'}</div>
            <div>{p?.sku}</div>
          </div>
        )}
        {!locked && (
          <Button className="mt-4" size="sm" variant={line.picked ? 'secondary' : 'primary'} onClick={() => api.togglePickingLine(session.id, line.id)}>
            {line.picked ? 'Undo picked' : 'Mark picked'}
          </Button>
        )}
      </Card>
    )
  }

  return (
    <div>
      <PageHeader
        title="Picking List"
        subtitle={`${session.reference} · Collect fresh materials from the Store first, then Production Balance from Storage Box.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/manufacturing/today"><Button variant="secondary">Today's production</Button></Link>
            {session.status === 'in_progress' && !locked && (
              <>
                <Button variant="secondary" onClick={() => openAdd('purchase')}>+ Add Material</Button>
                <Button variant="secondary" onClick={() => openAdd('loose')}>+ Add Loose</Button>
              </>
            )}
            {session.status === 'in_progress' && <Link to={`/manufacturing/complete/${session.id}`}><Button>Complete production</Button></Link>}
          </div>
        }
      />
      <div className="mb-4 text-sm text-slate-500">{picked} / {session.picking.length} lines picked · viewing as {user.name}</div>
      {!session.picking.length && (
        <Card className="p-6 text-sm text-slate-500">Start production to generate the consolidated picking list.</Card>
      )}
      {session.picking.length > 0 && (
        <div className="space-y-8">
          <PickingSection
            title="Fresh Materials"
            description="Collect all fresh materials from the Store first."
            progress={`${freshPicked} / ${freshLines.length} picked`}
          >
            {freshLines.length ? freshLines.map(renderLine) : (
              <Card className="p-5 text-sm text-slate-500">No fresh materials to collect.</Card>
            )}
          </PickingSection>
          <PickingSection
            title="Production Balance"
            description="After fresh materials are collected, go to Storage Box."
            progress={`${balancePicked} / ${balanceLines.length} picked`}
          >
            {balanceLines.length ? balanceLines.map(renderLine) : (
              <Card className="p-5 text-sm text-slate-500">No production balance to collect.</Card>
            )}
          </PickingSection>
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={addMode === 'loose' ? 'Add Loose Material' : 'Add Material'} width="max-w-md">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant={addMode === 'purchase' ? 'primary' : 'secondary'} onClick={() => setAddMode('purchase')}>Full purchase unit</Button>
            <Button size="sm" variant={addMode === 'loose' ? 'primary' : 'secondary'} onClick={() => setAddMode('loose')}>Loose</Button>
          </div>
          <Field label="Material">
            <Select value={defaultMaterial} onChange={(e) => setAddProductId(e.target.value)}>
              {rawMaterials.map((line) => (
                <option key={line.productId} value={line.productId}>{product(line.productId)?.name ?? line.label}</option>
              ))}
            </Select>
          </Field>
          {addMode === 'purchase' ? (
            <>
              <Field label={`Quantity (${formatUnit(addProduct?.purchaseUnit || addProduct?.unit)})`}>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="secondary" onClick={() => setPurchaseQty(Math.max(1, purchaseQty - 1))}>−</Button>
                  <Input className="text-center" type="number" min={1} value={purchaseQty} onChange={(e) => setPurchaseQty(Math.max(1, Number(e.target.value) || 1))} />
                  <Button type="button" variant="secondary" onClick={() => setPurchaseQty(purchaseQty + 1)}>+</Button>
                </div>
              </Field>
              {addNote ? <p className="text-xs text-slate-500">Conversion: {addNote}</p> : null}
              {addProduct && Number.isFinite(addBase) ? (
                <p className="text-sm text-slate-600">Adds {formatQty(addBase)} {formatUnit(addProduct.unit)} to this session.</p>
              ) : null}
            </>
          ) : (
            <>
              <Field label="Container">
                <Select value={containerType} onChange={(e) => setContainerType(e.target.value)}>
                  {LOOSE_CONTAINERS.map((row) => <option key={row} value={row}>{row}</option>)}
                </Select>
              </Field>
              <Field label={`Quantity (${formatUnit(addProduct?.unit)})`}>
                <Input type="number" min={0} value={looseQty} onChange={(e) => setLooseQty(e.target.value)} />
              </Field>
              <p className="text-xs text-slate-500">Loose quantity is the physical amount in the base unit. A tong is not a fixed conversion.</p>
            </>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={submitAdd} disabled={addMode === 'loose' ? looseQty === '' : purchaseQty <= 0}>Add</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function PickingSection({
  title,
  description,
  progress,
  children,
}: {
  title: string
  description: string
  progress: string
  children: ReactNode
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
        <p className="mt-1 text-xs text-slate-400">{progress}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
