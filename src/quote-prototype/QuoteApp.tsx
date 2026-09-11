import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QuoteDashboardPage } from './DashboardPage'
import { QuoteCustomersPage, QuoteProductsPage, QuoteSettingsPage } from './PartyPages'
import { QuoteLayout } from './QuoteLayout'
import { QuotationEditorPage, QuotationPreviewPage, QuotationsListPage } from './QuotationsPages'

export function QuoteApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<QuoteLayout />}>
          <Route path="/" element={<QuoteDashboardPage />} />
          <Route path="/quotations" element={<QuotationsListPage />} />
          <Route path="/quotations/new" element={<QuotationEditorPage />} />
          <Route path="/quotations/:id/preview" element={<QuotationPreviewPage />} />
          <Route path="/quotations/:id" element={<QuotationEditorPage />} />
          <Route path="/customers" element={<QuoteCustomersPage />} />
          <Route path="/products" element={<QuoteProductsPage />} />
          <Route path="/settings" element={<QuoteSettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
