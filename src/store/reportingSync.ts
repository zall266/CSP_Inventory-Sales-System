import { useEffect, useState } from 'react'
import { canHydrateFromServer, postIdentityAction } from '@/api/identityApi'
import { currentUser } from '@/features/manufacturing/sessionPlan'
import type { AppState } from '@/types'
import { PROTOTYPE_TODAY, systemDateKey } from '@/utils/format'
import type { ReportingQueryState, ReportingStatus } from '@/store/reportingOverlay'

export function reportingRangePayload(state: AppState) {
  return {
    actorUserId: currentUser(state).id,
    today: systemDateKey(PROTOTYPE_TODAY),
    preset: state.ui.datePreset,
    customFrom: state.ui.customFrom,
    customTo: state.ui.customTo,
    warehouseId: state.ui.warehouseFilter,
  }
}

export function useReportingQuery<T>(
  action: string,
  payload: Record<string, unknown>,
  options?: { enabled?: boolean },
): ReportingQueryState<T> {
  const configured = canHydrateFromServer()
  const enabled = options?.enabled ?? true
  const serialized = JSON.stringify(payload)
  const [data, setData] = useState<T | null>(null)
  const [denied, setDenied] = useState(false)
  const [status, setStatus] = useState<ReportingStatus>(configured && enabled ? 'loading' : 'idle')
  useEffect(() => {
    if (!configured || !enabled) {
      setData(null)
      setDenied(false)
      setStatus('idle')
      return
    }
    let cancelled = false
    setStatus('loading')
    setData(null)
    setDenied(false)
    const body = JSON.parse(serialized) as Record<string, unknown>
    void (async () => {
      try {
        const result = await postIdentityAction(action, body)
        if (cancelled) return
        if (!result.ok) {
          const forbidden = result.error?.code === 'FORBIDDEN'
          setDenied(forbidden)
          setData(null)
          setStatus(forbidden ? 'denied' : 'error')
          return
        }
        setDenied(false)
        setData((result.data as T) ?? null)
        setStatus('ok')
      } catch {
        if (!cancelled) {
          setDenied(false)
          setData(null)
          setStatus('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [action, serialized, configured, enabled])
  return { data, denied, configured, status }
}
