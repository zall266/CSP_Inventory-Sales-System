# Step 10 — Receiving & To-Order — UAT Report

**Module:** Master Step 10  
**Audit:** [`STEP10_RECEIVING_TO_ORDER_AUDIT.md`](STEP10_RECEIVING_TO_ORDER_AUDIT.md)  
**Detailed run log:** [`STEP10_UAT_REPORT_S10-UAT-20261105.md`](STEP10_UAT_REPORT_S10-UAT-20261105.md)  
**UAT run ID:** `S10-UAT-20261105`  
**Public DEV:** https://zall266.github.io/CSP_Inventory-Sales-System/  
**Backend (unchanged this phase):** Apps Script **v14** — deployment ID `AKfycbyMDLwOJ2iqD_nuLFcVMQYrS81WDkkaBhutTGBCrbUClM1Aap1MJiO6CnzzcYuTAoMbDw`  
**Step 10 LOCKED:** **No**

---

## A. PR #96 merge

| Item | Value |
|------|--------|
| PR | [#96](https://github.com/zall266/CSP_Inventory-Sales-System/pull/96) — **MERGED** |
| Source | `cursor/module-10-receiving-to-order-d9ac` |
| Target | `cursor/dev-frontend-github-pages-d9ac` |
| Merge commit | **`53ab98adaee94c9ff22520c0bfaf086f12ff8484`** |
| Merged (UTC) | 2026-11-05T03:18:52Z |
| Pre-merge CI | Deploy DEV — **SUCCESS** (commit `bd2c211`) |
| Scope | Step 10 backend + `receivingSync` + tests; Step 9 UAT evidence preserved under `docs/uat/` (no Step 9 code changes) |

**Apps Script:** No redeploy in this phase — **v14** remains as deployed from commit `7f94d20`.

---

## B. GitHub Pages deployment

| Item | Value |
|------|--------|
| Workflow | **Deploy DEV frontend** (push to integration branch) |
| Run | [41960807166](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/41960807166) |
| Status | **PASS** |
| Trigger | Merge commit `53ab98a` |
| Public URL | https://zall266.github.io/CSP_Inventory-Sales-System/ — **loads** (SPA shell + `index-BBn6Q2m5.js`) |
| Step 10 bundle check | Production JS contains `receivings.list` / `receivings.create` strings |

---

## C. Public UI ↔ backend integration (Agent UI)

| Check | Result |
|-------|--------|
| `VITE_CSP_API_URL` → GAS `/exec` | **PASS** — POST + redirect; echo JSON `ok: true` on successful writes |
| `receivings.list` hydration | **PASS** (Receiving list populated after create) |
| `receivings.create` | **PASS** — **RCV-000001** |
| `inventory.markOrdered` / `inventory.cancelOrder` | **PASS** — Sugar order/cancel |
| `inventory.usage` | **PASS** — **USE-0001**, Chocolate Powder 39→38 KG on Inventory |
| Health (prior) | DEV backend healthy on v14 |

Evidence type: **Agent UI** + network observation (not Sheet rows).

---

## D. UAT scenarios

| ID | Scenario | Status | References / notes |
|----|----------|--------|-------------------|
| **R1** | Receive raw material without purchase | **PASS (Agent UI)** | **RCV-000001** — Sugar 1 KG, Shopee, note `S10-UAT-20261105 R1`. **Observation:** Inventory list for Sugar did not show increased qty immediately after receive (detail shows stock in 1). |
| **R2** | Link receiving → draft purchase | **NOT RUN** | Deferred this session |
| **R3** | To Order → Receive completes stock order | **NOT RUN** | Mark/cancel exercised in R4; full receive-from-order path not executed |
| **R4** | Mark as ordered / cancel | **PASS (Agent UI)** | Sugar — Shopee remark `S10-UAT-20261105 R4`; ordered then cancelled (Other) |
| **R5** | Stock usage | **PASS (Agent UI)** | **USE-0001** — Chocolate Powder −1 KG (39→38 verified on Inventory) |
| **R6** | Cashier cannot receive | **NOT RUN** | |
| **Dup** | Idempotency / double-submit UI | **NOT RUN** | |
| **Reg-8** | Opening Balance page load | **PASS (smoke)** | Screenshot only |
| **Reg-9** | Purchases page load | **PASS (smoke)** | Screenshot only |

---

## E. Screenshot evidence index

| File | Proves |
|------|--------|
| `step10-r1-form.png` | R1 form before submit |
| `step10-r1-success.png` | R1 **RCV-000001** detail |
| `step10-r1-list.png` | R1 receiving list row |
| `step10-r4-to-order-before.png` | R4 low-stock queue |
| `step10-r4-ordered.png` | R4 Sugar **Ordered** |
| `step10-r4-cancelled.png` | R4 after cancel |
| `step10-r5-usage-form.png` | R5 usage form |
| `step10-r5-success.png` | R5 after submit |
| `step10-r5-inventory-after.png` | R5 **38 KG** balance |
| `step10-regression-purchases.png` | Reg-9 |
| `step10-regression-opening-balance.png` | Reg-8 |

Also: `STEP10_TEST_ARTIFACTS.md`, `STEP10_UAT_REPORT_S10-UAT-20261105.md`.

---

## F. Google Sheets reconciliation

| Tab | Status |
|-----|--------|
| Receivings / ReceivingLines | **BLOCKED** (cloud agent — no authorized Sheet read) |
| StockOrders | **BLOCKED** |
| StockMovements | **BLOCKED** |
| InventoryBalances | **BLOCKED** |
| AuditLogs | **BLOCKED** |

### Owner phone checklist (DEV workbook)

Verify rows for UAT run **`S10-UAT-20261105`**:

1. **Receivings** — **RCV-000001**, completed, Main Warehouse, Shopee, note contains `S10-UAT-20261105 R1`  
2. **ReceivingLines** — Sugar line, qty/baseQty, condition **Baik**  
3. **StockMovements** — type **receiving**, ref **RCV-000001**; type **stock_usage**, ref **USE-0001**  
4. **StockOrders** — Sugar order row if persisted before cancel (status **cancelled** after R4)  
5. **AuditLogs** — `receivings.create`, `inventory.markOrdered`, `inventory.cancelOrder`, `inventory.usage` as applicable  

Screenshots alone do **not** substitute for Sheet proof.

---

## G. Regression

| Module | Status |
|--------|--------|
| Step 8 Opening Balance (smoke) | **PASS** |
| Step 9 Purchases (smoke) | **PASS** |
| Step 10 Receiving / To Order / Usage | See §D |

**Step 9 status:** **ACCEPTED TO PROCEED — WITH DEFERRED UAT ITEMS** (unchanged; not LOCKED).

---

## H. Defects / limitations

1. **R1 inventory list vs receiving detail** — possible UI refresh or Sugar warehouse filter; needs Sheet movement row to confirm balance (owner).  
2. **R2, R3, R6, idempotency UI** — not executed.  
3. **Sheet verification** — owner-required.

---

## I. Roadmap status

| Step | Status |
|------|--------|
| **Step 9** | Accepted to proceed; deferred UAT items open |
| **Step 10** | **Implementation merged + Pages live + partial public UAT PASS** — **not LOCKED** (Sheet + remaining scenarios) |

---

## J. Next owner action

**Reconcile DEV Google Sheets** for **RCV-000001**, **USE-0001**, and Sugar **StockOrders** / movements per §F, and confirm whether Sugar balance after R1 matches **ReceivingLines** (or report discrepancy).
