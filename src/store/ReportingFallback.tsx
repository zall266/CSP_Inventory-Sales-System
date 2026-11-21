import { PermissionDenied } from '@/features/documents/A4Sheet'
import { PageHeader } from '@/components/ui'
import type { ReportingSurface } from '@/store/reportingOverlay'

export function ReportingFallback({
  surface,
  title,
  deniedSubtitle,
}: {
  surface: ReportingSurface
  title: string
  deniedSubtitle: string
}) {
  if (surface === 'denied') return <PermissionDenied title={title} subtitle={deniedSubtitle} />
  if (surface === 'loading') {
    return (
      <div>
        <PageHeader title={title} subtitle="Loading from the server." />
      </div>
    )
  }
  if (surface === 'error') {
    return (
      <div>
        <PageHeader title={title} subtitle="Could not load from the server." />
      </div>
    )
  }
  return null
}
