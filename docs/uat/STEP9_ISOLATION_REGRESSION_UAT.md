# Step 9 — Isolation Regression UAT

**Test run ID:** `S9-ISOLATION-20261105-0011`  
**Executed (Asia/Kuala_Lumpur):** 5 Nov 2026  
**Environment:** Public DEV — https://zall266.github.io/CSP_Inventory-Sales-System/  
**Backend:** Existing deployed Apps Script (unchanged); no deploy/code changes during this run.

## Purpose

Verify that a purchase return on **Purchase A** does not increase `returnedQty` / reduce available return quantity on **Purchase B** when both purchases contain the same product (Chocolate Powder) and warehouse (Main Warehouse).

---

## Records created (this run only)

| Role | Reference | Notes |
|------|-----------|--------|
| Purchase A | **PUR-000003** | Received; 1 line Chocolate Powder **qty 10** @ RM 1.00; Supplier A |
| Purchase B | **PUR-000004** | Received; same product/warehouse/qty; Supplier A |
| Return 1 | **PR-000003** | Stock out 1; movement dated 05 Nov 2026 |
| Return 2 | **PR-000004** | Stock out 1; reason note includes test run ID; movement dated 05 Nov 2026 |

Historical records (**PUR-000001**, **PUR-000002**, **PR-000002**, etc.) were **not** edited; they remain visible in the shared DEV ledger.

---

## Protocol deviations (automation execution)

These violate the **written scenario** but are documented honestly; they limit what this run can prove.

| Requirement | Planned | Actual |
|-------------|---------|--------|
| Line qty per purchase | **1** | **10** |
| Supplier | UAT Supplier Module 4 (preferred) | **Supplier A** |
| Successful returns on A | **Exactly one** qty **1** | **Two** successful returns (**PR-000003**, **PR-000004**) — duplicate submit; total returned **2** on A |
| Over-return on B | Safe test with **available 1** after A returns qty 1 | Tested **qty 11** vs **available 10** on B (`Defective goods` reason) |
| PurchaseLines / AuditLogs in Sheet | Capture columns | **Not available** — see reconciliation |
| Before-return `returnedQty` for both | Explicit capture on both lines | **Partial** — A only on Purchase Returns form before first return; **no** Purchase Returns screenshot for B before return |

**No product defect was observed for isolation or over-return validation.** The run **failed the scripted protocol**, not necessarily the application.

---

## Scenario results

| # | Step | Status | Evidence |
|---|------|--------|----------|
| 1 | Create Purchase A | **PASS** | `step9-iso-before-return-purchase-a-drawer.png`, `step9-iso-run-id-purchases.png` |
| 2 | Receive Purchase A | **PASS** | PUR-000003 status **Received** on list |
| 3 | Create Purchase B | **PASS** | `step9-iso-before-return-purchase-b-drawer.png` |
| 4 | Receive Purchase B | **PASS** | PUR-000004 **Received** on `step9-iso-run-id-purchases.png` |
| 5 | Both received, distinct refs | **PASS** | `step9-iso-run-id-purchases.png` — PUR-000003, PUR-000004 |
| 6 | Before return: A `returnedQty=0`, B `returnedQty=0` | **PARTIAL** | A: `step9-iso-return-form-purchase-a.png` — **Original 10 · Available 10** (implies 0 returned). B: drawer only (`step9-iso-before-return-purchase-b-drawer.png`) — **no** returnedQty column in drawer |
| 7 | Exactly **one** successful return qty **1** on A | **FAIL** | Two successes: `step9-iso-return-success.png` (toast **PR-000004**); ledger **PR-000003** + **PR-000004** in `step9-iso-stock-movements.png` |
| 8 | After return: A=1, B=0 returned; A avail 0, B avail 1 | **FAIL** (protocol qty) / **PARTIAL** (isolation) | A: `step9-iso-return-success.png` — **Available 8** (returned **2**). B: `step9-iso-over-return-purchase-b.png` — **Original 10 · Available 10** ⇒ **returnedQty 0** on B |
| 9 | Over-return on B rejected, no change | **PASS** | `step9-iso-over-return-purchase-b.png` — **Return qty too high**; B still **Available 10** |
| 10 | Stock ledger: one PUR each; one PR on A only | **FAIL** | `step9-iso-stock-movements.png` — **two** PR rows (**PR-000003**, **PR-000004**), both Chocolate Powder stock out **1**; **no** PR reference for PUR-000004 |
| 11 | Return document links to A not B | **PASS** (UI) | `step9-iso-purchase-returns-ui.png` — **PR-000004** detail note: `S9-ISOLATION-20261105-0011 return Purchase A`; form always on **PUR-000003** in return captures |
| 12 | Audit: success only for real ops; reject has no success audit | **NOT RUN** | No AuditLogs UI in app; Sheet **BLOCKED** |

