import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { defaultPermissionsForLegacy } from '../settings/permissions.ts'
import {
  PRODUCT_IMAGE_CACHE_MAX,
  PRODUCT_IMAGE_GET_ACTION,
  PRODUCT_IMAGE_MISSING,
  clearProductImageCache,
  loadStoredProductImage,
  peekProductImageCache,
  shouldFetchProductImage,
  storeProductImageCache,
} from './productImage.ts'
import {
  POS_IMAGE_AB_PREVIEWS,
  parsePosImageAbVariant,
  posImageAbFit,
  posImageAbPreviewUrl,
} from '../pos/posImageAb.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

const payload = {
  productId: 'p-cp',
  fileName: 'p-cp.png',
  mimeType: 'image/png',
  dataUrl: PNG_DATA_URL,
}

test('Products listing shows a thumb beside the name and keeps ProductMark as fallback', () => {
  const productsPage = read('features/products/ProductsPage.tsx')
  const thumb = read('features/products/ProductImageThumb.tsx')
  const listing = productsPage.slice(0, productsPage.indexOf('export function RawMaterialsPage'))
  assert.equal(listing.includes('<ProductImageThumb product={p} size="sm" />'), true)
  assert.equal(listing.includes('<span className="font-medium">{p.name}</span>'), true)
  assert.equal(listing.includes('api.openDrawer({ type: \'product\', id: p.id })'), true)
  assert.equal(listing.includes('api.setProductStatus'), true)
  assert.equal(listing.includes('Search product or SKU'), true)
  assert.equal(listing.includes('All categories'), true)
  assert.equal(listing.includes('sf-table-wrap'), true)
  assert.equal(productsPage.includes('<ProductMark product={product} size="sm" />'), true)
  assert.equal(thumb.includes('<ProductMark product={product} size={size} />'), true)
  assert.equal(thumb.includes('onError={() => setDataUrl(\'\')}'), true)
  assert.equal(thumb.includes('imageFileId'), true)
  assert.equal(thumb.includes('alt=""'), true)
  assert.equal(thumb.includes('drive.google'), false)
  assert.equal(thumb.includes('imageUrl'), false)
})

test('POS catalogue cards show thumbs; cart, qty, price, and sales stay unchanged', () => {
  const pos = read('features/pos/PosPage.tsx')
  const thumb = read('features/products/ProductImageThumb.tsx')
  assert.equal(pos.includes('<ProductImageThumb'), true)
  assert.equal(pos.includes('size="xl"'), true)
  assert.equal(pos.includes('presentation={posImagePresentation}'), true)
  assert.equal(pos.includes('{p.name}'), true)
  assert.equal(pos.includes('{p.sku}'), true)
  assert.equal(pos.includes('p.sellingPrice'), true)
  assert.equal(pos.includes('getProductStockStatus'), true)
  assert.equal(pos.includes('QtyControl'), true)
  assert.equal(pos.includes('<ProductMark product={product} size="md" />'), true)
  assert.equal(pos.includes('api.createSale({'), true)
  assert.equal(pos.includes('api.createAgentSale({'), true)
  assert.equal(pos.includes('products.getImage'), false)
  assert.equal(pos.includes('products.list'), false)
  assert.equal(pos.includes('Drive'), false)
  assert.equal(thumb.includes('h-[4.75rem] w-full rounded-2xl'), true)
  assert.equal(pos.includes('grid min-w-0 grid-cols-2'), true)
  assert.equal(pos.includes('md:grid-cols-3'), true)
  assert.equal(pos.includes('xl:grid-cols-4'), true)
})

