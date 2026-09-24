import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, PageHeader, Select } from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { PJKM_511, buildPjkm511, type PjkmPage, type PjkmRow } from '@/features/pjkm/pjkm511'
import { hasPermission } from '@/features/settings/permissions'
import { useStore } from '@/store/hooks'
import { PROTOTYPE_TODAY, systemDateKey } from '@/utils/format'
import './pjkm.css'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function monthLabel(key: string) {
  const [year, month] = key.split('-')
  return `${MONTHS[Number(month) - 1]} ${year}`
}

function monthOptions(selected: string) {
  const keys = new Set<string>()
  const [year, month] = systemDateKey(PROTOTYPE_TODAY).split('-').map(Number)
  for (let i = 0; i < 18; i += 1) {
    const date = new Date(Date.UTC(year, month - 1 - i, 1))
    keys.add(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  keys.add(selected)
  return [...keys].sort().reverse()
}

function warningText(row: PjkmRow) {
  const parts = row.warnings.map((code) => (code === 'supplier' ? 'missing supplier' : code === 'batch' ? 'missing batch/expiry' : 'missing condition'))
  return `${row.receivingNo} · ${row.date} · ${row.product || 'Unknown material'}: ${parts.join(', ')}`
}

export function PjkmRecordsPage() {
  const state = useStore()
  const navigate = useNavigate()
  const [month, setMonth] = useState(systemDateKey(PROTOTYPE_TODAY).slice(0, 7))
  if (!hasPermission(state, 'receiving.view')) return <PermissionDenied title="PJKM Records" subtitle="You do not have permission to view receiving." />
  const report = buildPjkm511({
    month,
    receivings: state.receivings ?? [],
    suppliers: state.suppliers,
    products: state.products,
    warehouses: state.warehouses,
  })
  return (
    <div className="min-w-0 overflow-x-hidden">
      <PageHeader title="PJKM Records" subtitle="Generate the official monthly receiving record from confirmed receivings." />
      <Card className="max-w-xl p-5">
        <label className="block text-sm text-slate-600">
          Month
          <Select className="mt-1" value={month} onChange={(event) => setMonth(event.target.value)}>
            {monthOptions(month).map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}
          </Select>
        </label>
        <label className="mt-3 block text-sm text-slate-600">
          Record
          <Select className="mt-1" value="5.1.1" onChange={() => undefined}>
            <option value="5.1.1">5.1.1 — Penerimaan Bahan Mentah</option>
          </Select>
        </label>
        <p className="mt-4 text-sm text-slate-800">Receiving lines found: {report.rows.length}</p>
        {report.attention.length > 0 && (
          <div className="mt-3 text-sm text-amber-900">
            <p>{report.attention.length} line{report.attention.length === 1 ? '' : 's'} need attention</p>
            <ul className="mt-1 list-disc pl-5">
              {report.attention.slice(0, 8).map((row) => <li key={`${row.receivingId}-${row.product}-${row.notes}`}>{warningText(row)}</li>)}
            </ul>
          </div>
        )}
        <Button className="mt-4" onClick={() => navigate(`/pjkm/5.1.1?month=${month}`)}>Preview</Button>
      </Card>
    </div>
  )
}

export function Pjkm511PreviewPage() {
  const state = useStore()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const month = params.get('month') || systemDateKey(PROTOTYPE_TODAY).slice(0, 7)
  const report = useMemo(
    () => buildPjkm511({
      month,
      receivings: state.receivings ?? [],
      suppliers: state.suppliers,
      products: state.products,
      warehouses: state.warehouses,
    }),
    [month, state.products, state.receivings, state.suppliers, state.warehouses],
  )
  if (!hasPermission(state, 'receiving.view')) return <PermissionDenied title="PJKM Records" subtitle="You do not have permission to view receiving." />
  const filename = `MGT-05_REKOD-5.1.1_PENERIMAAN-BAHAN-MENTAH_${month}.pdf`
  return (
    <div className="pjkm-root min-h-screen bg-slate-200">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 bg-white px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">PJKM 5.1.1 preview</div>
          <div className="text-xs text-slate-500">{monthLabel(month)} · {report.rows.length} lines · {filename}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigate('/pjkm')}>Back</Button>
          <Button onClick={() => { document.title = filename; window.print() }}>Print / Save as PDF</Button>
        </div>
      </div>
      {report.attention.length > 0 && (
        <div className="no-print mx-auto mt-4 max-w-[8.5in] rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {report.attention.length} line{report.attention.length === 1 ? '' : 's'} need attention. Blank cells are not filled in.
        </div>
      )}
      <div className="py-6 print:py-0">
        {report.pages.map((page) => <PjkmSheet key={page.page} page={page} />)}
      </div>
    </div>
  )
}

function PjkmSheet({ page }: { page: PjkmPage }) {
  return (
    <section className="pjkm-sheet">
      <header className="pjkm-head">
        <div>
          <div className="pjkm-company">{PJKM_511.company}</div>
          <div className="pjkm-manual">{PJKM_511.manual}</div>
          <div className="pjkm-manual">{PJKM_511.control}</div>
        </div>
        <table className="pjkm-control">
          <tbody>
            <tr><th>No. Dokumen</th><td>{PJKM_511.documentNo}</td></tr>
            <tr><th>Tarikh Berkuatkuasa</th><td>{PJKM_511.effectiveDate}</td></tr>
            <tr><th>Versi</th><td>{PJKM_511.version}</td></tr>
            <tr><th>Muka Surat</th><td>{page.label}</td></tr>
          </tbody>
        </table>
      </header>
      <div className="pjkm-sub">{PJKM_511.subtopic}</div>
      <div className="pjkm-title">{PJKM_511.title}</div>
      <table className="pjkm-grid">
        <thead>
          <tr>
            <th>Tarikh Terima</th>
            <th>Nama Pembekal</th>
            <th>Nama Bahan Mentah</th>
            <th>Batch Number/ Expiry Date</th>
            <th>Kuantiti Diterima</th>
            <th>Keadaan Bahan Mentah</th>
            <th>Catatan</th>
            <th>Disediakan oleh</th>
            <th>Disahkan Oleh</th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row, index) => (
            <tr key={`${row.receivingId}-${index}`}>
              <td>{row.date}</td>
              <td>{row.supplier}</td>
              <td>{row.product}</td>
              <td className="pjkm-pre">{row.batchCell}</td>
              <td>{row.qtyText}</td>
              <td>{row.condition}</td>
              <td>{row.notes}</td>
              <td>{row.preparedBy}</td>
              <td>{row.verifiedBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
