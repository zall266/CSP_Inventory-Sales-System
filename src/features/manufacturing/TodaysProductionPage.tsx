import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, Card, Modal, PageHeader, StatusBadge } from '@/components/ui'
import { ProductMark } from '@/components/ProductMark'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatCalendarDate, formatDate, formatDateTime, formatQty } from '@/utils/format'
import type { ProductionSession } from '@/types'
import { hasPermission } from '@/features/settings/permissions'
import { allocationLabel, sessionAllocatedQty } from './materialClosing'
import { formatUnit } from '@/features/products/masterData'
import { AmendPlanModal, CancelPlanDialog, EditPlannedModal, planActionFlags } from './planAmendment'
import { RecipeSheetUpload } from './RecipeSheetUpload'
import { canStartProductionWithPhoto, isSampleRecipePhoto } from './recipePhoto'
import { buildSessionPlan, canEditSession, canStartAcceptedSession, currentUser, isSessionOperationalToday, originSessionForLine, systemProductionDate, todayOperationalSession } from './sessionPlan'

function todaySession(sessions: ProductionSession[], date = systemProductionDate()) {
  return todayOperationalSession(sessions, date)
}

export function TodaysProductionPage() {
  const state = useStore()
  const { id } = useParams()
  const today = systemProductionDate()
  const linked = id ? state.productionSessions.find((item) => item.id === id) : undefined
  if (linked && !isSessionOperationalToday(linked, today)) {
    return (
      <div>
        <PageHeader
          title="Today's Production"
          subtitle={`${formatCalendarDate(today)} · Today`}
        />
        <Card className="p-6 text-sm text-slate-600">
          This plan is for {formatCalendarDate(linked.productionDate)} ({linked.reference}).
          Today's Production only runs the current system date. Open Production History to view this record.
          <div className="mt-4">
            <Link to={`/manufacturing/history/${linked.id}`}><Button variant="secondary">View in Production History</Button></Link>
          </div>
        </Card>
      </div>
    )
  }
  const session = linked ?? todaySession(state.productionSessions, today)
  if (!session) {
    return (
      <div>
        <PageHeader title="Today's Production" subtitle={`No daily session for ${formatCalendarDate(today)}.`} />
        <Card className="p-6 text-sm text-slate-500">Create a session from Production Planning.</Card>
      </div>
    )
  }
  return <SessionWorkspace session={session} />
}

