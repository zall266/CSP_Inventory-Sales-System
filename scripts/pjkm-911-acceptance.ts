const memory = new Map<string, string>()
const localStoragePolyfill = {
  getItem(key: string) { return memory.has(key) ? memory.get(key)! : null },
  setItem(key: string, value: string) { memory.set(key, String(value)) },
  removeItem(key: string) { memory.delete(key) },
  clear() { memory.clear() },
  key(index: number) { return [...memory.keys()][index] ?? null },
  get length() { return memory.size },
}
Object.defineProperty(globalThis, 'localStorage', { value: localStoragePolyfill })
Object.defineProperty(globalThis, 'window', { value: globalThis })

import { readFileSync } from 'node:fs'
import { activeCourierColumns, courierKeyFromSource, dispatchAwbTotals, validateDispatchLines } from '@/features/dispatch/dispatchModel'
import { buildPjkm911, paginatePjkm911 } from '@/features/pjkm/pjkm911'
import type { TextItem } from '@/features/salesImport/parsePickingList'
import { db } from '@/store/db'
import type { DispatchLine } from '@/types'

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

db.resetDemo()
db.switchUser('u-admin')
const snap = () => db.getSnapshot()
const movements = () => snap().stockMovements.length

check('Courier SPX Express maps to SPX', courierKeyFromSource('SPX Express') === 'SPX')
check('Courier Instant maps to INSTANT', courierKeyFromSource('Instant') === 'INSTANT')
check('Courier AIR and TT stay UNKNOWN', courierKeyFromSource('AIR') === 'UNKNOWN' && courierKeyFromSource('TT') === 'UNKNOWN')
check('Blank courier stays UNKNOWN', courierKeyFromSource('') === 'UNKNOWN' && courierKeyFromSource('   ') === 'UNKNOWN')

const duplicate = [
  { shipmentId: 'a', trackingNumber: 'AWB1', courierKey: 'SPX' as const, parcelQty: 1 },
  { shipmentId: 'b', trackingNumber: 'AWB1', courierKey: 'JNT' as const, parcelQty: 2 },
  { shipmentId: 'c', trackingNumber: '', courierKey: 'UNKNOWN' as const, parcelQty: 3 },
  { shipmentId: 'd', trackingNumber: 'AWB2', courierKey: 'INSTANT' as const, parcelQty: 1 },
]
const totals = dispatchAwbTotals(duplicate)
check('Distinct tracking numbers count once', totals.totalAwb === 2 && totals.counts.SPX === 1 && totals.counts.JNT == null)
check('Blank tracking is not an AWB and still adds parcels', totals.parcelQty === 7 && (totals.counts.UNKNOWN ?? 0) === 0)
check('Product quantity is not the AWB count', totals.totalAwb !== 7)

db.switchUser('u-siti')
check('Cashier cannot create a vehicle', db.createVehicle({ code: 'V001', vehicleType: 'Van', plateNumber: 'JQK 1234' }) === null)
db.switchUser('u-admin')
check('Plate and type are required', db.createVehicle({ code: 'V000', vehicleType: '', plateNumber: 'JQK 1' }) === null && db.createVehicle({ code: 'V000', vehicleType: 'Van', plateNumber: ' ' }) === null)
const v001 = db.createVehicle({ code: 'V001', vehicleType: 'Van', plateNumber: 'JQK 1234' })
const v002 = db.createVehicle({ code: 'V002', vehicleType: 'Lorry', plateNumber: 'JTR 5678' })
check('Vehicles are created', Boolean(v001 && v002))
check('Vehicle code is unique', db.createVehicle({ code: 'v001', vehicleType: 'Car', plateNumber: 'AAA 1111' }) === null)
check('Vehicle can be deactivated', db.setVehicleActive(v002!.id, false) && snap().vehicles.find((row) => row.id === v002!.id)?.active === false)
const blocked = db.createDispatch({ vehicleId: v002!.id, dispatchDate: '2026-09-11' })
check('Inactive vehicle cannot be selected', blocked === null)
check('Vehicle can be activated', db.setVehicleActive(v002!.id, true))

function word(text: string, x: number, y: number, page = 1): TextItem {
  return { text, x, y, page }
}
const account = db.createSalesImportAccount('shopee', 'Dispatch Proof')
const batch = db.createSalesImportBatch('shopee', account!.id)
let file = 0
function ingest(items: TextItem[]) {
  file += 1
  return db.ingestSalesImportAwb(batch!.id, { fileName: `awb-${file}.pdf`, fileHash: `hash-${file}`, items })
}
function label(orderId: string, extra: string[], page = 1) {
  return [word(orderId, 40, 700, page), word('Recipient', 40, 660, page), word('Details', 100, 660, page), ...extra.map((text, index) => word(text, 40, 620 - index * 20, page))]
}
ingest(label('260910ABCD1234', ['SPX', 'Express', 'SPXMY100001']))
ingest(label('260910ABCD1235', ['Instant', 'SPXMY100002']))
ingest(label('260910ABCD1236', ['AIR', '123456789012']))
ingest(label('260910ABCD1237', ['TT', '123456789013']))
ingest(label('260910ABCD1238', ['123456789014']))
ingest([
  ...label('260910ABCD1239', ['SPX', 'Express', 'SPXMY200001'], 1),
  ...label('260910ABCD1239', ['SPX', 'Express', 'SPXMY200002'], 2),
])
ingest(label('260910ABCD1240', ['SPX', 'Express', 'SPXMY300001']))
ingest(label('260910ABCD1241', ['SPX', 'Express', 'SPXMY300002']))
const shipments = () => snap().salesImportShipments ?? []
const byTracking = (tracking: string) => shipments().find((row) => row.trackingNumber === tracking)
check('Shipments were read from the existing AWB path', Boolean(byTracking('SPXMY100001') && byTracking('SPXMY100002') && byTracking('123456789012')))

