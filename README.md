# Cool Slurppy Marketing — B2B Quotation Prototype

Interactive **frontend prototype** for a professional B2B quotation / sales document system.

This phase is a high-fidelity click-through preview. There is no real backend, database, authentication, or email sending. All data lives in a mock store (`localStorage` key `csp-quotation-prototype-v1`).

The existing StockFlow ERP screens remain in the repo under `src/features/`, but this branch boots the quotation prototype.

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

## Pages

- Dashboard
- Quotations (list, create/edit, A4 preview/print)
- Customers
- Products
- Settings

## Reset demo data

Settings → **Reset prototype data**.
