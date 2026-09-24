export type TextItem = { text: string; x: number; y: number; page: number }

export type ParsedPickingLine = {
  externalProductName: string
  variationText?: string
  parentSku?: string
  externalSku?: string
  quantity: number
  orderIds: string[]
}

export type ParsedPicking = {
  layout: 'shopee-picklist' | 'numeric-picklist' | 'unknown'
  detectedUsername?: string
  identityReliable: boolean
  lines: ParsedPickingLine[]
  customerMessages: { orderId: string; message: string }[]
  warnings: string[]
  error?: string
}

const SHOPEE_ORDER = /26\d{4}[A-Z0-9]{8}/g
const LONG_ORDER = /\d{18}/g

type Anchor = { key: string; x: number }

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function rowsOf(items: TextItem[]) {
  const pages = [...new Set(items.map((item) => item.page))].sort((a, b) => a - b)
  const rows: TextItem[][] = []
  for (const page of pages) {
    const pageItems = items.filter((item) => item.page === page && item.text.trim())
    const grouped: Array<{ y: number; items: TextItem[] }> = []
    for (const item of pageItems) {
      const found = grouped.find((row) => Math.abs(row.y - item.y) <= 4)
      if (found) found.items.push(item)
      else grouped.push({ y: item.y, items: [item] })
    }
    grouped.sort((a, b) => b.y - a.y)
    for (const row of grouped) rows.push([...row.items].sort((a, b) => a.x - b.x))
  }
  return rows
}

function rowText(row: TextItem[]) {
  return clean(row.map((item) => item.text).join(' '))
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
  return best?.key ?? ''
}

function reliableUsername(value: string) {
  const name = value.trim()
  if (!name || /[*@\s]/.test(name)) return false
  return /^[A-Za-z0-9._-]{3,64}$/.test(name)
}

function identityFrom(rows: TextItem[][]) {
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
  return { detectedUsername: undefined, identityReliable: false }
}

function detectLayout(rows: TextItem[][]): ParsedPicking['layout'] {
  const text = rows.map(rowText).join('\n')
  if (/Picking List/i.test(text) && /Seller SKU/i.test(text) && /Order quantity/i.test(text)) return 'numeric-picklist'
  if (/Picklist/i.test(text) && /Parent SKU/i.test(text) && /Username:/i.test(text)) return 'shopee-picklist'
  return 'unknown'
}

function shopeeAnchors(header: TextItem[]): Anchor[] {
  const anchors: Anchor[] = []
  for (const item of header) {
    const text = item.text.trim()
    if (text === '#') anchors.push({ key: 'index', x: item.x })
    else if (/Parent SKU/i.test(text)) anchors.push({ key: 'parent', x: item.x })
    else if (text === 'Name') anchors.push({ key: 'name', x: item.x })
    else if (text === 'SKU') anchors.push({ key: 'sku', x: item.x })
    else if (/Variation/i.test(text)) anchors.push({ key: 'variation', x: item.x })
    else if (text === 'Qty') anchors.push({ key: 'qty', x: item.x })
    else if (/Order ID/i.test(text)) anchors.push({ key: 'order', x: item.x })
    else if (/Location/i.test(text)) anchors.push({ key: 'location', x: item.x })
  }
  return anchors
}

function orderIdsIn(text: string) {
  return [...text.toUpperCase().matchAll(SHOPEE_ORDER)].map((match) => match[0])
}

function ignoreOrderToken(text: string) {
  const value = text.trim().toLowerCase()
  return value === 'package' || value === 'package 1' || value === '1'
}

type ShopeePart = {
  name: string[]
  variation: string[]
  parentSku?: string
  sku?: string
  qty?: number
  orderIds: string[]
}

function readShopeeRow(row: TextItem[], anchors: Anchor[]): ShopeePart {
  const part: ShopeePart = { name: [], variation: [], orderIds: [] }
  let qty: number | undefined
  const variationBits: string[] = []
  for (const item of row) {
    const column = nearest(item.x, anchors)
    const text = clean(item.text)
    if (!text || text.toLowerCase() === 'image') continue
    if (column === 'index') continue
    if (column === 'name') {
      part.name.push(text)
      continue
    }
    if (column === 'parent' && /^[A-Za-z0-9][A-Za-z0-9-]{2,}$/.test(text)) {
      part.parentSku = text
      continue
    }
    if (column === 'sku' && /^[A-Za-z0-9][A-Za-z0-9-]{2,}$/.test(text)) {
      part.sku = text
      continue
    }
    if (column === 'qty' && /^\d{1,5}$/.test(text)) {
      qty = Number(text)
      continue
    }
    if (column === 'order' || column === 'location') {
      if (ignoreOrderToken(text)) continue
      part.orderIds.push(...orderIdsIn(text))
      continue
    }
    if (column === 'variation') variationBits.push(text)
  }
  let variation = clean(variationBits.join(' '))
  if (qty == null && variation) {
    const trailing = variation.match(/^(.*\D)\s+(\d{1,5})$/)
    if (trailing) {
      variation = clean(trailing[1])
      qty = Number(trailing[2])
    }
  }
  if (variation) part.variation.push(variation)
  if (qty != null && qty > 0) part.qty = qty
  part.orderIds = [...new Set(part.orderIds)]
  return part
}

