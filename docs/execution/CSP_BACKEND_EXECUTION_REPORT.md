# CSP Backend Execution Report

Steps 9, 10, and 11 are **PASS / LOCKED** by owner authorization dated 9 Nov 2026. Step 12 Daily Sessions is **OWNER UAT REQUIRED**. Do not mark Step 12 PASS or LOCKED.

Statuses used here: PASS / PASS / LOCKED / OWNER UAT REQUIRED / BLOCKED / IN PROGRESS. Untouched later modules stay NOT STARTED.

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
| 12 Daily sessions | IN PROGRESS |
| 13–18 | NOT STARTED |

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

Filled after merge and Deploy DEV. The UAT row must remain `planned`, date serial/calendar 9 Nov 2026, quantities 45/45, notes unchanged, no duplicate `PROD-20261109-001`, no production stock movements.

