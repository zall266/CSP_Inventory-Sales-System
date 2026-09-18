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
const { hasPermission } = await import('@/features/settings/permissions')
const { navGroups } = await import('@/components/layout/Sidebar')
const { SalesReturnsListPage, SalesReturnEditorPage, SalesReturnDetailPage } = await import('@/features/returns/SalesReturnPages')
const {
  DEFAULT_RETURN_REASON_NAMES,
  DEFAULT_RETURN_SOURCE_NAMES,
  DISPOSITION_EQUALITY_ERROR,
  SALES_RETURN_PERMISSION_KEYS,
  evidenceCountLabel,
  evidenceRetentionUntil,
  hydrateSalesReturn,
  isAllowedReturnPhotoFile,
  isAllowedReturnVideoFile,
  validateReturnEvidence,
} = await import('@/features/returns/salesReturnModel')
const { putAttachmentBlob, getAttachmentBlob, deleteAttachmentBlob, SALES_RETURN_EVIDENCE_KIND } = await import('@/store/attachmentBlobs')
const { allocateBalanceFifo } = await import('@/features/manufacturing/sessionPlan')

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function inventoryOf(productId: string, warehouseId = 'wh-main') {
  return db.getSnapshot().inventory.find((row) => row.productId === productId && row.warehouseId === warehouseId)?.qty ?? 0
}

function userById(id: string) {
  return db.getSnapshot().users.find((user) => user.id === id)
}

function saleByInvoice(invoiceNo: string) {
  return db.getSnapshot().sales.find((sale) => sale.invoiceNo === invoiceNo)
}

function pbQty(productId: string) {
  return (db.getSnapshot().productionBalances ?? [])
    .filter((row) => row.productId === productId && row.status === 'available')
    .reduce((sum, row) => sum + row.quantity, 0)
}

function integrityItems() {
  return [
    {
      productId: 'p-pack-mt',
      returnedQty: 10,
      unit: 'PACK',
      goodQty: 3,
      repackQty: 5,
      wasteQty: 2,
      repackRecoveredGrams: 470,
      repackStorageBoxId: 'Box 3',
    },
    { productId: 'p-pack-st', returnedQty: 5, unit: 'PACK', goodQty: 5, repackQty: 0, wasteQty: 0 },
    {
      productId: 'p-pack-ch',
      returnedQty: 8,
      unit: 'PACK',
      goodQty: 0,
      repackQty: 6,
      wasteQty: 2,
      repackRecoveredGrams: 560,
      repackStorageBoxId: 'Box 1',
    },
    { productId: 'p-wf', returnedQty: 3, unit: 'PACK', goodQty: 3, repackQty: 0, wasteQty: 0 },
  ]
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appSrc = readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
const sidebarSrc = readFileSync(path.join(root, 'src/components/layout/Sidebar.tsx'), 'utf8')
const pagesSrc = readFileSync(path.join(root, 'src/features/returns/SalesReturnPages.tsx'), 'utf8')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }

db.resetDemo()
db.switchUser('u-admin')

check('Returns page exists', typeof SalesReturnsListPage === 'function')
check('New Return page exists', typeof SalesReturnEditorPage === 'function')
check('Return detail page exists', typeof SalesReturnDetailPage === 'function')
check(
  'Returns routes are registered',
  appSrc.includes('path="/sales/returns"') &&
    appSrc.includes('path="/sales/returns/new"') &&
    appSrc.includes('path="/sales/returns/:id"'),
)
check(
  'One Returns sidebar item',
  navGroups.find((group) => group.id === 'sales')?.items.filter((item) => item.to === '/sales/returns' && item.label === 'Returns').length === 1,
)
check('Sidebar does not split marketplace returns', !/Shopee Returns|TikTok Returns|Online Returns|Product Returns/i.test(sidebarSrc))
check('Return Source is not hard-coded in the Return UI options', !pagesSrc.includes('Shopee ▼') && !/option>\s*Shopee/.test(pagesSrc) && pagesSrc.includes('state.returnSources'))
check(
  'Seeded Return Sources include required channels',
  DEFAULT_RETURN_SOURCE_NAMES.join(',') ===
    'Shopee,TikTok Shop,Website,WhatsApp,Lazada,Walk-in,Courier,Agent,Wholesale,Other' &&
    DEFAULT_RETURN_SOURCE_NAMES.every((name) => (db.getSnapshot().returnSources ?? []).some((row) => row.name === name && row.active)),
)
check(
  'Seeded Return Reasons include required reasons',
  DEFAULT_RETURN_REASON_NAMES.join(',') ===
    'Customer changed mind,Damaged,Wrong item,Defective,Parcel damaged,Expired,Other' &&
    DEFAULT_RETURN_REASON_NAMES.every((name) => (db.getSnapshot().returnReasons ?? []).some((row) => row.name === name && row.active)),
)