test('cashier POS can view images through sales.create; listing uses the same getImage action', () => {
  assert.equal(PRODUCT_IMAGE_GET_ACTION, 'products.getImage')
  assert.equal(defaultPermissionsForLegacy('cashier')['sales.create'], true)
  assert.equal(defaultPermissionsForLegacy('cashier')['products.edit'], false)
  assert.equal(defaultPermissionsForLegacy('admin')['products.edit'], true)
  const service = fs.readFileSync(path.join(root, '../apps-script/services/productService.js'), 'utf8')
  assert.equal(service.includes("var PRODUCT_IMAGE_GET_KEYS = ['sales.create', 'agent.sale.create', 'products.edit']"), true)
  const pos = read('features/pos/PosPage.tsx')
  const productsPage = read('features/products/ProductsPage.tsx')
  assert.equal(pos.includes('ProductImageThumb'), true)
  assert.equal(productsPage.includes('ProductImageThumb'), true)
})

test('products without an image file id never fetch', async () => {
  clearProductImageCache()
  let fetched = 0
  const missing = await loadStoredProductImage({
    productId: 'p-mt',
    imageFileId: '',
    actorUserId: 'u-siti',
    requestId: 1,
    isCurrent: () => true,
    fetchImage: async () => {
      fetched += 1
      return { ok: true, data: payload, error: null }
    },
  })
  assert.equal(shouldFetchProductImage(undefined), false)
  assert.equal(missing.status, 'missing')
  assert.equal(fetched, 0)
})

test('product with an image reuses the cache and coalesces in-flight getImage calls', async () => {
  clearProductImageCache()
  let fetched = 0
  const fetchImage = async () => {
    fetched += 1
    await new Promise((resolve) => setTimeout(resolve, 20))
    return { ok: true, data: payload, error: null }
  }
  const [first, second] = await Promise.all([
    loadStoredProductImage({
      productId: 'p-cp',
      imageFileId: 'driveFileId123456',
      actorUserId: 'u-siti',
      requestId: 11,
      isCurrent: () => true,
      fetchImage,
    }),
    loadStoredProductImage({
      productId: 'p-cp',
      imageFileId: 'driveFileId123456',
      actorUserId: 'u-siti',
      requestId: 12,
      isCurrent: () => true,
      fetchImage,
    }),
  ])
  const third = await loadStoredProductImage({
    productId: 'p-cp',
    imageFileId: 'driveFileId123456',
    actorUserId: 'u-siti',
    requestId: 13,
    isCurrent: () => true,
    fetchImage,
  })
  assert.equal(first.status, 'ready')
  assert.equal(second.status, 'ready')
  assert.equal(third.status, 'ready')
  assert.equal(fetched, 1)
  assert.equal(Boolean(peekProductImageCache('p-cp', 'driveFileId123456')), true)
})

