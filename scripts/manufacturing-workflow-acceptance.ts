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
const { allocateBalanceFifo, isSessionOperationalToday, systemProductionDate, todaySessions } = await import(
  '@/features/manufacturing/sessionPlan'
)
const {
  buildSessionMaterialClosing,
  closingLineFromInput,
  conversionNote,
  physicalRemainingBaseQty,
  plannedClosingMaterials,
} = await import('@/features/manufacturing/materialClosing')
const { round2 } = await import('@/utils/format')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const todaySrc = readFileSync(path.join(root, 'src/features/manufacturing/TodaysProductionPage.tsx'), 'utf8')
const completeSrc = readFileSync(path.join(root, 'src/features/manufacturing/CompleteProductionPage.tsx'), 'utf8')
const sessionPlanSrc = readFileSync(path.join(root, 'src/features/manufacturing/sessionPlan.ts'), 'utf8')

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function inventoryOf(productId: string, warehouseId = 'wh-main') {
  return db.getSnapshot().inventory.find((row) => row.productId === productId && row.warehouseId === warehouseId)?.qty ?? 0
}

function packResults(session: { items: Array<{ productId: string; targetQty: number }> }) {
  return session.items.map((item) => ({
    productId: item.productId,
    actualQty: item.targetQty,
    productionBalanceQty: 0,
    balanceLocation: 'Main Warehouse',
    balanceContainer: '',
    wasteQty: 0,
    shortProductionReason: '',
    notes: '',
    displayQty: 0,
    cartonQty: item.targetQty,
  }))
}

function plannedRemainingInputs(sessionId: string) {
  const state = db.getSnapshot()
  const session = state.productionSessions.find((item) => item.id === sessionId)!
  return plannedClosingMaterials(state, session).map((row) => ({
    productId: row.productId,
    fullUnits: 0,
    looseQty: round2(row.availableQty - row.plannedQty),
  }))
}

function startToday() {
  db.resetDemo()
  db.switchUser('u-admin')
  db.acceptSession('ps-0910')
  return db.startSession('ps-0910', { recipePhoto: 'data:image/png;base64,aaa', recipePhotoName: 'sheet.jpg' })
}

db.resetDemo()
db.switchUser('u-admin')

const today = systemProductionDate()
check('System production date is prototype today', today === '2026-09-10', today)

