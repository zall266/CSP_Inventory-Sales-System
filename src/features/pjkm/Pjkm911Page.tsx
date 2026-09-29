import { Fragment, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { PJKM_911, PJKM_911_DETAILS, buildPjkm911, pjkm911DetailValue, pjkm911Widths, type Pjkm911Page as Page } from '@/features/pjkm/pjkm911'
import { hasPermission } from '@/features/settings/permissions'
import { useStore } from '@/store/hooks'
import { PROTOTYPE_TODAY, systemDateKey } from '@/utils/format'
import './pjkm911.css'

export function Pjkm911PreviewPage() {
  const state = useStore()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const month = params.get('month') || systemDateKey(PROTOTYPE_TODAY).slice(0, 7)
  const report = useMemo(
    () => buildPjkm911({ month, dispatches: state.dispatches ?? [], groups: state.inspectionGroups ?? [] }),
    [month, state.dispatches, state.inspectionGroups],
  )
  if (!hasPermission(state, 'receiving.view')) return <PermissionDenied title="PJKM Records" subtitle="You do not have permission to view receiving." />
  const filename = `MGT-09_REKOD-9.1.1_PEMERIKSAAN-KENDERAAN_${month}.pdf`
  return (
    <div className="pjkm911-root min-h-screen bg-slate-200">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">PJKM 9.1.1 preview</div>
          <div className="text-xs text-slate-500">BULAN : {report.bulan} · TAHUN : {report.tahun} · {report.blocks.length} inspection blocks · {filename}</div>
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
      <div className="overflow-x-auto py-6 print:overflow-visible print:py-0">
        {report.pages.map((page) => <Pjkm911Sheet key={page.page} page={page} />)}
      </div>
    </div>
  )
}

function Pjkm911Sheet({ page }: { page: Page }) {
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
              <div className="pjkm911-manual">{PJKM_911.subtopic}</div>
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
          <div className="pjkm911-period"><span>BULAN : {page.bulan}</span><span>TAHUN : {page.tahun}</span></div>
        </>
      ) : null}
      <table className="pjkm911-grid">
        <colgroup>
          <col style={{ width: percent(widths.tarikh) }} />
          <col style={{ width: percent(widths.butiran) }} />
          {page.columns.map((column) => <col key={column} style={{ width: percent(widths.courier) }} />)}
          <col style={{ width: percent(widths.total) }} />
        </colgroup>
        <thead>
          <tr>
            <th>TARIKH</th>
            <th>BUTIRAN</th>
            {page.columns.map((column) => <th key={column}>{column}</th>)}
            <th>TOTAL AWB</th>
          </tr>
        </thead>
        {page.blocks.map((block) => (
          <tbody key={block.id} className="pjkm911-block">
            {PJKM_911_DETAILS.map((detail, index) => (
              <tr key={detail.key}>
                {index === 0 ? <td className="pjkm911-bil" rowSpan={PJKM_911_DETAILS.length}>{block.bil}</td> : null}
                <td className="pjkm911-label">{detail.lines.map((line) => <Fragment key={line}>{line}{line !== detail.lines.at(-1) ? <br /> : null}</Fragment>)}</td>
                {page.columns.map((column) => <td key={column}>{pjkm911DetailValue(block, column, detail.key)}</td>)}
                {index === 0 ? <td className="pjkm911-total" rowSpan={PJKM_911_DETAILS.length}>{block.totalAwb}</td> : null}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </section>
  )
}
