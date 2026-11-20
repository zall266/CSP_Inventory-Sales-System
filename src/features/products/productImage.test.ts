import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { defaultPermissionsForLegacy } from '../settings/permissions.ts'
import {
  PRODUCT_IMAGE_ACCEPT,
  PRODUCT_IMAGE_CACHE_MAX,
  PRODUCT_IMAGE_FORBIDDEN,
  PRODUCT_IMAGE_GET_ACTION,
  PRODUCT_IMAGE_HEIC_ERROR,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MISSING,
  PRODUCT_IMAGE_REMOVE_ACTION,
  PRODUCT_IMAGE_REPLACE_ACTION,
  PRODUCT_IMAGE_SIZE_ERROR,
  PRODUCT_IMAGE_TYPE_ERROR,
  PRODUCT_IMAGE_UPLOAD_ACTION,
  clearProductImageCache,
  dropProductImageCache,
  fetchProductImage,
  imageFileIdFromProductSnapshot,
  isDriveProductImageRef,
  isHeicLike,
  loadStoredProductImage,
  mutateProductImage,
  parseProductImage,
  parseProductImagePayload,
  peekProductImageCache,
  productImageCacheKey,
  productImageCacheSize,
  readProductImageFile,
  shouldFetchProductImage,
  storeProductImageCache,
} from './productImage.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP///wA='

function pngFile(name = 'product.png', type = 'image/png') {
  const bytes = Buffer.from(PNG_B64, 'base64')
  return new File([bytes], name, { type })
}

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

test('authorized product editors see Upload Image; cashiers do not', () => {
  const panel = read('features/products/ProductImagePanel.tsx')
  const drawers = read('components/drawers/GlobalDrawers.tsx')
  assert.equal(drawers.includes("hasPermission(state, 'products.edit')"), true)
  assert.equal(drawers.includes('canEdit={hasPermission(state, \'products.edit\')}'), true)
  assert.equal(panel.includes('data-product-image-upload'), true)
  assert.equal(panel.includes('Upload Image'), true)
  assert.equal(panel.includes('{canUpload &&'), true)
  assert.equal(defaultPermissionsForLegacy('owner')['products.edit'], true)
  assert.equal(defaultPermissionsForLegacy('admin')['products.edit'], true)
  assert.equal(defaultPermissionsForLegacy('manager')['products.edit'], true)
  assert.equal(defaultPermissionsForLegacy('staff')['products.edit'], true)
  assert.equal(defaultPermissionsForLegacy('cashier')['products.edit'], false)
  assert.equal(defaultPermissionsForLegacy('warehouse')['products.edit'], true)
})