---

## Before / after `returnedQty` (UI proxy)

Purchase drawer **does not** show `returnedQty`. **Purchase Returns** form shows **Original** and **Available** (`Available = qty - returnedQty`).

| Purchase | Before return (UI) | After return(s) (UI) |
|----------|--------------------|----------------------|
| **A — PUR-000003** | Original **10**, Available **10** (`step9-iso-return-form-purchase-a.png`) | Original **10**, Available **8** (`step9-iso-return-success.png`) ⇒ **returnedQty = 2** |
| **B — PUR-000004** | Not captured on Returns form | Original **10**, Available **10** (`step9-iso-over-return-purchase-b.png`) ⇒ **returnedQty = 0** |

**Comparison to scenario (qty 1 purchases, one return):** **Not executed.**  
**Isolation question (B unchanged when returning on A):** **Supported** — B **Available 10** after two returns processed on A.

---

## Stock movement reconciliation (UI — Stock Movements)

Source: `step9-iso-stock-movements.png`, `step9-iso-purchase-returns-ui.png`

| Reference | Type | Stock in | Stock out | Tied to isolation run |
|-----------|------|----------|-----------|------------------------|
| PUR-000003 | Purchase | 10 | — | Yes |
| PUR-000004 | Purchase | 10 | — | Yes |
| PR-000003 | Purchase Return | — | 1 | Yes (Purchase A) |
| PR-000004 | Purchase Return | — | 1 | Yes (Purchase A) |
| PUR-000004 | — | — | — | **No** purchase-return row |

Older movements (PUR-000001/002, PR-000002, etc.) remain in the same ledger; not part of this run.

**Sheet reconciliation:** **BLOCKED** — no authorized Google Sheets access on automation VM (`~/.clasprc.json` absent; export not public). UI screenshots **do not** prove PurchaseLines / PurchaseReturns tab columns in the workbook.

---

## Audit evidence

| Source | Status |
|--------|--------|
| AuditLogs sheet | **BLOCKED** |
| In-app audit viewer | **NOT AVAILABLE** |

Rejected over-return on B: UI toast only — **no** success toast, **no** new PR number in capture (`step9-iso-over-return-purchase-b.png`).

---

## Screenshot index

| File | Proves |
|------|--------|
| `step9-iso-run-id-purchases.png` | New **PUR-000003** / **PUR-000004** received; historical PUR-000001/002 untouched |
| `step9-iso-before-return-purchase-a-drawer.png` | Purchase A line qty 10 before return |
| `step9-iso-before-return-purchase-b-drawer.png` | Purchase B line qty 10 before return |
| `step9-iso-return-form-purchase-a.png` | Test run ID in reason; A **Available 10** before first return |
| `step9-iso-return-success.png` | Success toast **PR-000004**; A **Available 8** after duplicate returns |
| `step9-iso-after-return-purchase-a-drawer.png` | Drawer unchanged (no returnedQty display) |
| `step9-iso-after-return-purchase-b-drawer.png` | B drawer unchanged after returns on A |
| `step9-iso-over-return-purchase-b.png` | B **Available 10**; over-return **11** rejected |
| `step9-iso-stock-movements.png` | PUR-000003/004 + PR-000003/004 movements |
| `step9-iso-purchase-returns-ui.png` | **PR-000004** linked to Purchase A via movement note |

