import { formatMoney } from '@/utils/format'
import { formatQuoteDate, formatQuoteDay } from './calc'
import type { QuoteCustomer, QuoteSettings, Quotation } from './types'

export function QuotationA4({
  quotation,
  customer,
  settings,
}: {
  quotation: Quotation
  customer?: QuoteCustomer
  settings: QuoteSettings
}) {
  return (
    <div className="quote-a4">
      <header className="quote-a4-header">
        {settings.logoDataUrl ? (
          <img src={settings.logoDataUrl} alt="" className="quote-a4-logo" />
        ) : null}
        <div>
          <div className="quote-a4-company">
            {settings.companyName}
            {settings.registrationNo ? ` (${settings.registrationNo})` : ''}
          </div>
          <div className="quote-a4-muted">{settings.address}</div>
          <div className="quote-a4-muted">
            Mobile: {settings.phone}
            {settings.website ? ` , ${settings.website}` : ''}
            {settings.email ? ` · ${settings.email}` : ''}
          </div>
        </div>
      </header>

      <h1 className="quote-a4-title">Quotation</h1>

      <div className="quote-a4-meta">
        <div>
          <div>
            <span className="quote-a4-label">Quotation No.</span> {quotation.quotationNo}
          </div>
          {quotation.reference ? (
            <div>
              <span className="quote-a4-label">Reference</span> {quotation.reference}
            </div>
          ) : null}
          <div>
            <span className="quote-a4-label">Salesperson</span> {quotation.salesperson}
          </div>
        </div>
        <div className="text-right">
          <div>
            <span className="quote-a4-label">Date</span> {formatQuoteDate(quotation.date)}
          </div>
          <div>
            <span className="quote-a4-label">Valid Until</span> {formatQuoteDay(quotation.validUntil)}
          </div>
        </div>
      </div>

      <div className="quote-a4-customer">
        <div className="quote-a4-label">Customer</div>
        <div className="font-semibold">{customer?.company || customer?.name || '—'}</div>
        {customer?.address ? <div>{customer.address}</div> : null}
        {customer?.phone ? <div>Mobile: {customer.phone}</div> : null}
        {customer?.email ? <div>{customer.email}</div> : null}
      </div>

      <table className="quote-a4-table">
        <thead>
          <tr>
            <th>No</th>
            <th>Product</th>
            <th>Code</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Unit Price</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {quotation.items.map((item, index) => (
            <tr key={item.id}>
              <td>{index + 1}</td>
              <td>
                <div>{item.name}</div>
                {item.description && item.description !== item.name ? <div className="quote-a4-muted">{item.description}</div> : null}
              </td>
              <td>{item.code}</td>
              <td className="tabular">{item.qty.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</td>
              <td>{item.unit}</td>
              <td className="tabular">{formatMoney(item.unitPrice)}</td>
              <td className="tabular">{formatMoney(item.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="quote-a4-totals">
        <Row label="Subtotal" value={formatMoney(quotation.subtotal)} />
        <Row label="Shipping Charges" value={formatMoney(quotation.shipping)} />
        <Row label="Discount" value={`-${formatMoney(quotation.discount)}`} />
        <Row label="Tax" value={formatMoney(quotation.tax)} />
        <Row label="TOTAL" value={formatMoney(quotation.total)} strong />
      </div>

      <section className="quote-a4-block">
        <div className="quote-a4-label">Payment Information</div>
        <div>{quotation.paymentMethod || settings.paymentMethod}</div>
        <div>
          {settings.bankName}
          {settings.accountNumber ? `, Account No : ${settings.accountNumber}` : ''}
        </div>
        {settings.accountHolder ? <div>Account Holder: {settings.accountHolder}</div> : null}
        {settings.duitNowQrDataUrl ? <img src={settings.duitNowQrDataUrl} alt="DuitNow QR" className="quote-a4-qr" /> : null}
      </section>

      <BulletBlock title="Notes" text={quotation.notes || settings.defaultNotes} />
      {quotation.terms && quotation.terms.trim() !== (quotation.notes || '').trim() ? (
        <BulletBlock title="Terms & Conditions" text={quotation.terms} />
      ) : null}

      <footer className="quote-a4-footer">
        {settings.companyName}
        {settings.website ? ` · ${settings.website}` : ''}
      </footer>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? 'quote-a4-total-row strong' : 'quote-a4-total-row'}>
      <span>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  )
}

function BulletBlock({ title, text }: { title: string; text: string }) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return null
  return (
    <section className="quote-a4-block">
      <div className="quote-a4-label">{title}</div>
      {lines.map((line, index) => (
        <div key={`${title}-${index}`}>{`* ${line.replace(/^\*\s*/, '')}`}</div>
      ))}
    </section>
  )
}
