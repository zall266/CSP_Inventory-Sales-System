import { createSeedData, CURRENT_USER } from '@/data/seed'
import type {
  AppData,
  AppState,
  AdjustmentType,
  DrawerState,
  Expense,
  ExpenseCategory,
  InventoryRow,
  LineItem,
  MovementType,
  PaymentMethod,
  ProductInput,
  PurchaseInput,
  PurchaseStatus,
  QuickModal,
  SaleInput,
  SaleStatus,
  Settings,
  StockStatus,
  ToastTone,
  UiState,
} from '@/types'
import { nextDocNo, PROTOTYPE_TODAY, round2, stockStatus, uid } from '@/utils/format'

const STORAGE_KEY = 'stockflow-prototype-v1'

const defaultUi = (): UiState => ({
  toasts: [],
  drawer: null,
  quickModal: null,
  warehouseFilter: 'all',
  sidebarCollapsed: false,
  mobileNavOpen: false,
  datePreset: '30d',
  customFrom: '2026-08-12',
  customTo: '2026-09-10',
})

function cloneData(data: AppData): AppData {
  return structuredClone(data)
}

function loadPersisted(): AppData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { version?: number; data?: AppData }
    if (parsed.version !== 1 || !parsed.data?.products) return null
    return parsed.data
  } catch {
    return null
  }
}

function persist(data: AppData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, data }))
  } catch {
    /* ignore quota */
  }
}

let seed = createSeedData()
let state: AppState = {
  ...(loadPersisted() ?? cloneData(seed)),
  ui: defaultUi(),
}

const listeners = new Set<() => void>()

function emit() {
  persist(state)
  listeners.forEach((listener) => listener())
}

function setData(patch: Partial<AppData>) {
  state = { ...state, ...patch }
  emit()
}

function setUi(patch: Partial<UiState>) {
  state = { ...state, ui: { ...state.ui, ...patch } }
  listeners.forEach((listener) => listener())
}

function nowIso() {
  return PROTOTYPE_TODAY.toISOString()
}

function getQty(productId: string, warehouseId: string) {
  return state.inventory.find((row) => row.productId === productId && row.warehouseId === warehouseId)?.qty ?? 0
}

function productById(id: string) {
  return state.products.find((product) => product.id === id)
}

function addMovement(
  movements: typeof state.stockMovements,
  inventory: InventoryRow[],
  input: {
    date: string
    reference: string
    productId: string
    warehouseId: string
    type: MovementType
    stockIn: number
    stockOut: number
    notes?: string
  },
) {
  const current = inventory.find((row) => row.productId === input.productId && row.warehouseId === input.warehouseId)?.qty ?? 0
  const balance = round2(current + input.stockIn - input.stockOut)
  const nextInventory = inventory.some((row) => row.productId === input.productId && row.warehouseId === input.warehouseId)
    ? inventory.map((row) =>
        row.productId === input.productId && row.warehouseId === input.warehouseId ? { ...row, qty: balance } : row,
      )
    : [...inventory, { productId: input.productId, warehouseId: input.warehouseId, qty: balance }]
  const movement = {
    id: uid('mv'),
    date: input.date,
    reference: input.reference,
    productId: input.productId,
    warehouseId: input.warehouseId,
    type: input.type,
    stockIn: input.stockIn,
    stockOut: input.stockOut,
    balance,
    user: CURRENT_USER.name,
    notes: input.notes,
  }
  return { inventory: nextInventory, movements: [movement, ...movements] }
}

function toast(title: string, description?: string, tone: ToastTone = 'success') {
  const item = { id: uid('toast'), title, description, tone }
  setUi({ toasts: [...state.ui.toasts, item] })
  window.setTimeout(() => {
    setUi({ toasts: state.ui.toasts.filter((t) => t.id !== item.id) })
  }, 3200)
}

function notify(type: AppState['notifications'][number]['type'], title: string, body: string, href?: string) {
  state = {
    ...state,
    notifications: [
      { id: uid('nt'), type, title, body, date: nowIso(), read: false, href },
      ...state.notifications,
    ],
  }
}

