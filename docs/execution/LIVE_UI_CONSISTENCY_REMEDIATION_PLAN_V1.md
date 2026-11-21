# Live UI consistency — minimal remediation plan V1

**Date:** 15 Nov 2026, 3:29 PM MYT (Asia/Kuala_Lumpur)  
**Status:** PLAN ONLY. No behavioural code was implemented. No Apps Script deploy. No writes. `PROD-20261109-001` untouched. `PROTOTYPE_TODAY` unchanged. Steps 12–18 remain **OWNER UAT REQUIRED**. Steps 9–11 remain **PASS / LOCKED**.

Objective: make the public DEV UI show the same records as `/exec` and Google Sheets so Owner UAT can proceed safely.

---

## 0. PR verification (this turn)

### PR #115 — https://github.com/zall266/CSP_Inventory-Sales-System/pull/115

| Check | Result |
| --- | --- |
| State | OPEN, **not merged** |
| Base | `cursor/dev-frontend-github-pages-d9ac` (`a756a9b`) |
| Head | `cursor/owner-uat-automation-d9ac` (`1a7c8c7`) |
| Mergeable | clean |
| Reviews / comments | none |
| GitHub Actions | **No workflow ran.** Combined status is empty/`pending` with 0 statuses. |
| Why no CI | Repo has no PR test workflow. `deploy-dev.yml` and `deploy-frontend-pages.yml` only run on named module/integration branches. This docs/evidence branch is not in those lists (correct — do not add it). |
| Review | Docs, Playwright evidence, API logs, isolated write plan **not executed**. Safe to keep open for owner reading. **Do not auto-merge.** |

### PR #113 — https://github.com/zall266/CSP_Inventory-Sales-System/pull/113

Ready for **normal owner approval and merge**. Do not treat merge as Owner UAT of Steps 12–18.

| Check | Result |
| --- | --- |
| State | OPEN, mergeable **clean**, 0 reviews |
| Head | `cursor/completion-program-audit-d9ac` (`bf8231b`) |
| What it lands | Expenses `expenses.manage` UI gate; Malaysia-safe `reportDateRange`; integration tests (150 backend); UAT guides; execution report |
| Apps Script | This branch is listed in `deploy-dev.yml`. Push already published **v30** (`git:ea910f2`) on the **same** `/exec`. Backend date-range fix is already live. |
| Pages | **Not** live. Public bundle is still `index-BIZo9uFM.js`. Merge into the integration branch **will** start `Deploy DEV frontend` and replace the Pages bundle. |
| Does not fix | ScriptLock hydrate contention, cashier dashboard local KPIs, header prototype date |

**Owner merge checklist for #113 (after you approve):**

1. Confirm you want expenses UI gating and the Malaysia `reportDateRange` on public Pages.
2. Merge #113 into `cursor/dev-frontend-github-pages-d9ac` (do not squash-away the expenses UI files).
3. Wait for Actions **Publish DEV frontend**. Confirm `index.html` no longer loads `index-BIZo9uFM.js`.
4. As Siti: `/expenses` must not show **Add expense**; expect permission denied if `finance.view` is also false. As owner: Add expense remains.
5. Do **not** lock Steps 12–18. Do **not** accept `PROD-20261109-001`.
6. Follow-up (optional): remove `cursor/completion-program-audit-d9ac` from `deploy-dev.yml` after merge so later pushes to that stale branch cannot republish Apps Script.

#113 does **not** make live lists match Sheets. Merge it for the expenses UI; then apply Fix A (below) so UAT screens stop showing seed data.

---

## 1. Issue A — ScriptLock contention vs inconsistent lists

### Root cause

Live DEV uses one Apps Script **script lock** for almost every action, including reads.

```7:17:apps-script/utils/locks.js
function withScriptLock(fn, timeoutMs) {
  if (scriptLockDepth > 0) return fn();
  var timeout = timeoutMs || 10000;
  var lock = LockService.getScriptLock();
  // ...
  if (!acquired) throw appError('CONFLICT', 'The request could not get a lock in time.');
```

The SPA, at module load, starts **18 parallel hydrations** from `src/store/db.ts`:

identity, masters, parties, products, inventory, receiving, warehouse map, opening balance, halal, tasks, expenses, dispatch, sales import, sales returns, sales, purchases, manufacturing (`packing.list`), BOMs.

Each hydration `POST`s `/exec`. LockService allows **one** holder. Wait is **10 seconds**. Overflow returns `CONFLICT` “The request could not get a lock in time.”

The client then:

1. Leaves **prototype seed** in that slice (`PROD-20260908-001` / `PAY-1001` / seed expenses).
2. Toasts **“Could not save to the server”** even though the call was a **load** (`onError` in `db.ts` uses that title for every hydration).

Evidence: `docs/uat/evidence/step-13/ui-13-10-supplier-payments.png` (15 Nov 2026, ~2:43 PM MYT). Planning still showed seed sessions after 28s while `sessions.list` had only `PROD-20261109-001`.

