export type ReportingStatus = 'idle' | 'loading' | 'ok' | 'error' | 'denied'

export type ReportingQueryState<T> = {
  data: T | null
  denied: boolean
  configured: boolean
  status: ReportingStatus
}

export type ReportingSurface = 'denied' | 'demo' | 'loading' | 'error' | 'live'

export function isReportingDenied(query: Pick<ReportingQueryState<unknown>, 'configured' | 'denied'>, permitted: boolean) {
  return !permitted || (query.configured && query.denied)
}

export function reportingSurface(
  query: Pick<ReportingQueryState<unknown>, 'configured' | 'denied' | 'status'>,
  permitted: boolean,
): ReportingSurface {
  if (!permitted || query.denied || query.status === 'denied') return 'denied'
  if (!query.configured) return 'demo'
  if (query.status === 'loading' || query.status === 'idle') return 'loading'
  if (query.status === 'error') return 'error'
  return 'live'
}

export function isReportingFallback(surface: ReportingSurface) {
  return surface === 'denied' || surface === 'loading' || surface === 'error'
}

export function combineReportingSurfaces(surfaces: ReportingSurface[]): ReportingSurface {
  if (surfaces.some((surface) => surface === 'denied')) return 'denied'
  if (surfaces.some((surface) => surface === 'error')) return 'error'
  if (surfaces.some((surface) => surface === 'loading')) return 'loading'
  if (surfaces.every((surface) => surface === 'demo')) return 'demo'
  return 'live'
}

export function pickReportingOverlay<T>(
  query: Pick<ReportingQueryState<T>, 'data' | 'configured' | 'status'>,
  local: T,
  empty: T,
): T {
  if (!query.configured) return query.data ?? local
  if (query.status !== 'ok') return empty
  return query.data ?? empty
}

export function pickReportingNumber(
  query: Pick<ReportingQueryState<unknown>, 'configured' | 'status'>,
  overlay: number | undefined,
  local: number,
) {
  if (!query.configured) return overlay ?? local
  if (query.status !== 'ok') return 0
  return overlay ?? 0
}
