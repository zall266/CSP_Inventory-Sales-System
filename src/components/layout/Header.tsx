import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  CalendarDays,
  Menu,
  Plus,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { useApi, useStore } from '@/store/hooks'
import { formatDate, initials } from '@/utils/format'
import { headerDateLabels } from '@/utils/headerDates'
import { Dropdown, MenuItem } from '@/components/ui'
import { currentUser } from '@/features/manufacturing/sessionPlan'
import { displayRoleName, hasPermission } from '@/features/settings/permissions'
import { companyWarehouses } from '@/features/agent/agentModel'

export function Header() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isPos = pathname === '/pos'
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const dateLabels = headerDateLabels()
  const user = currentUser(state)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isPos) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isPos])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 1) return null
    const products = state.products.filter((p) => `${p.name} ${p.sku} ${p.barcode}`.toLowerCase().includes(q)).slice(0, 5)
    const sales = state.sales.filter((s) => s.invoiceNo.toLowerCase().includes(q)).slice(0, 5)
    const purchases = state.purchases.filter((p) => `${p.purchaseNo} ${p.invoiceNumber}`.toLowerCase().includes(q)).slice(0, 5)
    const receivings = (state.receivings ?? []).filter((r) => r.receivingNo.toLowerCase().includes(q)).slice(0, 5)
    const customers = state.customers.filter((c) => `${c.name} ${c.phone}`.toLowerCase().includes(q)).slice(0, 5)
    const suppliers = state.suppliers.filter((s) => `${s.name} ${s.contact}`.toLowerCase().includes(q)).slice(0, 5)
    const production = state.productionOrders.filter((o) => {
      const name = state.products.find((p) => p.id === o.productId)?.name ?? ''
      return `${o.orderNo} ${o.batchNo} ${name}`.toLowerCase().includes(q)
    }).slice(0, 5)
    const sessions = state.productionSessions.filter((s) => s.reference.toLowerCase().includes(q)).slice(0, 5)
    const batches = state.batches.filter((b) => b.batchNo.toLowerCase().includes(q)).slice(0, 5)
    const openingBalances = (state.openingBalances ?? [])
      .filter((row) => `${row.documentNo} ${row.type}`.toLowerCase().includes(q))
      .slice(0, 5)
    return { products, sales, purchases, receivings, customers, suppliers, production, batches, sessions, openingBalances }
  }, [query, state])

  const unread = state.notifications.filter((n) => !n.read).length

  return (
    <header
      className="no-print sticky top-0 z-30 flex h-16 min-w-0 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur lg:px-6"
      data-app-header={isPos ? 'pos' : 'office'}
    >
      <button
        type="button"
        className="shrink-0 rounded-xl p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
        onClick={() => api.setMobileNavOpen(true)}
      >
        <Menu size={18} />
      </button>
      <button
        type="button"
        className="hidden shrink-0 rounded-xl p-2 text-slate-500 hover:bg-slate-100 lg:inline-flex"
        onClick={() => api.setSidebarCollapsed(!state.ui.sidebarCollapsed)}
      >
        {state.ui.sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>

      {isPos ? (
        <div className="min-w-0 flex-1" data-header-search-slot="pos" />
      ) : (
        <div className="relative min-w-0 flex-1" data-header-search>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSearchOpen(true)
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 180)}
            placeholder="Search"
            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-50 min-[1440px]:pr-16"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-400 min-[1440px]:block">
            ⌘K
          </kbd>
          {searchOpen && results && (
            <div className="absolute z-50 mt-2 max-h-[70vh] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
              <SearchGroup
                label="Products"
                items={results.products.map((p) => ({ id: p.id, title: p.name, meta: p.sku }))}
                onPick={(id) => {
                  api.openDrawer({ type: 'product', id })
                  setQuery('')
                }}
              />
              <SearchGroup
                label="Sales"
                items={results.sales.map((s) => ({ id: s.id, title: s.invoiceNo, meta: formatDate(s.date) }))}
                onPick={(id) => {
                  navigate('/sales')
                  api.openDrawer({ type: 'sale', id })
                  setQuery('')
                }}
              />
              <SearchGroup
                label="Purchases"
                items={results.purchases.map((p) => ({ id: p.id, title: p.purchaseNo, meta: p.invoiceNumber }))}
                onPick={(id) => {
                  navigate('/purchases')
                  api.openDrawer({ type: 'purchase', id })
                  setQuery('')
                }}
              />
              <SearchGroup
                label="Receiving"
                items={results.receivings.map((r) => ({ id: r.id, title: r.receivingNo, meta: r.purchaseNo ?? 'Unlinked' }))}
                onPick={(id) => {
                  navigate(`/receiving/${id}`)
                  setQuery('')
                }}
              />
              <SearchGroup
                label="Customers"
                items={results.customers.map((c) => ({ id: c.id, title: c.name, meta: c.phone }))}
                onPick={(id) => {
                  navigate('/customers')
                  api.openDrawer({ type: 'customer', id })
                  setQuery('')
                }}
              />
              <SearchGroup
                label="Suppliers"
                items={results.suppliers.map((s) => ({ id: s.id, title: s.name, meta: s.contact }))}
                onPick={(id) => {
                  navigate('/suppliers')
                  api.openDrawer({ type: 'supplier', id })
                  setQuery('')
                }}
              />
              <SearchGroup
                label="Production"
                items={results.production.map((o) => ({
                  id: o.id,
                  title: o.orderNo,
                  meta: o.batchNo || state.products.find((p) => p.id === o.productId)?.name || '',
                }))}
                onPick={(id) => {
                  navigate(`/manufacturing/orders/${id}`)
                  api.openDrawer({ type: 'production', id })
                  setQuery('')
                }}
              />
              <SearchGroup
                label="Batches"
                items={results.batches.map((b) => ({
                  id: b.id,
                  title: b.batchNo,
                  meta: state.products.find((p) => p.id === b.productId)?.name || '',
                }))}
                onPick={(id) => {
                  const batch = state.batches.find((b) => b.id === id)
                  if (batch) api.openDrawer({ type: 'product', id: batch.productId })
                  setQuery('')
                }}
              />
              <SearchGroup
                label="Daily production"
                items={results.sessions.map((s) => ({ id: s.id, title: s.reference, meta: s.status }))}
                onPick={(id) => {
                  navigate(`/manufacturing/today/${id}`)
                  setQuery('')
                }}
              />
              <SearchGroup
                label="Opening Balance"
                items={results.openingBalances.map((row) => ({ id: row.id, title: row.documentNo, meta: row.type }))}
                onPick={(id) => {
                  navigate(`/inventory/opening-balance/${id}`)
                  setQuery('')
                }}
              />
              {!results.products.length &&
                !results.sales.length &&
                !results.purchases.length &&
                !results.receivings.length &&
                !results.customers.length &&
                !results.suppliers.length &&
                !results.production.length &&
                !results.batches.length &&
                !results.sessions.length &&
                !results.openingBalances.length && (
                  <div className="px-3 py-6 text-center text-sm text-slate-500">No results for “{query}”</div>
                )}
            </div>
          )}
        </div>
      )}

      <select
        value={state.ui.warehouseFilter}
        onChange={(event) => api.setWarehouseFilter(event.target.value)}
        className="hidden h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 md:block"
        data-header-warehouse
      >
        <option value="all">All warehouses</option>
        {companyWarehouses(state.warehouses).map((warehouse) => (
          <option key={warehouse.id} value={warehouse.id}>
            {warehouse.name}
          </option>
        ))}
      </select>

      {!isPos && (
        <Dropdown
          trigger={
            <button type="button" className="inline-flex h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-xl bg-indigo-600 px-3 text-sm font-medium text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-700" data-header-quick-add>
              <Plus size={16} />
              <span className="hidden sm:inline">Quick Add</span>
            </button>
          }
        >
          <MenuItem onClick={() => navigate('/pos')}>New Sale</MenuItem>
          <MenuItem onClick={() => navigate('/purchases/new')}>New Purchase</MenuItem>
          {hasPermission(state, 'receiving.create') ? (
            <MenuItem onClick={() => navigate('/receiving/new')}>New Receiving</MenuItem>
          ) : null}
          <MenuItem onClick={() => api.openModal('product')}>Add Product</MenuItem>
          <MenuItem onClick={() => api.openModal('customer')}>Add Customer</MenuItem>
          <MenuItem onClick={() => api.openModal('supplier')}>Add Supplier</MenuItem>
          <MenuItem onClick={() => navigate('/stock-adjustment')}>Adjust Stock</MenuItem>
          <MenuItem onClick={() => api.openModal('payment')}>Record Payment</MenuItem>
          <MenuItem onClick={() => api.openModal('bom')}>New BOM</MenuItem>
          <MenuItem onClick={() => navigate('/manufacturing/today')}>Today's Production</MenuItem>
          <MenuItem onClick={() => navigate('/manufacturing/orders/new')}>New Production Order</MenuItem>
        </Dropdown>
      )}

      <Dropdown
        trigger={
          <button type="button" className="relative rounded-xl p-2 text-slate-500 hover:bg-slate-100" data-header-notifications>
            <Bell size={18} />
            {unread > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500" />
            )}
          </button>
        }
      >
        <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Notifications
          {unread > 0 && (
            <button
              type="button"
              className="font-medium normal-case tracking-normal text-indigo-600"
              onClick={() => api.markAllNotificationsRead()}
            >
              Mark all read
            </button>
          )}
        </div>
        {state.notifications.slice(0, 6).map((item) => (
          <button
            key={item.id}
            type="button"
            className="block w-full px-3 py-2 text-left hover:bg-slate-50"
            onClick={() => {
              api.markNotificationRead(item.id)
              if (item.href) navigate(item.href)
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium text-slate-800">{item.title}</div>
              {!item.read && <span className="mt-1 h-1.5 w-1.5 rounded-full bg-indigo-500" />}
            </div>
            <div className="text-xs text-slate-500">{item.body}</div>
          </button>
        ))}
      </Dropdown>

      <div
        className={isPos
          ? 'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 px-2.5 py-2 text-xs text-slate-600 sm:gap-2 sm:px-3 sm:text-sm'
          : 'hidden items-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 lg:flex'}
        data-header-today
      >
        <CalendarDays size={15} className="text-slate-400" />
        <span>Today · {dateLabels.today}</span>
      </div>

      <div className="flex shrink-0 items-center gap-2 rounded-xl py-1 pl-1 pr-2" data-header-user>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
          {initials(user.name)}
        </div>
        <div className={isPos ? 'hidden text-left sm:block' : 'hidden text-left min-[1440px]:block'}>
          <div className="truncate text-sm font-medium leading-4 text-slate-800">{user.name}</div>
          <div className="truncate text-[11px] text-slate-400">{displayRoleName(state, user)}</div>
        </div>
      </div>
    </header>
  )
}

function SearchGroup({
  label,
  items,
  onPick,
}: {
  label: string
  items: Array<{ id: string; title: string; meta: string }>
  onPick: (id: string) => void
}) {
  if (!items.length) return null
  return (
    <div className="mb-2">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(item.id)}
          className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left hover:bg-slate-50"
        >
          <span className="text-sm text-slate-800">{item.title}</span>
          <span className="text-xs text-slate-400">{item.meta}</span>
        </button>
      ))}
    </div>
  )
}