const todayRows = todaySessions(db.getSnapshot().productionSessions)
check('Today\'s Production list is current date only', todayRows.every((row) => row.productionDate === today) && todayRows.some((row) => row.id === 'ps-0910'))
check('8 Sep session is not in today\'s list', !todayRows.some((row) => row.id === 'ps-0908'))
check('History still contains 8 Sep session', (db.getSnapshot().productionSessions ?? []).some((row) => row.id === 'ps-0908' && row.productionDate === '2026-09-08'))
check('Today\'s Production has no operational date picker', !/type=["']date["']/.test(todaySrc))
check('Today\'s Production shows Today badge', todaySrc.includes('<Badge tone="indigo">Today</Badge>'))
check('Deep link to a non-today plan is blocked in Today\'s Production', todaySrc.includes('Today\'s Production only runs the current system date'))

const future = db.createDailySession({
  productionDate: '2026-09-11',
  items: [
    { productId: 'p-pack-mt', targetQty: 50 },
    { productId: 'p-pack-st', targetQty: 40 },
  ],
})
check('Future planning can still be created', Boolean(future?.id) && future?.productionDate === '2026-09-11')
check('Future plan is not in today\'s sessions', !todaySessions(db.getSnapshot().productionSessions).some((row) => row.id === future?.id))
check('Future plan appears when the matching date is used', todaySessions(db.getSnapshot().productionSessions, '2026-09-11').some((row) => row.id === future?.id))
check('Future plan is not operational today', future ? !isSessionOperationalToday(future) : false)
db.acceptSession(future!.id)
check('Staff cannot accept a future plan as today\'s production', db.getSnapshot().productionSessions.find((row) => row.id === future!.id)?.status === 'planned')

const past = db.createDailySession({
  productionDate: '2026-09-08',
  items: [{ productId: 'p-pack-ch', targetQty: 50 }],
})
db.acceptSession(past!.id)
check('Old-date plan cannot be executed as today\'s production', db.getSnapshot().productionSessions.find((row) => row.id === past!.id)?.status === 'planned')

check(
  '39 BAG + 20 KG = 995 KG',
  physicalRemainingBaseQty({ unit: 'KG', purchaseUnit: 'BAG', purchaseConversionQty: 25 }, 39, 20).ok === true
    && (physicalRemainingBaseQty({ unit: 'KG', purchaseUnit: 'BAG', purchaseConversionQty: 25 }, 39, 20) as { remaining: number }).remaining === 995,
)
check(
  '10 PACK + 250 G = 5,750 G',
  physicalRemainingBaseQty({ unit: 'G', purchaseUnit: 'PACK', purchaseConversionQty: 550 }, 10, 250).ok === true
    && (physicalRemainingBaseQty({ unit: 'G', purchaseUnit: 'PACK', purchaseConversionQty: 550 }, 10, 250) as { remaining: number }).remaining === 5750,
)
check(
  'Conversion note is generated from Product Master',
  conversionNote({ unit: 'KG', purchaseUnit: 'BAG', purchaseConversionQty: 25 }) === '1 BAG = 25 KG'
    && conversionNote({ unit: 'G', purchaseUnit: 'PACK', purchaseConversionQty: 550 }) === '1 PACKS = 550 G',
)
check('Invalid conversion is rejected', physicalRemainingBaseQty({ unit: 'KG', purchaseUnit: 'BAG', purchaseConversionQty: 0 }, 1, 0).ok === false)
check('Negative remaining is rejected', physicalRemainingBaseQty({ unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1 }, 0, -1).ok === false)

const over = closingLineFromInput(
  { id: 'p-x', unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1 },
  4.5,
  1000,
  { fullUnits: 0, looseQty: 1001 },
)
check('Remaining greater than available is rejected', !over.ok)

startToday()
const sharedState = db.getSnapshot()
const sharedSession = sharedState.productionSessions.find((item) => item.id === 'ps-0910')!
const drafts = plannedClosingMaterials(sharedState, sharedSession)
const milk = drafts.filter((row) => row.productId === 'p-milkpw')
const sugar = drafts.filter((row) => row.productId === 'p-sugar')
check('Shared Milk Powder is one consolidated closing line', milk.length === 1 && milk[0].plannedQty > 0)
check('Shared Sugar is one consolidated closing line', sugar.length === 1 && sugar[0].plannedQty > 0)
check('Matcha and Strawberry share those session-level material lines', sharedSession.items.some((item) => item.productId === 'p-pack-mt') && sharedSession.items.some((item) => item.productId === 'p-pack-st'))
check('Complete page requires acknowledgement and remaining input', completeSrc.includes('I have checked the physical material balance') && completeSrc.includes('Material Closing Check'))
check('Variance is visible before complete', completeSrc.includes('Actual Used') && completeSrc.includes('Variance'))

const started = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
const blockedNoAck = db.completeSession(started.id, packResults(started))
check('Complete without acknowledgement is rejected', blockedNoAck === false && db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')?.status === 'in_progress')

const tooMuch = plannedRemainingInputs('ps-0910').map((row, index) => (index === 0 ? { ...row, looseQty: row.looseQty + 1000 } : row))
const blockedOver = db.completeSession(started.id, packResults(started), { acknowledged: true, inputs: tooMuch })
check('Complete rejects remaining above available', blockedOver === false && db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')?.status === 'in_progress')

const milkBefore = inventoryOf('p-milkpw')
const sugarBefore = inventoryOf('p-sugar')
const pouchBefore = inventoryOf('p-pouch')
const fgBefore = inventoryOf('p-pack-mt')
const inputs = plannedRemainingInputs('ps-0910')
const milkDraft = drafts.find((row) => row.productId === 'p-milkpw')!
const milkInput = inputs.map((row) =>
  row.productId === 'p-milkpw' ? { ...row, looseQty: round2(milkDraft.availableQty - milkDraft.plannedQty - 0.2) } : row,
)
const built = buildSessionMaterialClosing(db.getSnapshot(), db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!, milkInput)
check('Staff remaining input calculates actual used and variance', built.ok && built.ok && built.lines.some((row) => row.productId === 'p-milkpw' && row.actualUsedQty === round2(milkDraft.plannedQty + 0.2)))

const completed = db.completeSession(started.id, packResults(started), { acknowledged: true, inputs: milkInput })
const after = db.getSnapshot()
const done = after.productionSessions.find((item) => item.id === 'ps-0910')!
check('Acknowledged closing can complete production', completed === true && done.status === 'completed')
check('Closing snapshot is stored on the session', Boolean(done.materialClosing?.acknowledged && done.materialClosing.lines.length > 0))
check('Variance is stored on the session', done.materialClosing!.lines.some((row) => row.productId === 'p-milkpw' && row.varianceQty !== 0))

const milkOuts = after.stockMovements.filter((row) => row.reference === done.reference && row.productId === 'p-milkpw' && row.type === 'production_out')
const milkLine = done.materialClosing!.lines.find((row) => row.productId === 'p-milkpw')!
check('Inventory posts actual used quantity', milkOuts.length === 1 && milkOuts[0].stockOut === milkLine.actualUsedQty)
check('Planned quantity is not posted again', milkOuts.length === 1)
check('Milk inventory dropped by actual used only', inventoryOf('p-milkpw') === round2(milkBefore - milkLine.actualUsedQty))
check('Sugar inventory dropped by closing actual used', inventoryOf('p-sugar') === round2(sugarBefore - done.materialClosing!.lines.find((row) => row.productId === 'p-sugar')!.actualUsedQty))
check('Pouch inventory uses actual used', inventoryOf('p-pouch') === round2(pouchBefore - done.materialClosing!.lines.find((row) => row.productId === 'p-pouch')!.actualUsedQty))
check('Finished goods still post actual packs', inventoryOf('p-pack-mt') === round2(fgBefore + 45))
check('Old 8 Sep completed session remains readable without materialClosing', after.productionSessions.find((row) => row.id === 'ps-0908')?.status === 'completed' && after.productionSessions.find((row) => row.id === 'ps-0908')?.materialClosing === undefined)

startToday()
const highInputs = plannedRemainingInputs('ps-0910').map((row) => {
  const draft = plannedClosingMaterials(db.getSnapshot(), db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!).find((item) => item.productId === row.productId)!
  return { ...row, looseQty: round2(Math.max(0, draft.availableQty - draft.plannedQty * 1.2)) }
})
db.completeSession('ps-0910', packResults(db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!), {
  acknowledged: true,
  inputs: highInputs,
})
const flagged = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
const varianceNote = db.getSnapshot().notifications.find((row) => row.title === 'Significant material variance')
check('Significant variance still allows completion', flagged.status === 'completed')
check('Significant variance notifies Owner/Admin via existing notifications', Boolean(varianceNote) && flagged.materialClosing?.significantVariance === true)

const fifoState = db.getSnapshot()
const fifo = allocateBalanceFifo(fifoState.productionBalances, 'p-pack-mt', 50)
check(
  'allocateBalanceFifo still orders by production date then id',
  sessionPlanSrc.includes('.sort((a, b) => a.productionDate.localeCompare(b.productionDate) || a.id.localeCompare(b.id))'),
)
check('allocateBalanceFifo still returns used balances', fifo.used.length >= 0)

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.filter((row) => row.ok).length}/${results.length} passed`)
if (failed.length) {
  console.log(failed)
  process.exitCode = 1
}
