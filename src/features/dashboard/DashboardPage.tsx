import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, PackageX } from 'lucide-react'
import { Card, KpiCard, PageHeader, Segmented, StatusBadge } from '@/components/ui'
import { ProductMark, movementLabel } from '@/components/ProductMark'
import {
  dateRangeFromState,
  filteredPurchases,
  filteredSales,
  inventoryValue,
  outstandingPayables,
  outstandingReceivables,
  saleCogs,
  useApi,
  useLookups,
  useStore,
} from '@/store/hooks'
import { formatDate, formatMoney, formatQty, greeting, round2, startOfDay } from '@/utils/format'
import { CURRENT_USER } from '@/data/seed'

export function DashboardPage() {
  const state = useStore()
  const api = useApi()
  const { product, warehouseName, customerName, supplierName } = useLookups()
  const [customOpen, setCustomOpen] = useState(state.ui.datePreset === 'custom')
  const sales = filteredSales(state)
  const purchases = filteredPurchases(state)
  const warehouse = state.ui.warehouseFilter

  const totalSales = round2(sales.reduce((sum, s) => sum + s.total, 0))
  const cogs = round2(sales.reduce((sum, s) => sum + saleCogs(state, s), 0))
  const grossProfit = round2(totalSales - cogs)
  const totalPurchases = round2(purchases.reduce((sum, p) => sum + p.total, 0))
  const invValue = inventoryValue(state, warehouse)
  const receivables = outstandingReceivables(state)
  const payables = outstandingPayables(state)

  const stockRows = state.inventory.filter((row) => warehouse === 'all' || row.warehouseId === warehouse)
  const low = stockRows.filter((row) => {
    const p = product(row.productId)
    return row.qty > 0 && p && row.qty <= p.reorderLevel
  })
  const out = stockRows.filter((row) => row.qty <= 0)

  const chartData = useMemo(() => {
    const { from, to } = dateRangeFromState(state)
    const days: Array<{ label: string; sales: number; purchases: number }> = []
    const cursor = startOfDay(from)
    while (cursor.getTime() <= to.getTime()) {
      const key = cursor.toISOString().slice(0, 10)
      const daySales = state.sales
        .filter((s) => s.status !== 'voided' && s.date.slice(0, 10) === key)
        .filter((s) => warehouse === 'all' || s.warehouseId === warehouse)
        .reduce((sum, s) => sum + s.total, 0)
      const dayPurchases = state.purchases
        .filter((p) => p.date.slice(0, 10) === key)
        .filter((p) => warehouse === 'all' || p.warehouseId === warehouse)
        .reduce((sum, p) => sum + p.total, 0)
      days.push({
        label: cursor.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        sales: round2(daySales),
        purchases: round2(dayPurchases),
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    return days
  }, [state, warehouse])

  const topProducts = useMemo(() => {
    const map = new Map<string, number>()
    for (const sale of sales) {
      for (const item of sale.items) {
        map.set(item.productId, (map.get(item.productId) ?? 0) + item.total)
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, total]) => ({ product: product(id), total }))
      .filter((row) => row.product)
  }, [sales, product])

  const recent = [
    ...state.sales.slice(0, 6).map((s) => ({
      id: s.id,
      type: 'Sales',
      ref: s.invoiceNo,
      party: customerName(s.customerId),
      date: s.date,
      amount: s.total,
      onClick: () => api.openDrawer({ type: 'sale', id: s.id }),
    })),
    ...state.purchases.slice(0, 4).map((p) => ({
      id: p.id,
      type: 'Purchases',
      ref: p.purchaseNo,
      party: supplierName(p.supplierId),
      date: p.date,
      amount: p.total,
      onClick: () => api.openDrawer({ type: 'purchase', id: p.id }),
    })),
    ...state.payments.slice(0, 4).map((p) => ({
      id: p.id,
      type: 'Payments',
      ref: p.paymentNo,
      party: p.invoiceNo,
      date: p.date,
      amount: p.amount,
      onClick: () => {},
    })),
    ...state.stockMovements
      .filter((m) => m.type === 'adjustment' || m.type === 'stock_count')
      .slice(0, 3)
      .map((m) => ({
        id: m.id,
        type: 'Stock Adjustments',
        ref: m.reference,
        party: movementLabel(m.type),
        date: m.date,
        amount: 0,
        onClick: () => api.openDrawer({ type: 'movement', id: m.id }),
      })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)

  const alerts = [...out.slice(0, 3), ...low.slice(0, 5)]

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${CURRENT_USER.name}`}
        subtitle="Here's what's happening with your business today."
        actions={
          <Segmented
            value={state.ui.datePreset}
            onChange={(id) => {
              api.setDatePreset(id as typeof state.ui.datePreset)
              setCustomOpen(id === 'custom')
            }}
            options={[
              { id: '7d', label: '7 Days' },
              { id: '30d', label: '30 Days' },
              { id: '90d', label: '90 Days' },
              { id: 'custom', label: 'Custom' },
            ]}
          />
        }
      />
      {customOpen && (
        <div className="mb-5 flex gap-3">
          <input
            type="date"
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
            value={state.ui.customFrom}
            onChange={(e) => api.setDatePreset('custom', e.target.value, state.ui.customTo)}
          />
          <input
            type="date"
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
            value={state.ui.customTo}
            onChange={(e) => api.setDatePreset('custom', state.ui.customFrom, e.target.value)}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total sales" value={formatMoney(totalSales, { compact: true })} hint={`${sales.length} invoices`} />
        <KpiCard label="Gross profit" value={formatMoney(grossProfit, { compact: true })} tone="success" hint="Sales minus COGS" />
        <KpiCard label="Inventory value" value={formatMoney(invValue, { compact: true })} hint={warehouse === 'all' ? 'All warehouses' : warehouseName(warehouse)} />
        <KpiCard label="Receivables" value={formatMoney(receivables, { compact: true })} tone={receivables > 0 ? 'warning' : 'default'} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total purchases" value={formatMoney(totalPurchases, { compact: true })} />
        <KpiCard label="Payables" value={formatMoney(payables, { compact: true })} />
        <KpiCard label="Low stock" value={`${low.length} items`} tone="warning" />
        <KpiCard label="Out of stock" value={`${out.length} items`} tone="danger" />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <div className="mb-4">
            <div className="text-sm font-semibold text-slate-900">Sales overview</div>
            <div className="text-xs text-slate-400">Trend across the selected date range</div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4F46E5" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#4F46E5" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#EEF2F7" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => formatMoney(Number(value))} />
                <Area type="monotone" dataKey="sales" stroke="#4F46E5" fill="url(#salesFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-4 text-sm font-semibold text-slate-900">Top selling products</div>
          <div className="space-y-3">
            {topProducts.map((row) =>
              row.product ? (
                <button
                  key={row.product.id}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl p-1 text-left hover:bg-slate-50"
                  onClick={() => api.openDrawer({ type: 'product', id: row.product!.id })}
                >
                  <ProductMark product={row.product} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{row.product.name}</div>
                    <div className="text-xs text-slate-400">{row.product.sku}</div>
                  </div>
                  <div className="text-sm tabular text-slate-600">{formatMoney(row.total, { compact: true })}</div>
                </button>
              ) : null,
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <div className="mb-4 text-sm font-semibold text-slate-900">Sales vs purchases</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData.filter((_, i) => i % Math.max(1, Math.ceil(chartData.length / 10)) === 0 || i === chartData.length - 1)}>
                <CartesianGrid stroke="#EEF2F7" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => formatMoney(Number(value))} />
                <Bar dataKey="sales" fill="#4F46E5" radius={[6, 6, 0, 0]} />
                <Bar dataKey="purchases" fill="#CBD5E1" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-4 text-sm font-semibold text-slate-900">Stock alerts</div>
          <div className="space-y-3">
            {alerts.slice(0, 6).map((row) => {
              const p = product(row.productId)
              if (!p) return null
              const status = row.qty <= 0 ? 'out_of_stock' : 'low_stock'
              return (
                <button
                  key={`${row.productId}-${row.warehouseId}`}
                  type="button"
                  className="flex w-full items-start gap-3 rounded-xl p-1 text-left hover:bg-slate-50"
                  onClick={() => api.openDrawer({ type: 'product', id: p.id })}
                >
                  {status === 'out_of_stock' ? (
                    <PackageX size={18} className="mt-0.5 text-rose-500" />
                  ) : (
                    <AlertTriangle size={18} className="mt-0.5 text-amber-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-800">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      {formatQty(row.qty)} {p.unit} remaining · {warehouseName(row.warehouseId)}
                    </div>
                  </div>
                  <StatusBadge status={status} />
                </button>
              )
            })}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="text-sm font-semibold text-slate-900">Recent transactions</div>
          <div className="text-xs text-slate-400">Sales · Purchases · Payments · Adjustments</div>
        </div>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Reference</th>
                <th>Party</th>
                <th>Date</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.id} onClick={row.onClick}>
                  <td>{row.type}</td>
                  <td className="font-medium">{row.ref}</td>
                  <td>{row.party}</td>
                  <td>{formatDate(row.date)}</td>
                  <td className="tabular">{row.amount ? formatMoney(row.amount) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
