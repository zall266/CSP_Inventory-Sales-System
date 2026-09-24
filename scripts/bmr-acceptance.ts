import { readFileSync } from 'node:fs'
import {
  BMR_EFFECTIVE_DATE,
  BMR_MULTIPLE_HALAL_REMARK,
  BMR_PROCESS_STEPS,
  addCalendarYears,
  bmrBatchNo,
  bmrExpiryDate,
  buildBmr,
  canPrintBmr,
  paginateBmr,
  weightToGrams,
  type BmrMaterialRow,
  type BmrSource,
} from '../src/features/manufacturing/bmrModel'
import type {
  Bom,
  Category,
  HalalCertificate,
  Manufacturer,
  MaterialClosingLine,
  Product,
  ProductionSession,
  ProductionSessionItem,
  RawMaterialHalalCompliance,
} from '../src/types'

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function product(partial: Pick<Product, 'id' | 'name' | 'unit' | 'categoryId'> & Partial<Product>): Product {
  return {
    sku: partial.id,
    barcode: '',
    purchaseUnit: partial.unit,
    costPrice: 0,
    sellingPrice: 0,
    wholesalePrice: 0,
    reorderLevel: 0,
    trackBatch: false,
    trackExpiry: false,
    status: 'active',
    accent: '',
    ...partial,
  }
}

function item(partial: Pick<ProductionSessionItem, 'productId' | 'bomId' | 'actualQty'> & Partial<ProductionSessionItem>): ProductionSessionItem {
  return {
    id: partial.productId,
    sessionId: 'ps-1',
    originalTargetQty: partial.actualQty,
    targetQty: partial.actualQty,
    shortProductionQty: 0,
    shortProductionReason: '',
    productionBalanceQty: 0,
    balanceLocation: '',
    balanceContainer: '',
    wasteQty: 0,
    wasteReason: '',
    notes: '',
    displayQty: partial.actualQty,
    cartonQty: 0,
    ...partial,
  }
}

function closing(productId: string, actualUsedQty: number, plannedQty: number): MaterialClosingLine {
  return {
    productId,
    plannedQty,
    availableQty: plannedQty,
    remainingQty: 0,
    actualUsedQty,
    varianceQty: actualUsedQty - plannedQty,
    variancePercent: 0,
  }
}

function session(partial: Partial<ProductionSession> & Pick<ProductionSession, 'productionDate' | 'items'>): ProductionSession {
  return {
    id: 'ps-1',
    reference: 'PROD-20260924-001',
    status: 'completed',
    warehouseId: 'wh-main',
    createdBy: 'Admin',
    createdAt: '2026-09-24T04:00:00.000Z',
    acceptedBy: 'Admin',
    acceptedAt: '2026-09-24T04:00:00.000Z',
    startedBy: 'Admin',
    startedAt: '2026-09-24T05:00:00.000Z',
    completedBy: 'En.Nazaruddin',
    completedAt: '2026-09-24T12:00:00.000Z',
    recipePhoto: '',
    recipePhotoName: '',
    uploadedBy: '',
    uploadedAt: '',
    notes: '',
    picking: [],
    excessReturns: [],
    targetChanges: [],
    completedEdits: [],
    posted: true,
    materialClosing: { checkedAt: '', checkedBy: 'En.Nazaruddin', acknowledged: true, significantVariance: false, lines: [] },
    ...partial,
  }
}

const categories: Category[] = [
  { id: 'cat-ing', name: 'Ingredients' },
  { id: 'cat-pack', name: 'Packaging' },
]
const sugar = product({ id: 'p-sugar', name: 'Gula Kasar', unit: 'KG', categoryId: 'cat-ing' })
const pouch = product({ id: 'p-pouch', name: 'Retail Pouch', unit: 'PCS', categoryId: 'cat-pack' })
const waffle = product({ id: 'p-waffle', name: 'Tepung Waffle', unit: 'packs', categoryId: 'cat-fg' })
const creamer = product({ id: 'p-creamer', name: 'AB Non-Dairy Creamer', unit: 'packs', categoryId: 'cat-fg' })
const waffleBom: Bom = {
  id: 'bom-waffle',
  name: 'Tepung Waffle',
  productId: waffle.id,
  outputQty: 408,
  outputUnit: 'packs',
  bulkYieldGrams: 399840,
  status: 'active',
  notes: '',
  items: [],
}
const creamerBom: Bom = {
  id: 'bom-creamer',
  name: 'AB Non-Dairy Creamer',
  productId: creamer.id,
  outputQty: 50,
  outputUnit: 'packs',
  bulkYieldGrams: 49000,
  status: 'active',
  notes: '',
  items: [],
}
const manufacturer: Manufacturer = {
  id: 'm-csr',
  name: 'CENTER SUGAR REFINERY SDN BHD',
  active: true,
  createdAt: '',
  createdBy: '',
  updatedAt: '',
  updatedBy: '',
}
const certificate: HalalCertificate = {
  id: 'cert-1',
  certificateNo: 'hidden-cert',
  issuingAuthority: 'JAKIM',
  expiryDate: '2027-12-31',
  verificationStatus: 'verified',
  documentFileId: 'file-should-not-print',
  documentName: 'halal.pdf',
  documentMime: 'application/pdf',
  createdAt: '',
  createdBy: '',
  updatedAt: '',
  updatedBy: '',
}
const compliance: RawMaterialHalalCompliance = {
  id: 'hc-1',
  productId: sugar.id,
  manufacturerId: manufacturer.id,
  certificateId: certificate.id,
  previousCertificateIds: ['old-cert'],
  createdAt: '',
  createdBy: '',
  updatedAt: '',
  updatedBy: '',
}

