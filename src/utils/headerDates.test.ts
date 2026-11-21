import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { formatCalendarDate, liveSystemDateKey } from './calendarDate.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('report date 2026-09-10 stays distinct from live Malaysia today', () => {
  const reportDate = formatCalendarDate('2026-09-10')
  const today = formatCalendarDate(liveSystemDateKey())
  assert.match(reportDate, /^10 Sept? 2026$/)
  assert.equal(today, formatCalendarDate(liveSystemDateKey()))
  assert.notEqual(reportDate, today)
})

test('header markup labels Today without a static Report date and without changing report payloads', () => {
  const header = fs.readFileSync(path.join(root, 'src/components/layout/Header.tsx'), 'utf8')
  const reporting = fs.readFileSync(path.join(root, 'src/store/reportingSync.ts'), 'utf8')
  const helper = fs.readFileSync(path.join(root, 'src/utils/headerDates.ts'), 'utf8')
  const dashboard = fs.readFileSync(path.join(root, 'src/features/dashboard/DashboardPage.tsx'), 'utf8')
  assert.equal(header.includes('Report date'), false)
  assert.equal(header.includes('data-header-report-date'), false)
  assert.equal(header.includes('Today'), true)
  assert.equal(header.includes('headerDateLabels'), true)
  assert.equal(helper.includes('liveSystemDateKey()'), true)
  assert.equal(reporting.includes('today: systemDateKey(PROTOTYPE_TODAY)'), true)
  assert.equal(dashboard.includes("{ id: '7d', label: '7 Days' }"), true)
  assert.equal(dashboard.includes("{ id: '30d', label: '30 Days' }"), true)
  assert.equal(dashboard.includes("{ id: '90d', label: '90 Days' }"), true)
  assert.equal(dashboard.includes("{ id: 'custom', label: 'Custom' }"), true)
})

test('POS header hides office-only controls and the prototype role switcher', () => {
  const header = fs.readFileSync(path.join(root, 'src/components/layout/Header.tsx'), 'utf8')
  const pos = fs.readFileSync(path.join(root, 'src/features/pos/PosPage.tsx'), 'utf8')
  assert.equal(header.includes("pathname === '/pos'"), true)
  assert.equal(header.includes('data-header-search'), true)
  assert.equal(header.includes('data-header-quick-add'), true)
  assert.equal(header.includes('data-header-warehouse'), true)
  assert.equal(header.includes('data-header-today'), true)
  assert.equal(header.includes('data-header-report-date'), false)
  assert.equal(header.includes('data-header-user'), true)
  assert.equal(header.includes('Preview mode'), false)
  assert.equal(header.includes('Switch role (prototype)'), false)
  assert.equal(header.includes('api.switchUser'), false)
  assert.equal(header.includes('setWarehouseFilter'), true)
  assert.equal(pos.includes('Search name, SKU or barcode'), true)
  assert.equal(pos.includes('data-pos-search'), true)
})
