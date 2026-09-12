import { Link } from 'react-router-dom'
import { Button, Card, KpiCard, PageHeader, StatusBadge } from '@/components/ui'
import { isCompanyWarehouseId } from '@/features/agent/agentModel'
import { useLookups, useStore } from '@/store/hooks'
import { formatQty } from '@/utils/format'
import { currentUser, sessionTotals } from './sessionPlan'

export function ManufacturingDashboardPage() {
  const state = useStore()
  const { product } = useLookups()
  const user = currentUser(state)
  const today = state.productionSessions.find((item) => item.productionDate === '2026-09-10')
  const active = state.productionSessions.filter((item) => item.status === 'in_progress' || item.status === 'accepted')
  const completedToday = state.productionSessions.filter((item) => item.status === 'completed' && item.completedAt?.slice(0, 10) === '2026-09-10')
  const plannedPacks = today ? sessionTotals(today).planned : 0
  const actualPacks = completedToday.reduce((sum, item) => sum + sessionTotals(item).actual, 0)
  const balanceG = state.productionBalances.filter((row) => row.status === 'available').reduce((sum, row) => sum + row.quantity, 0)
  const lowAlerts = state.inventory.filter((row) => {
    if (!isCompanyWarehouseId(state.warehouses, row.warehouseId)) return false
    const p = product(row.productId)
    return p && row.qty > 0 && row.qty <= p.reorderLevel
  }).length

  return (
    <div>
      <PageHeader
        title="Manufacturing Dashboard"
        subtitle={`Daily pack sessions. Viewing as ${user.name}.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/manufacturing/today"><Button>Today's Production</Button></Link>
            <Link to="/manufacturing/picking"><Button variant="secondary">Picking List</Button></Link>
            <Link to="/manufacturing/history"><Button variant="secondary">Production History</Button></Link>
          </div>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Today's production" value={today ? today.status.replace('_', ' ') : 'None'} hint={today?.reference} />
        <KpiCard label="Active production" value={String(active.length)} />
        <KpiCard label="Completed today" value={String(completedToday.length)} tone="success" />
        <KpiCard label="Planned packs" value={String(plannedPacks)} />
        <KpiCard label="Actual packs" value={String(actualPacks)} />
        <KpiCard label="Production balance" value={`${formatQty(balanceG)} g`} hint="Processed bulk ready for reuse" />
        <KpiCard label="Material alerts" value={String(lowAlerts)} tone={lowAlerts ? 'warning' : 'default'} />
      </div>
      {today && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">{today.reference}</div>
            <StatusBadge status={today.status} />
          </div>
          <ul className="space-y-1 text-sm">
            {today.items.map((item) => (
              <li key={item.id} className="flex justify-between">
                <span>{product(item.productId)?.name}</span>
                <span className="tabular">{item.targetQty} packs</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
