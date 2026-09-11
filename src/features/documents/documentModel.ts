import type { AppState, Customer, DocumentLine, Sale, Settings } from '@/types'
import { addDays, formatDate, formatMoney, formatQty, PROTOTYPE_TODAY, round2 } from '@/utils/format'
import { demoBusiness } from '@/brand'

export const DEFAULT_DOCUMENT_TERMS =
  '1. Prices are in Malaysian Ringgit (RM).\n2. Goods remain the property of the seller until paid in full.\n3. Please quote this document number in all correspondence.\n4. This quotation is not an invoice and does not request payment.'

export function companyProfile(settings: Settings) {
  return {
    name: settings.businessName || demoBusiness.name,
    legalName: settings.legalName || demoBusiness.legalName,
    address: settings.address || 'Address not set',
    phone: settings.phone || '—',
    email: settings.email || '—',
    website: settings.website,
    registrationNo: settings.registrationNo,
    bankName: settings.bankName,
    bankAccount: settings.bankAccount,
    paymentTerms: settings.paymentTerms || 'Net 7 days',
    documentTerms: settings.documentTerms || DEFAULT_DOCUMENT_TERMS,
  }
}

export function customerLines(customer: Customer | undefined) {
  return {
    name: customer?.name ?? '—',
    address: customer?.address || '—',
    phone: customer?.phone && customer.phone !== '-' ? customer.phone : '—',
    email: customer?.email || '—',
  }
}

export function lineAmount(qty: number, price: number, discount = 0) {
  return round2(Math.max(0, qty * price - discount))
}

export function totalsFromLines(items: Array<{ total: number }>, extraDiscount = 0, tax = 0) {
  const subtotal = round2(items.reduce((sum, item) => sum + item.total, 0))
  const discount = round2(extraDiscount)
  const total = round2(Math.max(0, subtotal - discount + tax))
  return { subtotal, discount, tax, total }
}

export function buildDocumentLines(
  state: AppState,
  items: Array<{ productId: string; description?: string; qty: number; unit?: string; price: number; discount?: number }>,
): DocumentLine[] {
  return items
    .filter((item) => item.qty > 0 && item.productId)
    .map((item) => {
      const product = state.products.find((row) => row.id === item.productId)
      const discount = item.discount ?? 0
      return {
        productId: item.productId,
        description: item.description?.trim() || product?.name || 'Item',
        qty: item.qty,
        unit: item.unit || product?.unit || 'pcs',
        price: item.price,
        discount,
        total: lineAmount(item.qty, item.price, discount),
      }
    })
}

export function invoiceDisplayStatus(sale: Sale) {
  if (sale.status === 'voided') return 'cancelled'
  if (sale.status === 'returned') return 'returned'
  if (sale.status === 'paid') return 'paid'
  if (sale.balance > 0 && sale.dueDate && new Date(sale.dueDate) < PROTOTYPE_TODAY) return 'overdue'
  if (sale.status === 'partial') return 'partial'
  return 'issued'
}

export function defaultDueDate(fromIso = PROTOTYPE_TODAY.toISOString(), days = 7) {
  return addDays(new Date(fromIso), days).toISOString()
}

export function pdfFilename(docNo: string, customerName: string) {
  const party = customerName.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Customer'
  return `${docNo} - ${party}`
}

export function money(value: number) {
  return formatMoney(value)
}

export function qty(value: number) {
  return formatQty(value)
}

export function dateLabel(iso: string) {
  return formatDate(iso)
}
