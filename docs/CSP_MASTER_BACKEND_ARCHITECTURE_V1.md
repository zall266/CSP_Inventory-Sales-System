# CSP Master Backend Architecture V1

Status: READY TO LOCK

This is the technical blueprint for building the backend behind the existing product. It is not a new product design. It does not amend `docs/CSP_BACKEND_BIBLE_V1.1.md` or `docs/CSP_EXECUTION_BASELINE_V1.md`.

No application code is implemented by this document.

## 1. Document control

| Field | Value |
| --- | --- |
| Version | V1 |
| Status | READY TO LOCK |
| UI baseline | `70b6a4bdf5ba7b86d879de27d8a6c5d8a7bf63b1` on `origin/cursor/pjkm-911-daily-summary-d9ac` |
| Bible | `docs/CSP_BACKEND_BIBLE_V1.1.md` |
| Execution baseline | `docs/CSP_EXECUTION_BASELINE_V1.md` |
| Phase 1 | Same commit, `apps-script/` |

Rules for later edits: affected section, reason, implementation impact, migration impact, and whether a locked UI or Bible rule changes. A proposed change is not an implemented change.

## 2. Authority and evidence

Priority:

1. Frontend behavior at `70b6a4b`, especially `src/App.tsx`, `src/types/index.ts`, `src/store/db.ts`, and the feature modules.
2. Phase 1 Apps Script already in that commit.
3. The locked Bible.
4. The locked execution baseline.

Marks used here:

| Mark | Meaning |
| --- | --- |
| SOURCE | Directly in the cited file or type |
| INFERENCE | Required to store or call that source behavior from Apps Script and Sheets. Not a new business rule |
| NOT SPECIFIED | The source does not decide it. It is not filled with a generic product rule |

SOURCE. The React app does not call Apps Script. Business data is the in-memory `AppData` object, persisted to `localStorage` key `stockflow-prototype-v8`, excluding the `ui` slice. Seed data is `createSeedData()`. Reset demo reloads that seed. Attachment bytes for Halal certificates and sales-return evidence use `src/store/attachmentBlobs.ts` (IndexedDB). Other photos are data URLs on the record.

## 3. System architecture

```text
Existing React/Vite UI
        ↓
API adapter with the same db method names the UI already calls
        ↓
Apps Script doPost envelope v1
        ↓
Router → service → repository
        ↓
Existing Google Sheet / existing Drive root
```

SOURCE. Package `stockflow` 0.1.0, React 19, Vite, React Router. Entry `index.html` → `src/main.tsx`.

INFERENCE. The adapter sits behind the existing `db` / `useApi()` calls. Screens, routes, labels, and validation toasts stay. The adapter is not a second UI.

Phase 1 envelope stays the only HTTP shape:

```text
{ v: 1, requestId, action, payload, idempotencyKey? }
→ { ok, data, error, meta }
```

`doGet` remains `system.health`. It does not serve the React app.

## 4. Locked frontend boundary

Locked at `70b6a4b`:

- Sidebar groups and items, desktop section collapse, mobile drawer with no section collapse
- Every route in `src/App.tsx` (section 34)
- Forms, buttons, field labels, terminology, calculations, validations, toasts
- Status unions in `src/types/index.ts`
- Print layouts in this commit, including quotation and invoice signature boxes
- Permission keys in `src/features/settings/permissions.ts`
- `localStorage` and seed as the behavior reference, not the production source of truth

The backend reproduces these outcomes. It does not replace them with a simpler flow.

## 5. Backend boundary

Reuse Phase 1. Do not create a second project, spreadsheet, Drive root, or foundation.

Already present and kept:

- `system.health`, `system.ping`
- Envelope and error codes
- `AuditLogs`, `Idempotency`, `Counters`
- `withScriptLock` for idempotency and counters
- Sheet repository and `storage/driveStorage.js`
- DEV-only config via Script Properties
- Deploy DEV = `clasp push` only

New business actions are added to the existing router. Unknown actions remain `UNKNOWN_ACTION` until that module is implemented.

`authenticate()` / `authorize()` stay the only identity hook. This blueprint does not add a second login system. The session-provider design is NOT SPECIFIED (Bible §6, Phase 2 and Phase 13).

## 6. Data layer

Production business rows live in the existing spreadsheet. One entity has one tab. Nested arrays in a TypeScript object become child tabs. That split is INFERENCE so Sheets can store the arrays the UI already saves. It is not a new entity.

`Sheet1` stays. It is not a product table.

Authoritative quantity is the inventory balance row plus the movement ledger written in the same post. The React page must not recompute stock and write it back as truth.

`settings.costingMethod` (`average` | `fifo`) is stored and shown. SOURCE: no `db.ts` stock post reads it. Posting does not invent average-cost logic.

## 7. Drive layer

One Drive root, the existing DEV root. No second root. No `ProductImages` folder: SOURCE, the `Product` type has no image field, and Phase 1 must not create that folder.

Files the UI actually stores are listed in section 12. Child folder names are NOT SPECIFIED. INFERENCE for implementation: one child folder under the existing root, used only as a container, with the file id stored on the owning record. The folder is not a second root and is not `ProductImages`.

## 8. Complete module inventory

Verified from routes plus `db` methods. Menu presence was not treated as proof; each row has a writer or a reader in source.

| Module | Routes | What the UI actually does |
| --- | --- | --- |
| Dashboard | `/` | Reads store totals and recent rows. Date preset is UI state |
| Products | `/products`, `/products/raw-materials` | CRUD, status, SKU, units, cost, sellable, sales components |
| Categories | `/categories` | Create, rename |
| Pricing | `/products/pricing`; `/sales/agents/pricing` redirects | Agent, selling, and wholesale prices |
| Customers | `/customers` | Create, wholesale price, deactivate price |
| Suppliers | `/suppliers` | Create |
| Agents | `/sales/agents`, `/sales/agents/:id` | CRUD, status, stock transfer, agent sale, earnings, withdrawal |
| Sales / POS | `/sales`, `/pos` | Create sale, wholesale sale, void, pay, print receipt |
| Quotations | `/sales/quotations` and new/edit/detail | CRUD, status, convert to invoice, print |
| Invoices | `/sales/invoices/:id` | Detail of a sale, print |
| Delivery orders | `/sales/delivery-orders` and new/edit/detail | CRUD, status, print |
| Sales returns | `/sales/returns` and new/detail; `/sales-returns` redirects | Draft, update, confirm, cancel, sources, reasons |
| Purchases | `/purchases`, `/purchases/new` | Create, receive all lines, pay |
| Purchase returns | `/purchase-returns` | Create return |
| Receiving | `/receiving` and new/detail | Create, link to purchase, photo |
| Opening balance | `/inventory/opening-balance` and `:id` | Draft, update, confirm, Excel/CSV import and export |
| Inventory | `/inventory` | Quantity and status |
| Stock usage | `/inventory/stock-usage` | Usage out |
| To order | `/inventory/to-order` | Queue at or below Min Stock, mark ordered, cancel |
| Stock documents | `/stock-movements`, `/stock-adjustment`, `/stock-transfer`, `/stock-count` | List, adjust, transfer, count |
| Warehouse map | `/inventory/warehouse-map` | Locations, place, move, top up, empty, rename, deactivate, use balance |
| BOM | `/manufacturing/bom` | CRUD, active/inactive, AUTO/MANUAL |
| Manufacturing dashboard | `/manufacturing` | Read sessions and orders |
| Today’s production | `/manufacturing/today`, `/:id` | Plan, accept, start, pick, amend, cancel planned |
| Complete production | `/manufacturing/complete`, `/:id` | Result, distribution, material closing, complete |
| Carry forward | `/manufacturing/carry-forward` | Resume a short line |
| History | `/manufacturing/history` and edit/detail | Read, edit completed session and closing |
| Session records | `/manufacturing/consumption`, `/manufacturing/finished-goods` | Read session records. Not sidebar items |
| Production orders | `/manufacturing/orders` and new/detail | Separate from sessions. Not sidebar items |
| Planning / picking | `/manufacturing/planning`, `/manufacturing/picking` | Read and act on sessions |
| Packing | `/manufacturing/packing` and new/detail | Draft, refresh snapshot, confirm, cancel |
| Sales import | `/sales/import`, `/mappings`, `/:batchId` | Account, batch, picking PDF, AWB PDF, map, confirm into sales |
| Dispatch | `/sales/dispatch`, `/:id` | Draft, confirm, void, inspection group |
| Vehicles | `/settings/vehicles` | CRUD, active flag |
| PJKM | `/pjkm`, `/pjkm/5.1.1`, `/pjkm/9.1.1`, `/pjkm/10.1.1` | Build from receiving, dispatch, or movements. Browser print |
| Halal | `/compliance/halal` | Manufacturers, certificates, compliance, verify on save |
| BMR | `/compliance/bmr`, `/manufacturing/bmr/:sessionId` | List completed posted sessions, browser print |
| Tasks | `/tasks`, manage, categories, detail | Category, task, start, photo, complete |
| Finance | `/payments`, `/receivables`, `/payables`, `/expenses` | Payments table, derived open sales/purchases, expenses |
| Reports | `/reports/sales`, `purchases`, `inventory`, `profit`, `manufacturing` | Aggregates, CSV export, browser print |
| Users and roles | `/settings/users` | Users, departments, roles, permission matrix |
| Settings | `/settings/business`, `inventory`, `sales`; `/settings/payments` renders sales settings | Settings fields, reset demo |

