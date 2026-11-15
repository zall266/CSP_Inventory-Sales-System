export type ReportingQueryState<T> = {
  data: T | null
  denied: boolean
  configured: boolean
}

export function isReportingDenied(query: Pick<ReportingQueryState<unknown>, 'configured' | 'denied'>, permitted: boolean) {
  return !permitted || (query.configured && query.denied)
}

export function pickReportingOverlay<T>(query: Pick<ReportingQueryState<T>, 'data' | 'configured'>, local: T, empty: T): T {
  if (!query.configured) return query.data ?? local
  return query.data ?? empty
}

export function pickReportingNumber(
  query: Pick<ReportingQueryState<unknown>, 'configured'>,
  overlay: number | undefined,
  local: number,
) {
  if (!query.configured) return overlay ?? local
  return overlay ?? 0
}
