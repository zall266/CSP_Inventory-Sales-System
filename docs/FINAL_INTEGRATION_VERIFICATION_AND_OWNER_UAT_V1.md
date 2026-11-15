# CSP Inventory & Sales System — Final Integration Verification and Owner UAT V1

Verification date: **15 Nov 2026, 11:46 AM MYT** (Asia/Kuala_Lumpur).  
Verifier: read-only GitHub, live `/exec`, public GitHub Pages, local automated suites.  
No production workflow was executed. No historical row was rewritten. `PROD-20261109-001` was not accepted, started, amended, completed, or cancelled.

Status values used in this document: **PASS**, **FAIL**, **BLOCKED**, **NOT RUN**, **OWNER UAT REQUIRED**.

Automated verification is not owner UAT. A passing test suite does not lock a module.

---

## 1. Executive summary

The DEV backend is healthy and the live inventory ledger still reconciles. Steps 9–11 remain owner-locked. Steps 12–18 are implemented on the backend and covered by automated tests, but they are **not** owner-accepted and must not be marked LOCKED.

**PR #113 is open and not merged.** That is the Pages blocker for the expenses-permission UI fix. Do not force-merge. The existing `/exec` already published the PR #113 Apps Script source (see section 4). Public GitHub Pages still serves the pre-#113 bundle.

The system is a verified DEV baseline for owner UAT. It is not production-ready.

| Area | Status |
| --- | --- |
| PR #113 merge into integration | **BLOCKED** (open, mergeable, awaiting approval) |
| Public GitHub Pages vs PR #113 frontend | **BLOCKED** until #113 merges |
| Live `/exec` health | **PASS** |
| Inventory baseline 234 / 53 | **PASS** |
| Duplicate StockMovement IDs | **PASS** (0 duplicates) |
| Cashier dashboard `FORBIDDEN` | **PASS** (expected permission boundary) |
| `PROD-20261109-001` planned, unposted | **PASS** |
| Steps 9–11 | Owner-locked (out of scope; not modified) |
| Steps 12–18 owner UAT | **OWNER UAT REQUIRED** |
| Automated backend suite on PR #113 HEAD | **PASS** (150/150) |

---

## 2. PR #113 verification

Repository: `zall266/CSP_Inventory-Sales-System`  
URL: https://github.com/zall266/CSP_Inventory-Sales-System/pull/113

| Item | Evidence |
| --- | --- |
| State | **open**, `draft: false`, `merged: false`, `merged_at: null`, `merged_by: null` |
| Title | Complete Step 0–18 integration audit and owner UAT prep |
| Base | `cursor/dev-frontend-github-pages-d9ac` @ `a756a9b0a684f48e85db2b46c0ebe0c252003471` |
| Head | `cursor/completion-program-audit-d9ac` @ `bf8231b37d0e278a015f826e0b0554c10ea28992` |
| Commits | 2 (`ea910f2` implementation, `bf8231b` v30 evidence docs) |
| Files | 12 changed, +851 / −17 |
| Mergeable | `mergeable: true`, `mergeable_state: clean`, `rebaseable: true` |
| Speculative merge SHA | `45978c1e455f238ce4df3b9ea42a0276cbd815b8` (GitHub preview only; **not** a merge) |
| CI | `gh pr checks 113`: Deploy DEV job **pass** (run [43600212554](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/43600212554)) |
| Reviews / comments | 0 |

Intended frontend change in #113: `expenses.manage` gates Finance → Expenses and `createExpense`. Backend already rejected unauthorized `expenses.create`.

**This verification did not merge #113.** Branch protection / owner approval must be followed. Do not bypass it.

---

## 3. GitHub Pages deployment verification

Public URL: https://zall266.github.io/CSP_Inventory-Sales-System/

