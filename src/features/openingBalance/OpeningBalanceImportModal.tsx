import { useState } from 'react'
import { Button, Field, Input } from '@/components/ui'
import {
  commitOpeningBalanceImport,
  downloadOpeningBalanceTemplate,
  previewOpeningBalanceFile,
  type OpeningBalanceImportPreview,
} from '@/features/openingBalance/openingBalanceImport'
import { hasPermission } from '@/features/settings/permissions'
import { useApi, useStore } from '@/store/hooks'
import type { OpeningBalance } from '@/types'

export function OpeningBalanceImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: (documents: OpeningBalance[]) => void
}) {
  const state = useStore()
  const api = useApi()
  const canCreate = hasPermission(state, 'opening_balance.create')
  const [preview, setPreview] = useState<OpeningBalanceImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string>('')

  const readFile = async (file: File | undefined) => {
    setResult('')
    if (!file) {
      setPreview(null)
      return
    }
    const bytes = await file.arrayBuffer()
    setPreview(previewOpeningBalanceFile(state, file.name, { bytes }))
  }

  const confirmImport = () => {
    if (!preview?.canImport || busy || !canCreate) return
    setBusy(true)
    const committed = commitOpeningBalanceImport((input) => api.saveOpeningBalance(input), preview.drafts)
    setBusy(false)
    if (!committed.ok) {
      setResult(committed.reason)
      return
    }
    onImported(committed.documents)
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-slate-600">
        Upload Excel or CSV to create Opening Balance drafts. Inventory is posted only after you confirm the draft.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="secondary" className="w-full sm:w-auto" onClick={downloadOpeningBalanceTemplate}>
          Download Template
        </Button>
      </div>
      <Field label="Upload Excel / CSV">
        <Input
          type="file"
          accept=".xlsx,.xls,.csv"
          disabled={!canCreate}
          onChange={(event) => void readFile(event.target.files?.[0])}
        />
      </Field>
      {preview ? (
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {preview.rows.length} rows detected · {preview.validCount} valid · {preview.errorCount} errors
        </div>
      ) : null}
      {preview?.issues.length ? (
        <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {preview.issues.slice(0, 8).map((issue, index) => (
            <div key={`${issue.row}-${index}`}>
              {issue.row ? `Row ${issue.row}: ` : ''}
              {issue.message}
            </div>
          ))}
          {preview.issues.length > 8 ? <div>{preview.issues.length - 8} more errors</div> : null}
        </div>
      ) : null}
      {preview?.rows.length ? (
        <div className="sf-table-wrap overflow-x-auto rounded-xl border border-slate-100">
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Type</th>
                <th>Item</th>
                <th>SKU</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.row} className="cursor-default">
                  <td>{row.row}</td>
                  <td>{row.typeLabel || '—'}</td>
                  <td>{row.productName || '—'}</td>
                  <td>{row.sku || '—'}</td>
                  <td>{row.qty || '—'}</td>
                  <td>{row.unit || '—'}</td>
                  <td className={row.errors.length ? 'text-rose-600' : 'text-emerald-700'}>
                    {row.errors.length ? row.errors[0] : 'Valid'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {result ? <div className="text-sm text-rose-600">{result}</div> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" className="w-full sm:w-auto" onClick={onClose}>
          Close
        </Button>
        <Button className="w-full sm:w-auto" disabled={!preview?.canImport || busy || !canCreate} onClick={confirmImport}>
          Confirm Import
        </Button>
      </div>
    </div>
  )
}
