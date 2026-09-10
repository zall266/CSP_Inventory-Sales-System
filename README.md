# StockFlow — Inventory & Sales Management

Interactive **frontend prototype** for the CSP Inventory & Sales System.

This phase is a high-fidelity click-through preview. There is no real backend, database, authentication, or payment processing. All data lives in a mock store (in-memory + `localStorage`).

## Preview name

- Product: **StockFlow**
- Subtitle: **Inventory & Sales Management**
- Demo business: **Cool Slurppy**

Branding is centralized in `src/brand.ts`.

## How to run

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default `http://localhost:5173`).

```bash
npm run build    # production build of the prototype
npm run preview  # serve the built files
```

## What’s included

Dashboard, POS, sales, purchases, inventory, stock movements / adjustment / transfer / count, products, customers, suppliers, returns, payments, receivables, payables, expenses, reports, and settings.

Create a sale in POS and inventory, sales lists, and dashboard KPIs update together. Same for purchases, adjustments, transfers, returns, and payments.

## Reset demo data

Business Settings → **Reset demo data**.
