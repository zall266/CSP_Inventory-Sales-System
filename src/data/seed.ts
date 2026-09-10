import type {
  AppData,
  Batch,
  Bom,
  Expense,
  InventoryRow,
  LineItem,
  MovementType,
  Payment,
  PaymentMethod,
  Product,
  ProductionConsumption,
  ProductionOrder,
  Purchase,
  RoleMatrix,
  Sale,
  StockMovement,
} from '@/types'
import { PROTOTYPE_TODAY, round2, uid } from '@/utils/format'

const iso = (month: number, day: number, hour = 10) =>
  `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:15:00+08:00`

const defaultRoleMatrix: RoleMatrix = {
  owner: {
    dashboard: true,
    pos: true,
    create_sale: true,
    void_sale: true,
    create_purchase: true,
    adjust_stock: true,
    transfer_stock: true,
    view_reports: true,
    manage_settings: true,
    manage_users: true,
    create_production: true,
  },
  admin: {
    dashboard: true,
    pos: true,
    create_sale: true,
    void_sale: true,
    create_purchase: true,
    adjust_stock: true,
    transfer_stock: true,
    view_reports: true,
    manage_settings: true,
    manage_users: true,
    create_production: true,
  },
  manager: {
    dashboard: true,
    pos: true,
    create_sale: true,
    void_sale: true,
    create_purchase: true,
    adjust_stock: true,
    transfer_stock: true,
    view_reports: true,
    manage_settings: false,
    manage_users: false,
    create_production: true,
  },
  staff: {
    dashboard: true,
    pos: true,
    create_sale: true,
    void_sale: false,
    create_purchase: false,
    adjust_stock: false,
    transfer_stock: false,
    view_reports: true,
    manage_settings: false,
    manage_users: false,
    create_production: false,
  },
  cashier: {
    dashboard: false,
    pos: true,
    create_sale: true,
    void_sale: false,
    create_purchase: false,
    adjust_stock: false,
    transfer_stock: false,
    view_reports: false,
    manage_settings: false,
    manage_users: false,
    create_production: false,
  },
  warehouse: {
    dashboard: true,
    pos: false,
    create_sale: false,
    void_sale: false,
    create_purchase: true,
    adjust_stock: true,
    transfer_stock: true,
    view_reports: false,
    manage_settings: false,
    manage_users: false,
    create_production: true,
  },
}

function line(product: Product, qty: number, price = product.sellingPrice, discount = 0): LineItem {
  const total = round2(qty * price - discount)
  return { productId: product.id, qty, price, discount, total, returnedQty: 0 }
}

function totals(items: LineItem[], extra?: { discount?: number; tax?: number; shipping?: number }) {
  const subtotal = round2(items.reduce((sum, item) => sum + item.total, 0))
  const discount = extra?.discount ?? 0
  const tax = extra?.tax ?? 0
  const shipping = extra?.shipping ?? 0
  const total = round2(subtotal - discount + tax + shipping)
  return { subtotal, discount, tax, shipping, total }
}

