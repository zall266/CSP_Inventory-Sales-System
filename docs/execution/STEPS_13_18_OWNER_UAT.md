# Steps 13–18 — Owner UAT checklists

Automated tests and live API read-backs are **not** owner UAT. Do not fabricate acceptance. Use isolated labels `UAT13-` … `UAT18-` / `COMPLETION-`. Do not edit locked closeout documents or `PROD-20261109-001`.

Public app: https://zall266.github.io/CSP_Inventory-Sales-System/

Actor unless noted: owner Aina Rahman (`u-aina`). Cashier denial: Siti (`u-siti`). Warehouse denial: Kumar (`u-kumar`) where relevant.

---

## Step 13 — Sales documents — OWNER UAT REQUIRED

### POS cash sale

| Item | Detail |
| --- | --- |
| Page | Sales → POS (`/pos`) |
| Objective | Paid walk-in sale posts stock-out once |
| Data | Sellable pack with stock, Walk-in customer, cash, qty 1 |
| Expected UI | Invoice `INV-` created, status Paid |
| Expected backend | `sales.create` `ok`, payment `PAY-`, movement type `sale` |
| Sheets | `Sales` + `SaleLines` + `Payments` + one `sale` StockMovements row |
| Stock | Finished-goods qty −1 |
| AuditLogs | `sales.create` |
| PASS | Document, payment, movement, and balance agree. Retry with the same idempotency key does not double-post |

### Unpaid invoice + collection

| Item | Detail |
| --- | --- |
| Page | Sales (`/sales`) then Finance → Payments (`/payments`) |
| Objective | Unpaid invoice then customer payment |
| Data | Wholesale/customer invoice, paid amount 0, then collect full |
| Expected UI | Status Unpaid → Paid, balance 0 |
| Expected backend | `sales.create` then `sales.recordPayment` |
| Sheets | Sale `paid` / `balance` match Payments sum |
| Stock | Out only on create, not on payment |
| PASS | Payment does not move stock. Second collection on a zero balance is rejected |

### Void remaining qty

| Item | Detail |
| --- | --- |
| Page | Invoice detail |
| Objective | Void restores remaining qty as `sales_return` `{invoiceNo}-VOID` |
| Expected UI | Status Voided. Payments are **not** reversed |
| Expected backend | `sales.void` once; second key `CONFLICT` |
| Stock | Remaining qty back in. Already-returned qty is not restored twice |
| PASS | Inventory + document agree; payments still present |

### Quotation convert once

| Item | Detail |
| --- | --- |
| Page | Sales → Quotations (`/sales/quotations`) |
| Objective | Convert a quotation to an invoice once |
| Expected UI | `INV-YYYYMMDD-###`. Agent quotations are not converted here |
| Expected backend | `quotations.convert` posts through `sales.create` |
| Stock | Same as a normal sale |
| PASS | Second convert is rejected. Print uses browser print; `documents.recordPrint` writes `DocumentAuditLogs` only |

### Delivery order — no stock

| Item | Detail |
| --- | --- |
| Page | Sales → Delivery Orders (`/sales/delivery-orders`) |
| Objective | Create / issue / deliver / cancel without inventory posts |
| Expected backend | `deliveries.*` `ok` |
| Stock | Unchanged |
| PASS | No StockMovements for the DO number |

### Cashier

| Item | Detail |
| --- | --- |
| Actor | Siti |
| Objective | Can POS-create; cannot void or quote |
| Expected backend | `sales.create` allowed by live cashier matrix; `sales.void` / `quotations.create` `FORBIDDEN` |
| PASS | Unauthorized call writes nothing |

---

## Step 14 — Sales returns — OWNER UAT REQUIRED

Do not confirm a return against a locked historical sale. Create a fresh `UAT14-` POS sale first.

### Draft does not move stock

| Item | Detail |
| --- | --- |
| Page | Sales → Returns (`/sales/returns`) → New |
| Objective | Save a draft |
| Data | Source Shopee, reason Changed mind, good qty only |
| Expected UI | `RT-` draft |
| Expected backend | `salesReturns.save` `ok` |
| Stock | Unchanged |
| PASS | Confirm is a separate action |

### Confirm good / repack / waste

| Item | Detail |
| --- | --- |
| Objective | Good IN to finished goods; repack grams to Box 1/2/3; waste does not add finished-goods qty |
| Expected backend | `salesReturns.confirm` with idempotency key |
| Sheets | `sales_return_good` IN; `sales_return_repack` skip-inventory; `production_balance_in`; `sales_return_waste` skip-inventory |
| Stock | Finished-goods qty += good only |
| AuditLogs | `sales_return_confirmed` |
| PASS | Good + repack + waste = returned qty. Same key replays. New key `CONFLICT` |

### Cashier denial

| Item | Detail |
| --- | --- |
| Actor | Siti |
| Expected backend | `salesReturns.save` `FORBIDDEN` “You cannot create a sales return.” |
| PASS | No `RT-` row |

---

## Step 15 — Sales import — OWNER UAT REQUIRED

