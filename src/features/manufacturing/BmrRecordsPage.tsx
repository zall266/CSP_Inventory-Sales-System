import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, FilterRow, Input, PageHeader, Select } from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { filterBmrRecords, listBmrRecords, type BmrRecordRange } from '@/features/manufacturing/bmrModel'
import { hasPermission } from '@/features/settings/permissions'
import { useStore } from '@/store/hooks'
import { systemDateKey } from '@/utils/format'

const RANGES: Array<{ value: BmrRecordRange; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'custom', label: 'Custom' },
]

export function BmrRecordsPage() {
  const state = useStore()
  const [query, setQuery] = useState('')
  const [range, setRange] = useState<BmrRecordRange>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [warehouseId, setWarehouseId] = useState('all')
  const today = systemDateKey()
  const rows = useMemo(() => {
    const listed = listBmrRecords(state.productionSessions, state.products, state.warehouses)
    return filterBmrRecords(listed, { query, range, from, to, warehouseId, today })
  }, [state.productionSessions, state.products, state.warehouses, query, range, from, to, warehouseId, today])

  if (!hasPermission(state, 'manufacturing.history.view')) {
    return <PermissionDenied title="BMR Records" subtitle="You do not have permission to view completed production." />
  }

  return (
    <div className="min-w-0 overflow-x-hidden">
      <PageHeader title="BMR Records" subtitle="Batch Manufacturing Records" />
      <FilterRow>
        <Select aria-label="Date" value={range} onChange={(event) => setRange(event.target.value as BmrRecordRange)}>
          {RANGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
        <Input aria-label="Search batch or product" placeholder="Search batch / product" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Select aria-label="Warehouse" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
          <option value="all">All warehouses</option>
          {state.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
        </Select>
        {range === 'custom' ? (
          <div className="flex gap-2">
            <Input aria-label="From" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <Input aria-label="To" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
        ) : <div />}
      </FilterRow>
      <Card className="hidden md:block">
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Batch No.</th>
                <th>Product</th>
                <th>Warehouse</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sessionId}>
                  <td>{row.dateLabel}</td>
                  <td className="tabular">{row.batchNo}</td>
                  <td className="max-w-xs whitespace-normal break-words">{row.productName}</td>
                  <td>{row.warehouseName || '—'}</td>
                  <td>{row.status}</td>
                  <td>
                    <div className="flex gap-2">
                      <Link to={row.viewPath}><Button size="sm" variant="secondary">View</Button></Link>
                      <Link to={row.printPath}><Button size="sm">Print BMR</Button></Link>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="text-slate-500">No completed BMR records match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <Card key={row.sessionId} className="p-4">
            <div className="text-sm text-slate-500">{row.dateLabel}</div>
            <div className="mt-1 font-medium">{row.batchNo}</div>
            <div className="mt-1 break-words text-sm text-slate-700">{row.productName}</div>
            <div className="mt-1 text-sm text-slate-500">{row.status}{row.warehouseName ? ` · ${row.warehouseName}` : ''}</div>
            <div className="mt-3 flex gap-2">
              <Link to={row.viewPath}><Button size="sm" variant="secondary">View</Button></Link>
              <Link to={row.printPath}><Button size="sm">Print BMR</Button></Link>
            </div>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-500">No completed BMR records match this filter.</p>}
      </div>
    </div>
  )
}
