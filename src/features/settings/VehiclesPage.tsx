import { useState } from 'react'
import { Button, Card, Field, Input, PageHeader } from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { hasPermission } from '@/features/settings/permissions'
import { useApi, useStore } from '@/store/hooks'
import type { Vehicle } from '@/types'

const emptyForm = { id: '', code: '', vehicleType: '', plateNumber: '' }

export function VehiclesPage() {
  const state = useStore()
  const api = useApi()
  const [query, setQuery] = useState('')
  const [form, setForm] = useState(emptyForm)
  if (!hasPermission(state, 'settings.edit')) {
    return <PermissionDenied title="Vehicles" subtitle="You do not have permission to maintain vehicles." />
  }
  const vehicles = [...(state.vehicles ?? [])]
    .filter((row) => `${row.code} ${row.vehicleType} ${row.plateNumber}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.code.localeCompare(b.code))
  const save = () => {
    const saved = form.id
      ? api.updateVehicle(form.id, form)
      : api.createVehicle(form)
    if (saved) setForm(emptyForm)
  }
  const edit = (vehicle: Vehicle) => setForm({ id: vehicle.id, code: vehicle.code, vehicleType: vehicle.vehicleType, plateNumber: vehicle.plateNumber })
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Vehicles" subtitle="Vehicle type and plate number for dispatch. Inactive vehicles stay on historical records." />
      <Card className="mb-4 space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Code"><Input value={form.code} placeholder="V001" onChange={(event) => setForm({ ...form, code: event.target.value })} /></Field>
          <Field label="Vehicle type"><Input value={form.vehicleType} placeholder="Van" onChange={(event) => setForm({ ...form, vehicleType: event.target.value })} /></Field>
          <Field label="Plate number"><Input value={form.plateNumber} placeholder="JQK 1234" onChange={(event) => setForm({ ...form, plateNumber: event.target.value })} /></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={save}>{form.id ? 'Save vehicle' : 'Add vehicle'}</Button>
          {form.id ? <Button variant="secondary" onClick={() => setForm(emptyForm)}>Cancel</Button> : null}
        </div>
      </Card>
      <Card className="p-4">
        <Field label="Search"><Input value={query} placeholder="Code, type, or plate" onChange={(event) => setQuery(event.target.value)} /></Field>
        <div className="sf-table-wrap mt-3">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Type</th>
                <th>Plate</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((vehicle) => (
                <tr key={vehicle.id}>
                  <td className="font-medium">{vehicle.code}</td>
                  <td>{vehicle.vehicleType}</td>
                  <td>{vehicle.plateNumber}</td>
                  <td>{vehicle.active ? 'Active' : 'Inactive'}</td>
                  <td className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button variant="secondary" onClick={() => edit(vehicle)}>Edit</Button>
                      <Button variant="secondary" onClick={() => api.setVehicleActive(vehicle.id, !vehicle.active)}>{vehicle.active ? 'Deactivate' : 'Activate'}</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {vehicles.length === 0 ? <tr><td colSpan={5} className="text-slate-500">No vehicles yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
