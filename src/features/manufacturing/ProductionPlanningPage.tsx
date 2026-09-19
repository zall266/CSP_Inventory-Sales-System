import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Field, Input, PageHeader, StatusBadge, Textarea } from '@/components/ui'
import { useApi, useStore } from '@/store/hooks'
import { formatDate } from '@/utils/format'
import type { ProductionSession } from '@/types'
import { sessionTotals, systemProductionDate } from './sessionPlan'
import {
  AmendPlanModal,
  CancelPlanDialog,
  EditPlannedModal,
  PlanLinesEditor,
  planActionFlags,
  type PlanLineDraft,
} from './planAmendment'

function sessionPath(session: ProductionSession) {
  if (session.status === 'cancelled' || session.status === 'completed' || session.productionDate !== systemProductionDate()) {
    return `/manufacturing/history/${session.id}`
  }
  return '/manufacturing/today'
}

export function ProductionPlanningPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const [date, setDate] = useState('2026-09-11')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<PlanLineDraft[]>([
    { productId: 'p-pack-mt', targetQty: 45 },
    { productId: 'p-pack-cl', targetQty: 45 },
  ])
  const [editSession, setEditSession] = useState<ProductionSession | null>(null)
  const [cancelSession, setCancelSession] = useState<ProductionSession | null>(null)
  const [amendSession, setAmendSession] = useState<ProductionSession | null>(null)

  return (
    <div>
      <PageHeader title="Production Planning" subtitle="Build the next daily pack session. Several products share one production day." />
      <Card className="mb-5 p-5">
        <div className="mb-3 text-sm font-semibold">New daily session</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Production date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <div className="mt-3">
          <PlanLinesEditor lines={lines} onChange={setLines} />
        </div>
        <div className="mt-3">
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              const created = api.createDailySession({ productionDate: date, items: lines, notes })
              if (created) {
                navigate(created.productionDate === systemProductionDate() ? '/manufacturing/today' : `/manufacturing/history/${created.id}`)
              }
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {state.productionSessions.map((session) => {
                const totals = sessionTotals(session)
                const flags = planActionFlags(state, session)
                return (
                  <tr key={session.id} onClick={() => navigate(sessionPath(session))}>
                    <td>{formatDate(session.productionDate + 'T00:00:00+08:00')}</td>
                    <td className="font-medium text-indigo-700">{session.reference}</td>
                    <td>{totals.products}</td>
                    <td className="tabular">{totals.planned}</td>
                    <td><StatusBadge status={session.status} /></td>
                    <td>
                      <div className="flex flex-wrap justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                        {flags.canEdit && (
                          <Button size="sm" variant="ghost" onClick={() => setEditSession(session)}>Edit</Button>
                        )}
                        {flags.canCancel && (
                          <Button size="sm" variant="ghost" onClick={() => setCancelSession(session)}>Delete / Cancel</Button>
                        )}
                        {flags.canAmend && (
                          <Button size="sm" variant="ghost" onClick={() => setAmendSession(session)}>Amend Plan</Button>
                        )}
                        {flags.viewOnly && (
                          <Button size="sm" variant="ghost" onClick={() => navigate(`/manufacturing/history/${session.id}`)}>View</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {editSession && (
        <EditPlannedModal session={editSession} open onClose={() => setEditSession(null)} />
      )}
      {cancelSession && (
        <CancelPlanDialog session={cancelSession} open onClose={() => setCancelSession(null)} />
      )}
      {amendSession && (
        <AmendPlanModal session={amendSession} open onClose={() => setAmendSession(null)} />
      )}
    </div>
  )
}
