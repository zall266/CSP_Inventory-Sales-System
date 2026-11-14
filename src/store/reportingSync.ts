import { useEffect, useState } from 'react'
import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import { currentUser } from '@/features/manufacturing/sessionPlan'
import type { AppState } from '@/types'
import { PROTOTYPE_TODAY, systemDateKey } from '@/utils/format'

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

export function useReportingQuery<T>(action: string, payload: Record<string, unknown>) {
  const serialized = JSON.stringify(payload)
  const [data, setData] = useState<T | null>(null)
  useEffect(() => {
    if (!identityApiUrl()) {
      setData(null)
      return
    }
    let cancelled = false
    const body = JSON.parse(serialized) as Record<string, unknown>
    void (async () => {
      try {
        const result = await postIdentityAction(action, body)
        if (cancelled || !result.ok || !result.data) return
        setData(result.data as T)
      } catch {
        // Keep the local page math when the read API is unavailable.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [action, serialized])
  return data
}