function makeLines(
  items: Array<{ productId: string; qty: number; price: number; discount?: number; batchNo?: string; expiry?: string }>,
): LineItem[] {
  return items.map((item) => ({
    productId: item.productId,
    qty: item.qty,
    price: item.price,
    discount: item.discount ?? 0,
    total: round2(item.qty * item.price - (item.discount ?? 0)),
    returnedQty: 0,
    batchNo: item.batchNo,
    expiry: item.expiry,
  }))
}

function maybeStockAlerts(productId: string, warehouseId: string, qty: number) {
  const product = productById(productId)
  if (!product) return
  const warehouse = state.warehouses.find((w) => w.id === warehouseId)
  if (qty <= 0) {
    notify('out_of_stock', 'Out of stock', `${product.name} is out of stock at ${warehouse?.name ?? 'warehouse'}.`, '/inventory')
  } else if (qty <= product.reorderLevel) {
    notify('low_stock', 'Low stock', `${product.name} is below reorder level.`, '/inventory')
  }
}

export const db = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot() {
    return state
  },
  toast,
  dismissToast(id: string) {
    setUi({ toasts: state.ui.toasts.filter((item) => item.id !== id) })
  },
  openDrawer(drawer: DrawerState) {
    setUi({ drawer, mobileNavOpen: false })
  },
  closeDrawer() {
    setUi({ drawer: null })
  },
  openModal(quickModal: QuickModal) {
    setUi({ quickModal, mobileNavOpen: false })
  },
  closeModal() {
    setUi({ quickModal: null })
  },
  setWarehouseFilter(warehouseFilter: string) {
    setUi({ warehouseFilter })
  },
  setSidebarCollapsed(sidebarCollapsed: boolean) {
    setUi({ sidebarCollapsed })
  },
  setMobileNavOpen(mobileNavOpen: boolean) {
    setUi({ mobileNavOpen })
  },
  setDatePreset(datePreset: UiState['datePreset'], customFrom?: string, customTo?: string) {
    setUi({
      datePreset,
      customFrom: customFrom ?? state.ui.customFrom,
      customTo: customTo ?? state.ui.customTo,
    })
  },
  markNotificationRead(id: string) {
    setData({
      notifications: state.notifications.map((item) => (item.id === id ? { ...item, read: true } : item)),
    })
  },
  markAllNotificationsRead() {
    setData({ notifications: state.notifications.map((item) => ({ ...item, read: true })) })
  },
  resetDemo() {
    seed = createSeedData()
    state = { ...cloneData(seed), ui: { ...defaultUi(), toasts: [] } }
    persist(state)
    listeners.forEach((listener) => listener())
    toast('Demo data reset', 'All prototype data is back to the original sample.', 'info')
  },

  getProductQty(productId: string, warehouseId?: string) {
    if (warehouseId && warehouseId !== 'all') return getQty(productId, warehouseId)
    return round2(
      state.inventory.filter((row) => row.productId === productId).reduce((sum, row) => sum + row.qty, 0),
    )
  },

  getProductStockStatus(productId: string, warehouseId?: string): StockStatus {
    const product = productById(productId)
    const qty = this.getProductQty(productId, warehouseId)
    return stockStatus(qty, product?.reorderLevel ?? 0)
  },

  createProduct(input: ProductInput) {
    if (state.products.some((p) => p.sku.toLowerCase() === input.sku.toLowerCase())) {
      toast('SKU already exists', `${input.sku} is already used.`, 'danger')
      return null
    }
    const product = {
      ...input,
      id: uid('prd'),
      accent: '#4F46E5',
    }
    const inventory = [
      ...state.inventory,
      ...state.warehouses.map((warehouse) => ({ productId: product.id, warehouseId: warehouse.id, qty: 0 })),
    ]
    setData({ products: [product, ...state.products], inventory })
    toast('Product added', `${product.name} is now in the catalogue.`)
    return product
  },

  updateProduct(id: string, patch: Partial<ProductInput>) {
    setData({
      products: state.products.map((product) => (product.id === id ? { ...product, ...patch } : product)),
    })
    toast('Product updated')
  },

  setProductStatus(id: string, status: ProductInput['status']) {
    setData({
      products: state.products.map((product) => (product.id === id ? { ...product, status } : product)),
    })
    toast(status === 'inactive' ? 'Product deactivated' : 'Product activated')
  },

  createCategory(name: string) {
    const category = { id: uid('cat'), name }
    setData({ categories: [...state.categories, category] })
    toast('Category added', name)
    return category
  },

  renameCategory(id: string, name: string) {
    setData({
      categories: state.categories.map((category) => (category.id === id ? { ...category, name } : category)),
    })
    toast('Category renamed')
  },

  createCustomer(input: { name: string; phone: string; email: string }) {
    const customer = { id: uid('cus'), status: 'active' as const, ...input }
    setData({ customers: [customer, ...state.customers] })
    toast('Customer added', customer.name)
    return customer
  },

  createSupplier(input: { name: string; contact: string; phone: string; email: string }) {
    const supplier = { id: uid('sup'), status: 'active' as const, ...input }
    setData({ suppliers: [supplier, ...state.suppliers] })
    toast('Supplier added', supplier.name)
    return supplier
  },

  createUser(input: { name: string; email: string; role: AppState['users'][number]['role'] }) {
    const user = {
      id: uid('usr'),
      name: input.name,
      email: input.email,
      role: input.role,
      status: 'active' as const,
      lastLogin: 'Never',
    }
    setData({ users: [user, ...state.users] })
    toast('User created', input.name)
    return user
  },

  updateSettings(patch: Partial<Settings>) {
    setData({ settings: { ...state.settings, ...patch } })
  },

  updateRoleMatrix(matrix: Settings['roleMatrix']) {
    setData({ settings: { ...state.settings, roleMatrix: matrix } })
  },

  createSale(input: SaleInput) {
    const items = makeLines(input.items).filter((item) => item.qty > 0)
    if (!items.length) {
      toast('Cart is empty', 'Add at least one product.', 'warning')
      return null
    }
    const warehouseId = input.warehouseId
    if (!state.settings.allowNegativeStock) {
      for (const item of items) {
        const available = getQty(item.productId, warehouseId)
        if (item.qty > available) {
          const product = productById(item.productId)
          toast('Insufficient stock', `${product?.name ?? 'Item'} has ${available} available.`, 'danger')
          return null
        }
      }
    }
    const subtotal = round2(items.reduce((sum, item) => sum + item.total, 0))
    const discount = input.discount ?? 0
    const tax = input.tax ?? 0
    const total = round2(subtotal - discount + tax)
    const paidAmount = Math.min(input.paidAmount ?? 0, total)
    const balance = round2(total - paidAmount)
    const invoiceNo = nextDocNo(state.sales.map((s) => s.invoiceNo), 'INV-')
    const date = input.date ?? nowIso()
    const sale = {
      id: uid('sal'),
      invoiceNo,
      date,
      customerId: input.customerId,
      warehouseId,
      salesperson: input.salesperson ?? CURRENT_USER.name,
      items,
      subtotal,
      discount,
      tax,
      total,
      paid: paidAmount,
      balance,
      status: (paidAmount >= total ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid') as SaleStatus,
      paymentMethod: input.paymentMethod,
      notes: input.notes,
    }

    let inventory = state.inventory
    let movements = state.stockMovements
    for (const item of items) {
      const applied = addMovement(movements, inventory, {
        date,
        reference: invoiceNo,
        productId: item.productId,
        warehouseId,
        type: 'sale',
        stockIn: 0,
        stockOut: item.qty,
      })
      inventory = applied.inventory
      movements = applied.movements
    }

    const payments = [...state.payments]
    if (paidAmount > 0 && input.paymentMethod) {
      payments.unshift({
        id: uid('pay'),
        paymentNo: nextDocNo(state.payments.map((p) => p.paymentNo), 'PAY-'),
        date,
        partyType: 'customer',
        partyId: input.customerId,
        invoiceId: sale.id,
        invoiceNo,
        method: input.paymentMethod,
        amount: paidAmount,
        status: 'completed',
      })
    }

    state = { ...state, sales: [sale, ...state.sales], inventory, stockMovements: movements, payments }
    for (const item of items) {
      const qty = inventory.find((row) => row.productId === item.productId && row.warehouseId === warehouseId)?.qty ?? 0
      maybeStockAlerts(item.productId, warehouseId, qty)
    }
    emit()
    toast('Sale completed', `${invoiceNo} · ${sale.status === 'paid' ? 'Paid' : 'Recorded'}`)
    return sale
  },

  voidSale(id: string) {
    const sale = state.sales.find((item) => item.id === id)
    if (!sale || sale.status === 'voided') return
    let inventory = state.inventory
    let movements = state.stockMovements
    for (const item of sale.items) {
      const remaining = item.qty - item.returnedQty
      if (remaining <= 0) continue
      const applied = addMovement(movements, inventory, {
        date: nowIso(),
        reference: `${sale.invoiceNo}-VOID`,
        productId: item.productId,
        warehouseId: sale.warehouseId,
        type: 'sales_return',
        stockIn: remaining,
        stockOut: 0,
        notes: 'Voided sale',
      })
      inventory = applied.inventory
      movements = applied.movements
    }
    setData({
      sales: state.sales.map((item) => (item.id === id ? { ...item, status: 'voided', balance: 0 } : item)),
      inventory,
      stockMovements: movements,
    })
    toast('Sale voided', sale.invoiceNo, 'warning')
  },

  createPurchase(input: PurchaseInput) {
    const items = makeLines(input.items).filter((item) => item.qty > 0)
    if (!items.length) {
      toast('Add products', 'A purchase needs at least one line.', 'warning')
      return null
    }
    const subtotal = round2(items.reduce((sum, item) => sum + item.total, 0))
    const discount = input.discount ?? 0
    const tax = input.tax ?? 0
    const shipping = input.shipping ?? 0
    const total = round2(subtotal - discount + tax + shipping)
    const paidAmount = Math.min(input.paidAmount ?? 0, total)
    const purchaseNo = nextDocNo(state.purchases.map((p) => p.purchaseNo), 'PUR-')
    const date = input.date ?? nowIso()
    const status = input.receive ? (paidAmount >= total ? 'paid' : paidAmount > 0 ? 'partial' : 'received') : 'draft'
    const purchase = {
      id: uid('pur'),
      purchaseNo,
      date,
      supplierId: input.supplierId,
      warehouseId: input.warehouseId,
      invoiceNumber: input.invoiceNumber || purchaseNo,
      items,
      subtotal,
      discount,
      tax,
      shipping,
      total,
      paid: paidAmount,
      balance: round2(total - paidAmount),
      status: status as PurchaseStatus,
      notes: input.notes,
    }

    let inventory = state.inventory
    let movements = state.stockMovements
    if (input.receive) {
      for (const item of items) {
        const applied = addMovement(movements, inventory, {
          date,
          reference: purchaseNo,
          productId: item.productId,
          warehouseId: input.warehouseId,
          type: 'purchase',
          stockIn: item.qty,
          stockOut: 0,
        })
        inventory = applied.inventory
        movements = applied.movements
      }
    }

    const payments = [...state.payments]
    if (paidAmount > 0) {
      payments.unshift({
        id: uid('pay'),
        paymentNo: nextDocNo(state.payments.map((p) => p.paymentNo), 'PAY-'),
        date,
        partyType: 'supplier',
        partyId: input.supplierId,
        invoiceId: purchase.id,
        invoiceNo: purchaseNo,
        method: 'bank_transfer',
        amount: paidAmount,
        status: 'completed',
      })
    }

    setData({ purchases: [purchase, ...state.purchases], inventory, stockMovements: movements, payments })
    toast(input.receive ? 'Purchase received' : 'Draft saved', purchaseNo)
    return purchase
  },

  receivePurchase(id: string) {
    const purchase = state.purchases.find((item) => item.id === id)
    if (!purchase || purchase.status !== 'draft') {
      toast('Already received', undefined, 'info')
      return
    }
    let inventory = state.inventory
    let movements = state.stockMovements
    for (const item of purchase.items) {
      const applied = addMovement(movements, inventory, {
        date: nowIso(),
        reference: purchase.purchaseNo,
        productId: item.productId,
        warehouseId: purchase.warehouseId,
        type: 'purchase',
        stockIn: item.qty,
        stockOut: 0,
      })
      inventory = applied.inventory
      movements = applied.movements
    }
    setData({
      purchases: state.purchases.map((item) =>
        item.id === id ? { ...item, status: item.paid >= item.total ? 'paid' : item.paid > 0 ? 'partial' : 'received' } : item,
      ),
      inventory,
      stockMovements: movements,
    })
    toast('Purchase received', purchase.purchaseNo)
  },

  adjustStock(input: {
    warehouseId: string
    productId: string
    type: AdjustmentType
    qty: number
    reason: string
    notes?: string
  }) {
    if (input.qty <= 0) {
      toast('Enter a quantity', undefined, 'warning')
      return false
    }
    const current = getQty(input.productId, input.warehouseId)
    const stockIn = input.type === 'increase' ? input.qty : 0
    const stockOut = input.type === 'decrease' ? input.qty : 0
    if (input.type === 'decrease' && !state.settings.allowNegativeStock && input.qty > current) {
      toast('Not enough stock', `Current stock is ${current}.`, 'danger')
      return false
    }
    const applied = addMovement(state.stockMovements, state.inventory, {
      date: nowIso(),
      reference: nextDocNo(
        state.stockMovements.filter((m) => m.reference.startsWith('ADJ-')).map((m) => m.reference),
        'ADJ-',
        4,
      ),
      productId: input.productId,
      warehouseId: input.warehouseId,
      type: 'adjustment',
      stockIn,
      stockOut,
      notes: input.reason + (input.notes ? ` — ${input.notes}` : ''),
    })
    setData({ inventory: applied.inventory, stockMovements: applied.movements })
    const product = productById(input.productId)
    toast('Stock adjusted', `${product?.name ?? 'Product'} updated.`)
    return true
  },

  transferStock(input: { fromWarehouseId: string; toWarehouseId: string; productId: string; qty: number }) {
    if (input.fromWarehouseId === input.toWarehouseId) {
      toast('Choose different warehouses', undefined, 'warning')
      return false
    }
    if (input.qty <= 0) {
      toast('Enter a quantity', undefined, 'warning')
      return false
    }
    const current = getQty(input.productId, input.fromWarehouseId)
    if (!state.settings.allowNegativeStock && input.qty > current) {
      toast('Not enough stock at source', `Available: ${current}.`, 'danger')
      return false
    }
    const reference = nextDocNo(
      state.stockMovements.filter((m) => m.reference.startsWith('TRF-')).map((m) => m.reference),
      'TRF-',
      4,
    )
    const date = nowIso()
    const outMove = addMovement(state.stockMovements, state.inventory, {
      date,
      reference,
      productId: input.productId,
      warehouseId: input.fromWarehouseId,
      type: 'transfer_out',
      stockIn: 0,
      stockOut: input.qty,
    })
    const inMove = addMovement(outMove.movements, outMove.inventory, {
      date,
      reference,
      productId: input.productId,
      warehouseId: input.toWarehouseId,
      type: 'transfer_in',
      stockIn: input.qty,
      stockOut: 0,
    })
    setData({ inventory: inMove.inventory, stockMovements: inMove.movements })
    toast('Transfer complete', `${input.qty} moved.`)
    return true
  },

  completeStockCount(input: { warehouseId: string; counts: Array<{ productId: string; countedQty: number }> }) {
    let inventory = state.inventory
    let movements = state.stockMovements
    const reference = nextDocNo(
      state.stockMovements.filter((m) => m.reference.startsWith('CNT-')).map((m) => m.reference),
      'CNT-',
      4,
    )
    const date = nowIso()
    let changes = 0
    for (const row of input.counts) {
      const system = inventory.find((item) => item.productId === row.productId && item.warehouseId === input.warehouseId)?.qty ?? 0
      const diff = round2(row.countedQty - system)
      if (diff === 0) continue
      changes += 1
      const applied = addMovement(movements, inventory, {
        date,
        reference,
        productId: row.productId,
        warehouseId: input.warehouseId,
        type: 'stock_count',
        stockIn: diff > 0 ? diff : 0,
        stockOut: diff < 0 ? Math.abs(diff) : 0,
        notes: 'Physical count',
      })
      inventory = applied.inventory
      movements = applied.movements
    }
    setData({ inventory, stockMovements: movements })
    toast('Stock count complete', changes ? `${changes} SKUs adjusted.` : 'No differences found.', changes ? 'success' : 'info')
    return true
  },

  createSalesReturn(input: { saleId: string; items: Array<{ productId: string; qty: number }>; reason: string }) {
    if (!state.settings.allowReturns) {
      toast('Returns disabled', 'Enable returns in Sales Settings.', 'warning')
      return null
    }
    const sale = state.sales.find((item) => item.id === input.saleId)
    if (!sale) return null
    const returning = input.items.filter((item) => item.qty > 0)
    if (!returning.length) {
      toast('Select quantities to return', undefined, 'warning')
      return null
    }
    for (const row of returning) {
      const line = sale.items.find((item) => item.productId === row.productId)
      const available = (line?.qty ?? 0) - (line?.returnedQty ?? 0)
      if (row.qty > available) {
        toast('Return qty too high', undefined, 'danger')
        return null
      }
    }
    const returnNo = nextDocNo(state.salesReturns.map((item) => item.returnNo), 'SR-')
    const date = nowIso()
    let inventory = state.inventory
    let movements = state.stockMovements
    const items = returning.map((row) => {
      const line = sale.items.find((item) => item.productId === row.productId)!
      const applied = addMovement(movements, inventory, {
        date,
        reference: returnNo,
        productId: row.productId,
        warehouseId: sale.warehouseId,
        type: 'sales_return',
        stockIn: row.qty,
        stockOut: 0,
        notes: input.reason,
      })
      inventory = applied.inventory
      movements = applied.movements
      return { productId: row.productId, qty: row.qty, price: line.price }
    })
    const total = round2(items.reduce((sum, item) => sum + item.qty * item.price, 0))
    const sales = state.sales.map((item) => {
      if (item.id !== sale.id) return item
      const nextItems = item.items.map((line) => {
        const ret = returning.find((row) => row.productId === line.productId)
        return ret ? { ...line, returnedQty: line.returnedQty + ret.qty } : line
      })
      const fullyReturned = nextItems.every((line) => line.returnedQty >= line.qty)
      return { ...item, items: nextItems, status: fullyReturned ? 'returned' : item.status }
    })
    setData({
      sales,
      inventory,
      stockMovements: movements,
      salesReturns: [
        {
          id: uid('sret'),
          returnNo,
          date,
          saleId: sale.id,
          warehouseId: sale.warehouseId,
          items,
          reason: input.reason,
          total,
        },
        ...state.salesReturns,
      ],
    })
    toast('Return processed', returnNo)
    return returnNo
  },

  createPurchaseReturn(input: { purchaseId: string; items: Array<{ productId: string; qty: number }>; reason: string }) {
    const purchase = state.purchases.find((item) => item.id === input.purchaseId)
    if (!purchase) return null
    const returning = input.items.filter((item) => item.qty > 0)
    if (!returning.length) {
      toast('Select quantities to return', undefined, 'warning')
      return null
    }
    for (const row of returning) {
      const line = purchase.items.find((item) => item.productId === row.productId)
      const available = (line?.qty ?? 0) - (line?.returnedQty ?? 0)
      if (row.qty > available) {
        toast('Return qty too high', undefined, 'danger')
        return null
      }
      const onHand = getQty(row.productId, purchase.warehouseId)
      if (!state.settings.allowNegativeStock && row.qty > onHand) {
        toast('Not enough stock to return', undefined, 'danger')
        return null
      }
    }
    const returnNo = nextDocNo(state.purchaseReturns.map((item) => item.returnNo), 'PR-')
    const date = nowIso()
    let inventory = state.inventory
    let movements = state.stockMovements
    const items = returning.map((row) => {
      const line = purchase.items.find((item) => item.productId === row.productId)!
      const applied = addMovement(movements, inventory, {
        date,
        reference: returnNo,
        productId: row.productId,
        warehouseId: purchase.warehouseId,
        type: 'purchase_return',
        stockIn: 0,
        stockOut: row.qty,
        notes: input.reason,
      })
      inventory = applied.inventory
      movements = applied.movements
      return { productId: row.productId, qty: row.qty, price: line.price }
    })
    const total = round2(items.reduce((sum, item) => sum + item.qty * item.price, 0))
    const purchases = state.purchases.map((item) => {
      if (item.id !== purchase.id) return item
      const nextItems = item.items.map((line) => {
        const ret = returning.find((row) => row.productId === line.productId)
        return ret ? { ...line, returnedQty: line.returnedQty + ret.qty } : line
      })
      return { ...item, items: nextItems }
    })
    setData({
      purchases,
      inventory,
      stockMovements: movements,
      purchaseReturns: [
        {
          id: uid('pret'),
          returnNo,
          date,
          purchaseId: purchase.id,
          warehouseId: purchase.warehouseId,
          items,
          reason: input.reason,
          total,
        },
        ...state.purchaseReturns,
      ],
    })
    toast('Purchase return processed', returnNo)
    return returnNo
  },

  recordPayment(input: {
    kind: 'customer' | 'supplier'
    invoiceId: string
    method: PaymentMethod
    amount: number
  }) {
    if (input.amount <= 0) {
      toast('Enter an amount', undefined, 'warning')
      return false
    }
    if (input.kind === 'customer') {
      const sale = state.sales.find((item) => item.id === input.invoiceId)
      if (!sale || sale.balance <= 0) {
        toast('Nothing to collect', undefined, 'info')
        return false
      }
      const amount = Math.min(input.amount, sale.balance)
      const paid = round2(sale.paid + amount)
      const balance = round2(sale.total - paid)
      const payment = {
        id: uid('pay'),
        paymentNo: nextDocNo(state.payments.map((p) => p.paymentNo), 'PAY-'),
        date: nowIso(),
        partyType: 'customer' as const,
        partyId: sale.customerId,
        invoiceId: sale.id,
        invoiceNo: sale.invoiceNo,
        method: input.method,
        amount,
        status: 'completed' as const,
      }
      setData({
        sales: state.sales.map((item) =>
          item.id === sale.id
            ? { ...item, paid, balance, status: balance <= 0 ? 'paid' : 'partial', paymentMethod: input.method }
            : item,
        ),
        payments: [payment, ...state.payments],
      })
      toast('Payment recorded', `${payment.paymentNo} · ${sale.invoiceNo}`)
      return true
    }
    const purchase = state.purchases.find((item) => item.id === input.invoiceId)
    if (!purchase || purchase.balance <= 0) {
      toast('Nothing to pay', undefined, 'info')
      return false
    }
    const amount = Math.min(input.amount, purchase.balance)
    const paid = round2(purchase.paid + amount)
    const balance = round2(purchase.total - paid)
    const payment = {
      id: uid('pay'),
      paymentNo: nextDocNo(state.payments.map((p) => p.paymentNo), 'PAY-'),
      date: nowIso(),
      partyType: 'supplier' as const,
      partyId: purchase.supplierId,
      invoiceId: purchase.id,
      invoiceNo: purchase.purchaseNo,
      method: input.method,
      amount,
      status: 'completed' as const,
    }
    setData({
      purchases: state.purchases.map((item) =>
        item.id === purchase.id ? { ...item, paid, balance, status: balance <= 0 ? 'paid' : 'partial' } : item,
      ),
      payments: [payment, ...state.payments],
    })
    toast('Supplier payment recorded', payment.paymentNo)
    return true
  },

  createExpense(input: {
    date: string
    category: ExpenseCategory
    description: string
    amount: number
    paymentMethod: PaymentMethod
    notes: string
  }) {
    if (!input.description || input.amount <= 0) {
      toast('Enter description and amount', undefined, 'warning')
      return null
    }
    const expense: Expense = { id: uid('exp'), ...input }
    setData({ expenses: [expense, ...state.expenses] })
    toast('Expense added', input.description)
    return expense
  },
}

export type MockApi = typeof db