UI-only, not business entities: toasts, drawers, quick modals, sidebar collapsed, mobile nav open, date preset, current acting user. SOURCE: `UiState`. The acting user is a prototype switcher. It is not a second identity system.

## 9. Complete entity model

Persistent entities are the arrays on `AppData` (`src/types/index.ts`). Primary key is the existing `id` string unless noted. Human numbers are the document series in section 25. Column lists below are the source fields. Child tabs hold array fields.

Common rules, SOURCE unless marked:

- Status values are the TypeScript unions. No new statuses.
- A posted or confirmed document does not post again. Guards are in `db.ts`.
- Timestamps and actor names are the fields the type already has (`createdAt`, `createdBy`, and the step-specific `*By` / `*At` fields). A global `updatedBy` on every table is NOT SPECIFIED where the type has no such field.
- Deactivation is `status: inactive` or `active: false` where the type has that flag. Hard delete of posted business rows is NOT SPECIFIED and is not added.
- Snapshot fields stay on the document that captured them. Later master edits do not rewrite the snapshot.

### Master data

| Entity | Purpose | Human id | Status | Notes |
| --- | --- | --- | --- | --- |
| Warehouse | Company or agent stock location | `code` | kind `company` \| `agent` | Agent warehouse is created with the agent |
| Category | Product grouping | name | none | Rename in place |
| Product | SKU master, raw or finished | `sku` | `active` \| `inactive` | SKU immutable once `productIsUsed`. Empty SKU becomes a unique 6-digit code from 100001. `sellable !== false` means sellable. `salesComponents` is a child tab |
| Customer | Buyer | name | none on type | Wholesale prices are separate rows |
| CustomerWholesalePrice | Price per customer and product | id | `active` flag | Deactivate, do not delete the history by a new rule |
| Supplier | Vendor | name | none | |
| Agent | Linked user, bank, warehouse | `code` | `active` \| `inactive` | |
| Vehicle | Dispatch vehicle | `code` | `active` | |
| Manufacturer | Halal party | name | none beyond the type | |
| HalalCertificate | Certificate file and verify state | `certificateNo` | `pending` \| `verified` | Verify is a save, not a separate function |
| RawMaterialHalalCompliance | Product + manufacturer + certificate | id | verification on the certificate | |
| ReturnSource / ReturnReason | Return lookups | name | `active` | |
| StaffTaskCategory | Task grouping | name | `active` \| `inactive` | |
| Role / Department / User | Access master | name / email | `active` \| `inactive` | Owner role cannot be deactivated. Owner user has full permissions |

### Documents and transactions

| Entity | Purpose | Human id | Status |
| --- | --- | --- | --- |
| Sale | Invoice / POS / wholesale sale | `invoiceNo` | `paid` \| `unpaid` \| `partial` \| `voided` \| `returned` |
| Sale line | `LineItem` | parent + line | `returnedQty` accumulates |
| Quotation | Quote | `quotationNo` | `draft` \| `sent` \| `accepted` \| `rejected` \| `expired` \| `cancelled` |
| DeliveryOrder | Delivery | `doNo` | `draft` \| `issued` \| `delivered` \| `cancelled` |
| Purchase | Supplier bill | `purchaseNo` | `draft` \| `pending` \| `received` \| `partial` \| `paid`. `partial` is payment, not partial goods receipt |
| Receiving | Goods in, with or without a purchase | `receivingNo` | `completed` only |
| PurchaseReturn | Return to supplier | `returnNo` | no status union |
| SalesReturn | Customer return | `RT-` number | `draft` \| `confirmed` \| `cancelled` |
| Payment | Customer or supplier payment | `paymentNo` | `completed` \| `pending` |
| Expense | Spend | id only | category enum |
| StockOrder | To-order marker | none; audit uses SKU | `ordered` \| `received` \| `cancelled` |
| OpeningBalance | Go-live stock | `documentNo` `OB-` | `draft` \| `confirmed` |
| ProductionOrder | Order-based production, not the daily session | `orderNo` `PO-` | `draft` \| `planned` \| `in_progress` \| `paused` \| `completed` \| `cancelled` |
| ProductionSession | Daily session | `reference` `PROD-YYYYMMDD-###` | `planned` \| `accepted` \| `in_progress` \| `completed` \| `cancelled` |
| PackingAssembly | BOM conversion | `packingNo` `PA-` | `draft` \| `confirmed` \| `cancelled` |
| Bom | Recipe | name | `active` \| `inactive` |
| AgentSale | Agent checkout linked to a sale | sale invoice | |
| AgentWithdrawal | Payout | id | `requested` \| `processing` \| `paid` \| `cancelled` |
| ImportBatch | One import run | id | `draft` \| `ready` \| `partial` \| `confirmed` |
| DispatchRecord | Day vehicle dispatch | date + vehicle, no sequential number | `draft` \| `confirmed` \| `void` |
| InspectionGroup | Group of dispatches | `groupNo` `IG-` | `confirmed` \| `released` |
| StaffTask / Occurrence | Work | title | occurrence `pending` \| `in_progress` \| `completed` |

### Ledger and location

| Entity | Purpose | Key |
| --- | --- | --- |
| InventoryRow | On-hand qty | `productId` + `warehouseId` |
| StockMovement | Immutable ledger line | `id`. Unique business key is not a single number; `reference` + `type` + product ties it to a document |
| DisplayStock | Loose display qty | product + warehouse. Not a map slot. Does not change inventory total on top-up |
| ProductionBalance | Grams balance | `id`. Not saleable packs |
| Batch | Lot from `completeProduction` | `batchNo` |
| StorageLocation / StorageSlot / SlotOccupancy | Map | slot id `` `${locationId}-l{level}-{face}-{slotNo}` `` |
| PlacementLog / BalanceUsageLog | Map history | append only |

