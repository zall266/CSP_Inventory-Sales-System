/** Isolated POS image A/B presentation. Not a permanent design lock. */

export type PosImageAbVariant = 'a' | 'b'

export function parsePosImageAbVariant(value: string | null | undefined): PosImageAbVariant | null {
  const next = String(value || '').trim().toLowerCase()
  if (next === 'a' || next === 'contain') return 'a'
  if (next === 'b' || next === 'cover') return 'b'
  return null
}

export function posImageAbFit(variant: PosImageAbVariant) {
  return variant === 'a' ? 'contain' : 'cover'
}

function packSvg(width: number, height: number, fill: string, label: string) {
  const font = Math.max(18, Math.round(Math.min(width, height) / 9))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#f8fafc"/>
    <rect x="4%" y="4%" width="92%" height="92%" rx="18" fill="${fill}"/>
    <rect x="12%" y="12%" width="76%" height="76%" rx="12" fill="#fff"/>
    <rect x="18%" y="18%" width="64%" height="64%" rx="8" fill="${fill}"/>
    <text x="50%" y="48%" text-anchor="middle" fill="#fff" font-size="${font}" font-family="DM Sans,sans-serif" font-weight="700">${label}</text>
    <text x="50%" y="62%" text-anchor="middle" fill="#e2e8f0" font-size="${Math.round(font * 0.55)}" font-family="DM Sans,sans-serif">${width}x${height}</text>
  </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export const POS_IMAGE_AB_PREVIEWS: Record<string, { shape: 'portrait' | 'landscape' | 'square'; dataUrl: string }> = {
  'p-mt': { shape: 'portrait', dataUrl: packSvg(240, 400, '#166534', 'PORTRAIT') },
  'p-st': { shape: 'landscape', dataUrl: packSvg(400, 240, '#9d174d', 'LANDSCAPE') },
  'p-wf': { shape: 'square', dataUrl: packSvg(320, 320, '#9a3412', 'SQUARE') },
}

export function posImageAbPreviewUrl(productId: string) {
  return POS_IMAGE_AB_PREVIEWS[productId]?.dataUrl
}