function source(extra?: Partial<BmrSource>): BmrSource {
  return {
    products: [sugar, pouch, waffle, creamer],
    boms: [waffleBom, creamerBom],
    categories,
    manufacturers: [manufacturer],
    halalCertificates: [certificate],
    halalCompliances: [compliance],
    ...extra,
  }
}

check('expiry is production date plus one year', bmrExpiryDate('2026-09-24') === '2027-09-24')
check('batch uses production day month and expiry year', bmrBatchNo('2026-09-24') === '24092027')
check('25 Sep example', bmrBatchNo('2026-09-25') === '25092027' && bmrExpiryDate('2026-09-25') === '2027-09-25')
check('01 Oct example', bmrBatchNo('2026-10-01') === '01102027' && bmrExpiryDate('2026-10-01') === '2027-10-01')
check(
  'leap day follows Date roll and keeps production day month',
  addCalendarYears('2024-02-29', 1) === '2025-03-01' && bmrBatchNo('2024-02-29') === '29022025',
  `expiry ${addCalendarYears('2024-02-29', 1)} batch ${bmrBatchNo('2024-02-29')}`,
)
check('kg converts to grams', weightToGrams(2.62, 'KG') === 2620)
check('grams stay grams', weightToGrams(150, 'g') === 150)

const one = session({
  productionDate: '2026-09-24',
  completedBy: 'En.Nazaruddin',
  items: [item({ productId: waffle.id, bomId: waffleBom.id, actualQty: 408, productionBalanceQty: 867, wasteQty: 80 })],
  materialClosing: {
    checkedAt: '',
    checkedBy: 'En.Nazaruddin',
    acknowledged: true,
    significantVariance: false,
    lines: [closing(sugar.id, 2.62, 99), closing(pouch.id, 408, 408)],
  },
})
const doc = buildBmr(one, source())
check('completed one-product session generates a BMR', doc != null)
check('header product name', doc?.productName === 'Tepung Waffle')
check('production date label', doc?.productionDateLabel === '24-Sep-2026')
check('expiry label', doc?.expiryDateLabel === '24-Sep-2027')
check('batch is not the session reference', doc?.batchNo === '24092027' && doc.batchNo !== one.reference)
check('approved by stays blank', doc?.approvedBy === '')
check('raw materials come from material closing', doc?.materials.length === 1 && doc.materials[0].material === 'Gula Kasar')
check('actual used is printed, planned is not', doc?.materials[0].quantityUsedG === '2,620')
check('pcs packaging is excluded', !doc?.materials.some((row) => row.material === 'Retail Pouch'))
check('warehouse stock stays blank', doc?.materials[0].warehouseStockG === '')
check('single halal record fills manufacturer', doc?.materials[0].manufacturer === 'CENTER SUGAR REFINERY SDN BHD')
check('halal status is the system label', doc?.materials[0].halalStatus === 'Active')
check('single halal record fills certificate expiry', doc?.materials[0].expiryDate === '31-Dec-2027')
const serialized = JSON.stringify(doc)
check('certificate file is not embedded', !serialized.includes('file-should-not-print') && !serialized.includes('halal.pdf') && !serialized.includes('hidden-cert'))
check('process steps are numbered 1 to 5', doc?.process.map((row) => row.step).join(',') === '1,2,3,4,5')
check('process names match the template', doc?.process.map((row) => row.description).join('|') === BMR_PROCESS_STEPS.join('|'))
check('process times and operators stay blank', doc?.process.every((row) => row.timeStart === '' && row.timeEnd === '' && row.operatorName === '') === true)
check('packaging row count matches session items', doc?.packaging.length === 1)
check('size is grams per pack', doc?.packaging[0].sizeWeightG === '980')
check('released packs equal actual qty', doc?.packaging[0].quantityReleasedPack === '408')
check('produced grams equal packs times size', doc?.packaging[0].quantityProducedG === '399,840')
check('production balance is only a remark', doc?.packaging[0].remarks === 'Production balance 867 g' && !doc.packaging[0].quantityProducedG.includes('867'))
check('rejected packs stay blank', doc?.packaging[0].quantityRejected === '')
check('deviation row is blank', doc?.deviations.length === 1 && doc.deviations[0].issue === '' && doc.deviations[0].description === '' && doc.deviations[0].correctiveAction === '' && doc.deviations[0].responsiblePerson === '' && doc.deviations[0].date === '')
check('production approval name and date', doc?.approval[0].department === 'Production' && doc.approval[0].name === 'En.Nazaruddin' && doc.approval[0].date === '24-Sep-2026' && doc.approval[0].signature === '')
check('qc approval stays blank', doc?.approval[1].department === 'QC / QA' && doc.approval[1].name === '' && doc.approval[1].signature === '' && doc.approval[1].date === '')
check('halal approval stays blank', doc?.approval[2].department === 'Halal Compliance' && doc.approval[2].name === '' && doc.approval[2].signature === '' && doc.approval[2].date === '')

