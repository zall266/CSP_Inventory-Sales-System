import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Card, Field, Input, Modal, PageHeader, StatusBadge } from '@/components/ui'
import { ProductMark } from '@/components/ProductMark'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatDateTime, formatQty } from '@/utils/format'
import type { ProductionSession } from '@/types'
import { buildSessionPlan, canEditCompleted, canEditSession, currentUser } from './sessionPlan'

const SAMPLE_SHEET =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <rect x="24" y="24" width="592" height="352" fill="white" stroke="#cbd5e1" rx="12"/>
  <text x="48" y="80" font-family="sans-serif" font-size="22" fill="#0f172a">CSP Process Room Recipe Sheet</text>
  <text x="48" y="120" font-family="sans-serif" font-size="14" fill="#64748b">10 Sep 2026 · Matcha / Chocolate Lava / Strawberry</text>
  <text x="48" y="170" font-family="sans-serif" font-size="16" fill="#334155">Evidence photo only — BOM in StockFlow is the source of requirements.</text>
  <text x="48" y="220" font-family="sans-serif" font-size="14" fill="#64748b">Posted on process-room mirror</text>
</svg>`)

function todaySession(sessions: ProductionSession[], date = '2026-09-10') {
  return sessions.find((item) => item.productionDate === date && item.status !== 'completed')
    ?? sessions.find((item) => item.productionDate === date)
}

export function TodaysProductionPage() {
  const state = useStore()
  const { id } = useParams()
  const session = id
    ? state.productionSessions.find((item) => item.id === id)
    : todaySession(state.productionSessions)
  if (!session) {
    return (
      <div>
        <PageHeader title="Today's Production" subtitle="No daily session for 10 Sep 2026." />
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
  const adminEdit = canEditCompleted(user.role)

  const [startOpen, setStartOpen] = useState(false)
  const [photo, setPhoto] = useState(session.recipePhoto)
  const [photoName, setPhotoName] = useState(session.recipePhotoName)
  const [targetEdit, setTargetEdit] = useState<{ productId: string; qty: number; reason: string } | null>(null)

  const start = () => {
    const ok = api.startSession(session.id, { recipePhoto: photo, recipePhotoName: photoName || 'recipe-sheet.jpg' })
    if (ok) {
      setStartOpen(false)
      navigate('/manufacturing/picking')
    }
  }

  return (
    <div>
      <PageHeader
        title="Today's Production"
        subtitle="One daily session — accept, start, pick, then complete all products together."
        actions={
          <div className="flex flex-wrap gap-2">
            {session.status === 'planned' && canEdit && <Button onClick={() => api.acceptSession(session.id)}>Accept production</Button>}
            {session.status === 'accepted' && canEdit && <Button onClick={() => setStartOpen(true)}>Start production</Button>}
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
            {session.status === 'completed' && !adminEdit && (
              <Link to={`/manufacturing/history/${session.id}`}><Button variant="secondary">View details</Button></Link>
            )}
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Meta label="Production date" value={formatDate(session.productionDate + 'T00:00:00+08:00')} />
        <Meta label="Reference" value={session.reference} />
        <Meta label="Status" value="" ><StatusBadge status={session.status} /></Meta>
        <Meta label="Created by" value={session.createdBy} />
        <Meta label="Accepted by" value={session.acceptedBy || '—'} />
        <Meta label="Started by" value={session.startedBy || '—'} />
        <Meta label="Completed by" value={session.completedBy || '—'} />
        <Meta label="Recipe photo" value={session.recipePhotoName || 'Not uploaded'} />
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {session.items.map((item) => {
                const p = product(item.productId)
                const lineStatus = session.status === 'completed' ? 'completed' : session.status === 'in_progress' ? 'in_progress' : session.status
                return (
                  <tr key={item.id} className="cursor-default">
                    <td>
                      <div className="flex items-center gap-2">
                        {p && <ProductMark product={p} size="sm" />}
                        <div>
                          <div className="font-medium">{p?.name}</div>
                          <div className="text-xs text-slate-400">{p?.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td className="tabular">{item.originalTargetQty}</td>
                    <td className="tabular">{item.targetQty} packs</td>
                    <td className="tabular">{item.actualQty ? `${item.actualQty} packs` : '—'}</td>
                    <td className="tabular">{item.productionBalanceQty ? `${formatQty(item.productionBalanceQty)} g` : '—'}</td>
                    <td><StatusBadge status={lineStatus} /></td>
                    <td>
                      {canEdit && session.status !== 'completed' && (
                        <Button size="sm" variant="ghost" onClick={() => setTargetEdit({ productId: item.productId, qty: item.targetQty, reason: '' })}>
                          Edit target
                        </Button>
                      )}
                    </td>
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
          <div className="mb-2 text-sm font-semibold">Target change log</div>
          {session.targetChanges.map((row) => (
            <div key={row.id} className="mb-2 text-sm text-slate-600">
              {product(row.productId)?.name}: {row.originalTarget} → {row.newTarget} · {row.reason} · {row.changedBy} · {formatDateTime(row.changedAt)}
            </div>
          ))}
        </Card>
      )}

      <Modal open={startOpen} onClose={() => setStartOpen(false)} title="Start production" width="max-w-lg">
        <p className="mb-3 text-sm text-slate-600">Upload a photo of the physical recipe sheet on the process-room mirror. This is evidence only — material requirements still come from the configured BOM.</p>
        <Field label="Recipe sheet photo">
          <input
            type="file"
            accept="image/*"
            className="block w-full text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = () => {
                setPhoto(String(reader.result))
                setPhotoName(file.name)
              }
              reader.readAsDataURL(file)
            }}
          />
        </Field>
        <Button className="mt-3" size="sm" variant="secondary" onClick={() => { setPhoto(SAMPLE_SHEET); setPhotoName('process-room-recipe-sheet.jpg') }}>
          Use sample recipe sheet
        </Button>
        {photo && <img src={photo} alt="Recipe sheet" className="mt-3 max-h-48 rounded-xl border border-slate-200" />}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setStartOpen(false)}>Cancel</Button>
          <Button disabled={!photo} onClick={start}>Start production</Button>
        </div>
      </Modal>

      <Modal open={Boolean(targetEdit)} onClose={() => setTargetEdit(null)} title="Edit target" width="max-w-md">
        {targetEdit && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Original target: {session.items.find((item) => item.productId === targetEdit.productId)?.originalTargetQty} packs.
              Current target: {session.items.find((item) => item.productId === targetEdit.productId)?.targetQty} packs.
              New target: {targetEdit.qty} packs.
              Difference: {targetEdit.qty - (session.items.find((item) => item.productId === targetEdit.productId)?.originalTargetQty ?? 0)} packs.
            </p>
            <Field label="New target (packs)">
              <Input type="number" min={1} value={targetEdit.qty} onChange={(e) => setTargetEdit({ ...targetEdit, qty: Number(e.target.value) })} />
            </Field>
            <Field label="Reason">
              <Input value={targetEdit.reason} onChange={(e) => setTargetEdit({ ...targetEdit, reason: e.target.value })} placeholder="Insufficient sugar" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setTargetEdit(null)}>Cancel</Button>
              <Button onClick={() => { api.changeSessionTarget(session.id, targetEdit.productId, targetEdit.qty, targetEdit.reason); setTargetEdit(null) }}>Save target</Button>
            </div>
          </div>
        )}
      </Modal>
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
