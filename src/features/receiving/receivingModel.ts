import { formatUnit, productHasBom, purchaseQtyToBaseQty } from '@/features/products/masterData'
import type { AppState, Product, Receiving, ReceivingInput, ReceivingLine, ReceivingSource } from '@/types'

export const RECEIVING_PERMISSION_KEYS = ['receiving.view', 'receiving.create', 'receiving.link_purchase'] as const

export const RECEIVING_PHOTO_MAX_BYTES = 5 * 1024 * 1024
const RECEIVING_PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export const RECEIVING_SOURCES: Array<{ id: ReceivingSource; label: string }> = [
  { id: 'supplier', label: 'Supplier' },
  { id: 'shopee', label: 'Shopee' },
  { id: 'direct', label: 'Direct purchase' },
  { id: 'other', label: 'Other' },
]

export function receivingSourceLabel(source: ReceivingSource | undefined) {
  return RECEIVING_SOURCES.find((item) => item.id === source)?.label ?? 'Other'
}

export function isReceivableRawMaterial(state: Pick<AppState, 'boms'>, product: Product | undefined) {
  if (!product || product.status !== 'active') return false
  return !productHasBom(state.boms, product.id)
}

export function receivableRawMaterials(state: Pick<AppState, 'products' | 'boms'>) {
  return state.products.filter((product) => isReceivableRawMaterial(state, product))
}

export function isAllowedReceivingPhotoFile(file: Pick<File, 'type' | 'name' | 'size'>) {
  const name = file.name.toLowerCase()
  const extOk = ['.png', '.jpg', '.jpeg', '.webp'].some((ext) => name.endsWith(ext))
  const type = file.type === 'image/jpg' ? 'image/jpeg' : file.type
  if (file.size > RECEIVING_PHOTO_MAX_BYTES) return false
  if (RECEIVING_PHOTO_TYPES.has(type)) return true
  if (!file.type || file.type === 'application/octet-stream') return extOk
  return false
}

export function parseReceivingPhoto(value: unknown, fileName?: string) {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) return { ok: false as const }
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/)
  if (!match) return { ok: false as const }
  let mime = match[1].toLowerCase()
  if (mime === 'image/jpg') mime = 'image/jpeg'
  if (!RECEIVING_PHOTO_TYPES.has(mime)) return { ok: false as const }
  const b64 = match[2].replace(/\s/g, '')
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  const bytes = Math.floor((b64.length * 3) / 4) - padding
  if (!(bytes > 0) || bytes > RECEIVING_PHOTO_MAX_BYTES) return { ok: false as const }
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  const name = fileName?.trim() || `receiving-photo.${extension}`
  return { ok: true as const, url: `data:${mime};base64,${b64}`, name }
}

export function emptyReceivingLine(product: Product | undefined): {
  productId: string
  qty: number
  batchNo: string
  expiry: string
  notes: string
} {
  return {
    productId: product?.id ?? '',
    qty: 1,
    batchNo: '',
    expiry: '',
    notes: '',
  }
}

export function buildReceivingLines(
  state: Pick<AppState, 'products' | 'boms'>,
  items: ReceivingInput['items'],
): { ok: true; lines: ReceivingLine[] } | { ok: false; reason: string } {
  const lines: ReceivingLine[] = []
  for (const item of items) {
    const product = state.products.find((row) => row.id === item.productId)
    if (!product) return { ok: false, reason: 'Choose a raw material for every line.' }
    if (!isReceivableRawMaterial(state, product)) {
      return { ok: false, reason: `${product.name} is a finished product. Receive raw materials only.` }
    }
    const qty = Number(item.qty)
    if (!Number.isFinite(qty) || !(qty > 0)) {
      return { ok: false, reason: 'Enter a received quantity greater than 0.' }
    }
    const batchNo = item.batchNo?.trim() || undefined
    const expiry = item.expiry?.trim() || undefined
    if (product.trackExpiry && !expiry) {
      return { ok: false, reason: `Enter an expiry date for ${product.name}.` }
    }
    const unit = product.purchaseUnit || product.unit
    const baseQty = purchaseQtyToBaseQty(qty, product)
    lines.push({
      productId: product.id,
      qty,
      unit,
      baseQty,
      batchNo,
      expiry,
      notes: item.notes?.trim() || undefined,
    })
  }
  if (!lines.length) return { ok: false, reason: 'Add at least one raw material.' }
  return { ok: true, lines }
}

export function receivingQtyHint(product: Product | undefined) {
  if (!product) return ''
  const purchase = formatUnit(product.purchaseUnit ?? product.unit)
  const base = formatUnit(product.unit)
  const conversion = product.purchaseConversionQty ?? 1
  if (purchase === base) return `Quantity in ${purchase}`
  return `Quantity in ${purchase} · 1 ${purchase} = ${conversion} ${base}`
}

export function unlinkedReceivings(state: Pick<AppState, 'receivings'>) {
  return (state.receivings ?? []).filter((row) => !row.purchaseId)
}

export function receivingLinkLabel(row: Receiving) {
  if (row.purchaseNo) return `Linked to ${row.purchaseNo}`
  return 'Not linked to a purchase'
}
