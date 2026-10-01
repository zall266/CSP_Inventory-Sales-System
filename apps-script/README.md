# CSP Apps Script foundation

Phase 1 backend for the CSP Inventory & Sales System. Backend Bible V1.1 is the roadmap. This folder does not replace it.

The React app remains the prototype. It still stores business data in `localStorage`. No business module calls this backend yet.

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

Optional `idempotencyKey` replays a stored success. A different action with the same key returns `DUPLICATE_REQUEST`. Any other action, including sales and inventory, returns `UNKNOWN_ACTION`.

Success and failure use `ok`, `data`, `error`, and `meta`. Clients do not receive stack traces, property values, or Drive URLs.

## Deployment

This repository is the source. The cloud agent could not sign in to Google, so the existing Apps Script project was not modified and no web app was deployed.

After Script Properties are saved, copy these files into the existing project or run `clasp push` from `apps-script/` with a clasp login for the same Google account. `.clasprc.json` must not be committed. The clasp file already points at script id `1mkRzptY0mzHnzOFB8TA6AGIZyv6q2gJq-QdKPBWtV91oq5okHWVpY4Jj`.

Then run `initializeFoundation` once from the editor. Leave `TEMPORARY_CspAccessTest` in the Apps Script project until `system.health` reports `foundationReady: true`. Delete that temporary file after that check. The Google authorization remains.

Shared-link access is not the security model. The script opens private ids. A later web app should execute as the deploying account. Do not deploy that web app in Phase 1.

## Tests

`npm run test:backend` exercises the foundation with in-memory Sheet and Drive doubles. It does not touch Google.

Phase 2 is temporary CSP UAT access. It depends on this source being present in the existing Apps Script project, the four Script Properties being set, and `initializeFoundation` having been run.
