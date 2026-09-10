import { Link } from 'react-router-dom'
import { Button, Card, PageHeader, StatusBadge } from '@/components/ui'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatQty } from '@/utils/format'
import { currentUser } from './sessionPlan'

export function PickingListPage() {
  const state = useStore()
  const api = useApi()
  const { product } = useLookups()
  const user = currentUser(state)
  const session = state.productionSessions.find((item) => item.status === 'in_progress')
    ?? state.productionSessions.find((item) => item.productionDate === '2026-09-10')

  if (!session) {
    return (
      <div>
        <PageHeader title="Picking List" subtitle="No production session found." />
      </div>
    )
  }

  const locked = session.status !== 'in_progress'
  const picked = session.picking.filter((line) => line.picked).length

  return (
    <div>
      <PageHeader
        title="Picking List"
        subtitle={`${session.reference} · Collect everything in one store walk. Production balance is processed bulk, not raw material.`}
        actions={
          <div className="flex gap-2">
            <Link to="/manufacturing/today"><Button variant="secondary">Today's production</Button></Link>
            {session.status === 'in_progress' && <Link to={`/manufacturing/complete/${session.id}`}><Button>Complete production</Button></Link>}
          </div>
        }
      />
      <div className="mb-4 text-sm text-slate-500">{picked} / {session.picking.length} lines picked · viewing as {user.name}</div>
      {!session.picking.length && (
        <Card className="p-6 text-sm text-slate-500">Start production to generate the consolidated picking list.</Card>
      )}
      <div className="space-y-4">
        {session.picking.map((line) => (
          <Card key={line.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">{line.label}</div>
                <div className="mt-1 text-xs uppercase tracking-wide text-slate-400">{line.kind === 'balance' ? 'Production balance' : 'Pick'}</div>
              </div>
              {line.picked ? <StatusBadge status="picked" /> : <StatusBadge status="pending" />}
            </div>
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
              <div>{product(line.productId)?.sku}</div>
            </div>
            {!locked && (
              <Button className="mt-4" size="sm" variant={line.picked ? 'secondary' : 'primary'} onClick={() => api.togglePickingLine(session.id, line.id)}>
                {line.picked ? 'Undo picked' : 'Mark picked'}
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