### Import, audit, config

Sales import: Account, Batch, File (metadata + parsed lines, not the PDF bytes), Order, Line, Mapping, Shipment.

Audit already in the prototype: `DocumentAuditLog`, `UserAuditLog`, session `materialAudits`, `targetChanges`, `completedEdits`. Phase 1 `AuditLogs` is the backend append log. INFERENCE: business posts append Phase 1 `AuditLogs` and still return the same prototype audit rows the screens list, stored in their own tabs. One log is not deleted in favor of the other.

`Settings` is one row: business identity, `logoUrl`, bank, `currency`, `defaultWarehouseId`, `allowNegativeStock`, `costingMethod`, `batchTracking`, `expiryTracking`, `allowDiscount`, `allowReturns`, `enabledPaymentMethods`, `roleMatrix`.

`AppNotification` is a list the UI marks read. It is not a stock document.

## 10. Entity relationships

Only relationships the UI uses.

```text
Category 1—* Product
Warehouse 1—* InventoryRow
Product + Warehouse 1—1 InventoryRow
Product 1—* SalesComponent
Product 1—* Bom (output product) and Bom 1—* BomItem (component product)
Customer 1—* Sale, Quotation, DeliveryOrder, CustomerWholesalePrice
Supplier 1—* Purchase, Receiving
Purchase 1—* PurchaseLine
Purchase 0—1 Receiving          (purchase.receivingId; stock posts once)
Receiving 1—* ReceivingLine
Sale 1—* SaleLine 1—* SalesComponentSnapshot
Quotation 0—1 Sale              (convertQuotationToInvoice)
Sale 0—* DeliveryOrder          (saleId / invoiceNo)
Sale 1—* Payment                (customer)
Purchase 1—* Payment            (supplier)
Sale 1—* SalesReturn            (optional link)
SalesReturn confirm updates Sale.returnedQty and may set status returned
Agent 1—1 Warehouse (kind agent)
Agent 1—* AgentSale 1—1 Sale
Agent 1—* AgentEarningLedger
Agent 1—* AgentWithdrawal
ProductionSession 1—* SessionItem *—1 Product
SessionItem 0—1 carriedFrom SessionItem
Session 1—* PickingLine, MaterialAllocation, MaterialClosingLine
ProductionOrder 1—* Consumption, Wastage
PackingAssembly 1—1 Bom snapshot
OpeningBalance 1—* lines → inventory and/or display and/or slot and/or production balance
SalesImportAccount 1—* Batch 1—* File, Order, Line
Mapping *—* reused by platform+account+key
Shipment *—1 Import order; DispatchLine *—1 Shipment
Dispatch *—* InspectionGroup membership
HalalCompliance *—1 Product, Manufacturer, Certificate
StaffTask 1—* Occurrence
User *—1 Role, *—1 Department
```

Cardinality is one-to-many unless marked. Sales-component snapshot is a document snapshot, not a live link. BOM snapshot on packing is the same kind of copy. Many-to-many: a product can be a component of many BOMs and a BOM has many products; stored as BomItem rows, not a duplicate product master.

No Customer Order entity exists beyond Sale, Quotation, and import orders. Do not add one.

## 11. Google Sheets architecture

Existing system tabs stay: `Sheet1`, `AuditLogs`, `Idempotency`, `Counters`.

New tabs, one each:

**Configuration:** `Settings`, `Departments`, `Roles`, `RolePermissions`, `Users`, `UserAuditLogs`, `Notifications`

**Master:** `Warehouses`, `Categories`, `Products`, `SalesComponents`, `Customers`, `CustomerWholesalePrices`, `Suppliers`, `Agents`, `Vehicles`, `Manufacturers`, `HalalCertificates`, `HalalCompliances`, `ReturnSources`, `ReturnReasons`, `StaffTaskCategories`

**Transactions:** `Sales`, `SaleLines`, `SaleLineComponents`, `Quotations`, `QuotationLines`, `DeliveryOrders`, `DeliveryOrderLines`, `DocumentAuditLogs`, `Purchases`, `PurchaseLines`, `Receivings`, `ReceivingLines`, `PurchaseReturns`, `PurchaseReturnLines`, `SalesReturns`, `SalesReturnLines`, `SalesReturnEvidence`, `Payments`, `Expenses`, `StockOrders`, `OpeningBalances`, `OpeningBalanceLines`, `Boms`, `BomItems`, `ProductionOrders`, `ProductionConsumptions`, `ProductionWastage`, `PackingAssemblies`, `PackingSnapshotItems`, `ProductionSessions`, `ProductionSessionItems`, `PickingLines`, `ExcessReturns`, `TargetChangeLogs`, `CompletedEditLogs`, `MaterialClosings`, `MaterialClosingLines`, `MaterialAllocations`, `MaterialAudits`, `AgentSales`, `AgentSaleLines`, `AgentEarningLedgers`, `AgentWithdrawals`, `SalesImportAccounts`, `SalesImportBatches`, `SalesImportFiles`, `SalesImportOrders`, `SalesImportLines`, `SalesImportMappings`, `SalesImportShipments`, `Dispatches`, `DispatchLines`, `InspectionGroups`, `StaffTasks`, `StaffTaskOccurrences`, `Batches`

**Ledger:** `InventoryBalances`, `StockMovements`, `DisplayStocks`, `ProductionBalances`, `BalanceUsageLogs`

**Warehouse:** `StorageLocations`, `StorageSlots`, `SlotOccupancies`, `PlacementLogs`

Rules for every new tab:

| Rule | Value |
| --- | --- |
| Primary key | `id`, except `InventoryBalances` (`productId` + `warehouseId`) and `RolePermissions` (`roleId` + `permissionKey`) and `Settings` (single row id `settings`) |
| Human number | unique where section 25 names a series |
| Types | string, number, boolean, or ISO timestamp, matching the TypeScript field |
| Required | fields the `db.ts` writer always sets. Optional fields are the `?` fields on the type |
| Foreign keys | ids in section 10. Repository checks the parent exists |
| Search keys | human number, `date`, `status`, `productId`, `warehouseId`, `customerId`, `reference` |
| Audit | posted documents also append Phase 1 `AuditLogs`. Movement rows are not updated |
| Snapshot columns | `salesComponentsSnapshot` fields, packing snapshot items, dispatch line tracking snapshot, import `mappedProductSnapshot` |

`RolePermissions` flattens `settings.roleMatrix`. INFERENCE, same booleans.

Do not add a second inventory table per module. Sales, manufacturing, receiving, and packing all write `InventoryBalances` and `StockMovements` through one posting service.

## 12. Google Drive architecture

| File | Source module | Related record | Today | Backend |
| --- | --- | --- | --- | --- |
| Recipe photo | `startSession` | `ProductionSession.id` | data URL on the session | Drive file. Field keeps file id and name. Required to start |
| Receiving photo | receiving create | `Receiving.id` | data URL | Drive file. Optional unless the form already requires it |
| Task completion photo | task complete | occurrence id | data URL, image, max 5 MB | Drive file. Required when `photoRequirement` is `required` |
| Sales-return evidence | return | `SalesReturn.id` | metadata + IndexedDB blob | Drive file, many per return |
| Halal certificate | halal save | `HalalCertificate.id` | IndexedDB, PDF/JPG/PNG, max 5 MB | Drive file. Replace uses existing Drive replace (trash previous). INFERENCE from single `documentFileId` |
| Company logo | business settings | Settings row | data URL | Drive file |
| Withdrawal receipt | agent pay | `AgentWithdrawal.id` | data URL | Drive file |
| Sales-import PDF | picking and AWB ingest | `SalesImportFile.id` | hash + parsed text only. Bytes discarded | Do not invent PDF retention. Store `fileName`, `fileHash`, parsed lines |