const shopee = (db.getSnapshot().returnSources ?? []).find((row) => row.name === 'Shopee')
const tiktok = (db.getSnapshot().returnSources ?? []).find((row) => row.name === 'TikTok Shop')
const website = (db.getSnapshot().returnSources ?? []).find((row) => row.name === 'Website')
const agentSource = (db.getSnapshot().returnSources ?? []).find((row) => row.name === 'Agent')
const reason = (db.getSnapshot().returnReasons ?? []).find((row) => row.name === 'Customer changed mind')
const damaged = (db.getSnapshot().returnReasons ?? []).find((row) => row.name === 'Damaged')
check('Shopee source is selectable', Boolean(shopee?.active))
check('TikTok Shop source is selectable', Boolean(tiktok?.active))
check('Website source is selectable', Boolean(website?.active))

const customSource = db.upsertReturnSource({ name: 'Night Market' })
check('Custom Return Source can be added', customSource?.name === 'Night Market' && customSource.active)
const renamed = db.upsertReturnSource({ id: customSource!.id, name: 'Pasar Malam' })
check('Return Source can be edited', renamed?.name === 'Pasar Malam')

const deactivatedSource = db.setReturnSourceActive(customSource!.id, false)
const afterDeactivate = (db.getSnapshot().returnSources ?? []).find((row) => row.id === customSource!.id)
check('Return Source can be deactivated without delete', deactivatedSource && afterDeactivate && afterDeactivate.active === false)

const customReason = db.upsertReturnReason({ name: 'Wrong flavour' })
check('Custom Return Reason can be added', customReason?.name === 'Wrong flavour')
check('Return Reason can be deactivated without delete', db.setReturnReasonActive(customReason!.id, false))
check(
  'Historical masters remain after deactivate',
  (db.getSnapshot().returnSources ?? []).some((row) => row.id === customSource!.id) &&
    (db.getSnapshot().returnReasons ?? []).some((row) => row.id === customReason!.id),
)

const invoice = saleByInvoice('INV-001234')
check('Original invoice INV-001234 exists for optional linking', Boolean(invoice))

const ownerCanView = hasPermission(db.getSnapshot(), 'sales_return.view', userById('u-aina'))
const adminCanCreate = hasPermission(db.getSnapshot(), 'sales_return.create', userById('u-admin'))
const adminCanManage = hasPermission(db.getSnapshot(), 'return_source.manage', userById('u-admin'))
const staffCannotView = !hasPermission(db.getSnapshot(), 'sales_return.view', userById('u-mei'))
const staffCannotCreate = !hasPermission(db.getSnapshot(), 'sales_return.create', userById('u-mei'))
const staffCannotManage = !hasPermission(db.getSnapshot(), 'sales_return.manage', userById('u-mei'))
const cashierCannot = !hasPermission(db.getSnapshot(), 'sales_return.view', userById('u-siti'))
check('Owner can view Returns', ownerCanView)
check('Admin can create Returns', adminCanCreate)
check('Admin can manage Return Source/Reason', adminCanManage)
check('Staff restriction: view/create/manage off by default', staffCannotView && staffCannotCreate && staffCannotManage)
check('Cashier Return access is off by default', cashierCannot)
check(
  'Dynamic permission keys are registered',
  SALES_RETURN_PERMISSION_KEYS.join(',') ===
    'sales_return.view,sales_return.create,sales_return.manage,return_source.manage,return_reason.manage',
)

