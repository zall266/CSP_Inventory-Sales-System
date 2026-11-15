# Step 12 — Daily Sessions fresh-session owner UAT

Status: **OWNER UAT REQUIRED**. Automated tests are not owner UAT. Do not fabricate acceptance.

## Locked records — do not touch

- Do **not** accept, start, edit, cancel, pick, distribute, complete, or duplicate `PROD-20261109-001`.
- That session stays planned for production date **2026-11-09**.
- Accept and Start remain restricted to the **current Malaysia production date**. There is no past-date override.

## Where to run

Public app: https://zall266.github.io/CSP_Inventory-Sales-System/

Sign in as owner **Aina Rahman** (`u-aina`) unless a step says otherwise.

Use a **new** daily session dated today (Asia/Kuala_Lumpur). Label notes `STEP12-UAT-<YYYYMMDD>`.

## Test data

- Products already on the locked session can be reused on the new session (Matcha pack / Chocolate Lava or current finished-goods SKUs).
- AUTO BOM component: a recipe line that auto-deducts on complete.
- MANUAL BOM component: a recipe line that must **not** auto-deduct.
- Recipe photo: any JPEG of the day’s recipe card.
- Cashier user: Siti (`u-siti`).

## Cases

### 1. Create

| Item | Detail |
| --- | --- |
| Page | Manufacturing → Production Planning (`/manufacturing`) |
| Objective | Create a planned session for **today**, not 9 Nov 2026 |
| Expected UI | New `PROD-<today>-00n` appears with today’s date, status Planned |
| Expected backend | `sessions.create` → `ok`, status `planned`, `posted` false |
| Sheets | One new `ProductionSessions` row. `PROD-20261109-001` unchanged |
| Stock / Audit | No StockMovements. AuditLogs `sessions.create` for the new id |
| PASS | New session exists for today. Historical session untouched |

### 2. Accept

| Item | Detail |
| --- | --- |
| Page | Manufacturing → Today’s Production (`/manufacturing/today`) |
| Objective | Accept only today’s session |
| Expected UI | Status Accepted. Accept on `PROD-20261109-001` still shows “Not today’s production” |
| Expected backend | `sessions.accept` → `ok` for today; `VALIDATION_ERROR` “Not today's production” for the 9 Nov session |
| Sheets | Today’s row `acceptedBy` / `acceptedAt` filled. Historical row unchanged |
| PASS | Only the new session is accepted |

### 3. Start with recipe photo

| Item | Detail |
| --- | --- |
| Page | Today’s Production → Start |
| Objective | Start requires a recipe photo |
| Expected UI | Start without photo is blocked. With photo, status In progress |
| Expected backend | `sessions.start` with photo payload → `ok`; missing photo → validation error |
| Drive | Recipe image stored. Session keeps the file id |
| Sheets | Status `in_progress`. No finished-goods StockMovements yet |
| PASS | Photo required; session in progress |

### 4. Picking

| Item | Detail |
| --- | --- |
| Page | Today’s Production → Picking list (`/manufacturing/today/picking`) |
| Objective | Toggle picking for today’s materials |
| Expected UI | Lines can be marked picked. Past-date session cannot be picked |
| Expected backend | `sessions.togglePicking` → `ok` |
| Stock | No AUTO/MANUAL stock-out yet |
| PASS | Picking updates only the new session |

### 5. Three complete-production steps

| Item | Detail |
| --- | --- |
| Page | Complete production (`/manufacturing/today/complete`) |
| Objective | Save result, distribution, and material closing before complete |
| Expected UI | Three steps in the existing order. Complete stays disabled until they are saved |
| Expected backend | `sessions.saveResult`, `sessions.saveDistribution`, `sessions.saveMaterialClosing` |
| Sheets | Result / distribution / closing fields on the session and lines |
| PASS | All three steps save without posting stock |

### 6. Display + carton = actual

| Item | Detail |
| --- | --- |
| Page | Complete production → distribution |
| Objective | Display qty + carton qty must equal actual produced |
| Expected UI | Mismatch is rejected with the existing message |
| Expected backend | `VALIDATION_ERROR` when they do not equal. Success when they do |
| Stock | Still no complete posting on the mismatch attempt |
| PASS | Equality enforced; matching values save |

### 7. Complete once

| Item | Detail |
| --- | --- |
| Page | Complete production → Complete |
| Objective | Complete posts once |
| Expected UI | Status Completed. Second click does not double-post |
| Expected backend | First `sessions.complete` with a key → `ok`. Same key replays. A new key → `CONFLICT` |
| Sheets | `posted` true. One finished-goods `production_in` per product |
| AuditLogs | One successful `sessions.complete` |
| PASS | Qty and movements unchanged on retry |

### 8. AUTO stock-out

| Item | Detail |
| --- | --- |
| Objective | AUTO components deduct from material-closing **actual used** |
| Expected backend / sheets | `production_out` for AUTO SKUs. InventoryBalances reduced once |
| PASS | AUTO qty = opening + in − out on those SKUs |

### 9. MANUAL skip

| Item | Detail |
| --- | --- |
| Objective | MANUAL components do not auto-out |
| Expected backend / sheets | No `production_out` for MANUAL SKUs. Balances unchanged for those products |
| PASS | MANUAL stock identical before and after complete |

### 10. Cashier denial

| Item | Detail |
| --- | --- |
| Actor | Switch to Siti (`u-siti`) |
| Objective | Cashier cannot accept / start / complete |
| Expected UI | Actions hidden or permission denied |
| Expected backend | `FORBIDDEN` on `sessions.accept` / `sessions.start` / `sessions.complete` |
| Sheets | No partial write, no extra movement |
| PASS | Unauthorized calls rejected; today’s completed session unchanged if already posted |

### 11. Carry-forward

| Item | Detail |
| --- | --- |
| Page | Carry-forward (`/manufacturing/today/carry-forward`) after a remaining target |
| Objective | Remaining target continues once onto today’s operational session, or a new planned session |
| Expected backend | `sessions.continueCarryForward` → `ok` once; second continue rejected |
| Sheets | Origin remaining reduced; destination has the continued line |
| PASS | Carry-forward happens once and is visible on Today’s Production |

## How to record the result

Write PASS or FAIL per case with the new session reference. Do not alter `PROD-20261109-001` to force a pass.