This is **not** Sheets corruption. Sequential API UAT (one POST at a time) stayed at 234 / 53 / 0 diffs.

`packing.list` / `inventory.get` snapshots are large, so they hold the lock longer and are the first to starve.

### Affected files / modules

| Layer | Files |
| --- | --- |
| Lock | `apps-script/utils/locks.js`; every `locked()` in `*Service.js` |
| Parallel boot | `src/store/db.ts` (`start*Hydration`) |
| Per-module clients | `src/store/*Sync.ts` |
| Symptom UX | toast via `db.ts` `onError`; Planning, Payments, History, session detail |

### Proposed minimal fix (needs owner approval) — **Fix A, frontend only**

Do **not** deploy Apps Script for this.

1. Add a single in-browser hydrate **queue** (concurrency 1, or 1–2). Run the existing list/get actions in a stable order (identity → masters → products → inventory → manufacturing → sales → the rest).
2. Retry `CONFLICT` / lock-timeout **2–3 times** with backoff on hydrate only.
3. Change load failures to toast **“Could not load from the server”**, not “Could not save”.
4. Optional later: a hydrate-complete flag so list pages can show “Loading live data…” instead of seed.

**Not proposed now:** a new bootstrap API, skipping locks on all reads, or raising LockService timeout globally. Those need an Apps Script deploy and change the write-safety model.

### Regression risks

- Hydrate takes longer wall-clock (serial vs parallel) but should **complete** instead of failing.
- Writes must stay off this queue or share it so a user click cannot race a hydrate (existing per-module `pending` queues already serialize writes **inside** one module).
- Do not call `products.bootstrap` / other bootstrap paths as a “fix”.

### Automated tests

- Unit: fake lock that only allows one holder; 18 concurrent hydrations with the queue all succeed; without the queue N-1 fail after 10s (can mock `postIdentityAction`).
- Existing `npm run test:backend` unchanged.
- Playwright against Pages: Planning shows `PROD-20261109-001` and **not** `PROD-20260910-001` after hydrate; no lock toast.

### Public DEV verification (after Pages deploy of Fix A)

1. Cold-load https://zall266.github.io/CSP_Inventory-Sales-System/ as Admin/Aina.
2. No stacked lock toasts.
3. Production Planning lists live `PROD-20261109-001` (9 Nov 2026), not seed 8/10 Sept sessions.
4. Session detail `/manufacturing/history/ps_p2lblrm1i` is not “Not found.”
5. Payments → **Supplier payments** shows `PAY-000001` / `PAY-000002`.
6. `inventory.get` still 234 / 53 / 0 diffs. No new StockMovements.

---

## 2. Issue B — Cashier dashboard local KPIs while `dashboard.get` is FORBIDDEN

### Root cause

Two independent gaps:

1. **API is correct.** Live cashier `u-siti` `dashboard.get` → `FORBIDDEN` “You cannot view the dashboard.” Seed cashier matrix in `defaultPermissionsForLegacy('cashier')` also **omits** `dashboard.view`.

2. **UI ignores both.** `DashboardPage` never checks `dashboard.view`. Sidebar Home → Dashboard is always visible (`navItemVisible` has no dashboard rule).

3. **Overlay falls back to seed math.** `useReportingQuery` only `setData` when `result.ok`. On FORBIDDEN it returns `null`. The page does:

```ts
const overlay = useReportingQuery<DashboardOverlay>('dashboard.get', ...)
const totalSales = overlay?.totalSales ?? round2(sales.reduce(...))
```

Seed sales (24 invoices, RM 42,516) paint as if they were live. The same `?? local` pattern is on Sales/Purchase/Profit/Inventory/Manufacturing reports.

Catch comment in `reportingSync.ts`: “Keep the local page math when the read API is unavailable.” That is appropriate for **offline prototype**, not for a connected cashier who was denied.

### Affected files / modules

- `src/store/reportingSync.ts`
- `src/features/dashboard/DashboardPage.tsx`
- `src/features/reports/ReportsPages.tsx`
- `src/features/manufacturing/ManufacturingReportsPages.tsx`
- `src/components/layout/Sidebar.tsx`
- Live RolePermissions (cashier has no `dashboard.view`)

### Proposed minimal fix — **Fix B, frontend only**

Same pattern PR #113 already uses for expenses:

1. If `!hasPermission(state, 'dashboard.view')`, render `PermissionDenied` and hide Dashboard in the sidebar. Do not call `dashboard.get`.
2. If `!hasPermission(state, 'reports.view')`, deny report routes the same way.
3. `useReportingQuery`: on `FORBIDDEN`, do **not** leave overlay null for KPI fallback; surface denied. Keep local math only when `/exec` is unset (true prototype).

Do not grant cashier `dashboard.view` in Sheets to “fix” the screenshot.

### Regression risks

- Cashier (and any role without the key) loses the prototype KPI screen. That is the intended live rule.
- Owner/admin dashboard unchanged if `dashboard.view` is true.
- Offline `VITE_CSP_API_URL` empty still uses seed math.

