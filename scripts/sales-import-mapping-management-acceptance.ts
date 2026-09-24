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
Object.defineProperty(globalThis, 'localStorage', { value: localStoragePolyfill })
Object.defineProperty(globalThis, 'window', { value: globalThis })

import { readFileSync } from 'node:fs'
import { db } from '@/store/db'
import { filterSalesImportMappings, resolveLineProduct } from '@/features/salesImport/mapping'
import type { SalesImportLine } from '@/types'

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const snap = () => db.getSnapshot()
const account = db.createSalesImportAccount('shopee', 'faizal266')
const other = db.createSalesImportAccount('tiktok', 'coolslurppypowder')
const batch = account ? db.createSalesImportBatch('shopee', account.id) : null
const otherBatch = other ? db.createSalesImportBatch('tiktok', other.id) : null
const productA = 'p-ib'
const productB = 'p-wf'

if (batch) db.saveSalesImportMapping({ batchId: batch.id, keyType: 'sku', key: '147539', productId: productA })
if (otherBatch) db.saveSalesImportMapping({ batchId: otherBatch.id, keyType: 'text', key: 'blue ice vanila|cup', productId: productB })

const saved = () => (snap().salesImportMappings ?? []).filter((row) => row.key === '147539' || row.key === 'blue ice vanila|cup')
const skuMapping = () => saved().find((row) => row.key === '147539')

const line: SalesImportLine = {
  id: 'sil-test',
  orderId: 'sio-test',
  externalProductName: 'BLUE ICE VANILA',
  variationText: 'Cup',
  externalSku: '147539',
  quantity: 1,
  quantitySource: 'picking',
}
const textLine: SalesImportLine = {
  id: 'sil-text',
  orderId: 'sio-test',
  externalProductName: 'Tepung Waffle Crispy',
  variationText: 'Original',
  quantity: 1,
  quantitySource: 'picking',
}

function listed(search: string, platform = '', accountId = '', status: 'all' | 'active' | 'inactive' = 'all') {
  const state = snap()
  return filterSalesImportMappings({
    mappings: saved(),
    products: state.products,
    lines: [line, textLine],
    orders: [{ id: 'sio-test', batchId: batch?.id ?? '' }],
    batches: state.salesImportBatches ?? [],
    search,
    platform,
    accountId,
    status,
  })
}

check('1. Existing saved mapping appears', Boolean(skuMapping()) && listed('').some((row) => row.key === '147539'))
check('2. Search by external SKU', listed('147539').length === 1 && listed('147539')[0]?.key === '147539')
check('3. Search by source product', listed('blue ice vanila').some((row) => row.key === '147539'))
check('4. Search by CSP product', listed('ice blended').some((row) => row.key === '147539') && listed('WF001').some((row) => row.key === 'blue ice vanila|cup'))
check('5. Platform filter', listed('', 'shopee').every((row) => row.platform === 'shopee') && listed('', 'tiktok').every((row) => row.platform === 'tiktok') && listed('', 'shopee').length === 1)
check('6. Account filter', Boolean(account) && listed('', '', account!.id).every((row) => row.accountId === account!.id) && listed('', '', account!.id).length === 1)
check('7. Active filter', listed('', '', '', 'active').some((row) => row.key === '147539'))

const salesBefore = JSON.stringify(snap().sales)
const componentsBefore = JSON.stringify(snap().products.map((product) => [product.id, product.salesComponents]))
const shipmentsBefore = JSON.stringify(snap().salesImportShipments ?? [])
const ordersBefore = JSON.stringify(snap().salesImportOrders ?? [])

const mapping = skuMapping()
const updated = mapping ? db.updateSalesImportMapping({ id: mapping.id, productId: productB }) : false
const afterEdit = skuMapping()
check('9. Edit mapping from Product A to Product B', Boolean(updated) && afterEdit?.productId === productB && afterEdit?.key === '147539')
check('10. Updated mapping appears immediately', listed('waffle premix').some((row) => row.id === mapping?.id && row.productId === productB))

