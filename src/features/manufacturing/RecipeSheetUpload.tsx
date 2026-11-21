import { useRef, useState } from 'react'
import { Camera, Images } from 'lucide-react'
import { Button } from '@/components/ui'
import {
  RECIPE_PHOTO_CAMERA_ACCEPT,
  RECIPE_PHOTO_CAMERA_CAPTURE,
  RECIPE_PHOTO_GALLERY_ACCEPT,
  SAMPLE_RECIPE_SHEET,
  SAMPLE_RECIPE_SHEET_NAME,
  canStartProductionWithPhoto,
  isPreviewableRecipePhoto,
  isSampleRecipePhoto,
  openRecipePicker,
  readRecipePhotoFile,
} from './recipePhoto'

type RecipeSheetUploadProps = {
  photo: string
  photoName: string
  busy?: boolean
  onChange: (photo: string, photoName: string) => void
  onError?: (message: string) => void
}

export function RecipeSheetUpload({ photo, photoName, busy = false, onChange, onError }: RecipeSheetUploadProps) {
  const cameraInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const previewable = isPreviewableRecipePhoto(photo)
  const sample = isSampleRecipePhoto(photo)
  const ready = canStartProductionWithPhoto(photo, photoName)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setReading(true)
    setError('')
    onError?.('')
    const result = await readRecipePhotoFile(file)
    setReading(false)
    if (!result.ok) {
      if (!result.error) return
      setError(result.error)
      onError?.(result.error)
      return
    }
    onChange(result.dataUrl, result.name)
  }

  const disabled = busy || reading

  return (
    <div className="relative space-y-3">
      <p className="text-sm text-slate-600">
        Photograph the physical recipe sheet on the process-room mirror, or choose an existing photo. This is evidence
        only — material requirements still come from the configured BOM.
      </p>
      <input
        ref={cameraInput}
        type="file"
        accept={RECIPE_PHOTO_CAMERA_ACCEPT}
        capture={RECIPE_PHOTO_CAMERA_CAPTURE}
        data-recipe-source="camera"
        className="sr-only"
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          void pick(file)
        }}
      />
      <input
        ref={galleryInput}
        type="file"
        accept={RECIPE_PHOTO_GALLERY_ACCEPT}
        data-recipe-source="gallery"
        className="sr-only"
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          void pick(file)
        }}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          className="h-12 w-full min-h-12"
          disabled={disabled}
          onClick={() => openRecipePicker(cameraInput.current)}
        >
          <Camera size={18} />
          Take Photo
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-12 w-full min-h-12"
          disabled={disabled}
          onClick={() => openRecipePicker(galleryInput.current)}
        >
          <Images size={18} />
          Choose from Gallery
        </Button>
      </div>
      <p className="text-xs text-slate-400">JPG, PNG or WebP up to 5 MB. iPhone HEIC photos are converted to JPG when the browser allows it.</p>
      {reading ? <div className="text-sm text-indigo-700">Reading photo…</div> : null}
      {error ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {photo ? (
        <div className="rounded-xl border border-slate-200 p-3">
          {previewable ? (
            <img src={photo} alt={photoName || 'Recipe sheet'} className="max-h-56 w-full rounded-lg object-contain" />
          ) : sample ? (
            <div>
              <img src={photo} alt="Demo recipe sheet" className="max-h-40 w-full rounded-lg object-contain opacity-80" />
              <div className="mt-2 text-xs font-medium text-amber-800">Demo preview only — this does not count as uploaded evidence.</div>
            </div>
          ) : (
            <div className="text-sm text-slate-600">Stored recipe sheet: {photoName || 'uploaded'}</div>
          )}
          <div className="mt-2 truncate text-xs text-slate-500">{photoName || 'recipe-sheet.jpg'}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => openRecipePicker(cameraInput.current)}>
              Replace with camera
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => openRecipePicker(galleryInput.current)}>
              Replace from gallery
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => { setError(''); onChange('', ''); onError?.('') }}>
              Remove
            </Button>
          </div>
        </div>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => {
          setError('')
          onChange(SAMPLE_RECIPE_SHEET, SAMPLE_RECIPE_SHEET_NAME)
        }}
      >
        Show labelled demo recipe sheet
      </Button>
      {ready ? <div className="text-sm text-emerald-700">Photo ready. You can start production.</div> : null}
    </div>
  )
}
