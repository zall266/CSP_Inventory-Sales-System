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
import { activeCourierColumns, courierKeyFromSource, dispatchAwbTotals, validateDispatchLines, validateInspectionGroup } from '@/features/dispatch/dispatchModel'
import { PJKM_911, PJKM_911_DETAILS, buildPjkm911, paginatePjkm911, pjkm911DetailValue, pjkm911Widths, type Pjkm911Block } from '@/features/pjkm/pjkm911'
import type { TextItem } from '@/features/salesImport/parsePickingList'
import { db } from '@/store/db'
import type { DispatchLine, DispatchRecord } from '@/types'

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
const september = buildPjkm911({ month: '2026-09', dispatches: snap().dispatches, groups: snap().inspectionGroups })
const firstBlock = september.blocks.find((block) => block.dispatchIds.includes(draft!.id))
const secondBlock = september.blocks.find((block) => block.dispatchIds.includes(second!.id))
check('September keeps the snapshotted plate', firstBlock?.cells.JNT?.plateNumber === 'JQK 1234' && firstBlock.cells.JNT.vehicleType === 'Van')
check('Ungrouped dispatches on the same date stay separate blocks', september.blocks.filter((block) => block.dateKey === '2026-09-12').length === 2)
check('One vehicle keeps several couriers on one block', firstBlock?.cells.JNT?.parcelQty === 1 && firstBlock.cells.SPX?.parcelQty === 2 && firstBlock.cells.INSTANT?.parcelQty === 2 && firstBlock.cells.UNKNOWN?.parcelQty === 3)
check('TOTAL AWB counts distinct tracking numbers and parcels stay per courier', firstBlock?.totalAwb === 7 && Object.values(firstBlock.cells).reduce((sum, cell) => sum + cell.parcelQty, 0) === 8)
check('GDEX appears from the second dispatch', secondBlock?.cells.GDEX?.parcelQty === 4 && secondBlock.cells.GDEX.plateNumber === 'JTR 5678' && secondBlock.cells.GDEX.vehicleType === 'Lorry')
check('Courier columns follow the fixed order and hide unused couriers', september.columns.join(',') === 'JNT,SPX,GDEX,INSTANT,UNKNOWN')
check('October does not show September couriers', buildPjkm911({ month: '2026-10', dispatches: snap().dispatches }).columns.length === 0)
check('BULAN and TAHUN are separate', september.bulan === 'SEP' && september.tahun === '2026')
check('TARIKH uses the Bil sequence', september.blocks.map((block) => block.bil).join(',') === '1,2')

const october = db.createDispatch({ dispatchDate: '2026-10-02', vehicleId: v001!.id })
const octoberShipment = shipments().find((row) => row.trackingNumber === 'SPXMY300002')!
db.updateDispatch(october!.id, { lines: [{ shipmentId: octoberShipment.id, courierKey: 'GDEX', parcelQty: 1 }] })
db.confirmDispatch(october!.id)
const octoberReport = buildPjkm911({ month: '2026-10', dispatches: snap().dispatches, groups: snap().inspectionGroups })
check('October shows GDEX and September does not gain it as a new block', octoberReport.columns.join(',') === 'GDEX' && buildPjkm911({ month: '2026-09', dispatches: snap().dispatches }).blocks.length === 2)

check('Void removes the dispatch from PJKM and releases the shipment', db.voidDispatch(second!.id) === true && !buildPjkm911({ month: '2026-09', dispatches: snap().dispatches }).blocks.some((block) => block.dispatchIds.includes(second!.id)))
const reused = db.createDispatch({ dispatchDate: '2026-09-20', vehicleId: v002!.id })
check('A voided shipment can be dispatched again', db.updateDispatch(reused!.id, { lines: [{ shipmentId: other.id, courierKey: 'POS', parcelQty: 1 }] }) && db.confirmDispatch(reused!.id))
check('Draft dispatch is excluded', buildPjkm911({ month: '2026-09', dispatches: [{ ...confirmed, status: 'draft', lines: confirmed.lines }] }).blocks.length === 0)
check('A voided dispatch cannot be grouped', validateInspectionGroup(snap().dispatches, [second!.id]) === 'A voided dispatch cannot join an inspection group.')

