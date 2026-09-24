import { receivableRawMaterials } from '@/features/receiving/receivingModel'
import type { AppState, HalalCertificate, HalalVerificationStatus, Manufacturer, RawMaterialHalalCompliance } from '@/types'
import { systemDateKey } from '@/utils/format'

export const HALAL_CERTIFICATE_KIND = 'halal_certificate'
export const HALAL_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024
export const HALAL_AUTHORITIES = ['JAKIM', 'JAIN', 'MAIN'] as const
export const HALAL_EXPIRING_DAYS = 90

const HALAL_DOCUMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])

export type HalalStatus = 'not_registered' | 'pending' | 'active' | 'expiring' | 'expired'
export type HalalStatusFilter = 'all' | HalalStatus

export type HalalRow = {
  key: string
  productId: string
  productName: string
  sku: string
  complianceId?: string
  manufacturerId?: string
  manufacturerName: string
  certificateId?: string
  certificateNo: string
  issueDate?: string
  expiryDate?: string
  status: HalalStatus
  verificationStatus?: HalalVerificationStatus
  verifiedBy?: string
  verifiedAt?: string
  documentFileId?: string
  documentName?: string
  notes?: string
}

export function normalizeManufacturerName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function normalizeCertificateNo(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function isDateKey(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function addCalendarDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  const nextYear = date.getUTCFullYear()
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0')
  const nextDay = String(date.getUTCDate()).padStart(2, '0')
  return `${nextYear}-${nextMonth}-${nextDay}`
}

export function halalStatusLabel(status: HalalStatus) {
  if (status === 'not_registered') return 'Not Registered'
  if (status === 'pending') return 'Pending Verification'
  if (status === 'active') return 'Active'
  if (status === 'expiring') return 'Expiring Soon'
  return 'Expired'
}

export function halalStatusMark(status: HalalStatus) {
  if (status === 'active') return '🟢'
  if (status === 'expiring') return '🟡'
  if (status === 'expired') return '🔴'
  if (status === 'pending') return '🟠'
  return '⚪'
}

export function halalBusinessDate(now = new Date()) {
  return systemDateKey(now)
}

export function deriveHalalStatus(certificate: HalalCertificate | undefined, today = halalBusinessDate()): HalalStatus {
  if (!certificate || !isDateKey(certificate.expiryDate)) return 'not_registered'
  if (certificate.expiryDate < today) return 'expired'
  if (certificate.verificationStatus !== 'verified') return 'pending'
  if (certificate.expiryDate <= addCalendarDays(today, HALAL_EXPIRING_DAYS)) return 'expiring'
  return 'active'
}

export function findManufacturerByName(manufacturers: Manufacturer[], name: string, excludeId?: string) {
  const needle = normalizeManufacturerName(name)
  if (!needle) return undefined
  return manufacturers.find((item) => item.id !== excludeId && normalizeManufacturerName(item.name) === needle)
}

export function certificatePeriodMatches(
  certificate: HalalCertificate,
  input: { certificateNo: string; issuingAuthority: string; issueDate?: string; expiryDate: string },
) {
  return (
    normalizeCertificateNo(certificate.certificateNo) === normalizeCertificateNo(input.certificateNo) &&
    certificate.issuingAuthority.trim().toLowerCase() === input.issuingAuthority.trim().toLowerCase() &&
    certificate.expiryDate === input.expiryDate &&
    (certificate.issueDate ?? '') === (input.issueDate ?? '')
  )
}

export function findCertificateByPeriod(
  certificates: HalalCertificate[],
  input: { certificateNo: string; issuingAuthority: string; issueDate?: string; expiryDate: string },
  excludeId?: string,
) {
  return certificates.find((item) => item.id !== excludeId && certificatePeriodMatches(item, input))
}

export function validateHalalDocument(file: { name: string; type: string; size: number }) {
  const name = file.name.toLowerCase()
  const extOk = name.endsWith('.pdf') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png')
  const type = file.type === 'image/jpg' ? 'image/jpeg' : file.type
  if (file.size > HALAL_DOCUMENT_MAX_BYTES) return 'Certificate document must be 5 MB or smaller.'
  if (HALAL_DOCUMENT_TYPES.has(type) || ((!type || type === 'application/octet-stream') && extOk)) return ''
  return 'Upload a PDF, JPG, or PNG certificate.'
}

export function halalSummary(rows: HalalRow[]) {
  return {
    active: rows.filter((row) => row.status === 'active').length,
    expiring: rows.filter((row) => row.status === 'expiring').length,
    expired: rows.filter((row) => row.status === 'expired').length,
    notRegistered: rows.filter((row) => row.status === 'not_registered').length,
  }
}

function productOf(state: Pick<AppState, 'products'>, productId: string) {
  return state.products.find((product) => product.id === productId)
}

function manufacturerOf(state: Pick<AppState, 'manufacturers'>, manufacturerId: string) {
  return (state.manufacturers ?? []).find((item) => item.id === manufacturerId)
}

function certificateOf(state: Pick<AppState, 'halalCertificates'>, certificateId: string) {
  return (state.halalCertificates ?? []).find((item) => item.id === certificateId)
}

export function complianceToRow(
  state: Pick<AppState, 'products' | 'manufacturers' | 'halalCertificates'>,
  compliance: RawMaterialHalalCompliance,
  today = halalBusinessDate(),
): HalalRow {
  const product = productOf(state, compliance.productId)
  const manufacturer = manufacturerOf(state, compliance.manufacturerId)
  const certificate = certificateOf(state, compliance.certificateId)
  return {
    key: compliance.id,
    productId: compliance.productId,
    productName: product?.name ?? 'Unknown material',
    sku: product?.sku ?? '',
    complianceId: compliance.id,
    manufacturerId: compliance.manufacturerId,
    manufacturerName: manufacturer?.name ?? '—',
    certificateId: certificate?.id,
    certificateNo: certificate?.certificateNo ?? '—',
    issueDate: certificate?.issueDate,
    expiryDate: certificate?.expiryDate,
    status: deriveHalalStatus(certificate, today),
    verificationStatus: certificate?.verificationStatus,
    verifiedBy: certificate?.verifiedBy,
    verifiedAt: certificate?.verifiedAt,
    documentFileId: certificate?.documentFileId,
    documentName: certificate?.documentName,
    notes: certificate?.notes || compliance.notes,
  }
}

export function buildHalalRows(state: Pick<AppState, 'products' | 'boms' | 'manufacturers' | 'halalCertificates' | 'halalCompliances'>, today = halalBusinessDate()) {
  const compliances = state.halalCompliances ?? []
  const registeredIds = new Set(compliances.map((row) => row.productId))
  const registered = compliances.map((row) => complianceToRow(state, row, today))
  const missing = receivableRawMaterials(state)
    .filter((product) => !registeredIds.has(product.id))
    .map((product): HalalRow => ({
      key: `missing:${product.id}`,
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      manufacturerName: '—',
      certificateNo: '—',
      status: 'not_registered',
    }))
  return [...registered, ...missing].sort((a, b) => a.productName.localeCompare(b.productName) || a.manufacturerName.localeCompare(b.manufacturerName))
}

export function filterHalalRows(rows: HalalRow[], query: string, status: HalalStatusFilter) {
  const needle = query.trim().toLowerCase()
  return rows.filter((row) => {
    if (status !== 'all' && row.status !== status) return false
    if (!needle) return true
    return [row.productName, row.sku, row.manufacturerName, row.certificateNo].some((value) => value.toLowerCase().includes(needle))
  })
}
