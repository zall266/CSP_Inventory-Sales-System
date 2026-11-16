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

test('header markup labels Report date and Today without changing report payloads', () => {
  const header = fs.readFileSync(path.join(root, 'src/components/layout/Header.tsx'), 'utf8')
  const reporting = fs.readFileSync(path.join(root, 'src/store/reportingSync.ts'), 'utf8')
  const helper = fs.readFileSync(path.join(root, 'src/utils/headerDates.ts'), 'utf8')
  assert.equal(header.includes('Report date'), true)
  assert.equal(header.includes('Today'), true)
  assert.equal(header.includes('headerDateLabels'), true)
  assert.equal(helper.includes("formatCalendarDate('2026-09-10')"), true)
  assert.equal(helper.includes('liveSystemDateKey()'), true)
  assert.equal(reporting.includes('today: systemDateKey(PROTOTYPE_TODAY)'), true)
})
