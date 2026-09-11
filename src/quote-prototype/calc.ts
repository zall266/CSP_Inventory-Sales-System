import { round2 } from '@/utils/format'
import type { QuoteLine } from './types'

export function lineSubtotal(qty: number, unitPrice: number, discount = 0) {
  return round2(Math.max(0, qty * unitPrice - discount))
}

export function quotationTotals(items: QuoteLine[], shipping = 0, discount = 0, tax = 0) {
  const subtotal = round2(items.reduce((sum, item) => sum + item.subtotal, 0))
  const total = round2(Math.max(0, subtotal + shipping - discount + tax))
  return { subtotal, shipping: round2(shipping), discount: round2(discount), tax: round2(tax), total }
}

export function nextQuotationNo(existing: string[], prefix: string, nextNumber: number) {
  const yearPrefix = `${prefix}/`
  let max = nextNumber - 1
  for (const value of existing) {
    if (!value.startsWith(yearPrefix)) continue
    const n = Number(value.slice(yearPrefix.length))
    if (!Number.isNaN(n)) max = Math.max(max, n)
  }
  return `${yearPrefix}${String(max + 1).padStart(4, '0')}`
}

export function addDaysIso(iso: string, days: number) {
  const date = new Date(iso)
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

export function formatQuoteDate(iso: string) {
  const date = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('day')}/${pick('month')}/${pick('year')} ${pick('hour')}:${pick('minute')} ${pick('dayPeriod')}`
}

export function formatQuoteDay(iso: string) {
  const date = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('day')}/${pick('month')}/${pick('year')}`
}
