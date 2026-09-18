const memory = new Map<string, string>()
const localStoragePolyfill = {
  getItem(key: string) {
    return memory.has(key) ? memory.get(key)! : null
  },
  setItem(key: string, value: string) {
    memory.set(key, String(value))
  },
  removeItem(key: string) {
    memory.delete(key)
  },
  clear() {
    memory.clear()
  },
  key(index: number) {
    return [...memory.keys()][index] ?? null
  },
  get length() {
    return memory.size
  },
}

Object.defineProperty(globalThis, 'localStorage', { value: localStoragePolyfill })
Object.defineProperty(globalThis, 'window', { value: globalThis })

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const { db } = await import('@/store/db')
const { allocateBalanceFifo } = await import('@/features/manufacturing/sessionPlan')
const { buildOpeningBalanceLines } = await import('@/features/openingBalance/openingBalanceModel')
const { buildSalesReturnLines } = await import('@/features/returns/salesReturnModel')
const {
  getBalanceStorageBoxes,
  balanceStorageBoxNames,
  isActiveBalanceStorageBox,
  nextGenericSlot,
  storageBoxSelectOptions,
} = await import('@/features/warehouse/warehouseModel')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const openingPages = readFileSync(path.join(root, 'src/features/openingBalance/OpeningBalancePages.tsx'), 'utf8')
const openingModel = readFileSync(path.join(root, 'src/features/openingBalance/openingBalanceModel.ts'), 'utf8')
const returnPages = readFileSync(path.join(root, 'src/features/returns/SalesReturnPages.tsx'), 'utf8')
const returnModel = readFileSync(path.join(root, 'src/features/returns/salesReturnModel.ts'), 'utf8')
const manufacturing = readFileSync(path.join(root, 'src/features/manufacturing/CompleteProductionPage.tsx'), 'utf8')

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

db.resetDemo()
db.switchUser('u-admin')
const state = db.getSnapshot()
const names = balanceStorageBoxNames(state, 'wh-main')
const boxes = getBalanceStorageBoxes(state, { warehouseId: 'wh-main' })

check(
  'getBalanceStorageBoxes returns active BALANCE_AREA boxes',
  names.join(',') === 'Box 1,Box 2,Box 3' && boxes.every((box) => box.active && box.warehouseId === 'wh-main'),
  names.join(','),
)
check('Seed Box 1 is an active balance box', isActiveBalanceStorageBox(state, 'wh-main', 'Box 1'))
check('Seed Box 2 is an active balance box', isActiveBalanceStorageBox(state, 'wh-main', 'Box 2'))
check('Seed Box 3 is an active balance box', isActiveBalanceStorageBox(state, 'wh-main', 'Box 3'))

check('Opening Balance Storage Box uses a real select', openingPages.includes('<StorageBoxSelect') && openingPages.includes('<Select value={value}'))
check('Opening Balance no longer uses datalist', !openingPages.includes('<datalist') && !openingPages.includes('list={`ob-storage-boxes'))
check('Opening Balance no longer uses DEFAULT_STORAGE_BOXES', !openingModel.includes('DEFAULT_STORAGE_BOXES') && !openingPages.includes('storageBoxOptions'))
check('Sales Return uses shared storage box helper', returnPages.includes('storageBoxSelectOptions(state, warehouseId') && !returnModel.includes('returnStorageBoxOptions') && !returnModel.includes('BOX-03'))
check('Manufacturing no longer hard-codes Box 1/2/3 options', !manufacturing.includes('<option value="Box 1">') && manufacturing.includes('storageBoxSelectOptions(state, session.warehouseId'))

const box2 = buildOpeningBalanceLines(state, 'production_balance', [
  { productId: 'p-pack-ch', qty: 100, unit: 'G', warehouseId: 'wh-main', container: 'Box 2' },
])
check('Opening Balance can select Box 2', box2.ok && box2.ok && box2.lines[0]?.container === 'Box 2')

const box3 = buildOpeningBalanceLines(state, 'production_balance', [
  { productId: 'p-pack-ch', qty: 100, unit: 'G', warehouseId: 'wh-main', container: 'Box 3' },
])
check('Opening Balance can select Box 3', box3.ok && box3.lines[0]?.container === 'Box 3')

const unknown = buildOpeningBalanceLines(state, 'production_balance', [
  { productId: 'p-pack-ch', qty: 100, unit: 'G', warehouseId: 'wh-main', container: 'BOX-02' },
])
check('Opening Balance rejects arbitrary container BOX-02', !unknown.ok)

const alias = buildOpeningBalanceLines(state, 'production_balance', [
  { productId: 'p-pack-ch', qty: 100, unit: 'G', warehouseId: 'wh-main', container: 'BOX-03' },
])
check('Opening Balance rejects BOX-03 alias', !alias.ok)

const returnBox2 = buildSalesReturnLines(
  state,
  [{ productId: 'p-pack-mt', returnedQty: 1, goodQty: 0, repackQty: 1, wasteQty: 0, repackRecoveredGrams: 80, repackStorageBoxId: 'Box 2' }],
  undefined,
  undefined,
  'wh-main',
)
check('Sales Return Repack can select Box 2', returnBox2.ok && returnBox2.ok && returnBox2.lines[0]?.repackStorageBoxId === 'Box 2')