Access: the script reads and writes as the existing Drive root owner. Shared-link access is not the model (Bible). Retention period is NOT SPECIFIED. The UI does not version files except by replacing the single field.

## 13. API contract

Transport stays `doPost` with `v: 1`. Action names mirror `db` methods. INFERENCE: the name is the contract id; the behavior is the source function.

Errors use Phase 1 codes. Validation failures that are toasts today become `VALIDATION_ERROR` with the same message. Permission denial becomes `FORBIDDEN` with the same toast text. Missing rows are `NOT_FOUND`. Posting a document that is already posted is `CONFLICT`. Reusing an idempotency key for another action is `DUPLICATE_REQUEST`.

Idempotency: any action in the posting list (section 18) requires an `idempotencyKey`. Replay returns the stored success. Status guards still apply.

Permission: the string is the existing `PermissionKey`. Owner still passes every key. INFERENCE: the service calls `authorize(principal, key)` once that returns a real decision. Until the Phase 2 provider exists, the hook stays, and a module must not invent a password store.

### Actions by module

| Action | db function | Writes | Permission | Idempotent post |
| --- | --- | --- | --- | --- |
| `settings.get` / `settings.update` | `updateSettings` | Settings | `settings.view` / `settings.edit` | update no |
| `settings.resetDemo` | `resetDemo` | reloads seed | settings | no. Prototype only. Not a production data API |
| `users.list/create/update` | `createUser`, `updateUser` | Users, user audit | `users.*` | no |
| `users.switch` | `switchUser` | UI current user only | prototype switcher | no. Stays client UI state |
| `roles.*` / `departments` via user payloads | `createRole`, `updateRole`, `setRoleStatus`, `saveRolePermissions` | Roles, RolePermissions | `roles.*` | no |
| `categories.create/rename` | `createCategory`, `renameCategory` | Categories | product screens | no |
| `products.list/get/create/update/setStatus` | matching db methods | Products, InventoryBalances at 0 | product screens | create no |
| `products.saveAgentPrices` | `saveAgentPrices` | product prices | `agent.manage` | no |
| `customers.create` | `createCustomer` | Customers | sales | no |
| `customers.saveWholesalePrice` / `deactivateWholesalePrice` | matching | CustomerWholesalePrices | `customer.pricing.manage` | no |
| `suppliers.create` | `createSupplier` | Suppliers | purchases | no |
| `agents.create/update/setStatus` | matching | Agents, Warehouses | `agent.manage` | no |
| `agents.transferStock` | `transferStockToAgent` | ledger | `agent.stock.transfer` | yes |
| `agents.createSale` | `createAgentSale` | Sale, AgentSale, ledger, earnings | `agent.sale.create` | yes, already replayed by `requestId` |
| `agents.requestWithdrawal` / `pay` / `cancel` | matching | withdrawal + earning ledger | withdrawal keys | yes |
| `sales.create` / `sales.createWholesale` | `createSale`, `createWholesaleSale` | Sales, lines, components, ledger, optional Payment | `sales.create` | yes |
| `sales.void` | `voidSale` | status voided, ledger in | `sales.void` | yes |
| `sales.recordPayment` | `recordPayment` customer | Payment, sale paid/balance/status | payments | yes |
| `quotations.create/update/setStatus/convert` | matching | Quotations, and Sale on convert | quotation keys | convert yes |
| `deliveries.create/update/setStatus` | matching | DeliveryOrders | delivery keys | no |
| `documents.recordPrint` | `recordDocumentPrint` | DocumentAuditLogs | matching `*.print` | no |
| `returns.save/update/confirm/cancel` | matching | SalesReturns, ledger on confirm | `sales_return.*` | confirm yes |
| `returns.upsertSource/Reason` / `setActive` | matching | lookups | `return_source.manage` / `return_reason.manage` | no |
| `purchases.create/receive` | matching | Purchases, ledger if not linked to receiving | `purchases.*` | receive yes |
| `purchases.recordPayment` | `recordPayment` supplier | Payment, purchase balance | purchases | yes |
| `purchaseReturns.create` | `createPurchaseReturn` | return + ledger out | purchases | yes |
| `receivings.create/linkPurchase` | matching | Receivings, ledger, may link purchase and stock order | `receiving.*` | create yes |
| `openingBalances.save/update/confirm` | matching | document, then ledger/display/slots/balances | `opening_balance.*` | confirm yes |
| `inventory.adjust/usage/transfer/count` | matching | ledger | inventory keys | yes |
| `inventory.markOrdered/cancelOrder` | matching | StockOrders | `inventory.view` for to-order | no |
| `warehouse.place/move/topUp/empty/rename/deactivate/createRack/createTemporary/useBalance` | matching db methods | map tables or production balance. Not inventory qty, except none of these change `InventoryBalances` | warehouse_map keys | place/move/topUp/empty/useBalance yes |
| `boms.create/update/setStatus` | matching | Boms, then product cost via `applyBomCosts` | manufacturing | no |
| `packing.create/update/refresh/cancel/confirm` | matching | Packing, ledger on confirm | manufacturing create/edit/complete | confirm yes |
| `productionOrders.create/update/start/pause/resume/cancel/updateConsumption/addLine/confirmConsumption/recordWastage/complete/createPurchaseRequest` | matching | orders. Ledger only on `complete` | manufacturing keys | complete yes |
| `sessions.create/accept/start/cancelPlanned/amend/changeTarget/togglePicking/addMaterial/saveResult/saveDistribution/saveMaterialClosing/complete/continueCarryForward/editCompleted/editCompletedClosing` | matching | session children. Ledger only on complete and the two completed edits | plan, amend, completed.edit, and `canEditSession` | complete and stock edits yes |
| `salesImport.*` | account, batch, ingest picking, ingest awb, acknowledge, spot check, mapping CRUD, confirm | import tables. Confirm calls the same sale post | `sales.create` to import; view needs `sales.view` or `sales.create` | confirm yes |
| `vehicles.create/update/setActive` | matching | Vehicles | `settings.edit` | no |
| `dispatch.create/update/confirm/void` | matching | Dispatches | delivery create/edit | confirm/void yes |
| `dispatch.createInspectionGroup/release` | matching | InspectionGroups | `sales.delivery.edit` | yes |
| `halal.saveManufacturer/saveCompliance` | `createManufacturer`, `updateManufacturer`, `saveHalalCompliance` | Halal tabs + Drive | `halal.manage` | no |
| `tasks.*` | category, task, occurrence start/photo/complete | Tasks | task keys | complete yes if photo required |
| `expenses.create` | `createExpense` | Expenses | `expenses.manage` | no |
| `reports.sales/purchases/inventory/profit/manufacturing` | page aggregations | read only | `reports.view` | no |
| `pjkm.511/911/1011` | `buildPjkm511/911/1011` | read only | `receiving.view` for PJKM menu | no |
| `bmr.get` | print data for a posted completed session | read only | `manufacturing.history.view` | no |
| `dashboard.get` | dashboard aggregates for the date preset | read only | `dashboard.view` | no |

`users.switch` and `settings.resetDemo` stay available in the prototype adapter until identity cutover. They are not production posting APIs.

List/get actions exist for every tab the screens render. They are the read side of the same services. They are not extra workflows.

## 14. Frontend → API mapping

The UI keeps calling the same `db` methods. The adapter forwards them.

