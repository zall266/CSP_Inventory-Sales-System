const memory = new Map<string, string>()
const localStoragePolyfill = {
  getItem(key: string) {
    return memory.has(key) ? memory.get(key)! : null
  },
  setItem(key: string, value: string) {
    memory.set(key, String(value))
  },
  removeItem(key: string) {
    memory.delete(key)
  },
  clear() {
    memory.clear()
  },
  key(index: number) {
    return [...memory.keys()][index] ?? null
  },
  get length() {
    return memory.size
  },
}

Object.defineProperty(globalThis, 'localStorage', { value: localStoragePolyfill, configurable: true })
Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true })

const { readFileSync } = await import('node:fs')
const { db } = await import('@/store/db')
const { hasPermission } = await import('@/features/settings/permissions')
const { getAttachmentBlob } = await import('@/store/attachmentBlobs')
const { addCalendarDays, buildHalalRows, deriveHalalStatus, filterHalalRows, halalBusinessDate } = await import('@/features/halal/halalModel')
const { systemDateKey } = await import('@/utils/format')
const { receivableRawMaterials } = await import('@/features/receiving/receivingModel')

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const today = halalBusinessDate()
const activeExpiry = addCalendarDays(today, 120)
const expiringExpiry = addCalendarDays(today, 30)
const expiredExpiry = addCalendarDays(today, -5)
const renewalExpiry = addCalendarDays(today, 400)
const klBefore = new Date('2026-09-24T15:30:00Z')
const klAfter = new Date('2026-09-24T16:30:00Z')
check('malaysia date uses current instant', today === systemDateKey(new Date()) && /^\d{4}-\d{2}-\d{2}$/.test(today))
check('malaysia date keeps the kuala lumpur boundary', halalBusinessDate(klBefore) === '2026-09-24' && halalBusinessDate(klAfter) === '2026-09-25' && klAfter.toISOString().slice(0, 10) === '2026-09-24')
check('expired before today', deriveHalalStatus({ expiryDate: addCalendarDays(today, -1), verificationStatus: 'verified' } as never) === 'expired')
check('expiring on today and day 90', deriveHalalStatus({ expiryDate: today, verificationStatus: 'verified' } as never) === 'expiring' && deriveHalalStatus({ expiryDate: addCalendarDays(today, 90), verificationStatus: 'verified' } as never) === 'expiring')
check('active after day 90', deriveHalalStatus({ expiryDate: addCalendarDays(today, 91), verificationStatus: 'verified' } as never) === 'active')
check('pending unless expired', deriveHalalStatus({ expiryDate: addCalendarDays(today, 91), verificationStatus: 'pending' } as never) === 'pending' && deriveHalalStatus({ expiryDate: addCalendarDays(today, -1), verificationStatus: 'pending' } as never) === 'expired')
const halalSource = readFileSync(new URL('../src/features/halal/halalModel.ts', import.meta.url), 'utf8')
check('halal model does not freeze the prototype date', !halalSource.includes('PROTOTYPE_TODAY') && halalSource.includes('systemDateKey(now)'))

db.resetDemo()
const beforeProducts = JSON.stringify(db.getSnapshot().products)
const beforeSuppliers = JSON.stringify(db.getSnapshot().suppliers)
const beforeReceivings = JSON.stringify(db.getSnapshot().receivings)
const beforeBoms = JSON.stringify(db.getSnapshot().boms)

const created = db.createManufacturer({
  name: 'ABC Food Manufacturing',
  registrationNo: '202001234567',
  address: 'Shah Alam',
  contact: '03-1000 0000',
  notes: 'Kilang',
  active: true,
})
check('1 create manufacturer', Boolean(created?.id && created.name === 'ABC Food Manufacturing'))

const duplicate = db.createManufacturer({ name: '  abc   food manufacturing  ' })
check('2 duplicate manufacturer blocked', duplicate === null && (db.getSnapshot().manufacturers ?? []).length === 1)

const materials = receivableRawMaterials(db.getSnapshot())
const sugar = materials.find((item) => item.id === 'p-sugar')
const milk = materials.find((item) => item.id === 'p-milkpw')
const extra = materials.filter((item) => item.id !== 'p-sugar' && item.id !== 'p-milkpw')
check('raw materials available', Boolean(sugar && milk && extra.length >= 3), `${materials.length}`)

