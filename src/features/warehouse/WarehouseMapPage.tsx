import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import { Button, Card, ConfirmDialog, Field, Input, Modal, PageHeader, Select, Textarea } from '@/components/ui'
import { hasPermission } from '@/features/settings/permissions'
import {
  contrastText,
  isFinishedPack,
  locationTypeLabel,
  occupancyBySlot,
  placedPacks,
  displayPacks,
  shortProductName,
  slotLabel,
  unplacedPacks,
  latestProductionRef,
  occupancyProductionLabel,
  BALANCE_USAGE_REASONS,
  balanceProductionDate,
  formatProductionDate,
} from '@/features/warehouse/warehouseModel'
import { useApi, useStore } from '@/store/hooks'
import { formatDateTime, formatQty } from '@/utils/format'
import type { BalanceUsageLog, BalanceUsageReason, PlacementLog, Product, SlotOccupancy, StorageLocation, StorageSlot } from '@/types'

type PlaceMode = { kind: 'place'; productId: string } | { kind: 'move'; fromSlotId: string } | null

type SlotDnd = {
  enabled: boolean
  fromId: string
  overId: string
  setFrom: (id: string) => void
  setOver: (id: string) => void
  markDrag: () => void
  consumedClick: () => boolean
  drop: (toSlotId: string, fromSlotId?: string) => void
  end: () => void
}