function sampleBlock(id: string, plate = 'JQK 1234'): Pjkm911Block {
  return { id, bil: 1, dateKey: '2026-09-01', cells: { SPX: { parcelQty: 1, vehicleType: 'Van', plateNumber: plate } }, totalAwb: 1, dispatchIds: [id] }
}
const period = { bulan: 'SEP', tahun: '2026' }
const shortBlocks = [sampleBlock('one')]
const longBlocks = Array.from({ length: 12 }, (_, index) => sampleBlock(`long-${index}`))
const packed = paginatePjkm911(shortBlocks, ['SPX'], period)
const forced = paginatePjkm911(longBlocks, ['SPX'], period, { firstMm: 40, nextMm: 40 })
const forcedIds = forced.flatMap((page) => page.blocks.map((block) => block.id))
check('A short report stays on one page and a long report continues by whole blocks', packed.length === 1 && forced.length > 1 && forced.every((page) => page.blocks.length > 0) && forcedIds.length === longBlocks.length && new Set(forcedIds).size === longBlocks.length)
check('Page labels stay in order', forced[0].label === `1 of ${forced.length}` && forced.at(-1)?.label === `${forced.length} of ${forced.length}` && forced.every((page) => page.columns.join(',') === 'SPX'))
const pair = paginatePjkm911([sampleBlock('a'), sampleBlock('b')], ['SPX'], period, { firstMm: 40, nextMm: 40 })
check('A block that does not fit moves entirely to the next page', pair.length === 2 && pair[0].blocks.length === 1 && pair[1].blocks.length === 1)
const huge = paginatePjkm911([sampleBlock('huge', 'PLATE'.repeat(30)), sampleBlock('after')], ['SPX'], period, { firstMm: 5, nextMm: 5 })
check('An oversized block is kept whole', huge[0].blocks.length === 1 && huge[0].blocks[0].id === 'huge' && huge[1]?.blocks[0].id === 'after')
const css = readFileSync('src/features/pjkm/pjkm911.css', 'utf8')
const printCss = readFileSync('src/index.css', 'utf8')
const pageSource = readFileSync('src/features/pjkm/Pjkm911Page.tsx', 'utf8')
check('Print layout is A4 portrait', css.includes('size: A4 portrait') && !css.includes('landscape') && css.includes('Page') === false)
check('Footer page numbers come from the shared print rule', printCss.includes("content: 'Page ' counter(page) ' of ' counter(pages)"))
check('Main title matches the template', PJKM_911.title === 'REKOD 9.1.1 : REKOD PEMERIKSAAN KENDERAAN')
check('Header names the distribution control and subtopic', PJKM_911.control === 'KAWALAN PENGEDARAN DAN PENGANGKUTAN' && PJKM_911.subtopic === 'SUB TOPIK : PEMERIKSAAN KENDERAAN')
check('Document box keeps MGT/09, 1 Apr 2024, and version 1', PJKM_911.documentNo === 'MGT/09' && PJKM_911.effectiveDate === '1 Apr 2024' && PJKM_911.version === '1')
check('The sheet repeats the table header and merges Bil and TOTAL AWB', pageSource.includes('TARIKH') && pageSource.includes('BUTIRAN') && pageSource.includes('rowSpan={PJKM_911_DETAILS.length}') && pageSource.includes('BULAN :'))
check('BUTIRAN rows are the five template labels', PJKM_911_DETAILS.map((detail) => detail.lines.join(' ')).join('|') === 'QUANTITI PARCEL|JENIS KENDERAAN|PLATE NUMBER|SUHU KENDERAAN|KEADAAN')
const eight = pjkm911Widths(8)
const nine = pjkm911Widths(9)
check('Eight couriers and UNKNOWN stay inside the portrait width', eight.tarikh + eight.butiran + eight.courier * 8 + eight.total <= 186.01 && nine.tarikh + nine.butiran + nine.courier * 9 + nine.total <= 186.01)
check('Column order helper does not sort alphabetically', activeCourierColumns([{ counts: { UNKNOWN: 1, GDEX: 1, JNT: 1 } }]).join(',') === 'JNT,GDEX,UNKNOWN')
check('Temperature stays blank and an active courier is BAIK', firstBlock != null && pjkm911DetailValue(firstBlock, 'JNT', 'suhu') === '' && pjkm911DetailValue(firstBlock, 'JNT', 'condition') === 'BAIK' && pjkm911DetailValue(firstBlock, 'FLASH', 'condition') === '')
check('Grid text stays at a readable size', css.includes('font-size: 8px') && !css.includes('font-size: 5px') && !css.includes('font-size: 6px'))

const line: DispatchLine = confirmed.lines[0]
check('Snapshot line keeps the tracking number', line.trackingNumber.length > 0)

