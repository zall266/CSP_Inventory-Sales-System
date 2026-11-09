import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calendarDatesEqual,
  canonicalCalendarDate,
  formatCalendarDate,
  liveSystemDateKey,
  malaysiaDateKey,
} from './calendarDate.ts'

const PROTOTYPE_TODAY = new Date('2026-09-10T12:00:00+08:00')

test('canonicalCalendarDate keeps date-only YYYY-MM-DD without shifting', () => {
  assert.equal(canonicalCalendarDate('2026-11-09'), '2026-11-09')
  assert.equal(formatCalendarDate('2026-11-09'), '09 Nov 2026')
})

test('canonicalCalendarDate reads Malaysia-offset ISO timestamps', () => {
  assert.equal(canonicalCalendarDate('2026-11-09T00:00:00+08:00'), '2026-11-09')
  assert.equal(canonicalCalendarDate('2026-11-08T16:00:00.000Z'), '2026-11-09')
  assert.equal(formatCalendarDate('2026-11-09T00:00:00+08:00'), '09 Nov 2026')
})

test('canonicalCalendarDate reads historical Apps Script Date strings', () => {
  const historical = 'Mon Nov 09 2026 00:00:00 GMT+0800 (Malaysia Time)'
  assert.equal(canonicalCalendarDate(historical), '2026-11-09')
  assert.equal(formatCalendarDate(historical), '09 Nov 2026')
  assert.equal(Number.isNaN(new Date(`${historical}T00:00:00+08:00`).getTime()), true)
})

test('canonicalCalendarDate reads Excel serial values from Sheets', () => {
  assert.equal(canonicalCalendarDate(46335), '2026-11-09')
  assert.equal(canonicalCalendarDate('46335.0'), '2026-11-09')
  assert.equal(formatCalendarDate(46335), '09 Nov 2026')
})

test('missing and invalid dates stay visible and do not become today', () => {
  const today = liveSystemDateKey()
  assert.equal(canonicalCalendarDate(''), null)
  assert.equal(canonicalCalendarDate(null), null)
  assert.equal(canonicalCalendarDate(undefined), null)
  assert.equal(canonicalCalendarDate('not-a-date'), null)
  assert.equal(canonicalCalendarDate('2026-13-40'), null)
  assert.equal(formatCalendarDate(''), 'Date missing')
  assert.equal(formatCalendarDate(null), 'Date missing')
  assert.equal(formatCalendarDate('not-a-date'), 'Invalid date')
  assert.notEqual(formatCalendarDate(''), formatCalendarDate(today))
  assert.notEqual(canonicalCalendarDate('not-a-date'), today)
})

test('date-only formatting does not shift across timezone boundaries', () => {
  assert.equal(formatCalendarDate('2026-11-09'), '09 Nov 2026')
  assert.notEqual(formatCalendarDate('2026-11-09'), '08 Nov 2026')
  assert.notEqual(formatCalendarDate('2026-11-09'), '10 Nov 2026')
})

test('session list date helper displays the stored production day', () => {
  const rows = [
    { reference: 'PROD-20261109-001', productionDate: 'Mon Nov 09 2026 00:00:00 GMT+0800 (Malaysia Time)' },
    { reference: 'PROD-20260908-001', productionDate: '2026-09-08' },
  ]
  assert.deepEqual(
    rows.map((row) => ({ reference: row.reference, date: formatCalendarDate(row.productionDate) })),
    [
      { reference: 'PROD-20261109-001', date: '09 Nov 2026' },
      { reference: 'PROD-20260908-001', date: '08 Sept 2026' },
    ],
  )
})

test('liveSystemDateKey uses the current Malaysia calendar date, not PROTOTYPE_TODAY', () => {
  assert.equal(malaysiaDateKey(PROTOTYPE_TODAY), '2026-09-10')
  assert.equal(liveSystemDateKey(), malaysiaDateKey(new Date()))
  assert.notEqual(liveSystemDateKey(), malaysiaDateKey(PROTOTYPE_TODAY))
})

test('Today\'s Production filter matches only the current Malaysia date', () => {
  const today = liveSystemDateKey()
  const sessions = [
    { id: 'today', productionDate: today, reference: 'PROD-TODAY' },
    { id: 'other', productionDate: '2026-09-10', reference: 'PROD-PROTOTYPE' },
    { id: 'uat', productionDate: 'Mon Nov 09 2026 00:00:00 GMT+0800 (Malaysia Time)', reference: 'PROD-20261109-001' },
  ]
  const todays = sessions.filter((item) => calendarDatesEqual(item.productionDate, today))
  assert.equal(todays.some((item) => item.id === 'today'), true)
  assert.equal(todays.some((item) => item.id === 'other'), false)
  if (today === '2026-11-09') {
    assert.equal(todays.some((item) => item.reference === 'PROD-20261109-001'), true)
  } else {
    assert.equal(todays.some((item) => item.reference === 'PROD-20261109-001'), false)
  }
})

test('Malaysia midnight boundary stays on the correct calendar day', () => {
  assert.equal(malaysiaDateKey(new Date('2026-11-08T16:00:00.000Z')), '2026-11-09')
  assert.equal(malaysiaDateKey(new Date('2026-11-09T15:59:59.000Z')), '2026-11-09')
  assert.equal(malaysiaDateKey(new Date('2026-11-09T16:00:00.000Z')), '2026-11-10')
  assert.equal(canonicalCalendarDate(new Date('2026-11-08T16:00:00.000Z')), '2026-11-09')
  assert.equal(canonicalCalendarDate(new Date('2026-11-09T16:00:00.000Z')), '2026-11-10')
})