Do not confirm live marketplace orders during this UAT if they would deduct real shop stock. Use a labelled test account.

| Item | Detail |
| --- | --- |
| Page | Sales → Sales Import (`/sales/import`) |
| Objective | Account → batch → picking text → map → confirm once onto `wh-main` |
| Data | Platform Shopee or TikTok only. Unique external order ids `UAT15-` |
| Expected UI | Batch status confirmed. Sales appear under Sales |
| Expected backend | `salesImport.confirm` posts through `sales.create` |
| Sheets | Import batch + Sales + `sale` movements |
| Stock | Component/finished SKUs out once per external order |
| PASS | Duplicate `{PLATFORM}:{account}:{externalOrderId}` does not double-post. Missing AWB does not block. Confirm without key is rejected |

Warehouse user `u-kumar` cannot import (`sales.create` false). Live cashier/staff matrices currently include `sales.create`, so they can import unless the owner changes the matrix.

---

## Step 16 — Dispatch — OWNER UAT REQUIRED

Confirm/void do **not** post inventory.

| Item | Detail |
| --- | --- |
| Pages | Settings → Vehicles (`/settings/vehicles`); Sales → Dispatch (`/sales/dispatch`) |
| Objective | Create vehicle, draft dispatch from an existing shipment, confirm, optional inspection group, void |
| Data | Unique vehicle code `UAT16-`. Use a sales-import shipment or skip confirm if none exist |
| Expected UI | Dispatch `confirmed` then `void`. Inspection group `IG-` |
| Expected backend | `vehicles.create`, `dispatch.confirm`, `dispatch.createInspectionGroup`, `dispatch.void` |
| Sheets | `Vehicles`, `Dispatches`, `DispatchLines`, `InspectionGroups` |
| Stock | Unchanged on confirm and void |
| PASS | Inactive vehicle cannot confirm. Confirmed shipment cannot be reused until void. Cashier `vehicles.create` / `dispatch.create` `FORBIDDEN` |

---

## Step 17 — Halal, tasks, expenses — OWNER UAT REQUIRED

Ops writes do not post inventory.

### Halal certificate

| Item | Detail |
| --- | --- |
| Page | Compliance → Halal (`/compliance/halal`) |
| Objective | Manufacturer + compliance with PDF/JPG/PNG |
| Data | Manufacturer `UAT17-Acme`, unique certificate no, expiry in the future |
| Expected UI | Verified/pending as selected. File visible |
| Expected backend | `halal.saveManufacturer` / `halal.saveCompliance` |
| Drive | File in `HalalCertificates` |
| Sheets | `Manufacturers`, `HalalCertificates`, `HalalCompliances` |
| PASS | Duplicate manufacturer name rejected. Staff cannot manage |

### Staff task complete with photo

| Item | Detail |
| --- | --- |
| Page | Tasks (`/tasks`) |
| Objective | Create, start, attach photo, complete once |
| Data | Category from seeded list, assigned to owner, photo required |
| Expected backend | `tasks.complete` with key; replay same key; missing photo blocked |
| Drive | `TaskPhotos` |
| PASS | Unassigned staff cannot start the owner’s task |

### Expense

| Item | Detail |
| --- | --- |
| Page | Finance → Expenses (`/expenses`) |
| Objective | Owner can add; cashier/staff cannot |
| Data | Description `UAT17-rent`, amount > 0 |
| Expected UI | Add expense visible only with `expenses.manage`. Other roles see permission denied or a hidden button |
| Expected backend | `expenses.create` `ok` for owner; `FORBIDDEN` “You cannot manage expenses.” otherwise |
| Sheets | One `Expenses` row. No StockMovements |
| PASS | Unauthorized UI and API both refuse. No local-only expense when the API is connected |

---

## Step 18 — Dashboard, reports, PJKM, BMR — OWNER UAT REQUIRED

Reads only. No inventory posts.

| Item | Detail |
| --- | --- |
| Pages | Dashboard (`/`); Reports → Sales / Purchases / Inventory / Profit / Manufacturing; PJKM (`/pjkm`); BMR (`/compliance/bmr`) |
| Objective | KPIs and tables match sheet-backed APIs for the selected range |
| Data | Existing DEV documents. Optional `today` is the prototype header date on some report filters; Daily Sessions uses live Malaysia date |
| Expected UI | Overlay numbers load. Cashier cannot open dashboard/reports/PJKM/BMR |
| Expected backend | `dashboard.get`, `reports.*`, `pjkm.511/911/1011`, `bmr.list` / `bmr.get` |
| Sheets | No new rows |
| PASS | Empty range shows zeros. Cashier `FORBIDDEN`. InventoryBalances unchanged after the reads |

PJKM 9.1.1 unique AWB count is unique tracking numbers, not parcel sum.

---

## Shared PASS / FAIL rule

PASS only when the UI result, API result, sheet rows, stock movement (or proven absence), and AuditLogs agree for that isolated document. FAIL if any layer disagrees. Do not repair historical rows to force a pass.
