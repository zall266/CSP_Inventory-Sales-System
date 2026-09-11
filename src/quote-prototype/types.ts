export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'

export type QuoteCustomer = {
  id: string
  name: string
  company: string
  address: string
  phone: string
  email: string
}

export type QuoteProduct = {
  id: string
  name: string
  code: string
  description: string
  unit: string
  sellingPrice: number
  taxRate: number
  status: 'active' | 'inactive'
}

export type QuoteLine = {
  id: string
  productId: string
  name: string
  code: string
  description: string
  qty: number
  unit: string
  unitPrice: number
  discount: number
  subtotal: number
}

export type Quotation = {
  id: string
  quotationNo: string
  date: string
  validUntil: string
  reference: string
  salesperson: string
  customerId: string
  items: QuoteLine[]
  subtotal: number
  shipping: number
  discount: number
  tax: number
  total: number
  paymentMethod: string
  notes: string
  terms: string
  status: QuoteStatus
}

export type QuoteSettings = {
  companyName: string
  registrationNo: string
  address: string
  phone: string
  email: string
  website: string
  logoDataUrl: string
  quotationPrefix: string
  nextNumber: number
  validityDays: number
  paymentMethod: string
  bankName: string
  accountHolder: string
  accountNumber: string
  duitNowQrDataUrl: string
  defaultNotes: string
  defaultTerms: string
}

export type QuoteState = {
  settings: QuoteSettings
  customers: QuoteCustomer[]
  products: QuoteProduct[]
  quotations: Quotation[]
}

export type QuoteToast = { id: string; title: string; description?: string }
