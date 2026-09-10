export type ProductStatus = 'active' | 'inactive'
export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock'
export type PartyStatus = 'active' | 'inactive'
export type SaleStatus = 'paid' | 'unpaid' | 'partial' | 'voided' | 'returned'
export type PurchaseStatus = 'draft' | 'pending' | 'received' | 'partial' | 'paid'
export type PaymentStatus = 'completed' | 'pending'
export type PaymentMethod = 'cash' | 'bank_transfer' | 'duitnow' | 'card' | 'ewallet'
export type MovementType =
  | 'purchase'
  | 'sale'
  | 'sales_return'
  | 'purchase_return'
  | 'adjustment'
  | 'transfer_in'
  | 'transfer_out'
  | 'opening_stock'
  | 'stock_count'
  | 'production_in'
  | 'production_out'
  | 'production_wastage'
  | 'production_balance_in'
  | 'production_balance_out'
export type ProductionStatus = 'draft' | 'planned' | 'in_progress' | 'paused' | 'completed' | 'cancelled'
export type ProductionSessionStatus = 'planned' | 'accepted' | 'in_progress' | 'completed'
export type ShortProductionReason =
  | 'Material Shortage'
  | 'Production Loss'
  | 'Machine Issue'
  | 'Quality Issue'
  | 'Packaging Issue'
  | 'Other'
export type PickingKind = 'raw' | 'balance'
export type WastageKind = 'material' | 'process_loss' | 'damaged_fg' | 'yield_variance'
export type UserRole = 'owner' | 'admin' | 'manager' | 'staff' | 'cashier' | 'warehouse'
export type UserStatus = 'active' | 'inactive'
export type ExpenseCategory =
  | 'Rent'
  | 'Utilities'
  | 'Salary'
  | 'Transport'
  | 'Packaging'
  | 'Marketing'
  | 'Maintenance'
  | 'Office'
  | 'Other'
export type AdjustmentType = 'increase' | 'decrease'
export type ToastTone = 'success' | 'info' | 'warning' | 'danger'
export type DatePreset = '7d' | '30d' | '90d' | 'custom'

export type Warehouse = {
  id: string
  name: string
  code: string
}

export type Category = {
  id: string
  name: string
}

export type Product = {
  id: string
  name: string
  sku: string
  barcode: string
  categoryId: string
  unit: string
  costPrice: number
  sellingPrice: number
  wholesalePrice: number
  reorderLevel: number
  trackBatch: boolean
  trackExpiry: boolean
  status: ProductStatus
  accent: string
}

export type InventoryRow = {
  productId: string
  warehouseId: string
  qty: number
}

export type Batch = {
  id: string
  productId: string
  warehouseId: string
  batchNo: string
  qty: number
  expiry?: string
  productionDate?: string
  productionOrderId?: string
}

export type Customer = {
  id: string
  name: string
  phone: string
  email: string
  status: PartyStatus
}

export type Supplier = {
  id: string
  name: string
  contact: string
  phone: string
  email: string
  status: PartyStatus
}

export type LineItem = {
  productId: string
  qty: number
  price: number
  discount: number
  total: number
  returnedQty: number
  batchNo?: string
  expiry?: string
}

export type Sale = {
  id: string
  invoiceNo: string
  date: string
  customerId: string
  warehouseId: string
  salesperson: string
  items: LineItem[]
  subtotal: number
  discount: number
  tax: number
  total: number
  paid: number
  balance: number
  status: SaleStatus
  paymentMethod?: PaymentMethod
  notes?: string
}

export type Purchase = {
  id: string
  purchaseNo: string
  date: string
  supplierId: string
  warehouseId: string
  invoiceNumber: string
  items: LineItem[]
  subtotal: number
  discount: number
  tax: number
  shipping: number
  total: number
  paid: number
  balance: number
  status: PurchaseStatus
  notes?: string
}

export type SalesReturn = {
  id: string
  returnNo: string
  date: string
  saleId: string
  warehouseId: string
  items: Array<{ productId: string; qty: number; price: number }>
  reason: string
  total: number
}

export type PurchaseReturn = {
  id: string
  returnNo: string
  date: string
  purchaseId: string
  warehouseId: string
  items: Array<{ productId: string; qty: number; price: number }>
  reason: string
  total: number
}

