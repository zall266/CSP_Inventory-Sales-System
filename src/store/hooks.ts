import { useSyncExternalStore } from 'react'
import { db } from '@/store/db'
import type { AppState } from '@/types'
import { addDays, inRange, PROTOTYPE_TODAY, round2, startOfDay } from '@/utils/format'

export function useStore(): AppState {
  return useSyncExternalStore(db.subscribe, db.getSnapshot, db.getSnapshot)
}

export function useApi() {
  return db
}

export function dateRangeFromState(state: AppState) {
  const end = startOfDay(PROTOTYPE_TODAY)
  end.setHours(23, 59, 59, 999)
  if (state.ui.datePreset === '7d') return { from: addDays(startOfDay(PROTOTYPE_TODAY), -6), to: end }
  if (state.ui.datePreset === '90d') return { from: addDays(startOfDay(PROTOTYPE_TODAY), -89), to: end }
  if (state.ui.datePreset === 'custom') {
    const from = new Date(`${state.ui.customFrom}T00:00:00+08:00`)
    const to = new Date(`${state.ui.customTo}T23:59:59+08:00`)
    return { from, to }
  }
  return { from: addDays(startOfDay(PROTOTYPE_TODAY), -29), to: end }
}

export function useLookups() {
  const state = useStore()
  const categoryName = (id: string) => state.categories.find((c) => c.id === id)?.name ?? '—'
  const warehouseName = (id: string) => state.warehouses.find((w) => w.id === id)?.name ?? '—'
  const productName = (id: string) => state.products.find((p) => p.id === id)?.name ?? '—'
  const customerName = (id: string) => state.customers.find((c) => c.id === id)?.name ?? '—'
  const supplierName = (id: string) => state.suppliers.find((s) => s.id === id)?.name ?? '—'
  const product = (id: string) => state.products.find((p) => p.id === id)
  return { categoryName, warehouseName, productName, customerName, supplierName, product, state }
}

export function inventoryValue(state: AppState, warehouseId = 'all') {
  return round2(
    state.inventory.reduce((sum, row) => {
      if (warehouseId !== 'all' && row.warehouseId !== warehouseId) return sum
      const cost = state.products.find((p) => p.id === row.productId)?.costPrice ?? 0
      return sum + row.qty * cost
    }, 0),
  )
}

export function outstandingReceivables(state: AppState) {
  return round2(
    state.sales
      .filter((sale) => sale.status !== 'voided')
      .reduce((sum, sale) => sum + sale.balance, 0),
  )
}

export function outstandingPayables(state: AppState) {
  return round2(state.purchases.reduce((sum, purchase) => sum + purchase.balance, 0))
}

export function customerOutstanding(state: AppState, customerId: string) {
  return round2(
    state.sales
      .filter((sale) => sale.customerId === customerId && sale.status !== 'voided')
      .reduce((sum, sale) => sum + sale.balance, 0),
  )
}

export function supplierOutstanding(state: AppState, supplierId: string) {
  return round2(
    state.purchases.filter((purchase) => purchase.supplierId === supplierId).reduce((sum, purchase) => sum + purchase.balance, 0),
  )
}

export function customerSalesTotal(state: AppState, customerId: string) {
  return round2(
    state.sales
      .filter((sale) => sale.customerId === customerId && sale.status !== 'voided')
      .reduce((sum, sale) => sum + sale.total, 0),
  )
}

export function supplierPurchaseTotal(state: AppState, supplierId: string) {
  return round2(
    state.purchases.filter((purchase) => purchase.supplierId === supplierId).reduce((sum, purchase) => sum + purchase.total, 0),
  )
}

export function saleCogs(state: AppState, sale: AppState['sales'][number]) {
  return round2(
    sale.items.reduce((sum, item) => {
      const cost = state.products.find((p) => p.id === item.productId)?.costPrice ?? 0
      return sum + cost * item.qty
    }, 0),
  )
}

export function filteredSales(state: AppState) {
  const { from, to } = dateRangeFromState(state)
  const warehouse = state.ui.warehouseFilter
  return state.sales.filter((sale) => {
    if (sale.status === 'voided') return false
    if (!inRange(sale.date, from, to)) return false
    if (warehouse !== 'all' && sale.warehouseId !== warehouse) return false
    return true
  })
}

export function filteredPurchases(state: AppState) {
  const { from, to } = dateRangeFromState(state)
  const warehouse = state.ui.warehouseFilter
  return state.purchases.filter((purchase) => {
    if (!inRange(purchase.date, from, to)) return false
    if (warehouse !== 'all' && purchase.warehouseId !== warehouse) return false
    return true
  })
}

export function filteredExpenses(state: AppState) {
  const { from, to } = dateRangeFromState(state)
  return state.expenses.filter((expense) => inRange(expense.date, from, to))
}

export { inRange }
