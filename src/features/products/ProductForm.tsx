import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, Field, Input, Select } from '@/components/ui'
import { activeBomForProduct, baseUnitCost, baseUnitOptions, formatUnit, unitOptions, unitsEqual, validatePurchaseConversion } from '@/features/products/masterData'
import { useStore } from '@/store/hooks'
import { formatMoney, round2 } from '@/utils/format'
import type { Product, ProductInput, ProductStatus } from '@/types'

export type ProductFormValue = {
  name: string
  sku: string
  categoryId: string
  unit: string
  purchaseUnit: string
  purchaseConversionQty: number | ''
  purchaseCost: number | ''
  costPrice: number | ''
  sellingPrice: number | ''
  status: ProductStatus
}

export function emptyProductForm(categoryId: string, material = false): ProductFormValue {
  return {
    name: '',
    sku: '',
    categoryId,
    unit: material ? 'KG' : 'PCS',
    purchaseUnit: material ? 'BAG' : 'PCS',
    purchaseConversionQty: material ? 25 : 1,
    purchaseCost: '',
    costPrice: '',
    sellingPrice: '',
    status: 'active',
  }
}

export function formFromProduct(product: Product): ProductFormValue {
  return {
    name: product.name,
    sku: product.sku,
    categoryId: product.categoryId,
    unit: product.unit,
    purchaseUnit: product.purchaseUnit ?? product.unit,
    purchaseConversionQty: product.purchaseConversionQty ?? 1,
    purchaseCost: product.purchaseCost ?? product.costPrice,
    costPrice: product.costPrice,
    sellingPrice: product.sellingPrice,
    status: product.status,
  }
}

export function toProductInput(form: ProductFormValue, material: boolean): ProductInput {
  const conversion = Number(form.purchaseConversionQty || 1)
  const purchaseCost = form.purchaseCost === '' ? Number(form.costPrice || 0) : Number(form.purchaseCost)
  const costPrice = form.costPrice === '' ? purchaseCost : Number(form.costPrice)
  return {
    name: form.name,
    sku: form.sku,
    barcode: '',
    categoryId: form.categoryId,
    unit: form.unit,
    purchaseUnit: form.purchaseUnit,
    purchaseConversionQty: conversion,
    ...(material ? { purchaseCost } : { costPrice }),
    sellingPrice: form.sellingPrice === '' ? 0 : Number(form.sellingPrice),
    wholesalePrice: 0,
    status: form.status,
    reorderLevel: 0,
    trackBatch: false,
    trackExpiry: false,
  }
}

export function ProductForm({
  product,
  material = false,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  product?: Product
  material?: boolean
  submitLabel: string
  onSubmit: (input: ProductInput) => boolean | void
  onCancel: () => void
}) {
  const state = useStore()
  const defaultCategory = material
    ? state.categories.find((row) => row.id === 'cat-ing')?.id ?? state.categories[0]?.id ?? ''
    : state.categories[0]?.id ?? ''
  const [form, setForm] = useState<ProductFormValue>(product ? formFromProduct(product) : emptyProductForm(defaultCategory, material))

  useEffect(() => {
    setForm(product ? formFromProduct(product) : emptyProductForm(defaultCategory, material))
  }, [product?.id, material, defaultCategory])

  const bom = product ? activeBomForProduct(state.boms, product.id) : undefined
  const hasBom = Boolean(bom)
  const sameUnits = unitsEqual(form.unit, form.purchaseUnit)
  const conversion = sameUnits ? 1 : Number(form.purchaseConversionQty || 0)
  const purchaseCost = Number(form.purchaseCost === '' ? 0 : form.purchaseCost)
  const calculatedBase = conversion > 0 ? round2(purchaseCost / conversion) : 0
  const conversionCheck = validatePurchaseConversion({
    baseUnit: form.unit,
    purchaseUnit: form.purchaseUnit,
    conversionQty: sameUnits ? 1 : form.purchaseConversionQty,
  })

  const previewProduct = useMemo(
    () => ({
      unit: form.unit,
      purchaseUnit: form.purchaseUnit,
      purchaseConversionQty: conversion,
      purchaseCost,
      costPrice: calculatedBase,
    }),
    [form.unit, form.purchaseUnit, conversion, purchaseCost, calculatedBase],
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const ok = onSubmit(toProductInput(form, material || hasBom))
    if (ok !== false) return
  }

  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
      <Field label={material ? 'Raw material name' : 'Product name'} className="sm:col-span-2">
        <Input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      </Field>
      <Field label="SKU" hint="Leave empty to auto-generate a 6-digit SKU.">
        <Input
          value={form.sku}
          onChange={(event) => setForm({ ...form, sku: event.target.value })}
          placeholder="Auto-generated 6-digit SKU"
        />
      </Field>
      <Field label="Category">
        <Select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
          {state.categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Base unit">
        <Select value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value, purchaseUnit: sameUnits ? event.target.value : form.purchaseUnit })}>
          {(material ? unitOptions(form.unit) : baseUnitOptions(form.unit)).map((unit) => (
            <option key={unit} value={unit}>{unit}</option>
          ))}
        </Select>
      </Field>
      {material && (
        <>
          <Field label="Purchase unit">
            <Select value={form.purchaseUnit} onChange={(event) => setForm({ ...form, purchaseUnit: event.target.value })}>
              {unitOptions(form.purchaseUnit).map((unit) => (
                <option key={unit} value={unit}>{unit}</option>
              ))}
            </Select>
          </Field>
          <Field
            label={`1 ${formatUnit(form.purchaseUnit) || 'purchase unit'} =`}
            hint={sameUnits ? 'Same as base unit · 1:1' : `Converted into ${formatUnit(form.unit) || 'base unit'}`}
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={sameUnits ? 1 : 0.000001}
                step="any"
                disabled={sameUnits}
                value={sameUnits ? 1 : form.purchaseConversionQty}
                onChange={(event) => setForm({ ...form, purchaseConversionQty: event.target.value === '' ? '' : Number(event.target.value) })}
              />
              <span className="shrink-0 text-sm text-slate-500">{formatUnit(form.unit)}</span>
            </div>
          </Field>
          <Field label="Purchase cost" hint={`Per ${formatUnit(form.purchaseUnit) || 'purchase unit'}`}>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.purchaseCost}
              onChange={(event) => setForm({ ...form, purchaseCost: event.target.value === '' ? '' : Number(event.target.value) })}
            />
          </Field>
          <Field label="Calculated base cost">
            <Input disabled value={conversionCheck.ok ? `${formatMoney(baseUnitCost(previewProduct))} / ${formatUnit(form.unit)}` : 'Invalid conversion'} />
          </Field>
        </>
      )}
      {!material && (
        <>
          <Field
            label="Cost price"
            hint={hasBom ? `Calculated from BOM${bom ? ` · ${bom.name}` : ''}` : 'Manual cost in base unit'}
          >
            <Input
              type="number"
              min={0}
              step="0.01"
              disabled={hasBom}
              value={hasBom ? product?.costPrice ?? 0 : form.costPrice}
              onChange={(event) => setForm({ ...form, costPrice: event.target.value === '' ? '' : Number(event.target.value) })}
            />
          </Field>
          <Field label="Selling price">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.sellingPrice}
              onChange={(event) => setForm({ ...form, sellingPrice: event.target.value === '' ? '' : Number(event.target.value) })}
            />
          </Field>
        </>
      )}
      <Field label="Status">
        <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ProductStatus })}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      </Field>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  )
}

