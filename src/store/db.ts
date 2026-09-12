import { createSeedData, CURRENT_USER } from '@/data/seed'
import {
  applyDisplayDelta,
  createMainWarehouseLayout,
  DISPLAY_STOCK_DESTINATION,
  generateGenericSlots,
  generateRackSlots,
  nextGenericSlot,
  migrateFinishedGoodsStorage,
  seedWarehouseOccupancy,
  unplacedPacks,
  WAREHOUSE_MAP_KEYS,
} from '@/features/warehouse/warehouseModel'
import { AGENT_PERMISSION_KEYS, agentLinkedWarehouseName, companyWarehouses, isAgentWarehouseId, isCompanyWarehouseId, nextAgentWarehouseId } from '@/features/agent/agentModel'
import { bomLinesForQty, consumptionCost, hasShortage, materialAvailability } from '@/features/manufacturing/helpers'
import { buildSessionPlan, canEditSession, currentUser, mergePicking } from '@/features/manufacturing/sessionPlan'
import {
  defaultPermissionsForLegacy,
  displayRoleName,
  emptyPermissions,
  hasPermission,
  isOwnerRole,
  isOwnerUser,
  normalizePermissions,
  roleById,
  roleName,
} from '@/features/settings/permissions'
import {
  canAssignRole,
  canChangeUserRole,
  canCreateRole,
  canCreateUser,
  canDeactivateRole,
  canDeactivateUser,
  canEditRoleRecord,
  canEditUserRecord,
  canManagePermissions,
  canRenameRole,
} from '@/features/settings/userPermissions'
import { buildDocumentLines, DEFAULT_DOCUMENT_TERMS, defaultDueDate, totalsFromLines } from '@/features/documents/documentModel'
import type {
  AppData,
  AppState,
  AdjustmentType,
  Agent,
  AgentInput,
  AgentStatus,
  BomInput,
  DeliveryOrder,
  DeliveryOrderInput,
  DeliveryOrderStatus,
  DocumentAuditAction,
  DocumentAuditLog,
  DrawerState,
  Expense,
  ExpenseCategory,
  InventoryRow,
  LineItem,
  MovementType,
  PaymentMethod,
  PermissionKey,
  ProductInput,
  ProductionInput,
  ProductionWastage,
  PurchaseInput,
  PurchaseStatus,
  QuickModal,
  Quotation,
  QuotationInput,
  QuotationStatus,
  Role,
  RolePermissions,
  RoleStatus,
  SaleInput,
  SaleStatus,
  Settings,
  StockStatus,
  StorageLocationType,
  ToastTone,
  UiState,
  User,
  UserAuditAction,
  UserAuditLog,
  UserStatus,
  WastageKind,
  BalanceUsageReason,
} from '@/types'
import { nextDatedDocNo, nextDocNo, PROTOTYPE_TODAY, formatQty, round2, stockStatus, uid } from '@/utils/format'

const STORAGE_KEY = 'stockflow-prototype-v8'

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

function loadPersisted(): { data: AppData; currentUserId?: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { version?: number; data?: AppData & { ui?: UiState }; currentUserId?: string }
    if (parsed.version !== 1 || !parsed.data?.products) return null
    const { ui: _ignored, ...data } = parsed.data
    return { data: data as AppData, currentUserId: parsed.currentUserId ?? parsed.data.ui?.currentUserId }
  } catch {
    return null
  }
}

function persist(data: AppData) {
  try {
    const { ui: _ignored, ...rest } = data as AppData & { ui?: UiState }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, data: rest, currentUserId: state.ui.currentUserId }),
    )
  } catch {
    /* ignore quota */
  }
}

function hydrateData(data: AppData): AppData {
  const seedLayout = createMainWarehouseLayout('2026-09-08T09:15:00+08:00')
  const seedOccupancy = seedWarehouseOccupancy('2026-09-08T16:15:00+08:00', 'Admin')
  const roles = data.roles ?? seed.roles
  const roleMatrix = Object.fromEntries(
    roles.map((role) => {
      const raw = data.settings?.roleMatrix?.[role.id] ?? {}
      const normalized = normalizePermissions(raw)
      const defaults = defaultPermissionsForLegacy(role.legacyRole)
      for (const key of [...WAREHOUSE_MAP_KEYS, ...AGENT_PERMISSION_KEYS]) {
        if (raw[key] === undefined) normalized[key] = defaults[key]
      }
      return [role.id, normalized]
    }),
  )
  const migrated = migrateFinishedGoodsStorage(
    {
      storageLocations: data.storageLocations?.length ? data.storageLocations : seedLayout.storageLocations,
      storageSlots: data.storageSlots?.length ? data.storageSlots : seedLayout.storageSlots,
      slotOccupancies: data.slotOccupancies ?? (data.storageLocations?.length ? [] : seedOccupancy.slotOccupancies),
      displayStocks: data.displayStocks,
    },
    '2026-09-08T16:15:00+08:00',
  )
  return {
    ...data,
    warehouses: (data.warehouses ?? []).map((warehouse) => ({
      ...warehouse,
      kind: warehouse.kind === 'agent' ? 'agent' : 'company',
    })),
    products: (data.products ?? []).map((product) => ({
      ...product,
      agentPrice: product.agentPrice,
    })),
    sales: (data.sales ?? []).map((sale) => ({
      ...sale,
      shipping: sale.shipping ?? 0,
    })),
    agents: data.agents ?? [],
    agentSales: data.agentSales ?? [],
    agentEarningLedgers: data.agentEarningLedgers ?? [],
    agentWithdrawals: data.agentWithdrawals ?? [],
    quotations: data.quotations ?? [],
    deliveryOrders: data.deliveryOrders ?? [],
    documentAuditLogs: data.documentAuditLogs ?? [],
    storageLocations: migrated.storageLocations,
    storageSlots: migrated.storageSlots,
    slotOccupancies: migrated.slotOccupancies,
    displayStocks: migrated.displayStocks,
    placementLogs: data.placementLogs ?? (data.storageLocations?.length ? [] : seedOccupancy.placementLogs),
    balanceUsageLogs: data.balanceUsageLogs ?? [],
    productionSessions: (data.productionSessions ?? []).map((session) => ({
      ...session,
      items: session.items.map((item) => ({
        ...item,
        displayQty: item.displayQty ?? 0,
        cartonQty: item.cartonQty ?? 0,
      })),
    })),
    settings: {
      ...data.settings,
      legalName: data.settings.legalName ?? '',
      logoUrl: data.settings.logoUrl ?? '',
      website: data.settings.website ?? '',
      registrationNo: data.settings.registrationNo ?? '',
      bankName: data.settings.bankName ?? '',
      bankAccount: data.settings.bankAccount ?? '',
      paymentTerms: data.settings.paymentTerms ?? 'Net 7 days',
      documentTerms: data.settings.documentTerms ?? DEFAULT_DOCUMENT_TERMS,
      roleMatrix,
    },
  }
}

let seed = createSeedData()
const loaded = loadPersisted()
let state: AppState = {
  ...hydrateData(loaded?.data ?? cloneData(seed)),
  ui: {
    ...defaultUi(),
    currentUserId: loaded?.currentUserId && (loaded.data.users ?? seed.users).some((user) => user.id === loaded.currentUserId)
      ? loaded.currentUserId
      : 'u-admin',
  },
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
  if ('currentUserId' in patch) persist(state)
  listeners.forEach((listener) => listener())
}

function nowIso() {
  return PROTOTYPE_TODAY.toISOString()
}

function makeAudit(input: {
  action: UserAuditAction
  userId: string
  userName: string
  field: string
  oldValue?: string
  newValue?: string
  changedBy: string
}): UserAuditLog {
  return {
    id: uid('ual'),
    action: input.action,
    userId: input.userId,
    userName: input.userName,
    field: input.field,
    oldValue: input.oldValue ?? '',
    newValue: input.newValue ?? '',
    changedBy: input.changedBy,
    changedAt: nowIso(),
  }
}