test('valid image files can be selected and parsed before upload', async () => {
  const png = parseProductImage(PNG_DATA_URL, 'chocolate.png')
  assert.equal(png.ok, true)
  if (png.ok) {
    assert.equal(png.mime, 'image/png')
    assert.equal(png.name, 'chocolate.png')
    assert.equal(png.dataUrl.startsWith('data:image/png;base64,'), true)
  }
  const jpeg = parseProductImage(JPEG_DATA_URL, 'chocolate.jpg')
  assert.equal(jpeg.ok, true)
  const webp = parseProductImage('data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'shot.webp')
  assert.equal(webp.ok, true)
  const selected = await readProductImageFile(pngFile())
  assert.equal(selected.ok, true)
  if (selected.ok) assert.equal(selected.mime, 'image/png')
})

test('unsupported formats and HEIC are rejected with a clear message', async () => {
  const svg = parseProductImage('data:image/svg+xml;base64,PHN2Zy8+', 'x.svg')
  assert.equal(svg.ok, false)
  if (!svg.ok) assert.equal(svg.error, PRODUCT_IMAGE_TYPE_ERROR)
  assert.equal(isHeicLike({ type: 'image/heic', name: 'photo.heic' }), true)
  assert.equal(isHeicLike({ type: '', name: 'photo.HEIF' }), true)
  const heic = await readProductImageFile(new File([new Uint8Array([0, 1, 2])], 'photo.heic', { type: 'image/heic' }))
  assert.equal(heic.ok, false)
  if (!heic.ok) assert.equal(heic.error, PRODUCT_IMAGE_HEIC_ERROR)
  const gif = await readProductImageFile(new File([new Uint8Array([0, 1, 2])], 'anim.gif', { type: 'image/gif' }))
  assert.equal(gif.ok, false)
  if (!gif.ok) assert.equal(gif.error, PRODUCT_IMAGE_TYPE_ERROR)
})

test('oversized images are rejected against the 1MB Phase 3A limit', async () => {
  assert.equal(PRODUCT_IMAGE_MAX_BYTES, 1 * 1024 * 1024)
  const huge = `data:image/jpeg;base64,${'A'.repeat(1_500_000)}`
  const parsed = parseProductImage(huge, 'huge.jpg')
  assert.equal(parsed.ok, false)
  if (!parsed.ok) assert.equal(parsed.error, PRODUCT_IMAGE_SIZE_ERROR)
  const oversized = await readProductImageFile(new File([new Uint8Array(2 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' }))
  assert.equal(oversized.ok, false)
  if (!oversized.ok) assert.equal(oversized.error, PRODUCT_IMAGE_SIZE_ERROR)
})

test('preview appears before upload and cancel does not call the API', () => {
  const panel = read('features/products/ProductImagePanel.tsx')
  assert.equal(panel.includes("title={preview?.mode === 'replace' ? 'Replace product image' : 'Upload product image'}"), true)
  assert.equal(panel.includes('data-product-image-preview={preview.mode}'), true)
  assert.equal(panel.includes('setPreview(null)'), true)
  assert.equal(panel.includes('Cancel'), true)
  assert.equal(panel.includes("if (!saved.ok) return"), true)
  assert.equal(panel.includes('api.uploadProductImage'), true)
  assert.equal(panel.includes('confirmPreview'), true)
  assert.equal(panel.includes("pickModeRef.current = mode"), true)
})

test('successful upload refreshes the image; failed upload keeps ProductMark', () => {
  const db = read('store/db.ts')
  const panel = read('features/products/ProductImagePanel.tsx')
  assert.equal(db.includes('this.applyProductImageFileId(productId, imageFileId)'), true)
  assert.equal(db.includes('storeProductImageCache(productId, imageFileId'), true)
  assert.equal(db.includes("toast('Product image uploaded')"), true)
  assert.equal(db.includes("toast('Could not upload product image'"), true)
  assert.equal(db.includes('return { ok: false as const }'), true)
  assert.equal(panel.includes('<ProductMark product={product} size="lg" />'), true)
  assert.equal(panel.includes('const canUpload = canEdit && !imageFileId'), true)
  assert.equal(panel.includes("if (!saved.ok) return"), true)
})

test('replace action is authorized-only, requires preview confirmation, and preserves the old image on failure', () => {
  const panel = read('features/products/ProductImagePanel.tsx')
  const db = read('store/db.ts')
  assert.equal(panel.includes('{canMutateExisting &&'), true)
  assert.equal(panel.includes('Replace Image'), true)
  assert.equal(panel.includes("pickImage('replace')"), true)
  assert.equal(panel.includes('api.replaceProductImage'), true)
  assert.equal(db.includes('PRODUCT_IMAGE_REPLACE_ACTION'), true)
  assert.equal(db.includes("toast('Could not replace product image'"), true)
  assert.equal(db.includes("toast('Product image replaced')"), true)
  const replaceFn = db.slice(db.indexOf('async replaceProductImage'), db.indexOf('async removeProductImage'))
  assert.equal(replaceFn.includes('applyProductImageFileId'), true)
  assert.equal(replaceFn.includes("if (!result.ok)"), true)
  assert.equal(replaceFn.includes('dropProductImageCache'), false)
})

test('remove action is authorized-only, requires confirmation, and preserves the image on failure', () => {
  const panel = read('features/products/ProductImagePanel.tsx')
  const db = read('store/db.ts')
  assert.equal(panel.includes('Remove Image'), true)
  assert.equal(panel.includes('setRemoveOpen(true)'), true)
  assert.equal(panel.includes('data-product-image-confirm-remove'), true)
  assert.equal(panel.includes('This will remove the product image.'), true)
  assert.equal(panel.includes('api.removeProductImage'), true)
  assert.equal(db.includes('dropProductImageCache(productId)'), true)
  assert.equal(db.includes("toast('Product image removed')"), true)
  assert.equal(db.includes("toast('Could not remove product image'"), true)
  const removeFn = db.slice(db.indexOf('async removeProductImage'), db.indexOf('createCategory'))
  assert.equal(removeFn.includes("if (!result.ok)"), true)
  assert.equal(removeFn.includes('applyProductImageFileId(productId, undefined)'), true)
  const failReturn = removeFn.indexOf("toast('Could not remove product image'")
  const clearCall = removeFn.indexOf('applyProductImageFileId(productId, undefined)')
  assert.equal(failReturn > -1 && clearCall > failReturn, true)
})

test('image retrieval uses products.getImage only when Product Details needs it', async () => {
  const panel = read('features/products/ProductImagePanel.tsx')
  const db = read('store/db.ts')
  const pos = read('features/pos/PosPage.tsx')
  const productsPage = read('features/products/ProductsPage.tsx')
  assert.equal(PRODUCT_IMAGE_GET_ACTION, 'products.getImage')
  assert.equal(panel.includes('fetchProductImage'), true)
  assert.equal(panel.includes('loadStoredProductImage'), true)
  assert.equal(db.includes("queueProductWrite('products.list'"), false)
  assert.equal(db.includes("queueProductWrite('products.uploadImage'"), false)
  assert.equal(pos.includes('products.getImage'), false)
  assert.equal(productsPage.includes('products.getImage'), false)
  assert.equal(productsPage.includes('uploadImage'), false)
  let fetched = 0
  const payload = {
    productId: 'p-cp',
    fileName: 'p-cp.png',
    mimeType: 'image/png',
    dataUrl: PNG_DATA_URL,
  }
  clearProductImageCache()
  const first = await loadStoredProductImage({
    productId: 'p-cp',
    imageFileId: 'driveFileId123456',
    actorUserId: 'u-admin',
    requestId: 1,
    isCurrent: () => true,
    fetchImage: async () => {
      fetched += 1
      return { ok: true, data: payload, error: null }
    },
  })
  const second = await loadStoredProductImage({
    productId: 'p-cp',
    imageFileId: 'driveFileId123456',
    actorUserId: 'u-admin',
    requestId: 2,
    isCurrent: () => true,
    fetchImage: async () => {
      fetched += 1
      return { ok: true, data: payload, error: null }
    },
  })
  assert.equal(first.status, 'ready')
  assert.equal(second.status, 'ready')
  assert.equal(fetched, 1)
  assert.equal(shouldFetchProductImage('driveFileId123456'), true)
  assert.equal(isDriveProductImageRef('data:image/png;base64,xx'), false)
})

test('failed or missing retrieval does not retry forever and falls back to ProductMark', async () => {
  const panel = read('features/products/ProductImagePanel.tsx')
  assert.equal(panel.includes("setView({ status: 'error', error: PRODUCT_IMAGE_LOAD_ERROR })"), true)
  assert.equal(panel.includes('Try again'), true)
  assert.equal(panel.includes('<ProductMark product={product} size="lg" />'), true)
  clearProductImageCache()
  const missing = await loadStoredProductImage({
    productId: 'p-cp',
    imageFileId: 'driveFileId123456',
    actorUserId: 'u-admin',
    requestId: 3,
    isCurrent: () => true,
    fetchImage: async () => ({ ok: false, data: null, error: { code: 'NOT_FOUND', message: PRODUCT_IMAGE_MISSING } }),
  })
  assert.equal(missing.status, 'missing')
  const forbidden = await loadStoredProductImage({
    productId: 'p-cp',
    imageFileId: 'driveFileId123456',
    actorUserId: 'u-siti',
    requestId: 4,
    isCurrent: () => true,
    fetchImage: async () => ({ ok: false, data: null, error: { code: 'FORBIDDEN', message: PRODUCT_IMAGE_FORBIDDEN } }),
  })
  assert.equal(forbidden.status, 'forbidden')
})

test('cache keys stay per product and image file id, and can be dropped after removal', () => {
  clearProductImageCache()
  const payload = { productId: 'p-cp', fileName: 'p-cp.png', mimeType: 'image/png', dataUrl: PNG_DATA_URL }
  storeProductImageCache('p-cp', 'file-a', payload)
  storeProductImageCache('p-mt', 'file-b', { ...payload, productId: 'p-mt' })
  assert.equal(productImageCacheKey('p-cp', 'file-a'), 'p-cp::file-a')
  assert.equal(Boolean(peekProductImageCache('p-cp', 'file-a')), true)
  dropProductImageCache('p-cp')
  assert.equal(peekProductImageCache('p-cp', 'file-a'), undefined)
  assert.equal(Boolean(peekProductImageCache('p-mt', 'file-b')), true)
  for (let i = 0; i < PRODUCT_IMAGE_CACHE_MAX + 3; i += 1) {
    storeProductImageCache(`p-${i}`, `file-${i}`, { ...payload, productId: `p-${i}` })
  }
  assert.equal(productImageCacheSize() <= PRODUCT_IMAGE_CACHE_MAX, true)
  clearProductImageCache()
})

test('upload and replace APIs send data URLs through dedicated actions, never products.list', async () => {
  const actions: string[] = []
  const snapshot = { products: [{ id: 'p-cp', imageFileId: 'file-new-1234567890' }] }
  const uploaded = await mutateProductImage(
    PRODUCT_IMAGE_UPLOAD_ACTION,
    { productId: 'p-cp', dataUrl: PNG_DATA_URL, fileName: 'chocolate.png', actorUserId: 'u-admin' },
    async (action, payload) => {
      actions.push(action)
      assert.equal(typeof payload.dataUrl, 'string')
      assert.equal(String(payload.dataUrl).startsWith('data:image/'), true)
      return { ok: true, data: snapshot, error: null }
    },
  )
  assert.equal(uploaded.ok, true)
  assert.equal(imageFileIdFromProductSnapshot(uploaded.data, 'p-cp'), 'file-new-1234567890')
  const listed = await fetchProductImage('p-cp', 'u-admin', async (action, payload) => {
    actions.push(action)
    assert.equal(payload.productId, 'p-cp')
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'dataUrl'), false)
    return { ok: true, data: parseProductImagePayload({ productId: 'p-cp', fileName: 'p-cp.png', mimeType: 'image/png', dataUrl: PNG_DATA_URL }), error: null }
  })
  assert.equal(listed.ok, true)
  assert.deepEqual(actions, [PRODUCT_IMAGE_UPLOAD_ACTION, PRODUCT_IMAGE_GET_ACTION])
  assert.equal(PRODUCT_IMAGE_UPLOAD_ACTION, 'products.uploadImage')
  assert.equal(PRODUCT_IMAGE_REPLACE_ACTION, 'products.replaceImage')
  assert.equal(PRODUCT_IMAGE_REMOVE_ACTION, 'products.removeImage')
  const db = read('store/db.ts')
  const productSync = read('store/productSync.ts')
  assert.equal(productSync.includes("'products.list'"), true)
  assert.equal(db.includes("queueProductWrite('products.uploadImage'"), false)
  assert.equal(db.includes('PRODUCT_IMAGE_UPLOAD_ACTION'), true)
  assert.equal(db.includes('dataUrl: parsed.dataUrl'), true)
})

test('failed replacement keeps the previous cached image', async () => {
  clearProductImageCache()
  const oldPayload = { productId: 'p-cp', fileName: 'old.png', mimeType: 'image/png', dataUrl: PNG_DATA_URL }
  storeProductImageCache('p-cp', 'file-old-1234567890', oldPayload)
  const failed = await mutateProductImage(
    PRODUCT_IMAGE_REPLACE_ACTION,
    { productId: 'p-cp', dataUrl: PNG_DATA_URL, fileName: 'new.png', actorUserId: 'u-admin' },
    async () => ({ ok: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Drive failed' } }),
  )
  assert.equal(failed.ok, false)
  assert.equal(peekProductImageCache('p-cp', 'file-old-1234567890')?.fileName, 'old.png')
})

test('Product Details tabs, Overview, Stock Card, Batches, and Production remain unchanged', () => {
  const drawers = read('components/drawers/GlobalDrawers.tsx')
  assert.equal(drawers.includes("{ id: 'overview', label: 'Overview' }"), true)
  assert.equal(drawers.includes("{ id: 'card', label: 'Stock Card' }"), true)
  assert.equal(drawers.includes("{ id: 'batches', label: 'Batches' }"), true)
  assert.equal(drawers.includes("{ id: 'production', label: 'Production' }"), true)
  assert.equal(drawers.includes("{tab === 'overview' &&"), true)
  assert.equal(drawers.includes("{tab === 'card' &&"), true)
  assert.equal(drawers.includes("{tab === 'batches' &&"), true)
  assert.equal(drawers.includes("{tab === 'production' &&"), true)
  assert.equal(drawers.includes('<AgentPriceEditor'), true)
  assert.equal(drawers.includes('<ProductForm'), true)
  assert.equal(drawers.includes('Stock Card'), true)
})

test('ProductMark, POS, Agent POS, RecipePhotos, and sales/stock behaviour stay unchanged', () => {
  const mark = read('components/ProductMark.tsx')
  const pos = read('features/pos/PosPage.tsx')
  const recipe = read('features/manufacturing/recipePhoto.ts')
  const recipeUi = read('features/manufacturing/RecipeSheetEvidence.tsx')
  const db = read('store/db.ts')
  const panel = read('features/products/ProductImagePanel.tsx')
  assert.equal(mark.includes('initials(product.name)'), true)
  assert.equal(mark.includes('getImage'), false)
  assert.equal(mark.includes('imageFileId'), false)
  assert.equal(pos.includes('<ProductMark product={p} size="xl" />'), true)
  assert.equal(pos.includes('products.getImage'), false)
  assert.equal(pos.includes('uploadImage'), false)
  assert.equal(pos.includes('api.createSale({'), true)
  assert.equal(pos.includes('api.createAgentSale({'), true)
  assert.equal(recipe.includes('sessions.getRecipePhoto'), true)
  assert.equal(recipe.includes('products.getImage'), false)
  assert.equal(recipe.includes('ProductImages'), false)
  assert.equal(recipeUi.includes('fetchSessionRecipePhoto'), true)
  assert.equal(recipeUi.includes('products.getImage'), false)
  assert.equal(db.includes('createSale'), true)
  assert.equal(db.includes('createAgentSale'), true)
  assert.equal(db.includes("queueProductWrite('products.create'"), true)
  assert.equal(panel.includes('recipePhoto'), false)
  assert.equal(panel.includes('sessions.getRecipePhoto'), false)
  assert.equal(panel.includes('object-cover'), true)
  assert.equal(panel.includes('object-contain'), true)
  assert.equal(PRODUCT_IMAGE_ACCEPT.includes('image/jpeg'), true)
  assert.equal(PRODUCT_IMAGE_ACCEPT.includes('heic'), false)
})

test('mobile Product Details header stays compact and touch-friendly', () => {
  const panel = read('features/products/ProductImagePanel.tsx')
  const drawers = read('components/drawers/GlobalDrawers.tsx')
  assert.equal(panel.includes('min-h-10'), true)
  assert.equal(panel.includes('min-w-0'), true)
  assert.equal(panel.includes('h-16 w-16'), true)
  assert.equal(panel.includes('flex-wrap'), true)
  assert.equal(drawers.includes('ProductImageHeader'), true)
  assert.equal(drawers.includes('<ProductMark product={item} size="lg" />'), false)
})
