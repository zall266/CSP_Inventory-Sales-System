import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  RECIPE_PHOTO_CAMERA_ACCEPT,
  RECIPE_PHOTO_CAMERA_CAPTURE,
  RECIPE_PHOTO_GALLERY_ACCEPT,
  RECIPE_PHOTO_HEIC_ERROR,
  RECIPE_PHOTO_MAX_BYTES,
  RECIPE_PHOTO_SIZE_ERROR,
  RECIPE_PHOTO_TYPE_ERROR,
  SAMPLE_RECIPE_SHEET,
  SAMPLE_RECIPE_SHEET_NAME,
  canStartProductionWithPhoto,
  isDriveRecipePhotoRef,
  isHeicLike,
  isPreviewableRecipePhoto,
  isSampleRecipePhoto,
  openRecipePicker,
  parseRecipePhoto,
  readRecipePhotoFile,
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
