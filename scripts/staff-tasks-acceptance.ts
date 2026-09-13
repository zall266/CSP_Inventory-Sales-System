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
const {
  currentTaskPeriod,
  occurrenceVisualStatus,
  parseTaskCompletionPhoto,
} = await import('@/features/tasks/taskModel')
const { hasPermission } = await import('@/features/settings/permissions')

const TINY_JPG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAD/2Q=='

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function toastTitles() {
  return db.getSnapshot().ui.toasts.map((row) => row.title)
}

function inventoryFingerprint() {
  return db
    .getSnapshot()
    .inventory.map((row) => `${row.productId}:${row.warehouseId}:${row.qty}`)
    .sort()
    .join('|')
}

function occurrenceFor(taskId: string) {
  return db.getSnapshot().staffTaskOccurrences.filter((row) => row.taskId === taskId)
}

db.resetDemo()
db.switchUser('u-admin')

const toilet = db.createStaffTask({
  title: 'Bersihkan tandas',
  assignedTo: 'u-mei',
  categoryId: 'tcat-cleaning',
  frequency: 'daily',
  photoRequirement: 'none',
})
check('TEST 1 Create daily task Bersihkan tandas', Boolean(toilet?.id), toilet?.id)

db.switchUser('u-mei')
db.syncStaffTaskOccurrences()
const meiTasks = db
  .getSnapshot()
  .staffTaskOccurrences.map((row) => {
    const task = db.getSnapshot().staffTasks.find((item) => item.id === row.taskId)
    return task
  })
  .filter((task) => task?.assignedTo === 'u-mei')
check(
  'TEST 2 Staff A sees Bersihkan tandas in My Tasks',
  meiTasks.some((task) => task?.id === toilet?.id || task?.title === 'Bersihkan tandas'),
)

const toiletOcc = occurrenceFor(toilet!.id).find((row) => row.periodKey.startsWith('d:')) ?? occurrenceFor(toilet!.id)[0]
check('TEST 2 current daily occurrence exists', Boolean(toiletOcc?.id), toiletOcc?.periodKey)

const started = db.startStaffTaskOccurrence(toiletOcc!.id)
const afterStart = db.getSnapshot().staffTaskOccurrences.find((row) => row.id === toiletOcc!.id)
check('TEST 3 Staff starts task → IN_PROGRESS', started && afterStart?.status === 'in_progress', afterStart?.status)

const completedNone = db.completeStaffTaskOccurrence(afterStart!.id)
const afterComplete = db.getSnapshot().staffTaskOccurrences.find((row) => row.id === afterStart!.id)
check(
  'TEST 4 Complete with photo NONE and no photo',
  completedNone && afterComplete?.status === 'completed' && !afterComplete.completionPhotoUrl,
  afterComplete?.status,
)

db.switchUser('u-admin')
const drain = db.createStaffTask({
  title: 'Bersihkan longkang',
  assignedTo: 'u-mei',
  categoryId: 'tcat-cleaning',
  frequency: 'monthly',
  monthDay: 1,
  time: '09:00',
  photoRequirement: 'required',
})
check('TEST 5 Create monthly photo REQUIRED', Boolean(drain?.id))
const drainPeriod = currentTaskPeriod(drain!)
check('TEST 11 Monthly recurrence is 1st of current month', drainPeriod?.ymd === '2026-09-01' && drainPeriod.periodKey === 'm:2026-09', drainPeriod?.periodKey)

db.switchUser('u-mei')
const drainOcc = occurrenceFor(drain!.id).find((row) => row.periodKey === 'm:2026-09') ?? occurrenceFor(drain!.id)[0]
const blocked = db.completeStaffTaskOccurrence(drainOcc!.id)
check('TEST 6 Complete without photo is blocked', blocked === false && db.getSnapshot().staffTaskOccurrences.find((row) => row.id === drainOcc!.id)?.status !== 'completed')
check(
  'TEST 6 shows required photo message',
  toastTitles().includes('Please upload a photo before completing this task.'),
)

const jpgOk = parseTaskCompletionPhoto(TINY_JPG, 'drain.jpg')
check('TEST 7 JPG under 5MB is accepted by parser', jpgOk.ok === true)
const uploaded = db.attachStaffTaskPhoto(drainOcc!.id, TINY_JPG, 'drain.jpg')
check('TEST 7 Staff uploads JPG under 5MB', uploaded === true)
const pdfBlocked = db.attachStaffTaskPhoto(drainOcc!.id, 'data:application/pdf;base64,JVBERi0=', 'drain.pdf')
check('TEST 7 PDF is rejected', pdfBlocked === false)

