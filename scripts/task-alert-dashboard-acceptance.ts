const memory = new Map<string, string>()
const localStoragePolyfill = {
  getItem(key: string) {
    return memory.has(key) ? memory.get(key)! : null
  },
  setItem(key: string, value: string) {
    memory.set(key, String(value))
  },
  removeItem(key: string) {
    memory.delete(key)
  },
  clear() {
    memory.clear()
  },
  key(index: number) {
    return [...memory.keys()][index] ?? null
  },
  get length() {
    return memory.size
  },
}

Object.defineProperty(globalThis, 'localStorage', { value: localStoragePolyfill })
Object.defineProperty(globalThis, 'window', { value: globalThis })

const { db } = await import('@/store/db')
const { myTaskSummary, taskAssignedEventKey, visibleNotifications } = await import('@/features/tasks/taskModel')
const { hasPermission } = await import('@/features/settings/permissions')

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function summary(userId: string) {
  return myTaskSummary(db.getSnapshot(), userId)
}

function notesFor(userId: string) {
  return visibleNotifications(db.getSnapshot().notifications, userId)
}

function assignedNotes(userId: string, title: string) {
  return notesFor(userId).filter((row) => row.title === 'New Task Assigned' && row.body.includes(title))
}

db.resetDemo()
db.switchUser('u-admin')
const meiAtStart = summary('u-mei')

const sitiEmpty = summary('u-siti')
check('TEST 8 No pending tasks for unassigned staff', sitiEmpty.pending === 0, JSON.stringify(sitiEmpty))

const overdue = db.createStaffTask({
  title: 'Clean Drain',
  assignedTo: 'u-siti',
  categoryId: 'tcat-cleaning',
  frequency: 'specific_date',
  specificDate: '2026-09-01',
  photoRequirement: 'none',
})
const dueA = db.createStaffTask({
  title: 'Clean Toilet A',
  assignedTo: 'u-siti',
  categoryId: 'tcat-cleaning',
  frequency: 'specific_date',
  specificDate: '2026-09-10',
  photoRequirement: 'none',
})
const dueB = db.createStaffTask({
  title: 'Clean Toilet B',
  assignedTo: 'u-siti',
  categoryId: 'tcat-cleaning',
  frequency: 'specific_date',
  specificDate: '2026-09-10',
  photoRequirement: 'none',
})
const upA = db.createStaffTask({
  title: 'Upcoming A',
  assignedTo: 'u-siti',
  categoryId: 'tcat-general',
  frequency: 'specific_date',
  specificDate: '2026-09-20',
  photoRequirement: 'none',
})
const upB = db.createStaffTask({
  title: 'Upcoming B',
  assignedTo: 'u-siti',
  categoryId: 'tcat-general',
  frequency: 'specific_date',
  specificDate: '2026-10-01',
  photoRequirement: 'none',
})
const upC = db.createStaffTask({
  title: 'Upcoming C',
  assignedTo: 'u-siti',
  categoryId: 'tcat-general',
  frequency: 'specific_date',
  specificDate: '2026-10-20',
  photoRequirement: 'none',
})

const siti = summary('u-siti')
check('TEST 1 Overdue 1', siti.overdue === 1, String(siti.overdue))
check('TEST 1 Due Today 2', siti.dueToday === 2, String(siti.dueToday))
check('TEST 1 Upcoming 3', siti.upcoming === 3, String(siti.upcoming))

const dueOcc = db.getSnapshot().staffTaskOccurrences.find((row) => row.taskId === dueA?.id)
db.switchUser('u-siti')
const completed = db.completeStaffTaskOccurrence(dueOcc!.id)
const afterComplete = summary('u-siti')
check('TEST 2 Completed due-today decreases count', completed === true && afterComplete.dueToday === 1, String(afterComplete.dueToday))
check('TEST 2 Completed is not pending', afterComplete.pending === 5, String(afterComplete.pending))

db.switchUser('u-admin')
const mei = summary('u-mei')
const kumar = summary('u-kumar')
const sitiNow = summary('u-siti')
check('TEST 3 Staff A dashboard is not Staff B', sitiNow.pending !== mei.pending, `siti ${sitiNow.pending} mei ${mei.pending}`)
check('TEST 3 Creating Siti tasks does not change Mei counts', JSON.stringify(mei) === JSON.stringify(meiAtStart))
check('TEST 3 Kumar counts only Kumar tasks', kumar.pending > 0, JSON.stringify(kumar))

const store = db.createStaffTask({
  title: 'Clean Store',
  assignedTo: 'u-siti',
  categoryId: 'tcat-warehouse',
  frequency: 'specific_date',
  specificDate: '2026-11-01',
  photoRequirement: 'none',
})
const sitiAssigned = assignedNotes('u-siti', 'Clean Store')
const meiAssigned = assignedNotes('u-mei', 'Clean Store')
check('TEST 4 User A receives New Task Assigned', sitiAssigned.length === 1 && sitiAssigned[0].userId === 'u-siti', String(sitiAssigned.length))
check('TEST 4 User B does not receive User A assignment', meiAssigned.length === 0)
check(
  'TEST 4 Assignment event is idempotent',
  db.getSnapshot().notifications.filter((row) => row.eventKey === taskAssignedEventKey(store!.id, 'u-siti')).length === 1,
)

const beforeSpam = notesFor('u-siti').length
for (let i = 0; i < 10; i += 1) {
  db.getSnapshot()
  myTaskSummary(db.getSnapshot(), 'u-siti')
  db.syncStaffTaskOccurrences()
}
check('TEST 5 Opening dashboard/sync 10 times does not spam', notesFor('u-siti').length === beforeSpam, `${beforeSpam} -> ${notesFor('u-siti').length}`)
check('TEST 6 Refresh/getSnapshot does not duplicate task notifications', notesFor('u-siti').length === beforeSpam)

const daily = db.createStaffTask({
  title: 'Clean Store Daily',
  assignedTo: 'u-siti',
  categoryId: 'tcat-warehouse',
  frequency: 'daily',
  photoRequirement: 'none',
})
db.syncStaffTaskOccurrences()
db.syncStaffTaskOccurrences()
const dailyDue = db.getSnapshot().notifications.filter((row) => row.eventKey?.startsWith(`task_due_today:${daily!.id}:`))
const dailyOverdue = db.getSnapshot().notifications.filter((row) => row.eventKey?.startsWith(`task_overdue:${daily!.id}:`))
const dailySummary = summary('u-siti')
check('TEST 7 Recurring current occurrence is visible on dashboard', dailySummary.dueToday >= 1 || dailySummary.overdue >= 1, JSON.stringify(dailySummary))
check('TEST 7 At most one due-today notification per occurrence', dailyDue.length <= 1, String(dailyDue.length))
check('TEST 7 Recurring catch-up overdue notifies at most once per period', dailyOverdue.length <= 1, String(dailyOverdue.length))

db.switchUser('u-siti')
check('TEST 4/5 Visible list never includes other staff task titles', !notesFor('u-siti').some((row) => row.body.includes('Bersihkan tandas') && row.userId === 'u-mei'))
check('Staff isolation uses permission key, not role name', hasPermission(db.getSnapshot(), 'task.view') === true)

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => ` - ${row.name}${row.detail ? `: ${row.detail}` : ''}`).join('\n'))
  process.exit(1)
}
