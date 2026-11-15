import { useEffect, useState } from 'react'
import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import { currentUser } from '@/features/manufacturing/sessionPlan'
import type { AppState } from '@/types'
import { PROTOTYPE_TODAY, systemDateKey } from '@/utils/format'
import type { ReportingQueryState } from '@/store/reportingOverlay'

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
  const configured = Boolean(identityApiUrl())
  const enabled = options?.enabled ?? true
  const serialized = JSON.stringify(payload)
  const [data, setData] = useState<T | null>(null)
  const [denied, setDenied] = useState(false)
  useEffect(() => {
    if (!configured || !enabled) {
      setData(null)
      setDenied(false)
      return
    }
    let cancelled = false
    const body = JSON.parse(serialized) as Record<string, unknown>
    void (async () => {
      try {
        const result = await postIdentityAction(action, body)
        if (cancelled) return
        if (!result.ok) {
          setDenied(result.error?.code === 'FORBIDDEN')
          setData(null)
          return
        }
        setDenied(false)
        setData((result.data as T) ?? null)
      } catch {
        if (!cancelled) {
          setDenied(false)
          setData(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [action, serialized, configured, enabled])
  return { data, denied, configured }
}
