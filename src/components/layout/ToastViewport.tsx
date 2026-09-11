import { useApi, useStore } from '@/store/hooks'
import { cn } from '@/utils/format'

export function ToastViewport() {
  const toasts = useStore().ui.toasts
  const api = useApi()
  return (
    <div className="sf-toast pointer-events-none no-print fixed bottom-4 right-4 z-[80] flex w-[min(100%-2rem,360px)] flex-col gap-2">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => api.dismissToast(toast.id)}
          className={cn(
            'pointer-events-auto rounded-2xl border bg-white p-4 text-left shadow-xl',
            toast.tone === 'danger' && 'border-rose-100',
            toast.tone === 'warning' && 'border-amber-100',
            toast.tone === 'info' && 'border-sky-100',
            toast.tone === 'success' && 'border-emerald-100',
          )}
        >
          <div className="text-sm font-semibold text-slate-900">{toast.title}</div>
          {toast.description && <div className="mt-0.5 text-sm text-slate-500">{toast.description}</div>}
        </button>
      ))}
    </div>
  )
}
