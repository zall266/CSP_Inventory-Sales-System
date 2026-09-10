# StockFlow Interactive Prototype Plan

Temporary product name: **StockFlow** — Inventory & Sales Management  
Phase: **Interactive frontend prototype only** (no backend, database, auth, or payments).

## Existing architecture

The repository is a greenfield GitHub project (`CSP_Inventory-Sales-System`) containing only a README. There is:

- No existing frontend framework
- No CSS/UI system
- No reusable component library
- No dashboard or sidebar
- Nothing to reuse besides the README description

## Prototype architecture

New frontend app at the repository root.

| Layer | Choice |
| --- | --- |
| Framework | React 19 + TypeScript |
| Bundler | Vite |
| Styling | Tailwind CSS v4 |
| Icons | Lucide |
| Charts | Recharts |
| Routing | React Router |
| State | In-memory mock database (`useSyncExternalStore`) with optional `localStorage` persistence |
| Branding | `src/brand.ts` so the name/subtitle are easy to change |

Service functions live in `src/services/mockApi.ts` and operate on local mock state. Replacing them with real API calls later should not require rewriting pages.

Recommended layout:

```
src/
  brand.ts
  types/
  data/            # seed / demo data
  services/        # mock API (get/create/update)
  store/           # reactive mock database
  components/      # layout + reusable UI
  features/        # page-level feature modules
  hooks/
  utils/
  App.tsx
```

## Visual language

Inspired by premium finance / inventory SaaS (Finnova-style invoice UI as the primary reference; dense operational dashboard as secondary).

- Light theme, white cards, very light gray canvas
- Indigo / purple primary accent
- Dark navy text, muted slate secondary text
- Large rounded cards, soft shadows, subtle borders
- Compact premium sidebar, spacious content
- Professional tables and status badges

## Pages

| Route | Page |
| --- | --- |
| `/` | Dashboard |
| `/sales` | Sales list + detail drawer |
| `/pos` | Point of sale |
| `/sales-returns` | Sales returns |
| `/customers` | Customers + detail drawer |
| `/purchases` | Purchases list + detail drawer |
| `/purchases/new` | New purchase / receive |
| `/purchase-returns` | Purchase returns |
| `/suppliers` | Suppliers + detail drawer |
| `/inventory` | Inventory + product stock drawer |
| `/stock-movements` | Stock ledger |
| `/stock-adjustment` | Stock adjustment |
| `/stock-transfer` | Stock transfer |
| `/stock-count` | Physical stock count |
| `/products` | Products + add/edit |
| `/categories` | Categories |
| `/reports/sales` | Sales reports |
| `/reports/purchases` | Purchase reports |
| `/reports/inventory` | Inventory reports |
| `/reports/profit` | Profit reports |
| `/payments` | Payments |
| `/receivables` | Accounts receivable |
| `/payables` | Accounts payable |
| `/expenses` | Expenses |
| `/settings/users` | Users & roles |
| `/settings/business` | Business settings |
| `/settings/inventory` | Inventory settings |
| `/settings/sales` | Sales settings |
| `/settings/payments` | Payment settings |

## Components

- App shell: sidebar, header, mobile drawer
- UI kit: buttons, inputs, selects, tabs, badges, KPIs, tables, modals, drawers, toasts, empty states, confirm dialogs
- Global search dropdown
- Quick Add menu
- Notifications dropdown
- Product / sale / purchase / customer / supplier drawers
- POS cart + payment + success modal
- Charts (line, bar, donut)

## Mock data structure

Central seed + store:

- `products`, `categories`, `warehouses`
- `inventory` (product × warehouse qty)
- `customers`, `suppliers`
- `sales`, `purchases`, `salesReturns`, `purchaseReturns`
- `stockMovements`
- `payments`, `expenses`
- `users`, `notifications`
- `settings`

Malaysian F&B / beverage-ingredient context, currency **MYR / RM**.

## Mock services

```
getProducts / createProduct / updateProduct
getInventory
createSale / createPurchase / receivePurchase
adjustStock / transferStock / completeStockCount
createSalesReturn / createPurchaseReturn
recordPayment
createExpense / createCustomer / createSupplier
```

All mutations update the same in-memory graph so dashboard KPIs, inventory, ledgers, and lists stay connected.

## Navigation structure

Collapsible sidebar groups:

- HOME — Dashboard
- SALES — Sales, POS, Sales Returns, Customers
- PURCHASES — Purchases, Purchase Returns, Suppliers
- INVENTORY — Inventory, Stock Movements, Stock Adjustment, Stock Transfer, Stock Count
- PRODUCTS — Products, Categories
- REPORTS — Sales, Purchase, Inventory, Profit
- FINANCE — Payments, Receivables, Payables, Expenses
- SETTINGS — Users & Roles, Business, Inventory, Sales

Header: search, Quick Add, notifications, date, preview-mode badge, profile.

## User flows (prototype)

1. **POS sale** — add products → qty/discount/customer → complete → invoice modal → inventory down, sales + dashboard update.
2. **Receive purchase** — add lines → receive → stock up, purchase + movements update.
3. **Adjust / transfer / count** — confirm → inventory + stock movements update.
4. **Returns** — select document & qty → stock moves in the correct direction.
5. **AR/AP payment** — record payment → balance and payment list update.
6. **Add product / customer / supplier / expense** — forms write to local state and appear in tables.
7. **Global search / Quick Add** — jump to the matching page or open the matching modal/drawer.

## Implementation sequence

1. Scaffold Vite + Tailwind + routing + design tokens
2. Types, seed data, mock store/services
3. Layout (sidebar/header) and UI kit
4. Dashboard
5. Products, categories, inventory, product drawer
6. POS + sales + sale drawer
7. Purchases + new purchase
8. Stock movements / adjustment / transfer / count
9. Customers, suppliers, returns
10. Payments, receivables, payables, expenses
11. Reports
12. Settings + users/roles
13. Global search, Quick Add, notifications, responsive behaviour
14. Manual click-through of the prototype acceptance checklist

## Out of scope (this phase)

- Real database / API
- Real authentication
- Real payment processing
- Production inventory ledger / costing engine
- Production accounting
