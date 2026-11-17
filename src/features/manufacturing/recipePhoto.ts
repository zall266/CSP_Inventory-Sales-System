/** Recipe-sheet evidence for daily production start. Mirrors Apps Script SESSION_PHOTO_* limits. */

export const RECIPE_PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const RECIPE_PHOTO_MAX_EDGE = 1920
export const RECIPE_PHOTO_CAMERA_ACCEPT = 'image/*'
export const RECIPE_PHOTO_GALLERY_ACCEPT = 'image/*'
export const RECIPE_PHOTO_CAMERA_CAPTURE = 'environment'
export const RECIPE_PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
export const RECIPE_PHOTO_HEIC_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
])

export const RECIPE_PHOTO_TYPE_ERROR = 'Choose a recipe sheet photo (JPG, PNG, or WebP).'
export const RECIPE_PHOTO_SIZE_ERROR = 'Use a JPG, PNG, or WebP image up to 5 MB.'
export const RECIPE_PHOTO_HEIC_ERROR =
  'This iPhone photo (HEIC) could not be converted. In Camera, set Formats to Most Compatible, or choose a JPG from the gallery.'
export const RECIPE_PHOTO_READ_ERROR = 'The photo could not be read. Try taking it again or pick another image.'
export const SAMPLE_RECIPE_SHEET_NAME = 'process-room-recipe-sheet.jpg'

export const SAMPLE_RECIPE_SHEET =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <rect x="24" y="24" width="592" height="352" fill="white" stroke="#cbd5e1" rx="12"/>
  <text x="48" y="80" font-family="sans-serif" font-size="22" fill="#0f172a">CSP Process Room Recipe Sheet</text>
  <text x="48" y="120" font-family="sans-serif" font-size="14" fill="#64748b">10 Sep 2026 · Matcha / Chocolate Lava / Strawberry</text>
  <text x="48" y="170" font-family="sans-serif" font-size="16" fill="#334155">Evidence photo only — BOM in StockFlow is the source of requirements.</text>
  <text x="48" y="220" font-family="sans-serif" font-size="14" fill="#64748b">Posted on process-room mirror</text>
