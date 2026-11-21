import { useEffect, useRef, useState } from 'react'
import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import { ProductMark } from '@/components/ProductMark'
import { useStore } from '@/store/hooks'
import type { Product } from '@/types'
import { cn } from '@/utils/format'
import {
  PRODUCT_IMAGE_MISSING,
  fetchProductImage,
  loadStoredProductImage,
  peekProductImageCache,
  shouldFetchProductImage,
} from './productImage'

const FRAME: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
  sm: 'h-9 w-9 rounded-xl',
  md: 'h-11 w-11 rounded-xl',
  lg: 'h-16 w-16 rounded-xl',
  xl: 'h-[4.75rem] w-full rounded-2xl',
}

export type ProductImageThumbPresentation = 'square-contain' | 'square-cover'

export function ProductImageThumb({
  product,
  size,
  presentation,
  previewDataUrl,
}: {
  product: Product
  size: 'sm' | 'md' | 'lg' | 'xl'
  presentation?: ProductImageThumbPresentation
  previewDataUrl?: string
}) {
  const actorUserId = useStore().ui.currentUserId
  const imageFileId = product.imageFileId?.trim() || ''
  const rootRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef(0)
  const square = presentation === 'square-contain' || presentation === 'square-cover'
  const objectFit = presentation === 'square-contain' ? 'object-contain' : 'object-cover'
  const [visible, setVisible] = useState(false)
  const [dataUrl, setDataUrl] = useState(() => {
    if (previewDataUrl) return previewDataUrl
    return shouldFetchProductImage(imageFileId) ? peekProductImageCache(product.id, imageFileId)?.dataUrl ?? '' : ''
  })

  useEffect(() => {
    if (previewDataUrl) {
      setDataUrl(previewDataUrl)
      return
    }
    if (!shouldFetchProductImage(imageFileId)) {
      setVisible(false)
      return
    }
    const node = rootRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    setVisible(false)
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '180px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [product.id, imageFileId, previewDataUrl])

  useEffect(() => {
    const requestId = ++requestRef.current
    if (previewDataUrl) {
      setDataUrl(previewDataUrl)
      return
    }
    if (!shouldFetchProductImage(imageFileId)) {
      setDataUrl('')
      return
    }
    const cached = peekProductImageCache(product.id, imageFileId)
    if (cached) {
      setDataUrl(cached.dataUrl)
      return
    }
    if (!visible) {
      setDataUrl('')
      return
    }
    void loadStoredProductImage({
      productId: product.id,
      imageFileId,
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
        setDataUrl(result.status === 'ready' && result.payload ? result.payload.dataUrl : '')
      })
      .catch(() => {
        if (requestId !== requestRef.current) return
        setDataUrl('')
      })
    return () => {
      requestRef.current += 1
    }
  }, [product.id, imageFileId, actorUserId, visible, previewDataUrl])

  return (
    <div
      ref={rootRef}
      className={cn('relative shrink-0', (size === 'xl' || square) && 'w-full')}
      data-product-image-thumb={product.id}
      data-pos-image-presentation={presentation || 'default'}
    >
      {square ? (
        <div
          className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl bg-white p-2.5"
          data-pos-image-frame="square"
          data-pos-image-fit={presentation === 'square-contain' ? 'contain' : 'cover'}
        >
          {dataUrl ? (
            <img
              src={dataUrl}
              alt=""
              className={cn('h-full w-full', objectFit)}
              draggable={false}
              onError={() => setDataUrl('')}
            />
          ) : (
            <ProductMark product={product} size="lg" />
          )}
        </div>
      ) : dataUrl ? (
        <div className={cn('overflow-hidden', FRAME[size])}>
          <img
            src={dataUrl}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
            onError={() => setDataUrl('')}
          />
        </div>
      ) : (
        <ProductMark product={product} size={size} />
      )}
    </div>
  )
}
