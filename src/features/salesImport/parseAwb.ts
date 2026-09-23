import type { TextItem } from '@/features/salesImport/parsePickingList'

export type ParsedAwbLine = {
  externalProductName: string
  variationText?: string
  externalSku?: string
  quantity: number
  unitPrice?: number
}

export type ParsedAwbShipment = {
  externalOrderId: string
  trackingNumber: string
  courierText: string
  recipientName?: string
  recipientAddress?: string
  serviceText?: string
  lines: ParsedAwbLine[]
}

export type ParsedAwb = {
  layout: 'shopee-awb' | 'numeric-awb' | 'unknown'
  detectedUsername?: string
  identityReliable: boolean
  shipments: ParsedAwbShipment[]
  error?: string
}

const SHOPEE_ORDER = /26\d{4}[A-Z0-9]{8}/
const LONG_ORDER = /\d{18}/
const SPX_TRACK = /SPXMY\d{6,}/
const MY_TRACK = /MY\d{8,}[A-Z]?/
const SHORT_TRACK = /^\d{12,16}$/

type Anchor = { key: string; x: number }

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function rowsOf(items: TextItem[]) {
  const pages = [...new Set(items.map((item) => item.page))].sort((a, b) => a - b)
  const pagesRows: TextItem[][][] = []
  for (const page of pages) {
    const grouped: Array<{ y: number; items: TextItem[] }> = []
    for (const item of items.filter((row) => row.page === page && row.text.trim())) {
      const found = grouped.find((row) => Math.abs(row.y - item.y) <= 4)
      if (found) found.items.push(item)
      else grouped.push({ y: item.y, items: [item] })
    }
    grouped.sort((a, b) => b.y - a.y)
    pagesRows.push(grouped.map((row) => [...row.items].sort((a, b) => a.x - b.x)))
  }
  return pagesRows
}

function rowText(row: TextItem[]) {
  return clean(row.map((item) => item.text).join(' '))
}

function pageText(rows: TextItem[][]) {
  return rows.map(rowText).join('\n')
}

function reliableUsername(value: string) {
  const name = value.trim()
  if (!name || /[*@\s]/.test(name)) return false
  return /^[A-Za-z0-9._-]{3,64}$/.test(name)
}

function identityFrom(pages: TextItem[][][]) {
  for (const rows of pages) {
    for (const row of rows) {
      const text = rowText(row)
      const username = text.match(/Username:\s*(\S+)/i)
      if (username) return { detectedUsername: username[1], identityReliable: reliableUsername(username[1]) }
      const user = text.match(/^User:\s*(.+)$/i)
      if (user) {
        const detectedUsername = user[1].trim()
        return { detectedUsername, identityReliable: reliableUsername(detectedUsername) }
      }
    }
  }
  return { detectedUsername: undefined as string | undefined, identityReliable: false }
}

function detectLayout(pages: TextItem[][][]): ParsedAwb['layout'] {
  const text = pages.map(pageText).join('\n')
  if (SHOPEE_ORDER.test(text) && ((/Packing List/i.test(text) && /Qty/i.test(text)) || /SPXMY|SPX Express|Recipient Details/i.test(text))) return 'shopee-awb'
  if (/Seller SKU/i.test(text) && /Product Name/i.test(text) && LONG_ORDER.test(text)) return 'numeric-awb'
  return 'unknown'
}

function nearest(x: number, anchors: Anchor[]) {
  let best = anchors[0]
  let distance = Infinity
  for (const anchor of anchors) {
    const next = Math.abs(anchor.x - x)
    if (next < distance) {
      best = anchor
      distance = next
    }
  }
  return best
}

function firstOrder(text: string, pattern: RegExp) {
  const match = text.match(pattern)
  return match?.[0] ?? ''
}

