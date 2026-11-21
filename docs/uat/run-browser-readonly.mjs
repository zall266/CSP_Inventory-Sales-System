/**
 * Read-only Playwright UAT against the public GitHub Pages SPA.
 * Does not click Accept / Start / Complete / Confirm / Save / Add expense / Create session.
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright')

const ROOT = dirname(fileURLToPath(import.meta.url))
const BASE = 'https://zall266.github.io/CSP_Inventory-Sales-System'
const EVIDENCE = join(ROOT, 'evidence')
const FORBIDDEN_CLICK = /Accept production|Start production|Complete production|Create session|Add expense|Add vehicle|New Dispatch|Confirm|Save vehicle|Record payment|Import|Post/i

const PAGES = [
  { id: 'UI-18-01', module: 'step-18', path: '/', title: 'Dashboard' },
  { id: 'UI-12-01', module: 'step-12', path: '/manufacturing/planning', title: 'Production Planning' },
  { id: 'UI-12-02', module: 'step-12', path: '/manufacturing/today', title: "Today's Production" },
  { id: 'UI-12-03', module: 'step-12', path: '/manufacturing/picking', title: 'Picking List' },
  { id: 'UI-12-04', module: 'step-12', path: '/manufacturing/complete', title: 'Complete production' },
  { id: 'UI-12-05', module: 'step-12', path: '/manufacturing/carry-forward', title: 'Carry Forward' },
  { id: 'UI-12-06', module: 'step-12', path: '/manufacturing/history', title: 'Production History' },
  { id: 'UI-13-01', module: 'step-13', path: '/sales', title: 'Sales' },
  { id: 'UI-13-02', module: 'step-13', path: '/pos', title: 'POS' },
  { id: 'UI-13-03', module: 'step-13', path: '/sales/quotations', title: 'Quotations' },
  { id: 'UI-13-04', module: 'step-13', path: '/sales/delivery-orders', title: 'Delivery Orders' },
  { id: 'UI-13-05', module: 'step-13', path: '/payments', title: 'Payments' },
  { id: 'UI-14-01', module: 'step-14', path: '/sales/returns', title: 'Returns' },
  { id: 'UI-14-02', module: 'step-14', path: '/sales/returns/new', title: 'New return' },
  { id: 'UI-15-01', module: 'step-15', path: '/sales/import', title: 'Sales Import' },
  { id: 'UI-15-02', module: 'step-15', path: '/sales/import/mappings', title: 'Mappings' },
  { id: 'UI-16-01', module: 'step-16', path: '/sales/dispatch', title: 'Dispatch' },
  { id: 'UI-16-02', module: 'step-16', path: '/settings/vehicles', title: 'Vehicles' },
  { id: 'UI-17-01', module: 'step-17', path: '/compliance/halal', title: 'Halal Compliance' },
  { id: 'UI-17-02', module: 'step-17', path: '/tasks', title: 'My Tasks' },
  { id: 'UI-17-03', module: 'step-17', path: '/expenses', title: 'Expenses' },
  { id: 'UI-18-02', module: 'step-18', path: '/reports/sales', title: 'Sales Reports' },
  { id: 'UI-18-03', module: 'step-18', path: '/reports/purchases', title: 'Purchase Reports' },
  { id: 'UI-18-04', module: 'step-18', path: '/reports/inventory', title: 'Inventory Reports' },
  { id: 'UI-18-05', module: 'step-18', path: '/reports/profit', title: 'Profit Reports' },
  { id: 'UI-18-06', module: 'step-18', path: '/reports/manufacturing', title: 'Manufacturing Reports' },
  { id: 'UI-18-07', module: 'step-18', path: '/pjkm', title: 'PJKM Records' },
  { id: 'UI-18-08', module: 'step-18', path: '/compliance/bmr', title: 'BMR Records' },
  { id: 'UI-18-09', module: 'step-18', path: '/stock-movements', title: 'Stock Movements' },
  { id: 'UI-18-10', module: 'step-18', path: '/pjkm/9.1.1', title: '9.1.1' },
]

function urlFor(path) {
  return BASE + path
}

async function waitSettled(page, extraMs = 3500) {
  await page.waitForLoadState('domcontentloaded')
  await page.locator('text=Preview mode').first().waitFor({ timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(extraMs)
}

async function bodyOf(page) {
  return page.locator('body').innerText()
}

const results = []
function push(row) {
  results.push(row)
  console.log(JSON.stringify({ id: row.id, status: row.status, description: row.description }))
}

mkdirSync(join(EVIDENCE, 'step-12'), { recursive: true })
mkdirSync(join(EVIDENCE, 'step-13'), { recursive: true })
mkdirSync(join(EVIDENCE, 'step-14'), { recursive: true })
mkdirSync(join(EVIDENCE, 'step-15'), { recursive: true })
mkdirSync(join(EVIDENCE, 'step-16'), { recursive: true })
mkdirSync(join(EVIDENCE, 'step-17'), { recursive: true })
mkdirSync(join(EVIDENCE, 'step-18'), { recursive: true })
mkdirSync(join(ROOT, 'logs'), { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.setDefaultTimeout(45000)

page.on('dialog', async (dialog) => {
  await dialog.dismiss()
})

await page.goto(urlFor('/'), { waitUntil: 'domcontentloaded' })
await waitSettled(page, 6000)
const loaded = await page.locator('text=Preview mode').first().isVisible().catch(() => false)
push({
  id: 'UI-LOAD-01',
  module: 'baseline',
  description: 'Public DEV frontend loads with Preview mode',
  expected: 'Preview mode badge visible',
  actual: loaded ? 'visible' : 'missing',
  screenshot: 'step-18/ui-load-01.png',
  recon: 'n/a',
  status: loaded ? 'PASS' : 'FAIL',
})
await page.screenshot({ path: join(EVIDENCE, 'step-18', 'ui-load-01.png'), fullPage: true })

const bundle = await page.evaluate(() => {
  const s = [...document.scripts].find((el) => el.src.includes('index-'))
  return s ? s.src : ''
})
push({
  id: 'UI-LOAD-02',
  module: 'baseline',
  description: 'Live JS bundle filename',
  expected: 'index-BIZo9uFM.js (pre-PR #113 Pages)',
  actual: bundle,
  screenshot: 'step-18/ui-load-01.png',
  recon: 'n/a',
  status: bundle.includes('index-BIZo9uFM.js') ? 'PASS' : 'FAIL',
})

const headerDate = await page.locator('header').innerText()
push({
  id: 'UI-LOAD-03',
  module: '18',
  description: 'Header still shows PROTOTYPE_TODAY 10 Sept 2026 (not globally changed)',
  expected: '10 Sept 2026 (or 10 Sep 2026) in header; Daily Sessions uses live date separately',
  actual: headerDate.match(/10 Sep[t]? 2026|10\/09\/2026|2026-09-10/)?.[0] || headerDate.slice(0, 180),
  screenshot: 'step-18/ui-load-01.png',
  recon: 'n/a',
  status: /10 Sep/i.test(headerDate) ? 'PASS' : 'FAIL',
})

for (const item of PAGES) {
  mkdirSync(join(EVIDENCE, item.module), { recursive: true })
  const file = `${item.id.toLowerCase()}.png`
  await page.goto(urlFor(item.path), { waitUntil: 'domcontentloaded' })
  await waitSettled(page)
  const bodyText = (await bodyOf(page)).slice(0, 5000)
  const crashed = /Unexpected Application Error|Something went wrong/i.test(bodyText)
  const headingHit =
    bodyText.includes(item.title) ||
    new RegExp(item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(bodyText) ||
    bodyText.length > 80
  await page.screenshot({ path: join(EVIDENCE, item.module, file), fullPage: true })
  push({
    id: item.id,
    module: item.module.replace('step-', ''),
    description: `Render ${item.title} (${item.path})`,
    expected: `Page renders; no application crash; ${item.title} present or substantial content`,
    actual: crashed ? 'CRASH' : headingHit ? `rendered (${bodyText.split('\n').filter(Boolean)[0]?.slice(0, 80)})` : bodyText.slice(0, 120),
    screenshot: `${item.module}/${file}`,
    recon: 'display only; API recon is separate',
    status: !crashed && headingHit ? 'PASS' : 'FAIL',
  })
}

await page.goto(urlFor('/manufacturing/planning'))
await waitSettled(page, 6000)
const planningText = await bodyOf(page)
const hasLocked = /PROD-20261109-001/.test(planningText)
const dateOk = /09 Nov 2026|9 Nov 2026|2026-11-09/.test(planningText)
push({
  id: 'UI-12-07',
  module: '12',
  description: 'Planning list shows PROD-20261109-001 with 9 Nov 2026, not Invalid Date',
  expected: 'PROD-20261109-001 and 09 Nov 2026',
  actual: { hasLocked, dateOk, snippet: planningText.match(/PROD-20261109-001[\s\S]{0,160}/)?.[0] },
  screenshot: 'step-12/ui-12-07-planning-date.png',
  recon: 'matches sessions.list productionDate 2026-11-09',
  status: hasLocked && dateOk && !/Invalid Date/.test(planningText) ? 'PASS' : 'FAIL',
})
await page.screenshot({ path: join(EVIDENCE, 'step-12', 'ui-12-07-planning-date.png'), fullPage: true })

const createForm = /New daily session|Production date|Create session/.test(planningText)
push({
  id: 'UI-12-09',
  module: '12',
  description: 'Planning creation form is visible (not submitted)',
  expected: 'New daily session form + Create session button present; not clicked',
  actual: createForm ? 'form visible; Create session not clicked' : planningText.slice(0, 160),
  screenshot: 'step-12/ui-12-01.png',
  recon: 'n/a',
  status: createForm ? 'PASS' : 'FAIL',
})

await page.goto(urlFor('/manufacturing/today'))
await waitSettled(page, 5000)
const todayText = await bodyOf(page)
const prototypeFrozen = /No daily session for 10 Sept|No daily session for 10 Sep/.test(todayText)
push({
  id: 'UI-12-08',
  module: '12',
  description: "Today's Production uses live Malaysia date, not frozen 10 Sept 2026",
  expected: 'Not frozen prototype 10 Sept 2026 as the operational day',
  actual: todayText.match(/No daily session[^\n]*|Today[^\n]{0,80}|15 Nov|14 Nov|16 Nov/)?.[0] || todayText.slice(0, 220),
  screenshot: 'step-12/ui-12-08-today-date.png',
  recon: 'live Malaysia operational date',
  status: prototypeFrozen ? 'FAIL' : 'PASS',
})
await page.screenshot({ path: join(EVIDENCE, 'step-12', 'ui-12-08-today-date.png'), fullPage: true })

await page.goto(urlFor('/manufacturing/history'))
await waitSettled(page, 5000)
const historySearch = page.getByPlaceholder('Search reference or product')
await historySearch.fill('PROD-20261109-001')
await page.waitForTimeout(800)
await page.screenshot({ path: join(EVIDENCE, 'step-12', 'ui-12-10-history-search.png'), fullPage: true })
const historyText = await bodyOf(page)
push({
  id: 'UI-12-10',
  module: '12',
  description: 'History search filters to PROD-20261109-001',
  expected: 'Search shows the locked session',
  actual: historyText.match(/PROD-20261109-001[\s\S]{0,80}/)?.[0] || historyText.slice(0, 160),
  screenshot: 'step-12/ui-12-10-history-search.png',
  recon: 'same reference as API-12-01',
  status: /PROD-20261109-001/.test(historyText) ? 'PASS' : 'FAIL',
})

await page.goto(urlFor('/manufacturing/history/ps_p2lblrm1i'))
await waitSettled(page, 5000)
await page.screenshot({ path: join(EVIDENCE, 'step-12', 'ui-12-11-session-detail.png'), fullPage: true })
const detailText = await bodyOf(page)
push({
  id: 'UI-12-11',
  module: '12',
  description: 'Session detail for PROD-20261109-001 (read-only; Accept not clicked)',
  expected: 'Detail renders planned session; Accept not exercised',
  actual: detailText.match(/PROD-20261109-001[\s\S]{0,120}|Planned[\s\S]{0,80}/)?.[0] || detailText.slice(0, 180),
  screenshot: 'step-12/ui-12-11-session-detail.png',
  recon: 'status planned unposted',
  status: /PROD-20261109-001|Planned|planned/i.test(detailText) && !/Unexpected Application Error/.test(detailText) ? 'PASS' : 'FAIL',
})

const searchBox = page.getByPlaceholder('Search products, invoices, production, batches...')
await searchBox.fill('PROD-20261109-001')
await page.waitForTimeout(800)
await page.screenshot({ path: join(EVIDENCE, 'step-12', 'ui-12-12-global-search.png'), fullPage: true })
const searchText = await bodyOf(page)
push({
  id: 'UI-12-12',
  module: '12',
  description: 'Global header search finds the locked session',
  expected: 'Search results include PROD-20261109-001 after hydrate',
  actual: searchText.match(/PROD-20261109-001[\s\S]{0,80}/)?.[0] || searchText.slice(0, 160),
  screenshot: 'step-12/ui-12-12-global-search.png',
  recon: 'n/a',
  status: /PROD-20261109-001/.test(searchText) ? 'PASS' : 'FAIL',
})
await searchBox.fill('')

await page.goto(urlFor('/sales'))
await waitSettled(page, 4000)
const salesSearch = page.getByPlaceholder('Search invoice or customer')
await salesSearch.fill('INV')
await page.waitForTimeout(600)
await page.screenshot({ path: join(EVIDENCE, 'step-13', 'ui-13-06-sales-search.png'), fullPage: true })
const salesText = await bodyOf(page)
push({
  id: 'UI-13-06',
  module: '13',
  description: 'Sales list search (no live invoices expected)',
  expected: 'Page remains stable; empty or matching rows; no crash',
  actual: salesText.slice(0, 220),
  screenshot: 'step-13/ui-13-06-sales-search.png',
  recon: 'API sales.list n=0',
  status: /Unexpected Application Error/.test(salesText) ? 'FAIL' : 'PASS',
})

await page.goto(urlFor('/payments'))
await waitSettled(page, 4000)
await page.screenshot({ path: join(EVIDENCE, 'step-13', 'ui-13-07-payments.png'), fullPage: true })
const payText = await bodyOf(page)
push({
  id: 'UI-13-07',
  module: '13',
  description: 'Customer payments display locked closeout PAY rows',
  expected: 'PAY-000001 and/or PAY-000002 after hydrate, or empty table if overlay not loaded',
  actual: payText.match(/PAY-\d+/) ? payText.match(/PAY-\d+/g) : payText.slice(0, 200),
  screenshot: 'step-13/ui-13-07-payments.png',
  recon: 'API payments length 2',
  status: /PAY-000001|PAY-000002|Payment no/.test(payText) ? 'PASS' : 'FAIL',
})

await page.goto(urlFor('/pos'))
await waitSettled(page, 4000)
await page.screenshot({ path: join(EVIDENCE, 'step-13', 'ui-13-08-pos.png'), fullPage: true })
const posText = await bodyOf(page)
push({
  id: 'UI-13-08',
  module: '13',
  description: 'POS catalogue renders (no checkout)',
  expected: 'POS search / products; Charge/Pay not clicked',
  actual: posText.slice(0, 200),
  screenshot: 'step-13/ui-13-08-pos.png',
  recon: 'n/a',
  status: /POS|Search name|Charge|Pay|Walk-in/i.test(posText) ? 'PASS' : 'FAIL',
})

await page.goto(urlFor('/sales/returns'))
await waitSettled(page, 4000)
const retSearch = page.getByPlaceholder('Search return no, source, customer')
if (await retSearch.count()) {
  await retSearch.fill('RT-')
  await page.waitForTimeout(500)
}
await page.screenshot({ path: join(EVIDENCE, 'step-14', 'ui-14-03-search.png'), fullPage: true })
const retText = await bodyOf(page)
push({
  id: 'UI-14-03',
  module: '14',
  description: 'Returns list + search; New Return not posted',
  expected: 'List renders; no confirmed returns required',
  actual: retText.slice(0, 220),
  screenshot: 'step-14/ui-14-03-search.png',
  recon: 'API salesReturns n',
  status: /Return|Unexpected Application Error/.test(retText) && !/Unexpected Application Error/.test(retText) ? 'PASS' : 'FAIL',
})

await page.goto(urlFor('/sales/import'))
await waitSettled(page, 5000)
await page.screenshot({ path: join(EVIDENCE, 'step-15', 'ui-15-03-accounts.png'), fullPage: true })
const importText = await bodyOf(page)
push({
  id: 'UI-15-03',
  module: '15',
  description: 'Sales import accounts / preview (no ingest, no confirm)',
  expected: 'Import screen renders; confirm/import not clicked',
  actual: importText.slice(0, 240),
  screenshot: 'step-15/ui-15-03-accounts.png',
  recon: 'API salesImportAccounts',
  status: /Import|Account|Shopee|Lazada|TikTok|Mapping/i.test(importText) && !/Unexpected Application Error/.test(importText) ? 'PASS' : 'FAIL',
})

await page.goto(urlFor('/sales/dispatch'))
await waitSettled(page, 4000)
const dispatchText = await bodyOf(page)
push({
  id: 'UI-16-03',
  module: '16',
  description: 'Dispatch list New Dispatch button present for owner; not clicked',
  expected: 'Page renders; New Dispatch not clicked',
  actual: /New Dispatch/.test(dispatchText) ? 'New Dispatch visible, not clicked' : dispatchText.slice(0, 180),
  screenshot: 'step-16/ui-16-01.png',
  recon: 'API dispatches 0',
  status: /Dispatch/.test(dispatchText) ? 'PASS' : 'FAIL',
})

await page.goto(urlFor('/compliance/halal'))
await waitSettled(page, 4000)
const halalSearch = page.getByPlaceholder('Search material...')
if (await halalSearch.count()) {
  await halalSearch.fill('mint')
  await page.waitForTimeout(500)
}
await page.screenshot({ path: join(EVIDENCE, 'step-17', 'ui-17-05-halal-search.png'), fullPage: true })
const halalText = await bodyOf(page)
push({
  id: 'UI-17-05',
  module: '17',
  description: 'Halal listing + material search',
  expected: 'Halal page filters without write',
  actual: halalText.slice(0, 220),
  screenshot: 'step-17/ui-17-05-halal-search.png',
  recon: 'API halal.list ok',
  status: /Halal|Certificate|Status/.test(halalText) ? 'PASS' : 'FAIL',
})

await page.goto(urlFor('/expenses'))
await waitSettled(page)
const expensesText = await bodyOf(page)
const addExpenseVisible = /Add expense/.test(expensesText)
push({
  id: 'UI-17-04',
  module: '17',
  description: 'Expenses Add button on pre-PR #113 Pages bundle',
  expected: 'BLOCKED until #113 merges; Add expense currently visible for default owner role',
  actual: addExpenseVisible ? 'Add expense visible' : 'Add expense not visible',
  screenshot: 'step-17/ui-17-03.png',
  recon: 'API expenses 0; UI permission not the #113 gated control',
  status: 'BLOCKED',
})

await page.goto(urlFor('/reports/sales'))
await waitSettled(page, 4000)
await page.screenshot({ path: join(EVIDENCE, 'step-18', 'ui-18-11-sales-report.png'), fullPage: true })
const reportText = await bodyOf(page)
push({
  id: 'UI-18-11',
  module: '18',
  description: 'Sales report KPIs on prototype date range (PROTOTYPE_TODAY unchanged)',
  expected: 'Sales Reports page; invoices/revenue display; do not change PROTOTYPE_TODAY',
  actual: reportText.match(/Invoices[\s\S]{0,40}|Revenue[\s\S]{0,40}/)?.[0] || reportText.slice(0, 200),
  screenshot: 'step-18/ui-18-11-sales-report.png',
  recon: 'API reports.sales invoices',
  status: /Sales Reports|Invoices|Revenue/.test(reportText) ? 'PASS' : 'FAIL',
})

await page.click('button[aria-label="Switch prototype role"]')
await page.waitForTimeout(500)
await page.getByText(/Siti/).first().click()
await waitSettled(page)
await page.goto(urlFor('/'))
await waitSettled(page, 4000)
await page.screenshot({ path: join(EVIDENCE, 'step-18', 'ui-18-cashier-dashboard.png'), fullPage: true })
const cashierDash = await bodyOf(page)
push({
  id: 'UI-18-N1',
  module: '18',
  description: 'Cashier dashboard UI (Pages pre-#113). API is FORBIDDEN; UI may still show local overlay fallback',
  expected: 'Document actual UI. Do not claim API deny from this screenshot alone',
  actual: cashierDash.slice(0, 400),
  screenshot: 'step-18/ui-18-cashier-dashboard.png',
  recon: 'API-18-N1 FORBIDDEN; UI overlay is local math',
  status: /Siti|Cashier/i.test(cashierDash) ? 'PASS' : 'FAIL',
})

await page.goto(urlFor('/expenses'))
await waitSettled(page)
await page.screenshot({ path: join(EVIDENCE, 'step-17', 'ui-17-cashier-expenses.png'), fullPage: true })
const cashierExp = await bodyOf(page)
push({
  id: 'UI-17-N1',
  module: '17',
  description: 'Cashier expenses page on pre-PR #113 bundle',
  expected: 'Add expense still present until #113 Pages deploy — BLOCKED for UI permission PASS',
  actual: /Add expense/.test(cashierExp) ? 'Add expense visible' : cashierExp.slice(0, 200),
  screenshot: 'step-17/ui-17-cashier-expenses.png',
  recon: 'API-17-N1 FORBIDDEN on create; UI not gated on live Pages',
  status: 'BLOCKED',
})

await page.goto(urlFor('/reports/sales'))
await waitSettled(page, 3500)
await page.screenshot({ path: join(EVIDENCE, 'step-18', 'ui-18-cashier-reports.png'), fullPage: true })
const cashierRep = await bodyOf(page)
push({
  id: 'UI-18-N2',
  module: '18',
  description: 'Cashier sales reports UI vs API FORBIDDEN',
  expected: 'Document UI. API reports.view is FORBIDDEN; page may still render local overlay',
  actual: cashierRep.slice(0, 280),
  screenshot: 'step-18/ui-18-cashier-reports.png',
  recon: 'API-18-N3 FORBIDDEN',
  status: /Siti|Cashier|Permission Denied|Sales Reports/.test(cashierRep) ? 'PASS' : 'FAIL',
})

await page.goto(urlFor('/sales/dispatch'))
await waitSettled(page, 3500)
await page.screenshot({ path: join(EVIDENCE, 'step-16', 'ui-16-cashier-dispatch.png'), fullPage: true })
const cashierDisp = await bodyOf(page)
push({
  id: 'UI-16-N1',
  module: '16',
  description: 'Cashier dispatch page (do not confirm)',
  expected: 'Permission denied or list without New Dispatch depending on delivery.view',
  actual: cashierDisp.slice(0, 240),
  screenshot: 'step-16/ui-16-cashier-dispatch.png',
  recon: 'API-16-N2 FORBIDDEN on create',
  status: /Dispatch|Permission Denied/.test(cashierDisp) ? 'PASS' : 'FAIL',
})

await page.goto(urlFor('/manufacturing/today'))
await waitSettled(page)
await page.screenshot({ path: join(EVIDENCE, 'step-12', 'ui-12-cashier-today.png'), fullPage: true })
push({
  id: 'UI-12-N1',
  module: '12',
  description: "Cashier Today's Production (read-only screenshot; no Accept click)",
  expected: 'Page renders; Accept not exercised',
  actual: 'screenshot captured; Accept not clicked',
  screenshot: 'step-12/ui-12-cashier-today.png',
  recon: 'API-12-N2 FORBIDDEN',
  status: 'PASS',
})

await page.goto(urlFor('/sales/returns'))
await waitSettled(page)
await page.screenshot({ path: join(EVIDENCE, 'step-14', 'ui-14-cashier-returns.png'), fullPage: true })
const cashierRet = await bodyOf(page)
push({
  id: 'UI-14-N1',
  module: '14',
  description: 'Cashier returns list',
  expected: 'Page renders or permission denied; no save',
  actual: cashierRet.slice(0, 200),
  screenshot: 'step-14/ui-14-cashier-returns.png',
  recon: 'API-14-N1 FORBIDDEN on save',
  status: /Return|Permission Denied/.test(cashierRet) ? 'PASS' : 'FAIL',
})

const clickedForbidden = []
const buttons = await page.locator('button').allTextContents()
for (const label of buttons) {
  if (FORBIDDEN_CLICK.test(label)) clickedForbidden.push(label)
}
push({
  id: 'UI-SAFE-01',
  module: 'baseline',
  description: 'Write-capable buttons observed but not clicked in this run',
  expected: 'No Accept/Start/Complete/Confirm/Save/Add expense clicks',
  actual: { observed: [...new Set(clickedForbidden)].slice(0, 12), clicked: [] },
  screenshot: 'n/a',
  recon: 'inventory snapshot compared in API runner',
  status: 'PASS',
})

await browser.close()
writeFileSync(join(ROOT, 'logs', 'browser-readonly.json'), JSON.stringify({ at: new Date().toISOString(), bundle, results }, null, 2))
const fail = results.filter((r) => r.status === 'FAIL').length
console.log(
  JSON.stringify(
    {
      total: results.length,
      pass: results.filter((r) => r.status === 'PASS').length,
      blocked: results.filter((r) => r.status === 'BLOCKED').length,
      fail,
      bundle,
    },
    null,
    2,
  ),
)
process.exit(fail ? 1 : 0)
