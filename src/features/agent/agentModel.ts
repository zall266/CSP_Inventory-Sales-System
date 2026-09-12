import { productIsSellable } from '@/features/products/masterData'
import type { Agent, AgentEarningKind, AgentEarningLedger, AgentWithdrawal, AppState, Product, Sale, Warehouse } from '@/types'
import { round2 } from '@/utils/format'

export const SALE_EARNING_KIND: AgentEarningKind = 'sale_earning'
export const WITHDRAWAL_PENDING_KIND: AgentEarningKind = 'withdrawal_pending'
export const WITHDRAWAL_PAID_KIND: AgentEarningKind = 'withdrawal_paid'
export const WITHDRAWAL_CANCELLED_KIND: AgentEarningKind = 'withdrawal_cancelled'
export const WITHDRAWAL_RECEIPT_MAX_BYTES = 5 * 1024 * 1024
const WITHDRAWAL_RECEIPT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function configuredAgentPrice(product: { agentPrice?: number | null } | undefined) {
  if (!product) return null
  const value = product.agentPrice
  if (value === undefined || value === null) return null
  if (!Number.isFinite(value) || value < 0) return null
  return round2(value)
}

export function parseAgentPriceWrite(value: unknown) {
  if (value === undefined || value === null || value === '') return { ok: true as const, value: undefined }
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return { ok: false as const }
  return { ok: true as const, value: round2(amount) }
}

export function hasSaleEarningLedger(entries: AgentEarningLedger[], agentSaleId: string) {
  return entries.some((entry) => entry.kind === SALE_EARNING_KIND && entry.relatedAgentSaleId === agentSaleId)
}

export function saleEarningForAgentSale(entries: AgentEarningLedger[], agentSaleId: string) {
  return entries.find((entry) => entry.kind === SALE_EARNING_KIND && entry.relatedAgentSaleId === agentSaleId)
}

export function saleIsAgentSale(
  state: Pick<AppState, 'agentSales' | 'warehouses'>,
  sale: Pick<Sale, 'id' | 'warehouseId'>,
) {
  if ((state.agentSales ?? []).some((row) => row.saleId === sale.id)) return true
  return isAgentWarehouseId(state.warehouses, sale.warehouseId)
}

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

export function agentLinkedWarehouseName(agentName: string) {
  const name = agentName.trim()
  if (!name) return 'Agent'
  if (/^agent\s+/i.test(name)) return name
  return `Agent ${name}`
}

export function agentWarehouseSlug(code: string) {
  const stripped = code.trim().toLowerCase().replace(/^ag[-_]?/, '')
  return stripped.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent'
}

export function nextAgentWarehouseId(warehouses: Warehouse[], code: string) {
  const base = `wh-agent-${agentWarehouseSlug(code)}`
  if (!warehouses.some((warehouse) => warehouse.id === base)) return base
  let n = 2
  while (warehouses.some((warehouse) => warehouse.id === `${base}-${n}`)) n += 1
  return `${base}-${n}`
}

export function agentStockTotal(state: Pick<AppState, 'inventory'>, warehouseId: string) {
  return round2(
    state.inventory.filter((row) => row.warehouseId === warehouseId).reduce((sum, row) => sum + row.qty, 0),
  )
}

export function agentStockRows(state: Pick<AppState, 'inventory' | 'products'>, warehouseId: string) {
  return state.inventory
    .filter((row) => row.warehouseId === warehouseId && row.qty !== 0)
    .map((row) => {
      const product = state.products.find((item) => item.id === row.productId)
      return product ? { ...row, product } : null
    })
    .filter((row): row is { productId: string; warehouseId: string; qty: number; product: Product } => Boolean(row))
    .sort((a, b) => a.product.name.localeCompare(b.product.name) || a.product.sku.localeCompare(b.product.sku))
}

export function agentSalesForAgent<T extends { agentId: string; date: string; createdAt: string }>(sales: T[], agentId: string) {
  return sales
    .filter((sale) => sale.agentId === agentId)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
}

export function activeAgents<T extends { status: string }>(agents: T[]) {
  return agents.filter((agent) => agent.status === 'active')
}

