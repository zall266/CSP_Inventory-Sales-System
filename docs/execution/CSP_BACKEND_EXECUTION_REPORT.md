# CSP Backend Execution Report

Closeout sprint for Steps 9, 10, and 11. Step 12 was not started.

Statuses used here: PASS / OWNER UAT REQUIRED / BLOCKED / IN PROGRESS. Untouched later modules stay NOT STARTED.

Integration branch: `cursor/dev-frontend-github-pages-d9ac` at `c7a88d33797511922b09a2b99632c8b41fb347db` (merge of PR #100).
Locked Apps Script: `1mkRzptY0mzHnzOFB8TA6AGIZyv6q2gJq-QdKPBWtV91oq5okHWVpY4Jj`.
DEV spreadsheet: `1TPmkASdzlGssGyAisklf4QkLcxWYbHHhUSxntgLha94`.
`/exec`: `AKfycbyMDLwOJ2iqD_nuLFcVMQYrS81WDkkaBhutTGBCrbUClM1Aap1MJiO6CnzzcYuTAoMbDw`.

## Deployed runtime (verified this closeout)

| Check | Evidence |
| --- | --- |
| Apps Script version | **v19**, `versionDescription=git:c7a88d33797511922b09a2b99632c8b41fb347db`. Deploy DEV run [42254596523](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/42254596523), published 7 Nov 2026, 12:41 AM MYT. No later Apps Script deploy. |
| Health | `GET /exec` at 8 Nov 2026, 9:46 PM MYT: DEV, healthy, spreadsheet and Drive accessible, foundation ready. |
| Public frontend | Pages deploy [42254560519](https://github.com/zall266/CSP_Inventory-Sales-System/actions/runs/42254560519) for the same SHA. Live `index.html` loads `assets/index-lYW-7utq.js`, which contains `receivings.linkPurchase`, `packing.confirm`, and `productionOrders.complete`. |
| Automated tests | Full backend suite on this SHA: **103 pass, 0 fail** (8 Nov 2026, 10:00 PM MYT). Includes purchase, receiving, and 7 manufacturing tests. Pages CI build step on this SHA succeeded. No application code changed in this closeout. |

Live checks below are API read-backs of the sheet repositories (Purchases, PurchaseLines, PurchaseReturns, Payments, Receivings, ReceivingLines, StockOrders, StockMovements, InventoryBalances, PackingAssemblies, ProductionOrders, Batches). They are not a screenshot of the Google Sheets UI. There is no `audit.list` action, so AuditLogs rows were not read back. Each successful write returns only after that service appends its audit row; a thrown audit write would have failed the call.

Actor: `u-aina` (owner). Cashier denials: `u-siti`. Supplier: `sup_38eymadw0`. All new products, notes, and invoice numbers are prefixed `CLOSEOUT-20261108`. Run window: 8 Nov 2026, 9:49 PM–10:02 PM MYT. Result: **63/63 live checks passed** (60 scenario checks plus 3 follow-ups).

Historical rows were read before and after the run and were identical. They were not edited.

| Record | Status after closeout |
| --- | --- |
| PUR-000009 | `received`, `receivingId=rcv_n6aryogtn` |
| RCV-000001 | `completed`, no purchase, date `2026-09-10T04:00:00.000Z` |
| RCV-000002 | `completed`, `purchaseId=pur_iu7dhvrfb`, date `2026-11-06T13:38:31.893Z` |

## Step 9 — Purchases and returns — OWNER UAT REQUIRED

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

Not PASS, and not LOCKED:

- Google Sheets UI was not opened. Owner should confirm the new rows above on Purchases, PurchaseLines, PurchaseReturns, PurchaseReturnLines, Payments, StockMovements, InventoryBalances, and AuditLogs.
- Historical `PUR-000001` / `PUR-000002` / `PAY-000001` / `PR-000002`, including the unexplained dual `returnedQty=1`, were not rewritten and were not re-proved. Waiving them is an owner decision.
- Formal module lock is not recorded.

## Step 10 — Receiving and to-order — OWNER UAT REQUIRED

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

Not PASS, and not LOCKED: owner still needs to see these new rows on Receivings, ReceivingLines, StockOrders, StockMovements, InventoryBalances, and AuditLogs. Do not edit RCV-000001, RCV-000002, or PUR-000009.

## Step 11 — Production orders and packing — OWNER UAT REQUIRED

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

Not PASS, and not LOCKED: owner should confirm `PA-0001`, `PO-0001`, batch `CO08-PO`, the AUTO/MANUAL balances, and the matching AuditLogs (`packing.confirm`, `productionOrders.complete`) in the workbook. Daily sessions were not exercised.

## Cross-module reconciliation

On the isolated products, the same unit was not posted twice:

- Purchase receive and purchase return moved only their own product lines.
- Linking `RCV-000003` to `PUR-000012` did not add a second receipt when the purchase was marked received.
- To-order mark/cancel did not move stock. Receiving that order moved it once.
- Usage deducted once.
- Packing and production completion deducted AUTO components once and left MANUAL components unchanged.
- Opening-balance list still reads. Historical purchase and receiving headers above were unchanged.

Document header, lines, StockMovements, and InventoryBalances agreed on every live check that returned those collections. Batches agreed for `PO-0001` (exactly one row). AuditLogs were not read back.

## Defects

No implementation defect was found in this closeout. No fix commit. No new deploy.

Known limits, not defects:

- Error responses for a rejected return do not include an inventory snapshot. The following successful return showed the rejected quantity was still available.
- New receiving dates are stored as UTC ISO (`toISOString()`), which is the server clock. A date-only usage value is stored as `T08:00:00.000+08:00`.
- `PUR-000001` / `PUR-000002` historical `returnedQty` anomaly remains unexplained. It was not modified.

## Owner actions

1. In the DEV workbook, filter notes, names, and invoice numbers containing `CLOSEOUT-20261108` and confirm the document numbers in the tables above. Do not edit RCV-000001, RCV-000002, or PUR-000009.
2. Confirm AuditLogs contains the successful actions for those new document numbers (`purchases.create`, `purchases.receive`, `purchases.recordPayment`, `purchaseReturns.create`, `receivings.create`, `receivings.linkPurchase`, `inventory.markOrdered`, `inventory.cancelOrder`, `inventory.usage`, `packing.confirm`, `productionOrders.complete`). Rejected calls must not have success audit rows.
3. Decide in writing whether the historical Step 9 rows (`PUR-000001`, `PUR-000002`, `PAY-000001`, `PR-000002`) are waived. Do not ask for those rows to be rewritten to force a pass.
4. After that review, say whether Steps 9, 10, and 11 may be marked PASS / LOCKED. Until then they stay **OWNER UAT REQUIRED**.

## Roadmap

| Module | Closeout status |
| --- | --- |
| 0–8 | PASS (previously verified; opening-balance list re-read this sprint) |
| 9 Purchases and returns | **OWNER UAT REQUIRED** — live API checklist passed; workbook sign-off and historical waiver open |
| 10 Receiving and to-order | **OWNER UAT REQUIRED** — R1–R6 passed on v19 with new documents; workbook sign-off open |
| 11 Production orders and packing | **OWNER UAT REQUIRED** — live API checklist passed on v19; workbook sign-off open |
| 12 Daily sessions | NOT STARTED — paused for this closeout |
| 13–18 | NOT STARTED |

PRs: Step 10 linkage [#99](https://github.com/zall266/CSP_Inventory-Sales-System/pull/99) merged `9e81fcd`. Step 11 [#100](https://github.com/zall266/CSP_Inventory-Sales-System/pull/100) merged `c7a88d3`. This closeout report is a docs-only follow-up; it does not deploy.
