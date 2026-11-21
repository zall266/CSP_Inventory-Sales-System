/**
 * Wait for live /exec hydrate on public Pages. Read-only. No write clicks.
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
mkdirSync(join(EVIDENCE, 'step-12'), { recursive: true })
mkdirSync(join(EVIDENCE, 'step-13'), { recursive: true })
mkdirSync(join(EVIDENCE, 'step-17'), { recursive: true })
mkdirSync(join(ROOT, 'logs'), { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const apiHits = []
page.on('response', async (res) => {
  const url = res.url()
  if (!url.includes('script.google.com') && !url.includes('/exec')) return
  let body = ''
  try {
    body = (await res.text()).slice(0, 400)
  } catch {
    body = ''
  }
  apiHits.push({ url: url.slice(0, 180), status: res.status(), body })
})

async function waitForText(path, needle, file, timeout = 25000) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await page.locator('text=Preview mode').first().waitFor({ timeout: 20000 }).catch(() => {})
  const found = await page
    .waitForFunction(
      (text) => document.body && document.body.innerText.includes(text),
      needle,
      { timeout },
    )
    .then(() => true)
    .catch(() => false)
  await page.screenshot({ path: join(EVIDENCE, file), fullPage: true })
  const actual = (await page.locator('body').innerText()).slice(0, 1500)
  return { found, actual }
}

const results = []
const planning = await waitForText('/manufacturing/planning', 'PROD-20261109-001', 'step-12/ui-12-13-hydrate-wait.png', 28000)
results.push({
  id: 'UI-12-13',
  module: '12',
  description: 'Wait up to 28s for live session PROD-20261109-001 on Planning',
  expected: 'Live Sheets session replaces seed PROD-20260910-001',
  actual: planning.found ? 'live session appeared' : planning.actual.match(/PROD-[^\n]+/g) || planning.actual.slice(0, 400),
  screenshot: 'step-12/ui-12-13-hydrate-wait.png',
  recon: 'API-12-01 has PROD-20261109-001; UI seed until packing.list applies',
  status: planning.found ? 'PASS' : 'FAIL',
})

const payments = await waitForText('/payments', 'PAY-000001', 'step-13/ui-13-09-hydrate-wait.png', 28000)
results.push({
  id: 'UI-13-09',
  module: '13',
  description: 'Wait up to 28s for live PAY-000001 on Payments',
  expected: 'Live closeout payments replace seed PAY-1001 series',
  actual: payments.found ? 'PAY-000001 appeared' : payments.actual.match(/PAY-[^\n]+/g)?.slice(0, 8) || payments.actual.slice(0, 400),
  screenshot: 'step-13/ui-13-09-hydrate-wait.png',
  recon: 'API-13-01 PAY-000001 / PAY-000002',
  status: payments.found ? 'PASS' : 'FAIL',
})

const expenses = await waitForText('/expenses', 'Add expense', 'step-17/ui-17-06-hydrate-wait.png', 12000)
const expenseRows = /Shop rental|Staff payroll/.test(expenses.actual)
results.push({
  id: 'UI-17-06',
  module: '17',
  description: 'Expenses page after wait: seed rows vs API 0',
  expected: 'API expenses.list is 0; UI may still show seed until ops.list applies',
  actual: expenseRows ? 'seed expense rows still visible' : expenses.actual.slice(0, 300),
  screenshot: 'step-17/ui-17-06-hydrate-wait.png',
  recon: 'API-17-01 n=0',
  status: 'BLOCKED',
})

await browser.close()
writeFileSync(
  join(ROOT, 'logs', 'browser-hydrate.json'),
  JSON.stringify({ at: new Date().toISOString(), apiHits: apiHits.slice(0, 20), results }, null, 2),
)
console.log(JSON.stringify({ results, apiHits: apiHits.length }, null, 2))
process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0)
