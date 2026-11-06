# Step 10 — Receiving & To-Order — Implementation Audit

**Date:** 5 Nov 2026 (Asia/Kuala_Lumpur)  
**Integration branch:** `cursor/dev-frontend-github-pages-d9ac`  
**Authoritative architecture:** `docs/CSP_MASTER_BACKEND_ARCHITECTURE_V1.md` (§ Receiving, StockOrder, Step 10 row), `docs/CSP_EXECUTION_BASELINE_V1.md` §5  
**Step 9 dependency:** Accepted to proceed with deferred UAT; purchase `receivingId` skip-stock guard preserved in `apps-script/services/purchaseService.js` (`resolveReceiving`, `receive`, `create`).

---

## 1. Step 10 objectives (from architecture + locked frontend)

| Objective | Source |
|-----------|--------|
| Record raw-material **receiving** (with or without purchase), post stock once as type `receiving` | Architecture §20; `ReceivingPages.tsx` |
| **Link** completed receiving to **draft** purchase without second stock post | `linkReceivingToPurchase` in `src/store/db.ts`; backend `receivings.linkPurchase` |
| **To-order** queue: mark low-stock items **ordered**, cancel, complete via receiving | `ToOrderPages.tsx`, `toOrderModel.ts` |
| **Stock usage**, **transfer**, **count** (Module 5) — already on backend | `inventoryService.js`; no new frontend |

**Out of scope (explicit):** New routes, SPA redesign, second database, production deploy, Step 11+, duplicate purchase stock when `receivingId` set.

---

## 2. Frontend (existing — not modified for behavior)

| Area | Path | Notes |
|------|------|--------|
| Receiving list/new/detail | `src/features/receiving/ReceivingPages.tsx` | Permissions `receiving.view`, `receiving.create`, `receiving.link_purchase` |
| Validation / lines | `src/features/receiving/receivingModel.ts` | `buildReceivingLines`, photo rules, BOM exclusion |
| To Order + Stock Usage | `src/features/inventory/ToOrderPages.tsx`, `toOrderModel.ts` | `markStockOrdered`, `cancelStockOrder`, `recordStockUsage` |
| Types | `src/types/index.ts` | `Receiving`, `StockOrder`, movement type `receiving` |
| Local reference logic | `src/store/db.ts` | Optimistic UI; **now** queues API when `identityApiUrl()` set |

**Acceptance scripts (local db contract):** `scripts/raw-material-receiving-acceptance.ts`, `scripts/stock-usage-to-order-acceptance.ts`.

---

## 3. Gap analysis (pre-implementation)

| Capability | Frontend | Backend before Step 10 |
|------------|----------|------------------------|
| `receivings.list/get/create/linkPurchase` | Used via new sync | **Missing** — only stub `Receivings` link columns in `purchaseRepository.js` |
| `inventory.markOrdered` / `cancelOrder` | To Order page | **Missing** |
| `inventory.usage/transfer/count/adjust` | Stock pages | **Present** (`inventoryService.js`) |
| Purchase + `receivingId` | Purchases | **Present** (`purchaseService.js`) |
| Sheet tabs `ReceivingLines`, `StockOrders` | Implied by types | **Not ensured** |

---

## 4. Backend implemented (this Step 10)

| Component | Path | Actions / methods |
|-----------|------|-------------------|
| Receiving repository | `apps-script/repositories/receivingRepository.js` | `Receivings`, `ReceivingLines`, `StockOrders` tabs |
| Receiving service | `apps-script/services/receivingService.js` | `receivings.list`, `.get`, `.create`, `.linkPurchase` |
| Inventory extensions | `apps-script/services/inventoryService.js` | `inventory.markOrdered`, `inventory.cancelOrder`; `inventory.get` includes `stockOrders` |
| Router | `apps-script/app/router.js` | Dispatches `receivings.*` |
| Main wiring | `apps-script/app/main.js` | `createReceivingService({ driveStorage })` |
| Frontend sync | `src/store/receivingSync.ts` | Hydration + write queue |
| Frontend wiring | `src/store/db.ts`, `inventorySync.ts` | Queue create/link/mark/cancel |

**Idempotency:** Required on `receivings.create`, `receivings.linkPurchase` (architecture §24). Not required on mark/cancel stock order.

**Audit actions:** `receivings.create`, `receivings.linkPurchase`, `inventory.markOrdered`, `inventory.cancelOrder` → `AuditLogs`.

**Drive:** Optional receiving photo → folder `ReceivingPhotos`, `photoFileId` on `Receivings` row.

---

## 5. Validations (aligned with `buildReceivingLines`)

- Company warehouse only  
- Active products without active BOM  
- Qty &gt; 0, condition ∈ `Baik` / `Tidak Baik` / `Perlu Pemeriksaan`  
- Expiry required when `product.trackExpiry`  
- Purchase link: draft purchase only; inventory fingerprint unchanged  
- One active `ordered` stock order per product/warehouse  

---

## 6. Automated tests

| Suite | Count | Result |
|-------|-------|--------|
| `apps-script/tests/receiving.test.js` | 2 tests | PASS (with full backend suite **73/73**) |
| `npm run lint` | tsc | PASS |
| `npm run build` | vite | PASS |

---

## 7. UAT scenarios (planned — public DEV)

See `docs/uat/STEP10_RECEIVING_TO_ORDER_UAT.md` (filled after deploy + UI run).

| # | Scenario | Status |
|---|----------|--------|
| R1 | Receive raw material without purchase → `RCV-*`, movement `receiving` | NOT RUN |
| R2 | Link receiving to draft purchase → receive purchase, no double stock | NOT RUN |
| R3 | Receive from To Order → stock order `received` | NOT RUN |
| R4 | Mark ordered / cancel on To Order | NOT RUN |
| R5 | Stock usage (API) after Step 10 deploy | NOT RUN |
| R6 | Permission: cashier cannot receive | NOT RUN |
| S1 | Google Sheets: Receivings, ReceivingLines, StockMovements, AuditLogs | BLOCKED (agent) |
| Reg | Purchases Module 9 smoke | NOT RUN |

---

## 8. Owner phone checklist (Sheet verification)

When UAT records exist, verify in DEV Sheet:

1. **Receivings** — new `RCV-*`, `status=completed`, `receivedBy`  
2. **ReceivingLines** — qty, baseQty, condition  
3. **StockMovements** — type `receiving`, reference `RCV-*`  
4. **Purchases** — linked row has `receivingId`; receive did not duplicate qty  
5. **StockOrders** — ordered → received or cancelled  
6. **AuditLogs** — `receivings.create`, `receivings.linkPurchase` as applicable  

---

## 9. Discrepancies / notes

- Architecture lists `receivings.create/linkPurchase` as one row; implemented as two actions matching frontend flows.  
- `DocumentAuditLogs` in frontend remain local; system **AuditLogs** tab used on backend (consistent with Modules 5–9).  
- Step 9 formal LOCK deferred per owner; no Step 9 code changes in this branch.

**Step 10 LOCKED:** No — pending deploy, UI UAT, owner review.