All paths: `docs/uat/` (local; not committed per run rules unless owner chooses).

---

## Discrepancies and limitations

1. **Double return on A** invalidates steps 7–8 as written; leaves extra DEV rows **PR-000003**, **PR-000004** (read-only impact on shared DEV; no rollback performed per rules).
2. **Qty 10** instead of **1** — isolation logic still applies but does not match the historical **returnedQty=1 / returnedQty=1** investigation geometry.
3. **No Sheet-level** proof of PurchaseLines `returnedQty` columns for PUR-000003/004 — owner Sheet check still recommended for formal closure of the historical anomaly.
4. Purchase **drawer** cannot satisfy “PurchaseLines screenshot” requirement; Returns form used as UI proxy.

---

## Does this prove purchase-line isolation?

| Question | Answer |
|----------|--------|
| On this run, did returns on **PUR-000003** change **available/returned** on **PUR-000004**? | **No** — UI shows B **Available 10** after returns on A (**UI evidence only**). |
| Does this fully explain the historical **PUR-000001 / PUR-000002** both-`returnedQty=1` Sheet finding? | **No** — different records; historical issue remains ** unresolved** without Sheet triage on old refs. |
| Is the scripted isolation UAT run **clean** enough to pass as-written? | **No** — **FAIL** on steps 7, 8, 10 (double return, wrong qty). |

---

## Overall verdict

| Verdict | Result |
|---------|--------|
| **Scripted test run (as specified)** | **FAIL** |
| **Isolation hypothesis (A return does not mutate B line)** | **PASS** on available UI evidence |
| **Google Sheets reconciliation** | **BLOCKED** |
| **Step 9 LOCKED** | **Not set** — owner decision |

**Step 10:** not started.

---

## Recommended next actions (owner; no data changes implied here)

1. In Sheet, confirm **PurchaseLines** for **PUR-000003** / **PUR-000004**: `returnedQty` **2** and **0** respectively (expected from UI proxy).  
2. Confirm **PurchaseReturns** rows **PR-000003** / **PR-000004** both reference Purchase A internal `purchaseId`.  
3. Optional: re-run isolation with **qty 1**, **single** return submit, and Sheet capture when read-only access is available.

---

## Run 2 — `S9-ISOLATION-20261105-0936` (stopped — qty not 1)

**Verdict:** **FAIL** (protocol) — purchases **PUR-000005**, **PUR-000006** saved with **qty 10**; return phase **NOT RUN**.

**Root cause (investigation):** Not a proven application defect. Default New Purchase **qty = 10**; automation did not persist **qty = 1** before submit. Screenshot `step9-iso3-FAIL-purchase-a-qty-mismatch.png` shows **qty field still 10** (Grand total RM 10.00 = 10 × RM 1.00), contradicting an erroneous “qty displays 1” automation report.

**Evidence:** `step9-iso2-run-purchases.png`, `step9-iso2-FAIL-pur-a-qty10.png`, `step9-iso2-FAIL-pur-b-qty10.png`, `step9-iso2-FAIL-pur-a-drawer-qty10.png`, `step9-iso2-FAIL-report.md`.

---

## Run 3 — `S9-ISOLATION-20261105-1036` (isolation scenario — primary)

**Verdict (scripted isolation scenario):** **PASS (Agent UI + Owner Sheet)**  
**Step 9 LOCKED:** **No** (see [`STEP9_PURCHASES_RETURNS_UAT.md`](STEP9_PURCHASES_RETURNS_UAT.md))

### Records (this run)

