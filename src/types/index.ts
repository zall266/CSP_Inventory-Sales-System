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
export type StorageLocationType = 'RACK' | 'DISPLAY' | 'PALLET' | 'FLOOR' | 'BALANCE_AREA'
export type StorageFace = 'FRONT' | 'BACK' | 'NONE'
export type PlacementAction = 'PLACED' | 'MOVED' | 'TOPPED_UP' | 'EMPTIED'
export type BalanceUsageReason = 'Content' | 'Sample' | 'R&D / Testing' | 'Internal Use' | 'Waste' | 'Other'

export type WarehouseKind = 'company' | 'agent'

export type Warehouse = {
  id: string
  name: string
  code: string
  kind: WarehouseKind
}

export type AgentStatus = 'active' | 'inactive'

export type Agent = {
  id: string
  name: string
  code: string
  warehouseId: string
  userId?: string
  bankName: string
  accountHolder: string
  bankAccount: string
  status: AgentStatus
  createdAt: string
  updatedAt: string
}

export type AgentInput = {
  name: string
  code: string
  userId?: string
  bankName?: string
  accountHolder?: string
  bankAccount?: string
}

export type Category = {
  id: string
  name: string
}

export type CostSource = 'bom' | 'manual'

export type Product = {
  id: string
  name: string
  sku: string
  barcode: string
  categoryId: string
  unit: string
  purchaseUnit?: string
  purchaseConversionQty?: number
  purchaseCost?: number
  costPrice: number
  costSource?: CostSource
  sellingPrice: number
  wholesalePrice: number
  agentPrice?: number
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

export type DisplayStock = {
  id: string
  warehouseId: string
  productId: string
  qty: number
  updatedAt: string
}

export type StorageLocation = {
  id: string
  name: string
  type: StorageLocationType
  warehouseId: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export type StorageSlot = {
  id: string
  locationId: string
  level: number
  face: StorageFace
  slotNo: number
  capacity: number
  active: boolean
}

export type SlotOccupancy = {
  id: string
  slotId: string
  productId: string
  quantityPacks: number
  batchRef: string
  productionSessionRef: string
  placedBy: string
  placedAt: string
  updatedAt: string
}

export type PlacementLog = {
  id: string
  action: PlacementAction
  productId: string
  quantity: number
  fromSlotId: string
  toSlotId: string
  batchRef: string
  referenceId: string
  performedBy: string
  performedAt: string
  reason: string
}

export type BalanceUsageLog = {
  id: string
  balanceId: string
  productId: string
  quantity: number
  unit: string
  productionDate: string
  productionReference: string
  container: string
  location: string
  reason: BalanceUsageReason
  notes: string
  performedBy: string
  performedAt: string
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
  address?: string
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
  description?: string
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
  shipping: number
  total: number
  paid: number
  balance: number
  status: SaleStatus
  paymentMethod?: PaymentMethod
  notes?: string
  reference?: string
  quotationId?: string
  quotationNo?: string
  dueDate?: string
  paymentTerms?: string
}

export type AgentSaleItem = {
  productId: string
  qty: number
  agentPrice: number
  sellingPrice: number
  productMarkup: number
}

export type AgentSale = {
  id: string
  saleId: string
  agentId: string
  warehouseId: string
  date: string
  customerId: string
  items: AgentSaleItem[]
  cspAmount: number
  productMarkup: number
  deliveryEarnings: number
  totalEarnings: number
  customerPaid: number
  notes?: string
  createdAt: string
}

export type AgentEarningKind =
  | 'sale_earning'
  | 'product_markup'
  | 'delivery_earnings'
  | 'withdrawal_pending'
  | 'withdrawal_paid'
  | 'withdrawal_cancelled'

export type AgentEarningLedger = {
  id: string
  agentId: string
  date: string
  kind: AgentEarningKind
  amount: number
  availableDelta: number
  pendingDelta: number
  paidDelta: number
  relatedSaleId?: string
  relatedAgentSaleId?: string
  relatedWithdrawalId?: string
  notes?: string
  createdAt: string
}

export type AgentWithdrawalStatus = 'requested' | 'processing' | 'paid' | 'cancelled'

export type AgentWithdrawal = {
  id: string
  agentId: string
  amount: number
  status: AgentWithdrawalStatus
  bankName: string
  accountHolder: string
  accountNumber: string
  requestedAt: string
  requestedBy: string
  processedAt?: string
  paidAt?: string
  cancelledAt?: string
  paymentReference?: string
  paymentDate?: string
  receiptUrl?: string
  receiptName?: string
  processedBy?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'cancelled'
export type DeliveryOrderStatus = 'draft' | 'issued' | 'delivered' | 'cancelled'

export type DocumentLine = {
  productId: string
  description: string
  qty: number
  unit: string
  price: number
  discount: number
  total: number
}

export type Quotation = {
  id: string
  quotationNo: string
  date: string
  validUntil: string
  customerId: string
  salesperson: string
  reference: string
  notes: string
  terms: string
  items: DocumentLine[]
  subtotal: number
  discount: number
  tax: number
  total: number
  status: QuotationStatus
  convertedSaleId?: string
  convertedInvoiceNo?: string
  createdAt: string
  updatedAt: string
}

export type DeliveryOrder = {
  id: string
  doNo: string
  date: string
  customerId: string
  deliveryAddress: string
  contactPerson: string
  contactNumber: string
  saleId?: string
  invoiceNo?: string
  quotationId?: string
  quotationNo?: string
  transport: string
  preparedBy: string
  notes: string
  items: Array<{ productId: string; description: string; qty: number; unit: string }>
  status: DeliveryOrderStatus
  createdAt: string
  updatedAt: string
}

export type DocumentAuditAction =
  | 'quotation_created'
  | 'quotation_edited'
  | 'quotation_issued'
  | 'quotation_cancelled'
  | 'quotation_converted'
  | 'invoice_created'
  | 'invoice_edited'
  | 'invoice_issued'
  | 'invoice_printed'
  | 'invoice_cancelled'
  | 'delivery_created'
  | 'delivery_edited'
  | 'delivery_issued'
  | 'delivery_cancelled'
  | 'delivery_delivered'
  | 'quotation_printed'
  | 'delivery_printed'
  | 'agent_sale_created'
  | 'agent_withdrawal_paid'
  | 'agent_withdrawal_cancelled'

export type DocumentAuditLog = {
  id: string
  action: DocumentAuditAction
  documentType: 'quotation' | 'invoice' | 'delivery' | 'agent_sale' | 'agent_withdrawal'
  documentId: string
  documentNo: string
  field: string
  oldValue: string
  newValue: string
  changedBy: string
  changedAt: string
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
  displayQty: number
  cartonQty: number
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

export type RoleStatus = 'active' | 'inactive'
export type DepartmentStatus = 'active' | 'inactive'

export type Role = {
  id: string
  name: string
  description: string
  status: RoleStatus
  protected: boolean
  /** Operational mapping used only by existing manufacturing session gates. */
  legacyRole: UserRole
  createdAt: string
  updatedAt: string
}

export type Department = {
  id: string
  name: string
  status: DepartmentStatus
}

export type User = {
  id: string
  name: string
  email: string
  roleId: string
  /** Synced from the assigned role's legacyRole for manufacturing session gates. */
  role: UserRole
  departmentId: string
  status: UserStatus
  lastLogin: string
  createdAt: string
  updatedAt: string
}

export type UserAuditAction =
  | 'user_created'
  | 'user_updated'
  | 'role_changed'
  | 'department_changed'
  | 'user_deactivated'
  | 'user_reactivated'
  | 'role_created'
  | 'role_renamed'
  | 'role_updated'
  | 'role_deactivated'
  | 'role_reactivated'
  | 'role_permissions_changed'

export type UserAuditLog = {
  id: string
  action: UserAuditAction
  userId: string
  userName: string
  field: string
  oldValue: string
  newValue: string
  changedBy: string
  changedAt: string
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
  | 'dashboard.view'
  | 'sales.view'
  | 'sales.create'
  | 'sales.edit'
  | 'sales.void'
  | 'sales.quotation.view'
  | 'sales.quotation.create'
  | 'sales.quotation.edit'
  | 'sales.quotation.issue'
  | 'sales.quotation.cancel'
  | 'sales.quotation.print'
  | 'sales.invoice.view'
  | 'sales.invoice.create'
  | 'sales.invoice.edit'
  | 'sales.invoice.issue'
  | 'sales.invoice.cancel'
  | 'sales.invoice.print'
  | 'sales.delivery.view'
  | 'sales.delivery.create'
  | 'sales.delivery.edit'
  | 'sales.delivery.issue'
  | 'sales.delivery.cancel'
  | 'sales.delivery.print'
  | 'purchases.view'
  | 'purchases.create'
  | 'purchases.edit'
  | 'purchases.delete'
  | 'inventory.view'
  | 'inventory.adjust'
  | 'inventory.transfer'
  | 'inventory.count'
  | 'warehouse_map.view'
  | 'warehouse_map.putaway'
  | 'warehouse_map.move'
  | 'warehouse_map.layout.edit'
  | 'warehouse_map.location.manage'
  | 'warehouse_map.balance.use'
  | 'manufacturing.view'
  | 'manufacturing.create'
  | 'manufacturing.edit'
  | 'manufacturing.start'
  | 'manufacturing.complete'
  | 'manufacturing.completed.edit'
  | 'manufacturing.history.view'
  | 'reports.view'
  | 'reports.export'
  | 'finance.view'
  | 'payments.view'
  | 'receivables.view'
  | 'payables.view'
  | 'expenses.manage'
  | 'users.view'
  | 'users.create'
  | 'users.edit'
  | 'users.role.change'
  | 'users.deactivate'
  | 'roles.view'
  | 'roles.create'
  | 'roles.edit'
  | 'roles.deactivate'
  | 'roles.permissions.manage'
  | 'settings.view'
  | 'settings.edit'
  | 'agent.view'
  | 'agent.manage'
  | 'agent.stock.view'
  | 'agent.stock.transfer'
  | 'agent.sale.create'
  | 'agent.sale.view'
  | 'agent.earnings.view'
  | 'agent.withdrawal.create'
  | 'agent.withdrawal.process'

export type RolePermissions = Record<PermissionKey, boolean>
export type RoleMatrix = Record<string, RolePermissions>

export type Settings = {
  businessName: string
  legalName: string
  logoUrl: string
  phone: string
  email: string
  address: string
  website: string
  registrationNo: string
  bankName: string
  bankAccount: string
  paymentTerms: string
  documentTerms: string
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
  | { type: 'quotation'; id: string }
  | { type: 'delivery'; id: string }
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
  payInvoiceId?: string
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
  agents: Agent[]
  agentSales: AgentSale[]
  agentEarningLedgers: AgentEarningLedger[]
  agentWithdrawals: AgentWithdrawal[]
  quotations: Quotation[]
  deliveryOrders: DeliveryOrder[]
  documentAuditLogs: DocumentAuditLog[]
  purchases: Purchase[]
  salesReturns: SalesReturn[]
  purchaseReturns: PurchaseReturn[]
  stockMovements: StockMovement[]
  payments: Payment[]
  expenses: Expense[]
  users: User[]
  roles: Role[]
  departments: Department[]
  userAuditLogs: UserAuditLog[]
  notifications: AppNotification[]
  settings: Settings
  boms: Bom[]
  productionOrders: ProductionOrder[]
  productionSessions: ProductionSession[]
  productionBalances: ProductionBalance[]
  displayStocks: DisplayStock[]
  storageLocations: StorageLocation[]
  storageSlots: StorageSlot[]
  slotOccupancies: SlotOccupancy[]
  placementLogs: PlacementLog[]
  balanceUsageLogs: BalanceUsageLog[]
}

export type AppState = AppData & {
  ui: UiState
}

export type ProductInput = {
  name: string
  sku?: string
  barcode?: string
  categoryId: string
  unit: string
  purchaseUnit?: string
  purchaseConversionQty?: number
  purchaseCost?: number
  costPrice?: number
  costSource?: CostSource
  sellingPrice: number
  wholesalePrice?: number
  agentPrice?: number
  reorderLevel?: number
  trackBatch?: boolean
  trackExpiry?: boolean
  status?: ProductStatus
}

export type SaleInput = {
  customerId: string
  warehouseId: string
  salesperson?: string
  items: Array<{ productId: string; qty: number; price: number; discount?: number; description?: string }>
  discount?: number
  tax?: number
  shipping?: number
  paymentMethod?: PaymentMethod
  paidAmount?: number
  notes?: string
  reference?: string
  date?: string
  datedInvoiceNo?: boolean
  quotationId?: string
  quotationNo?: string
  dueDate?: string
  paymentTerms?: string
}

export type QuotationInput = {
  customerId: string
  date?: string
  validUntil?: string
  salesperson?: string
  reference?: string
  notes?: string
  terms?: string
  items: Array<{ productId: string; description?: string; qty: number; unit?: string; price: number; discount?: number }>
  discount?: number
  tax?: number
  status?: QuotationStatus
}

export type DeliveryOrderInput = {
  customerId: string
  date?: string
  deliveryAddress?: string
  contactPerson?: string
  contactNumber?: string
  saleId?: string
  quotationId?: string
  transport?: string
  preparedBy?: string
  notes?: string
  items: Array<{ productId: string; description?: string; qty: number; unit?: string }>
  status?: DeliveryOrderStatus
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