</svg>`)

export type RecipePhotoReady = {
  ok: true
  dataUrl: string
  name: string
  convertedFromHeic?: boolean
}

export type RecipePhotoFailure = {
  ok: false
  error: string
}

export type RecipePhotoResult = RecipePhotoReady | RecipePhotoFailure

function normalizeMime(type: string) {
  const mime = type.toLowerCase()
  return mime === 'image/jpg' ? 'image/jpeg' : mime
}

export function isHeicLike(file: Pick<File, 'type' | 'name'>) {
  const mime = normalizeMime(file.type)
  const name = file.name.toLowerCase()
  return RECIPE_PHOTO_HEIC_TYPES.has(mime) || name.endsWith('.heic') || name.endsWith('.heif')
}

export function isSampleRecipePhoto(value: string | undefined | null) {
  if (!value) return false
  return value.includes('CSP Process Room Recipe Sheet') || value.startsWith('data:image/svg+xml')
}

export function isDriveRecipePhotoRef(value: string | undefined | null) {
  if (!value) return false
  if (value.startsWith('data:')) return false
  if (value.includes('/') || value.includes(' ') || value.includes(':')) return false
  return /^[a-zA-Z0-9_-]{10,}$/.test(value)
}

export function isPreviewableRecipePhoto(value: string | undefined | null) {
  return Boolean(value) && value!.startsWith('data:image/') && !isSampleRecipePhoto(value)
}

export function parseRecipePhoto(value: unknown, fileName?: string) {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) return { ok: false as const }
  if (isSampleRecipePhoto(value)) return { ok: false as const }
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/)
  if (!match) return { ok: false as const }
  const mime = normalizeMime(match[1])
  if (!RECIPE_PHOTO_TYPES.has(mime)) return { ok: false as const }
  const b64 = match[2].replace(/\s/g, '')
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  const bytes = Math.floor((b64.length * 3) / 4) - padding
  if (!(bytes > 0) || bytes > RECIPE_PHOTO_MAX_BYTES) return { ok: false as const }
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  const name = fileName?.trim() || `recipe-sheet.${extension}`
  return { ok: true as const, url: `data:${mime};base64,${b64}`, name, mime, bytes }
}

export function canStartProductionWithPhoto(value: string | undefined | null, fileName?: string) {
  if (!value || isSampleRecipePhoto(value)) return false
  if (value.startsWith('data:')) return parseRecipePhoto(value, fileName).ok
  return isDriveRecipePhotoRef(value)
}

export function jpegNameFrom(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, '').trim() || 'recipe-sheet'
  return `${base}.jpg`
}

export function openRecipePicker(input: HTMLInputElement | null) {
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

function scaledSize(width: number, height: number) {
  const edge = Math.max(width, height)
  if (!(edge > RECIPE_PHOTO_MAX_EDGE)) return { width, height }
  const scale = RECIPE_PHOTO_MAX_EDGE / edge
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function convertToJpegDataUrl(file: Blob) {
  const objectUrl = URL.createObjectURL(file)
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file)
      const size = scaledSize(bitmap.width, bitmap.height)
      const dataUrl = await canvasToJpegDataUrl(bitmap, size.width, size.height, 0.82)
      bitmap.close?.()
      return dataUrl
    }
    const image = await loadImageElement(objectUrl)
    const size = scaledSize(image.naturalWidth || image.width, image.naturalHeight || image.height)
    return canvasToJpegDataUrl(image, size.width, size.height, 0.82)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function compressUntilLimit(file: Blob, name: string): Promise<RecipePhotoResult> {
  let quality = 0.82
  let lastError = RECIPE_PHOTO_SIZE_ERROR
  while (quality >= 0.5) {
    try {
      const objectUrl = URL.createObjectURL(file)
      let dataUrl: string
      try {
        if (typeof createImageBitmap === 'function') {
          const bitmap = await createImageBitmap(file)
          const size = scaledSize(bitmap.width, bitmap.height)
          dataUrl = await canvasToJpegDataUrl(bitmap, size.width, size.height, quality)
          bitmap.close?.()
        } else {
          const image = await loadImageElement(objectUrl)
          const size = scaledSize(image.naturalWidth || image.width, image.naturalHeight || image.height)
          dataUrl = await canvasToJpegDataUrl(image, size.width, size.height, quality)
        }
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
      const parsed = parseRecipePhoto(dataUrl, jpegNameFrom(name))
      if (parsed.ok) return { ok: true, dataUrl: parsed.url, name: parsed.name }
      lastError = RECIPE_PHOTO_SIZE_ERROR
    } catch {
      lastError = RECIPE_PHOTO_READ_ERROR
      break
    }
    quality -= 0.12
  }
  return { ok: false, error: lastError }
}

export async function readRecipePhotoFile(file: File | undefined | null): Promise<RecipePhotoResult> {
  if (!file) return { ok: false, error: '' }
  if (isHeicLike(file)) {
    try {
      const dataUrl = await convertToJpegDataUrl(file)
      const parsed = parseRecipePhoto(dataUrl, jpegNameFrom(file.name))
      if (parsed.ok) return { ok: true, dataUrl: parsed.url, name: parsed.name, convertedFromHeic: true }
      const compressed = await compressUntilLimit(file, file.name)
      if (compressed.ok) return { ...compressed, convertedFromHeic: true }
      return { ok: false, error: RECIPE_PHOTO_HEIC_ERROR }
    } catch {
      return { ok: false, error: RECIPE_PHOTO_HEIC_ERROR }
    }
  }
  const mime = normalizeMime(file.type)
  const name = file.name.toLowerCase()
  const extOk = ['.png', '.jpg', '.jpeg', '.webp'].some((ext) => name.endsWith(ext))
  const typeOk = RECIPE_PHOTO_TYPES.has(mime) || ((!file.type || file.type === 'application/octet-stream') && extOk)
  if (!typeOk) return { ok: false, error: RECIPE_PHOTO_TYPE_ERROR }
  if (file.size > RECIPE_PHOTO_MAX_BYTES) {
    const compressed = await compressUntilLimit(file, file.name)
    if (compressed.ok) return compressed
    return { ok: false, error: RECIPE_PHOTO_SIZE_ERROR }
  }
  try {
    const dataUrl = await fileToDataUrl(file, RECIPE_PHOTO_TYPES.has(mime) ? mime : 'image/jpeg')
    const parsed = parseRecipePhoto(dataUrl, file.name)
    if (parsed.ok) return { ok: true, dataUrl: parsed.url, name: parsed.name }
    const compressed = await compressUntilLimit(file, file.name)
    if (compressed.ok) return compressed
    return { ok: false, error: RECIPE_PHOTO_SIZE_ERROR }
  } catch {
    return { ok: false, error: RECIPE_PHOTO_READ_ERROR }
  }
}