| Frontend call | Action | Service | Repository | Sheet / Drive |
| --- | --- | --- | --- | --- |
| Product form save | `products.create` or `products.update` | MasterData | Product, Inventory | `Products`, `SalesComponents`, `InventoryBalances` |
| Category save | `categories.create` / `rename` | MasterData | Category | `Categories` |
| Pricing save | `products.saveAgentPrices` | MasterData | Product | `Products` |
| Customer / wholesale | customer actions | MasterData | Customer | `Customers`, `CustomerWholesalePrices` |
| Supplier save | `suppliers.create` | MasterData | Supplier | `Suppliers` |
| Agent save | `agents.create` / `update` | MasterData | Agent, Warehouse | `Agents`, `Warehouses` |
| POS / sale save | `sales.create` | Sales → Inventory | Sale, Movement | `Sales`, `SaleLines`, `SaleLineComponents`, `InventoryBalances`, `StockMovements`, `Payments` |
| Void / pay | `sales.void` / `sales.recordPayment` | Sales → Inventory | same | same |
| Quotation convert | `quotations.convert` | Sales | Quotation, Sale | quotation tabs + sale tabs |
| Delivery save | `deliveries.*` | Sales | Delivery | delivery tabs |
| Print | `documents.recordPrint` | Sales | DocumentAudit | `DocumentAuditLogs`. PDF stays browser print |
| Sales return confirm | `returns.confirm` | Returns → Inventory | Return, Movement, Drive | return tabs, ledger, Drive |
| Purchase receive | `purchases.receive` | Purchasing → Inventory | Purchase, Movement | purchase tabs, ledger |
| Receiving save | `receivings.create` | Receiving → Inventory | Receiving, Drive | receiving tabs, ledger, Drive |
| Opening balance confirm | `openingBalances.confirm` | Inventory | Opening, Movement, Warehouse | OB tabs, ledger, display, slots, production balances |
| Adjust / usage / transfer / count | inventory actions | Inventory | Movement | ledger tabs |
| To order | `inventory.markOrdered` / `cancelOrder` | Inventory | StockOrder | `StockOrders` |
| Map actions | `warehouse.*` | Warehouse | Location, Slot | warehouse tabs, `DisplayStocks`, `ProductionBalances` |
| BOM save | `boms.*` | Manufacturing | Bom, Product | `Boms`, `BomItems`, `Products` cost |
| Packing confirm | `packing.confirm` | Manufacturing → Inventory | Packing, Movement | packing tabs, ledger |
| Session complete | `sessions.complete` | Manufacturing → Inventory | Session, Movement | session tabs, ledger, display, production balances, Drive for the recipe photo already stored at start |
| Production order complete | `productionOrders.complete` | Manufacturing → Inventory | Order, Batch, Movement | order tabs, `Batches`, ledger |
| Import confirm | `salesImport.confirm` | SalesImport → Sales | Import, Sale | import tabs + sale post |
| Dispatch confirm | `dispatch.confirm` | Dispatch | Dispatch | `Dispatches`, `DispatchLines` |
| Halal save | `halal.saveCompliance` | Compliance | Halal, Drive | halal tabs, Drive |
| Task complete | `tasks.complete` | Tasks | Task, Drive | task tabs, Drive |
| Expense | `expenses.create` | Finance | Expense | `Expenses` |
| Reports / PJKM / BMR / dashboard | report and read actions | Reporting | read repositories | no write |

## 15. Service architecture

Services call repositories. They do not call `SpreadsheetApp`. The React app does not call `SpreadsheetApp`.

| Service | Responsibility | Depends on |
| --- | --- | --- |
| SystemService | health, ping | existing |
| AuditService, IdempotencyService, CounterService | existing foundation | existing |
| IdentityService | users, roles, departments, role matrix, user audit | Counter not required |
| MasterDataService | warehouses, categories, products, SKU, customers, suppliers, agents, vehicles, prices | Identity for permission keys, Inventory to add zero balances |
| InventoryService | the only writer of `InventoryBalances` and `StockMovements`; also display delta, production balance qty, opening balance, usage, adjust, transfer, count, stock orders | Counter, Audit, lock |
| WarehouseService | locations, slots, occupancy, placement log, top-up display, use balance | InventoryService only for balance qty, never for inventory qty |
| PurchasingService | purchases, purchase returns, supplier payments | InventoryService |
| ReceivingService | receiving and purchase link | InventoryService, PurchasingService |
| SalesService | sales, POS, quotations, deliveries, customer payments, print audit | InventoryService, MasterData |
| ReturnsService | sales returns and lookups | InventoryService, Drive |
| ManufacturingService | BOM, packing, production orders, sessions, carry forward | InventoryService, WarehouseService, Drive |
| SalesImportService | parse results, mapping, confirm | SalesService. Parsing of PDF bytes stays in the browser as it does now. SOURCE: `extractPdfTextItems` runs in the client. The API receives parsed items plus hash and file name |
| DispatchService | dispatch and inspection groups | SalesImport shipments already stored |
| ComplianceService | halal writes; PJKM and BMR reads | Drive, read models |
| TaskService | tasks | Drive |
| FinanceService | expenses. Receivables and payables are queries over sales and purchases | none for posting stock |
| ReportingService | the five report pages and dashboard reads | read only |

Posting rule: a service that changes stock calls `InventoryService.post`. It does not write movement rows itself.

Transaction rule, INFERENCE from current all-or-nothing `setData` updates: a post writes the document, the lines, the movements, and the balance changes under `withScriptLock`, then appends audit, then stores the idempotent response. A failure writes none of the stock rows.

`canEditSession` in `sessionPlan.ts` remains a manufacturing rule beside the permission keys. Do not drop it when the matrix is enforced.

## 16. Repository architecture

One repository per tab group. Sheet access stays in the existing sheet repository style (`getRange` 4-argument form, header row, no overwrite of mismatched headers).

| Repository | Tabs | Reads | Writes | Deactivate | Lock |
| --- | --- | --- | --- | --- | --- |
| ConfigRepository | Settings, notifications | get | update | none | no |
| IdentityRepository | Users, Roles, Departments, RolePermissions, UserAuditLogs | list, get | create, update, append audit | status flag | user/role status change |
| MasterRepository | products, parties, agents, vehicles, categories, prices, sales components | list, get, by SKU, by code | create, update | product/agent/vehicle/price flags | SKU uniqueness |
| InventoryRepository | balances, movements, display, production balances, balance usage, batches, stock orders, opening balances | balance by product+warehouse, movements by reference | append movement, set balance, confirm OB | stock order cancel | yes on post |
| WarehouseRepository | locations, slots, occupancy, placement logs | by warehouse, by slot | place, move, empty, rename, deactivate | location inactive, history kept | yes on occupancy change |
| PurchasingRepository | purchases and returns | list, get | create, set status | none | yes on receive and return |
| ReceivingRepository | receivings | list, get | create, link | none | yes on create |
| SalesRepository | sales, quotations, deliveries, payments, document audit | list, get, by number, by reference | create, set status | void/cancel flags | yes on sale post, void, pay, convert |
| ReturnsRepository | sales returns, sources, reasons, evidence metadata | list, get | save, confirm, cancel | lookup active flag | yes on confirm |
| ManufacturingRepository | boms, orders, packing, sessions and child tabs | list, get | the session and order methods | BOM inactive, packing cancel | yes on complete and packing confirm |
| ImportRepository | import tabs | by batch, by hash, by reference | ingest, map, confirm markers | mapping active flag | yes on confirm |
| DispatchRepository | dispatches, groups, vehicles | by date, by shipment | create, confirm, void | vehicle inactive | yes on confirm/void |
| ComplianceRepository | halal tabs | list | save | none | no |
| TaskRepository | tasks | list, by occurrence | create, start, complete | category/task inactive | yes on complete |
| FinanceRepository | expenses | list | create | none | no |
| DriveStorage | existing helper | get, upload, replace | trash on replace | n/a | with the parent post |
| AuditRepository, IdempotencyRepository, CounterRepository | existing | existing | existing | none | existing |