test('image retrieval failure and a broken loaded image both fall back to ProductMark', async () => {
  const thumb = read('features/products/ProductImageThumb.tsx')
  assert.equal(thumb.includes('<ProductMark product={product} size={size} />'), true)
  assert.equal(thumb.includes('onError={() => setDataUrl(\'\')}'), true)
  assert.equal(thumb.includes("setDataUrl('')"), true)
  clearProductImageCache()
  const failed = await loadStoredProductImage({
    productId: 'p-cp',
    imageFileId: 'driveFileId123456',
    actorUserId: 'u-siti',
    requestId: 21,
    isCurrent: () => true,
    fetchImage: async () => ({ ok: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Drive failed' } }),
  })
  assert.equal(failed.status, 'error')
  assert.equal(peekProductImageCache('p-cp', 'driveFileId123456'), undefined)
  const missing = await loadStoredProductImage({
    productId: 'p-cp',
    imageFileId: 'driveFileId123456',
    actorUserId: 'u-siti',
    requestId: 22,
    isCurrent: () => true,
    fetchImage: async () => ({ ok: false, data: null, error: { code: 'NOT_FOUND', message: PRODUCT_IMAGE_MISSING } }),
  })
  assert.equal(missing.status, 'missing')
})

test('stale product changes do not apply the previous image, and the fetched payload stays cached', async () => {
  clearProductImageCache()
  let currentId = 31
  const stale = await loadStoredProductImage({
    productId: 'p-cp',
    imageFileId: 'file-old-1234567890',
    actorUserId: 'u-admin',
    requestId: 31,
    isCurrent: (id) => id === currentId,
    fetchImage: async () => {
      currentId = 32
      return { ok: true, data: { ...payload, fileName: 'old.png' }, error: null }
    },
  })
  assert.equal(stale.status, 'error')
  assert.equal(peekProductImageCache('p-cp', 'file-old-1234567890')?.fileName, 'old.png')
  storeProductImageCache('p-cp', 'file-new-1234567890', { ...payload, fileName: 'new.png' })
  const next = await loadStoredProductImage({
    productId: 'p-cp',
    imageFileId: 'file-new-1234567890',
    actorUserId: 'u-admin',
    requestId: 32,
    isCurrent: () => true,
    fetchImage: async () => {
      throw new Error('should use cache')
    },
  })
  assert.equal(next.status, 'ready')
  assert.equal(next.payload?.fileName, 'new.png')
})

test('lazy thumbs observe visibility and listing/POS keep existing responsive frames', () => {
  const thumb = read('features/products/ProductImageThumb.tsx')
  const pos = read('features/pos/PosPage.tsx')
  const productsPage = read('features/products/ProductsPage.tsx')
  assert.equal(thumb.includes('IntersectionObserver'), true)
  assert.equal(thumb.includes("rootMargin: '180px 0px'"), true)
  assert.equal(thumb.includes('h-9 w-9 rounded-xl'), true)
  assert.equal(thumb.includes('h-[4.75rem] w-full rounded-2xl'), true)
  assert.equal(pos.includes('overflow-x-clip'), true)
  assert.equal(pos.includes('grid min-w-0 grid-cols-2'), true)
  assert.equal(pos.includes('pb-[calc(8.75rem+env(safe-area-inset-bottom))]'), true)
  assert.equal(productsPage.includes('sf-table-wrap'), true)
  assert.equal(PRODUCT_IMAGE_CACHE_MAX >= 64, true)
})

test('POS image A/B uses a 1:1 frame; default catalogue stays Phase 3C cover', () => {
  const thumb = read('features/products/ProductImageThumb.tsx')
  const pos = read('features/pos/PosPage.tsx')
  assert.equal(parsePosImageAbVariant(null), null)
  assert.equal(parsePosImageAbVariant('a'), 'a')
  assert.equal(parsePosImageAbVariant('b'), 'b')
  assert.equal(posImageAbFit('a'), 'contain')
  assert.equal(posImageAbFit('b'), 'cover')
  assert.equal(pos.includes("searchParams.get('posImage')"), true)
  assert.equal(pos.includes('data-pos-image-ab={posImageAb || \'default\'}'), true)
  assert.equal(thumb.includes("presentation === 'square-contain' ? 'object-contain' : 'object-cover'"), true)
  assert.equal(thumb.includes('aspect-square w-full'), true)
  assert.equal(thumb.includes('bg-white p-2.5'), true)
  assert.equal(thumb.includes("data-pos-image-fit={presentation === 'square-contain' ? 'contain' : 'cover'}"), true)
  assert.equal(thumb.includes('h-[4.75rem] w-full rounded-2xl'), true)
  assert.equal(thumb.includes('h-full w-full object-cover'), true)
  assert.equal(pos.includes('api.createSale({'), true)
  assert.equal(pos.includes('api.createAgentSale({'), true)
  assert.equal(POS_IMAGE_AB_PREVIEWS['p-mt']?.shape, 'portrait')
  assert.equal(POS_IMAGE_AB_PREVIEWS['p-st']?.shape, 'landscape')
  assert.equal(POS_IMAGE_AB_PREVIEWS['p-wf']?.shape, 'square')
  assert.equal(Boolean(posImageAbPreviewUrl('p-cp')), false)
  assert.equal(pos.includes('products.uploadImage'), false)
  assert.equal(pos.includes('products.replaceImage'), false)
  assert.equal(pos.includes('import.meta.env.DEV'), true)
})
