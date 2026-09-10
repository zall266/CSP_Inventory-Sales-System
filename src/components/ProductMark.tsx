import { initials } from '@/utils/format'
import type { Product } from '@/types'
import { cn } from '@/utils/format'

export function ProductMark({ product, size = 'md' }: { product: Product; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl font-semibold text-white shadow-inner',
        size === 'sm' && 'h-9 w-9 text-[10px]',
        size === 'md' && 'h-11 w-11 text-xs',
        size === 'lg' && 'h-16 w-16 text-sm',
      )}
      style={{ background: `linear-gradient(145deg, ${product.accent}, #0f172a)` }}
    >
      {initials(product.name)}
    </div>
  )
}

export function paymentLabel(method?: string) {
  const map: Record<string, string> = {
    cash: 'Cash',
    bank_transfer: 'Bank Transfer',
    duitnow: 'DuitNow',
    card: 'Card',
    ewallet: 'E-wallet',
  }
  return method ? map[method] ?? method : '—'
}

export function movementLabel(type: string) {
  const map: Record<string, string> = {
    purchase: 'Purchase',
    sale: 'Sale',
    sales_return: 'Sales Return',
    purchase_return: 'Purchase Return',
    adjustment: 'Adjustment',
    transfer_in: 'Transfer In',
    transfer_out: 'Transfer Out',
    opening_stock: 'Opening Stock',
    stock_count: 'Stock Count',
    production_in: 'Production In',
    production_out: 'Material Consumption',
    production_wastage: 'Production Wastage',
  }
  return map[type] ?? type
}
