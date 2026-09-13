import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { actorUser, departmentName, hasPermission } from '@/features/settings/permissions'
import {
  WEEKDAY_OPTIONS,
  activeTaskCategories,
  assignableUsers,
  emptyStaffTaskDraft,
  frequencyLabel,
  isAllowedTaskPhotoFile,
  isDueToday,
  occurrenceVisualStatus,
  photoRequirementLabel,
  priorityLabel,
  taskCategoryById,
  taskReferenceHref,
} from '@/features/tasks/taskModel'
import { useApi, useStore } from '@/store/hooks'
import { formatDate, formatDateTime, PROTOTYPE_TODAY } from '@/utils/format'
import type { StaffTask, StaffTaskFrequency, StaffTaskInput, StaffTaskOccurrence, StaffTaskPhotoRequirement, StaffTaskPriority, StaffTaskReferenceType } from '@/types'

function userName(state: ReturnType<typeof useStore>, userId: string) {
  return state.users.find((user) => user.id === userId)?.name ?? '—'
}

function readPhotoFile(file: File): Promise<{ url: string; name: string } | { error: string }> {
  if (!isAllowedTaskPhotoFile(file)) return Promise.resolve({ error: 'Use a JPG, PNG, or WebP image up to 5 MB.' })
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      if (!result.startsWith('data:image/')) {
        resolve({ error: 'That file could not be read as an image.' })
        return
      }
      resolve({ url: result, name: file.name })
    }
    reader.onerror = () => resolve({ error: 'That file could not be read as an image.' })
    reader.readAsDataURL(file)
  })
}

function TaskCard({
  task,
  occurrence,
  assignee,
  category,
  onOpen,
}: {
  task: StaffTask
  occurrence: StaffTaskOccurrence
  assignee: string
  category?: string
  onOpen: () => void
}) {
  const visual = occurrenceVisualStatus(occurrence, PROTOTYPE_TODAY)
  return (
    <button type="button" onClick={onOpen} className="w-full text-left">
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-900">{task.title}</div>
            <div className="mt-1 text-xs text-slate-500">
              {formatDate(occurrence.dueAt)} · {frequencyLabel(task)}
            </div>
            <div className="mt-1 text-xs text-slate-500">Assigned to: {assignee}</div>
            {category ? <div className="mt-1 text-xs text-slate-400">{category}</div> : null}
          </div>
          <StatusBadge status={visual} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {task.priority === 'high' ? <Badge tone="rose">High</Badge> : null}
          {task.photoRequirement === 'required' ? <Badge tone="amber">Photo required</Badge> : null}
          {visual === 'overdue' ? <Badge tone="rose">Overdue</Badge> : null}
        </div>
      </Card>
    </button>
  )
}

export function MyTasksPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const user = actorUser(state)

  useEffect(() => {
    api.syncStaffTaskOccurrences()
  }, [api])

  if (!hasPermission(state, 'task.view')) {
    return <PermissionDenied subtitle="You do not have access to tasks." />
  }

  const mine = (state.staffTaskOccurrences ?? [])
    .map((occurrence) => {
      const task = (state.staffTasks ?? []).find((row) => row.id === occurrence.taskId)
      return task ? { occurrence, task } : null
    })
    .filter((row): row is { occurrence: StaffTaskOccurrence; task: StaffTask } => Boolean(row))
    .filter((row) => row.task.assignedTo === user.id)

  const overdue = mine.filter((row) => occurrenceVisualStatus(row.occurrence) === 'overdue')
  const today = mine.filter((row) => {
    const visual = occurrenceVisualStatus(row.occurrence)
    return visual !== 'completed' && visual !== 'overdue' && isDueToday(row.occurrence.dueAt)
  })
  const upcoming = mine.filter((row) => {
    const visual = occurrenceVisualStatus(row.occurrence)
    return visual !== 'completed' && visual !== 'overdue' && !isDueToday(row.occurrence.dueAt)
  })
  const completed = mine.filter((row) => row.occurrence.status === 'completed')

  const section = (title: string, rows: typeof mine) =>
    rows.length ? (
      <section className="mb-6" data-task-section={title.toLowerCase()}>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{title}</h2>
        <div className="space-y-3">
          {rows.map(({ task, occurrence }) => (
            <TaskCard
              key={occurrence.id}
              task={task}
              occurrence={occurrence}
              assignee={userName(state, task.assignedTo)}
              category={taskCategoryById(state, task.categoryId)?.name}
              onOpen={() => navigate(`/tasks/${occurrence.id}`)}
            />
          ))}
        </div>
      </section>
    ) : null

  return (
    <div>
      <PageHeader title="My Tasks" subtitle="Work assigned to you. Complete each item when it is done." />
      {mine.length === 0 ? (
        <Card>
          <EmptyState title="No tasks assigned" hint="When a task is assigned to you, it will appear here." />
        </Card>
      ) : (
        <>
          {section('Overdue', overdue)}
          {section('Today', today)}
          {section('Upcoming', upcoming)}
          {section('Completed', completed)}
        </>
      )}
    </div>
  )
}

