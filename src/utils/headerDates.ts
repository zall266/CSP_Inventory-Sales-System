import { formatCalendarDate, liveSystemDateKey } from './calendarDate'

export function headerDateLabels() {
  return {
    today: formatCalendarDate(liveSystemDateKey()),
  }
}