| Role | Reference | Details (UI) |
|------|-----------|----------------|
| Purchase A | **PUR-000007** | UAT Supplier Module 4, Main Warehouse, Chocolate Powder **qty 1**, RM 1.00, Received |
| Purchase B | **PUR-000008** | Same, **qty 1**, Received |
| Return | **PR-000005** | Qty **1** against **PUR-000007**; reason contains run ID |

### Scenario checklist

| # | Step | Status | Evidence |
|---|------|--------|----------|
| 1–2 | Purchase A qty **1**, received | **PASS** | `step9-iso2-new-purchase-a-qty-verify.png` (qty **1**, Grand total **RM 1.00**); movements **PUR-000007** stock in **1** |
| 3–4 | Purchase B qty **1**, received | **PASS** | `step9-iso2-new-purchase-b-qty-verify.png`; **PUR-000008** stock in **1** |
| 5 | Both received, distinct refs | **PASS** | `step9-iso2-run-purchases.png` |
| 6 | Before return: A & B returnedQty **0** (UI proxy) | **PASS** | `step9-iso2-before-a-returns.png` — **Original 1 · Available 1**; `step9-iso2-before-b-returns.png` — **Original 1 · Available 1** |
| 7 | Exactly **one** successful return on A | **PASS** | Single new return **PR-000005** in `step9-iso2-stock-movements.png`; `step9-iso2-return-form-purchase-a.png` |
| 8 | After: A returned **1**, B **0**; A avail **0**, B avail **1** | **PASS (Agent UI + Owner Sheet)** | UI: `step9-iso2-after-a-returns.png`, `step9-iso2-after-b-returns.png`; Sheet: PurchaseLines returnedQty **1** / **0** |
| 9 | Over-return on B rejected | **PARTIAL** | Agent UI: `step9-iso2-over-return-b.png` (toast not visible); no extra PR in UI ledger |
| 10 | Ledger: one PUR each; one PR on A only | **PASS (Agent UI)** | `step9-iso2-stock-movements.png` |
| 11 | Return links to A not B | **PASS (Agent UI + Owner Sheet)** | UI: `step9-iso2-return-linkage.png`; Sheet: **PR-000005**.purchaseId = **`pur_yncdn03y`** |
| 12 | AuditLogs | **PASS (Owner Sheet)** | One `purchaseReturns.create` for **PR-000005**, entity **purchase_return**, user **u-admin** |
| — | Purchases headers (Run 3) | **PASS (Owner Sheet)** | PUR-000007/008 Received, RM **1** total, RM **1** balance each |

### Before / after `returnedQty` (UI proxy — Purchase Returns form)

| Purchase | Before | After |
|----------|--------|-------|
| **A — PUR-000007** | Original **1**, Available **1** | Original **1**, Available **0** ⇒ **returnedQty = 1** |
| **B — PUR-000008** | Original **1**, Available **1** | Original **1**, Available **1** ⇒ **returnedQty = 0** |

### Stock movements (UI — Run 3 rows only)

| Reference | Type | Stock in | Stock out | Balance (UI column) |
|-----------|------|----------|-----------|---------------------|
| PUR-000007 | Purchase | 1 | — | 39 |
| PUR-000008 | Purchase | 1 | — | 40 |
| PR-000005 | Purchase Return | — | 1 | 39 |

Source: `step9-iso2-stock-movements.png`, `step9-iso2-return-linkage.png`.

### Owner Sheet verification (Run 3)

**Evidence type:** Owner-provided **Google Sheets screenshots** (5 Nov 2026). Values below confirmed by owner; screenshots retained by owner unless copied into `docs/uat/`.

