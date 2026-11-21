import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const srcDir = path.join(root, 'src/features/salesImport')
const outDir = path.join(root, 'apps-script/utils')

function transpile(source, fileName) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2019,
      module: ts.ModuleKind.ESNext,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      removeComments: true,
    },
    fileName,
    reportDiagnostics: true,
  })
  if (result.diagnostics && result.diagnostics.length) {
    const text = ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    })
    throw new Error(text)
  }
  return result.outputText
    .replace(/^import\s+[^;]+;\s*/gm, '')
    .replace(/^export\s+/gm, '')
    .replace(/\.at\(-1\)/g, '.slice(-1)[0]')
}

function wrapParser(name, source) {
  return `// Ported from src/features/salesImport/${name}.ts for Apps Script V8.\n\nvar ${name} = (function () {\n${source}\n  return ${name};\n})();\n`
}

function wrapMath(sources) {
  const body = sources.join('\n')
  const exported = [
    'normalizeTextKey',
    'mappingIdentity',
    'mappingKeyLabel',
    'externalLabel',
    'suggestProduct',
    'mappingIsActive',
    'mappingSourceTexts',
    'filterSalesImportMappings',
    'resolveLineProduct',
    'SALES_IMPORT_WAREHOUSE_ID',
    'saleReference',
    'takenOrderIds',
    'materializeOrders',
    'accountIssues',
    'liveOrderStatus',
    'deriveBatchStatus',
    'requiredStock',
    'assessSalesImport',
    'salesImportSummary',
    'salesImportLinesForBatch',
    'salesImportProductReview',
    'salesImportActions',
    'batchStatusLabel',
    'awbQuantityFor',
    'reconcileAwbLines',
    'shipmentLinkStatus',
  ]
  const assigns = exported.map((name) => `  root.${name} = ${name};`).join('\n')
  return `// Ported from src/features/salesImport mapping/review/reconcile for Apps Script V8.\n\n(function (root) {\nfunction round2(value) {\n  return Math.round(Number(value) * 100) / 100;\n}\nfunction salesComponentsOf(product) {\n  var rows = product && product.salesComponents ? product.salesComponents : [];\n  var merged = {};\n  for (var i = 0; i < rows.length; i += 1) {\n    var row = rows[i];\n    var productId = String(row && row.productId ? row.productId : '').trim();\n    var qty = Number(row && row.qty);\n    if (!productId || !Number.isFinite(qty) || !(qty > 0)) continue;\n    merged[productId] = round2((merged[productId] || 0) + qty);\n  }\n  return Object.keys(merged).map(function (id) {\n    return { productId: id, qty: merged[id] };\n  });\n}\n${body}\n${assigns}\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n`
}

const picking = transpile(fs.readFileSync(path.join(srcDir, 'parsePickingList.ts'), 'utf8'), 'parsePickingList.ts')
const awb = transpile(fs.readFileSync(path.join(srcDir, 'parseAwb.ts'), 'utf8'), 'parseAwb.ts')
const mapping = transpile(fs.readFileSync(path.join(srcDir, 'mapping.ts'), 'utf8'), 'mapping.ts')
const review = transpile(
  fs.readFileSync(path.join(srcDir, 'review.ts'), 'utf8')
    .replace(/import type[^\n]+\n/g, '')
    .replace(/import \{ salesComponentsOf \} from[^\n]+\n/g, '')
    .replace(/import \{ externalLabel, mappingIdentity, resolveLineProduct \} from[^\n]+\n/g, '')
    .replace(/import \{ round2 \} from[^\n]+\n/g, ''),
  'review.ts',
)
const reconcile = transpile(
  fs.readFileSync(path.join(srcDir, 'reconcileAwb.ts'), 'utf8')
    .replace(/import type[^\n]+\n/g, ''),
  'reconcileAwb.ts',
)

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'parsePickingList.js'), wrapParser('parsePickingList', picking))
fs.writeFileSync(path.join(outDir, 'parseAwb.js'), wrapParser('parseAwb', awb))
fs.writeFileSync(path.join(outDir, 'salesImportMath.js'), wrapMath([mapping, review, reconcile]))
console.log('converted sales import math')
