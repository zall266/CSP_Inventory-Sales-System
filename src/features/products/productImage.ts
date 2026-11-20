/** Product Details image management. Mirrors Phase 3A products.*Image limits. Isolated from recipe photos. */

export const PRODUCT_IMAGE_MAX_BYTES = 1 * 1024 * 1024
export const PRODUCT_IMAGE_MAX_EDGE = 800
export const PRODUCT_IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'
export const PRODUCT_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
export const PRODUCT_IMAGE_HEIC_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
])

export const PRODUCT_IMAGE_TYPE_ERROR = 'Choose a JPG, JPEG, PNG, or WebP image.'
export const PRODUCT_IMAGE_SIZE_ERROR = 'Use a JPG, PNG, or WebP image up to 1 MB.'
export const PRODUCT_IMAGE_HEIC_ERROR =
  'HEIC photos are not supported. Save the image as JPG, PNG, or WebP and try again.'
export const PRODUCT_IMAGE_READ_ERROR = 'The image could not be read. Choose another JPG, PNG, or WebP file.'
export const PRODUCT_IMAGE_MISSING = 'Product image was not found.'
export const PRODUCT_IMAGE_FORBIDDEN = 'You cannot view this product image.'
export const PRODUCT_IMAGE_LOAD_ERROR = 'The product image could not be loaded. Try again.'
export const PRODUCT_IMAGE_API_MISSING = 'The product image API is not connected.'
export const PRODUCT_IMAGE_SAVE_ERROR = 'Could not save the product image.'
export const PRODUCT_IMAGE_PERMISSION_ERROR = 'You cannot change product images.'

export const PRODUCT_IMAGE_GET_ACTION = 'products.getImage'
export const PRODUCT_IMAGE_UPLOAD_ACTION = 'products.uploadImage'
export const PRODUCT_IMAGE_REPLACE_ACTION = 'products.replaceImage'
export const PRODUCT_IMAGE_REMOVE_ACTION = 'products.removeImage'

export type ProductImageReady = {
  ok: true
  dataUrl: string
  name: string
  mime: string
  bytes: number
}

export type ProductImageFailure = {
  ok: false
  error: string
}

export type ProductImageResult = ProductImageReady | ProductImageFailure

export type ProductImagePayload = {
  productId: string
  fileName: string
  mimeType: string
  dataUrl: string
}

export type ProductImageEnvelope = {
  ok: boolean
  data: unknown
  error: { code: string; message: string } | null
}

export type ProductImageLoadStatus = 'ready' | 'missing' | 'forbidden' | 'error'

export type ProductImageLoadResult = {
  requestId: number
  status: ProductImageLoadStatus
  payload?: ProductImagePayload
  error?: string
}

type ProductImageFetcher = (productId: string, actorUserId: string) => Promise<ProductImageEnvelope>
type ProductImagePoster = (
  action: string,
  payload: Record<string, unknown>,
) => Promise<{
  ok: boolean
  data: unknown
  error: { code: string; message: string } | null
}>

export const PRODUCT_IMAGE_CACHE_MAX = 8

const productImageCache = new Map<string, ProductImagePayload>()

function normalizeMime(type: string) {
  const mime = type.toLowerCase()
  return mime === 'image/jpg' ? 'image/jpeg' : mime
}

export function isHeicLike(file: Pick<File, 'type' | 'name'>) {
  const mime = normalizeMime(file.type)
  const name = file.name.toLowerCase()
  return PRODUCT_IMAGE_HEIC_TYPES.has(mime) || name.endsWith('.heic') || name.endsWith('.heif')
}

export function isDriveProductImageRef(value: string | undefined | null) {
  if (!value) return false
  if (value.startsWith('data:')) return false
  if (value.includes('/') || value.includes(' ') || value.includes(':')) return false
  return /^[a-zA-Z0-9_-]{10,}$/.test(value)
}

export function isPreviewableProductImage(value: string | undefined | null) {
  return Boolean(value) && value!.startsWith('data:image/')
}

export function parseProductImage(value: unknown, fileName?: string): ProductImageResult {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) {
    return { ok: false, error: PRODUCT_IMAGE_TYPE_ERROR }
  }
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/)
  if (!match) return { ok: false, error: PRODUCT_IMAGE_TYPE_ERROR }
  const mime = normalizeMime(match[1])
  if (!PRODUCT_IMAGE_TYPES.has(mime)) return { ok: false, error: PRODUCT_IMAGE_TYPE_ERROR }
  const b64 = match[2].replace(/\s/g, '')
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  const bytes = Math.floor((b64.length * 3) / 4) - padding
  if (!(bytes > 0) || bytes > PRODUCT_IMAGE_MAX_BYTES) {
    return { ok: false, error: PRODUCT_IMAGE_SIZE_ERROR }
  }
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  const name = fileName?.trim() || `product.${extension}`
  return { ok: true, dataUrl: `data:${mime};base64,${b64}`, name, mime, bytes }
}

export function jpegNameFrom(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, '').trim() || 'product'
  return `${base}.jpg`
}

