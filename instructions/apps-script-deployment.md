# Google Apps Script Backend — Deployment Guide

The app authenticates users against a Google Sheet and writes every export
(Sheets budget, Docs scope agreement, Calendar events, Drive JSON + PDFs)
through a single Apps Script web app (`apps-script/Code.gs`). This guide
deploys that backend manually from the Apps Script editor.

## 1. Create the project

1. Go to https://script.google.com → **New project**.
2. Rename it **XactSchedule Backend**.
3. Delete the placeholder `Code.gs` content and paste the entire contents of
   [`apps-script/Code.gs`](../apps-script/Code.gs).
4. In the editor: **Project Settings** → check **"Show 'appsscript.json'
   manifest file in editor"** → replace the manifest with the contents of
   [`apps-script/appsscript.json`](../apps-script/appsscript.json) → Save.

## 2. Script properties

**Project Settings → Script properties**, add:

| Property | Value |
| --- | --- |
| `APP_KEY` | a random 32+ character secret (password manager) — the app sends this with every request |
| `ADMIN_SETUP_KEY` | a different random 32+ character secret — guards the `addUser` action |
| `SESSION_TTL_HOURS` | `12` (optional; default 12) |

Save the two keys — `APP_KEY` is also needed in `env/gapps-config.json`
(step 5).

## 3. First run (permissions)

1. In the toolbar dropdown, select the `setup` function → **Run**.
2. Grant the requested permissions (Spreadsheets, Drive, Documents, Calendar).
3. The run creates a spreadsheet named **XactSchedule Database** with four
   sheets: `Users`, `Sessions`, `Exports`, `Customers` and stores its ID in
   script properties. It also creates an **XactSchedule Customers** folder in
   Drive where every customer profile (estimate JSON + generated PDFs) lives.

## 4. Create the first user

There are **no default credentials**. The simplest path is the in-app flow:

1. Open the app → on the sign-in page click **"Create the first account"**.
2. Enter name, email, password (8+ characters) and confirm — leave the
   **Setup Key** blank. The very first account is always allowed; once any
   user exists, account creation requires `ADMIN_SETUP_KEY`.
3. Click **Create Account**, then sign in with those credentials.

If you'd rather bootstrap from the editor instead: save the project (Ctrl+S),
select `setup` in the toolbar dropdown → Run (approve permissions), then paste
this at the BOTTOM of `Code.gs` with your own values, select `createFirstUser`
in the dropdown → Run, and delete the block afterwards:

```javascript
function createFirstUser() {
  createAdminUser('you@hayssons.com', 'Your Name', 'pick-a-strong-password', 'admin');
}
```

Additional users: repeat the in-app flow with the setup key, run
`createAdminUser` again, add rows directly in the `Users` sheet, or call the
`addUser` action with `ADMIN_SETUP_KEY`.

**Users sheet columns:** `Email | Name | Role | Salt | PasswordHash | Active | CreatedAt`

- Email must be lowercase; it is normalized on login anyway.
- `Active` must be `TRUE` (any other value disables the account).
- `Salt` / `PasswordHash` are filled automatically — never edit them by hand.
  To reset a password, run `createAdminUser` again for that email.

## 5. Deploy the web app

1. **Deploy → New deployment** → type **Web app**.
2. Execute as: **Me** (`you@hayssons.com`).
3. Who has access: **Anyone**.
4. Deploy and copy the `/exec` URL.

## 6. Point the app at the backend

Edit [`env/gapps-config.json`](../env/gapps-config.json):

```json
{
  "webAppUrl": "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec",
  "appKey": "<the APP_KEY from step 2>"
}
```

Restart the dev server if it was running, reload the app, and sign in.

### Current deployment (2026-09-30)

- Deployed `/exec` URL:
  `https://script.google.com/macros/s/AKfycbxqc4v_5zF77qmcoTWMta45JD9lOfwJUr2F8_03J48gUTxUiP4j3Qz2nkTqcRL55GgIRg/exec`
- This deployment must be a version created AFTER pasting the current
  `apps-script/Code.gs` (it adds the customer-profile actions:
  `saveCustomerProfile`, `listCustomerProfiles`, `getCustomerProfile`,
  `deleteCustomerProfile`, `uploadCustomerPdf`). If the version predates that
  code, the customer actions answer `Unknown action.` — create a new version.
- After setting `APP_KEY`/`ADMIN_SETUP_KEY` and running `setup()`, paste the
  real `APP_KEY` into `env/gapps-config.json` (the placeholder keeps local dev
  on the built-in mock).

## Operational notes

- **Edits need a new deployment.** Code changes in `Code.gs` only reach the
  published URL after **Deploy → Manage deployments → Edit → New version**.
  Script-property changes (`APP_KEY`, users sheet rows) apply immediately.
- **Protocol:** the app posts JSON with a `text/plain` content type so requests
  avoid CORS preflights (Apps Script web apps do not answer preflights). Keep
  `gappsAuth.ts` on the text/plain path.
- **All files are owned by the deploying account.** Budget sheets, scope docs,
  calendar events, JSON packages and PDFs are created in that account's Drive
  and default calendar. The `Exports` sheet logs every write (timestamp, user,
  type, title, URL).
- **Security model:** the web app is anonymous-access, but every request must
  carry the correct `APP_KEY`, and every data action a session token issued by
  `login` (SHA-256 salted password hashes, expiring sessions). Anyone with the
  deployed URL and the app key could still enumerate actions — keep the URL
  internal and rotate `APP_KEY` if it leaks.
- **Permissions:** after adding new Google services to the script, Google
  re-prompts authorization on the next run/deploy.
- **Users are managed in the Users sheet.** Deactivate by setting `Active` to
  `FALSE` (leave the row in place).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Login fails: "Could not reach the Google Workspace backend" | `webAppUrl` in `env/gapps-config.json` is wrong or unreachable; the local dev server falls back to a mock when unconfigured — deployed builds always need the real URL. |
| Login fails: "Invalid app key" | `appKey` in `env/gapps-config.json` does not match the `APP_KEY` script property. |
| "Invalid email or password" | Check the Users sheet row (lowercase email, `Active` = TRUE) or re-run `createAdminUser`. |
| "Session expired or invalid" | Session TTL elapsed — sign in again. |
| "Script function not found" / old behavior after edits | You edited `Code.gs` but didn't create a new deployment version. |
| Exports missing | Look at the `Exports` sheet and the Apps Script **Executions** log for errors. |
| Permission re-prompt | Expected the first time a new Google service is used — approve again. |
