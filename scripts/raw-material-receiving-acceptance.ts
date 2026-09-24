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

const { db } = await import('@/store/db')
const { hasPermission } = await import('@/features/settings/permissions')
const { productHasBom, purchaseQtyToBaseQty } = await import('@/features/products/masterData')
const { receivableRawMaterials } = await import('@/features/receiving/receivingModel')

const TINY_JPG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAD/2Q=='

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function inventoryOf(productId: string, warehouseId = 'wh-main') {
  return db.getSnapshot().inventory.find((row) => row.productId === productId && row.warehouseId === warehouseId)?.qty ?? 0
}

function inventoryFingerprint() {
  return db
    .getSnapshot()
    .inventory.map((row) => `${row.productId}:${row.warehouseId}:${row.qty}`)
    .sort()
    .join('|')
}

db.resetDemo()
db.switchUser('u-admin')

const staffCan = hasPermission(db.getSnapshot(), 'receiving.create', db.getSnapshot().users.find((u) => u.id === 'u-mei'))
const staffCannotLink = !hasPermission(db.getSnapshot(), 'receiving.link_purchase', db.getSnapshot().users.find((u) => u.id === 'u-mei'))
const cashierCannot = !hasPermission(db.getSnapshot(), 'receiving.create', db.getSnapshot().users.find((u) => u.id === 'u-siti'))
const warehouseCan = hasPermission(db.getSnapshot(), 'receiving.create', db.getSnapshot().users.find((u) => u.id === 'u-kumar'))
check('Staff Mei can receive without purchase permission', staffCan && staffCannotLink)
check('Cashier cannot receive', cashierCannot)
check('Warehouse Kumar can receive', warehouseCan)

const materials = receivableRawMaterials(db.getSnapshot())
check(
  'Finished goods with BOM are not receivable',
  materials.every((product) => !productHasBom(db.getSnapshot().boms, product.id)) && materials.some((product) => product.id === 'p-sugar'),
)

db.switchUser('u-siti')
const cashierBlocked = db.createReceiving({
  warehouseId: 'wh-main',
  source: 'shopee',
  items: [{ productId: 'p-sugar', qty: 1 }],
})
check('Cashier API cannot create receiving', cashierBlocked === null)

db.switchUser('u-mei')
const beforeSugar = inventoryOf('p-sugar')
const shopee = db.createReceiving({
  warehouseId: 'wh-main',
  source: 'shopee',
  supplierNote: 'Shopee order 240911',
  items: [{ productId: 'p-sugar', qty: 12, batchNo: 'SG-2409', expiry: '', condition: 'Baik' }],
  photoUrl: TINY_JPG,
  photoName: 'do.jpg',
})
check('Staff can receive without a purchase', Boolean(shopee?.id) && !shopee?.purchaseId, shopee?.receivingNo)
check('Receiving number uses RCV prefix', Boolean(shopee?.receivingNo.startsWith('RCV-')))
check('Stock increased on confirm', inventoryOf('p-sugar') === beforeSugar + 12, `${beforeSugar} → ${inventoryOf('p-sugar')}`)
check(
  'Movement type is receiving not purchase',
  (db.getSnapshot().stockMovements ?? []).some((row) => row.reference === shopee?.receivingNo && row.type === 'receiving' && row.stockIn === 12),
)
check('Photo stored', Boolean(shopee?.photoUrl?.startsWith('data:image/jpeg')))
check('Batch stored when available', shopee?.items[0]?.batchNo === 'SG-2409')
check('Staff receiving has no purchase price field', shopee?.items.every((line) => !('price' in line)))

const missingExpiry = db.createReceiving({
  warehouseId: 'wh-main',
  source: 'direct',
  items: [{ productId: 'p-milkpw', qty: 2 }],
})
check('Expiry required when material tracks expiry', missingExpiry === null)

const milkBefore = inventoryOf('p-milkpw')
const milk = db.createReceiving({
  warehouseId: 'wh-main',
  source: 'direct',
  items: [{ productId: 'p-milkpw', qty: 2, expiry: '2027-03-01', condition: 'Baik' }],
})
check('Direct receiving without purchase still stocks in', Boolean(milk?.id) && inventoryOf('p-milkpw') === milkBefore + 2)

const fg = db.createReceiving({
  warehouseId: 'wh-main',
  source: 'other',
  items: [{ productId: 'p-pack-mt', qty: 1, expiry: '2027-01-01', condition: 'Baik' }],
})
check('Finished goods cannot be received as raw material', fg === null)

