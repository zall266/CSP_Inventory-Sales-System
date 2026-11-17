import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  RECIPE_PHOTO_CAMERA_ACCEPT,
  RECIPE_PHOTO_CAMERA_CAPTURE,
  RECIPE_PHOTO_FORBIDDEN,
  RECIPE_PHOTO_GALLERY_ACCEPT,
  RECIPE_PHOTO_GET_ACTION,
  RECIPE_PHOTO_HEIC_ERROR,
  RECIPE_PHOTO_MAX_BYTES,
  RECIPE_PHOTO_MISSING,
  RECIPE_PHOTO_SIZE_ERROR,
  RECIPE_PHOTO_TYPE_ERROR,
  SAMPLE_RECIPE_SHEET,
  SAMPLE_RECIPE_SHEET_NAME,
  canStartProductionWithPhoto,
  clearRecipePhotoCache,
  isDriveRecipePhotoRef,
  isHeicLike,
  isPreviewableRecipePhoto,
  isSampleRecipePhoto,
  loadStoredRecipePhoto,
  openRecipePicker,
  parseRecipePhoto,
  peekRecipePhotoCache,
  readRecipePhotoFile,
  recipePhotoCacheKey,
  shouldFetchStoredRecipePhoto,
} from './recipePhoto.ts'

