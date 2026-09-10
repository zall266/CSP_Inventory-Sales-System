import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const PROTOTYPE_TODAY = new Date('2026-09-10T12:00:00+08:00')

export function round2(n: number) {
  return Math.round(n * 100) / 100
}

export function formatMoney(value: number, options?: { compact?: boolean }) {
  const compact = options?.compact ?? false
  const abs = Math.abs(value)
  const formatted = abs.toLocaleString('en-MY', {
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
  })
  const sign = value < 0 ? '-' : ''
  return `${sign}RM ${formatted}`
}

export function formatQty(value: number) {
  if (Number.isInteger(value)) return value.toLocaleString('en-MY')
  return value.toLocaleString('en-MY', { maximumFractionDigits: 2 })
}

export function formatDate(iso: string, options?: { short?: boolean }) {
  const d = new Date(iso)
  const opts: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    timeZone: 'Asia/Kuala_Lumpur',
  }
  if (!options?.short) opts.year = 'numeric'
  return d.toLocaleDateString('en-GB', opts)
}

export function formatDateTime(iso: string) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kuala_Lumpur',
  })
  return `${formatDate(iso)} · ${time}`
}

export function toIsoDate(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function inRange(iso: string, from: Date, to: Date) {
  const t = new Date(iso).getTime()
  return t >= from.getTime() && t <= to.getTime()
}

export function greeting(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Asia/Kuala_Lumpur',
    }).format(now),
  )
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`
}

export function nextDocNo(existing: string[], prefix: string, pad = 6) {
  let max = 0
  for (const value of existing) {
    const match = value.match(/(\d+)\s*$/)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `${prefix}${String(max + 1).padStart(pad, '0')}`
}

export function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? '')
          return `"${value.replaceAll('"', '""')}"`
        })
        .join(','),
    )
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function stockStatus(qty: number, reorderLevel: number): 'in_stock' | 'low_stock' | 'out_of_stock' {
  if (qty <= 0) return 'out_of_stock'
  if (qty <= reorderLevel) return 'low_stock'
  return 'in_stock'
}

export function printPage() {
  window.print()
}