Search is by the columns the screens filter: date range, warehouse, status, text on number/name/SKU. INFERENCE: repositories filter in memory after a bounded read until a later index is specified. No new query language.

## 17. Inventory and ledger architecture

Three layers. Do not collapse them.

| Layer | Store | Meaning |
| --- | --- | --- |
| Document | sale, purchase, receiving, session, packing, adjustment reference | The business event |
| Ledger | `StockMovements` | Append-only. `balance` on the row is the on-hand after that line, matching `addMovement` |
| Balance | `InventoryBalances` | Current qty. Updated only inside the same post as the movement |
| Location | display, slots, production balance | Physical or gram records. Top-up and place do not change `InventoryBalances` |

`addMovement` rule, SOURCE: `balance = current + stockIn - stockOut`, unless `skipInventory`, in which case the movement row is still written and inventory qty is unchanged.

| Movement type | Effect on inventory qty | Writer |
| --- | --- | --- |
| `purchase` | in | create/receive purchase when not linked to a receiving |
| `receiving` | in | createReceiving |
| `opening_balance` | in, except pure production-balance documents | confirm opening balance |
| `sale` | out, on the component SKU when a snapshot exists, otherwise the sold SKU | createSale |
| `sales_return` | in | voidSale only |
| `sales_return_good` | in | return confirm |
| `sales_return_repack` | no. Grams go to production balance | return confirm |
| `sales_return_waste` | no (`skipInventory`) | return confirm |
| `purchase_return` | out | createPurchaseReturn |
| `adjustment` | in or out | adjustStock, completed-session edits |
| `transfer_out` / `transfer_in` | out then in, same reference | transfer and agent transfer |
| `stock_count` | difference | completeStockCount |
| `stock_usage` | out | recordStockUsage |
| `production_out` | out | packing, completeProduction, completeSession, excluding MANUAL components |
| `production_in` | in | those completes, finished qty |
| `production_wastage` | no | session waste note |
| `production_balance_in` / `out` | no | production balance grams |
| `opening_stock` | not written by `db.ts` | seed only. Do not invent a new writer |

`allowNegativeStock` blocks the shortage paths that already consult it. Agent transfer and agent sale do not use that flag to go negative. SOURCE.

Duplicate posting: the document `posted` flag or the status guard is the business lock. The idempotency key is the request lock. Both are required for the posting actions. A second confirm returns the first result or `CONFLICT` if the key differs and the document is already posted.

FIFO for production balance consumption is `allocateBalanceFifo`: same `productId`, sort `productionDate` then `id`. SOURCE. This is not `settings.costingMethod`.

There is no partial purchase receipt. Do not add one.

## 18. Manufacturing architecture

Two flows. Do not merge them.

**Daily session**

`planned` → accept → `accepted` → start (recipe photo required, evidence only, BOM unchanged) → `in_progress` → optional step saves → complete → `completed` + `posted`.

`planned` may cancel. Amend target only in `accepted` or `in_progress`, with a reason, permission `manufacturing.plan.amend`, and new target not below actual.

Step 2: for each product, display qty + carton qty = actual qty. Step 3 labels stay Expected Remaining, Physical Remaining, Actual Used, Variance, plus acknowledgement. Complete refuses an unacknowledged closing.

Stock posts only on complete, and on later completed edits:

- Balance grams out, `skipInventory`
- AUTO raw materials out by actual used qty
- MANUAL components do not auto-post
- Finished packs in
- Display qty increases display stock
- Production balance grams in
- Packaging waste is a wastage movement with `skipInventory`

Carry forward creates or extends a later session line with `carriedFromItemId`. The origin session is not reopened. Multiple products per session stay. Step actors and timestamps stay on the fields the session already has.

**Production order**

Separate status machine including pause. Stock posts only on `completeProduction`: AUTO components out, finished goods in, a `batches` row. Wastage records on the order do not by themselves post inventory. Pause, resume, and consumption edits do not post.

**Packing**

Draft holds a BOM snapshot. Confirm posts AUTO components out and output in, or refuses shortage unless `allowNegativeStock`. If the live BOM differs, the user must refresh or pass `acceptSnapshot`. Circular BOM is `packingHasCircularBom`. Packing does not write production-session balance or carry-forward fields.

**BOM**

`AUTO` posts at complete. `MANUAL` does not. `bomMaterialCostFromProducts` still costs MANUAL lines. `applyBomCosts` writes `costSource: bom` and `costPrice`. No nested explode.

## 19. Sales architecture

Sale is the invoice. Quotation converts into a sale. Delivery order may point at a sale or quotation. POS is `createSale` plus browser print. There is no separate customer-order table.

Status on create: `paid` if paid ≥ total, `partial` if paid > 0 and below total, otherwise `unpaid`. Void sets `voided`, balance 0, and stocks the remaining qty back in. Payment reduces balance and sets `paid` or `partial`. Return confirm raises `returnedQty` and sets the sale to `returned` only when every line is fully returned.

Wholesale uses customer wholesale price when the sale is wholesale. Agent sale uses agent price and writes `SAL-` plus an `AgentSale` and earning ledger rows. Withdrawal moves available and pending amounts. Those ledger kinds stay: `sale_earning`, `product_markup`, `delivery_earnings`, `withdrawal_pending`, `withdrawal_paid`, `withdrawal_cancelled`.

Snapshots: `salesComponentsSnapshot` is stored on the sale line at create. Later component edits do not change that line.

Print stays in the browser. The API only records the print audit the UI already records.

Numbers: `INV-` is dated `INV-YYYYMMDD-###` when `datedInvoiceNo` is set, otherwise `INV-` plus 6 digits. `QT-` and `DO-` are dated with a 3-digit sequence. `PAY-` is 6 digits. `SAL-` is 6 digits.

## 20. Purchase and receiving architecture

Purchase create can post all lines immediately, or stay `draft` and post on `receivePurchase`. If `receivingId` is set, the purchase does not post stock again. Receive is all lines. `partial` means underpaid.

Receiving always completes and posts `baseQty` in. It can later link to a purchase. Linking must not post the same goods twice. SOURCE: purchase skips stock when a receiving is linked. The backend keeps that guard.

Purchase return posts out and increases line `returnedQty`.

Opening balance types:

- `stock_item`: inventory in
- `finished_goods`: inventory in, plus display and/or a map slot when the line says so
- `production_balance`: grams only, `skipInventory`

Supplier payment uses the same `recordPayment` path as customer payment, with `partyType: supplier`.

## 21. Sales import architecture

Keep this order. SOURCE: the page flow.

```text
create account → create batch → upload picking PDF → optional AWB PDF
→ map products → review → confirm → createSale
```

Missing AWB does not block confirm. Platforms are `shopee` and `tiktok` only.

The browser parses the PDF and sends `fileName`, `fileHash`, and text items. The same hash in the batch is rejected. Confirmed order ids and non-void sales whose `reference` is `{PLATFORM}:{account}:{externalOrderId}` mark later rows `duplicate`. Confirm reuses that sale instead of posting twice. Warehouse for posted import sales is `wh-main`.

Spot-check data exists on the batch (`spotCheckedKeys`, `setSalesImportSpotCheck`). The confirm button does not require those keys. Do not add a new gate.

Mappings persist by platform, account, and SKU or normalized text, with an active flag.

