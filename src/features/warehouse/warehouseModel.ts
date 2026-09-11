import type {
  AppState,
  PlacementLog,
  Product,
  SlotOccupancy,
  StorageFace,
  StorageLocation,
  StorageLocationType,
  StorageSlot,
} from '@/types'

export const WAREHOUSE_MAP_KEYS = [
  'warehouse_map.view',
  'warehouse_map.putaway',
  'warehouse_map.move',
  'warehouse_map.layout.edit',
  'warehouse_map.location.manage',
] as const

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

export function placedPacks(state: AppState, productId: string, warehouseId: string) {
  const locationIds = new Set(
    state.storageLocations.filter((row) => row.warehouseId === warehouseId && row.active).map((row) => row.id),
  )
  const slotIds = new Set(state.storageSlots.filter((row) => locationIds.has(row.locationId) && row.active).map((row) => row.id))
  return state.slotOccupancies
    .filter((row) => slotIds.has(row.slotId) && row.productId === productId)
    .reduce((sum, row) => sum + row.quantityPacks, 0)
}

export function inventoryPacks(state: AppState, productId: string, warehouseId: string) {
  return state.inventory.find((row) => row.productId === productId && row.warehouseId === warehouseId)?.qty ?? 0
}

export function unplacedPacks(state: AppState, productId: string, warehouseId: string) {
  return Math.max(0, inventoryPacks(state, productId, warehouseId) - placedPacks(state, productId, warehouseId))
}

export function slotLabel(state: AppState, slotId: string) {
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
    occupy(slotIdFor('loc-display', 0, 'NONE', 1), 'p-pack-st', 5, 'PROD-20260908-001'),
    occupy(slotIdFor('loc-display', 0, 'NONE', 2), 'p-pack-mt', 8, 'PROD-20260908-001'),
    occupy(slotIdFor('loc-display', 0, 'NONE', 3), 'p-pack-ch', 12, 'PROD-20260909-001'),
  ]
  const logs: PlacementLog[] = occupancies.map((row) => ({
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
