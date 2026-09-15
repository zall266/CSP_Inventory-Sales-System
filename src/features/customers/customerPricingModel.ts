import { productIsSellable } from '@/features/products/masterData'
import { formatMoney, round2 } from '@/utils/format'
import type { AppState, CustomerWholesalePrice, Product } from '@/types'

export const CUSTOMER_PRICING_PERMISSION_KEYS = ['customer.pricing.view', 'customer.pricing.manage'] as const

export function defaultWholesalePrice(product: Pick<Product, 'wholesalePrice'> | undefined) {
  if (!product) return null
  const value = product.wholesalePrice
  if (value === undefined || value === null) return null
  if (!Number.isFinite(value) || value < 0) return null
  return round2(value)
}

export function activeCustomerWholesalePrice(
  prices: CustomerWholesalePrice[] | undefined,
  customerId: string,
  productId: string,
) {
  const row = (prices ?? []).find(
    (item) => item.customerId === customerId && item.productId === productId && item.active,
  )
  if (!row) return null
  if (!Number.isFinite(row.price) || row.price < 0) return null
  return round2(row.price)
}

export function customerWholesalePriceRow(
  prices: CustomerWholesalePrice[] | undefined,
  customerId: string,
  productId: string,
) {
  return (prices ?? []).find((item) => item.customerId === customerId && item.productId === productId)
}

export function resolveWholesaleUnitPrice(
  state: Pick<AppState, 'products' | 'customerWholesalePrices'>,
  customerId: string,
  productId: string,
) {
  const custom = activeCustomerWholesalePrice(state.customerWholesalePrices, customerId, productId)
  if (custom !== null) return custom
  const product = state.products.find((item) => item.id === productId)
  const wholesale = defaultWholesalePrice(product)
  if (wholesale !== null) return wholesale
  return Number(product?.sellingPrice) || 0
}

export function sellableProductsForCustomerPricing(products: Product[]) {
  return products
    .filter((product) => productIsSellable(product) && product.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku))
}

export function customerPricingAuditNo(customerName: string, productSku: string) {
  return `${customerName} · ${productSku}`
}

export function formatCustomPriceStatus(active: boolean) {
  return active ? 'Active' : 'Inactive'
}

export function customPriceLabel(price: number | null) {
  return price === null ? '—' : formatMoney(price)
}

export function isWholesaleSale(sale: { pricingMode?: string } | undefined) {
  return sale?.pricingMode === 'wholesale'
}
