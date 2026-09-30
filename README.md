# XactSchedule — Xactimate Trade Work Package, Budget & Field Work Order Engine

Restoration reconstruction workspace: ingest a Xactimate insurance estimate and produce
rolled-up subcontractor trade packages, an audited master budget, a Gantt schedule, a
Google Workspace export and **crew-ready Subcontractor Field Work Orders (PDF)**.

## Run Locally

**Prerequisites:** Node.js 22+

1. Install dependencies: `npm install --legacy-peer-deps` (pre-existing esbuild/vite peer conflict)
2. Configure [env/.env.local](env/.env.local) with `DEEPSEEK_API_KEY` (optional: `DEEPSEEK_MODEL`
   default `deepseek-chat`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MAX_TOKENS`). All env vars/API keys
   live in the `env/` folder — see [env/README.md](env/README.md) for the full inventory.
3. Run the app: `npm run dev` → http://localhost:3000

## AI Pipeline (budget-engine-v2)

`POST /api/process-estimate` (PDF or pasted text) runs a two-stage pipeline:

1. **LLM extraction** (`xactEngine.ts`) — the model only extracts and packages: project metadata
   (claim, carrier, address, base subtotal, tax, O&P, RCV), 9–16 trade packages mapped to the
   14-division taxonomy, direct subtotals, retail labor/material splits, exclusions, scheduling
   hints and itemized material allowances. Prompts live in code and follow `instructions/read`.
2. **Deterministic post-processing** (`src/utils/budgetEngine.ts`) — all money is recomputed in
   code, never trusted from the model: O&P/tax apportionment by line-item share, rounding
   reconciliation against the largest trade, 72%/70%/68%/65% benchmark labor splits, 68% turnkey
   buyouts, 7% material sales tax and the audit checksums (Σ trade RCV ≡ carrier RCV).

Call robustness (`deepseek.ts`): bounded retries with exponential backoff (429/5xx/network),
`finish_reason` truncation detection with compact retry, JSON extraction + brace-balancing
repair and a model-driven repair pass before failure.

## Field Work Orders

`POST /api/generate-work-orders` routes trade packages to 7 field crews (plus a supplemental
exterior crew) and generates one work order per crew — one DeepSeek call per crew with bounded
concurrency, per-crew deterministic fallback templates when the AI is unavailable.

- **Contract-amount policy** (hard rule from `instructions/work orders`): Work orders double as subcontractor contracts: each crew document includes its contract amount linked to the estimate budget lines (task id, trade package, amount). Carrier pricing, margins, O&P and unit rates remain stripped.
  `attachWorkOrderContracts` in `src/utils/workOrders.ts` links each crew's `contract` (budget lines
  + total, rendered exclusively via the shared `formatMoney`); all remaining strings pass through
  `redactFinancials` — leftover margin language and Xactimate category/selector codes are stripped —
  with a second PDF draw-time redaction layer and a third UI render-time layer.
- Each crew gets the mandatory 5-part block: Scope Summary / Safety & Containment / Step-by-step
  field instructions (by room or phase) / Material Specs / QC Punchlist, plus a
  **DO NOT PERFORM / SCOPE EXCLUSIONS** block and a sign-off panel.
- **PDF export** (`src/utils/workOrderPdf.ts`, pdf-lib): **one standalone PDF per subcontractor** —
  each document contains only that crew's exact scope (compact project/site header + the 5-part work
  order + its **CONTRACT AMOUNT & BUDGET LINE LINKAGE** block + sign-off) so it can be emailed
  directly; the office packet cover announces **CONTRACT AMOUNT INCLUDED — CARRIER PRICING
  EXCLUDED**. `buildAllCrewWorkOrderPdfs` generates the whole set; filenames look like
  `Client_Claim_1234_Flooring_WO.pdf`; every page carries a per-crew verification token. An
  optional combined office packet remains available via `buildWorkOrderPdf`.
- **Google Drive**: `uploadWorkOrderPdf` saves each crew document with the existing `drive.file` scope.

## Customer Selections & Material Allowances

Intake accepts an optional second PDF — the **Xactimate Component Breakdown Report** — alongside the
estimate. Both are merged into one extraction pass (the component report is appended beneath a
marker header), so the engine's "exact component quantities" rule drives the material allowance
roll-up.

- `xactEngine.processEstimate` derives `customer_selections` from the final `material_allowances`
  via the deterministic classifier in `src/utils/customerSelections.ts` (Flooring, Tile,
  Cabinets & Countertops, Paint & Finishes, Trim & Doors, Plumbing Fixtures, Hardware, Appliances).
  Selection rows live separately from the procurement list, so customer-facing edits never touch
  the budget engine or its audit checksums.
- **Customer Selections section**: review/edit rows (description, category, qty, uom, $/unit,
  vendor, notes), add or remove items, rebuild from the extracted allowances, and generate the
  branded **Customer Selections & Material Allowance Sheet** (`src/utils/customerSelectionsPdf.ts`).
  The sheet is a deliberate customer-facing money document (allowance figures rendered via
  `formatMoney`) — carrier RCV, O&P and margins never appear; the verify script allow-lists every
  dollar token. Filenames look like `Client_Claim_1234_Customer_Selections.pdf`; every page carries
  a `SEL-CHK-` verification token.

## HTTP API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | provider/model/capabilities/engines |
| `POST /api/process-estimate` | `{ pdfBase64?, componentsPdfBase64?, componentsFilename?, textContent?, prompt?, filename? }` → enriched `EstimateResult` with `budget_audit`, `material_allowances` and `customer_selections` |
| `POST /api/generate-work-orders` | `{ estimate }` → `{ work_orders, site_logistics, generated_at, meta }` (each work order carries its subcontract contract amount + budget-line linkage; all other financials redacted) |

## UI Sections

Intake & Metadata · Trade Packages · Buyout Budget (includes the AI Budget Engine panel with
Output 1 master budget + Output 2 material allowance) · Gantt Schedule · **Field Work Orders** ·
**Customer Selections** · Workspace Sync (Sheets/Docs/Calendar/Drive) · JSON & Schema.

## Verification

Offline (no API key, no server):

```
npm run lint                 # tsc --noEmit across src, scripts, server, engines
npm run verify:budget        # budget engine: reconciliation, idempotence, cycle repair, turnkey rules
npm run verify:workorders    # per-crew docs + office packet for all samples: re-parsed; own-scope-only, contract_amount == Σ budget lines, $ tokens allow-listed to the crew's own contract, no code leaks
npm run verify:selections    # customer selections: classifier determinism, totals math, engine preservation, sheet PDF re-parsed; $ tokens allow-listed to allowance figures, no carrier language / code leaks
npm run verify:pdf-extract   # pdfjs-dist text extraction round-trip
```

Live e2e (requires dev server + `DEEPSEEK_API_KEY`, consumes credits):
`npx tsx scripts/__verify_tmp/e2e-pdf.ts`

Generated packet artifacts land in `scripts/__verify_tmp/out-workorder-<sample>.pdf`.

## Project Layout

- `server.ts` — Express + Vite middleware, API endpoints
- `deepseek.ts` — retry/repair JSON client · `xactEngine.ts` — extraction + prompt/schema
- `workOrderEngine.ts` — per-crew work order generation + contract attachment/redaction/fallback
  orchestration
- `src/utils/budgetEngine.ts` — deterministic budget math · `src/utils/workOrders.ts` — crews,
  contract attachment (`attachWorkOrderContracts` / `formatMoney`), redaction, fallbacks ·
  `src/utils/workOrderPdf.ts` — pdf-lib packet renderer (CONTRACT AMOUNT & BUDGET LINE LINKAGE)
- `src/utils/scheduler.ts` — business-day FS scheduler (Gantt + critical path)
- `pdfText.ts` — pdfjs-dist text extraction for uploaded PDFs
- `scripts/` — verification scripts · `instructions/` — source specs (budget + work orders)

View the original app in AI Studio: https://ai.studio/apps/4faab206-47ef-4665-8fdf-83ca45aa13b3

## Deploying to Vercel

Production is a static Vite SPA (built to `dist/` by `npm run build`, which also injects the
service-worker precache manifest) plus serverless functions in `api/` (`health`,
`process-estimate`, `generate-work-orders`) that wrap the same engines used locally — the Express
server from `server.ts` is not used on Vercel.

- **Project settings:** Framework Preset **Vite** · Build Command `npm run build` · Output
  Directory `dist` · Node.js **>= 20** (enforced by `engines` in `package.json`).
- **Install reliability:** `.npmrc` commits `legacy-peer-deps=true` — Vercel runs plain
  `npm install`, which otherwise fails with `ERESOLVE`.
- **Environment variables** (Project → Settings → Environment Variables; never committed —
  local copies live in `env/`, see [env/README.md](env/README.md)):

| Variable | Required | Notes |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | Yes | Server-only secret for `api/*.ts` — never add a `VITE_` prefix |
| `DEEPSEEK_MODEL` | No | Defaults to `deepseek-chat` |
| `DEEPSEEK_BASE_URL` | No | Defaults to `https://api.deepseek.com` |
| `DEEPSEEK_MAX_TOKENS` | No | Defaults to `8192` |

- **Body size:** Vercel caps serverless request bodies at ~4.5 MB; the client already blocks
  uploads above 3.2 MB and recommends **Paste Text** for larger estimates.
- **Duration:** `vercel.json` sets `maxDuration: 60` (Hobby maximum) — PDF extraction + DeepSeek
  calls take 30–90 s, so very large PDFs can still time out.
- **Service worker:** `/sw.js` is served `Cache-Control: public, max-age=0, must-revalidate` so
  PWA updates always revalidate.

Deploy via CLI (repo: `spservicesgroupinc-blip/pmbudget` — not git-connected to Vercel):

```bash
npx vercel link      # one-time: link this folder to a Vercel project
npx vercel deploy    # preview deployment (add --prod for production only when ready)
```
