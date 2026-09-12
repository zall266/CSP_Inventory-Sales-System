import type {
  AppState,
  DisplayStock,
  PlacementLog,
  Product,
  SlotOccupancy,
  StorageFace,
  StorageLocation,
  StorageLocationType,
  StorageSlot,
} from '@/types'
import { round2 } from '@/utils/format'

export const WAREHOUSE_MAP_KEYS = [
  'warehouse_map.view',
  'warehouse_map.putaway',
  'warehouse_map.move',
  'warehouse_map.layout.edit',
  'warehouse_map.location.manage',
  'warehouse_map.balance.use',
] as const

export const BALANCE_USAGE_REASONS = ['Content', 'Sample', 'R&D / Testing', 'Internal Use', 'Waste', 'Other'] as const

export const DISPLAY_STOCK_DESTINATION = 'display-stock'

export const CARTON_STORAGE_TYPES: StorageLocationType[] = ['RACK', 'PALLET', 'FLOOR']

export function isCartonStorageType(type: StorageLocationType) {
  return type === 'RACK' || type === 'PALLET' || type === 'FLOOR'
}

export function isFinishedPack(product: Product | undefined) {
  return Boolean(product && product.unit.toLowerCase() === 'packs')
}

export function slotIdFor(locationId: string, level: number, face: StorageFace, slotNo: number) {
  return `${locationId}-l${level}-${face.toLowerCase()}-${slotNo}`
}

export function generateRackSlots(locationId: string, levels: number, frontCount: number, backCount: number): StorageSlot[] {
  const slots: StorageSlot[] = []
  for (let level = levels; level >= 1; level -= 1) {
    for (let slotNo = 1; slotNo <= frontCount; slotNo += 1) {
      slots.push({
        id: slotIdFor(locationId, level, 'FRONT', slotNo),
        locationId,
        level,
        face: 'FRONT',
        slotNo,
        capacity: 0,
        active: true,
      })
    }
    for (let slotNo = 1; slotNo <= backCount; slotNo += 1) {
      slots.push({
        id: slotIdFor(locationId, level, 'BACK', slotNo),
        locationId,
        level,
        face: 'BACK',
        slotNo,
        capacity: 0,
        active: true,
      })
    }
  }
  return slots
}

export function generateGenericSlots(locationId: string, count: number, face: StorageFace = 'NONE'): StorageSlot[] {
  return Array.from({ length: count }, (_, index) => ({
    id: slotIdFor(locationId, 0, face, index + 1),
    locationId,
    level: 0,
    face,
    slotNo: index + 1,
    capacity: 0,
    active: true,
  }))
}

export function occupancyBySlot(occupancies: SlotOccupancy[]) {
  return Object.fromEntries(occupancies.map((row) => [row.slotId, row])) as Record<string, SlotOccupancy>
}

export function placedPacks(state: AppState, productId: string, warehouseId: string, types: StorageLocationType[] = CARTON_STORAGE_TYPES) {
  const allowed = new Set(types)
  const locationIds = new Set(
    state.storageLocations
      .filter((row) => row.warehouseId === warehouseId && row.active && allowed.has(row.type))
      .map((row) => row.id),
  )
  const slotIds = new Set(state.storageSlots.filter((row) => locationIds.has(row.locationId) && row.active).map((row) => row.id))
  return state.slotOccupancies
    .filter((row) => slotIds.has(row.slotId) && row.productId === productId)
    .reduce((sum, row) => sum + row.quantityPacks, 0)
}

export function inventoryPacks(state: AppState, productId: string, warehouseId: string) {
  return state.inventory.find((row) => row.productId === productId && row.warehouseId === warehouseId)?.qty ?? 0
}

export function displayPacks(state: AppState, productId: string, warehouseId: string) {
  return state.displayStocks?.find((row) => row.productId === productId && row.warehouseId === warehouseId)?.qty ?? 0
}

export function unplacedPacks(state: AppState, productId: string, warehouseId: string) {
  return Math.max(
    0,
    inventoryPacks(state, productId, warehouseId) - displayPacks(state, productId, warehouseId) - placedPacks(state, productId, warehouseId),
  )
}

export function finishedGoodsBreakdown(state: AppState, productId: string, warehouseId: string) {
  const inventory = inventoryPacks(state, productId, warehouseId)
  const display = displayPacks(state, productId, warehouseId)
  const rack = placedPacks(state, productId, warehouseId, ['RACK'])
  const pallet = placedPacks(state, productId, warehouseId, ['PALLET', 'FLOOR'])
  const carton = rack + pallet
  const ready = unplacedPacks(state, productId, warehouseId)
  return { inventory, display, rack, pallet, carton, ready }
}