export function parseWithdrawalAmount(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return { ok: false as const }
  const amount = round2(numeric)
  if (!Number.isFinite(amount) || !(amount > 0)) return { ok: false as const }
  return { ok: true as const, value: amount }
}

export function agentBankDetailsComplete(agent: Pick<Agent, 'bankName' | 'accountHolder' | 'bankAccount'> | undefined) {
  if (!agent) return false
  return Boolean(agent.bankName.trim() && agent.accountHolder.trim() && agent.bankAccount.trim())
}

export function snapshotAgentBankDetails(agent: Pick<Agent, 'bankName' | 'accountHolder' | 'bankAccount'>) {
  return {
    bankName: agent.bankName.trim(),
    accountHolder: agent.accountHolder.trim(),
    accountNumber: agent.bankAccount.trim(),
  }
}

export function linkedAgentForUser<T extends { userId?: string }>(agents: T[], userId: string) {
  return agents.find((agent) => agent.userId === userId)
}

export function currentLinkedAgent(state: Pick<AppState, 'agents' | 'ui'>) {
  return linkedAgentForUser(state.agents ?? [], state.ui.currentUserId)
}

export function posSellingWarehouseId(state: AppState) {
  const linked = currentLinkedAgent(state)
  if (linked) return linked.warehouseId
  return companySellingWarehouseId(state)
}

export function isOwnLinkedAgent(state: Pick<AppState, 'agents' | 'ui'>, agentId: string) {
  return currentLinkedAgent(state)?.id === agentId
}

export function agentPosItemAvailable(product: Product, qtyOnHand: number) {
  if (!productIsSellable(product)) return false
  if (configuredAgentPrice(product) === null) return false
  return qtyOnHand > 0
}

export type AgentSaleLineInput = { productId: string; qty: number; sellingPrice: number }

export function normalizeAgentSaleItems(input: {
  items?: AgentSaleLineInput[]
  productId?: string
  qty?: number
  sellingPrice?: number
}): AgentSaleLineInput[] {
  if (input.items && input.items.length) return input.items
  if (input.productId) {
    return [{ productId: input.productId, qty: Number(input.qty) || 0, sellingPrice: Number(input.sellingPrice) || 0 }]
  }
  return []
}

export function calcAgentSaleDocument(input: {
  lines: Array<{ agentPrice: number; sellingPrice: number; qty: number }>
  delivery: number
}) {
  const parts = input.lines.map((line) =>
    calcAgentSaleEarnings({ agentPrice: line.agentPrice, sellingPrice: line.sellingPrice, qty: line.qty, delivery: 0 }),
  )
  const productMarkup = round2(parts.reduce((sum, part) => sum + part.productMarkup, 0))
  const cspAmount = round2(parts.reduce((sum, part) => sum + part.cspAmount, 0))
  const deliveryEarnings = round2(input.delivery)
  const productTotal = round2(parts.reduce((sum, part) => sum + part.customerPays, 0))
  return {
    productMarkup,
    deliveryEarnings,
    totalEarnings: round2(productMarkup + deliveryEarnings),
    cspAmount,
    customerPays: round2(productTotal + deliveryEarnings),
  }
}

export function quotationsVisibleToUser<T extends { agentId?: string }>(state: Pick<AppState, 'agents' | 'ui'>, quotations: T[]) {
  const linked = currentLinkedAgent(state)
  if (linked) return quotations.filter((row) => row.agentId === linked.id)
  return quotations.filter((row) => !row.agentId)
}

export function salesVisibleToUser<T extends { warehouseId: string }>(
  state: Pick<AppState, 'agents' | 'ui' | 'warehouses'>,
  sales: T[],
) {
  const linked = currentLinkedAgent(state)
  if (linked) return sales.filter((sale) => sale.warehouseId === linked.warehouseId)
  return sales.filter((sale) => isCompanyWarehouseId(state.warehouses, sale.warehouseId))
}

