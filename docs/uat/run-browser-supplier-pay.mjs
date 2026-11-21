import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright')
const ROOT = dirname(fileURLToPath(import.meta.url))
const BASE = 'https://zall266.github.io/CSP_Inventory-Sales-System'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(BASE + '/payments', { waitUntil: 'domcontentloaded' })
await page.locator('text=Preview mode').first().waitFor({ timeout: 20000 })
await page.waitForTimeout(12000)
await page.getByText('Supplier payments', { exact: true }).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: join(ROOT, 'evidence/step-13/ui-13-10-supplier-payments.png'), fullPage: true })
const text = await page.locator('body').innerText()
console.log(JSON.stringify({
  hasPay1: /PAY-000001/.test(text),
  hasPay2: /PAY-000002/.test(text),
  payHits: text.match(/PAY-\d+/g)?.slice(0, 12) || [],
}))
await browser.close()
