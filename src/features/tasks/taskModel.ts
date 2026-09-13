import type {
  AppState,
  StaffTask,
  StaffTaskCategory,
  StaffTaskFrequency,
  StaffTaskOccurrence,
  StaffTaskPhotoRequirement,
  StaffTaskPriority,
  StaffTaskReferenceType,
} from '@/types'
import { PROTOTYPE_TODAY, uid } from '@/utils/format'

export const TASK_PERMISSION_KEYS = [
  'task.view',
  'task.create',
  'task.edit',
  'task.assign',
  'task.complete',
  'task.category.manage',
] as const

export const TASK_PHOTO_MAX_BYTES = 5 * 1024 * 1024
const TASK_PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export const TASK_FREQUENCIES: StaffTaskFrequency[] = ['daily', 'weekly', 'monthly', 'annually', 'specific_date']
export const TASK_PRIORITIES: StaffTaskPriority[] = ['low', 'normal', 'high']
export const TASK_PHOTO_REQUIREMENTS: StaffTaskPhotoRequirement[] = ['none', 'optional', 'required']
export const WEEKDAY_OPTIONS = [
  { id: 1, label: 'Monday' },
  { id: 2, label: 'Tuesday' },
  { id: 3, label: 'Wednesday' },
  { id: 4, label: 'Thursday' },
  { id: 5, label: 'Friday' },
  { id: 6, label: 'Saturday' },
  { id: 0, label: 'Sunday' },
] as const

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export function defaultStaffTaskCategories(createdAt: string): StaffTaskCategory[] {
  return [
    { id: 'tcat-cleaning', name: 'Cleaning', status: 'active', createdAt, updatedAt: createdAt },
    { id: 'tcat-maintenance', name: 'Maintenance', status: 'active', createdAt, updatedAt: createdAt },
    { id: 'tcat-parcel', name: 'Parcel', status: 'active', createdAt, updatedAt: createdAt },
    { id: 'tcat-warehouse', name: 'Warehouse', status: 'active', createdAt, updatedAt: createdAt },
    { id: 'tcat-general', name: 'General', status: 'active', createdAt, updatedAt: createdAt },
  ]
}

