# Owner UAT automation report V1 — Steps 12–18

**Status of Steps 12–18: OWNER UAT REQUIRED.**  
Automated evidence is not owner acceptance. This run did **not** execute controlled writes, did **not** deploy Apps Script, did **not** change `PROTOTYPE_TODAY`, and did **not** accept, start, edit, cancel, duplicate, or complete `PROD-20261109-001`. Steps 9–11 remain **PASS / LOCKED**.

Executed: **15 Nov 2026, 2:21–2:43 PM MYT** (Asia/Kuala_Lumpur).  
Branch: `cursor/owner-uat-automation-d9ac` (from integration `cursor/dev-frontend-github-pages-d9ac` @ `a756a9b`).

---

## 1. Environment (live DEV, not mocks)

| Resource | Value |
| --- | --- |
| Public DEV frontend | https://zall266.github.io/CSP_Inventory-Sales-System/ |
| Live JS bundle | `assets/index-BIZo9uFM.js` (**pre-PR #113**) |
| `/exec` | `https://script.google.com/macros/s/AKfycbyMDLwOJ2iqD_nuLFcVMQYrS81WDkkaBhutTGBCrbUClM1Aap1MJiO6CnzzcYuTAoMbDw/exec` |
| Health | DEV, healthy, `Asia/Kuala_Lumpur`, spreadsheet + Drive accessible |
| Spreadsheet | `1TPmkASdzlGssGyAisklf4QkLcxWYbHHhUSxntgLha94` (anonymous CSV export **BLOCKED**) |
| Default Pages actor | `u-admin` (Admin). API negatives used `u-aina` (owner) and `u-siti` (cashier). |
| Header calendar | **10 Sept 2026** (`PROTOTYPE_TODAY` not changed) |
| Daily Sessions operational date | **15 Nov 2026** (live Malaysia). Today's Production: “No daily session for 15 Nov 2026.” |
| PR #113 | **OPEN**, not merged, not Pages-deployed |
| PR #114 | OPEN (prior verification package) |

Runners (read-only / negative only):

- `docs/uat/run-api-readonly.mjs`
- `docs/uat/run-browser-readonly.mjs`
- `docs/uat/run-browser-hydrate.mjs`
- `docs/uat/run-browser-supplier-pay.mjs`

Logs: `docs/uat/logs/api-readonly.json`, `browser-readonly.json`, `browser-hydrate.json`.  
Screenshots: `docs/uat/evidence/step-12/` … `step-18/`.

---

## 2. Baseline protection (forced values were **not** written)

Live `inventory.get` before and after every negative call:

| Check | Expected | Actual | Result |
| --- | --- | --- | --- |
| InventoryBalances rows | 234 | 234 | PASS |
| StockMovements rows | 53 | 53 | PASS |
| Duplicate movement IDs | 0 | 0 | PASS |
| Unexplained recon diffs (opening + in − out = closing, skip-inventory types excluded) | 0 | 0 | PASS |
| `PROD-20261109-001` | planned, unposted, `2026-11-09` | `ps_p2lblrm1i`, planned, posted=false | PASS |
| Cashier `dashboard.get` | FORBIDDEN | FORBIDDEN “You cannot view the dashboard.” | PASS |
| Sales rows | 0 | 0 | PASS |
| Sales returns | 0 | 0 | PASS |
| DocumentAuditLogs on sales snapshot | 0 | 0 | PASS |

Direct Google Sheets workbook download is **BLOCKED** (spreadsheet is not public). Reconciliation used the live Apps Script read of `InventoryBalances` / `StockMovements` (the same sheets). That is a genuine backend read, not a mock.

Leftover **sales import accounts** (not created in this run; 0 batches / 0 orders): `should-fail`, `cashier-should-fail`, `coolslurppypowder`. They are prior probe accounts. No import was confirmed.

---

## 3. What automation can and cannot accept

| Kind | This run |
| --- | --- |
| Public frontend loads, routes render, no crash | Automated |
| Live `/exec` reads and permission/validation negatives | Automated |
| Inventory identity after negatives | Automated |
| UI display of **live** records vs seed overlay | **Failed / blocked** on several screens because hydrate lost the Apps Script lock |
| Controlled writes (create session, POS, return, import, dispatch, expense) | **NOT RUN** — isolated plan only |
| Owner acceptance of Steps 12–18 | **Not claimed** |

A green API test is not a UI pass. A toast is not a backend pass. Owner review of this package is still required.

---

## 4. Critical UI finding — seed overlay + ScriptLock

Public Pages boots from prototype seed, then hydrates through many parallel `POST /exec` calls (`packing.list`, `sales.list`, `expenses.list`, …). Each backend dispatch uses `withScriptLock`.

Evidence `docs/uat/evidence/step-13/ui-13-10-supplier-payments.png` (2:43 PM MYT):

> “Could not save to the server” / “The request could not get a lock in time.” (many stacked toasts)

Consequences observed on the **same public bundle**:

- Production Planning kept seed sessions `PROD-20260908-001` (completed) and `PROD-20260910-001` (planned) after **28 seconds**. Live `PROD-20261109-001` never appeared in the list, history search, session detail, or global search.
- Create-session date control correctly showed **11/15/2026** (Malaysia today). Today's Production correctly said **no session for 15 Nov 2026**.
- Payments first paint showed seed `PAY-1001…`. After wait, customer tab emptied (live payments are **supplier** `PAY-000001` / `PAY-000002`). Supplier tab still showed seed `PAY-1023…` while lock toasts fired.
- Expenses first paint showed seed rent/payroll rows. After wait, the table matched API **0 expenses**. **Add expense** stayed visible for Admin **and** cashier.

Do **not** treat a Pages screenshot of prototype seed as proof of live Sheets data. Owner UAT of on-screen records must wait until lock toasts stop, or use the API evidence below.

This is **not** an Apps Script deploy in this task. Fixing lock contention would be a separate change.

---

## 5. Scoreboard

| Suite | Total | PASS | FAIL | BLOCKED | NOT RUN |
| --- | --- | --- | --- | --- | --- |
| Live API read + negative | 53 | 52 | 0 | 1 (anonymous Sheets export) | Controlled writes |
| Playwright page render / navigation | 55 recorded | 48 after correcting UI-12-12 | 5 UI live-record | 2 expenses permission UI | Writes |
| Hydrate wait follow-up | 3 | 0 | 2 | 1 | — |
| Controlled write UAT | — | — | — | — | **All** (await owner approval) |

Corrected UI-12-12: the search **input** contained `PROD-20261109-001`; the results overlay was **“No results”**. Logged as FAIL.

---

## 6. Test register

Execution method codes: **API** = live `/exec`; **UI** = Playwright against public Pages; **RECON** = inventory snapshot via `inventory.get`.

Status: **PASS** / **FAIL** / **BLOCKED** / **NOT RUN**.

### 6.1 Baseline

| Test ID | Module | Description | Method | Expected | Actual | Evidence | Recon | Status | Owner still |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| API-BASE-01 | baseline | inventory.get snapshot | API | 234 / 53 / 0 dup / 0 diffs | same | `logs/api-readonly.json` | opening+in−out=closing | PASS | Confirm workbook if desired |
| API-BASE-02 | baseline | GET /exec health | API | DEV healthy MYT | match | log | n/a | PASS | none |
| API-BASE-SHEETS | baseline | Anonymous Sheets export | HTTP | public CSV or blocked | HTTP 400 login HTML | log | use API read | BLOCKED | Owner-authenticated export optional |
| API-BASE-03 | baseline | inventory unchanged after negatives | API | same snapshot | 234 / 53 / 0 / 0 | log | PASS | PASS | none |
| API-BASE-04 | 12 | locked session unchanged | API | planned unposted | match, 1 session | log | n/a | PASS | Do not accept/start |
| API-BASE-05 | 13–15 | no new sales/returns/import orders | API | 0 / 0 / 0 | match | log | n/a | PASS | none |
| UI-LOAD-01 | baseline | Pages loads Preview mode | UI | badge visible | visible | `step-18/ui-load-01.png` | n/a | PASS | none |
| UI-LOAD-02 | baseline | Bundle is pre-#113 | UI | `index-BIZo9uFM.js` | match | same | n/a | PASS | Merge #113 then redeploy Pages before expenses UI UAT |
| UI-LOAD-03 | 18 | Header `PROTOTYPE_TODAY` | UI | 10 Sept 2026 | 10 Sept 2026 | same | n/a | PASS | Do not change globally |
| UI-SAFE-01 | baseline | Write buttons not clicked | UI | no Accept/Start/Complete/Confirm/Save | none clicked | log | API-BASE-03 | PASS | none |

### 6.2 Step 12 — Daily Sessions

| Test ID | Description | Method | Expected | Actual | Evidence | Recon | Status | Owner still |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| API-12-01 | sessions.list locked session | API | `PROD-20261109-001` planned unposted 2026-11-09 | `ps_p2lblrm1i` | log | n/a | PASS | Visual confirm after hydrate works |
| API-12-N1 | owner accept past session | API | VALIDATION Not today's production | match | log | no status change | PASS | Keep today-only rule |
| API-12-N2 | cashier accept | API | FORBIDDEN | “You cannot accept production.” | log | n/a | PASS | none |
| API-12-N3 | owner start past session | API | Not today's production | match | log | n/a | PASS | none |
| API-12-N4 | owner complete past (keyed) | API | error, no post | Not today's production | log | n/a | PASS | none |
| API-12-N5 | cashier sessions.create | API | FORBIDDEN | match | log | n/a | PASS | none |
| API-12-N6 | owner create qty 0 | API | VALIDATION Add products | match | log | no session | PASS | none |
| UI-12-01…06 | Planning / Today / Picking / Complete / Carry-forward / History render | UI | no crash | rendered | `step-12/ui-12-01.png` … `ui-12-06.png` | not live-record proof | PASS (render only) | Confirm live rows |
| UI-12-07 | Planning shows live locked session + 9 Nov 2026 | UI | `PROD-20261109-001` | seed `PROD-20260908-001` / `PROD-20260910-001`; create date 11/15/2026 | `ui-12-07-planning-date.png` | API has live session; UI does not | **FAIL** | Retry when lock is quiet |
| UI-12-08 | Today uses live MY date | UI | not frozen 10 Sept operational day | “No daily session for 15 Nov 2026.” | `ui-12-08-today-date.png` | n/a | PASS | none |
| UI-12-09 | Create form visible, not submitted | UI | form + Create session | visible, not clicked | `ui-12-01.png` | n/a | PASS | Do not create without write plan |
| UI-12-10 | History search live reference | UI | finds locked session | seed only | `ui-12-10-history-search.png` | FAIL vs API | **FAIL** | same |
| UI-12-11 | Detail `ps_p2lblrm1i` | UI | planned detail | “Not found.” | `ui-12-11-session-detail.png` | FAIL vs API | **FAIL** | same |
| UI-12-12 | Global search | UI | live session in results | “No results” | `ui-12-12-global-search.png` | FAIL vs API | **FAIL** | same |
| UI-12-13 | 28s hydrate wait | UI | live session replaces seed | seed unchanged | `ui-12-13-hydrate-wait.png` | FAIL | **FAIL** | same |
| UI-12-N1 | Cashier Today screenshot, no Accept | UI | render, no click | captured | `ui-12-cashier-today.png` | API-12-N2 | PASS (no-click) | none |

**Manual owner actions still required (Step 12):** visually confirm listing/date after a successful hydrate; walk create form without posting, or approve write plan W-12-01 for a **today** session only. Do not operate `PROD-20261109-001`. Keep Accept/Start **today-only**.

### 6.3 Step 13 — Sales documents

| Test ID | Description | Method | Expected | Actual | Evidence | Recon | Status | Owner still |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| API-13-01 | sales.list | API | 0 sales, 2 payments | 0 sales; `PAY-000001`/`PAY-000002` **supplier** | log | n/a | PASS | Open **Supplier payments** in UI |
| API-13-02 | quotations.list | API | ok | ok, 0 quotations | log | n/a | PASS | none |
| API-13-N1 | sales.create no key | API | Idempotency key required | match | log | no sale | PASS | none |
| API-13-N2A | cashier void, no key | API | key required (checked **before** permission) | match | log | n/a | PASS | Documented order |
| API-13-N2 | cashier void keyed | API | FORBIDDEN | “You cannot void sales.” | log | n/a | PASS | none |
| API-13-N2B | duplicate keyed cashier void | API | replay FORBIDDEN | match | log | no document | PASS | none |
| API-13-N4 | owner void missing sale | API | NOT_FOUND | “Sale not found” | log | n/a | PASS | none |
| API-13-N3 | cashier purchases.create | API | FORBIDDEN | match | log | n/a | PASS | none |
| UI-13-01…05 | Sales / POS / Quotations / DO / Payments render | UI | no crash | rendered | `step-13/ui-13-01.png` … `ui-13-05.png` | UI-13-05 is **seed** PAY-1001 | PASS (render) | Confirm live payments |
| UI-13-06 | Sales search | UI | stable | stable | `ui-13-06-sales-search.png` | API 0 sales | PASS | none |
| UI-13-07 | Customer payments show PAY-000001 | UI | live customer pay **or** empty if supplier-only | empty after wait | `ui-13-07-payments.png` | API payments are supplier | FAIL vs original expected; **live customer tab empty is consistent** | Check supplier tab |
| UI-13-08 | POS catalogue, no checkout | UI | catalogue | rendered | `ui-13-08-pos.png` | n/a | PASS | Do not charge |
| UI-13-09 | Wait for PAY-000001 on default tab | UI | live row | customer tab empty | `ui-13-09-hydrate-wait.png` | wrong tab | FAIL (test tab) | Supplier tab |
| UI-13-10 | Supplier payments + lock toasts | UI | live PAY-000001/2 | seed PAY-1023… + lock toasts | `ui-13-10-supplier-payments.png` | API has live supplier pays; UI seed | **FAIL** | Retry when quiet |

**Manual owner actions:** POS walkthrough without posting; quotations / DO / void permission on a real document only after write approval; confirm supplier payment rows when hydrate succeeds.

### 6.4 Step 14 — Sales returns (no posting)

| Test ID | Description | Method | Expected | Actual | Evidence | Recon | Status | Owner still |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| API-14-01 | salesReturns.list | API | ok | 0 returns, 10 sources | log | n/a | PASS | none |
| API-14-N1 | cashier save | API | FORBIDDEN | match | log | n/a | PASS | none |
| API-14-N2 | confirm no key | API | key required | match | log | n/a | PASS | none |
| API-14-N3 | owner save qty 0 | API | VALIDATION > 0 | “Returned quantity for Matcha must be greater than 0.” | log | no RT- | PASS | none |
| API-14-N4 | invalid product | API | error | “Choose a product for every line.” | log | no RT- | PASS | none |
| API-14-N5 | confirm missing keyed | API | NOT_FOUND | match | log | no movement | PASS | none |
| UI-14-01 | Returns list | UI | empty/live list | “No sales returns yet” | `ui-14-01.png` | API 0 | PASS | none |
| UI-14-02 | New return form, not posted | UI | form | rendered | `ui-14-02.png` | n/a | PASS | Do not confirm |
| UI-14-03 | Search | UI | stable | stable | `ui-14-03-search.png` | n/a | PASS | none |
| UI-14-N1 | Cashier returns | UI | list or deny | rendered | `ui-14-cashier-returns.png` | API-14-N1 | PASS (no save) | none |

### 6.5 Step 15 — Sales import (no ingest / confirm)

| Test ID | Description | Method | Expected | Actual | Evidence | Recon | Status | Owner still |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| API-15-01 | salesImport.list | API | ok; field is `salesImportAccounts` | 3 accounts, 0 batches, 0 orders | log | no posted sales | PASS | Review leftover probe accounts |
| API-15-N1 | confirm no key | API | key required | match | log | no sale | PASS | none |
| API-15-N2 | confirm missing keyed | API | NOT_FOUND | match | log | no sale | PASS | none |
| API-15-N3 | cashier confirm missing | API | FORBIDDEN **or** NOT_FOUND (cashier has `sales.create`) | NOT_FOUND | log | no sale | PASS | Permission is on create, not missing-id |
| UI-15-01…03 | Import + mappings screens | UI | render; no confirm | “No import batches”; account picker | `step-15/*.png` | API 0 batches | PASS (render) | Do not Add account / New Import Batch / confirm |

Duplicate **external order** reject cannot be proven without ingest. **NOT RUN** (would write a batch/file). Covered in isolated plan W-15-01.

### 6.6 Step 16 — Dispatch (no confirm / dispatch)

| Test ID | Description | Method | Expected | Actual | Evidence | Recon | Status | Owner still |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| API-16-01 | dispatch.list | API | ok | 0 dispatches, 0 vehicles | log | n/a | PASS | none |
| API-16-N1 | cashier vehicles.create | API | FORBIDDEN | match | log | n/a | PASS | none |
| API-16-N2 | cashier dispatch.create | API | FORBIDDEN | match | log | n/a | PASS | none |
| API-16-N3 | confirm no key | API | key required | match | log | n/a | PASS | none |
| API-16-N4 | confirm missing keyed | API | NOT_FOUND | match | log | no movement | PASS | none |
| API-16-N5 | cashier dispatch.void keyed | API | FORBIDDEN | match | log | n/a | PASS | none |
| UI-16-01 | Dispatch list | UI | empty drafts/confirmed/groups | empty; New Dispatch **not** clicked | `ui-16-01.png` | API 0 | PASS | Do not New Dispatch |
| UI-16-02 | Vehicles | UI | form/list | rendered | `ui-16-02.png` | API 0 | PASS | Do not Add vehicle |
| UI-16-N1 | Cashier dispatch | UI | deny or list without create | rendered | `ui-16-cashier-dispatch.png` | API-16-N2 | PASS | none |

### 6.7 Step 17 — Halal, tasks, expenses

| Test ID | Description | Method | Expected | Actual | Evidence | Recon | Status | Owner still |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| API-17-01 | expenses.list owner | API | 0 rows | 0 | log | n/a | PASS | none |
| API-17-N1 | cashier expenses.create | API | FORBIDDEN manage expenses | match | log | no row | PASS | none |
| API-17-N2 | owner amount 0 | API | VALIDATION | “Enter description and amount” | log | no row | PASS | none |
| API-17-02 | halal.list | API | ok | ok | log | n/a | PASS | none |
| API-17-03 | tasks.list | API | ok | 5 categories, 0 tasks | log | n/a | PASS | none |
| UI-17-01 | Halal page | UI | listing | rendered | `ui-17-01.png` | API ok | PASS (render) | none |
| UI-17-02 | My Tasks | UI | listing | rendered | `ui-17-02.png` | API ok | PASS (render) | none |
| UI-17-03 | Expenses owner | UI | live 0 rows; #113 gated Add | seed rows then empty; **Add expense visible** | `ui-17-03.png`, `ui-17-06-hydrate-wait.png` | API 0 | **BLOCKED** for permission UI | Merge #113 + Pages redeploy |
| UI-17-04 | Expenses Add on pre-#113 | UI | BLOCKED | Add expense visible | `ui-17-03.png` | n/a | **BLOCKED** | same |
| UI-17-05 | Halal search | UI | filter | ran | `ui-17-05-halal-search.png` | n/a | PASS | none |
| UI-17-N1 | Cashier expenses UI | UI | no Add until #113 | Add expense **visible** for Siti | `ui-17-cashier-expenses.png` | API create FORBIDDEN; `expenses.list` as cashier FORBIDDEN | **BLOCKED** | same |

Cashier `expenses.list` (extra probe, 2:42 PM MYT): FORBIDDEN “You cannot view expenses.” Live Pages still shows the expenses table + Add button. **Do not mark expenses permission UI PASS.**

### 6.8 Step 18 — Reads and reports

| Test ID | Description | Method | Expected | Actual | Evidence | Recon | Status | Owner still |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| API-18-01 | owner dashboard.get `today=2026-09-10` | API | ok, salesCount 0 | 0 sales, 8 purchases | log | prototype range | PASS | Do not change PROTOTYPE_TODAY |
| API-18-N1 | cashier dashboard.get | API | FORBIDDEN | match | log | n/a | PASS | none |
| API-18-03 | reports.sales | API | ok | invoices 0, revenue 0 | log | n/a | PASS | none |
| API-18-N3 | cashier reports.sales | API | FORBIDDEN | match | log | n/a | PASS | none |
| API-18-02 | bmr.list | API | ok | 0 records | log | n/a | PASS | none |
| API-18-04 | owner pjkm.911 2026-11 | API | ok | ok | log | n/a | PASS | none |
| API-18-N2 | cashier pjkm.911 | API | FORBIDDEN receiving.view | match | log | n/a | PASS | none |
| UI-18-01…11 | Dashboard, reports, PJKM, BMR, stock movements, 9.1.1 | UI | render | rendered | `step-18/*.png` | dashboard cashier uses **local overlay** | PASS (render) | Compare KPIs to API after hydrate |
| UI-18-N1 | Cashier dashboard UI | UI | document overlay; do not infer API deny | Siti; RM 42,516 / 24 invoices **local**; recent txns include live-looking PUR/ADJ | `ui-18-cashier-dashboard.png` | API FORBIDDEN | PASS (documented) | Owner: API is deny, UI still paints local math |
| UI-18-N2 | Cashier reports UI | UI | document | rendered | `ui-18-cashier-reports.png` | API FORBIDDEN | PASS (documented) | same |

### 6.9 Cross-module negatives (invalid refs / qty)

| Test ID | Description | Method | Expected | Actual | Recon | Status |
| --- | --- | --- | --- | --- | --- | --- |
| API-NEG-01A | inventory.adjust bad product, no key | API | key required first | match | no movement | PASS |
| API-NEG-01 | same with key | API | NOT_FOUND Product was not found | match | no movement | PASS |
| API-NEG-02 | bad warehouse keyed | API | NOT_FOUND Warehouse was not found | match | no movement | PASS |
| API-NEG-03 | qty 0 keyed | API | Enter a quantity | match | no movement | PASS |

Invalid **document status transitions** that require an existing posted document (void confirmed dispatch, confirm draft return, etc.) were **not** invented. Missing-id confirms returned NOT_FOUND without stock writes.

---

## 7. Data reconciliation summary

| Surface | InventoryBalances | StockMovements | Dup IDs | Formula diffs | Notes |
| --- | --- | --- | --- | --- | --- |
| API before negatives | 234 | 53 | 0 | 0 | skip-inventory types excluded from the formula |
| API after negatives | 234 | 53 | 0 | 0 | no unintended writes |
| Public Pages stock movements screenshot | seed/live mix possible | not used as proof | — | — | lock toasts; do not treat as Sheets |
| Direct Sheets CSV | — | — | — | — | BLOCKED anonymous |

`PROD-20261109-001` remains the only production session on the live backend (planned, unposted). Pages Planning continued to show **two seed sessions** that are **not** in `sessions.list`.

---

## 8. Isolated controlled-write UAT plan — **NOT EXECUTED**

Do not run any row until the owner explicitly approves it. Unique prefix: `UAT-W-{module}-20261115`. Operational date for new sessions: **2026-11-15** (Malaysia). **Never** use or modify `PROD-20261109-001`. Accept/Start/Complete remain **today-only**.

### W-12-01 — Create today's planned session, then cancel (no Accept)

| Field | Value |
| --- | --- |
| Module | 12 Daily Sessions |
| Actor | `u-aina` / owner (`manufacturing.create`, `manufacturing.plan.edit`) |
| Reference | new `PROD-20261115-001` (server-assigned; do not force 20261109) |
| Product / qty | `p-pack-mt` (Matcha) target **1** pack; warehouse `wh-main` |
| Expected records | +1 `productionSessions` planned unposted |
| Expected movements | **none** (create/cancel planned does not post) |
| Expected balances | unchanged 234 / 53 |
| Expected audit | `sessions.create` then `sessions.cancelPlanned` |
| Cleanup | `sessions.cancelPlanned` while still planned |
| Forbidden | Accept, Start, Complete, any action on `PROD-20261109-001` |

### W-13-01 — POS one pack, then void

| Field | Value |
| --- | --- |
| Module | 13 Sales |
| Actor | `u-aina` (`sales.create`, `sales.void`) with **new** idempotency keys |
| Reference | invoice `INV-20261115-###` server-assigned; notes `UAT-W-13-01` |
| Product / qty | `p-pack-mt` qty **1**, `wh-main`, walk-in `c-walkin`, paid 0 |
| Expected records | +1 sale; void restores remaining as `sales_return` `{invoiceNo}-VOID` |
| Expected movements | OUT `sales` 1 then IN `sales_return` 1 (component SKUs only if that product is a component) |
| Expected balances | net **0** after void |
| Expected audit | `sales.create`, `invoice_cancelled` / void |
| Cleanup | void the same sale; do not record a customer payment unless a follow-up row is approved |

Cashier must **not** run this (cashier has `sales.create` but not `sales.void`).

### W-14-01 — Draft return only (no confirm)

| Field | Value |
| --- | --- |
| Module | 14 Sales returns |
| Actor | `u-aina` (`sales_return.create`) |
| Prerequisite | W-13-01 sale **before** void, or a dedicated posted sale from a separate approved row |
| Product / qty | returnedQty **1**, goodQty **1** of the sold SKU |
| Expected records | +1 draft `RT-` |
| Expected movements / balances | **none** until confirm |
| Cleanup | `salesReturns.cancel` draft. **Do not confirm** in the first approval. |

### W-15-01 — Preview / duplicate-reference only

| Field | Value |
| --- | --- |
| Module | 15 Sales import |
| Actor | `u-aina` (`sales.create`) |
| Action | create a throwaway account `UAT-W-15-01` + batch; ingest a **fixture picking text** twice |
| Expected | second ingest `VALIDATION_ERROR` duplicate file/order; **0** posted sales |
| Movements | none unless confirm is separately approved (default: **do not confirm**) |
| Cleanup | leave unconfirmed batch; do not `salesImport.confirm` |

### W-16-01 — Draft dispatch, no confirm

| Field | Value |
| --- | --- |
| Module | 16 Dispatch |
| Actor | `u-aina` (`sales.delivery.create`) |
| Expected | +1 draft dispatch, 0 vehicles unless a vehicle row is approved first |
| Movements | confirm/void **do not post inventory** per module contract; still **do not confirm** live courier shipments |
| Cleanup | void draft if supported; do not attach real orders |

### W-17-01 — Expense create (only after #113 Pages deploy if UI gating is in scope)

| Field | Value |
| --- | --- |
| Module | 17 Expenses |
| Actor | `u-aina` (`expenses.manage`) |
| Reference | description `UAT-W-17-01-20261115`, amount 1.00, category Other |
| Expected | +1 expense; 0 stock movements |
| Cleanup | no expense delete API in this module — **do not run** unless the owner accepts a leftover RM 1 row |
| Cashier | must remain FORBIDDEN |

### W-18-01

Reads only. No write plan. Re-run dashboard/reports after hydrate is healthy.

---

## 9. Blockers

1. **PR #113 OPEN** — expenses permission UI must not be marked PASS until merge **and** Pages redeploy (`index-BIZo9uFM.js` is still live).
2. **Apps Script ScriptLock timeouts** on public Pages hydrate — live records often do not replace seed. Owner visual UAT of lists is blocked until a quiet retry succeeds.
3. **Anonymous Sheets export BLOCKED** — recon used `/exec` `inventory.get`, which is the live workbook projection.
4. **Cashier dashboard UI** paints local KPIs while `dashboard.get` is FORBIDDEN. Do not accept the painted KPIs as API data.
5. **Controlled writes** not started — no POS, return, import, dispatch, or today's session was posted.

Non-blockers (working as designed):

- Past-dated Accept/Start/Complete → “Not today's production”.
- Idempotency key is validated **before** `sales.void` permission (unkeyed cashier void is VALIDATION_ERROR, not FORBIDDEN).
- Live payments `PAY-000001` / `PAY-000002` are **supplier** closeout rows.
- Header 10 Sept 2026 is `PROTOTYPE_TODAY`; Daily Sessions uses live Malaysia date.

---

## 10. Remaining owner actions (acceptance checklist)

Automated UAT **does not** close Steps 12–18. Suggested owner sequence:

1. **Do not** accept/start `PROD-20261109-001`. Keep today-only Accept/Start.
2. Retry public Pages when no lock toasts appear. Confirm Planning shows **only** live sessions (currently API has `PROD-20261109-001` only).
3. On Payments, open **Supplier payments** and confirm `PAY-000001` / `PAY-000002` after a successful `sales.list` hydrate.
4. Review leftover sales-import probe accounts; do not confirm imports.
5. **Do not** mark expenses UI PASS until PR #113 is merged and Pages is redeployed; then re-test cashier **Add expense** hidden + API FORBIDDEN.
6. Approve or reject each isolated write row in §8 **in writing**. Until then, all write IDs stay **NOT RUN**.
7. After any approved write: re-check 234±delta balances, movement identity, and `PROD-20261109-001` still planned/unposted.
8. Explicitly accept or reject each of Steps 12, 13, 14, 15, 16, 17, 18. Until that happens they stay **OWNER UAT REQUIRED**.

Steps 9–11 stay **LOCKED**. No Apps Script deploy was performed in this task.
