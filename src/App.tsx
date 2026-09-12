import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { PosPage } from '@/features/pos/PosPage'
import { SalesPage } from '@/features/sales/SalesPage'
import { CategoriesPage, ProductsPage, RawMaterialsPage } from '@/features/products/ProductsPage'
import { InventoryPage } from '@/features/inventory/InventoryPage'
import { WarehouseMapPage } from '@/features/warehouse/WarehouseMapPage'
import { StockAdjustmentPage, StockCountPage, StockMovementsPage, StockTransferPage } from '@/features/inventory/StockPages'
import { NewPurchasePage, PurchasesPage } from '@/features/purchases/PurchasesPage'
import { CustomersPage, SuppliersPage } from '@/features/parties/PartiesPages'
import { PurchaseReturnsPage, SalesReturnsPage } from '@/features/returns/ReturnsPages'
import { ExpensesPage, PayablesPage, PaymentsPage, ReceivablesPage } from '@/features/finance/FinancePages'
import { InventoryReportPage, ProfitReportPage, PurchaseReportPage, SalesReportPage } from '@/features/reports/ReportsPages'
import { BusinessSettingsPage, InventorySettingsPage, SalesSettingsPage, UsersSettingsPage } from '@/features/settings/SettingsPages'
import { ManufacturingDashboardPage } from '@/features/manufacturing/ManufacturingDashboardPage'
import { BomListPage } from '@/features/manufacturing/BomPages'
import { NewProductionOrderPage, ProductionOrderDetailPage, ProductionOrdersPage } from '@/features/manufacturing/ProductionOrdersPage'
import { ProductionPlanningPage } from '@/features/manufacturing/ProductionPlanningPage'
import { FinishedGoodsPage, MaterialConsumptionPage } from '@/features/manufacturing/SessionRecordPages'
import { ProductionHistoryPage, ProductionSessionDetailPage, ProductionSessionEditPage } from '@/features/manufacturing/ProductionHistoryPage'
import { ManufacturingReportPage } from '@/features/manufacturing/ManufacturingReportsPages'
import { TodaysProductionPage } from '@/features/manufacturing/TodaysProductionPage'
import { CompleteProductionPage } from '@/features/manufacturing/CompleteProductionPage'
import { PickingListPage } from '@/features/manufacturing/PickingListPage'

import { QuotationsPage, QuotationEditorPage, QuotationDetailPage, QuotationPrintPage } from '@/features/documents/QuotationPages'
import { InvoiceDetailPage, InvoicePrintPage } from '@/features/documents/InvoicePages'
import { DeliveryOrdersPage, DeliveryEditorPage, DeliveryDetailPage, DeliveryPrintPage } from '@/features/documents/DeliveryPages'
import { AgentDetailPage, AgentsPage } from '@/features/agent/AgentPages'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/print/quotation/:id" element={<QuotationPrintPage />} />
        <Route path="/print/invoice/:id" element={<InvoicePrintPage />} />
        <Route path="/print/delivery/:id" element={<DeliveryPrintPage />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/sales" element={<SalesPage />} />
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
          <Route path="/sales/agents/:id" element={<AgentDetailPage />} />
          <Route path="/sales-returns" element={<SalesReturnsPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/purchases" element={<PurchasesPage />} />
          <Route path="/purchases/new" element={<NewPurchasePage />} />
          <Route path="/purchase-returns" element={<PurchaseReturnsPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/inventory/warehouse-map" element={<WarehouseMapPage />} />
          <Route path="/stock-movements" element={<StockMovementsPage />} />
          <Route path="/stock-adjustment" element={<StockAdjustmentPage />} />
          <Route path="/stock-transfer" element={<StockTransferPage />} />
          <Route path="/stock-count" element={<StockCountPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/raw-materials" element={<RawMaterialsPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/manufacturing" element={<ManufacturingDashboardPage />} />
          <Route path="/manufacturing/today" element={<TodaysProductionPage />} />
          <Route path="/manufacturing/today/:id" element={<TodaysProductionPage />} />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
