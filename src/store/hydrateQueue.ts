export type ActionEnvelope = {
  ok: boolean
  data?: unknown
  error?: { code?: string; message?: string } | null
}

type LoadErrorHandlers = {
  onError: (message: string) => void
  onLoadError?: (message: string) => void
}

let tail: Promise<void> = Promise.resolve()

export function resetHydrateQueue() {
  tail = Promise.resolve()
}

export function enqueueHydrate<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task)
  tail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function isLockContention(error?: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'CONFLICT') return true
  return /could not get a lock in time/i.test(error.message || '')
}

export function canBootstrapFromRead(result: ActionEnvelope): boolean {
  return result.ok === true && !isLockContention(result.error)
}

export function isPermissionDeniedLoad(message: string | undefined | null) {
  return /do not have permission/i.test(message || '')
}

export function reportLoadError(handlers: LoadErrorHandlers, message: string) {
  if (isPermissionDeniedLoad(message)) return
  ;(handlers.onLoadError || handlers.onError)(message)
}

async function defaultSleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withConflictRetry<T extends ActionEnvelope>(
  fn: () => Promise<T>,
  options: {
    retries?: number
    backoffMs?: number
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<T> {
  const retries = options.retries ?? 3
  const backoffMs = options.backoffMs ?? 400
  const sleep = options.sleep ?? defaultSleep
  let last = await fn()
  for (let attempt = 1; attempt <= retries && !last.ok && isLockContention(last.error); attempt += 1) {
    await sleep(backoffMs * attempt)
    last = await fn()
  }
  return last
}

export function hydrateRead(
  post: (action: string, payload: Record<string, unknown>, idempotencyKey?: string) => Promise<ActionEnvelope>,
  action: string,
  payload: Record<string, unknown> = {},
) {
  return withConflictRetry(() => post(action, payload))
}
