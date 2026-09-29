import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Card, Field, Input, PageHeader, Select } from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { DISPATCH_COURIER_ORDER, courierKeyFromSource, dispatchCourierKeys, validateInspectionGroup, vehicleLabel } from '@/features/dispatch/dispatchModel'
import { hasPermission } from '@/features/settings/permissions'
import { useApi, useStore } from '@/store/hooks'
import type { DispatchCourierKey, DispatchRecord, InspectionGroup, Vehicle } from '@/types'
import { systemDateKey } from '@/utils/format'

function canOpenDispatch(state: ReturnType<typeof useStore>) {
  return hasPermission(state, 'sales.delivery.view') || hasPermission(state, 'sales.delivery.create') || hasPermission(state, 'sales.delivery.edit')
}

function displayDate(value: string) {
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}

function courierSummary(row: DispatchRecord) {
  return dispatchCourierKeys(row).join(' · ') || 'No courier'
}

export function DispatchListPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string[]>([])
  if (!canOpenDispatch(state)) return <PermissionDenied title="Dispatch" subtitle="You do not have permission to view dispatch." />
  const rows = [...(state.dispatches ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const confirmed = rows.filter((row) => row.status === 'confirmed')
  const canGroup = hasPermission(state, 'sales.delivery.edit')
  const picked = confirmed.filter((row) => selected.includes(row.id) && !row.inspectionGroupId)
  const issue = picked.length ? validateInspectionGroup(state.dispatches ?? [], picked.map((row) => row.id)) : ''
  const open = () => {
    const created = api.createDispatch({ dispatchDate: systemDateKey() })
    if (created) navigate(`/sales/dispatch/${created.id}`)
  }
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const confirmGroup = () => {
    const group = api.createInspectionGroup(picked.map((row) => row.id))
    if (group) setSelected([])
  }
  return (
    <div>
      <PageHeader
        title="Dispatch"
        subtitle="One vehicle, one handover date, and the shipments that left with it."
        actions={hasPermission(state, 'sales.delivery.create') ? <Button onClick={open}>New Dispatch</Button> : undefined}
      />
      <DispatchTable title="Drafts" rows={rows.filter((row) => row.status === 'draft')} vehicles={state.vehicles ?? []} />
      <Card className="mb-4 p-4">
        <div className="mb-2 text-sm font-semibold text-slate-900">Confirmed</div>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                {canGroup ? <th>Group</th> : null}
                <th>Date</th>
                <th>Vehicle</th>
                <th>Couriers</th>
                <th>Shipments</th>
                <th>Inspection group</th>
              </tr>
            </thead>
            <tbody>
              {confirmed.map((row) => (
                <tr key={row.id}>
                  {canGroup ? (
                    <td>
                      {row.inspectionGroupId ? '—' : (
                        <input
                          type="checkbox"
                          aria-label={`${displayDate(row.dispatchDate)} ${courierSummary(row)} ${row.plateNumber}`}
                          checked={selected.includes(row.id)}
                          onChange={() => toggle(row.id)}
                        />
                      )}
                    </td>
                  ) : null}
                  <td><Link className="text-indigo-700" to={`/sales/dispatch/${row.id}`}>{displayDate(row.dispatchDate)}</Link></td>
                  <td>{dispatchVehicleLabel(row, state.vehicles ?? [])}</td>
                  <td>{courierSummary(row)}</td>
                  <td>{row.lines.length}</td>
                  <td>{groupNo(state.inspectionGroups ?? [], row.inspectionGroupId)}</td>
                </tr>
              ))}
              {confirmed.length === 0 ? <tr><td colSpan={canGroup ? 6 : 5} className="text-slate-500">None</td></tr> : null}
            </tbody>
          </table>
        </div>
        {canGroup ? (
          <div className="mt-4 border-t border-slate-200 pt-3">
            <div className="text-sm font-semibold text-slate-900">Create Inspection Group</div>
            <p className="mt-1 text-sm text-slate-600">Select confirmed dispatches from the same date. Courier, parcels, vehicle, and plate come from each dispatch.</p>
            {picked.length > 0 ? (
              <div className="mt-3 space-y-1 text-sm">
                {picked.map((row) => (
                  <div key={row.id}>{displayDate(row.dispatchDate)} — {courierSummary(row)} — {row.plateNumber}</div>
                ))}
                {issue ? <p className="text-red-700">{issue}</p> : <p className="text-slate-600">These dispatches will print as one inspection block.</p>}
                <Button disabled={Boolean(issue)} onClick={confirmGroup}>Confirm Group</Button>
              </div>
            ) : <p className="mt-2 text-sm text-slate-500">No dispatches selected.</p>}
          </div>
        ) : null}
      </Card>
      <InspectionGroups groups={(state.inspectionGroups ?? []).filter((group) => group.status === 'confirmed')} dispatches={state.dispatches ?? []} canRelease={canGroup} onRelease={(id) => api.releaseInspectionGroup(id)} />
      <DispatchTable title="Voided" rows={rows.filter((row) => row.status === 'void')} vehicles={state.vehicles ?? []} />
    </div>
  )
}

function groupNo(groups: InspectionGroup[], id?: string) {
  if (!id) return '—'
  return groups.find((group) => group.id === id)?.groupNo ?? '—'
}

function InspectionGroups({ groups, dispatches, canRelease, onRelease }: { groups: InspectionGroup[]; dispatches: DispatchRecord[]; canRelease: boolean; onRelease: (id: string) => void }) {
  return (
    <Card className="mb-4 p-4">
      <div className="mb-2 text-sm font-semibold text-slate-900">Inspection Groups</div>
      <div className="sf-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Date</th>
              <th>Dispatches</th>
              <th>Couriers</th>
              <th>Status</th>
              {canRelease ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const members = group.dispatchIds.map((id) => dispatches.find((row) => row.id === id)).filter((row): row is DispatchRecord => Boolean(row))
              const present = new Set(members.flatMap((row) => dispatchCourierKeys(row)))
              const couriers = DISPATCH_COURIER_ORDER.filter((key) => present.has(key)).join(' · ') || '—'
              return (
                <tr key={group.id}>
                  <td>{group.groupNo}</td>
                  <td>{displayDate(group.dispatchDate)}</td>
                  <td>{members.length}</td>
                  <td>{couriers}</td>
                  <td className="capitalize">{group.status}</td>
                  {canRelease ? <td><Button variant="secondary" onClick={() => onRelease(group.id)}>Release group</Button></td> : null}
                </tr>
              )
            })}
            {groups.length === 0 ? <tr><td colSpan={canRelease ? 6 : 5} className="text-slate-500">No inspection groups yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function dispatchVehicleLabel(row: DispatchRecord, vehicles: Vehicle[]) {
  if (row.status !== 'draft') return row.vehicleCode ? `${row.vehicleCode} · ${row.plateNumber}` : '—'
  const vehicle = vehicles.find((item) => item.id === row.vehicleId)
  return vehicle ? vehicleLabel(vehicle) : '—'
}

function DispatchTable({ title, rows, vehicles }: { title: string; rows: DispatchRecord[]; vehicles: Vehicle[] }) {
  return (
    <Card className="mb-4 p-4">
      <div className="mb-2 text-sm font-semibold text-slate-900">{title}</div>
      <div className="sf-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Vehicle</th>
              <th>Shipments</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><Link className="text-indigo-700" to={`/sales/dispatch/${row.id}`}>{row.dispatchDate}</Link></td>
                <td>{dispatchVehicleLabel(row, vehicles)}</td>
                <td>{row.lines.length}</td>
                <td className="capitalize">{row.status}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={4} className="text-slate-500">None</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export function DispatchEditorPage() {
  const { id = '' } = useParams()
  const state = useStore()
  const navigate = useNavigate()
  const dispatch = (state.dispatches ?? []).find((row) => row.id === id)
  if (!canOpenDispatch(state)) return <PermissionDenied title="Dispatch" subtitle="You do not have permission to view dispatch." />
  if (!dispatch) {
    return (
      <div>
        <PageHeader title="Dispatch" subtitle="This dispatch is no longer available." />
        <Link className="text-sm text-indigo-600" to="/sales/dispatch">Back to Dispatch</Link>
      </div>
    )
  }
  if (dispatch.status !== 'draft') return <DispatchLocked dispatch={dispatch} />
  return <DispatchDraft dispatch={dispatch} onDone={() => navigate('/sales/dispatch')} />
}

function DispatchLocked({ dispatch }: { dispatch: DispatchRecord }) {
  const api = useApi()
  const state = useStore()
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Dispatch" subtitle={`${dispatch.dispatchDate} · ${dispatch.status}`} actions={<Link className="text-sm text-indigo-600" to="/sales/dispatch">All dispatches</Link>} />
      <Card className="space-y-2 p-4 text-sm">
        <div>Vehicle: {dispatch.vehicleCode} — {dispatch.vehicleType} — {dispatch.plateNumber}</div>
        <div>Inspection group: {groupNo(state.inspectionGroups ?? [], dispatch.inspectionGroupId)}</div>
        <div>Condition: {dispatch.condition || '—'}</div>
        <div>Temperature: blank</div>
        <div className="sf-table-wrap">
          <table>
            <thead><tr><th>Tracking</th><th>Courier</th><th>Parcels</th></tr></thead>
            <tbody>
              {dispatch.lines.map((line) => (
                <tr key={line.shipmentId}><td>{line.trackingNumber || '—'}</td><td>{line.courierKey}</td><td>{line.parcelQty}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {dispatch.status === 'confirmed' && hasPermission(state, 'sales.delivery.edit') ? (
          <Button variant="danger" onClick={() => api.voidDispatch(dispatch.id)}>Void dispatch</Button>
        ) : null}
      </Card>
    </div>
  )
}

function DispatchDraft({ dispatch, onDone }: { dispatch: DispatchRecord; onDone: () => void }) {
  const state = useStore()
  const api = useApi()
  const [date, setDate] = useState(dispatch.dispatchDate)
  const [vehicleId, setVehicleId] = useState(dispatch.vehicleId)
  const [query, setQuery] = useState('')
  const [lines, setLines] = useState(dispatch.lines.map((line) => ({ shipmentId: line.shipmentId, courierKey: line.courierKey, parcelQty: line.parcelQty })))
  const vehicles = (state.vehicles ?? []).filter((row) => row.active)
  const blocked = useMemo(() => {
    const ids = new Set<string>()
    for (const row of state.dispatches ?? []) {
      if (row.status !== 'confirmed') continue
      for (const line of row.lines) ids.add(line.shipmentId)
    }
    return ids
  }, [state.dispatches])
  const selected = new Set(lines.map((line) => line.shipmentId))
  const shipments = (state.salesImportShipments ?? []).filter((shipment) => {
    const text = `${shipment.trackingNumber} ${shipment.courierText} ${shipment.externalOrderId} ${shipment.recipientName ?? ''}`.toLowerCase()
    return text.includes(query.trim().toLowerCase())
  })
  const toggle = (shipmentId: string) => {
    if (selected.has(shipmentId)) {
      setLines(lines.filter((line) => line.shipmentId !== shipmentId))
      return
    }
    if (blocked.has(shipmentId)) return
    const shipment = (state.salesImportShipments ?? []).find((item) => item.id === shipmentId)
    if (!shipment) return
    setLines([...lines, { shipmentId, courierKey: courierKeyFromSource(shipment.courierText), parcelQty: 1 }])
  }
  const save = (confirm: boolean) => {
    const ok = api.updateDispatch(dispatch.id, { dispatchDate: date, vehicleId, lines })
    if (!ok) return
    if (!confirm) {
      onDone()
      return
    }
    if (api.confirmDispatch(dispatch.id)) onDone()
  }
  return (
    <div>
      <PageHeader title="New Dispatch" subtitle="Confirming stores the vehicle, courier, and parcel snapshot. It does not move stock." actions={<Link className="text-sm text-indigo-600" to="/sales/dispatch">All dispatches</Link>} />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2">
        <Field label="Dispatch date"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Vehicle">
          <Select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
            <option value="">Select vehicle</option>
            {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicleLabel(vehicle)}</option>)}
          </Select>
        </Field>
      </Card>
      <Card className="mb-4 p-4">
        <Field label="Find shipment"><Input value={query} placeholder="Tracking, order, or recipient" onChange={(event) => setQuery(event.target.value)} /></Field>
        <div className="sf-table-wrap mt-3">
          <table>
            <thead><tr><th></th><th>Tracking</th><th>Source</th><th>Order</th><th>Recipient</th><th>Status</th></tr></thead>
            <tbody>
              {shipments.map((shipment) => {
                const taken = blocked.has(shipment.id)
                return (
                  <tr key={shipment.id}>
                    <td><input type="checkbox" checked={selected.has(shipment.id)} disabled={taken} onChange={() => toggle(shipment.id)} /></td>
                    <td>{shipment.trackingNumber || '—'}</td>
                    <td>{shipment.courierText || 'Blank'}</td>
                    <td>{shipment.externalOrderId}</td>
                    <td>{shipment.recipientName || '—'}</td>
                    <td>{taken ? 'On a confirmed dispatch' : selected.has(shipment.id) ? 'Selected' : 'Available'}</td>
                  </tr>
                )
              })}
              {shipments.length === 0 ? <tr><td colSpan={6} className="text-slate-500">No shipment records yet. Upload an AWB from Sales Import first.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="mb-4 p-4">
        <div className="mb-2 text-sm font-semibold">Review</div>
        {lines.some((line) => line.courierKey === 'UNKNOWN') ? (
          <p className="mb-3 text-sm text-amber-800">Some shipments have no reliable courier. Leave them as UNKNOWN or choose a column. Confirm is still allowed.</p>
        ) : null}
        <div className="sf-table-wrap">
          <table>
            <thead><tr><th>Tracking</th><th>Source</th><th>Courier</th><th>Parcels</th></tr></thead>
            <tbody>
              {lines.map((line) => {
                const shipment = (state.salesImportShipments ?? []).find((item) => item.id === line.shipmentId)
                return (
                  <tr key={line.shipmentId}>
                    <td>{shipment?.trackingNumber || '—'}</td>
                    <td>{shipment?.courierText || 'Blank'}</td>
                    <td>
                      <Select value={line.courierKey} onChange={(event) => setLines(lines.map((item) => item.shipmentId === line.shipmentId ? { ...item, courierKey: event.target.value as DispatchCourierKey } : item))}>
                        {DISPATCH_COURIER_ORDER.map((key) => <option key={key} value={key}>{key}</option>)}
                      </Select>
                    </td>
                    <td>
                      <Input type="number" min={1} step={1} value={line.parcelQty} onChange={(event) => setLines(lines.map((item) => item.shipmentId === line.shipmentId ? { ...item, parcelQty: Number(event.target.value) } : item))} />
                    </td>
                  </tr>
                )
              })}
              {lines.length === 0 ? <tr><td colSpan={4} className="text-slate-500">No shipments selected.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => save(false)}>Save draft</Button>
          <Button onClick={() => save(true)}>Confirm Dispatch</Button>
        </div>
      </Card>
    </div>
  )
}
