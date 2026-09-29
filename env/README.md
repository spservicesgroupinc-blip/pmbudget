# env/ — all environment variables & API keys

Everything this project needs to run (locally, in AI Studio, and on Vercel) is listed here.
**All local env files and key files live in this folder.**

| File | Committed? | Purpose |
| --- | --- | --- |
| `.env.local` | No — git-ignored via `.env*` | Your real local secrets (copy from `.env.example`) |
| `.env.example` | Yes | Template with every supported variable |
| `firebase-applet-config.json` | Yes | Firebase web app config (public client keys, not secret) |

## How they are loaded

- Local server (`server.ts`) and `scripts/verify-miner.ts`: `dotenv` loads **`env/.env.local`**
  first, then `env/.env` (legacy root-level `.env.local`/`.env` still work as a fallback;
  first file found wins, existing shell env is never overwritten).
- Vite (`vite.config.ts`): `envDir: 'env'` — client-exposed vars must use the `VITE_` prefix.
- Vercel: files here are **not deployed**; set the same variables in
  Project → Settings → Environment Variables.
- Firebase: `src/services/firebaseAuth.ts` imports `env/firebase-applet-config.json` directly
  (Firebase web config is public by design — never put server secrets in it).

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
| Firebase web config (in `firebase-applet-config.json`) | Yes | `src/services/firebaseAuth.ts` | Public web keys; replace the file to point at a different Firebase project |