export type StockMovement = {
  id: string
  date: string
  reference: string
  productId: string
  warehouseId: string
  type: MovementType
  stockIn: number
  stockOut: number
  balance: number
  user: string
  notes?: string
}

export type Payment = {
  id: string
  paymentNo: string
  date: string
  partyType: 'customer' | 'supplier'
  partyId: string
  invoiceId: string
  invoiceNo: string
  method: PaymentMethod
  amount: number
  status: PaymentStatus
}

export type Expense = {
  id: string
  date: string
  category: ExpenseCategory
  description: string
  amount: number
  paymentMethod: PaymentMethod
  notes: string
}

export type BomItem = {
  id: string
  productId: string
  qty: number
  unit: string
  wastagePct: number
  notes: string
}

export type Bom = {
  id: string
  name: string
  productId: string
  outputQty: number
  outputUnit: string
  bulkYieldGrams?: number
  status: 'active' | 'inactive'
  notes: string
  items: BomItem[]
}

export type ProductionConsumption = {
  productId: string
  expectedQty: number
  actualQty: number
  unit: string
  notes: string
}

export type ProductionWastage = {
  id: string
  kind: WastageKind
  productId?: string
  qty: number
  unit: string
  reason: string
  notes: string
}

export type ProductionOrder = {
  id: string
  orderNo: string
  date: string
  productId: string
  bomId: string
  warehouseId: string
  plannedQty: number
  actualQty: number
  unit: string
  plannedStart: string
  plannedEnd: string
  actualStart?: string
  actualEnd?: string
  status: ProductionStatus
  batchNo: string
  expiryDate?: string
  operator: string
  notes: string
  consumptions: ProductionConsumption[]
  wastage: ProductionWastage[]
  consumptionConfirmed: boolean
  posted: boolean
  costEstimate: number
}

export type ProductionBalance = {
  id: string
  productId: string
  quantity: number
  unit: string
  location: string
  container: string
  warehouseId: string
  productionDate: string
  productionReference: string
  status: 'available' | 'consumed'
}

export type TargetChangeLog = {
  id: string
  sessionId: string
  productId: string
  originalTarget: number
  newTarget: number
  reason: string
  changedBy: string
  changedAt: string
}

export type CompletedEditLog = {
  id: string
  sessionId: string
  productId: string
  field: string
  originalValue: string
  newValue: string
  reason: string
  editedBy: string
  editedAt: string
}

export type PickingLine = {
  id: string
  kind: PickingKind
  productId: string
  label: string
  requiredQty: number
  existingBalanceQty: number
  freshQty: number
  qtyToPick: number
  unit: string
  source: string
  location: string
  container: string
  balanceId?: string
  picked: boolean
  previousPickedQty?: number
}

export type ExcessReturn = {
  id: string
  productId: string
  qty: number
  unit: string
  status: 'to_return' | 'returned'
  notes: string
}

export type ProductionSessionItem = {
  id: string
  sessionId: string
  productId: string
  bomId: string
  originalTargetQty: number
  targetQty: number
  actualQty: number
  shortProductionQty: number
  shortProductionReason: string
  productionBalanceQty: number
  balanceLocation: string
  balanceContainer: string
  wasteQty: number
  wasteReason: string
  notes: string
}

export type ProductionSession = {
  id: string
  productionDate: string
  reference: string
  status: ProductionSessionStatus
  warehouseId: string
  createdBy: string
  createdAt: string
  acceptedBy: string
  acceptedAt: string
  startedBy: string
  startedAt: string
  completedBy: string
  completedAt: string
  recipePhoto: string
  recipePhotoName: string
  uploadedBy: string
  uploadedAt: string
  notes: string
  items: ProductionSessionItem[]
  picking: PickingLine[]
  excessReturns: ExcessReturn[]
  targetChanges: TargetChangeLog[]
  completedEdits: CompletedEditLog[]
  posted: boolean
}

export type User = {
  id: string
  name: string
  email: string
  role: UserRole
  status: UserStatus
  lastLogin: string
}

