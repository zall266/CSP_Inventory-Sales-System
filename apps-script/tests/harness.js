import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  'utils/errors.js',
  'utils/time.js',
  'utils/ids.js',
  'utils/locks.js',
  'utils/envelope.js',
  'utils/log.js',
  'config/config.js',
  'auth/boundary.js',
  'repositories/sheetRepository.js',
  'repositories/auditRepository.js',
  'repositories/idempotencyRepository.js',
  'repositories/counterRepository.js',
  'storage/driveStorage.js',
  'identity/permissionCatalog.js',
  'repositories/identityRepository.js',
  'repositories/masterRepository.js',
  'services/auditService.js',
  'services/idempotencyService.js',
  'services/counterService.js',
  'services/systemService.js',
  'services/foundationService.js',
  'services/identityService.js',
  'services/masterService.js',
  'app/router.js',
  'app/main.js',
]

export function loadBackend(globals = {}) {
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
    crypto,
    Buffer,
    Uint8Array,
    ...globals,
  }
  vm.createContext(context)
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file })
  }
  return context
}

export function memoryProperties(initial) {
  const store = { ...initial }
  return {
    getProperty(key) {
      return store[key] || null
    },
    setProperty(key, value) {
      store[key] = String(value)
    },
  }
}

export function devProperties() {
  return memoryProperties({
    ENVIRONMENT: 'DEV',
    SPREADSHEET_ID: 'sheet-id',
    DRIVE_ROOT_ID: 'drive-id',
    TIMEZONE: 'Asia/Kuala_Lumpur',
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
      getParents: () => ({ hasNext: () => true, next: () => parent }),
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
