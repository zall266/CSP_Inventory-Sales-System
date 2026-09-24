import { useMemo, useState, type ReactNode } from 'react'
import { PermissionDenied } from '@/features/documents/A4Sheet'
import { hasPermission } from '@/features/settings/permissions'
import { receivableRawMaterials } from '@/features/receiving/receivingModel'
import {
  HALAL_AUTHORITIES,
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
import type { HalalVerificationStatus } from '@/types'
import { formatDate, formatDateTime } from '@/utils/format'

const FILTERS: Array<{ id: HalalStatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'expiring', label: 'Expiring Soon' },
  { id: 'expired', label: 'Expired' },
  { id: 'pending', label: 'Pending Verification' },
  { id: 'not_registered', label: 'Not Registered' },
]

type DrawerMode = 'closed' | 'register' | 'view' | 'edit'

const emptyForm = {
  productId: '',
  manufacturerId: '',
  certificateNo: '',
  issuingAuthority: 'JAKIM',
  issueDate: '',
  expiryDate: '',
  verificationStatus: 'pending' as HalalVerificationStatus,
  notes: '',
}

export function HalalCompliancePage() {
  const state = useStore()
  const api = useApi()
  const canView = hasPermission(state, 'halal.view')
  const canManage = hasPermission(state, 'halal.manage')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<HalalStatusFilter>('all')
  const [mode, setMode] = useState<DrawerMode>('closed')
  const [row, setRow] = useState<HalalRow | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [manufacturerOpen, setManufacturerOpen] = useState(false)
  const [manufacturerForm, setManufacturerForm] = useState({
    name: '',
    registrationNo: '',
    address: '',
    contact: '',
    notes: '',
    active: true,
  })

  const rows = useMemo(() => buildHalalRows(state), [state])
  const summary = useMemo(() => halalSummary(rows), [rows])
  const visible = useMemo(() => filterHalalRows(rows, query, status), [rows, query, status])
  const materials = useMemo(() => receivableRawMaterials(state), [state])
  const manufacturers = (state.manufacturers ?? []).filter((item) => item.active || item.id === form.manufacturerId)
  const certificates = state.halalCertificates ?? []

  if (!canView) return <PermissionDenied title="Halal Compliance" subtitle="You do not have permission to view Halal Compliance." />

  function openRegister(productId = '') {
    setRow(null)
    setShowHistory(false)
    setFile(null)
    setFileError('')
    setForm({ ...emptyForm, productId })
    setMode('register')
  }

  function openView(next: HalalRow) {
    setRow(next)
    setShowHistory(false)
    setMode('view')
  }

  function openEdit(next: HalalRow) {
    setRow(next)
    setShowHistory(false)
    setFile(null)
    setFileError('')
    setForm({
      productId: next.productId,
      manufacturerId: next.manufacturerId ?? '',
      certificateNo: next.certificateNo === '—' ? '' : next.certificateNo,
      issuingAuthority: certificates.find((item) => item.id === next.certificateId)?.issuingAuthority ?? 'JAKIM',
      issueDate: next.issueDate ?? '',
      expiryDate: next.expiryDate ?? '',
      verificationStatus: next.verificationStatus ?? 'pending',
      notes: next.notes ?? '',
    })
    setMode('edit')
  }

  async function saveCompliance() {
    const document = file ? { fileName: file.name, mimeType: file.type || 'application/octet-stream', blob: file } : null
    const saved = await api.saveHalalCompliance({
      complianceId: mode === 'edit' ? row?.complianceId : undefined,
      productId: form.productId,
      manufacturerId: form.manufacturerId,
      certificateNo: form.certificateNo,
      issuingAuthority: form.issuingAuthority,
      issueDate: form.issueDate,
      expiryDate: form.expiryDate,
      verificationStatus: form.verificationStatus,
      notes: form.notes,
      document,
    })
    if (!saved) return
    setMode('closed')
  }

  function saveManufacturer() {
    const saved = api.createManufacturer(manufacturerForm)
    if (!saved) return
    setForm((current) => ({ ...current, manufacturerId: saved.id }))
    setManufacturerOpen(false)
    setManufacturerForm({ name: '', registrationNo: '', address: '', contact: '', notes: '', active: true })
  }

  async function viewDocument(fileId?: string) {
    if (!fileId) return
    const url = await getAttachmentObjectUrl(fileId)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  const compliance = row?.complianceId ? (state.halalCompliances ?? []).find((item) => item.id === row.complianceId) : undefined
  const historyIds = compliance ? [...compliance.previousCertificateIds].reverse() : []
  const editing = mode === 'register' || mode === 'edit'
  const nothingStored = (state.halalCompliances ?? []).length === 0 && materials.length === 0

  return (
    <div className="overflow-x-hidden">
      <PageHeader
        title="Halal Compliance"
        subtitle="Raw Material Halal Status & Certificate Monitoring"
        actions={canManage ? <Button onClick={() => openRegister()}>+ Register Raw Material</Button> : undefined}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Active" value={summary.active} active={status === 'active'} onClick={() => setStatus('active')} />
        <SummaryCard label="Expiring Soon" value={summary.expiring} active={status === 'expiring'} onClick={() => setStatus('expiring')} />
        <SummaryCard label="Expired" value={summary.expired} active={status === 'expired'} onClick={() => setStatus('expired')} />
        <SummaryCard label="Not Registered" value={summary.notRegistered} active={status === 'not_registered'} onClick={() => setStatus('not_registered')} />
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search raw material, manufacturer or certificate..."
          aria-label="Search raw material, manufacturer or certificate"
        />
        <Select className="sm:w-56" value={status} aria-label="Status" onChange={(event) => setStatus(event.target.value as HalalStatusFilter)}>
          {FILTERS.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </Select>
      </div>

      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            title={nothingStored || (status === 'all' && !query) ? 'No halal compliance records yet.' : 'No matching records'}
            hint={canManage && (nothingStored || (status === 'all' && !query)) ? undefined : undefined}
          />
        ) : (
          <>
            <div className="hidden sm:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Raw Material</th>
                    <th className="px-4 py-3 font-medium">Manufacturer / Kilang</th>
                    <th className="px-4 py-3 font-medium">Halal Certificate</th>
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
                      <td className="px-4 py-3 text-slate-700">{item.manufacturerName}</td>
                      <td className="px-4 py-3 text-slate-700">{item.certificateNo}</td>
                      <td className="px-4 py-3 text-slate-700">{item.expiryDate ? formatDate(item.expiryDate) : '—'}</td>
                      <td className="px-4 py-3"><StatusText status={item.status} /></td>
                      <td className="px-4 py-3">
                        {item.status === 'not_registered' ? (
                          canManage ? <Button variant="secondary" onClick={() => openRegister(item.productId)}>Register</Button> : '—'
                        ) : (
                          <Button variant="secondary" onClick={() => openView(item)}>View / Edit</Button>
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
                  <div className="mt-2 text-sm text-slate-600">{item.manufacturerName}</div>
                  <div className="text-sm text-slate-600">{item.certificateNo}</div>
                  <div className="text-sm text-slate-600">{item.expiryDate ? formatDate(item.expiryDate) : '—'}</div>
                  <div className="mt-2"><StatusText status={item.status} /></div>
                  <div className="mt-3">
                    {item.status === 'not_registered' ? (
                      canManage ? <Button variant="secondary" onClick={() => openRegister(item.productId)}>Register</Button> : null
                    ) : (
                      <Button variant="secondary" onClick={() => openView(item)}>View / Edit</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {visible.length === 0 && canManage && (nothingStored || (status === 'all' && !query)) && (
          <div className="pb-8 text-center">
            <Button onClick={() => openRegister()}>+ Register Raw Material</Button>
          </div>
        )}
      </Card>

      <Drawer
        open={mode !== 'closed'}
        onClose={() => setMode('closed')}
        title={editing ? (mode === 'edit' ? 'Edit Halal Compliance' : 'Register Halal Compliance') : 'Halal Compliance'}
        subtitle={mode === 'view' ? row?.productName : undefined}
      >
        {mode === 'view' && row && (
          <div className="space-y-4 text-sm">
            <Detail label="Raw Material" value={`${row.productName}${row.sku ? ` · ${row.sku}` : ''}`} />
            <Detail label="Manufacturer" value={row.manufacturerName} />
            <Detail label="Halal Certificate" value={row.certificateNo} />
            <Detail label="Issue Date" value={row.issueDate ? formatDate(row.issueDate) : '—'} />
            <Detail label="Expiry Date" value={row.expiryDate ? formatDate(row.expiryDate) : '—'} />
            <Detail label="Status" value={<StatusText status={row.status} />} />
            <Detail
              label="Verification"
              value={row.verificationStatus === 'verified'
                ? `Verified${row.verifiedBy ? ` · By: ${row.verifiedBy}` : ''}${row.verifiedAt ? ` · ${formatDateTime(row.verifiedAt)}` : ''}`
                : 'Pending Verification'}
            />
            <Detail
              label="Certificate"
              value={row.documentFileId ? (
                <button type="button" className="text-indigo-600" onClick={() => void viewDocument(row.documentFileId)}>View Document</button>
              ) : '—'}
            />
            <Detail label="Notes" value={row.notes || '—'} />
            <div className="flex flex-wrap gap-2 pt-2">
              {canManage && <Button onClick={() => openEdit(row)}>Edit</Button>}
              <Button variant="secondary" onClick={() => setShowHistory((value) => !value)}>View History</Button>
            </div>
            {showHistory && (
              <div className="space-y-2 rounded-xl border border-slate-100 p-3">
                {historyIds.length === 0 && <div className="text-slate-500">No earlier certificates.</div>}
                {historyIds.map((id) => {
                  const certificate = certificates.find((item) => item.id === id)
                  if (!certificate) return null
                  return (
                    <div key={id} className="border-b border-slate-50 pb-2 last:border-0">
                      <div className="font-medium">{certificate.certificateNo}</div>
                      <div className="text-slate-500">Issue {certificate.issueDate ? formatDate(certificate.issueDate) : '—'}</div>
                      <div className="text-slate-500">Expiry {formatDate(certificate.expiryDate)}</div>
                      <div className="text-slate-500">{certificate.verificationStatus === 'verified' ? `Verified${certificate.verifiedBy ? ` by ${certificate.verifiedBy}` : ''}` : 'Pending Verification'}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {editing && (
          <div className="space-y-4">
            <Field label="Raw Material">
              <Select value={form.productId} disabled={mode === 'edit'} onChange={(event) => setForm({ ...form, productId: event.target.value })}>
                <option value="">Select Product</option>
                {materials.map((product) => (
                  <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>
                ))}
              </Select>
            </Field>
            <Field label="Manufacturer / Kilang">
              <Select value={form.manufacturerId} onChange={(event) => setForm({ ...form, manufacturerId: event.target.value })}>
                <option value="">Select Manufacturer</option>
                {manufacturers.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </Select>
            </Field>
            {canManage && (
              <Button variant="secondary" onClick={() => setManufacturerOpen(true)}>+ Add Manufacturer</Button>
            )}
            <Field label="Certificate No.">
              <Input value={form.certificateNo} onChange={(event) => setForm({ ...form, certificateNo: event.target.value })} />
            </Field>
            <Field label="Issuing Authority">
              <Select value={form.issuingAuthority} onChange={(event) => setForm({ ...form, issuingAuthority: event.target.value })}>
                {HALAL_AUTHORITIES.map((authority) => (
                  <option key={authority} value={authority}>{authority}</option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Issue Date">
                <Input type="date" value={form.issueDate} onChange={(event) => setForm({ ...form, issueDate: event.target.value })} />
              </Field>
              <Field label="Expiry Date">
                <Input type="date" value={form.expiryDate} onChange={(event) => setForm({ ...form, expiryDate: event.target.value })} />
              </Field>
            </div>
            <Field label="Verification Status">
              <Select value={form.verificationStatus} onChange={(event) => setForm({ ...form, verificationStatus: event.target.value as HalalVerificationStatus })}>
                <option value="pending">Pending Verification</option>
                <option value="verified">Verified</option>
              </Select>
            </Field>
            <Field label="Certificate Document" hint={fileError || 'PDF, JPG, or PNG'}>
              <Input
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
            {mode === 'edit' && row?.documentName && <div className="text-xs text-slate-500">Current document: {row.documentName}</div>}
            <Field label="Notes">
              <Input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </Field>
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
            <Input value={manufacturerForm.name} onChange={(event) => setManufacturerForm({ ...manufacturerForm, name: event.target.value })} />
          </Field>
          <Field label="Company Registration No.">
            <Input value={manufacturerForm.registrationNo} onChange={(event) => setManufacturerForm({ ...manufacturerForm, registrationNo: event.target.value })} />
          </Field>
          <Field label="Address">
            <Input value={manufacturerForm.address} onChange={(event) => setManufacturerForm({ ...manufacturerForm, address: event.target.value })} />
          </Field>
          <Field label="Contact">
            <Input value={manufacturerForm.contact} onChange={(event) => setManufacturerForm({ ...manufacturerForm, contact: event.target.value })} />
          </Field>
          <Field label="Notes">
            <Input value={manufacturerForm.notes} onChange={(event) => setManufacturerForm({ ...manufacturerForm, notes: event.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={manufacturerForm.active ? 'active' : 'inactive'} onChange={(event) => setManufacturerForm({ ...manufacturerForm, active: event.target.value === 'active' })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
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

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-slate-800">{value}</div>
    </div>
  )
}
