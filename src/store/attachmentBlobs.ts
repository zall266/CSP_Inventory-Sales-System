/** Browser blob store for evidence/attachments. Metadata stays on the document; bytes stay here. */

export const SALES_RETURN_EVIDENCE_KIND = 'sales_return_evidence'

const IDB_NAME = 'csp-attachment-blobs-v1'
const IDB_STORE = 'files'

export type AttachmentBlobRecord = {
  fileId: string
  kind: string
  fileName: string
  mimeType: string
  blob: Blob
}

const memory = new Map<string, AttachmentBlobRecord>()
const objectUrls = new Map<string, string>()

function canUseIdb() {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB could not be opened.'))
  })
}

function idbOp<T>(run: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, mode)
        const req = run(tx.objectStore(IDB_STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed.'))
      }),
  )
}

export async function putAttachmentBlob(record: AttachmentBlobRecord): Promise<void> {
  memory.set(record.fileId, record)
  revokeObjectUrl(record.fileId)
  if (!canUseIdb()) return
  try {
    await idbOp((store) => store.put(record, record.fileId), 'readwrite')
  } catch {
    memory.delete(record.fileId)
    throw new Error('Attachment storage is unavailable.')
  }
}

export async function getAttachmentBlob(fileId: string): Promise<AttachmentBlobRecord | undefined> {
  const cached = memory.get(fileId)
  if (cached) return cached
  if (!canUseIdb()) return undefined
  try {
    const record = await idbOp<AttachmentBlobRecord | undefined>((store) => store.get(fileId), 'readonly')
    if (record?.fileId) {
      memory.set(fileId, record)
      return record
    }
  } catch {
    return undefined
  }
  return undefined
}

export async function deleteAttachmentBlob(fileId: string): Promise<void> {
  memory.delete(fileId)
  revokeObjectUrl(fileId)
  if (!canUseIdb()) return
  try {
    await idbOp((store) => store.delete(fileId), 'readwrite')
  } catch {
    // Missing or unavailable storage must not fail cleanup.
  }
}

export async function clearAttachmentBlobs(): Promise<void> {
  for (const fileId of [...objectUrls.keys()]) revokeObjectUrl(fileId)
  memory.clear()
  if (!canUseIdb()) return
  try {
    await idbOp((store) => store.clear(), 'readwrite')
  } catch {
    // Demo reset should not fail if IndexedDB is missing.
  }
}

function revokeObjectUrl(fileId: string) {
  const url = objectUrls.get(fileId)
  if (!url) return
  URL.revokeObjectURL(url)
  objectUrls.delete(fileId)
}

export async function getAttachmentObjectUrl(fileId: string): Promise<string | undefined> {
  const existing = objectUrls.get(fileId)
  if (existing) return existing
  const record = await getAttachmentBlob(fileId)
  if (!record) return undefined
  const url = URL.createObjectURL(record.blob)
  objectUrls.set(fileId, url)
  return url
}