export function applyDisplayDelta(stocks: DisplayStock[], productId: string, warehouseId: string, delta: number, at: string, newId?: string) {
  const qty = round2(delta)
  if (!qty) return stocks
  const existing = stocks.find((row) => row.productId === productId && row.warehouseId === warehouseId)
  if (!existing) {
    const nextQty = round2(Math.max(0, qty))
    if (nextQty <= 0) return stocks
    return [...stocks, { id: newId || `ds-${warehouseId}-${productId}`, warehouseId, productId, qty: nextQty, updatedAt: at }]
  }
  return stocks.map((row) =>
    row.id === existing.id ? { ...row, qty: round2(Math.max(0, row.qty + qty)), updatedAt: at } : row,
  )
}

export function migrateFinishedGoodsStorage<T extends {
  storageLocations: StorageLocation[]
  storageSlots: StorageSlot[]
  slotOccupancies: SlotOccupancy[]
  displayStocks?: DisplayStock[]
}>(data: T, at: string): T & { displayStocks: DisplayStock[] } {
  const storageLocations = data.storageLocations.map((row) => (row.type === 'DISPLAY' ? { ...row, active: false } : row))
  const displayLocationIds = new Set(storageLocations.filter((row) => row.type === 'DISPLAY').map((row) => row.id))
  const displaySlotIds = new Set(data.storageSlots.filter((row) => displayLocationIds.has(row.locationId)).map((row) => row.id))
  const leftover = data.slotOccupancies.filter((row) => displaySlotIds.has(row.slotId))
  const slotOccupancies = data.slotOccupancies.filter((row) => !displaySlotIds.has(row.slotId))
  let displayStocks = [...(data.displayStocks ?? [])]
  for (const occupancy of leftover) {
    const slot = data.storageSlots.find((row) => row.id === occupancy.slotId)
    const location = slot ? storageLocations.find((row) => row.id === slot.locationId) : undefined
    displayStocks = applyDisplayDelta(displayStocks, occupancy.productId, location?.warehouseId || 'wh-main', occupancy.quantityPacks, at)
  }
  const hasPallet = storageLocations.some((row) => row.id === 'loc-pallet-depan-office' || (row.type === 'PALLET' && row.name.toUpperCase() === 'DEPAN OFFICE'))
  const nextLocations = hasPallet
    ? storageLocations
    : [
        ...storageLocations,
        {
          id: 'loc-pallet-depan-office',
          name: 'DEPAN OFFICE',
          type: 'PALLET' as const,
          warehouseId: storageLocations.find((row) => row.warehouseId)?.warehouseId || 'wh-main',
          active: true,
          createdAt: at,
          updatedAt: at,
        },
      ]
  const nextSlots = hasPallet || data.storageSlots.some((row) => row.locationId === 'loc-pallet-depan-office')
    ? data.storageSlots
    : [...data.storageSlots, ...generateGenericSlots('loc-pallet-depan-office', 4)]
  return { ...data, storageLocations: nextLocations, storageSlots: nextSlots, slotOccupancies, displayStocks }
}

export function slotLabel(state: AppState, slotId: string) {
  if (slotId === DISPLAY_STOCK_DESTINATION) return 'Display stock'
  const slot = state.storageSlots.find((row) => row.id === slotId)
  const location = slot ? state.storageLocations.find((row) => row.id === slot.locationId) : undefined
  if (!slot || !location) return '—'
  if (location.type === 'RACK') {
    const face = slot.face === 'FRONT' ? 'Front' : slot.face === 'BACK' ? 'Back' : ''
    return `${location.name} · L${slot.level} · ${face} ${slot.slotNo}`.replace(/\s+/g, ' ').trim()
  }
  if (location.type === 'BALANCE_AREA') return `Box ${slot.slotNo}`
  if (location.type === 'DISPLAY') return slot.slotNo > 1 ? `${location.name} · ${slot.slotNo}` : location.name
  return `${location.name} · Slot ${slot.slotNo}`
}

export function shortProductName(name: string) {
  return name.replace(/^Ice Blended\s+/i, '').trim()
}

export function createMainWarehouseLayout(createdAt: string): {
  storageLocations: StorageLocation[]
  storageSlots: StorageSlot[]
} {
  const rack = (id: string, name: string): StorageLocation => ({
    id,
    name,
    type: 'RACK',
    warehouseId: 'wh-main',
    active: true,
    createdAt,
    updatedAt: createdAt,
  })
  const locations: StorageLocation[] = [
    rack('loc-rack-1', 'Rack 1'),
    rack('loc-rack-2', 'Rack 2'),
    {
      id: 'loc-display',
      name: 'Display Rack',
      type: 'DISPLAY',
      warehouseId: 'wh-main',
      active: false,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: 'loc-pallet-depan-office',
      name: 'DEPAN OFFICE',
      type: 'PALLET',
      warehouseId: 'wh-main',
      active: true,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: 'loc-balance',
      name: 'Balance Storage',
      type: 'BALANCE_AREA',
      warehouseId: 'wh-main',
      active: true,
      createdAt,
      updatedAt: createdAt,
    },
  ]
  const slots = [
    ...generateRackSlots('loc-rack-1', 4, 4, 4),
    ...generateRackSlots('loc-rack-2', 4, 4, 4),
    ...generateGenericSlots('loc-display', 6),
    ...generateGenericSlots('loc-pallet-depan-office', 4),
    ...generateGenericSlots('loc-balance', 3),
  ]
  return { storageLocations: locations, storageSlots: slots }
}

