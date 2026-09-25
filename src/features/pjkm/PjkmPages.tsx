import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, PageHeader, Select } from '@/components/ui'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { PJKM_511, buildPjkm511, type PjkmPage, type PjkmRow } from '@/features/pjkm/pjkm511'
import { PJKM_1011, buildPjkm1011, pjkm1011QtyText, type Pjkm1011Page } from '@/features/pjkm/pjkm1011'
import { hasPermission } from '@/features/settings/permissions'
import { useStore } from '@/store/hooks'
import { PROTOTYPE_TODAY, systemDateKey } from '@/utils/format'
import './pjkm.css'
import './pjkm1011.css'

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
  const [record, setRecord] = useState('5.1.1')
  if (!hasPermission(state, 'receiving.view')) return <PermissionDenied title="PJKM Records" subtitle="You do not have permission to view receiving." />
  const receiving = buildPjkm511({
    month,
    receivings: state.receivings ?? [],
    suppliers: state.suppliers,
    products: state.products,
    warehouses: state.warehouses,
  })
  const distributor = buildPjkm1011({
    month,
    movements: state.stockMovements,
    sales: state.sales,
    products: state.products,
    warehouses: state.warehouses,
    sessions: state.productionSessions ?? [],
  })
  const previewPath = record === '10.1.1' ? `/pjkm/10.1.1?month=${month}` : `/pjkm/5.1.1?month=${month}`
  return (
    <div className="min-w-0 overflow-x-hidden">
      <PageHeader title="PJKM Records" subtitle="Generate the official monthly compliance records from confirmed transactions." />
      <Card className="max-w-xl p-5">
        <label className="block text-sm text-slate-600">
          Month
          <Select className="mt-1" value={month} onChange={(event) => setMonth(event.target.value)}>
            {monthOptions(month).map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}
          </Select>
        </label>
        <label className="mt-3 block text-sm text-slate-600">
          Record
          <Select className="mt-1" value={record} onChange={(event) => setRecord(event.target.value)}>
            <option value="5.1.1">5.1.1 — Penerimaan Bahan Mentah</option>
            <option value="10.1.1">10.1.1 — Pengedar / Penjual</option>
          </Select>
        </label>
        {record === '10.1.1' ? (
          <p className="mt-4 text-sm text-slate-800">Movement lines found: {distributor.rows.length}</p>
        ) : (
          <p className="mt-4 text-sm text-slate-800">Receiving lines found: {receiving.rows.length}</p>
        )}
        {record !== '10.1.1' && receiving.attention.length > 0 && (
          <div className="mt-3 text-sm text-amber-900">
            <p>{receiving.attention.length} line{receiving.attention.length === 1 ? '' : 's'} need attention</p>
            <ul className="mt-1 list-disc pl-5">
              {receiving.attention.slice(0, 8).map((row) => <li key={`${row.receivingId}-${row.product}-${row.notes}`}>{warningText(row)}</li>)}
            </ul>
          </div>
        )}
        {record === '10.1.1' && distributor.attention.length > 0 && (
          <p className="mt-3 text-sm text-amber-900">Some fields require manual review.</p>
        )}
        <Button className="mt-4" onClick={() => navigate(previewPath)}>Preview</Button>
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

export function Pjkm1011PreviewPage() {
  const state = useStore()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const month = params.get('month') || systemDateKey(PROTOTYPE_TODAY).slice(0, 7)
  const report = useMemo(
    () => buildPjkm1011({
      month,
      movements: state.stockMovements,
      sales: state.sales,
      products: state.products,
      warehouses: state.warehouses,
      sessions: state.productionSessions ?? [],
    }),
    [month, state.products, state.productionSessions, state.sales, state.stockMovements, state.warehouses],
  )
  if (!hasPermission(state, 'receiving.view')) return <PermissionDenied title="PJKM Records" subtitle="You do not have permission to view receiving." />
  const filename = `MGT-10_REKOD-10.1.1_PENGEDAR-PENJUAL_${month}.pdf`
  return (
    <div className="pjkm1011-root min-h-screen bg-slate-200">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">PJKM 10.1.1 preview</div>
          <div className="text-xs text-slate-500">{monthLabel(month)} · {report.rows.length} lines · {filename}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigate('/pjkm')}>Back</Button>
          <Button onClick={() => { document.title = filename; window.print() }}>Print / Save as PDF</Button>
        </div>
      </div>
      {report.attention.length > 0 && (
        <div className="no-print mx-auto mt-4 max-w-[297mm] rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Some fields require manual review. Blank cells are not filled in.
        </div>
      )}
      <div className="overflow-x-auto py-6 print:py-0">
        {report.pages.map((page) => <Pjkm1011Sheet key={page.page} page={page} monthLabel={report.monthLabel} />)}
      </div>
    </div>
  )
}

function Pjkm1011Sheet({ page, monthLabel: period }: { page: Pjkm1011Page; monthLabel: string }) {
  return (
    <section className="pjkm1011-sheet">
      <div className="pjkm1011-head">
        <div>
          <div className="pjkm1011-company">{PJKM_1011.company}</div>
          <div className="pjkm1011-manual">{PJKM_1011.manual}</div>
          <div className="pjkm1011-manual">{PJKM_1011.control}</div>
        </div>
        <table className="pjkm1011-control">
          <tbody>
            <tr><th>No. Dokumen</th><td>{PJKM_1011.documentNo}</td></tr>
            <tr><th>Tarikh Berkuatkuasa</th><td>{PJKM_1011.effectiveDate}</td></tr>
            <tr><th>Versi</th><td>{PJKM_1011.version}</td></tr>
            <tr><th>Muka Surat</th><td>{page.label}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="pjkm1011-sub">{PJKM_1011.subtopic}</div>
      <div className="pjkm1011-title">{PJKM_1011.title}</div>
      <div className="pjkm1011-month">{period}</div>
      <table className="pjkm1011-grid">
        <thead>
          <tr>
            <th>Bil</th>
            <th>Nama Produk</th>
            <th>Tarikh Buat</th>
            <th>Tarikh Luput</th>
            <th>Kuantiti (Masuk)</th>
            <th>Tempat Simpan</th>
            <th>Pengedar / Penjual</th>
            <th>Tarikh edar/jual</th>
            <th>Kuantiti (Keluar)</th>
            <th>Batch No</th>
            <th>Baki</th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row) => (
            <tr key={row.key}>
              <td>{row.bil}</td>
              <td>{row.product}</td>
              <td>{row.tarikhBuat}</td>
              <td>{row.tarikhLuput}</td>
              <td>{pjkm1011QtyText(row.qtyIn)}</td>
              <td>{row.tempatSimpan}</td>
              <td>{row.seller}</td>
              <td>{row.tarikhEdar}</td>
              <td>{pjkm1011QtyText(row.qtyOut)}</td>
              <td>{row.batchNo}</td>
              <td>{pjkm1011QtyText(row.baki)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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