function SessionWorkspace({ session }: { session: ProductionSession }) {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { product } = useLookups()
  const user = currentUser(state)
  const plan = useMemo(() => buildSessionPlan(state, session), [state, session])
  const canEdit = canEditSession(user.role, session.status)
  const adminEdit = hasPermission(state, 'manufacturing.completed.edit')
  const flags = planActionFlags(state, session)

  const [startOpen, setStartOpen] = useState(false)
  const [photo, setPhoto] = useState(isSampleRecipePhoto(session.recipePhoto) ? '' : session.recipePhoto)
  const [photoName, setPhotoName] = useState(isSampleRecipePhoto(session.recipePhoto) ? '' : session.recipePhotoName)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [editPlan, setEditPlan] = useState(false)
  const [cancelPlan, setCancelPlan] = useState(false)
  const [amendPlan, setAmendPlan] = useState(false)
  const canStart = canStartAcceptedSession(user, session)
  const photoReady = canStartProductionWithPhoto(photo, photoName)

  const start = () => {
    if (starting) return
    if (!canStart) {
      setStartError('Only the staff member who accepted this session can start production.')
      return
    }
    if (!photoReady) {
      setStartError('Upload a real recipe sheet photo before starting production.')
      return
    }
    setStarting(true)
    setStartError('')
    const ok = api.startSession(session.id, { recipePhoto: photo, recipePhotoName: photoName || 'recipe-sheet.jpg' })
    setStarting(false)
    if (ok) {
      setStartOpen(false)
      navigate('/manufacturing/picking')
      return
    }
    setStartError('Production did not start. The selected photo is still here — try Start production again.')
  }

  return (
    <div>
      <PageHeader
        title="Today's Production"
        subtitle="One daily session — accept, start, pick, then complete all products together."
        actions={
          <div className="flex flex-wrap gap-2">
            {flags.canEdit && <Button variant="secondary" onClick={() => setEditPlan(true)}>Edit</Button>}
            {flags.canCancel && <Button variant="secondary" onClick={() => setCancelPlan(true)}>Delete / Cancel</Button>}
            {flags.canAmend && <Button variant="secondary" onClick={() => setAmendPlan(true)}>Amend Plan</Button>}
            {session.status === 'planned' && canEdit && <Button onClick={() => api.acceptSession(session.id)}>Accept production</Button>}
            {session.status === 'accepted' && canStart && <Button onClick={() => { setStartError(''); setStartOpen(true) }}>Start production</Button>}
            <Link to={`/manufacturing/history/${session.id}`}><Button variant="secondary">View production details</Button></Link>
            {session.status === 'in_progress' && canEdit && (
              <>
                <Link to="/manufacturing/picking"><Button variant="secondary">View picking list</Button></Link>
                <Link to={`/manufacturing/complete/${session.id}`}><Button variant="success">Complete production</Button></Link>
              </>
            )}
            {session.status === 'completed' && adminEdit && (
              <Link to={`/manufacturing/history/${session.id}/edit`}><Button>Edit completed production</Button></Link>
            )}
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Meta label="Production date" value="">
          <div className="flex flex-wrap items-center gap-2">
            <span>{formatCalendarDate(session.productionDate)}</span>
            <Badge tone="indigo">Today</Badge>
          </div>
        </Meta>
        <Meta label="Reference" value={session.reference} />
        <Meta label="Status" value="" ><StatusBadge status={session.status} /></Meta>
        <Meta label="Created by" value={session.createdBy} />
        <Meta label="Accepted by" value={session.acceptedBy || '—'} />
        <Meta label="Started by" value={session.startedBy || '—'} />
        <Meta label="Completed by" value={session.completedBy || '—'} />
        <Meta label="Recipe photo" value={isSampleRecipePhoto(session.recipePhoto) ? 'Not uploaded' : session.recipePhotoName || 'Not uploaded'} />
      </div>

      <Card className="mb-5">
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Original</th>
                <th>Target</th>
                <th>Actual</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {session.items.map((item) => {
                const p = product(item.productId)
                const lineStatus = session.status === 'completed' ? 'completed' : session.status === 'in_progress' ? 'in_progress' : session.status
                const origin = originSessionForLine(state.productionSessions, item)
                const originLine = origin?.items.find((row) => row.id === item.carriedFromItemId)
                return (
                  <tr key={item.id} className="cursor-default">
                    <td>
                      <div className="flex items-center gap-2">
                        {p && <ProductMark product={p} size="sm" />}
                        <div>
                          <div className="font-medium">{p?.name}</div>
                          <div className="text-xs text-slate-400">{p?.sku}</div>
                          {origin && (
                            <div className="text-xs text-indigo-700">
                              Continued from {formatCalendarDate(origin.productionDate)}
                              {originLine ? ` · original ${originLine.originalTargetQty} packs` : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="tabular">{item.originalTargetQty}</td>
                    <td className="tabular">{item.targetQty} packs</td>
                    <td className="tabular">{item.actualQty ? `${item.actualQty} packs` : '—'}</td>
                    <td className="tabular">{item.productionBalanceQty ? `${formatQty(item.productionBalanceQty)} g` : '—'}</td>
                    <td><StatusBadge status={lineStatus} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 text-sm font-semibold">Consolidated material requirement</div>
          <p className="mb-3 text-xs text-slate-500">BOM scaled to each target, then totalled. Production balance is used first so fresh pick is lower.</p>
          <div className="sf-table-wrap">
            <table>
              <thead><tr><th>Material</th><th>Gross BOM</th><th>Fresh to pick</th></tr></thead>
              <tbody>
                {plan.consolidatedRaw.map((row) => {
                  const p = product(row.productId)
                  const fresh = row.unit === 'KG' || row.unit === 'kg' ? `${formatQty(row.requiredG)} g` : `${formatQty(row.qty)} ${row.unit}`
                  const gross = row.unit === 'KG' || row.unit === 'kg' ? `${formatQty(row.grossG)} g` : `${formatQty(row.grossQty)} ${row.unit}`
                  return (
                    <tr key={row.productId} className="cursor-default">
                      <td>{p?.name}</td>
                      <td className="tabular">{gross}</td>
                      <td className="tabular">{fresh}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-3 text-sm font-semibold">Production balance (used first)</div>
          {plan.products.every((row) => row.balanceUsedG === 0) ? (
            <p className="text-sm text-slate-500">No reusable processed bulk for these products.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {plan.products.filter((row) => row.balanceUsedG > 0).map((row) => (
                <li key={row.productId}>
                  <div className="font-medium">{product(row.productId)?.name}</div>
                  <div className="text-slate-500">Required {formatQty(row.bulkRequiredG)} g · Balance used {formatQty(row.balanceUsedG)} g · Fresh {formatQty(row.freshBulkG)} g</div>
                  {row.balanceUsed.map((alloc) => (
                    <div key={alloc.balanceId} className="text-xs text-slate-400">{alloc.container} · {alloc.location} · {formatQty(alloc.qty)} g · {formatDate(alloc.date)}</div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {(session.materialAllocations?.length ?? 0) > 0 && (
        <Card className="mb-5 p-5">
          <div className="mb-2 text-sm font-semibold">Allocated materials</div>
          <p className="mb-3 text-xs text-slate-500">Session ledger — not warehouse on-hand.</p>
          {[...new Set(session.materialAllocations!.map((row) => row.productId))].map((productId) => {
            const rows = session.materialAllocations!.filter((row) => row.productId === productId)
            const total = sessionAllocatedQty(session, product(productId), productId) ?? 0
            return (
              <div key={productId} className="mb-2 text-sm text-slate-600">
                <span className="font-medium text-slate-900">{product(productId)?.name}</span>
                {' · '}{formatQty(total)} {formatUnit(product(productId)?.unit)}
                <div className="text-xs text-slate-500">{rows.map((row) => allocationLabel(row)).join(' + ')}</div>
              </div>
            )
          })}
        </Card>
      )}

      {session.excessReturns.length > 0 && (
        <Card className="mb-5 p-5">
          <div className="mb-2 text-sm font-semibold text-amber-800">Excess material to return</div>
          {session.excessReturns.map((row) => (
            <div key={row.id} className="flex items-center justify-between text-sm">
              <span>{product(row.productId)?.name} · {formatQty(row.qty)} {row.unit}</span>
              <StatusBadge status={row.status} />
            </div>
          ))}
        </Card>
      )}

      {session.targetChanges.length > 0 && (
        <Card className="mb-5 p-5">
          <div className="mb-2 text-sm font-semibold">Amendment history</div>
          {session.targetChanges.map((row) => (
            <div key={row.id} className="mb-2 text-sm text-slate-600">
              {product(row.productId)?.name}: {row.originalTarget} → {row.newTarget} · {row.reason} · {row.changedBy} · {formatDateTime(row.changedAt)}
            </div>
          ))}
        </Card>
      )}

      <Modal open={startOpen} onClose={() => { if (!starting) setStartOpen(false) }} title="Start production" width="max-w-lg">
        <RecipeSheetUpload
          photo={photo}
          photoName={photoName}
          busy={starting}
          onChange={(nextPhoto, nextName) => {
            setPhoto(nextPhoto)
            setPhotoName(nextName)
            setStartError('')
          }}
        />
        {startError ? <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{startError}</div> : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={starting} onClick={() => setStartOpen(false)}>Cancel</Button>
          <Button disabled={!photoReady || starting} onClick={start}>
            {starting ? 'Starting…' : 'Start production'}
          </Button>
        </div>
      </Modal>
      {editPlan && <EditPlannedModal session={session} open onClose={() => setEditPlan(false)} />}
      {cancelPlan && <CancelPlanDialog session={session} open onClose={() => setCancelPlan(false)} />}
      {amendPlan && <AmendPlanModal session={session} open onClose={() => setAmendPlan(false)} />}
    </div>
  )
}

function Meta({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{children ?? value}</div>
    </div>
  )
}