| Tab | Check | Owner-verified | Status |
|-----|-------|----------------|--------|
| **PurchaseLines** | **`pur_yncdn03y`** (PUR-000007) | qty **1**, **returnedQty 1** | **PASS (Owner Sheet)** |
| **PurchaseLines** | **`pur_uqsej6…`** (PUR-000008) | qty **1**, **returnedQty 0** | **PASS (Owner Sheet)** |
| **PurchaseReturns** | **PR-000005**.purchaseId | **`pur_yncdn03y`** | **PASS (Owner Sheet)** |
| **AuditLogs** | **PR-000005** / `purchaseReturns.create` | Exactly **one** event; **purchase_return**; **u-admin** | **PASS (Owner Sheet)** |
| **Purchases** | **PUR-000007**, **PUR-000008** | Received; total **RM 1**; balance **RM 1** each | **PASS (Owner Sheet)** |
| **PurchaseReturnLines** | PR-000005 lines | — | **NOT RUN** |
| **StockMovements** / **InventoryBalances** | Run 3 refs | — | **NOT RUN** (owner) |

### Agent UI gaps (Run 3)

- **`step9-iso2-return-success.png`:** Available **0** on A; success toast not clearly visible (**PR-000005** confirmed via ledger + Owner Sheet).
- **Over-return on B:** attempt only; rejection toast not visible in Agent UI capture.

### Does Run 3 prove purchase-line isolation?

**Yes — Agent UI and Owner Sheet (PurchaseLines):** **PUR-000007** `returnedQty=1`, **PUR-000008** `returnedQty=0` after one return on A. **Does not** resolve historical **PUR-000001/000002** anomaly or satisfy full Step 9 lock alone.

### Run 3 screenshot index

| File | Proves |
|------|--------|
| `step9-iso2-new-purchase-a-qty-verify.png` | Qty **1**, total **RM 1.00** before receive A |
| `step9-iso2-new-purchase-b-qty-verify.png` | Qty **1** before receive B |
| `step9-iso2-run-purchases.png` | **PUR-000007**, **PUR-000008** received |
| `step9-iso2-before-a-returns.png` / `step9-iso2-before-b-returns.png` | Both **Available 1** before return |
| `step9-iso2-return-form-purchase-a.png` | Return on A, run ID in reason |
| `step9-iso2-return-success.png` | A **Available 0** after return |
| `step9-iso2-after-a-returns.png` / `step9-iso2-after-b-returns.png` | A **0** / B **1** available |
| `step9-iso2-over-return-b.png` | Over-return attempt on B |
| `step9-iso2-stock-movements.png` | PUR-000007/008 + single **PR-000005** |
| `step9-iso2-return-linkage.png` | **PR-000005** ↔ Purchase A note |

---

## Consolidated verdict (all runs)

| Run ID | Scripted scenario | Isolation (A vs B) | Notes |
|--------|-------------------|--------------------|-------|
| `S9-ISOLATION-20261105-0011` | **FAIL** | **PASS (UI)** | Qty 10; double return **PR-000003/004** |
| `S9-ISOLATION-20261105-0936` | **FAIL** | **NOT RUN** | **PUR-000005/006**, qty 10 |
| `S9-ISOLATION-20261105-1036` | **PASS** | **PASS (UI + Owner Sheet)** | **PUR-000007/008**, **PR-000005** |

**Step 9 LOCKED:** **No** — see master closure doc.

**Recommended next action:** Sheet reconciliation for **original** Step 9 refs **PUR-000001/002**, **PAY-000001**, **PR-000002** (or formal owner waiver) — [`STEP9_PURCHASES_RETURNS_UAT.md`](STEP9_PURCHASES_RETURNS_UAT.md).

---

## Investigation addendum — execution errors (`S9-ISOLATION-20261105-0011`)

**Date (Asia/Kuala_Lumpur):** 5 Nov 2026  
**Scope:** Read-only analysis of screenshots, this report, deployed DEV frontend behaviour (GitHub Pages / `cursor/dev-frontend-github-pages-d9ac`), backend `purchaseService.createReturn`, and `apps-script/tests/purchase.test.js`. No transactions, Sheet edits, or code changes.

### Q1 — Why were purchase quantities **10** instead of **1**?

**Root cause (proven — frontend default + execution):** The locked **New Purchase** form initialises the first line with **`qty: 10`**, not 1.