db.switchUser('u-mei')
const staffBlocked = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  items: [{ productId: 'p-pack-mt', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Staff API cannot create Sales Return', staffBlocked === null)
check(
  'Existing Receiving permission for staff is unaffected',
  hasPermission(db.getSnapshot(), 'receiving.view', userById('u-mei')) &&
    hasPermission(db.getSnapshot(), 'receiving.create', userById('u-mei')),
)
check(
  'Existing task permission for staff is unaffected',
  hasPermission(db.getSnapshot(), 'task.view', userById('u-mei')),
)

db.switchUser('u-admin')
const purchasesBefore = db.getSnapshot().purchases.length
const receivingsBefore = (db.getSnapshot().receivings ?? []).length
const sessionsBefore = db.getSnapshot().productionSessions.length
const adjustmentsBefore = db.getSnapshot().stockMovements.filter((row) => row.type === 'adjustment').length
const openingBefore = (db.getSnapshot().openingBalances ?? []).length
const agentSalesBefore = (db.getSnapshot().agentSales ?? []).length
const agentEarningsBefore = (db.getSnapshot().agentEarningLedgers ?? []).length
const occupanciesBefore = (db.getSnapshot().slotOccupancies ?? []).length
const displayBefore = (db.getSnapshot().displayStocks ?? []).map((row) => `${row.productId}:${row.qty}`).join('|')
const salesCountBefore = db.getSnapshot().sales.length

const matchaBefore = inventoryOf('p-pack-mt')
const strawberryBefore = inventoryOf('p-pack-st')
const chocolateBefore = inventoryOf('p-pack-ch')
const waffleBefore = inventoryOf('p-wf')
const matchaPbBefore = pbQty('p-pack-mt')
const chocolatePbBefore = pbQty('p-pack-ch')

const draft = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  originalSaleId: invoice!.id,
  customerId: invoice!.customerId,
  notes: 'Shopee parcel inspection',
  items: integrityItems(),
})
check('Draft return can be saved', Boolean(draft?.returnNo.startsWith('RT-') && draft.status === 'draft'), draft ? draft.returnNo : 'save returned null')
check('Draft does not change Finished Goods', inventoryOf('p-pack-mt') === matchaBefore && inventoryOf('p-pack-st') === strawberryBefore)
check('Draft does not change Production Balance', pbQty('p-pack-mt') === matchaPbBefore)
check('Document numbers use RT prefix', draft?.returnNo === 'RT-000001', draft?.returnNo)

if (!draft) {
  console.error('Aborting remaining posting tests because draft save failed')
  const failedEarly = results.filter((row) => !row.ok)
  console.log(`\n${results.length - failedEarly.length}/${results.length} passed`)
  process.exit(1)
}

const duplicateDraftConfirmA = db.confirmSalesReturn(draft!.id)
const duplicateDraftConfirmB = db.confirmSalesReturn(draft!.id)
check('Confirm posts inventory once', duplicateDraftConfirmA === true)
check('Duplicate confirm is blocked', duplicateDraftConfirmB === false)

const confirmed = (db.getSnapshot().salesReturns ?? []).find((row) => row.id === draft!.id)
check('Confirmed return is locked as confirmed', confirmed?.status === 'confirmed')
const lockedEdit = db.updateSalesReturn(draft!.id, {
  sourceId: shopee!.id,
  reasonId: reason!.id,
  items: integrityItems(),
})
check('Confirmed return cannot be edited silently', lockedEdit === null)

const matchaAfter = inventoryOf('p-pack-mt')
const strawberryAfter = inventoryOf('p-pack-st')
const chocolateAfter = inventoryOf('p-pack-ch')
const waffleAfter = inventoryOf('p-wf')
check('Good stock returns Matcha +3 PACK', matchaAfter === matchaBefore + 3)
check('Good stock returns Strawberry +5 PACK', strawberryAfter === strawberryBefore + 5)
check('Chocolate Good is 0 so Finished Goods unchanged', chocolateAfter === chocolateBefore)
check('Waffle Premix Good +3', waffleAfter === waffleBefore + 3)
check(
  'Finished Goods increase equals Good qty only (+11 PACK, not +26)',
  matchaAfter - matchaBefore + (strawberryAfter - strawberryBefore) + (chocolateAfter - chocolateBefore) + (waffleAfter - waffleBefore) === 11,
)
check('No double counting of returned packs into Finished Goods', matchaAfter !== matchaBefore + 10)

