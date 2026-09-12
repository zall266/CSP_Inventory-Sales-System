import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Card, PageHeader, StatusBadge } from '@/components/ui'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { hasPermission } from '@/features/settings/permissions'
import { saleIsAgentSale, salesVisibleToUser } from '@/features/agent/agentModel'
import { formatDate, formatMoney } from '@/utils/format'
import { PermissionDenied, PrintShell } from './A4Sheet'
import { InvoiceA4 } from './DocumentBodies'
import { invoiceDisplayStatus, pdfFilename } from './documentModel'

const auditLabel: Record<string, string> = {
  invoice_created: 'Invoice Created',
  invoice_printed: 'Invoice Printed',
  invoice_cancelled: 'Invoice Cancelled',
  quotation_converted: 'Converted from Quotation',
}

export function InvoiceDetailPage() {
  const { id } = useParams()
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { customerName } = useLookups()
  const sale = salesVisibleToUser(state, state.sales).find((item) => item.id === id)
  if (!hasPermission(state, 'sales.invoice.view') && !hasPermission(state, 'sales.view')) {
    return <PermissionDenied subtitle="You do not have access to invoices." />
  }
  if (!sale) return <PageHeader title="Invoice" subtitle="Not found." />
  const status = invoiceDisplayStatus(sale)
  const relatedDos = (state.deliveryOrders ?? []).filter((row) => row.saleId === sale.id)
  const logs = (state.documentAuditLogs ?? []).filter((row) => row.documentId === sale.id || (sale.quotationId && row.documentId === sale.quotationId && row.action === 'quotation_converted'))
  const agentSale = saleIsAgentSale(state, sale)
  return (
    <div>
      <PageHeader
        title={sale.invoiceNo}
        subtitle={`${customerName(sale.customerId)} · Official invoice`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to={`/print/invoice/${sale.id}`}><Button variant="secondary">Preview / Print</Button></Link>
            {sale.balance > 0 && sale.status !== 'voided' && (
              <Button onClick={() => api.openPaymentForSale(sale.id)}>Record Payment</Button>
            )}
            {hasPermission(state, 'sales.delivery.create') && sale.status !== 'voided' && (
              <Button variant="secondary" onClick={() => navigate(`/sales/delivery-orders/new?invoice=${sale.id}`)}>Create DO</Button>
            )}
            {sale.status !== 'voided' && !agentSale && (hasPermission(state, 'sales.invoice.cancel') || hasPermission(state, 'sales.void')) && (
              <Button variant="danger" onClick={() => api.voidSale(sale.id)}>Cancel</Button>
            )}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge status={status} />
        {sale.quotationNo && sale.quotationId && <Link className="text-sm text-indigo-700" to={`/sales/quotations/${sale.quotationId}`}>{sale.quotationNo}</Link>}
        {relatedDos.map((row) => (
          <Link key={row.id} className="text-sm text-indigo-700" to={`/sales/delivery-orders/${row.id}`}>{row.doNo}</Link>
        ))}
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><div className="text-xs text-slate-400">Grand total</div><div className="text-lg font-semibold">{formatMoney(sale.total)}</div></Card>
        <Card className="p-4"><div className="text-xs text-slate-400">Paid</div><div className="text-lg font-semibold">{formatMoney(sale.paid)}</div></Card>
        <Card className="p-4"><div className="text-xs text-slate-400">Outstanding</div><div className="text-lg font-semibold">{formatMoney(sale.balance)}</div></Card>
      </div>
      <Card className="mb-5 overflow-hidden p-0">
        <div className="p-4"><InvoiceA4 state={state} sale={sale} /></div>
      </Card>
      <Card className="p-5">
        <div className="mb-2 text-sm font-semibold">Document history</div>
        {logs.length ? logs.map((row) => (
          <div key={row.id} className="text-sm text-slate-600">
            {auditLabel[row.action] ?? row.action}
            {row.oldValue ? ` · ${row.oldValue} → ${row.newValue}` : row.newValue ? ` · ${row.newValue}` : ''}
            {' · '}{row.changedBy} · {formatDate(row.changedAt)}
          </div>
        )) : <p className="text-sm text-slate-500">No document history yet. Sales payments still appear under Receivables.</p>}
      </Card>
    </div>
  )
}

export function InvoicePrintPage() {
  const { id } = useParams()
  const state = useStore()
  const api = useApi()
  const sale = salesVisibleToUser(state, state.sales).find((item) => item.id === id)
  if (!sale) return <PageHeader title="Invoice" subtitle="Not found." />
  if (!hasPermission(state, 'sales.invoice.view') && !hasPermission(state, 'sales.view')) {
    return <PermissionDenied subtitle="You do not have access to invoices." />
  }
  const name = state.customers.find((item) => item.id === sale.customerId)?.name ?? 'Customer'
  const canPrint = hasPermission(state, 'sales.invoice.print')
  return (
    <PrintShell
      filename={pdfFilename(sale.invoiceNo, name)}
      backTo={`/sales/invoices/${sale.id}`}
      canPrint={canPrint}
      onPrint={() => api.recordDocumentPrint('invoice', sale.id)}
    >
      <InvoiceA4 state={state} sale={sale} />
    </PrintShell>
  )
}
