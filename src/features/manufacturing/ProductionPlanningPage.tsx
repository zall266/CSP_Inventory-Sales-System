import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Field, Input, PageHeader, Select, StatusBadge } from '@/components/ui'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatDate } from '@/utils/format'
import { sessionTotals } from './sessionPlan'

const PACK_PRODUCTS = ['p-pack-mt', 'p-pack-cl', 'p-pack-st', 'p-pack-mlt', 'p-pack-ch']

export function ProductionPlanningPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { productName } = useLookups()
  const [date, setDate] = useState('2026-09-11')
  const [lines, setLines] = useState([
    { productId: 'p-pack-mt', targetQty: 45 },
    { productId: 'p-pack-cl', targetQty: 45 },
  ])

  return (
    <div>
      <PageHeader title="Production Planning" subtitle="Build the next daily pack session. Several products share one production day." />
      <Card className="mb-5 p-5">
        <div className="mb-3 text-sm font-semibold">New daily session</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Production date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <div className="mt-3 space-y-2">
          {lines.map((line, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-2">
              <Select value={line.productId} onChange={(e) => setLines(lines.map((row, i) => i === index ? { ...row, productId: e.target.value } : row))}>
                {PACK_PRODUCTS.map((id) => <option key={id} value={id}>{productName(id)}</option>)}
              </Select>
              <Input type="number" min={1} value={line.targetQty} onChange={(e) => setLines(lines.map((row, i) => i === index ? { ...row, targetQty: Number(e.target.value) } : row))} />
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setLines([...lines, { productId: 'p-pack-ch', targetQty: 45 }])}>Add product</Button>
          <Button
            size="sm"
            onClick={() => {
              const created = api.createDailySession({ productionDate: date, items: lines })
              if (created) navigate('/manufacturing/today/' + created.id)
            }}
          >
            Create session
          </Button>
        </div>
      </Card>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference</th>
                <th>Products</th>
                <th>Planned packs</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {state.productionSessions.map((session) => {
                const totals = sessionTotals(session)
                return (
                  <tr key={session.id} onClick={() => navigate(session.productionDate === '2026-09-10' ? '/manufacturing/today' : `/manufacturing/today/${session.id}`)}>
                    <td>{formatDate(session.productionDate + 'T00:00:00+08:00')}</td>
                    <td className="font-medium text-indigo-700">{session.reference}</td>
                    <td>{totals.products}</td>
                    <td className="tabular">{totals.planned}</td>
                    <td><StatusBadge status={session.status} /></td>
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