function trackingIn(text: string) {
  const spx = text.match(SPX_TRACK)
  if (spx) return spx[0]
  const my = text.match(MY_TRACK)
  if (my) return my[0]
  const tokens = text.split(/\s+/)
  const counts = new Map<string, number>()
  for (const token of tokens) {
    if (!SHORT_TRACK.test(token) || LONG_ORDER.test(token)) continue
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

function courierFrom(text: string) {
  if (/SPXMY|SPX Express/i.test(text)) return 'SPX Express'
  if (/\bInstant\b/i.test(text)) return 'Instant'
  if (/\bAIR\b/.test(text) || /SELF COLLECTION/i.test(text)) return 'AIR'
  if (/\bTT\b/.test(text)) return 'TT'
  return ''
}

function serviceFrom(text: string) {
  const found = [...text.matchAll(/\b(NDD|EZ)\b/g)].map((match) => match[1])
  return [...new Set(found)].join(' / ')
}

function shopeeAnchors(rows: TextItem[][]) {
  const header = rows.find((row) => row.some((item) => item.text === 'Qty') && row.some((item) => /Variation|Parent|SKU/i.test(item.text)))
  if (!header) return []
  const anchors: Anchor[] = []
  const skus = header.filter((item) => item.text === 'SKU')
  for (const item of header) {
    const text = item.text.trim()
    if (text === '#') anchors.push({ key: 'index', x: item.x })
    else if (text === 'Parent') anchors.push({ key: 'parent', x: item.x })
    else if (text === 'Name') anchors.push({ key: 'name', x: item.x })
    else if (/Variation/i.test(text)) anchors.push({ key: 'variation', x: item.x })
    else if (text === 'Qty') anchors.push({ key: 'qty', x: item.x })
    else if (text === 'Price' || text === 'Unit') anchors.push({ key: 'price', x: item.x })
    else if (text === 'Total') anchors.push({ key: 'total', x: item.x })
  }
  const sku = skus.sort((a, b) => a.x - b.x).at(-1)
  if (sku) anchors.push({ key: 'sku', x: sku.x })
  const parentSku = skus.find((item) => item !== sku)
  if (parentSku && !anchors.some((anchor) => anchor.key === 'parent')) anchors.push({ key: 'parent', x: parentSku.x })
  return anchors
}

function shopeePacking(rows: TextItem[][]) {
  const text = pageText(rows)
  if (!/Packing List/i.test(text)) return null
  const orderId = firstOrder(text, SHOPEE_ORDER)
  const anchors = shopeeAnchors(rows)
  const qty = anchors.find((anchor) => anchor.key === 'qty')
  if (!orderId || !qty) return null
  const headerIndex = rows.findIndex((row) => row.some((item) => item.text === 'Qty'))
  const lines: ParsedAwbLine[] = []
  let current: { name: string[]; variation: string[]; sku?: string; quantity?: number; unitPrice?: number } | null = null
  const push = () => {
    if (!current || !(current.quantity && current.quantity > 0)) return
    const name = clean(current.name.join(' '))
      .replace(/^\[?\s*READY\s+STOCK\s*\]?\s*/i, '')
      .replace(/\b26\d{4}[A-Z0-9]{8}\b/g, '')
      .replace(/\bpackage\b/ig, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!name) return
    lines.push({
      externalProductName: name,
      variationText: clean(current.variation.join(' ')) || undefined,
      externalSku: current.sku,
      quantity: current.quantity,
      unitPrice: current.unitPrice,
    })
  }
  for (const row of rows.slice(headerIndex + 1)) {
    const textRow = rowText(row)
    if (/^Buyer/i.test(textRow) || /^Page\b/i.test(textRow) || /Order ID/i.test(textRow) || SHOPEE_ORDER.test(textRow)) break
    const index = row.find((item) => /^\d{1,2}$/.test(item.text) && nearest(item.x, anchors)?.key === 'index' && Math.abs(item.x - (anchors.find((anchor) => anchor.key === 'index')?.x ?? 0)) < 18)
    if (index) {
      push()
      current = { name: [], variation: [] }
    }
    if (!current) continue
    for (const item of row) {
      if (item === index) continue
      const key = nearest(item.x, anchors)?.key
      if (key === 'qty' && /^\d+$/.test(item.text) && Math.abs(item.x - qty.x) < 22) current.quantity = Number(item.text)
      else if (key === 'price' && /^\d+\.\d+$/.test(item.text)) current.unitPrice = Number(item.text)
      else if (key === 'sku' && /^\d{4,}$/.test(item.text)) current.sku = item.text
      else if (key === 'variation' && !/^\d+(?:\.\d+)?$/.test(item.text)) current.variation.push(item.text)
      else if (key === 'name' && !/^\d+(?:\.\d+)?$/.test(item.text)) current.name.push(item.text)
    }
  }
  push()
  return { orderId, lines }
}

function valueAfter(row: TextItem[], label: string) {
  const index = row.findIndex((item) => new RegExp(`^${label}:?$`, 'i').test(item.text) || new RegExp(`^${label}:`, 'i').test(item.text))
  if (index < 0) return ''
  const labeled = row[index]
  const inline = labeled.text.replace(new RegExp(`^${label}:?\\s*`, 'i'), '')
  const rest = row.slice(index + 1).map((item) => item.text)
  return clean([inline, ...rest].filter(Boolean).join(' '))
}

function shopeeLabel(rows: TextItem[][]) {
  const text = pageText(rows)
  if (/Packing List/i.test(text)) return null
  const orderId = firstOrder(text, SHOPEE_ORDER)
  if (!orderId) return null
  const trackingNumber = trackingIn(text)
  const courierText = courierFrom(text)
  let seenRecipient = false
  let recipientName = ''
  let collectingAddress = false
  const address: string[] = []
  for (const row of rows) {
    const rowLabel = rowText(row)
    if (/Recipient Details/i.test(rowLabel)) seenRecipient = true
    if (!seenRecipient) continue
    if (!recipientName && /\bName\b/i.test(rowLabel)) recipientName = valueAfter(row, 'Name')
    if (/^Address/i.test(rowLabel)) {
      collectingAddress = true
      address.push(valueAfter(row, 'Address'))
      continue
    }
    if (collectingAddress && /Postcode|Seller|Buyer|Select|Scan|SPX|Weight|Order|Details/i.test(rowLabel)) break
    if (collectingAddress) address.push(rowLabel)
  }
  return {
    orderId,
    trackingNumber,
    courierText,
    recipientName: recipientName || undefined,
    recipientAddress: clean(address.join(' ')) || undefined,
  }
}

function numericLines(rows: TextItem[][]) {
  const headerIndex = rows.findIndex((row) => row.some((item) => item.text === 'Qty') && row.some((item) => /Product/i.test(item.text)))
  if (headerIndex < 0) return []
  const header = rows[headerIndex]
  const qty = header.find((item) => item.text === 'Qty')
  const seller = header.find((item) => item.text === 'Seller') ?? header.find((item) => /Seller/i.test(item.text))
  const sku = header.filter((item) => item.text === 'SKU').sort((a, b) => a.x - b.x)[0]
  if (!qty) return []
  const lines: ParsedAwbLine[] = []
  let current: ParsedAwbLine | null = null
  for (const row of rows.slice(headerIndex + 1)) {
    const textRow = rowText(row)
    if (/Qty Total/i.test(textRow) || /^Order ID/i.test(textRow)) break
    const qtyItem = row.find((item) => /^\d+$/.test(item.text) && Math.abs(item.x - qty.x) < 24)
    if (qtyItem) {
      if (current) lines.push(current)
      const name = row.filter((item) => item.x < (sku?.x ?? qty.x) - 8 && item !== qtyItem).map((item) => item.text)
      const variation = seller ? row.filter((item) => item.x >= (sku?.x ?? 0) - 4 && item.x < qty.x - 8 && item !== qtyItem).map((item) => item.text) : []
      current = {
        externalProductName: clean(name.join(' ')),
        variationText: clean(variation.join(' ')) || undefined,
        quantity: Number(qtyItem.text),
      }
      continue
    }
    if (!current) continue
    const extra = row.filter((item) => item.x < (sku?.x ?? qty.x) - 8).map((item) => item.text)
    if (extra.length) current.externalProductName = clean(`${current.externalProductName} ${extra.join(' ')}`)
  }
  if (current?.externalProductName) lines.push(current)
  return lines.filter((line) => line.quantity > 0 && line.externalProductName)
}

function numericPage(rows: TextItem[][]) {
  const text = pageText(rows)
  const orderId = firstOrder(text, LONG_ORDER)
  if (!orderId) return null
  let recipientName = ''
  const address: string[] = []
  let afterReceiver = false
  for (const row of rows) {
    const label = rowText(row)
    if (/^Receiver\b/i.test(label)) {
      recipientName = valueAfter(row, 'Receiver')
      afterReceiver = true
      continue
    }
    if (afterReceiver && !/Product Name|PICK-UP|Order Created|Estimated|Scan me|Self Collect/i.test(label)) {
      if (/^\d{12,}$/.test(label)) break
      address.push(label)
      if (address.length > 4) break
    }
  }
  return {
    externalOrderId: orderId,
    trackingNumber: trackingIn(text),
    courierText: courierFrom(text),
    recipientName: recipientName || undefined,
    recipientAddress: clean(address.join(' ')) || undefined,
    serviceText: serviceFrom(text) || undefined,
    lines: numericLines(rows),
  }
}

function mergeShipment(current: ParsedAwbShipment | undefined, next: ParsedAwbShipment): ParsedAwbShipment[] {
  if (!current) return [next]
  const tracking = current.trackingNumber && next.trackingNumber && current.trackingNumber !== next.trackingNumber
  if (tracking) return [current, { ...next, lines: next.lines.length ? next.lines : current.lines }]
  return [{
    ...current,
    trackingNumber: current.trackingNumber || next.trackingNumber,
    courierText: current.courierText || next.courierText,
    recipientName: current.recipientName || next.recipientName,
    recipientAddress: current.recipientAddress || next.recipientAddress,
    serviceText: current.serviceText || next.serviceText,
    lines: [...current.lines, ...next.lines],
  }]
}

export function parseAwb(items: TextItem[]): ParsedAwb {
  const pages = rowsOf(items ?? [])
  const identity = identityFrom(pages)
  const layout = detectLayout(pages)
  if (layout === 'unknown') {
    return { layout, ...identity, shipments: [], error: 'This PDF is not a recognised AWB layout.' }
  }
  const grouped = new Map<string, ParsedAwbShipment[]>()
  const add = (shipment: ParsedAwbShipment) => {
    if (!shipment.externalOrderId) return
    const existing = grouped.get(shipment.externalOrderId) ?? []
    const base = existing.length === 1 ? existing[0] : undefined
    grouped.set(shipment.externalOrderId, existing.length > 1 ? [...existing, shipment] : mergeShipment(base, shipment))
  }
  for (const rows of pages) {
    if (layout === 'shopee-awb') {
      const packing = shopeePacking(rows)
      if (packing) add({ externalOrderId: packing.orderId, trackingNumber: '', courierText: '', lines: packing.lines })
      const label = shopeeLabel(rows)
      if (label) {
        add({
          externalOrderId: label.orderId,
          trackingNumber: label.trackingNumber,
          courierText: label.courierText,
          recipientName: label.recipientName,
          recipientAddress: label.recipientAddress,
          lines: [],
        })
      }
    } else {
      const page = numericPage(rows)
      if (page) add(page)
    }
  }
  const shipments = [...grouped.values()].flat().filter((shipment) => shipment.externalOrderId)
  if (!shipments.length) {
    return { layout, ...identity, shipments: [], error: 'No AWB orders could be read from this PDF.' }
  }
  return { layout, ...identity, shipments }
}