export type AppNotification = {
  id: string
  type: 'low_stock' | 'out_of_stock' | 'payment' | 'info' | 'production'
  title: string
  body: string
  date: string
  read: boolean
  href?: string
}

export type PermissionKey =
  | 'dashboard'
  | 'pos'
  | 'create_sale'
  | 'void_sale'
  | 'create_purchase'
  | 'adjust_stock'
  | 'transfer_stock'
  | 'view_reports'
  | 'manage_settings'
  | 'manage_users'
  | 'create_production'
  | 'edit_completed_production'

export type RoleMatrix = Record<UserRole, Record<PermissionKey, boolean>>

export type Settings = {
  businessName: string
  phone: string
  email: string
  address: string
  currency: string
  defaultWarehouseId: string
  allowNegativeStock: boolean
  costingMethod: 'average' | 'fifo'
  batchTracking: boolean
  expiryTracking: boolean
  defaultCustomerId: string
  allowDiscount: boolean
  allowReturns: boolean
  enabledPaymentMethods: PaymentMethod[]
  roleMatrix: RoleMatrix
}

export type Toast = {
  id: string
  title: string
  description?: string
  tone: ToastTone
}

export type DrawerState =
  | { type: 'product'; id: string }
  | { type: 'sale'; id: string }
  | { type: 'purchase'; id: string }
  | { type: 'customer'; id: string }
  | { type: 'supplier'; id: string }
  | { type: 'movement'; id: string }
  | { type: 'bom'; id: string }
  | { type: 'production'; id: string }
  | { type: 'session'; id: string }
  | null

export type QuickModal =
  | 'product'
  | 'customer'
  | 'supplier'
  | 'expense'
  | 'user'
  | 'payment'
  | 'bom'
  | 'production-order'
  | null

export type UiState = {
  toasts: Toast[]
  drawer: DrawerState
  quickModal: QuickModal
  warehouseFilter: string
  sidebarCollapsed: boolean
  mobileNavOpen: boolean
  datePreset: DatePreset
  customFrom: string
  customTo: string
  currentUserId: string
}

export type AppData = {
  warehouses: Warehouse[]
  categories: Category[]
  products: Product[]
  inventory: InventoryRow[]
  batches: Batch[]
  customers: Customer[]
  suppliers: Supplier[]
  sales: Sale[]
  purchases: Purchase[]
  salesReturns: SalesReturn[]
  purchaseReturns: PurchaseReturn[]
  stockMovements: StockMovement[]
  payments: Payment[]
  expenses: Expense[]
  users: User[]
  notifications: AppNotification[]
  settings: Settings
  boms: Bom[]
  productionOrders: ProductionOrder[]
  productionSessions: ProductionSession[]
  productionBalances: ProductionBalance[]
}

export type AppState = AppData & {
  ui: UiState
}

export type ProductInput = {
  name: string
  sku: string
  barcode: string
  categoryId: string
  unit: string
  costPrice: number
  sellingPrice: number
  wholesalePrice: number
  reorderLevel: number
  trackBatch: boolean
  trackExpiry: boolean
  status: ProductStatus
}

export type SaleInput = {
  customerId: string
  warehouseId: string
  salesperson?: string
  items: Array<{ productId: string; qty: number; price: number; discount?: number }>
  discount?: number
  tax?: number
  paymentMethod?: PaymentMethod
  paidAmount?: number
  notes?: string
  date?: string
}

export type BomInput = {
  name: string
  productId: string
  outputQty: number
  outputUnit: string
  bulkYieldGrams?: number
  notes: string
  items: Array<{ productId: string; qty: number; unit: string; wastagePct: number; notes: string }>
}

export type ProductionInput = {
  productId: string
  bomId: string
  warehouseId: string
  plannedQty: number
  plannedStart: string
  plannedEnd: string
  operator: string
  notes: string
  status?: 'draft' | 'planned'
}

export type PurchaseInput = {
  supplierId: string
  warehouseId: string
  invoiceNumber: string
  items: Array<{
    productId: string
    qty: number
    price: number
    discount?: number
    batchNo?: string
    expiry?: string
  }>
  discount?: number
  tax?: number
  shipping?: number
  receive: boolean
  paidAmount?: number
  date?: string
  notes?: string
}
