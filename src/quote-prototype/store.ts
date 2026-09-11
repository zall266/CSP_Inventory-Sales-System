import { useSyncExternalStore } from 'react'
import { PROTOTYPE_TODAY, round2, uid } from '@/utils/format'
import { addDaysIso, lineSubtotal, nextQuotationNo, quotationTotals } from './calc'
import { createSeedState } from './seed'
import type { QuoteCustomer, QuoteProduct, QuoteSettings, QuoteState, QuoteStatus, QuoteToast, Quotation } from './types'

const STORAGE_KEY = 'csp-quotation-prototype-v1'

function clone<T>(value: T): T {
  return structuredClone(value)
}

function load(): QuoteState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createSeedState()
    const parsed = JSON.parse(raw) as QuoteState
    if (!parsed?.quotations || !parsed?.customers || !parsed?.products || !parsed?.settings) return createSeedState()
    return parsed
  } catch {
    return createSeedState()
  }
}

let state = load()
let toasts: QuoteToast[] = []
const listeners = new Set<() => void>()

function emit() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
  listeners.forEach((listener) => listener())
}

function snapshot() {
  return { state, toasts }
}

export function subscribeQuote(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getQuoteSnapshot() {
  return snapshot()
}

export function useQuoteStore() {
  return useSyncExternalStore(subscribeQuote, getQuoteSnapshot, getQuoteSnapshot)
}

function toast(title: string, description?: string) {
  const item = { id: uid('qtst'), title, description }
  toasts = [item, ...toasts].slice(0, 4)
  emit()
  window.setTimeout(() => {
    toasts = toasts.filter((row) => row.id !== item.id)
    listeners.forEach((listener) => listener())
  }, 3200)
}

function nowIso() {
  return PROTOTYPE_TODAY.toISOString()
}

export const quoteApi = {
  toast,
  dismissToast(id: string) {
    toasts = toasts.filter((row) => row.id !== id)
    listeners.forEach((listener) => listener())
  },
  reset() {
    state = createSeedState()
    emit()
    toast('Prototype reset', 'Sample quotations, customers and products restored.')
  },
  updateSettings(patch: Partial<QuoteSettings>) {
    state = { ...state, settings: { ...state.settings, ...patch } }
    emit()
  },
  saveCustomer(input: Omit<QuoteCustomer, 'id'> & { id?: string }) {
    if (input.id) {
      state = { ...state, customers: state.customers.map((item) => (item.id === input.id ? { ...item, ...input, id: input.id } : item)) }
      emit()
      toast('Customer updated', input.name)
      return input.id
    }
    const customer: QuoteCustomer = { ...input, id: uid('qc') }
    state = { ...state, customers: [customer, ...state.customers] }
    emit()
    toast('Customer added', customer.name)
    return customer.id
  },
  deleteCustomer(id: string) {
    if (state.quotations.some((row) => row.customerId === id)) {
      toast('Cannot delete', 'This customer has quotations.')
      return false
    }
    state = { ...state, customers: state.customers.filter((item) => item.id !== id) }
    emit()
    toast('Customer deleted')
    return true
  },
  saveProduct(input: Omit<QuoteProduct, 'id'> & { id?: string }) {
    if (input.id) {
      state = { ...state, products: state.products.map((item) => (item.id === input.id ? { ...item, ...input, id: input.id } : item)) }
      emit()
      toast('Product updated', input.name)
      return input.id
    }
    const product: QuoteProduct = { ...input, id: uid('qp') }
    state = { ...state, products: [product, ...state.products] }
    emit()
    toast('Product added', product.name)
    return product.id
  },
  deleteProduct(id: string) {
    state = { ...state, products: state.products.filter((item) => item.id !== id) }
    emit()
    toast('Product deleted')
    return true
  },
  saveQuotation(input: Omit<Quotation, 'id' | 'quotationNo' | 'subtotal' | 'total'> & { id?: string; quotationNo?: string }) {
    const items = input.items
      .filter((item) => item.qty > 0)
      .map((item) => ({ ...item, subtotal: lineSubtotal(item.qty, item.unitPrice, item.discount) }))
    if (!items.length) {
      toast('Add at least one product')
      return null
    }
    if (!input.customerId) {
      toast('Select a customer')
      return null
    }
    const totals = quotationTotals(items, input.shipping, input.discount, input.tax)
    if (input.id) {
      const current = state.quotations.find((row) => row.id === input.id)
      if (!current) return null
      const next: Quotation = { ...current, ...input, items, ...totals, id: current.id, quotationNo: current.quotationNo }
      state = { ...state, quotations: state.quotations.map((row) => (row.id === input.id ? next : row)) }
      emit()
      toast('Quotation saved', next.quotationNo)
      return next
    }
    const quotationNo = nextQuotationNo(
      state.quotations.map((row) => row.quotationNo),
      state.settings.quotationPrefix,
      state.settings.nextNumber,
    )
    const created: Quotation = {
      ...input,
      id: uid('qtn'),
      quotationNo,
      items,
      ...totals,
    }
    state = {
      ...state,
      quotations: [created, ...state.quotations],
      settings: { ...state.settings, nextNumber: Number(quotationNo.split('/')[1]) + 1 },
    }
    emit()
    toast('Quotation saved', created.quotationNo)
    return created
  },
  setStatus(id: string, status: QuoteStatus) {
    state = { ...state, quotations: state.quotations.map((row) => (row.id === id ? { ...row, status } : row)) }
    emit()
    toast('Status updated', status)
  },
  duplicate(id: string) {
    const current = state.quotations.find((row) => row.id === id)
    if (!current) return null
    const { id: _ignored, quotationNo: _no, ...rest } = clone(current)
    const date = nowIso()
    return this.saveQuotation({
      ...rest,
      date,
      validUntil: addDaysIso(date, state.settings.validityDays),
      status: 'draft',
    })
  },
  deleteQuotation(id: string) {
    state = { ...state, quotations: state.quotations.filter((row) => row.id !== id) }
    emit()
    toast('Quotation deleted')
  },
}

export function emptyLine(products: QuoteProduct[]) {
  const product = products.find((item) => item.status === 'active') ?? products[0]
  return {
    id: uid('ln'),
    productId: product?.id ?? '',
    name: product?.name ?? '',
    code: product?.code ?? '',
    description: product?.description ?? '',
    qty: 1,
    unit: product?.unit ?? 'PCS',
    unitPrice: product?.sellingPrice ?? 0,
    discount: 0,
    subtotal: round2(product?.sellingPrice ?? 0),
  }
}