| Item | Evidence |
| --- | --- |
| HTTP | 200 |
| Last-Modified | Sat, 14 Nov 2026 07:04:02 GMT = **3:04 PM MYT, 14 Nov 2026** |
| Workflow | Last Pages deploy on the integration branch: [43569258510](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/43569258510) for merge of PR #112 @ `a756a9b` |
| Deployed integration commit | `a756a9b` (PR #112). **Not** `bf8231b` / PR #113 |
| Live JS bundle | `/CSP_Inventory-Sales-System/assets/index-BIZo9uFM.js` (2,107,397 bytes) |
| Live CSS | `/CSP_Inventory-Sales-System/assets/index-BwvC6gyD.css` |
| Bundle contains | `dashboard.get`, `sessions.create`, `salesReturns.confirm`, `salesImport.confirm`, `dispatch.confirm`, `Not today's production`, permission key string `expenses.manage` (catalog label) |
| Bundle does **not** contain | `You cannot manage expenses.` (the #113 toast). Frontend expenses gate is therefore **not** on Pages |

Local Vite production build of the PR #113 tree produced `index-Dl80gYdS.js`. That artifact is **not** the public bundle.

Pages status vs PR #113 frontend: **BLOCKED** until #113 is merged through the normal process.

---

## 4. Apps Script deployment verification

Locked project, spreadsheet, `/exec`, and Drive were not replaced.

| Resource | Value |
| --- | --- |
| Apps Script project | `1mkRzptY0mzHnzOFB8TA6AGIZyv6q2gJq-QdKPBWtV91oq5okHWVpY4Jj` |
| Spreadsheet | `1TPmkASdzlGssGyAisklf4QkLcxWYbHHhUSxntgLha94` |
| `/exec` | `AKfycbyMDLwOJ2iqD_nuLFcVMQYrS81WDkkaBhutTGBCrbUClM1Aap1MJiO6CnzzcYuTAoMbDw` |
| Drive root | `14vIYpPSNQafvMnWgSEd1EGounerNjK3S` |

| Version | Git description | Workflow | Notes |
| --- | --- | --- | --- |
| v30 | `git:ea910f2c0d7e78039339074212f4c4aa42f018d5` | [43599997388](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/43599997388) | PR #113 implementation (report date-range fix + tests). Live-verified 14 Nov 2026, 9:30 PM MYT |
| **v31 (current clasp version)** | `git:bf8231b37d0e278a015f826e0b0554c10ea28992` | [43600212554](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/43600212554) | Evidence-docs commit. Apps Script source is the same as v30 (`tests/**` is clasp-ignored; only `docs/` changed) |

Baseline expected v30 / `ea910f2`. Actual clasp version is **v31** / `bf8231b` because the evidence push re-ran the existing Deploy DEV workflow on the unmerged PR branch. Inventory counts did not change. This verification **did not** deploy Apps Script.

Same `/exec` URL. No new Apps Script project.

---

## 5. Backend health and baseline comparison

`GET /exec` at **11:46 AM MYT, 15 Nov 2026**:

```json
{
  "ok": true,
  "data": {
    "service": "CSP Inventory Backend",
    "environment": "DEV",
    "status": "healthy",
    "timezone": "Asia/Kuala_Lumpur",
    "spreadsheetAccessible": true,
    "driveAccessible": true,
    "foundationReady": true
  }
}
```

Meta timestamp: `2026-11-15T03:46:40.176Z`.

| Item | Expected (last report) | Observed 15 Nov 2026, 11:46 AM MYT | Status |
| --- | --- | --- | --- |
| Environment | DEV | DEV | **PASS** |
| Timezone | Asia/Kuala_Lumpur | Asia/Kuala_Lumpur | **PASS** |
| Health | healthy | healthy | **PASS** |
| InventoryBalances rows | 234 | 234 | **PASS** |
| StockMovements rows | 53 | 53 | **PASS** |
| Duplicate movement IDs | none | 0 | **PASS** |
| Ledger recon (in − out vs balances, skip-inventory types excluded) | 0 unexplained | 0 unexplained | **PASS** |
| Apps Script version | v30 / `ea910f2` | clasp **v31** / `bf8231b` (source = v30) | Version number differs; data baseline **PASS** |
| Cashier `dashboard.get` | FORBIDDEN | `FORBIDDEN` “You cannot view the dashboard.” | **PASS** |
| Sales | 0 | 0 | **PASS** |
| Payments | 2 | 2 | **PASS** |
| Expenses | 0 | 0 | **PASS** |
| Sessions | 1 planned | 1: `PROD-20261109-001` planned, posted false | **PASS** |
| Dashboard `today=2026-11-15` 30d | n/a | sales 0, purchases 7 totaling 39, inventory value 477.22, receivables 0, payables 99 | Informational |
| Dashboard `today=2026-09-10` 30d (frontend prototype date) | purchases 8 totaling 86 | same | **PASS** |

Movement types on the live 53 rows: adjustment 13, opening_balance 1, production_in 3, production_out 3, purchase 11, purchase_return 8, receiving 5, stock_count 1, stock_usage 2, transfer_in 3, transfer_out 3. No skip-inventory types present.

No records were modified to match the expected counts.

---

## 6. Steps 12–18 implementation audit

Authoritative roadmap: Master Backend Architecture V1 §29 (`docs/CSP_MASTER_BACKEND_ARCHITECTURE_V1.md` @ `86230b5`). Frontend workflows and existing adapters are the UI contract. Backend services on the integration branch (plus PR #113 date-range/expenses UI, unmerged) are the API contract.

Comparison method for each step: roadmap name/scope → backend service/actions → frontend routes/adapters → tests → live read-only evidence. **No real writes.**

### Step 12 — Daily Sessions

Roadmap: full session machine, recipe file; UAT boundary display+carton, complete once.

| Layer | Finding |
| --- | --- |
| Backend | `sessions.list/get/create/accept/start/cancelPlanned/update/amend/changeTarget/togglePicking/addMaterial/saveResult/saveDistribution/saveMaterialClosing/complete/continueCarryForward/editCompleted/editCompletedClosing`. `requireToday` → `VALIDATION_ERROR` “Not today's production”. Complete is idempotent; second key `CONFLICT`. AUTO out from material-closing actual used; MANUAL skip. |
| Frontend | Manufacturing → Production Planning `/manufacturing/planning`; Today’s Production `/manufacturing/today`; Picking `/manufacturing/picking`; Complete `/manufacturing/complete`; Carry Forward `/manufacturing/carry-forward`; History `/manufacturing/history`. Adapter queues `sessions.*`. Accept/Start toast “Not today's production”. |
| Tests | `manufacturing.test.js`, `sessionDate.test.js` (6), `calendarDate.test.ts` (10). |
| Live | `sessions.list`: only `ps_p2lblrm1i` / `PROD-20261109-001` / `2026-11-09` / `planned` / posted false. |
| Writes | **NOT RUN** (owner-only; session must be new and dated today). |

Implementation vs roadmap: **PASS**. Owner UAT: **OWNER UAT REQUIRED**.

### Step 13 — Sales documents

Roadmap: sale, quote, delivery, payment, print audit; void restores stock.

| Layer | Finding |
| --- | --- |
| Backend | `sales.create` / `createWholesale` / `void` / `recordPayment`; quotations; deliveries; `documents.recordPrint`. Shared `Payments` / `PAY-` with purchases. Agent warehouse rejected. |
| Frontend | Sales `/sales`, POS `/pos`, Quotations `/sales/quotations`, Delivery Orders `/sales/delivery-orders`, invoice print routes. Agent Sales `/sales/agents` remains local `createAgentSale`. |
| Tests | `sales.test.js`. |
| Live | `sales.list`: 0 sales, 2 locked-closeout payments. |
| Writes | **NOT RUN**. |

Implementation vs roadmap: **PASS**. Owner UAT: **OWNER UAT REQUIRED**.

### Step 14 — Sales returns (authoritative name)

Architecture §29 step 14 is **Sales returns**, not a different module. Prerequisites: Step 13. Backend: return confirm. UI: returns pages. UAT: good / repack / waste match architecture section 17 (good IN finished goods; repack grams to production balance; waste does not add finished-goods qty).

| Layer | Finding |
| --- | --- |
| Backend | `salesReturns.save/update/cancel/confirm`, lookup upsert. Confirm requires idempotency key. Agent `SAL-` and agent warehouses rejected. Evidence metadata only; Drive blob upload is not in this module. |
| Frontend | Sales → Returns `/sales/returns`, `/sales/returns/new`. |
| Tests | `salesReturn.test.js`. |
| Live | 0 returns; default sources/reasons previously seeded. |
| Writes | **NOT RUN**. |

Implementation vs roadmap: **PASS**. Owner UAT: **OWNER UAT REQUIRED**.

### Step 15 — Sales import

Roadmap: import tables and confirm; duplicate reference does not double-post.

| Layer | Finding |
| --- | --- |
| Backend | Account/batch/ingest/map/`salesImport.confirm` through `sales.create` onto `wh-main`. Duplicate key `{PLATFORM}:{account}:{externalOrderId}`. Platforms Shopee and TikTok only. Missing AWB does not block. Confirm without key rejected. |
| Frontend | Sales → Sales Import `/sales/import`, mappings `/sales/import/mappings`. |
| Tests | `salesImport.test.js`. |
| Live | Previously noted 3 probe accounts, 0 batches, 0 posted sales. This read did not re-list import accounts (no write). Sales still 0. |
| Writes | **NOT RUN**. |

Implementation vs roadmap: **PASS**. Owner UAT: **OWNER UAT REQUIRED**.

Live cashier/staff matrices include `sales.create`, so those roles can import unless the owner changes the matrix. Warehouse `u-kumar` cannot.

### Step 16 — Dispatch

Roadmap: dispatch, vehicles, groups; confirm and void. Vehicles were deferred from Step 4 and implemented here.

| Layer | Finding |
| --- | --- |
| Backend | `vehicles.*`, `dispatch.create/update/confirm/void`, inspection groups. Confirm/void do not post inventory. |
| Frontend | Settings → Vehicles `/settings/vehicles`; Sales → Dispatch `/sales/dispatch`. |
| Tests | `dispatch.test.js`. |
| Live | Prior verify: empty vehicles/dispatches. Inventory still 234/53. |
| Writes | **NOT RUN**. |

Implementation vs roadmap: **PASS**. Owner UAT: **OWNER UAT REQUIRED**.

### Step 17 — Halal, tasks, expenses

Roadmap: those writes; files in Drive and ids on the row.

| Layer | Finding |
| --- | --- |
| Backend | Halal manufacturer/compliance with Drive `HalalCertificates`; tasks with `TaskPhotos`; `expenses.create` requires `expenses.manage`. Ops writes do not post inventory. |
| Frontend | Compliance → Halal `/compliance/halal`; Tasks `/tasks`; Finance → Expenses `/expenses`. PR #113 adds UI permission gates; **not on Pages until merge**. |
| Tests | `ops.test.js`. |
| Live | `expenses.list` 0 rows. |
| Writes | **NOT RUN**. No confidential uploads. |

Implementation vs roadmap: **PASS** (backend). Pages expenses UI: **BLOCKED** on #113 merge. Owner UAT: **OWNER UAT REQUIRED**.

### Step 18 — Reads (dashboard, reports, PJKM, BMR)

Roadmap: dashboard, reports, PJKM, BMR; totals match sheets; print unchanged.

| Layer | Finding |
| --- | --- |
| Backend | `dashboard.get`, `reports.*`, `pjkm.511/911/1011`, `bmr.list/get`. Locked reads. PR #113 made `reportDateRange` Malaysia `+08:00` calendar bounds (live on `/exec` v30/v31). |
| Frontend | Dashboard `/`; Reports `/reports/*`; PJKM `/pjkm`; BMR `/compliance/bmr`. Overlay sends `today=PROTOTYPE_TODAY` (`2026-09-10`). Daily Sessions uses live Malaysia date. **No global change to `PROTOTYPE_TODAY` in this task.** |
| Tests | `reporting.test.js` including Malaysia end-of-day (on PR #113 branch). |
| Live | Owner dashboard ok; cashier FORBIDDEN; reads did not change inventory 234/53. |
| Writes | **NOT RUN** (reads only). |

Implementation vs roadmap: **PASS**. Owner UAT: **OWNER UAT REQUIRED**.

---

## 7. Automated test results

Commands run on the PR #113 tree (`bf8231b`) at 11:46 AM MYT, 15 Nov 2026. Integration HEAD `a756a9b` does not yet contain `integration.test.js`.

| Command | Passed | Failed | Skipped | Result |
| --- | --- | --- | --- | --- |
| `npm run test:backend` | 150 | 0 | 0 | **PASS** |
| `npm run test:dates` | 10 | 0 | 0 | **PASS** |
| `npx tsc --noEmit --pretty false` | — | — | — | **PASS** (exit 0) |
| `npm run lint` (alias of `tsc --noEmit --pretty false`) | — | — | — | **PASS** (exit 0) |
| `npx vite build` | — | — | — | **PASS** (exit 0), local `index-Dl80gYdS.js` |
| Dedicated security scanner | — | — | — | **NOT RUN** (no project script; permission cases are inside the backend suite) |
| Owner UI UAT | — | — | — | **NOT RUN** |

Existing tests were not deleted, skipped, or weakened.

---

## 8. Permission and security verification

| Check | Method | Status |
| --- | --- | --- |
| Cashier cannot view dashboard | Live `u-siti` `dashboard.get` → `FORBIDDEN` | **PASS** |
| Cashier cannot create purchases / expenses | Automated (purchase + ops + integration) | **PASS** |
| Staff cannot manage Halal/expenses | Automated ops tests | **PASS** |
| Unauthorized writes create no inventory | Ops expense create leaves movements unchanged (automated) | **PASS** |
| Hidden UI is not the only expenses control | Backend `requirePermission('expenses.manage')` on `/exec` | **PASS** |
| Pages expenses button hidden without permission | Requires #113 merge | **BLOCKED** |
| `inventory.get` has no view key | Early-module architecture; not changed | Documented risk (section 10) |
| Identity is `payload.actorUserId` | Established Apps Script contract | Documented; not redesigned |

---

## 9. Data integrity findings

Live independent recon at 11:46 AM MYT, 15 Nov 2026:

Opening (from movements) + Stock In − Stock Out = InventoryBalances, excluding skip-inventory types (`sales_return_repack`, `sales_return_waste`, `production_balance_in`, `production_balance_out`, `production_wastage`). None of those types exist in the 53 live movements.

**Unexplained differences: 0. Duplicate movement IDs: 0.**

`PROD-20261109-001` is still the only production session: planned, unposted, date `2026-11-09`, notes `STEP12-UAT-20261109`.

No historical repair was applied.

---

## 10. Known defects and risks

| ID | Severity | Status | Notes |
| --- | --- | --- | --- |
| PR-113-UNMERGED | Process | **BLOCKED** | Pages does not include expenses UI gate. Backend already enforces the permission. |
| ASP-V31 | Low | Informational | Clasp version is v31 (`bf8231b`) after a docs-only Deploy DEV. Source matches v30. Inventory unchanged. |
| PROTO-DATE | Low | Documented | Dashboard/Reports overlay uses `PROTOTYPE_TODAY` 2026-09-10. Daily Sessions uses live Malaysia date. **Not changed.** Owner decision required to switch reports. |
| EXP-UI-PAGES | Medium | **BLOCKED** on merge | Live bundle lacks `You cannot manage expenses.` toast. Cashier can still open `/expenses` in the current Pages bundle; API create is FORBIDDEN. |
| INV-GET-OPEN | Low | Documented | `inventory.get` does not require a view key (Step 5 contract). Later list APIs do. Not changed. |
| AGENT-LOCAL | Low | Documented | Agent sales remain local `createAgentSale`. |
| SRET-DRIVE | Low | Documented | Sales-return confirm stores evidence metadata; Drive blob upload is out of Step 14. |
| S9-RETURN-QTY | Low | Locked Step 9 | Purchase-return qty is checked against purchase-line qty; stock-out uses that number as base units. Not modified. |

No CRITICAL live inventory defect. No FAIL on the locked modules.

---

## 11. Owner UAT checklist

Public app: https://zall266.github.io/CSP_Inventory-Sales-System/  
Actor unless stated: owner Aina Rahman (`u-aina`). Negative actor: cashier Siti (`u-siti`).  
Label isolated writes `UAT12-` … `UAT18-` / `STEP12-UAT-<YYYYMMDD>`.  
**Do not use `PROD-20261109-001`.** Accept/Start remain today-only (Malaysia).

### A. Read-only tests (safe; no new business rows)

| UAT ID | Module | Preconditions | Navigation | Owner action | Expected UI | Sheets / stock / audit | Evidence | PASS/FAIL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-12-01 | Daily Sessions | Signed in as owner | Manufacturing → Production Planning `/manufacturing/planning` | View list only. Do not click Accept on `PROD-20261109-001` | Session `PROD-20261109-001`, date **09 Nov 2026**, Planned | Unchanged | Screenshot of date + status | PASS if date is 09 Nov 2026 and status Planned |
| R-12-02 | Daily Sessions | Same | Manufacturing → Today’s Production `/manufacturing/today` | Observe today’s Malaysia date | Empty or “no session for today”. Must **not** treat 9 Nov as today | Unchanged | Screenshot of header date vs session | PASS if 9 Nov session is not operational today |
| R-12-03 | Daily Sessions | Switch to Siti | `/manufacturing/today` | Attempt Accept if visible | Denied or hidden | No status change on `PROD-20261109-001` | Screenshot + sheet still planned | PASS if no write |
| R-13-01 | Sales | Owner | Sales `/sales`, POS `/pos` | Browse only | 0 sales in DEV; 2 historical payments under Finance → Payments | Sales 0; Payments 2 | Screenshot | PASS if no new sale |
| R-14-01 | Sales returns | Owner | Sales → Returns `/sales/returns` | Open list | Empty or historical UAT only; sources/reasons available | No confirm | Screenshot | PASS if no confirm |
| R-16-01 | Dispatch | Owner | Sales → Dispatch `/sales/dispatch`; Settings → Vehicles | Browse | Empty or prior UAT only | No confirm | Screenshot | PASS if inventory still 234/53 |
| R-17-01 | Expenses/Halal/Tasks | Owner | `/expenses`, `/compliance/halal`, `/tasks` | Browse | Expenses 0 | No create | Screenshot | PASS if no new row |
| R-18-01 | Dashboard | Owner | Home `/` | Open dashboard | KPIs load. Prototype range may show Sept 2026 overlay | No writes; inventory 234/53 | Screenshot + note the date preset | PASS if page loads and stock unchanged |
| R-18-02 | Reports / PJKM / BMR | Owner | `/reports/sales`, `/pjkm`, `/compliance/bmr` | Open each | Tables/zeros load; print still browser print | No new rows | Screenshot | PASS if reads only |
| R-18-03 | Dashboard permission | Siti | `/` | Open dashboard | Permission denied in UI and/or blank KPIs; API FORBIDDEN | No writes | Screenshot | PASS if cashier cannot see owner KPIs |

Google Sheets access is required to confirm “unchanged” for R-12-01 and stock 234/53.

### B. Controlled write tests (explicit owner approval; isolated data)

Do **not** execute these in this verification. Owner runs them on the **current Malaysia date**.

#### Step 12 — new session only

| UAT ID | Function | Preconditions | Navigation | Steps | Expected UI | Sheets | StockMovements | InventoryBalances | AuditLogs | PASS/FAIL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W-12-01 | Create | Owner; today MYT | `/manufacturing/planning` | Create session for **today**, notes `STEP12-UAT-<YYYYMMDD>`, products with AUTO and MANUAL BOM lines | New `PROD-<today>-00n`, Planned | New ProductionSessions row. Historical session untouched | None | Unchanged | `sessions.create` | PASS if new id exists and `PROD-20261109-001` unchanged |
| W-12-02 | Accept | W-12-01 | `/manufacturing/today` | Accept the **new** session only | Accepted | acceptedBy/At filled on new row only | None | Unchanged | `sessions.accept` | FAIL if 9 Nov session changes |
| W-12-03 | Start + recipe photo | W-12-02; JPEG | `/manufacturing/today` | Start without photo (must fail), then with photo | In progress after photo | status `in_progress`; Drive file id | None | Unchanged | `sessions.start` | PASS if photo required |
| W-12-04 | Picking | W-12-03 | `/manufacturing/picking` | Toggle picking on today’s lines | Picked flags update | Session picking fields | None | Unchanged | `sessions.togglePicking` | PASS if 9 Nov not picked |
| W-12-05 | Three complete steps | W-12-04 | `/manufacturing/complete` | Save result, distribution, material closing | Complete disabled until all three saved | Result/distribution/closing fields | None yet | Unchanged | save* actions | PASS if no stock yet |
| W-12-06 | Display + carton = actual | W-12-05 | Complete → distribution | Enter mismatch, then matching display+carton=actual | Mismatch rejected | No complete post on mismatch | None on mismatch | Unchanged | validation only | PASS if equality enforced |
| W-12-07 | Complete once | W-12-06 | Complete | Complete once, retry | Completed; retry no extra qty | posted true | One `production_in` per FG; AUTO `production_out`; no MANUAL out | FG +actual; AUTO −used; MANUAL unchanged | one `sessions.complete` | PASS if retry does not double-post |
| W-12-08 | Carry-forward | Remaining target after complete | `/manufacturing/carry-forward` | Continue once | Remaining on today or new planned | Origin remaining reduced | None extra from continue itself | Unchanged by continue | `sessions.continueCarryForward` | PASS if once only |

Batch: completed session should create/keep the production batch used by BMR. Confirm on History `/manufacturing/history/:id`.

#### Steps 13–17 — isolated documents

| UAT ID | Module | Navigation | Isolated data | Expected UI | Sheets | Stock | Audit | PASS/FAIL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W-13-01 | POS cash | `/pos` | 1 sellable pack in stock, Walk-in, cash | `INV-` Paid | Sales, SaleLines, Payments | one `sale` OUT | `sales.create` | Document, payment, movement, balance agree; same key does not double-post |
| W-13-02 | Invoice + collect | `/sales`, `/payments` | Unpaid invoice then full collect | Unpaid → Paid | paid/balance = Payments | Out on create only | create + recordPayment | Payment does not move stock |
| W-13-03 | Void | Invoice detail | Remaining qty | Voided; payments **not** reversed | status voided | `sales_return` `{invoiceNo}-VOID` IN remaining | void + print audit cancelled | Remaining restored once |
| W-13-04 | Quotation convert | `/sales/quotations` | Non-agent quote | `INV-YYYYMMDD-###` once | Quotation convertedSaleId | Same as sale | convert | Second convert rejected |
| W-13-05 | Delivery | `/sales/delivery-orders` | Create/issue/deliver | DO statuses | DeliveryOrders | **none** | deliveries.* | No movement for DO number |
| W-14-01 | Return draft | `/sales/returns/new` | After W-13-01; Shopee + changed mind; good qty | `RT-` draft | SalesReturns draft | **none** | save | Draft does not move stock |
| W-14-02 | Return confirm | Confirm W-14-01 | good / optional repack+waste totaling returned qty | Confirmed | good IN; repack skip + `production_balance_in`; waste skip | FG += good only | `sales_return_confirmed` | Same key replay; new key CONFLICT |
| W-15-01 | Import confirm | `/sales/import` | Test Shopee/TikTok account; unique `UAT15-` external ids; do not use live shop orders that would drain real stock | Batch confirmed | Import + Sales | `sale` OUT once per external id | confirm | Duplicate `{PLATFORM}:{account}:{externalOrderId}` does not double-post |
| W-16-01 | Dispatch | `/settings/vehicles`, `/sales/dispatch` | Vehicle code `UAT16-`; shipment from W-15 or skip confirm | Confirmed then optional void | Vehicles, Dispatches, DispatchLines | **none** on confirm/void | confirm/void | Inactive vehicle cannot confirm |
| W-17-01 | Halal | `/compliance/halal` | Manufacturer `UAT17-`; non-confidential sample PDF | Certificate row | Manufacturers, certificates, compliances | **none** | save* | File in Drive `HalalCertificates` |
| W-17-02 | Task | `/tasks` | Seeded category; photo required | Complete once | StaffTasks / occurrences | **none** | complete | Missing photo blocked; same key replay |
| W-17-03 | Expense | `/expenses` | Description `UAT17-rent`, amount > 0 | Added | Expenses | **none** | expenses.create | After #113 merge, cashier has no Add button |

### C. Negative tests (rejection without unintended writes)

| UAT ID | Actor | Action | Expected | Stock/sheets | PASS/FAIL |
| --- | --- | --- | --- | --- | --- |
| N-12-01 | Owner | Accept `PROD-20261109-001` | “Not today's production” | Session still planned, posted false | PASS if unchanged |
| N-12-02 | Siti | Accept/start/complete today’s session | FORBIDDEN / hidden | No posted flag | PASS if no movement |
| N-13-01 | Siti | Void / create quotation | FORBIDDEN | No void movement | PASS |
| N-14-01 | Siti | `salesReturns.save` | FORBIDDEN “You cannot create a sales return.” | No `RT-` | PASS |
| N-15-01 | Confirm import without idempotency key | VALIDATION_ERROR | No sale | PASS |
| N-16-01 | Siti | `vehicles.create` / `dispatch.create` | FORBIDDEN | No vehicle | PASS |
| N-17-01 | Siti | Add expense | UI denied after #113 merge; API FORBIDDEN always | No Expenses row | PASS |
| N-18-01 | Siti | Dashboard/reports/PJKM/BMR | FORBIDDEN | No writes | PASS |

### D. Reconciliation tests

After any approved write, owner (or verifier with Sheets access) compares:

1. UI document number and status.  
2. API list/get snapshot.  
3. Google Sheets header + lines.  
4. StockMovements for that reference (or proven absence).  
5. InventoryBalances for each product+warehouse: previous + in − out.  
6. AuditLogs userId `u-aina` (or Siti for deny-with-no-row).

PASS only when all six agree. FAIL if any layer disagrees. Do not repair historical rows to force a pass.

---

## 12. Blockers and dependencies

1. **PR #113 is not merged.** Pages frontend expenses gate is not live. Merge through normal approval; do not bypass protection.  
2. **Owner UAT of Steps 12–18** has not started (except historical create of `PROD-20261109-001`).  
3. Step 12 writes require a **new** session on the current Malaysia date. The 9 Nov session is not usable for Accept/Start.  
4. Step 16 confirm needs an import shipment or the owner skips confirm.  
5. Optional owner decision: whether Dashboard/Reports should stop using `PROTOTYPE_TODAY`. Not implemented.  
6. Google Sheets access is required for reconciliation evidence.

Dependencies that must stay locked: Steps 9–11. Shared ledger: `StockMovements` / `InventoryBalances`. Shared `/exec`.

---

## 13. Recommended next action

1. Owner reviews and, if accepted, **merges PR #113** into `cursor/dev-frontend-github-pages-d9ac` so Pages rebuilds with the expenses UI gate.  
2. Confirm the new Pages bundle no longer matches `index-BIZo9uFM.js` and contains `You cannot manage expenses.`  
3. Do **not** redeploy Apps Script unless a new backend defect is found. `/exec` already has the date-range fix (v30 source / v31 clasp version).  
4. Owner executes **A. Read-only** checks the same day.  
5. Owner authorizes **B. Controlled writes** on isolated labels, starting with Step 12 **new** session. Never `PROD-20261109-001`.  
6. Keep Steps 12–18 **OWNER UAT REQUIRED** until those writes are evidenced. Do not mark LOCKED. Do not call the system production-ready.

---

## Appendix — locked identifiers

- Integration branch HEAD at verification: `a756a9b`  
- PR #113 HEAD: `bf8231b`  
- `/exec`: `AKfycbyMDLwOJ2iqD_nuLFcVMQYrS81WDkkaBhutTGBCrbUClM1Aap1MJiO6CnzzcYuTAoMbDw`  
- Session to preserve: `PROD-20261109-001` / `ps_p2lblrm1i`
