import type { AgentEarningLedger, AppState, Warehouse } from '@/types'
import { round2 } from '@/utils/format'

export const AGENT_PERMISSION_KEYS = [
  'agent.view',
  'agent.manage',
  'agent.stock.view',
  'agent.stock.transfer',
  'agent.sale.create',
  'agent.sale.view',
  'agent.earnings.view',
  'agent.withdrawal.create',
  'agent.withdrawal.process',
] as const

export function isCompanyWarehouse(warehouse: Pick<Warehouse, 'kind'> | undefined) {
  return warehouse?.kind !== 'agent'
}

export function isAgentWarehouse(warehouse: Pick<Warehouse, 'kind'> | undefined) {
  return warehouse?.kind === 'agent'
}

export function companyWarehouses(warehouses: Warehouse[]) {
  return warehouses.filter((warehouse) => warehouse.kind !== 'agent')
}

export function agentWarehouses(warehouses: Warehouse[]) {
  return warehouses.filter((warehouse) => warehouse.kind === 'agent')
}

export function isCompanyWarehouseId(warehouses: Warehouse[], warehouseId: string) {
  return warehouses.find((warehouse) => warehouse.id === warehouseId)?.kind !== 'agent'
}

export function isAgentWarehouseId(warehouses: Warehouse[], warehouseId: string) {
  return warehouses.find((warehouse) => warehouse.id === warehouseId)?.kind === 'agent'
}

export function companySellingWarehouseId(state: Pick<AppState, 'warehouses' | 'settings' | 'ui'>) {
  const company = companyWarehouses(state.warehouses)
  const fallback =
    company.find((warehouse) => warehouse.id === state.settings.defaultWarehouseId)?.id ??
    company.find((warehouse) => warehouse.id === 'wh-main')?.id ??
    company[0]?.id ??
    state.settings.defaultWarehouseId
  if (state.ui.warehouseFilter === 'all') return fallback
  if (company.some((warehouse) => warehouse.id === state.ui.warehouseFilter)) return state.ui.warehouseFilter
  return fallback
}

export function companyMapWarehouseId(state: Pick<AppState, 'warehouses' | 'ui'>) {
  const company = companyWarehouses(state.warehouses)
  const preferred = state.ui.warehouseFilter === 'all' ? 'wh-main' : state.ui.warehouseFilter
  if (company.some((warehouse) => warehouse.id === preferred)) return preferred
  return company.find((warehouse) => warehouse.id === 'wh-main')?.id ?? company[0]?.id ?? 'wh-main'
}

export function calcAgentSaleEarnings(input: {
  agentPrice: number
  sellingPrice: number
  qty: number
  delivery: number
}) {
  const productMarkup = round2((input.sellingPrice - input.agentPrice) * input.qty)
  const deliveryEarnings = round2(input.delivery)
  return {
    productMarkup,
    deliveryEarnings,
    totalEarnings: round2(productMarkup + deliveryEarnings),
    cspAmount: round2(input.agentPrice * input.qty),
    customerPays: round2(input.sellingPrice * input.qty + input.delivery),
  }
}

export function summarizeAgentEarnings(entries: AgentEarningLedger[], agentId?: string) {
  const rows = agentId ? entries.filter((entry) => entry.agentId === agentId) : entries
  return {
    available: round2(rows.reduce((sum, entry) => sum + entry.availableDelta, 0)),
    pendingWithdrawal: round2(rows.reduce((sum, entry) => sum + entry.pendingDelta, 0)),
    paid: round2(rows.reduce((sum, entry) => sum + entry.paidDelta, 0)),
  }
}