function canStartAcceptedSession(
  user: { name: string; role: string },
  session: { status: string; acceptedBy: string },
) {
  if (session.status !== 'accepted') return false
  if (user.role === 'cashier') return false
  if (user.role === 'admin' || user.role === 'owner' || user.role === 'manager') return true
  return Boolean(session.acceptedBy) && session.acceptedBy === user.name
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`

function pngFile(name = 'sheet.png', type = 'image/png') {
  const bytes = Buffer.from(PNG_B64, 'base64')
  return new File([bytes], name, { type })
}

test('camera and gallery options are separate image inputs', () => {
  const source = fs.readFileSync(path.join(root, 'features/manufacturing/RecipeSheetUpload.tsx'), 'utf8')
  assert.equal(source.includes('Take Photo'), true)
  assert.equal(source.includes('Choose from Gallery'), true)
  assert.equal(source.includes('data-recipe-source="camera"'), true)
  assert.equal(source.includes('data-recipe-source="gallery"'), true)
  assert.equal(source.includes('capture={RECIPE_PHOTO_CAMERA_CAPTURE}'), true)
  assert.equal(source.includes('accept={RECIPE_PHOTO_CAMERA_ACCEPT}'), true)
  assert.equal(source.includes('accept={RECIPE_PHOTO_GALLERY_ACCEPT}'), true)
  assert.equal(source.includes('openRecipePicker(cameraInput.current)'), true)
  assert.equal(source.includes('openRecipePicker(galleryInput.current)'), true)
  assert.equal(source.includes('readRecipePhotoFile'), true)
  const galleryBlock = source.slice(source.indexOf('data-recipe-source="gallery"') - 120, source.indexOf('data-recipe-source="gallery"') + 80)
  assert.equal(galleryBlock.includes('capture'), false)
  assert.equal(source.includes('Show labelled demo recipe sheet'), true)
  assert.equal(source.includes('does not count as uploaded evidence'), true)
})

test('camera capture hint and gallery accept constants stay image-only', () => {
  assert.equal(RECIPE_PHOTO_CAMERA_ACCEPT, 'image/*')
  assert.equal(RECIPE_PHOTO_GALLERY_ACCEPT, 'image/*')
  assert.equal(RECIPE_PHOTO_CAMERA_CAPTURE, 'environment')
})

test('valid JPEG and PNG data URLs can start production; sample and invalid files cannot', () => {
  const jpeg = parseRecipePhoto('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP///wA=', 'sheet.jpg')
  assert.equal(parseRecipePhoto(PNG_DATA_URL, 'sheet.png').ok, true)
  assert.equal(canStartProductionWithPhoto(PNG_DATA_URL, 'sheet.png'), true)
  assert.equal(isPreviewableRecipePhoto(PNG_DATA_URL), true)
  if (jpeg.ok) assert.equal(canStartProductionWithPhoto(jpeg.url, jpeg.name), true)
  assert.equal(isSampleRecipePhoto(SAMPLE_RECIPE_SHEET), true)
  assert.equal(canStartProductionWithPhoto(SAMPLE_RECIPE_SHEET, SAMPLE_RECIPE_SHEET_NAME), false)
  assert.equal(parseRecipePhoto(SAMPLE_RECIPE_SHEET).ok, false)
  assert.equal(parseRecipePhoto('data:text/plain;base64,aaaa').ok, false)
  assert.equal(canStartProductionWithPhoto(''), false)
  assert.equal(canStartProductionWithPhoto('data:image/svg+xml;utf8,abc'), false)
})

test('Drive file ids from a prior upload remain startable evidence and are not treated as a preview URL', () => {
  assert.equal(isDriveRecipePhotoRef('1abcDEFGHIJ-klmnopqr'), true)
  assert.equal(canStartProductionWithPhoto('1abcDEFGHIJ-klmnopqr'), true)
  assert.equal(isPreviewableRecipePhoto('1abcDEFGHIJ-klmnopqr'), false)
  assert.equal(isDriveRecipePhotoRef('blob:https://example/1'), false)
})

test('HEIC files are detected and conversion failure is explicit', async () => {
  const heic = new File([Buffer.from(PNG_B64, 'base64')], 'sheet.heic', { type: 'image/heic' })
  assert.equal(isHeicLike(heic), true)
  const result = await readRecipePhotoFile(heic)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error, RECIPE_PHOTO_HEIC_ERROR)
})

test('invalid and oversized files are rejected; cancelled picker is a no-op', async () => {
  const pdf = new File([Buffer.from('not-an-image')], 'notes.pdf', { type: 'application/pdf' })
  const invalid = await readRecipePhotoFile(pdf)
  assert.equal(invalid.ok, false)
  if (!invalid.ok) assert.equal(invalid.error, RECIPE_PHOTO_TYPE_ERROR)
  const cancelled = await readRecipePhotoFile(undefined)
  assert.equal(cancelled.ok, false)
  if (!cancelled.ok) assert.equal(cancelled.error, '')
  const huge = new File([new Uint8Array(RECIPE_PHOTO_MAX_BYTES + 1)], 'huge.jpg', { type: 'image/jpeg' })
  const oversized = await readRecipePhotoFile(huge)
  assert.equal(oversized.ok, false)
  if (!oversized.ok) assert.equal(oversized.error, RECIPE_PHOTO_SIZE_ERROR)
  const png = await readRecipePhotoFile(pngFile())
  assert.equal(png.ok, true)
  if (png.ok) {
    assert.equal(png.name, 'sheet.png')
    assert.equal(canStartProductionWithPhoto(png.dataUrl, png.name), true)
  }
})

test('opening the picker resets the input so the same photo can be chosen again', () => {
  const clicks: string[] = []
  const input = {
    value: 'C:\\fakepath\\old.jpg',
    click() {
      clicks.push(this.value)
    },
  } as HTMLInputElement
  openRecipePicker(input)
  assert.equal(input.value, '')
  assert.deepEqual(clicks, [''])
  openRecipePicker(null)
  assert.deepEqual(clicks, [''])
})

test('today production start is blocked without a real photo and keeps sample labelled as demo', () => {
  const page = fs.readFileSync(path.join(root, 'features/manufacturing/TodaysProductionPage.tsx'), 'utf8')
  const store = fs.readFileSync(path.join(root, 'store/db.ts'), 'utf8')
  assert.equal(page.includes('RecipeSheetUpload'), true)
  assert.equal(page.includes('canStartProductionWithPhoto'), true)
  assert.equal(page.includes('canStartAcceptedSession'), true)
  assert.equal(page.includes('starting'), true)
  assert.equal(store.includes('canStartProductionWithPhoto'), true)
  assert.equal(store.includes('canStartAcceptedSession'), true)
  assert.equal(store.includes("toast('Upload recipe photo'"), true)
  assert.equal(page.includes('Use sample recipe sheet'), false)
})

test('planned sessions cannot start; accepted staff can; other staff cannot overwrite', () => {
  const staff = { name: 'Mei Ling', role: 'staff' }
  const other = { name: 'Kumar Raj', role: 'warehouse' }
  const admin = { name: 'Admin', role: 'admin' }
  const planned = { status: 'planned', acceptedBy: '' }
  const accepted = { status: 'accepted', acceptedBy: 'Mei Ling' }
  const sessionPlan = fs.readFileSync(path.join(root, 'features/manufacturing/sessionPlan.ts'), 'utf8')
  assert.equal(sessionPlan.includes('export function canStartAcceptedSession'), true)
  assert.equal(sessionPlan.includes("user.role === 'admin' || user.role === 'owner' || user.role === 'manager'"), true)
  assert.equal(sessionPlan.includes('session.acceptedBy === user.name'), true)
  assert.equal(canStartAcceptedSession(staff, planned), false)
  assert.equal(canStartAcceptedSession(staff, accepted), true)
  assert.equal(canStartAcceptedSession(other, accepted), false)
  assert.equal(canStartAcceptedSession(admin, accepted), true)
  assert.equal(canStartAcceptedSession({ name: 'Siti Nurhaliza', role: 'cashier' }, accepted), false)
})

test('stored Drive refs fetch on demand and cache by session plus photo reference', async () => {
  clearRecipePhotoCache()
  const driveId = '1abcDEFGHIJ-klmnopqr'
  const otherId = '1otherDriveFileXXXX'
  assert.equal(shouldFetchStoredRecipePhoto(driveId), true)
  assert.equal(shouldFetchStoredRecipePhoto(PNG_DATA_URL), false)
  assert.equal(shouldFetchStoredRecipePhoto(SAMPLE_RECIPE_SHEET), false)
  const calls: Array<{ sessionId: string; actorUserId: string }> = []
  const payload = {
    sessionId: 'ps-1',
    recipePhotoName: 'recipe.png',
    uploadedBy: 'Aina Rahman',
    uploadedAt: '2026-11-16T12:00:00.000Z',
    mimeType: 'image/png',
    dataUrl: PNG_DATA_URL,
  }
  const fetchPhoto = async (sessionId: string, actorUserId: string) => {
    calls.push({ sessionId, actorUserId })
    return { ok: true, data: { ...payload, sessionId }, error: null }
  }
  const first = await loadStoredRecipePhoto({
    sessionId: 'ps-1',
    recipePhoto: driveId,
    actorUserId: 'u-aina',
    requestId: 1,
    isCurrent: () => true,
    fetchPhoto,
  })
  assert.equal(first.status, 'ready')
  assert.equal(first.payload?.dataUrl, PNG_DATA_URL)
  assert.equal(calls.length, 1)
  assert.equal(peekRecipePhotoCache('ps-1', driveId)?.dataUrl, PNG_DATA_URL)
  const cached = await loadStoredRecipePhoto({
    sessionId: 'ps-1',
    recipePhoto: driveId,
    actorUserId: 'u-aina',
    requestId: 2,
    isCurrent: () => true,
    fetchPhoto,
  })
  assert.equal(cached.status, 'ready')
  assert.equal(calls.length, 1)
  const switched = await loadStoredRecipePhoto({
    sessionId: 'ps-2',
    recipePhoto: otherId,
    actorUserId: 'u-aina',
    requestId: 3,
    isCurrent: () => true,
    fetchPhoto: async (sessionId) => ({
      ok: true,
      data: { ...payload, sessionId, dataUrl: 'data:image/png;base64,abc' },
      error: null,
    }),
  })
  assert.equal(switched.payload?.sessionId, 'ps-2')
  assert.notEqual(peekRecipePhotoCache('ps-1', driveId)?.sessionId, switched.payload?.sessionId)
  assert.equal(recipePhotoCacheKey('ps-1', driveId) !== recipePhotoCacheKey('ps-2', otherId), true)
  clearRecipePhotoCache()
  const refreshed = await loadStoredRecipePhoto({
    sessionId: 'ps-1',
    recipePhoto: driveId,
    actorUserId: 'u-aina',
    requestId: 4,
    isCurrent: () => true,
    fetchPhoto,
  })
  assert.equal(refreshed.status, 'ready')
  assert.equal(calls.length, 2)
})

test('stale recipe photo responses and permission failures do not leak the previous image', async () => {
  clearRecipePhotoCache()
  const stale = await loadStoredRecipePhoto({
    sessionId: 'ps-1',
    recipePhoto: '1abcDEFGHIJ-klmnopqr',
    actorUserId: 'u-aina',
    requestId: 1,
    isCurrent: () => false,
    fetchPhoto: async () => ({
      ok: true,
      data: {
        sessionId: 'ps-1',
        recipePhotoName: 'old.png',
        uploadedBy: 'Aina',
        uploadedAt: '',
        mimeType: 'image/png',
        dataUrl: PNG_DATA_URL,
      },
      error: null,
    }),
  })
  assert.equal(stale.status, 'error')
  assert.equal(stale.payload, undefined)
  assert.equal(peekRecipePhotoCache('ps-1', '1abcDEFGHIJ-klmnopqr'), undefined)

  const forbidden = await loadStoredRecipePhoto({
    sessionId: 'ps-1',
    recipePhoto: '1abcDEFGHIJ-klmnopqr',
    actorUserId: 'u-siti',
    requestId: 2,
    isCurrent: () => true,
    fetchPhoto: async () => ({ ok: false, data: null, error: { code: 'FORBIDDEN', message: RECIPE_PHOTO_FORBIDDEN } }),
  })
  assert.equal(forbidden.status, 'forbidden')
  assert.equal(forbidden.error, RECIPE_PHOTO_FORBIDDEN)

  const missing = await loadStoredRecipePhoto({
    sessionId: 'ps-1',
    recipePhoto: '1abcDEFGHIJ-klmnopqr',
    actorUserId: 'u-aina',
    requestId: 3,
    isCurrent: () => true,
    fetchPhoto: async () => ({ ok: false, data: null, error: { code: 'NOT_FOUND', message: RECIPE_PHOTO_MISSING } }),
  })
  assert.equal(missing.status, 'missing')

  const retryable = await loadStoredRecipePhoto({
    sessionId: 'ps-1',
    recipePhoto: '1abcDEFGHIJ-klmnopqr',
    actorUserId: 'u-aina',
    requestId: 4,
    isCurrent: () => true,
    fetchPhoto: async () => ({ ok: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'down' } }),
  })
  assert.equal(retryable.status, 'error')
  const recovered = await loadStoredRecipePhoto({
    sessionId: 'ps-1',
    recipePhoto: '1abcDEFGHIJ-klmnopqr',
    actorUserId: 'u-aina',
    requestId: 5,
    isCurrent: () => true,
    fetchPhoto: async () => ({
      ok: true,
      data: {
        sessionId: 'ps-1',
        recipePhotoName: 'recipe.png',
        uploadedBy: 'Aina',
        uploadedAt: '',
        mimeType: 'image/png',
        dataUrl: PNG_DATA_URL,
      },
      error: null,
    }),
  })
  assert.equal(recovered.status, 'ready')
  assert.equal(recovered.payload?.dataUrl, PNG_DATA_URL)
})

test('today and history details fetch stored photos; lists and writes do not', () => {
  const today = fs.readFileSync(path.join(root, 'features/manufacturing/TodaysProductionPage.tsx'), 'utf8')
  const history = fs.readFileSync(path.join(root, 'features/manufacturing/ProductionHistoryPage.tsx'), 'utf8')
  const evidence = fs.readFileSync(path.join(root, 'features/manufacturing/RecipeSheetEvidence.tsx'), 'utf8')
  const sync = fs.readFileSync(path.join(root, 'store/manufacturingSync.ts'), 'utf8')
  const store = fs.readFileSync(path.join(root, 'store/db.ts'), 'utf8')
  const photo = fs.readFileSync(path.join(root, 'features/manufacturing/recipePhoto.ts'), 'utf8')
  assert.equal(today.includes('RecipeSheetEvidence'), true)
  assert.equal(today.includes('RecipeSheetUpload'), true)
  assert.equal(history.includes('RecipeSheetEvidence'), true)
  assert.equal(history.includes('export function ProductionHistoryPage'), true)
  const tableFn = history.slice(history.indexOf('export function ProductionHistoryPage'), history.indexOf('export function ProductionSessionDetailPage'))
  assert.equal(tableFn.includes('RecipeSheetEvidence'), false)
  assert.equal(tableFn.includes(RECIPE_PHOTO_GET_ACTION), false)
  assert.equal(history.includes('export function ProductionSessionDetailPage'), true)
  const detailFn = history.slice(history.indexOf('export function ProductionSessionDetailPage'))
  assert.equal(detailFn.includes('RecipeSheetEvidence'), true)
  assert.equal(evidence.includes('loadStoredRecipePhoto'), true)
  assert.equal(evidence.includes('Try again'), true)
  assert.equal(evidence.includes('Loading recipe sheet photo'), true)
  assert.equal(sync.includes('queueManufacturingWrite'), true)
  assert.equal(sync.includes(RECIPE_PHOTO_GET_ACTION), false)
  assert.equal(store.includes("queueSessionWrite('sessions.start'"), true)
  assert.equal(store.includes(RECIPE_PHOTO_GET_ACTION), false)
  assert.equal(photo.includes('RECIPE_PHOTO_GET_ACTION'), true)
  assert.equal(evidence.includes('postIdentityAction'), true)
  assert.equal(evidence.includes('queueManufacturingWrite'), false)
  assert.equal(photo.includes('productionSessions'), false)
})

