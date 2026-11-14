import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import type {
  DocumentAuditLog,
  Expense,
  HalalCertificate,
  Manufacturer,
  RawMaterialHalalCompliance,
  StaffTask,
  StaffTaskCategory,
  StaffTaskOccurrence,
} from '@/types'

export type HalalSlice = {
  manufacturers: Manufacturer[]
  halalCertificates: HalalCertificate[]
  halalCompliances: RawMaterialHalalCompliance[]
  documentAuditLogs?: DocumentAuditLog[]
}

export type TaskSlice = {
  staffTaskCategories: StaffTaskCategory[]
  staffTasks: StaffTask[]
  staffTaskOccurrences: StaffTaskOccurrence[]
  documentAuditLogs?: DocumentAuditLog[]
}

export type ExpenseSlice = {
  expenses: Expense[]
}

type SyncOptions<T> = {
  apply: (slice: T) => void
  actorId: () => string
  onError: (message: string) => void
  onSaved: (action: string, payload: Record<string, unknown>, data: Record<string, unknown>) => void
  onSettled: () => void
}

type PendingWrite = {
  action: string
  payload: Record<string, unknown>
  idempotencyKey?: string
}

function createSync<T>(config: {
  listAction: string
  sliceFrom: (data: Partial<T> | null) => T | null
  postingActions?: Set<string>
  loadError: string
  saveError: string
}) {
  let options: SyncOptions<T> | null = null
  let epoch = 0
  let ready = false
  const pending: PendingWrite[] = []

  function needsIdempotency(action: string) {
    return Boolean(config.postingActions?.has(action))
  }

  function startHydration(next: SyncOptions<T>) {
    if (!identityApiUrl()) return
    options = next
    const seen = epoch
    void (async () => {
      try {
        const loaded = await postIdentityAction(config.listAction, { actorUserId: options?.actorId() })
        if (epoch !== seen) return
        if (!loaded.ok) {
          if (loaded.error?.code === 'FORBIDDEN') return
          next.onError(loaded.error?.message || config.loadError)
          return
        }
        const slice = config.sliceFrom(loaded.data as Partial<T> | null)
        if (slice) options?.apply(slice)
      } catch (error) {
        next.onError(error instanceof Error ? error.message : config.loadError)
      } finally {
        if (epoch === seen) {
          ready = true
          const queued = pending.splice(0, pending.length)
          queued.forEach((item) => queueWrite(item.action, item.payload, item.idempotencyKey))
        }
      }
    })()
  }

  function queueWrite(action: string, payload: Record<string, unknown>, idempotencyKey?: string) {
    if (!identityApiUrl() || !options) return
    if (!ready) {
      pending.push({ action, payload, idempotencyKey })
      return
    }
    epoch += 1
    const seen = epoch
    const actorUserId = options.actorId()
    const key = idempotencyKey || (needsIdempotency(action) ? crypto.randomUUID() : undefined)
    const body: Record<string, unknown> = { ...payload, actorUserId }
    void (async () => {
      try {
        const result = await postIdentityAction(action, body, key)
        if (epoch !== seen) return
        if (!result.ok || !result.data) {
          options?.onError(result.error?.message || config.saveError)
          return
        }
        const data = result.data as Record<string, unknown>
        const slice = config.sliceFrom(data as Partial<T>)
        if (slice) options?.apply(slice)
        options?.onSaved(action, payload, data)
      } catch {
        if (epoch === seen) options?.onError(config.saveError)
      } finally {
        if (epoch === seen) options?.onSettled()
      }
    })()
  }

  return { startHydration, queueWrite }
}

const halal = createSync<HalalSlice>({
  listAction: 'halal.list',
  loadError: 'Could not load Halal Compliance from the server.',
  saveError: 'Could not save Halal Compliance to the server.',
  sliceFrom(data) {
    if (!data || !Array.isArray(data.manufacturers) || !Array.isArray(data.halalCertificates) || !Array.isArray(data.halalCompliances)) {
      return null
    }
    return {
      manufacturers: data.manufacturers,
      halalCertificates: data.halalCertificates,
      halalCompliances: data.halalCompliances,
      documentAuditLogs: data.documentAuditLogs,
    }
  },
})

const tasks = createSync<TaskSlice>({
  listAction: 'tasks.list',
  loadError: 'Could not load tasks from the server.',
  saveError: 'Could not save the task to the server.',
  postingActions: new Set(['tasks.complete']),
  sliceFrom(data) {
    if (
      !data
      || !Array.isArray(data.staffTaskCategories)
      || !Array.isArray(data.staffTasks)
      || !Array.isArray(data.staffTaskOccurrences)
    ) {
      return null
    }
    return {
      staffTaskCategories: data.staffTaskCategories,
      staffTasks: data.staffTasks,
      staffTaskOccurrences: data.staffTaskOccurrences,
      documentAuditLogs: data.documentAuditLogs,
    }
  },
})

const expenses = createSync<ExpenseSlice>({
  listAction: 'expenses.list',
  loadError: 'Could not load expenses from the server.',
  saveError: 'Could not save the expense to the server.',
  sliceFrom(data) {
    if (!data || !Array.isArray(data.expenses)) return null
    return { expenses: data.expenses }
  },
})

export const startHalalHydration = halal.startHydration
export const queueHalalWrite = halal.queueWrite
export const startTaskHydration = tasks.startHydration
export const queueTaskWrite = tasks.queueWrite
export const startExpenseHydration = expenses.startHydration
export const queueExpenseWrite = expenses.queueWrite
