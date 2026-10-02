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
  'services/auditService.js',
  'services/idempotencyService.js',
  'services/counterService.js',
  'services/systemService.js',
  'services/foundationService.js',
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
  const folder = {
    getId() {
      return rootId
    },
    getName() {
      return 'CSP Inventory & Sales System'
    },
    getFoldersByName() {
      return { hasNext: () => false, next: () => null }
    },
    createFolder(name) {
      created.push(name)
      return { getId: () => `folder-${name}`, getName: () => name }
    },
  }
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
      if (id === 'file-1') {
        return {
          getId: () => id,
          getName: () => 'note.txt',
          getMimeType: () => 'text/plain',
          getParents: () => ({ hasNext: () => true, next: () => folder }),
          setName() {},
          setTrashed() {
            trashed.push(id)
          },
          createFile() {
            return null
          },
        }
      }
      throw new Error('File not found')
    },
  }
}
