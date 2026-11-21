import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  'utils/errors.js',
  'utils/receivingPurchaseLink.js',
  'utils/packingMath.js',
  'utils/sessionMath.js',
  'utils/time.js',
  'utils/ids.js',
  'utils/locks.js',
  'utils/envelope.js',
  'utils/log.js',
  'config/config.js',
  'auth/crypto.js',
  'auth/boundary.js',
  'repositories/sheetRepository.js',
  'repositories/auditRepository.js',
  'repositories/idempotencyRepository.js',
  'repositories/counterRepository.js',
  'storage/driveStorage.js',
  'identity/permissionCatalog.js',
  'repositories/identityRepository.js',
  'repositories/authRepository.js',
  'repositories/masterRepository.js',
  'repositories/productRepository.js',
  'repositories/partyRepository.js',
  'repositories/inventoryRepository.js',
  'repositories/warehouseRepository.js',
  'repositories/bomRepository.js',
  'repositories/openingBalanceRepository.js',
  'repositories/purchaseRepository.js',
  'repositories/receivingRepository.js',
  'repositories/manufacturingRepository.js',
  'repositories/salesRepository.js',
  'repositories/salesReturnRepository.js',
  'repositories/salesImportRepository.js',
  'repositories/dispatchRepository.js',
  'repositories/opsRepository.js',
  'utils/parsePickingList.js',
  'utils/parseAwb.js',
  'utils/salesImportMath.js',
  'utils/dispatchMath.js',
  'utils/halalMath.js',
  'utils/taskMath.js',
  'utils/reportMath.js',
  'utils/pjkmMath.js',
  'utils/bmrMath.js',
  'services/auditService.js',
  'services/idempotencyService.js',
  'services/counterService.js',
  'services/systemService.js',
  'services/foundationService.js',
  'services/identityService.js',
  'services/authService.js',
  'services/masterService.js',
  'services/productService.js',
  'services/partyService.js',
  'services/inventoryService.js',
  'services/warehouseService.js',
  'services/bomService.js',
  'services/openingBalanceService.js',
  'services/purchaseService.js',
  'services/receivingService.js',
  'services/manufacturingService.js',
  'services/salesService.js',
  'services/salesReturnService.js',
  'services/salesImportService.js',
  'services/dispatchService.js',
  'services/opsService.js',
  'services/reportingService.js',
  'app/router.js',
  'app/main.js',
]

function toNodeBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  if (Array.isArray(value)) return Buffer.from(Uint8Array.from(value.map((item) => item & 255)))
  return Buffer.from(String(value))
}

function nodeUtilities() {
  return {
    getUuid: () => crypto.randomUUID(),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest(_algo, value) {
      return Array.from(crypto.createHash('sha256').update(toNodeBuffer(value)).digest())
    },
    computeHmacSha256Signature(value, key) {
      return Array.from(crypto.createHmac('sha256', toNodeBuffer(key)).update(toNodeBuffer(value)).digest())
    },
    base64Encode(value) {
      return toNodeBuffer(value).toString('base64')
    },
    base64Decode(value) {
      return Array.from(Buffer.from(String(value), 'base64'))
    },
  }
}

function shouldMintHarnessSession(context, request) {
  if (!request || !request.payload || request.payload.sessionToken !== undefined) return false
  if (context.isPublicAuthAction(request.action)) return false
  if (typeof context.isSetupAuthAction === 'function' && context.isSetupAuthAction(request.action)) return false
  const actor = request.payload.actorUserId
  if (typeof actor === 'string' && actor.trim()) return true
  if (actor === '' || actor === null) return false
  const action = String(request.action || '')
  return /\.(bootstrap|get|list)$/.test(action) || action === 'settings.get'
}

export const HARNESS_IDENTITY_BOOTSTRAP_SECRET = 'a'.repeat(64)
export const HARNESS_OWNER_ENROLL_SECRET = 'b'.repeat(64)
export const HARNESS_OWNER_ENROLL_USERNAME = 'aina@coolslurppy.my'
export const HARNESS_OWNER_ENROLL_USER_ID = 'u-aina'

export function harnessIdentityBootstrapHash() {
  return crypto.createHash('sha256').update(HARNESS_IDENTITY_BOOTSTRAP_SECRET).digest('hex')
}

export function harnessOwnerEnrollHash() {
  return crypto.createHash('sha256').update(HARNESS_OWNER_ENROLL_SECRET).digest('hex')
}