### Automated tests

- Frontend assertion (same style as `ops.test.js` expenses): DashboardPage / Sidebar source includes `dashboard.view`.
- Existing reporting tests: cashier `dashboard.get` FORBIDDEN.
- Playwright: switch to Siti → `/` shows permission denied, not RM 42,516.

### Public DEV verification

1. Best after #113 Pages deploy (bundle change is independent but avoid mixed evidence).
2. Siti: dashboard denied; reports denied if `reports.view` is false.
3. Aina: dashboard KPIs match `dashboard.get` for the **selected** range (still prototype `today=2026-09-10` until Fix C labeling).
4. Inventory 234 / 53 unchanged.

---

## 3. Issue C — Header 10 Sept 2026 vs Today's Production 15 Nov 2026

### Root cause

**Two clocks by design.** This is not a hydrate bug.

| Clock | Function | Used by |
| --- | --- | --- |
| Prototype report date | `PROTOTYPE_TODAY` = `2026-09-10T12:00:00+08:00` | Header calendar chip; `reportingRangePayload` `today`; many finance/report filters |
| Live Malaysia operating date | `liveSystemDateKey()` | Daily Sessions create default, Today's Production, Accept/Start today-only rule |

Header:

```286:289:src/components/layout/Header.tsx
      <div className="hidden items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 lg:flex">
        <CalendarDays size={15} className="text-slate-400" />
        {formatDate(PROTOTYPE_TODAY.toISOString())}
```

Today's Production uses `systemProductionDate()` → `liveSystemDateKey()`. On 15 Nov 2026 it correctly showed “No daily session for 15 Nov 2026.”

PR #113 already documented this as K1 and **did not** change it.

Owner instruction: **do not change `PROTOTYPE_TODAY` globally.** Switching reports to the live date would change Step 18 numbers and is a separate product decision.

### Affected files / modules

- `src/utils/format.ts` (`PROTOTYPE_TODAY`)
- `src/utils/calendarDate.ts` (`liveSystemDateKey`)
- `src/components/layout/Header.tsx`
- `src/store/reportingSync.ts` (`today: systemDateKey(PROTOTYPE_TODAY)`)
- `src/features/manufacturing/sessionPlan.ts`

### Proposed minimal fix — **Fix C, display only**

Do **not** change the `PROTOTYPE_TODAY` constant or report `today` payload until the owner explicitly wants reports on the live calendar.

1. Label the existing chip **Report date · 10 Sept 2026** (or “Prototype date”).
2. Add a second chip **Today · {live Malaysia date}** from `liveSystemDateKey()` / `formatCalendarDate`.
3. Keep Preview mode badge.

That removes the false impression that Daily Sessions is stuck on 10 Sept, without moving dashboard math.

### Regression risks

- None for stock, sessions, or report totals if payloads stay on `PROTOTYPE_TODAY`.
- If the owner later asks reports to use live today, that is a **separate** change to `reportingRangePayload` only.

### Automated tests

- `calendarDate.test.ts` already distinguishes live vs prototype.
- Add a small Header/source assertion: header still formats `PROTOTYPE_TODAY` **and** includes `liveSystemDateKey`.

### Public DEV verification

- Header shows both dates. Today's Production still uses live Malaysia today. Reports still keyed to 10 Sept until a later owner decision. Accept on `PROD-20261109-001` still “Not today's production.”

---

## 4. Implementation order (after owner approval)

| Step | Change | Deploy | Business data |
| --- | --- | --- | --- |
| 0 | Owner merges **PR #113** | Pages yes; Apps Script already v30 | none |
| 1 | **Fix A** hydrate queue + lock retry + load toast | Pages only | none |
| 2 | **Fix B** dashboard/reports permission UI | Pages only | none |
| 3 | **Fix C** header dual-date labels | Pages only | none |

Do **not** implement 1–3 until the owner approves. Prefer one frontend PR for A+B+C after #113 is on Pages, so UAT uses a single bundle.

Apps Script deploy is **not** required for A–C.

---

## 5. Explicitly out of scope until asked

- Controlled write UAT (§8 of `docs/OWNER_UAT_AUTOMATION_REPORT_V1.md`)
- Accept/start/edit `PROD-20261109-001`
- Changing `PROTOTYPE_TODAY`
- New `/exec` URL, spreadsheet, or architecture
- Skipping script locks on writes
- Marking Steps 12–18 accepted or locked

---

## 6. Owner decisions requested

Reply with yes/no:

1. Merge **PR #113** now (expenses UI + Pages redeploy)?
2. Approve **Fix A** (serial hydrate / lock retry) so live lists match Sheets?
3. Approve **Fix B** (cashier dashboard/reports PermissionDenied, no local KPI fallback when `/exec` is connected)?
4. Approve **Fix C** (header labels: report date vs live today) **without** moving report `today` off 2026-09-10?
5. Keep PR #115 open as evidence only (recommended)?
