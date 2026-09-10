import { createSeedData, CURRENT_USER } from '@/data/seed'
import { bomLinesForQty, consumptionCost, hasShortage, materialAvailability } from '@/features/manufacturing/helpers'
import { buildSessionPlan, canEditCompleted, canEditSession, currentUser, mergePicking } from '@/features/manufacturing/sessionPlan'
import type {
  AppData,
  AppState,
  AdjustmentType,
  BomInput,
  DrawerState,
  Expense,
  ExpenseCategory,
  InventoryRow,
  LineItem,
  MovementType,
  PaymentMethod,
  ProductInput,
  ProductionInput,
  ProductionWastage,
  PurchaseInput,
  PurchaseStatus,
  QuickModal,
  SaleInput,
  SaleStatus,
  Settings,
  StockStatus,
  ToastTone,
  UiState,
  WastageKind,
} from '@/types'
import { nextDocNo, PROTOTYPE_TODAY, round2, stockStatus, uid } from '@/utils/format'

const STORAGE_KEY = 'stockflow-prototype-v5'

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
  currentUserId: 'u-admin',
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
    skipInventory?: boolean
  },
) {
  const current = inventory.find((row) => row.productId === input.productId && row.warehouseId === input.warehouseId)?.qty ?? 0
  const balance = input.skipInventory ? current : round2(current + input.stockIn - input.stockOut)
  const nextInventory = input.skipInventory
    ? inventory
    : inventory.some((row) => row.productId === input.productId && row.warehouseId === input.warehouseId)
      ? inventory.map((row) =>
          row.productId === input.productId && row.warehouseId === input.warehouseId ? { ...row, qty: balance } : row,
        )
      : [...inventory, { productId: input.productId, warehouseId: input.warehouseId, qty: balance }]
  const actor = state.users.find((user) => user.id === state.ui.currentUserId)?.name ?? CURRENT_USER.name
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
    user: actor,
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
  switchUser(currentUserId: string) {
    const user = state.users.find((item) => item.id === currentUserId)
    if (!user) return
    setUi({ currentUserId })
    toast('Viewing as ' + user.name, user.role === 'manager' ? 'Supervisor' : user.role, 'info')
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

  createBom(input: BomInput) {
    if (!input.productId || !input.items.length) {
      toast('Add components', 'A BOM needs a finished product and at least one material.', 'warning')
      return null
    }
    const product = productById(input.productId)
    const bom = {
      id: uid('bom'),
      name: input.name || `${product?.name ?? 'Product'} BOM`,
      productId: input.productId,
      outputQty: input.outputQty,
      outputUnit: input.outputUnit || product?.unit || 'KG',
      bulkYieldGrams: input.bulkYieldGrams,
      status: 'active' as const,
      notes: input.notes,
      items: input.items.filter((item) => item.qty > 0).map((item) => ({
        id: uid('bi'),
        productId: item.productId,
        qty: item.qty,
        unit: item.unit,
        wastagePct: item.wastagePct,
        notes: item.notes,
      })),
    }
    setData({ boms: [bom, ...state.boms] })
    toast('BOM created', bom.name)
    return bom
  },

  updateBom(id: string, input: BomInput) {
    const existing = state.boms.find((bom) => bom.id === id)
    if (!existing) return
    setData({
      boms: state.boms.map((bom) =>
        bom.id === id
          ? {
              ...bom,
              name: input.name,
              productId: input.productId,
              outputQty: input.outputQty,
              outputUnit: input.outputUnit,
              bulkYieldGrams: input.bulkYieldGrams ?? bom.bulkYieldGrams,
              notes: input.notes,
              items: input.items.filter((item) => item.qty > 0).map((item) => ({
                id: uid('bi'),
                productId: item.productId,
                qty: item.qty,
                unit: item.unit,
                wastagePct: item.wastagePct,
                notes: item.notes,
              })),
            }
          : bom,
      ),
    })
    toast('BOM updated')
  },

  setBomStatus(id: string, status: 'active' | 'inactive') {
    setData({
      boms: state.boms.map((bom) => (bom.id === id ? { ...bom, status } : bom)),
    })
    toast(status === 'inactive' ? 'BOM deactivated' : 'BOM activated')
  },

  createProductionOrder(input: ProductionInput) {
    const bom = state.boms.find((item) => item.id === input.bomId)
    const product = productById(input.productId)
    if (!bom || !product) {
      toast('Select product and BOM', undefined, 'warning')
      return null
    }
    if (input.plannedQty <= 0) {
      toast('Enter a planned quantity', undefined, 'warning')
      return null
    }
    const consumptions = bomLinesForQty(bom, input.plannedQty)
    const sku = (product.sku.match(/[A-Za-z]+/)?.[0] ?? 'FG').slice(0, 4).toUpperCase()
    const stamp = '20260910'
    const seq = String(state.productionOrders.length + 1).padStart(3, '0')
    const order = {
      id: uid('po'),
      orderNo: nextDocNo(state.productionOrders.map((item) => item.orderNo), 'PO-', 4),
      date: nowIso(),
      productId: input.productId,
      bomId: input.bomId,
      warehouseId: input.warehouseId,
      plannedQty: input.plannedQty,
      actualQty: 0,
      unit: product.unit,
      plannedStart: input.plannedStart,
      plannedEnd: input.plannedEnd,
      status: input.status ?? 'planned',
      batchNo: `${sku}-2026-${stamp.slice(4)}-${seq}`,
      expiryDate: '2027-03-10',
      operator: input.operator || CURRENT_USER.name,
      notes: input.notes,
      consumptions,
      wastage: [],
      consumptionConfirmed: false,
      posted: false,
      costEstimate: consumptionCost(state, consumptions),
    }
    setData({ productionOrders: [order, ...state.productionOrders] })
    toast('Production order created', order.orderNo)
    return order
  },

  updateProductionOrder(id: string, patch: Partial<ProductionInput> & { plannedQty?: number; bomId?: string }) {
    const order = state.productionOrders.find((item) => item.id === id)
    if (!order || order.posted || order.status === 'completed' || order.status === 'cancelled') {
      toast('This order can no longer be edited', undefined, 'warning')
      return
    }
    const bomId = patch.bomId ?? order.bomId
    const plannedQty = patch.plannedQty ?? order.plannedQty
    const bom = state.boms.find((item) => item.id === bomId)
    const consumptions = bom ? bomLinesForQty(bom, plannedQty) : order.consumptions
    setData({
      productionOrders: state.productionOrders.map((item) =>
        item.id === id
          ? {
              ...item,
              productId: patch.productId ?? item.productId,
              bomId,
              warehouseId: patch.warehouseId ?? item.warehouseId,
              plannedQty,
              plannedStart: patch.plannedStart ?? item.plannedStart,
              plannedEnd: patch.plannedEnd ?? item.plannedEnd,
              operator: patch.operator ?? item.operator,
              notes: patch.notes ?? item.notes,
              unit: productById(patch.productId ?? item.productId)?.unit ?? item.unit,
              consumptions,
              consumptionConfirmed: false,
              costEstimate: consumptionCost(state, consumptions),
            }
          : item,
      ),
    })
    toast('Production order updated')
  },

  startProduction(id: string, options?: { ignoreShortage?: boolean }) {
    const order = state.productionOrders.find((item) => item.id === id)
    if (!order || order.posted) return false
    if (order.status === 'cancelled' || order.status === 'completed') return false
    const rows = materialAvailability(state, order.warehouseId, order.consumptions)
    if (hasShortage(rows) && !options?.ignoreShortage) {
      toast('Material shortage', 'Resolve shortages or create a purchase request before starting.', 'danger')
      return false
    }
    if (hasShortage(rows) && options?.ignoreShortage) {
      toast('Started with shortage', 'Prototype allowed start despite missing materials.', 'warning')
    }
    setData({
      productionOrders: state.productionOrders.map((item) =>
        item.id === id
          ? { ...item, status: 'in_progress' as const, actualStart: item.actualStart ?? nowIso() }
          : item,
      ),
    })
    toast('Production started', order.orderNo)
    return true
  },

  pauseProduction(id: string) {
    const order = state.productionOrders.find((item) => item.id === id)
    if (!order || order.status !== 'in_progress') {
      toast('Only in-progress orders can be paused', undefined, 'info')
      return
    }
    setData({
      productionOrders: state.productionOrders.map((item) => (item.id === id ? { ...item, status: 'paused' as const } : item)),
    })
    toast('Production paused', order.orderNo, 'info')
  },

  resumeProduction(id: string) {
    const order = state.productionOrders.find((item) => item.id === id)
    if (!order || order.status !== 'paused') return
    setData({
      productionOrders: state.productionOrders.map((item) => (item.id === id ? { ...item, status: 'in_progress' as const } : item)),
    })
    toast('Production resumed', order.orderNo)
  },

  cancelProduction(id: string) {
    const order = state.productionOrders.find((item) => item.id === id)
    if (!order || order.posted || order.status === 'completed') {
      toast('Completed orders cannot be cancelled', undefined, 'warning')
      return
    }
    setData({
      productionOrders: state.productionOrders.map((item) => (item.id === id ? { ...item, status: 'cancelled' as const } : item)),
    })
    toast('Production cancelled', order.orderNo, 'warning')
  },

  updateConsumption(id: string, lines: Array<{ productId: string; actualQty: number; notes?: string }>) {
    const order = state.productionOrders.find((item) => item.id === id)
    if (!order || order.posted) return
    const consumptions = order.consumptions.map((line) => {
      const next = lines.find((item) => item.productId === line.productId)
      return next ? { ...line, actualQty: next.actualQty, notes: next.notes ?? line.notes } : line
    })
    setData({
      productionOrders: state.productionOrders.map((item) =>
        item.id === id
          ? { ...item, consumptions, consumptionConfirmed: false, costEstimate: consumptionCost(state, consumptions) }
          : item,
      ),
    })
  },

  addConsumptionLine(id: string, productId: string, qty: number) {
    const order = state.productionOrders.find((item) => item.id === id)
    const product = productById(productId)
    if (!order || !product || order.posted) return
    if (order.consumptions.some((line) => line.productId === productId)) {
      toast('Material already on this order', undefined, 'info')
      return
    }
    const consumptions = [
      ...order.consumptions,
      { productId, expectedQty: 0, actualQty: qty, unit: product.unit, notes: 'Extra material' },
    ]
    setData({
      productionOrders: state.productionOrders.map((item) =>
        item.id === id ? { ...item, consumptions, consumptionConfirmed: false, costEstimate: consumptionCost(state, consumptions) } : item,
      ),
    })
    toast('Extra material added', product.name)
  },

  confirmConsumption(id: string) {
    const order = state.productionOrders.find((item) => item.id === id)
    if (!order || order.posted) return
    setData({
      productionOrders: state.productionOrders.map((item) => (item.id === id ? { ...item, consumptionConfirmed: true } : item)),
    })
    toast('Consumption confirmed', order.orderNo)
  },

  recordWastage(id: string, input: { kind: WastageKind; productId?: string; qty: number; unit: string; reason: string; notes: string }) {
    const order = state.productionOrders.find((item) => item.id === id)
    if (!order || order.status === 'cancelled') return
    if (input.qty <= 0) {
      toast('Enter a wastage quantity', undefined, 'warning')
      return
    }
    const row: ProductionWastage = { id: uid('wst'), ...input }
    setData({
      productionOrders: state.productionOrders.map((item) => (item.id === id ? { ...item, wastage: [...item.wastage, row] } : item)),
    })
    toast('Wastage recorded')
  },

  completeProduction(id: string, input: { actualQty: number; batchNo: string; expiryDate?: string }) {
    const order = state.productionOrders.find((item) => item.id === id)
    if (!order) return false
    if (order.posted || order.status === 'completed') {
      toast('Already posted', undefined, 'info')
      return false
    }
    if (order.status !== 'in_progress' && order.status !== 'paused') {
      toast('Start production first', undefined, 'warning')
      return false
    }
    if (input.actualQty <= 0) {
      toast('Enter actual quantity', undefined, 'warning')
      return false
    }
    if (!state.settings.allowNegativeStock) {
      for (const line of order.consumptions) {
        const available = getQty(line.productId, order.warehouseId)
        if (line.actualQty > available) {
          const product = productById(line.productId)
          toast('Insufficient material', `${product?.name ?? 'Item'} has ${available} ${line.unit}.`, 'danger')
          return false
        }
      }
    }
    const date = nowIso()
    let inventory = state.inventory
    let movements = state.stockMovements
    for (const line of order.consumptions) {
      if (line.actualQty <= 0) continue
      const applied = addMovement(movements, inventory, {
        date,
        reference: order.orderNo,
        productId: line.productId,
        warehouseId: order.warehouseId,
        type: 'production_out',
        stockIn: 0,
        stockOut: line.actualQty,
        notes: 'Material consumption',
      })
      inventory = applied.inventory
      movements = applied.movements
    }
    const fgIn = addMovement(movements, inventory, {
      date,
      reference: order.orderNo,
      productId: order.productId,
      warehouseId: order.warehouseId,
      type: 'production_in',
      stockIn: input.actualQty,
      stockOut: 0,
      notes: 'Finished goods',
    })
    inventory = fgIn.inventory
    movements = fgIn.movements
    const yieldLoss = round2(Math.max(0, order.plannedQty - input.actualQty))
    const batchNo = input.batchNo || order.batchNo
    const batches = [
      {
        id: uid('bch'),
        productId: order.productId,
        warehouseId: order.warehouseId,
        batchNo,
        qty: input.actualQty,
        expiry: input.expiryDate,
        productionDate: date,
        productionOrderId: order.id,
      },
      ...state.batches,
    ]
    const wastage = yieldLoss > 0 && !order.wastage.some((row) => row.kind === 'yield_variance')
      ? [...order.wastage, { id: uid('wst'), kind: 'yield_variance' as const, productId: order.productId, qty: yieldLoss, unit: order.unit, reason: 'Yield variance', notes: '' }]
      : order.wastage
    setData({
      inventory,
      stockMovements: movements,
      batches,
      productionOrders: state.productionOrders.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'completed' as const,
              posted: true,
              consumptionConfirmed: true,
              actualQty: input.actualQty,
              actualEnd: date,
              batchNo,
              expiryDate: input.expiryDate,
              wastage,
              costEstimate: consumptionCost(state, item.consumptions),
            }
          : item,
      ),
    })
    notify('production', 'Production completed', `${order.orderNo} posted ${input.actualQty} ${order.unit} (${batchNo}).`, '/manufacturing/history')
    for (const line of order.consumptions) {
      const qty = inventory.find((row) => row.productId === line.productId && row.warehouseId === order.warehouseId)?.qty ?? 0
      maybeStockAlerts(line.productId, order.warehouseId, qty)
    }
    emit()
    toast('Production completed', `${order.orderNo} · ${batchNo}`)
    return true
  },

  createPurchaseRequest(orderId: string) {
    const order = state.productionOrders.find((item) => item.id === orderId)
    if (!order) return
    const rows = materialAvailability(state, order.warehouseId, order.consumptions).filter((row) => row.shortage > 0)
    if (!rows.length) {
      toast('No shortages', 'All materials are available.', 'info')
      return
    }
    const names = rows
      .map((row) => `${productById(row.productId)?.name ?? 'Material'} ${row.shortage} ${row.unit}`)
      .join(', ')
    notify('production', 'Purchase request (preview)', `PRQ created for ${order.orderNo}: ${names}`, '/purchases/new')
    toast('Purchase request created', 'Preview only — not sent to Purchases yet.', 'info')
  },

  acceptSession(id: string) {
    const session = state.productionSessions.find((item) => item.id === id)
    const user = currentUser(state)
    if (!session || session.status !== 'planned') {
      toast('Only a planned session can be accepted', undefined, 'warning')
      return
    }
    if (!canEditSession(user.role, session.status)) {
      toast('Permission denied', undefined, 'danger')
      return
    }
    setData({
      productionSessions: state.productionSessions.map((item) =>
        item.id === id ? { ...item, status: 'accepted' as const, acceptedBy: user.name, acceptedAt: nowIso() } : item,
      ),
    })
    toast('Production accepted', session.reference)
  },

  startSession(id: string, input: { recipePhoto: string; recipePhotoName: string }) {
    const session = state.productionSessions.find((item) => item.id === id)
    const user = currentUser(state)
    if (!session || (session.status !== 'accepted' && session.status !== 'planned')) {
      toast('Accept production before starting', undefined, 'warning')
      return false
    }
    if (session.status === 'planned') {
      toast('Accept production first', undefined, 'warning')
      return false
    }
    if (!canEditSession(user.role, session.status)) {
      toast('Permission denied', undefined, 'danger')
      return false
    }
    if (!input.recipePhoto) {
      toast('Upload recipe photo', 'Photograph the process-room recipe sheet. It is evidence only — BOM stays the source of requirements.', 'warning')
      return false
    }
    const plan = buildSessionPlan(state, session)
    setData({
      productionSessions: state.productionSessions.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'in_progress' as const,
              startedBy: user.name,
              startedAt: nowIso(),
              recipePhoto: input.recipePhoto,
              recipePhotoName: input.recipePhotoName,
              uploadedBy: user.name,
              uploadedAt: nowIso(),
              picking: plan.picking,
            }
          : item,
      ),
    })
    toast('Production started', 'Picking list is ready.')
    return true
  },

  changeSessionTarget(id: string, productId: string, newTarget: number, reason: string) {
    const session = state.productionSessions.find((item) => item.id === id)
    const user = currentUser(state)
    if (!session) return
    if (session.status === 'completed') {
      toast('Completed sessions cannot change target here', 'Admin can edit completed records separately.', 'warning')
      return
    }
    if (!canEditSession(user.role, session.status)) {
      toast('Permission denied', undefined, 'danger')
      return
    }
    if (!reason.trim()) {
      toast('Enter a reason', 'Target changes must be explained.', 'warning')
      return
    }
    if (newTarget <= 0) {
      toast('Target must be greater than zero', undefined, 'warning')
      return
    }
    const line = session.items.find((item) => item.productId === productId)
    if (!line || line.targetQty === newTarget) return
    const updatedItems = session.items.map((item) =>
      item.productId === productId ? { ...item, targetQty: newTarget } : item,
    )
    const nextSession = { ...session, items: updatedItems }
    const plan = buildSessionPlan(state, nextSession)
    const merged = mergePicking(session.picking, plan.picking)
    const log = {
      id: uid('tcl'),
      sessionId: id,
      productId,
      originalTarget: line.targetQty,
      newTarget,
      reason: reason.trim(),
      changedBy: user.name,
      changedAt: nowIso(),
    }
    setData({
      productionSessions: state.productionSessions.map((item) =>
        item.id === id
          ? {
              ...item,
              items: updatedItems,
              picking: merged.picking,
              targetChanges: [...item.targetChanges, log],
              excessReturns: [
                ...item.excessReturns,
                ...merged.excess.map((row) => ({
                  id: uid('ex'),
                  productId: row.productId,
                  qty: row.qty,
                  unit: row.unit,
                  status: 'to_return' as const,
                  notes: `Target change ${line.targetQty} → ${newTarget}`,
                })),
              ],
            }
          : item,
      ),
    })
    toast('Target updated', `${productById(productId)?.name}: ${line.targetQty} → ${newTarget}`)
  },

  togglePickingLine(id: string, lineId: string, picked?: boolean) {
    const session = state.productionSessions.find((item) => item.id === id)
    if (!session || session.status !== 'in_progress') {
      toast('Picking is only for in-progress sessions', undefined, 'info')
      return
    }
    setData({
      productionSessions: state.productionSessions.map((item) =>
        item.id === id
          ? {
              ...item,
              picking: item.picking.map((line) =>
                line.id === lineId ? { ...line, picked: picked ?? !line.picked } : line,
              ),
            }
          : item,
      ),
    })
  },

  completeSession(
    id: string,
    results: Array<{
      productId: string
      actualQty: number
      productionBalanceQty: number
      balanceLocation: string
      balanceContainer: string
      wasteQty: number
      shortProductionReason: string
      notes: string
    }>,
  ) {
    const session = state.productionSessions.find((item) => item.id === id)
    const user = currentUser(state)
    if (!session || session.status !== 'in_progress') {
      toast('Start production first', undefined, 'warning')
      return false
    }
    if (!canEditSession(user.role, session.status)) {
      toast('Permission denied', undefined, 'danger')
      return false
    }
    if (session.posted) {
      toast('Already posted', undefined, 'info')
      return false
    }
    for (const item of session.items) {
      const result = results.find((row) => row.productId === item.productId)
      if (!result || result.actualQty < 0) {
        toast('Enter actual quantity for every product', undefined, 'warning')
        return false
      }
      if (result.productionBalanceQty > 0 && (!result.balanceLocation || !result.balanceContainer)) {
        toast('Storage and box required', 'Production balance must have a location and container.', 'warning')
        return false
      }
      if (result.actualQty < item.targetQty && !result.shortProductionReason) {
        toast('Select a reason', `${productById(item.productId)?.name} is below target.`, 'warning')
        return false
      }
    }
    const items = session.items.map((item) => {
      const result = results.find((row) => row.productId === item.productId)!
      return {
        ...item,
        actualQty: result.actualQty,
        productionBalanceQty: result.productionBalanceQty,
        balanceLocation: result.balanceLocation,
        balanceContainer: result.balanceContainer,
        wasteQty: result.wasteQty,
        shortProductionQty: Math.max(0, item.targetQty - result.actualQty),
        shortProductionReason: result.shortProductionReason,
        notes: result.notes,
      }
    })
    const working = { ...session, items }
    const plan = buildSessionPlan(state, working)
    const date = nowIso()
    let inventory = state.inventory
    let movements = state.stockMovements
    let balances = state.productionBalances
    const apply = (input: Parameters<typeof addMovement>[2]) => {
      const next = addMovement(movements, inventory, input)
      inventory = next.inventory
      movements = next.movements
    }

    for (const req of plan.products) {
      for (const alloc of req.balanceUsed) {
        balances = balances.map((row) => {
          if (row.id !== alloc.balanceId) return row
          const qty = round2(row.quantity - alloc.qty)
          return { ...row, quantity: Math.max(0, qty), status: qty <= 0.001 ? 'consumed' as const : row.status }
        })
        apply({
          date,
          reference: session.reference,
          productId: req.productId,
          warehouseId: session.warehouseId,
          type: 'production_balance_out',
          stockIn: 0,
          stockOut: alloc.qty,
          notes: `Use production balance ${alloc.container}`,
          skipInventory: true,
        })
      }
    }

    for (const raw of plan.consolidatedRaw) {
      if (raw.qty <= 0) continue
      apply({
        date,
        reference: session.reference,
        productId: raw.productId,
        warehouseId: session.warehouseId,
        type: 'production_out',
        stockIn: 0,
        stockOut: raw.qty,
        notes: 'Consolidated material consumption',
      })
    }

    for (const item of items) {
      if (item.actualQty > 0) {
        apply({
          date,
          reference: session.reference,
          productId: item.productId,
          warehouseId: session.warehouseId,
          type: 'production_in',
          stockIn: item.actualQty,
          stockOut: 0,
          notes: 'Finished goods packs',
        })
      }
      if (item.productionBalanceQty > 0) {
        balances = [
          {
            id: uid('pb'),
            productId: item.productId,
            quantity: item.productionBalanceQty,
            unit: 'g',
            location: item.balanceLocation,
            container: item.balanceContainer,
            warehouseId: session.warehouseId,
            productionDate: date,
            productionReference: session.reference,
            status: 'available' as const,
          },
          ...balances,
        ]
        apply({
          date,
          reference: session.reference,
          productId: item.productId,
          warehouseId: session.warehouseId,
          type: 'production_balance_in',
          stockIn: item.productionBalanceQty,
          stockOut: 0,
          notes: `Production balance ${item.balanceContainer}`,
          skipInventory: true,
        })
      }
      if (item.wasteQty > 0) {
        apply({
          date,
          reference: session.reference,
          productId: 'p-pouch',
          warehouseId: session.warehouseId,
          type: 'production_wastage',
          stockIn: 0,
          stockOut: 0,
          notes: `Packaging waste ${item.wasteQty}g · ${productById(item.productId)?.name}`,
          skipInventory: true,
        })
      }
    }

    setData({
      inventory,
      stockMovements: movements,
      productionBalances: balances,
      productionSessions: state.productionSessions.map((item) =>
        item.id === id
          ? {
              ...item,
              items,
              status: 'completed' as const,
              posted: true,
              completedBy: user.name,
              completedAt: date,
              picking: plan.picking.map((line) => ({ ...line, picked: true })),
            }
          : item,
      ),
    })
    notify('production', 'Production completed', `${session.reference} posted.`, '/manufacturing/history')
    emit()
    toast('Production completed', session.reference)
    return true
  },

  editCompletedSession(
    id: string,
    productId: string,
    field: 'actualQty' | 'productionBalanceQty' | 'wasteQty',
    newValue: number,
    reason: string,
  ) {
    const session = state.productionSessions.find((item) => item.id === id)
    const user = currentUser(state)
    if (!session || session.status !== 'completed') {
      toast('Only completed sessions use this edit', undefined, 'warning')
      return false
    }
    if (!canEditCompleted(user.role)) {
      toast('Permission denied', 'Only Admin or Owner can edit completed production.', 'danger')
      return false
    }
    if (!reason.trim()) {
      toast('Reason is required', undefined, 'warning')
      return false
    }
    const item = session.items.find((row) => row.productId === productId)
    if (!item) return false
    const original = item[field]
    if (original === newValue) return false
    const date = nowIso()
    let inventory = state.inventory
    let movements = state.stockMovements
    let balances = state.productionBalances
    const apply = (input: Parameters<typeof addMovement>[2]) => {
      const next = addMovement(movements, inventory, input)
      inventory = next.inventory
      movements = next.movements
    }
    const diff = round2(newValue - original)
    if (field === 'actualQty' && diff !== 0) {
      apply({
        date,
        reference: `${session.reference} adj`,
        productId,
        warehouseId: session.warehouseId,
        type: 'adjustment',
        stockIn: diff > 0 ? diff : 0,
        stockOut: diff < 0 ? -diff : 0,
        notes: `Completed production edit · ${reason.trim()}`,
      })
    }
    if (field === 'productionBalanceQty') {
      const existing = balances.find((row) => row.productionReference === session.reference && row.productId === productId && row.status === 'available')
      if (existing) {
        const qty = round2(existing.quantity + diff)
        balances = balances.map((row) => (row.id === existing.id ? { ...row, quantity: Math.max(0, qty), status: qty <= 0 ? 'consumed' as const : 'available' as const } : row))
      } else if (newValue > 0) {
        balances = [
          {
            id: uid('pb'),
            productId,
            quantity: newValue,
            unit: 'g',
            location: item.balanceLocation || 'Main Warehouse',
            container: item.balanceContainer || 'Box 1',
            warehouseId: session.warehouseId,
            productionDate: date,
            productionReference: session.reference,
            status: 'available' as const,
          },
          ...balances,
        ]
      }
      apply({
        date,
        reference: `${session.reference} adj`,
        productId,
        warehouseId: session.warehouseId,
        type: diff >= 0 ? 'production_balance_in' : 'production_balance_out',
        stockIn: diff > 0 ? diff : 0,
        stockOut: diff < 0 ? -diff : 0,
        notes: `Balance edit · ${reason.trim()}`,
        skipInventory: true,
      })
    }
    if (field === 'wasteQty' && diff !== 0) {
      apply({
        date,
        reference: `${session.reference} adj`,
        productId: 'p-pouch',
        warehouseId: session.warehouseId,
        type: 'production_wastage',
        stockIn: 0,
        stockOut: 0,
        notes: `Waste edit ${original}g → ${newValue}g · ${productById(productId)?.name} · ${reason.trim()}`,
        skipInventory: true,
      })
    }
    const log = {
      id: uid('cel'),
      sessionId: id,
      productId,
      field,
      originalValue: String(original),
      newValue: String(newValue),
      reason: reason.trim(),
      editedBy: user.name,
      editedAt: date,
    }
    setData({
      inventory,
      stockMovements: movements,
      productionBalances: balances,
      productionSessions: state.productionSessions.map((row) =>
        row.id === id
          ? {
              ...row,
              items: row.items.map((line) => {
                if (line.productId !== productId) return line
                const next = { ...line, [field]: newValue }
                if (field === 'actualQty') next.shortProductionQty = Math.max(0, line.targetQty - newValue)
                return next
              }),
              completedEdits: [...row.completedEdits, log],
            }
          : row,
      ),
    })
    toast('Completed production updated', 'Audit log recorded.')
    return true
  },

  createDailySession(input: { productionDate: string; items: Array<{ productId: string; targetQty: number }>; notes?: string }) {
    if (!input.items.length) {
      toast('Add products to the daily plan', undefined, 'warning')
      return null
    }
    const user = currentUser(state)
    const stamp = input.productionDate.replaceAll('-', '')
    const seq = String(state.productionSessions.filter((item) => item.productionDate === input.productionDate).length + 1).padStart(3, '0')
    const id = uid('ps')
    const session = {
      id,
      productionDate: input.productionDate,
      reference: `PROD-${stamp}-${seq}`,
      status: 'planned' as const,
      warehouseId: state.settings.defaultWarehouseId,
      createdBy: user.name,
      createdAt: nowIso(),
      acceptedBy: '',
      acceptedAt: '',
      startedBy: '',
      startedAt: '',
      completedBy: '',
      completedAt: '',
      recipePhoto: '',
      recipePhotoName: '',
      uploadedBy: '',
      uploadedAt: '',
      notes: input.notes ?? '',
      items: input.items.map((row) => {
        const bom = state.boms.find((item) => item.productId === row.productId && item.status === 'active')
        return {
          id: uid('psi'),
          sessionId: id,
          productId: row.productId,
          bomId: bom?.id ?? '',
          originalTargetQty: row.targetQty,
          targetQty: row.targetQty,
          actualQty: 0,
          shortProductionQty: 0,
          shortProductionReason: '',
          productionBalanceQty: 0,
          balanceLocation: 'Main Warehouse',
          balanceContainer: '',
          wasteQty: 0,
          wasteReason: '',
          notes: '',
        }
      }),
      picking: [],
      excessReturns: [],
      targetChanges: [],
      completedEdits: [],
      posted: false,
    }
    setData({ productionSessions: [session, ...state.productionSessions] })
    toast('Daily production created', session.reference)
    return session
  },
}

export type MockApi = typeof db