function track(orderId: string, tracking: string) {
  ingest(label(orderId, ['SPX', 'Express', tracking]))
  return byTracking(tracking)!
}
const loriA = db.createVehicle({ code: 'L001', vehicleType: 'LORI', plateNumber: 'VEK 7187' })
const loriB = db.createVehicle({ code: 'L002', vehicleType: 'LORI', plateNumber: 'VQM 6404' })
const loriC = db.createVehicle({ code: 'L003', vehicleType: 'LORI', plateNumber: 'BPW 4063' })
const vanD = db.createVehicle({ code: 'L004', vehicleType: 'VAN', plateNumber: 'VEK 7192' })
const jntOne = track('260911AAAAAAA1', 'SPXMY910001')
const jntTwo = track('260911AAAAAAA2', 'SPXMY910002')
const spxGroup = track('260911AAAAAAA3', 'SPXMY910003')
const gdexGroup = track('260911AAAAAAA4', 'SPXMY910004')
const instantGroup = track('260911AAAAAAA5', 'SPXMY910005')
const jntLater = track('260911AAAAAAA6', 'SPXMY910006')
const jntOther = track('260911AAAAAAA7', 'SPXMY910007')
function confirmLines(date: string, vehicleId: string, lines: Array<{ shipmentId: string; courierKey: DispatchLine['courierKey']; parcelQty: number }>) {
  const created = db.createDispatch({ dispatchDate: date, vehicleId })
  if (!created || !db.updateDispatch(created.id, { lines }) || !db.confirmDispatch(created.id)) return null
  return snap().dispatches.find((row) => row.id === created.id) ?? null
}
const groupedJnt = confirmLines('2026-11-12', loriA!.id, [
  { shipmentId: jntOne.id, courierKey: 'JNT', parcelQty: 10 },
  { shipmentId: jntTwo.id, courierKey: 'JNT', parcelQty: 16 },
])
const groupedSpx = confirmLines('2026-11-12', loriB!.id, [{ shipmentId: spxGroup.id, courierKey: 'SPX', parcelQty: 79 }])
const groupedGdex = confirmLines('2026-11-12', loriC!.id, [{ shipmentId: gdexGroup.id, courierKey: 'GDEX', parcelQty: 1 }])
const standaloneInstant = confirmLines('2026-11-12', vanD!.id, [{ shipmentId: instantGroup.id, courierKey: 'INSTANT', parcelQty: 2 }])
const draftGroup = db.createDispatch({ dispatchDate: '2026-11-12', vehicleId: loriA!.id })
check('A draft dispatch cannot be grouped', validateInspectionGroup(snap().dispatches, [draftGroup!.id, groupedJnt!.id]) === 'A draft dispatch cannot join an inspection group.')
check('Different dates cannot share a group', validateInspectionGroup(snap().dispatches, [groupedJnt!.id, confirmed.id]) === 'Inspection Group must contain Dispatch records from the same date.')
const group = db.createInspectionGroup([groupedJnt!.id, groupedSpx!.id, groupedGdex!.id])
check('Three dispatches with different vehicles become one group', group?.groupNo === 'IG-0001' && group.dispatchDate === '2026-11-12')
check('An already grouped dispatch cannot be grouped again', db.createInspectionGroup([groupedJnt!.id, standaloneInstant!.id]) === null && validateInspectionGroup(snap().dispatches, [groupedJnt!.id, standaloneInstant!.id]) === 'That dispatch is already in an inspection group.')
const november = buildPjkm911({ month: '2026-11', dispatches: snap().dispatches, groups: snap().inspectionGroups })
const groupedBlock = november.blocks.find((block) => block.id === group!.id)
check('Grouped dispatches render as one Bil and an ungrouped dispatch stays separate', november.blocks.length === 2 && groupedBlock?.dispatchIds.length === 3 && november.blocks.some((block) => block.dispatchIds.length === 1 && block.dispatchIds[0] === standaloneInstant!.id))
check('Parcel, vehicle, and plate stay with each courier', groupedBlock?.cells.JNT?.parcelQty === 26 && groupedBlock.cells.JNT.vehicleType === 'LORI' && groupedBlock.cells.JNT.plateNumber === 'VEK 7187' && groupedBlock.cells.SPX?.parcelQty === 79 && groupedBlock.cells.SPX.plateNumber === 'VQM 6404' && groupedBlock.cells.GDEX?.parcelQty === 1 && groupedBlock.cells.GDEX.vehicleType === 'LORI')
check('TOTAL AWB counts the grouped tracking numbers once each', groupedBlock?.totalAwb === 4)
const blankReport = buildPjkm911({
  month: '2026-07',
  dispatches: [{
    id: 'blank-dispatch',
    status: 'confirmed',
    dispatchDate: '2026-07-04',
    confirmedAt: '2026-07-04T00:00:00.000Z',
    createdAt: '2026-07-04T00:00:00.000Z',
    vehicleType: 'VAN',
    plateNumber: 'BLK 1',
    lines: [
      { shipmentId: 'b1', trackingNumber: 'KEEP-1', courierKey: 'POS', parcelQty: 2 },
      { shipmentId: 'b2', trackingNumber: 'KEEP-1', courierKey: 'POS', parcelQty: 3 },
      { shipmentId: 'b3', trackingNumber: '   ', courierKey: 'POS', parcelQty: 4 },
    ],
  } as DispatchRecord],
})
check('A blank tracking number does not increase TOTAL AWB and duplicate tracking counts once', blankReport.blocks[0]?.totalAwb === 1 && blankReport.blocks[0].cells.POS?.parcelQty === 9)
check('Condition is BAIK only on couriers in the Bil', groupedBlock != null && pjkm911DetailValue(groupedBlock, 'JNT', 'condition') === 'BAIK' && pjkm911DetailValue(groupedBlock, 'SPX', 'suhu') === '' && pjkm911DetailValue(groupedBlock, 'INSTANT', 'condition') === '')
check('November columns omit couriers that are not in the month', november.columns.join(',') === 'JNT,SPX,GDEX,INSTANT')
db.updateVehicle(loriA!.id, { code: 'L001', vehicleType: 'BUS', plateNumber: 'VEK 9999' })
const afterVehicleEdit = buildPjkm911({ month: '2026-11', dispatches: snap().dispatches, groups: snap().inspectionGroups }).blocks.find((block) => block.id === group!.id)
check('A later vehicle edit does not change the grouped snapshot', afterVehicleEdit?.cells.JNT?.plateNumber === 'VEK 7187' && afterVehicleEdit.cells.JNT.vehicleType === 'LORI')
const laterJnt = confirmLines('2026-11-13', loriA!.id, [{ shipmentId: jntLater.id, courierKey: 'JNT', parcelQty: 3 }])
const otherJnt = confirmLines('2026-11-13', loriB!.id, [{ shipmentId: jntOther.id, courierKey: 'JNT', parcelQty: 4 }])
check('The same courier cannot be added twice', db.createInspectionGroup([laterJnt!.id, otherJnt!.id]) === null && validateInspectionGroup(snap().dispatches, [laterJnt!.id, otherJnt!.id]).includes('Courier JNT already exists'))
const separate = buildPjkm911({ month: '2026-11', dispatches: snap().dispatches, groups: snap().inspectionGroups })
check('The same courier on two vehicles stays two Bils', separate.blocks.filter((block) => block.dateKey === '2026-11-13').length === 2 && separate.blocks.filter((block) => block.cells.JNT).length === 3)
check('Releasing a group returns each dispatch to its own Bil', db.releaseInspectionGroup(group!.id) === true && buildPjkm911({ month: '2026-11', dispatches: snap().dispatches, groups: snap().inspectionGroups }).blocks.filter((block) => block.dateKey === '2026-11-12').length === 4)
const mixed = {
  id: 'mixed',
  status: 'confirmed' as const,
  dispatchDate: '2026-08-12',
  confirmedAt: '2026-08-12T01:00:00.000Z',
  createdAt: '2026-08-12T01:00:00.000Z',
  vehicleType: 'LORI',
  plateNumber: 'MIX 1000',
  inspectionGroupId: 'ig-mixed',
  lines: [
    { shipmentId: 'm1', trackingNumber: 'MIX-JNT', courierKey: 'JNT' as const, parcelQty: 4 },
    { shipmentId: 'm2', trackingNumber: 'MIX-SPX', courierKey: 'SPX' as const, parcelQty: 6 },
  ],
}
const partner = {
  ...mixed,
  id: 'partner',
  confirmedAt: '2026-08-12T02:00:00.000Z',
  vehicleType: 'VAN',
  plateNumber: 'MIX 2000',
  lines: [{ shipmentId: 'm3', trackingNumber: 'MIX-GDEX', courierKey: 'GDEX' as const, parcelQty: 1 }],
}
const august = buildPjkm911({ month: '2026-08', dispatches: [mixed, partner] as DispatchRecord[] })
check('One dispatch can fill two courier columns in the same Bil', august.blocks.length === 1 && august.blocks[0].cells.JNT?.plateNumber === 'MIX 1000' && august.blocks[0].cells.SPX?.plateNumber === 'MIX 1000' && august.blocks[0].cells.GDEX?.plateNumber === 'MIX 2000' && august.blocks[0].totalAwb === 3)
check('PJKM 5.1.1 and 10.1.1 files were not edited for this layout', !readFileSync('src/features/pjkm/pjkm511.ts', 'utf8').includes('inspectionGroupId') && !readFileSync('src/features/pjkm/pjkm1011.ts', 'utf8').includes('inspectionGroupId'))

const failed = results.filter((row) => !row.ok)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
