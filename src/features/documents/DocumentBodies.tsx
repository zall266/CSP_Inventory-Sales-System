import { CompanyHeader, MetaGrid, PartyBlock, SignatureBox } from './A4Sheet'
import { companyProfile, customerLines, dateLabel, invoiceDisplayStatus, money, qty } from './documentModel'
import type { AppState, DeliveryOrder, Quotation, Sale } from '@/types'

export function QuotationA4({ state, quotation }: { state: AppState; quotation: Quotation }) {
  const company = companyProfile(state.settings)
  const customer = customerLines(state.customers.find((item) => item.id === quotation.customerId))
  return (
    <div>
      <CompanyHeader settings={state.settings} />
      <div className="mt-5 flex items-start justify-between gap-6">
        <div>
          <div className="text-2xl font-bold tracking-[0.18em] text-slate-900">QUOTATION</div>
          <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-amber-800">This is a quotation, not an invoice. No payment is requested.</div>
        </div>
        <MetaGrid
          items={[
            { label: 'Quotation No', value: quotation.quotationNo },
            { label: 'Date', value: dateLabel(quotation.date) },
            { label: 'Valid until', value: dateLabel(quotation.validUntil) },
            { label: 'Prepared by', value: quotation.salesperson },
          ]}
        />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-6">
        <PartyBlock title="Customer" name={customer.name} lines={[customer.address, customer.phone, customer.email]} />
        <div className="text-[11px] text-slate-600">
          {quotation.reference && (
            <div>
              <span className="text-slate-500">Reference: </span>
              {quotation.reference}
            </div>
          )}
        </div>
      </div>
      <table className="a4-table mt-5">
        <thead>
          <tr>
            <th>No</th>
            <th>Product / Description</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Unit price</th>
            <th>Discount</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {quotation.items.map((line, index) => (
            <tr key={`${line.productId}-${index}`}>
              <td>{index + 1}</td>
              <td>{line.description}</td>
              <td className="tabular">{qty(line.qty)}</td>
              <td>{line.unit}</td>
              <td className="tabular">{money(line.price)}</td>
              <td className="tabular">{line.discount ? money(line.discount) : '—'}</td>
              <td className="tabular">{money(line.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="a4-avoid-break ml-auto mt-4 w-56 space-y-1 text-[11px]">
        <Row label="Subtotal" value={money(quotation.subtotal)} />
        <Row label="Discount" value={money(quotation.discount)} />
        <Row label="Tax" value={money(quotation.tax)} />
        <Row label="Grand total" value={money(quotation.total)} strong />
      </div>
      <div className="a4-avoid-break mt-6 grid gap-4 text-[10px] text-slate-600">
        {quotation.notes && (
          <div>
            <div className="font-bold uppercase tracking-wide text-slate-500">Notes</div>
            <div className="whitespace-pre-wrap">{quotation.notes}</div>
          </div>
        )}
        <div>
          <div className="font-bold uppercase tracking-wide text-slate-500">Terms & conditions</div>
          <div className="whitespace-pre-wrap">{quotation.terms || company.documentTerms}</div>
        </div>
      </div>
      <div className="a4-avoid-break mt-10 flex gap-8">
        <SignatureBox label="Prepared by" />
        <SignatureBox label="Authorized by / Signature" />
      </div>
    </div>
  )
}

export function InvoiceA4({ state, sale }: { state: AppState; sale: Sale }) {
  const company = companyProfile(state.settings)
  const customer = customerLines(state.customers.find((item) => item.id === sale.customerId))
  const status = invoiceDisplayStatus(sale)
  return (
    <div>
      <CompanyHeader settings={state.settings} />
      <div className="mt-5 flex items-start justify-between gap-6">
        <div className="text-2xl font-bold tracking-[0.18em] text-slate-900">INVOICE</div>
        <MetaGrid
          items={[
            { label: 'Invoice No', value: sale.invoiceNo },
            { label: 'Invoice date', value: dateLabel(sale.date) },
            { label: 'Due date', value: sale.dueDate ? dateLabel(sale.dueDate) : '—' },
            { label: 'Payment terms', value: sale.paymentTerms || company.paymentTerms },
            { label: 'Prepared by', value: sale.salesperson },
            ...(sale.quotationNo ? [{ label: 'Quotation', value: sale.quotationNo }] : []),
            ...(sale.reference ? [{ label: 'Reference', value: sale.reference }] : []),
          ]}
        />
      </div>
      <div className="mt-5">
        <PartyBlock title="Bill to" name={customer.name} lines={[customer.address, customer.phone, customer.email]} />
      </div>
      <table className="a4-table mt-5">
        <thead>
          <tr>
            <th>No</th>
            <th>Item</th>
            <th>Description</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Unit price</th>
            <th>Discount</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((line, index) => {
            const product = state.products.find((item) => item.id === line.productId)
            return (
              <tr key={`${line.productId}-${index}`}>
                <td>{index + 1}</td>
                <td>{product?.sku ?? ''}</td>
                <td>{line.description || product?.name || 'Item'}</td>
                <td className="tabular">{qty(line.qty)}</td>
                <td>{product?.unit ?? 'pcs'}</td>
                <td className="tabular">{money(line.price)}</td>
                <td className="tabular">{line.discount ? money(line.discount) : '—'}</td>
                <td className="tabular">{money(line.total)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-4 flex items-start justify-between gap-8">
        <div className="a4-avoid-break max-w-sm text-[10px] text-slate-600">
          <div className="font-bold uppercase tracking-wide text-slate-500">Payment</div>
          <div>Status: {status.toUpperCase()}</div>
          <div>Paid: {money(sale.paid)}</div>
          <div>Outstanding: {money(sale.balance)}</div>
          {(company.bankName || company.bankAccount) && (
            <div className="mt-2">
              {company.bankName ? <div>Bank: {company.bankName}</div> : null}
              {company.bankAccount ? <div>Account: {company.bankAccount}</div> : null}
            </div>
          )}
        </div>
        <div className="a4-avoid-break w-56 space-y-1 text-[11px]">
          <Row label="Subtotal" value={money(sale.subtotal)} />
          {sale.shipping > 0 && <Row label="Delivery" value={money(sale.shipping)} />}
          <Row label="Discount" value={money(sale.discount)} />
          <Row label="Tax" value={money(sale.tax)} />
          <Row label="Grand total" value={money(sale.total)} strong />
          <Row label="Paid" value={money(sale.paid)} />
          <Row label="Outstanding" value={money(sale.balance)} />
        </div>
      </div>
      <div className="a4-avoid-break mt-6 text-[10px] text-slate-600">
        {sale.notes && (
          <div className="mb-3">
            <div className="font-bold uppercase tracking-wide text-slate-500">Notes</div>
            <div className="whitespace-pre-wrap">{sale.notes}</div>
          </div>
        )}
        <div className="font-bold uppercase tracking-wide text-slate-500">Terms & conditions</div>
        <div className="whitespace-pre-wrap">{company.documentTerms.replace('This quotation is not an invoice and does not request payment.', 'Please settle outstanding amounts by the due date.')}</div>
      </div>
      <div className="a4-avoid-break mt-10 flex gap-8">
        <SignatureBox label="Prepared by" />
        <SignatureBox label="Authorized by / Signature" />
      </div>
    </div>
  )
}

export function DeliveryA4({ state, order }: { state: AppState; order: DeliveryOrder }) {
  const customer = customerLines(state.customers.find((item) => item.id === order.customerId))
  return (
    <div>
      <CompanyHeader settings={state.settings} />
      <div className="mt-5 flex items-start justify-between gap-6">
        <div>
          <div className="text-2xl font-bold tracking-[0.18em] text-slate-900">DELIVERY ORDER</div>
          <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">Dispatch document — not a tax invoice</div>
        </div>
        <MetaGrid
          items={[
            { label: 'DO No', value: order.doNo },
            { label: 'DO date', value: dateLabel(order.date) },
            { label: 'Related invoice', value: order.invoiceNo || '—' },
            { label: 'Quotation', value: order.quotationNo || '—' },
            { label: 'Prepared by', value: order.preparedBy },
          ]}
        />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-6">
        <PartyBlock
          title="Customer"
          name={customer.name}
          lines={[customer.address, `Contact: ${order.contactPerson || customer.name}`, order.contactNumber || customer.phone]}
        />
        <div className="text-[11px] text-slate-700">
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Delivery information</div>
          <div className="mt-1 font-medium">Delivery address</div>
          <div className="text-[10px] text-slate-600">{order.deliveryAddress || customer.address}</div>
          {order.transport && <div className="mt-2 text-[10px]">Transport / logistics: {order.transport}</div>}
        </div>
      </div>
      <table className="a4-table mt-5">
        <thead>
          <tr>
            <th>No</th>
            <th>Product</th>
            <th>Description</th>
            <th>Quantity</th>
            <th>Unit</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((line, index) => (
            <tr key={`${line.productId}-${index}`}>
              <td>{index + 1}</td>
              <td>{state.products.find((item) => item.id === line.productId)?.sku ?? ''}</td>
              <td>{line.description}</td>
              <td className="tabular">{qty(line.qty)}</td>
              <td>{line.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {order.notes && (
        <div className="mt-4 text-[10px] text-slate-600">
          <div className="font-bold uppercase tracking-wide text-slate-500">Notes</div>
          <div className="whitespace-pre-wrap">{order.notes}</div>
        </div>
      )}
      <div className="a4-avoid-break mt-8 border border-slate-300 p-4">
        <div className="mb-3 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Receiving acknowledgement</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-6">
          <SignLine label="Received by" />
          <SignLine label="Driver / delivered by" />
          <SignLine label="IC / ID / company stamp" />
          <SignLine label="Signature" />
          <SignLine label="Date" />
          <SignLine label="Driver signature" />
        </div>
      </div>
      <div className="a4-avoid-break mt-8 flex gap-8">
        <SignatureBox label="Prepared by" />
        <SignatureBox label="Customer signature / stamp" />
      </div>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? 'font-bold text-slate-900' : 'tabular'}>{value}</span>
    </div>
  )
}

function SignLine({ label }: { label: string }) {
  return (
    <div>
      <div className="a4-sign" />
      <div className="text-[10px] text-slate-600">{label}</div>
    </div>
  )
}