function uniqueRoleName(name: string, excludeId?: string) {
  const needle = name.trim().toLowerCase()
  return !state.roles.some((role) => role.id !== excludeId && role.name.trim().toLowerCase() === needle)
}

function makeDocAudit(input: {
  action: DocumentAuditAction
  documentType: DocumentAuditLog['documentType']
  documentId: string
  documentNo: string
  field?: string
  oldValue?: string
  newValue?: string
}): DocumentAuditLog {
  return {
    id: uid('dal'),
    action: input.action,
    documentType: input.documentType,
    documentId: input.documentId,
    documentNo: input.documentNo,
    field: input.field ?? '',
    oldValue: input.oldValue ?? '',
    newValue: input.newValue ?? '',
    changedBy: currentUser(state).name,
    changedAt: nowIso(),
  }
}

function pushDocAudit(log: DocumentAuditLog) {
  return [log, ...(state.documentAuditLogs ?? [])]
}

function getQty(productId: string, warehouseId: string) {
  return state.inventory.find((row) => row.productId === productId && row.warehouseId === warehouseId)?.qty ?? 0
}

function applyWarehouseTransfer(input: {
  fromWarehouseId: string
  toWarehouseId: string
  productId: string
  qty: number
  notes?: string
}) {
  const reference = nextDocNo(
    state.stockMovements.filter((m) => m.reference.startsWith('TRF-')).map((m) => m.reference),
    'TRF-',
    4,
  )
  const date = nowIso()
  const fromName = state.warehouses.find((warehouse) => warehouse.id === input.fromWarehouseId)?.name ?? input.fromWarehouseId
  const toName = state.warehouses.find((warehouse) => warehouse.id === input.toWarehouseId)?.name ?? input.toWarehouseId
  const note = input.notes?.trim()
  const outMove = addMovement(state.stockMovements, state.inventory, {
    date,
    reference,
    productId: input.productId,
    warehouseId: input.fromWarehouseId,
    type: 'transfer_out',
    stockIn: 0,
    stockOut: input.qty,
    notes: [note, `To ${toName}`].filter(Boolean).join(' — '),
  })
  const inMove = addMovement(outMove.movements, outMove.inventory, {
    date,
    reference,
    productId: input.productId,
    warehouseId: input.toWarehouseId,
    type: 'transfer_in',
    stockIn: input.qty,
    stockOut: 0,
    notes: [note, `From ${fromName}`].filter(Boolean).join(' — '),
  })
  setData({ inventory: inMove.inventory, stockMovements: inMove.movements })
  return reference
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
  items: Array<{ productId: string; qty: number; price: number; discount?: number; batchNo?: string; expiry?: string; description?: string }>,
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
    description: item.description,
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
    setUi({ quickModal: null, payInvoiceId: undefined })
  },
  openPaymentForSale(invoiceId: string) {
    setUi({ quickModal: 'payment', payInvoiceId: invoiceId })
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
    if (user.status !== 'active') {
      toast('User is inactive', 'Inactive users cannot be used in the prototype switcher.', 'warning')
      return
    }
    setUi({ currentUserId })
    toast('Viewing as ' + user.name, displayRoleName(state, user), 'info')
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
      state.inventory
        .filter((row) => row.productId === productId && isCompanyWarehouseId(state.warehouses, row.warehouseId))
        .reduce((sum, row) => sum + row.qty, 0),
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
      ...companyWarehouses(state.warehouses).map((warehouse) => ({ productId: product.id, warehouseId: warehouse.id, qty: 0 })),
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

  createCustomer(input: { name: string; phone: string; email: string; address?: string }) {
    const customer = { id: uid('cus'), status: 'active' as const, address: input.address ?? '', ...input }
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

  createAgent(input: AgentInput) {
    if (!hasPermission(state, 'agent.manage')) {
      toast('Permission denied', 'You cannot manage agents.', 'danger')
      return null
    }
    const name = input.name.trim()
    const code = input.code.trim().toUpperCase()
    if (!name) {
      toast('Agent name is required', undefined, 'warning')
      return null
    }
    if (!code) {
      toast('Agent code is required', undefined, 'warning')
      return null
    }
    const agents = state.agents ?? []
    if (agents.some((agent) => agent.code.trim().toLowerCase() === code.toLowerCase())) {
      toast('Agent code already exists', code, 'warning')
      return null
    }
    if (state.warehouses.some((warehouse) => warehouse.code.trim().toLowerCase() === code.toLowerCase())) {
      toast('Warehouse code already exists', code, 'warning')
      return null
    }
    const warehouseId = nextAgentWarehouseId(state.warehouses, code)
    if (
      state.warehouses.some((warehouse) => warehouse.id === warehouseId) ||
      agents.some((agent) => agent.warehouseId === warehouseId)
    ) {
      toast('Linked warehouse already exists', warehouseId, 'warning')
      return null
    }
    const userId = input.userId?.trim() || undefined
    if (userId) {
      const user = state.users.find((item) => item.id === userId)
      if (!user) {
        toast('User not found', undefined, 'warning')
        return null
      }
      if (agents.some((agent) => agent.userId === userId)) {
        toast('User already linked to an agent', user.name, 'warning')
        return null
      }
    }
    const stamp = nowIso()
    const warehouse = {
      id: warehouseId,
      name: agentLinkedWarehouseName(name),
      code,
      kind: 'agent' as const,
    }
    const agent: Agent = {
      id: uid('agt'),
      name,
      code,
      warehouseId,
      userId,
      bankName: input.bankName?.trim() ?? '',
      accountHolder: input.accountHolder?.trim() ?? '',
      bankAccount: input.bankAccount?.trim() ?? '',
      status: 'active',
      createdAt: stamp,
      updatedAt: stamp,
    }
    setData({
      agents: [agent, ...agents],
      warehouses: [...state.warehouses, warehouse],
    })
    toast('Agent added', agent.name)
    return agent
  },

  updateAgent(id: string, patch: AgentInput) {
    if (!hasPermission(state, 'agent.manage')) {
      toast('Permission denied', 'You cannot manage agents.', 'danger')
      return false
    }
    const current = (state.agents ?? []).find((agent) => agent.id === id)
    if (!current) return false
    const name = patch.name.trim()
    const code = patch.code.trim().toUpperCase()
    if (!name) {
      toast('Agent name is required', undefined, 'warning')
      return false
    }
    if (!code) {
      toast('Agent code is required', undefined, 'warning')
      return false
    }
    if ((state.agents ?? []).some((agent) => agent.id !== id && agent.code.trim().toLowerCase() === code.toLowerCase())) {
      toast('Agent code already exists', code, 'warning')
      return false
    }
    const userId = patch.userId?.trim() || undefined
    if (userId) {
      const user = state.users.find((item) => item.id === userId)
      if (!user) {
        toast('User not found', undefined, 'warning')
        return false
      }
      if ((state.agents ?? []).some((agent) => agent.id !== id && agent.userId === userId)) {
        toast('User already linked to an agent', user.name, 'warning')
        return false
      }
    }
    const next: Agent = {
      ...current,
      name,
      code,
      userId,
      bankName: patch.bankName?.trim() ?? '',
      accountHolder: patch.accountHolder?.trim() ?? '',
      bankAccount: patch.bankAccount?.trim() ?? '',
      warehouseId: current.warehouseId,
      updatedAt: nowIso(),
    }
    setData({
      agents: (state.agents ?? []).map((agent) => (agent.id === id ? next : agent)),
      warehouses: state.warehouses.map((warehouse) =>
        warehouse.id === current.warehouseId ? { ...warehouse, name: agentLinkedWarehouseName(name) } : warehouse,
      ),
    })
    toast('Agent updated', next.name)
    return true
  },

  setAgentStatus(id: string, status: AgentStatus) {
    if (!hasPermission(state, 'agent.manage')) {
      toast('Permission denied', 'You cannot manage agents.', 'danger')
      return false
    }
    const current = (state.agents ?? []).find((agent) => agent.id === id)
    if (!current) return false
    if (current.status === status) return true
    setData({
      agents: (state.agents ?? []).map((agent) =>
        agent.id === id ? { ...agent, status, updatedAt: nowIso() } : agent,
      ),
    })
    toast(status === 'inactive' ? 'Agent deactivated' : 'Agent activated', current.name)
    return true
  },

  createUser(input: { name: string; email: string; roleId: string; departmentId: string; status?: UserStatus }) {
    const actor = currentUser(state)
    if (!canCreateUser(state, actor)) {
      toast('Permission denied', 'You cannot add users.', 'danger')
      return null
    }
    const name = input.name.trim()
    const email = input.email.trim().toLowerCase()
    if (!name || !email) {
      toast('Name and email are required', undefined, 'warning')
      return null
    }
    const role = roleById(state, input.roleId)
    if (!role || !canAssignRole(state, actor, role)) {
      toast('Permission denied', 'You cannot assign that role.', 'danger')
      return null
    }
    const department = state.departments.find((item) => item.id === input.departmentId && item.status === 'active')
    if (!department) {
      toast('Department is required', 'Choose an active department.', 'warning')
      return null
    }
    if (state.users.some((item) => item.email.trim().toLowerCase() === email)) {
      toast('Email already in use', email, 'warning')
      return null
    }
    const stamp = nowIso()
    const user: User = {
      id: uid('usr'),
      name,
      email,
      roleId: role.id,
      role: role.legacyRole,
      departmentId: department.id,
      status: input.status ?? 'active',
      lastLogin: 'Never',
      createdAt: stamp,
      updatedAt: stamp,
    }
    const log = makeAudit({
      action: 'user_created',
      userId: user.id,
      userName: user.name,
      field: 'user',
      newValue: `${user.name} · ${role.name} · ${department.name} · ${user.status}`,
      changedBy: actor.name,
    })
    setData({ users: [user, ...state.users], userAuditLogs: [log, ...(state.userAuditLogs ?? [])] })
    toast('User created', user.name)
    return user
  },

  updateUser(id: string, patch: { name?: string; email?: string; roleId?: string; departmentId?: string; status?: UserStatus }) {
    const actor = currentUser(state)
    const target = state.users.find((item) => item.id === id)
    if (!target) return false
    if (!canEditUserRecord(state, actor) && patch.status === undefined) {
      toast('Permission denied', 'You cannot edit users.', 'danger')
      return false
    }
    const nextName = patch.name?.trim() ?? target.name
    const nextEmail = (patch.email ?? target.email).trim().toLowerCase()
    const nextRoleId = patch.roleId ?? target.roleId
    const nextDepartmentId = patch.departmentId ?? target.departmentId
    const nextStatus = patch.status ?? target.status
    if (!nextName || !nextEmail) {
      toast('Name and email are required', undefined, 'warning')
      return false
    }
    if (state.users.some((item) => item.id !== id && item.email.trim().toLowerCase() === nextEmail)) {
      toast('Email already in use', nextEmail, 'warning')
      return false
    }
    const nextRole = roleById(state, nextRoleId)
    if (nextRoleId !== target.roleId && !canChangeUserRole(state, actor, target, nextRole)) {
      toast('Permission denied', 'You cannot change that user\'s role.', 'danger')
      return false
    }
    if (nextRoleId === target.roleId && !nextRole) {
      toast('Role not found', undefined, 'danger')
      return false
    }
    const nextDepartment = state.departments.find((item) => item.id === nextDepartmentId)
    if (!nextDepartment || (nextDepartment.status !== 'active' && nextDepartmentId !== target.departmentId)) {
      toast('Department is required', 'Choose an active department.', 'warning')
      return false
    }
    if (nextStatus !== target.status && nextStatus === 'inactive' && !canDeactivateUser(state, actor, target)) {
      toast('Permission denied', 'You cannot deactivate this user.', 'danger')
      return false
    }
    if (nextStatus === 'inactive' && isOwnerUser(state, target) && !isOwnerUser(state, actor)) {
      toast('Permission denied', 'Admin cannot deactivate Owner.', 'danger')
      return false
    }
    if (!canEditUserRecord(state, actor) && nextStatus === target.status) {
      toast('Permission denied', 'You cannot edit users.', 'danger')
      return false
    }
    const stamp = nowIso()
    const logs: UserAuditLog[] = []
    const push = (action: UserAuditAction, field: string, oldValue: string, newValue: string) => {
      logs.push(makeAudit({ action, userId: target.id, userName: nextName, field, oldValue, newValue, changedBy: actor.name }))
    }
    if (nextRoleId !== target.roleId) push('role_changed', 'role', roleName(state, target.roleId), nextRole!.name)
    if (nextDepartmentId !== target.departmentId) {
      const oldDept = state.departments.find((item) => item.id === target.departmentId)?.name ?? target.departmentId
      push('department_changed', 'department', oldDept, nextDepartment.name)
    }
    if (nextStatus !== target.status) push(nextStatus === 'inactive' ? 'user_deactivated' : 'user_reactivated', 'status', target.status, nextStatus)
    if (nextName !== target.name) push('user_updated', 'name', target.name, nextName)
    if (nextEmail !== target.email) push('user_updated', 'email', target.email, nextEmail)
    if (!logs.length) return true
    setData({
      users: state.users.map((item) =>
        item.id === id
          ? {
              ...item,
              name: nextName,
              email: nextEmail,
              roleId: nextRole!.id,
              role: nextRole!.legacyRole,
              departmentId: nextDepartment.id,
              status: nextStatus,
              updatedAt: stamp,
            }
          : item,
      ),
      userAuditLogs: [...logs, ...(state.userAuditLogs ?? [])],
    })
    toast('User updated', nextName)
    return true
  },

  createRole(input: { name: string; description: string; status?: RoleStatus }) {
    const actor = currentUser(state)
    if (!canCreateRole(state, actor)) {
      toast('Permission denied', 'You cannot create roles.', 'danger')
      return null
    }
    const name = input.name.trim()
    if (!name) {
      toast('Role name is required', undefined, 'warning')
      return null
    }
    if (!uniqueRoleName(name)) {
      toast('Role name already exists', 'Choose a unique role name.', 'warning')
      return null
    }
    const stamp = nowIso()
    const role: Role = {
      id: uid('role'),
      name,
      description: input.description.trim(),
      status: input.status ?? 'active',
      protected: false,
      legacyRole: 'staff',
      createdAt: stamp,
      updatedAt: stamp,
    }
    const log = makeAudit({
      action: 'role_created',
      userId: role.id,
      userName: role.name,
      field: 'role',
      newValue: `${role.name} · ${role.status}`,
      changedBy: actor.name,
    })
    setData({
      roles: [...state.roles, role],
      settings: {
        ...state.settings,
        roleMatrix: { ...state.settings.roleMatrix, [role.id]: emptyPermissions() },
      },
      userAuditLogs: [log, ...(state.userAuditLogs ?? [])],
    })
    toast('Role created', role.name)
    return role
  },

  updateRole(id: string, patch: { name?: string; description?: string }) {
    const actor = currentUser(state)
    const role = roleById(state, id)
    if (!role) return false
    if (!canEditRoleRecord(state, actor)) {
      toast('Permission denied', 'You cannot edit roles.', 'danger')
      return false
    }
    if (isOwnerRole(role) && patch.name !== undefined && patch.name.trim() !== role.name) {
      toast('Permission denied', 'The Owner role cannot be renamed.', 'danger')
      return false
    }
    if (patch.name !== undefined && !canRenameRole(state, actor, role) && patch.name.trim() !== role.name) {
      toast('Permission denied', 'You cannot rename this role.', 'danger')
      return false
    }
    const nextName = (patch.name ?? role.name).trim()
    const nextDescription = patch.description !== undefined ? patch.description.trim() : role.description
    if (!nextName) {
      toast('Role name is required', undefined, 'warning')
      return false
    }
    if (!uniqueRoleName(nextName, role.id)) {
      toast('Role name already exists', 'Choose a unique role name.', 'warning')
      return false
    }
    const stamp = nowIso()
    const logs: UserAuditLog[] = []
    if (nextName !== role.name) {
      logs.push(makeAudit({ action: 'role_renamed', userId: role.id, userName: nextName, field: 'name', oldValue: role.name, newValue: nextName, changedBy: actor.name }))
    }
    if (nextDescription !== role.description) {
      logs.push(makeAudit({ action: 'role_updated', userId: role.id, userName: nextName, field: 'description', oldValue: role.description, newValue: nextDescription, changedBy: actor.name }))
    }
    if (!logs.length) return true
    setData({
      roles: state.roles.map((item) => (item.id === id ? { ...item, name: nextName, description: nextDescription, updatedAt: stamp } : item)),
      userAuditLogs: [...logs, ...(state.userAuditLogs ?? [])],
    })
    toast('Role updated', nextName)
    return true
  },

  setRoleStatus(id: string, status: RoleStatus) {
    const actor = currentUser(state)
    const role = roleById(state, id)
    if (!role) return false
    if (!canDeactivateRole(state, actor, role) && status === 'inactive') {
      toast('Permission denied', 'You cannot deactivate this role.', 'danger')
      return false
    }
    if (!canEditRoleRecord(state, actor) && status === 'active') {
      toast('Permission denied', 'You cannot reactivate this role.', 'danger')
      return false
    }
    if (isOwnerRole(role) && status === 'inactive') {
      toast('Permission denied', 'The Owner role cannot be deactivated.', 'danger')
      return false
    }
    if (role.status === status) return true
    const stamp = nowIso()
    const assigned = state.users.filter((user) => user.roleId === role.id).length
    const log = makeAudit({
      action: status === 'inactive' ? 'role_deactivated' : 'role_reactivated',
      userId: role.id,
      userName: role.name,
      field: 'status',
      oldValue: role.status,
      newValue: status,
      changedBy: actor.name,
    })
    setData({
      roles: state.roles.map((item) => (item.id === id ? { ...item, status, updatedAt: stamp } : item)),
      userAuditLogs: [log, ...(state.userAuditLogs ?? [])],
    })
    toast(status === 'inactive' ? 'Role deactivated' : 'Role reactivated', assigned ? `${assigned} user(s) still reference this role.` : role.name)
    return true
  },

  saveRolePermissions(roleId: string, permissions: RolePermissions) {
    const actor = currentUser(state)
    if (!canManagePermissions(state, actor)) {
      toast('Permission denied', 'You cannot manage role permissions.', 'danger')
      return false
    }
    const role = roleById(state, roleId)
    if (!role) return false
    if (isOwnerRole(role)) {
      toast('Permission denied', 'Owner always has full access. Permissions cannot be reduced.', 'danger')
      return false
    }
    const previous = normalizePermissions(state.settings.roleMatrix[roleId] ?? defaultPermissionsForLegacy(role.legacyRole))
    const next = normalizePermissions(permissions)
    const logs: UserAuditLog[] = []
    ;(Object.keys(next) as PermissionKey[]).forEach((key) => {
      if (previous[key] === next[key]) return
      logs.push(
        makeAudit({
          action: 'role_permissions_changed',
          userId: role.id,
          userName: role.name,
          field: key,
          oldValue: previous[key] ? 'ON' : 'OFF',
          newValue: next[key] ? 'ON' : 'OFF',
          changedBy: actor.name,
        }),
      )
    })
    if (!logs.length) return true
    setData({
      settings: { ...state.settings, roleMatrix: { ...state.settings.roleMatrix, [roleId]: next } },
      userAuditLogs: [...logs, ...(state.userAuditLogs ?? [])],
    })
    toast('Permissions saved', role.name)
    return true
  },

  updateRoleMatrix(matrix: Settings['roleMatrix']) {
    const actor = currentUser(state)
    if (!canManagePermissions(state, actor)) {
      toast('Permission denied', 'You cannot manage role permissions.', 'danger')
      return
    }
    const logs: UserAuditLog[] = []
    const nextMatrix = { ...state.settings.roleMatrix }
    for (const role of state.roles) {
      if (isOwnerRole(role)) {
        nextMatrix[role.id] = normalizePermissions(state.settings.roleMatrix[role.id] ?? defaultPermissionsForLegacy('owner'))
        continue
      }
      const previous = normalizePermissions(state.settings.roleMatrix[role.id])
      const next = normalizePermissions(matrix[role.id])
      nextMatrix[role.id] = next
      ;(Object.keys(next) as PermissionKey[]).forEach((key) => {
        if (previous[key] === next[key]) return
        logs.push(
          makeAudit({
            action: 'role_permissions_changed',
            userId: role.id,
            userName: role.name,
            field: key,
            oldValue: previous[key] ? 'ON' : 'OFF',
            newValue: next[key] ? 'ON' : 'OFF',
            changedBy: actor.name,
          }),
        )
      })
    }
    setData({
      settings: { ...state.settings, roleMatrix: nextMatrix },
      userAuditLogs: logs.length ? [...logs, ...(state.userAuditLogs ?? [])] : state.userAuditLogs,
    })
    if (logs.length) toast('Permission matrix updated')
  },

  updateSettings(patch: Partial<Settings>) {
    setData({ settings: { ...state.settings, ...patch } })
  },

  createQuotation(input: QuotationInput) {
    if (!hasPermission(state, 'sales.quotation.create')) {
      toast('Permission denied', 'You cannot create quotations.', 'danger')
      return null
    }
    const customer = state.customers.find((item) => item.id === input.customerId)
    if (!customer) {
      toast('Select a customer', undefined, 'warning')
      return null
    }
    const items = buildDocumentLines(state, input.items)
    if (!items.length) {
      toast('Add at least one item', undefined, 'warning')
      return null
    }
    const date = input.date ?? nowIso()
    const totals = totalsFromLines(items, input.discount ?? 0, input.tax ?? 0)
    const quotation: Quotation = {
      id: uid('qt'),
      quotationNo: nextDatedDocNo((state.quotations ?? []).map((row) => row.quotationNo), 'QT-', date),
      date,
      validUntil: input.validUntil ?? defaultDueDate(date, 14),
      customerId: customer.id,
      salesperson: input.salesperson ?? currentUser(state).name,
      reference: input.reference?.trim() ?? '',
      notes: input.notes?.trim() ?? '',
      terms: input.terms?.trim() || state.settings.documentTerms,
      items,
      ...totals,
      status: input.status ?? 'draft',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    setData({
      quotations: [quotation, ...(state.quotations ?? [])],
      documentAuditLogs: pushDocAudit(
        makeDocAudit({
          action: 'quotation_created',
          documentType: 'quotation',
          documentId: quotation.id,
          documentNo: quotation.quotationNo,
          newValue: `${customer.name} · ${quotation.total}`,
        }),
      ),
    })
    toast('Quotation created', quotation.quotationNo)
    return quotation
  },

  updateQuotation(id: string, input: QuotationInput) {
    if (!hasPermission(state, 'sales.quotation.edit')) {
      toast('Permission denied', 'You cannot edit quotations.', 'danger')
      return false
    }
    const current = (state.quotations ?? []).find((item) => item.id === id)
    if (!current) return false
    if (current.status === 'cancelled' || current.convertedSaleId) {
      toast('This quotation cannot be edited', undefined, 'warning')
      return false
    }
    const items = buildDocumentLines(state, input.items)
    if (!items.length) {
      toast('Add at least one item', undefined, 'warning')
      return false
    }
    const totals = totalsFromLines(items, input.discount ?? 0, input.tax ?? 0)
    setData({
      quotations: state.quotations.map((item) =>
        item.id === id
          ? {
              ...item,
              customerId: input.customerId || item.customerId,
              validUntil: input.validUntil ?? item.validUntil,
              salesperson: input.salesperson ?? item.salesperson,
              reference: input.reference ?? item.reference,
              notes: input.notes ?? item.notes,
              terms: input.terms ?? item.terms,
              items,
              ...totals,
              updatedAt: nowIso(),
            }
          : item,
      ),
      documentAuditLogs: pushDocAudit(
        makeDocAudit({
          action: 'quotation_edited',
          documentType: 'quotation',
          documentId: current.id,
          documentNo: current.quotationNo,
        }),
      ),
    })
    toast('Quotation updated', current.quotationNo)
    return true
  },

  setQuotationStatus(id: string, status: QuotationStatus) {
    const current = (state.quotations ?? []).find((item) => item.id === id)
    if (!current) return false
    if (status === 'sent' && !hasPermission(state, 'sales.quotation.issue')) {
      toast('Permission denied', 'You cannot issue quotations.', 'danger')
      return false
    }
    if (status === 'cancelled' && !hasPermission(state, 'sales.quotation.cancel')) {
      toast('Permission denied', 'You cannot cancel quotations.', 'danger')
      return false
    }
    if (status !== 'sent' && status !== 'cancelled' && !hasPermission(state, 'sales.quotation.edit') && !hasPermission(state, 'sales.quotation.issue')) {
      toast('Permission denied', 'You cannot update this quotation.', 'danger')
      return false
    }
    const action: DocumentAuditAction =
      status === 'sent' ? 'quotation_issued' : status === 'cancelled' ? 'quotation_cancelled' : 'quotation_edited'
    setData({
      quotations: state.quotations.map((item) => (item.id === id ? { ...item, status, updatedAt: nowIso() } : item)),
      documentAuditLogs: pushDocAudit(
        makeDocAudit({
          action,
          documentType: 'quotation',
          documentId: current.id,
          documentNo: current.quotationNo,
          field: 'status',
          oldValue: current.status,
          newValue: status,
        }),
      ),
    })
    toast('Quotation updated', `${current.quotationNo} · ${status}`)
    return true
  },

  convertQuotationToInvoice(id: string) {
    if (!hasPermission(state, 'sales.invoice.create') && !hasPermission(state, 'sales.create')) {
      toast('Permission denied', 'You cannot convert this quotation to an invoice.', 'danger')
      return null
    }
    const quotation = (state.quotations ?? []).find((item) => item.id === id)
    if (!quotation) return null
    if (quotation.convertedSaleId) {
      toast('Already converted', quotation.convertedInvoiceNo, 'info')
      return state.sales.find((item) => item.id === quotation.convertedSaleId) ?? null
    }
    if (quotation.status === 'cancelled') {
      toast('Cancelled quotations cannot be converted', undefined, 'warning')
      return null
    }
    const sale = this.createSale({
      customerId: quotation.customerId,
      warehouseId: state.settings.defaultWarehouseId,
      salesperson: quotation.salesperson,
      items: quotation.items.map((line) => ({
        productId: line.productId,
        qty: line.qty,
        price: line.price,
        discount: line.discount,
        description: line.description,
      })),
      discount: quotation.discount,
      tax: quotation.tax,
      paidAmount: 0,
      notes: quotation.notes,
      reference: quotation.reference,
      datedInvoiceNo: true,
      quotationId: quotation.id,
      quotationNo: quotation.quotationNo,
      dueDate: defaultDueDate(nowIso(), 7),
      paymentTerms: state.settings.paymentTerms,
    })
    if (!sale) return null
    setData({
      quotations: state.quotations.map((item) =>
        item.id === id
          ? { ...item, status: 'accepted', convertedSaleId: sale.id, convertedInvoiceNo: sale.invoiceNo, updatedAt: nowIso() }
          : item,
      ),
      documentAuditLogs: [
        makeDocAudit({
          action: 'quotation_converted',
          documentType: 'quotation',
          documentId: quotation.id,
          documentNo: quotation.quotationNo,
          oldValue: quotation.quotationNo,
          newValue: sale.invoiceNo,
        }),
        makeDocAudit({
          action: 'invoice_created',
          documentType: 'invoice',
          documentId: sale.id,
          documentNo: sale.invoiceNo,
          newValue: `From ${quotation.quotationNo}`,
        }),
        ...(state.documentAuditLogs ?? []),
      ],
    })
    toast('Converted to invoice', sale.invoiceNo)
    return sale
  },

  createDeliveryOrder(input: DeliveryOrderInput) {
    if (!hasPermission(state, 'sales.delivery.create')) {
      toast('Permission denied', 'You cannot create delivery orders.', 'danger')
      return null
    }
    const customer = state.customers.find((item) => item.id === input.customerId)
    if (!customer) {
      toast('Select a customer', undefined, 'warning')
      return null
    }
    const sale = input.saleId ? state.sales.find((item) => item.id === input.saleId) : undefined
    const quotation = input.quotationId ? (state.quotations ?? []).find((item) => item.id === input.quotationId) : undefined
    const items = (input.items.length
      ? input.items
      : sale
        ? sale.items.map((line) => {
            const product = state.products.find((row) => row.id === line.productId)
            return {
              productId: line.productId,
              description: line.description || product?.name,
              qty: line.qty,
              unit: product?.unit,
            }
          })
        : []
    ).filter((line) => line.qty > 0 && line.productId)
    if (!items.length) {
      toast('Add at least one item', undefined, 'warning')
      return null
    }
    const date = input.date ?? nowIso()
    const order: DeliveryOrder = {
      id: uid('do'),
      doNo: nextDatedDocNo((state.deliveryOrders ?? []).map((row) => row.doNo), 'DO-', date),
      date,
      customerId: customer.id,
      deliveryAddress: input.deliveryAddress?.trim() || customer.address || state.settings.address,
      contactPerson: input.contactPerson?.trim() || customer.name,
      contactNumber: input.contactNumber?.trim() || customer.phone,
      saleId: sale?.id,
      invoiceNo: sale?.invoiceNo,
      quotationId: quotation?.id ?? sale?.quotationId,
      quotationNo: quotation?.quotationNo ?? sale?.quotationNo,
      transport: input.transport?.trim() ?? '',
      preparedBy: input.preparedBy?.trim() || currentUser(state).name,
      notes: input.notes?.trim() ?? '',
      items: items.map((line) => ({
        productId: line.productId,
        description: line.description?.trim() || state.products.find((product) => product.id === line.productId)?.name || 'Item',
        qty: line.qty,
        unit: line.unit || state.products.find((product) => product.id === line.productId)?.unit || 'pcs',
      })),
      status: input.status ?? 'draft',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    setData({
      deliveryOrders: [order, ...(state.deliveryOrders ?? [])],
      documentAuditLogs: pushDocAudit(
        makeDocAudit({
          action: 'delivery_created',
          documentType: 'delivery',
          documentId: order.id,
          documentNo: order.doNo,
          newValue: order.invoiceNo || customer.name,
        }),
      ),
    })
    toast('Delivery order created', order.doNo)
    return order
  },

  updateDeliveryOrder(id: string, input: Partial<DeliveryOrderInput>) {
    if (!hasPermission(state, 'sales.delivery.edit')) {
      toast('Permission denied', 'You cannot edit delivery orders.', 'danger')
      return false
    }
    const current = (state.deliveryOrders ?? []).find((item) => item.id === id)
    if (!current || current.status === 'cancelled' || current.status === 'delivered') {
      toast('This delivery order cannot be edited', undefined, 'warning')
      return false
    }
    const items = input.items
      ? input.items
          .filter((line) => line.qty > 0 && line.productId)
          .map((line) => ({
            productId: line.productId,
            description: line.description?.trim() || state.products.find((product) => product.id === line.productId)?.name || 'Item',
            qty: line.qty,
            unit: line.unit || state.products.find((product) => product.id === line.productId)?.unit || 'pcs',
          }))
      : current.items
    setData({
      deliveryOrders: state.deliveryOrders.map((item) =>
        item.id === id
          ? {
              ...item,
              deliveryAddress: input.deliveryAddress ?? item.deliveryAddress,
              contactPerson: input.contactPerson ?? item.contactPerson,
              contactNumber: input.contactNumber ?? item.contactNumber,
              transport: input.transport ?? item.transport,
              notes: input.notes ?? item.notes,
              items,
              updatedAt: nowIso(),
            }
          : item,
      ),
      documentAuditLogs: pushDocAudit(
        makeDocAudit({
          action: 'delivery_edited',
          documentType: 'delivery',
          documentId: current.id,
          documentNo: current.doNo,
        }),
      ),
    })
    toast('Delivery order updated', current.doNo)
    return true
  },

  setDeliveryOrderStatus(id: string, status: DeliveryOrderStatus) {
    const current = (state.deliveryOrders ?? []).find((item) => item.id === id)
    if (!current) return false
    if (status === 'issued' && !hasPermission(state, 'sales.delivery.issue')) {
      toast('Permission denied', 'You cannot issue delivery orders.', 'danger')
      return false
    }
    if (status === 'cancelled' && !hasPermission(state, 'sales.delivery.cancel')) {
      toast('Permission denied', 'You cannot cancel delivery orders.', 'danger')
      return false
    }
    if (status === 'delivered' && !hasPermission(state, 'sales.delivery.issue') && !hasPermission(state, 'sales.delivery.edit')) {
      toast('Permission denied', 'You cannot mark this delivery order delivered.', 'danger')
      return false
    }
    const action: DocumentAuditAction =
      status === 'issued' ? 'delivery_issued' : status === 'cancelled' ? 'delivery_cancelled' : status === 'delivered' ? 'delivery_delivered' : 'delivery_edited'
    setData({
      deliveryOrders: state.deliveryOrders.map((item) => (item.id === id ? { ...item, status, updatedAt: nowIso() } : item)),
      documentAuditLogs: pushDocAudit(
        makeDocAudit({
          action,
          documentType: 'delivery',
          documentId: current.id,
          documentNo: current.doNo,
          field: 'status',
          oldValue: current.status,
          newValue: status,
        }),
      ),
    })
    toast('Delivery order updated', `${current.doNo} · ${status}`)
    return true
  },

  recordDocumentPrint(type: 'quotation' | 'invoice' | 'delivery', id: string) {
    const key =
      type === 'quotation' ? 'sales.quotation.print' : type === 'invoice' ? 'sales.invoice.print' : 'sales.delivery.print'
    if (!hasPermission(state, key)) {
      toast('Permission denied', 'You cannot print this document.', 'danger')
      return false
    }
    const row =
      type === 'quotation'
        ? (state.quotations ?? []).find((item) => item.id === id)
        : type === 'invoice'
          ? state.sales.find((item) => item.id === id)
          : (state.deliveryOrders ?? []).find((item) => item.id === id)
    if (!row) return false
    const documentNo = ('doNo' in row ? row.doNo : 'quotationNo' in row ? row.quotationNo : row.invoiceNo) || id
    const action: DocumentAuditAction = type === 'quotation' ? 'quotation_printed' : type === 'invoice' ? 'invoice_printed' : 'delivery_printed'
    setData({
      documentAuditLogs: pushDocAudit(
        makeDocAudit({
          action,
          documentType: type,
          documentId: id,
          documentNo,
        }),
      ),
    })
    return true
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
    const shipping = input.shipping ?? 0
    const total = round2(subtotal - discount + tax + shipping)
    const paidAmount = Math.min(input.paidAmount ?? 0, total)
    const balance = round2(total - paidAmount)
    const date = input.date ?? nowIso()
    const invoiceNo = input.datedInvoiceNo
      ? nextDatedDocNo(state.sales.map((s) => s.invoiceNo), 'INV-', date)
      : nextDocNo(state.sales.map((s) => s.invoiceNo), 'INV-')
    const sale = {
      id: uid('sal'),
      invoiceNo,
      date,
      customerId: input.customerId,
      warehouseId,
      salesperson: input.salesperson ?? currentUser(state).name,
      items,
      subtotal,
      discount,
      tax,
      shipping,
      total,
      paid: paidAmount,
      balance,
      status: (paidAmount >= total ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid') as SaleStatus,
      paymentMethod: input.paymentMethod,
      notes: input.notes,
      quotationId: input.quotationId,
      quotationNo: input.quotationNo,
      dueDate: input.dueDate,
      paymentTerms: input.paymentTerms ?? state.settings.paymentTerms,
      reference: input.reference,
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
      documentAuditLogs: pushDocAudit(
        makeDocAudit({
          action: 'invoice_cancelled',
          documentType: 'invoice',
          documentId: sale.id,
          documentNo: sale.invoiceNo,
          field: 'status',
          oldValue: sale.status,
          newValue: 'cancelled',
        }),
      ),
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

  transferStock(input: { fromWarehouseId: string; toWarehouseId: string; productId: string; qty: number; notes?: string }) {
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
    applyWarehouseTransfer(input)
    toast('Transfer complete', `${input.qty} moved.`)
    return true
  },

  transferStockToAgent(input: { agentId: string; fromWarehouseId: string; productId: string; qty: number; notes?: string }) {
    if (!hasPermission(state, 'agent.stock.transfer')) {
      toast('Permission denied', 'You cannot transfer agent stock.', 'danger')
      return false
    }
    const agent = (state.agents ?? []).find((item) => item.id === input.agentId)
    if (!agent) {
      toast('Agent not found', undefined, 'warning')
      return false
    }
    if (agent.status !== 'active') {
      toast('Inactive agents cannot receive stock.', undefined, 'warning')
      return false
    }
    if (!input.fromWarehouseId) {
      toast('Select a source warehouse', undefined, 'warning')
      return false
    }
    if (!isCompanyWarehouseId(state.warehouses, input.fromWarehouseId)) {
      toast('Source must be a company warehouse', undefined, 'warning')
      return false
    }
    if (!input.productId) {
      toast('Select a product', undefined, 'warning')
      return false
    }
    if (!(input.qty > 0)) {
      toast('Enter a quantity', undefined, 'warning')
      return false
    }
    const available = getQty(input.productId, input.fromWarehouseId)
    if (input.qty > available) {
      toast('Insufficient stock.', `Available: ${available}.`, 'danger')
      return false
    }
    applyWarehouseTransfer({
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: agent.warehouseId,
      productId: input.productId,
      qty: input.qty,
      notes: input.notes,
    })
    toast('Stock transferred successfully.')
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
      displayQty: number
      cartonQty: number
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
      const displayQty = round2(result.displayQty || 0)
      const cartonQty = round2(result.cartonQty || 0)
      if (displayQty < 0 || cartonQty < 0) {
        toast('Distribution cannot be negative', undefined, 'warning')
        return false
      }
      if (round2(displayQty + cartonQty) !== round2(result.actualQty)) {
        toast(
          'Distribution must equal actual',
          `${productById(item.productId)?.name}: Display ${formatQty(displayQty)} + Carton ${formatQty(cartonQty)} must equal ${formatQty(result.actualQty)} PACK.`,
          'warning',
        )
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
        displayQty: round2(result.displayQty || 0),
        cartonQty: round2(result.cartonQty || 0),
      }
    })
    const working = { ...session, items }
    const plan = buildSessionPlan(state, working)
    const date = nowIso()
    let inventory = state.inventory
    let movements = state.stockMovements
    let balances = state.productionBalances
    let displayStocks = state.displayStocks ?? []
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
      if (item.displayQty > 0) {
        displayStocks = applyDisplayDelta(displayStocks, item.productId, session.warehouseId, item.displayQty, date, uid('ds'))
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
      displayStocks,
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
    if (!hasPermission(state, 'manufacturing.completed.edit')) {
      toast('Permission denied', 'You cannot edit completed production.', 'danger')
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
          displayQty: 0,
          cartonQty: 0,
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

  unplacedPacks(productId: string, warehouseId = 'wh-main') {
    return unplacedPacks(state, productId, warehouseId)
  },

  placeStock(input: { slotId: string; productId: string; qty: number; batchRef?: string; productionSessionRef?: string; reason?: string }) {
    if (!hasPermission(state, 'warehouse_map.putaway')) {
      toast('Permission denied', 'You cannot place finished goods.', 'danger')
      return false
    }
    const qty = round2(input.qty)
    if (qty <= 0) {
      toast('Enter a quantity', undefined, 'warning')
      return false
    }
    const slot = state.storageSlots.find((row) => row.id === input.slotId && row.active)
    const location = slot ? state.storageLocations.find((row) => row.id === slot.locationId && row.active) : undefined
    if (!slot || !location || location.type === 'BALANCE_AREA') {
      toast('Choose a storage position', undefined, 'warning')
      return false
    }
    if (location.type === 'DISPLAY') {
      toast('Display is loose stock', 'Place cartons on CTN Rack or Pallet Stock, then top up Display from carton stock.', 'warning')
      return false
    }
    const existing = state.slotOccupancies.find((row) => row.slotId === slot.id)
    if (existing) {
      toast('Slot occupied', 'Choose an empty position.', 'warning')
      return false
    }
    const available = unplacedPacks(state, input.productId, location.warehouseId)
    if (qty > available) {
      toast('Not enough unplaced stock', `${available} pack(s) left to place.`, 'warning')
      return false
    }
    const actor = currentUser(state)
    const occupancy = {
      id: uid('occ'),
      slotId: slot.id,
      productId: input.productId,
      quantityPacks: qty,
      batchRef: input.batchRef ?? '',
      productionSessionRef: input.productionSessionRef ?? '',
      placedBy: actor.name,
      placedAt: nowIso(),
      updatedAt: nowIso(),
    }
    const log = {
      id: uid('pl'),
      action: 'PLACED' as const,
      productId: input.productId,
      quantity: qty,
      fromSlotId: '',
      toSlotId: slot.id,
      batchRef: occupancy.batchRef,
      referenceId: occupancy.productionSessionRef,
      performedBy: actor.name,
      performedAt: nowIso(),
      reason: input.reason ?? '',
    }
    setData({
      slotOccupancies: [...state.slotOccupancies, occupancy],
      placementLogs: [log, ...state.placementLogs],
    })
    toast('Stock placed', `${qty} pack(s) placed.`)
    return true
  },

  moveStock(input: { fromSlotId: string; toSlotId: string; qty: number; action?: 'MOVED' | 'TOPPED_UP'; reason?: string }) {
    if (!hasPermission(state, 'warehouse_map.move')) {
      toast('Permission denied', 'You cannot move warehouse stock.', 'danger')
      return false
    }
    const qty = round2(input.qty)
    if (qty <= 0) {
      toast('Enter a quantity', undefined, 'warning')
      return false
    }
    if (input.fromSlotId === input.toSlotId) {
      toast('Choose a different position', undefined, 'warning')
      return false
    }
    const source = state.slotOccupancies.find((row) => row.slotId === input.fromSlotId)
    const fromSlot = state.storageSlots.find((row) => row.id === input.fromSlotId && row.active)
    const toSlot = state.storageSlots.find((row) => row.id === input.toSlotId && row.active)
    const toLocation = toSlot ? state.storageLocations.find((row) => row.id === toSlot.locationId && row.active) : undefined
    if (!source || !fromSlot || !toSlot || !toLocation || toLocation.type === 'BALANCE_AREA' || toLocation.type === 'DISPLAY') {
      toast('Choose valid positions', toLocation?.type === 'DISPLAY' ? 'Use Top up Display instead of a map slot.' : undefined, 'warning')
      return false
    }
    if (qty > source.quantityPacks) {
      toast('Not enough in that position', `${source.quantityPacks} pack(s) available.`, 'warning')
      return false
    }
    const destination = state.slotOccupancies.find((row) => row.slotId === toSlot.id)
    if (destination && destination.productId !== source.productId) {
      toast('Slot has another product', 'One SKU per position.', 'warning')
      return false
    }
    const sourceRef = source.productionSessionRef || source.batchRef
    const destRef = destination ? destination.productionSessionRef || destination.batchRef : ''
    if (destination && sourceRef && destRef && sourceRef !== destRef) {
      toast('Keep cartons separate', 'Different production dates cannot share a slot.', 'warning')
      return false
    }
    const actor = currentUser(state)
    const remaining = round2(source.quantityPacks - qty)
    let occupancies = state.slotOccupancies
    if (remaining <= 0) occupancies = occupancies.filter((row) => row.id !== source.id)
    else occupancies = occupancies.map((row) => (row.id === source.id ? { ...row, quantityPacks: remaining, updatedAt: nowIso() } : row))
    if (destination) {
      occupancies = occupancies.map((row) =>
        row.id === destination.id ? { ...row, quantityPacks: round2(row.quantityPacks + qty), updatedAt: nowIso() } : row,
      )
    } else {
      occupancies = [
        ...occupancies,
        {
          id: uid('occ'),
          slotId: toSlot.id,
          productId: source.productId,
          quantityPacks: qty,
          batchRef: source.batchRef,
          productionSessionRef: source.productionSessionRef,
          placedBy: actor.name,
          placedAt: nowIso(),
          updatedAt: nowIso(),
        },
      ]
    }
    const log = {
      id: uid('pl'),
      action: (input.action ?? 'MOVED') as 'MOVED' | 'TOPPED_UP',
      productId: source.productId,
      quantity: qty,
      fromSlotId: fromSlot.id,
      toSlotId: toSlot.id,
      batchRef: source.batchRef,
      referenceId: source.productionSessionRef,
      performedBy: actor.name,
      performedAt: nowIso(),
      reason: input.reason ?? '',
    }
    setData({ slotOccupancies: occupancies, placementLogs: [log, ...state.placementLogs] })
    toast('Stock moved', `${qty} pack(s) moved.`)
    return true
  },

  topUpDisplay(input: { fromSlotId: string; qty: number; reason?: string }) {
    if (!hasPermission(state, 'warehouse_map.move')) {
      toast('Permission denied', 'You cannot move warehouse stock.', 'danger')
      return false
    }
    const qty = round2(input.qty)
    if (qty <= 0) {
      toast('Enter a quantity', undefined, 'warning')
      return false
    }
    const source = state.slotOccupancies.find((row) => row.slotId === input.fromSlotId)
    const fromSlot = state.storageSlots.find((row) => row.id === input.fromSlotId && row.active)
    const fromLocation = fromSlot ? state.storageLocations.find((row) => row.id === fromSlot.locationId && row.active) : undefined
    if (!source || !fromSlot || !fromLocation || fromLocation.type === 'BALANCE_AREA' || fromLocation.type === 'DISPLAY') {
      toast('Choose carton stock', 'Top up Display from CTN Rack or Pallet Stock.', 'warning')
      return false
    }
    if (qty > source.quantityPacks) {
      toast('Not enough in that position', `${source.quantityPacks} pack(s) available.`, 'warning')
      return false
    }
    const actor = currentUser(state)
    const remaining = round2(source.quantityPacks - qty)
    const occupancies =
      remaining <= 0
        ? state.slotOccupancies.filter((row) => row.id !== source.id)
        : state.slotOccupancies.map((row) => (row.id === source.id ? { ...row, quantityPacks: remaining, updatedAt: nowIso() } : row))
    const displayStocks = applyDisplayDelta(state.displayStocks ?? [], source.productId, fromLocation.warehouseId, qty, nowIso(), uid('ds'))
    const log = {
      id: uid('pl'),
      action: 'TOPPED_UP' as const,
      productId: source.productId,
      quantity: qty,
      fromSlotId: fromSlot.id,
      toSlotId: DISPLAY_STOCK_DESTINATION,
      batchRef: source.batchRef,
      referenceId: source.productionSessionRef,
      performedBy: actor.name,
      performedAt: nowIso(),
      reason: input.reason ?? 'Top up display stock',
    }
    setData({ slotOccupancies: occupancies, displayStocks, placementLogs: [log, ...state.placementLogs] })
    toast('Display topped up', `${qty} pack(s) moved to Display. Inventory total unchanged.`)
    return true
  },

  emptySlot(slotId: string, reason = '') {
    if (!hasPermission(state, 'warehouse_map.move')) {
      toast('Permission denied', 'You cannot empty a position.', 'danger')
      return false
    }
    const source = state.slotOccupancies.find((row) => row.slotId === slotId)
    if (!source) return false
    const actor = currentUser(state)
    const log = {
      id: uid('pl'),
      action: 'EMPTIED' as const,
      productId: source.productId,
      quantity: source.quantityPacks,
      fromSlotId: slotId,
      toSlotId: '',
      batchRef: source.batchRef,
      referenceId: source.productionSessionRef,
      performedBy: actor.name,
      performedAt: nowIso(),
      reason,
    }
    setData({
      slotOccupancies: state.slotOccupancies.filter((row) => row.id !== source.id),
      placementLogs: [log, ...state.placementLogs],
    })
    toast('Position emptied', 'Packs returned to Ready to Place.')
    return true
  },

  ensurePalletEmptySlot(locationId: string) {
    const location = state.storageLocations.find((row) => row.id === locationId && row.active)
    if (!location || (location.type !== 'PALLET' && location.type !== 'FLOOR')) return null
    const empty = state.storageSlots
      .filter((row) => row.locationId === locationId && row.active)
      .sort((a, b) => a.slotNo - b.slotNo)
      .find((row) => !state.slotOccupancies.some((item) => item.slotId === row.id))
    if (empty) return empty
    const slot = nextGenericSlot(locationId, state.storageSlots)
    setData({ storageSlots: [...state.storageSlots, slot] })
    return slot
  },

  createTemporaryLocation(input: { name: string; type: Extract<StorageLocationType, 'PALLET' | 'FLOOR'>; warehouseId?: string; slotCount?: number }) {
    if (!hasPermission(state, 'warehouse_map.location.manage')) {
      toast('Permission denied', 'You cannot add storage locations.', 'danger')
      return null
    }
    const name = input.name.trim()
    if (!name) {
      toast('Location name is required', undefined, 'warning')
      return null
    }
    const warehouseId = input.warehouseId || state.settings.defaultWarehouseId || 'wh-main'
    if (isAgentWarehouseId(state.warehouses, warehouseId)) {
      toast('Agent warehouses cannot have storage locations', undefined, 'warning')
      return null
    }
    const id = uid('loc')
    const location = {
      id,
      name,
      type: input.type,
      warehouseId,
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    const slots = generateGenericSlots(id, Math.max(1, input.slotCount ?? 3))
    setData({
      storageLocations: [...state.storageLocations, location],
      storageSlots: [...state.storageSlots, ...slots],
    })
    toast('Temporary location added', name)
    return location
  },

  createRackLocation(input: { name: string; warehouseId?: string; levels?: number; frontCount?: number; backCount?: number }) {
    if (!hasPermission(state, 'warehouse_map.layout.edit')) {
      toast('Permission denied', 'You cannot edit warehouse layout.', 'danger')
      return null
    }
    const name = input.name.trim()
    if (!name) {
      toast('Rack name is required', undefined, 'warning')
      return null
    }
    const warehouseId = input.warehouseId || state.settings.defaultWarehouseId || 'wh-main'
    if (isAgentWarehouseId(state.warehouses, warehouseId)) {
      toast('Agent warehouses cannot have storage locations', undefined, 'warning')
      return null
    }
    const id = uid('loc')
    const location = {
      id,
      name,
      type: 'RACK' as const,
      warehouseId,
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    const slots = generateRackSlots(id, Math.max(1, input.levels ?? 4), Math.max(1, input.frontCount ?? 4), Math.max(0, input.backCount ?? 4))
    setData({
      storageLocations: [...state.storageLocations, location],
      storageSlots: [...state.storageSlots, ...slots],
    })
    toast('Rack added', name)
    return location
  },

  renameStorageLocation(id: string, name: string) {
    if (!hasPermission(state, 'warehouse_map.location.manage')) {
      toast('Permission denied', 'You cannot rename locations.', 'danger')
      return false
    }
    const next = name.trim()
    if (!next) return false
    setData({
      storageLocations: state.storageLocations.map((row) => (row.id === id ? { ...row, name: next, updatedAt: nowIso() } : row)),
    })
    toast('Location renamed', next)
    return true
  },

  deactivateStorageLocation(id: string) {
    if (!hasPermission(state, 'warehouse_map.location.manage')) {
      toast('Permission denied', 'You cannot deactivate locations.', 'danger')
      return false
    }
    const location = state.storageLocations.find((row) => row.id === id)
    if (!location) return false
    const slotIds = state.storageSlots.filter((row) => row.locationId === id).map((row) => row.id)
    if (state.slotOccupancies.some((row) => slotIds.includes(row.slotId))) {
      toast('Location still has stock', 'Empty it before deactivating.', 'warning')
      return false
    }
    setData({
      storageLocations: state.storageLocations.map((row) => (row.id === id ? { ...row, active: false, updatedAt: nowIso() } : row)),
      storageSlots: state.storageSlots.map((row) => (row.locationId === id ? { ...row, active: false } : row)),
    })
    toast('Location deactivated', location.name)
    return true
  },

  useProductionBalance(input: { balanceId: string; qty: number; reason: BalanceUsageReason; notes?: string }) {
    if (!hasPermission(state, 'warehouse_map.balance.use')) {
      toast('Permission denied', 'You cannot use production balance.', 'danger')
      return false
    }
    const qty = round2(input.qty)
    if (qty <= 0) {
      toast('Enter a quantity', undefined, 'warning')
      return false
    }
    const balance = state.productionBalances.find((row) => row.id === input.balanceId)
    if (!balance || balance.status !== 'available' || balance.quantity <= 0) {
      toast('No available balance', undefined, 'warning')
      return false
    }
    if (qty > balance.quantity) {
      toast('Quantity exceeds available balance.', `${formatQty(balance.quantity)}${balance.unit} available.`, 'warning')
      return false
    }
    const remaining = round2(balance.quantity - qty)
    const actor = currentUser(state)
    const log = {
      id: uid('bu'),
      balanceId: balance.id,
      productId: balance.productId,
      quantity: qty,
      unit: balance.unit,
      productionDate: balance.productionDate,
      productionReference: balance.productionReference,
      container: balance.container,
      location: balance.location,
      reason: input.reason,
      notes: input.notes?.trim() ?? '',
      performedBy: actor.name,
      performedAt: nowIso(),
    }
    setData({
      productionBalances: state.productionBalances.map((row) =>
        row.id === balance.id
          ? { ...row, quantity: remaining, status: remaining > 0 ? 'available' : 'consumed' }
          : row,
      ),
      balanceUsageLogs: [log, ...(state.balanceUsageLogs ?? [])],
    })
    toast('Balance used', `${qty}${balance.unit} recorded. Inventory packs unchanged.`)
    return true
  },
}

export type MockApi = typeof db
