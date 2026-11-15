import { formatCalendarDate, liveSystemDateKey } from './calendarDate'

export function headerDateLabels() {
  return {
    reportDate: formatCalendarDate('2026-09-10'),
    today: formatCalendarDate(liveSystemDateKey()),
  }
}
