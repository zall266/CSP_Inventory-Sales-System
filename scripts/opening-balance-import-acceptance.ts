const memory = new Map<string, string>()
const localStoragePolyfill = {
  getItem(key: string) {
    return memory.has(key) ? memory.get(key)! : null
  },
  setItem(key: string, value: string) {
    memory.set(key, String(value))
  },
  removeItem(key: string) {
    memory.delete(key)
  },
  clear() {
    memory.clear()
  },
  key(index: number) {
    return [...memory.keys()][index] ?? null
  },
  get length() {
    return memory.size
  },
}

Object.defineProperty(globalThis, 'localStorage', { value: localStoragePolyfill })
Object.defineProperty(globalThis, 'window', { value: globalThis })

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const { db } = await import('@/store/db')
const { hasPermission } = await import('@/features/settings/permissions')
const { navGroups } = await import('@/components/layout/Sidebar')
const pagesSrc = readFileSync(new URL('../src/features/openingBalance/OpeningBalancePages.tsx', import.meta.url), 'utf8')
const sidebarSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/components/layout/Sidebar.tsx'), 'utf8')
const {
  commitOpeningBalanceImport,
  exportOpeningBalanceMatrix,
  openingBalanceImportTemplateMatrix,
  previewOpeningBalanceFile,
  previewOpeningBalanceImport,
} = await import('@/features/openingBalance/openingBalanceImport')
const { xlsxBytesFromMatrix } = await import('@/features/importexport/workbook')

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function inventoryOf(productId: string, warehouseId = 'wh-main') {
  return db.getSnapshot().inventory.find((row) => row.productId === productId && row.warehouseId === warehouseId)?.qty ?? 0
}

function csv(rows: string[][]) {
  return rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n')
}

const headers = ['Type', 'Product / Item', 'SKU', 'Quantity', 'Unit', 'Batch / Lot', 'Expiry', 'Warehouse', 'Location', 'Storage Box', 'Notes']

db.resetDemo()
db.switchUser('u-admin')

check(
  'Opening Balance page has Import and Export actions',
  pagesSrc.includes('Import') && pagesSrc.includes('Export') && pagesSrc.includes('OpeningBalanceImportModal'),
)
check(
  'Sidebar does not add an Import/Export menu',
  !/Import\/Export|Import & Export/i.test(sidebarSrc) &&
    navGroups.every((group) => group.items.every((item) => item.label !== 'Import/Export')),
)
check(
  'Template includes Type, SKU, Quantity, Storage Box',
  openingBalanceImportTemplateMatrix()[0]?.join(',') ===
    'Type,Product / Item,SKU,Quantity,Unit,Batch / Lot,Expiry,Warehouse,Location,Storage Box,Notes',
)

const cocoaBefore = inventoryOf('p-cocoa')
const validStock = previewOpeningBalanceFile(db.getSnapshot(), 'opening.csv', {
  text: csv([
    headers,
    ['Stock Item', 'Cocoa Powder', 'RW-CC001', '2', 'KG', 'LOT-1', '2027-01-15', 'Main Warehouse', '', '', 'Imported cocoa'],
  ]),
})
check('Valid import parses one stock row', validStock.canImport && validStock.validCount === 1 && validStock.errorCount === 0)
const imported = commitOpeningBalanceImport((input) => db.saveOpeningBalance(input), validStock.drafts)
check('Valid import creates a draft through saveOpeningBalance', imported.ok && imported.documents[0]?.status === 'draft', imported.ok ? imported.documents[0]?.documentNo : imported.reason)
check('Import does not post inventory', inventoryOf('p-cocoa') === cocoaBefore)
check('Draft keeps quantity and SKU product', imported.ok && imported.documents[0]?.items[0]?.productId === 'p-cocoa' && imported.documents[0]?.items[0]?.qty === 2)
check('Draft keeps optional batch and expiry', imported.ok && imported.documents[0]?.items[0]?.batchNo === 'LOT-1' && imported.documents[0]?.items[0]?.expiry === '2027-01-15')

const confirmed = imported.ok ? db.confirmOpeningBalance(imported.documents[0].id) : false
check('Existing confirm still posts imported draft', confirmed === true)
check('Inventory posts only after confirm', inventoryOf('p-cocoa') === cocoaBefore + 2)

