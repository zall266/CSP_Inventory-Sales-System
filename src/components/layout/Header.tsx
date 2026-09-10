import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  CalendarDays,
  ChevronDown,
  Menu,
  Plus,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { CURRENT_USER } from '@/data/seed'
import { useApi, useStore } from '@/store/hooks'
import { formatDate, initials, PROTOTYPE_TODAY } from '@/utils/format'
import { Dropdown, MenuItem } from '@/components/ui'

export function Header() {
  const state = useStore()
  const api = useApi()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 1) return null
    const products = state.products.filter((p) => `${p.name} ${p.sku} ${p.barcode}`.toLowerCase().includes(q)).slice(0, 5)
    const sales = state.sales.filter((s) => s.invoiceNo.toLowerCase().includes(q)).slice(0, 5)
    const purchases = state.purchases.filter((p) => `${p.purchaseNo} ${p.invoiceNumber}`.toLowerCase().includes(q)).slice(0, 5)
    const customers = state.customers.filter((c) => `${c.name} ${c.phone}`.toLowerCase().includes(q)).slice(0, 5)
    const suppliers = state.suppliers.filter((s) => `${s.name} ${s.contact}`.toLowerCase().includes(q)).slice(0, 5)
    return { products, sales, purchases, customers, suppliers }
  }, [query, state])

  const unread = state.notifications.filter((n) => !n.read).length

  return (
    <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur lg:px-6">
      <button
        type="button"
        className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
        onClick={() => api.setMobileNavOpen(true)}
      >
        <Menu size={18} />
      </button>
      <button
        type="button"
        className="hidden rounded-xl p-2 text-slate-500 hover:bg-slate-100 lg:inline-flex"
        onClick={() => api.setSidebarCollapsed(!state.ui.sidebarCollapsed)}
      >
        {state.ui.sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>

      <div className="relative min-w-0 flex-1">
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
          placeholder="Search products, invoices, customers..."
          className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-16 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-50"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-400 sm:block">
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
            {!results.products.length &&
              !results.sales.length &&
              !results.purchases.length &&
              !results.customers.length &&
              !results.suppliers.length && (
                <div className="px-3 py-6 text-center text-sm text-slate-500">No results for “{query}”</div>
              )}
          </div>
        )}
      </div>

      <select
        value={state.ui.warehouseFilter}
        onChange={(event) => api.setWarehouseFilter(event.target.value)}
        className="hidden h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 md:block"
      >
        <option value="all">All warehouses</option>
        {state.warehouses.map((warehouse) => (
          <option key={warehouse.id} value={warehouse.id}>
            {warehouse.name}
          </option>
        ))}
      </select>

      <Dropdown
        trigger={
          <button type="button" className="inline-flex h-10 items-center gap-1 rounded-xl bg-indigo-600 px-3 text-sm font-medium text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-700">
            <Plus size={16} />
            <span className="hidden sm:inline">Quick Add</span>
          </button>
        }
      >
        <MenuItem onClick={() => navigate('/pos')}>New Sale</MenuItem>
        <MenuItem onClick={() => navigate('/purchases/new')}>New Purchase</MenuItem>
        <MenuItem onClick={() => api.openModal('product')}>Add Product</MenuItem>
        <MenuItem onClick={() => api.openModal('customer')}>Add Customer</MenuItem>
        <MenuItem onClick={() => api.openModal('supplier')}>Add Supplier</MenuItem>
        <MenuItem onClick={() => navigate('/stock-adjustment')}>Adjust Stock</MenuItem>
        <MenuItem onClick={() => api.openModal('payment')}>Record Payment</MenuItem>
      </Dropdown>

      <Dropdown
        trigger={
          <button type="button" className="relative rounded-xl p-2 text-slate-500 hover:bg-slate-100">
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

      <div className="hidden items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 lg:flex">
        <CalendarDays size={15} className="text-slate-400" />
        {formatDate(PROTOTYPE_TODAY.toISOString())}
      </div>

      <span className="hidden rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-amber-100 sm:inline">
        Preview mode
      </span>

      <button type="button" className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 hover:bg-slate-50">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
          {initials(CURRENT_USER.name)}
        </div>
        <div className="hidden text-left sm:block">
          <div className="text-sm font-medium leading-4 text-slate-800">{CURRENT_USER.name}</div>
          <div className="text-[11px] text-slate-400">{CURRENT_USER.role}</div>
        </div>
        <ChevronDown size={14} className="hidden text-slate-400 sm:block" />
      </button>
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
