# env/ — all environment variables & API keys

Everything this project needs to run (locally, in AI Studio, and on Vercel) is listed here.
**All local env files and key files live in this folder.**

| File | Committed? | Purpose |
| --- | --- | --- |
| `.env.local` | No — git-ignored via `.env*` | Your real local secrets (copy from `.env.example`) |
| `.env.example` | Yes | Template with every supported variable |
| `gapps-config.json` | Yes | Google Apps Script backend config — `webAppUrl` (the deployed /exec URL) |

## How they are loaded

- Local server (`server.ts`) and `scripts/verify-miner.ts`: `dotenv` loads **`env/.env.local`**
  first, then `env/.env` (legacy root-level `.env.local`/`.env` still work as a fallback;
  first file found wins, existing shell env is never overwritten).
- Vite (`vite.config.ts`): `envDir: 'env'` — client-exposed vars must use the `VITE_` prefix.
- Vercel: files here are **not deployed**; set the same variables in
  Project → Settings → Environment Variables.
- Apps Script backend: `src/services/gappsAuth.ts` imports `env/gapps-config.json`
  directly. `webAppUrl` is the deployed web-app `/exec` URL. Sign-up and login
  require no shared setup keys; saved jobs and exports require a signed-in
  account session. Legacy `appKey` values and `VITE_GAPPS_APP_KEY` are ignored. See
  `instructions/apps-script-deployment.md` for the full deployment flow.

## Variable inventory

| Variable | Required | Used by | Notes |
| --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | Yes | `deepseek.ts` (server + `api/*.ts`) | Server-only secret — **never** add a `VITE_` prefix. Get one at https://platform.deepseek.com |
| `DEEPSEEK_MODEL` | No | `deepseek.ts` | Default `deepseek-chat` |
| `DEEPSEEK_BASE_URL` | No | `deepseek.ts` | Default `https://api.deepseek.com` |
| `DEEPSEEK_MAX_TOKENS` | No | `deepseek.ts` | Default `8192` |
| `APP_URL` | No | AI Studio hosting | Injected automatically at runtime by AI Studio |
| `PORT` | No | `server.ts` | Default `3000` |
| `NODE_ENV` | No | `server.ts` | `production` serves the built `dist/` app; otherwise Vite middleware |
| `DISABLE_HMR` | No | `vite.config.ts` | AI Studio sets `true` to disable file watching |
| Apps Script backend config (in `gapps-config.json`) | Yes | `src/services/gappsAuth.ts` | `webAppUrl`; fill in after deploying the Apps Script web app (see `instructions/apps-script-deployment.md`). On Vercel, `VITE_GAPPS_WEB_APP_URL` overrides the JSON at build time. |

## Deploying env changes to Vercel (learned the hard way, 2026-09-29)

- Vercel **never sees `env/.env.local`** (git-ignored by `.env*`) — the variable must be set in
  **Project → Settings → Environment Variables** for every environment you actually deploy.
  A `Development`-scope entry does **not** reach deployed builds; production needs a `Production`-scope entry.
- After adding/changing an env var, **redeploy** — existing deployments keep their old values.
- Store/paste the value **without surrounding quotes**. `.env` files may quote values
  (`DEEPSEEK_API_KEY="sk-..."`) and dotenv strips the quotes locally — but a raw copy/pipe
  keeps them, Vercel stores the quote characters as part of the secret, and DeepSeek then
  replies `HTTP 401: Authentication Fails ... api key: ****bbb" is invalid`.
  The key line in `env/.env.local` is now unquoted so naive copy-paste is safe.
- Verify a deployment: `GET https://<app>/api/health` → `"hasApiKey": true`, then process a
  small estimate and expect **HTTP 200** (not 500 with `DEEPSEEK_API_KEY is not configured`).