export function klParts(at: Date | string = PROTOTYPE_TODAY) {
  const date = typeof at === 'string' ? new Date(at) : at
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(date)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    y: Number(pick('year')),
    m: Number(pick('month')),
    d: Number(pick('day')),
    weekday: weekdayMap[pick('weekday')] ?? 0,
  }
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function ymd(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`
}

export function addCalendarDays(y: number, m: number, d: number, days: number) {
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() }
}

export function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function clampMonthDay(y: number, m: number, day: number) {
  return Math.min(Math.max(1, day), daysInMonth(y, m))
}

export function parseTaskTime(value: string | undefined) {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  return match ? `${match[1]}:${match[2]}` : null
}

function dueIso(y: number, m: number, d: number, time: string) {
  if (time) return `${ymd(y, m, d)}T${time}:00+08:00`
  return `${ymd(y, m, d)}T23:59:59+08:00`
}

function mondayIndex(weekday: number) {
  return (weekday + 6) % 7
}

export type TaskPeriod = {
  periodKey: string
  dueAt: string
  ymd: string
}

export function currentTaskPeriod(task: StaffTask, now: Date | string = PROTOTYPE_TODAY): TaskPeriod | null {
  const today = klParts(now)
  const time = task.time ?? ''
  if (task.frequency === 'daily') {
    const key = ymd(today.y, today.m, today.d)
    return { periodKey: `d:${key}`, dueAt: dueIso(today.y, today.m, today.d, time), ymd: key }
  }
  if (task.frequency === 'weekly') {
    const weekDay = Number.isFinite(task.weekDay) ? task.weekDay : 1
    const weekStart = addCalendarDays(today.y, today.m, today.d, -mondayIndex(today.weekday))
    const offset = weekDay === 0 ? 6 : weekDay - 1
    const due = addCalendarDays(weekStart.y, weekStart.m, weekStart.d, offset)
    const key = ymd(due.y, due.m, due.d)
    return { periodKey: `w:${key}`, dueAt: dueIso(due.y, due.m, due.d, time), ymd: key }
  }
  if (task.frequency === 'monthly') {
    const day = clampMonthDay(today.y, today.m, task.monthDay || 1)
    const key = `${today.y}-${pad(today.m)}`
    return { periodKey: `m:${key}`, dueAt: dueIso(today.y, today.m, day, time), ymd: ymd(today.y, today.m, day) }
  }
  if (task.frequency === 'annually') {
    const month = Math.min(12, Math.max(1, task.annualMonth || 1))
    const day = clampMonthDay(today.y, month, task.annualDay || 1)
    return { periodKey: `y:${today.y}`, dueAt: dueIso(today.y, month, day, time), ymd: ymd(today.y, month, day) }
  }
  const specific = (task.specificDate ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(specific)) return null
  const [ys, ms, ds] = specific.split('-').map(Number)
  return { periodKey: `s:${specific}`, dueAt: dueIso(ys, ms, ds, time), ymd: specific }
}

export function previousTaskPeriod(task: StaffTask, now: Date | string = PROTOTYPE_TODAY): TaskPeriod | null {
  if (task.frequency === 'specific_date') return null
  const today = klParts(now)
  const time = task.time ?? ''
  if (task.frequency === 'daily') {
    const prev = addCalendarDays(today.y, today.m, today.d, -1)
    const key = ymd(prev.y, prev.m, prev.d)
    return { periodKey: `d:${key}`, dueAt: dueIso(prev.y, prev.m, prev.d, time), ymd: key }
  }
  if (task.frequency === 'weekly') {
    const current = currentTaskPeriod(task, now)
    if (!current) return null
    const [y, m, d] = current.ymd.split('-').map(Number)
    const prev = addCalendarDays(y, m, d, -7)
    const key = ymd(prev.y, prev.m, prev.d)
    return { periodKey: `w:${key}`, dueAt: dueIso(prev.y, prev.m, prev.d, time), ymd: key }
  }
  if (task.frequency === 'monthly') {
    const prevMonth = today.m === 1 ? { y: today.y - 1, m: 12 } : { y: today.y, m: today.m - 1 }
    const day = clampMonthDay(prevMonth.y, prevMonth.m, task.monthDay || 1)
    const key = `${prevMonth.y}-${pad(prevMonth.m)}`
    return { periodKey: `m:${key}`, dueAt: dueIso(prevMonth.y, prevMonth.m, day, time), ymd: ymd(prevMonth.y, prevMonth.m, day) }
  }
  const year = today.y - 1
  const month = Math.min(12, Math.max(1, task.annualMonth || 1))
  const day = clampMonthDay(year, month, task.annualDay || 1)
  return { periodKey: `y:${year}`, dueAt: dueIso(year, month, day, time), ymd: ymd(year, month, day) }
}

export function periodsToEnsure(task: StaffTask, now: Date | string = PROTOTYPE_TODAY): TaskPeriod[] {
  const current = currentTaskPeriod(task, now)
  const clock = typeof now === 'string' ? new Date(now) : now
  const periods: TaskPeriod[] = []
  if (current) periods.push(current)
  const previous = previousTaskPeriod(task, now)
  if (previous && new Date(previous.dueAt).getTime() < clock.getTime()) {
    if (!periods.some((row) => row.periodKey === previous.periodKey)) periods.push(previous)
  }
  return periods
}

export function makeTaskOccurrence(task: StaffTask, period: TaskPeriod, createdAt: string): StaffTaskOccurrence {
  return {
    id: uid('tocc'),
    taskId: task.id,
    periodKey: period.periodKey,
    dueAt: period.dueAt,
    status: 'pending',
    startedAt: '',
    completedBy: '',
    completedAt: '',
    completionNote: '',
    completionPhotoUrl: '',
    completionPhotoName: '',
    createdAt,
  }
}

export function missingTaskOccurrences(
  tasks: StaffTask[],
  existing: StaffTaskOccurrence[],
  now: Date | string = PROTOTYPE_TODAY,
) {
  const stamp = typeof now === 'string' ? now : now.toISOString()
  const extra: StaffTaskOccurrence[] = []
  for (const task of tasks) {
    if (!task.active) continue
    for (const period of periodsToEnsure(task, now)) {
      const found = existing.some((row) => row.taskId === task.id && row.periodKey === period.periodKey)
      const queued = extra.some((row) => row.taskId === task.id && row.periodKey === period.periodKey)
      if (!found && !queued) extra.push(makeTaskOccurrence(task, period, stamp))
    }
  }
  return extra.length ? [...existing, ...extra] : existing
}

export function occurrenceIsOverdue(occurrence: StaffTaskOccurrence, now: Date | string = PROTOTYPE_TODAY) {
  if (occurrence.status === 'completed') return false
  const clock = typeof now === 'string' ? new Date(now) : now
  return new Date(occurrence.dueAt).getTime() < clock.getTime()
}

export function occurrenceVisualStatus(occurrence: StaffTaskOccurrence, now: Date | string = PROTOTYPE_TODAY) {
  if (occurrence.status === 'completed') return 'completed' as const
  if (occurrenceIsOverdue(occurrence, now)) return 'overdue' as const
  return occurrence.status
}

export function isAllowedTaskPhotoFile(file: Pick<File, 'type' | 'name' | 'size'>) {
  const name = file.name.toLowerCase()
  const extOk = ['.png', '.jpg', '.jpeg', '.webp'].some((ext) => name.endsWith(ext))
  const type = file.type === 'image/jpg' ? 'image/jpeg' : file.type
  if (file.size > TASK_PHOTO_MAX_BYTES) return false
  if (TASK_PHOTO_TYPES.has(type)) return true
  if (!file.type || file.type === 'application/octet-stream') return extOk
  return false
}

export function parseTaskCompletionPhoto(value: unknown, fileName?: string) {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) return { ok: false as const }
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/)
  if (!match) return { ok: false as const }
  let mime = match[1].toLowerCase()
  if (mime === 'image/jpg') mime = 'image/jpeg'
  if (!TASK_PHOTO_TYPES.has(mime)) return { ok: false as const }
  const b64 = match[2].replace(/\s/g, '')
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  const bytes = Math.floor((b64.length * 3) / 4) - padding
  if (!(bytes > 0) || bytes > TASK_PHOTO_MAX_BYTES) return { ok: false as const }
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  const name = fileName?.trim() || `task-photo.${extension}`
  return { ok: true as const, url: `data:${mime};base64,${b64}`, name }
}

export function frequencyLabel(task: Pick<StaffTask, 'frequency' | 'weekDay' | 'monthDay' | 'annualMonth' | 'annualDay' | 'specificDate' | 'time'>) {
  const time = task.time ? ` · ${task.time}` : ''
  if (task.frequency === 'daily') return `Daily${time}`
  if (task.frequency === 'weekly') return `Weekly · ${WEEKDAY_SHORT[task.weekDay] ?? 'Mon'}${time}`
  if (task.frequency === 'monthly') return `Monthly · day ${task.monthDay || 1}${time}`
  if (task.frequency === 'annually') {
    const month = new Date(Date.UTC(2026, (task.annualMonth || 1) - 1, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })
    return `Annually · ${task.annualDay || 1} ${month}${time}`
  }
  return `Once · ${task.specificDate || '—'}${time}`
}

export function photoRequirementLabel(value: StaffTaskPhotoRequirement) {
  if (value === 'required') return 'Photo required'
  if (value === 'optional') return 'Photo optional'
  return 'No photo'
}

export function priorityLabel(value: StaffTaskPriority) {
  if (value === 'high') return 'High'
  if (value === 'low') return 'Low'
  return 'Normal'
}

export function taskCategoryById(state: Pick<AppState, 'staffTaskCategories'>, categoryId: string) {
  return (state.staffTaskCategories ?? []).find((row) => row.id === categoryId)
}

export function taskById(state: Pick<AppState, 'staffTasks'>, taskId: string) {
  return (state.staffTasks ?? []).find((row) => row.id === taskId)
}

export function activeTaskCategories(state: Pick<AppState, 'staffTaskCategories'>) {
  return (state.staffTaskCategories ?? []).filter((row) => row.status === 'active')
}

export function assignableUsers(state: Pick<AppState, 'users'>) {
  return state.users.filter((user) => user.status === 'active')
}

export function taskReferenceHref(task: Pick<StaffTask, 'referenceType' | 'referenceId'>) {
  if (!task.referenceType || !task.referenceId) return ''
  if (task.referenceType === 'invoice') return `/sales/invoices/${task.referenceId}`
  if (task.referenceType === 'purchase') return '/purchases'
  if (task.referenceType === 'production') return `/manufacturing/history/${task.referenceId}`
  return ''
}

export function resolveTaskReference(
  state: Pick<AppState, 'sales' | 'purchases' | 'productionSessions' | 'productionOrders'>,
  type: StaffTaskReferenceType | '',
  referenceNo: string,
  referenceId?: string,
) {
  const no = referenceNo.trim()
  if (type === 'invoice') {
    const row = state.sales.find((sale) => sale.id === referenceId) ?? state.sales.find((sale) => sale.invoiceNo === no)
    return row ? { id: row.id, no: row.invoiceNo } : { id: referenceId ?? '', no }
  }
  if (type === 'purchase') {
    const row = state.purchases.find((item) => item.id === referenceId) ?? state.purchases.find((item) => item.purchaseNo === no || item.invoiceNumber === no)
    return row ? { id: row.id, no: row.purchaseNo } : { id: referenceId ?? '', no }
  }
  if (type === 'production') {
    const session = state.productionSessions.find((item) => item.id === referenceId) ?? state.productionSessions.find((item) => item.reference === no)
    if (session) return { id: session.id, no: session.reference }
    const order = state.productionOrders.find((item) => item.id === referenceId) ?? state.productionOrders.find((item) => item.orderNo === no)
    return order ? { id: order.id, no: order.orderNo } : { id: referenceId ?? '', no }
  }
  return { id: referenceId ?? '', no }
}

export function dueYmd(iso: string) {
  const parts = klParts(iso)
  return ymd(parts.y, parts.m, parts.d)
}

export function isDueToday(iso: string, now: Date | string = PROTOTYPE_TODAY) {
  return dueYmd(iso) === dueYmd(typeof now === 'string' ? now : now.toISOString())
}

export function emptyStaffTaskDraft(): {
  title: string
  description: string
  categoryId: string
  assignedTo: string
  departmentId: string
  priority: StaffTaskPriority
  frequency: StaffTaskFrequency
  weekDay: number
  monthDay: number
  annualMonth: number
  annualDay: number
  specificDate: string
  time: string
  photoRequirement: StaffTaskPhotoRequirement
  referenceType: StaffTaskReferenceType | ''
  referenceId: string
  referenceNo: string
} {
  return {
    title: '',
    description: '',
    categoryId: '',
    assignedTo: '',
    departmentId: '',
    priority: 'normal',
    frequency: 'daily',
    weekDay: 1,
    monthDay: 1,
    annualMonth: 3,
    annualDay: 15,
    specificDate: '',
    time: '',
    photoRequirement: 'none',
    referenceType: '',
    referenceId: '',
    referenceNo: '',
  }
}