const none = buildBmr(one, source({ halalCompliances: [] }))
check('no halal record is Not Registered', none?.materials[0].halalStatus === 'Not Registered' && none.materials[0].manufacturer === '' && none.materials[0].expiryDate === '' && none.materials[0].remarks === '')

const second: RawMaterialHalalCompliance = { ...compliance, id: 'hc-2', manufacturerId: 'm-other' }
const many = buildBmr(one, source({ halalCompliances: [compliance, second] }))
check(
  'multiple halal records stay blank with a manual remark',
  many?.materials[0].manufacturer === '' && many.materials[0].expiryDate === '' && many.materials[0].halalStatus === '' && many.materials[0].remarks === BMR_MULTIPLE_HALAL_REMARK,
)

const multi = session({
  id: 'ps-multi',
  productionDate: '2026-09-24',
  items: [
    item({ productId: waffle.id, bomId: waffleBom.id, actualQty: 408 }),
    item({ productId: creamer.id, bomId: creamerBom.id, actualQty: 50 }),
  ],
  materialClosing: one.materialClosing,
})
const multiDoc = buildBmr(multi, source())
check('multi-product session is one BMR', multiDoc != null && multiDoc.sessionId === 'ps-multi')
check('header lists every flavour', multiDoc?.productName === 'Tepung Waffle, AB Non-Dairy Creamer')
check('packaging has one row per flavour', multiDoc?.packaging.length === 2 && multiDoc.packaging[1].quantityReleasedPack === '50' && multiDoc.packaging[1].quantityProducedG === '49,000')

const open = buildBmr(session({ ...one, status: 'in_progress', posted: false }), source())
const unposted = buildBmr(session({ ...one, posted: false }), source())
check('incomplete production does not build a BMR', open == null && unposted == null)
check('print gate requires completed and posted', canPrintBmr(one) === true && canPrintBmr({ status: 'in_progress', posted: false }) === false && canPrintBmr({ status: 'completed', posted: false }) === false)

const longMaterials: BmrMaterialRow[] = Array.from({ length: 20 }, (_, index) => ({
  material: `Material ${index + 1}`,
  manufacturer: '',
  warehouseStockG: '',
  quantityUsedG: '1',
  expiryDate: '',
  halalStatus: '',
  remarks: '',
}))
const pages = paginateBmr(longMaterials)
check('long material list spans more than one material page', pages.filter((page) => page.materials.length > 0).length > 1)
check('material pages repeat by each carrying their own rows', pages.filter((page) => page.materials.length > 0).every((page) => page.materials.length > 0))
check('final approval is only on the last page', pages.at(-1)?.showApproval === true && pages.slice(0, -1).every((page) => !page.showApproval))
check('packaging and deviations share the final page', pages.at(-1)?.showPackaging === true && pages.at(-1)?.showDeviations === true)

const css = readFileSync(new URL('../src/features/manufacturing/bmr.css', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../src/features/manufacturing/BmrPrintPage.tsx', import.meta.url), 'utf8')
const historySource = readFileSync(new URL('../src/features/manufacturing/ProductionHistoryPage.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
check('print page is A4 portrait', css.includes('size: A4 portrait'))
check('material table header repeats on print', css.includes('display: table-header-group'))
check('effective date is on the print page path', pageSource.includes('BMR_EFFECTIVE_DATE') && BMR_EFFECTIVE_DATE === '01st JUNE 2026')
check('print route is outside the layout import', appSource.includes('/manufacturing/bmr/:sessionId'))
check('history shows Print BMR through the completed gate', historySource.includes('canPrintBmr(session)') && historySource.includes('Print BMR'))
check('signature cells are blank fields', pageSource.includes('row.signature') && !pageSource.includes('digital'))

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