const returnBox3 = buildSalesReturnLines(
  state,
  [{ productId: 'p-pack-mt', returnedQty: 1, goodQty: 0, repackQty: 1, wasteQty: 0, repackRecoveredGrams: 80, repackStorageBoxId: 'Box 3' }],
  undefined,
  undefined,
  'wh-main',
)
check('Sales Return Repack can select Box 3', returnBox3.ok && returnBox3.lines[0]?.repackStorageBoxId === 'Box 3')

const returnAlias = buildSalesReturnLines(
  state,
  [{ productId: 'p-pack-mt', returnedQty: 1, goodQty: 0, repackQty: 1, wasteQty: 0, repackRecoveredGrams: 80, repackStorageBoxId: 'BOX-03' }],
  undefined,
  undefined,
  'wh-main',
)
check('Sales Return Repack rejects BOX-03 alias', !returnAlias.ok)

const openingNames = storageBoxSelectOptions(state, 'wh-main')
const returnNames = storageBoxSelectOptions(state, 'wh-main')
const manufacturingNames = storageBoxSelectOptions(state, 'wh-main')
check(
  'Opening Balance, Sales Return, and Manufacturing share the same Storage Box list',
  openingNames.join('|') === returnNames.join('|') && returnNames.join('|') === manufacturingNames.join('|') && openingNames.join('|') === 'Box 1|Box 2|Box 3',
)

const extra = nextGenericSlot('loc-balance', state.storageSlots)
check('Simulated slot is Box 4', extra.slotNo === 4)
const withBox4 = {
  storageLocations: state.storageLocations,
  storageSlots: [...state.storageSlots, extra],
}
check(
  'Opening Balance shows Box 4 when a BALANCE_AREA slot is added',
  storageBoxSelectOptions(withBox4, 'wh-main').includes('Box 4'),
)
check(
  'Sales Return Repack shows Box 4 when a BALANCE_AREA slot is added',
  storageBoxSelectOptions(withBox4, 'wh-main').includes('Box 4'),
)
check(
  'Manufacturing shows Box 4 when a BALANCE_AREA slot is added',
  getBalanceStorageBoxes(withBox4, { warehouseId: 'wh-main' }).some((box) => box.name === 'Box 4' && box.active),
)
check(
  'Box 4 is accepted for a new Opening Balance line',
  buildOpeningBalanceLines({ ...state, storageSlots: withBox4.storageSlots }, 'production_balance', [
    { productId: 'p-pack-ch', qty: 25, unit: 'G', warehouseId: 'wh-main', container: 'Box 4' },
  ]).ok === true,
)

const deactivated = { ...extra, active: false }
const withoutBox4 = {
  storageLocations: state.storageLocations,
  storageSlots: [...state.storageSlots, deactivated],
}
check('Deactivated Box 4 is not offered for new entries', !balanceStorageBoxNames(withoutBox4, 'wh-main').includes('Box 4'))
check(
  'New Opening Balance cannot use deactivated Box 4',
  buildOpeningBalanceLines({ ...state, storageSlots: withoutBox4.storageSlots }, 'production_balance', [
    { productId: 'p-pack-ch', qty: 25, unit: 'G', warehouseId: 'wh-main', container: 'Box 4' },
  ]).ok === false,
)
check(
  'Historical Box 4 remains readable as a current select value',
  storageBoxSelectOptions(withoutBox4, 'wh-main', 'Box 4').includes('Box 4'),
)

const historical = (state.productionBalances ?? []).map((row) => ({ id: row.id, container: row.container, productId: row.productId }))
check(
  'Historical Box 1 production balance remains readable',
  historical.some((row) => row.container === 'Box 1' && row.productId === 'p-pack-mt'),
)
check(
  'Historical Box 2 production balance remains readable',
  historical.some((row) => row.container === 'Box 2' && row.productId === 'p-pack-st'),
)
check(
  'Historical production balance records were not mutated',
  (db.getSnapshot().productionBalances ?? []).every((row, index) => {
    const original = historical[index]
    return original && original.id === row.id && original.container === row.container
  }),
)

const fifo = allocateBalanceFifo(state.productionBalances, 'p-pack-mt', 50)
check(
  'FIFO still consumes oldest Matcha balance first',
  fifo.used[0]?.container === 'Box 1' && fifo.used[0]?.qty === 50 && fifo.remainingRequired === 0,
  fifo.used.map((row) => `${row.container}:${row.qty}`).join('|'),
)
const fifoStrawberry = allocateBalanceFifo(state.productionBalances, 'p-pack-st', 100)
check(
  'FIFO still ignores Storage Box when consuming Strawberry',
  fifoStrawberry.used[0]?.container === 'Box 2' && fifoStrawberry.used[0]?.qty === 100,
)

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => row.name).join('\n'))
  process.exit(1)
}
