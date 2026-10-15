import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { PosPage } from '@/features/pos/PosPage'
import { SalesPage } from '@/features/sales/SalesPage'
import { CategoriesPage, ProductsPage } from '@/features/products/ProductsPage'
import { InventoryPage } from '@/features/inventory/InventoryPage'
import { StockAdjustmentPage, StockCountPage, StockMovementsPage, StockTransferPage } from '@/features/inventory/StockPages'
import { NewPurchasePage, PurchasesPage } from '@/features/purchases/PurchasesPage'
import { CustomersPage, SuppliersPage } from '@/features/parties/PartiesPages'
import { PurchaseReturnsPage, SalesReturnsPage } from '@/features/returns/ReturnsPages'
import { ExpensesPage, PayablesPage, PaymentsPage, ReceivablesPage } from '@/features/finance/FinancePages'
import { InventoryReportPage, ProfitReportPage, PurchaseReportPage, SalesReportPage } from '@/features/reports/ReportsPages'
import { BusinessSettingsPage, InventorySettingsPage, SalesSettingsPage, UsersSettingsPage } from '@/features/settings/SettingsPages'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/pos" element={<PosPage />} />
          <Route path="/sales-returns" element={<SalesReturnsPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/purchases" element={<PurchasesPage />} />
          <Route path="/purchases/new" element={<NewPurchasePage />} />
          <Route path="/purchase-returns" element={<PurchaseReturnsPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/stock-movements" element={<StockMovementsPage />} />
          <Route path="/stock-adjustment" element={<StockAdjustmentPage />} />
          <Route path="/stock-transfer" element={<StockTransferPage />} />
          <Route path="/stock-count" element={<StockCountPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/reports/sales" element={<SalesReportPage />} />
          <Route path="/reports/purchases" element={<PurchaseReportPage />} />
          <Route path="/reports/inventory" element={<InventoryReportPage />} />
          <Route path="/reports/profit" element={<ProfitReportPage />} />
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
