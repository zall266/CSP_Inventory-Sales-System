import { useEffect, useRef, useState } from 'react'
import { identityApiUrl, postIdentityAction } from '@/api/identityApi'
import { Button } from '@/components/ui'
import { formatDateTime } from '@/utils/format'
import {
  RECIPE_PHOTO_FORBIDDEN,
  RECIPE_PHOTO_LOAD_ERROR,
  RECIPE_PHOTO_MISSING,
  fetchSessionRecipePhoto,
  isDriveRecipePhotoRef,
  isPreviewableRecipePhoto,
  isSampleRecipePhoto,
  loadStoredRecipePhoto,
} from './recipePhoto'

type RecipeSheetEvidenceProps = {
  sessionId: string
  recipePhoto: string
  recipePhotoName: string
  uploadedBy: string
  uploadedAt: string
  actorUserId: string
}

type ViewState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'ready'; dataUrl: string }
  | { status: 'missing' | 'forbidden' | 'error'; error: string }

export function RecipeSheetEvidence({
  sessionId,
  recipePhoto,
  recipePhotoName,
  uploadedBy,
  uploadedAt,
  actorUserId,
}: RecipeSheetEvidenceProps) {
  const requestRef = useRef(0)
  const [view, setView] = useState<ViewState>({ status: 'empty' })

  const load = (photo: string) => {
    const requestId = ++requestRef.current
    setView({ status: 'loading' })
    void loadStoredRecipePhoto({
      sessionId,
      recipePhoto: photo,
      actorUserId,
      requestId,
      isCurrent: (id) => id === requestRef.current,
      fetchPhoto: async (id, actor) => {
        if (!identityApiUrl()) {
          return { ok: false, data: null, error: { code: 'NOT_FOUND', message: RECIPE_PHOTO_MISSING } }
        }
        return fetchSessionRecipePhoto(id, actor, postIdentityAction)
      },
    }).then((result) => {
      if (result.requestId !== requestRef.current) return
      if (result.status === 'ready' && result.payload) {
        setView({ status: 'ready', dataUrl: result.payload.dataUrl })
        return
      }
      setView({
        status: result.status === 'forbidden' ? 'forbidden' : result.status === 'missing' ? 'missing' : 'error',
        error: result.error || (result.status === 'forbidden' ? RECIPE_PHOTO_FORBIDDEN : result.status === 'missing' ? RECIPE_PHOTO_MISSING : RECIPE_PHOTO_LOAD_ERROR),
      })
    }).catch(() => {
      if (requestId !== requestRef.current) return
      setView({ status: 'error', error: RECIPE_PHOTO_LOAD_ERROR })
    })
  }

  useEffect(() => {
    requestRef.current += 1
    if (!recipePhoto || isSampleRecipePhoto(recipePhoto)) {
      setView({ status: 'empty' })
      return () => {
        requestRef.current += 1
      }
    }
    if (isPreviewableRecipePhoto(recipePhoto)) {
      setView({ status: 'ready', dataUrl: recipePhoto })
      return () => {
        requestRef.current += 1
      }
    }
    if (isDriveRecipePhotoRef(recipePhoto)) {
      load(recipePhoto)
      return () => {
        requestRef.current += 1
      }
    }
    setView({ status: 'missing', error: RECIPE_PHOTO_MISSING })
    return () => {
      requestRef.current += 1
    }
  }, [sessionId, recipePhoto, actorUserId])

  if (view.status === 'empty') return null

  const meta = `${recipePhotoName || 'recipe-sheet.jpg'}${uploadedBy ? ` · ${uploadedBy}` : ''}${uploadedAt ? ` · ${formatDateTime(uploadedAt)}` : ''}`

  return (
    <div className="rounded-xl border border-slate-200 p-5" data-recipe-evidence="stored">
      <div className="mb-2 text-sm font-semibold">Recipe sheet (evidence)</div>
      {view.status === 'loading' ? (
        <div className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-600" data-recipe-evidence-state="loading">
          Loading recipe sheet photo…
        </div>
      ) : null}
      {view.status === 'ready' ? (
        <img
          src={view.dataUrl}
          alt={recipePhotoName || 'Recipe sheet'}
          className="max-h-56 w-full rounded-xl border border-slate-200 object-contain"
          data-recipe-evidence-state="ready"
        />
      ) : null}
      {view.status === 'missing' ? (
        <div className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-600" data-recipe-evidence-state="missing">
          {view.error || RECIPE_PHOTO_MISSING}
        </div>
      ) : null}
      {view.status === 'forbidden' ? (
        <div className="rounded-xl bg-rose-50 px-3 py-4 text-sm text-rose-700" data-recipe-evidence-state="forbidden">
          {view.error || RECIPE_PHOTO_FORBIDDEN}
        </div>
      ) : null}
      {view.status === 'error' ? (
        <div className="space-y-3" data-recipe-evidence-state="error">
          <div className="rounded-xl bg-rose-50 px-3 py-4 text-sm text-rose-700">{view.error || RECIPE_PHOTO_LOAD_ERROR}</div>
          <Button type="button" size="sm" variant="secondary" onClick={() => load(recipePhoto)}>
            Try again
          </Button>
        </div>
      ) : null}
      <div className="mt-2 text-xs text-slate-400">{meta}</div>
    </div>
  )
}
