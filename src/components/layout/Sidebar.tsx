import { NavLink, useLocation } from 'react-router-dom'
import {
  ArrowLeftRight,
  BadgePercent,
  BarChart3,
  Boxes,
  ClipboardList,
  CreditCard,
  Factory,
  FileText,
  FlaskConical,
  History,
  LayoutDashboard,
  Package,
  PackageMinus,
  PackagePlus,
  Receipt,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Store,
  Tags,
  Truck,
  Users,
  Wallet,
  Warehouse,
  CalendarDays,
  ChevronDown,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { brand } from '@/brand'
import { cn } from '@/utils/format'
import { useApi, useStore } from '@/store/hooks'

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard }
type NavGroup = { id: string; label: string; items: NavItem[] }

export const navGroups: NavGroup[] = [
  {
    id: 'home',
    label: 'HOME',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    id: 'sales',
    label: 'SALES',
    items: [
      { to: '/sales', label: 'Sales', icon: Receipt },
      { to: '/pos', label: 'POS', icon: ShoppingCart },
      { to: '/sales-returns', label: 'Sales Returns', icon: PackageMinus },
      { to: '/customers', label: 'Customers', icon: Users },
    ],
  },
  {
    id: 'purchases',
    label: 'PURCHASES',
    items: [
      { to: '/purchases', label: 'Purchases', icon: ShoppingBag },
      { to: '/purchase-returns', label: 'Purchase Returns', icon: PackagePlus },
      { to: '/suppliers', label: 'Suppliers', icon: Truck },
    ],
  },
  {
    id: 'inventory',
    label: 'INVENTORY',
    items: [
      { to: '/inventory', label: 'Inventory', icon: Warehouse },
      { to: '/stock-movements', label: 'Stock Movements', icon: ClipboardList },
      { to: '/stock-adjustment', label: 'Stock Adjustment', icon: BadgePercent },
      { to: '/stock-transfer', label: 'Stock Transfer', icon: ArrowLeftRight },
      { to: '/stock-count', label: 'Stock Count', icon: Boxes },
    ],
  },
  {
    id: 'manufacturing',
    label: 'MANUFACTURING',
    items: [
      { to: '/manufacturing', label: 'Manufacturing Dashboard', icon: Factory },
      { to: '/manufacturing/bom', label: 'Bill of Materials', icon: ClipboardList },
      { to: '/manufacturing/orders', label: 'Production Orders', icon: PackagePlus },
      { to: '/manufacturing/planning', label: 'Production Planning', icon: CalendarDays },
      { to: '/manufacturing/consumption', label: 'Material Consumption', icon: FlaskConical },
      { to: '/manufacturing/finished-goods', label: 'Finished Goods', icon: Package },
      { to: '/manufacturing/history', label: 'Production History', icon: History },
    ],
  },
  {
    id: 'products',
    label: 'PRODUCTS',
    items: [
      { to: '/products', label: 'Products', icon: Package },
      { to: '/categories', label: 'Categories', icon: Tags },
    ],
  },
  {
    id: 'reports',
    label: 'REPORTS',
    items: [
      { to: '/reports/sales', label: 'Sales Reports', icon: BarChart3 },
      { to: '/reports/purchases', label: 'Purchase Reports', icon: FileText },
      { to: '/reports/inventory', label: 'Inventory Reports', icon: Boxes },
      { to: '/reports/profit', label: 'Profit Reports', icon: Wallet },
      { to: '/reports/manufacturing', label: 'Manufacturing Reports', icon: Factory },
    ],
  },
  {
    id: 'finance',
    label: 'FINANCE',
    items: [
      { to: '/payments', label: 'Payments', icon: CreditCard },
      { to: '/receivables', label: 'Receivables', icon: Receipt },
      { to: '/payables', label: 'Payables', icon: Wallet },
      { to: '/expenses', label: 'Expenses', icon: Store },
    ],
  },
  {
    id: 'settings',
    label: 'SETTINGS',
    items: [
      { to: '/settings/users', label: 'Users & Roles', icon: Users },
      { to: '/settings/business', label: 'Business Settings', icon: Settings },
      { to: '/settings/inventory', label: 'Inventory Settings', icon: Warehouse },
      { to: '/settings/sales', label: 'Sales Settings', icon: ShoppingCart },
    ],
  },
]

function pathActive(pathname: string, to: string) {
  if (to === '/') return pathname === '/'
  if (to === '/manufacturing') return pathname === '/manufacturing'
  return pathname === to || pathname.startsWith(`${to}/`)
}

export function Sidebar() {
  const location = useLocation()
  const api = useApi()
  const ui = useStore().ui
  const collapsed = ui.sidebarCollapsed

  const initialOpen = useMemo(() => {
    const open: Record<string, boolean> = {}
    for (const group of navGroups) {
      open[group.id] = group.items.some((item) => pathActive(location.pathname, item.to)) || group.id === 'home'
    }
    return open
  }, [location.pathname])

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initialOpen)

  return (
    <aside
      className={cn(
        'no-print hidden h-screen shrink-0 flex-col border-r border-slate-200/80 bg-white lg:flex',
        collapsed ? 'w-[76px]' : 'w-[260px]',
      )}
    >
      <div className={cn('flex items-center gap-3 px-4 py-5', collapsed && 'justify-center px-2')}>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">
          {brand.productInitials}
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{brand.name}</div>
            <div className="truncate text-[11px] text-slate-400">{brand.subtitle}</div>
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-6">
        {navGroups.map((group) => {
          const isOpen = collapsed ? true : openGroups[group.id] !== false
          return (
            <div key={group.id} className="mb-3">
              {!collapsed && (
                <button
                  type="button"
                  className="mb-1 flex w-full items-center justify-between px-2 py-1 text-[10px] font-semibold tracking-[0.14em] text-slate-400"
                  onClick={() => setOpenGroups((current) => ({ ...current, [group.id]: !isOpen }))}
                >
                  {group.label}
                  <ChevronDown size={12} className={cn('transition', isOpen ? 'rotate-0' : '-rotate-90')} />
                </button>
              )}
              {isOpen &&
                group.items.map((item) => {
                  const Icon = item.icon
                  const active = pathActive(location.pathname, item.to)
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      title={item.label}
                      onClick={() => api.setMobileNavOpen(false)}
                      className={cn(
                        'mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition',
                        collapsed && 'justify-center px-2',
                        active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                      )}
                    >
                      <Icon size={18} />
                      {!collapsed && item.label}
                    </NavLink>
                  )
                })}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}

export function MobileSidebar() {
  const api = useApi()
  const open = useStore().ui.mobileNavOpen
  const location = useLocation()
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button type="button" className="absolute inset-0 bg-slate-900/40" onClick={() => api.setMobileNavOpen(false)} />
      <div className="relative h-full w-[280px] overflow-y-auto bg-white p-3 shadow-2xl">
        <div className="mb-4 flex items-center gap-3 px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">
            {brand.productInitials}
          </div>
          <div>
            <div className="text-sm font-semibold">{brand.name}</div>
            <div className="text-[11px] text-slate-400">{brand.subtitle}</div>
          </div>
        </div>
        {navGroups.map((group) => (
          <div key={group.id} className="mb-3">
            <div className="px-2 py-1 text-[10px] font-semibold tracking-[0.14em] text-slate-400">{group.label}</div>
            {group.items.map((item) => {
              const Icon = item.icon
              const active = pathActive(location.pathname, item.to)
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => api.setMobileNavOpen(false)}
                  className={cn(
                    'mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium',
                    active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600',
                  )}
                >
                  <Icon size={18} />
                  {item.label}
                </NavLink>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
