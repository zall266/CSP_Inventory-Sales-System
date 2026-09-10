import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button, Card, ConfirmDialog, Field, FilterRow, Input, Modal, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui'
import { movementLabel } from '@/components/ProductMark'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatDateTime, formatQty } from '@/utils/format'
import { canEditCompleted, currentUser, sessionTotals } from './sessionPlan'

export function SessionEditDeniedPage() {
  return (
    <div>
      <PageHeader title="Permission denied" subtitle="Staff and Supervisor cannot edit a completed production session. Ask an Admin or Owner." />
    </div>
  )
}

export function ProductionSessionEditPage() {
  const state = useStore()
  const user = currentUser(state)
  if (!canEditCompleted(user.role)) return <SessionEditDeniedPage />
  return <ProductionSessionDetailPage />
}

export function ProductionHistoryPage() {
  const state = useStore()
  const { productName } = useLookups()
  const [query, setQuery] = useState('')
  const rows = useMemo(
    () =>
      state.productionSessions
        .filter((session) => {
          if (query && !`${session.reference} ${session.items.map((item) => productName(item.productId)).join(' ')}`.toLowerCase().includes(query.toLowerCase())) return false
          return true
        })
        .slice()
        .sort((a, b) => b.productionDate.localeCompare(a.productionDate)),
    [state.productionSessions, query, productName],
  )
  return (
    <div>
      <PageHeader title="Production History" subtitle="Completed and past daily production sessions." />
      <FilterRow>
        <Input placeholder="Search reference or product" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div /><div /><div />
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference</th>
                <th>Products</th>
                <th>Planned</th>
                <th>Actual</th>
                <th>Status</th>
                <th>Completed by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((session) => {
                const totals = sessionTotals(session)
                return (
                  <tr key={session.id}>
                    <td>
                      <Link to={`/manufacturing/history/${session.id}`} className="font-medium text-indigo-700">{formatDate(session.productionDate + 'T00:00:00+08:00')}</Link>
                    </td>
                    <td>{session.reference}</td>
                    <td>{totals.products} products</td>
                    <td className="tabular">{totals.planned}</td>
                    <td className="tabular">{session.status === 'completed' ? totals.actual : '—'}</td>
                    <td><StatusBadge status={session.status} /></td>
                    <td>{session.completedBy || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export function ProductionSessionDetailPage() {
  const { id } = useParams()
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { product } = useLookups()
  const session = state.productionSessions.find((item) => item.id === id)
  const user = currentUser(state)
  const location = useLocation()
  const [edit, setEdit] = useState<{ productId: string; field: 'actualQty' | 'productionBalanceQty' | 'wasteQty'; value: number; reason: string } | null>(null)
  const [confirmEdit, setConfirmEdit] = useState(false)
  const allowEdit = session?.status === 'completed' && canEditCompleted(user.role)

  useEffect(() => {
    if (!session || !allowEdit || !location.pathname.endsWith('/edit')) return
    const first = session.items[0]
    setEdit({ productId: first.productId, field: 'actualQty', value: first.actualQty, reason: '' })
  }, [session?.id, allowEdit, location.pathname])

  if (!session) {
    return <PageHeader title="Production record" subtitle="Not found." />
  }

  const totals = sessionTotals(session)
  const denied = session.status === 'completed' && !allowEdit

  return (
    <div>
      <PageHeader
        title={session.reference}
        subtitle={`Daily session · ${formatDate(session.productionDate + 'T00:00:00+08:00')}`}
        actions={
          <div className="flex gap-2">
            {allowEdit && <Link to={`/manufacturing/history/${session.id}/edit`}><Button>Edit completed production</Button></Link>}
            <Button variant="secondary" onClick={() => navigate('/manufacturing/history')}>Back</Button>
          </div>
        }
      />
      {denied && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Completed production is locked for {user.role === 'manager' ? 'Supervisor' : 'Staff'}. Only Admin or Owner can edit.
        </div>
      )}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="Status"><StatusBadge status={session.status} /></Info>
        <Info label="Accepted by" value={`${session.acceptedBy || '—'} ${session.acceptedAt ? formatDateTime(session.acceptedAt) : ''}`} />
        <Info label="Started by" value={`${session.startedBy || '—'} ${session.startedAt ? formatDateTime(session.startedAt) : ''}`} />
        <Info label="Completed by" value={`${session.completedBy || '—'} ${session.completedAt ? formatDateTime(session.completedAt) : ''}`} />
      </div>
      {session.recipePhoto && (
        <Card className="mb-5 p-5">
          <div className="mb-2 text-sm font-semibold">Recipe sheet (evidence)</div>
          <img src={session.recipePhoto} alt={session.recipePhotoName} className="max-h-56 rounded-xl border border-slate-200" />
          <div className="mt-2 text-xs text-slate-400">{session.recipePhotoName} · {session.uploadedBy} · {session.uploadedAt ? formatDateTime(session.uploadedAt) : ''}</div>
        </Card>
      )}
      <Card className="mb-5">
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Original target</th>
                <th>Final target</th>
                <th>Actual</th>
                <th>Short</th>
                <th>Balance</th>
                <th>Box</th>
                <th>Waste</th>
              </tr>
            </thead>
            <tbody>
              {session.items.map((item) => (
                <tr key={item.id} className="cursor-default">
                  <td className="font-medium">{product(item.productId)?.name}</td>
                  <td className="tabular">{item.originalTargetQty}</td>
                  <td className="tabular">{item.targetQty}</td>
                  <td className="tabular">{item.actualQty || '—'}</td>
                  <td>{item.shortProductionQty ? `${item.shortProductionQty} · ${item.shortProductionReason}` : '—'}</td>
                  <td className="tabular">{item.productionBalanceQty ? `${formatQty(item.productionBalanceQty)} g` : '—'}</td>
                  <td>{item.balanceContainer || '—'}</td>
                  <td className="tabular">{item.wasteQty ? `${formatQty(item.wasteQty)} g` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="mb-5 text-sm text-slate-500">Planned {totals.planned} packs · Actual {totals.actual} packs · Balance {formatQty(totals.balance)} g</div>
      {session.targetChanges.length > 0 && (
        <Card className="mb-5 p-5">
          <div className="mb-2 text-sm font-semibold">Target changes</div>
          {session.targetChanges.map((row) => (
            <div key={row.id} className="text-sm text-slate-600">{product(row.productId)?.name}: {row.originalTarget} → {row.newTarget} · {row.reason} · {row.changedBy} · {formatDateTime(row.changedAt)}</div>
          ))}
        </Card>
      )}
      {session.completedEdits.length > 0 && (
        <Card className="mb-5 p-5">
          <div className="mb-2 text-sm font-semibold">Completed-production audit</div>
          {session.completedEdits.map((row) => (
            <div key={row.id} className="text-sm text-slate-600">
              {product(row.productId)?.name} · {row.field} · {row.originalValue} → {row.newValue} · {row.reason} · {row.editedBy} · {formatDateTime(row.editedAt)}
            </div>
          ))}
        </Card>
      )}
      {session.picking.length > 0 && (
        <Card className="mb-5 p-5">
          <div className="mb-2 text-sm font-semibold">Picking</div>
          {session.picking.map((line) => (
            <div key={line.id} className="text-sm text-slate-600">{line.label}: {formatQty(line.qtyToPick)} {line.unit} · {line.source} {line.container} {line.picked ? '· picked' : ''}</div>
          ))}
        </Card>
      )}
      {state.stockMovements.filter((row) => row.reference === session.reference || row.reference.startsWith(`${session.reference} `)).length > 0 && (
        <Card className="mb-5 p-5">
          <div className="mb-2 text-sm font-semibold">Inventory movements</div>
          {state.stockMovements
            .filter((row) => row.reference === session.reference || row.reference.startsWith(`${session.reference} `))
            .map((row) => (
              <div key={row.id} className="text-sm text-slate-600">
                {movementLabel(row.type)} · {product(row.productId)?.name}: {row.stockIn ? `+${formatQty(row.stockIn)}` : `-${formatQty(row.stockOut)}`} · {row.notes}
              </div>
            ))}
        </Card>
      )}

      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title="Edit completed production" width="max-w-md">
        {edit && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Original values are kept in the audit log. Inventory will be adjusted to match.</p>
            <Field label="Product">
              <Select value={edit.productId} onChange={(e) => {
                const item = session.items.find((row) => row.productId === e.target.value)!
                setEdit({ ...edit, productId: e.target.value, value: item[edit.field] })
              }}>
                {session.items.map((item) => <option key={item.productId} value={item.productId}>{product(item.productId)?.name}</option>)}
              </Select>
            </Field>
            <Field label="Field">
              <Select
                value={edit.field}
                onChange={(e) => {
                  const field = e.target.value as typeof edit.field
                  const item = session.items.find((row) => row.productId === edit.productId)!
                  setEdit({ ...edit, field, value: item[field] })
                }}
              >
                <option value="actualQty">Actual packs</option>
                <option value="productionBalanceQty">Production balance (g)</option>
                <option value="wasteQty">Waste (g)</option>
              </Select>
            </Field>
            <Field label="New value">
              <Input type="number" value={edit.value} onChange={(e) => setEdit({ ...edit, value: Number(e.target.value) })} />
            </Field>
            <Field label="Reason (required)">
              <Textarea rows={3} value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} placeholder="Incorrect quantity entered during production completion" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
              <Button
                onClick={() => {
                  if (!edit.reason.trim()) return
                  setConfirmEdit(true)
                }}
              >
                Save with audit
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={confirmEdit}
        title="Save completed production edit?"
        message={edit ? `${product(edit.productId)?.name} ${edit.field} → ${edit.value}. Reason: ${edit.reason}. Inventory will be adjusted.` : ''}
        confirmLabel="Save and adjust inventory"
        onClose={() => setConfirmEdit(false)}
        onConfirm={() => {
          if (!edit) return
          const ok = api.editCompletedSession(session.id, edit.productId, edit.field, edit.value, edit.reason)
          if (ok) {
            setConfirmEdit(false)
            setEdit(null)
          }
        }}
      />
    </div>
  )
}

function Info({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{children ?? value}</div>
    </div>
  )
}
