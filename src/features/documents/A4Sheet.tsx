import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, PageHeader } from '@/components/ui'
import { companyProfile } from './documentModel'
import type { Settings } from '@/types'
import { cn } from '@/utils/format'

export function PermissionDenied({ title = 'Permission Denied', subtitle }: { title?: string; subtitle?: string }) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle ?? 'You do not have permission for this action.'} />
    </div>
  )
}

export function CompanyHeader({ settings }: { settings: Settings }) {
  const company = companyProfile(settings)
  const initials = company.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <div className="flex gap-4 border-b-2 border-slate-800 pb-3">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center bg-slate-800 text-sm font-bold tracking-wide text-white">
        {initials || 'CS'}
      </div>
      <div className="min-w-0">
        <div className="text-lg font-bold uppercase tracking-[0.08em] text-slate-900">{company.name}</div>
        {company.legalName && <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-600">{company.legalName}</div>}
        <div className="mt-1 text-[10px] leading-relaxed text-slate-600">
          {company.address}
          <br />
          Tel: {company.phone} · {company.email}
          {company.website ? ` · ${company.website}` : ''}
          {company.registrationNo ? (
            <>
              <br />
              Registration No: {company.registrationNo}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function MetaGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
      {items.map((item) => (
        <div key={item.label}>
          <span className="text-slate-500">{item.label}: </span>
          <span className="whitespace-nowrap font-medium text-slate-800">{item.value}</span>
        </div>
      ))}
    </div>
  )
}

export function PartyBlock({ title, name, lines }: { title: string; name: string; lines: string[] }) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">{title}</div>
      <div className="mt-1 text-[12px] font-semibold text-slate-900">{name}</div>
      {lines.filter(Boolean).map((line) => (
        <div key={line} className="text-[10px] text-slate-600">
          {line}
        </div>
      ))}
    </div>
  )
}

export function SignatureBox({ label }: { label: string }) {
  return (
    <div className="a4-avoid-break min-w-[140px] flex-1">
      <div className="a4-sign" />
      <div className="text-[10px] font-medium text-slate-700">{label}</div>
    </div>
  )
}

export function PrintShell({
  filename,
  backTo,
  canPrint,
  onPrint,
  denied,
  children,
}: {
  filename: string
  backTo: string
  canPrint: boolean
  onPrint: () => boolean | void
  denied?: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  useEffect(() => {
    const previous = document.title
    document.title = filename
    document.documentElement.classList.toggle('print-blocked', !canPrint)
    return () => {
      document.title = previous
      document.documentElement.classList.remove('print-blocked')
    }
  }, [filename, canPrint])

  const print = () => {
    const ok = onPrint()
    if (ok === false) return
    window.print()
  }

  if (denied) return <PermissionDenied subtitle={denied} />

  return (
    <div className="min-h-screen bg-slate-200 print:bg-white">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 bg-white px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">A4 preview</div>
          <div className="text-xs text-slate-500">{filename} · Print or Save as PDF from the browser dialog</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigate(backTo)}>
            Back
          </Button>
          {canPrint ? (
            <Button onClick={print}>Print / Save as PDF</Button>
          ) : (
            <Button disabled>Print permission required</Button>
          )}
        </div>
      </div>
      <div className={cn('a4-page mx-auto my-6 shadow-xl print:mx-0 print:my-0 print:shadow-none')}>{children}</div>
    </div>
  )
}