export function WarehouseMapPage() {
  const state = useStore()
  const api = useApi()
  const warehouseId = state.ui.warehouseFilter === 'all' ? 'wh-main' : state.ui.warehouseFilter
  const canView = hasPermission(state, 'warehouse_map.view')
  const canPlace = hasPermission(state, 'warehouse_map.putaway')
  const canMove = hasPermission(state, 'warehouse_map.move')
  const canManage = hasPermission(state, 'warehouse_map.location.manage')
  const canLayout = hasPermission(state, 'warehouse_map.layout.edit')
  const canUseBalance = hasPermission(state, 'warehouse_map.balance.use')
  const [query, setQuery] = useState('')
  const [highlightId, setHighlightId] = useState('')
  const [mode, setMode] = useState<PlaceMode>(null)
  const [selectedSlotId, setSelectedSlotId] = useState('')
  const [qty, setQty] = useState(20)
  const [showTemp, setShowTemp] = useState(false)
  const [showRack, setShowRack] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [balanceHistoryOpen, setBalanceHistoryOpen] = useState(false)
  const [deactivateId, setDeactivateId] = useState('')
  const [dragFromId, setDragFromId] = useState('')
  const [dragOverId, setDragOverId] = useState('')
  const [mapTab, setMapTab] = useState<'ctn' | 'pallet'>('ctn')
  const [topUpOpen, setTopUpOpen] = useState(false)
  const draggedRef = useRef(false)
  const occupancies = occupancyBySlot(state.slotOccupancies)
  const products = state.products.filter(isFinishedPack)
  const productById = (id: string) => state.products.find((row) => row.id === id)

  const unplaced = useMemo(
    () =>
      products
        .map((product) => ({
          product,
          qty: unplacedPacks(state, product.id, warehouseId),
          placed: placedPacks(state, product.id, warehouseId),
          display: displayPacks(state, product.id, warehouseId),
          inventory: state.inventory.find((row) => row.productId === product.id && row.warehouseId === warehouseId)?.qty ?? 0,
        }))
        .filter((row) => row.qty > 0 || row.placed + row.display > row.inventory),
    [products, state, warehouseId],
  )

  const overPlaced = unplaced.filter((row) => row.placed + row.display > row.inventory)
  const findMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return state.slotOccupancies
      .map((row) => {
        const product = productById(row.productId)
        const slot = state.storageSlots.find((item) => item.id === row.slotId)
        const location = slot ? state.storageLocations.find((item) => item.id === slot.locationId) : undefined
        if (!product || !slot || !location) return null
        if (!location.active || location.warehouseId !== warehouseId || location.type === 'DISPLAY' || location.type === 'BALANCE_AREA') return null
        if (!`${product.name} ${product.sku} ${location.name}`.toLowerCase().includes(q)) return null
        return { occupancy: row, product, slot, location }
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
  }, [query, state.slotOccupancies, state.storageSlots, state.storageLocations, warehouseId])

  const highlightedSlotIds = new Set(findMatches.map((row) => row.occupancy.slotId))
  if (highlightId) highlightedSlotIds.add(highlightId)

  const racks = state.storageLocations.filter((row) => row.active && row.warehouseId === warehouseId && row.type === 'RACK')
  const pallets = state.storageLocations.filter((row) => row.active && row.warehouseId === warehouseId && (row.type === 'PALLET' || row.type === 'FLOOR'))
  const balances = state.storageLocations.filter((row) => row.active && row.warehouseId === warehouseId && row.type === 'BALANCE_AREA')

  const firstEmptySlot = (locationId: string) =>
    state.storageSlots
      .filter((row) => row.locationId === locationId && row.active)
      .sort((a, b) => a.slotNo - b.slotNo)
      .find((row) => !occupancies[row.id])

  const clickSlot = (slot: StorageSlot, occupancy?: SlotOccupancy) => {
    if (mode?.kind === 'place') {
      if (occupancy) return
      if (!canPlace) return
      const location = state.storageLocations.find((row) => row.id === slot.locationId)
      if (location?.type === 'DISPLAY' || location?.type === 'BALANCE_AREA') {
        api.toast('Display is loose stock', 'Place cartons on CTN Rack or Pallet Stock, then top up Display from carton stock.', 'warning')
        return
      }
      setSelectedSlotId(slot.id)
      const remaining = unplacedPacks(state, mode.productId, warehouseId)
      setQty(Math.min(20, remaining) || remaining)
      return
    }
    if (mode?.kind === 'move') {
      if (slot.id === mode.fromSlotId) return
      if (!canMove) return
      setSelectedSlotId(slot.id)
      const source = occupancies[mode.fromSlotId]
      setQty(source?.quantityPacks ?? 0)
      return
    }
    if (occupancy && canMove) {
      setMode({ kind: 'move', fromSlotId: slot.id })
      setSelectedSlotId('')
      setQty(occupancy.quantityPacks)
    }
  }

  const confirmPlace = () => {
    if (!selectedSlotId || !mode) return
    if (mode.kind === 'place') {
      const remaining = unplacedPacks(state, mode.productId, warehouseId)
      const batchRef = latestProductionRef(state, mode.productId)
      const ok = api.placeStock({
        slotId: selectedSlotId,
        productId: mode.productId,
        qty,
        batchRef,
        productionSessionRef: batchRef,
      })
      if (ok) {
        setSelectedSlotId('')
        if (remaining - qty <= 0) setMode(null)
      }
      return
    }
    const toLocation = state.storageLocations.find((row) => row.id === state.storageSlots.find((item) => item.id === selectedSlotId)?.locationId)
    if (toLocation?.type === 'DISPLAY') {
      api.topUpDisplay({ fromSlotId: mode.fromSlotId, qty })
      setMode(null)
      setSelectedSlotId('')
      return
    }
    api.moveStock({
      fromSlotId: mode.fromSlotId,
      toSlotId: selectedSlotId,
      qty,
      action: 'MOVED',
    })
    setMode(null)
    setSelectedSlotId('')
  }

  const moveToDisplay = (fromSlotId: string) => {
    const source = occupancies[fromSlotId]
    if (!source) return
    setMode({ kind: 'move', fromSlotId })
    setQty(source.quantityPacks)
    setTopUpOpen(true)
  }

  const dropMove = (toSlotId: string, fromSlotId?: string) => {
    const fromId = fromSlotId || dragFromId
    if (!canMove || !fromId || fromId === toSlotId) return
    if (occupancies[toSlotId]) return
    const source = occupancies[fromId]
    const toSlot = state.storageSlots.find((row) => row.id === toSlotId && row.active)
    const toLocation = toSlot ? state.storageLocations.find((row) => row.id === toSlot.locationId && row.active) : undefined
    if (!source || !toSlot || !toLocation || toLocation.type === 'BALANCE_AREA' || toLocation.type === 'DISPLAY') return
    api.moveStock({
      fromSlotId: fromId,
      toSlotId,
      qty: source.quantityPacks,
      action: 'MOVED',
    })
    setMode(null)
    setSelectedSlotId('')
  }

  const dnd: SlotDnd = {
    enabled: canMove,
    fromId: dragFromId,
    overId: dragOverId,
    setFrom: setDragFromId,
    setOver: setDragOverId,
    markDrag: () => {
      draggedRef.current = true
    },
    consumedClick: () => {
      if (!draggedRef.current) return false
      draggedRef.current = false
      return true
    },
    drop: dropMove,
    end: () => {
      setDragFromId('')
      setDragOverId('')
    },
  }

  if (!canView) {
    return <PageHeader title="Warehouse Map" subtitle="You do not have permission to view the warehouse map." />
  }

  const placingProduct = mode?.kind === 'place' ? productById(mode.productId) : undefined
  const movingFrom = mode?.kind === 'move' ? occupancies[mode.fromSlotId] : undefined

  return (
    <div>
      <PageHeader
        title="Warehouse Map"
        subtitle="Physical carton locations. Inventory qty is unchanged when you place or move stock."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setHistoryOpen(true)}>Placement history</Button>
            <Button variant="secondary" onClick={() => setBalanceHistoryOpen(true)}>Balance usage</Button>
            {canManage && <Button variant="secondary" onClick={() => setShowTemp(true)}>+ Temporary location</Button>}
            {canLayout && <Button variant="secondary" onClick={() => setShowRack(true)}>+ Rack</Button>}
          </div>
        }
      />
      {overPlaced.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Map occupancy is higher than inventory for {overPlaced.map((row) => row.product.name).join(', ')}. POS does not deduct carton slots in this prototype.
        </div>
      )}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder={mapTab === 'pallet' ? 'Search location / product' : 'Find product'} value={query} onChange={(e) => { setQuery(e.target.value); setHighlightId('') }} />
        </div>
        {mode && (
          <Button variant="ghost" onClick={() => { setMode(null); setSelectedSlotId('') }}>
            Cancel {mode.kind === 'place' ? 'putaway' : 'move'}
          </Button>
        )}
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          {query.trim() && (
            <Card className="p-4">
              <div className="mb-3 text-sm font-semibold">Find results</div>
              {findMatches.length === 0 ? (
                <p className="text-sm text-slate-500">No mapped locations.</p>
              ) : (
                <div className="space-y-2">
                  {findMatches.map((row) => (
                    <button
                      key={row.occupancy.id}
                      type="button"
                      className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50 ${
                        highlightId === row.occupancy.slotId ? 'bg-indigo-50 ring-1 ring-indigo-300' : ''
                      }`}
                      onClick={() => {
                        setHighlightId(row.occupancy.slotId)
                        setMapTab(row.location.type === 'RACK' ? 'ctn' : 'pallet')
                      }}
                    >
                      {slotLabel(state, row.occupancy.slotId)} · {formatQty(row.occupancy.quantityPacks)} · {occupancyProductionLabel(state, row.occupancy)}
                    </button>
                  ))}
                </div>
              )}
            </Card>
          )}
          <Card className="p-4">
            <div className="mb-3 text-sm font-semibold">Ready to place</div>
            <p className="mb-3 text-[11px] text-slate-400">Place carton stock onto CTN Rack or Pallet Stock. Display is loose stock, not a map slot.</p>
            {unplaced.filter((row) => row.qty > 0).length === 0 ? (
              <p className="text-sm text-slate-500">No finished goods waiting for placement.</p>
            ) : (
              <div className="space-y-3">
                {unplaced.filter((row) => row.qty > 0).map((row) => (
                  <div key={row.product.id} className="rounded-xl border border-slate-100 p-3">
                    <div className="text-sm font-medium text-slate-900">{row.product.name}</div>
                    <div className="mt-1 text-lg font-semibold tabular">{formatQty(row.qty)} PACK</div>
                    <div className="text-xs text-slate-400">Inventory {formatQty(row.inventory)} · Display {formatQty(row.display)} · Carton {formatQty(row.placed)}</div>
                    {latestProductionRef(state, row.product.id) && (
                      <div className="text-xs text-slate-400">Batch: {latestProductionRef(state, row.product.id)}</div>
                    )}
                    {canPlace && (
                      <Button
                        size="sm"
                        className="mt-2"
                        onClick={() => { setMode({ kind: 'place', productId: row.product.id }); setSelectedSlotId(''); setQty(Math.min(20, row.qty)) }}
                      >
                        Place stock
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
          {mode?.kind === 'move' && movingFrom && (
            <Card className="p-4">
              <div className="text-sm font-semibold">Move stock</div>
              <p className="mt-1 text-sm text-slate-600">{slotLabel(state, mode.fromSlotId)} · {formatQty(movingFrom.quantityPacks)} pack</p>
              <p className="mt-2 text-xs text-slate-500">Click a destination cell, or top up Display from this carton.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => moveToDisplay(mode.fromSlotId)}>Top up Display</Button>
                <Button size="sm" variant="secondary" onClick={() => api.emptySlot(mode.fromSlotId)}>Empty (unplace)</Button>
              </div>
            </Card>
          )}
          {mode?.kind === 'place' && placingProduct && (
            <Card className="p-4">
              <div className="text-sm font-semibold">Placing {placingProduct.name}</div>
              <p className="mt-1 text-sm text-slate-600">{formatQty(unplacedPacks(state, placingProduct.id, warehouseId))} pack left. Click an empty CTN Rack cell or Place here on Pallet Stock.</p>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap gap-2">
            <Button variant={mapTab === 'ctn' ? 'primary' : 'secondary'} onClick={() => setMapTab('ctn')}>CTN Rack</Button>
            <Button variant={mapTab === 'pallet' ? 'primary' : 'secondary'} onClick={() => setMapTab('pallet')}>Pallet Stock</Button>
          </div>
          {mapTab === 'ctn' ? (
            <>
              <div className="overflow-x-auto pb-2">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">CTN Rack</div>
                <div className="flex min-w-max gap-6">
                  {racks.map((rack) => (
                    <RackCard
                      key={rack.id}
                      location={rack}
                      slots={state.storageSlots.filter((row) => row.locationId === rack.id && row.active)}
                      occupancies={occupancies}
                      productById={productById}
                      highlightedSlotIds={highlightedSlotIds}
                      selectedSlotId={selectedSlotId}
                      searching={Boolean(query.trim())}
                      onClick={clickSlot}
                      onDeactivate={canManage ? () => setDeactivateId(rack.id) : undefined}
                      dnd={dnd}
                    />
                  ))}
                </div>
              </div>
              {balances.map((location) => (
                <BalanceStrip key={location.id} location={location} slots={state.storageSlots.filter((row) => row.locationId === location.id && row.active)} canUse={canUseBalance} />
              ))}
            </>
          ) : (
            <PalletStockPanel
              locations={pallets}
              query={query}
              occupancies={occupancies}
              productById={productById}
              highlightedSlotIds={highlightedSlotIds}
              selectedSlotId={selectedSlotId}
              canManage={canManage}
              canPlace={canPlace}
              placing={mode?.kind === 'place'}
              firstEmptySlot={firstEmptySlot}
              onClickSlot={clickSlot}
              onPlaceHere={(locationId) => {
                const slot = firstEmptySlot(locationId)
                if (!slot) {
                  api.toast('Pallet is full', 'Empty a carton position or add another pallet.', 'warning')
                  return
                }
                clickSlot(slot)
              }}
              onDeactivate={(id) => setDeactivateId(id)}
              onDropLocation={(locationId, fromSlotId) => {
                const slot = firstEmptySlot(locationId)
                if (!slot) return
                dropMove(slot.id, fromSlotId)
              }}
              dnd={dnd}
            />
          )}
        </div>
      </div>

      <Modal
        open={Boolean(selectedSlotId && mode)}
        onClose={() => setSelectedSlotId('')}
        title={mode?.kind === 'place' ? 'Place stock' : 'Move stock'}
      >
        {selectedSlotId && mode && (
          <div className="space-y-3">
            <Field label="Location">
              <div className="text-sm text-slate-800">{slotLabel(state, selectedSlotId)}</div>
            </Field>
            <Field label="Product">
              <div className="text-sm font-medium">
                {mode.kind === 'place' ? placingProduct?.name : productById(movingFrom?.productId ?? '')?.name}
              </div>
            </Field>
            {mode.kind === 'place' && placingProduct && (
              <Field label="Available to place">
                <div className="text-sm tabular">{formatQty(unplacedPacks(state, placingProduct.id, warehouseId))} PACK</div>
              </Field>
            )}
            <Field label="Quantity (packs)">
              <Input type="number" min={0.01} step="1" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            </Field>
            {(mode.kind === 'move' ? movingFrom?.batchRef : latestProductionRef(state, placingProduct?.id ?? '')) ? (
              <Field label="Batch">
                <div className="text-sm text-slate-600">
                  {mode.kind === 'move'
                    ? movingFrom?.batchRef
                    : latestProductionRef(state, placingProduct?.id ?? '')}
                </div>
              </Field>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSelectedSlotId('')}>Cancel</Button>
              <Button onClick={confirmPlace}>{mode.kind === 'place' ? 'Place' : 'Move'}</Button>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={topUpOpen && mode?.kind === 'move'}
        onClose={() => setTopUpOpen(false)}
        title="Top up Display"
      >
        {mode?.kind === 'move' && movingFrom && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Move packs from {slotLabel(state, mode.fromSlotId)} into Display / Loose stock. Inventory total does not change.
            </p>
            <Field label="Available">
              <div className="text-sm tabular">{formatQty(movingFrom.quantityPacks)} PACK</div>
            </Field>
            <Field label="Quantity (packs)">
              <Input type="number" min={0.01} step="1" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setTopUpOpen(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  const ok = api.topUpDisplay({ fromSlotId: mode.fromSlotId, qty })
                  if (ok) {
                    setTopUpOpen(false)
                    setMode(null)
                    setSelectedSlotId('')
                  }
                }}
              >
                Top up Display
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <TempLocationModal open={showTemp} onClose={() => setShowTemp(false)} warehouseId={warehouseId} />
      <RackModal open={showRack} onClose={() => setShowRack(false)} warehouseId={warehouseId} />
      <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} logs={state.placementLogs} />
      <BalanceUsageHistoryModal open={balanceHistoryOpen} onClose={() => setBalanceHistoryOpen(false)} logs={state.balanceUsageLogs ?? []} />
      <ConfirmDialog
        open={Boolean(deactivateId)}
        title="Deactivate location?"
        message="History is kept. The location can only be deactivated if it is empty."
        confirmLabel="Deactivate"
        onClose={() => setDeactivateId('')}
        onConfirm={() => {
          if (deactivateId) api.deactivateStorageLocation(deactivateId)
          setDeactivateId('')
        }}
      />
    </div>
  )
}

function PalletStockPanel({
  locations,
  query,
  occupancies,
  productById,
  highlightedSlotIds,
  selectedSlotId,
  canManage,
  canPlace,
  placing,
  firstEmptySlot,
  onClickSlot,
  onPlaceHere,
  onDeactivate,
  onDropLocation,
  dnd,
}: {
  locations: StorageLocation[]
  query: string
  occupancies: Record<string, SlotOccupancy>
  productById: (id: string) => Product | undefined
  highlightedSlotIds: Set<string>
  selectedSlotId: string
  canManage: boolean
  canPlace: boolean
  placing: boolean
  firstEmptySlot: (locationId: string) => StorageSlot | undefined
  onClickSlot: (slot: StorageSlot, occupancy?: SlotOccupancy) => void
  onPlaceHere: (locationId: string) => void
  onDeactivate: (id: string) => void
  onDropLocation: (locationId: string, fromSlotId?: string) => void
  dnd: SlotDnd
}) {
  const state = useStore()
  const q = query.trim().toLowerCase()
  const cards = locations
    .map((location) => {
      const slots = state.storageSlots.filter((row) => row.locationId === location.id && row.active).sort((a, b) => a.slotNo - b.slotNo)
      const rows = slots
        .map((slot) => occupancies[slot.id] ? { slot, occupancy: occupancies[slot.id], product: productById(occupancies[slot.id].productId) } : null)
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
      return { location, slots, rows, empty: firstEmptySlot(location.id) }
    })
    .filter((card) => {
      if (!q) return true
      if (card.location.name.toLowerCase().includes(q)) return true
      return card.rows.some((row) => `${row.product?.name ?? ''} ${row.product?.sku ?? ''}`.toLowerCase().includes(q))
    })

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Pallet Stock</div>
        <p className="mt-1 text-[11px] text-slate-400">Cartons stored outside the CTN Rack. Empty pallets can be deactivated; history is kept.</p>
      </div>
      {cards.length === 0 ? (
        <Card className="p-5">
          <p className="text-sm text-slate-500">{locations.length === 0 ? 'No active pallet locations. Add a temporary location such as DEPAN OFFICE.' : 'No pallet locations match that search.'}</p>
        </Card>
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          {cards.map((card) => {
            const highlighted = card.rows.some((row) => highlightedSlotIds.has(row.slot.id))
            const visibleSlots = [
              ...card.rows.map((row) => row.slot),
              ...(card.empty ? [card.empty] : []),
            ]
            return (
              <div
                key={card.location.id}
                className={`w-fit shrink-0 rounded-xl border bg-white p-1.5 ${highlighted ? 'border-indigo-300 ring-1 ring-indigo-200' : 'border-slate-200'}`}
                onDragOver={(event) => {
                  if (!dnd.enabled || !dnd.fromId || !card.empty) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  if (dnd.overId !== card.empty.id) dnd.setOver(card.empty.id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const fromId = event.dataTransfer.getData('text/plain') || dnd.fromId
                  onDropLocation(card.location.id, fromId)
                  dnd.end()
                }}
              >
                <div className="mb-1.5 max-w-[96px] px-0.5">
                  <div className="text-[11px] font-semibold leading-tight text-slate-900">{card.location.name}</div>
                  <div className="text-[9px] uppercase tracking-wide text-slate-400">{locationTypeLabel(card.location.type)}</div>
                  <div className="mt-1 flex flex-col items-start gap-1">
                    {placing && canPlace && (
                      <button type="button" className="text-[10px] font-medium text-indigo-600" onClick={() => onPlaceHere(card.location.id)}>Place here</button>
                    )}
                    {canManage && card.rows.length === 0 && (
                      <button type="button" className="text-[10px] text-rose-600" onClick={() => onDeactivate(card.location.id)}>Deactivate</button>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  {visibleSlots.map((slot) => {
                    const occupancy = occupancies[slot.id]
                    const slotHighlighted = highlightedSlotIds.has(slot.id)
                    return (
                      <SlotCell
                        key={slot.id}
                        slot={slot}
                        occupancy={occupancy}
                        product={occupancy ? productById(occupancy.productId) : undefined}
                        highlighted={slotHighlighted}
                        selected={selectedSlotId === slot.id}
                        dimmed={Boolean(q && occupancy && !slotHighlighted)}
                        onClick={() => onClickSlot(slot, occupancy)}
                        dnd={dnd}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RackCard({
  location,
  slots,
  occupancies,
  productById,
  highlightedSlotIds,
  selectedSlotId,
  searching,
  onClick,
  onDeactivate,
  dnd,
}: {
  location: StorageLocation
  slots: StorageSlot[]
  occupancies: Record<string, SlotOccupancy>
  productById: (id: string) => Product | undefined
  highlightedSlotIds: Set<string>
  selectedSlotId: string
  searching?: boolean
  onClick: (slot: StorageSlot, occupancy?: SlotOccupancy) => void
  onDeactivate?: () => void
  dnd: SlotDnd
}) {
  const levels = [...new Set(slots.map((row) => row.level))].sort((a, b) => a - b)
  const occupied = slots.some((slot) => occupancies[slot.id])
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <MapPin size={15} className="text-slate-400" />
          {location.name}
        </div>
        {onDeactivate && !occupied && (
          <button type="button" className="text-xs text-rose-600" onClick={onDeactivate}>Deactivate</button>
        )}
      </div>
      <div className="space-y-4">
        {levels.map((level) => {
          const front = slots.filter((row) => row.level === level && row.face === 'FRONT').sort((a, b) => a.slotNo - b.slotNo)
          const back = slots.filter((row) => row.level === level && row.face === 'BACK').sort((a, b) => a.slotNo - b.slotNo)
          return (
            <div key={level}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Level {level}</div>
              <FaceRow
                label="Back"
                slots={back}
                occupancies={occupancies}
                productById={productById}
                highlightedSlotIds={highlightedSlotIds}
                selectedSlotId={selectedSlotId}
                partnerSlots={front}
                searching={searching}
                onClick={onClick}
                dnd={dnd}
                muted
              />
              <FaceRow
                label="Front"
                slots={front}
                occupancies={occupancies}
                productById={productById}
                highlightedSlotIds={highlightedSlotIds}
                selectedSlotId={selectedSlotId}
                partnerSlots={back}
                searching={searching}
                onClick={onClick}
                dnd={dnd}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FaceRow({
  label,
  slots,
  occupancies,
  productById,
  highlightedSlotIds,
  selectedSlotId,
  partnerSlots,
  searching,
  onClick,
  dnd,
  muted,
}: {
  label: string
  slots: StorageSlot[]
  occupancies: Record<string, SlotOccupancy>
  productById: (id: string) => Product | undefined
  highlightedSlotIds: Set<string>
  selectedSlotId: string
  partnerSlots: StorageSlot[]
  searching?: boolean
  onClick: (slot: StorageSlot, occupancy?: SlotOccupancy) => void
  dnd: SlotDnd
  muted?: boolean
}) {
  return (
    <div className={muted ? '' : 'mt-1'}>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="flex gap-1.5">
        {slots.map((slot) => {
          const partner = partnerSlots.find((row) => row.slotNo === slot.slotNo)
          const backHidden = Boolean(muted && occupancies[slot.id] && partner && occupancies[partner.id])
          const highlighted = highlightedSlotIds.has(slot.id)
          return (
            <SlotCell
              key={slot.id}
              slot={slot}
              occupancy={occupancies[slot.id]}
              product={occupancies[slot.id] ? productById(occupancies[slot.id].productId) : undefined}
              highlighted={highlighted}
              selected={selectedSlotId === slot.id}
              dimmed={Boolean(searching && occupancies[slot.id] && !highlighted)}
              backStock={backHidden}
              onClick={() => onClick(slot, occupancies[slot.id])}
              dnd={dnd}
            />
          )
        })}
      </div>
    </div>
  )
}

function BalanceStrip({ location, slots, canUse }: { location: StorageLocation; slots: StorageSlot[]; canUse: boolean }) {
  const state = useStore()
  const [useId, setUseId] = useState('')
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{location.name}</div>
      <p className="mb-2 text-[11px] text-slate-400">Leftover production stock in grams. Using balance does not change pack inventory.</p>
      <div className="flex flex-wrap gap-2">
        {slots.sort((a, b) => a.slotNo - b.slotNo).map((slot) => {
          const rows = state.productionBalances.filter(
            (row) => row.status === 'available' && row.quantity > 0 && row.warehouseId === location.warehouseId && row.container === `Box ${slot.slotNo}`,
          )
          return (
            <div key={slot.id} className="min-w-[160px] rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Box {slot.slotNo}</div>
              {rows.length ? rows.map((row) => {
                const product = state.products.find((item) => item.id === row.productId)
                const produced = formatProductionDate(balanceProductionDate(state, row.productionDate, row.productionReference))
                return (
                  <div key={row.id} className="mt-2 border-t border-slate-200/80 pt-2 first:mt-1 first:border-t-0 first:pt-0">
                    <div className="text-xs font-medium text-slate-800">{shortProductName(product?.name ?? 'Balance')}</div>
                    <div className="tabular text-sm text-slate-700">{formatQty(row.quantity)}{row.unit}</div>
                    {produced ? <div className="mt-0.5 text-[11px] text-slate-500">Production Date: {produced}</div> : null}
                    {canUse && (
                      <Button size="sm" variant="secondary" className="mt-1.5" onClick={() => setUseId(row.id)}>
                        Use balance
                      </Button>
                    )}
                  </div>
                )
              }) : <div className="mt-1 text-xs text-slate-400">Empty</div>}
            </div>
          )
        })}
      </div>
      <UseBalanceModal balanceId={useId} onClose={() => setUseId('')} />
    </div>
  )
}

function SlotCell({
  slot,
  occupancy,
  product,
  highlighted,
  selected,
  dimmed,
  backStock,
  onClick,
  dnd,
}: {
  slot: StorageSlot
  occupancy?: SlotOccupancy
  product?: Product
  highlighted?: boolean
  selected?: boolean
  dimmed?: boolean
  backStock?: boolean
  onClick: () => void
  dnd?: SlotDnd
}) {
  const state = useStore()
  const color = product?.accent || '#e2e8f0'
  const occupied = Boolean(occupancy)
  const canDrag = Boolean(dnd?.enabled && occupied)
  const dragging = Boolean(dnd?.fromId === slot.id)
  const hovering = Boolean(dnd?.fromId && dnd.fromId !== slot.id && dnd.overId === slot.id)
  const dropOk = hovering && !occupied
  const dropBad = hovering && occupied
  const produced = occupancy ? occupancyProductionLabel(state, occupancy) : ''
  return (
    <button
      type="button"
      draggable={canDrag}
      onDragStart={(event) => {
        if (!canDrag || !dnd) {
          event.preventDefault()
          return
        }
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', slot.id)
        dnd.markDrag()
        dnd.setFrom(slot.id)
      }}
      onDragEnd={() => dnd?.end()}
      onDragOver={(event) => {
        if (!dnd?.enabled || !dnd.fromId || dnd.fromId === slot.id) return
        event.preventDefault()
        event.dataTransfer.dropEffect = occupied ? 'none' : 'move'
        if (dnd.overId !== slot.id) dnd.setOver(slot.id)
      }}
      onDragLeave={() => {
        if (dnd?.overId === slot.id) dnd.setOver('')
      }}
      onDrop={(event) => {
        event.preventDefault()
        const fromId = event.dataTransfer.getData('text/plain') || dnd?.fromId
        dnd?.drop(slot.id, fromId)
        dnd?.end()
      }}
      onClick={() => {
        if (dnd?.consumedClick()) return
        onClick()
      }}
      className={`relative h-[76px] w-[96px] shrink-0 rounded-lg border text-left text-[11px] leading-tight ${
        occupancy
          ? 'border-slate-300 shadow-sm'
          : 'border-dashed border-slate-300 bg-[repeating-linear-gradient(-45deg,#fff,#fff_6px,#f8fafc_6px,#f8fafc_12px)] text-slate-400'
      } ${highlighted ? 'z-10 scale-[1.03] ring-4 ring-indigo-500 ring-offset-2' : ''} ${selected ? 'ring-2 ring-emerald-500' : ''} ${
        dimmed && !dragging ? 'opacity-35' : ''
      } ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''} ${dragging ? 'opacity-50 shadow-md' : ''} ${
        dropOk ? 'z-10 ring-2 ring-emerald-500 bg-emerald-50' : ''
      } ${dropBad ? 'z-10 ring-2 ring-rose-400' : ''}`}
      style={occupancy ? { background: color, color: contrastText(color) } : undefined}
    >
      <div className="flex h-full flex-col justify-between p-1.5">
        {occupancy && product ? (
          <>
            <div className="font-semibold uppercase tracking-wide">{shortProductName(product.name)}</div>
            <div>
              <div className="tabular font-medium">{formatQty(occupancy.quantityPacks)} PACK</div>
              <div className="text-[9px] font-medium tabular opacity-80">{produced}</div>
            </div>
          </>
        ) : (
          <div className="m-auto text-[10px] font-medium tracking-wide">EMPTY</div>
        )}
      </div>
      {backStock && (
        <span className="absolute -top-1 right-1 rounded bg-slate-900/80 px-1 text-[8px] font-semibold uppercase tracking-wide text-white">
          Back stock
        </span>
      )}
    </button>
  )
}

function TempLocationModal({ open, onClose, warehouseId }: { open: boolean; onClose: () => void; warehouseId: string }) {
  const api = useApi()
  const [name, setName] = useState('DEPAN OFFICE')
  const [type, setType] = useState<'PALLET' | 'FLOOR'>('PALLET')
  const [slotCount, setSlotCount] = useState(3)
  return (
    <Modal open={open} onClose={onClose} title="Add temporary location">
      <div className="space-y-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as 'PALLET' | 'FLOOR')}>
            <option value="PALLET">Pallet</option>
            <option value="FLOOR">Floor</option>
          </Select>
        </Field>
        <Field label="Positions"><Input type="number" min={1} value={slotCount} onChange={(e) => setSlotCount(Number(e.target.value))} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (api.createTemporaryLocation({ name, type, warehouseId, slotCount })) onClose()
            }}
          >
            Add
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function RackModal({ open, onClose, warehouseId }: { open: boolean; onClose: () => void; warehouseId: string }) {
  const api = useApi()
  const [name, setName] = useState('Rack 3')
  const [levels, setLevels] = useState(4)
  const [frontCount, setFrontCount] = useState(4)
  const [backCount, setBackCount] = useState(4)
  return (
    <Modal open={open} onClose={onClose} title="Add rack">
      <div className="space-y-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Levels"><Input type="number" min={1} value={levels} onChange={(e) => setLevels(Number(e.target.value))} /></Field>
          <Field label="Front"><Input type="number" min={1} value={frontCount} onChange={(e) => setFrontCount(Number(e.target.value))} /></Field>
          <Field label="Back"><Input type="number" min={0} value={backCount} onChange={(e) => setBackCount(Number(e.target.value))} /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (api.createRackLocation({ name, warehouseId, levels, frontCount, backCount })) onClose()
            }}
          >
            Generate slots
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function HistoryModal({ open, onClose, logs }: { open: boolean; onClose: () => void; logs: PlacementLog[] }) {
  const state = useStore()
  return (
    <Modal open={open} onClose={onClose} title="Placement history" width="max-w-2xl">
      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {logs.length === 0 && <p className="text-sm text-slate-500">No movements yet.</p>}
        {logs.slice(0, 80).map((row) => {
          const product = state.products.find((item) => item.id === row.productId)
          return (
            <div key={row.id} className="rounded-lg border border-slate-100 px-3 py-2 text-sm">
              <div className="font-medium text-slate-800">{row.action} · {shortProductName(product?.name ?? 'Product')} · {formatQty(row.quantity)}</div>
              <div className="text-xs text-slate-500">
                {row.fromSlotId ? slotLabel(state, row.fromSlotId) : 'Unplaced'}
                {' → '}
                {row.toSlotId ? slotLabel(state, row.toSlotId) : 'Unplaced'}
                {' · '}{row.performedBy}
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function UseBalanceModal({ balanceId, onClose }: { balanceId: string; onClose: () => void }) {
  const state = useStore()
  const api = useApi()
  const balance = state.productionBalances.find((row) => row.id === balanceId)
  const product = balance ? state.products.find((row) => row.id === balance.productId) : undefined
  const [qty, setQty] = useState(0)
  const [reason, setReason] = useState<BalanceUsageReason>('Content')
  const [notes, setNotes] = useState('')
  useEffect(() => {
    setQty(0)
    setReason('Content')
    setNotes('')
  }, [balanceId])
  const produced = balance ? formatProductionDate(balanceProductionDate(state, balance.productionDate, balance.productionReference)) : ''
  return (
    <Modal open={Boolean(balance)} onClose={onClose} title="Use balance">
      {balance && (
        <div className="space-y-3">
          <Field label="Product">
            <div className="text-sm font-medium">{product?.name ?? 'Balance'}</div>
          </Field>
          <Field label="Available">
            <div className="text-sm tabular">{formatQty(balance.quantity)} {balance.unit}</div>
          </Field>
          {produced ? (
            <Field label="Production Date">
              <div className="text-sm text-slate-600">{produced}</div>
            </Field>
          ) : null}
          {balance.productionReference ? (
            <Field label="Batch">
              <div className="text-sm text-slate-600">{balance.productionReference}</div>
            </Field>
          ) : null}
          <Field label="Quantity used">
            <Input type="number" min={0.01} step="0.01" value={qty || ''} onChange={(e) => setQty(Number(e.target.value))} />
          </Field>
          <Field label="Reason">
            <Select value={reason} onChange={(e) => setReason(e.target.value as BalanceUsageReason)}>
              {BALANCE_USAGE_REASONS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </Select>
          </Field>
          <Field label="Notes">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => {
                if (api.useProductionBalance({ balanceId: balance.id, qty, reason, notes })) onClose()
              }}
            >
              Confirm use
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function BalanceUsageHistoryModal({ open, onClose, logs }: { open: boolean; onClose: () => void; logs: BalanceUsageLog[] }) {
  const state = useStore()
  return (
    <Modal open={open} onClose={onClose} title="Balance usage" width="max-w-2xl">
      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {logs.length === 0 && <p className="text-sm text-slate-500">No balance usage yet.</p>}
        {logs.slice(0, 80).map((row) => {
          const product = state.products.find((item) => item.id === row.productId)
          const produced = formatProductionDate(row.productionDate)
          return (
            <div key={row.id} className="rounded-lg border border-slate-100 px-3 py-2 text-sm">
              <div className="font-medium text-slate-800">
                {shortProductName(product?.name ?? 'Product')} · {formatQty(row.quantity)}{row.unit} · {row.reason}
              </div>
              <div className="text-xs text-slate-500">
                {row.container || row.location}
                {produced ? ` · Production Date: ${produced}` : ''}
                {row.productionReference ? ` · ${row.productionReference}` : ''}
                {' · '}{row.performedBy}
                {' · '}{formatDateTime(row.performedAt)}
              </div>
              {row.notes ? <div className="mt-1 text-xs text-slate-500">{row.notes}</div> : null}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