const pdf = new Blob(['%PDF-1.1 halal'], { type: 'application/pdf' })
const pending = await db.saveHalalCompliance({
  productId: 'p-sugar',
  manufacturerId: created!.id,
  certificateNo: 'JAKIM-12345',
  issuingAuthority: 'JAKIM',
  issueDate: '2026-05-12',
  expiryDate: activeExpiry,
  verificationStatus: 'pending',
  notes: 'Awaiting check',
  document: { fileName: 'jakim-12345.pdf', mimeType: 'application/pdf', blob: pdf },
})
check('3 register raw material', pending?.productId === 'p-sugar')
const cert = (db.getSnapshot().halalCertificates ?? []).find((item) => item.id === pending?.certificateId)
check('4 register certificate', cert?.certificateNo === 'JAKIM-12345' && cert.expiryDate === activeExpiry)
const stored = cert?.documentFileId ? await getAttachmentBlob(cert.documentFileId) : undefined
check('5 upload certificate document', stored?.kind === 'halal_certificate' && stored.mimeType === 'application/pdf' && !JSON.stringify(cert).includes('%PDF'))
check('6 pending verification status', deriveHalalStatus(cert) === 'pending' && cert?.verificationStatus === 'pending' && !cert.verifiedBy)

const verified = await db.saveHalalCompliance({
  complianceId: pending!.id,
  productId: 'p-sugar',
  manufacturerId: created!.id,
  certificateNo: 'JAKIM-12345',
  issuingAuthority: 'JAKIM',
  issueDate: '2026-05-12',
  expiryDate: activeExpiry,
  verificationStatus: 'verified',
  notes: 'Checked',
})
const verifiedCert = (db.getSnapshot().halalCertificates ?? []).find((item) => item.id === verified?.certificateId)
check('7 verify certificate', verifiedCert?.verificationStatus === 'verified' && verifiedCert.verifiedBy === 'Admin' && Boolean(verifiedCert.verifiedAt))
check('8 active status', deriveHalalStatus(verifiedCert) === 'active')

const shared = await db.saveHalalCompliance({
  productId: 'p-milkpw',
  manufacturerId: created!.id,
  certificateNo: 'JAKIM-12345',
  issuingAuthority: 'JAKIM',
  issueDate: '2026-05-12',
  expiryDate: activeExpiry,
  verificationStatus: 'verified',
})
check(
  '16 multiple materials one certificate',
  shared?.certificateId === verified?.certificateId && (db.getSnapshot().halalCertificates ?? []).filter((item) => item.certificateNo === 'JAKIM-12345').length === 1,
)

const expiring = await db.saveHalalCompliance({
  productId: extra[0].id,
  manufacturerId: created!.id,
  certificateNo: 'JAKIM-EXP',
  issuingAuthority: 'JAKIM',
  expiryDate: expiringExpiry,
  verificationStatus: 'verified',
})
const expiringCert = (db.getSnapshot().halalCertificates ?? []).find((item) => item.id === expiring?.certificateId)
check('9 expiring soon status', deriveHalalStatus(expiringCert) === 'expiring')

const expired = await db.saveHalalCompliance({
  productId: extra[1].id,
  manufacturerId: created!.id,
  certificateNo: 'JAKIM-OLD',
  issuingAuthority: 'JAKIM',
  expiryDate: expiredExpiry,
  verificationStatus: 'pending',
})
const expiredCert = (db.getSnapshot().halalCertificates ?? []).find((item) => item.id === expired?.certificateId)
check('10 expired status', deriveHalalStatus(expiredCert) === 'expired')

const rows = buildHalalRows(db.getSnapshot())
check('11 not registered status', rows.some((row) => row.productId === extra[2].id && row.status === 'not_registered' && !row.complianceId))
check('12 search raw material', filterHalalRows(rows, 'sugar', 'all').some((row) => row.productId === 'p-sugar'))
check('13 search manufacturer', filterHalalRows(rows, 'abc food', 'all').length >= 2)
check('14 search certificate', filterHalalRows(rows, 'jakim-12345', 'all').length === 2)
check('15 status filter', filterHalalRows(rows, '', 'expired').every((row) => row.status === 'expired') && filterHalalRows(rows, '', 'active').some((row) => row.productId === 'p-sugar'))

const renewed = await db.saveHalalCompliance({
  complianceId: pending!.id,
  productId: 'p-sugar',
  manufacturerId: created!.id,
  certificateNo: 'JAKIM-12345',
  issuingAuthority: 'JAKIM',
  issueDate: today,
  expiryDate: renewalExpiry,
  verificationStatus: 'verified',
  notes: 'Renewed',
})
const sameNumberCerts = (db.getSnapshot().halalCertificates ?? []).filter((item) => item.certificateNo === 'JAKIM-12345')
const originalCert = sameNumberCerts.find((item) => item.expiryDate === activeExpiry)
check(
  '17 same number renewal keeps history',
  renewed?.certificateId !== pending?.certificateId
    && renewed?.previousCertificateIds.includes(pending!.certificateId)
    && sameNumberCerts.length === 2
    && originalCert?.expiryDate === activeExpiry
    && sameNumberCerts.some((item) => item.expiryDate === renewalExpiry)
    && shared?.certificateId === (db.getSnapshot().halalCompliances ?? []).find((item) => item.productId === 'p-milkpw')?.certificateId,
)

