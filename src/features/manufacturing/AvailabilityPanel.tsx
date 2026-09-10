import { Button, StatusBadge } from '@/components/ui'
import { useLookups } from '@/store/hooks'
import { formatQty } from '@/utils/format'
import { hasShortage, type MaterialCheckRow } from './helpers'

export function AvailabilityPanel({
  rows,
  warning,
  onPurchaseRequest,
}: {
  rows: MaterialCheckRow[]
  warning?: string
  onPurchaseRequest?: () => void
}) {
  const { product } = useLookups()
  const shortage = hasShortage(rows)
  return (
    <div>
      {shortage && (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <div className="font-semibold">Material shortage</div>
          <div className="mt-0.5 text-rose-700">{warning ?? 'One or more raw materials are below the required quantity. Production cannot start until this is resolved.'}</div>
          {onPurchaseRequest && (
            <Button size="sm" variant="secondary" className="mt-3" onClick={onPurchaseRequest}>
              Create Purchase Request
            </Button>
          )}
        </div>
      )}
      <div className="sf-table-wrap rounded-xl border border-slate-100">
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>Required</th>
              <th>Available</th>
              <th>Shortage</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const item = product(row.productId)
              return (
                <tr key={row.productId} className="cursor-default">
                  <td>
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${row.status === 'shortage' ? 'bg-rose-500' : row.status === 'low' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                      <div>
                        <div className="font-medium">{item?.name}</div>
                        <div className="text-xs text-slate-400">{item?.sku}</div>
                      </div>
                    </div>
                  </td>
                  <td className="tabular">{formatQty(row.required)} {row.unit}</td>
                  <td className="tabular">{formatQty(row.available)} {row.unit}</td>
                  <td className={`tabular ${row.shortage > 0 ? 'font-semibold text-rose-600' : 'text-slate-400'}`}>
                    {row.shortage > 0 ? `${formatQty(row.shortage)} ${row.unit}` : '—'}
                  </td>
                  <td><StatusBadge status={row.status} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