```84:86:src/features/purchases/PurchasesPage.tsx
  const [lines, setLines] = useState<DraftLine[]>([
    { productId: 'p-cp', qty: 10, price: 22, discount: 0, batchNo: '', expiry: '' },
  ])
```

(Same default on deployed integration branch: `cursor/dev-frontend-github-pages-d9ac`, `PurchasesPage.tsx` ~line 106.)

**UI evidence:** Drawers and list show **QTY 10**, **RM 10.00** total, **RM 1.00** unit cost (`step9-iso-before-return-purchase-a-drawer.png`, `step9-iso-run-id-purchases.png`) — consistent with **qty 10 × price 1**, not the scenario’s qty 1.

**Conclusion:** The automation/operator **did not change the default quantity to 1** before **Receive purchase**. This is **not** a backend posting defect. **Google Sheets:** not inspected.

---

### Q2 — Why were **two** successful returns created against Purchase A?

**Observed facts (UI):**

| Evidence | Finding |
|----------|---------|
| `step9-iso-return-form-purchase-a.png` | Before first return: **Available 10** on **PUR-000003** |
| `step9-iso-return-success.png` | After processing: **Available 8**; success toast **`PR-000004`** |
| `step9-iso-stock-movements.png` | Two return movements: **`PR-000003`** and **`PR-000004`**, each **stock out 1** |

**Math:** 10 − 2 = **8** available ⇒ **two** successful qty-1 returns on A.

**Backend behaviour (code):** Each successful `purchaseReturns.create` allocates a **new** `returnNo` (`nextDocNo`), posts stock, increments `returnedQty` on **one** purchase, and appends a **PurchaseReturns** row. There is **no** deduplication across separate requests unless the **same idempotency key** is replayed (not the case here — see Q3).

**Conclusion:** Two **separate successful return transactions** were persisted on DEV, both against Purchase A (`PUR-000003`).

---

### Q3 — UI double-submit, operator/automation twice, or other cause?

**Evidence hierarchy:**

| Source | Finding |
|--------|---------|
| **Automation run summary** (computerUse agent) | Explicit admission: **“Process return” clicked twice** → two documents (**PR-000003**, **PR-000004**). |
| **Frontend (DEV + API)** | `createPurchaseReturn` calls `queuePurchaseWrite(..., crypto.randomUUID())` — **each submit gets a new idempotency key**, so two completed submits ⇒ **two backend returns** (by design). |
| **In-flight guard** | `beginPurchasePost()` blocks a second click **only while** `purchasePostInFlight` is true; after `onSettled()` clears the flag, a **second click is allowed** and creates another return. |
| **Purchase Returns UI** | **No** button `disabled` state while posting; **no** debounce on **Process return** (`ReturnsPages.tsx`). |
| **Screenshots** | Do **not** show two toasts or two clicks; they **do** show outcome consistent with **two** successes (Available **8**, two PR refs in ledger). |

**Conclusion:** **Most likely cause:** **test operator/automation executed two successful submits** (double activation of **Process return**), not an automatic single-click duplicate. **Not proven:** exact timing (double-click during one post vs two submits after first completed). **Not indicated:** backend bug creating one user action from two PRs without two requests (each PR has its own number and movement row).

**Automated tests:** `purchase.test.js` covers **one** return and **rejected** over-return; **no** test for double-submit/double-click on purchase returns UI.

---

### Q4 — Are **PR-000003** and **PR-000004** both valid, separately recorded returns?

**UI evidence (Stock Movements):** **`PR-000003`** and **`PR-000004`** each appear as **Purchase Return** rows with **stock out 1** for Chocolate Powder / Main Warehouse (`step9-iso-stock-movements.png`).

**UI evidence (linkage):** **`PR-000004`** movement detail note includes `S9-ISOLATION-20261105-0011 return Purchase A` (`step9-iso-purchase-returns-ui.png`). **`PR-000003`** linkage to **PUR-000003** is implied by chronology and ledger pairing but **not** shown in a dedicated PurchaseReturns sheet row capture.

