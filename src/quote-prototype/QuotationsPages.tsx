import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { Button, Card, Field, FilterRow, Input, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui'
import { formatMoney, PROTOTYPE_TODAY } from '@/utils/format'
import { addDaysIso, formatQuoteDay, lineSubtotal, quotationTotals } from './calc'
import { QuotationA4 } from './QuotationA4'
import { emptyLine, quoteApi, useQuoteStore } from './store'
import type { QuoteLine, QuoteStatus } from './types'

export function QuotationsListPage() {
  const { state } = useQuoteStore()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const customerName = (id: string) => state.customers.find((item) => item.id === id)?.company || state.customers.find((item) => item.id === id)?.name || '—'
  const rows = useMemo(
    () =>
      state.quotations.filter((row) => {
        if (query && !`${row.quotationNo} ${customerName(row.customerId)}`.toLowerCase().includes(query.toLowerCase())) return false
        if (status !== 'all' && row.status !== status) return false
        if (from && row.date.slice(0, 10) < from) return false
        if (to && row.date.slice(0, 10) > to) return false
        return true
      }),
    [state.quotations, query, status, from, to, state.customers],
  )
  return (
    <div>
      <PageHeader
        title="Quotations"
        subtitle="Create, preview and print professional A4 quotations."
        actions={<Button onClick={() => navigate('/quotations/new')}>+ New Quotation</Button>}
      />
      <FilterRow>
        <Input placeholder="Search number or customer" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All status</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quotation No</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Valid Until</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="cursor-default">
                  <td className="font-medium text-indigo-700"><Link to={`/quotations/${row.id}`}>{row.quotationNo}</Link></td>
                  <td>{customerName(row.customerId)}</td>
                  <td>{formatQuoteDay(row.date)}</td>
                  <td>{formatQuoteDay(row.validUntil)}</td>
                  <td className="tabular">{formatMoney(row.total)}</td>
                  <td><StatusBadge status={row.status} /></td>
                  <td className="space-x-2 whitespace-nowrap text-xs">
                    <Link className="text-indigo-700" to={`/quotations/${row.id}/preview`}>View</Link>
                    <Link className="text-indigo-700" to={`/quotations/${row.id}`}>Edit</Link>
                    <button type="button" className="text-indigo-700" onClick={() => { const copy = quoteApi.duplicate(row.id); if (copy) navigate(`/quotations/${copy.id}`) }}>Duplicate</button>
                    <Link className="text-indigo-700" to={`/quotations/${row.id}/preview`}>Print</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export function QuotationEditorPage() {
  const { id } = useParams()
  const { state } = useQuoteStore()
  const navigate = useNavigate()
  const existing = id ? state.quotations.find((item) => item.id === id) : undefined
  const creating = !existing
  const [customerId, setCustomerId] = useState(existing?.customerId ?? '')
  const [date, setDate] = useState((existing?.date ?? PROTOTYPE_TODAY.toISOString()).slice(0, 10))
  const [validUntil, setValidUntil] = useState((existing?.validUntil ?? addDaysIso(PROTOTYPE_TODAY.toISOString(), state.settings.validityDays)).slice(0, 10))
  const [reference, setReference] = useState(existing?.reference ?? '')
  const [salesperson, setSalesperson] = useState(existing?.salesperson ?? 'Admin')
  const [shipping, setShipping] = useState(existing?.shipping ?? 0)
  const [discount, setDiscount] = useState(existing?.discount ?? 0)
  const [tax, setTax] = useState(existing?.tax ?? 0)
  const [paymentMethod, setPaymentMethod] = useState(existing?.paymentMethod ?? state.settings.paymentMethod)
  const [notes, setNotes] = useState(existing?.notes ?? state.settings.defaultNotes)
  const [terms, setTerms] = useState(existing?.terms ?? state.settings.defaultTerms)
  const [status, setStatus] = useState<QuoteStatus>(existing?.status ?? 'draft')
  const [lines, setLines] = useState<QuoteLine[]>(existing?.items ?? [emptyLine(state.products)])
  const [showCustomer, setShowCustomer] = useState(false)
  const totals = quotationTotals(lines.map((line) => ({ ...line, subtotal: lineSubtotal(line.qty, line.unitPrice, line.discount) })), shipping, discount, tax)
  const customer = state.customers.find((item) => item.id === customerId)

  const patchLine = (index: number, next: Partial<QuoteLine>) => {
    setLines((current) =>
      current.map((line, i) => {
        if (i !== index) return line
        const merged = { ...line, ...next }
        if (next.productId) {
          const product = state.products.find((item) => item.id === next.productId)
          if (product) {
            merged.name = product.name
            merged.code = product.code
            merged.description = product.description
            merged.unit = product.unit
            if (next.unitPrice === undefined) merged.unitPrice = product.sellingPrice
          }
        }
        merged.subtotal = lineSubtotal(merged.qty, merged.unitPrice, merged.discount)
        return merged
      }),
    )
  }

  const save = (andPreview = false) => {
    const payload = {
      id: existing?.id,
      date: `${date}T12:00:00+08:00`,
      validUntil: `${validUntil}T12:00:00+08:00`,
      reference,
      salesperson,
      customerId,
      items: lines,
      shipping,
      discount,
      tax,
      paymentMethod,
      notes,
      terms,
      status,
    }
    const saved = quoteApi.saveQuotation(payload)
    if (!saved) return
    navigate(andPreview ? `/quotations/${saved.id}/preview` : `/quotations/${saved.id}`)
  }

  return (
    <div>
      <PageHeader
        title={creating ? 'New Quotation' : existing?.quotationNo}
        subtitle={creating ? 'Draft a customer-facing quotation. Totals update as you type.' : 'Edit quotation details. Preview uses the saved document plus live totals below.'}
        actions={
          <div className="flex flex-wrap gap-2">
            {existing && <Link to={`/quotations/${existing.id}/preview`}><Button variant="secondary">Preview</Button></Link>}
            <Button variant="secondary" onClick={() => save(true)}>Save & Preview</Button>
            <Button onClick={() => save(false)}>Save Draft</Button>
          </div>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <Card className="space-y-3 p-5">
            <div className="text-sm font-semibold">Company</div>
            <div className="text-sm text-slate-700">
              <div className="font-semibold">{state.settings.companyName}</div>
              <div className="text-slate-500">{state.settings.registrationNo}</div>
              <div className="text-slate-500">{state.settings.address}</div>
              <div className="text-slate-500">{state.settings.phone} · {state.settings.website}</div>
              <Link className="text-xs text-indigo-700" to="/settings">Edit in Settings</Link>
            </div>
          </Card>
          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Customer</div>
              <Button size="sm" variant="secondary" onClick={() => setShowCustomer(true)}>+ Add Customer</Button>
            </div>
            <Field label="Customer">
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Select customer</option>
                {state.customers.map((item) => (
                  <option key={item.id} value={item.id}>{item.company || item.name}</option>
                ))}
              </Select>
            </Field>
            {customer && (
              <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                <div>{customer.address}</div>
                <div>{customer.phone}</div>
                <div>{customer.email}</div>
              </div>
            )}
          </Card>
          <Card className="space-y-3 p-5">
            <div className="text-sm font-semibold">Quotation Information</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Quotation Number"><Input value={existing?.quotationNo ?? 'Auto on save'} disabled /></Field>
              <Field label="Salesperson"><Input value={salesperson} onChange={(e) => setSalesperson(e.target.value)} /></Field>
              <Field label="Quotation Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Valid Until"><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
              <Field label="Reference / PO Number"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
              <Field label="Status">
                <Select value={status} onChange={(e) => setStatus(e.target.value as QuoteStatus)}>
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="accepted">Accepted</option>
                  <option value="rejected">Rejected</option>
                  <option value="expired">Expired</option>
                </Select>
              </Field>
            </div>
          </Card>
          <Card className="space-y-3 p-5">
            <div className="text-sm font-semibold">Products</div>
            <div className="sf-table-wrap rounded-xl border border-slate-100">
              <table>
                <thead>
                  <tr>
                    <th>No</th>
                    <th>Product</th>
                    <th>Code</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Unit Price</th>
                    <th>Discount</th>
                    <th>Subtotal</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={line.id} className="cursor-default">
                      <td>{index + 1}</td>
                      <td>
                        <Select value={line.productId} onChange={(e) => patchLine(index, { productId: e.target.value })}>
                          {state.products.filter((item) => item.status === 'active').map((product) => (
                            <option key={product.id} value={product.id}>{product.name}</option>
                          ))}
                        </Select>
                      </td>
                      <td className="text-xs text-slate-500">{line.code}</td>
                      <td><input type="number" min={0} className="h-10 w-20 rounded-xl border border-slate-200 px-2 text-sm" value={line.qty} onChange={(e) => patchLine(index, { qty: Number(e.target.value) })} /></td>
                      <td><input className="h-10 w-16 rounded-xl border border-slate-200 px-2 text-sm" value={line.unit} onChange={(e) => patchLine(index, { unit: e.target.value })} /></td>
                      <td><input type="number" min={0} step="0.01" className="h-10 w-24 rounded-xl border border-slate-200 px-2 text-sm" value={line.unitPrice} onChange={(e) => patchLine(index, { unitPrice: Number(e.target.value) })} /></td>
                      <td><input type="number" min={0} step="0.01" className="h-10 w-20 rounded-xl border border-slate-200 px-2 text-sm" value={line.discount} onChange={(e) => patchLine(index, { discount: Number(e.target.value) })} /></td>
                      <td className="tabular">{formatMoney(lineSubtotal(line.qty, line.unitPrice, line.discount))}</td>
                      <td><Button size="sm" variant="ghost" onClick={() => setLines(lines.filter((_, i) => i !== index))}><Trash2 size={14} /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button variant="secondary" onClick={() => setLines([...lines, emptyLine(state.products)])}>+ Add Product</Button>
          </Card>
          <Card className="space-y-3 p-5">
            <div className="text-sm font-semibold">Payment Information</div>
            <Field label="Payment Method"><Textarea rows={2} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} /></Field>
            <div className="text-sm text-slate-500">{state.settings.bankName} · {state.settings.accountNumber}</div>
          </Card>
          <Card className="space-y-3 p-5">
            <div className="text-sm font-semibold">Notes & Terms</div>
            <Field label="Notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Field label="Terms & Conditions"><Textarea rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="space-y-2 p-5">
            <div className="text-sm font-semibold">Totals</div>
            <TotalRow label="Subtotal" value={formatMoney(totals.subtotal)} />
            <Field label="Shipping Charges"><Input type="number" step="0.01" value={shipping} onChange={(e) => setShipping(Number(e.target.value))} /></Field>
            <Field label="Discount"><Input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} /></Field>
            <Field label="Tax"><Input type="number" step="0.01" value={tax} onChange={(e) => setTax(Number(e.target.value))} /></Field>
            <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-semibold">
              <span>TOTAL</span>
              <span className="tabular">{formatMoney(totals.total)}</span>
            </div>
          </Card>
        </div>
      </div>
      {showCustomer && <InlineCustomer onClose={() => setShowCustomer(false)} onCreated={(id) => { setCustomerId(id); setShowCustomer(false) }} />}
    </div>
  )
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  )
}

function InlineCustomer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <Card className="w-full max-w-lg space-y-3 p-5">
        <div className="text-base font-semibold">Add Customer</div>
        <Field label="Customer Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Company"><Input value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
        <Field label="Address"><Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!name.trim()) return
              const id = quoteApi.saveCustomer({ name, company: company || name, address, phone, email })
              onCreated(id)
            }}
          >
            Save
          </Button>
        </div>
      </Card>
    </div>
  )
}

