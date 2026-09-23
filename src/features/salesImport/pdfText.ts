import type { TextItem } from '@/features/salesImport/parsePickingList'

type PdfTextItem = { str?: string; transform: number[] }
type PdfPage = { getTextContent: () => Promise<{ items: PdfTextItem[] }> }
type PdfDoc = { numPages: number; getPage: (page: number) => Promise<PdfPage> }
type Pdfjs = {
  getDocument: (src: { data: Uint8Array; disableWorker?: boolean; isEvalSupported?: boolean }) => { promise: Promise<PdfDoc> }
}

export async function extractPdfTextItems(data: Uint8Array): Promise<TextItem[]> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as Pdfjs & {
    GlobalWorkerOptions: { workerSrc: string }
  }
  const browser = typeof document !== 'undefined' && typeof document.createElement === 'function'
  if (browser) {
    const { configurePdfWorker } = await import('./pdfWorker')
    configurePdfWorker(pdfjs)
  }
  const doc = await pdfjs.getDocument({ data, disableWorker: !browser, isEvalSupported: false }).promise
  const items: TextItem[] = []
  for (let page = 1; page <= doc.numPages; page += 1) {
    const pdfPage = await doc.getPage(page)
    const content = await pdfPage.getTextContent()
    for (const item of content.items) {
      const text = String(item.str ?? '').trim()
      if (!text || !item.transform) continue
      items.push({ text, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0, page })
    }
  }
  return items
}

export async function hashBytes(data: Uint8Array) {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  const digest = await crypto.subtle.digest('SHA-256', copy)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