export function seedWarehouseOccupancy(createdAt: string, placedBy: string): {
  slotOccupancies: SlotOccupancy[]
  placementLogs: PlacementLog[]
} {
  const occupy = (
    slotId: string,
    productId: string,
    quantityPacks: number,
    batchRef: string,
  ): SlotOccupancy => ({
    id: `occ-${slotId}`,
    slotId,
    productId,
    quantityPacks,
    batchRef,
    productionSessionRef: batchRef,
    placedBy,
    placedAt: createdAt,
    updatedAt: createdAt,
  })
  const occupancies = [
    occupy(slotIdFor('loc-rack-1', 3, 'FRONT', 1), 'p-pack-st', 20, 'PROD-20260908-001'),
    occupy(slotIdFor('loc-rack-1', 3, 'FRONT', 2), 'p-pack-mt', 20, 'PROD-20260908-001'),
    occupy(slotIdFor('loc-rack-1', 3, 'BACK', 1), 'p-pack-cl', 20, 'PROD-20260909-001'),
    occupy(slotIdFor('loc-rack-1', 4, 'BACK', 3), 'p-pack-mlt', 20, 'PROD-20260908-001'),
  ]
  const historicalDisplay = [
    occupy(slotIdFor('loc-display', 0, 'NONE', 1), 'p-pack-st', 5, 'PROD-20260908-001'),
    occupy(slotIdFor('loc-display', 0, 'NONE', 2), 'p-pack-mt', 8, 'PROD-20260908-001'),
    occupy(slotIdFor('loc-display', 0, 'NONE', 3), 'p-pack-ch', 12, 'PROD-20260909-001'),
  ]
  const logs: PlacementLog[] = [...occupancies, ...historicalDisplay].map((row) => ({
    id: `pl-${row.id}`,
    action: 'PLACED',
    productId: row.productId,
    quantity: row.quantityPacks,
    fromSlotId: '',
    toSlotId: row.slotId,
    batchRef: row.batchRef,
    referenceId: row.productionSessionRef,
    performedBy: placedBy,
    performedAt: createdAt,
    reason: 'Opening warehouse layout',
  }))
  return { slotOccupancies: occupancies, placementLogs: logs }
}

export function seedDisplayStocks(updatedAt: string): DisplayStock[] {
  return [
    { id: 'ds-p-pack-st', warehouseId: 'wh-main', productId: 'p-pack-st', qty: 5, updatedAt },
    { id: 'ds-p-pack-mt', warehouseId: 'wh-main', productId: 'p-pack-mt', qty: 8, updatedAt },
    { id: 'ds-p-pack-ch', warehouseId: 'wh-main', productId: 'p-pack-ch', qty: 12, updatedAt },
  ]
}

export function formatProductionDate(iso: string) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('day')}/${pick('month')}/${pick('year')}`
}

export function balanceProductionDate(state: AppState, productionDate: string, productionReference: string) {
  if (productionDate) return productionDate
  const session = state.productionSessions.find((row) => row.reference === productionReference)
  return session?.productionDate || session?.completedAt || ''
}

export function occupancyProductionIso(state: AppState, occupancy: Pick<SlotOccupancy, 'batchRef' | 'productionSessionRef'>) {
  const refs = [occupancy.productionSessionRef, occupancy.batchRef].filter(Boolean)
  for (const ref of refs) {
    const session = state.productionSessions.find((row) => row.reference === ref)
    if (session?.productionDate) return session.productionDate
  }
  for (const ref of refs) {
    const stamped = ref.match(/PROD-(\d{4})(\d{2})(\d{2})/)
    if (stamped) return `${stamped[1]}-${stamped[2]}-${stamped[3]}`
  }
  return ''
}

export function occupancyProductionLabel(state: AppState, occupancy: Pick<SlotOccupancy, 'batchRef' | 'productionSessionRef'>) {
  const iso = occupancyProductionIso(state, occupancy)
  return iso ? formatProductionDate(iso) : '—'
}

export function latestProductionRef(state: AppState, productId: string) {
  if (!productId) return ''
  const sessions = state.productionSessions
    .filter((session) => session.status === 'completed' && session.items.some((item) => item.productId === productId && item.actualQty > 0))
    .sort((a, b) => (b.completedAt || b.productionDate).localeCompare(a.completedAt || a.productionDate))
  return sessions[0]?.reference ?? ''
}

export function locationTypeLabel(type: StorageLocationType) {
  if (type === 'RACK') return 'Rack'
  if (type === 'DISPLAY') return 'Display'
  if (type === 'PALLET') return 'Pallet'
  if (type === 'FLOOR') return 'Floor'
  return 'Balance'
}

export function contrastText(hex: string) {
  const value = hex.replace('#', '')
  if (value.length !== 6) return '#0f172a'
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.62 ? '#0f172a' : '#ffffff'
}
