# CSP BACKEND BIBLE V1.1

Status: CANONICAL RECOVERY / RECONSTRUCTED V1.1

This document is the canonical architecture and roadmap record for the CSP Inventory & Sales System. It is a reconstruction from evidence already in the project. It is not a byte-for-byte recovery of a missing historical file.

## Historical Note

The original Backend Bible V1.1 referenced by earlier project documentation could not be recovered from the accessible repository, Git history, project files, or accessible GitHub history. This document reconstructs the canonical project rules from established project evidence. It is not a byte-for-byte recovery of the missing historical document.

Evidence baseline used for repository facts, unless a side branch is named:

- Commit `70b6a4bdf5ba7b86d879de27d8a6c5d8a7bf63b1` (“Merge pull request #77”) on `origin/cursor/pjkm-911-daily-summary-d9ac`.
- That commit contains the Phase 1 Apps Script foundation and the StockFlow React prototype that had been stacked beneath it.
- Side branches that are not ancestors of that commit are named where their facts differ.

## How to read a statement

| Mark | Meaning |
| --- | --- |
| ESTABLISHED | Directly supported by a project decision, source comment, or README sentence. |
| CURRENT IMPLEMENTATION | Describes behavior already present in source. |
| LOCKED | An explicit project constraint this document does not change. |
| ROADMAP | Named as a later phase or direction. |
| UNVERIFIED | Mentioned, but the exact original requirement cannot be proven from recovered source. |
| NOT SPECIFIED | No reliable project evidence for the missing detail. |

A prototype screen is not, by itself, a completed Apps Script phase.

---

## 1. Document control

| Field | Value |
| --- | --- |
| Version | V1.1 |
| Status | CANONICAL RECOVERY / RECONSTRUCTED |
| Authority | CSP Inventory & Sales System project architecture decisions, as evidenced in this repository and the conflicts recorded below |
| Original file recovered | NO |

Rule:

Any future architecture change must explicitly identify:

- affected section
- reason
- implementation impact
- migration impact
- whether an existing LOCKED rule is being changed

A proposed change is not an implemented change.

This recovery does not modify application code, Apps Script, GitHub Actions, README files, Sheets, Drive, or Script Properties.

---

## 2. Authority and source rules

Priority used while writing this file:

1. Explicit rules already written in project source and README text.
2. Current repository implementation.
3. README and in-repo documentation.
4. Phase names and boundaries already written in `apps-script/README.md`.
5. Pull request and commit history.

Where those sources disagree, the disagreement is recorded under [Unresolved / source conflict](#18-unresolved--source-conflict). This document does not pick a silent winner and does not change code.

Statements that were not supported were left as NOT SPECIFIED. General software practice was not used to fill gaps.

---

## 3. Locked architecture

### 3.1 What this repository actually is

LOCKED / CURRENT IMPLEMENTATION. The repository product is a React 19 + TypeScript + Vite frontend named StockFlow (`package.json` name `stockflow`, version `0.1.0`). Entry files are `index.html` and `src/main.tsx`. Styling is Tailwind CSS v4. Routing is React Router. Business data for the prototype is an in-memory store persisted with `localStorage` (`src/store/db.ts`). `PROTOTYPE_PLAN.md` and the root README on this lineage say the React app is a prototype and is not the Apps Script backend.

LOCKED. This recovery does not redesign that SPA, its routes, or its build.

CURRENT IMPLEMENTATION. Public entry of the prototype is `index.html`, which mounts `#root` and loads `/src/main.tsx`. Build scripts are `vite` dev, `tsc --noEmit && vite build`, and `vite preview`. Backend unit tests are `npm run test:backend`.

CURRENT IMPLEMENTATION. Routes defined in `src/App.tsx` at the evidence commit include the print, PJKM, sales, POS, agent, inventory, warehouse map, manufacturing, receiving, compliance, and report paths in that file. This Bible does not add or rename them. A full route list belongs to that file, not to a second copy that could drift.

### 3.2 Backend layering

ESTABLISHED / CURRENT IMPLEMENTATION. The Apps Script README describes the call path:

`doGet` / `doPost` → `app/main.js` → router → service → sheet repository, with Drive opened only by `storage/driveStorage.js`.

CURRENT IMPLEMENTATION. Runtime is Google Apps Script V8 (`appsscript.json` `runtimeVersion` `V8`, `timeZone` `Asia/Kuala_Lumpur`). OAuth scopes in the manifest are spreadsheets and Drive only.

CURRENT IMPLEMENTATION. Google Sheets is the Phase 1 store. Google Drive is the Phase 1 file root. The React prototype does not call this backend yet (README).

### 3.3 Claims not found in this repository

The recovery instruction listed WordPress pages, a shortcode, WooCommerce, an existing checkout, an existing payment flow, a locked J&T shipping plugin, a vanilla HTML/CSS/JS CSP Shop V2, and “existing database architecture” as locked. Search of this repository found no WordPress, WooCommerce, shortcode, or checkout implementation.

Those claims are recorded as a conflict in section 18. They are not restated here as the architecture of this repository.

CURRENT IMPLEMENTATION, narrower fact: dispatch and PJKM 9.1.1 use a courier key `JNT` (and `JNT CARGO` in the dispatch model). That is a courier column in the prototype, not a WooCommerce shipping integration.

---

## 4. Phase roadmap

Phase names 1, 2, 4, and 13 are written in `apps-script/README.md`. Phase names 0, 3, 5, 6, 7, 8, 9, 10, 11, 12, and 14 were supplied as the known roadmap for this recovery. They were not found as a Backend Bible body in Git. Detailed requirements below are limited to what source or README already states.

| Phase | Name used in this recovery | What is actually evidenced |
| --- | --- | --- |
| 0 | Bible / architecture foundation | ROADMAP name only. Detailed requirements: NOT SPECIFIED IN RECOVERED SOURCE. |
| 1 | Backend Foundation | ESTABLISHED. Implemented under `apps-script/`. See section 5. |
| 2 | Temporary CSP UAT access | ESTABLISHED name and one dependency sentence in the Apps Script README. Further requirements: NOT SPECIFIED IN RECOVERED SOURCE. |
| 3 | Master Data | ROADMAP name only for the backend. Prototype master-data behavior is section 8 and is not Phase 3 of Apps Script. Detailed backend requirements: NOT SPECIFIED IN RECOVERED SOURCE. |
| 4 | Drive / attachments / product image foundation | ESTABLISHED boundary: Phase 1 does not create Phase 4 folders such as `ProductImages`. Further Phase 4 requirements: NOT SPECIFIED IN RECOVERED SOURCE. |
| 5 | Inventory Ledger | ROADMAP name only for the backend. Prototype inventory screens are section 9. Detailed backend requirements: NOT SPECIFIED IN RECOVERED SOURCE. |
| 6 | Receiving + Opening | ROADMAP name only for the backend. Prototype receiving and opening-balance screens exist. Detailed backend requirements: NOT SPECIFIED IN RECOVERED SOURCE. |
| 7 | Sales | ROADMAP name only for the backend. Prototype sales screens exist. Detailed backend requirements: NOT SPECIFIED IN RECOVERED SOURCE. |
| 8 | Manufacturing | ROADMAP name only for the backend. Prototype manufacturing rules are section 10. Detailed backend requirements: NOT SPECIFIED IN RECOVERED SOURCE. |
| 9 | Packing | ROADMAP name only for the backend. Prototype packing is section 11. Detailed backend requirements: NOT SPECIFIED IN RECOVERED SOURCE. |
| 10 | Sales Import | ROADMAP name only for the backend. Prototype import screens are section 14. Detailed backend requirements: NOT SPECIFIED IN RECOVERED SOURCE. |
| 11 | Dispatch + Halal | ROADMAP name only for the backend. Prototype dispatch, Halal, and PJKM screens are section 15. Detailed backend requirements: NOT SPECIFIED IN RECOVERED SOURCE. |
| 12 | Reports | ROADMAP name only for the backend. Prototype report routes exist. Detailed backend requirements: NOT SPECIFIED IN RECOVERED SOURCE. |
| 13 | Security + unified identity | ESTABLISHED direction only: `auth/boundary.js` says Phase 13 replaces the Phase 2 session provider. Unified-identity design: NOT SPECIFIED IN RECOVERED SOURCE. |
| 14 | Migration / cutover | ROADMAP name only. Detailed requirements: NOT SPECIFIED IN RECOVERED SOURCE. |

---

## 5. Phase 1 — Backend foundation

### 5.1 Scope

ESTABLISHED. Phase 1 is the Apps Script foundation. It does not log anyone in and does not grant business permissions (README and `auth/boundary.js`).

ESTABLISHED. `doGet` returns `system.health`. `doPost` accepts version `v: 1`, a `requestId`, an `action`, and a `payload` object. Documented actions are `system.health` and `system.ping`. Any other action, including sales and inventory, returns `UNKNOWN_ACTION`.

CURRENT IMPLEMENTATION. `initializeFoundation` is a global function in `app/main.js`. It is not a router action.

CURRENT IMPLEMENTATION. Optional `idempotencyKey` on a request is handled in `app/main.js` by `idempotency.execute` when the trimmed key is non-empty. The README says a matching action replays a stored success and a different action with the same key returns `DUPLICATE_REQUEST`.

### 5.2 Configuration

ESTABLISHED / CURRENT IMPLEMENTATION. Script Properties, not source constants, supply:

| Key | Rule in `config/config.js` |
| --- | --- |
| `ENVIRONMENT` | Required. Must be `DEV`. Any other value throws `FORBIDDEN` (“This foundation build serves DEV only.”). |
| `SPREADSHEET_ID` | Required. Not hardcoded in `config.js`. |
| `DRIVE_ROOT_ID` | Required. Not hardcoded in `config.js`. |
| `TIMEZONE` | Required. Must be `Asia/Kuala_Lumpur`. Any other value throws `VALIDATION_ERROR`. |

CURRENT IMPLEMENTATION. Missing keys log the key names only and throw `INTERNAL_ERROR` with message “Backend configuration is incomplete.” Values are not echoed in that error.

ENVIRONMENTAL EXAMPLES already published in `apps-script/README.md` (not secrets):

| Property | Example value recorded in that README |
| --- | --- |
| `ENVIRONMENT` | `DEV` |
| `SPREADSHEET_ID` | `1TPmkASdzlGssGyAisklf4QkLcxWYbHHhUSxntgLha94` |
| `DRIVE_ROOT_ID` | `14vIYpPSNQafvMnWgSEd1EGounerNjK3S` |
| `TIMEZONE` | `Asia/Kuala_Lumpur` |

ESTABLISHED. The README says `14vIYpPSNQafvMnWgSEd1EGounerNjK3S` is the verified Drive root, and a similar-looking id that ends in the Apps Script id is not the folder.

CURRENT IMPLEMENTATION. `.clasp.json` `scriptId` is `1mkRzptY0mzHnzOFB8TA6AGIZyv6q2gJq-QdKPBWtV91oq5okHWVpY4Jj`, `rootDir` `.`.

OAuth client secrets and refresh tokens are not Bible content. They are not recorded here.

### 5.3 HTTP surface and envelope

CURRENT IMPLEMENTATION. Success envelope from `utils/envelope.js`:

```text
{ ok: true, data, error: null, meta: { timestamp, ...extra } }
```

CURRENT IMPLEMENTATION. Failure envelope:

```text
{ ok: false, data: null, error: { code, message }, meta: { timestamp, ...extra } }
```

CURRENT IMPLEMENTATION. Error codes in `utils/errors.js`: `INVALID_REQUEST`, `UNKNOWN_ACTION`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`, `DUPLICATE_REQUEST`, `INTERNAL_ERROR`. Unknown codes become `INTERNAL_ERROR`. `toSafeError` hides non-exposed errors behind “The request could not be completed.”

CURRENT IMPLEMENTATION. Router requires `v === 1`, a string `action`, and a non-array object `payload`. Otherwise `INVALID_REQUEST`.

CURRENT IMPLEMENTATION. `system.ping` data is `{ pong: true, serverTimestamp, environment }` plus meta `requestId`.

### 5.4 system.health

CURRENT IMPLEMENTATION. `system.health` reads only. It opens the spreadsheet and calls `getName()`, checks that sheets named `AuditLogs`, `Idempotency`, and `Counters` exist, opens the Drive root, and throws `INTERNAL_ERROR` (“Drive root did not match configuration.”) if `root.getId()` is not `config.driveRootId`. It then calls `root.getName()`.

CURRENT IMPLEMENTATION. Health `data` is:

- `service`: `CSP Inventory Backend`
- `environment`
- `status`: `healthy`
- `timezone`
- `spreadsheetAccessible`: `true`
- `driveAccessible`: `true`
- `foundationReady`: true only when all three foundation sheets are present

CURRENT IMPLEMENTATION. `foundationReady` is presence of those three sheet names. Health does not return tab names, headers, or row counts, and it does not audit header contents.

ESTABLISHED. README: health only reads. Phase 4 folders such as `ProductImages` are not created.

Reported live browser result from prior project verification (not re-called for this document): environment `DEV`, status `healthy`, timezone `Asia/Kuala_Lumpur`, `spreadsheetAccessible` true, `driveAccessible` true, `foundationReady` true. One paste placed `error: null` inside `data`. Source `okEnvelope` places `error: null` and `meta` as siblings of `data`, not inside `data`.

UNVERIFIED. The cause of that live-paste difference is not proven. This document does not treat either shape as a bug fix and does not rewrite the source contract.

### 5.5 Foundation tables

`initializeFoundation()` creates only `AuditLogs`, `Idempotency`, and `Counters`, then appends one audit row. `Sheet1` is left in place. `ensureSheet` refuses the name `Sheet1`. If an existing foundation sheet’s headers differ, it throws `CONFLICT` and does not overwrite them.

Initialization locking: NOT SPECIFIED as a requirement. CURRENT IMPLEMENTATION does not take `withScriptLock` around `initialize()` or around the audit append. The README says to run `initializeFoundation` once from the editor. It does not state a concurrency rule.

`TEMPORARY_CspAccessTest`: ESTABLISHED. README says leave that temporary file in the Apps Script project until `system.health` reports `foundationReady: true`, then delete it. This Bible does not delete it.

#### AuditLogs

| Item | Evidence |
| --- | --- |
| Purpose | ESTABLISHED. README: append only. |
| Schema | CURRENT IMPLEMENTATION. `auditId`, `timestamp`, `userId`, `action`, `entityType`, `entityId`, `reference`, `before`, `after`, `requestId`. |
| Init row | CURRENT IMPLEMENTATION. `action` `system.foundation.initialize`, `entityType` `system`, `entityId` `foundation`, `after` `AuditLogs,Idempotency,Counters`, empty `userId`, `reference`, `before`, and `requestId`. |
| Locking | NOT SPECIFIED. The append path used by init is not inside `withScriptLock`. |
| Update/delete | NOT SPECIFIED as a product rule. The repository exposes append. |

#### Idempotency

| Item | Evidence |
| --- | --- |
| Purpose | ESTABLISHED. README: one stored response per key. |
| Schema | CURRENT IMPLEMENTATION. `idempotencyKey`, `requestId`, `action`, `status`, `response`, `createdAt`, `updatedAt`. |
| Locking | CURRENT IMPLEMENTATION. `idempotencyService.execute` runs inside `withScriptLock`. |
| Replay | CURRENT IMPLEMENTATION. Same key and same action returns the stored JSON with `meta.idempotentReplay: true`. Different action throws `DUPLICATE_REQUEST`. |
| Failures | CURRENT IMPLEMENTATION. A response is stored only when `response.ok` is true. |
| Limitation | A key is optional. Requests without a key do not use this table. |

#### Counters

| Item | Evidence |
| --- | --- |
| Purpose | ESTABLISHED. README: locked integer allocation for later document numbers. |
| Schema | CURRENT IMPLEMENTATION. `counterKey`, `prefix`, `nextValue`, `updatedAt`. |
| Locking | CURRENT IMPLEMENTATION. `counterService` allocates inside `withScriptLock`. |
| Allocation | CURRENT IMPLEMENTATION. First issue for a key returns `1` and stores `nextValue` `2`. A later issue returns the stored `nextValue` and stores that number plus one. Non-finite or `< 1` throws `CONFLICT`. |
| Use in Phase 1 | CURRENT IMPLEMENTATION. The router does not call the counter. No document number is issued by Phase 1 HTTP actions. |

### 5.6 Other Phase 1 mechanisms

CURRENT IMPLEMENTATION. IDs: `Utilities.getUuid` when present, otherwise `crypto.randomUUID`. If neither exists, `INTERNAL_ERROR`.

CURRENT IMPLEMENTATION. Request ids are taken from the request when present. `doGet` builds a health request with `createId()` when it needs a request id (`app/main.js`).

CURRENT IMPLEMENTATION. `LockService.getScriptLock` via `withScriptLock`, default `tryLock` 10000 ms. Failure is `CONFLICT` “The request could not get a lock in time.” Used by idempotency and counters, not by health and not by `initialize()`.

CURRENT IMPLEMENTATION. Drive storage can get the root, find a child by name (null if absent), create a child, upload, replace (trash the old file), and trash a file. Health uses `getRoot` only. Creating Phase 4 folders during health or init: not done.

CURRENT IMPLEMENTATION. Time helpers exist for ISO timestamps and `Asia/Kuala_Lumpur` business dates. Logging writes `requestId`, `action`, `timestamp`, `status`, `errorCode`, and `durationMs` only.

### 5.7 Tests

CURRENT IMPLEMENTATION. `apps-script/tests/foundation.test.js` defines 10 tests. `apps-script/tests/harness.js` loads production files into a Node `vm` with in-memory Sheet and Drive doubles.

ESTABLISHED. README: `npm run test:backend` does not touch Google.

The 10 test titles are:

1. configuration rejects missing properties without echoing values
2. configuration accepts DEV Kuala Lumpur settings and rejects PROD
3. business dates use Asia/Kuala_Lumpur
4. ids are uuids and unsafe errors hide internals
5. health and ping stay read-only and unknown actions are rejected
6. foundation sheets are created beside an empty Sheet1
7. idempotency replays one response and rejects a reused key
8. counter allocation is ordered inside the script lock
9. drive storage can address a later child without creating one during health
10. http entry points return the json envelope

Prior project execution reported 10 passed and 0 failed. This recovery did not re-run the tests. Integration coverage against live Google: NOT SPECIFIED. These tests are not that coverage.

`.claspignore` excludes `tests/**` and markdown from clasp push.

---

## 6. Security boundary

ESTABLISHED. Phase 1 does not provide business login and does not provide business permissions.

CURRENT IMPLEMENTATION. `authenticate()` returns `userId` `''`, `sessionId` `''`, `authenticated: false`. `authorize()` returns `enforced: false`. The router calls both and does not branch on the result.

ESTABLISHED. `auth/boundary.js`: “Phase 1 boundary only. Phase 2 inserts a temporary session provider. Phase 13 replaces that provider. Business services take a principal and a permission key. They do not read passwords, HR, or Script Properties.”

DEFERRED / PHASE-SPECIFIC. Temporary access is named as Phase 2. Replacement of that provider is named as Phase 13. The design of unified identity, passwords, and permission enforcement on the Apps Script router: NOT SPECIFIED IN RECOVERED SOURCE.

CURRENT IMPLEMENTATION, separate from Apps Script. The React prototype has its own `hasPermission` in `src/features/settings/permissions.ts`. That is prototype UI authorization. It is not the Phase 1 HTTP boundary.

Shared-link access: ESTABLISHED. README says shared-link access is not the security model. The script opens private ids. A later web app should execute as the deploying account.

---

## 7. Deployment boundary

ESTABLISHED / CURRENT IMPLEMENTATION. `.github/workflows/deploy-dev.yml`:

- trigger: `workflow_dispatch`
- permissions: `contents: read`
- job environment: `dev`
- secret name used by the job: `CSP_DEV_CLASP_CREDENTIALS` (the value is not in Git and is not copied here)
- command: `npx --yes @google/clasp@3.4.1 push --force` from `apps-script/`
- the credential file is written for the job and removed afterward
- the job does not run `clasp create`
- the job does not set Script Properties
- the job does not run `initializeFoundation`

ESTABLISHED. README: `--force` is required because a non-interactive runner would otherwise skip the whole push when `appsscript.json` is part of the change.

These are different steps. This document does not collapse them:

| Step | What the recovered sources say |
| --- | --- |
| Source push | CURRENT IMPLEMENTATION. `clasp push --force` updates project content. |
| Apps Script version | NOT SPECIFIED. The workflow file does not create a version. |
| Web app deployment | ESTABLISHED prohibition for Phase 1. README: “Do not deploy that web app in Phase 1.” The workflow does not run `clasp deploy`. |
| `/exec` URL | NOT SPECIFIED / UNVERIFIED. No `/exec` URL is stored in the repository. How a deployment is retargeted: NOT SPECIFIED / UNVERIFIED. |

---

## 8. Master data

Backend Phase 3 requirements: NOT SPECIFIED IN RECOVERED SOURCE.

CURRENT IMPLEMENTATION in the React prototype (`src/features/products`, `masterData.ts`), not an Apps Script phase:

- Product records exist, including SKU, units, cost, and sellable flag.
- The product form says to leave SKU empty to auto-generate a 6-digit SKU. `masterData.ts` can fail with “No unique 6-digit SKU remaining.”
- Manual SKU entry is the same field. Exact format rules beyond that hint: NOT SPECIFIED here beyond the form text.
- `db.ts` toasts “SKU cannot be changed” / “This product is already used in transactions.”
- `applyBomCosts` sets `costSource: 'bom'` and `costPrice` from `bomUnitCost` for products with an active BOM.
- Base unit, purchase unit, and purchase conversion are fields used by `baseUnitCost`.
- `sellable` defaults to true when not `false` (`productIsSellable`). A raw material is a product route (`/products/raw-materials`). Whether every raw material is sellable: the flag exists; a blanket rule beyond `sellable !== false` is NOT SPECIFIED.
- Product import acceptance scripts and Usahaone import work exist in `scripts/` and the product feature. Marketplace-specific import rules beyond that code: NOT SPECIFIED IN RECOVERED SOURCE.

---

## 9. Inventory

Backend Inventory Ledger (Phase 5) requirements: NOT SPECIFIED IN RECOVERED SOURCE.

CURRENT IMPLEMENTATION in the prototype:

- Inventory, stock movements, adjustment, transfer, and count routes exist.
- `reorderLevel` is shown as the column “Min Stock” on To Order.
- To Order subtitle: “Items that need purchasing attention. The system does not decide how much to buy.” Hint: items appear when current stock is at or below Min Stock.
- Stock Usage is `/inventory/stock-usage`.
- Mark Ordered / Cancel exists as To Order actions in that feature’s pages and store. Exact status machine beyond the page: see `src/features/inventory/ToOrderPages.tsx` and `db.ts`. This Bible does not add states.
- Warehouse map and company warehouse concepts exist in the prototype (section 16 and agent warehouses).
- Permissions on those pages use `hasPermission`.

---

## 10. Manufacturing

Backend Phase 8 requirements: NOT SPECIFIED IN RECOVERED SOURCE.

CURRENT IMPLEMENTATION in the prototype at the evidence commit:

- A daily production session is the Today’s Production flow.
- A session has multiple product lines.
- Start calls `startSession` with a recipe photo. The page text is: “Upload a photo of the physical recipe sheet on the process-room mirror. This is evidence only — material requirements still come from the configured BOM.” No OCR function was found on that page.
- Picking list subtitle: collect fresh materials from the Store first, then Production Balance from Storage Box.
- `allocateBalanceFifo` uses available `productionBalances` for the same `productId`, sorted by `productionDate` then `id`.
- Production balance quantity is stored and displayed in grams (`g`) on completion and history. The page does not describe it as raw leftover or as saleable packs.
- Completion UI is three steps: production result, Finished Goods Distribution, Material Closing Check.
- Result fields used by the page include actual quantity, production balance quantity, waste, carry-forward or a short-production reason, and notes. A field literally named `box` was not confirmed as a separate result column; carton quantity is part of distribution. Extra result fields beyond the page: NOT SPECIFIED.
- Distribution rule in the toast: “Display + Carton must equal Actual Produced for every product.”
- Material closing labels on the page: Expected Remaining, Physical Remaining, Actual Used, Variance, and an acknowledgement checkbox required before save and before complete.
- Complete Production is the success action after Step 3 is saved. It calls `api.completeSession`.
- History shows who saved distribution and who checked material closing, with timestamps. Per-step actor fields beyond those shown: NOT SPECIFIED.
- Target can be edited on the session edit route. The exact statuses during which a target may change, and the audit record shape: see the history/edit implementation. A single sentence that covers every status was not copied from an unrecovered Bible.

Carry forward, CURRENT IMPLEMENTATION:

- Lines can be marked carry-forward when actual is below target.
- A later line can reference `carriedFromItemId`. `originSessionForLine` and `isCarryForwardResumed` exist.
- “Day 1 does not reopen” as a named rule: NOT SPECIFIED as that sentence in source. What the code does with a completed origin session must be read from `sessionPlan.ts` and `db.ts`, and is not expanded here.

---

## 11. Packing / assembly

Backend Phase 9 requirements: NOT SPECIFIED IN RECOVERED SOURCE.

CURRENT IMPLEMENTATION. Packing/assembly is a separate flow from the production session (`packingModel.ts`, `postPackingAssembly` in `db.ts`):

- It converts components of a saved BOM snapshot into an output product.
- It is not the production-session complete path and does not write `productionBalanceQty`.
- It does not use the carry-forward session fields.
- Posting uses the saved snapshot. If the live BOM differs, the user must refresh or confirm the snapshot.
- Stock is checked unless `allowNegativeStock` is set. Shortage blocks posting in that case.
- Movements are posted through `postConversionMovements` in one function. A separate transaction engine: NOT SPECIFIED.
- Lines posted are `snapshot.items`. No nested-BOM explode function was found. Circular BOM checks exist (`packingHasCircularBom`).

---

## 12. BOM component consumption

CURRENT IMPLEMENTATION. `BomConsumptionMethod` is `'AUTO' | 'MANUAL'`.

- UI text: “AUTO consumes this component automatically. MANUAL: staff records actual usage later.”
- Packing sets `postsOut` false when the method is `MANUAL`.
- `bomMaterialCostFromProducts` sums every `bom.items` line. It does not skip `MANUAL`.

Stock Usage as the later MANUAL path: the Stock Usage screen exists. The exact link from a MANUAL packing line to a Stock Usage document: NOT SPECIFIED beyond the UI sentence above.

---

## 13. Sales components and sales documents

### 13.1 Sales components

CURRENT IMPLEMENTATION. A product may have `salesComponents` (`productId`, `qty`). Sales lines can store `salesComponentsSnapshot` via `salesComponentSnapshot`. Inactive components are rejected. Stock checks for components exist in `db.ts`.

Wholesale price is a product field and customer wholesale pricing exists.

Returns store snapshots (`sales-return` feature and types). The exact void/return movement rules: see that feature. They are not restated beyond “snapshots are stored.”

“OUT components instead of the parent” as a one-line law: the snapshot and stock-check code support component consumption. A full movement matrix for every sale type: NOT SPECIFIED in this Bible beyond that code.

### 13.2 Document flow

CURRENT IMPLEMENTATION on the evidence commit (before the invoice side branch): quotation, invoice, and delivery-order print routes exist. Quotation header includes Prepared by. Quotation and invoice bodies include signature boxes. Delivery order includes signature and customer signature / stamp boxes.

SIDE BRANCH, not an ancestor of `70b6a4b`:

- `743645b` adds the invoice footer text: “This is a computer-generated document and does not require a signature.”
- `5cf12a5` (“fix(invoice): remove signature lines from Invoice A4”) removes invoice signature lines and keeps header Prepared by and that footer. The commit message says quotation and delivery signature blocks are unchanged.
- On `5cf12a5`, quotation still renders “Prepared by” and “Authorized by / Signature” boxes and does not render the computer-generated footer.
- Delivery order on that commit still has signature and customer signature / stamp.

CONFLICT. A recovery instruction said quotation is clean, with no signature and no footer. Commit `5cf12a5` still renders quotation signature boxes. This Bible does not delete those boxes and does not declare the instruction to be the code.

Sale status values in the prototype include paid, partial, and unpaid displays (`invoiceDisplayStatus` and the sales list). The click-path “Customer Order → Create Invoice → Select Customer → Add Products → Save Draft → Issue Invoice → Payment” is the prototype sales UI shape. Step-by-step field rules beyond the pages: NOT SPECIFIED IN RECOVERED SOURCE.

---

## 14. Sales import

Backend Phase 10 requirements: NOT SPECIFIED IN RECOVERED SOURCE.

CURRENT IMPLEMENTATION. Prototype modules under `src/features/salesImport`: picking-list parse, AWB parse and reconcile, review, spot check, and mapping management pages. Routes: `/sales/import`, `/sales/import/mappings`, `/sales/import/:batchId`.

Acceptance scripts exist for Phase 1 picking lists, AWB, product review, spot check, summary, action centre, guided workflow, and mapping management. Those scripts are the evidence of what was built. Marketplace rules not present in those files: NOT SPECIFIED.

---

## 15. Compliance, PJKM, and Halal

Backend Phase 11 requirements: NOT SPECIFIED IN RECOVERED SOURCE.

CURRENT IMPLEMENTATION. Prototype routes and modules:

- `/pjkm`, `/pjkm/5.1.1`, `/pjkm/9.1.1`, `/pjkm/10.1.1`
- `/compliance/halal`
- `/compliance/bmr` and BMR print from a production session
- BMR title text includes “Batch Manufacturing Report (BMR)” and a multiple-Halal remark “Multiple Halal records — confirm manually”

Regulatory text that is not in those modules: NOT SPECIFIED. This Bible does not add Halal or PJKM legal requirements.

---

## 16. Warehouse map

CURRENT IMPLEMENTATION.

- CTN Rack slots are generated from levels, front count, and back count (`generateRackSlots`).
- The add-rack form defaults to 4 levels, 4 front, and 4 back. Those defaults are editable.
- A fixed count of “2 CTN racks”: NOT SPECIFIED. No seed of exactly two racks was found.
- Front and back faces are both stored. Back is rendered with `muted`. A back slot is hidden when that back slot and its front partner are both occupied (`backHidden`). “All back positions are always hidden”: not what that condition says.
- Display is loose stock. Page copy: place cartons on CTN Rack or Pallet Stock; display is not a map slot.
- Pallet stock is “Cartons stored outside the CTN Rack.”
- Balance storage boxes are a separate location type on the map (`balanceStorageBoxName`).
- Empty locations can be deactivated; history is kept.
- Who may manage the map uses the prototype permission helpers.

Coordinates and naming schemes beyond `slotIdFor` (`locationId-l{level}-{face}-{slotNo}`): NOT SPECIFIED.

---

## 17. Roles, agent scope, and HR

### 17.1 Prototype permissions

CURRENT IMPLEMENTATION. Dynamic roles and `hasPermission(state, key)`. Users page: “Owner always has full access.” Deactivating the Owner role is rejected. Deactivated roles remain and the toast notes users who still reference the role. User, role, and department are separate fields (`departmentId` on users, `departments` on state).

This is prototype behavior. It is not Phase 1 Apps Script enforcement. See section 6.

### 17.2 Agent module

CURRENT IMPLEMENTATION. Agent steps through Step 7 (admin withdrawal payout, commit `4d8cead`) are in the evidence commit. Later commits on the same lineage also exist: agent sales POS, catalogue fix, and Agent Pricing (`42b29a7`, `a65113f`, `80a2c3c`, `5984514`).

CONFLICT. “The agent module stopped after Step 7” is not true of Git history, because those later commits are ancestors of `70b6a4b`.

SCOPE. This recovery does not extend the agent module. No new agent behavior is specified here.

### 17.3 HR

ESTABLISHED for Phase 1. `auth/boundary.js` says business services do not read passwords, HR, or Script Properties.

ESTABLISHED for this recovery. The HR Staff Portal is a separate system. It is not merged into this Bible. No HR Staff Portal source was found in this repository.

---

## 18. Unresolved / source conflict

| Topic | Conflict | What this Bible does |
| --- | --- | --- |
| WordPress, shortcode, WooCommerce, checkout, payment flow, vanilla CSP Shop V2 | Named as locked in the recovery instruction. Not present in this repository. The evidenced app is the React/Vite StockFlow prototype plus Apps Script. | Does not adopt WordPress as this repo’s architecture. Does not delete the React app. |
| J&T shipping | Named as a locked existing shipping flow. This repo has a `JNT` courier key in dispatch and PJKM, not a storefront shipping plugin. | Records the courier key only. |
| Quotation has no signature | Instruction says clean quotation, no signature, no footer. Commit `5cf12a5` still renders quotation signature boxes and does not add the invoice footer to the quotation. | Does not change the quotation. |
| Invoice footer and signature removal | Present on `cursor/invoice-computer-generated-footer-d9ac`, which is not contained in `70b6a4b`. The Phase 1 tip still has invoice signature boxes and no computer-generated footer. | Records both lineages. Does not merge them. |
| Agent stopped after Step 7 | Later agent pricing and POS commits are in `70b6a4b`. | Does not extend the module and does not pretend the later commits are absent. |
| Live health JSON | Source envelope keeps `error` and `meta` beside `data`. A reported live paste placed `error: null` inside `data`. | Leaves the cause UNVERIFIED. |
| Phase 0 and phases 3–12 and 14 detailed requirements | Names were supplied for this recovery. They are not in the recovered Bible file, because that file was not found. | Names only, plus prototype behavior where code exists. No new backend requirements. |
| `/exec` versus clasp push | README forbids deploying the web app in Phase 1. The workflow only pushes source. No deployment id is in Git. | Deployment relationship to `/exec`: NOT SPECIFIED / UNVERIFIED. |
| Init and audit locking | README says run init once and says counters are locked. `initialize()` does not take the script lock. | Does not add a lock requirement that the source does not state. |

---

## 19. Not specified

The following were looked for and are not given a invented answer:

- Byte-for-byte text of the missing historical Backend Bible.
- Phase 0, 3, 5, 6, 7, 8, 9, 10, 11, 12, and 14 backend requirement lists.
- Unified identity design for Phase 13.
- How an Apps Script deployment is pointed at `/exec`.
- A concurrency contract for `initializeFoundation` or the audit append.
- Whether the live health paste or the source envelope is the one a signed-in browser must show.
- A fixed warehouse of exactly two CTN racks.
- OCR of the recipe photo.
- HR Staff Portal internals.
- OAuth client secrets or refresh tokens.

---

## 20. Change control

Version: V1.1

Status: CANONICAL RECOVERY / RECONSTRUCTED

Authority: CSP Inventory & Sales System project architecture decisions

Any future architecture change must explicitly identify:

- affected section
- reason
- implementation impact
- migration impact
- whether an existing LOCKED rule is being changed

Do not implement a change merely because it is proposed.

Future documentation may point at `docs/CSP_BACKEND_BIBLE_V1.1.md`. README files were not changed by this recovery.
