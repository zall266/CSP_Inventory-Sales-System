import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, Card, FilterRow, KpiCard, PageHeader, Select } from '@/components/ui'
import { isCompanyWarehouseId } from '@/features/agent/agentModel'
import { filteredExpenses, filteredPurchases, filteredSales, inventoryValue, saleCogs, useLookups, useStore } from '@/store/hooks'
import { reportingRangePayload, useReportingQuery } from '@/store/reportingSync'
import { downloadCsv, formatDate, formatMoney, formatQty, printPage, round2 } from '@/utils/format'

const COLORS = ['#4F46E5', '#7C3AED', '#06B6D4', '#F59E0B', '#10B981', '#F43F5E']

function ReportToolbar({ onExport }: { onExport: () => void }) {
  return (
    <div className="flex gap-2">
      <Button variant="secondary" onClick={onExport}>Export</Button>
      <Button variant="secondary" onClick={printPage}>Print</Button>
    </div>
  )
}

export function SalesReportPage() {
  const state = useStore()
  const { customerName, product } = useLookups()
  const [categoryId, setCategoryId] = useState('all')
  const sales = filteredSales(state)
  const overlay = useReportingQuery<{ invoices: number; revenue: number; averageTicket: number }>('reports.sales', reportingRangePayload(state))
  const invoices = overlay?.invoices ?? sales.length
  const revenue = overlay?.revenue ?? sales.reduce((s, x) => s + x.total, 0)
  const averageTicket = overlay?.averageTicket ?? (sales.length ? sales.reduce((s, x) => s + x.total, 0) / sales.length : 0)
  const rows = sales.flatMap((s) => s.items.map((item) => ({ sale: s, item }))).filter(({ item }) => {
    if (categoryId === 'all') return true
    return product(item.productId)?.categoryId === categoryId
  })
  const chart = useMemo(() => {
    const map = new Map<string, number>()
    for (const { sale } of rows) map.set(sale.invoiceNo, sale.total)
    return [...map.entries()].slice(0, 12).map(([name, total]) => ({ name, total }))
  }, [rows])
  return (
    <div>
      <PageHeader title="Sales Reports" subtitle="Invoice performance for the selected range." actions={<ReportToolbar onExport={() => downloadCsv('sales-report.csv', [['Invoice','Date','Customer','Total'], ...sales.map((s) => [s.invoiceNo, formatDate(s.date), customerName(s.customerId), s.total])])} />} />
      <FilterRow>
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="all">All categories</option>
          {state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div /><div /><div />
      </FilterRow>
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Invoices" value={String(invoices)} />
        <KpiCard label="Revenue" value={formatMoney(revenue, { compact: true })} />
        <KpiCard label="Average ticket" value={formatMoney(averageTicket)} />
      </div>
      <Card className="mb-4 p-5">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid stroke="#EEF2F7" vertical={false} />
              <XAxis dataKey="name" hide />
              <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => formatMoney(Number(v))} />
              <Bar dataKey="total" fill="#4F46E5" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Total</th></tr></thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} className="cursor-default">
                  <td>{s.invoiceNo}</td>
                  <td>{formatDate(s.date)}</td>
                  <td>{customerName(s.customerId)}</td>
                  <td>{formatMoney(s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export function PurchaseReportPage() {
  const state = useStore()
  const { supplierName } = useLookups()
  const purchases = filteredPurchases(state)
  const overlay = useReportingQuery<{ documents: number; spend: number; unpaid: number }>('reports.purchases', reportingRangePayload(state))
  const documents = overlay?.documents ?? purchases.length
  const spend = overlay?.spend ?? purchases.reduce((s, p) => s + p.total, 0)
  const unpaid = overlay?.unpaid ?? purchases.reduce((s, p) => s + p.balance, 0)
  return (
    <div>
      <PageHeader title="Purchase Reports" subtitle="Supplier spend for the selected range." actions={<ReportToolbar onExport={() => downloadCsv('purchase-report.csv', [['Purchase','Date','Supplier','Total'], ...purchases.map((p) => [p.purchaseNo, formatDate(p.date), supplierName(p.supplierId), p.total])])} />} />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Documents" value={String(documents)} />
        <KpiCard label="Spend" value={formatMoney(spend, { compact: true })} />
        <KpiCard label="Unpaid" value={formatMoney(unpaid, { compact: true })} />
      </div>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead><tr><th>Purchase</th><th>Date</th><th>Supplier</th><th>Total</th><th>Balance</th></tr></thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id} className="cursor-default">
                  <td>{p.purchaseNo}</td>
                  <td>{formatDate(p.date)}</td>
                  <td>{supplierName(p.supplierId)}</td>
                  <td>{formatMoney(p.total)}</td>
                  <td>{formatMoney(p.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export function InventoryReportPage() {
  const state = useStore()
  const { categoryName, warehouseName } = useLookups()
  const warehouse = state.ui.warehouseFilter
  const localRows = state.inventory.filter((r) =>
    warehouse === 'all'
      ? isCompanyWarehouseId(state.warehouses, r.warehouseId)
      : r.warehouseId === warehouse,
  )
  const overlay = useReportingQuery<{
    rows: Array<{
      productId: string
      productName: string
      categoryId: string
      categoryName: string
      warehouseId: string
      warehouseName: string
      qty: number
      unit: string
      value: number
    }>
    inventoryValue: number
  }>('reports.inventory', reportingRangePayload(state))
  const value = overlay?.inventoryValue ?? inventoryValue(state, warehouse)
  const rows = overlay?.rows ?? localRows.flatMap((r) => {
    const p = state.products.find((x) => x.id === r.productId)
    if (!p) return []
    return [{
      productId: r.productId,
      productName: p.name,
      categoryId: p.categoryId,
      categoryName: categoryName(p.categoryId),
      warehouseId: r.warehouseId,
      warehouseName: warehouseName(r.warehouseId),
      qty: r.qty,
      unit: p.unit,
      value: r.qty * p.costPrice,
    }]
  })
  return (
    <div>
      <PageHeader title="Inventory Reports" subtitle="On-hand quantity and inventory value." actions={<ReportToolbar onExport={() => downloadCsv('inventory-report.csv', [['Product','Warehouse','Qty','Value'], ...rows.map((r) => [r.productName, r.warehouseName, r.qty, r.value])])} />} />
      <KpiCard label="Inventory value" value={formatMoney(value, { compact: true })} />
      <Card className="mt-4">
        <div className="sf-table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Category</th><th>Warehouse</th><th>Qty</th><th>Value</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.productId}-${r.warehouseId}`} className="cursor-default">
                  <td>{r.productName}</td>
                  <td>{r.categoryName}</td>
                  <td>{r.warehouseName}</td>
                  <td>{formatQty(r.qty)} {r.unit}</td>
                  <td>{formatMoney(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export function ProfitReportPage() {
  const state = useStore()
  const sales = filteredSales(state)
  const expenses = filteredExpenses(state)
  const overlay = useReportingQuery<{
    revenue: number
    cogs: number
    grossProfit: number
    grossMargin: number
    expenses: number
    netProfit: number
  }>('reports.profit', reportingRangePayload(state))
  const revenue = overlay?.revenue ?? round2(sales.reduce((s, x) => s + x.total, 0))
  const cogs = overlay?.cogs ?? round2(sales.reduce((s, x) => s + saleCogs(state, x), 0))
  const gross = overlay?.grossProfit ?? round2(revenue - cogs)
  const expenseTotal = overlay?.expenses ?? round2(expenses.reduce((s, e) => s + e.amount, 0))
  const net = overlay?.netProfit ?? round2(gross - expenseTotal)
  const margin = overlay?.grossMargin ?? (revenue ? (gross / revenue) * 100 : 0)
  const pie = [
    { name: 'COGS', value: cogs },
    { name: 'Expenses', value: expenseTotal },
    { name: 'Net profit', value: Math.max(net, 0) },
  ]
  return (
    <div>
      <PageHeader title="Profit Reports" subtitle="Revenue, cost, expenses and net profit." actions={<ReportToolbar onExport={() => downloadCsv('profit-report.csv', [['Metric','Amount'], ['Revenue', revenue], ['COGS', cogs], ['Gross profit', gross], ['Expenses', expenseTotal], ['Net profit', net]])} />} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Revenue" value={formatMoney(revenue, { compact: true })} />
        <KpiCard label="COGS" value={formatMoney(cogs, { compact: true })} />
        <KpiCard label="Gross profit" value={formatMoney(gross, { compact: true })} tone="success" />
        <KpiCard label="Gross margin" value={`${margin.toFixed(1)}%`} />
        <KpiCard label="Expenses" value={formatMoney(expenseTotal, { compact: true })} />
        <KpiCard label="Net profit" value={formatMoney(net, { compact: true })} tone={net >= 0 ? 'success' : 'danger'} />
      </div>
      <Card className="mt-4 p-5">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pie} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={3}>
                {pie.map((entry, index) => (
                  <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => formatMoney(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  )
}