export function harnessOwnerEnrollExpiry(fromMs = Date.now()) {
  return new Date(Number(fromMs) + 10 * 60 * 1000).toISOString()
}

function injectHarnessSetup(context, request) {
  if (!request || !request.payload || typeof request.payload !== 'object') return
  if (typeof context.setupAuthorizationField !== 'function') return
  const field = context.setupAuthorizationField(request.action)
  if (!field) return
  if (field === 'setupAuthorization') {
    if (context.AUTH_INJECT_TEST_BOOTSTRAP === false) return
    if (request.payload.setupAuthorization !== undefined) return
    request.payload.setupAuthorization = HARNESS_IDENTITY_BOOTSTRAP_SECRET
    return
  }
  if (field === 'ownerEnrollmentAuthorization') {
    if (context.AUTH_INJECT_TEST_OWNER_ENROLL === false) return
    if (request.payload.ownerEnrollmentAuthorization !== undefined) return
    request.payload.ownerEnrollmentAuthorization = HARNESS_OWNER_ENROLL_SECRET
  }
}

export function loadBackend(globals = {}) {
  const utilities = { ...nodeUtilities(), ...(globals.Utilities || {}) }
  const context = {
    console,
    JSON,
    Date,
    Math,
    Number,
    String,
    Object,
    Array,
    Intl,
    crypto: {
      getRandomValues: (value) => crypto.getRandomValues(value),
      randomUUID: () => crypto.randomUUID(),
    },
    authNativePbkdf2HmacSha256(password, salt, iterations, dkLen) {
      return new Uint8Array(crypto.pbkdf2Sync(
        toNodeBuffer(password),
        toNodeBuffer(salt),
        Number(iterations) || 600000,
        Number(dkLen) || 32,
        'sha256',
      ))
    },
    Buffer,
    Uint8Array,
    Map,
    Set,
    Infinity,
    Boolean,
    RegExp,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    ...globals,
    Utilities: utilities,
    AUTH_ALLOW_TEST_SESSION: true,
    AUTH_INJECT_TEST_BOOTSTRAP: true,
    AUTH_INJECT_TEST_OWNER_ENROLL: true,
  }
  context.globalThis = context
  vm.createContext(context)
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file })
  }
  context.issueHarnessSession = function issueHarnessSession(request, backend) {
    if (!request || !request.payload || request.payload.sessionToken !== undefined) return ''
    if (context.isPublicAuthAction(request.action)) return ''
    if (typeof context.isSetupAuthAction === 'function' && context.isSetupAuthAction(request.action)) return ''
    try {
      const auth = backend && backend.auth
        ? backend.auth
        : context.createAuthService({
            sheetRepository: backend && backend.sheets ? backend.sheets : context.createSheetRepository(),
            driveStorage: backend && (backend.driveStorage || backend.drive),
          })
      const sheets = backend && backend.sheets ? backend.sheets : context.createSheetRepository()
      return auth.issueTestSession(sheets.openSpreadsheet(), String((request.payload && request.payload.actorUserId) || '').trim())
    } catch {
      return ''
    }
  }
  const innerHandle = context.handleRequest
  const tokenCache = new WeakMap()
  context.handleRequest = function handleRequestWithTestSession(request, backend) {
    injectHarnessSetup(context, request)
    if (shouldMintHarnessSession(context, request) && backend && backend.sheets) {
      const spreadsheet = backend.sheets.openSpreadsheet()
      const cacheKey = spreadsheet.store || spreadsheet
      let tokens = tokenCache.get(cacheKey)
      if (!tokens) {
        tokens = Object.create(null)
        tokenCache.set(cacheKey, tokens)
      }
      const actor = String((request.payload && request.payload.actorUserId) || '').trim() || '__default__'
      if (!tokens[actor]) tokens[actor] = context.issueHarnessSession(request, backend)
      if (tokens[actor]) request.payload.sessionToken = tokens[actor]
    }
    return innerHandle(request, backend)
  }
  return context
}

export function memoryProperties(initial) {
  const store = { ...initial }
  return {
    getProperty(key) {
      if (!Object.prototype.hasOwnProperty.call(store, key)) return null
      const value = store[key]
      return value === undefined || value === null ? null : String(value)
    },
    setProperty(key, value) {
      store[key] = String(value)
    },
    deleteProperty(key) {
      delete store[key]
    },
  }
}