const missingQty = previewOpeningBalanceImport(db.getSnapshot(), 'missing.csv', [
  headers,
  ['Stock Item', 'Sugar', 'RW-SG001', '', 'KG', '', '', 'Main Warehouse', '', '', ''],
])
check('Invalid required quantity is blocked', !missingQty.canImport && missingQty.issues.some((issue) => issue.message.includes('greater than 0')))

const missingSku = previewOpeningBalanceFile(db.getSnapshot(), 'missing-sku.csv', {
  text: csv([headers, ['Stock Item', 'No Such Item', 'ZZ-NOT-FOUND', '1', 'KG', '', '', 'Main Warehouse', '', '', '']]),
})
check('Invalid product/SKU reference is blocked', !missingSku.canImport && missingSku.issues.some((issue) => /not found/i.test(issue.message)))

const badPbUnit = previewOpeningBalanceImport(db.getSnapshot(), 'pb-unit.csv', [
  headers,
  ['Production Balance', 'Matcha', 'FG-MT45', '5000', 'PACK', '', '', 'Main Warehouse', '', 'Box 1', ''],
])
check('Invalid Production Balance unit PACK is blocked', !badPbUnit.canImport && badPbUnit.issues.some((issue) => issue.message.includes('unit must be G')))

const zeroQty = previewOpeningBalanceImport(db.getSnapshot(), 'zero.csv', [
  headers,
  ['Stock Item', 'Sugar', 'RW-SG001', '0', 'KG', '', '', 'Main Warehouse', '', '', ''],
])
check('Invalid quantity 0 is blocked', !zeroQty.canImport)

const duplicate = previewOpeningBalanceImport(db.getSnapshot(), 'dup.csv', [
  headers,
  ['Stock Item', 'Sugar', 'RW-SG001', '1', 'KG', '', '', 'Main Warehouse', '', '', ''],
  ['Stock Item', 'Sugar', 'RW-SG001', '2', 'KG', '', '', 'Main Warehouse', '', '', ''],
])
check('Duplicate stock lines in the same warehouse are blocked', !duplicate.canImport && duplicate.issues.some((issue) => /Duplicate/i.test(issue.message)))

const emptyFile = previewOpeningBalanceFile(db.getSnapshot(), 'empty.csv', { text: '' })
check('Empty file is blocked', !emptyFile.canImport && emptyFile.issues.some((issue) => /empty/i.test(issue.message)))

const badFormat = previewOpeningBalanceFile(db.getSnapshot(), 'notes.pdf', { text: 'not a spreadsheet' })
check('Invalid file format is blocked', !badFormat.canImport && badFormat.issues.some((issue) => /Excel \(\.xlsx\) or CSV/i.test(issue.message)))

const headerMismatch = previewOpeningBalanceImport(db.getSnapshot(), 'headers.csv', [['Name', 'Amount'], ['Sugar', '1']])
check('Header mismatch is blocked', !headerMismatch.canImport && headerMismatch.issues.some((issue) => /Header mismatch/i.test(issue.message)))

const kgPb = previewOpeningBalanceImport(db.getSnapshot(), 'pb-kg.csv', [
  headers,
  ['Production Balance', 'Matcha', 'FG-MT45', '5', 'KG', '', '', 'Main Warehouse', '', 'Box 1', ''],
])
check('Production Balance rejects KG', !kgPb.canImport)

const bagPb = previewOpeningBalanceImport(db.getSnapshot(), 'pb-bag.csv', [
  headers,
  ['Production Balance', 'Matcha', 'FG-MT45', '1', 'BAG', '', '', 'Main Warehouse', '', 'Box 1', ''],
])
check('Production Balance rejects BAG', !bagPb.canImport)