Order statuses stay `new`, `duplicate`, `unallocated`, `unmapped`, `confirmed`, `error`. Batch statuses stay `draft`, `ready`, `partial`, `confirmed`.

## 22. Warehouse architecture

Location types: `RACK`, `DISPLAY`, `PALLET`, `FLOOR`, `BALANCE_AREA`. Carton storage is rack, pallet, and floor. Display is `displayStocks`, not a slot. The add-rack form defaults to 4 levels, 4 front, 4 back, and those values are editable. Back slots render muted and hide only when the back slot and its front partner are both occupied.

Slot id: `` `${locationId}-l{level}-{face}-{slotNo}` ``.

Place, move, empty, and top-up change occupancy or display and append `PlacementLog`. They do not change inventory qty. Deactivate requires an empty location and keeps history. Balance boxes are `BALANCE_AREA`. Using production balance writes `BalanceUsageLog` and the gram balance, reason enum unchanged.

Permissions: `warehouse_map.view`, `putaway`, `move`, `layout.edit`, `location.manage`, `balance.use`.

## 23. Permission architecture

The key list in `PERMISSION_KEYS` is the backend vocabulary. Groups cover dashboard, sales documents, purchases, receiving, halal, inventory, warehouse map, manufacturing, reports, finance, users, roles, settings, agent, and tasks.

Owner (`protected` or legacy role `owner`) has every key and cannot be deactivated. Users, roles, and departments stay three entities. `hasPermission` is what the UI hides. The service must check the same key before it writes.

Extra manufacturing rule: `canEditSession(role, status)` in `sessionPlan.ts`. Preserve it.

`users.switch` changes `ui.currentUserId` only. It is the prototype acting-user control. It is not the Phase 2 session provider. Do not store passwords. Do not read HR.

Phase 2 session provider and Phase 13 replacement remain NOT SPECIFIED. This blueprint only reserves `authorize(principal, permissionKey)`.

## 24. Audit and idempotency

Phase 1 audit row: `auditId`, `timestamp`, `userId`, `action`, `entityType`, `entityId`, `reference`, `before`, `after`, `requestId`.

Append one row for every successful business write. `before` and `after` are the changed fields the screen already keeps, not a dump of secrets. Health and ping stay read-only.

Idempotency key required for: sale create, void, payment, quotation convert, return confirm, purchase receive, purchase return, receiving create, opening-balance confirm, adjust, usage, transfer, count, packing confirm, production-order complete, session complete, completed-session stock edits, import confirm, dispatch confirm and void, inspection group create and release, agent sale, agent stock transfer, agent withdrawal request, pay, and cancel.

The key is the Phase 1 idempotency table. Same key and same action replays. Same key and different action is `DUPLICATE_REQUEST`. Failures are not stored. SOURCE: Phase 1.

Lock: `withScriptLock` wraps counter allocation plus the stock post. Timeout stays `CONFLICT`.

## 25. Document numbering

SOURCE formats. Counters use the Phase 1 allocator. INFERENCE: `counterKey` is the prefix, and `nextValue` is seeded from the current maximum so numbers do not restart at 1 when real rows already exist. Dated series include the Kuala Lumpur date in the key, matching `nextDatedDocNo`.

| Document | Format | Pad |
| --- | --- | --- |
| Invoice | `INV-` + 6 digits, or `INV-YYYYMMDD-###` when dated | 6 or 3 |
| Agent invoice | `SAL-` | 6 |
| Payment | `PAY-` | 6 |
| Quotation | `QT-YYYYMMDD-###` | 3 |
| Delivery | `DO-YYYYMMDD-###` | 3 |
| Purchase | `PUR-` | 6 |
| Receiving | `RCV-` | 6 |
| Sales return | `RT-` | 6 |
| Purchase return | `PR-` | 6 |
| Opening balance | `OB-` | 6 |
| Adjustment | `ADJ-` | 4 |
| Usage | `USE-` | 4 |
| Count | `CNT-` | 4 |
| Transfer | `TRF-` | 4 |
| Packing | `PA-` | 4 |
| Production order | `PO-` | 4 |
| Session | `PROD-YYYYMMDD-###` | 3 |
| Inspection group | `IG-` | 4 |
| Product SKU | 6-digit from 100001 when blank | 6 |

Immutable once saved. Dispatch has no sequential number. Expense, task, import batch, and stock order have no series. Halal `certificateNo` is user-entered or an id. Do not invent series for those.

Uniqueness is per prefix. Allocation holds the script lock.

## 26. Reports architecture

Reports read transactional tabs and the ledger. They do not have summary tables. The UI math stays.

| Report | Reads | Export |
| --- | --- | --- |
| Sales | sales and lines in the date preset, by category | CSV and browser print |
| Purchases | purchases, unpaid balance | CSV and print |
| Inventory | inventory balances and product cost | CSV and print |
| Profit | sales revenue, `saleCogs`, expenses | CSV and print |
| Manufacturing | production orders, consumption, wastage, finished, cost | CSV and print per tab |
| Dashboard | the same stores for the preset, plus recent rows | none |
| PJKM 5.1.1 | completed receivings in a company warehouse for the month | browser print |
| PJKM 9.1.1 | confirmed dispatches for the month | browser print |
| PJKM 10.1.1 | movements, sales, sessions for the month | browser print |
| BMR | one completed posted session | browser print |

Date preset filtering stays `7d`, `30d`, `90d`, `custom`. Time zone for document dates is `Asia/Kuala_Lumpur`.

## 27. Print and PDF architecture

Browser `window.print` remains the output. No server PDF renderer is added.

| Document | Route | This commit |
| --- | --- | --- |
| Quotation | `/print/quotation/:id` | A4, Prepared by, signature boxes |
| Invoice | `/print/invoice/:id` | A4, Prepared by, signature boxes. No computer-generated footer |
| Delivery | `/print/delivery/:id` | A4, prepared by, customer signature / stamp |
| POS receipt | `/pos` | `window.print` |
| PJKM 5.1.1, 9.1.1, 10.1.1 | `/pjkm/...` | monthly layouts, Print / Save as PDF |
| BMR | `/manufacturing/bmr/:sessionId` | only if completed and posted. Title “Batch Manufacturing Report (BMR)” |

Page size and orientation are the CSS already on those pages. Side-branch invoice footer work is not in this baseline.

`recordDocumentPrint` still writes the print audit when the user prints a quotation, invoice, or delivery order, and the print permission still blocks the control.

## 28. Module dependency graph

```text
Phase 1 foundation (done)
        ↓
Identity (users, roles, departments, settings)
        ↓
Warehouses + categories
        ↓
Products + sales components
        ↓
Customers, suppliers, agents, vehicles, prices
        ↓
Inventory ledger service
        ↓
Warehouse locations
        ↓
BOM
        ↓
Opening balance
        ↓
Purchases, receiving, stock usage, adjustment, transfer, count, to-order
        ↓
Production orders, packing, daily sessions
        ↓
Sales, quotations, deliveries, payments, returns
        ↓
Sales import
        ↓
Dispatch
        ↓
Halal, tasks, expenses
        ↓
Dashboard, reports, PJKM, BMR
```

Hard dependencies are the arrows. Soft: reports can be wired as soon as their source module is posted. Circular case: product cost depends on BOM, and BOM depends on products. Products are stored first. BOM save then runs `applyBomCosts`. That is the existing order, not a new one.

Shared service: InventoryService. Shared ledger: `StockMovements` and `InventoryBalances`. Shared file helper: DriveStorage.

Sales import depends on sales posting. Dispatch depends on import shipments. PJKM 9.1.1 depends on confirmed dispatches. PJKM 5.1.1 depends on receivings. PJKM 10.1.1 depends on movements, sales, and sessions. None of these cycles require a new entity.