export function QuotationPreviewPage() {
  const { id } = useParams()
  const { state } = useQuoteStore()
  const navigate = useNavigate()
  const quotation = state.quotations.find((item) => item.id === id)
  const customer = state.customers.find((item) => item.id === quotation?.customerId)
  if (!quotation) return <PageHeader title="Quotation" subtitle="Not found." />

  const print = () => {
    const previous = document.title
    document.title = `${quotation.quotationNo} - ${customer?.company || customer?.name || 'Customer'}`
    window.print()
    document.title = previous
  }

  const send = () => {
    quoteApi.setStatus(quotation.id, 'sent')
    quoteApi.toast('Marked as sent', 'Email / WhatsApp sending is not connected in this prototype.')
  }

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={quotation.quotationNo} subtitle="A4 customer-facing quotation" />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigate(`/quotations/${quotation.id}`)}>Edit</Button>
          <Button variant="secondary" onClick={send}>Send</Button>
          <Button onClick={print}>Print / Download PDF</Button>
        </div>
      </div>
      <div className="no-print mb-4"><StatusBadge status={quotation.status} /></div>
      <div className="mx-auto overflow-auto rounded-sm bg-slate-200 p-4 print:bg-white print:p-0">
        <div className="mx-auto shadow-xl print:shadow-none">
          <QuotationA4 quotation={quotation} customer={customer} settings={state.settings} />
        </div>
      </div>
    </div>
  )
}