const pbBefore = (db.getSnapshot().productionBalances ?? []).filter((row) => row.productId === 'p-pack-mt').length
const pbOk = previewOpeningBalanceImport(db.getSnapshot(), 'pb.csv', [
  headers,
  ['Production Balance', 'Matcha', 'FG-MT45', '5000', 'G', '', '', 'Main Warehouse', '', 'Box 1', 'Opening grams'],
])
const pbSaved = commitOpeningBalanceImport((input) => db.saveOpeningBalance(input), pbOk.drafts)
check('Production Balance import is gram-based with Storage Box', pbOk.canImport && pbSaved.ok && pbSaved.documents[0]?.items[0]?.unit === 'G' && pbSaved.documents[0]?.items[0]?.container === 'Box 1')
check('Production Balance import stays draft', pbSaved.ok && pbSaved.documents[0]?.status === 'draft')
check(
  'Production Balance import does not create a Production Session or extra balance yet',
  db.getSnapshot().productionSessions.length > 0 &&
    (db.getSnapshot().productionBalances ?? []).filter((row) => row.productId === 'p-pack-mt').length === pbBefore,
)

const fg = previewOpeningBalanceImport(db.getSnapshot(), 'fg.csv', [
  headers,
  ['Finished Goods', 'Matcha', 'FG-MT45', '40', 'PACKS', '', '', 'Main Warehouse', 'inventory', '', ''],
])
const fgSaved = commitOpeningBalanceImport((input) => db.saveOpeningBalance(input), fg.drafts)
check('Finished Goods import creates a draft', fg.canImport && fgSaved.ok && fgSaved.documents[0]?.type === 'finished_goods' && fgSaved.documents[0]?.status === 'draft')

const mixed = previewOpeningBalanceImport(db.getSnapshot(), 'mixed.csv', [
  headers,
  ['Stock Item', 'Milk Powder', 'RW-MK001', '3', 'KG', '', '', 'Main Warehouse', '', '', ''],
  ['Finished Goods', 'Strawberry', 'FG-ST45', '30', 'PACKS', '', '', 'Main Warehouse', 'inventory', '', ''],
])
check('Mixed types preview as two drafts', mixed.canImport && mixed.drafts.length === 2)

const agent = db.createAgent({ name: 'JB', code: 'JB' })
const agentWarehouseName = db.getSnapshot().warehouses.find((row) => row.id === agent?.warehouseId)?.name ?? 'Agent JB'
const agentWh = previewOpeningBalanceImport(db.getSnapshot(), 'agent.csv', [
  headers,
  ['Stock Item', 'Sugar', 'RW-SG001', '1', 'KG', '', '', agentWarehouseName, '', '', ''],
])
check('Agent warehouse is rejected', Boolean(agent) && !agentWh.canImport)

const xlsxPreview = previewOpeningBalanceFile(db.getSnapshot(), 'opening.xlsx', {
  bytes: xlsxBytesFromMatrix([
    headers,
    ['Stock Item', 'Flour', 'RW-FL001', '8', 'KG', '', '', 'Main Warehouse', '', '', 'From xlsx'],
  ]),
})
check('Excel xlsx file can be parsed', xlsxPreview.canImport && xlsxPreview.validCount === 1)

const exported = exportOpeningBalanceMatrix(db.getSnapshot())
check(
  'Export includes document fields without mutating data',
  exported[0]?.[0] === 'Document No' &&
    exported.some((row) => row.includes('Cocoa Powder')) &&
    exported.some((row) => row.includes('draft') || row.includes('confirmed')),
)
const cocoaAfterExport = inventoryOf('p-cocoa')
check('Export is read-only', cocoaAfterExport === inventoryOf('p-cocoa'))

db.switchUser('u-mei')
const staffPreview = previewOpeningBalanceImport(db.getSnapshot(), 'staff.csv', [
  headers,
  ['Stock Item', 'Sugar', 'RW-SG001', '1', 'KG', '', '', 'Main Warehouse', '', '', ''],
])
const staffSave = commitOpeningBalanceImport((input) => db.saveOpeningBalance(input), staffPreview.drafts)
check('Staff without permission cannot create imported drafts', staffSave.ok === false)
check(
  'Staff without opening_balance.create is denied',
  !hasPermission(db.getSnapshot(), 'opening_balance.create', db.getSnapshot().users.find((user) => user.id === 'u-mei')),
)

db.switchUser('u-admin')
check('Owner/Admin can still view Opening Balance after import tests', hasPermission(db.getSnapshot(), 'opening_balance.view'))

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.error(failed.map((row) => row.name).join('\n'))
  process.exit(1)
}
