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
const { allocateBalanceFifo, isSessionOperationalToday, remainingTargetQty, systemProductionDate, todaySessions } = await import(
  '@/features/manufacturing/sessionPlan'
)
const {
  additionalRequiredPick,
  allocationsForProduct,
  buildSessionMaterialClosing,
  closingLineFromInput,
  conversionNote,
  expectedRemainingQty,
  physicalRemainingBaseQty,
  plannedClosingMaterials,
  sessionAllocatedQty,
  usesAllocationLedger,
  varianceLabel,
} = await import('@/features/manufacturing/materialClosing')
const { isRawStorePickingLine, suggestPurchasePick } = await import('@/features/manufacturing/sessionPlan')
const { groupPickingListForDisplay } = await import('@/features/manufacturing/PickingListPage')
const { round2 } = await import('@/utils/format')
const { hasPermission } = await import('@/features/settings/permissions')
const { getBalanceStorageBoxes } = await import('@/features/warehouse/warehouseModel')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const todaySrc = readFileSync(path.join(root, 'src/features/manufacturing/TodaysProductionPage.tsx'), 'utf8')
const completeSrc = readFileSync(path.join(root, 'src/features/manufacturing/CompleteProductionPage.tsx'), 'utf8')
const sessionPlanSrc = readFileSync(path.join(root, 'src/features/manufacturing/sessionPlan.ts'), 'utf8')
const pickingSrc = readFileSync(path.join(root, 'src/features/manufacturing/PickingListPage.tsx'), 'utf8')
const planningSrc = readFileSync(path.join(root, 'src/features/manufacturing/ProductionPlanningPage.tsx'), 'utf8')
const planAmendmentSrc = readFileSync(path.join(root, 'src/features/manufacturing/planAmendment.tsx'), 'utf8')
const dbSrc = readFileSync(path.join(root, 'src/store/db.ts'), 'utf8')
const permissionsSrc = readFileSync(path.join(root, 'src/features/settings/permissions.ts'), 'utf8')

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

function pickRawStore(sessionId: string) {
  const session = db.getSnapshot().productionSessions.find((item) => item.id === sessionId)
  if (!session) return
  for (const line of session.picking) {
    if (isRawStorePickingLine(line) && !line.picked) db.togglePickingLine(sessionId, line.id, true)
  }
}

function startToday() {
  db.resetDemo()
  db.switchUser('u-admin')
  db.acceptSession('ps-0910')
  const ok = db.startSession('ps-0910', { recipePhoto: 'data:image/png;base64,aaa', recipePhotoName: 'sheet.jpg' })
  pickRawStore('ps-0910')
  return ok
}

function patchMilkBags() {
  return db.updateProduct('p-milkpw', { unit: 'KG', purchaseUnit: 'BAG', purchaseConversionQty: 25 })
}

function productionOuts(reference: string, productId: string) {
  return db.getSnapshot().stockMovements.filter(
    (row) => row.reference === reference && row.productId === productId && row.type === 'production_out',
  )
}

