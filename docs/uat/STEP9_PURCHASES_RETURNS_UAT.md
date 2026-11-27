# Step 9 — Purchases & Returns — Master UAT & Closure Status

**Module:** Master Step 9 — Purchases and Returns  
**Integration commit (deployed DEV):** `adc704f2419171110e4e59d95837d74b62c33d22`  
**Apps Script DEV version:** 13  
**Public frontend:** https://zall266.github.io/CSP_Inventory-Sales-System/  
**Execution baseline:** `docs/CSP_EXECUTION_BASELINE_V1.md` §5 — implement → test → deploy → **User UAT through real UI and real Sheet** → lock on pass  

**Step 9 LOCKED:** **No**

---

## Evidence types used in this document

| Label | Meaning |
|-------|---------|
| **Agent UI** | Public DEV frontend screenshots collected by cloud UAT automation (`docs/uat/step9-*.png`, `step9-iso2-*.png`) |
| **Owner Sheet** | Google Sheets tabs verified by owner with **owner-provided Sheet screenshots** (Nov 2026); values recorded below — screenshots retained by owner unless copied into `docs/uat/` |
| **Automated tests** | `apps-script/tests/purchase.test.js` (DEV backend logic, not Sheet rows) |

---

## A. Original Step 9 acceptance (scenarios 1–5)

**Primary agent UI run:** Oct 2026 — purchases **PUR-000001**, **PUR-000002**; payment **PAY-000001**; return **PR-000002**; draft display **PUR-001016**.

Detailed scenario tables and screenshots were captured under `docs/uat/step9-test*.png` in an earlier workspace session; **not all files are present in the current checkout**. Agent UI evidence summary:

| Scenario | Agent UI | Owner Sheet |
|----------|----------|-------------|
| 1 Draft → Receive | **PASS** (UI); draft-at-save no-movement **NOT VERIFIED** historically | **NOT RUN** for PUR-000001/001016 |
| 2 Create + Receive | **PASS** (UI) | **NOT RUN** |
| 3 Supplier payment | **PASS** (UI); Finance → Payables path **NOT RUN** | **NOT RUN** for PAY-000001 |
| 4 Return + validation | **PASS** (UI) | **NOT RUN** for PR-000002 |
| 5 Modules 1–8 regression | **PASS (smoke)** — Business Settings + Permission Matrix completed later; warehouses CRUD **N/A** | **NOT RUN** |

### Historical data integrity note (owner Sheet, earlier review)

Owner reported **PurchaseLines** for **PUR-000001** and **PUR-000002** both showed **`returnedQty=1`**, while UAT expected **PUR-000002 `returnedQty=0`** after a rejected over-return. **Not reconciled** to a single root cause in Sheet. Isolation run **`S9-ISOLATION-20261105-1036`** (below) **supports correct per-line isolation** for new records; it **does not** re-open or close the historical row anomaly.

---

## B. Isolation regression — `S9-ISOLATION-20261105-1036`

**Full report:** [`STEP9_ISOLATION_REGRESSION_UAT.md`](STEP9_ISOLATION_REGRESSION_UAT.md)

| Record | Reference |
|--------|-----------|
| Purchase A | **PUR-000007** (internal id **`pur_yncdn03y`**) |
| Purchase B | **PUR-000008** (internal id **`pur_uqsej6…`** — suffix per owner Sheet) |
| Return | **PR-000005** |

### Owner Sheet verification — **PASS** (owner-provided screenshots)

| Check | Tab / field | Expected | Owner-verified | Status |
|-------|-------------|----------|----------------|--------|
| Line A qty / returned | **PurchaseLines** — `pur_yncdn03y` / PUR-000007 | qty **1**, returnedQty **1** | qty **1**, returnedQty **1** | **PASS (Owner Sheet)** |
| Line B qty / returned | **PurchaseLines** — `pur_uqsej6…` / PUR-000008 | qty **1**, returnedQty **0** | qty **1**, returnedQty **0** | **PASS (Owner Sheet)** |
| Return linkage | **PurchaseReturns** — PR-000005.`purchaseId` | **`pur_yncdn03y`** (PUR-000007) | **`pur_yncdn03y`** | **PASS (Owner Sheet)** |
| Audit | **AuditLogs** — `purchaseReturns.create` for PR-000005 | One success; entity **purchase_return**; user **u-admin** | Exactly **one** visible event | **PASS (Owner Sheet)** |
| Purchase headers | **Purchases** — PUR-000007, PUR-000008 | Received; total **RM 1** each; balance **RM 1** each | Matches | **PASS (Owner Sheet)** |

**Purchase-line isolation (A vs B):** **Proven** for this run by **Owner Sheet + Agent UI** (aligned).

### Agent UI verification — same run (**PASS** where captured)

