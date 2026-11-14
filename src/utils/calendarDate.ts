const MALAYSIA_TZ = 'Asia/Kuala_Lumpur'
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const NUMERIC_SERIAL = /^\d+(\.0+)?$/

export function malaysiaDateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MALAYSIA_TZ }).format(date)
}

/** Live Malaysia calendar date. Does not use PROTOTYPE_TODAY. */
export function liveSystemDateKey() {
  return malaysiaDateKey(new Date())
}

function isRealUtcYmd(year: number, month: number, day: number) {
  const check = new Date(Date.UTC(year, month - 1, day))
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
}

function excelSerialToDateKey(serial: number) {
  if (!(serial >= 20000 && serial <= 80000)) return null
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000
  const date = new Date(utc)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Canonical operational production date (YYYY-MM-DD in Asia/Kuala_Lumpur).
 * Returns null for missing or invalid values. Never substitutes today's date.
 */
export function canonicalCalendarDate(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return malaysiaDateKey(value)
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return excelSerialToDateKey(value)
  }
  const raw = String(value).trim()
  if (!raw) return null
  const dateOnly = raw.match(DATE_ONLY)
  if (dateOnly) {
    const year = Number(dateOnly[1])
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    if (!isRealUtcYmd(year, month, day)) return null
    return raw
  }
  if (NUMERIC_SERIAL.test(raw)) {
    return excelSerialToDateKey(Number(raw))
  }
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return malaysiaDateKey(parsed)
}

export function calendarDatesEqual(left: unknown, right: unknown) {
  const a = canonicalCalendarDate(left)
  const b = canonicalCalendarDate(right)
  return Boolean(a && b && a === b)
}

/** Human-readable production date. Missing/invalid stay visible; never fall back to today. */
export function formatCalendarDate(value: unknown, options?: { short?: boolean }) {
  if (value == null || String(value).trim() === '') return 'Date missing'
  const key = canonicalCalendarDate(value)
  if (!key) return 'Invalid date'
  const date = new Date(`${key}T12:00:00+08:00`)
  const opts: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    timeZone: MALAYSIA_TZ,
  }
  if (!options?.short) opts.year = 'numeric'
  return date.toLocaleDateString('en-GB', opts)
}