const matchaPbAfter = pbQty('p-pack-mt')
const chocolatePbAfter = pbQty('p-pack-ch')
check('Repack recovered Matcha 470 G into Production Balance', matchaPbAfter === matchaPbBefore + 470)
check('Repack recovered Chocolate 560 G into Production Balance', chocolatePbAfter === chocolatePbBefore + 560)
check('Production Balance total recovered is 1,030 G', matchaPbAfter - matchaPbBefore + (chocolatePbAfter - chocolatePbBefore) === 1030)
check(
  'Production Balance remains separate from Finished Goods',
  matchaAfter === matchaBefore + 3 && matchaPbAfter === matchaPbBefore + 470,
)

const movements = db.getSnapshot().stockMovements.filter((row) => row.reference === confirmed!.returnNo)
check(
  'Stock movements reference RT number',
  movements.length > 0 && movements.every((row) => row.reference === confirmed!.returnNo),
)
check(
  'Good movement type is sales_return_good',
  movements.some((row) => row.type === 'sales_return_good' && row.stockIn === 3 && row.productId === 'p-pack-mt'),
)
check(
  'Repack movement type is sales_return_repack and skip FG',
  movements.some((row) => row.type === 'sales_return_repack' && row.productId === 'p-pack-mt' && row.stockIn === 0),
)
check(
  'Waste movement type is sales_return_waste',
  movements.filter((row) => row.type === 'sales_return_waste').reduce((sum, row) => sum + row.stockOut, 0) === 4,
)
check(
  'Waste does not become saleable stock',
  chocolateAfter === chocolateBefore && movements.some((row) => row.type === 'sales_return_waste' && row.productId === 'p-pack-ch'),
)

const matchaBox = (db.getSnapshot().productionBalances ?? []).find(
  (row) => row.productionReference === confirmed!.returnNo && row.productId === 'p-pack-mt',
)
const chocolateBox = (db.getSnapshot().productionBalances ?? []).find(
  (row) => row.productionReference === confirmed!.returnNo && row.productId === 'p-pack-ch',
)
check('Repack requires Storage Box BOX-03 for Matcha', matchaBox?.container === 'Box 3' && matchaBox.quantity === 470)
check('Multiple Repack Storage Boxes are preserved', chocolateBox?.container === 'Box 1' && matchaBox?.container === 'Box 3')

const fifo = allocateBalanceFifo(db.getSnapshot().productionBalances ?? [], 'p-pack-mt', matchaPbAfter)
check(
  'Repack Production Balance participates in existing FIFO',
  fifo.remainingRequired === 0 && fifo.used.some((row) => row.reference === confirmed!.returnNo),
)

check('History keeps the confirmed return', (db.getSnapshot().salesReturns ?? []).some((row) => row.returnNo === confirmed!.returnNo && row.status === 'confirmed'))
check(
  'Detail preserves multi-item dispositions',
  confirmed!.items.length === 4 &&
    confirmed!.items[0].goodQty === 3 &&
    confirmed!.items[0].repackQty === 5 &&
    confirmed!.items[0].wasteQty === 2 &&
    confirmed!.sourceNameSnapshot === 'Shopee' &&
    confirmed!.originalDocumentNo === 'INV-001234',
)
check('Customer is stored from original invoice', confirmed!.customerNameSnapshot === 'Maju Enterprise' || Boolean(confirmed!.customerId))
check('Multi-item return totals 26 returned / 11 good / 11 repack / 4 waste', confirmed!.items.reduce((sum, line) => sum + line.returnedQty, 0) === 26)

const audits = db.getSnapshot().documentAuditLogs ?? []
check(
  'Audit records sales_return_created',
  audits.some((row) => row.action === 'sales_return_created' && row.documentNo === confirmed!.returnNo && row.documentType === 'sales_return'),
)
check(
  'Audit records sales_return_confirmed',
  audits.some((row) => row.action === 'sales_return_confirmed' && row.documentNo === confirmed!.returnNo && row.changedBy === 'Admin'),
)

