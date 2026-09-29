import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { PJKM_911, buildPjkm911, pjkm911Widths, type Pjkm911Page as Page } from '@/features/pjkm/pjkm911'
import { hasPermission } from '@/features/settings/permissions'
import { useStore } from '@/store/hooks'
import { PROTOTYPE_TODAY, systemDateKey } from '@/utils/format'
import './pjkm911.css'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function monthLabel(key: string) {
  const [year, month] = key.split('-')
  return `${MONTHS[Number(month) - 1]} ${year}`
}

export function Pjkm911PreviewPage() {
  const state = useStore()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const month = params.get('month') || systemDateKey(PROTOTYPE_TODAY).slice(0, 7)
  const report = useMemo(
    () => buildPjkm911({ month, dispatches: state.dispatches ?? [] }),
    [month, state.dispatches],
  )
  if (!hasPermission(state, 'receiving.view')) return <PermissionDenied title="PJKM Records" subtitle="You do not have permission to view receiving." />
  const filename = `MGT-09_REKOD-9.1.1_PEMERIKSAAN-KENDERAAN_${month}.pdf`
  return (
    <div className="pjkm911-root min-h-screen bg-slate-200">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">PJKM 9.1.1 preview</div>
          <div className="text-xs text-slate-500">{monthLabel(month)} · {report.rows.length} handovers · {filename}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigate('/pjkm')}>Back</Button>
          <Button onClick={() => { document.title = filename; window.print() }}>Print / Save as PDF</Button>
        </div>
      </div>
      {report.unknown && (
        <div className="no-print mx-auto mt-4 max-w-[186mm] rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Some courier labels need review. UNKNOWN is shown only for this month.
        </div>
      )}
      <div className="overflow-x-auto py-6 print:py-0">
        {report.pages.map((page) => <Pjkm911Sheet key={page.page} page={page} monthLabel={`${monthLabel(month)}`} />)}
      </div>
    </div>
  )
}

function Pjkm911Sheet({ page, monthLabel: period }: { page: Page; monthLabel: string }) {
  const widths = pjkm911Widths(page.columns.length)
  const percent = (mm: number) => `${(mm / 186) * 100}%`
  const first = page.page === 1
  return (
    <section className="pjkm911-sheet">
      {first ? (
        <>
          <div className="pjkm911-head">
            <div>
              <div className="pjkm911-company">{PJKM_911.company}</div>
              <div className="pjkm911-manual">{PJKM_911.manual}</div>
              <div className="pjkm911-manual">{PJKM_911.control}</div>
            </div>
            <table className="pjkm911-control">
              <tbody>
                <tr><th>No. Dokumen</th><td>{PJKM_911.documentNo}</td></tr>
                <tr><th>Tarikh Berkuatkuasa</th><td>{PJKM_911.effectiveDate}</td></tr>
                <tr><th>Versi</th><td>{PJKM_911.version}</td></tr>
                <tr><th>Muka Surat</th><td>{page.label}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="pjkm911-title">{PJKM_911.title}</div>
          <div className="pjkm911-month">{period}</div>
        </>
      ) : (
        <div className="pjkm911-page">Muka Surat {page.label}</div>
      )}
      <table className="pjkm911-grid">
        <thead>
          <tr>
            <th style={{ width: percent(widths.tarikh) }}>Tarikh</th>
            {page.columns.map((column) => <th key={column} style={{ width: percent(widths.courier) }}>{column}</th>)}
            <th style={{ width: percent(widths.total) }}>TOTAL AWB</th>
            <th style={{ width: percent(widths.parcel) }}>QUANTITY PARCEL</th>
            <th style={{ width: percent(widths.jenis) }}>JENIS KENDERAAN</th>
            <th style={{ width: percent(widths.plate) }}>PLATE NUMBER</th>
            <th style={{ width: percent(widths.suhu) }}>SUHU<br />KENDERAAN</th>
            <th style={{ width: percent(widths.keadaan) }}>KEADAAN</th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row) => (
            <tr key={row.dispatchId}>
              <td>{row.dateLabel}</td>
              {page.columns.map((column) => <td key={column}>{row.counts[column] ?? ''}</td>)}
              <td>{row.totalAwb}</td>
              <td>{row.parcelQty}</td>
              <td>{row.vehicleType}</td>
              <td>{row.plateNumber}</td>
              <td></td>
              <td>{row.condition}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
