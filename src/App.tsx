import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { PosPage } from '@/features/pos/PosPage'
import { SalesPage } from '@/features/sales/SalesPage'
import { SalesImportPage } from '@/features/salesImport/SalesImportPage'
import { SalesImportMappingsPage } from '@/features/salesImport/SalesImportMappingsPage'
import { CategoriesPage, ProductsPage, RawMaterialsPage } from '@/features/products/ProductsPage'
import { PRODUCT_PRICING_PATH, ProductPricingPage } from '@/features/products/ProductPricingPage'
import { InventoryPage } from '@/features/inventory/InventoryPage'
import { StockUsagePage, ToOrderPage } from '@/features/inventory/ToOrderPages'
import { WarehouseMapPage } from '@/features/warehouse/WarehouseMapPage'
import { StockAdjustmentPage, StockCountPage, StockMovementsPage, StockTransferPage } from '@/features/inventory/StockPages'
import { NewPurchasePage, PurchasesPage } from '@/features/purchases/PurchasesPage'
import { CustomersPage, SuppliersPage } from '@/features/parties/PartiesPages'
import { PurchaseReturnsPage } from '@/features/returns/ReturnsPages'
import { LegacySalesReturnsRedirect, SalesReturnDetailPage, SalesReturnEditorPage, SalesReturnsListPage } from '@/features/returns/SalesReturnPages'
import { ExpensesPage, PayablesPage, PaymentsPage, ReceivablesPage } from '@/features/finance/FinancePages'
import { InventoryReportPage, ProfitReportPage, PurchaseReportPage, SalesReportPage } from '@/features/reports/ReportsPages'
import { BusinessSettingsPage, InventorySettingsPage, SalesSettingsPage, UsersSettingsPage } from '@/features/settings/SettingsPages'
import { ManufacturingDashboardPage } from '@/features/manufacturing/ManufacturingDashboardPage'
import { BomListPage } from '@/features/manufacturing/BomPages'
import { NewProductionOrderPage, ProductionOrderDetailPage, ProductionOrdersPage } from '@/features/manufacturing/ProductionOrdersPage'
import { ProductionPlanningPage } from '@/features/manufacturing/ProductionPlanningPage'
import { FinishedGoodsPage, MaterialConsumptionPage } from '@/features/manufacturing/SessionRecordPages'
import { ProductionHistoryPage, ProductionSessionDetailPage, ProductionSessionEditPage } from '@/features/manufacturing/ProductionHistoryPage'
import { BmrPrintPage } from '@/features/manufacturing/BmrPrintPage'
import { BmrRecordsPage } from '@/features/manufacturing/BmrRecordsPage'
import { ManufacturingReportPage } from '@/features/manufacturing/ManufacturingReportsPages'
import { TodaysProductionPage } from '@/features/manufacturing/TodaysProductionPage'
import { CompleteProductionPage } from '@/features/manufacturing/CompleteProductionPage'
import { CarryForwardPage } from '@/features/manufacturing/CarryForwardPage'
import { PickingListPage } from '@/features/manufacturing/PickingListPage'
import { NewPackingPage, PackingDetailPage, PackingListPage } from '@/features/manufacturing/PackingPages'

