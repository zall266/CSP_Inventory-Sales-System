import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Card, ConfirmDialog, Field, Input, PageHeader, Select, Textarea } from '@/components/ui'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatQty } from '@/utils/format'
import type { ShortProductionReason } from '@/types'
import { canEditSession, currentUser, sessionTotals } from './sessionPlan'

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
  const session = state.productionSessions.find((item) => item.id === (id ?? ''))
    ?? state.productionSessions.find((item) => item.status === 'in_progress')
    ?? state.productionSessions.find((item) => item.productionDate === '2026-09-10')

  const [results, setResults] = useState(() =>
    (session?.items ?? []).map((item) => ({
      productId: item.productId,
      actualQty: item.actualQty || item.targetQty,
      productionBalanceQty: item.productionBalanceQty || 0,
      balanceLocation: item.balanceLocation || 'Main Warehouse',
      balanceContainer: item.balanceContainer,
      wasteQty: item.wasteQty || 0,
      shortProductionReason: item.shortProductionReason,
      notes: item.notes,
    })),
  )
  const [confirm, setConfirm] = useState(false)

  if (!session) {
    return <PageHeader title="Complete production" subtitle="No session found." />
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
  const totals = sessionTotals(session)

  const submit = () => {
    const ok = api.completeSession(session.id, results)
    if (ok) {
      setConfirm(false)
      navigate(`/manufacturing/history/${session.id}`)
    }
  }

  return (
    <div>
      <PageHeader
        title="Complete production"
        subtitle={`${session.reference} · enter actual packs, leftover processed bulk, and waste for every product in one screen.`}
        actions={<Link to="/manufacturing/today"><Button variant="secondary">Back</Button></Link>}
      />
      <p className="mb-4 text-sm text-slate-600">
        Production balance is leftover processed bulk of that product — not leftover raw material and not finished goods.
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
                <Field label="Actual packs">
                  <Input type="number" min={0} value={row.actualQty} onChange={(e) => setRow({ actualQty: Number(e.target.value) })} />
                </Field>
                <Field label="Production balance (g)">
                  <Input type="number" min={0} value={row.productionBalanceQty} onChange={(e) => setRow({ productionBalanceQty: Number(e.target.value) })} />
                </Field>
                <Field label="Storage">
                  <Input value={row.balanceLocation} onChange={(e) => setRow({ balanceLocation: e.target.value })} />
                </Field>
                <Field label="Box / container">
                  <Select value={row.balanceContainer} onChange={(e) => setRow({ balanceContainer: e.target.value })}>
                    <option value="">Select box</option>
                    <option value="Box 1">Box 1</option>
                    <option value="Box 2">Box 2</option>
                    <option value="Box 3">Box 3</option>
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
            </Card>
          )
        })}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Link to="/manufacturing/today"><Button variant="secondary">Cancel</Button></Link>
        <Button variant="success" onClick={() => setConfirm(true)}>Review and complete</Button>
      </div>
      <ConfirmDialog
        open={confirm}
        title="Complete this production session?"
        message={`Products: ${totals.products}. Planned: ${planned} packs. Actual: ${actual} packs. Production balance: ${formatQty(balance)} g. Waste: ${formatQty(waste)} g.`}
        confirmLabel="Complete production"
        onClose={() => setConfirm(false)}
        onConfirm={submit}
      />
    </div>
  )
}