export function canUserRequestWithdrawalForAgent(
  agents: Array<{ id: string; userId?: string }>,
  userId: string,
  agentId: string,
) {
  const linked = linkedAgentForUser(agents, userId)
  if (linked) return linked.id === agentId
  return true
}

export function hasWithdrawalPendingLedger(entries: AgentEarningLedger[], withdrawalId: string) {
  return entries.some((entry) => entry.kind === WITHDRAWAL_PENDING_KIND && entry.relatedWithdrawalId === withdrawalId)
}

export function withdrawalPendingForWithdrawal(entries: AgentEarningLedger[], withdrawalId: string) {
  return entries.find((entry) => entry.kind === WITHDRAWAL_PENDING_KIND && entry.relatedWithdrawalId === withdrawalId)
}

export function withdrawalsForAgent(withdrawals: AgentWithdrawal[], agentId: string) {
  return withdrawals
    .filter((row) => row.agentId === agentId)
    .slice()
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || b.createdAt.localeCompare(a.createdAt))
}

export function sortAgentWithdrawals(withdrawals: AgentWithdrawal[]) {
  return withdrawals
    .slice()
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || b.createdAt.localeCompare(a.createdAt))
}

export function hasWithdrawalPaidLedger(entries: AgentEarningLedger[], withdrawalId: string) {
  return entries.some((entry) => entry.kind === WITHDRAWAL_PAID_KIND && entry.relatedWithdrawalId === withdrawalId)
}

export function hasWithdrawalCancelledLedger(entries: AgentEarningLedger[], withdrawalId: string) {
  return entries.some((entry) => entry.kind === WITHDRAWAL_CANCELLED_KIND && entry.relatedWithdrawalId === withdrawalId)
}

export function withdrawalPaidForWithdrawal(entries: AgentEarningLedger[], withdrawalId: string) {
  return entries.find((entry) => entry.kind === WITHDRAWAL_PAID_KIND && entry.relatedWithdrawalId === withdrawalId)
}

export function withdrawalCancelledForWithdrawal(entries: AgentEarningLedger[], withdrawalId: string) {
  return entries.find((entry) => entry.kind === WITHDRAWAL_CANCELLED_KIND && entry.relatedWithdrawalId === withdrawalId)
}

export function parseWithdrawalPaymentDate(value: unknown) {
  if (typeof value !== 'string') return { ok: false as const }
  const date = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false as const }
  const parsed = new Date(`${date}T00:00:00+08:00`)
  if (Number.isNaN(parsed.getTime())) return { ok: false as const }
  return { ok: true as const, value: date }
}

export function parseWithdrawalPaymentReference(value: unknown) {
  if (typeof value !== 'string') return { ok: false as const }
  const reference = value.trim()
  if (!reference) return { ok: false as const }
  return { ok: true as const, value: reference }
}

export function isAllowedWithdrawalReceiptFile(file: Pick<File, 'type' | 'name' | 'size'>) {
  const name = file.name.toLowerCase()
  const extOk = ['.png', '.jpg', '.jpeg', '.webp'].some((ext) => name.endsWith(ext))
  const type = file.type === 'image/jpg' ? 'image/jpeg' : file.type
  if (file.size > WITHDRAWAL_RECEIPT_MAX_BYTES) return false
  if (WITHDRAWAL_RECEIPT_TYPES.has(type)) return true
  if (!file.type || file.type === 'application/octet-stream') return extOk
  return false
}

export function parseWithdrawalReceipt(value: unknown, fileName?: string) {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) return { ok: false as const }
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/)
  if (!match) return { ok: false as const }
  let mime = match[1].toLowerCase()
  if (mime === 'image/jpg') mime = 'image/jpeg'
  if (!WITHDRAWAL_RECEIPT_TYPES.has(mime)) return { ok: false as const }
  const b64 = match[2].replace(/\s/g, '')
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  const bytes = Math.floor((b64.length * 3) / 4) - padding
  if (!(bytes > 0) || bytes > WITHDRAWAL_RECEIPT_MAX_BYTES) return { ok: false as const }
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  const name = fileName?.trim() || `receipt.${extension}`
  return { ok: true as const, url: `data:${mime};base64,${b64}`, name }
}
