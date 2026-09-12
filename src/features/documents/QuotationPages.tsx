import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button, Card, Field, FilterRow, Input, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { hasPermission } from '@/features/settings/permissions'
import { agentPosItemAvailable, currentLinkedAgent, quotationsVisibleToUser } from '@/features/agent/agentModel'
import { productIsSellable } from '@/features/products/masterData'
import { currentUser } from '@/features/manufacturing/sessionPlan'
import { formatDate, formatMoney, PROTOTYPE_TODAY, addDays } from '@/utils/format'
import { PermissionDenied, PrintShell } from './A4Sheet'
import { QuotationA4 } from './DocumentBodies'
import { customerLines, pdfFilename } from './documentModel'
import { emptyLine, LineEditor, lineTotals, type DraftLine } from './LineEditor'

const auditLabel: Record<string, string> = {
  quotation_created: 'Quotation Created',
  quotation_edited: 'Quotation Edited',
  quotation_issued: 'Quotation Issued',
  quotation_cancelled: 'Quotation Cancelled',
  quotation_converted: 'Quotation Converted to Invoice',
  quotation_printed: 'Quotation Printed',
}

export function QuotationsPage() {
  const state = useStore()
  const { customerName } = useLookups()
  const [query, setQuery] = useState('')
  const rows = useMemo(
    () =>
      quotationsVisibleToUser(state, state.quotations ?? []).filter((row) => {
        if (!query) return true
        const q = query.toLowerCase()
        return row.quotationNo.toLowerCase().includes(q) || customerName(row.customerId).toLowerCase().includes(q)
      }),
    [state, query, customerName],
  )
  if (!hasPermission(state, 'sales.quotation.view') && !hasPermission(state, 'sales.view')) {
    return <PermissionDenied subtitle="You do not have access to quotations." />
  }
  return (
    <div>
      <PageHeader
        title="Quotations"
        subtitle="Price offers for customers and prospects. Quotations do not deduct inventory."
        actions={hasPermission(state, 'sales.quotation.create') ? <Link to="/sales/quotations/new"><Button><Plus size={16} /> Create Quotation</Button></Link> : undefined}
      />
      <FilterRow>
        <Input placeholder="Search quotation or customer" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div /><div /><div />
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium text-indigo-700"><Link to={`/sales/quotations/${row.id}`}>{row.quotationNo}</Link></td>
                  <td>{formatDate(row.date)}</td>
                  <td>{customerName(row.customerId)}</td>
                  <td className="tabular">{formatMoney(row.total)}</td>
                  <td><StatusBadge status={row.status} /></td>
                  <td className="text-right">
                    <Link to={`/print/quotation/${row.id}`} className="text-xs text-indigo-700">Preview</Link>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr className="cursor-default"><td colSpan={6} className="text-slate-500">No quotations yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export function QuotationEditorPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { id } = useParams()
  const existing = id ? quotationsVisibleToUser(state, state.quotations ?? []).find((item) => item.id === id) : undefined
  const creating = !id
  const linked = currentLinkedAgent(state)
  const quoteProducts = state.products.filter((product) => {
    if (!linked) return productIsSellable(product)
    return agentPosItemAvailable(product, api.getProductQty(product.id, linked.warehouseId))
  })
  const defaultCustomer = state.customers.find((item) => item.id === 'c-abc-ent')?.id ?? state.customers.find((item) => item.status === 'active')?.id ?? ''
  const [customerId, setCustomerId] = useState(existing?.customerId ?? defaultCustomer)
  const [validUntil, setValidUntil] = useState((existing?.validUntil ?? addDays(PROTOTYPE_TODAY, 14).toISOString()).slice(0, 10))
  const [reference, setReference] = useState(existing?.reference ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [terms, setTerms] = useState(existing?.terms ?? state.settings.documentTerms)
  const [shipping, setShipping] = useState(existing?.shipping ?? 0)
  const [lines, setLines] = useState<DraftLine[]>(existing?.items.map((line) => ({ ...line })) ?? [emptyLine(state, quoteProducts)])
  const totals = lineTotals(lines, 0, 0, shipping)
  if (creating && !hasPermission(state, 'sales.quotation.create')) return <PermissionDenied subtitle="You cannot create quotations." />
  if (!creating && !hasPermission(state, 'sales.quotation.edit')) return <PermissionDenied subtitle="You cannot edit quotations." />

  const save = () => {
    const payload = {
      customerId,
      validUntil: `${validUntil}T12:00:00+08:00`,
      reference,
      notes,
      terms,
      items: lines,
      shipping,
      salesperson: currentUser(state).name,
    }
    if (creating) {
      const created = api.createQuotation(payload)
      if (created) navigate(`/sales/quotations/${created.id}`)
      return
    }
    if (existing && api.updateQuotation(existing.id, payload)) navigate(`/sales/quotations/${existing.id}`)
  }

  return (
    <div>
      <PageHeader title={creating ? 'Create Quotation' : `Edit ${existing?.quotationNo}`} subtitle="Quotations do not create a sale and do not deduct stock." />
      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {state.customers.filter((item) => item.status === 'active').map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Valid until"><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
          <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          <Field label="Salesperson"><Input value={existing?.salesperson ?? currentUser(state).name} disabled /></Field>
        </div>
        <LineEditor state={state} lines={lines} onChange={setLines} products={quoteProducts} />
        <div className="ml-auto w-56 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{formatMoney(totals.subtotal)}</span></div>
          <label className="flex justify-between gap-3 text-slate-500">
            Delivery
            <Input className="h-9 w-28" type="number" min={0} step="0.01" value={shipping} onChange={(e) => setShipping(Number(e.target.value))} />
          </label>
          <div className="flex justify-between font-semibold"><span>Grand total</span><span>{formatMoney(totals.total)}</span></div>
        </div>
        <Field label="Notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Terms & conditions"><Textarea rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate('/sales/quotations')}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </div>
      </Card>
    </div>
  )
}

export function QuotationDetailPage() {
  const { id } = useParams()
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const quotation = quotationsVisibleToUser(state, state.quotations ?? []).find((item) => item.id === id)
  if (!hasPermission(state, 'sales.quotation.view') && !hasPermission(state, 'sales.view')) {
    return <PermissionDenied subtitle="You do not have access to quotations." />
  }
  if (!quotation) return <PageHeader title="Quotation" subtitle="Not found." />
  const customer = customerLines(state.customers.find((item) => item.id === quotation.customerId))
  const logs = (state.documentAuditLogs ?? []).filter((row) => row.documentId === quotation.id)
  const relatedDos = (state.deliveryOrders ?? []).filter((row) => row.quotationId === quotation.id)
  return (
    <div>
      <PageHeader
        title={quotation.quotationNo}
        subtitle={`${customer.name} · Quotation, not an invoice`}
        actions={
          <div className="flex flex-wrap gap-2">
            {hasPermission(state, 'sales.quotation.edit') && !quotation.convertedSaleId && quotation.status !== 'cancelled' && (
              <Button variant="secondary" onClick={() => navigate(`/sales/quotations/${quotation.id}/edit`)}>Edit</Button>
            )}
            <Link to={`/print/quotation/${quotation.id}`}><Button variant="secondary">Preview / Print</Button></Link>
            {quotation.status === 'draft' && hasPermission(state, 'sales.quotation.issue') && (
              <Button variant="secondary" onClick={() => api.setQuotationStatus(quotation.id, 'sent')}>Issue</Button>
            )}
            {quotation.status === 'sent' && hasPermission(state, 'sales.quotation.edit') && (
              <>
                <Button variant="secondary" onClick={() => api.setQuotationStatus(quotation.id, 'rejected')}>Reject</Button>
                <Button variant="secondary" onClick={() => api.setQuotationStatus(quotation.id, 'expired')}>Mark Expired</Button>
              </>
            )}
            {!quotation.convertedSaleId && quotation.status !== 'cancelled' && (hasPermission(state, 'sales.invoice.create') || hasPermission(state, 'sales.create')) && (
              <Button onClick={() => {
                const sale = api.convertQuotationToInvoice(quotation.id)
                if (sale) navigate(`/sales/invoices/${sale.id}`)
              }}>Convert to Invoice</Button>
            )}
            {quotation.status !== 'cancelled' && !quotation.convertedSaleId && hasPermission(state, 'sales.quotation.cancel') && (
              <Button variant="danger" onClick={() => api.setQuotationStatus(quotation.id, 'cancelled')}>Cancel</Button>
            )}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusBadge status={quotation.status} />
        {quotation.convertedInvoiceNo && <Link className="text-sm text-indigo-700" to={`/sales/invoices/${quotation.convertedSaleId}`}>Invoice {quotation.convertedInvoiceNo}</Link>}
        {relatedDos.map((row) => (
          <Link key={row.id} className="text-sm text-indigo-700" to={`/sales/delivery-orders/${row.id}`}>{row.doNo}</Link>
        ))}
      </div>
      <Card className="mb-5 overflow-hidden p-0">
        <div className="origin-top scale-[0.92] p-4 sm:scale-100"><QuotationA4 state={state} quotation={quotation} /></div>
      </Card>
      <Card className="p-5">
        <div className="mb-2 text-sm font-semibold">Document history</div>
        {logs.length ? logs.map((row) => (
          <div key={row.id} className="text-sm text-slate-600">
            {auditLabel[row.action] ?? row.action}
            {row.oldValue ? ` · ${row.oldValue} → ${row.newValue}` : row.newValue ? ` · ${row.newValue}` : ''}
            {' · '}{row.changedBy} · {formatDate(row.changedAt)}
          </div>
        )) : <p className="text-sm text-slate-500">No history yet.</p>}
      </Card>
    </div>
  )
}

export function QuotationPrintPage() {
  const { id } = useParams()
  const state = useStore()
  const api = useApi()
  const quotation = quotationsVisibleToUser(state, state.quotations ?? []).find((item) => item.id === id)
  if (!quotation) return <PageHeader title="Quotation" subtitle="Not found." />
  if (!hasPermission(state, 'sales.quotation.view') && !hasPermission(state, 'sales.view')) {
    return <PermissionDenied subtitle="You do not have access to quotations." />
  }
  const canPrint = hasPermission(state, 'sales.quotation.print')
  const name = state.customers.find((item) => item.id === quotation.customerId)?.name ?? 'Customer'
  return (
    <PrintShell
      filename={pdfFilename(quotation.quotationNo, name)}
      backTo={`/sales/quotations/${quotation.id}`}
      canPrint={canPrint}
      onPrint={() => api.recordDocumentPrint('quotation', quotation.id)}
    >
      <QuotationA4 state={state} quotation={quotation} />
    </PrintShell>
  )
}