const edited = await db.saveHalalCompliance({
  complianceId: renewed!.id,
  productId: 'p-sugar',
  manufacturerId: created!.id,
  certificateNo: 'JAKIM-12345',
  issuingAuthority: 'JAKIM',
  issueDate: today,
  expiryDate: renewalExpiry,
  verificationStatus: 'verified',
  notes: 'Edited note',
})
check('18 edit compliance', edited?.notes === 'Edited note' && edited?.previousCertificateIds.length === 1)

const actions = new Set((db.getSnapshot().documentAuditLogs ?? []).map((log) => log.action))
check(
  '19 audit events',
  ['manufacturer_created', 'halal_certificate_created', 'halal_certificate_updated', 'halal_compliance_created', 'halal_compliance_updated'].every((action) => actions.has(action as never)),
)

const badExpiry = await db.saveHalalCompliance({
  productId: extra[2].id,
  manufacturerId: created!.id,
  certificateNo: 'JAKIM-BAD',
  issuingAuthority: 'JAKIM',
  issueDate: '2027-01-02',
  expiryDate: '2027-01-01',
  verificationStatus: 'pending',
})
check('expiry before issue blocked', badExpiry === null)

const reusedPeriod = await db.saveHalalCompliance({
  productId: extra[2].id,
  manufacturerId: created!.id,
  certificateNo: 'JAKIM-12345',
  issuingAuthority: 'JAKIM',
  issueDate: '2026-05-12',
  expiryDate: activeExpiry,
  verificationStatus: 'verified',
})
check('exact certificate period is reused', reusedPeriod?.certificateId === originalCert?.id && (db.getSnapshot().halalCertificates ?? []).filter((item) => item.certificateNo === 'JAKIM-12345' && item.expiryDate === activeExpiry).length === 1)
const duplicateRow = await db.saveHalalCompliance({
  productId: 'p-milkpw',
  manufacturerId: created!.id,
  certificateNo: 'JAKIM-12345',
  issuingAuthority: 'JAKIM',
  issueDate: '2026-05-12',
  expiryDate: activeExpiry,
  verificationStatus: 'verified',
})
check('exact compliance duplicate blocked', duplicateRow === null)

check('22 product master unaffected', JSON.stringify(db.getSnapshot().products) === beforeProducts && JSON.stringify(db.getSnapshot().boms) === beforeBoms)
check('supplier master unaffected', JSON.stringify(db.getSnapshot().suppliers) === beforeSuppliers)
check('20 receiving unaffected', JSON.stringify(db.getSnapshot().receivings) === beforeReceivings)

db.switchUser('u-siti')
const cashierDenied = db.createManufacturer({ name: 'Cashier Kilang' })
check('23 cashier permission denied', cashierDenied === null && !hasPermission(db.getSnapshot(), 'halal.view') && !hasPermission(db.getSnapshot(), 'halal.manage'))
db.switchUser('u-mei')
const staffDenied = await db.saveHalalCompliance({
  productId: extra[2].id,
  manufacturerId: created!.id,
  certificateNo: 'JAKIM-STAFF',
  issuingAuthority: 'JAKIM',
  expiryDate: '2027-12-01',
  verificationStatus: 'pending',
})
check('23 staff permission denied', staffDenied === null && !hasPermission(db.getSnapshot(), 'halal.manage'))
db.switchUser('u-admin')
check('23 admin permission allowed', hasPermission(db.getSnapshot(), 'halal.view') && hasPermission(db.getSnapshot(), 'halal.manage'))

const page = readFileSync(new URL('../src/features/halal/HalalCompliancePage.tsx', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8')
check('24 mobile ui', page.includes('overflow-x-hidden') && page.includes('sm:hidden') && page.includes('hidden sm:block'))
check('25 desktop ui', page.includes('<table') && page.includes('Halal Compliance'))
check(
  'one sidebar item',
  sidebar.split('Halal Compliance').length === 2 && !sidebar.includes('Expiry Monitor') && !sidebar.includes('Halal Dashboard'),
)
check('21 pjkm module untouched by halal page', !page.includes('pjkm') && !page.includes('createReceiving'))

const updated = db.updateManufacturer(created!.id, { name: 'ABC Food Manufacturing', notes: 'Updated', active: true })
check('manufacturer update audit', updated?.notes === 'Updated' && (db.getSnapshot().documentAuditLogs ?? []).some((log) => log.action === 'manufacturer_updated'))

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