const completedRequired = db.completeStaffTaskOccurrence(drainOcc!.id)
const drainDone = db.getSnapshot().staffTaskOccurrences.find((row) => row.id === drainOcc!.id)
check('TEST 8 Complete after photo upload', completedRequired === true && drainDone?.status === 'completed' && Boolean(drainDone.completionPhotoUrl))

db.switchUser('u-admin')
const optional = db.createStaffTask({
  title: 'Susun stor optional',
  assignedTo: 'u-mei',
  categoryId: 'tcat-warehouse',
  frequency: 'weekly',
  weekDay: 1,
  photoRequirement: 'optional',
})
check('TEST 9 Create photo OPTIONAL', Boolean(optional?.id))
const weeklyPeriod = currentTaskPeriod(optional!)
check('TEST 10 Weekly recurrence is this Monday', weeklyPeriod?.ymd === '2026-09-07' && weeklyPeriod.periodKey === 'w:2026-09-07', weeklyPeriod?.periodKey)

db.switchUser('u-mei')
const optionalOcc = occurrenceFor(optional!.id).find((row) => row.periodKey === 'w:2026-09-07') ?? occurrenceFor(optional!.id)[0]
const optionalWithout = db.completeStaffTaskOccurrence(optionalOcc!.id)
check('TEST 9 Can complete OPTIONAL without photo', optionalWithout === true)

db.switchUser('u-admin')
const optionalPhoto = db.createStaffTask({
  title: 'Susun stor with photo',
  assignedTo: 'u-mei',
  categoryId: 'tcat-warehouse',
  frequency: 'weekly',
  weekDay: 5,
  photoRequirement: 'optional',
})
db.switchUser('u-mei')
const optionalPhotoOcc = occurrenceFor(optionalPhoto!.id)[0]
const attachedOptional = db.attachStaffTaskPhoto(optionalPhotoOcc.id, TINY_JPG, 'stor.jpg')
const optionalWith = db.completeStaffTaskOccurrence(optionalPhotoOcc.id)
check('TEST 9 Can also attach photo on OPTIONAL', attachedOptional && optionalWith)

db.switchUser('u-admin')
const annual = db.createStaffTask({
  title: 'Servis mesin feeding',
  assignedTo: 'u-hafiz',
  categoryId: 'tcat-maintenance',
  frequency: 'annually',
  annualMonth: 3,
  annualDay: 15,
  time: '10:00',
  photoRequirement: 'required',
})
const annualPeriod = currentTaskPeriod(annual!)
check('TEST 12 Annual recurrence is 15 March this year', annualPeriod?.ymd === '2026-03-15' && annualPeriod.periodKey === 'y:2026', annualPeriod?.periodKey)

const once = db.createStaffTask({
  title: 'Check fire extinguisher',
  assignedTo: 'u-kumar',
  categoryId: 'tcat-general',
  frequency: 'specific_date',
  specificDate: '2026-10-20',
  photoRequirement: 'none',
})
check('TEST 13 Specific date task created', Boolean(once?.id))
db.syncStaffTaskOccurrences()
const onceOccs = occurrenceFor(once!.id)
check('TEST 13 One-time task only has one occurrence', onceOccs.length === 1 && onceOccs[0].periodKey === 's:2026-10-20', String(onceOccs.length))
db.syncStaffTaskOccurrences()
check('TEST 13 Sync does not duplicate specific date', occurrenceFor(once!.id).length === 1)

const overdueOcc = db.getSnapshot().staffTaskOccurrences.find((row) => row.taskId === annual!.id)
check(
  'TEST 14 Overdue is derived and not auto-completed',
  Boolean(overdueOcc) && overdueOcc!.status !== 'completed' && occurrenceVisualStatus(overdueOcc!) === 'overdue',
  overdueOcc?.status,
)

const food = db.createStaffTaskCategory('Food Safety')
check('TEST 15 Custom category Food Safety', food?.name === 'Food Safety')
const foodTask = db.createStaffTask({
  title: 'Check chiller temperature',
  assignedTo: 'u-mei',
  categoryId: food!.id,
  frequency: 'daily',
  photoRequirement: 'none',
})
check('TEST 15 Category appears on new task', foodTask?.categoryId === food!.id)

