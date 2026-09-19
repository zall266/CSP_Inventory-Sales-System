import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Card, Checkbox, ConfirmDialog, Field, Input, PageHeader, Select, Textarea } from '@/components/ui'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatQty, round2 } from '@/utils/format'
import { formatUnit } from '@/features/products/masterData'
import type { ShortProductionReason } from '@/types'
import { canEditSession, currentUser, isSessionOperationalToday, sessionTotals, systemProductionDate } from './sessionPlan'
import { isActiveBalanceStorageBox, storageBoxSelectOptions } from '@/features/warehouse/warehouseModel'
import {
  buildSessionMaterialClosing,
  closingLineFromInput,
  conversionNote,
  expectedRemainingQty,
  isSignificantVariance,
  plannedClosingMaterials,
  usesPurchaseUnitSplit,
  varianceLabel,
} from './materialClosing'

const SHORT_REASONS: ShortProductionReason[] = [
  'Material Shortage',
  'Production Loss',
  'Machine Issue',
  'Quality Issue',
  'Packaging Issue',
  'Other',
]

export function CompleteProductionPage() {
  const { id } = useParams()
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { product } = useLookups()
  const user = currentUser(state)
  const today = systemProductionDate()
  const session = state.productionSessions.find((item) => item.id === (id ?? ''))
    ?? state.productionSessions.find((item) => item.status === 'in_progress' && item.productionDate === today)

  const [step, setStep] = useState<1 | 2>(1)
  const [results, setResults] = useState(() =>
    (session?.items ?? []).map((item) => {
      const actualQty = item.actualQty || item.targetQty
      const displayQty = item.displayQty || 0
      return {
        productId: item.productId,
        actualQty,
        productionBalanceQty: item.productionBalanceQty || 0,
        balanceLocation: item.balanceLocation || 'Main Warehouse',
        balanceContainer: item.balanceContainer,
        wasteQty: item.wasteQty || 0,
        shortProductionReason: item.shortProductionReason,
        notes: item.notes,
        displayQty,
        cartonQty: item.cartonQty || Math.max(0, actualQty - displayQty),
      }
    }),
  )
  const drafts = session ? plannedClosingMaterials(state, session) : []
  const [closingInputs, setClosingInputs] = useState<Record<string, { fullUnits: string; looseQty: string }>>(() =>
    Object.fromEntries(drafts.map((row) => [row.productId, { fullUnits: '', looseQty: '' }])),
  )
  const [acknowledged, setAcknowledged] = useState(false)
  const [confirm, setConfirm] = useState(false)

  if (!session) {
    return <PageHeader title="Complete production" subtitle="No session found." />
  }
  if (!isSessionOperationalToday(session, today)) {
    return (
      <div>
        <PageHeader title="Complete production" subtitle={`${session.reference} is not today's production.`} />
        <Link to="/manufacturing/history"><Button>Production History</Button></Link>
      </div>
    )
  }
  if (session.status !== 'in_progress') {
    return (
      <div>
        <PageHeader title="Complete production" subtitle={`${session.reference} is not in progress.`} />
        <Link to="/manufacturing/today"><Button>Today's production</Button></Link>
      </div>
    )
  }
  if (!canEditSession(user.role, session.status)) {
    return <PageHeader title="Permission denied" subtitle="You cannot complete this session." />
  }

  const planned = session.items.reduce((sum, item) => sum + item.targetQty, 0)
  const actual = results.reduce((sum, row) => sum + row.actualQty, 0)
  const balance = results.reduce((sum, row) => sum + row.productionBalanceQty, 0)
  const waste = results.reduce((sum, row) => sum + row.wasteQty, 0)
  const displayTotal = results.reduce((sum, row) => sum + row.displayQty, 0)
  const cartonTotal = results.reduce((sum, row) => sum + row.cartonQty, 0)
  const totals = sessionTotals(session)
  const distributionInvalid = results.some((row) => round2(row.displayQty + row.cartonQty) !== round2(row.actualQty))

  const goNext = () => {
    for (const item of session.items) {
      const result = results.find((row) => row.productId === item.productId)
      if (!result || result.actualQty < 0) {
        api.toast('Enter actual quantity for every product', undefined, 'warning')
        return
      }
      if (result.productionBalanceQty > 0 && (!result.balanceLocation || !result.balanceContainer)) {
        api.toast('Storage and box required', 'Production balance must have a location and container.', 'warning')
        return
      }
      if (result.productionBalanceQty > 0 && !isActiveBalanceStorageBox(state, session.warehouseId, result.balanceContainer)) {
        api.toast('Select a valid Storage Box', 'Production balance must use an active Warehouse Map storage box.', 'warning')
        return
      }
      if (result.actualQty < item.targetQty && !result.shortProductionReason) {
        api.toast('Select a reason', `${product(item.productId)?.name} is below target.`, 'warning')
        return
      }
    }
    if (distributionInvalid) {
      api.toast('Distribution must equal actual', 'Display + Carton must equal Actual Produced for every product.', 'warning')
      return
    }
    setStep(2)
  }

  const parsedInputs = drafts.map((row) => {
    const input = closingInputs[row.productId] ?? { fullUnits: '', looseQty: '' }
    const p = product(row.productId)
    const split = usesPurchaseUnitSplit(p)
    return {
      productId: row.productId,
      fullUnits: split ? Number(input.fullUnits) : 0,
      looseQty: Number(input.looseQty),
      filled: split ? input.fullUnits !== '' && input.looseQty !== '' : input.looseQty !== '',
    }
  })
  const closingReady = parsedInputs.every((row) => row.filled) && parsedInputs.length === drafts.length
  const closingPreview = closingReady
    ? buildSessionMaterialClosing(state, session, parsedInputs.map((row) => ({ productId: row.productId, fullUnits: row.fullUnits, looseQty: row.looseQty })))
    : { ok: false as const, reason: 'Enter remaining quantity for every material.' }

  const openReview = () => {
    if (!acknowledged) {
      api.toast('Acknowledge the physical check', 'Tick the material balance acknowledgement before completing.', 'warning')
      return
    }
    if (!closingPreview.ok) {
      api.toast('Finish Material Closing Check', closingPreview.reason, 'warning')
      return
    }
    setConfirm(true)
  }

  const submit = () => {
    if (!closingPreview.ok) return
    const ok = api.completeSession(session.id, results, {
      acknowledged: true,
      inputs: parsedInputs.map((row) => ({ productId: row.productId, fullUnits: row.fullUnits, looseQty: row.looseQty })),
    })
    if (ok) {
      setConfirm(false)
      navigate(`/manufacturing/history/${session.id}`)
    }
  }

  return (
    <div>
      <PageHeader
        title="Complete production"
        subtitle={`${session.reference} · ${formatDate(session.productionDate + 'T00:00:00+08:00')} · Today · ${step === 1 ? 'Step 1 of 2 · Production Result' : 'Step 2 of 2 · Material Closing Check'}`}
        actions={<Link to="/manufacturing/today"><Button variant="secondary">Back to today</Button></Link>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide">
        <span className={step === 1 ? 'rounded-full bg-indigo-600 px-3 py-1 text-white' : 'rounded-full bg-slate-100 px-3 py-1 text-slate-500'}>Step 1 of 2</span>
        <span className="text-slate-300">→</span>
        <span className={step === 2 ? 'rounded-full bg-indigo-600 px-3 py-1 text-white' : 'rounded-full bg-slate-100 px-3 py-1 text-slate-500'}>Step 2 of 2</span>
      </div>

      {step === 1 && (
        <>
          <p className="mb-4 text-sm text-slate-600">
            Production Result: actual packs, leftover processed bulk, storage box, and packaging waste. Material remaining is checked in the next step.
          </p>
          <div className="space-y-4">
            {session.items.map((item) => {
              const p = product(item.productId)
              const row = results.find((r) => r.productId === item.productId)!
              const setRow = (patch: Partial<typeof row>) =>
                setResults(results.map((r) => (r.productId === item.productId ? { ...r, ...patch } : r)))
              return (
                <Card key={item.id} className="p-5">
                  <div className="mb-3 text-base font-semibold">{p?.name}</div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Target"><Input disabled value={`${item.targetQty} packs`} /></Field>
                    <Field label="Actual Finished Packs">
                      <Input
                        type="number"
                        min={0}
                        value={row.actualQty}
                        onChange={(e) => {
                          const actualQty = Number(e.target.value)
                          setRow({ actualQty, cartonQty: Math.max(0, actualQty - row.displayQty) })
                        }}
                      />
                    </Field>
                    <Field label="Production balance (g)">
                      <Input type="number" min={0} value={row.productionBalanceQty} onChange={(e) => setRow({ productionBalanceQty: Number(e.target.value) })} />
                    </Field>
                    <Field label="Storage">
                      <Input value={row.balanceLocation} onChange={(e) => setRow({ balanceLocation: e.target.value })} />
                    </Field>
                    <Field label="Storage Box">
                      <Select value={row.balanceContainer} onChange={(e) => setRow({ balanceContainer: e.target.value })}>
                        <option value="">Select box</option>
                        {storageBoxSelectOptions(state, session.warehouseId, row.balanceContainer).map((box) => (
                          <option key={box} value={box}>{box}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Packaging waste (g)">
                      <Input type="number" min={0} value={row.wasteQty} onChange={(e) => setRow({ wasteQty: Number(e.target.value) })} />
                    </Field>
                    {row.actualQty < item.targetQty && (
                      <Field label="Reason actual below target" className="sm:col-span-2">
                        <Select value={row.shortProductionReason} onChange={(e) => setRow({ shortProductionReason: e.target.value })}>
                          <option value="">Select reason</option>
                          {SHORT_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                        </Select>
                      </Field>
                    )}
                    <Field label="Notes" className="sm:col-span-2 lg:col-span-3">
                      <Textarea rows={2} value={row.notes} onChange={(e) => setRow({ notes: e.target.value })} />
                    </Field>
                  </div>
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 text-sm font-semibold text-slate-900">Finished Goods Distribution</div>
                    <p className="mb-3 text-xs text-slate-500">
                      Display is loose stock. Carton quantity stays in Ready to Place for CTN Rack or Pallet.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="Actual produced">
                        <div className="flex h-10 items-center text-sm font-medium tabular">{formatQty(row.actualQty)} PACK</div>
                      </Field>
                      <Field label="Display / Loose">
                        <Input
                          type="number"
                          min={0}
                          value={row.displayQty}
                          onChange={(e) => {
                            const displayQty = Number(e.target.value)
                            setRow({ displayQty, cartonQty: Math.max(0, row.actualQty - displayQty) })
                          }}
                        />
                      </Field>
                      <Field label="Carton / Warehouse">
                        <Input type="number" min={0} value={row.cartonQty} onChange={(e) => setRow({ cartonQty: Number(e.target.value) })} />
                      </Field>
                      <Field label="Total distributed">
                        <div className={`flex h-10 items-center text-sm font-medium tabular ${round2(row.displayQty + row.cartonQty) === round2(row.actualQty) ? 'text-slate-900' : 'text-rose-600'}`}>
                          {formatQty(row.displayQty + row.cartonQty)} PACK
                        </div>
                      </Field>
                    </div>
                    {round2(row.displayQty + row.cartonQty) !== round2(row.actualQty) && (
                      <p className="mt-2 text-sm text-rose-600">
                        Display {formatQty(row.displayQty)} + Carton {formatQty(row.cartonQty)} must equal Actual {formatQty(row.actualQty)} PACK.
                      </p>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Link to="/manufacturing/today" className="w-full sm:w-auto"><Button variant="secondary" className="w-full">Cancel</Button></Link>
            <Button className="w-full sm:w-auto" onClick={goNext} disabled={distributionInvalid}>Next</Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <Card className="p-5">
            <div className="text-base font-semibold">Material Closing Check</div>
            <p className="mt-1 text-sm text-slate-600">
              Check the physical material remaining after today's production. The system calculates actual usage automatically.
              Material allocated to this production session, not current warehouse stock.
            </p>
            <p className="mt-2 text-sm text-slate-500">If the result looks wrong, recheck the physical balance and edit the value.</p>
            <div className="mt-4 space-y-4">
              {drafts.map((draft) => {
                const p = product(draft.productId)
                const split = usesPurchaseUnitSplit(p)
                const input = closingInputs[draft.productId] ?? { fullUnits: '', looseQty: '' }
                const setInput = (patch: Partial<typeof input>) =>
                  setClosingInputs((current) => ({ ...current, [draft.productId]: { ...input, ...patch } }))
                const parsed = parsedInputs.find((row) => row.productId === draft.productId)
                const live = parsed?.filled && p
                  ? closingLineFromInput(p, draft.plannedQty, draft.availableQty, { fullUnits: parsed.fullUnits, looseQty: parsed.looseQty })
                  : undefined
                const expected = expectedRemainingQty(draft.availableQty, draft.plannedQty)
                const note = conversionNote(p)
                const line = live && live.ok ? live.line : undefined
                const significant = line ? isSignificantVariance(line) : false
                return (
                  <div key={draft.productId} className="rounded-xl border border-slate-200 p-4">
                    <div className="text-sm font-semibold text-slate-900">{p?.name}</div>
                    <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                      <div className="text-slate-600">Allocated: <span className="font-medium tabular text-slate-900">{formatQty(draft.availableQty)} {formatUnit(draft.unit)}</span></div>
                      <div className="text-slate-600">Planned Usage: <span className="font-medium tabular text-slate-900">{formatQty(draft.plannedQty)} {formatUnit(draft.unit)}</span></div>
                      <div className="text-slate-600 sm:col-span-2">Expected Remaining: <span className="font-medium tabular text-slate-900">{formatQty(expected)} {formatUnit(draft.unit)}</span></div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {split ? (
                        <>
                          <Field label={`Full ${formatUnit(p?.purchaseUnit)}`}>
                            <Input
                              type="number"
                              min={0}
                              value={input.fullUnits}
                              onChange={(e) => setInput({ fullUnits: e.target.value })}
                            />
                          </Field>
                          <Field label={`Loose ${formatUnit(p?.unit)}`}>
                            <Input
                              type="number"
                              min={0}
                              value={input.looseQty}
                              onChange={(e) => setInput({ looseQty: e.target.value })}
                            />
                          </Field>
                        </>
                      ) : (
                        <Field label={`Physical Remaining ${formatUnit(draft.unit)}`}>
                          <Input
                            type="number"
                            min={0}
                            value={input.looseQty}
                            onChange={(e) => setInput({ looseQty: e.target.value })}
                          />
                        </Field>
                      )}
                    </div>
                    {note ? <p className="mt-2 text-xs text-slate-500">ⓘ {note}</p> : null}
                    {line ? (
                      <div className="mt-3 space-y-1 text-sm">
                        <div>Physical Remaining: <span className="tabular font-medium">{formatQty(line.remainingQty)} {formatUnit(draft.unit)}</span></div>
                        <div>Actual Used: <span className="tabular font-medium">{formatQty(line.actualUsedQty)} {formatUnit(draft.unit)}</span></div>
                        <div>
                          Variance: <span className="tabular font-medium">{line.varianceQty > 0 ? '+' : ''}{formatQty(line.varianceQty)} {formatUnit(draft.unit)}</span>
                          <span className="ml-2 text-slate-500">{line.variancePercent > 0 ? '+' : ''}{formatQty(line.variancePercent)}%</span>
                        </div>
                        <div className={line.varianceQty === 0 ? 'text-emerald-700' : significant ? 'text-rose-700' : 'text-amber-700'}>
                          {line.varianceQty === 0 ? '✓' : significant ? '🔴' : '⚠'} {varianceLabel(line)}
                        </div>
                      </div>
                    ) : parsed?.filled ? (
                      <p className="mt-2 text-sm text-rose-600">{live && !live.ok ? live.reason : closingPreview.ok ? '' : closingPreview.reason}</p>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">Enter physical remaining to see actual used and variance immediately.</p>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="mt-4">
              <Checkbox
                checked={acknowledged}
                onChange={setAcknowledged}
                label="I have checked the physical material balance"
              />
            </div>
          </Card>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="secondary" className="w-full sm:w-auto" onClick={() => setStep(1)}>Back</Button>
            <Button variant="success" className="w-full sm:w-auto" onClick={openReview} disabled={!acknowledged || !closingPreview.ok}>
              Complete production
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirm}
        title="Complete this production session?"
        message={`Products: ${totals.products}. Planned: ${planned} packs. Actual: ${actual} packs. Display: ${formatQty(displayTotal)} PACK. Carton: ${formatQty(cartonTotal)} PACK. Production balance: ${formatQty(balance)} g. Waste: ${formatQty(waste)} g.`}
        confirmLabel="Complete production"
        onClose={() => setConfirm(false)}
        onConfirm={submit}
      />
    </div>
  )
}
