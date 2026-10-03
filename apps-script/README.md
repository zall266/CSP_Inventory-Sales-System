# CSP Apps Script foundation

Phase 1 backend for the CSP Inventory & Sales System. Backend Bible V1.1 is the roadmap. This folder does not replace it.

The React app remains the prototype. Modules other than identity still store their data in `localStorage`. Module 1 calls this backend only when `VITE_CSP_API_URL` is set.

## Shape

React will later call HTTPS `doGet` / `doPost`. Those functions enter `app/main.js`, then the router, then a service. Sheets are opened only by repositories. Drive is opened only by `storage/driveStorage.js`.

```text
doPost
  -> router
  -> system service
  -> sheet repository
  -> Google Sheet

system service
  -> drive storage
  -> private Drive folder id
```

`auth/boundary.js` exposes `authenticate()` and `authorize()` so Phase 2 and Phase 13 can wrap requests. Phase 1 does not log anyone in and does not grant business permissions.

## DEV resources

Use the existing Apps Script project, spreadsheet, and Drive root that passed `testCspGoogleAccess`. Do not create a second project, workbook, or root. Do not rename `01_Data`, `99_System`, or `Sheet1`.

Set these Script Properties on that existing project. Keep the values out of React and out of sheet cells.

| Property | DEV value |
| --- | --- |
| ENVIRONMENT | DEV |
| SPREADSHEET_ID | `1TPmkASdzlGssGyAisklf4QkLcxWYbHHhUSxntgLha94` |
| DRIVE_ROOT_ID | `14vIYpPSNQafvMnWgSEd1EGounerNjK3S` |
| TIMEZONE | `Asia/Kuala_Lumpur` |

`14vIYpPSNQafvMnWgSEd1EGounerNjK3S` is the verified Drive root. A similar-looking id that ends in the Apps Script id is not the folder.

## Foundation sheets

`initializeFoundation()` creates only:

- `AuditLogs` — append only
- `Idempotency` — one stored response per key
- `Counters` — locked integer allocation for later document numbers

`Sheet1` stays in place. Phase 4 folders such as `ProductImages` are not created. `system.health` only reads.

## API

`doGet` returns `system.health`.

`doPost` accepts:

```json
{ "v": 1, "requestId": "...", "action": "system.ping", "payload": {} }
```

Optional `idempotencyKey` replays a stored success. A different action with the same key returns `DUPLICATE_REQUEST`. Sales, inventory, and every module after identity still return `UNKNOWN_ACTION`.

Module 1 adds `identity.get`, `identity.bootstrap`, `settings.get`, `settings.update`, `users.list`, `users.create`, `users.update`, `roles.create`, `roles.update`, `roles.setStatus`, `roles.savePermissions`, and `roles.updateMatrix`. These actions use the existing router, sheet repository, audit log, and Drive root. `actorUserId` is the prototype user switcher already stored in the UI. It is not a login session. `users.switch` and `settings.resetDemo` stay in the browser.

Success and failure use `ok`, `data`, `error`, and `meta`. Clients do not receive stack traces, property values, or Drive URLs.

## Deployment

This repository is the source. The live project is not updated until the owner runs the GitHub Action.

`.github/workflows/deploy-dev.yml` is a manual `workflow_dispatch` job. It checks out this repo, runs `npx --yes @google/clasp@3.4.1 push --force` from `apps-script/`, and targets script id `1mkRzptY0mzHnzOFB8TA6AGIZyv6q2gJq-QdKPBWtV91oq5okHWVpY4Jj`. `--force` is required because a non-interactive runner would otherwise skip the whole push when `appsscript.json` is part of the change. The job does not run `clasp create` and does not open a new Apps Script project.

The job uses GitHub Environment `dev` and secret `CSP_DEV_CLASP_CREDENTIALS`. That secret is the clasp authorized-user JSON. It is written to `~/.clasprc.json` for the job and deleted afterward. Do not commit it, print it, or paste it into Cursor.

The Action does not set Script Properties and does not run `initializeFoundation`.

`apps-script/.claspignore` keeps Node tests, markdown, and credential files out of the push. Apps Script source and `appsscript.json` stay included.

After a successful Action run, set the four Script Properties if they are not set, then run `initializeFoundation` once from the Apps Script editor. Leave `TEMPORARY_CspAccessTest` in the Apps Script project until `system.health` reports `foundationReady: true`. Delete that temporary file after that check.

Shared-link access is not the security model. The script opens private ids. A later web app should execute as the deploying account. Do not deploy that web app in Phase 1.

## Tests

`npm run test:backend` exercises the foundation and Module 1 identity rules with in-memory Sheet and Drive doubles. It does not touch Google.

Phase 2 is temporary CSP UAT access. It depends on this source being present in the existing Apps Script project, the four Script Properties being set, and `initializeFoundation` having been run.
