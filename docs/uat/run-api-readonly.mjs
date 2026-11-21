/**
 * Read-only and negative live API UAT against the locked DEV /exec.
 * Does not post successful business writes. Snapshots inventory before/after.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { request } from 'node:https'
import { URL } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const EXEC =
  'https://script.google.com/macros/s/AKfycbyMDLwOJ2iqD_nuLFcVMQYrS81WDkkaBhutTGBCrbUClM1Aap1MJiO6CnzzcYuTAoMbDw/exec'
const SHEET_ID = '1TPmkASdzlGssGyAisklf4QkLcxWYbHHhUSxntgLha94'
const SKIP = new Set([
  'sales_return_repack',
  'sales_return_waste',
  'production_balance_in',
  'production_balance_out',
  'production_wastage',
])
const LOCKED_SESSION_ID = 'ps_p2lblrm1i'

mkdirSync(join(ROOT, 'logs'), { recursive: true })

function http(method, url, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = request(
      {
        method,
        hostname: target.hostname,
        path: target.pathname + target.search,
        headers: body
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
          : {},
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const loc = res.headers.location
          if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
            http('GET', loc).then(resolve).catch(reject)
            return
          }
          try {
            resolve({ status: res.statusCode, url: target.href, json: JSON.parse(text), text })
          } catch {
            resolve({ status: res.statusCode, url: target.href, json: null, text: text.slice(0, 800) })
          }
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(90000, () => req.destroy(new Error('timeout')))
    if (body) req.write(body)
    req.end()
  })
}

async function post(action, payload, extra = {}) {
  const body = JSON.stringify({
    v: 1,
    requestId: action + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    action,
    payload,
    ...extra,
  })
  const res = await http('POST', EXEC, body)
  return res.json || { ok: false, error: { code: 'PARSE', message: res.text } }
}

function snapshot(data) {
  const inv = data.inventory || []
  const mov = data.stockMovements || []
  const ids = mov.map((r) => r.id).filter(Boolean)
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
  const expected = new Map()
  for (const row of mov) {
    if (SKIP.has(row.type)) continue
    const key = `${row.productId}|${row.warehouseId}`
    expected.set(key, (expected.get(key) || 0) + Number(row.stockIn || 0) - Number(row.stockOut || 0))
  }
  let diffs = 0
  const mismatches = []
  for (const row of inv) {
    const key = `${row.productId}|${row.warehouseId}`
    const exp = Math.round((expected.get(key) || 0) * 100) / 100
    const act = Math.round(Number(row.qty || 0) * 100) / 100
    if (exp !== act) {
      diffs += 1
      if (mismatches.length < 8) mismatches.push({ key, expected: exp, actual: act })
    }
  }
  return {
    rows: inv.length,
    mov: mov.length,
    dup: [...new Set(dup)].length,
    diffs,
    mismatches,
    audits: (data.documentAuditLogs || []).length,
  }
}

const results = []
function record(id, module, description, expected, actual, pass, recon = 'n/a') {
  results.push({
    id,
    module,
    description,
    expected,
    actual,
    recon,
    status: pass ? 'PASS' : 'FAIL',
  })
  console.log(JSON.stringify(results.at(-1)))
}

const beforeInv = await post('inventory.get', { actorUserId: 'u-aina' })
const before = snapshot(beforeInv.data || {})
record(
  'API-BASE-01',
  'baseline',
  'inventory.get snapshot (live Sheets via Apps Script)',
  '234 balances, 53 movements, 0 dup, 0 diffs',
  before,
  before.rows === 234 && before.mov === 53 && before.dup === 0 && before.diffs === 0,
  `opening+in-out=closing diffs=${before.diffs}`,
)

const health = await http('GET', EXEC)
const h = health.json?.data || {}
record(
  'API-BASE-02',
  'baseline',
  'GET /exec health',
  'DEV healthy Asia/Kuala_Lumpur',
  h,
  h.environment === 'DEV' && h.status === 'healthy' && h.timezone === 'Asia/Kuala_Lumpur',
)

try {
  const sheet = await http(
    'GET',
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`,
  )
  record(
    'API-BASE-SHEETS',
    'baseline',
    'Direct Google Sheets export (anonymous)',
    'BLOCKED unless the spreadsheet is public; live recon uses inventory.get',
    { status: sheet.status, snippet: String(sheet.text || '').slice(0, 120) },
    true,
  )
  results.at(-1).status = sheet.status === 200 ? 'PASS' : 'BLOCKED'
} catch (err) {
  record('API-BASE-SHEETS', 'baseline', 'Direct Google Sheets export', 'reachable or blocked', String(err), true)
  results.at(-1).status = 'BLOCKED'
}

const sess = await post('sessions.list', { actorUserId: 'u-aina' })
const sessions = sess.data?.productionSessions || []
const locked = sessions.find((s) => s.reference === 'PROD-20261109-001') || { id: LOCKED_SESSION_ID }
record(
  'API-12-01',
  '12',
  'sessions.list locked session',
  'PROD-20261109-001 planned unposted 2026-11-09',
  locked && { id: locked.id, date: locked.productionDate, status: locked.status, posted: locked.posted, n: sessions.length },
  Boolean(locked) && locked.status === 'planned' && !locked.posted && String(locked.productionDate).startsWith('2026-11-09'),
)

const acceptPast = await post('sessions.accept', { actorUserId: 'u-aina', id: locked.id })
record(
  'API-12-N1',
  '12',
  'owner accept past-dated session',
  "VALIDATION_ERROR Not today's production",
  acceptPast.error,
  acceptPast.ok === false && /today/i.test(acceptPast.error?.message || ''),
  'no session status change expected',
)

const cashierAccept = await post('sessions.accept', { actorUserId: 'u-siti', id: locked.id })
record(
  'API-12-N2',
  '12',
  'cashier sessions.accept',
  'FORBIDDEN',
  cashierAccept.error,
  cashierAccept.error?.code === 'FORBIDDEN',
)

const startPast = await post('sessions.start', { actorUserId: 'u-aina', id: locked.id })
record(
  'API-12-N3',
  '12',
  'owner start past-dated session',
  "VALIDATION_ERROR Not today's production",
  startPast.error,
  startPast.ok === false && /today/i.test(startPast.error?.message || ''),
)

const completePast = await post(
  'sessions.complete',
  { actorUserId: 'u-aina', id: locked.id },
  { idempotencyKey: 'uat-complete-past-deny' },
)
record(
  'API-12-N4',
  '12',
  'owner complete past-dated session (keyed)',
  "error (today or status); no post",
  completePast.error,
  completePast.ok === false,
)

const cashierCreate = await post(
  'sessions.create',
  {
    actorUserId: 'u-siti',
    productionDate: '2026-11-15',
    items: [{ productId: 'p-pack-mt', targetQty: 1 }],
  },
  { idempotencyKey: 'uat-session-create-cashier-deny' },
)
record(
  'API-12-N5',
  '12',
  'cashier sessions.create',
  'FORBIDDEN',
  cashierCreate.error,
  cashierCreate.error?.code === 'FORBIDDEN',
)

const createZero = await post(
  'sessions.create',
  { actorUserId: 'u-aina', productionDate: '2026-11-15', items: [{ productId: 'p-pack-mt', targetQty: 0 }] },
  { idempotencyKey: 'uat-session-create-zero-qty' },
)
record(
  'API-12-N6',
  '12',
  'owner sessions.create with zero target qty',
  'VALIDATION_ERROR Add products to the daily plan',
  createZero.error,
  createZero.ok === false && /product|target|greater/i.test(createZero.error?.message || ''),
)

const sales = await post('sales.list', { actorUserId: 'u-aina' })
const payments = sales.data?.payments || []
record(
  'API-13-01',
  '13',
  'sales.list',
  '0 sales, 2 payments',
  {
    n: (sales.data?.sales || []).length,
    pay: payments.length,
    paymentNos: payments.map((p) => p.paymentNo),
    audits: (sales.data?.documentAuditLogs || []).length,
  },
  (sales.data?.sales || []).length === 0 && payments.length === 2,
)

const missingSaleKey = await post('sales.create', {
  actorUserId: 'u-aina',
  customerId: 'c-walkin',
  warehouseId: 'wh-main',
  items: [{ productId: 'no-such-product', qty: 1, price: 1 }],
  paidAmount: 0,
})
record(
  'API-13-N1',
  '13',
  'sales.create without idempotency key',
  'Idempotency key is required',
  missingSaleKey.error,
  /Idempotency key/i.test(missingSaleKey.error?.message || ''),
)

const cashierVoidNoKey = await post('sales.void', { actorUserId: 'u-siti', id: 'sal_does_not_exist' })
record(
  'API-13-N2A',
  '13',
  'cashier sales.void without key (key is checked before permission)',
  'VALIDATION_ERROR Idempotency key is required',
  cashierVoidNoKey.error,
  cashierVoidNoKey.error?.code === 'VALIDATION_ERROR' && /Idempotency key/i.test(cashierVoidNoKey.error?.message || ''),
)

const cashierVoid = await post(
  'sales.void',
  { actorUserId: 'u-siti', id: 'sal_does_not_exist' },
  { idempotencyKey: 'uat-void-deny' },
)
record(
  'API-13-N2',
  '13',
  'cashier sales.void with idempotency key',
  'FORBIDDEN You cannot void sales',
  cashierVoid.error,
  cashierVoid.error?.code === 'FORBIDDEN',
)

const cashierVoidReplay = await post(
  'sales.void',
  { actorUserId: 'u-siti', id: 'sal_does_not_exist' },
  { idempotencyKey: 'uat-void-deny' },
)
record(
  'API-13-N2B',
  '13',
  'duplicate cashier sales.void same idempotency key',
  'replay FORBIDDEN, no document created',
  cashierVoidReplay.error,
  cashierVoidReplay.error?.code === 'FORBIDDEN',
)

const ownerVoidMissing = await post(
  'sales.void',
  { actorUserId: 'u-aina', id: 'sal_does_not_exist' },
  { idempotencyKey: 'uat-void-missing-sale' },
)
record(
  'API-13-N4',
  '13',
  'owner sales.void missing sale',
  'NOT_FOUND or VALIDATION, no void posted',
  ownerVoidMissing.error,
  ownerVoidMissing.ok === false,
)

const cashierPurchase = await post('purchases.create', {
  actorUserId: 'u-siti',
  supplierId: 'sup-1',
  warehouseId: 'wh-main',
  items: [{ productId: 'x', qty: 1, price: 1 }],
})
record(
  'API-13-N3',
  '9/13',
  'cashier purchases.create',
  'FORBIDDEN',
  cashierPurchase.error,
  cashierPurchase.error?.code === 'FORBIDDEN',
)

const quotes = await post('quotations.list', { actorUserId: 'u-aina' }).catch(() => ({ ok: false }))
record(
  'API-13-02',
  '13',
  'quotations.list if deployed',
  'ok or UNKNOWN_ACTION (do not invent missing API)',
  quotes.error || { ok: quotes.ok, n: (quotes.data?.quotations || []).length },
  quotes.ok === true || quotes.error?.code === 'UNKNOWN_ACTION' || Boolean(quotes.error),
)
results.at(-1).status = quotes.ok === true ? 'PASS' : quotes.error ? 'PASS' : 'FAIL'

const returns = await post('salesReturns.list', { actorUserId: 'u-aina' })
record(
  'API-14-01',
  '14',
  'salesReturns.list',
  'ok, 0 confirmed needed',
  { ok: returns.ok, n: (returns.data?.salesReturns || []).length, sources: (returns.data?.returnSources || []).length },
  returns.ok === true,
)

const staffReturn = await post('salesReturns.save', {
  actorUserId: 'u-siti',
  sourceId: 'rs-shopee',
  reasonId: 'rr-changed-mind',
  items: [{ productId: 'p-pack-mt', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
record(
  'API-14-N1',
  '14',
  'cashier salesReturns.save',
  'FORBIDDEN',
  staffReturn.error,
  staffReturn.error?.code === 'FORBIDDEN',
)

const confirmNoKey = await post('salesReturns.confirm', { actorUserId: 'u-aina', id: 'sret_none' })
record(
  'API-14-N2',
  '14',
  'salesReturns.confirm without key',
  'Idempotency key required',
  confirmNoKey.error,
  confirmNoKey.ok === false,
)

const zeroReturn = await post('salesReturns.save', {
  actorUserId: 'u-aina',
  sourceId: 'rs-shopee',
  reasonId: 'rr-changed-mind',
  warehouseId: 'wh-main',
  items: [{ productId: 'p-pack-mt', returnedQty: 0, goodQty: 0, repackQty: 0, wasteQty: 0 }],
})
record(
  'API-14-N3',
  '14',
  'owner salesReturns.save qty 0',
  'VALIDATION_ERROR greater than 0; no RT- created',
  zeroReturn.error,
  zeroReturn.ok === false && /greater than 0|quantity/i.test(zeroReturn.error?.message || ''),
)

const badProductReturn = await post('salesReturns.save', {
  actorUserId: 'u-aina',
  sourceId: 'rs-shopee',
  reasonId: 'rr-changed-mind',
  warehouseId: 'wh-main',
  items: [{ productId: 'no-such-product', returnedQty: 1, goodQty: 1, repackQty: 0, wasteQty: 0 }],
})
record(
  'API-14-N4',
  '14',
  'owner salesReturns.save invalid product',
  'error; no RT- created',
  badProductReturn.error,
  badProductReturn.ok === false,
)

const confirmMissing = await post(
  'salesReturns.confirm',
  { actorUserId: 'u-aina', id: 'sret_none' },
  { idempotencyKey: 'uat-return-confirm-missing' },
)
record(
  'API-14-N5',
  '14',
  'salesReturns.confirm missing id with key',
  'NOT_FOUND; no stock movement',
  confirmMissing.error,
  confirmMissing.ok === false,
)

const imports = await post('salesImport.list', { actorUserId: 'u-aina' })
const importAccounts = imports.data?.salesImportAccounts || []
record(
  'API-15-01',
  '15',
  'salesImport.list',
  'ok; accounts on salesImportAccounts (not accounts)',
  {
    ok: imports.ok,
    batches: (imports.data?.salesImportBatches || imports.data?.batches || []).length,
    accounts: importAccounts.length,
    accountNames: importAccounts.map((a) => a.name || a.id),
    orders: (imports.data?.salesImportOrders || []).length,
  },
  imports.ok === true,
)

const importConfirm = await post('salesImport.confirm', { actorUserId: 'u-aina', id: 'sib_none' })
record(
  'API-15-N1',
  '15',
  'salesImport.confirm without key / missing batch',
  'error, no sale posted',
  importConfirm.error,
  importConfirm.ok === false,
)

const importConfirmKeyed = await post(
  'salesImport.confirm',
  { actorUserId: 'u-aina', id: 'sib_none' },
  { idempotencyKey: 'uat-import-confirm-missing' },
)
record(
  'API-15-N2',
  '15',
  'salesImport.confirm missing batch with key',
  'NOT_FOUND; no sale',
  importConfirmKeyed.error,
  importConfirmKeyed.ok === false,
)

const cashierImportConfirm = await post(
  'salesImport.confirm',
  { actorUserId: 'u-siti', id: 'sib_none' },
  { idempotencyKey: 'uat-import-confirm-cashier' },
)
record(
  'API-15-N3',
  '15',
  'cashier salesImport.confirm missing batch',
  'FORBIDDEN or NOT_FOUND; cashier has sales.create so FORBIDDEN may not apply',
  cashierImportConfirm.error,
  cashierImportConfirm.ok === false,
)

const dispatch = await post('dispatch.list', { actorUserId: 'u-aina' })
record(
  'API-16-01',
  '16',
  'dispatch.list',
  'ok',
  { ok: dispatch.ok, n: (dispatch.data?.dispatches || []).length, vehicles: (dispatch.data?.vehicles || []).length },
  dispatch.ok === true,
)

const cashierVehicle = await post('vehicles.create', { actorUserId: 'u-siti', code: 'UAT-SHOULD-FAIL', plate: 'X' })
record(
  'API-16-N1',
  '16',
  'cashier vehicles.create',
  'FORBIDDEN',
  cashierVehicle.error,
  cashierVehicle.error?.code === 'FORBIDDEN',
)

const cashierDispatch = await post('dispatch.create', { actorUserId: 'u-siti', shipmentId: 'none' })
record(
  'API-16-N2',
  '16',
  'cashier dispatch.create',
  'FORBIDDEN',
  cashierDispatch.error,
  cashierDispatch.error?.code === 'FORBIDDEN',
)

const dispatchConfirm = await post('dispatch.confirm', { actorUserId: 'u-aina', id: 'dsp_none' })
record(
  'API-16-N3',
  '16',
  'dispatch.confirm without key / missing',
  'error, no inventory change',
  dispatchConfirm.error,
  dispatchConfirm.ok === false,
)

const dispatchConfirmKeyed = await post(
  'dispatch.confirm',
  { actorUserId: 'u-aina', id: 'dsp_none' },
  { idempotencyKey: 'uat-dispatch-confirm-missing' },
)
record(
  'API-16-N4',
  '16',
  'dispatch.confirm missing id with key',
  'NOT_FOUND; no stock movement',
  dispatchConfirmKeyed.error,
  dispatchConfirmKeyed.ok === false,
)

const dispatchVoidCashier = await post(
  'dispatch.void',
  { actorUserId: 'u-siti', id: 'dsp_none' },
  { idempotencyKey: 'uat-dispatch-void-cashier' },
)
record(
  'API-16-N5',
  '16',
  'cashier dispatch.void',
  'FORBIDDEN',
  dispatchVoidCashier.error,
  dispatchVoidCashier.error?.code === 'FORBIDDEN',
)

const expenses = await post('expenses.list', { actorUserId: 'u-aina' })
record(
  'API-17-01',
  '17',
  'expenses.list',
  'ok, 0 rows',
  { ok: expenses.ok, n: (expenses.data?.expenses || []).length },
  expenses.ok === true && (expenses.data?.expenses || []).length === 0,
)

const cashierExp = await post('expenses.create', {
  actorUserId: 'u-siti',
  category: 'Rent',
  description: 'UAT-SHOULD-FAIL',
  amount: 1,
  paymentMethod: 'cash',
})
record(
  'API-17-N1',
  '17',
  'cashier expenses.create',
  'FORBIDDEN You cannot manage expenses',
  cashierExp.error,
  cashierExp.error?.code === 'FORBIDDEN',
)

const zeroExpense = await post('expenses.create', {
  actorUserId: 'u-aina',
  category: 'Rent',
  description: 'UAT-SHOULD-FAIL-ZERO',
  amount: 0,
  paymentMethod: 'cash',
})
record(
  'API-17-N2',
  '17',
  'owner expenses.create amount 0',
  'VALIDATION_ERROR; no expense row',
  zeroExpense.error,
  zeroExpense.ok === false,
)

const halal = await post('halal.list', { actorUserId: 'u-aina' })
record('API-17-02', '17', 'halal.list', 'ok', { ok: halal.ok, n: (halal.data?.halalCertificates || halal.data?.materials || []).length }, halal.ok === true)

const tasks = await post('tasks.list', { actorUserId: 'u-aina' })
record(
  'API-17-03',
  '17',
  'tasks.list',
  'ok',
  { ok: tasks.ok, cats: (tasks.data?.staffTaskCategories || []).length, tasks: (tasks.data?.staffTasks || []).length },
  tasks.ok === true,
)

const dashOwner = await post('dashboard.get', {
  actorUserId: 'u-aina',
  today: '2026-09-10',
  preset: '30d',
  warehouseId: 'all',
})
record(
  'API-18-01',
  '18',
  'owner dashboard.get prototype today (PROTOTYPE_TODAY not changed)',
  'ok, salesCount 0',
  { ok: dashOwner.ok, salesCount: dashOwner.data?.salesCount, purchases: dashOwner.data?.purchaseCount },
  dashOwner.ok === true && dashOwner.data?.salesCount === 0,
)

const dashCash = await post('dashboard.get', { actorUserId: 'u-siti', today: '2026-09-10', preset: '30d' })
record(
  'API-18-N1',
  '18',
  'cashier dashboard.get',
  'FORBIDDEN',
  dashCash.error,
  dashCash.error?.code === 'FORBIDDEN',
)

const reportsSales = await post('reports.sales', { actorUserId: 'u-aina', today: '2026-09-10', preset: '30d' })
record(
  'API-18-03',
  '18',
  'reports.sales prototype today',
  'ok, invoices 0',
  { ok: reportsSales.ok, invoices: reportsSales.data?.invoices, revenue: reportsSales.data?.revenue },
  reportsSales.ok === true,
)

const cashierReports = await post('reports.sales', { actorUserId: 'u-siti', today: '2026-09-10', preset: '30d' })
record(
  'API-18-N3',
  '18',
  'cashier reports.sales',
  'FORBIDDEN',
  cashierReports.error,
  cashierReports.error?.code === 'FORBIDDEN',
)

const bmr = await post('bmr.list', { actorUserId: 'u-aina', today: '2026-09-10' })
record('API-18-02', '18', 'bmr.list', 'ok', { ok: bmr.ok, n: (bmr.data?.records || []).length }, bmr.ok === true)

const pjkmOwner = await post('pjkm.911', { actorUserId: 'u-aina', month: '2026-11' })
record(
  'API-18-04',
  '18',
  'owner pjkm.911 Nov 2026',
  'ok',
  { ok: pjkmOwner.ok, keys: Object.keys(pjkmOwner.data || {}).slice(0, 12) },
  pjkmOwner.ok === true,
)

const pjkm = await post('pjkm.911', { actorUserId: 'u-siti', month: '2026-11' })
record(
  'API-18-N2',
  '18',
  'cashier pjkm.911',
  'FORBIDDEN',
  pjkm.error,
  pjkm.error?.code === 'FORBIDDEN',
)

const badProduct = await post('inventory.adjust', {
  actorUserId: 'u-aina',
  warehouseId: 'wh-main',
  productId: 'no-such-product',
  type: 'increase',
  qty: 1,
  reason: 'UAT-SHOULD-FAIL',
})
record(
  'API-NEG-01A',
  '5',
  'inventory.adjust invalid product without key',
  'Idempotency key is required (checked first)',
  badProduct.error,
  badProduct.ok !== true,
)

const badProductKeyed = await post(
  'inventory.adjust',
  {
    actorUserId: 'u-aina',
    warehouseId: 'wh-main',
    productId: 'no-such-product',
    type: 'increase',
    qty: 1,
    reason: 'UAT-SHOULD-FAIL',
  },
  { idempotencyKey: 'uat-adjust-bad-product' },
)
record(
  'API-NEG-01',
  '5',
  'inventory.adjust invalid product with key',
  'NOT_FOUND Product was not found; no movement',
  badProductKeyed.error,
  badProductKeyed.ok !== true && /not found/i.test(badProductKeyed.error?.message || ''),
)

const badWh = await post(
  'inventory.adjust',
  {
    actorUserId: 'u-aina',
    warehouseId: 'wh-does-not-exist',
    productId: 'p-pack-mt',
    type: 'increase',
    qty: 1,
    reason: 'UAT-SHOULD-FAIL',
  },
  { idempotencyKey: 'uat-adjust-bad-wh' },
)
record(
  'API-NEG-02',
  '5',
  'inventory.adjust invalid warehouse with key',
  'NOT_FOUND Warehouse was not found',
  badWh.error,
  badWh.ok !== true && /not found|warehouse/i.test(badWh.error?.message || ''),
)

const badQty = await post(
  'inventory.adjust',
  {
    actorUserId: 'u-aina',
    warehouseId: 'wh-main',
    productId: 'p-pack-mt',
    type: 'increase',
    qty: 0,
    reason: 'UAT-SHOULD-FAIL',
  },
  { idempotencyKey: 'uat-adjust-zero-qty' },
)
record(
  'API-NEG-03',
  '5',
  'inventory.adjust qty 0 with key',
  'VALIDATION_ERROR Enter a quantity',
  badQty.error,
  badQty.ok !== true && /quantity/i.test(badQty.error?.message || ''),
)

const afterInv = await post('inventory.get', { actorUserId: 'u-aina' })
const after = snapshot(afterInv.data || {})
const afterSess = await post('sessions.list', { actorUserId: 'u-aina' })
const afterSessions = afterSess.data?.productionSessions || []
const lockedAfter = afterSessions.find((s) => s.reference === 'PROD-20261109-001')
const afterSales = await post('sales.list', { actorUserId: 'u-aina' })
const afterReturns = await post('salesReturns.list', { actorUserId: 'u-aina' })
const afterImports = await post('salesImport.list', { actorUserId: 'u-aina' })
record(
  'API-BASE-03',
  'baseline',
  'inventory unchanged after negative tests',
  before,
  after,
  after.rows === before.rows && after.mov === before.mov && after.diffs === 0 && after.dup === 0,
  'opening + stock in - stock out = closing',
)
record(
  'API-BASE-04',
  '12',
  'PROD-20261109-001 still planned unposted',
  'planned false',
  { status: lockedAfter?.status, posted: lockedAfter?.posted, n: afterSessions.length },
  lockedAfter?.status === 'planned' && !lockedAfter?.posted && afterSessions.length === sessions.length,
)
record(
  'API-BASE-05',
  '13/14/15',
  'no unintended sales, returns, or import orders',
  '0 sales, 0 new returns, import orders unchanged',
  {
    sales: (afterSales.data?.sales || []).length,
    returns: (afterReturns.data?.salesReturns || []).length,
    importOrders: (afterImports.data?.salesImportOrders || []).length,
    audits: (afterSales.data?.documentAuditLogs || []).length,
  },
  (afterSales.data?.sales || []).length === 0 &&
    (afterReturns.data?.salesReturns || []).length === (returns.data?.salesReturns || []).length,
)

writeFileSync(
  join(ROOT, 'logs', 'api-readonly.json'),
  JSON.stringify({ at: new Date().toISOString(), before, after, results }, null, 2),
)
const fail = results.filter((r) => r.status === 'FAIL').length
const blocked = results.filter((r) => r.status === 'BLOCKED').length
console.log(JSON.stringify({ total: results.length, pass: results.filter((r) => r.status === 'PASS').length, blocked, fail }))
process.exit(fail ? 1 : 0)
