import type { Product, SalesComponent, SalesComponentSnapshot } from '@/types'
import { round2 } from '@/utils/format'

export function normalizeSalesComponents(rows: SalesComponent[] | undefined): SalesComponent[] {
  const merged = new Map<string, number>()
  for (const row of rows ?? []) {
    const productId = row?.productId?.trim()
    const qty = Number(row?.qty)
    if (!productId || !Number.isFinite(qty) || !(qty > 0)) continue
    merged.set(productId, round2((merged.get(productId) ?? 0) + qty))
  }
  return [...merged.entries()].map(([productId, qty]) => ({ productId, qty }))
}

export function validateSalesComponents(
  productId: string | undefined,
  rows: SalesComponent[] | undefined,
  products: Product[],
): { ok: true; items: SalesComponent[] } | { ok: false; reason: string } {
  const pending = rows ?? []
  for (const row of pending) {
    const id = row?.productId?.trim() ?? ''
    const qty = Number(row?.qty)
    if (!id && (qty === 0 || !Number.isFinite(qty))) continue
    if (!id) return { ok: false, reason: 'Select a component product.' }
    if (!Number.isFinite(qty) || !(qty > 0)) return { ok: false, reason: 'Component quantity must be greater than 0.' }
    if (productId && id === productId) return { ok: false, reason: 'A product cannot include itself as a sales component.' }
    const component = products.find((item) => item.id === id)
    if (!component) return { ok: false, reason: 'Component product was not found.' }
    if (component.status !== 'active') return { ok: false, reason: `${component.name} is inactive.` }
  }
  return { ok: true, items: normalizeSalesComponents(pending) }
}

export function salesComponentsOf(product: Pick<Product, 'salesComponents'> | undefined): SalesComponent[] {
  return normalizeSalesComponents(product?.salesComponents)
}

export function salesComponentSnapshot(product: Product, products: Product[], saleQty: number): SalesComponentSnapshot[] {
  return salesComponentsOf(product).map((row) => {
    const component = products.find((item) => item.id === row.productId)
    return {
      productId: row.productId,
      productName: component?.name ?? '',
      sku: component?.sku ?? '',
      qty: round2(saleQty * row.qty),
      unit: component?.unit ?? '',
    }
  })
}

export function inactiveSalesComponent(product: Product | undefined, products: Product[]) {
  for (const row of salesComponentsOf(product)) {
    const component = products.find((item) => item.id === row.productId)
    if (!component || component.status !== 'active') return component?.name || 'Component'
  }
  return null
}
