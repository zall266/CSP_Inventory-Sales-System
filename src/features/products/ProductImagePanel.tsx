import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import { ProductMark } from '@/components/ProductMark'
import { Button, Modal } from '@/components/ui'
import { useApi, useStore } from '@/store/hooks'
import type { Product } from '@/types'
import {
  PRODUCT_IMAGE_ACCEPT,
  PRODUCT_IMAGE_FORBIDDEN,
  PRODUCT_IMAGE_LOAD_ERROR,
  PRODUCT_IMAGE_MISSING,
  fetchProductImage,
  loadStoredProductImage,
  openProductImagePicker,
  readProductImageFile,
  storeProductImageCache,
} from './productImage'

type ViewState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'ready'; dataUrl: string }
  | { status: 'missing' | 'forbidden' | 'error'; error: string }

type PreviewState = {
  mode: 'upload' | 'replace'
  dataUrl: string
  name: string
}

export function ProductImageHeader({
  product,
  categoryLabel,
  canEdit,
  children,
}: {
  product: Product
  categoryLabel: string
  canEdit: boolean
  children?: ReactNode
}) {
  const api = useApi()
  const actorUserId = useStore().ui.currentUserId
  const pickerRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef(0)
  const pickModeRef = useRef<'upload' | 'replace'>('upload')
  const [view, setView] = useState<ViewState>({ status: 'empty' })
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pickerError, setPickerError] = useState('')
  const imageFileId = product.imageFileId?.trim() || ''
  const hasImage = view.status === 'ready'
  const canUpload = canEdit && !imageFileId
  const canMutateExisting = canEdit && Boolean(imageFileId)

  const load = (fileId: string) => {
    const requestId = ++requestRef.current
    if (!fileId) {
      setView({ status: 'empty' })
      return
    }
    setView({ status: 'loading' })
    void loadStoredProductImage({
      productId: product.id,
      imageFileId: fileId,
      actorUserId,
      requestId,
      isCurrent: (id) => id === requestRef.current,
      fetchImage: async (id, actor) => {
        if (!identityApiUrl()) {
          return { ok: false, data: null, error: { code: 'NOT_FOUND', message: PRODUCT_IMAGE_MISSING } }
        }
        return fetchProductImage(id, actor, postIdentityAction)
      },
    })
      .then((result) => {
        if (result.requestId !== requestRef.current) return
        if (result.status === 'ready' && result.payload) {
          setView({ status: 'ready', dataUrl: result.payload.dataUrl })
          return
        }
        setView({
          status: result.status === 'forbidden' ? 'forbidden' : result.status === 'missing' ? 'missing' : 'error',
          error:
            result.error ||
            (result.status === 'forbidden'
              ? PRODUCT_IMAGE_FORBIDDEN
              : result.status === 'missing'
                ? PRODUCT_IMAGE_MISSING
                : PRODUCT_IMAGE_LOAD_ERROR),
        })
      })
      .catch(() => {
        if (requestId !== requestRef.current) return
        setView({ status: 'error', error: PRODUCT_IMAGE_LOAD_ERROR })
      })
  }

  useEffect(() => {
    load(imageFileId)
    return () => {
      requestRef.current += 1
    }
  }, [product.id, imageFileId, actorUserId])

  useEffect(() => {
    if (!import.meta.env.DEV || identityApiUrl()) return
    const onMock = (event: Event) => {
      const detail = (event as CustomEvent<{ dataUrl?: string; imageFileId?: string; fileName?: string }>).detail
      const dataUrl = detail?.dataUrl
      const fileId = detail?.imageFileId
      if (!dataUrl || !fileId) return
      storeProductImageCache(product.id, fileId, {
        productId: product.id,
        fileName: detail.fileName || 'product.png',
        mimeType: 'image/png',
        dataUrl,
      })
      api.applyProductImageFileId(product.id, fileId)
    }
    window.addEventListener('csp-product-image-mock', onMock)
    return () => window.removeEventListener('csp-product-image-mock', onMock)
  }, [api, product.id])

  const closePreview = () => {
    if (busy) return
    setPreview(null)
  }

  const pickImage = (mode: 'upload' | 'replace') => {
    setPickerError('')
    pickModeRef.current = mode
    openProductImagePicker(pickerRef.current)
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    const result = await readProductImageFile(file)
    if (!result.ok) {
      setPickerError(result.error)
      return
    }
    setPickerError('')
    setPreview({ mode: pickModeRef.current, dataUrl: result.dataUrl, name: result.name })
  }

  const confirmPreview = async () => {
    if (!preview || busy) return
    setBusy(true)
    const saved =
      preview.mode === 'replace'
        ? await api.replaceProductImage(product.id, preview.dataUrl, preview.name)
        : await api.uploadProductImage(product.id, preview.dataUrl, preview.name)
    setBusy(false)
    if (!saved.ok) return
    setPreview(null)
  }

  const confirmRemove = async () => {
    if (busy) return
    setBusy(true)
    const saved = await api.removeProductImage(product.id)
    setBusy(false)
    if (!saved.ok) return
    setRemoveOpen(false)
  }

  return (
    <div className="flex min-w-0 items-start gap-4" data-product-image-section>
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl">
        {hasImage ? (
          <img
            src={view.dataUrl}
            alt=""
            className="h-full w-full object-cover"
            data-product-image-preview="saved"
            onError={() => setView({ status: 'error', error: PRODUCT_IMAGE_LOAD_ERROR })}
          />
        ) : (
          <ProductMark product={product} size="lg" />
        )}
        {view.status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-[10px] font-medium text-slate-500">
            Loading
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-500">{categoryLabel}</div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Product Image</div>
          {canUpload && (
            <Button
              type="button"
              size="sm"
              className="min-h-10"
              data-product-image-upload
              disabled={busy}
              onClick={() => pickImage('upload')}
            >
              Upload Image
            </Button>
          )}
          {canMutateExisting && (
            <>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="min-h-10"
                data-product-image-replace
                disabled={busy}
                onClick={() => pickImage('replace')}
              >
                Replace Image
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                className="min-h-10"
                data-product-image-remove
                disabled={busy}
                onClick={() => setRemoveOpen(true)}
              >
                Remove Image
              </Button>
            </>
          )}
        </div>
        {canUpload && (
          <p className="mt-1 text-xs text-slate-400">Optional. JPG, PNG, or WebP up to 1 MB.</p>
        )}
        {view.status === 'error' && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <p className="text-xs text-rose-600">{view.error || PRODUCT_IMAGE_LOAD_ERROR}</p>
            {imageFileId && (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => load(imageFileId)}>
                Try again
              </Button>
            )}
          </div>
        )}
        {view.status === 'forbidden' && <p className="mt-1 text-xs text-slate-500">{view.error}</p>}
        {pickerError && <p className="mt-1 text-xs text-rose-600">{pickerError}</p>}
        {children}
      </div>
      <input
        ref={pickerRef}
        type="file"
        accept={PRODUCT_IMAGE_ACCEPT}
        className="hidden"
        data-product-image-picker
        onChange={onFile}
      />
      <Modal
        open={Boolean(preview)}
        onClose={closePreview}
        title={preview?.mode === 'replace' ? 'Replace product image' : 'Upload product image'}
        width="max-w-md"
      >
        {preview && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
              <img
                src={preview.dataUrl}
                alt=""
                className="mx-auto max-h-64 w-full object-contain"
                data-product-image-preview={preview.mode}
              />
            </div>
            <p className="text-sm text-slate-500">{preview.name}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" className="min-h-10" disabled={busy} onClick={closePreview}>
                Cancel
              </Button>
              <Button
                type="button"
                className="min-h-10"
                data-product-image-confirm-save
                disabled={busy}
                onClick={() => void confirmPreview()}
              >
                {busy ? 'Saving…' : preview.mode === 'replace' ? 'Replace' : 'Upload'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={removeOpen} onClose={() => !busy && setRemoveOpen(false)} title="Remove product image" width="max-w-md">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            This will remove the product image. The product initials will be shown instead.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" className="min-h-10" disabled={busy} onClick={() => setRemoveOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              className="min-h-10"
              data-product-image-confirm-remove
              disabled={busy}
              onClick={() => void confirmRemove()}
            >
              {busy ? 'Removing…' : 'Remove Image'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