type Seg = { variation: string[]; sku?: string; qty?: number; orderIds: string[] }

function linesFromShopee(rows: TextItem[][], anchors: Anchor[]): ParsedPickingLine[] {
  const blocks: TextItem[][][] = []
  let block: TextItem[][] | null = null
  for (const row of rows) {
    if (/Parent SKU/i.test(rowText(row)) && /Qty/.test(rowText(row))) continue
    const indexItem = row.find((item) => nearest(item.x, anchors) === 'index' && /^\d{1,3}$/.test(item.text.trim()))
    if (indexItem) {
      block = [row]
      blocks.push(block)
    } else if (block) block.push(row)
  }
  const lines: ParsedPickingLine[] = []
  for (const group of blocks) {
    const nameParts: string[] = []
    let parentSku = ''
    const segs: Seg[] = []
    let seg: Seg | null = null
    // One Order ID printed on the first variation of a # group also covers later qty rows that omit it.
    let carryOrderId = ''
    const push = () => {
      if (seg && seg.qty && seg.qty > 0) {
        if (!seg.orderIds.length && carryOrderId) seg.orderIds = [carryOrderId]
        segs.push(seg)
        carryOrderId = seg.orderIds.length === 1 ? seg.orderIds[0] : ''
      }
      seg = null
    }
    for (const row of group) {
      const part = readShopeeRow(row, anchors)
      nameParts.push(...part.name)
      if (part.parentSku) parentSku = part.parentSku
      const payload = part.qty != null || part.variation.length > 0 || Boolean(part.sku) || part.orderIds.length > 0
      if (!payload) continue
      if (part.qty != null && (seg == null || seg.qty != null)) {
        push()
        seg = { variation: [...part.variation], sku: part.sku, qty: part.qty, orderIds: [...part.orderIds] }
        continue
      }
      if (!seg) {
        seg = { variation: [...part.variation], sku: part.sku, qty: part.qty, orderIds: [...part.orderIds] }
        continue
      }
      seg.variation.push(...part.variation)
      if (part.sku && !seg.sku) seg.sku = part.sku
      if (part.qty != null && seg.qty == null) seg.qty = part.qty
      for (const id of part.orderIds) if (!seg.orderIds.includes(id)) seg.orderIds.push(id)
    }
    push()
    const externalProductName = clean(nameParts.join(' '))
    for (const item of segs) {
      lines.push({
        externalProductName,
        variationText: clean(item.variation.join(' ')) || undefined,
        parentSku: parentSku || undefined,
        externalSku: item.sku || undefined,
        quantity: item.qty ?? 0,
        orderIds: item.orderIds,
      })
    }
  }
  return lines
}

function numericAnchors(header: TextItem[]): Anchor[] {
  const anchors: Anchor[] = []
  for (const item of header) {
    const text = item.text.trim()
    if (text === 'No') anchors.push({ key: 'index', x: item.x })
    else if (/Product name/i.test(text)) anchors.push({ key: 'name', x: item.x })
    else if (text === 'SKU') anchors.push({ key: 'sku', x: item.x })
    else if (/Seller SKU/i.test(text)) anchors.push({ key: 'seller', x: item.x })
    else if (text === 'Qty') anchors.push({ key: 'qty', x: item.x })
    else if (/Order ID/i.test(text)) anchors.push({ key: 'order', x: item.x })
  }
  return anchors
}

function clusterZone(items: TextItem[]) {
  const sorted = [...items].sort((a, b) => a.x - b.x)
  const groups: TextItem[][] = []
  for (const item of sorted) {
    const last = groups[groups.length - 1]
    const prev = last?.[last.length - 1]
    if (!last || !prev || item.x - prev.x > 45) groups.push([item])
    else last.push(item)
  }
  return groups.map((group) => clean(group.map((item) => item.text).join(' '))).filter(Boolean)
}

