import type { DispatchCourierKey, DispatchLine, DispatchRecord, SalesImportShipment, Vehicle } from '@/types'

export const DISPATCH_COURIER_ORDER = [
  'JNT',
  'JNT CARGO',
  'SPX',
  'FLASH',
  'GDEX',
  'INSTANT',
  'POS',
  'NINJAVAN',
  'UNKNOWN',
] as const satisfies readonly DispatchCourierKey[]

const COURIER_SET = new Set<string>(DISPATCH_COURIER_ORDER)

export function courierKeyFromSource(text: string): DispatchCourierKey {
  const value = text.trim()
  if (value === 'SPX Express') return 'SPX'
  if (value === 'Instant') return 'INSTANT'
  if (COURIER_SET.has(value)) return value as DispatchCourierKey
  return 'UNKNOWN'
}

export function parseParcelQty(value: number) {
  if (!Number.isInteger(value) || value < 1) return null
  return value
}

export function isDispatchDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function confirmedShipmentOwner(dispatches: DispatchRecord[], shipmentId: string, exceptDispatchId?: string) {
  return dispatches.find(
    (row) => row.status === 'confirmed' && row.id !== exceptDispatchId && row.lines.some((line) => line.shipmentId === shipmentId),
  )
}

export function dispatchAwbTotals(lines: DispatchLine[]) {
  const seen = new Set<string>()
  const counts: Partial<Record<DispatchCourierKey, number>> = {}
  let parcelQty = 0
  for (const line of lines) {
    parcelQty += line.parcelQty
    const tracking = line.trackingNumber.trim()
    if (!tracking || seen.has(tracking)) continue
    seen.add(tracking)
    counts[line.courierKey] = (counts[line.courierKey] ?? 0) + 1
  }
  return { counts, totalAwb: seen.size, parcelQty }
}

export function activeCourierColumns(rows: Array<{ counts: Partial<Record<DispatchCourierKey, number>> }>) {
  return DISPATCH_COURIER_ORDER.filter((key) => rows.some((row) => (row.counts[key] ?? 0) > 0))
}

export function validateDispatchLines(input: {
  lines: Array<{ shipmentId: string; courierKey: DispatchCourierKey; parcelQty: number }>
  shipments: SalesImportShipment[]
  dispatches: DispatchRecord[]
  dispatchId?: string
}) {
  const seenShipment = new Set<string>()
  const seenTracking = new Set<string>()
  for (const line of input.lines) {
    if (seenShipment.has(line.shipmentId)) return 'Each shipment can be added once.'
    seenShipment.add(line.shipmentId)
    const shipment = input.shipments.find((item) => item.id === line.shipmentId)
    if (!shipment) return 'A selected shipment was not found.'
    if (!COURIER_SET.has(line.courierKey)) return 'Choose a courier column or leave the shipment as UNKNOWN.'
    if (parseParcelQty(line.parcelQty) == null) return 'Parcel quantity must be a whole number of at least 1.'
    const owner = confirmedShipmentOwner(input.dispatches, line.shipmentId, input.dispatchId)
    if (owner) return 'That shipment is already on a confirmed dispatch.'
    const tracking = shipment.trackingNumber.trim()
    if (tracking) {
      if (seenTracking.has(tracking)) return 'That tracking number is already on this dispatch.'
      seenTracking.add(tracking)
    }
  }
  return ''
}

export function snapshotDispatchLines(
  lines: Array<{ shipmentId: string; courierKey: DispatchCourierKey; parcelQty: number }>,
  shipments: SalesImportShipment[],
): DispatchLine[] {
  return lines.map((line) => {
    const shipment = shipments.find((item) => item.id === line.shipmentId)
    return {
      shipmentId: line.shipmentId,
      trackingNumber: shipment?.trackingNumber ?? '',
      courierKey: line.courierKey,
      parcelQty: line.parcelQty,
    }
  })
}

export function vehicleLabel(vehicle: Pick<Vehicle, 'code' | 'vehicleType' | 'plateNumber'>) {
  return `${vehicle.code} — ${vehicle.vehicleType} — ${vehicle.plateNumber}`
}

export function dispatchCourierKeys(dispatch: DispatchRecord): DispatchCourierKey[] {
  const present = new Set(dispatch.lines.map((line) => line.courierKey))
  return DISPATCH_COURIER_ORDER.filter((key) => present.has(key))
}

export function inspectionCourierConflict(dispatches: DispatchRecord[]): DispatchCourierKey | '' {
  const seen = new Set<DispatchCourierKey>()
  for (const dispatch of dispatches) {
    for (const key of dispatchCourierKeys(dispatch)) {
      if (seen.has(key)) return key
      seen.add(key)
    }
  }
  return ''
}

export function validateInspectionGroup(dispatches: DispatchRecord[], dispatchIds: string[]) {
  if (dispatchIds.length < 1) return 'Select at least one confirmed dispatch.'
  if (new Set(dispatchIds).size !== dispatchIds.length) return 'Select each dispatch once.'
  const selected = dispatchIds.map((id) => dispatches.find((row) => row.id === id))
  if (selected.some((row) => !row)) return 'A selected dispatch was not found.'
  const rows = selected as DispatchRecord[]
  if (rows.some((row) => row.status === 'draft')) return 'A draft dispatch cannot join an inspection group.'
  if (rows.some((row) => row.status === 'void')) return 'A voided dispatch cannot join an inspection group.'
  if (rows.some((row) => row.status !== 'confirmed')) return 'Only a confirmed dispatch can join an inspection group.'
  if (rows.some((row) => row.inspectionGroupId)) return 'That dispatch is already in an inspection group.'
  const date = rows[0].dispatchDate
  if (rows.some((row) => row.dispatchDate !== date)) return 'Inspection Group must contain Dispatch records from the same date.'
  const conflict = inspectionCourierConflict(rows)
  if (conflict) return `Courier ${conflict} already exists in this inspection group. Use another Inspection Group.`
  return ''
}