const beforeMoves = movements()
const beforeQty = snap().inventory.reduce((sum, row) => sum + row.qty, 0)
const draft = db.createDispatch({ dispatchDate: '2026-09-12', vehicleId: v001!.id })
check('Draft dispatch is created', draft?.status === 'draft' && draft.dispatchDate === '2026-09-12')
const spx = byTracking('SPXMY100001')!
const instant = byTracking('SPXMY100002')!
const air = byTracking('123456789012')!
const tt = byTracking('123456789013')!
const blankCourier = byTracking('123456789014')!
const multi = shipments().filter((row) => row.externalOrderId === '260910ABCD1239')
check('One order can keep two tracking numbers', multi.length === 2)
const saved = db.updateDispatch(draft!.id, {
  lines: [
    { shipmentId: spx.id, courierKey: 'SPX', parcelQty: 1 },
    { shipmentId: instant.id, courierKey: 'INSTANT', parcelQty: 2 },
    { shipmentId: air.id, courierKey: courierKeyFromSource(air.courierText), parcelQty: 1 },
    { shipmentId: tt.id, courierKey: courierKeyFromSource(tt.courierText), parcelQty: 1 },
    { shipmentId: blankCourier.id, courierKey: courierKeyFromSource(blankCourier.courierText), parcelQty: 1 },
    { shipmentId: multi[0].id, courierKey: 'JNT', parcelQty: 1 },
    { shipmentId: multi[1].id, courierKey: 'SPX', parcelQty: 1 },
  ],
})
check('Draft lines save', saved === true)
check('Zero parcel quantity is rejected', db.updateDispatch(draft!.id, { lines: [{ shipmentId: spx.id, courierKey: 'SPX', parcelQty: 0 }] }) === false)
check('Duplicate tracking on one dispatch is rejected', validateDispatchLines({
  lines: [
    { shipmentId: 's1', courierKey: 'SPX', parcelQty: 1 },
    { shipmentId: 's2', courierKey: 'JNT', parcelQty: 1 },
  ],
  shipments: [
    { id: 's1', trackingNumber: 'AWB-SAME' },
    { id: 's2', trackingNumber: 'AWB-SAME' },
  ] as never,
  dispatches: [],
}) === 'That tracking number is already on this dispatch.')
const parcelLine = snap().dispatches.find((row) => row.id === draft!.id)?.lines.find((line) => line.shipmentId === instant.id)
check('Parcel quantity stays editable before confirm', parcelLine?.parcelQty === 2)
const stockSame = movements() === beforeMoves && snap().inventory.reduce((sum, row) => sum + row.qty, 0) === beforeQty
check('Confirm does not post stock', db.confirmDispatch(draft!.id) === true && movements() === beforeMoves && snap().inventory.reduce((sum, row) => sum + row.qty, 0) === beforeQty && stockSame)
const confirmed = snap().dispatches.find((row) => row.id === draft!.id)!
check('Confirm snapshots vehicle, condition, and courier', confirmed.status === 'confirmed' && confirmed.condition === 'BAIK' && confirmed.vehicleType === 'Van' && confirmed.plateNumber === 'JQK 1234' && confirmed.lines.every((line) => line.courierKey !== 'AIR' && line.courierKey !== 'TT'))
check('AIR, TT, and blank stay UNKNOWN', ['123456789012', '123456789013', '123456789014'].every((tracking) => confirmed.lines.find((line) => line.trackingNumber === tracking)?.courierKey === 'UNKNOWN'))
check('Confirmed dispatch cannot be edited', db.updateDispatch(draft!.id, { dispatchDate: '2026-09-13' }) === false && snap().dispatches.find((row) => row.id === draft!.id)?.dispatchDate === '2026-09-12')
check('Temperature is not stored', !('temperature' in confirmed))

const second = db.createDispatch({ dispatchDate: '2026-09-12', vehicleId: v002!.id })
check('The same shipment cannot join a second confirmed dispatch', db.updateDispatch(second!.id, { lines: [{ shipmentId: spx.id, courierKey: 'SPX', parcelQty: 1 }] }) === false)
const other = shipments().find((row) => row.trackingNumber === 'SPXMY300001')!
check('A free shipment can join the second vehicle', db.updateDispatch(second!.id, { lines: [{ shipmentId: other.id, courierKey: 'GDEX', parcelQty: 4 }] }) && db.confirmDispatch(second!.id))