function linesFromNumeric(rows: TextItem[][], anchors: Anchor[]) {
  const skuX = anchors.find((anchor) => anchor.key === 'sku')?.x ?? 260
  const qtyX = anchors.find((anchor) => anchor.key === 'qty')?.x ?? 400
  const messages: { orderId: string; message: string }[] = []
  const items: Array<{ name: string; variation?: string; sku?: string; quantity: number; orderIds: string[] }> = []
  let nameParts: string[] = []
  let segs: Array<{ variation?: string; sku?: string; quantity: number; orderIds: string[] }> = []
  const close = () => {
    const name = clean(nameParts.join(' '))
    for (const seg of segs) {
      if (!(seg.quantity > 0)) continue
      items.push({ name, variation: seg.variation, sku: seg.sku, quantity: seg.quantity, orderIds: seg.orderIds })
    }
    nameParts = []
    segs = []
  }
  let messageRows: TextItem[][] = []
  let inMessage = false
  for (const row of rows) {
    const text = rowText(row)
    if (/^Order ID:/i.test(text) || /^Customer message:/i.test(text)) {
      inMessage = true
      messageRows.push(row)
      continue
    }
    if (inMessage) {
      messageRows.push(row)
      continue
    }
    const index = row.find((item) => nearest(item.x, anchors) === 'index' && /^\d{1,3}$/.test(item.text.trim()))
    const name = clean(row.filter((item) => item.x < skuX - 8 && nearest(item.x, anchors) !== 'index').map((item) => item.text).join(' '))
    const zone = clusterZone(row.filter((item) => item.x >= skuX - 8 && item.x < qtyX - 12))
    let variation = ''
    let sku = ''
    if (zone.length >= 2) {
      const left = zone[0]
      const right = clean(zone.slice(1).join(' '))
      if (/^\d{4,}$/.test(left)) sku = left
      else if (left) nameParts.push(left)
      variation = right
    } else if (zone.length === 1) {
      if (/^\d{4,}$/.test(zone[0])) sku = zone[0]
      else variation = zone[0]
    }
    const qtyItem = row.find((item) => nearest(item.x, anchors) === 'qty' && /^\d{1,5}$/.test(item.text.trim()))
    const qty = qtyItem ? Number(qtyItem.text.trim()) : undefined
    const orderIds = [...new Set(row.flatMap((item) => [...item.text.matchAll(LONG_ORDER)].map((match) => match[0])))]
    if (index) {
      close()
      if (name) nameParts.push(name)
    } else if (name) nameParts.push(name)
    if (qty != null && qty > 0) {
      segs.push({ variation: variation || undefined, sku: sku || undefined, quantity: qty, orderIds })
    } else if (variation && segs.length) {
      const last = segs[segs.length - 1]
      last.variation = clean(`${last.variation ?? ''} ${variation}`)
      if (sku && !last.sku) last.sku = sku
      for (const id of orderIds) if (!last.orderIds.includes(id)) last.orderIds.push(id)
    }
  }
  close()
  if (messageRows.length) {
    const blob = messageRows.map(rowText).join(' ')
    const orderId = blob.match(/Order ID:\s*(\d{16,20})/i)?.[1] ?? ''
    const message = clean(blob.replace(/^.*?Customer message:\s*/i, ''))
    if (orderId && message) messages.push({ orderId, message })
  }
  return {
    lines: items.map((item) => ({
      externalProductName: item.name,
      variationText: item.variation,
      externalSku: item.sku,
      quantity: item.quantity,
      orderIds: item.orderIds,
    })),
    customerMessages: messages,
  }
}

function warningsFor(lines: ParsedPickingLine[]) {
  return lines
    .filter((line) => !line.orderIds.length)
    .map((line) => {
      const label = clean(`${line.externalProductName} ${line.variationText ?? ''} ${line.externalSku ?? ''}`)
      return `${label} × ${line.quantity} has no Order ID`
    })
}

export function parsePickingList(items: TextItem[]): ParsedPicking {
  const rows = rowsOf(items)
  if (!rows.length) {
    return { layout: 'unknown', identityReliable: false, lines: [], customerMessages: [], warnings: [], error: 'This PDF has no readable text.' }
  }
  const layout = detectLayout(rows)
  const identity = identityFrom(rows)
  if (layout === 'unknown') {
    return {
      layout,
      ...identity,
      lines: [],
      customerMessages: [],
      warnings: [],
      error: 'Unrecognised picking list layout. Sales Import only reads supported picking lists.',
    }
  }
  if (layout === 'shopee-picklist') {
    const header = rows.find((row) => /Parent SKU/i.test(rowText(row)) && /\bQty\b/.test(rowText(row)) && /Order ID/i.test(rowText(row)))
    const anchors = header ? shopeeAnchors(header) : []
    if (!header || !anchors.some((anchor) => anchor.key === 'qty') || !anchors.some((anchor) => anchor.key === 'order')) {
      return { layout, ...identity, lines: [], customerMessages: [], warnings: [], error: 'Picking list header was not found.' }
    }
    const body = rows.slice(rows.indexOf(header) + 1)
    const lines = linesFromShopee(body, anchors)
    if (!lines.length) return { layout, ...identity, lines: [], customerMessages: [], warnings: [], error: 'No picking rows were found.' }
    return { layout, ...identity, lines, customerMessages: [], warnings: warningsFor(lines) }
  }
  const header = rows.find((row) => /Seller SKU/i.test(rowText(row)) && /\bQty\b/.test(rowText(row)) && /Order ID/i.test(rowText(row)))
  const anchors = header ? numericAnchors(header) : []
  if (!header || anchors.length < 4) {
    return { layout, ...identity, lines: [], customerMessages: [], warnings: [], error: 'Picking list header was not found.' }
  }
  const body = rows.slice(rows.indexOf(header) + 1)
  const parsed = linesFromNumeric(body, anchors)
  if (!parsed.lines.length) return { layout, ...identity, lines: [], customerMessages: [], warnings: [], error: 'No picking rows were found.' }
  return { layout, ...identity, lines: parsed.lines, customerMessages: parsed.customerMessages, warnings: warningsFor(parsed.lines) }
}