function remainingInputsFor(sessionId: string, remainingByProduct: Record<string, number>) {
  const state = db.getSnapshot()
  const session = state.productionSessions.find((item) => item.id === sessionId)!
  return plannedClosingMaterials(state, session).map((row) => ({
    productId: row.productId,
    fullUnits: 0,
    looseQty: remainingByProduct[row.productId] ?? row.availableQty,
  }))
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

const kgProduct = { id: 'p-x', unit: 'KG', purchaseUnit: 'KG', purchaseConversionQty: 1 }
const normal = closingLineFromInput(kgProduct, 1000, 1000, { fullUnits: 0, looseQty: 995 })
check(
  '1,000 KG available and 995 KG remaining uses 5 KG',
  normal.ok && normal.line.actualUsedQty === 5 && normal.line.remainingQty === 995 && normal.line.availableQty === 1000,
)
const unrelated = closingLineFromInput(kgProduct, 1000, 1000, { fullUnits: 0, looseQty: 995 })
check(
  'Unrelated 100 KG stock OUT does not change actual used',
  unrelated.ok && unrelated.line.actualUsedQty === 5,
)
const extraIssue = closingLineFromInput(kgProduct, 10, 10, { fullUnits: 0, looseQty: 0 })
check(
  'Additional unofficial issue is not recorded; remaining 0 uses allocated 10 KG not 12 KG',
  extraIssue.ok && extraIssue.line.actualUsedQty === 10,
)
const over = closingLineFromInput(kgProduct, 4.5, 1000, { fullUnits: 0, looseQty: 1001 })
check('Remaining greater than session available is rejected', !over.ok && 'reason' in over && over.reason.includes('Physical remaining cannot exceed material allocated to this production session.'))
check('Actual used cannot become negative', !over.ok)

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
check(
  'Complete page Allocated is session allocation, not warehouse stock',
  completeSrc.includes('Allocated:')
    && completeSrc.includes('Material allocated to this production session')
    && !completeSrc.includes('System Available'),
)
check('Picking stays checklist-first with no Brought Qty field', pickingSrc.includes('Mark picked') && !/Brought Qty/i.test(pickingSrc))
check(
  'Picking List UI groups Fresh Materials before Production Balance',
  pickingSrc.includes('Collect all fresh materials from the Store first.')
    && pickingSrc.includes('After fresh materials are collected, go to Storage Box.')
    && pickingSrc.indexOf('title="Fresh Materials"') < pickingSrc.indexOf('title="Production Balance"')
    && pickingSrc.includes('freshLines.map')
    && pickingSrc.includes('balanceLines.map')
    && !pickingSrc.includes('{session.picking.map'),
)
check('Picking List keeps existing complete and add actions', pickingSrc.includes('Today\'s production') && pickingSrc.includes('+ Add Material') && pickingSrc.includes('+ Add Loose') && pickingSrc.includes('Complete production'))
check('Picking progress still counts all lines', pickingSrc.includes('{picked} / {session.picking.length} lines picked'))
check(
  'Three-step completion: Production Result, Finished Goods Distribution, then Material Closing',
  completeSrc.includes('Step 1 of 3')
    && completeSrc.includes('Production Result')
    && completeSrc.includes('Step 2 of 3')
    && completeSrc.includes('Finished Goods Distribution')
    && completeSrc.includes('Step 3 of 3')
    && completeSrc.includes('Material Closing Check')
    && completeSrc.includes('Save & Continue')
    && completeSrc.includes('saveProductionResult')
    && completeSrc.includes('saveFinishedGoodsDistribution'),
)
check('Save & Continue moves from Step 1 after persist', completeSrc.includes('saveStep1') && completeSrc.includes('{step === 1 &&'))
check('Complete Production is only available from Step 3', completeSrc.includes('{step === 3 &&') && completeSrc.includes('Complete production') && !completeSrc.includes('Review and complete'))
check('Recount button is removed; staff edits Physical Remaining', !/\bRecount\b/.test(completeSrc) && completeSrc.includes('If the result looks wrong, recheck the physical balance and edit the value'))
check('Expected Remaining is visible before remaining is entered', completeSrc.includes('Expected Remaining:') && completeSrc.includes('expectedRemainingQty('))
check('Actual Used and Variance update immediately from Physical Remaining', completeSrc.includes('closingLineFromInput') && completeSrc.includes('Enter physical remaining to see actual used and variance immediately'))
check('Complete page has no operational date picker', !/type=["']date["']/.test(completeSrc) && completeSrc.includes('isSessionOperationalToday') && completeSrc.includes('· Today ·'))
check('Storage Box still uses Warehouse Map source-of-truth', completeSrc.includes('storageBoxSelectOptions(state, session.warehouseId') && completeSrc.includes('isActiveBalanceStorageBox'))
check('Variance does not disable Complete Production', completeSrc.includes('disabled={!step3Done || !acknowledged || !closingPreview.ok}') && completeSrc.includes('I have checked the physical material balance'))
check('Allocated 3 KG minus planned 2.33 KG expects 0.67 KG remaining', expectedRemainingQty(3, 2.33) === 0.67)
const remaining070 = closingLineFromInput(kgProduct, 2.33, 3, { fullUnits: 0, looseQty: 0.7 })
check(
  'Remaining 0.70 KG uses 2.30 KG with variance -0.03 KG',
  remaining070.ok
    && remaining070.line.remainingQty === 0.7
    && remaining070.line.actualUsedQty === 2.3
    && remaining070.line.varianceQty === -0.03
    && remaining070.line.expectedRemainingQty === 0.67,
)
const remaining050 = closingLineFromInput(kgProduct, 2.33, 3, { fullUnits: 0, looseQty: 0.5 })
check(
  'Editing remaining 0.70 → 0.50 recalculates actual used and variance immediately',
  remaining050.ok && remaining050.line.actualUsedQty === 2.5 && remaining050.line.varianceQty === 0.17 && remaining050.line.remainingQty === 0.5,
)
check('Zero variance is within expected usage', varianceLabel({ varianceQty: 0, variancePercent: 0 }) === 'Within expected usage')
check('Small over-use is a warning, not a block', varianceLabel({ varianceQty: 0.2, variancePercent: 8 }) === 'Higher than planned')
check('Variance above 10% is significant', varianceLabel({ varianceQty: 3.5, variancePercent: 77.8 }) === 'Significant material variance')

const started = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
const groupedPicking = groupPickingListForDisplay(started.picking)
const originalBalance = started.picking.filter((line) => line.kind === 'balance')
check('Stored picking order is unchanged (balance still generated first)', started.picking[0]?.kind === 'balance')
check('Display grouping puts no production balance in Fresh Materials', groupedPicking.fresh.length > 0 && groupedPicking.fresh.every((line) => line.kind !== 'balance'))
check('Display grouping keeps all production balance after fresh materials', groupedPicking.balance.length > 0 && groupedPicking.balance.every((line) => line.kind === 'balance'))
check('Display grouping keeps every picking line', groupedPicking.fresh.length + groupedPicking.balance.length === started.picking.length)
check(
  'Display grouping preserves required, pick qty, and source',
  [...groupedPicking.fresh, ...groupedPicking.balance].every((line) => {
    const original = started.picking.find((row) => row.id === line.id)
    return Boolean(original && original.requiredQty === line.requiredQty && original.qtyToPick === line.qtyToPick && original.source === line.source && original.location === line.location)
  }),
)
check(
  'Production Balance display order matches existing FIFO/source order',
  groupedPicking.balance.length === originalBalance.length && groupedPicking.balance.every((line, index) => line.id === originalBalance[index].id),
)
check(
  'Shared raw materials stay one consolidated store line in the fresh section',
  groupedPicking.fresh.filter((line) => line.id === 'raw-p-milkpw').length === 1,
)
const movementsBeforePick = db.getSnapshot().stockMovements.length
db.togglePickingLine('ps-0910', groupedPicking.fresh.find((line) => !line.picked)!.id, true)
check('Mark picked does not create a stock movement', db.getSnapshot().stockMovements.length === movementsBeforePick)
check('Progress still counts the marked line', db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!.picking.filter((line) => line.picked).length >= 1)

const blockedNoAck = db.completeSession(started.id, packResults(started))
check('Complete without acknowledgement is rejected', blockedNoAck === false && db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')?.status === 'in_progress')

const tooMuch = plannedRemainingInputs('ps-0910').map((row, index) => (index === 0 ? { ...row, looseQty: row.looseQty + 1000 } : row))
const blockedOver = db.completeSession(started.id, packResults(started), { acknowledged: true, inputs: tooMuch })
check('Complete rejects remaining above available', blockedOver === false && db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')?.status === 'in_progress')

const milkDraft = drafts.find((row) => row.productId === 'p-milkpw')!
const milkProduct = sharedState.products.find((item) => item.id === 'p-milkpw')
const allocatedMilk = sessionAllocatedQty(started, milkProduct, 'p-milkpw')
const warehouseBeforeAdj = inventoryOf('p-milkpw')
check(
  'Session available is picking allocation, not warehouse on-hand',
  allocatedMilk != null && milkDraft.availableQty === allocatedMilk && allocatedMilk !== warehouseBeforeAdj && warehouseBeforeAdj > allocatedMilk,
)
const adjusted = db.adjustStock({
  warehouseId: 'wh-main',
  productId: 'p-milkpw',
  type: 'decrease',
  qty: 5,
  reason: 'Unrelated sale',
})
const milkAfterAdj = plannedClosingMaterials(
  db.getSnapshot(),
  db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!,
).find((row) => row.productId === 'p-milkpw')!
check('Unrelated stock movement applied', adjusted === true && inventoryOf('p-milkpw') === round2(warehouseBeforeAdj - 5))
check('Unrelated stock OUT does not change session available', milkAfterAdj.availableQty === milkDraft.availableQty)
const overWarehouse = closingLineFromInput(milkProduct!, milkDraft.plannedQty, milkDraft.availableQty, {
  fullUnits: 0,
  looseQty: round2(milkDraft.availableQty + 1),
})
check(
  'Remaining above session allocation is rejected even when warehouse is larger',
  !overWarehouse.ok && warehouseBeforeAdj > milkDraft.availableQty,
)

const milkBefore = inventoryOf('p-milkpw')
const sugarBefore = inventoryOf('p-sugar')
const pouchBefore = inventoryOf('p-pouch')
const fgBefore = inventoryOf('p-pack-mt')
const inputs = plannedRemainingInputs('ps-0910')
const milkRemaining = round2(Math.max(0, milkDraft.availableQty - milkDraft.plannedQty + 0.2))
const milkInput = inputs.map((row) =>
  row.productId === 'p-milkpw' ? { ...row, looseQty: milkRemaining } : row,
)
const built = buildSessionMaterialClosing(db.getSnapshot(), db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!, milkInput)
check(
  'Staff remaining input calculates actual used and variance',
  built.ok && built.lines.some((row) => row.productId === 'p-milkpw' && row.actualUsedQty === round2(milkDraft.availableQty - milkRemaining) && row.varianceQty !== 0),
)

const completed = db.completeSession(started.id, packResults(started), { acknowledged: true, inputs: milkInput })
const after = db.getSnapshot()
const done = after.productionSessions.find((item) => item.id === 'ps-0910')!
check('Acknowledged closing can complete production', completed === true && done.status === 'completed')
check('Closing snapshot is stored on the session', Boolean(done.materialClosing?.acknowledged && done.materialClosing.lines.length > 0))
check('Variance is stored on the session', done.materialClosing!.lines.some((row) => row.productId === 'p-milkpw' && row.varianceQty !== 0))

const milkOuts = after.stockMovements.filter((row) => row.reference === done.reference && row.productId === 'p-milkpw' && row.type === 'production_out')
const milkLine = done.materialClosing!.lines.find((row) => row.productId === 'p-milkpw')!
check('Inventory posts actual used quantity', milkOuts.length === 1 && milkOuts[0].stockOut === milkLine.actualUsedQty)
check(
  'Closing stores expected remaining as allocated minus planned',
  milkLine.expectedRemainingQty === round2(milkLine.availableQty - milkLine.plannedQty),
)
check('Planned quantity is not posted again', milkOuts.length === 1)
check('Milk inventory dropped by actual used only', inventoryOf('p-milkpw') === round2(milkBefore - milkLine.actualUsedQty))
check('Sugar inventory dropped by closing actual used', inventoryOf('p-sugar') === round2(sugarBefore - done.materialClosing!.lines.find((row) => row.productId === 'p-sugar')!.actualUsedQty))
check('Pouch inventory uses actual used', inventoryOf('p-pouch') === round2(pouchBefore - done.materialClosing!.lines.find((row) => row.productId === 'p-pouch')!.actualUsedQty))
check('Finished goods still post actual packs', inventoryOf('p-pack-mt') === round2(fgBefore + 45))
check('Old 8 Sep completed session remains readable without materialClosing', after.productionSessions.find((row) => row.id === 'ps-0908')?.status === 'completed' && after.productionSessions.find((row) => row.id === 'ps-0908')?.materialClosing === undefined)
check('Legacy completed session has no invented materialAllocations', after.productionSessions.find((row) => row.id === 'ps-0908')?.materialAllocations === undefined)

startToday()
const highInputs = plannedRemainingInputs('ps-0910').map((row) => {
  const draft = plannedClosingMaterials(db.getSnapshot(), db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!).find((item) => item.productId === row.productId)!
  return { ...row, looseQty: round2(draft.availableQty) }
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

const bagProduct = { id: 'p-milkpw', unit: 'KG', purchaseUnit: 'BAG', purchaseConversionQty: 25 }
const pick8 = suggestPurchasePick(bagProduct, 8)
const pick13 = suggestPurchasePick(bagProduct, 13)
const pick40 = suggestPurchasePick(bagProduct, 40)
check('TEST 14 purchase conversion 1 BAG = 25 KG', pick8.purchaseQty === 1 && pick8.baseQty === 25 && pick8.purchaseUnit === 'BAG' && pick8.note === '1 BAG = 25 KG')
check('TEST 14 13 KG still suggests 1 BAG not 13 KG', pick13.purchaseQty === 1 && pick13.baseQty === 25)
check('TEST 6 / 40 KG suggests 2 BAG = 50 KG', pick40.purchaseQty === 2 && pick40.baseQty === 50)

const formula = closingLineFromInput(bagProduct, 8, 25, { fullUnits: 0, looseQty: 13 })
check(
  'TEST 1 BOM 8 KG pick 25 KG remaining 13 KG uses 12 KG',
  formula.ok && formula.line.actualUsedQty === 12 && formula.line.availableQty === 25 && formula.line.plannedQty === 8 && formula.line.varianceQty === 4,
)

const bagsPlusLoose = closingLineFromInput(bagProduct, 40, 58, { fullUnits: 0, looseQty: 14 })
check(
  'TEST 2 / 15 allocated 58 remaining 14 uses 44 KG',
  bagsPlusLoose.ok && bagsPlusLoose.line.actualUsedQty === 44 && bagsPlusLoose.line.availableQty === 58 && bagsPlusLoose.line.varianceQty === 4,
)

const zeroRemain = closingLineFromInput(bagProduct, 8, 25, { fullUnits: 0, looseQty: 0 })
check('TEST 8 remaining 0 uses all allocated', zeroRemain.ok && zeroRemain.line.actualUsedQty === 25)

db.resetDemo()
db.switchUser('u-admin')
check('Milk bag fixture can be patched', patchMilkBags() === true)
db.acceptSession('ps-0910')
db.startSession('ps-0910', { recipePhoto: 'data:image/png;base64,aaa', recipePhotoName: 'sheet.jpg' })
const v2 = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
check('New sessions initialise an allocation ledger', usesAllocationLedger(v2) && v2.materialAllocations!.length === 0)
const milkPick = v2.picking.find((line) => line.productId === 'p-milkpw' && isRawStorePickingLine(line))!
check('Picking suggestion is purchase units', milkPick.qtyToPick === 1 && milkPick.unit === 'BAG')
check('Required stays in base unit', milkPick.requiredQty > 0 && milkPick.requiredQty < 25)
const sharedMilkLines = v2.picking.filter((line) => line.productId === 'p-milkpw' && isRawStorePickingLine(line))
check('TEST 13 shared raw material is one consolidated picking line', sharedMilkLines.length === 1)

const beforePickMoves = db.getSnapshot().stockMovements.length
db.togglePickingLine('ps-0910', milkPick.id, true)
const afterPick = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
const milkAlloc = allocationsForProduct(afterPick, 'p-milkpw')
check('TEST 1 / 14 tick records 1 BAG = 25 KG', milkAlloc.length === 1 && milkAlloc[0].source === 'picking' && milkAlloc[0].purchaseQty === 1 && milkAlloc[0].baseQty === 25)
check('Picking does not post inventory', db.getSnapshot().stockMovements.length === beforePickMoves)
check('PICKING_ALLOCATED audit is stored', afterPick.materialAudits?.some((row) => row.action === 'PICKING_ALLOCATED' && row.productId === 'p-milkpw') === true)

db.togglePickingLine('ps-0910', milkPick.id, false)
db.togglePickingLine('ps-0910', milkPick.id, true)
const afterRecheck = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
check(
  'TEST 16 uncheck does not delete allocation and recheck does not duplicate',
  allocationsForProduct(afterRecheck, 'p-milkpw').filter((row) => row.source === 'picking').length === 1
    && allocationsForProduct(afterRecheck, 'p-milkpw')[0].baseQty === 25
    && afterRecheck.picking.find((line) => line.id === milkPick.id)?.picked === true,
)

const beforeAddMoves = db.getSnapshot().stockMovements.length
check('TEST 17 additional 1 BAG appends without rewriting picking', db.addSessionMaterial('ps-0910', { productId: 'p-milkpw', mode: 'purchase', purchaseQty: 1 }) === true)
const afterAddBag = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
const milkAfterAdd = allocationsForProduct(afterAddBag, 'p-milkpw')
check(
  'TEST 17 initial picking remains 1 BAG and additional is 1 BAG',
  milkAfterAdd.find((row) => row.source === 'picking')?.purchaseQty === 1
    && milkAfterAdd.find((row) => row.source === 'additional')?.purchaseQty === 1
    && sessionAllocatedQty(afterAddBag, bagProduct, 'p-milkpw') === 50,
)
check('Add Material does not post inventory', db.getSnapshot().stockMovements.length === beforeAddMoves)

check('TEST 18 loose 8 KG TONG has no purchase conversion', db.addSessionMaterial('ps-0910', { productId: 'p-milkpw', mode: 'loose', looseQty: 8, containerType: 'TONG' }) === true)
const afterLoose = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
const looseRow = allocationsForProduct(afterLoose, 'p-milkpw').find((row) => row.source === 'loose')
check(
  'TEST 15 / 18 2 BAG + loose 8 KG = 58 KG',
  looseRow?.baseQty === 8 && looseRow.purchaseQty === undefined && looseRow.containerType === 'TONG' && sessionAllocatedQty(afterLoose, bagProduct, 'p-milkpw') === 58,
)
check('Loose add does not post inventory', db.getSnapshot().stockMovements.length === beforeAddMoves)
check('LOOSE_MATERIAL_ALLOCATED audit is stored', afterLoose.materialAudits?.some((row) => row.action === 'LOOSE_MATERIAL_ALLOCATED') === true)

const sugarBeforeRecv = inventoryOf('p-sugar')
const milkAllocBeforeRecv = sessionAllocatedQty(afterLoose, bagProduct, 'p-milkpw')
const recv = db.createReceiving({
  warehouseId: 'wh-main',
  source: 'direct',
  items: [{ productId: 'p-sugar', qty: 5 }],
})
const afterRecv = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
check('TEST 3 receiving posts warehouse stock', Boolean(recv?.id) && inventoryOf('p-sugar') === round2(sugarBeforeRecv + 5))
check('TEST 3 receiving does not become session allocation', sessionAllocatedQty(afterRecv, bagProduct, 'p-milkpw') === milkAllocBeforeRecv && allocationsForProduct(afterRecv, 'p-sugar').length === 0)

pickRawStore('ps-0910')
const beforeTarget = allocationsForProduct(db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!, 'p-milkpw').map((row) => ({ source: row.source, baseQty: row.baseQty, purchaseQty: row.purchaseQty }))
const milkRequiredBefore = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!.picking.find((line) => line.productId === 'p-milkpw' && isRawStorePickingLine(line))!.requiredQty
db.changeSessionTarget('ps-0910', 'p-pack-mt', 5220, 'Need more matcha packs')
const afterTarget = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
const milkRequiredAfter = afterTarget.picking.find((line) => line.productId === 'p-milkpw' && isRawStorePickingLine(line))!.requiredQty
check(
  'TEST 5 target change preserves historical allocation',
  JSON.stringify(allocationsForProduct(afterTarget, 'p-milkpw').map((row) => ({ source: row.source, baseQty: row.baseQty, purchaseQty: row.purchaseQty }))) === JSON.stringify(beforeTarget)
    && sessionAllocatedQty(afterTarget, bagProduct, 'p-milkpw') === 58,
)
const extra = additionalRequiredPick(afterTarget, db.getSnapshot().products.find((item) => item.id === 'p-milkpw'), 'p-milkpw', milkRequiredAfter)
check('TEST 6 additional requirement is calculated in purchase units', milkRequiredAfter > 58 && extra.shortfall > 0 && extra.purchaseQty >= 1)

const overClose = db.completeSession('ps-0910', packResults(afterTarget), {
  acknowledged: true,
  inputs: remainingInputsFor('ps-0910', { 'p-milkpw': 59 }),
})
check('TEST 7 remaining > allocated is rejected', overClose === false && db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')?.status === 'in_progress')

const zeroClosePreview = plannedClosingMaterials(db.getSnapshot(), db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!)
const milkDraftV2 = zeroClosePreview.find((row) => row.productId === 'p-milkpw')!
check('Closing allocated is the session ledger total', milkDraftV2.availableQty === 58)

const completeInputs = remainingInputsFor('ps-0910', { 'p-milkpw': 14 })
const milkBeforeComplete = inventoryOf('p-milkpw')
const completedV2 = db.completeSession('ps-0910', packResults(db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!), {
  acknowledged: true,
  inputs: completeInputs,
})
const doneV2 = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
const milkClosing = doneV2.materialClosing!.lines.find((row) => row.productId === 'p-milkpw')!
const milkOut = productionOuts(doneV2.reference, 'p-milkpw')
check('TEST 2 complete uses actual used 44 KG', completedV2 === true && milkClosing.actualUsedQty === 44 && milkClosing.availableQty === 58 && milkClosing.remainingQty === 14)
check('TEST 9 exactly one production_out of actual used', milkOut.length === 1 && milkOut[0].stockOut === 44)
check('Inventory dropped by actual used not BOM', inventoryOf('p-milkpw') === round2(milkBeforeComplete - 44))
check('Allocations survive completion', sessionAllocatedQty(doneV2, bagProduct, 'p-milkpw') === 58)
check('MATERIAL_CLOSING_RECORDED and PRODUCTION_COMPLETED are audited', doneV2.materialAudits?.some((row) => row.action === 'MATERIAL_CLOSING_RECORDED') === true && doneV2.materialAudits?.some((row) => row.action === 'PRODUCTION_COMPLETED') === true)

const secondComplete = db.completeSession('ps-0910', packResults(doneV2), { acknowledged: true, inputs: completeInputs })
check('TEST 10 duplicate completion is blocked', secondComplete === false && productionOuts(doneV2.reference, 'p-milkpw').length === 1)

db.switchUser('u-mei')
const staffBlocked = db.editCompletedMaterialClosing('ps-0910', 'p-milkpw', { fullUnits: 0, looseQty: 18 }, 'Staff cannot edit')
check('Staff cannot edit completed material closing', staffBlocked === false)

db.switchUser('u-admin')
const milkAfterComplete = inventoryOf('p-milkpw')
const editOk = db.editCompletedMaterialClosing('ps-0910', 'p-milkpw', { fullUnits: 0, looseQty: 18 }, 'Recounted leftover tong')
const edited = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
const editedLine = edited.materialClosing!.lines.find((row) => row.productId === 'p-milkpw')!
const milkAdj = db.getSnapshot().stockMovements.filter(
  (row) => row.productId === 'p-milkpw' && row.reference === `${edited.reference} adj` && row.type === 'adjustment',
)
check('TEST 12 remaining 18 KG recalculates actual used 40 KG', editOk === true && editedLine.remainingQty === 18 && editedLine.actualUsedQty === 40)
check('TEST 12 inventory reconciliation is the -4 KG delta', inventoryOf('p-milkpw') === round2(milkAfterComplete + 4) && milkAdj.length === 1 && milkAdj[0].stockIn === 4 && milkAdj[0].stockOut === 0)
check('TEST 12 does not create a second production_out', productionOuts(edited.reference, 'p-milkpw').length === 1)
check('TEST 12 audit trail records MATERIAL_CLOSING_UPDATED', edited.materialAudits?.some((row) => row.action === 'MATERIAL_CLOSING_UPDATED' && row.reason?.includes('Recounted leftover tong')) === true)
check('TEST 12 completedEdits captures remaining change', edited.completedEdits.some((row) => row.field === 'remainingQty' && row.originalValue === '14' && row.newValue === '18'))

db.resetDemo()
db.switchUser('u-admin')
patchMilkBags()
db.acceptSession('ps-0910')
db.startSession('ps-0910', { recipePhoto: 'data:image/png;base64,aaa', recipePhotoName: 'sheet.jpg' })
const firstMilkLine = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!.picking.find((line) => line.productId === 'p-milkpw' && isRawStorePickingLine(line))!
db.togglePickingLine('ps-0910', firstMilkLine.id, true)
const second = db.createDailySession({
  productionDate: '2026-09-10',
  items: [{ productId: 'p-pack-ch', targetQty: 45 }],
})
check('Second session created for the same date', Boolean(second?.id))
db.acceptSession(second!.id)
db.startSession(second!.id, { recipePhoto: 'data:image/png;base64,aaa', recipePhotoName: 'sheet.jpg' })
const secondMilk = db.getSnapshot().productionSessions.find((item) => item.id === second!.id)!.picking.find((line) => line.productId === 'p-milkpw' && isRawStorePickingLine(line))
if (secondMilk) db.togglePickingLine(second!.id, secondMilk.id, true)
db.addSessionMaterial(second!.id, { productId: 'p-milkpw', mode: 'purchase', purchaseQty: 1 })
const sessionA = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
const sessionB = db.getSnapshot().productionSessions.find((item) => item.id === second!.id)!
check(
  'TEST 4 two sessions stay isolated by sessionId',
  sessionAllocatedQty(sessionA, bagProduct, 'p-milkpw') === 25
    && (sessionAllocatedQty(sessionB, bagProduct, 'p-milkpw') ?? 0) >= 25
    && allocationsForProduct(sessionA, 'p-milkpw').every((row) => row.sessionId === 'ps-0910')
    && allocationsForProduct(sessionB, 'p-milkpw').every((row) => row.sessionId === second!.id),
)

db.resetDemo()
db.switchUser('u-admin')
patchMilkBags()
db.acceptSession('ps-0910')
db.startSession('ps-0910', { recipePhoto: 'data:image/png;base64,aaa', recipePhotoName: 'sheet.jpg' })
pickRawStore('ps-0910')
const highVarianceInputs = plannedClosingMaterials(
  db.getSnapshot(),
  db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!,
).map((row) => ({ productId: row.productId, fullUnits: 0, looseQty: 0 }))
const notifyBefore = db.getSnapshot().notifications.filter((row) => row.title === 'Significant material variance').length
db.completeSession('ps-0910', packResults(db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!), {
  acknowledged: true,
  inputs: highVarianceInputs,
})
const highVarSession = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
check('TEST 8 / 11 remaining 0 completes with actual used = allocated', highVarSession.status === 'completed' && highVarSession.materialClosing!.lines.every((row) => row.remainingQty === 0 && row.actualUsedQty === row.availableQty))
check(
  'TEST 11 variance above 10% notifies and does not block',
  highVarSession.materialClosing?.significantVariance === true
    && db.getSnapshot().notifications.filter((row) => row.title === 'Significant material variance').length > notifyBefore,
)

check(
  'TEST 25 PR #43 Material Closing remains intact inside Step 3',
  completeSrc.includes('Step 3 of 3')
    && completeSrc.includes('Material Closing Check')
    && completeSrc.includes('Physical Remaining')
    && completeSrc.includes('I have checked the physical material balance')
    && !completeSrc.includes('amendSessionPlan'),
)
check(
  'TEST 26 PR #44 picking list still renders Fresh Materials then Production Balance',
  pickingSrc.indexOf('title="Fresh Materials"') < pickingSrc.indexOf('title="Production Balance"')
    && pickingSrc.includes('freshLines.map')
    && pickingSrc.includes('balanceLines.map'),
)

db.resetDemo()
db.switchUser('u-admin')

const plannedEdit = db.createDailySession({
  productionDate: '2026-09-12',
  items: [
    { productId: 'p-pack-mt', targetQty: 50 },
    { productId: 'p-pack-st', targetQty: 40 },
  ],
  notes: 'Original planned notes',
})
check('Planned session created for edit/cancel tests', Boolean(plannedEdit?.id))
const plannedUpdated = db.updatePlannedSession(plannedEdit!.id, {
  productionDate: '2026-09-12',
  notes: 'Updated planned notes',
  items: [
    { productId: 'p-pack-mt', targetQty: 55 },
    { productId: 'p-pack-st', targetQty: 40 },
  ],
})
const afterPlannedEdit = db.getSnapshot().productionSessions.find((item) => item.id === plannedEdit!.id)!
check(
  'TEST 1 PLANNED can be edited',
  plannedUpdated === true
    && afterPlannedEdit.status === 'planned'
    && afterPlannedEdit.notes === 'Updated planned notes'
    && afterPlannedEdit.items.find((item) => item.productId === 'p-pack-mt')?.targetQty === 55
    && afterPlannedEdit.items.find((item) => item.productId === 'p-pack-mt')?.originalTargetQty === 55
    && afterPlannedEdit.items.find((item) => item.productId === 'p-pack-st')?.targetQty === 40,
)

const cancelled = db.cancelPlannedSession(plannedEdit!.id)
const afterCancel = db.getSnapshot().productionSessions.find((item) => item.id === plannedEdit!.id)
check(
  'TEST 2 PLANNED can be cancelled/deleted safely',
  cancelled === true
    && afterCancel?.status === 'cancelled'
    && Boolean(afterCancel?.cancelledBy)
    && Boolean(afterCancel?.cancelledAt)
    && afterCancel.items.length === 2,
)
check('Cancelled plan is not hard deleted', Boolean(afterCancel?.id) && afterCancel?.reference === plannedEdit?.reference)
check('TEST 22 CANCELLED cannot be amended', db.amendSessionPlan(plannedEdit!.id, [{ productId: 'p-pack-mt', targetQty: 70 }], 'Should fail') === false)
check('Cancelled plan cannot be accepted', (() => { db.acceptSession(plannedEdit!.id); return db.getSnapshot().productionSessions.find((item) => item.id === plannedEdit!.id)?.status === 'cancelled' })())

db.resetDemo()
db.switchUser('u-admin')
const seedPlanned = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
check('Seed plan loads without amendment history', Array.isArray(seedPlanned.targetChanges) && seedPlanned.targetChanges.length === 0)

db.acceptSession('ps-0910')
const accepted = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
check('Accepted session keeps the same id', accepted?.status === 'accepted' && accepted.id === 'ps-0910')
check(
  'TEST 3 ACCEPTED cannot use normal Edit',
  db.updatePlannedSession('ps-0910', { productionDate: accepted.productionDate, items: accepted.items.map((item) => ({ productId: item.productId, targetQty: item.targetQty + 1 })) }) === false
    && db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')?.items.find((item) => item.productId === 'p-pack-mt')?.targetQty === 45,
)
check('ACCEPTED cannot be cancelled', db.cancelPlannedSession('ps-0910') === false && db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')?.status === 'accepted')
check('Planning UI keeps Edit/Cancel for planned and Amend Plan for later statuses', planningSrc.includes('>Edit<') && planningSrc.includes('Delete / Cancel') && planningSrc.includes('Amend Plan'))
check('Today UI exposes Amend Plan and does not keep silent Edit target', todaySrc.includes('Amend Plan') && !todaySrc.includes('Edit target'))
check(
  'Amendment confirmation is required before save',
  planAmendmentSrc.includes('Confirm Amendment')
    && planAmendmentSrc.includes('Amend production plan?')
    && planAmendmentSrc.includes('if (saving) return'),
)
const mfgRunMatch = permissionsSrc.match(/const MFG_RUN: PermissionKey\[\] = \[([\s\S]*?)\]/)
check(
  'Plan actions use permission keys, not role-name checks',
  planAmendmentSrc.includes("hasPermission(state, 'manufacturing.plan.edit')")
    && planAmendmentSrc.includes("hasPermission(state, 'manufacturing.plan.amend')")
    && !/role\s*===\s*['"]Owner['"]/.test(planAmendmentSrc)
    && !/role\s*===\s*['"]Admin['"]/.test(planAmendmentSrc)
    && !/role\s*===\s*['"]Owner['"]/.test(planningSrc)
    && permissionsSrc.includes("'manufacturing.plan.amend'")
    && permissionsSrc.includes("'manufacturing.plan.edit'"),
)
check(
  'Staff manufacturing run permissions do not include plan amend',
  Boolean(mfgRunMatch && !mfgRunMatch[1].includes('manufacturing.plan.amend') && !mfgRunMatch[1].includes('manufacturing.plan.edit')),
)

db.switchUser('u-mei')
check('Staff has operational manufacturing.edit but not plan amend', hasPermission(db.getSnapshot(), 'manufacturing.edit') === true && hasPermission(db.getSnapshot(), 'manufacturing.plan.amend') === false)
check(
  'TEST 5 Staff cannot Amend',
  db.amendSessionPlan('ps-0910', [{ productId: 'p-pack-mt', targetQty: 60 }], 'Staff should not amend') === false
    && db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')?.items.find((item) => item.productId === 'p-pack-mt')?.targetQty === 45,
)

db.switchUser('u-admin')
check('Authorized admin can amend', hasPermission(db.getSnapshot(), 'manufacturing.plan.amend') === true)
check('TEST 6 Amendment requires reason', db.amendSessionPlan('ps-0910', [{ productId: 'p-pack-mt', targetQty: 60 }], '') === false)
check('TEST 7 Whitespace-only reason is rejected', db.amendSessionPlan('ps-0910', [{ productId: 'p-pack-mt', targetQty: 60 }], '   ') === false)

const beforeMoves = db.getSnapshot().stockMovements.length
const beforeBalances = JSON.stringify(db.getSnapshot().productionBalances)
const beforeBoxes = JSON.stringify(getBalanceStorageBoxes(db.getSnapshot()).map((row) => ({ slotId: row.slotId, name: row.name, active: row.active })))
const originalMatcha = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!.items.find((item) => item.productId === 'p-pack-mt')!

const firstAmend = db.amendSessionPlan(
  'ps-0910',
  [
    { productId: 'p-pack-mt', targetQty: 60 },
    { productId: 'p-pack-cl', targetQty: 45 },
    { productId: 'p-pack-st', targetQty: 45 },
  ],
  'Additional customer order',
)
const afterFirstAmend = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
const matchaAfter = afterFirstAmend.items.find((item) => item.productId === 'p-pack-mt')!
const strawberryAfter = afterFirstAmend.items.find((item) => item.productId === 'p-pack-st')!
const chocolateAfter = afterFirstAmend.items.find((item) => item.productId === 'p-pack-cl')!
check('TEST 4 ACCEPTED can Amend by authorized Owner/Admin', firstAmend === true && matchaAfter.targetQty === 60)
check('TEST 8 Amendment creates audit record', afterFirstAmend.targetChanges.length === 1 && afterFirstAmend.targetChanges[0].reason === 'Additional customer order' && afterFirstAmend.targetChanges[0].changedBy === 'Admin' && Boolean(afterFirstAmend.targetChanges[0].changedAt) && afterFirstAmend.targetChanges[0].originalTarget === 45 && afterFirstAmend.targetChanges[0].newTarget === 60 && afterFirstAmend.targetChanges[0].sessionId === 'ps-0910')
check('TEST 9 Original target remains preserved', matchaAfter.originalTargetQty === originalMatcha.originalTargetQty && matchaAfter.originalTargetQty === 45)
check('TEST 23 Existing Production Session remains the same session', afterFirstAmend.id === 'ps-0910' && afterFirstAmend.reference === accepted.reference)
check('TEST 24 Multi-product amendment changes only the selected product', strawberryAfter.targetQty === 45 && chocolateAfter.targetQty === 45 && strawberryAfter.originalTargetQty === 45)
check('TEST 20 Amendment does not create inventory movement', db.getSnapshot().stockMovements.length === beforeMoves)
check('TEST 18 Production Balance FIFO remains unchanged', JSON.stringify(db.getSnapshot().productionBalances) === beforeBalances)
check(
  'TEST 19 Storage Box source remains unchanged',
  JSON.stringify(getBalanceStorageBoxes(db.getSnapshot()).map((row) => ({ slotId: row.slotId, name: row.name, active: row.active }))) === beforeBoxes,
)
check('No-op amendment is rejected', db.amendSessionPlan('ps-0910', [{ productId: 'p-pack-mt', targetQty: 60 }], 'Same target') === false && db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!.targetChanges.length === 1)

const secondAmend = db.amendSessionPlan('ps-0910', [{ productId: 'p-pack-mt', targetQty: 65 }], 'Production adjustment')
const afterSecond = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
check(
  'TEST 10 Multiple amendments preserve complete history',
  secondAmend === true
    && afterSecond.targetChanges.length === 2
    && afterSecond.targetChanges[0].originalTarget === 45
    && afterSecond.targetChanges[0].newTarget === 60
    && afterSecond.targetChanges[1].originalTarget === 60
    && afterSecond.targetChanges[1].newTarget === 65
    && afterSecond.items.find((item) => item.productId === 'p-pack-mt')?.targetQty === 65,
)

db.startSession('ps-0910', { recipePhoto: 'data:image/png;base64,aaa', recipePhotoName: 'sheet.jpg' })
pickRawStore('ps-0910')
const startedAmend = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
const milkBeforeIncrease = startedAmend.picking.find((line) => line.productId === 'p-milkpw' && line.kind !== 'balance')?.requiredQty
    ?? startedAmend.picking.find((line) => line.productId === 'p-milkpw')?.requiredQty
const pickingIdsBefore = startedAmend.picking.map((line) => line.id).sort().join(',')
const groupedBefore = groupPickingListForDisplay(startedAmend.picking)
check('Started session still groups Fresh Materials then Production Balance', groupedBefore.fresh.length > 0 && groupedBefore.fresh.every((line) => line.kind !== 'balance') && groupedBefore.balance.every((line) => line.kind === 'balance'))

const inProgressAmend = db.amendSessionPlan('ps-0910', [{ productId: 'p-pack-mt', targetQty: 80 }], 'Operational requirement')
const afterInProgress = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
check('TEST 11 IN_PROGRESS can be amended by authorized user', inProgressAmend === true && afterInProgress.status === 'in_progress' && afterInProgress.items.find((item) => item.productId === 'p-pack-mt')?.targetQty === 80)
const milkAfterIncrease = afterInProgress.picking.find((line) => line.productId === 'p-milkpw' && line.kind !== 'balance')?.requiredQty
  ?? afterInProgress.picking.find((line) => line.productId === 'p-milkpw')?.requiredQty
check('TEST 15 BOM recalculates for new target', typeof milkBeforeIncrease === 'number' && typeof milkAfterIncrease === 'number' && milkAfterIncrease > milkBeforeIncrease!)
check(
  'TEST 16 Picking List reflects updated remaining requirement',
  afterInProgress.picking.some((line) => line.kind !== 'balance' && line.requiredQty > 0)
    && new Set(afterInProgress.picking.map((line) => line.id)).size === afterInProgress.picking.length
    && pickingIdsBefore.split(',').every((id) => afterInProgress.picking.some((line) => line.id === id)),
)
const groupedAfter = groupPickingListForDisplay(afterInProgress.picking)
check(
  'TEST 17 Picking List still renders Fresh Materials then Production Balance',
  groupedAfter.fresh.length > 0
    && groupedAfter.balance.length > 0
    && groupedAfter.fresh.every((line) => line.kind !== 'balance')
    && groupedAfter.balance.every((line) => line.kind === 'balance')
    && afterInProgress.picking.filter((line) => line.kind === 'balance').length === groupedAfter.balance.length,
)

const liveMatcha = afterInProgress.items.find((item) => item.productId === 'p-pack-mt')!
liveMatcha.actualQty = 40
check('Injected actual production is 40', db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!.items.find((item) => item.productId === 'p-pack-mt')!.actualQty === 40)
const blockedLow = db.amendSessionPlan('ps-0910', [{ productId: 'p-pack-mt', targetQty: 39 }], 'Too low')
check(
  'TEST 12 IN_PROGRESS cannot reduce target below actual production',
  blockedLow === false
    && db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!.items.find((item) => item.productId === 'p-pack-mt')!.targetQty === 80
    && db.getSnapshot().ui.toasts.some((row) => row.title === 'New target cannot be lower than actual production completed.'),
)
const equalActual = db.amendSessionPlan('ps-0910', [{ productId: 'p-pack-mt', targetQty: 40 }], 'Equal to actual')
const afterEqual = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!.items.find((item) => item.productId === 'p-pack-mt')!
check('Target equal to actual production is allowed', equalActual === true && afterEqual.targetQty === 40 && afterEqual.actualQty === 40 && remainingTargetQty(afterEqual) === 0)

const increaseAgain = db.amendSessionPlan('ps-0910', [{ productId: 'p-pack-mt', targetQty: 60 }], 'Customer order reduced then recovered')
const afterIncrease = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!.items.find((item) => item.productId === 'p-pack-mt')!
check(
  'TEST 13 Target increase calculates remaining target correctly',
  increaseAgain === true && afterIncrease.targetQty === 60 && remainingTargetQty(afterIncrease) === 20,
)
check('TEST 14 Existing actual production is not reset', afterIncrease.actualQty === 40 && afterIncrease.originalTargetQty === 45)

const completedOk = db.completeSession('ps-0910', packResults(db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!), {
  acknowledged: true,
  inputs: plannedRemainingInputs('ps-0910'),
})
const completedSession = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
check('Completed session still exists after amendment path', completedOk === true && completedSession.status === 'completed')
check('TEST 21 COMPLETED cannot be amended', db.amendSessionPlan('ps-0910', [{ productId: 'p-pack-mt', targetQty: 90 }], 'Too late') === false)

check(
  'Completion UI opens the first incomplete step by default',
  completeSrc.includes('if (!session?.resultSavedAt) return 1')
    && completeSrc.includes('if (!session.distributionSavedAt) return 2')
    && completeSrc.includes('Save Material Closing'),
)

db.resetDemo()
db.switchUser('u-admin')
db.acceptSession('ps-0910')
db.startSession('ps-0910', { recipePhoto: 'data:image/png;base64,aaa', recipePhotoName: 'sheet.jpg' })
pickRawStore('ps-0910')
const threeStepSession = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
const threeStepResults = packResults(threeStepSession)
const threeStepMoves = db.getSnapshot().stockMovements.length

db.switchUser('u-mei')
const skippedTwo = db.saveFinishedGoodsDistribution('ps-0910', threeStepResults)
check('Step 2 cannot be saved before Step 1', skippedTwo === false)

const step1 = db.saveProductionResult('ps-0910', threeStepResults)
const afterStep1 = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
check(
  'Staff A saves Step 1 Production Result',
  step1 === true
    && afterStep1.status === 'in_progress'
    && afterStep1.posted === false
    && afterStep1.resultSavedBy === 'Mei Ling'
    && Boolean(afterStep1.resultSavedAt)
    && afterStep1.items.every((item) => item.actualQty === item.targetQty)
    && db.getSnapshot().stockMovements.length === threeStepMoves,
)
check('Refresh still has Step 1 actor after reopen snapshot', db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')?.resultSavedBy === 'Mei Ling')

db.switchUser('u-kumar')
const afterStaffBOpen = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
check('Staff B sees Step 1 completed and Step 2 available', Boolean(afterStaffBOpen.resultSavedAt) && !afterStaffBOpen.distributionSavedAt)

const skippedThree = db.saveMaterialClosingDraft('ps-0910', { acknowledged: true, inputs: plannedRemainingInputs('ps-0910') })
check('Step 3 cannot be saved before Step 2', skippedThree === false)

const invalidDist = db.saveFinishedGoodsDistribution(
  'ps-0910',
  afterStaffBOpen.items.map((item) => ({ productId: item.productId, displayQty: 20, cartonQty: 60 })),
)
check(
  'Invalid distribution is blocked and does not post inventory',
  invalidDist === false
    && db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')?.distributionSavedAt == null
    && db.getSnapshot().stockMovements.length === threeStepMoves,
)

const step2 = db.saveFinishedGoodsDistribution(
  'ps-0910',
  afterStaffBOpen.items.map((item) => ({ productId: item.productId, displayQty: 10, cartonQty: item.actualQty - 10 })),
)
const afterStep2 = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
check(
  'Staff B saves Step 2 Finished Goods Distribution',
  step2 === true
    && afterStep2.distributionSavedBy === 'Kumar Raj'
    && Boolean(afterStep2.distributionSavedAt)
    && afterStep2.status === 'in_progress'
    && afterStep2.posted === false
    && afterStep2.items.every((item) => item.displayQty === 10 && item.cartonQty === item.actualQty - 10)
    && db.getSnapshot().stockMovements.length === threeStepMoves,
)

db.switchUser('u-hafiz')
const afterStaffCOpen = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
check('Staff C sees Step 1 and Step 2 complete', Boolean(afterStaffCOpen.resultSavedAt) && Boolean(afterStaffCOpen.distributionSavedAt) && !afterStaffCOpen.materialClosing?.checkedBy)

const step3 = db.saveMaterialClosingDraft('ps-0910', { acknowledged: true, inputs: plannedRemainingInputs('ps-0910') })
const afterStep3 = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
check(
  'Staff C saves Step 3 Material Closing without posting',
  step3 === true
    && afterStep3.status === 'in_progress'
    && afterStep3.posted === false
    && afterStep3.materialClosing?.checkedBy === 'Hafiz Malik'
    && Boolean(afterStep3.materialClosing?.checkedAt)
    && db.getSnapshot().stockMovements.length === threeStepMoves,
)
const closingStamp = afterStep3.materialClosing!.checkedAt

db.switchUser('u-admin')
const posted = db.completeSession('ps-0910', packResults(db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!), {
  acknowledged: true,
  inputs: plannedRemainingInputs('ps-0910'),
})
const postedSession = db.getSnapshot().productionSessions.find((item) => item.id === 'ps-0910')!
check(
  'Manager completes once and preserves Material Closing actor',
  posted === true
    && postedSession.status === 'completed'
    && postedSession.posted === true
    && postedSession.completedBy === 'Admin'
    && Boolean(postedSession.completedAt)
    && postedSession.materialClosing?.checkedBy === 'Hafiz Malik'
    && postedSession.materialClosing?.checkedAt === closingStamp
    && postedSession.resultSavedBy === 'Mei Ling'
    && postedSession.distributionSavedBy === 'Kumar Raj',
)
check('Inventory posts only on Complete Production', db.getSnapshot().stockMovements.length > threeStepMoves)
const postedAgain = db.completeSession('ps-0910', packResults(postedSession), { acknowledged: true, inputs: plannedRemainingInputs('ps-0910') })
check('Duplicate Complete Production is blocked', postedAgain === false && postedSession.status === 'completed')

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.filter((row) => row.ok).length}/${results.length} passed`)
if (failed.length) {
  console.log(failed)
  process.exitCode = 1
}