export function TaskDetailPage() {
  const { occurrenceId = '' } = useParams()
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const [note, setNote] = useState('')
  const [photoError, setPhotoError] = useState('')

  useEffect(() => {
    api.syncStaffTaskOccurrences()
  }, [api])

  const occurrence = (state.staffTaskOccurrences ?? []).find((row) => row.id === occurrenceId)
  const task = (state.staffTasks ?? []).find((row) => row.id === occurrence?.taskId)
  const user = actorUser(state)

  if (!hasPermission(state, 'task.view')) {
    return <PermissionDenied subtitle="You do not have access to tasks." />
  }
  if (!occurrence || !task) {
    return (
      <div>
        <PageHeader title="Task" subtitle="This task could not be found." />
        <Button variant="secondary" onClick={() => navigate('/tasks')}>
          Back to My Tasks
        </Button>
      </div>
    )
  }

  const assignedToMe = task.assignedTo === user.id
  if (!assignedToMe && !hasPermission(state, 'task.edit')) {
    return <PermissionDenied subtitle="You can only open tasks assigned to you." />
  }

  const visual = occurrenceVisualStatus(occurrence)
  const canWork = hasPermission(state, 'task.edit') || (assignedToMe && hasPermission(state, 'task.complete'))
  const completed = occurrence.status === 'completed'
  const showUpload = task.photoRequirement !== 'none' && !completed
  const href = taskReferenceHref(task)
  const completedBy = occurrence.completedBy ? userName(state, occurrence.completedBy) : ''

  const onUpload = async (file: File | undefined) => {
    setPhotoError('')
    if (!file) return
    const result = await readPhotoFile(file)
    if ('error' in result) {
      setPhotoError(result.error)
      return
    }
    const ok = api.attachStaffTaskPhoto(occurrence.id, result.url, result.name)
    if (!ok) setPhotoError('Photo could not be saved.')
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title={task.title}
        subtitle={taskCategoryById(state, task.categoryId)?.name ?? 'Task'}
        actions={
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Back
          </Button>
        }
      />
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={occurrence.status} />
          {visual === 'overdue' ? <StatusBadge status="overdue" /> : null}
          <Badge>{priorityLabel(task.priority)}</Badge>
          <Badge tone={task.photoRequirement === 'required' ? 'amber' : 'slate'}>{photoRequirementLabel(task.photoRequirement)}</Badge>
        </div>
        {task.description ? <p className="text-sm text-slate-600">{task.description}</p> : null}
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-400">Due</dt>
            <dd>{formatDateTime(occurrence.dueAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Frequency</dt>
            <dd>{frequencyLabel(task)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Assigned staff</dt>
            <dd>{userName(state, task.assignedTo)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Department</dt>
            <dd>{departmentName(state, task.departmentId)}</dd>
          </div>
        </dl>
        {task.referenceNo ? (
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs text-slate-400">Reference</div>
            {href ? (
              <Link className="font-medium text-indigo-700" to={href}>
                {task.referenceNo}
              </Link>
            ) : (
              <div className="font-medium">{task.referenceNo}</div>
            )}
          </div>
        ) : null}

        {completed ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">
            <div className="font-semibold">Completed</div>
            <div>By: {completedBy}</div>
            <div>Date/Time: {formatDateTime(occurrence.completedAt)}</div>
            {occurrence.completionNote ? <div className="mt-1">{occurrence.completionNote}</div> : null}
            {occurrence.completionPhotoUrl ? (
              <img src={occurrence.completionPhotoUrl} alt="Completion" className="mt-2 max-h-56 w-full rounded-lg object-cover" />
            ) : null}
          </div>
        ) : (
          <>
            {task.photoRequirement === 'required' ? (
              <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">
                Photo required before completing this task.
              </div>
            ) : null}
            {occurrence.completionPhotoUrl ? (
              <img src={occurrence.completionPhotoUrl} alt="Uploaded" className="max-h-56 w-full rounded-lg object-cover" />
            ) : null}
            {showUpload ? (
              <Field label={task.photoRequirement === 'required' ? 'Upload photo' : 'Upload photo (optional)'} hint={photoError}>
                <Input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  onChange={(event) => void onUpload(event.target.files?.[0])}
                />
              </Field>
            ) : null}
            <Field label="Completion note (optional)">
              <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a short note" />
            </Field>
            {canWork ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                {occurrence.status === 'pending' ? (
                  <Button className="w-full sm:w-auto" onClick={() => api.startStaffTaskOccurrence(occurrence.id)}>
                    Start Task
                  </Button>
                ) : null}
                <Button
                  className="w-full sm:w-auto"
                  variant="success"
                  onClick={() => api.completeStaffTaskOccurrence(occurrence.id, { note })}
                >
                  Complete
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </div>
  )
}

export function TaskManagePage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const canManage = hasPermission(state, 'task.create') || hasPermission(state, 'task.edit') || hasPermission(state, 'task.assign')

  useEffect(() => {
    api.syncStaffTaskOccurrences()
  }, [api])

  if (!canManage) {
    return <PermissionDenied subtitle="You do not have access to task management." />
  }

  const rows = (state.staffTasks ?? []).filter((task) => {
    if (query && !task.title.toLowerCase().includes(query.toLowerCase())) return false
    if (categoryId !== 'all' && task.categoryId !== categoryId) return false
    return true
  })

  return (
    <div>
      <PageHeader
        title="Manage Tasks"
        subtitle="Create, assign, and schedule staff work. Completing a task does not change stock."
        actions={
          hasPermission(state, 'task.create') ? (
            <Button onClick={() => navigate('/tasks/manage/new')}>Create Task</Button>
          ) : undefined
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks" />
        <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="all">All categories</option>
          {(state.staffTaskCategories ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
              {category.status === 'inactive' ? ' (inactive)' : ''}
            </option>
          ))}
        </Select>
      </div>
      {rows.length === 0 ? (
        <Card>
          <EmptyState title="No tasks yet" hint="Create a simple recurring or one-time task." />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((task) => {
            const occurrences = (state.staffTaskOccurrences ?? []).filter((row) => row.taskId === task.id)
            const current = [...occurrences].sort((a, b) => b.dueAt.localeCompare(a.dueAt))[0]
            return (
              <Card key={task.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-base font-semibold">{task.title}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {taskCategoryById(state, task.categoryId)?.name ?? '—'} · {frequencyLabel(task)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">Assigned to: {userName(state, task.assignedTo)}</div>
                    {current ? (
                      <div className="mt-2">
                        <StatusBadge status={occurrenceVisualStatus(current)} />
                      </div>
                    ) : null}
                    {!task.active ? <div className="mt-2"><Badge>Inactive</Badge></div> : null}
                  </div>
                  <div className="flex flex-col gap-2 sm:items-end">
                    {hasPermission(state, 'task.edit') ? (
                      <Button variant="secondary" onClick={() => navigate(`/tasks/manage/${task.id}`)}>
                        Edit
                      </Button>
                    ) : null}
                    {hasPermission(state, 'task.edit') && task.active ? (
                      <Button variant="ghost" onClick={() => api.deactivateStaffTask(task.id)}>
                        Deactivate
                      </Button>
                    ) : null}
                    {current ? (
                      <Button variant="soft" onClick={() => navigate(`/tasks/${current.id}`)}>
                        Open current
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function TaskEditorPage() {
  const { id } = useParams()
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const existing = id ? (state.staffTasks ?? []).find((row) => row.id === id) : undefined
  const creating = !existing
  const [form, setForm] = useState(() => {
    const draft = emptyStaffTaskDraft()
    if (!existing) return draft
    return {
      title: existing.title,
      description: existing.description,
      categoryId: existing.categoryId,
      assignedTo: existing.assignedTo,
      departmentId: existing.departmentId,
      priority: existing.priority,
      frequency: existing.frequency,
      weekDay: existing.weekDay,
      monthDay: existing.monthDay,
      annualMonth: existing.annualMonth,
      annualDay: existing.annualDay,
      specificDate: existing.specificDate,
      time: existing.time,
      photoRequirement: existing.photoRequirement,
      referenceType: existing.referenceType,
      referenceId: existing.referenceId,
      referenceNo: existing.referenceNo,
    }
  })

  if (creating && !hasPermission(state, 'task.create')) {
    return <PermissionDenied subtitle="You cannot create tasks." />
  }
  if (!creating && !hasPermission(state, 'task.edit')) {
    return <PermissionDenied subtitle="You cannot edit tasks." />
  }
  if (id && !existing) {
    return <PermissionDenied title="Task not found" subtitle="This task is no longer available." />
  }

  const categories = creating
    ? activeTaskCategories(state)
    : (state.staffTaskCategories ?? []).filter((row) => row.status === 'active' || row.id === existing?.categoryId)
  const history = existing
    ? [...(state.staffTaskOccurrences ?? []).filter((row) => row.taskId === existing.id)].sort((a, b) => b.dueAt.localeCompare(a.dueAt))
    : []
  const audits = existing
    ? (state.documentAuditLogs ?? []).filter((row) => row.documentId === existing.id)
    : []

  const patch = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }))

  const save = () => {
    const input: StaffTaskInput = {
      title: form.title,
      description: form.description,
      categoryId: form.categoryId,
      assignedTo: form.assignedTo,
      departmentId: form.departmentId,
      priority: form.priority,
      frequency: form.frequency,
      weekDay: form.weekDay,
      monthDay: form.monthDay,
      annualMonth: form.annualMonth,
      annualDay: form.annualDay,
      specificDate: form.specificDate,
      time: form.time,
      photoRequirement: form.photoRequirement,
      referenceType: form.referenceType,
      referenceId: form.referenceId,
      referenceNo: form.referenceNo,
    }
    if (creating) {
      const created = api.createStaffTask(input)
      if (created) navigate('/tasks/manage')
      return
    }
    if (api.updateStaffTask(existing!.id, input)) navigate('/tasks/manage')
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={creating ? 'Create Task' : 'Edit Task'} subtitle="Keep this simple: what, who, when, and whether a photo is needed." />
      <Card className="space-y-4 p-4">
        <Field label="Task">
          <Input value={form.title} onChange={(event) => patch('title', event.target.value)} placeholder="Bersihkan tandas" />
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={form.description} onChange={(event) => patch('description', event.target.value)} />
        </Field>
        <Field label="Category">
          <Select value={form.categoryId} onChange={(event) => patch('categoryId', event.target.value)}>
            <option value="">Select category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Assigned to">
          <Select
            value={form.assignedTo}
            onChange={(event) => {
              const user = state.users.find((row) => row.id === event.target.value)
              patch('assignedTo', event.target.value)
              if (user) patch('departmentId', user.departmentId)
            }}
            disabled={!creating && !hasPermission(state, 'task.assign')}
          >
            <option value="">Select staff</option>
            {assignableUsers(state).map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Priority">
            <Select value={form.priority} onChange={(event) => patch('priority', event.target.value as StaffTaskPriority)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </Select>
          </Field>
          <Field label="Photo">
            <Select value={form.photoRequirement} onChange={(event) => patch('photoRequirement', event.target.value as StaffTaskPhotoRequirement)}>
              <option value="none">No photo</option>
              <option value="optional">Optional</option>
              <option value="required">Required</option>
            </Select>
          </Field>
        </div>
        <Field label="Frequency">
          <Select value={form.frequency} onChange={(event) => patch('frequency', event.target.value as StaffTaskFrequency)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="annually">Annually</option>
            <option value="specific_date">Specific date</option>
          </Select>
        </Field>
        {form.frequency === 'weekly' ? (
          <Field label="Weekday">
            <Select value={String(form.weekDay)} onChange={(event) => patch('weekDay', Number(event.target.value))}>
              {WEEKDAY_OPTIONS.map((day) => (
                <option key={day.id} value={day.id}>
                  {day.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {form.frequency === 'monthly' ? (
          <Field label="Day of month">
            <Input type="number" min={1} max={31} value={form.monthDay} onChange={(event) => patch('monthDay', Number(event.target.value))} />
          </Field>
        ) : null}
        {form.frequency === 'annually' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Month">
              <Input type="number" min={1} max={12} value={form.annualMonth} onChange={(event) => patch('annualMonth', Number(event.target.value))} />
            </Field>
            <Field label="Day">
              <Input type="number" min={1} max={31} value={form.annualDay} onChange={(event) => patch('annualDay', Number(event.target.value))} />
            </Field>
          </div>
        ) : null}
        {form.frequency === 'specific_date' ? (
          <Field label="Date">
            <Input type="date" value={form.specificDate} onChange={(event) => patch('specificDate', event.target.value)} />
          </Field>
        ) : null}
        <Field label="Time (optional)">
          <Input type="time" value={form.time} onChange={(event) => patch('time', event.target.value)} />
        </Field>
        <Field label="Reference type (optional)">
          <Select
            value={form.referenceType}
            onChange={(event) => patch('referenceType', event.target.value as StaffTaskReferenceType | '')}
          >
            <option value="">None</option>
            <option value="invoice">Invoice</option>
            <option value="purchase">Purchase / GRN</option>
            <option value="production">Production session</option>
          </Select>
        </Field>
        {form.referenceType ? (
          <Field label="Reference no." hint="For navigation only. Completing this task does not post stock or sales.">
            <Input value={form.referenceNo} onChange={(event) => patch('referenceNo', event.target.value)} placeholder="INV-001251" />
          </Field>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="w-full sm:w-auto" onClick={save}>
            {creating ? 'Create Task' : 'Save Task'}
          </Button>
          <Button className="w-full sm:w-auto" variant="secondary" onClick={() => navigate('/tasks/manage')}>
            Cancel
          </Button>
        </div>
      </Card>

      {existing ? (
        <div className="mt-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-800">History</h2>
          {history.length === 0 ? (
            <Card className="p-4 text-sm text-slate-500">No occurrences yet.</Card>
          ) : (
            history.map((row) => (
              <Card key={row.id} className="p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div>{formatDate(row.dueAt)}</div>
                  <StatusBadge status={occurrenceVisualStatus(row)} />
                </div>
                {row.status === 'completed' ? (
                  <div className="mt-1 text-xs text-slate-500">
                    Completed by {userName(state, row.completedBy)} · {formatDateTime(row.completedAt)}
                  </div>
                ) : occurrenceVisualStatus(row) === 'overdue' ? (
                  <div className="mt-1 text-xs text-rose-600">Missed / Overdue</div>
                ) : null}
              </Card>
            ))
          )}
          {audits.length ? (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-800">Audit</h2>
              <Card className="divide-y divide-slate-100">
                {audits.map((row) => (
                  <div key={row.id} className="px-4 py-3 text-sm">
                    <div className="font-medium capitalize">{row.action.replaceAll('_', ' ')}</div>
                    <div className="text-xs text-slate-500">
                      {row.changedBy} · {formatDateTime(row.changedAt)}
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function TaskCategoriesPage() {
  const state = useStore()
  const api = useApi()
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editingName, setEditingName] = useState('')

  if (!hasPermission(state, 'task.category.manage')) {
    return <PermissionDenied subtitle="You cannot manage task categories." />
  }

  const usedIds = new Set((state.staffTasks ?? []).map((task) => task.categoryId))

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Task Categories" subtitle="Labels only. Categories are not inventory items and do not deduct stock." />
      <Card className="mb-4 flex flex-col gap-2 p-4 sm:flex-row">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Food Safety" />
        <Button
          onClick={() => {
            if (api.createStaffTaskCategory(name)) setName('')
          }}
        >
          Add Category
        </Button>
      </Card>
      <div className="space-y-3">
        {(state.staffTaskCategories ?? []).map((category) => (
          <Card key={category.id} className="p-4">
            {editingId === category.id ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input value={editingName} onChange={(event) => setEditingName(event.target.value)} />
                <Button
                  onClick={() => {
                    if (api.updateStaffTaskCategory(category.id, editingName)) setEditingId('')
                  }}
                >
                  Save
                </Button>
                <Button variant="secondary" onClick={() => setEditingId('')}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium">{category.name}</div>
                  <div className="mt-1">
                    <StatusBadge status={category.status} />
                    {usedIds.has(category.id) ? <span className="ml-2 text-xs text-slate-400">In use</span> : null}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditingId(category.id)
                      setEditingName(category.name)
                    }}
                  >
                    Edit
                  </Button>
                  {category.status === 'active' ? (
                    <Button variant="ghost" onClick={() => api.deactivateStaffTaskCategory(category.id)}>
                      Deactivate
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
