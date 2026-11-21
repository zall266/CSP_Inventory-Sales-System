export type CartLine = { productId: string; qty: number; price: number }

export type CartCap = { capToAvailable: boolean; available: number }

export function productMatchesQuery(
  product: { name: string; sku: string; barcode?: string },
  query: string,
) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${product.name} ${product.sku} ${product.barcode ?? ''}`.toLowerCase().includes(q)
}

export function addProductToCart(
  current: CartLine[],
  productId: string,
  unitPrice: number,
  cap: CartCap,
): CartLine[] {
  if (cap.capToAvailable && cap.available <= 0) return current
  const existing = current.find((line) => line.productId === productId)
  if (existing) {
    const nextQty = existing.qty + 1
    if (cap.capToAvailable && nextQty > cap.available) return current
    return current.map((line) => (line.productId === productId ? { ...line, qty: nextQty } : line))
  }
  return [...current, { productId, qty: 1, price: unitPrice }]
}

export function setCartQty(current: CartLine[], productId: string, qty: number, cap: CartCap): CartLine[] {
  return current
    .map((line) => {
      if (line.productId !== productId) return line
      const next = cap.capToAvailable ? Math.min(qty, cap.available) : qty
      return { ...line, qty: next }
    })
    .filter((line) => line.qty > 0)
}

export function cartCount(cart: CartLine[]) {
  return cart.reduce((sum, line) => sum + line.qty, 0)
}

export function cartSubtotal(cart: CartLine[]) {
  return cart.reduce((sum, line) => sum + line.qty * line.price, 0)
}

export function beginPosSubmit(lock: { current: boolean }) {
  if (lock.current) return false
  lock.current = true
  return true
}

export function endPosSubmit(lock: { current: boolean }) {
  lock.current = false
}
