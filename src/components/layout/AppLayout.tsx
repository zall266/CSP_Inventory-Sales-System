import { Outlet } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { MobileSidebar, Sidebar } from '@/components/layout/Sidebar'
import { GlobalDrawers } from '@/components/drawers/GlobalDrawers'
import { GlobalModals } from '@/components/modals/GlobalModals'
import { ToastViewport } from '@/components/layout/ToastViewport'

export function AppLayout() {
  return (
    <div className="flex min-h-screen bg-[#f3f5f9]">
      <Sidebar />
      <MobileSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
      <GlobalDrawers />
      <GlobalModals />
      <ToastViewport />
    </div>
  )
}