export function devProperties() {
  return memoryProperties({
    ENVIRONMENT: 'DEV',
    SPREADSHEET_ID: 'sheet-id',
    DRIVE_ROOT_ID: 'drive-id',
    TIMEZONE: 'Asia/Kuala_Lumpur',
    IDENTITY_BOOTSTRAP_HASH: harnessIdentityBootstrapHash(),
    AUTH_OWNER_ENROLL_HASH: harnessOwnerEnrollHash(),
    AUTH_OWNER_ENROLL_USERNAME: HARNESS_OWNER_ENROLL_USERNAME,
    AUTH_OWNER_ENROLL_USER_ID: HARNESS_OWNER_ENROLL_USER_ID,
    AUTH_OWNER_ENROLL_EXPIRES_AT: harnessOwnerEnrollExpiry(),
  })
}

export function createFakeSpreadsheet(seed = {}) {
  const store = { Sheet1: [['']], ...seed }
  function makeSheet(name) {
    return {
      getName() {
        return name
      },
      getLastRow() {
        return store[name].length
      },
      getLastColumn() {
        return store[name].reduce((max, row) => Math.max(max, row.length), 0)
      },
      getRange(row, column, numRows, numColumns) {
        return {
          getValues() {
            const values = []
            for (let r = 0; r < numRows; r += 1) {
              const source = store[name][row - 1 + r] || []
              const slice = []
              for (let c = 0; c < numColumns; c += 1) {
                const cell = source[column - 1 + c]
                slice.push(cell === undefined ? '' : cell)
              }
              values.push(slice)
            }
            return values
          },
          setValues(values) {
            for (let r = 0; r < values.length; r += 1) {
              if (!store[name][row - 1 + r]) store[name][row - 1 + r] = []
              for (let c = 0; c < values[r].length; c += 1) {
                store[name][row - 1 + r][column - 1 + c] = values[r][c]
              }
            }
          },
          clearContent() {
            for (let r = 0; r < numRows; r += 1) {
              const source = store[name][row - 1 + r]
              if (!source) continue
              for (let c = 0; c < numColumns; c += 1) source[column - 1 + c] = ''
            }
          },
        }
      },
      appendRow(row) {
        store[name].push(row.slice())
      },
    }
  }
  return {
    store,
    getName() {
      return 'CSP Inventory & Sales System - Database'
    },
    getSheetByName(name) {
      return store[name] ? makeSheet(name) : null
    },
    insertSheet(name) {
      if (store[name]) throw new Error('exists')
      store[name] = []
      return makeSheet(name)
    },
  }
}

export function createFakeDrive(rootId) {
  const created = []
  const trashed = []
  const files = new Map()
  const children = new Map()

  function makeFile(id, name, mime, bytes, parent) {
    let fileName = name
    const file = {
      getId: () => id,
      getName: () => fileName,
      getMimeType: () => mime,
      getBlob: () => ({
        getContentType: () => mime,
        getBytes: () => bytes,
      }),
      getParents: () => {
        let remaining = 1
        return {
          hasNext: () => remaining > 0,
          next: () => {
            remaining -= 1
            return parent
          },
        }
      },
      setName(next) {
        fileName = next
      },
      setTrashed(value) {
        if (value) trashed.push(id)
      },
    }
    files.set(id, file)
    return file
  }

  function makeFolder(id, name) {
    const folder = {
      getId: () => id,
      getName: () => name,
      getFoldersByName(childName) {
        const child = children.get(childName) || null
        return { hasNext: () => Boolean(child), next: () => child }
      },
      createFolder(childName) {
        created.push(childName)
        const child = makeFolder(`folder-${childName}`, childName)
        children.set(childName, child)
        return child
      },
      createFile(blob) {
        const id = `file-${files.size + 2}`
        const mime = blob && blob.getContentType ? blob.getContentType() : 'application/octet-stream'
        const bytes = blob && blob.getBytes ? blob.getBytes() : new Uint8Array()
        return makeFile(id, 'upload', mime, bytes, folder)
      },
    }
    return folder
  }

  const folder = makeFolder(rootId, 'CSP Inventory & Sales System')
  makeFile('file-1', 'note.txt', 'text/plain', new Uint8Array(), folder)

  return {
    created,
    trashed,
    folder,
    getFolderById(id) {
      if (id !== rootId) {
        const error = new Error('Folder not found')
        throw error
      }
      return folder
    },
    getFileById(id) {
      if (files.has(id)) return files.get(id)
      throw new Error('File not found')
    },
  }
}
