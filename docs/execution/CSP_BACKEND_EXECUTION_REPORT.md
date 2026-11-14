# CSP Backend Execution Report

Steps 9, 10, and 11 are **PASS / LOCKED** by owner authorization dated 9 Nov 2026. Step 12 Daily Sessions is **OWNER UAT REQUIRED**. Do not mark Step 12 PASS or LOCKED. Step 13 Sales documents is **IN PROGRESS** (backend merged; owner UAT not started). Step 14 Sales returns is **IN PROGRESS** (backend merged; owner UAT not started). Step 15 Sales import is **IN PROGRESS** (backend merged and live-verified; owner UAT not started). Step 16 Dispatch is **IN PROGRESS** (backend merged and live-verified; owner UAT not started). Step 17 Halal, tasks, expenses is **IN PROGRESS** (backend merged and live-verified; owner UAT not started). Step 18 Reads is **IN PROGRESS**.

Statuses used here: PASS / PASS / LOCKED / OWNER UAT REQUIRED / BLOCKED / IN PROGRESS. Untouched later modules stay NOT STARTED.

## Owner decision — Step 12 past-date accept/start (14 Nov 2026, MYT)

The owner kept the existing Daily Sessions past-date restriction. Options A and C were not implemented. `PROD-20261109-001` was not accepted, started, edited, cancelled, or duplicated. Step 12 stays **OWNER UAT REQUIRED**. This is **DOCUMENTED BUSINESS RULE** as of this owner decision; the prior audit classified the code path as an **IMPLEMENTATION RESTRICTION** that the owner has now confirmed.

## Step 13 — Sales documents — IN PROGRESS

Backend matches the existing Sales / POS / quotation / delivery / customer-payment / print-audit frontend. Locked Steps 9–11 were not redesigned. Step 12 business rules were not changed. Agent sales remain on the existing local `createAgentSale` path (`agents.createSale` is not this module).

| Item | Status |
| --- | --- |
| Sale create | POS and invoice `sales.create`. Component snapshot OUT on component SKUs only. Agent warehouse rejected. |
| Wholesale | `sales.createWholesale` uses customer wholesale price, then product wholesale, then selling price. |
| Void | Restores remaining qty as `sales_return` with `{invoiceNo}-VOID`. Payments are not reversed. |
| Customer payment | Shared `Payments` / `PAY-` series with Step 9 supplier payments. Status `paid` / `partial`. |
| Quotations | Create/update/status. Convert posts a dated `INV-YYYYMMDD-###` once. Agent quotations are not converted here. |
| Delivery orders | No stock movements on create, issue, deliver, or cancel. |
| Print | `documents.recordPrint` writes `DocumentAuditLogs` only. Browser print is unchanged. |
| Automated tests | **118 pass, 0 fail** on the Step 13 branch (`npm run test:backend`). TypeScript and production build succeeded. |
| Owner UAT | **Not started.** Automated tests are not owner UAT. Do not fabricate UAT. |
| Merge | PR #105 merged to `cursor/dev-frontend-github-pages-d9ac` as `e287a0a` (14 Nov 2026, MYT). |

Locked DEV resources remain the existing Apps Script project, spreadsheet, Drive root, and `/exec`. Historical closeout evidence below is unchanged.

