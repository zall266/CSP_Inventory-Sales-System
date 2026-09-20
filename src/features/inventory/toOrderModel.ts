import { isCompanyWarehouseId } from '@/features/agent/agentModel'
import { stockStatus } from '@/utils/format'
import type { AppState, InventoryRow, PermissionKey, StockOrder, StockOrderChannel } from '@/types'

export const INVENTORY_USAGE_PERMISSION_KEYS = ['inventory.usage'] as const satisfies readonly PermissionKey[]

export const STOCK_ORDER_CHANNELS: StockOrderChannel[] = ['Shopee', 'TikTok Shop', 'Supplier', 'Other']

export const STOCK_ORDER_CANCEL_REASONS = [
  'Supplier cancelled',
  'Courier problem',
  'Customer/company cancelled',
  'Other',
] as const

export type ToOrderQueueRow = {
  productId: string
  warehouseId: string
  qty: number
  minStock: number
  status: 'low_stock' | 'ordered'
  order?: StockOrder
}

export function orderChannelToReceivingSource(channel?: string) {
  if (channel === 'Shopee') return 'shopee' as const
  if (channel === 'Supplier') return 'supplier' as const
  return 'other' as const
}

export function activeStockOrder(state: Pick<AppState, 'stockOrders'>, productId: string, warehouseId: string) {
  return (state.stockOrders ?? []).find((row) => row.productId === productId && row.warehouseId === warehouseId && row.status === 'ordered')
}

export function lowStockCompanyRows(state: AppState): InventoryRow[] {
  return state.inventory.filter((row) => {
    if (!isCompanyWarehouseId(state.warehouses, row.warehouseId)) return false
    const product = state.products.find((item) => item.id === row.productId)
    if (!product || product.status !== 'active') return false
    return stockStatus(row.qty, product.reorderLevel ?? 0) === 'low_stock'
  })
}

export function awaitingReceivingOrders(state: Pick<AppState, 'stockOrders' | 'warehouses'>) {
  return (state.stockOrders ?? []).filter((row) => {
    if (row.status !== 'ordered') return false
    return isCompanyWarehouseId(state.warehouses, row.warehouseId)
  })
}

export function isActiveStockOrder(row: StockOrder | undefined): row is StockOrder {
  return Boolean(row && row.status === 'ordered')
}

export function toOrderQueue(state: AppState): ToOrderQueueRow[] {
  const orderedRows: ToOrderQueueRow[] = awaitingReceivingOrders(state).map((order) => {
    const product = state.products.find((item) => item.id === order.productId)
    const qty = state.inventory.find((row) => row.productId === order.productId && row.warehouseId === order.warehouseId)?.qty ?? 0
    return {
      productId: order.productId,
      warehouseId: order.warehouseId,
      qty,
      minStock: product?.reorderLevel ?? 0,
      status: 'ordered',
      order,
    }
  })
  const orderedKeys = new Set(orderedRows.map((row) => `${row.productId}:${row.warehouseId}`))
  const lowRows: ToOrderQueueRow[] = lowStockCompanyRows(state)
    .filter((row) => !orderedKeys.has(`${row.productId}:${row.warehouseId}`))
    .map((row) => {
      const product = state.products.find((item) => item.id === row.productId)
      return {
        productId: row.productId,
        warehouseId: row.warehouseId,
        qty: row.qty,
        minStock: product?.reorderLevel ?? 0,
        status: 'low_stock',
      }
    })
  return [...lowRows, ...orderedRows]
}