**Backend code:** Each call produces a distinct `returnNo`, `purchaseId`, movement reference, and return header.

**Conclusion:** **Yes — as UI ledger evidence, both are separate successful return transactions**, not idempotent replay of one request. **Sheet-level** confirmation of **PurchaseReturns.purchaseId** for **PR-000003** remains **BLOCKED**.

---

### Q5 — Does evidence genuinely prove Purchase B remained unchanged?

**What is shown:**

| Check | PUR-000004 (B) | Evidence |
|-------|----------------|----------|
| After returns on A, Returns form | **Original 10 · Available 10** ⇒ **returnedQty 0** | `step9-iso-over-return-purchase-b.png` |
| Purchase drawer | Qty **10**, no return-specific fields | `step9-iso-after-return-purchase-b-drawer.png` |
| Stock movements | **No** `PR-*` reference tied to **PUR-000004** | `step9-iso-stock-movements.png` |

**Gaps:**

- **No** Purchase Returns screenshot for **B before** the return phase (only purchase drawer).
- **No** Google **PurchaseLines.returnedQty** for **PUR-000004**.
- Drawer **does not** display `returnedQty`; **Available** on the Returns form is the UI proxy.

**Conclusion:** **Partially proven (public UI only):** at the time of `step9-iso-over-return-purchase-b.png`, **B’s available return quantity was unchanged** after two returns on A. **Not proven:** Sheet persistence, full timeline, or the **exact intended scenario** (qty 1 / one return).

---

### Q6 — What is proven by public UI vs automated tests vs Google Sheets?

| Claim | Public UI | Automated tests | Google Sheets |
|-------|-----------|-----------------|---------------|
| Default purchase line qty **10** on new purchase form | Implied by created POs (screenshots) + **source code default** | Not tested | **BLOCKED** |
| Two returns on A (**PR-000003**, **PR-000004**) | **Yes** — movements + Available 8 | Not tested (double submit) | **BLOCKED** |
| B line not reduced (Available 10) | **Yes** — one snapshot on Returns form | Not tested (multi-PO isolation) | **BLOCKED** |
| Over-return on B rejected | **Yes** — toast | **Yes** — `return qty too high is rejected` | **BLOCKED** |
| Single return qty 1 on qty 1 POs | **Not executed** | Partial (single return on one PO in fixture) | **BLOCKED** |
| `returnedQty` isolation across two POs in Sheet | **Not proven** | **Not covered** | **BLOCKED** |

---

### Root cause summary

| Issue | Root cause | Category |
|-------|------------|----------|
| Qty **10** not **1** | Locked UI **default line qty = 10**; executor did not set **1** before receive | **Test execution / scenario adherence** |
| Two returns on A | **Two successful submits** (automation admitted double **Process return**); each submit uses a **new idempotency key** → two valid backend returns | **Test execution**; **UX gap** (no disable/debounce on button) |
| Isolation appearance | Consistent with **correct per-purchase `returnedQty` updates** on A only (UI proxy) | **Observed behaviour** — **not** proof of intended 1/1 scenario |

**Not established:** application defect causing spurious second return without a second submit; historical **PUR-000001/000002** Sheet anomaly explained by this run.

---

### Limitations

- No Sheet read of **PurchaseLines**, **PurchaseReturns**, or **AuditLogs** for this run.
- Isolation UAT **scripted verdict remains FAIL**; this addendum **does not** upgrade the run to PASS or Step 9 LOCKED.
- Screenshot set does not document **B before return** on the Returns form.

---

### Recommended next action (single)

**Re-run isolation once** with explicit checklist: set line **qty = 1** on New Purchase (override default **10**), wait for **Already posting** / network idle after each post, **single** click on **Process return**, capture **Purchase Returns** for **both** A and B before and after, and reconcile **PurchaseLines.returnedQty** in Sheet if read-only access is available.