Integration branch: `cursor/dev-frontend-github-pages-d9ac` at `e287a0a` (merge of PR #105). Step 12 business rules were not changed. `PROD-20261109-001` was not touched.

## Step 14 — Sales returns — IN PROGRESS

Backend matches the existing good / repack / waste sales-return frontend. Locked Steps 9–11 were not redesigned. Step 12 business rules were not changed. Agent sales (`SAL-`) and agent warehouses are rejected. Evidence stays metadata JSON; Drive blob upload on confirm is not in this module.

| Item | Status |
| --- | --- |
| Draft save | `salesReturns.save` / `update` / `cancel`. No inventory or production-balance write. `RT-` numbers. |
| Confirm good | `sales_return_good` IN to company warehouse finished-goods qty. |
| Confirm repack | `sales_return_repack` skip-inventory; `production_balance_in` skip-inventory; grams posted to the selected Box 1/2/3. |
| Confirm waste | `sales_return_waste` skip-inventory (finished-goods qty unchanged). |
| Original sale | Confirmed return adds `returnedQty` on the linked sale. Fully returned sales become `returned`. |
| Lookups | Default Return Sources / Reasons seeded on first list. Inactive source/reason rejected. |
| Idempotency | Confirm requires a key. Same key replays. A second key returns `CONFLICT`. |
| Automated tests | **122 pass, 0 fail** on this branch (`npm run test:backend`), including 4 new sales-return tests. TypeScript and production build succeeded. |
| Merge | PR #106 merged to `cursor/dev-frontend-github-pages-d9ac` as `e912d73` (14 Nov 2026, 2:00 PM MYT). |
| Owner UAT | **Not started.** Automated tests and live API read-backs are not owner UAT. |

### Live DEV verify — 14 Nov 2026, 2:00–2:01 PM MYT

This block is implementation evidence, not owner UAT. No confirmed sales return was posted. `PROD-20261109-001` was not touched.

| Check | Evidence |
| --- | --- |
| Apps Script version | **v24**, `versionDescription=git:ae944b0b98b59e52634d651f6d2e0131e7682b64`. Deploy DEV run [43564130043](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/43564130043). Same `/exec`. |
| Health | `GET /exec` at 2:00 PM MYT: DEV, healthy, spreadsheet and Drive accessible, foundation ready. |
| `salesReturns.list` | `ok: true`. `salesReturns` empty. Default Return Sources (10) and Return Reasons (7) seeded. Existing production balances `pb-mt-1` / `pb-st-1` / `pb-cl-1` unchanged. |
| Confirm without key | `VALIDATION_ERROR` "Idempotency key is required." |
| Cashier deny | `u-siti` `salesReturns.save` → `FORBIDDEN` "You cannot create a sales return." |
| Regression Step 13 | `sales.list` still `ok`; 0 sales, 2 payments (`PAY-000001` / `PAY-000002` from the locked closeout). |
| Public frontend | Pages deploy [43564241590](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/43564241590) for merge `e912d73`. Live `index.html` loads `assets/index-C0iH2OAm.js`, which contains `salesReturns.list`, `salesReturns.save`, `salesReturns.confirm`, `sales_return_good`, and `returnSources.upsert`. |

Locked Apps Script: `1mkRzptY0mzHnzOFB8TA6AGIZyv6q2gJq-QdKPBWtV91oq5okHWVpY4Jj`.
DEV spreadsheet: `1TPmkASdzlGssGyAisklf4QkLcxWYbHHhUSxntgLha94`.
`/exec`: `AKfycbyMDLwOJ2iqD_nuLFcVMQYrS81WDkkaBhutTGBCrbUClM1Aap1MJiO6CnzzcYuTAoMbDw`.

## Step 15 — Sales import — IN PROGRESS

Backend matches the existing account → batch → picking PDF → optional AWB → map → confirm frontend. Locked Steps 9–11 were not redesigned. Step 12 business rules were not changed. `PROD-20261109-001` was not touched. Confirm posts through the existing `sales.create` path onto `wh-main`. PDF bytes stay in the browser; the backend re-parses submitted text items.

| Item | Status |
| --- | --- |
| Account / batch | `salesImport.createAccount` / `createBatch`. Platforms `shopee` and `tiktok` only. |
| Ingest | `ingestPicking` / `ingestAwb` re-parse text items. Same `fileHash` in a batch is rejected. |
| Mapping | SKU or normalized text, active flag. Exact SKU auto-maps. |
| Confirm | Same sale post as Step 13. Component SKUs OUT. Duplicate `{PLATFORM}:{account}:{externalOrderId}` does not double-post. |
| Gates | Missing AWB does not block. Spot-check keys are stored and are not a confirm gate. |
| Idempotency | Confirm requires a key. Same key replays. A later key on a fully confirmed batch posts 0 extra sales. |
| Automated tests | **129 pass, 0 fail** on the Step 15 branch (`npm run test:backend`), including 7 new sales-import tests. TypeScript and production build succeeded. |
| Merge | PR #108 merged to `cursor/dev-frontend-github-pages-d9ac` as `f7f16f6` (14 Nov 2026, 2:14 PM MYT). |
| Owner UAT | **Not started.** Automated tests and live API read-backs are not owner UAT. |

### Live DEV verify — 14 Nov 2026, 2:14–2:20 PM MYT

This block is implementation evidence, not owner UAT. No confirmed sales import was posted. `PROD-20261109-001` was not touched. Step 12 business rules were not changed.

| Check | Evidence |
| --- | --- |
| Apps Script version | **v25**, `versionDescription=git:31cf98ae3a5c6938efdfaa3cb2948d16d8201a84`. Deploy DEV run [43565235558](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/43565235558). Same `/exec`. |
| Health | `GET /exec` at 2:16 PM MYT: DEV, healthy, spreadsheet and Drive accessible, foundation ready. |
| `salesImport.list` | `ok: true`. Batches, files, orders, lines, mappings, and shipments empty. Sales still 0. Inventory 234 rows, 53 stock movements (locked closeout unchanged). |
| Confirm without key | `VALIDATION_ERROR` "Idempotency key is required." |
| Permission | Import writes use `sales.create`, matching the frontend. Live `role-cashier` and `role-staff` have that key, so `u-siti` / `u-mei` can create accounts. `u-kumar` (`role-warehouse`, `sales.create` false) `salesImport.createAccount` → `FORBIDDEN` "You cannot import sales." Unknown actor `u-nobody` is also `FORBIDDEN`. |
| Live-verify artifacts | Account `sia_d7ff7202b4` `coolslurppypowder` plus two permission-probe accounts (`cashier-should-fail`, `should-fail`). No batches and no posted sales. |
| Regression | `sales.list` 0 sales, 2 payments. `salesReturns.list` 0 returns, 10 sources, 7 reasons. `productionOrders.list` and packing list still `ok`. |
| Public frontend | Pages deploy [43565363229](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/43565363229) for merge `f7f16f6`. Live `index.html` (last-modified 14 Nov 2026, 2:15 PM MYT) loads `assets/index-DQpXlgLm.js`, which contains `salesImport.list`, `salesImport.createAccount`, `salesImport.ingestPicking`, and `salesImport.confirm`. |

Locked Apps Script: `1mkRzptY0mzHnzOFB8TA6AGIZyv6q2gJq-QdKPBWtV91oq5okHWVpY4Jj`.
DEV spreadsheet: `1TPmkASdzlGssGyAisklf4QkLcxWYbHHhUSxntgLha94`.
`/exec`: `AKfycbyMDLwOJ2iqD_nuLFcVMQYrS81WDkkaBhutTGBCrbUClM1Aap1MJiO6CnzzcYuTAoMbDw`.

## Step 16 — Dispatch — IN PROGRESS

Backend matches the existing vehicles / dispatch / inspection-group frontend. Locked Steps 9–11 were not redesigned. Step 12 business rules were not changed. `PROD-20261109-001` was not touched. Vehicles were deferred from Step 4 parties and are implemented here. Confirm and void do not post inventory.

| Item | Status |
| --- | --- |
| Vehicles | `vehicles.create` / `update` / `setActive`. `settings.edit`. Code unique case-insensitive. Inactive vehicles cannot be used on a draft or confirm. |
| Dispatch | `dispatch.create` / `update` / `confirm` / `void`. No document series. Status `draft` → `confirmed` → `void`. Confirm snapshots vehicle code/type/plate and tracking, sets `condition: BAIK`. |
| Lines | Nested on the API snapshot; stored on `DispatchLines`. Shipment must exist. Confirmed shipment cannot be reused until void. Draft update steals the shipment from other drafts. Empty confirm is allowed. |
| Inspection groups | `dispatch.createInspectionGroup` / `dispatch.release`. `IG-` pad 4. Same date, no courier overlap, confirmed members only. Release clears membership and keeps the row. |
| Permissions | View: delivery view/create/edit or `settings.edit`. Create/confirm: `sales.delivery.create`. Update: create or edit. Void and groups: `sales.delivery.edit`. |
| Idempotency | Confirm, void, inspection-group create, and release require a key. Same key replays. |
| Automated tests | **135 pass, 0 fail** on the Step 16 branch (`npm run test:backend`), including 6 new dispatch tests. TypeScript and production build succeeded. |
| Merge | PR #109 merged to `cursor/dev-frontend-github-pages-d9ac` as `0140e9b` (14 Nov 2026, MYT). |
| Owner UAT | **Not started.** Automated tests and live API read-backs are not owner UAT. Do not fabricate UAT. |

### Live DEV verify — 14 Nov 2026, MYT

This block is implementation evidence, not owner UAT. No vehicle, dispatch, or inspection group was created. No confirmed dispatch was posted. `PROD-20261109-001` was not touched. Step 12 business rules were not changed.

| Check | Evidence |
| --- | --- |
| Apps Script version | **v26**, `versionDescription=git:efda109f331f875cb76317ac1b709dcd9ce2fb54`. Deploy DEV run [43566472547](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/43566472547). Same `/exec`. |
| Health | `GET /exec`: DEV, healthy, spreadsheet and Drive accessible, foundation ready. |
| `dispatch.list` | `ok: true`. Vehicles, dispatches, and inspection groups empty. Inventory 234 rows, 53 stock movements (locked closeout unchanged). |
| Confirm without key | `VALIDATION_ERROR`. |
| Permission | `u-siti` `vehicles.create` → `FORBIDDEN` "You cannot maintain vehicles." `u-siti` `dispatch.create` → `FORBIDDEN` "You cannot create a dispatch." `u-kumar` list ok. |
| Regression | `salesImport.list` still 3 accounts, 0 batches, 0 sales. `sales.list` 2 payments. `salesReturns.list` 0 returns. |
| Public frontend | Pages deploy [43566603331](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/43566603331) for merge `0140e9b`. Live bundle `assets/index-C4Goe4h1.js` contains `dispatch.list`, `dispatch.confirm`, and `vehicles.create`. |

Locked Apps Script: `1mkRzptY0mzHnzOFB8TA6AGIZyv6q2gJq-QdKPBWtV91oq5okHWVpY4Jj`.
DEV spreadsheet: `1TPmkASdzlGssGyAisklf4QkLcxWYbHHhUSxntgLha94`.
`/exec`: `AKfycbyMDLwOJ2iqD_nuLFcVMQYrS81WDkkaBhutTGBCrbUClM1Aap1MJiO6CnzzcYuTAoMbDw`.

## Step 17 — Halal, tasks, expenses — IN PROGRESS

Backend matches the existing Halal Compliance, staff tasks, and expenses frontend. Locked Steps 9–11 were not redesigned. Step 12 business rules were not changed. `PROD-20261109-001` was not touched. Certificate PDFs/JPG/PNG upload to Drive folder `HalalCertificates`. Task photos upload to `TaskPhotos`. Ops writes do not post inventory.

| Item | Status |
| --- | --- |
| Halal | `halal.list` / `saveManufacturer` / `saveCompliance`. Unique manufacturer names. Certificate document required. Renew with a new file creates a new certificate and keeps previous ids. |
| Tasks | `tasks.list` seeds default categories (`tcat-cleaning` … `tcat-general`). Category CRUD, task create/update/deactivate, start, attach photo, complete. Photo-required complete is blocked without a photo. |
| Expenses | `expenses.list` / `expenses.create`. Create requires `expenses.manage` (architecture). The current frontend `/expenses` page does not check that key; that is a documented frontend gap, not an owner stop. |
| Idempotency | `tasks.complete` requires a key. Same key replays. |
| Automated tests | **141 pass, 0 fail** on this branch (`npm run test:backend`), including 6 new ops tests. TypeScript and production build succeeded. |
| Merge | PR #110 merged to `cursor/dev-frontend-github-pages-d9ac` as `beb316c` (14 Nov 2026, MYT). |
| Owner UAT | **Not started.** Automated tests and live API read-backs are not owner UAT. Do not fabricate UAT. |

### Live DEV verify — 14 Nov 2026, 2:41 PM MYT

This block is implementation evidence, not owner UAT. No manufacturer, certificate, task, or expense was created. `PROD-20261109-001` was not touched. Step 12 business rules were not changed.

| Check | Evidence |
| --- | --- |
| Apps Script version | **v27**, `versionDescription=git:05230148381a654682c23639bd0d255b9d872998`. Deploy DEV run [43567412071](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/43567412071). Same `/exec`. |
| Health | `GET /exec`: DEV, healthy, spreadsheet and Drive accessible, foundation ready. |
| `halal.list` | `ok: true`. Manufacturers, certificates, and compliances empty. |
| `tasks.list` | `ok: true`. 5 default categories seeded (`tcat-cleaning` … `tcat-general`). 0 tasks. |
| `expenses.list` | `ok: true`. 0 expenses. |
| Complete without key | `VALIDATION_ERROR` "Idempotency key is required." |
| Permission | `u-siti` / `u-kumar` `halal.saveManufacturer` → `FORBIDDEN` "You cannot manage Halal Compliance." `u-siti` `expenses.create` → `FORBIDDEN` "You cannot manage expenses." |
| Regression | Inventory 234 rows, 53 stock movements. Sales 0, 2 payments. Import 3 accounts, 0 batches. Returns 0, 10 sources, 7 reasons. |
| Public frontend | Pages deploy [43567556144](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/43567556144) for merge `beb316c`. Live bundle `assets/index-g02v_lq4.js` (Last-Modified 14 Nov 2026, 2:41 PM MYT) contains `halal.list`, `halal.saveManufacturer`, `halal.saveCompliance`, `tasks.list`, `tasks.create`, `tasks.complete`, `tasks.attachPhoto`, `expenses.list`, and `expenses.create`. |

Locked Apps Script: `1mkRzptY0mzHnzOFB8TA6AGIZyv6q2gJq-QdKPBWtV91oq5okHWVpY4Jj`.
DEV spreadsheet: `1TPmkASdzlGssGyAisklf4QkLcxWYbHHhUSxntgLha94`.
`/exec`: `AKfycbyMDLwOJ2iqD_nuLFcVMQYrS81WDkkaBhutTGBCrbUClM1Aap1MJiO6CnzzcYuTAoMbDw`.

## Step 18 — Reads (dashboard, reports, PJKM, BMR) — IN PROGRESS

Backend matches the existing dashboard, report, PJKM, and BMR page math. Locked Steps 9–11 were not redesigned. Step 12 business rules were not changed. `PROD-20261109-001` was not touched. These APIs are locked reads and do not post inventory.

| Item | Status |
| --- | --- |
| Dashboard | `dashboard.get`. Date preset `7d` / `30d` / `90d` / `custom`. Client sends `today` so prototype `2026-09-10` matches. `dashboard.view`. |
| Reports | `reports.sales` / `purchases` / `inventory` / `profit` / `manufacturing`. `reports.view`. No summary sheets. Print stays in the browser. |
| PJKM | `pjkm.511` / `911` / `1011`. Month `YYYY-MM`. `receiving.view`. 9.1.1 unique AWB tracking count, not parcel sum. |
| BMR | `bmr.list` / `bmr.get`. Completed and posted sessions only. `manufacturing.history.view`. Grams per pack = `bulkYieldGrams / outputQty`. |
| Automated tests | **147 pass, 0 fail** on this branch (`npm run test:backend`), including 6 new reporting tests. TypeScript and production build succeeded. |
| Owner UAT | **Not started.** Automated tests are not owner UAT. Do not fabricate UAT. |

Integration branch target: `cursor/dev-frontend-github-pages-d9ac`. Step 12 business rules were not changed. Steps 9–11 remain PASS / LOCKED.

## Deployed runtime (verified this closeout)

| Check | Evidence |
| --- | --- |
| Apps Script version | **v19**, `versionDescription=git:c7a88d33797511922b09a2b99632c8b41fb347db`. Deploy DEV run [42254596523](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/42254596523), published 7 Nov 2026, 12:41 AM MYT. No later Apps Script deploy. |
| Health | `GET /exec` at 8 Nov 2026, 9:46 PM MYT: DEV, healthy, spreadsheet and Drive accessible, foundation ready. |
| Public frontend | Pages deploy [42254560519](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/42254560519) for the same SHA. Live `index.html` loads `assets/index-lYW-7utq.js`, which contains `receivings.linkPurchase`, `packing.confirm`, and `productionOrders.complete`. |
| Automated tests | Full backend suite on this SHA: **103 pass, 0 fail** (8 Nov 2026, 10:00 PM MYT). Includes purchase, receiving, and 7 manufacturing tests. Pages CI build step on this SHA succeeded. No application code changed in this closeout. |

The checks in the sections above this reconciliation were API read-backs. They are not, by themselves, a direct workbook inspection. The dated section **FINAL OWNER UAT RECONCILIATION — 2026-11-08** is the direct Google Sheets read, including AuditLogs. That section is the status source for Steps 9, 10, and 11.

Actor: `u-aina` (owner). Cashier denials: `u-siti`. Supplier: `sup_38eymadw0`. All new products, notes, and invoice numbers are prefixed `CLOSEOUT-20261108`. Run window: 8 Nov 2026, 9:49 PM–10:02 PM MYT. Result: **63/63 live checks passed** (60 scenario checks plus 3 follow-ups).

Historical rows were read before and after the run and were identical. They were not edited.

| Record | Status after closeout |
| --- | --- |
| PUR-000009 | `received`, `receivingId=rcv_n6aryogtn` |
| RCV-000001 | `completed`, no purchase, date `2026-09-10T04:00:00.000Z` |
| RCV-000002 | `completed`, `purchaseId=pur_iu7dhvrfb`, date `2026-11-06T13:38:31.893Z` |

## Step 9 — Purchases and returns — API run record

Status after the 9 Nov 2026 owner approval is **PASS / LOCKED**. See **OFFICIAL LOCK — 2026-11-09**.

Implementation is on v19 (purchases module merged before this SHA). This closeout did not change purchase code.

| Check | Result | Evidence |
| --- | --- | --- |
| Save draft, no stock | PASS | `PUR-000010` (`pur_co08_draft`), status `draft`, co08a and co08b qty 0, no movement on that purchase number |
| Receive and one movement per line | PASS | Same document `received`; co08a 2, co08b 3; two `purchase` movements |
| Retry / second key | PASS | Same idempotency key replayed, qty stayed 2. A different key returned `CONFLICT` |
| Create and receive together | PASS | `PUR-000011`, one `purchase` movement, co08a qty 1 |
| Payment | PASS | `PAY-000002`, status `paid`, balance 0. This is the API the payment screen calls. The Finance → Payables page was not clicked |
| Partial return, product isolation | PASS | `PR-000006` returned 1 of co08a only. co08a qty 1, co08b qty 3. Line `returnedQty` 1 and 0 |
| Return cannot exceed received | PASS | Qty 5 on co08a rejected: `Return qty too high`. The next return of the remaining 1 of co08a and 3 of co08b succeeded, so the rejection did not consume stock |
| Full remaining return | PASS | co08a 0, co08b 0 |
| Cashier cannot create | PASS | `u-siti` → `FORBIDDEN` "You cannot create purchases." |
| Prior isolation UAT | Reused | Owner Sheet + UI for `S9-ISOLATION-20261105-1036` (`PUR-000007` / `PUR-000008` / `PR-000005`) stays as previously recorded. Not repeated |

This block is the API run. The workbook read later in this file is the status source. The module is not LOCKED.

## Step 10 — Receiving and to-order — API run record

Status after the 9 Nov 2026 owner approval is **PASS / LOCKED**. See **OFFICIAL LOCK — 2026-11-09**.

PR #99 (`9e81fcd`) and the server-date change are inside v19. Product-overlap and warehouse checks are the code that ran.

| ID | Result | Evidence |
| --- | --- | --- |
| R1 create | PASS | `RCV-000003` (`rcv_co08_r1`), status `completed`, one line, condition path accepted. Client date `2020-01-01` was ignored. Stored date `2026-11-08T13:52:49.470Z` (8 Nov 2026, 9:52 PM MYT). One `receiving` movement, stockIn 1, co08rcv qty 1. Same-key retry stayed at qty 1 |
| R2 link matching draft, including a larger purchase qty | PASS | Draft `PUR-000012` qty 5 linked to `RCV-000003` qty 1. Status stayed linked, co08rcv stayed 1. `purchases.receive` then set `PUR-000012` to `received` with **no** `purchase` movement |
| R2 retry and duplicate link | PASS | Same key replayed. A second draft (`pur_co08_link2`) was rejected: "Receiving already linked", and that draft stayed unlinked |
| R2 product mismatch | PASS | `rcv_co08_mismatch` (co08a) vs `pur_co08_mismatch` (co08b) → `PRODUCT_MISMATCH`. Receiving `purchaseId` stayed empty and qty stayed 2 (the earlier purchase receipt plus this receiving) |
| R2 warehouse mismatch | PASS | `pur_co08_shop` on `wh-shop` rejected: "Receiving and purchase must use the same warehouse." |
| R3 receive from to-order | PASS | Stock order `sord_7178f25c90` for co08ord, then `RCV-000005`. Order status `received`. One `receiving` movement, qty 2. Mark-ordered itself did not change qty |
| R4 mark ordered / cancel | PASS | co08use order marked then `cancelled`. Qty stayed 0. No receiving movement |
| R5 usage date and ledger | PASS | `USE-0002`, type `stock_usage`, date `2026-11-08T08:00:00.000+08:00`, qty 5→4. Same-key retry stayed at 4 |
| R6 cashier | PASS | `u-siti` `receivings.create` → `FORBIDDEN` "You cannot receive raw materials." No `rcv_co08_cashier` row |
| Regression Step 8 | PASS | `openingBalances.list` returned the existing document list (1 document) |
| Regression Step 9 | PASS | Purchase draft, receive, return, and payment above ran on this same deployment after receiving |

Prior UI evidence for R1 (`RCV-000001`, prototype date, still FAIL as sheet proof), R4, and R5 (`USE-0001`) is historical and was not reused as this closeout's proof. R2–R6 above are new documents on v19.

This block is the API run. Do not edit RCV-000001, RCV-000002, or PUR-000009.

## Step 11 — Production orders and packing — API run record

Status after the 9 Nov 2026 owner approval is **PASS / LOCKED**. See **OFFICIAL LOCK — 2026-11-09**.

PR #100 merged as `c7a88d3` and is the Apps Script v19 description. No defect was found against the packing or production-order workflow.

| Check | Result | Evidence |
| --- | --- | --- |
| BOM save | PASS | `bom_ef5c717ad8` (`CLOSEOUT-20261108 pack BOM`) |
| Packing draft posts nothing | PASS | `PA-0001` (`pak_co08`), status `draft`, finished-goods qty 0 |
| Confirm AUTO out, finished goods in | PASS | co08auto 10→8 (`production_out`), co08fg 0→2 (`production_in`) |
| MANUAL does not auto-out | PASS | co08man stayed 10. No movement for that product on `PA-0001` |
| Shortage | PASS | `pak_co08_short` confirm rejected: required 100, available 10 |
| Circular BOM | PASS | `co08cira` / `co08cirb` packing create rejected: circular dependency |
| Changed BOM / acceptSnapshot | PASS | Confirm without the flag rejected ("BOM has changed"). `acceptSnapshot: true` on `pak_co08_snap` consumed the **saved** qty 1 (co08snap 10→9), not the edited qty 4, and posted co08snapout +1 |
| Production order create | PASS | `PO-0001` (`po_co08`), status `planned` |
| Complete before start | PASS | Rejected: "Start production first" |
| Complete | PASS | Status `completed`, posted. co08raw 5→3. MANUAL co08man unchanged. co08pofg +2. One batch `CO08-PO` qty 2 for `po_co08` |
| Confirm and complete retry | PASS | Same keys left finished-goods qty and batch count unchanged |
| Cashier cannot confirm packing | PASS | `FORBIDDEN` "You cannot confirm packing / assembly." |
| Manufacturing permissions in automated tests | PASS | Cashier list/create/complete denied in `manufacturing.test.js`; staff/owner paths covered there |

This block is the API run. Daily sessions were not exercised.

## Cross-module reconciliation

On the isolated products, the same unit was not posted twice:

- Purchase receive and purchase return moved only their own product lines.
- Linking `RCV-000003` to `PUR-000012` did not add a second receipt when the purchase was marked received.
- To-order mark/cancel did not move stock. Receiving that order moved it once.
- Usage deducted once.
- Packing and production completion deducted AUTO components once and left MANUAL components unchanged.
- Opening-balance list still reads. Historical purchase and receiving headers above were unchanged.

Document header, lines, StockMovements, and InventoryBalances agreed on every live check that returned those collections. Batches agreed for `PO-0001` (exactly one row). AuditLogs were read in the reconciliation section, not by this API run.

## Defects

No implementation defect was found in this closeout. No fix commit. No new deploy.

Known limits, not defects:

- Error responses for a rejected return do not include an inventory snapshot. The following successful return showed the rejected quantity was still available.
- New receiving dates are stored as UTC ISO (`toISOString()`), which is the server clock. A date-only usage value is stored as `T08:00:00.000+08:00`.
- The historical `returnedQty=1` pair is explained in the reconciliation section. Classification: **VALID**. The rows were not modified and were not waived.

The owner-action list and module statuses below this paragraph are replaced by **FINAL OWNER UAT RECONCILIATION — 2026-11-08** and **OFFICIAL LOCK — 2026-11-09**.

## Roadmap

| Module | Status after direct workbook read |
| --- | --- |
| 0–8 | PASS (previously verified; opening-balance header `OB-0001` still present and confirmed) |
| 9 Purchases and returns | **PASS / LOCKED** — owner accepted the 2026-11-08 workbook reconciliation on 9 Nov 2026 |
| 10 Receiving and to-order | **PASS / LOCKED** — owner accepted the 2026-11-08 workbook reconciliation on 9 Nov 2026 |
| 11 Production orders and packing | **PASS / LOCKED** — owner accepted the 2026-11-08 workbook reconciliation on 9 Nov 2026 |
| 12 Daily sessions | **OWNER UAT REQUIRED** — past-date accept/start restriction kept; `PROD-20261109-001` unchanged |
| 13 Sales documents | **IN PROGRESS** — backend + tests implemented; owner UAT not started |
| 14 Sales returns | NOT STARTED |
| 15 Sales import | NOT STARTED |
| 16 Dispatch | NOT STARTED |
| 17 Halal, tasks, expenses | NOT STARTED |
| 18 Reads | NOT STARTED |

PRs: Step 10 linkage [#99](https://github.com/zall266/CSP_Inventory-Sales-System/pull/99) merged `9e81fcd`. Step 11 [#100](https://github.com/zall266/CSP_Inventory-Sales-System/pull/100) merged `c7a88d3`. This closeout report is a docs-only follow-up; it does not deploy.

## FINAL OWNER UAT RECONCILIATION — 2026-11-08

Read-only audit. No workbook cell, Apps Script deployment, GitHub Pages deployment, or application file was changed. Nothing in this section was a waiver, a lock, or a data repair at the time it was written. The owner lock is recorded in **OFFICIAL LOCK — 2026-11-09**.

Workbook export: `https://docs.google.com/spreadsheets/d/1TPmkASdzlGssGyAisklf4QkLcxWYbHHhUSxntgLha94/export?format=xlsx`, HTTP 200, 513,527 bytes, file time 8 Nov 2026, 10:54 PM MYT. All figures below are from that file. The Apps Script API was not called during this audit.

### A. Access and evidence matrix

| Source | What it covered | Classification |
| --- | --- | --- |
| Workbook xlsx export of the DEV spreadsheet | AuditLogs (145), Purchases (15), PurchaseLines (16), PurchaseReturns (7), PurchaseReturnLines (8), Payments (2), Receivings (5), ReceivingLines (5), StockOrders (2), StockMovements (53), InventoryBalances (234), PackingAssemblies (3), PackingSnapshotItems (5), ProductionOrders (1), ProductionConsumptions (2), ProductionWastage (0), Batches (1), Boms, BomItems, Products, Idempotency (82 completed), OpeningBalances (1) | **DIRECT GOOGLE SHEETS READ** |
| PR #101 live run on 8 Nov 2026, 9:49–10:02 PM MYT | The `FORBIDDEN` / `CONFLICT` / `PRODUCT_MISMATCH` response text, and the idempotent-replay flag. Those responses are not rows. The sheet shows the matching absence of a success row | **EXISTING API / REPOSITORY READ-BACK** (prior run; not repeated) |
| `docs/uat/` and the earlier part of this report | How the closeout documents were created | **GITHUB DOCUMENTATION** |
| Google Sheets UI in a browser, and any audit list API | Not used. The export is the workbook. There is still no `audit.list` action, and none was added | **NOT ACCESSIBLE** as a UI session. Not required once the tab export was read |

Every closeout product ledger was rolled forward from StockMovements and compared with the `balance` column and with InventoryBalances. All matched. No movement id is duplicated.

Preserved and unchanged from the prior fingerprint: `PUR-000009` received, `receivingId=rcv_n6aryogtn`, line `p-cp` qty 1 `returnedQty` 0; `RCV-000001` completed, no purchase, date `2026-09-10T04:00:00.000Z`; `RCV-000002` completed, `purchaseId=pur_iu7dhvrfb`, date `2026-11-06T13:38:31.893Z`.

### B. Step 9 reconciliation

`returnedQty` is a column on each PurchaseLines row. It is not a value shared across purchases.

#### PUR-000010 (`pur_co08_draft`) — PASS

| Field | Workbook |
| --- | --- |
| Header | Invoice `CLOSEOUT-20261108-DRAFT`, `wh-main`, supplier `sup_38eymadw0`, total 5, paid 0, balance 5, status `received`, no `receivingId`. Date `2026-11-08T13:51:12.084Z` |
| Lines | `co08a` qty 2 price 1 `returnedQty` 2. `co08b` qty 3 price 1 `returnedQty` 3 |
| Stock | One `purchase` movement each: `co08a` stockIn 2 (balance 2), `co08b` stockIn 3 (balance 3), both `2026-11-08T13:51:20.205Z`, user Aina Rahman. No second movement on this purchase number |
| Audit | One `purchases.create` (`movementCount` 0, `receive` false) and one `purchases.receive` (`movementCount` 2). User `u-aina` |
| Idempotency | `CLOSEOUT-20261108-draft` and `CLOSEOUT-20261108-recv` each stored once, status `completed`. The conflict key `CLOSEOUT-20261108-recv-other` is absent |

Draft-with-no-stock is the create audit (`movementCount` 0) plus the later single receive. The sheet does not keep a second copy of the draft.

#### PR-000006 (`pret_b571d1570f`) — PASS

Linked to `PUR-000010` / `wh-main`. One line: `co08a` qty 1 price 1. Total 1. Reason `CLOSEOUT-20261108 partial return A only`. One `purchase_return` movement, stockOut 1, balance 2→1. No `co08b` movement on this return. One audit `purchaseReturns.create`.

#### PR-000007 (`pret_eac85f6812`) — PASS

Same purchase. Lines: `co08a` qty 1 and `co08b` qty 3. Total 4. Two movements at `2026-11-08T13:52:03.033Z`: `co08a` stockOut 1 (balance 0) and `co08b` stockOut 3 (balance 0). Line `returnedQty` now equals the sum of the return lines (2 and 3). One audit. No third return document exists, so the rejected over-return did not persist a row. The over-return key `CLOSEOUT-20261108-ret-over` is absent.

#### PUR-000011 (`pur_co08_pay`) and PAY-000002 — PASS

Header: invoice `CLOSEOUT-20261108-PAY`, total 4, paid 4, balance 0, status `paid`, no `receivingId`. Line: `co08a` qty 1 price 4 `returnedQty` 0. One `purchase` movement stockIn 1, balance 0→1, at the create timestamp. Create audit says `movementCount` 1 and `receive` true. Payment `pay_881e43705f`: party supplier `sup_38eymadw0`, `invoiceId=pur_co08_pay`, `invoiceNo=PUR-000011`, method `bank_transfer`, amount 4, status `completed`, date `2026-11-08T13:52:30.820Z`. One payment row. One `purchases.recordPayment` audit, after `{"balance":0,"status":"paid"}`.

#### co08a / co08b balances — PASS

`co08a` movements: +2 purchase, −1 return, −1 return, +1 purchase, +1 receiving `RCV-000004`. Running total 2. InventoryBalances `wh-main` 2; shop and outlet 0. `co08b`: +3 then −3. Balance 0 on every warehouse. `wh-shop` draft `PUR-000015` did not move stock.

#### Historical PUR-000001, PUR-000002, PAY-000001, PR-000002 — VALID

| Record | Workbook fact |
| --- | --- |
| PUR-000001 `pur_hxqhep4qs` | Invoice `UAT-S9-T1`, `wh-main`, `p-cp` qty 1 price 22, `returnedQty` 1, total 22, paid 0, balance 22, status `received`. Create audit `movementCount` 0. Receive audit `movementCount` 1. One `purchase` movement stockIn 1, balance 0→1, `2026-10-25T16:33:17.972Z` |
| PR-000002 `pret_e5f0262113` | `purchaseId=pur_hxqhep4qs` (PUR-000001), not PUR-000002. Line `p-cp` qty 1 price 22. Total 22. Reason `UAT Step9 Test 4 return`. One `purchase_return` stockOut 1, balance 1→0, `2026-10-25T16:46:18.417Z`. One audit, after `{"purchaseId":"pur_hxqhep4qs","total":22}` |
| PUR-000002 `pur_q1tahfsxv` | Invoice `UAT-S9-T2`, its own line `p-cp` qty 1 price 22, `returnedQty` 1, total 22, paid 22, balance 0, status `paid`. Create audit `movementCount` 1, `receive` true. One `purchase` movement stockIn 1, balance 1→2 |
| PR-000001 `pret_0d95f04a13` | `purchaseId=pur_q1tahfsxv` (PUR-000002). Line `p-cp` qty 1 price 22. One `purchase_return` stockOut 1, balance 2→1, `2026-10-25T16:44:08.244Z`. One audit |
| PAY-000001 `pay_28409f5c94` | `invoiceId=pur_q1tahfsxv`, `invoiceNo=PUR-000002`, method `cash`, amount 22, status `completed`, date `2026-10-25T16:42:37.112Z`. One payment. Audit after `{"balance":0,"status":"paid"}`. PUR-000001 has no payment row |

The two `returnedQty=1` values sit on two different purchase lines. Each equals that line’s qty of 1, each has its own return document, and each has its own stock-out of 1. This is two valid independent returns of the same product. It is not one return applied to two purchases, not a shared `returnedQty`, and not a second deduction of the same line. Return numbers are the reverse of the purchase numbers because PR-000001 was written against PUR-000002 first. The `purchaseId` on each return is the link, and it matches the movement.

`p-cp` at `wh-main` has 14 movements. The running total is 38 and InventoryBalances is 38. Later documents (PUR-000003 through PUR-000008, PR-000003 through PR-000005, USE-0001) explain why the balance is 38 rather than 0. Those later rows were not edited. PUR-000001 stays `received` with balance 22 after its stock return; this module’s return does not reduce the purchase balance. PAY-000001 matches PUR-000002’s total and does not appear twice.

Recommendation: **VALID — no corrective action required.** No waiver is requested or granted.

### C. Step 10 reconciliation

#### R1 — RCV-000003 (`rcv_co08_r1`) — PASS

Header: `wh-main`, source `other`, supplier `sup_38eymadw0`, status `completed`, received by `u-aina` / Aina Rahman. Date `2026-11-08T13:52:49.470Z` (8 Nov 2026, 9:52 PM MYT). The cell is not `2020-01-01`. Line: `co08rcv` qty 1, unit PCS, baseQty 1, batch `CO08-R1`, condition `Baik`. One `receiving` movement stockIn 1, balance 1, id `mv_rcv_co08_r1.1`. InventoryBalances `co08rcv` `wh-main` = 1. One `receivings.create` audit. Idempotency key `CLOSEOUT-20261108-r1` stored once.

#### R2 — link to PUR-000012 — PASS

`RCV-000003.purchaseId=pur_co08_link` and `purchaseNo=PUR-000012`. `PUR-000012.receivingId=rcv_co08_r1`. Purchase line is `co08rcv` qty 5; receiving line is qty 1. Status `received`, total 5, paid 0, balance 5. Receive audit after is `{"status":"received","movementCount":0}`. StockMovements has no row with reference `PUR-000012`. The only `co08rcv` movement is `RCV-000003`.

Rejected siblings, still unlinked, no extra stock:

| Document | Sheet state |
| --- | --- |
| PUR-000013 `pur_co08_link2` | Draft, `co08rcv` qty 1, empty `receivingId`. Duplicate-link key absent. `RCV-000003` still points only at PUR-000012 |
| PUR-000014 `pur_co08_mismatch` | Draft, `co08b` qty 1, empty `receivingId` |
| RCV-000004 `rcv_co08_mismatch` | Completed, `co08a` qty 1, empty `purchaseId`. Its own one receiving movement is the stock from that receiving, not from a link |
| PUR-000015 `pur_co08_shop` | Draft on `wh-shop`, `co08a` qty 1, empty `receivingId`. `co08a` qty on `wh-shop` is 0 |

One `receivings.linkPurchase` audit. Keys `CLOSEOUT-20261108-r2-dup`, `CLOSEOUT-20261108-mismatch-link`, and `CLOSEOUT-20261108-wh-link` are absent. The mismatch and warehouse error text remains the prior API result.

#### R3 — sord_7178f25c90 and RCV-000005 — PASS

Stock order: product `co08ord`, `wh-main`, status `received`, channel Shopee, remark `CLOSEOUT-20261108 R3`, orderedQty 2, receivedQty 2, `receivingId=rcv_co08_r3`, `receivingNo=RCV-000005`, marked and received by Aina Rahman. Receiving date `2026-11-08T13:55:14.029Z`, source `shopee`, status `completed`, `stockOrderId=sord_7178f25c90`. Line qty 2 baseQty 2. One `receiving` movement stockIn 2, balance 2. InventoryBalances 2. Audits: one `inventory.markOrdered`, one `receivings.create`. Mark-ordered did not add a movement; the receiving did.

#### R4 — sord_2fb699536e — PASS

Product `co08use`, `wh-main`, status `cancelled`, channel Other, remark `CLOSEOUT-20261108 R4`, orderedQty 1, cancel reason `CLOSEOUT-20261108 R4 cancel`, empty `receivingId`. Audits: one `inventory.markOrdered` (before `low_stock`, after `ordered`) and one `inventory.cancelOrder` (before `ordered`, after `cancelled`). No stock movement references this order. `co08use` movements are only `ADJ-0009` (+5) and `USE-0002` (−1).

#### R5 — USE-0002 — PASS

Movement id `mv_866f9a7e0fb449e9`, type `stock_usage`, product `co08use`, `wh-main`, stockOut 1, balance 5→4, date `2026-11-08T08:00:00.000+08:00`, user Aina Rahman, notes `CLOSEOUT-20261108 R5 usage — isolated`. InventoryBalances 4. One `inventory.usage` audit, user `u-aina`, after `4.0`. Idempotency key stored once.

#### R6 — cashier — PASS on workbook absence

AuditLogs has no row with `userId=u-siti` (145 rows inspected). No receiving id `rcv_co08_cashier`. No purchase was created by the cashier. The `FORBIDDEN` text "You cannot receive raw materials." is the prior API result and was not re-issued. Key `CLOSEOUT-20261108-r6` is absent.

### D. Step 11 reconciliation

#### PA-0001 (`pak_co08`) — PASS

Status `confirmed`, `posted=1`, product `co08fg`, BOM `bom_ef5c717ad8`, `wh-main`, planned 2, actual 2, unit PCS. Confirmed by Aina Rahman at `2026-11-08T13:57:27.526Z`. Snapshot items: `co08auto` qty 1 AUTO, `co08man` qty 1 MANUAL. Posted `consumptionsJson` records AUTO actualQty 2 and MANUAL actualQty 0. Movements, both at the confirm time: `production_out` `co08auto` stockOut 2 (balance 10→8) and `production_in` `co08fg` stockIn 2 (balance 2). No `co08man` movement on this document. `co08man` balance remains 10, from `ADJ-0011` only. One `packing.confirm` audit, after `{"posted":true,"movements":2,"idempotencyKey":"CLOSEOUT-20261108-pak-ok"}`. One idempotency row.

#### Shortage, circular BOM, cashier confirm — PASS on persisted rejection

`PA-0002` (`pak_co08_short`) is still `draft`, `posted=0`, planned/actual 100. No StockMovements reference `PA-0002`. No `packing.confirm` audit for it. Key `CLOSEOUT-20261108-pak-short-ok` is absent. The insufficient-stock sentence is the prior API result.

BOMs `CLOSEOUT-20261108 circ A` (`co08cira` consumes `co08cirb`) and `circ B` (`co08cirb` consumes `co08cira`) exist. PackingAssemblies has no row for either product. Both balances are 0. Key `CLOSEOUT-20261108-circ-pak` is absent. No packing audit for a circular document. The circular-dependency sentence is the prior API result.

No `u-siti` packing audit. Key `CLOSEOUT-20261108-pak-cashier` is absent.

#### PA-0003 acceptSnapshot — PASS

Current BomItems for `bom_ea9ba46b5d` is `co08snap` qty **4** (name `CLOSEOUT-20261108 snap BOM v2`), after one `boms.update` audit. The packing snapshot item and `consumptionsJson` are qty **1**. Movement `PA-0003` is `production_out` stockOut **1** (balance 10→9) and `production_in` `co08snapout` stockIn 1. InventoryBalances: `co08snap` 9, `co08snapout` 1. One `packing.confirm` audit. Key `CLOSEOUT-20261108-snap-block` is absent, so the rejected confirm did not store a success key. The "BOM has changed" sentence is the prior API result.

#### PO-0001 (`po_co08`) and batch CO08-PO — PASS

One production order. Status `completed`, `posted=1`, `consumptionConfirmed=1`, product `co08pofg`, BOM `bom_d823293078`, `wh-main`, planned 2, actual 2, batch `CO08-PO`, operator Closeout. `actualStart` `2026-11-08T13:58:34.641Z`, `actualEnd` `2026-11-08T13:58:46.780Z`. Consumption lines: `co08raw` AUTO expected 2 actual 2; `co08man` MANUAL expected 2 actual 2. The MANUAL actualQty is the recipe quantity stored on the order. It did not post stock: `co08man` has no `production_out`, and its balance is still 10. Movements: `PO-0001` `production_out` `co08raw` stockOut 2 (balance 5→3) and `production_in` `co08pofg` stockIn 2 (balance 2). ProductionWastage is empty, which matches actual qty equal to planned qty. Batches has exactly one row: `bch_1d344beb14`, product `co08pofg`, `wh-main`, batch `CO08-PO`, qty 2, `productionOrderId=po_co08`, production date equal to `actualEnd`. Audits, one each: `productionOrders.create`, `productionOrders.start`, `productionOrders.complete` (after `{"posted":true,"actualQty":2,"idempotencyKey":"CLOSEOUT-20261108-po-done"}`). Complete key stored once. Key `CLOSEOUT-20261108-po-soon` is absent.

Date observation, not a quantity miss: `plannedStart` and `plannedEnd` are stored as `Sun Nov 08 2026 00:00:00 GMT+0800 (Singapore Standard Time)`, not as `2026-11-08`. The calendar day is 8 Nov 2026. Actual start and end are ISO timestamps.

### E. AuditLogs

Direct read of all 145 AuditLogs rows. Each successful closeout action listed above occurs once, with `userId=u-aina` except the historical Step 9 rows, which are `u-admin`. Entity ids and references match the document numbers in sections B–D. No second success row exists for receive, link, usage, packing confirm, or production complete. `u-siti` has zero rows. Rejected calls did not leave a success audit; they also did not leave a failure row. Absence is the evidence. No audit row was added by this audit.

### F. Historical discrepancy decision

The dual `returnedQty=1` observation is **VALID**. PUR-000001 and PUR-000002 each received 1 of `p-cp` and each returned 1, through PR-000002 and PR-000001 respectively. Stock movements and the `p-cp` balance of 38 agree. Classification: **VALID — no corrective action required.** This is not a waiver. The owner is not asked to forgive a defect. The rows stay as they are.

### G. Owner action checklist (closed 9 Nov 2026)

The owner accepted this reconciliation. Remaining instruction: leave `RCV-000001`, `RCV-000002`, `PUR-000009`, `PUR-000001`, `PUR-000002`, `PAY-000001`, `PR-000001`, and `PR-000002` unchanged.

### H. Final module status (superseded 9 Nov 2026)

See **OFFICIAL LOCK — 2026-11-09** below. At the time of this reconciliation the three modules were PASS and not yet locked.

## OFFICIAL LOCK — 2026-11-09

The owner reviewed and **ACCEPTED** **FINAL OWNER UAT RECONCILIATION — 2026-11-08**, including the direct DEV workbook export (8 Nov 2026, 10:54 PM MYT) and all 145 AuditLogs rows.

| Module | Official status |
| --- | --- |
| 9 Purchases and returns | **PASS / LOCKED** |
| 10 Receiving and to-order | **PASS / LOCKED** |
| 11 Production orders and packing | **PASS / LOCKED** |

Recorded decisions:

- Historical `PUR-000001`, `PUR-000002`, `PAY-000001`, `PR-000001`, and `PR-000002` are **VALID**. Two `returnedQty=1` values are two independent returns, each on its own purchase line, each with its own return document and stock-out.
- No waiver or data correction is required.
- Historical records remain unchanged. `RCV-000001`, `RCV-000002`, and `PUR-000009` remain unchanged.
- Existing closeout evidence (`CLOSEOUT-20261108`) is accepted.
- The planned production date format on `PO-0001` (`Sun Nov 08 2026 00:00:00 GMT+0800 (Singapore Standard Time)`) is non-blocking and does not reopen Step 11.
- Rejected API requests remain supported by the prior API test evidence and by the absence of a success workbook row. No fabricated rejection rows were added.

Locked-module protection: do not redesign or refactor Steps 9, 10, or 11. A later change requires a proven production defect, a security issue, a data integrity issue, or a documented dependency of a later module, plus explicit owner authorization and regression tests.

Step 12 Daily Sessions is authorized to begin. This lock section is documentation only. It does not deploy and does not change workbook data.

## Step 12 — Daily Sessions — OWNER UAT REQUIRED

Backend implementation matches the existing Daily Sessions frontend. Locked Steps 9–11 were not redesigned. Owner UAT started on 9 Nov 2026 and paused after two date defects. Those defects are fixed below. Do not accept, start, pick, distribute, or complete `PROD-20261109-001`. The owner resumes UAT manually.

| Item | Status |
| --- | --- |
| Workflow | planned → accepted → in_progress → completed+posted. Recipe photo required at start. |
| Display + carton | Must equal actual produced. Rejected when they do not. |
| Complete once | `sessions.complete` is idempotent. A second key after posting returns `CONFLICT`. |
| Stock | Posted only on complete (and completed-session edits). AUTO components out from material-closing actual used. MANUAL components skip auto-out. Finished goods in. Display qty updates DisplayStocks. |
| Carry-forward | Remaining target continues once onto today's operational session, or a new planned session. |
| Frontend | Existing pages unchanged except date display/filter for Daily Sessions. `db.ts` queues `sessions.*` when the identity API is connected. Hydration reads `productionSessions` from `packing.list` / `sessions.list`. |
| Automated tests | Manufacturing file 10/10. Session date file 6/6. Calendar date file 10/10. Full backend suite **112/112**. `tsc`, lint, and Vite production build passed. |
| Owner UAT | **OWNER UAT REQUIRED**. Create of `PROD-20261109-001` is done. Remaining accept/start/picking/complete steps are stopped until the owner resumes. |

Actions: `sessions.list`, `sessions.get`, `sessions.create`, `sessions.accept`, `sessions.start`, `sessions.cancelPlanned`, `sessions.update`, `sessions.amend`, `sessions.changeTarget`, `sessions.togglePicking`, `sessions.addMaterial`, `sessions.saveResult`, `sessions.saveDistribution`, `sessions.saveMaterialClosing`, `sessions.complete`, `sessions.continueCarryForward`, `sessions.editCompleted`, `sessions.editCompletedClosing`.

Owner UAT still required: accept/start with recipe photo, picking, the three complete-production steps, display+carton=actual, complete once, AUTO out / MANUAL skip, cashier denial, and carry-forward. Do not treat automated tests as owner UAT.

## Step 12 date defects — 9 Nov 2026

Owner UAT of Daily Sessions found two display/filter defects. The existing session was not deleted, recreated, accepted, started, or completed. No stock movement was posted for this fix.

### Pre-fix workbook read (direct xlsx export, read-only)

DEV spreadsheet `1TPmkASdzlGssGyAisklf4QkLcxWYbHHhUSxntgLha94` export at 9 Nov 2026, 8:45 PM MYT.

| Field | Stored value |
| --- | --- |
| id | `ps_p2lblrm1i` |
| reference | `PROD-20261109-001` |
| productionDate | Excel serial `46335.0` = calendar day **2026-11-09** |
| status | `planned` |
| notes | `STEP12-UAT-20261109` |
| posted | `0` |
| createdAt | `2026-11-09T04:49:25.923Z` |
| createdBy | Aina Rahman |
| items | `p-pack-mt` target 45, `p-pack-cl` target 45 |

### Defect A — Production Planning "Invalid Date"

**Observed:** list showed `PROD-20261109-001`, 2 products, 90 planned packs, Date **Invalid Date**.

**Root cause:** Sheets stores `productionDate` as a Date (xlsx serial `46335`). Apps Script `text(row.productionDate)` stringifies that as `Mon Nov 09 2026 00:00:00 GMT+0800 (...)`. The frontend then did `formatDate(session.productionDate + 'T00:00:00+08:00')`. Concatenating onto a GMT string or a serial produces a JavaScript Invalid Date. Same class of storage as the locked Step 11 `PO-0001` plannedStart observation. This is not a missing row and not a wrong calendar day in the sheet.

**Fix:** canonicalize operational production dates to `YYYY-MM-DD` on read (`sessionDateKey` / `canonicalCalendarDate`) without rewriting the sheet cell. Display with `formatCalendarDate`, which understands date-only, ISO+offset, historical GMT strings, Excel serials, missing, and invalid values. Date-only values are not parsed as UTC midnight. Missing/invalid dates render as `Date missing` / `Invalid date` and never become today.

### Defect B — Today's Production frozen prototype date

**Observed:** Today's Production showed **No daily session for 10 Sept 2026** while the owner UAT date was 9 Nov 2026 and `PROD-20261109-001` existed for `2026-11-09`.

**Root cause:** `systemProductionDate()` called `systemDateKey()` with no argument. `systemDateKey` still defaults to `PROTOTYPE_TODAY` (`2026-09-10T12:00:00+08:00`) for Header, dashboard windows, finance due-today, and seed. Today's Production therefore queried `2026-09-10` instead of the live Malaysia calendar date.

**Fix:** Daily Sessions only. `systemProductionDate()` now uses `liveSystemDateKey()` → `systemDateKey(new Date())` in `Asia/Kuala_Lumpur`. `PROTOTYPE_TODAY` remains the default for `systemDateKey()` and for Header/Finance/seed. The Production Planning create form defaults to the live Malaysia date. Session equality uses canonical dates so GMT/serial stored values still match `2026-11-09`.

### Files changed

- `src/utils/calendarDate.ts` (new shared parser/formatter)
- `src/utils/format.ts` (re-exports; `systemDateKey` default unchanged)
- `src/features/manufacturing/sessionPlan.ts`
- Daily Session pages: Planning, Today's Production, History, Complete, Picking, Carry-forward, plan amendment
- `src/store/db.ts`, `src/store/manufacturingSync.ts` (hydrate canonical dates)
- `apps-script/utils/sessionMath.js`, `apps-script/repositories/manufacturingRepository.js` (canonicalize on read)
- Tests: `src/utils/calendarDate.test.ts`, `apps-script/tests/sessionDate.test.js`
- `.github/workflows/deploy-dev.yml` (this fix branch)

### Tests

| Suite | Result |
| --- | --- |
| `src/utils/calendarDate.test.ts` | 10/10 |
| `apps-script/tests/sessionDate.test.js` | 6/6 |
| Full backend `npm run test:backend` | **112/112** (includes existing create/list/accept/start/picking/distribution/complete session tests; no live production writes) |
| `tsc --noEmit` | pass |
| Vite production build | pass (`index-ChemMI5e.js` local artifact) |

### Deploy and preservation

| Item | Evidence |
| --- | --- |
| PR | [#103](https://github.com/zall266/CSP_Inventory-Sales-System/pull/103) merged into `cursor/dev-frontend-github-pages-d9ac` at 9 Nov 2026, 8:57 PM MYT |
| Merge commit | `8623131906052d427e321b0c41e6088dfb172771` |
| Apps Script | **v21**, `versionDescription=git:8623131906052d427e321b0c41e6088dfb172771`. Same project `1mkRzptY0mzHnzOFB8TA6AGIZyv6q2gJq-QdKPBWtV91oq5okHWVpY4Jj`. Same `/exec` id `AKfycbyMDLwOJ2iqD_nuLFcVMQYrS81WDkkaBhutTGBCrbUClM1Aap1MJiO6CnzzcYuTAoMbDw`. Deploy DEV [42620918774](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/42620918774) |
| GitHub Pages | [42621261016](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/42621261016). Live `index.html` loads `assets/index-Txu30SAh.js` |
| Live bundle | Contains `Date missing` / `Invalid date` parser, `No daily session for ${…}` using that formatter, and `sessions.create`. Does **not** concatenate `productionDate+"T00:00:00+08:00"`. `PROTOTYPE_TODAY` remains for Header/finance/seed only. |
| `/exec` health | 9 Nov 2026, 8:57 PM MYT: DEV, healthy, spreadsheet and Drive accessible, foundation ready, timezone `Asia/Kuala_Lumpur` |

Post-deploy **direct workbook read** (xlsx export, read-only, 9 Nov 2026, 8:57 PM MYT). This is not API read-back.

| Field | Before | After |
| --- | --- | --- |
| Session rows | 1 | 1 |
| id | `ps_p2lblrm1i` | `ps_p2lblrm1i` |
| reference | `PROD-20261109-001` | `PROD-20261109-001` |
| productionDate | serial `46335.0` (9 Nov 2026) | serial `46335.0` (9 Nov 2026) — cell not rewritten |
| status | `planned` | `planned` |
| notes | `STEP12-UAT-20261109` | `STEP12-UAT-20261109` |
| posted | `0` | `0` |
| createdAt | `2026-11-09T04:49:25.923Z` | `2026-11-09T04:49:25.923Z` |
| accepted / started / completed | empty | empty |
| Matcha `p-pack-mt` | target 45, actual 0 | target 45, actual 0 |
| Chocolate Lava `p-pack-cl` | target 45, actual 0 | target 45, actual 0 |

No duplicate session. No `PROD-20261109-001` stock movement. Accept/start/complete were not called.

### Remaining

Step 12 stays **OWNER UAT REQUIRED**. Do not accept or start `PROD-20261109-001` in this task. The owner resumes UAT on https://zall266.github.io/CSP_Inventory-Sales-System/

Owner checks:

1. Production Planning: `PROD-20261109-001` date **09 Nov 2026**, 2 products, 90 packs, status Planned.
2. Today's Production: current Malaysia date **09 Nov 2026**, session present. Not 10 Sept 2026.
3. Do **not** click Accept, Start, Picking, Distribution, or Complete until the owner is ready.