import { QuotationsPage, QuotationEditorPage, QuotationDetailPage, QuotationPrintPage } from '@/features/documents/QuotationPages'
import { InvoiceDetailPage, InvoicePrintPage } from '@/features/documents/InvoicePages'
import { DeliveryOrdersPage, DeliveryEditorPage, DeliveryDetailPage, DeliveryPrintPage } from '@/features/documents/DeliveryPages'
import { AgentDetailPage, AgentsPage } from '@/features/agent/AgentPages'
import { MyTasksPage, TaskCategoriesPage, TaskDetailPage, TaskEditorPage, TaskManagePage } from '@/features/tasks/TaskPages'
import { NewReceivingPage, ReceivingDetailPage, ReceivingListPage } from '@/features/receiving/ReceivingPages'
import { Pjkm1011PreviewPage, Pjkm511PreviewPage, PjkmRecordsPage } from '@/features/pjkm/PjkmPages'
import { OpeningBalancePage } from '@/features/openingBalance/OpeningBalancePages'
import { HalalCompliancePage } from '@/features/halal/HalalCompliancePage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/print/quotation/:id" element={<QuotationPrintPage />} />
        <Route path="/print/invoice/:id" element={<InvoicePrintPage />} />
        <Route path="/print/delivery/:id" element={<DeliveryPrintPage />} />
        <Route path="/pjkm/5.1.1" element={<Pjkm511PreviewPage />} />
        <Route path="/pjkm/10.1.1" element={<Pjkm1011PreviewPage />} />
        <Route path="/manufacturing/bmr/:sessionId" element={<BmrPrintPage />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/sales/import" element={<SalesImportPage />} />
          <Route path="/sales/import/mappings" element={<SalesImportMappingsPage />} />
          <Route path="/sales/import/:batchId" element={<SalesImportPage />} />
          <Route path="/sales/quotations" element={<QuotationsPage />} />
          <Route path="/sales/quotations/new" element={<QuotationEditorPage />} />
          <Route path="/sales/quotations/:id/edit" element={<QuotationEditorPage />} />
          <Route path="/sales/quotations/:id" element={<QuotationDetailPage />} />
          <Route path="/sales/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="/sales/delivery-orders" element={<DeliveryOrdersPage />} />
          <Route path="/sales/delivery-orders/new" element={<DeliveryEditorPage />} />
          <Route path="/sales/delivery-orders/:id/edit" element={<DeliveryEditorPage />} />
          <Route path="/sales/delivery-orders/:id" element={<DeliveryDetailPage />} />
          <Route path="/pos" element={<PosPage />} />
          <Route path="/sales/agents" element={<AgentsPage />} />
          <Route path="/sales/agents/pricing" element={<Navigate to={PRODUCT_PRICING_PATH} replace />} />
          <Route path="/sales/agents/:id" element={<AgentDetailPage />} />
          <Route path="/sales/returns" element={<SalesReturnsListPage />} />
          <Route path="/sales/returns/new" element={<SalesReturnEditorPage />} />
          <Route path="/sales/returns/:id" element={<SalesReturnDetailPage />} />
          <Route path="/sales-returns" element={<LegacySalesReturnsRedirect />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/purchases" element={<PurchasesPage />} />
          <Route path="/purchases/new" element={<NewPurchasePage />} />
          <Route path="/pjkm" element={<PjkmRecordsPage />} />
          <Route path="/receiving" element={<ReceivingListPage />} />
          <Route path="/receiving/new" element={<NewReceivingPage />} />
          <Route path="/receiving/:id" element={<ReceivingDetailPage />} />
          <Route path="/purchase-returns" element={<PurchaseReturnsPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/compliance/halal" element={<HalalCompliancePage />} />
          <Route path="/compliance/bmr" element={<BmrRecordsPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/inventory/stock-usage" element={<StockUsagePage />} />
          <Route path="/inventory/to-order" element={<ToOrderPage />} />
          <Route path="/inventory/warehouse-map" element={<WarehouseMapPage />} />
          <Route path="/inventory/opening-balance/:id" element={<OpeningBalancePage />} />
          <Route path="/inventory/opening-balance" element={<OpeningBalancePage />} />
          <Route path="/stock-movements" element={<StockMovementsPage />} />
          <Route path="/stock-adjustment" element={<StockAdjustmentPage />} />
          <Route path="/stock-transfer" element={<StockTransferPage />} />
          <Route path="/stock-count" element={<StockCountPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path={PRODUCT_PRICING_PATH} element={<ProductPricingPage />} />
          <Route path="/products/raw-materials" element={<RawMaterialsPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/manufacturing" element={<ManufacturingDashboardPage />} />
          <Route path="/manufacturing/today" element={<TodaysProductionPage />} />
          <Route path="/manufacturing/today/:id" element={<TodaysProductionPage />} />
          <Route path="/manufacturing/packing" element={<PackingListPage />} />
          <Route path="/manufacturing/packing/new" element={<NewPackingPage />} />
          <Route path="/manufacturing/packing/:id" element={<PackingDetailPage />} />
          <Route path="/manufacturing/carry-forward" element={<CarryForwardPage />} />
          <Route path="/manufacturing/complete/:id" element={<CompleteProductionPage />} />
          <Route path="/manufacturing/complete" element={<CompleteProductionPage />} />
          <Route path="/manufacturing/bom" element={<BomListPage />} />
          <Route path="/manufacturing/orders" element={<ProductionOrdersPage />} />
          <Route path="/manufacturing/orders/new" element={<NewProductionOrderPage />} />
          <Route path="/manufacturing/orders/:id" element={<ProductionOrderDetailPage />} />
          <Route path="/manufacturing/planning" element={<ProductionPlanningPage />} />
          <Route path="/manufacturing/picking" element={<PickingListPage />} />
          <Route path="/manufacturing/consumption" element={<MaterialConsumptionPage />} />
          <Route path="/manufacturing/finished-goods" element={<FinishedGoodsPage />} />
          <Route path="/manufacturing/history" element={<ProductionHistoryPage />} />
          <Route path="/manufacturing/history/:id/edit" element={<ProductionSessionEditPage />} />
          <Route path="/manufacturing/history/:id" element={<ProductionSessionDetailPage />} />
          <Route path="/reports/sales" element={<SalesReportPage />} />
          <Route path="/reports/purchases" element={<PurchaseReportPage />} />
          <Route path="/reports/inventory" element={<InventoryReportPage />} />
          <Route path="/reports/profit" element={<ProfitReportPage />} />
          <Route path="/reports/manufacturing" element={<ManufacturingReportPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/receivables" element={<ReceivablesPage />} />
          <Route path="/payables" element={<PayablesPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/settings/users" element={<UsersSettingsPage />} />
          <Route path="/settings/business" element={<BusinessSettingsPage />} />
          <Route path="/settings/inventory" element={<InventorySettingsPage />} />
          <Route path="/settings/sales" element={<SalesSettingsPage />} />
          <Route path="/settings/payments" element={<SalesSettingsPage />} />
          <Route path="/tasks" element={<MyTasksPage />} />
          <Route path="/tasks/manage/new" element={<TaskEditorPage />} />
          <Route path="/tasks/manage/:id" element={<TaskEditorPage />} />
          <Route path="/tasks/manage" element={<TaskManagePage />} />
          <Route path="/tasks/categories" element={<TaskCategoriesPage />} />
          <Route path="/tasks/:occurrenceId" element={<TaskDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
