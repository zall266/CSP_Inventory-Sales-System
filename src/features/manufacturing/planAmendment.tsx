import { useEffect, useState } from 'react'
import { Button, ConfirmDialog, Field, Input, Modal, Select, Textarea } from '@/components/ui'
import { hasPermission } from '@/features/settings/permissions'
import { useApi, useLookups } from '@/store/hooks'
import type { AppState, ProductionSession } from '@/types'
import { remainingTargetQty } from './sessionPlan'

export const PACK_PRODUCTS = ['p-pack-mt', 'p-pack-cl', 'p-pack-st', 'p-pack-mlt', 'p-pack-ch']

export type PlanLineDraft = { productId: string; targetQty: number }

export function planActionFlags(state: AppState, session: ProductionSession) {
  const canEditPlan = hasPermission(state, 'manufacturing.plan.edit')
  const canAmendPlan = hasPermission(state, 'manufacturing.plan.amend')
  return {
    canEdit: session.status === 'planned' && canEditPlan,
    canCancel: session.status === 'planned' && canEditPlan,
    canAmend: (session.status === 'accepted' || session.status === 'in_progress') && canAmendPlan,
    viewOnly: session.status === 'completed' || session.status === 'cancelled',
  }
}

export function PlanLinesEditor({
  lines,
  onChange,
  allowAdd = true,
}: {
  lines: PlanLineDraft[]
  onChange: (lines: PlanLineDraft[]) => void
  allowAdd?: boolean
}) {
  const { productName } = useLookups()
  return (
    <div className="space-y-2">
      {lines.map((line, index) => (
        <div key={`${line.productId}-${index}`} className="grid gap-2 sm:grid-cols-2">
          <Select
            value={line.productId}
            onChange={(e) => onChange(lines.map((row, i) => (i === index ? { ...row, productId: e.target.value } : row)))}
          >
            {PACK_PRODUCTS.map((id) => (
              <option key={id} value={id}>{productName(id)}</option>
            ))}
          </Select>
          <Input
            type="number"
            min={1}
            value={line.targetQty}
            onChange={(e) => onChange(lines.map((row, i) => (i === index ? { ...row, targetQty: Number(e.target.value) } : row)))}
          />
        </div>
      ))}
      {allowAdd && (
        <Button size="sm" variant="secondary" onClick={() => onChange([...lines, { productId: 'p-pack-ch', targetQty: 45 }])}>
          Add product
        </Button>
      )}
    </div>
  )
}

function sessionLines(session: ProductionSession): PlanLineDraft[] {
  return session.items.map((item) => ({ productId: item.productId, targetQty: item.targetQty }))
}

export function EditPlannedModal({
  session,
  open,
  onClose,
}: {
  session: ProductionSession
  open: boolean
  onClose: () => void
}) {
  const api = useApi()
  const [date, setDate] = useState(session.productionDate)
  const [notes, setNotes] = useState(session.notes)
  const [lines, setLines] = useState<PlanLineDraft[]>(sessionLines(session))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDate(session.productionDate)
    setNotes(session.notes)
    setLines(sessionLines(session))
    setSaving(false)
  }, [open, session])

  const save = () => {
    if (saving) return
    setSaving(true)
    const ok = api.updatePlannedSession(session.id, { productionDate: date, notes, items: lines })
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit production plan" width="max-w-lg">
      <div className="space-y-3">
        <Field label="Production date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Products and target quantity">
          <PlanLinesEditor lines={lines} onChange={setLines} />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>Save plan</Button>
        </div>
      </div>
    </Modal>
  )
}

export function CancelPlanDialog({
  session,
  open,
  onClose,
}: {
  session: ProductionSession
  open: boolean
  onClose: () => void
}) {
  const api = useApi()
  const [saving, setSaving] = useState(false)
  return (
    <ConfirmDialog
      open={open}
      title="Cancel production plan?"
      message={`${session.reference} will be cancelled. The record is kept for history and is not hard deleted.`}
      confirmLabel="Cancel plan"
      tone="danger"
      confirmDisabled={saving}
      onClose={onClose}
      onConfirm={() => {
        if (saving) return
        setSaving(true)
        const ok = api.cancelPlannedSession(session.id)
        setSaving(false)
        if (ok) onClose()
      }}
    />
  )
}

export function AmendPlanModal({
  session,
  open,
  onClose,
}: {
  session: ProductionSession
  open: boolean
  onClose: () => void
}) {
  const api = useApi()
  const { productName } = useLookups()
  const [lines, setLines] = useState<PlanLineDraft[]>(sessionLines(session))
  const [reason, setReason] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLines(sessionLines(session))
    setReason('')
    setConfirmOpen(false)
    setSaving(false)
  }, [open, session])

  const changed = session.items.filter((item) => {
    const next = lines.find((row) => row.productId === item.productId)
    return next != null && next.targetQty !== item.targetQty
  })

  const validate = () => {
    if (!reason.trim()) {
      api.toast('Enter a reason', 'Every amendment must be explained.', 'warning')
      return false
    }
    for (const item of session.items) {
      const next = lines.find((row) => row.productId === item.productId)
      if (!next) continue
      if (!Number.isFinite(next.targetQty) || next.targetQty <= 0) {
        api.toast('Target must be greater than zero', undefined, 'warning')
        return false
      }
      if (next.targetQty < (item.actualQty || 0)) {
        api.toast('New target cannot be lower than actual production completed.', undefined, 'warning')
        return false
      }
    }
    if (!changed.length) {
      api.toast('No target changes', 'New targets match the current plan.', 'info')
      return false
    }
    return true
  }

  const confirmMessage = [
    'Amend production plan?',
    '',
    ...changed.map((item) => {
      const next = lines.find((row) => row.productId === item.productId)!
      return `${productName(item.productId)}: ${item.targetQty} → ${next.targetQty} PACK`
    }),
    '',
    `Reason: ${reason.trim()}`,
  ].join('\n')

  const save = () => {
    if (saving) return
    setSaving(true)
    const ok = api.amendSessionPlan(session.id, lines, reason)
    setSaving(false)
    setConfirmOpen(false)
    if (ok) onClose()
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Amend production plan" width="max-w-lg">
        <div className="space-y-4">
          <div className="sf-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Current</th>
                  <th>Actual</th>
                  <th>New target</th>
                </tr>
              </thead>
              <tbody>
                {session.items.map((item) => {
                  const next = lines.find((row) => row.productId === item.productId)?.targetQty ?? item.targetQty
                  return (
                    <tr key={item.id} className="cursor-default">
                      <td className="font-medium">{productName(item.productId)}</td>
                      <td className="tabular">{item.targetQty} PACK</td>
                      <td className="tabular">{item.actualQty ? `${item.actualQty} PACK` : '—'}</td>
                      <td>
                        <Input
                          type="number"
                          min={item.actualQty || 1}
                          value={next}
                          onChange={(e) => setLines(lines.map((row) => row.productId === item.productId ? { ...row, targetQty: Number(e.target.value) } : row))}
                        />
                        <div className="mt-1 text-[11px] text-slate-400">
                          Remaining {remainingTargetQty({ targetQty: next, actualQty: item.actualQty })} PACK
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Field label="Reason">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Additional customer order"
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button
              onClick={() => {
                if (validate()) setConfirmOpen(true)
              }}
              disabled={saving}
            >
              Save Amendment
            </Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmOpen}
        title="Amend production plan?"
        message={confirmMessage}
        confirmLabel="Confirm Amendment"
        confirmDisabled={saving}
        onClose={() => setConfirmOpen(false)}
        onConfirm={save}
      />
    </>
  )
}
