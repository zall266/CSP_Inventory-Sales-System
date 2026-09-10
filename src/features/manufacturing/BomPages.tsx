import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Card, Field, FilterRow, Input, Modal, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui'
import { ProductMark } from '@/components/ProductMark'
import { useApi, useLookups, useStore } from '@/store/hooks'
import { formatMoney, formatQty, round2 } from '@/utils/format'
import { bomMaterialCost, finishedProductIds, rawMaterialIds } from './helpers'
import type { Bom, BomInput } from '@/types'

type DraftLine = { productId: string; qty: number; unit: string; wastagePct: number; notes: string }

const emptyLine = (productId: string, unit = 'KG'): DraftLine => ({
  productId,
  qty: 0,
  unit,
  wastagePct: 0,
  notes: '',
})

export function BomListPage() {
  const state = useStore()
  const api = useApi()
  const { product } = useLookups()
  const [query, setQuery] = useState('')
  const [productId, setProductId] = useState('all')
  const [editing, setEditing] = useState<Bom | null | 'new'>(null)

  const rows = useMemo(() => {
    return state.boms.filter((bom) => {
      const p = product(bom.productId)
      if (productId !== 'all' && bom.productId !== productId) return false
      if (query && !`${bom.name} ${p?.name ?? ''} ${p?.sku ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
  }, [state.boms, query, productId, product])

  const fgIds = finishedProductIds(state)

  return (
    <div>
      <PageHeader
        title="Bill of Materials"
        subtitle="Recipes for finished goods — quantities, yield and estimated material cost."
        actions={<Button onClick={() => setEditing('new')}><Plus size={16} /> New BOM</Button>}
      />
      <FilterRow>
        <Input placeholder="Search BOM, product or SKU" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="all">All products</option>
          {fgIds.map((id) => {
            const p = product(id)
            return p ? <option key={id} value={id}>{p.name}</option> : null
          })}
        </Select>
        <div /><div />
      </FilterRow>
      <Card>
        <div className="sf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>BOM</th>
                <th>Finished product</th>
                <th>SKU</th>
                <th>Output / yield</th>
                <th>Components</th>
                <th>Est. cost</th>
                <th>Cost / unit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((bom) => {
                const p = product(bom.productId)
                const cost = bomMaterialCost(state, bom)
                return (
                  <tr key={bom.id} onClick={() => api.openDrawer({ type: 'bom', id: bom.id })}>
                    <td className="font-medium text-indigo-700">{bom.name}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        {p && <ProductMark product={p} size="sm" />}
                        <span>{p?.name}</span>
                      </div>
                    </td>
                    <td>{p?.sku}</td>
                    <td className="tabular">{formatQty(bom.outputQty)} {bom.outputUnit}</td>
                    <td>{bom.items.length}</td>
                    <td className="tabular">{formatMoney(cost)}</td>
                    <td className="tabular">{formatMoney(bom.outputQty ? cost / bom.outputQty : 0)}</td>
                    <td><StatusBadge status={bom.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <BomModal
        open={editing !== null}
        bom={editing === 'new' ? undefined : editing ?? undefined}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}

export function BomModal({ open, onClose, bom }: { open: boolean; onClose: () => void; bom?: Bom }) {
  const state = useStore()
  const api = useApi()
  const fg = finishedProductIds(state)
  const defaultProduct = bom?.productId ?? fg[0] ?? state.products[0]?.id ?? ''
  const materials = rawMaterialIds(state)
  const materialOptions = state.products.filter((p) => p.status === 'active' && (materials.includes(p.id) || p.id !== defaultProduct))

  const [form, setForm] = useState<BomInput>(() => ({
    name: bom?.name ?? '',
    productId: defaultProduct,
    outputQty: bom?.outputQty ?? 100,
    outputUnit: bom?.outputUnit ?? 'KG',
    notes: bom?.notes ?? '',
    items: bom?.items.map((item) => ({
      productId: item.productId,
      qty: item.qty,
      unit: item.unit,
      wastagePct: item.wastagePct,
      notes: item.notes,
    })) ?? [emptyLine(materialOptions[0]?.id ?? '', materialOptions[0]?.unit)],
  }))

  useEffect(() => {
    if (!open) return
    const productId = bom?.productId ?? fg[0] ?? state.products[0]?.id ?? ''
    setForm({
      name: bom?.name ?? '',
      productId,
      outputQty: bom?.outputQty ?? 100,
      outputUnit: bom?.outputUnit ?? 'KG',
      notes: bom?.notes ?? '',
      items: bom?.items.map((item) => ({
        productId: item.productId,
        qty: item.qty,
        unit: item.unit,
        wastagePct: item.wastagePct,
        notes: item.notes,
      })) ?? [emptyLine(materialOptions[0]?.id ?? '', materialOptions[0]?.unit)],
    })
  }, [open, bom?.id])

  const p = state.products.find((item) => item.id === form.productId)
  const preview: Bom = {
    id: bom?.id ?? 'preview',
    status: bom?.status ?? 'active',
    name: form.name,
    productId: form.productId,
    outputQty: form.outputQty,
    outputUnit: form.outputUnit,
    notes: form.notes,
    items: form.items.map((item, i) => ({ ...item, id: `tmp-${i}` })),
  }
  const cost = bomMaterialCost(state, preview)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (bom) api.updateBom(bom.id, form)
    else api.createBom(form)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={bom ? 'Edit BOM' : 'New BOM'} width="max-w-3xl">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="BOM name" className="sm:col-span-2">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Chocolate Powder — 100 KG" />
          </Field>
          <Field label="Finished product">
            <Select
              value={form.productId}
              onChange={(e) => {
                const next = state.products.find((item) => item.id === e.target.value)
                setForm({
                  ...form,
                  productId: e.target.value,
                  outputUnit: next?.unit ?? form.outputUnit,
                  name: form.name || (next ? `${next.name} — ${form.outputQty} ${next.unit}` : form.name),
                })
              }}
            >
              {state.products.filter((item) => item.status === 'active').map((item) => (
                <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>
              ))}
            </Select>
          </Field>
          <Field label="SKU">
            <Input disabled value={p?.sku ?? ''} />
          </Field>
          <Field label="Output quantity">
            <Input type="number" min={0.01} step="0.01" value={form.outputQty} onChange={(e) => setForm({ ...form, outputQty: Number(e.target.value) })} />
          </Field>
          <Field label="Output unit">
            <Input value={form.outputUnit} onChange={(e) => setForm({ ...form, outputUnit: e.target.value })} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <MiniStat label="Estimated material cost" value={formatMoney(cost)} />
          <MiniStat label="Cost per finished unit" value={formatMoney(form.outputQty ? cost / form.outputQty : 0)} />
          <MiniStat label="Total expected yield" value={`${formatQty(form.outputQty)} ${form.outputUnit}`} />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">Raw materials / components</div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const next = state.products.find((item) => item.id !== form.productId)
                setForm({ ...form, items: [...form.items, emptyLine(next?.id ?? '', next?.unit)] })
              }}
            >
              <Plus size={14} /> Add component
            </Button>
          </div>
          <div className="space-y-2">
            {form.items.map((line, index) => (
              <div key={index} className="grid gap-2 rounded-xl border border-slate-100 p-3 lg:grid-cols-12">
                <Select
                  className="lg:col-span-4"
                  value={line.productId}
                  onChange={(e) => {
                    const next = state.products.find((item) => item.id === e.target.value)
                    setForm({
                      ...form,
                      items: form.items.map((item, i) => i === index ? { ...item, productId: e.target.value, unit: next?.unit ?? item.unit } : item),
                    })
                  }}
                >
                  {state.products.filter((item) => item.id !== form.productId).map((item) => (
                    <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>
                  ))}
                </Select>
                <Input className="lg:col-span-2" type="number" min={0} step="0.01" value={line.qty} onChange={(e) => setForm({ ...form, items: form.items.map((item, i) => i === index ? { ...item, qty: Number(e.target.value) } : item) })} />
                <Input className="lg:col-span-1" value={line.unit} onChange={(e) => setForm({ ...form, items: form.items.map((item, i) => i === index ? { ...item, unit: e.target.value } : item) })} />
                <Input className="lg:col-span-2" type="number" min={0} step="0.1" value={line.wastagePct} onChange={(e) => setForm({ ...form, items: form.items.map((item, i) => i === index ? { ...item, wastagePct: Number(e.target.value) } : item) })} placeholder="Wastage %" />
                <Input className="lg:col-span-2" value={line.notes} onChange={(e) => setForm({ ...form, items: form.items.map((item, i) => i === index ? { ...item, notes: e.target.value } : item) })} placeholder="Notes" />
                <button
                  type="button"
                  className="lg:col-span-1 inline-flex items-center justify-center text-slate-400 hover:text-rose-600"
                  onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">Quantity required · Unit · Optional wastage % · Notes</p>
        </div>
        <Field label="Notes">
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">{bom ? 'Save BOM' : 'Create BOM'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular text-slate-900">{value}</div>
    </div>
  )
}

export function BomDetail({ id }: { id: string }) {
  const state = useStore()
  const api = useApi()
  const { product } = useLookups()
  const bom = state.boms.find((item) => item.id === id)
  const [editing, setEditing] = useState(false)
  if (!bom) return <div className="p-6 text-sm text-slate-500">BOM not found.</div>
  const p = product(bom.productId)
  const cost = bomMaterialCost(state, bom)
  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {p && <ProductMark product={p} size="lg" />}
          <div>
            <div className="text-sm text-slate-500">{p?.sku} · Yield {formatQty(bom.outputQty)} {bom.outputUnit}</div>
            <div className="mt-2"><StatusBadge status={bom.status} /></div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => api.setBomStatus(bom.id, bom.status === 'active' ? 'inactive' : 'active')}
          >
            {bom.status === 'active' ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Estimated material cost" value={formatMoney(cost)} />
        <MiniStat label="Cost per unit" value={formatMoney(bom.outputQty ? round2(cost / bom.outputQty) : 0)} />
        <MiniStat label="Expected yield" value={`${formatQty(bom.outputQty)} ${bom.outputUnit}`} />
      </div>
      {bom.notes && <p className="text-sm text-slate-600">{bom.notes}</p>}
      <div className="sf-table-wrap rounded-xl border border-slate-100">
        <table>
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>SKU</th>
              <th>Qty required</th>
              <th>Unit</th>
              <th>Wastage %</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {bom.items.map((item) => {
              const mat = product(item.productId)
              return (
                <tr key={item.id} className="cursor-default">
                  <td className="font-medium">{mat?.name}</td>
                  <td>{mat?.sku}</td>
                  <td className="tabular">{formatQty(item.qty)}</td>
                  <td>{item.unit}</td>
                  <td className="tabular">{item.wastagePct ? `${item.wastagePct}%` : '—'}</td>
                  <td>{item.notes || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <BomModal open={editing} bom={bom} onClose={() => setEditing(false)} />
    </div>
  )
}
