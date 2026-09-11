import { NavLink, Outlet } from 'react-router-dom'
import { FileText, LayoutDashboard, Package, Settings, Users } from 'lucide-react'
import { cn } from '@/utils/format'
import { quoteApi, useQuoteStore } from './store'

const items = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/quotations', label: 'Quotations', icon: FileText },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function QuoteLayout() {
  const { state, toasts } = useQuoteStore()
  return (
    <div className="min-h-screen bg-[#f3f5f9]">
      <div className="flex min-h-screen">
        <aside className="no-print hidden w-[240px] shrink-0 border-r border-slate-200/80 bg-white lg:flex lg:flex-col">
          <div className="border-b border-slate-100 px-5 py-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Quotations</div>
            <div className="mt-1 text-sm font-semibold leading-snug text-slate-900">{state.settings.companyName}</div>
          </div>
          <nav className="flex flex-1 flex-col gap-1 p-3">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium',
                    isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                  )
                }
              >
                <item.icon size={17} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print flex h-14 items-center justify-between border-b border-slate-200/80 bg-white px-4 lg:px-6">
            <div className="text-sm font-medium text-slate-800">B2B Quotation Prototype</div>
            <div className="text-xs text-slate-400">Clickable preview · local data only</div>
          </header>
          <div className="no-print flex gap-1 overflow-x-auto border-b border-slate-100 bg-white px-3 py-2 lg:hidden">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn('rounded-lg px-3 py-1.5 text-sm', isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
          <main className="flex-1 p-4 lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
      <div className="sf-toast pointer-events-none no-print fixed bottom-4 right-4 z-[80] flex w-[min(100%-2rem,360px)] flex-col gap-2">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => quoteApi.dismissToast(toast.id)}
            className="pointer-events-auto rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-xl"
          >
            <div className="text-sm font-semibold text-slate-900">{toast.title}</div>
            {toast.description && <div className="mt-0.5 text-sm text-slate-500">{toast.description}</div>}
          </button>
        ))}
      </div>
    </div>
  )
}