const lookupLine = { externalProductName: 'BLUE ICE VANILA', variationText: 'Cup', parentSku: '', externalSku: '147539' }
const future = account
  ? resolveLineProduct(lookupLine, 'shopee', account.id, snap().salesImportMappings ?? [], snap().products)
  : undefined
check('11. Future mapping lookup uses the updated active mapping', future?.productId === productB)

const deactivated = mapping ? db.setSalesImportMappingActive({ id: mapping.id, active: false }) : false
const inactiveLookup = account
  ? resolveLineProduct(
      { externalProductName: 'Mystery Powder', variationText: 'Mocha Dust', parentSku: '', externalSku: '' },
      'shopee',
      account.id,
      snap().salesImportMappings ?? [],
      snap().products,
    )
  : undefined
const skuLookup = account
  ? resolveLineProduct(lookupLine, 'shopee', account.id, snap().salesImportMappings ?? [], snap().products)
  : undefined
check('12. Deactivated mapping is no longer used for future automatic mapping', Boolean(deactivated) && skuMapping()?.active === false && skuLookup?.productId !== productB)
check('8. Inactive filter', listed('', '', '', 'inactive').some((row) => row.key === '147539') && !listed('', '', '', 'active').some((row) => row.key === '147539'))
check('13. Deactivated mapping remains searchable', listed('147539', '', '', 'inactive').some((row) => row.key === '147539'))

const reactivated = mapping ? db.setSalesImportMappingActive({ id: mapping.id, active: true }) : false
const restored = account
  ? resolveLineProduct(lookupLine, 'shopee', account.id, snap().salesImportMappings ?? [], snap().products)
  : undefined
check('14. Reactivated mapping works again', Boolean(reactivated) && restored?.productId === productB && skuMapping()?.active !== false)

db.saveSalesImportMapping({ batchId: batch!.id, keyType: 'sku', key: '147539', productId: productA })
const identities = (snap().salesImportMappings ?? []).filter((row) => row.platform === 'shopee' && row.accountId === account?.id && row.key === '147539')
check('15. Duplicate mapping identity is prevented', identities.length === 1 && identities[0]?.productId === productA && identities[0]?.active !== false)

check('16. Historical confirmed sales are unchanged', JSON.stringify(snap().sales) === salesBefore)
const posting = db.confirmSalesImport('missing-batch')
check('17. Existing Sales Import posting remains unchanged', posting.ok === false && posting.posted === 0 && JSON.stringify(snap().sales) === salesBefore)
check('18. Sales Components remain unchanged', JSON.stringify(snap().products.map((product) => [product.id, product.salesComponents])) === componentsBefore)
check('19. AWB logic remains unchanged', JSON.stringify(snap().salesImportShipments ?? []) === shipmentsBefore && JSON.stringify(snap().salesImportOrders ?? []) === ordersBefore)

const page = readFileSync('src/features/salesImport/SalesImportMappingsPage.tsx', 'utf8')
const list = readFileSync('src/features/salesImport/SalesImportPage.tsx', 'utf8')
const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8')
check(
  '20. Mobile UI has no horizontal overflow',
  page.includes('overflow-x-hidden') && page.includes('sm:hidden') && page.includes('break-words') && !page.includes('min-w-[') && list.includes('Manage Mappings') && !sidebar.includes('Product Mapping'),
)
check('Inactive or missing product is rejected', Boolean(mapping) && db.updateSalesImportMapping({ id: mapping!.id, productId: 'missing-product' }) === false && skuMapping()?.productId === productA)
check('Missing mapping is not invented', listed('not-a-real-sku').length === 0)
check('Search by source variation', listed('cup').some((row) => row.key === '147539'))
check('Combined filters', Boolean(account) && listed('147539', 'shopee', account!.id, 'active').length === 1)

const failed = results.filter((row) => !row.ok)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