db.updateVehicle(v001!.id, { code: 'V001', vehicleType: 'Bus', plateNumber: 'JQK 9999' })
const september = buildPjkm911({ month: '2026-09', dispatches: snap().dispatches })
const firstRow = september.rows.find((row) => row.dispatchId === draft!.id)
const secondRow = september.rows.find((row) => row.dispatchId === second!.id)
check('September keeps the snapshotted plate', firstRow?.plateNumber === 'JQK 1234' && firstRow.vehicleType === 'Van')
check('Same date with two vehicles is two rows', september.rows.filter((row) => row.dateKey === '2026-09-12').length === 2)
check('One vehicle keeps several couriers on one row', firstRow?.counts.JNT === 1 && firstRow.counts.SPX === 2 && firstRow.counts.INSTANT === 1 && (firstRow.counts.UNKNOWN ?? 0) === 3)
check('TOTAL AWB and parcel quantity use the snapshot', firstRow?.totalAwb === 7 && firstRow.parcelQty === 8)
check('GDEX appears from the second dispatch', secondRow?.counts.GDEX === 1 && secondRow.parcelQty === 4 && secondRow.plateNumber === 'JTR 5678')
check('Courier columns follow the fixed order and hide unused couriers', september.columns.join(',') === 'JNT,SPX,GDEX,INSTANT,UNKNOWN')
check('October does not show September couriers', buildPjkm911({ month: '2026-10', dispatches: snap().dispatches }).columns.length === 0)

const october = db.createDispatch({ dispatchDate: '2026-10-02', vehicleId: v001!.id })
const octoberShipment = shipments().find((row) => row.trackingNumber === 'SPXMY300002')!
db.updateDispatch(october!.id, { lines: [{ shipmentId: octoberShipment.id, courierKey: 'GDEX', parcelQty: 1 }] })
db.confirmDispatch(october!.id)
const octoberReport = buildPjkm911({ month: '2026-10', dispatches: snap().dispatches })
check('October shows GDEX and September does not gain it as a new row', octoberReport.columns.join(',') === 'GDEX' && buildPjkm911({ month: '2026-09', dispatches: snap().dispatches }).rows.length === 2)

check('Void removes the dispatch from PJKM and releases the shipment', db.voidDispatch(second!.id) === true && !buildPjkm911({ month: '2026-09', dispatches: snap().dispatches }).rows.some((row) => row.dispatchId === second!.id))
const reused = db.createDispatch({ dispatchDate: '2026-09-20', vehicleId: v002!.id })
check('A voided shipment can be dispatched again', db.updateDispatch(reused!.id, { lines: [{ shipmentId: other.id, courierKey: 'POS', parcelQty: 1 }] }) && db.confirmDispatch(reused!.id))
check('Draft dispatch is excluded', buildPjkm911({ month: '2026-09', dispatches: [{ ...confirmed, status: 'draft', lines: confirmed.lines }] }).rows.length === 0)

const longRows = Array.from({ length: 40 }, (_, index) => ({
  dispatchId: `long-${index}`,
  dateKey: '2026-09-01',
  dateLabel: '1-Sep-2026',
  counts: { SPX: 1 },
  totalAwb: 1,
  parcelQty: 1,
  vehicleType: 'Van',
  plateNumber: 'JQK 1234',
  condition: 'BAIK' as const,
}))
const packed = paginatePjkm911(longRows, ['SPX'])
const forced = paginatePjkm911(longRows, ['SPX'], { firstMm: 8, nextMm: 8 })
check('A short report stays on one page and a long report continues', packed.length === 1 && forced.length > 1 && forced[0].label === `1 of ${forced.length}` && forced.at(-1)?.label === `${forced.length} of ${forced.length}`)
const css = readFileSync('src/features/pjkm/pjkm911.css', 'utf8')
check('Print layout is A4 portrait', css.includes('size: A4 portrait') && !css.includes('landscape') && css.includes('Page') === false)
check('Header uses MGT/09 and the inspection title', readFileSync('src/features/pjkm/pjkm911.ts', 'utf8').includes('MGT/09') && readFileSync('src/features/pjkm/pjkm911.ts', 'utf8').includes('REKOD PEMERIKSAAN KENDERAAN') && readFileSync('src/features/pjkm/pjkm911.ts', 'utf8').includes('01 April 2024'))
check('Column order helper does not sort alphabetically', activeCourierColumns([{ counts: { UNKNOWN: 1, GDEX: 1, JNT: 1 } }]).join(',') === 'JNT,GDEX,UNKNOWN')
check('Suhu stays blank in the row model', firstRow != null && !('suhu' in firstRow))

const line: DispatchLine = confirmed.lines[0]
check('Snapshot line keeps the tracking number', line.trackingNumber.length > 0)

const failed = results.filter((row) => !row.ok)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
