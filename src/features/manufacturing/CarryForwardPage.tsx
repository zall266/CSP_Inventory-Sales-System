import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '@/components/ui'
import { ProductMark } from '@/components/ProductMark'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate, formatQty } from '@/utils/format'
import { hasPermission } from '@/features/settings/permissions'
import { committedCarryForwardOrigins } from './sessionPlan'

export function CarryForwardPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { product } = useLookups()
  const rows = committedCarryForwardOrigins(state)
  const canContinue = hasPermission(state, 'manufacturing.start') || hasPermission(state, 'manufacturing.complete') || hasPermission(state, 'manufacturing.create')

  const continueOrigin = (sessionId: string, itemId: string) => {
    const next = api.continueCarryForward(sessionId, itemId)
    if (next) navigate(`/manufacturing/today/${next.id}`)
  }

  return (
    <div>
      <PageHeader
        title="Carry Forward"
        subtitle="Unfinished flavours from completed production, ready to continue today."
        actions={<Link to="/manufacturing/today"><Button variant="secondary">Today's Production</Button></Link>}
      />
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Flavour</th>
                <th>Original date</th>
                <th>Original target</th>
                <th>Completed</th>
                <th>Remaining</th>
                <th>Production balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ session, item, remaining, availableBalanceG }) => {
                const p = product(item.productId)
                return (
                  <tr key={item.id} className="cursor-default">
                    <td>
                      <div className="flex items-center gap-2">
                        {p && <ProductMark product={p} size="sm" />}
                        <div>
                          <div className="font-medium">{p?.name}</div>
                          <div className="text-xs text-slate-400">{session.reference}</div>
                        </div>
                      </div>
                    </td>
                    <td>{formatDate(`${session.productionDate}T00:00:00+08:00`)}</td>
                    <td className="tabular">{item.originalTargetQty} packs</td>
                    <td className="tabular">{item.actualQty || 0} packs</td>
                    <td className="tabular">{remaining} packs</td>
                    <td className="tabular">{availableBalanceG ? `${formatQty(availableBalanceG)} g` : '—'}</td>
                    <td>
                      {canContinue ? (
                        <Button size="sm" onClick={() => continueOrigin(session.id, item.id)}>Continue Production</Button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
              {!rows.length && (
                <tr className="cursor-default">
                  <td colSpan={7} className="text-slate-500">No carry-forward work. Unfinished flavours appear here after today's production is completed.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