## 29. Module implementation order

Technical order only.

| Step | Module | Prerequisites | Backend work | UI integration | UAT boundary |
| --- | --- | --- | --- | --- | --- |
| 0 | Phase 1 | done | none | none | health still reads |
| 1 | Identity and settings | Phase 1 | users, roles, departments, settings, permission rows | adapter for settings and users pages | create a role and user, matrix saved, owner still full access |
| 2 | Warehouses and categories | 1 | two masters | product/category screens read them | rename category |
| 3 | Products | 2 | products, SKU, zero balances, sales components | product and raw-material pages | create, edit, lock SKU after use |
| 4 | Parties and agents | 3 | customers, suppliers, agents, vehicles, prices | those screens | agent gets a warehouse |
| 5 | Inventory ledger | 3 | balances and movements, no new screen | stock screens read balances | a manual adjust posts one movement and one balance |
| 6 | Warehouse map | 5 | locations and slots | map page | place and top-up do not change inventory qty |
| 7 | BOM | 3 | BOM and cost write-back | BOM page | AUTO/MANUAL saved, cost updates |
| 8 | Opening balance | 5, 6 | confirm post | opening-balance page and Excel | confirm once, second confirm conflicts |
| 9 | Purchases and returns | 4, 5 | purchase, receive, return, supplier pay | purchase pages | draft then receive, no double stock |
| 10 | Receiving and to-order | 9 | receiving, link, stock orders, usage, transfer, count | those pages | receiving posts once; linked purchase does not post again |
| 11 | Production orders and packing | 7, 5 | order and packing posts | those pages | MANUAL component does not auto-out |
| 12 | Daily sessions | 11, 6 | full session machine, recipe file | today, complete, carry forward, history | display + carton rule, complete once |
| 13 | Sales documents | 4, 5 | sale, quote, delivery, payment, print audit | sales, POS, documents | void restores stock, payment status matches the UI |
| 14 | Sales returns | 13 | return confirm | returns pages | good, repack, waste effects match section 17 |
| 15 | Sales import | 13 | import tables and confirm | import pages | duplicate reference does not double-post |
| 16 | Dispatch | 15, 4 | dispatch, vehicles, groups | dispatch pages | confirm and void |
| 17 | Halal, tasks, expenses | 3, Drive | those writes | those pages | files land in Drive and ids on the row |
| 18 | Reads | all sources used | dashboard, reports, PJKM, BMR | those pages | totals match the sheets, print unchanged |

Each step is one module execution: audit against this document, implement, test, deploy DEV, user UAT on the real UI and the Sheet or Drive, then lock.

## 30. Module completion criteria

A module is complete only when all of these are true:

1. Backend for that module is implemented on the Phase 1 architecture.
2. The existing UI calls it through the adapter.
3. The existing screens and workflow still behave as at `70b6a4b`.
4. Automated tests for that module pass.
5. DEV deploy of the Apps Script source succeeds through the established workflow.
6. User UAT on the real UI passes.
7. The Google Sheet rows match the action.
8. Drive files match, when the module stores files.
9. The existing permission key is enforced on the write.
10. The existing validation message still appears for the same bad input.
11. Posting actions replay on the same idempotency key and do not double-post.
12. Previously locked modules still pass.
13. The module is then marked locked.

## 31. System completion criteria

The system is complete only when:

- Every module in section 29 has met section 30
- Business entities are read from Sheets, not from seed, for production use
- Drive holds the files section 12 names
- Apps Script performs the business writes
- Routes, labels, calculations, and print layouts are still the baseline
- Permission keys are enforced on the server
- Inventory qty equals the ledger
- Document numbers are unique and stable
- Audit rows exist for writes
- Idempotency holds for the posting list
- Module UAT, regression UAT, and a final end-to-end UAT have passed

`localStorage` may still hold UI state. It must not be the source of business data after that final UAT.

## 32. Migration and cutover

Do not migrate in this task. Do not delete prototype data.

Per module, after that module’s UAT:

1. The adapter reads and writes that module’s tabs.
2. Other modules keep their current store until their own step.
3. The posting service refuses a second post if the document id or human number already exists.
4. Existing prototype rows are copied only by an explicit copy for that module, preserving ids and human numbers, then the counter is set to max + 1.
5. If UAT fails, the adapter for that module can be pointed back at the prototype store. Sheet rows written in the failed attempt stay. They are not silently deleted.
6. Seed and Reset demo remain until settings cutover says otherwise.
7. After system completion, business keys are removed from the persisted prototype payload. UI keys may remain. Nothing is deleted as part of this architecture document.

Sales-import PDF bytes were never stored. There is nothing to move. Data URLs that move to Drive are replaced on the record by the file id after the file upload succeeds. The old data URL is not required once the file id is stored. INFERENCE for the cutover of that field. The upload and the row update are one post.

## 33. Risks, conflicts, and unknowns

| Item | Class | Treatment |
| --- | --- | --- |
| Phase 2 session provider is not designed | NOT SPECIFIED | Do not invent one. Call the existing auth boundary. Identity module stores users and keys only |
| How the SPA reaches `/exec` | NOT SPECIFIED | Phase 1 still does not deploy a web app. Module deploy uses clasp push. A callable web app is not decided here |
| `costingMethod` is unused by posting | IMPLEMENTATION DETAIL | Store it. Do not invent costing |
| Purchase `partial` means unpaid, not partial receipt | SOURCE | Do not add partial receipt |
| Invoice computer-generated footer is on a side branch | HISTORICAL | Baseline keeps signature boxes |
| WordPress, WooCommerce, shop | HISTORICAL | Not this product |
| `opening_stock` movement is seed-only | SOURCE | No new writer |
| Spot check does not block import confirm | SOURCE | Do not add a block |
| `canEditSession` vs permission matrix | NON-BLOCKING | Enforce both, as the UI does |
| Counter must not restart at 1 if rows already exist | IMPLEMENTATION DETAIL | Seed `nextValue` from max + 1 at cutover |
| Drive child folder name | NOT SPECIFIED | One container under the existing root. Not a second root. Not `ProductImages` |
| Original import PDF retention | NOT SPECIFIED | Do not store bytes the UI discards |
| Live health JSON shape versus source envelope | NOT SPECIFIED | Keep the source envelope |

No item above is a BLOCKING conflict for locking this blueprint. A later module stops only if implementation would have to change a locked UI rule or contradict the Bible.

## 34. Final architecture verification

| Check | Result |
| --- | --- |
| Routes in `src/App.tsx` reviewed | Yes, including print, PJKM, BMR, redirects, and pages that are not in the sidebar |
| Modules reviewed | Section 8 |
| User actions reviewed | Section 13 lists the `db` writers, including void, cancel, convert, confirm, amend, carry forward, upload, import, map, and print audit |
| Entities | `AppData` fields |
| Stock operations | Section 17, every `MovementType` |
| Documents | Sections 19 and 20 |
| Files | Section 12. Product image NOT FOUND |
| Permissions | `PERMISSION_KEYS` plus `canEditSession` |
| Print | Section 27, this commit only |
| Dependencies and order | Sections 28 and 29 |
| Persistence mapped | Section 14 |
| API actions have a UI caller or are Phase 1 system actions | Yes. `system.health` and `system.ping` are the system exception |
| One source of truth per entity | Yes |
| Second database, Drive root, or frontend | No |
| Phase 1 reused | Yes |
| UI left as the behavior authority | Yes |
| Unsupported product rules invented | No. Inferences are marked |

READY TO LOCK.
