# Google Apps Script Backend — Deployment Guide

The PM app uses `apps-script/Code.gs` for account sign-up, sign-in, saved jobs,
and Google Workspace exports. Account creation needs no setup key or app key.
Saved jobs and exports still require a valid account session.

## Update an existing deployment

1. Open the Apps Script project that owns the configured `/exec` URL.
2. Replace its `Code.gs` with the entire contents of
   [apps-script/Code.gs](../apps-script/Code.gs) and save.
3. Keep the existing `DB_SPREADSHEET_ID` property so existing accounts and jobs
   remain in the same database. `APP_KEY` and `ADMIN_SETUP_KEY` are no longer
   used; they do not need to be created or changed.
4. If the project has not been initialized, select `setup` in the function
   dropdown and run it once. Approve the project's Google service permissions.
5. Choose **Deploy → Manage deployments → Edit → New version → Deploy**.
   Editing the existing deployment preserves its URL.
6. Reload [the local PM app](http://localhost:3000/). Choose **Create an account**,
   enter a name, email, password (8–128 characters), and confirmation, then sign in.

Saving the editor source alone does not update the published web app.
A response saying `APP_KEY script property is missing` or `Invalid setup key`
means the configured URL is still serving the previous backend version.
For a Vercel build, check `VITE_GAPPS_WEB_APP_URL` as well as `gapps-config.json`:
the environment override wins. Update the selected backend or URL and redeploy
the frontend; do not create an app key to work around the error.

## Create a new project

1. Go to the Apps Script editor and create a project named **XactSchedule Backend**.
2. Paste [apps-script/Code.gs](../apps-script/Code.gs) into `Code.gs`.
3. In **Project Settings**, enable the manifest editor and use
   [apps-script/appsscript.json](../apps-script/appsscript.json).
4. Run `setup` and approve its Spreadsheets, Drive, Documents, and Calendar permissions.
5. Deploy a **Web app** with **Execute as: Me** and **Who has access: Anyone**.
6. Copy the deployed `/exec` URL into `webAppUrl` in
   [env/gapps-config.json](../env/gapps-config.json).

Only the URL is required in the app config:

```json
{
  "webAppUrl": "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"
}
```

`VITE_GAPPS_WEB_APP_URL` can override that URL at build time. The only required
connection settings are this Apps Script URL and the server's `DEEPSEEK_API_KEY`.
Restart the dev server after changing environment variables.

For Vercel, use the exact uppercase name `VITE_GAPPS_WEB_APP_URL` for an optional
URL override in each target environment, or leave it unset to use the committed
JSON config. The old `vite_appscript_url` name is unused. Never add `APP_KEY`,
`VITE_GAPPS_APP_KEY`, `GAPPS_APP_KEY`, or `ADMIN_SETUP_KEY`. Rebuild and redeploy
the frontend after changing its URL; existing builds retain their bundled URL.
Editing a local `env/.env.vercel` snapshot does not update Vercel's remote settings.

## Database and accounts

The setup function creates **XactSchedule Database** with `Users`, `Sessions`,
`Exports`, and `Customers` sheets. It stores the spreadsheet ID as
`DB_SPREADSHEET_ID` and creates an **XactSchedule Customers** Drive folder.
Existing configured IDs are reused. `SESSION_TTL_HOURS` is optional and defaults
to 12 hours.

Self-service registration is available to anyone who can open the app:
- Every new account receives the `staff` role; public requests cannot choose `admin`.
- Names and email addresses are validated; passwords require 8–128 characters.
- Duplicate emails are rejected and never change existing passwords, names, or roles.
- Registration checks and inserts are serialized with an Apps Script lock.
- Passwords are stored as salted hashes. The browser receives expiring session tokens on sign-in.

**Users columns:** `Email | Name | Role | Salt | PasswordHash | Active | CreatedAt`.

To disable an account, set `Active` to `FALSE`. Do not edit salt/hash cells manually.
An administrator can use the editor-only `createAdminUser` helper to create an
administrator or reset an existing account. For example, add and run this
temporary editor function with your own values, then remove it:

```javascript
function createOfficeAdmin() {
  createAdminUser('you@hayssons.com', 'Your Name', 'pick-a-strong-password', 'admin');
}
```

This editor workflow is separate from public sign-up.

## Protocol and verification

- POST JSON using `Content-Type: text/plain;charset=UTF-8` to avoid CORS preflights.
- Public actions: `ping`, `addUser`, and `login`.
- Session validation, saved jobs, and export actions use the token from sign-in.
- Sign-out invalidates that session.
- Exported files and calendar events belong to the deploying Google account.
  The `Exports` sheet records export activity.
- Run `npm run verify:auth` to exercise the actual backend with in-memory
  Google service adapters. This does not create live accounts or Google files.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `APP_KEY script property is missing` or `Invalid setup key` | Replace `Code.gs`, then edit the existing deployment to use a new version. |
| `An account with this email already exists` | Sign in instead. An office administrator can reset a forgotten password through the editor helper. |
| `Invalid email or password` | Check the account credentials and the Users sheet's `Active` value. |
| `Session expired or invalid` | Sign in again. |
| `Could not reach the Google Workspace backend` | Check the deployed URL, anonymous web-app access, and deployment permissions. |
| `Unknown action` after a code change | The published URL is serving an older version; update the existing deployment. |
| Exports missing | Check the Exports sheet and the Apps Script Executions log. |
