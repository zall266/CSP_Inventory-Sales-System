import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button, Card, Field, FilterRow, Input, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { hasPermission } from '@/features/settings/permissions'
import { formatDate } from '@/utils/format'
import { PermissionDenied, PrintShell } from './A4Sheet'
import { DeliveryA4 } from './DocumentBodies'
import { customerLines, pdfFilename } from './documentModel'
import { emptyLine, LineEditor, type DraftLine } from './LineEditor'

const auditLabel: Record<string, string> = {
  delivery_created: 'DO Created',
  delivery_edited: 'DO Edited',
  delivery_issued: 'DO Issued',
  delivery_cancelled: 'DO Cancelled',
  delivery_delivered: 'DO Delivered',
  delivery_printed: 'DO Printed',
}

export function DeliveryOrdersPage() {
  const state = useStore()
  const { customerName } = useLookups()
  const [query, setQuery] = useState('')
  const rows = useMemo(
    () =>
      (state.deliveryOrders ?? []).filter((row) => {
        if (!query) return true
        const q = query.toLowerCase()
        return row.doNo.toLowerCase().includes(q) || (row.invoiceNo ?? '').toLowerCase().includes(q) || customerName(row.customerId).toLowerCase().includes(q)
      }),
    [state.deliveryOrders, query, customerName],
  )
  if (!hasPermission(state, 'sales.delivery.view') && !hasPermission(state, 'sales.view')) {
    return <PermissionDenied subtitle="You do not have access to delivery orders." />
  }
  return (
    <div>
      <PageHeader
        title="Delivery Orders"
        subtitle="Dispatch documents for logistics. Delivery orders do not deduct inventory."
        actions={hasPermission(state, 'sales.delivery.create') ? <Link to="/sales/delivery-orders/new"><Button><Plus size={16} /> Create Delivery Order</Button></Link> : undefined}
      />
      <FilterRow>
        <Input placeholder="Search DO, invoice or customer" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div /><div /><div />
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>DO Number</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Related Invoice</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium text-indigo-700"><Link to={`/sales/delivery-orders/${row.id}`}>{row.doNo}</Link></td>
                  <td>{formatDate(row.date)}</td>
                  <td>{customerName(row.customerId)}</td>
                  <td>{row.invoiceNo || '—'}</td>
                  <td><StatusBadge status={row.status} /></td>
                  <td><Link to={`/print/delivery/${row.id}`} className="text-xs text-indigo-700">Preview</Link></td>
                </tr>
              ))}
              {!rows.length && <tr className="cursor-default"><td colSpan={6} className="text-slate-500">No delivery orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export function DeliveryEditorPage() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { id } = useParams()
  const [params] = useSearchParams()
  const existing = id ? (state.deliveryOrders ?? []).find((item) => item.id === id) : undefined
  const editing = Boolean(existing)
  const invoiceId = params.get('invoice') ?? existing?.saleId ?? ''
  const sale = state.sales.find((item) => item.id === invoiceId)
  const customer = sale ? state.customers.find((item) => item.id === sale.customerId) : undefined
  const [customerId, setCustomerId] = useState(existing?.customerId ?? sale?.customerId ?? state.customers.find((item) => item.status === 'active')?.id ?? '')
  const [saleId, setSaleId] = useState(existing?.saleId ?? sale?.id ?? '')
  const selectedSale = state.sales.find((item) => item.id === saleId)
  const selectedCustomer = state.customers.find((item) => item.id === (selectedSale?.customerId ?? customerId))
  const [deliveryAddress, setDeliveryAddress] = useState(existing?.deliveryAddress ?? customer?.address ?? selectedCustomer?.address ?? '')
  const [contactPerson, setContactPerson] = useState(existing?.contactPerson ?? customer?.name ?? '')
  const [contactNumber, setContactNumber] = useState(existing?.contactNumber ?? customer?.phone ?? '')
  const [transport, setTransport] = useState(existing?.transport ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [lines, setLines] = useState<DraftLine[]>(
    existing
      ? existing.items.map((line) => ({ productId: line.productId, description: line.description, qty: line.qty, unit: line.unit, price: 0, discount: 0 }))
      : sale
        ? sale.items.map((line) => {
            const product = state.products.find((item) => item.id === line.productId)
            return { productId: line.productId, description: line.description || product?.name || '', qty: line.qty, unit: product?.unit ?? 'pcs', price: 0, discount: 0 }
          })
        : [emptyLine(state)],
  )

  const applyInvoice = (nextId: string) => {
    setSaleId(nextId)
    const next = state.sales.find((item) => item.id === nextId)
    if (!next) return
    const party = state.customers.find((item) => item.id === next.customerId)
    setCustomerId(next.customerId)
    setDeliveryAddress(party?.address ?? '')
    setContactPerson(party?.name ?? '')
    setContactNumber(party?.phone ?? '')
    setLines(
      next.items.map((line) => {
        const product = state.products.find((item) => item.id === line.productId)
        return { productId: line.productId, description: line.description || product?.name || '', qty: line.qty, unit: product?.unit ?? 'pcs', price: 0, discount: 0 }
      }),
    )
  }

  const save = () => {
    if (existing) {
      const ok = api.updateDeliveryOrder(existing.id, {
        deliveryAddress,
        contactPerson,
        contactNumber,
        transport,
        notes,
        items: lines,
      })
      if (ok) navigate(`/sales/delivery-orders/${existing.id}`)
      return
    }
    const created = api.createDeliveryOrder({
      customerId: selectedSale?.customerId ?? customerId,
      saleId: saleId || undefined,
      quotationId: selectedSale?.quotationId,
      deliveryAddress,
      contactPerson,
      contactNumber,
      transport,
      notes,
      items: lines,
    })
    if (created) navigate(`/sales/delivery-orders/${created.id}`)
  }

  if (!editing && !hasPermission(state, 'sales.delivery.create')) return <PermissionDenied subtitle="You cannot create delivery orders." />
  if (editing && !hasPermission(state, 'sales.delivery.edit')) return <PermissionDenied subtitle="You cannot edit delivery orders." />

  return (
    <div>
      <PageHeader title={editing ? `Edit ${existing?.doNo}` : 'Create Delivery Order'} subtitle="Copy from an invoice when possible. This does not deduct stock." />
      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Related invoice">
            <Select value={saleId} onChange={(e) => applyInvoice(e.target.value)} disabled={editing}>
              <option value="">No invoice</option>
              {state.sales.filter((item) => item.status !== 'voided').map((item) => (
                <option key={item.id} value={item.id}>{item.invoiceNo} · {state.customers.find((c) => c.id === item.customerId)?.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Customer">
            <Select value={selectedSale?.customerId ?? customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={Boolean(selectedSale) || editing}>
              {state.customers.filter((item) => item.status === 'active').map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Delivery address"><Textarea rows={2} value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} /></Field>
          <Field label="Contact person"><Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} /></Field>
          <Field label="Contact number"><Input value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} /></Field>
          <Field label="Transport / logistics"><Input value={transport} onChange={(e) => setTransport(e.target.value)} /></Field>
        </div>
        <LineEditor state={state} lines={lines} onChange={setLines} withPrices={false} />
        <Field label="Notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate(existing ? `/sales/delivery-orders/${existing.id}` : '/sales/delivery-orders')}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </div>
      </Card>
    </div>
  )
}

export function DeliveryDetailPage() {
  const { id } = useParams()
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const order = (state.deliveryOrders ?? []).find((item) => item.id === id)
  if (!hasPermission(state, 'sales.delivery.view') && !hasPermission(state, 'sales.view')) {
    return <PermissionDenied subtitle="You do not have access to delivery orders." />
  }
  if (!order) return <PageHeader title="Delivery Order" subtitle="Not found." />
  const customer = customerLines(state.customers.find((item) => item.id === order.customerId))
  const logs = (state.documentAuditLogs ?? []).filter((row) => row.documentId === order.id)
  return (
    <div>
      <PageHeader
        title={order.doNo}
        subtitle={`${customer.name} · Delivery / dispatch`}
        actions={
          <div className="flex flex-wrap gap-2">
            {order.status !== 'cancelled' && order.status !== 'delivered' && hasPermission(state, 'sales.delivery.edit') && (
              <Button variant="secondary" onClick={() => navigate(`/sales/delivery-orders/${order.id}/edit`)}>Edit</Button>
            )}
            <Link to={`/print/delivery/${order.id}`}><Button variant="secondary">Preview / Print</Button></Link>
            {order.status === 'draft' && hasPermission(state, 'sales.delivery.issue') && (
              <Button variant="secondary" onClick={() => api.setDeliveryOrderStatus(order.id, 'issued')}>Issue</Button>
            )}
            {(order.status === 'issued' || order.status === 'draft') && (
              <Button onClick={() => api.setDeliveryOrderStatus(order.id, 'delivered')}>Mark Delivered</Button>
            )}
            {order.status !== 'cancelled' && order.status !== 'delivered' && hasPermission(state, 'sales.delivery.cancel') && (
              <Button variant="danger" onClick={() => api.setDeliveryOrderStatus(order.id, 'cancelled')}>Cancel</Button>
            )}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <StatusBadge status={order.status} />
        {order.saleId && order.invoiceNo && <Link className="text-sm text-indigo-700" to={`/sales/invoices/${order.saleId}`}>{order.invoiceNo}</Link>}
        {order.quotationId && order.quotationNo && <Link className="text-sm text-indigo-700" to={`/sales/quotations/${order.quotationId}`}>{order.quotationNo}</Link>}
      </div>
      <Card className="mb-5 overflow-hidden p-0">
        <div className="p-4"><DeliveryA4 state={state} order={order} /></div>
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

export function DeliveryPrintPage() {
  const { id } = useParams()
  const state = useStore()
  const api = useApi()
  const order = (state.deliveryOrders ?? []).find((item) => item.id === id)
  if (!order) return <PageHeader title="Delivery Order" subtitle="Not found." />
  if (!hasPermission(state, 'sales.delivery.view') && !hasPermission(state, 'sales.view')) {
    return <PermissionDenied subtitle="You do not have access to delivery orders." />
  }
  const name = state.customers.find((item) => item.id === order.customerId)?.name ?? 'Customer'
  return (
    <PrintShell
      filename={pdfFilename(order.doNo, name)}
      backTo={`/sales/delivery-orders/${order.id}`}
      canPrint={hasPermission(state, 'sales.delivery.print')}
      onPrint={() => api.recordDocumentPrint('delivery', order.id)}
    >
      <DeliveryA4 state={state} order={order} />
    </PrintShell>
  )
}
