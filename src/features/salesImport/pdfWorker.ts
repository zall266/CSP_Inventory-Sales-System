import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

export function configurePdfWorker(pdfjs: { GlobalWorkerOptions: { workerSrc: string } }) {
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
}