| Check | Status | Agent UI evidence |
|-------|--------|-------------------|
| Qty 1 purchases | **PASS** | `step9-iso2-new-purchase-a-qty-verify.png`, `step9-iso2-new-purchase-b-qty-verify.png` |
| Before return Available 1 / 1 | **PASS** | `step9-iso2-before-a-returns.png`, `step9-iso2-before-b-returns.png` |
| Single return PR-000005 | **PASS** | `step9-iso2-stock-movements.png`, `step9-iso2-return-linkage.png` |
| After return A0 / B1 available | **PASS** | `step9-iso2-after-a-returns.png`, `step9-iso2-after-b-returns.png` |
| Over-return on B | **PARTIAL** | `step9-iso2-over-return-b.png` — qty 2 vs Available 1; **rejection toast not visible** in capture |

### Owner Sheet — supplementary tabs **NOT RUN** (Run 1036)

| Tab | Status |
|-----|--------|
| **PurchaseReturnLines** (PR-000005 line qty) | **NOT RUN** — not in owner verification list |
| **StockMovements** (row-level for PUR-000007/008, PR-000005) | **NOT RUN** — owner did not report Sheet rows |
| **InventoryBalances** | **NOT RUN** |

---

## C. Closure criteria vs `CSP_EXECUTION_BASELINE_V1.md` §5

| Criterion | Status | Notes |
|-----------|--------|-------|
| Backend implemented + tests | **PASS** | PR #95 @ `adc704f`; `purchase.test.js` |
| Deploy DEV + version verified | **PASS** | Apps Script **v13** |
| User UAT — **real UI** | **PASS (partial)** | Scenarios 1–4 + isolation Run 3; gaps: draft-time Test 1, Payables path, over-return toast capture |
| User UAT — **real Sheet** | **PARTIAL** | **PASS** for isolation **PUR-000007/008 / PR-000005** (owner); **NOT RUN** for original **PUR-000001/002 / PAY-000001 / PR-000002** |
| Purchase-line isolation defect | **Mitigated** | Run 1036 Sheet+UI; historical **000001/000002** anomaly **open** |
| Module lock (owner sign-off) | **NOT RUN** | Baseline §5 step 6 not recorded |
| Step 9 LOCKED | **No** | See below |

---

## D. Remaining NOT RUN / BLOCKED / incomplete

| Item | Status |
|------|--------|
| Sheet reconciliation — original UAT **PUR-000001**, **PUR-000002**, **PAY-000001**, **PR-000002** | **NOT RUN** |
| Historical **both returnedQty=1** on 000001/000002 | **Incomplete** — unexplained |
| Test 1 draft-at-instant no stock movement | **NOT VERIFIED** (historical) |
| Finance → Payables payment path | **NOT RUN** |
| UI idempotency replay (receive/pay/return) | **NOT VERIFIED** |
| Isolation Run 3 — over-return **toast** on Sheet/UI capture | **PARTIAL** |
| **PurchaseReturnLines**, **StockMovements**, **InventoryBalances** Sheet rows for Run 1036 | **NOT RUN** (owner) |
| Formal owner **Module 9 lock** approval | **NOT RUN** |
| Copy owner Sheet screenshots into repo `docs/uat/` | **Optional** — not required for PASS if owner retains originals |

---

## E. Closure decision

| Question | Answer |
|----------|--------|
| Is purchase-line **returnedQty** isolation proven for a clean qty-1 scenario? | **Yes** — **Owner Sheet + Agent UI** for **`S9-ISOLATION-20261105-1036`** |
| Is **full Step 9** ready for **LOCKED** per execution baseline? | **No** — original acceptance refs lack Sheet proof; historical **PUR-000001/000002** anomaly unresolved; several NOT RUN items above |
| **Step 9 LOCKED** | **No** |

---

## F. Next single action

**Owner:** Reconcile **Google Sheets** for the **original Step 9 UAT records** (**PUR-000001**, **PUR-000002**, **PAY-000001**, **PR-000002**) on tabs **Purchases**, **PurchaseLines**, **Payments**, **PurchaseReturns**, **StockMovements**, and **AuditLogs**, and either **explain or correct** the dual-`returnedQty=1` finding — **or** formally accept Run 1036 isolation evidence as sufficient to **waive** historical rows for lock (written owner decision).

---

## Related report paths

| Document | Path |
|----------|------|
| Master closure (this file) | `docs/uat/STEP9_PURCHASES_RETURNS_UAT.md` |
| Isolation runs (0011, 0936, 1036) | `docs/uat/STEP9_ISOLATION_REGRESSION_UAT.md` |
| Isolation Run 3 detail (agent-generated) | `docs/uat/STEP9_ISOLATION_UAT_REPORT_S9-ISOLATION-20261105-1036.md` |

**Do not commit or push** unless the owner chooses to add these files and owner Sheet screenshots to the repository.
