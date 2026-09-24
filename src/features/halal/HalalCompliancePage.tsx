import { useMemo, useState } from 'react'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { hasPermission } from '@/features/settings/permissions'
import {
  buildHalalRows,
  filterHalalRows,
  halalStatusLabel,
  halalStatusMark,
  halalSummary,
  validateHalalDocument,
  type HalalRow,
  type HalalStatus,
  type HalalStatusFilter,
} from '@/features/halal/halalModel'
import { getAttachmentObjectUrl } from '@/store/attachmentBlobs'
import { useApi, useStore } from '@/store/hooks'
import { Button, Card, Drawer, EmptyState, Field, Input, Modal, PageHeader, Select } from '@/components/ui'
import { formatDate } from '@/utils/format'

const FILTERS: Array<{ id: HalalStatusFilter; label: string }> = [
  { id: 'all', label: 'All Status' },
  { id: 'active', label: 'Active' },
  { id: 'expiring', label: 'Expiring Soon' },
  { id: 'expired', label: 'Expired' },
  { id: 'pending', label: 'Pending Verification' },
  { id: 'not_registered', label: 'Not Registered' },
]

type DrawerMode = 'closed' | 'register' | 'edit'

export function HalalCompliancePage() {
  const state = useStore()
  const api = useApi()
  const canView = hasPermission(state, 'halal.view')
  const canManage = hasPermission(state, 'halal.manage')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<HalalStatusFilter>('all')
  const [categoryId, setCategoryId] = useState('all')
  const [mode, setMode] = useState<DrawerMode>('closed')
  const [row, setRow] = useState<HalalRow | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [manufacturerId, setManufacturerId] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [manufacturerOpen, setManufacturerOpen] = useState(false)
  const [manufacturerName, setManufacturerName] = useState('')

  const rows = useMemo(() => buildHalalRows(state), [state])
  const summary = useMemo(() => halalSummary(rows), [rows])
  const visible = useMemo(() => filterHalalRows(rows, query, status, categoryId), [rows, query, status, categoryId])
  const categories = useMemo(() => {
    const used = new Set(rows.map((item) => item.categoryId).filter(Boolean))
    return state.categories.filter((category) => used.has(category.id))
  }, [rows, state.categories])
  const manufacturers = (state.manufacturers ?? []).filter((item) => item.active || item.id === manufacturerId)
  const certificates = state.halalCertificates ?? []

  if (!canView) return <PermissionDenied title="Halal Compliance" subtitle="You do not have permission to view Halal Compliance." />

  function openRegister(next: HalalRow) {
    setRow(next)
    setShowHistory(false)
    setManufacturerId('')
    setExpiryDate('')
    setFile(null)
    setFileError('')
    setMode('register')
  }

  function openEdit(next: HalalRow) {
    setRow(next)
    setShowHistory(false)
    setManufacturerId(next.manufacturerId ?? '')
    setExpiryDate(next.expiryDate ?? '')
    setFile(null)
    setFileError('')
    setMode('edit')
  }

  async function saveCompliance() {
    if (!row) return
    if (!file && !row.documentFileId) {
      setFileError('Upload the halal certificate.')
      return
    }
    if (!expiryDate) {
      setFileError('Expiry date is required.')
      return
    }
    const document = file ? { fileName: file.name, mimeType: file.type || 'application/octet-stream', blob: file } : null
    const saved = await api.saveHalalCompliance({
      complianceId: mode === 'edit' ? row.complianceId : undefined,
      productId: row.productId,
      manufacturerId,
      certificateNo: mode === 'edit' && !file && row.certificateNo !== '—' ? row.certificateNo : '',
      issuingAuthority: mode === 'edit' ? certificates.find((item) => item.id === row.certificateId)?.issuingAuthority ?? '' : '',
      issueDate: mode === 'edit' && !file ? row.issueDate : undefined,
      expiryDate,
      verificationStatus: 'verified',
      document,
    })
    if (!saved) return
    setMode('closed')
  }

  function saveManufacturer() {
    const saved = api.createManufacturer({ name: manufacturerName, active: true })
    if (!saved) return
    setManufacturerId(saved.id)
    setManufacturerOpen(false)
    setManufacturerName('')
  }

  async function viewDocument(fileId?: string) {
    if (!fileId) return
    const url = await getAttachmentObjectUrl(fileId)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  const compliance = row?.complianceId ? (state.halalCompliances ?? []).find((item) => item.id === row.complianceId) : undefined
  const historyIds = compliance ? [...compliance.previousCertificateIds].reverse() : []

  return (
    <div className="overflow-x-hidden">
      <PageHeader title="Halal Compliance" subtitle="Raw Material Halal Status & Certificate Monitoring" />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Active" value={summary.active} active={status === 'active'} onClick={() => setStatus('active')} />
        <SummaryCard label="Expiring Soon" value={summary.expiring} active={status === 'expiring'} onClick={() => setStatus('expiring')} />
        <SummaryCard label="Expired" value={summary.expired} active={status === 'expired'} onClick={() => setStatus('expired')} />
        <SummaryCard label="Not Registered" value={summary.notRegistered} active={status === 'not_registered'} onClick={() => setStatus('not_registered')} />
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Select className="sm:w-52" aria-label="Category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="all">All Categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </Select>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search material..."
          aria-label="Search material"
        />
        <Select className="sm:w-52" value={status} aria-label="Status" onChange={(event) => setStatus(event.target.value as HalalStatusFilter)}>
          {FILTERS.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </Select>
      </div>

      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState title="No matching records" />
        ) : (
          <>
            <div className="hidden sm:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Manufacturer</th>
                    <th className="px-4 py-3 font-medium">Certificate</th>
                    <th className="px-4 py-3 font-medium">Expiry</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.key} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{item.productName}</div>
                        {item.sku && <div className="text-xs text-slate-400">{item.sku}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{item.categoryName}</td>
                      <td className="px-4 py-3 text-slate-700">{item.manufacturerName}</td>
                      <td className="px-4 py-3">
                        {item.documentFileId ? (
                          <button type="button" className="text-indigo-600" onClick={() => void viewDocument(item.documentFileId)}>View Certificate</button>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{item.expiryDate ? formatDate(item.expiryDate) : '—'}</td>
                      <td className="px-4 py-3"><StatusText status={item.status} /></td>
                      <td className="px-4 py-3">
                        {item.status === 'not_registered' ? (
                          canManage ? <Button variant="secondary" onClick={() => openRegister(item)}>Register</Button> : '—'
                        ) : (
                          canManage ? <Button variant="secondary" onClick={() => openEdit(item)}>Edit</Button> : '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 p-3 sm:hidden">
              {visible.map((item) => (
                <div key={item.key} className="rounded-xl border border-slate-100 p-3">
                  <div className="font-medium text-slate-900">{item.productName}</div>
                  {item.sku && <div className="text-xs text-slate-400">{item.sku}</div>}
                  <div className="mt-2 text-sm text-slate-600">{item.categoryName}</div>
                  <div className="text-sm text-slate-600">{item.manufacturerName}</div>
                  <div className="text-sm text-slate-600">{item.expiryDate ? formatDate(item.expiryDate) : '—'}</div>
                  <div className="mt-2"><StatusText status={item.status} /></div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.documentFileId && (
                      <Button variant="secondary" onClick={() => void viewDocument(item.documentFileId)}>View Certificate</Button>
                    )}
                    {item.status === 'not_registered' ? (
                      canManage ? <Button variant="secondary" onClick={() => openRegister(item)}>Register</Button> : null
                    ) : (
                      canManage ? <Button variant="secondary" onClick={() => openEdit(item)}>Edit</Button> : null
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Drawer
        open={mode !== 'closed'}
        onClose={() => setMode('closed')}
        title={mode === 'edit' ? 'Edit Halal Compliance' : 'Register Halal Compliance'}
        subtitle={row?.productName}
      >
        {row && (
          <div className="space-y-4">
            <Field label="Product">
              <Input value={`${row.productName}${row.sku ? ` · ${row.sku}` : ''}`} readOnly />
            </Field>
            <Field label="Manufacturer / Factory">
              <Select aria-label="Manufacturer" value={manufacturerId} onChange={(event) => setManufacturerId(event.target.value)}>
                <option value="">Select Manufacturer</option>
                {manufacturers.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </Select>
            </Field>
            {canManage && <Button variant="secondary" onClick={() => setManufacturerOpen(true)}>+ Add Manufacturer</Button>}
            <Field label="Halal Certificate" hint={fileError || 'PDF, JPG, or PNG'}>
              <Input
                aria-label="Upload Certificate"
                type="file"
                accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null
                  const error = next ? validateHalalDocument(next) : ''
                  setFile(error ? null : next)
                  setFileError(error)
                }}
              />
            </Field>
            {(file || row.documentName) && (
              <div className="flex items-center gap-3 text-sm text-slate-700">
                <span>📄 {file?.name || row.documentName}</span>
                {row.documentFileId && !file && (
                  <button type="button" className="text-indigo-600" onClick={() => void viewDocument(row.documentFileId)}>View</button>
                )}
              </div>
            )}
            <Field label="Expiry Date">
              <Input aria-label="Expiry Date" type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} />
            </Field>
            {mode === 'edit' && (
              <Button variant="secondary" onClick={() => setShowHistory((value) => !value)}>View History</Button>
            )}
            {showHistory && (
              <div className="space-y-2 rounded-xl border border-slate-100 p-3 text-sm">
                {historyIds.length === 0 && <div className="text-slate-500">No earlier certificates.</div>}
                {historyIds.map((id) => {
                  const certificate = certificates.find((item) => item.id === id)
                  if (!certificate) return null
                  return (
                    <div key={id} className="border-b border-slate-50 pb-2 last:border-0">
                      <div className="font-medium">{certificate.documentName || 'Certificate'}</div>
                      <div className="text-slate-500">Expiry {formatDate(certificate.expiryDate)}</div>
                      <div className="text-slate-500">{certificate.verificationStatus === 'verified' ? `Verified${certificate.verifiedBy ? ` by ${certificate.verifiedBy}` : ''}` : 'Pending Verification'}</div>
                      {certificate.documentFileId && (
                        <button type="button" className="text-indigo-600" onClick={() => void viewDocument(certificate.documentFileId)}>View Certificate</button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setMode('closed')}>Cancel</Button>
              <Button onClick={() => void saveCompliance()} disabled={!canManage}>Save</Button>
            </div>
          </div>
        )}
      </Drawer>

      <Modal open={manufacturerOpen} onClose={() => setManufacturerOpen(false)} title="Add Manufacturer" layer="z-[80]">
        <div className="space-y-3">
          <Field label="Manufacturer Name">
            <Input value={manufacturerName} onChange={(event) => setManufacturerName(event.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setManufacturerOpen(false)}>Cancel</Button>
            <Button onClick={saveManufacturer}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function SummaryCard({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-left">
      <Card className={`p-4 ${active ? 'ring-2 ring-indigo-500' : ''}`}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      </Card>
    </button>
  )
}

function StatusText({ status }: { status: HalalStatus }) {
  return <span>{halalStatusMark(status)} {halalStatusLabel(status)}</span>
}