const deactivatedCategory = db.deactivateStaffTaskCategory(food!.id)
const blockedCategoryTask = db.createStaffTask({
  title: 'Should not use inactive category',
  assignedTo: 'u-mei',
  categoryId: food!.id,
  frequency: 'daily',
  photoRequirement: 'none',
})
check('TEST 16 Deactivated category cannot be assigned to new task', deactivatedCategory && blockedCategoryTask === null)
check('TEST 16 Existing task keeps inactive category', db.getSnapshot().staffTasks.find((row) => row.id === foodTask!.id)?.categoryId === food!.id)

const recurring = db.createStaffTask({
  title: 'Daily deactivate test',
  assignedTo: 'u-mei',
  categoryId: 'tcat-general',
  frequency: 'daily',
  photoRequirement: 'none',
})
db.syncStaffTaskOccurrences()
const beforeDeactivate = occurrenceFor(recurring!.id).length
db.deactivateStaffTask(recurring!.id)
db.syncStaffTaskOccurrences()
const afterDeactivate = occurrenceFor(recurring!.id).length
check('TEST 17 Deactivated recurring task creates no new occurrences', afterDeactivate === beforeDeactivate, `${beforeDeactivate} -> ${afterDeactivate}`)
check('TEST 17 History remains after deactivate', afterDeactivate > 0 && db.getSnapshot().staffTasks.find((row) => row.id === recurring!.id)?.active === false)

const stockBefore = inventoryFingerprint()
const salesBefore = db.getSnapshot().sales.length
const movementsBefore = db.getSnapshot().stockMovements.length
const sessionsBefore = JSON.stringify(db.getSnapshot().productionSessions.map((row) => [row.id, row.posted, row.status]))
const occupancyBefore = db.getSnapshot().slotOccupancies.length
const agentSalesBefore = db.getSnapshot().agentSales.length

const parcel = db.createStaffTask({
  title: 'Keluarkan parcel INV-001251',
  assignedTo: 'u-mei',
  categoryId: 'tcat-parcel',
  frequency: 'daily',
  photoRequirement: 'none',
  referenceType: 'invoice',
  referenceNo: 'INV-001251',
})
check('TEST 18 Task references invoice number', parcel?.referenceNo === 'INV-001251', parcel?.referenceNo)
check('TEST 18 Reference is navigation only (no duplicated invoice rows)', db.getSnapshot().sales.length === salesBefore)

db.switchUser('u-mei')
const parcelOcc = occurrenceFor(parcel!.id).find((row) => row.status !== 'completed') ?? occurrenceFor(parcel!.id)[0]
const parcelDone = db.completeStaffTaskOccurrence(parcelOcc.id)
check('TEST 19 Parcel task completes', parcelDone === true)
check('TEST 19 No inventory deduction from task completion', inventoryFingerprint() === stockBefore)
check('TEST 19 No extra stock movements from task completion', db.getSnapshot().stockMovements.length === movementsBefore)

check('TEST 20 Existing inventory unchanged', inventoryFingerprint() === stockBefore)

db.switchUser('u-admin')
const posSale = db.createSale({
  customerId: 'c-walkin',
  warehouseId: 'wh-main',
  items: [{ productId: 'p-pc', qty: 1, price: 0.4 }],
  paidAmount: 0.4,
  paymentMethod: 'cash',
})
check('TEST 21 Existing POS sale still works', Boolean(posSale?.id))

check('TEST 22 Existing Agent records unchanged by task completion', db.getSnapshot().agentSales.length === agentSalesBefore)
check('TEST 23 Existing manufacturing sessions unchanged by task completion', JSON.stringify(db.getSnapshot().productionSessions.map((row) => [row.id, row.posted, row.status])) === sessionsBefore)
check('TEST 24 Existing warehouse map occupancy unchanged by task completion', db.getSnapshot().slotOccupancies.length === occupancyBefore)

db.switchUser('u-mei')
check('Staff has task.view and task.complete', hasPermission(db.getSnapshot(), 'task.view') && hasPermission(db.getSnapshot(), 'task.complete'))
check('Staff cannot manage categories', hasPermission(db.getSnapshot(), 'task.category.manage') === false)
db.switchUser('u-hafiz')
check('Supervisor can manage tasks without category.manage by default', hasPermission(db.getSnapshot(), 'task.create') && hasPermission(db.getSnapshot(), 'task.category.manage') === false)
db.switchUser('u-admin')
check('Admin can manage categories', hasPermission(db.getSnapshot(), 'task.category.manage'))

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => ` - ${row.name}${row.detail ? `: ${row.detail}` : ''}`).join('\n'))
  process.exit(1)
}