db.switchUser('u-admin')
const bag = db.createProduct({
  name: 'Cocoa Bag',
  sku: 'RW-BAG-TEST',
  categoryId: 'cat-ing',
  unit: 'KG',
  purchaseUnit: 'BAG',
  purchaseConversionQty: 25,
  purchaseCost: 450,
  costPrice: 18,
  sellingPrice: 0,
  sellable: false,
})
check('Conversion product created', Boolean(bag?.id))
const bagBefore = inventoryOf(bag!.id)
const bagRecv = db.createReceiving({
  warehouseId: 'wh-main',
  source: 'supplier',
  supplierId: db.getSnapshot().suppliers[0]?.id,
  items: [{ productId: bag!.id, qty: 2, condition: 'Baik' }],
})
const expectedBase = purchaseQtyToBaseQty(2, bag!)
check(
  'Purchase-unit qty converts to base stock',
  bagRecv?.items[0]?.baseQty === expectedBase && inventoryOf(bag!.id) === bagBefore + expectedBase,
  `baseQty=${bagRecv?.items[0]?.baseQty} expected=${expectedBase}`,
)

db.switchUser('u-mei')
const asStaffBag = db.createReceiving({
  warehouseId: 'wh-main',
  source: 'direct',
  items: [{ productId: bag!.id, qty: 1, condition: 'Baik' }],
})
check('Staff can receive conversion material after admin created it', Boolean(asStaffBag?.id))

db.switchUser('u-mei')
const fingerprint = inventoryFingerprint()
const linkedByStaff = db.linkReceivingToPurchase(shopee!.id, db.getSnapshot().purchases[0]?.id ?? 'missing')
check('Staff cannot link purchase', linkedByStaff === false && inventoryFingerprint() === fingerprint)

db.switchUser('u-admin')
const draft = db.createPurchase({
  supplierId: db.getSnapshot().suppliers[0].id,
  warehouseId: 'wh-main',
  invoiceNumber: 'DRAFT-RCV',
  items: [{ productId: 'p-sugar', qty: 1, price: 3.5 }],
  receive: false,
})
check('Draft purchase does not stock in', Boolean(draft?.id) && draft?.status === 'draft')
const afterDraft = inventoryFingerprint()
const linked = db.linkReceivingToPurchase(shopee!.id, draft!.id)
const afterLink = inventoryFingerprint()
check('Admin can link receiving to draft purchase', linked === true)
check('Linking does not change inventory', afterLink === afterDraft)
check(
  'Both records point at each other',
  db.getSnapshot().receivings.find((row) => row.id === shopee!.id)?.purchaseId === draft!.id &&
    db.getSnapshot().purchases.find((row) => row.id === draft!.id)?.receivingId === shopee!.id,
)

db.receivePurchase(draft!.id)
check(
  'Receiving a linked draft purchase does not double stock',
  inventoryFingerprint() === afterLink && db.getSnapshot().purchases.find((row) => row.id === draft!.id)?.status === 'received',
)

const beforeFromReceiving = inventoryFingerprint()
const fromReceiving = db.createPurchase({
  supplierId: db.getSnapshot().suppliers[0].id,
  warehouseId: 'wh-main',
  invoiceNumber: 'ACC-MILK',
  items: [{ productId: 'p-milkpw', qty: 2, price: 16, expiry: '2027-03-01' }],
  receive: true,
  receivingId: milk!.id,
})
check('Create purchase from receiving succeeds', Boolean(fromReceiving?.id) && fromReceiving?.receivingId === milk!.id)
check('Create purchase from receiving does not stock in again', inventoryFingerprint() === beforeFromReceiving)
check(
  'Receiving now shows purchase no',
  db.getSnapshot().receivings.find((row) => row.id === milk!.id)?.purchaseNo === fromReceiving?.purchaseNo,
)

const beforeNormal = inventoryOf('p-sugar')
const normal = db.createPurchase({
  supplierId: db.getSnapshot().suppliers[0].id,
  warehouseId: 'wh-main',
  invoiceNumber: 'NORMAL-PUR',
  items: [{ productId: 'p-sugar', qty: 5, price: 3.5 }],
  receive: true,
})
check(
  'Unlinked purchase still stocks in (regression)',
  Boolean(normal?.id) && inventoryOf('p-sugar') === beforeNormal + 5,
)

const already = db.linkReceivingToPurchase(shopee!.id, normal!.id)
check('Cannot relink a receiving that already has a purchase', already === false)

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => row.name).join('\n'))
  process.exit(1)
}
