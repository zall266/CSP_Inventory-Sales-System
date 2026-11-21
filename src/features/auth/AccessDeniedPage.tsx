import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/ui'

export function AccessDeniedPage() {
  return (
    <div>
      <PageHeader title="Access denied" subtitle="You do not have permission to open this page." />
      <Link className="text-sm font-medium text-indigo-600" to="/">Return to dashboard</Link>
    </div>
  )
}