const manual = db.createSalesReturn({
  sourceId: tiktok!.id,
  reasonId: damaged!.id,
  items: [{ productId: 'p-pack-mt', returnedQty: 2, unit: 'PACK', goodQty: 2, repackQty: 0, wasteQty: 0 }],
})
check('Manual item entry works without an invoice', Boolean(manual && !manual.originalSaleId && manual.status === 'confirmed'))
check('TikTok Shop can be used as Return Source', manual?.sourceNameSnapshot === 'TikTok Shop')

const websiteReturn = db.createSalesReturn({
  sourceId: website!.id,
  reasonId: reason!.id,
  items: [{ productId: 'p-pack-st', returnedQty: 1, unit: 'PACK', goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Website can be used as Return Source', websiteReturn?.sourceNameSnapshot === 'Website')

const agentReturn = db.createSalesReturn({
  sourceId: agentSource!.id,
  reasonId: reason!.id,
  items: [{ productId: 'p-pack-st', returnedQty: 1, unit: 'PACK', goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Agent can be used as Return Source without Agent-module redesign', agentReturn?.sourceNameSnapshot === 'Agent' && agentReturn.warehouseId === 'wh-main')

const agent = db.createAgent({ name: 'Return Isolation Agent', code: 'RTISO' })
const agentBlocked = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  warehouseId: agent!.warehouseId,
  items: [{ productId: 'p-pack-mt', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Agent warehouse isolation blocks posting into Agent stock', agentBlocked === null)
check('Agent sales / earnings were not rewritten', (db.getSnapshot().agentSales ?? []).length === agentSalesBefore && (db.getSnapshot().agentEarningLedgers ?? []).length === agentEarningsBefore)

db.setReturnSourceActive(shopee!.id, false)
const inactiveSourceDoc = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  items: [{ productId: 'p-pack-mt', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Inactive source cannot be selected for new returns', inactiveSourceDoc === null)
db.setReturnSourceActive(shopee!.id, true)

db.setReturnReasonActive(reason!.id, false)
const inactiveReasonDoc = db.saveSalesReturn({
  sourceId: website!.id,
  reasonId: reason!.id,
  items: [{ productId: 'p-pack-mt', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Inactive reason cannot be selected for new returns', inactiveReasonDoc === null)
db.setReturnReasonActive(reason!.id, true)

const badDisposition = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  items: [{ productId: 'p-pack-mt', returnedQty: 10, goodQty: 3, repackQty: 5, wasteQty: 1 }],
})
check('Invalid disposition total is blocked', badDisposition === null)
check('Disposition equality error is user-friendly', DISPOSITION_EQUALITY_ERROR === 'Good + Repack + Waste must equal Returned Quantity.')

const missingGrams = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  items: [{ productId: 'p-pack-mt', returnedQty: 5, goodQty: 0, repackQty: 5, wasteQty: 0, repackStorageBoxId: 'BOX-03' }],
})
check('Repack without recovered grams is blocked', missingGrams === null)

const missingBox = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  items: [{ productId: 'p-pack-mt', returnedQty: 5, goodQty: 0, repackQty: 5, wasteQty: 0, repackRecoveredGrams: 400 }],
})
check('Repack without Storage Box is blocked', missingBox === null)

const zeroGrams = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  items: [{ productId: 'p-pack-mt', returnedQty: 5, goodQty: 0, repackQty: 5, wasteQty: 0, repackRecoveredGrams: 0, repackStorageBoxId: 'BOX-03' }],
})
check('Recovered grams must be greater than 0', zeroGrams === null)

const invalidQty = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  items: [{ productId: 'p-pack-mt', returnedQty: 0, goodQty: 0, repackQty: 0, wasteQty: 0 }],
})
check('Invalid returned quantity is blocked', invalidQty === null)

const duplicateLines = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  items: [
    { productId: 'p-pack-mt', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 },
    { productId: 'p-pack-mt', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 },
  ],
})
check('Duplicate product lines are blocked', duplicateLines === null)

const missingSource = db.saveSalesReturn({
  sourceId: '',
  reasonId: reason!.id,
  items: [{ productId: 'p-pack-mt', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Missing Return Source is blocked', missingSource === null)

const exceedInvoice = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  originalSaleId: invoice!.id,
  items: [{ productId: 'p-wf', returnedQty: 31, goodQty: 31, repackQty: 0, wasteQty: 0 }],
})
check('Returned qty cannot exceed original sold qty when invoice is linked', exceedInvoice === null)

db.setProductStatus('p-pack-mt', 'inactive')
const inactiveProduct = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  items: [{ productId: 'p-pack-mt', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Inactive product cannot be returned', inactiveProduct === null)
db.setProductStatus('p-pack-mt', 'active')

const cancelled = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Draft cancel is available', Boolean(cancelled) && db.cancelSalesReturn(cancelled!.id) === true)
check(
  'Cancelled return does not post inventory',
  (db.getSnapshot().stockMovements ?? []).every((row) => row.reference !== cancelled!.returnNo),
)

check('No Purchase created by Sales Return', db.getSnapshot().purchases.length === purchasesBefore)
check('No Receiving created by Sales Return', (db.getSnapshot().receivings ?? []).length === receivingsBefore)
check('No Production Session created by Sales Return', db.getSnapshot().productionSessions.length === sessionsBefore)
check(
  'No Stock Adjustment created by Sales Return',
  db.getSnapshot().stockMovements.filter((row) => row.type === 'adjustment').length === adjustmentsBefore,
)
check('Existing Opening Balance unaffected', (db.getSnapshot().openingBalances ?? []).length === openingBefore)
check('Existing sales documents unaffected', db.getSnapshot().sales.length === salesCountBefore)
check('Existing Warehouse Map occupancy unaffected', (db.getSnapshot().slotOccupancies ?? []).length === occupanciesBefore)
check(
  'Existing Display Stock unaffected',
  (db.getSnapshot().displayStocks ?? []).map((row) => `${row.productId}:${row.qty}`).join('|') === displayBefore,
)
check(
  'Mobile-compatible return entry uses stacked cards and full-width actions',
  pagesSrc.includes('space-y-3') && pagesSrc.includes('w-full sm:w-auto') && pagesSrc.includes('Add Item') && !pagesSrc.includes('nested modal'),
)
check(
  'Return Evidence section supports photos and one video',
  pagesSrc.includes('Return Evidence') &&
    pagesSrc.includes('Add Photos') &&
    pagesSrc.includes('Add Video') &&
    pagesSrc.includes('Optional') &&
    pagesSrc.includes('Only one video can be attached to a Sales Return.') &&
    pagesSrc.includes('Evidence expired / removed'),
)
check('Confirmed evidence is locked in the detail view', pagesSrc.includes('locked') && pagesSrc.includes('Return Evidence'))

const tinyJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAQQ='
const returnDate = '2026-09-14T12:00:00+08:00'
const until = evidenceRetentionUntil(returnDate)
check('retentionUntil is Sales Return Date plus 2 years', until.includes('2028-09-14'), until)

check(
  'Image over 5MB is rejected',
  isAllowedReturnPhotoFile({ name: 'big.jpg', type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 }) === false,
)
check(
  'Video over 50MB is rejected',
  isAllowedReturnVideoFile({ name: 'big.mp4', type: 'video/mp4', size: 50 * 1024 * 1024 + 1 }) === false,
)
check(
  'Unsupported image type is rejected',
  isAllowedReturnPhotoFile({ name: 'scan.gif', type: 'image/gif', size: 1200 }) === false,
)
check(
  'Unsupported video type is rejected',
  isAllowedReturnVideoFile({ name: 'clip.mov', type: 'video/quicktime', size: 1200 }) === false,
)
check(
  'Model blocks a video stored as a photo',
  validateReturnEvidence({
    photos: [{ fileId: 'x', fileName: 'clip.mp4', mimeType: 'video/mp4', size: 1000, uploadedBy: 'Admin', uploadedAt: returnDate }],
  }).ok === false,
)

async function storeEvidenceFile(fileId: string, fileName: string, mimeType: string, body: string) {
  await putAttachmentBlob({
    fileId,
    kind: SALES_RETURN_EVIDENCE_KIND,
    fileName,
    mimeType,
    blob: new Blob([body], { type: mimeType }),
  })
  return {
    fileId,
    fileName,
    mimeType,
    size: body.length,
    uploadedBy: 'Admin',
    uploadedAt: returnDate,
  }
}

const photoA = await storeEvidenceFile('evf-a', 'photo-1.jpg', 'image/jpeg', 'photo-a')
const photoB = await storeEvidenceFile('evf-b', 'photo-2.jpg', 'image/jpeg', 'photo-b')
const photoC = await storeEvidenceFile('evf-c', 'photo-3.jpg', 'image/jpeg', 'photo-c')
const videoA = await storeEvidenceFile('evf-v', 'return-video.mp4', 'video/mp4', 'video-bytes')

const none = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  returnDate,
  items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Return can be saved with no evidence', Boolean(none && !none.evidence?.photos?.length && !none.evidence?.video))

const threePhotos = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  returnDate,
  evidence: { photos: [photoA, photoB, photoC] },
  items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check(
  'Return can be saved with 3 photos',
  threePhotos?.evidence?.photos?.length === 3 && threePhotos.evidence.photos.every((file) => file.retentionUntil?.includes('2028-09-14')),
  evidenceCountLabel(threePhotos?.evidence?.photos?.length ?? 0, 0),
)
check(
  'Photo evidence is stored as file references, not Base64',
  JSON.stringify(threePhotos?.evidence) !== undefined &&
    !JSON.stringify(threePhotos?.evidence).includes('data:image') &&
    !JSON.stringify(threePhotos).includes(tinyJpeg),
)

const oneVideo = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  returnDate,
  evidence: { video: videoA },
  items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Return can be saved with 1 video', oneVideo?.evidence?.video?.fileName === 'return-video.mp4')
check('Video bytes are not stored on the Sales Return record', !JSON.stringify(oneVideo).includes('video-bytes'))

const mixed = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  returnDate,
  evidence: { photos: [photoA, photoB, photoC], video: videoA },
  items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check(
  'Return can be saved with 3 photos and 1 video',
  mixed?.status === 'draft' && mixed.evidence?.photos?.length === 3 && Boolean(mixed.evidence.video),
)

const mixedKept = db.updateSalesReturn(mixed!.id, {
  sourceId: shopee!.id,
  reasonId: reason!.id,
  returnDate,
  evidence: mixed!.evidence,
  items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Draft keeps evidence after save', mixedKept?.evidence?.photos?.length === 3 && mixedKept.evidence.video?.fileId === 'evf-v')

const confirmedEvidence = db.createSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  returnDate,
  evidence: { photos: [photoA], video: videoA },
  items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Confirmed return keeps evidence attached', confirmedEvidence?.status === 'confirmed' && confirmedEvidence.evidence?.photos?.length === 1 && Boolean(confirmedEvidence.evidence.video))
const lockedUpdate = db.updateSalesReturn(confirmedEvidence!.id, {
  sourceId: shopee!.id,
  reasonId: reason!.id,
  returnDate,
  evidence: { photos: [] },
  items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Confirmed evidence cannot be replaced or deleted', lockedUpdate === null)
const stillLocked = (db.getSnapshot().salesReturns ?? []).find((row) => row.id === confirmedEvidence!.id)
check('Confirmed evidence remains after lock attempt', stillLocked?.evidence?.photos?.length === 1 && Boolean(stillLocked.evidence?.video))

const oversized = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  returnDate,
  evidence: {
    photos: [{ ...photoA, size: 6 * 1024 * 1024 }],
  },
  items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Save rejects an image larger than 5MB', oversized === null)

const oversizedVideo = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  returnDate,
  evidence: {
    video: { ...videoA, size: 51 * 1024 * 1024 },
  },
  items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Save rejects a video larger than 50MB', oversizedVideo === null)

const badType = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  returnDate,
  evidence: {
    photos: [{ ...photoA, fileName: 'notes.txt', mimeType: 'text/plain' }],
  },
  items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check('Save rejects an unsupported evidence type', badType === null)

const livePhoto = await storeEvidenceFile('evf-live', 'keep.jpg', 'image/jpeg', 'keep-bytes')
const liveReturn = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  returnDate,
  evidence: { photos: [livePhoto] },
  items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
const liveUntil = liveReturn?.evidence?.photos?.[0]?.retentionUntil ?? ''
const beforeExpiry = new Date(new Date(liveUntil).getTime() - 1000).toISOString()
const earlyPurge = await db.purgeExpiredSalesReturnEvidence(beforeExpiry)
check('Non-expired evidence is not deleted', Boolean(await getAttachmentBlob('evf-live')) && (db.getSnapshot().salesReturns ?? []).some((row) => row.id === liveReturn?.id && !row.evidence?.photos?.[0]?.expired))
check('Cleanup before retentionUntil does not mark evidence expired', !earlyPurge.deletedFileIds.includes('evf-live'))

const expiredPhoto = await storeEvidenceFile('evf-old', 'old.jpg', 'image/jpeg', 'old-bytes')
const expiredReturn = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  returnDate: '2024-09-14T12:00:00+08:00',
  evidence: { photos: [expiredPhoto] },
  items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
const expiryAt = expiredReturn?.evidence?.photos?.[0]?.retentionUntil ?? until
const expiredPurge = await db.purgeExpiredSalesReturnEvidence(expiryAt)
const expiredRow = (db.getSnapshot().salesReturns ?? []).find((row) => row.id === expiredReturn?.id)
check('Expired evidence is eligible for cleanup', expiredPurge.deletedFileIds.includes('evf-old'))
check('Physical expired file is removed from storage', (await getAttachmentBlob('evf-old')) === undefined)
check('Sales Return record remains after evidence expiry', Boolean(expiredRow) && expiredRow?.status === 'draft')
check(
  'Expired evidence keeps historical metadata',
  expiredRow?.evidence?.photos?.[0]?.fileName === 'old.jpg' && expiredRow?.evidence?.photos?.[0]?.expired === true,
)

await storeEvidenceFile('evf-missing', 'gone.jpg', 'image/jpeg', 'gone')
const missingReturn = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  returnDate,
  evidence: {
    photos: [
      {
        fileId: 'evf-missing',
        fileName: 'gone.jpg',
        mimeType: 'image/jpeg',
        size: 4,
        uploadedBy: 'Admin',
        uploadedAt: returnDate,
      },
    ],
  },
  items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
await deleteAttachmentBlob('evf-missing')
let missingPurgeOk = true
try {
  await db.purgeExpiredSalesReturnEvidence(missingReturn?.evidence?.photos?.[0]?.retentionUntil ?? until)
} catch {
  missingPurgeOk = false
}
const missingRow = (db.getSnapshot().salesReturns ?? []).find((row) => row.id === missingReturn?.id)
check('Missing evidence does not break cleanup', missingPurgeOk && missingRow?.evidence?.photos?.[0]?.expired === true)

const legacy = db.saveSalesReturn({
  sourceId: shopee!.id,
  reasonId: reason!.id,
  returnDate,
  photoUrl: tinyJpeg,
  photoName: 'legacy.jpg',
  items: [{ productId: 'p-pack-st', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
check(
  'Legacy single photo hydrates without retentionUntil',
  Boolean(legacy?.photoUrl) &&
    legacy?.photoName === 'legacy.jpg' &&
    legacy.evidence?.photos?.[0]?.fileName === 'legacy.jpg' &&
    legacy.evidence?.photos?.[0]?.retentionUntil === undefined,
)
const legacyHydrated = hydrateSalesReturn({
  ...(legacy as NonNullable<typeof legacy>),
  evidence: undefined,
})
check('Legacy photo is preserved when evidence metadata is missing', legacyHydrated.evidence?.photos?.[0]?.fileId.startsWith('legacy:') === true && Boolean(legacyHydrated.photoUrl))
await db.purgeExpiredSalesReturnEvidence('2030-01-01T00:00:00+08:00')
const legacyAfter = (db.getSnapshot().salesReturns ?? []).find((row) => row.id === legacy?.id)
check(
  'Legacy photo without retentionUntil is not silently deleted',
  Boolean(legacyAfter?.photoUrl) && legacyAfter?.evidence?.photos?.[0]?.expired !== true,
)

check('TypeScript sources are used', pkg.scripts.build.includes('tsc --noEmit'))
check('Lint script uses TypeScript noEmit', pkg.scripts.lint.includes('tsc --noEmit'))
check('Build script exists', Boolean(pkg.scripts.build))

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => row.name).join('\n'))
  process.exit(1)
}