export function createSeedData(): AppData {
  const warehouses = [
    { id: 'wh-main', name: 'Main Warehouse', code: 'MAIN' },
    { id: 'wh-shop', name: 'Shop', code: 'SHOP' },
    { id: 'wh-outlet', name: 'Outlet 1', code: 'OUT1' },
  ]

  const categories = [
    { id: 'cat-air', name: 'Air Balang' },
    { id: 'cat-ice', name: 'Ice Blended' },
    { id: 'cat-waffle', name: 'Waffle' },
    { id: 'cat-ing', name: 'Ingredients' },
    { id: 'cat-pack', name: 'Packaging' },
    { id: 'cat-other', name: 'Others' },
  ]

  const products: Product[] = [
    { id: 'p-cp', name: 'Chocolate Powder', sku: 'CP001', barcode: '9550001000018', categoryId: 'cat-ing', unit: 'KG', costPrice: 22, sellingPrice: 35, wholesalePrice: 30, reorderLevel: 20, trackBatch: true, trackExpiry: false, status: 'active', accent: '#7C4A1E' },
    { id: 'p-mt', name: 'Matcha Powder', sku: 'MT001', barcode: '9550001000025', categoryId: 'cat-ing', unit: 'KG', costPrice: 35, sellingPrice: 55, wholesalePrice: 48, reorderLevel: 15, trackBatch: true, trackExpiry: false, status: 'active', accent: '#3F6B3A' },
    { id: 'p-st', name: 'Strawberry Powder', sku: 'ST001', barcode: '9550001000032', categoryId: 'cat-ing', unit: 'KG', costPrice: 28, sellingPrice: 45, wholesalePrice: 39, reorderLevel: 15, trackBatch: true, trackExpiry: false, status: 'active', accent: '#C45C6A' },
    { id: 'p-wf', name: 'Waffle Premix', sku: 'WF001', barcode: '9550001000049', categoryId: 'cat-waffle', unit: 'KG', costPrice: 18, sellingPrice: 32, wholesalePrice: 26, reorderLevel: 25, trackBatch: false, trackExpiry: false, status: 'active', accent: '#C9852A' },
    { id: 'p-pw', name: 'Pandan Waffle Premix', sku: 'PW001', barcode: '9550001000056', categoryId: 'cat-waffle', unit: 'KG', costPrice: 19, sellingPrice: 34, wholesalePrice: 28, reorderLevel: 20, trackBatch: false, trackExpiry: false, status: 'active', accent: '#5B8A3A' },
    { id: 'p-cs', name: 'Chocolate Syrup', sku: 'CS001', barcode: '9550001000063', categoryId: 'cat-ing', unit: 'bottle', costPrice: 8, sellingPrice: 15, wholesalePrice: 12, reorderLevel: 12, trackBatch: false, trackExpiry: true, status: 'active', accent: '#5C3317' },
    { id: 'p-vs', name: 'Vanilla Syrup', sku: 'VS001', barcode: '9550001000070', categoryId: 'cat-ing', unit: 'bottle', costPrice: 8, sellingPrice: 15, wholesalePrice: 12, reorderLevel: 12, trackBatch: false, trackExpiry: true, status: 'active', accent: '#C4B48A' },
    { id: 'p-pc', name: 'Plastic Cup', sku: 'PC001', barcode: '9550001000087', categoryId: 'cat-pack', unit: 'pcs', costPrice: 0.15, sellingPrice: 0.4, wholesalePrice: 0.28, reorderLevel: 500, trackBatch: false, trackExpiry: false, status: 'active', accent: '#64748B' },
    { id: 'p-cl', name: 'Cup Lid', sku: 'CL001', barcode: '9550001000094', categoryId: 'cat-pack', unit: 'pcs', costPrice: 0.08, sellingPrice: 0.2, wholesalePrice: 0.14, reorderLevel: 500, trackBatch: false, trackExpiry: false, status: 'active', accent: '#94A3B8' },
    { id: 'p-ib', name: 'Ice Blended Powder', sku: 'IB001', barcode: '9550001000100', categoryId: 'cat-ice', unit: 'KG', costPrice: 16, sellingPrice: 28, wholesalePrice: 24, reorderLevel: 20, trackBatch: true, trackExpiry: false, status: 'active', accent: '#4C7C8C' },
    { id: 'p-ab', name: 'Air Balang Premix', sku: 'AB001', barcode: '9550001000117', categoryId: 'cat-air', unit: 'KG', costPrice: 14, sellingPrice: 24, wholesalePrice: 20, reorderLevel: 18, trackBatch: true, trackExpiry: false, status: 'active', accent: '#2563EB' },
    { id: 'p-bd', name: 'Bandung Syrup', sku: 'BD001', barcode: '9550001000124', categoryId: 'cat-air', unit: 'bottle', costPrice: 7.5, sellingPrice: 14, wholesalePrice: 11, reorderLevel: 10, trackBatch: false, trackExpiry: true, status: 'active', accent: '#BE185D' },
    { id: 'p-ml', name: 'Milo Powder', sku: 'ML001', barcode: '9550001000131', categoryId: 'cat-ing', unit: 'KG', costPrice: 24, sellingPrice: 38, wholesalePrice: 33, reorderLevel: 15, trackBatch: true, trackExpiry: false, status: 'active', accent: '#92400E' },
    { id: 'p-cf', name: 'Coffee Powder', sku: 'CF001', barcode: '9550001000148', categoryId: 'cat-ing', unit: 'KG', costPrice: 30, sellingPrice: 48, wholesalePrice: 42, reorderLevel: 12, trackBatch: true, trackExpiry: false, status: 'active', accent: '#44403C' },
    { id: 'p-cm', name: 'Condensed Milk', sku: 'CM001', barcode: '9550001000155', categoryId: 'cat-ing', unit: 'tin', costPrice: 4.8, sellingPrice: 7.5, wholesalePrice: 6.2, reorderLevel: 24, trackBatch: false, trackExpiry: true, status: 'active', accent: '#F1E4C8' },
    { id: 'p-tp', name: 'Tapioca Pearls', sku: 'TP001', barcode: '9550001000162', categoryId: 'cat-ice', unit: 'KG', costPrice: 9, sellingPrice: 16, wholesalePrice: 13, reorderLevel: 10, trackBatch: false, trackExpiry: false, status: 'active', accent: '#1C1917' },
    { id: 'p-pb', name: 'Paper Bag', sku: 'PB001', barcode: '9550001000179', categoryId: 'cat-pack', unit: 'pcs', costPrice: 0.22, sellingPrice: 0.5, wholesalePrice: 0.35, reorderLevel: 300, trackBatch: false, trackExpiry: false, status: 'active', accent: '#D6B48A' },
    { id: 'p-sw', name: 'Straw', sku: 'SW001', barcode: '9550001000186', categoryId: 'cat-pack', unit: 'pcs', costPrice: 0.04, sellingPrice: 0.1, wholesalePrice: 0.07, reorderLevel: 800, trackBatch: false, trackExpiry: false, status: 'active', accent: '#0EA5E9' },
    { id: 'p-pp', name: 'Pandan Paste', sku: 'PP001', barcode: '9550001000193', categoryId: 'cat-other', unit: 'bottle', costPrice: 6.5, sellingPrice: 12, wholesalePrice: 10, reorderLevel: 8, trackBatch: false, trackExpiry: true, status: 'active', accent: '#166534' },
    { id: 'p-hn', name: 'Honey', sku: 'HN001', barcode: '9550001000209', categoryId: 'cat-other', unit: 'bottle', costPrice: 11, sellingPrice: 18, wholesalePrice: 15, reorderLevel: 8, trackBatch: false, trackExpiry: true, status: 'active', accent: '#D97706' },
    { id: 'p-cocoa', name: 'Cocoa Powder', sku: 'RW-CC001', barcode: '9550001000308', categoryId: 'cat-ing', unit: 'KG', costPrice: 18, sellingPrice: 28, wholesalePrice: 24, reorderLevel: 25, trackBatch: true, trackExpiry: false, status: 'active', accent: '#4A2C14' },
    { id: 'p-milkpw', name: 'Milk Powder', sku: 'RW-MK001', barcode: '9550001000315', categoryId: 'cat-ing', unit: 'KG', costPrice: 16, sellingPrice: 24, wholesalePrice: 21, reorderLevel: 20, trackBatch: true, trackExpiry: true, status: 'active', accent: '#E7E0D0' },
    { id: 'p-sugar', name: 'Sugar', sku: 'RW-SG001', barcode: '9550001000322', categoryId: 'cat-ing', unit: 'KG', costPrice: 3.5, sellingPrice: 6, wholesalePrice: 5, reorderLevel: 40, trackBatch: false, trackExpiry: false, status: 'active', accent: '#C4B59A' },
    { id: 'p-matcha-raw', name: 'Matcha', sku: 'RW-MT001', barcode: '9550001000339', categoryId: 'cat-ing', unit: 'KG', costPrice: 42, sellingPrice: 62, wholesalePrice: 54, reorderLevel: 10, trackBatch: true, trackExpiry: false, status: 'active', accent: '#2F5D32' },
    { id: 'p-flour', name: 'Flour', sku: 'RW-FL001', barcode: '9550001000346', categoryId: 'cat-ing', unit: 'KG', costPrice: 4.2, sellingPrice: 7, wholesalePrice: 6, reorderLevel: 30, trackBatch: false, trackExpiry: false, status: 'active', accent: '#E8D9B8' },
    { id: 'p-other', name: 'Other Ingredients', sku: 'RW-OT001', barcode: '9550001000353', categoryId: 'cat-ing', unit: 'KG', costPrice: 8, sellingPrice: 12, wholesalePrice: 10, reorderLevel: 15, trackBatch: false, trackExpiry: false, status: 'active', accent: '#78716C' },
    { id: 'p-pouch', name: 'Pouch Packaging', sku: 'PK-PH001', barcode: '9550001000360', categoryId: 'cat-pack', unit: 'pcs', costPrice: 0.35, sellingPrice: 0.8, wholesalePrice: 0.55, reorderLevel: 100, trackBatch: false, trackExpiry: false, status: 'active', accent: '#9A3412' },
  ]

  const byId = Object.fromEntries(products.map((p) => [p.id, p])) as Record<string, Product>

  const customers = [
    { id: 'c-walkin', name: 'Walk-in Customer', phone: '-', email: '', status: 'active' as const },
    { id: 'c-abc', name: 'ABC Cafe', phone: '03-2166 4410', email: 'orders@abccafe.my', status: 'active' as const },
    { id: 'c-fajar', name: 'Fajar Cafe', phone: '03-4142 8801', email: 'fajarcafe@gmail.com', status: 'active' as const },
    { id: 'c-maju', name: 'Maju Enterprise', phone: '012-388 2210', email: 'purchasing@maju.my', status: 'active' as const },
    { id: 'c-xyz', name: 'Kedai Kopi XYZ', phone: '017-662 1194', email: 'xyzkopi@gmail.com', status: 'active' as const },
  ]

  const suppliers = [
    { id: 's-a', name: 'Supplier A', contact: 'Encik Razak', phone: '03-7788 2100', email: 'sales@suppliera.my', status: 'active' as const },
    { id: 's-b', name: 'Supplier B', contact: 'Ms. Tan', phone: '03-3321 0098', email: 'hello@supplierb.my', status: 'active' as const },
    { id: 's-pack', name: 'Packaging Supplier', contact: 'Ahmad Faiz', phone: '03-9051 4412', email: 'order@paksupply.my', status: 'active' as const },
    { id: 's-ing', name: 'Ingredient Supplier', contact: 'Lily Wong', phone: '03-5621 7733', email: 'sales@ingsupply.my', status: 'active' as const },
  ]

  const users = [
    { id: 'u-aina', name: 'Aina Rahman', email: 'aina@coolslurppy.my', role: 'owner' as const, status: 'active' as const, lastLogin: iso(9, 10, 8) },
    { id: 'u-admin', name: 'Admin', email: 'admin@coolslurppy.my', role: 'admin' as const, status: 'active' as const, lastLogin: iso(9, 10, 9) },
    { id: 'u-hafiz', name: 'Hafiz Malik', email: 'hafiz@coolslurppy.my', role: 'manager' as const, status: 'active' as const, lastLogin: iso(9, 9, 18) },
    { id: 'u-siti', name: 'Siti Nurhaliza', email: 'siti@coolslurppy.my', role: 'cashier' as const, status: 'active' as const, lastLogin: iso(9, 10, 11) },
    { id: 'u-kumar', name: 'Kumar Raj', email: 'kumar@coolslurppy.my', role: 'warehouse' as const, status: 'active' as const, lastLogin: iso(9, 8, 16) },
    { id: 'u-mei', name: 'Mei Ling', email: 'mei@coolslurppy.my', role: 'staff' as const, status: 'active' as const, lastLogin: iso(9, 7, 14) },
  ]

  const opening: Record<string, [number, number, number]> = {
    'p-cp': [400, 90, 48],
    'p-mt': [80, 18, 12],
    'p-st': [70, 22, 16],
    'p-wf': [181, 70, 24],
    'p-pw': [80, 36, 18],
    'p-cs': [36, 16, 10],
    'p-vs': [40, 18, 8],
    'p-pc': [18000, 4000, 2500],
    'p-cl': [16000, 3500, 2200],
    'p-ib': [90, 28, 16],
    'p-ab': [75, 28, 14],
    'p-bd': [30, 12, 8],
    'p-ml': [55, 16, 10],
    'p-cf': [40, 12, 8],
    'p-cm': [120, 40, 24],
    'p-tp': [40, 14, 8],
    'p-pb': [3000, 800, 500],
    'p-sw': [20000, 5000, 3000],
    'p-pp': [24, 10, 6],
    'p-hn': [20, 8, 6],
    'p-cocoa': [100, 12, 6],
    'p-milkpw': [37, 6, 3],
    'p-sugar': [250, 40, 20],
    'p-matcha-raw': [28, 6, 3],
    'p-flour': [180, 30, 15],
    'p-other': [48, 10, 5],
    'p-pouch': [520, 80, 40],
  }

  const qtyMap = new Map<string, number>()
  const movements: StockMovement[] = []
  const inventory: InventoryRow[] = []

  const keyOf = (productId: string, warehouseId: string) => `${productId}:${warehouseId}`

  const pushMovement = (
    date: string,
    reference: string,
    productId: string,
    warehouseId: string,
    type: MovementType,
    stockIn: number,
    stockOut: number,
    user: string,
    notes?: string,
  ) => {
    const key = keyOf(productId, warehouseId)
    const current = qtyMap.get(key) ?? 0
    const balance = round2(current + stockIn - stockOut)
    qtyMap.set(key, balance)
    movements.push({
      id: uid('mv'),
      date,
      reference,
      productId,
      warehouseId,
      type,
      stockIn,
      stockOut,
      balance,
      user,
      notes,
    })
  }

  for (const product of products) {
    const [main, shop, outlet] = opening[product.id] ?? [0, 0, 0]
    const rows: Array<[string, number]> = [
      ['wh-main', main],
      ['wh-shop', shop],
      ['wh-outlet', outlet],
    ]
    for (const [warehouseId, qty] of rows) {
      if (qty > 0) {
        pushMovement(iso(8, 1, 8), 'Opening Stock', product.id, warehouseId, 'opening_stock', qty, 0, 'Kumar Raj')
      } else {
        qtyMap.set(keyOf(product.id, warehouseId), 0)
      }
    }
  }

  const applyLines = (
    date: string,
    reference: string,
    warehouseId: string,
    type: MovementType,
    items: LineItem[],
    user: string,
    direction: 'in' | 'out',
  ) => {
    for (const item of items) {
      if (direction === 'in') pushMovement(date, reference, item.productId, warehouseId, type, item.qty, 0, user)
      else pushMovement(date, reference, item.productId, warehouseId, type, 0, item.qty, user)
    }
  }

  const purchases: Purchase[] = []
  const addPurchase = (
    purchaseNo: string,
    date: string,
    supplierId: string,
    warehouseId: string,
    invoiceNumber: string,
    items: LineItem[],
    extra: { discount?: number; tax?: number; shipping?: number; paid?: number; status?: Purchase['status'] },
  ) => {
    const t = totals(items, extra)
    const paid = extra.paid ?? t.total
    const purchase: Purchase = {
      id: uid('pur'),
      purchaseNo,
      date,
      supplierId,
      warehouseId,
      invoiceNumber,
      items,
      subtotal: t.subtotal,
      discount: t.discount,
      tax: t.tax,
      shipping: t.shipping,
      total: t.total,
      paid,
      balance: round2(t.total - paid),
      status: extra.status ?? (paid >= t.total ? 'paid' : paid > 0 ? 'partial' : 'received'),
    }
    purchases.push(purchase)
    applyLines(date, purchaseNo, warehouseId, 'purchase', items, 'Kumar Raj', 'in')
    return purchase
  }

  addPurchase('PUR-1004', iso(9, 5, 11), 's-ing', 'wh-main', 'ING-8891', [
    line(byId['p-cp'], 50, byId['p-cp'].costPrice),
    line(byId['p-mt'], 20, byId['p-mt'].costPrice),
    line(byId['p-st'], 20, byId['p-st'].costPrice),
    line(byId['p-ml'], 15, byId['p-ml'].costPrice),
  ], { paid: 99999 })

  addPurchase('PUR-1006', iso(8, 18, 14), 's-pack', 'wh-main', 'PKG-2201', [
    line(byId['p-pc'], 8000, byId['p-pc'].costPrice),
    line(byId['p-cl'], 8000, byId['p-cl'].costPrice),
    line(byId['p-pb'], 1500, byId['p-pb'].costPrice),
    line(byId['p-sw'], 10000, byId['p-sw'].costPrice),
  ], { shipping: 120, paid: 99999 })

  addPurchase('PUR-1008', iso(8, 22, 10), 's-a', 'wh-main', 'SA-4410', [
    line(byId['p-wf'], 80, byId['p-wf'].costPrice),
    line(byId['p-pw'], 40, byId['p-pw'].costPrice),
    line(byId['p-ib'], 40, byId['p-ib'].costPrice),
    line(byId['p-ab'], 30, byId['p-ab'].costPrice),
  ], { paid: 99999 })

  addPurchase('PUR-1011', iso(9, 2, 15), 's-b', 'wh-shop', 'SB-9188', [
    line(byId['p-vs'], 12, byId['p-vs'].costPrice),
    line(byId['p-cs'], 12, byId['p-cs'].costPrice),
    line(byId['p-bd'], 10, byId['p-bd'].costPrice),
    line(byId['p-cm'], 24, byId['p-cm'].costPrice),
  ], { paid: 99999 })

  const unpaidPurchaseItems = [
    line(byId['p-cp'], 80, byId['p-cp'].costPrice),
    line(byId['p-cf'], 25, byId['p-cf'].costPrice),
    line(byId['p-mt'], 15, byId['p-mt'].costPrice),
    line(byId['p-hn'], 12, byId['p-hn'].costPrice),
    line(byId['p-pp'], 10, byId['p-pp'].costPrice),
  ]
  addPurchase('PUR-1012', iso(9, 7, 16), 's-ing', 'wh-main', 'ING-9022', unpaidPurchaseItems, {
    shipping: 80,
    paid: 0,
    status: 'received',
  })

  addPurchase('PUR-1015', iso(9, 8, 9), 's-pack', 'wh-outlet', 'PKG-2294', [
    line(byId['p-pc'], 2000, byId['p-pc'].costPrice),
    line(byId['p-cl'], 2000, byId['p-cl'].costPrice),
    line(byId['p-sw'], 2000, byId['p-sw'].costPrice),
  ], { paid: 99999 })

  for (const purchase of purchases) {
    if (purchase.paid > purchase.total) {
      purchase.paid = purchase.total
      purchase.balance = 0
      purchase.status = 'paid'
    }
  }

  const sales: Sale[] = []
  const addSale = (
    invoiceNo: string,
    date: string,
    customerId: string,
    warehouseId: string,
    salesperson: string,
    items: LineItem[],
    extra: { discount?: number; tax?: number; paid?: number; method?: PaymentMethod; status?: Sale['status'] },
  ) => {
    const t = totals(items, extra)
    const paid = extra.paid ?? t.total
    const sale: Sale = {
      id: uid('sal'),
      invoiceNo,
      date,
      customerId,
      warehouseId,
      salesperson,
      items,
      subtotal: t.subtotal,
      discount: t.discount,
      tax: t.tax,
      total: t.total,
      paid: Math.min(paid, t.total),
      balance: round2(t.total - Math.min(paid, t.total)),
      status: extra.status ?? (paid >= t.total ? 'paid' : paid > 0 ? 'partial' : 'unpaid'),
      paymentMethod: extra.method,
    }
    sales.push(sale)
    applyLines(date, invoiceNo, warehouseId, 'sale', items, salesperson, 'out')
    return sale
  }

  addSale('INV-001002', iso(9, 3, 11), 'c-walkin', 'wh-main', 'Siti Nurhaliza', [
    line(byId['p-cp'], 15),
    line(byId['p-pc'], 40),
    line(byId['p-cl'], 40),
  ], { method: 'cash' })

  addSale('INV-001010', iso(9, 8, 13), 'c-abc', 'wh-main', 'Hafiz Malik', [
    line(byId['p-cp'], 10, byId['p-cp'].wholesalePrice),
    line(byId['p-ib'], 8, byId['p-ib'].wholesalePrice),
    line(byId['p-pc'], 300, byId['p-pc'].wholesalePrice),
  ], { method: 'bank_transfer' })

  addSale('INV-001220', iso(8, 14, 10), 'c-maju', 'wh-main', 'Hafiz Malik', [
    line(byId['p-wf'], 120, byId['p-wf'].wholesalePrice),
    line(byId['p-pw'], 40, byId['p-pw'].wholesalePrice),
    line(byId['p-cp'], 60, byId['p-cp'].wholesalePrice),
    line(byId['p-pc'], 2000, byId['p-pc'].wholesalePrice),
    line(byId['p-cl'], 2000, byId['p-cl'].wholesalePrice),
  ], { method: 'bank_transfer' })

  addSale('INV-001228', iso(8, 20, 15), 'c-fajar', 'wh-shop', 'Mei Ling', [
    line(byId['p-ab'], 18, byId['p-ab'].wholesalePrice),
    line(byId['p-bd'], 12, byId['p-bd'].wholesalePrice),
    line(byId['p-cm'], 20, byId['p-cm'].wholesalePrice),
    line(byId['p-pc'], 400, byId['p-pc'].wholesalePrice),
  ], { method: 'duitnow' })

  addSale('INV-001230', iso(8, 25, 11), 'c-maju', 'wh-main', 'Hafiz Malik', [
    line(byId['p-cp'], 80, byId['p-cp'].wholesalePrice),
    line(byId['p-mt'], 25, byId['p-mt'].wholesalePrice),
    line(byId['p-st'], 20, byId['p-st'].wholesalePrice),
    line(byId['p-ib'], 30, byId['p-ib'].wholesalePrice),
    line(byId['p-wf'], 40, byId['p-wf'].wholesalePrice),
    line(byId['p-pc'], 3000, byId['p-pc'].wholesalePrice),
    line(byId['p-sw'], 3000, byId['p-sw'].wholesalePrice),
  ], { method: 'bank_transfer' })

  addSale('INV-001231', iso(8, 27, 16), 'c-abc', 'wh-main', 'Hafiz Malik', [
    line(byId['p-cp'], 50, byId['p-cp'].wholesalePrice),
    line(byId['p-ml'], 20, byId['p-ml'].wholesalePrice),
    line(byId['p-cf'], 15, byId['p-cf'].wholesalePrice),
    line(byId['p-ib'], 18, byId['p-ib'].wholesalePrice),
    line(byId['p-pc'], 1500, byId['p-pc'].wholesalePrice),
    line(byId['p-cl'], 1500, byId['p-cl'].wholesalePrice),
    line(byId['p-pb'], 400, byId['p-pb'].wholesalePrice),
  ], { paid: 0, status: 'unpaid' })

  addSale('INV-001232', iso(8, 29, 12), 'c-fajar', 'wh-main', 'Mei Ling', [
    line(byId['p-pw'], 24, byId['p-pw'].wholesalePrice),
    line(byId['p-wf'], 20, byId['p-wf'].wholesalePrice),
    line(byId['p-cs'], 10, byId['p-cs'].sellingPrice),
    line(byId['p-vs'], 8, byId['p-vs'].sellingPrice),
    line(byId['p-pc'], 800, byId['p-pc'].wholesalePrice),
  ], { method: 'card' })

  addSale('INV-001233', iso(9, 1, 17), 'c-xyz', 'wh-shop', 'Siti Nurhaliza', [
    line(byId['p-ab'], 10, byId['p-ab'].wholesalePrice),
    line(byId['p-ib'], 8, byId['p-ib'].wholesalePrice),
    line(byId['p-tp'], 6, byId['p-tp'].wholesalePrice),
    line(byId['p-pc'], 500, byId['p-pc'].wholesalePrice),
    line(byId['p-sw'], 500, byId['p-sw'].wholesalePrice),
  ], { method: 'duitnow' })

  addSale('INV-001234', iso(9, 2, 10), 'c-maju', 'wh-main', 'Hafiz Malik', [
    line(byId['p-cp'], 40, byId['p-cp'].wholesalePrice),
    line(byId['p-wf'], 30, byId['p-wf'].wholesalePrice),
    line(byId['p-pw'], 20, byId['p-pw'].wholesalePrice),
    line(byId['p-pc'], 1200, byId['p-pc'].wholesalePrice),
    line(byId['p-cl'], 1200, byId['p-cl'].wholesalePrice),
  ], { paid: 10000, method: 'bank_transfer', status: 'partial' })

  addSale('INV-001235', iso(9, 3, 15), 'c-abc', 'wh-main', 'Hafiz Malik', [
    line(byId['p-st'], 16, byId['p-st'].wholesalePrice),
    line(byId['p-mt'], 10, byId['p-mt'].wholesalePrice),
    line(byId['p-ib'], 12, byId['p-ib'].wholesalePrice),
    line(byId['p-pc'], 600, byId['p-pc'].wholesalePrice),
  ], { method: 'bank_transfer' })

  addSale('INV-001236', iso(9, 4, 11), 'c-walkin', 'wh-shop', 'Siti Nurhaliza', [
    line(byId['p-cp'], 2),
    line(byId['p-vs'], 1),
    line(byId['p-pc'], 25),
    line(byId['p-cl'], 25),
    line(byId['p-sw'], 25),
  ], { method: 'cash' })

  addSale('INV-001237', iso(9, 4, 16), 'c-fajar', 'wh-main', 'Mei Ling', [
    line(byId['p-ab'], 14, byId['p-ab'].wholesalePrice),
    line(byId['p-bd'], 8, byId['p-bd'].wholesalePrice),
    line(byId['p-cm'], 16, byId['p-cm'].wholesalePrice),
    line(byId['p-pc'], 350, byId['p-pc'].wholesalePrice),
  ], { method: 'duitnow' })

  addSale('INV-001238', iso(9, 5, 12), 'c-walkin', 'wh-outlet', 'Siti Nurhaliza', [
    line(byId['p-wf'], 3),
    line(byId['p-pw'], 2),
    line(byId['p-cs'], 1),
    line(byId['p-hn'], 1),
  ], { method: 'card' })

  addSale('INV-001239', iso(9, 6, 14), 'c-xyz', 'wh-main', 'Mei Ling', [
    line(byId['p-ib'], 10, byId['p-ib'].wholesalePrice),
    line(byId['p-tp'], 8, byId['p-tp'].wholesalePrice),
    line(byId['p-pc'], 400, byId['p-pc'].wholesalePrice),
    line(byId['p-sw'], 400, byId['p-sw'].wholesalePrice),
  ], { paid: 0, status: 'unpaid' })

  addSale('INV-001240', iso(9, 7, 10), 'c-maju', 'wh-main', 'Hafiz Malik', [
    line(byId['p-cp'], 70, byId['p-cp'].wholesalePrice),
    line(byId['p-wf'], 50, byId['p-wf'].wholesalePrice),
    line(byId['p-pw'], 20, byId['p-pw'].wholesalePrice),
    line(byId['p-ib'], 20, byId['p-ib'].wholesalePrice),
    line(byId['p-pc'], 2500, byId['p-pc'].wholesalePrice),
    line(byId['p-cl'], 2500, byId['p-cl'].wholesalePrice),
    line(byId['p-pb'], 600, byId['p-pb'].wholesalePrice),
  ], { method: 'bank_transfer' })

  addSale('INV-001241', iso(9, 8, 15), 'c-abc', 'wh-main', 'Hafiz Malik', [
    line(byId['p-ml'], 12, byId['p-ml'].wholesalePrice),
    line(byId['p-cf'], 8, byId['p-cf'].wholesalePrice),
    line(byId['p-cs'], 14, byId['p-cs'].sellingPrice),
    line(byId['p-pc'], 700, byId['p-pc'].wholesalePrice),
  ], { method: 'bank_transfer' })

  addSale('INV-001242', iso(9, 9, 11), 'c-fajar', 'wh-shop', 'Mei Ling', [
    line(byId['p-pw'], 8, byId['p-pw'].wholesalePrice),
    line(byId['p-wf'], 6, byId['p-wf'].wholesalePrice),
    line(byId['p-vs'], 4),
    line(byId['p-pc'], 220, byId['p-pc'].wholesalePrice),
  ], { method: 'card' })

  addSale('INV-001243', iso(9, 9, 18), 'c-walkin', 'wh-shop', 'Siti Nurhaliza', [
    line(byId['p-cp'], 3),
    line(byId['p-st'], 1),
    line(byId['p-pc'], 30),
    line(byId['p-cl'], 30),
    line(byId['p-pb'], 8),
  ], { method: 'cash' })

  addSale('INV-001244', iso(9, 10, 9), 'c-abc', 'wh-main', 'Hafiz Malik', [
    line(byId['p-ib'], 10, byId['p-ib'].wholesalePrice),
    line(byId['p-tp'], 6, byId['p-tp'].wholesalePrice),
    line(byId['p-ab'], 8, byId['p-ab'].wholesalePrice),
    line(byId['p-pc'], 500, byId['p-pc'].wholesalePrice),
  ], { method: 'duitnow' })

  addSale('INV-001245', iso(9, 10, 10), 'c-walkin', 'wh-main', 'Siti Nurhaliza', [
    line(byId['p-cp'], 2),
    line(byId['p-wf'], 1, 18),
  ], { method: 'cash' })

  addSale('INV-001246', iso(9, 10, 11), 'c-walkin', 'wh-outlet', 'Siti Nurhaliza', [
    line(byId['p-mt'], 1),
    line(byId['p-pc'], 12),
    line(byId['p-cl'], 12),
    line(byId['p-sw'], 12),
  ], { method: 'ewallet' })

  // Consume remaining waffle at main so it is out of stock
  const waffleMain = qtyMap.get('p-wf:wh-main') ?? 0
  if (waffleMain > 0) {
    addSale('INV-001247', iso(9, 10, 12), 'c-xyz', 'wh-main', 'Mei Ling', [
      line(byId['p-wf'], waffleMain, byId['p-wf'].wholesalePrice),
      line(byId['p-pc'], 180, byId['p-pc'].wholesalePrice),
    ], { method: 'cash' })
  }

  // Consume chocolate syrup at main
  const syrupMain = qtyMap.get('p-cs:wh-main') ?? 0
  if (syrupMain > 0) {
    addSale('INV-001248', iso(9, 10, 13), 'c-fajar', 'wh-main', 'Hafiz Malik', [
      line(byId['p-cs'], syrupMain),
      line(byId['p-vs'], 4),
    ], { method: 'bank_transfer' })
  }

  // Trim matcha main toward low stock (~8)
  const matchaMain = qtyMap.get('p-mt:wh-main') ?? 0
  if (matchaMain > 8) {
    addSale('INV-001249', iso(9, 10, 14), 'c-maju', 'wh-main', 'Hafiz Malik', [
      line(byId['p-mt'], matchaMain - 8, byId['p-mt'].wholesalePrice),
    ], { method: 'bank_transfer' })
  }

  // Trim chocolate main toward 125
  const chocMain = qtyMap.get('p-cp:wh-main') ?? 0
  if (chocMain > 125) {
    addSale('INV-001250', iso(9, 10, 15), 'c-abc', 'wh-main', 'Hafiz Malik', [
      line(byId['p-cp'], chocMain - 125, byId['p-cp'].wholesalePrice),
    ], { method: 'bank_transfer' })
  }

  const consume = (
    date: string,
    reference: string,
    warehouseId: string,
    lines: Array<[string, number]>,
    user: string,
  ) => {
    for (const [productId, qty] of lines) {
      pushMovement(date, reference, productId, warehouseId, 'production_out', 0, qty, user, 'Material consumption')
    }
  }

  consume(iso(9, 5, 9), 'PO-1001', 'wh-main', [
    ['p-cocoa', 20.5],
    ['p-milkpw', 15],
    ['p-sugar', 50],
    ['p-other', 15],
    ['p-pouch', 10],
  ], 'Kumar Raj')
  pushMovement(iso(9, 5, 16), 'PO-1001', 'p-cp', 'wh-main', 'production_in', 98, 0, 'Kumar Raj', 'Finished goods')

  consume(iso(9, 8, 9), 'PO-1002', 'wh-main', [
    ['p-flour', 50],
    ['p-sugar', 15],
    ['p-milkpw', 10],
    ['p-other', 5],
  ], 'Mei Ling')
  pushMovement(iso(9, 8, 15), 'PO-1002', 'p-wf', 'wh-main', 'production_in', 80, 0, 'Mei Ling', 'Finished goods')

  for (const [key, qty] of qtyMap) {
    const [productId, warehouseId] = key.split(':')
    inventory.push({ productId, warehouseId, qty })
  }

  const batches: Batch[] = [
    { id: 'b1', productId: 'p-cp', warehouseId: 'wh-main', batchNo: 'CP-2408', qty: 75 },
    { id: 'b2', productId: 'p-cp', warehouseId: 'wh-main', batchNo: 'CP-2509', qty: 50 },
    { id: 'b3', productId: 'p-mt', warehouseId: 'wh-main', batchNo: 'MT-2507', qty: 8 },
    { id: 'b4', productId: 'p-st', warehouseId: 'wh-main', batchNo: 'ST-2508', qty: 42 },
    { id: 'b5', productId: 'p-ib', warehouseId: 'wh-main', batchNo: 'IB-2506', qty: 40 },
    { id: 'b6', productId: 'p-cs', warehouseId: 'wh-shop', batchNo: 'CS-EXP', qty: 16, expiry: '2027-02-01' },
    { id: 'b7', productId: 'p-vs', warehouseId: 'wh-main', batchNo: 'VS-EXP', qty: 24, expiry: '2027-01-15' },
    { id: 'b-po1001', productId: 'p-cp', warehouseId: 'wh-main', batchNo: 'CP-2026-0905-001', qty: 98, expiry: '2027-03-05', productionDate: iso(9, 5, 16), productionOrderId: 'po-1001' },
    { id: 'b-po1002', productId: 'p-wf', warehouseId: 'wh-main', batchNo: 'WF-2026-0908-001', qty: 80, productionDate: iso(9, 8, 15), productionOrderId: 'po-1002' },
  ]

  const bomItem = (id: string, productId: string, qty: number, unit: string, wastagePct = 0, notes = ''): Bom['items'][number] => ({
    id, productId, qty, unit, wastagePct, notes,
  })

  const boms: Bom[] = [
    {
      id: 'bom-cp',
      name: 'Chocolate Powder — 100 KG',
      productId: 'p-cp',
      outputQty: 100,
      outputUnit: 'KG',
      status: 'active',
      notes: 'Standard blending recipe for chocolate premix.',
      items: [
        bomItem('bi1', 'p-cocoa', 20, 'KG', 2, 'Dutch process cocoa'),
        bomItem('bi2', 'p-milkpw', 15, 'KG', 0, ''),
        bomItem('bi3', 'p-sugar', 50, 'KG', 0, ''),
        bomItem('bi4', 'p-other', 15, 'KG', 1, 'Stabiliser and flavour'),
        bomItem('bi5', 'p-pouch', 10, 'pcs', 0, '1kg pouches'),
      ],
    },
    {
      id: 'bom-mt',
      name: 'Matcha Powder — 50 KG',
      productId: 'p-mt',
      outputQty: 50,
      outputUnit: 'KG',
      status: 'active',
      notes: 'Ceremonial blend cut with milk powder for cafe use.',
      items: [
        bomItem('bi6', 'p-matcha-raw', 18, 'KG', 1, ''),
        bomItem('bi7', 'p-sugar', 20, 'KG', 0, ''),
        bomItem('bi8', 'p-milkpw', 10, 'KG', 0, ''),
        bomItem('bi9', 'p-other', 2, 'KG', 0, ''),
        bomItem('bi10', 'p-pouch', 5, 'pcs', 0, ''),
      ],
    },
    {
      id: 'bom-wf',
      name: 'Waffle Premix — 80 KG',
      productId: 'p-wf',
      outputQty: 80,
      outputUnit: 'KG',
      status: 'active',
      notes: '',
      items: [
        bomItem('bi11', 'p-flour', 50, 'KG', 1, ''),
        bomItem('bi12', 'p-sugar', 15, 'KG', 0, ''),
        bomItem('bi13', 'p-milkpw', 10, 'KG', 0, ''),
        bomItem('bi14', 'p-other', 5, 'KG', 2, 'Baking powder mix'),
      ],
    },
    {
      id: 'bom-pw',
      name: 'Pandan Waffle Premix — 80 KG',
      productId: 'p-pw',
      outputQty: 80,
      outputUnit: 'KG',
      status: 'active',
      notes: 'Pandan paste added at blending.',
      items: [
        bomItem('bi15', 'p-flour', 48, 'KG', 1, ''),
        bomItem('bi16', 'p-sugar', 14, 'KG', 0, ''),
        bomItem('bi17', 'p-other', 14, 'KG', 0, 'Includes milk solids'),
        bomItem('bi18', 'p-pp', 4, 'bottle', 0, 'Pandan paste'),
      ],
    },
  ]

  const chocConsumptions: ProductionConsumption[] = [
    { productId: 'p-cocoa', expectedQty: 20.4, actualQty: 20.5, unit: 'KG', notes: '' },
    { productId: 'p-milkpw', expectedQty: 15, actualQty: 15, unit: 'KG', notes: '' },
    { productId: 'p-sugar', expectedQty: 50, actualQty: 50, unit: 'KG', notes: '' },
    { productId: 'p-other', expectedQty: 15.15, actualQty: 15, unit: 'KG', notes: '' },
    { productId: 'p-pouch', expectedQty: 10, actualQty: 10, unit: 'pcs', notes: '' },
  ]
  const waffleConsumptions: ProductionConsumption[] = [
    { productId: 'p-flour', expectedQty: 50.5, actualQty: 50, unit: 'KG', notes: '' },
    { productId: 'p-sugar', expectedQty: 15, actualQty: 15, unit: 'KG', notes: '' },
    { productId: 'p-milkpw', expectedQty: 10, actualQty: 10, unit: 'KG', notes: '' },
    { productId: 'p-other', expectedQty: 5.1, actualQty: 5, unit: 'KG', notes: '' },
  ]
  const matchaConsumptions: ProductionConsumption[] = [
    { productId: 'p-matcha-raw', expectedQty: 18.18, actualQty: 18.18, unit: 'KG', notes: '' },
    { productId: 'p-sugar', expectedQty: 20, actualQty: 20, unit: 'KG', notes: '' },
    { productId: 'p-milkpw', expectedQty: 10, actualQty: 10, unit: 'KG', notes: '' },
    { productId: 'p-other', expectedQty: 2, actualQty: 2, unit: 'KG', notes: '' },
    { productId: 'p-pouch', expectedQty: 5, actualQty: 5, unit: 'pcs', notes: '' },
  ]
  const plannedChoc: ProductionConsumption[] = [
    { productId: 'p-cocoa', expectedQty: 20.4, actualQty: 20.4, unit: 'KG', notes: '' },
    { productId: 'p-milkpw', expectedQty: 15, actualQty: 15, unit: 'KG', notes: '' },
    { productId: 'p-sugar', expectedQty: 50, actualQty: 50, unit: 'KG', notes: '' },
    { productId: 'p-other', expectedQty: 15.15, actualQty: 15.15, unit: 'KG', notes: '' },
    { productId: 'p-pouch', expectedQty: 10, actualQty: 10, unit: 'pcs', notes: '' },
  ]
  const plannedPandan: ProductionConsumption[] = [
    { productId: 'p-flour', expectedQty: 48.48, actualQty: 48.48, unit: 'KG', notes: '' },
    { productId: 'p-sugar', expectedQty: 14, actualQty: 14, unit: 'KG', notes: '' },
    { productId: 'p-other', expectedQty: 14, actualQty: 14, unit: 'KG', notes: '' },
    { productId: 'p-pp', expectedQty: 4, actualQty: 4, unit: 'bottle', notes: '' },
  ]

  const productionOrders: ProductionOrder[] = [
    {
      id: 'po-1001',
      orderNo: 'PO-1001',
      date: iso(9, 4, 9),
      productId: 'p-cp',
      bomId: 'bom-cp',
      warehouseId: 'wh-main',
      plannedQty: 100,
      actualQty: 98,
      unit: 'KG',
      plannedStart: iso(9, 5, 8),
      plannedEnd: iso(9, 5, 17),
      actualStart: iso(9, 5, 9),
      actualEnd: iso(9, 5, 16),
      status: 'completed',
      batchNo: 'CP-2026-0905-001',
      expiryDate: '2027-03-05',
      operator: 'Kumar Raj',
      notes: 'Slight yield loss on mill.',
      consumptions: chocConsumptions,
      wastage: [{ id: 'w1', kind: 'yield_variance', productId: 'p-cp', qty: 2, unit: 'KG', reason: 'Process loss', notes: 'Dust extraction' }],
      consumptionConfirmed: true,
      posted: true,
      costEstimate: 20.5 * 18 + 15 * 16 + 50 * 3.5 + 15 * 8 + 10 * 0.35,
    },
    {
      id: 'po-1002',
      orderNo: 'PO-1002',
      date: iso(9, 7, 10),
      productId: 'p-wf',
      bomId: 'bom-wf',
      warehouseId: 'wh-main',
      plannedQty: 80,
      actualQty: 80,
      unit: 'KG',
      plannedStart: iso(9, 8, 8),
      plannedEnd: iso(9, 8, 16),
      actualStart: iso(9, 8, 9),
      actualEnd: iso(9, 8, 15),
      status: 'completed',
      batchNo: 'WF-2026-0908-001',
      operator: 'Mei Ling',
      notes: '',
      consumptions: waffleConsumptions,
      wastage: [],
      consumptionConfirmed: true,
      posted: true,
      costEstimate: 50 * 4.2 + 15 * 3.5 + 10 * 16 + 5 * 8,
    },
    {
      id: 'po-1003',
      orderNo: 'PO-1003',
      date: iso(9, 9, 11),
      productId: 'p-mt',
      bomId: 'bom-mt',
      warehouseId: 'wh-main',
      plannedQty: 50,
      actualQty: 0,
      unit: 'KG',
      plannedStart: iso(9, 10, 8),
      plannedEnd: iso(9, 10, 17),
      actualStart: iso(9, 10, 9),
      status: 'in_progress',
      batchNo: 'MT-2026-0910-001',
      expiryDate: '2027-03-10',
      operator: 'Kumar Raj',
      notes: 'Started this morning. Confirm consumption before completing.',
      consumptions: matchaConsumptions,
      wastage: [],
      consumptionConfirmed: false,
      posted: false,
      costEstimate: 18.18 * 42 + 20 * 3.5 + 10 * 16 + 2 * 8 + 5 * 0.35,
    },
    {
      id: 'po-1004',
      orderNo: 'PO-1004',
      date: iso(9, 10, 8),
      productId: 'p-cp',
      bomId: 'bom-cp',
      warehouseId: 'wh-main',
      plannedQty: 100,
      actualQty: 0,
      unit: 'KG',
      plannedStart: iso(9, 11, 8),
      plannedEnd: iso(9, 11, 17),
      status: 'planned',
      batchNo: 'CP-2026-0911-001',
      expiryDate: '2027-03-11',
      operator: 'Hafiz Malik',
      notes: 'Hold — milk powder shortage.',
      consumptions: plannedChoc,
      wastage: [],
      consumptionConfirmed: false,
      posted: false,
      costEstimate: 20.4 * 18 + 15 * 16 + 50 * 3.5 + 15.15 * 8 + 10 * 0.35,
    },
    {
      id: 'po-1005',
      orderNo: 'PO-1005',
      date: iso(9, 10, 9),
      productId: 'p-pw',
      bomId: 'bom-pw',
      warehouseId: 'wh-main',
      plannedQty: 80,
      actualQty: 0,
      unit: 'KG',
      plannedStart: iso(9, 12, 8),
      plannedEnd: iso(9, 12, 16),
      status: 'draft',
      batchNo: 'PW-2026-0912-001',
      operator: 'Mei Ling',
      notes: '',
      consumptions: plannedPandan,
      wastage: [],
      consumptionConfirmed: false,
      posted: false,
      costEstimate: 48.48 * 4.2 + 14 * 3.5 + 14 * 8 + 4 * 6.5,
    },
    {
      id: 'po-1006',
      orderNo: 'PO-1006',
      date: iso(9, 3, 14),
      productId: 'p-wf',
      bomId: 'bom-wf',
      warehouseId: 'wh-shop',
      plannedQty: 40,
      actualQty: 0,
      unit: 'KG',
      plannedStart: iso(9, 4, 8),
      plannedEnd: iso(9, 4, 15),
      status: 'cancelled',
      batchNo: '',
      operator: 'Hafiz Malik',
      notes: 'Moved to Main Warehouse run PO-1002.',
      consumptions: [
        { productId: 'p-flour', expectedQty: 25.25, actualQty: 25.25, unit: 'KG', notes: '' },
        { productId: 'p-sugar', expectedQty: 7.5, actualQty: 7.5, unit: 'KG', notes: '' },
        { productId: 'p-milkpw', expectedQty: 5, actualQty: 5, unit: 'KG', notes: '' },
        { productId: 'p-other', expectedQty: 2.55, actualQty: 2.55, unit: 'KG', notes: '' },
      ],
      wastage: [],
      consumptionConfirmed: false,
      posted: false,
      costEstimate: 0,
    },
    {
      id: 'po-1007',
      orderNo: 'PO-1007',
      date: iso(9, 10, 10),
      productId: 'p-wf',
      bomId: 'bom-wf',
      warehouseId: 'wh-main',
      plannedQty: 40,
      actualQty: 0,
      unit: 'KG',
      plannedStart: iso(9, 10, 13),
      plannedEnd: iso(9, 10, 18),
      status: 'planned',
      batchNo: 'WF-2026-0910-002',
      operator: 'Kumar Raj',
      notes: 'Afternoon top-up batch.',
      consumptions: [
        { productId: 'p-flour', expectedQty: 25.25, actualQty: 25.25, unit: 'KG', notes: '' },
        { productId: 'p-sugar', expectedQty: 7.5, actualQty: 7.5, unit: 'KG', notes: '' },
        { productId: 'p-milkpw', expectedQty: 5, actualQty: 5, unit: 'KG', notes: '' },
        { productId: 'p-other', expectedQty: 2.55, actualQty: 2.55, unit: 'KG', notes: '' },
      ],
      wastage: [],
      consumptionConfirmed: false,
      posted: false,
      costEstimate: 25.25 * 4.2 + 7.5 * 3.5 + 5 * 16 + 2.55 * 8,
    },
  ]

  const payments: Payment[] = []
  let paySeq = 1001
  const pushPayment = (
    date: string,
    partyType: 'customer' | 'supplier',
    partyId: string,
    invoiceId: string,
    invoiceNo: string,
    method: PaymentMethod,
    amount: number,
  ) => {
    if (amount <= 0) return
    payments.push({
      id: uid('pay'),
      paymentNo: `PAY-${String(paySeq++).padStart(4, '0')}`,
      date,
      partyType,
      partyId,
      invoiceId,
      invoiceNo,
      method,
      amount,
      status: 'completed',
    })
  }

  for (const sale of sales) {
    if (sale.paid > 0) {
      pushPayment(sale.date, 'customer', sale.customerId, sale.id, sale.invoiceNo, sale.paymentMethod ?? 'cash', sale.paid)
    }
  }
  for (const purchase of purchases) {
    if (purchase.paid > 0) {
      pushPayment(purchase.date, 'supplier', purchase.supplierId, purchase.id, purchase.purchaseNo, 'bank_transfer', purchase.paid)
    }
  }

  const expenses: Expense[] = [
    { id: uid('exp'), date: iso(8, 1, 9), category: 'Rent', description: 'Shop rental — August', amount: 4500, paymentMethod: 'bank_transfer', notes: 'SS2 shop lot' },
    { id: uid('exp'), date: iso(9, 1, 9), category: 'Rent', description: 'Shop rental — September', amount: 4500, paymentMethod: 'bank_transfer', notes: '' },
    { id: uid('exp'), date: iso(9, 2, 10), category: 'Salary', description: 'Staff payroll', amount: 8600, paymentMethod: 'bank_transfer', notes: '' },
    { id: uid('exp'), date: iso(9, 4, 11), category: 'Utilities', description: 'TNB + water', amount: 980, paymentMethod: 'duitnow', notes: '' },
    { id: uid('exp'), date: iso(9, 5, 14), category: 'Packaging', description: 'Extra cup sleeves', amount: 420, paymentMethod: 'cash', notes: '' },
    { id: uid('exp'), date: iso(9, 6, 16), category: 'Marketing', description: 'Instagram ads', amount: 650, paymentMethod: 'card', notes: '' },
    { id: uid('exp'), date: iso(9, 8, 10), category: 'Transport', description: 'Stock transfer van', amount: 180, paymentMethod: 'cash', notes: '' },
    { id: uid('exp'), date: iso(9, 9, 15), category: 'Maintenance', description: 'Blender service', amount: 240, paymentMethod: 'duitnow', notes: '' },
    { id: uid('exp'), date: iso(9, 3, 12), category: 'Office', description: 'Stationery and printer ink', amount: 140, paymentMethod: 'card', notes: '' },
  ]

  const notifications = [
    { id: uid('nt'), type: 'low_stock' as const, title: 'Low stock', body: 'Matcha Powder is below reorder level.', date: iso(9, 10, 8), read: false, href: '/inventory' },
    { id: uid('nt'), type: 'out_of_stock' as const, title: 'Out of stock', body: 'Waffle Premix is out of stock at Main Warehouse.', date: iso(9, 10, 12), read: false, href: '/inventory' },
    { id: uid('nt'), type: 'payment' as const, title: 'Overdue invoice', body: 'Invoice INV-001231 is overdue.', date: iso(9, 9, 9), read: false, href: '/receivables' },
    { id: uid('nt'), type: 'info' as const, title: 'Stock received', body: 'PUR-1012 was received at Main Warehouse.', date: iso(9, 7, 16), read: true, href: '/purchases' },
    { id: uid('nt'), type: 'production' as const, title: 'Material shortage', body: 'PO-1004 Chocolate Powder is short of Milk Powder.', date: iso(9, 10, 8), read: false, href: '/manufacturing/orders' },
    { id: uid('nt'), type: 'production' as const, title: 'Production completed', body: 'PO-1001 posted 98 KG Chocolate Powder (CP-2026-0905-001).', date: iso(9, 5, 16), read: true, href: '/manufacturing/history' },
  ]

  return {
    warehouses,
    categories,
    products,
    inventory,
    batches,
    customers,
    suppliers,
    sales,
    purchases,
    salesReturns: [],
    purchaseReturns: [],
    stockMovements: movements.sort((a, b) => a.date.localeCompare(b.date)),
    payments,
    expenses,
    users,
    notifications,
    boms,
    productionOrders,
    settings: {
      businessName: 'Cool Slurppy',
      phone: '+60 3-2100 4588',
      email: 'hello@coolslurppy.my',
      address: '12, Jalan Ampang, 50450 Kuala Lumpur',
      currency: 'MYR',
      defaultWarehouseId: 'wh-main',
      allowNegativeStock: false,
      costingMethod: 'average',
      batchTracking: true,
      expiryTracking: true,
      defaultCustomerId: 'c-walkin',
      allowDiscount: true,
      allowReturns: true,
      enabledPaymentMethods: ['cash', 'bank_transfer', 'duitnow', 'card', 'ewallet'],
      roleMatrix: defaultRoleMatrix,
    },
  }
}

export const CURRENT_USER = {
  id: 'u-admin',
  name: 'Admin',
  email: 'admin@coolslurppy.my',
  role: 'Admin',
}

export { PROTOTYPE_TODAY }