export function openProductImagePicker(input: HTMLInputElement | null) {
  if (!input) return
  input.value = ''
  input.click()
}

function bytesToDataUrl(mime: string, bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

async function fileToDataUrl(file: Blob, mime: string) {
  const buffer = await file.arrayBuffer()
  return bytesToDataUrl(mime, new Uint8Array(buffer))
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('image'))
      return
    }
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('image'))
    image.src = src
  })
}

async function canvasToJpegDataUrl(image: CanvasImageSource, width: number, height: number, quality: number) {
  if (typeof document === 'undefined') throw new Error('canvas')
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

function scaledSize(width: number, height: number, maxEdge = PRODUCT_IMAGE_MAX_EDGE) {
  const edge = Math.max(width, height)
  if (!(edge > maxEdge)) return { width, height }
  const scale = maxEdge / edge
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function decodeBitmap(file: Blob) {
  if (typeof createImageBitmap !== 'function') return null
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  } catch {
    return createImageBitmap(file)
  }
}

async function compressToJpegDataUrl(file: Blob, quality: number, maxEdge: number) {
  const bitmap = await decodeBitmap(file)
  if (bitmap) {
    const size = scaledSize(bitmap.width, bitmap.height, maxEdge)
    const dataUrl = await canvasToJpegDataUrl(bitmap, size.width, size.height, quality)
    bitmap.close?.()
    return dataUrl
  }
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await loadImageElement(objectUrl)
    const size = scaledSize(image.naturalWidth || image.width, image.naturalHeight || image.height, maxEdge)
    return canvasToJpegDataUrl(image, size.width, size.height, quality)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function compressUntilLimit(file: Blob, name: string): Promise<ProductImageResult> {
  let quality = 0.82
  let maxEdge = PRODUCT_IMAGE_MAX_EDGE
  let lastError = PRODUCT_IMAGE_SIZE_ERROR
  while (maxEdge >= 480) {
    quality = 0.82
    while (quality >= 0.5) {
      try {
        const dataUrl = await compressToJpegDataUrl(file, quality, maxEdge)
        const parsed = parseProductImage(dataUrl, jpegNameFrom(name))
        if (parsed.ok) return parsed
        lastError = PRODUCT_IMAGE_SIZE_ERROR
      } catch {
        lastError = PRODUCT_IMAGE_READ_ERROR
        return { ok: false, error: lastError }
      }
      quality -= 0.12
    }
    maxEdge -= 160
  }
  return { ok: false, error: lastError }
}

export async function readProductImageFile(file: File | undefined | null): Promise<ProductImageResult> {
  if (!file) return { ok: false, error: '' }
  if (isHeicLike(file)) return { ok: false, error: PRODUCT_IMAGE_HEIC_ERROR }
  const mime = normalizeMime(file.type)
  const name = file.name.toLowerCase()
  const extOk = ['.png', '.jpg', '.jpeg', '.webp'].some((ext) => name.endsWith(ext))
  const typeOk = PRODUCT_IMAGE_TYPES.has(mime) || ((!file.type || file.type === 'application/octet-stream') && extOk)
  if (!typeOk) return { ok: false, error: PRODUCT_IMAGE_TYPE_ERROR }
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    const compressed = await compressUntilLimit(file, file.name)
    if (compressed.ok) return compressed
    return { ok: false, error: PRODUCT_IMAGE_SIZE_ERROR }
  }
  try {
    const dataUrl = await fileToDataUrl(file, PRODUCT_IMAGE_TYPES.has(mime) ? mime : 'image/jpeg')
    const parsed = parseProductImage(dataUrl, file.name)
    if (parsed.ok) return parsed
    const compressed = await compressUntilLimit(file, file.name)
    if (compressed.ok) return compressed
    return { ok: false, error: parsed.error || PRODUCT_IMAGE_SIZE_ERROR }
  } catch {
    return { ok: false, error: PRODUCT_IMAGE_READ_ERROR }
  }
}

export function productImageCacheKey(productId: string, imageFileId: string) {
  return `${productId}::${imageFileId}`
}

export function clearProductImageCache() {
  productImageCache.clear()
}

export function productImageCacheSize() {
  return productImageCache.size
}

export function productImageCacheKeys() {
  return Array.from(productImageCache.keys())
}

export function peekProductImageCache(productId: string, imageFileId: string) {
  return productImageCache.get(productImageCacheKey(productId, imageFileId))
}

function takeProductImageCache(productId: string, imageFileId: string) {
  const key = productImageCacheKey(productId, imageFileId)
  const cached = productImageCache.get(key)
  if (!cached) return undefined
  productImageCache.delete(key)
  productImageCache.set(key, cached)
  return cached
}

function evictProductImageCacheOverflow() {
  while (productImageCache.size > PRODUCT_IMAGE_CACHE_MAX) {
    const oldest = productImageCache.keys().next().value
    if (!oldest) break
    productImageCache.delete(oldest)
  }
}

export function dropProductImageCache(productId: string) {
  const prefix = `${productId}::`
  for (const existing of Array.from(productImageCache.keys())) {
    if (existing.startsWith(prefix)) productImageCache.delete(existing)
  }
}

export function storeProductImageCache(productId: string, imageFileId: string, payload: ProductImagePayload) {
  dropProductImageCache(productId)
  productImageCache.set(productImageCacheKey(productId, imageFileId), payload)
  evictProductImageCacheOverflow()
}

export function shouldFetchProductImage(value: string | undefined | null) {
  return isDriveProductImageRef(value)
}

export function parseProductImagePayload(data: unknown): ProductImagePayload | null {
  if (!data || typeof data !== 'object') return null
  const row = data as Record<string, unknown>
  if (typeof row.productId !== 'string' || typeof row.dataUrl !== 'string' || typeof row.mimeType !== 'string') return null
  const parsed = parseProductImage(row.dataUrl, typeof row.fileName === 'string' ? row.fileName : undefined)
  if (!parsed.ok) return null
  const mime = normalizeMime(row.mimeType)
  if (!PRODUCT_IMAGE_TYPES.has(mime)) return null
  return {
    productId: row.productId,
    fileName: typeof row.fileName === 'string' && row.fileName.trim() ? row.fileName : parsed.name,
    mimeType: mime,
    dataUrl: parsed.dataUrl,
  }
}

export function imageFileIdFromProductSnapshot(data: unknown, productId: string) {
  if (!data || typeof data !== 'object') return undefined
  const products = (data as { products?: unknown }).products
  if (!Array.isArray(products)) return undefined
  const product = products.find((row) => row && typeof row === 'object' && (row as { id?: unknown }).id === productId) as
    | { imageFileId?: unknown }
    | undefined
  const value = typeof product?.imageFileId === 'string' ? product.imageFileId.trim() : ''
  return value || undefined
}

export async function fetchProductImage(
  productId: string,
  actorUserId: string,
  postAction: ProductImagePoster,
): Promise<ProductImageEnvelope> {
  try {
    const result = await postAction(PRODUCT_IMAGE_GET_ACTION, { actorUserId, productId })
    if (!result.ok) return { ok: false, data: null, error: result.error }
    const payload = parseProductImagePayload(result.data)
    if (!payload) return { ok: false, data: null, error: { code: 'NOT_FOUND', message: PRODUCT_IMAGE_MISSING } }
    return { ok: true, data: payload, error: null }
  } catch {
    return { ok: false, data: null, error: { code: 'INTERNAL_ERROR', message: PRODUCT_IMAGE_LOAD_ERROR } }
  }
}

export async function mutateProductImage(
  action: typeof PRODUCT_IMAGE_UPLOAD_ACTION | typeof PRODUCT_IMAGE_REPLACE_ACTION | typeof PRODUCT_IMAGE_REMOVE_ACTION,
  payload: Record<string, unknown>,
  postAction: ProductImagePoster,
): Promise<ProductImageEnvelope> {
  try {
    const result = await postAction(action, payload)
    if (!result.ok) return { ok: false, data: null, error: result.error }
    return { ok: true, data: result.data, error: null }
  } catch {
    return { ok: false, data: null, error: { code: 'INTERNAL_ERROR', message: PRODUCT_IMAGE_SAVE_ERROR } }
  }
}

export async function loadStoredProductImage(options: {
  productId: string
  imageFileId: string
  actorUserId: string
  requestId: number
  isCurrent: (requestId: number) => boolean
  fetchImage: ProductImageFetcher
}): Promise<ProductImageLoadResult> {
  const { productId, imageFileId, actorUserId, requestId, isCurrent, fetchImage } = options
  if (!shouldFetchProductImage(imageFileId)) {
    return { requestId, status: 'missing', error: PRODUCT_IMAGE_MISSING }
  }
  const cached = takeProductImageCache(productId, imageFileId)
  if (cached) return { requestId, status: 'ready', payload: cached }
  let result: ProductImageEnvelope
  try {
    result = await fetchImage(productId, actorUserId)
  } catch {
    if (!isCurrent(requestId)) return { requestId, status: 'error', error: PRODUCT_IMAGE_LOAD_ERROR }
    return { requestId, status: 'error', error: PRODUCT_IMAGE_LOAD_ERROR }
  }
  if (!isCurrent(requestId)) return { requestId, status: 'error', error: PRODUCT_IMAGE_LOAD_ERROR }
  if (!result.ok || !result.data) {
    const code = result.error?.code
    if (code === 'FORBIDDEN') return { requestId, status: 'forbidden', error: result.error?.message || PRODUCT_IMAGE_FORBIDDEN }
    if (code === 'NOT_FOUND') return { requestId, status: 'missing', error: result.error?.message || PRODUCT_IMAGE_MISSING }
    return { requestId, status: 'error', error: result.error?.message || PRODUCT_IMAGE_LOAD_ERROR }
  }
  const payload = parseProductImagePayload(result.data) ?? (result.data as ProductImagePayload)
  if (!payload?.dataUrl) return { requestId, status: 'missing', error: PRODUCT_IMAGE_MISSING }
  storeProductImageCache(productId, imageFileId, payload)
  return { requestId, status: 'ready', payload }
}
