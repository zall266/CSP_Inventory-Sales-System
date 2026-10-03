# CSP Execution Baseline V1

Status: LOCKED

This record locks the UI/function baseline and the integration architecture for implementation. It does not amend `docs/CSP_BACKEND_BIBLE_V1.1.md`. The Bible remains the canonical recovered backend architecture. This record does not implement a business module, change application code, or deploy.

## 1. UI / function baseline — LOCKED

Authoritative product UI and behavior:

- Branch: `origin/cursor/pjkm-911-daily-summary-d9ac`
- Commit: `70b6a4bdf5ba7b86d879de27d8a6c5d8a7bf63b1`

Locked from that commit, unless a genuine conflict is found during a module audit:

- Sidebar structure and menu groups, including desktop section collapse and the mobile drawer
- Routes, screens, forms, buttons, field labels, and terminology
- Calculations, validations, toasts, and status transitions
- Print flows, workflows, user interactions, and module boundaries
- Permission concepts already in the frontend
- Responsive behavior already in the frontend
- Business rules already represented by the frontend

`src/store/db.ts`, seed data, and `localStorage` key `stockflow-prototype-v8` are the reference for what the product does. They are not the production source of truth.

The user-facing workflow stays the same when persistence moves to the backend.

## 2. Integration architecture — LOCKED

```text
Existing React/Vite frontend
        ↓
API / backend adapter
        ↓
Apps Script router → service → repository
        ↓
Google Sheets / Google Drive
```

- Frontend: React + Vite, remaining a separate application
- Backend: the existing Google Apps Script project
- Business data: the existing Google Sheet
- Files, photos, and documents: the existing Google Drive root

Locked exclusions:

- Do not bundle the React application into Apps Script
- Do not turn `doGet()` into the React application
- Do not move frontend source into Apps Script
- Do not add another frontend, database, spreadsheet, or Drive root
- Do not create a second Apps Script project or a second backend foundation

After a module is connected:

- React state holds UI state
- `localStorage` remains only where a module still needs it during migration
- `seed.ts` remains development and test seed
- Production business data is Google Sheets
- Files are Google Drive
- Business logic for the connected module is Apps Script

No broad destructive migration is authorized. Prototype data is not deleted because this baseline is locked. Cutover for a module happens only after that module passes UAT.

## 3. Phase 1 foundation — READY

Reuse the Phase 1 foundation at the same commit:

- `doGet` → `system.health`
- `doPost` → `system.health` and `system.ping` only
- Envelope, error codes, request ids, script lock
- AuditLogs, Idempotency, Counters
- Sheet repository and Drive storage helper
- DEV Script Properties and the existing DEV Sheet and Drive root
- DEV deployment flow: `clasp push --force`, then an Apps Script version, then create or redeploy the single stored DEV web-app deployment. The first deployment creates the deployment id. Later modules redeploy that same id. The version description contains the Git commit SHA. Source and runtime identity are verified from that version description. Production deployment remains prohibited.

Business modules build on this foundation. Phase 1 is not rebuilt.

Identified gap, not a second architecture: the React app does not call Apps Script. Any action other than health and ping returns `UNKNOWN_ACTION`. `localStorage` is still the prototype store.

## 4. Bible

`docs/CSP_BACKEND_BIBLE_V1.1.md` is LOCKED and is not rewritten here.

Where the Bible marks a later phase NOT SPECIFIED, the frontend behavior at `70b6a4b` is the evidence for what that module already does. A contradiction between the frontend, the Phase 1 backend, and the Bible stops that module until the conflict is reported. It is not resolved by inventing a requirement or by redesigning the UI.

The authoritative UI for print and documents is this commit, including the signature boxes present at `70b6a4b`. Side-branch invoice changes are not the baseline.

## 5. Module execution protocol — READY

For each existing module, in dependency order already present in the product:

1. Audit the existing UI, `db.ts`, calculations, validations, Phase 1 code, and the Bible.
2. Implement only the backend and the adapter that module needs.
3. Run the relevant automated tests.
4. Deploy DEV with the established workflow. Verify the deployed source from the Apps Script version description, which contains the Git commit SHA.
5. User UAT through the real UI and the real Sheet or Drive data.
6. On pass, lock the module. On failure, fix only the failed behavior and retest.

No UI redesign, new workflow, new field, new permission, new module, or new storage is part of normal implementation.

This record does not choose or implement the first module.

## 6. Verification at lock

| Check | Result |
| --- | --- |
| Frontend baseline identifiable | `70b6a4b`, React 19, Vite, React Router, `src/App.tsx`, `src/store/db.ts` |
| UI/function/workflow baseline identifiable | Routes and `db` actions at that commit |
| Frontend | React/Vite |
| Backend | Google Apps Script |
| Business data | Google Sheets |
| File storage | Google Drive |
| Phase 1 foundation | Present at the same commit |
| Canonical Bible | `docs/CSP_BACKEND_BIBLE_V1.1.md` |
| Integration gap | Identified in section 3 |
| Second architecture | None |
| UI redesign required | No |
| Module protocol | Section 5 |
