# Hays + Sons Workspace — Mobile-Field UI Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Hays + Sons project-management workspace fast and legible for a field
supervisor on a phone — one primary action per view, a real design-token system underneath,
and roughly 60% less JavaScript on first launch — without changing the brand or the domain math.

**Architecture:** Three layers, built in order. (1) A token + primitives layer in
`src/index.css` `@theme` and `src/components/ui/` absorbs 465 ad-hoc type sizes, 132 failing
contrast sites and five duplicated empty-state cards. (2) A mobile-first shell puts the primary
action in row one of a single-row header, collapses dense tables to labelled card lists below
`md`, and keeps the desktop canvas as the enhancement. (3) A payload and render-cost pass stops
the service worker precaching surfaces nobody opened and stops keystrokes re-rendering whole
sections. The Gantt blockers are repaired **before** any Gantt visual work, because two of them
are silently-wrong behavior (a dead scale toggle and discarded touch reschedules).

**Tech Stack:** React 19, TypeScript 7, Vite 8, Tailwind v4 (CSS-first `@theme`),
lucide-react, frappe-gantt 1.2.2, hand-rolled service worker, Express API routes on Vercel.
New dev dependencies: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.

**Spec:** `docs/superpowers/specs/2026-10-11-ui-improvement-design.md` — read it alongside this
plan; it carries the intent, the measured baseline, and the anti-goals.

## Global Constraints

Every task's requirements implicitly include this section.

- **Brand is locked.** `--color-brand: #DC2626`, `--color-brand-hover: #B91C1C`,
  `--color-ink: #1A1A1A` keep their values. No new palette, no gradient, no rebrand.
- **Type scale tokens** (Tailwind v4, in `@theme`), replacing all arbitrary sizes:
  `--text-micro: 11px`, `--text-label: 12px`, `--text-body: 13px`, `--text-title: 15px`,
  `--text-figure: 24px`, plus `--text-title--line-height: 1.4` and
  `--text-body--line-height: 1.5`. Utilities become `text-micro`, `text-label`, `text-body`,
  `text-title`, `text-figure`.
- **Contrast floor.** No text below 4.5:1. `slate-400` (`#94A3B8`, 2.56:1) is never text;
  the text floor is the new `--color-muted-text: #64748B` (4.76:1). Any red carrying white text
  uses `--color-brand-text: #B91C1C` (≈5.9:1); `#DC2626` stays a fill and an accent only.
- **Money:** always `formatMoney(value)` → `$1,234.50` (two decimals); KPI/headline figures use
  `formatMoneyWhole(value)` → `$1,235`. **Dates:** always `formatDate` or `formatDateTime` from
  `src/utils/format.ts`. No inline `toLocaleString`, no hard-coded `'en-US'` at call sites.
- **Targets:** every interactive element is ≥ 44×44 px (`min-h-11`). Inputs are ≥ 16px font on
  mobile so iOS Safari does not zoom on focus. One deliberate exception to the token scale: mobile form
  controls use Tailwind's `text-base` (16px) below `sm` and `text-body` above it — this is the only place
  a size outside the five tokens is allowed, and it exists to stop the iOS focus zoom.
- **One primary action per view.** Exactly one `variant="primary"` (red) button per rendered **section
  content area**. The header's Save button is the single exempt global primary — it is the app's one
  always-available action and the brand doc lists Save as a primary CTA; no other control in the header
  is red. `bg-slate-900` is never a primary action. Amber/emerald are status colours, never CTAs.
- **Budgets (enforced by `npm run verify:bundle`), all in KiB (1024 B):** the **eager set** — every
  `/assets/*.js` and `/assets/*.css` referenced by `dist/index.html`, i.e. what a cold load must fetch
  before first paint — ≤ 300 KiB; total precached assets ≤ 420 KiB. Today: **399.1 KiB** eager
  (`index-*.js` 346.1 + `index-*.css` 52.9) and **1,036.8 KiB** precached. Defining the entry metric as
  the eager set from `index.html` rather than `index-*.js` alone is deliberate: it stops the
  `manualChunks` split in Task 23 from moving React into a vendor chunk that satisfies the number while
  breaking offline boot.
- **Gates for every task:** `npm run lint` exits 0, `npm test` passes, and after any change that
  can touch domain math also `npm run verify:budget`, `verify:workorders`, `verify:selections`.
- **No new runtime dependencies.** `motion` (framer-motion) is unused and gets removed.
- **Commit per task**, message prefix `ui:`.

## Review Focus

Five input classes the spec implies but no task's own tests exercise. Each is pinned to the task
that owns the code.

1. **Cold offline launch after the precache scope shrinks** — the shell must still boot with the
   network off, from cache alone. Owned by Task 22.
2. **A 40+ trade job on a 375px viewport** — card collapse, search, and scroll performance must
   hold; this is the largest real job shape, not the 8-trade sample. Owned by Tasks 13, 25.
3. **A stale service worker after a deploy** — a hashed chunk that 404s must land in the error
   boundary with a recovery path, never a blank page. Owned by Tasks 3, 22.
4. **Non-US locale, or clipboard permission denied** — `Intl` output and the copy path must not
   silently claim success. Owned by Tasks 1, 25.
5. **Motion-sensitive and colour-vision-deficient users** — reduced motion honoured, and
   criticality/weekends still distinguishable in greyscale. Owned by Tasks 6, 17.

---

## Phase 0 — Instruments (do these first; they gate everything else)

### Task 1: Test harness and shared formatters

**Files:**
- Create: `vitest.config.ts`, `src/test/setup.ts`, `src/utils/format.ts`, `src/utils/format.test.ts`
- Modify: `package.json`, `tsconfig.json`, `src/utils/workOrders.ts` (re-export only, lines ~322)

**Interfaces:**
- Produces: `formatMoney(value: number): string`; `formatMoneyWhole(value: number): string`;
  `formatDate(iso: string): string`; `formatDateShort(iso: string): string`;
  `formatDateTime(iso: string): string`; `formatPercent(value: number, decimals?: number): string`;
  `toNumberOrNull(raw: string): number | null`
- **`formatMoney` already exists** at `src/utils/workOrders.ts:322` and is imported by
  `BuyoutBudgetSection`, `CustomersSection`, `CustomerSelectionsSection`, `WorkOrdersSection`,
  `workOrderPdf.ts` and `customerSelectionsPdf.ts`. `format.ts` becomes the single definition;
  `workOrders.ts` **re-exports it** so existing imports keep working. Output must stay byte-identical
  (hard-coded `en-US`, two decimals) because the generated PDF text layout depends on it.

- [ ] **Step 1:** Add dev deps `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`; add scripts `"test": "vitest run"`, `"test:watch": "vitest"`. Run `npm i`.
- [ ] **Step 2:** Write `vitest.config.ts`: `environment: 'jsdom'`, `globals: false`, `setupFiles: ['src/test/setup.ts']`, `include: ['src/**/*.test.{ts,tsx}']`, and reuse the `@` alias from `vite.config.ts`. Set `globals: false` so tests **import** `{ describe, it, expect }` from `'vitest'` explicitly — this keeps `npm run lint` (`tsc --noEmit`) green, because `tsconfig.json` currently pins `"types": ["vite/client"]` and bare globals would not type-check. Add `vitest.config.ts` and `src/**/*.test.*` to `tsconfig.json`'s `include`, and have `src/test/setup.ts` import `'@testing-library/jest-dom/vitest'` (the `/vitest` entrypoint carries the matcher types).
- [ ] **Step 3:** Write the failing tests in `src/utils/format.test.ts`, pinning the constraint values exactly:
  `formatMoney(1234.5) === '$1,234.50'`; `formatMoneyWhole(1234.5) === '$1,235'`;
  `formatDate('2026-10-05T00:00:00Z') === 'Oct 5, 2026'`; `formatDateShort('2026-10-05T00:00:00Z') === '10/05/26'`;
  `formatPercent(12.53) === '12.5%'`; `toNumberOrNull('') === null`; `toNumberOrNull('12.5') === 12.5`;
  `toNumberOrNull('abc') === null`; `toNumberOrNull('1e5') === null` (exponent notation is rejected, not
  silently coerced). **Review Focus 4:** assert the output is stable under a non-US process locale — call
  `formatMoney` and `formatDate` after setting `process.env.LANG='de_DE.UTF-8'` and assert the same strings.
- [ ] **Step 4:** Run `npm test` → FAIL (`Cannot find module './format'`).
- [ ] **Step 5:** Implement `src/utils/format.ts`. Cache one `Intl.NumberFormat('en-US', …)` and one
  `Intl.DateTimeFormat('en-US', …)` at module scope per shape — constructing them per row is a real render
  cost on a long ledger. All date parsing is **UTC-pinned** (append `T00:00:00Z` when the input is a bare
  `YYYY-MM-DD`), otherwise `'2026-10-05T00:00:00Z'` renders as Oct 4 in any negative-offset timezone.
  `toNumberOrNull` uses a strict `^-?\d*\.?\d+$` test, not `Number()`, so `'1e5'` and `' '` return `null`.
  Then move the body of `workOrders.ts`'s `formatMoney` here and leave `export { formatMoney } from './format';`
  behind, and re-run `npm run verify:workorders` to prove PDF output is unchanged.
- [ ] **Step 6:** Run `npm test` → PASS. Run `npm run lint` → exit 0. Run `npm run verify:workorders` and
  `verify:selections` → pass (byte-identical money formatting).
- [ ] **Step 7:** Commit `ui: add vitest harness and shared formatters`.

**Deferred, with an owner:** the remaining `toLocaleString` call sites migrate in Task 7
(`GanttScheduleSection.tsx:284`, `IntakeSection`, `TradePackagesSection.tsx:321`) and Task 7/8 for
`gappsApi.ts` display strings. `check-tokens.mjs` (Task 6) adds a guard for `toLocaleString(` outside
`src/utils/format.ts` once those land.

### Task 2: Record the mobile baseline and add the bundle/precache budget guard

**Files:**
- Create: `scripts/check-bundle-budget.mjs`, `docs/superpowers/baselines/2026-10-11-mobile-baseline.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run verify:bundle` (advisory) and `npm run verify:bundle -- --enforce` (exits 1 on breach)

- [ ] **Step 1:** Write the baseline doc from measured `dist/`, in KiB: per-file sizes, eager set
  **399.1 KiB** (346.1 JS + 52.9 CSS), precache total **1,036.8 KiB**, the **448.2 KiB** Work Orders
  path, plus the audit's viewport findings (`scrollWidth === viewport` at 375/640/1024/1440; header wraps
  to ~120px at 320–390px with a job loaded).
- [ ] **Step 2:** Write `scripts/check-bundle-budget.mjs`. Compute the **eager set** by parsing
  `dist/index.html` for every `/assets/*.js` and `/assets/*.css` reference — not `index-*.js` alone, so
  Task 23's chunk split cannot satisfy the metric while pushing React into a chunk a cold load still
  needs. Compute precache by reading the `const BUILD_ASSETS = [...]` array **out of `dist/sw.js`**, which
  is the ground truth of what the worker will actually precache; fall back to "every `.js|.css` in
  `dist/assets`" only when that marker is absent (pre-Task-22 builds). Print a table in KiB; warn when
  over; exit 1 only with `--enforce`; exit 0 with a warning when `dist/` is missing.
- [ ] **Step 3:** Add `"verify:bundle": "node scripts/check-bundle-budget.mjs"`.
- [ ] **Step 4:** Run `npm run build && npm run verify:bundle` → prints 399.1 KiB / 1,036.8 KiB against
  the 300/420 budgets and exits 0. Run with `-- --enforce` → exits 1. **This is the intentional red
  state**; Task 23 flips the default to enforcing.
- [ ] **Step 5:** Commit `ui: record mobile baseline and add bundle budget guard`.

### Task 3: App and section error boundary, plus a named loading state

**Files:**
- Create: `src/components/AppErrorBoundary.tsx`, `src/components/SectionFallback.tsx`, `src/components/SectionFallback.test.tsx`
- Modify: `src/App.tsx` (replace the inline fallback at 69–74; wrap the `<Suspense>` at 614; wrap the root)

**Interfaces:**
- `SectionFallback: React.FC<{ label: string }>`
- `AppErrorBoundary: React.ComponentClass<{ children: React.ReactNode; scope: 'app' | 'section' }>`

- [ ] **Step 1:** Failing test: render `<SectionFallback label="Schedule" />`; assert
  `getByRole('status')` has accessible name matching `/Loading Schedule/i` and carries `aria-busy="true"`.
- [ ] **Step 2:** Run `npm test` → FAIL.
- [ ] **Step 3:** Implement `SectionFallback` with **visible** text (the audit found the current copy is
  `sr-only`, so sighted users get a bare spinner).
- [ ] **Step 4:** Add `AppErrorBoundary` tests: a child that throws renders the fallback inside
  `role="alert"`; `scope="section"` offers "Reload section" and "Reload app"; clicking "Reload section"
  clears the error and re-renders the child.
- [ ] **Step 5:** Implement `AppErrorBoundary`; in `App.tsx` wrap the lazy `<Suspense>` with
  `scope="section"` and the whole shell with `scope="app"` so the shell stays mounted. **Review Focus 3:**
  the section boundary's reset must clear the error state without a full page reload.
- [ ] **Step 6:** `npm test` → PASS; `npm run lint` → exit 0.
- [ ] **Step 7:** Commit `ui: add error boundaries and named section loading state`.

## Phase 1 — The system underneath

### Task 4: Design-token layer and contrast utilities

**Files:**
- Modify: `src/index.css` (`@theme` at lines 4–8; `instructions/uibranding`)
- Create: `src/utils/contrast.ts`, `src/utils/contrast.test.ts`

**Interfaces:**
- Produces the CSS custom properties below; `contrastRatio(a: string, b: string): number`;
  `meetsAA(ratio: number, opts?: { large?: boolean }): boolean`

- [ ] **Step 1:** Add to `@theme`, keeping the three existing colour tokens unchanged:
  type scale (`--text-micro/label/body/title/figure` + two line-heights); semantic colour
  (`--color-brand-text: #B91C1C`, `--color-danger: #BE123C`, `--color-critical: #DC2626`,
  `--color-success: #10B981`, `--color-warning: #F59E0B`, `--color-muted-text: #64748B`,
  `--color-placeholder: #94A3B8`); radius (`--radius-control: 0.5rem`, `--radius-card: 0.75rem`,
  `--radius-modal: 1rem`); elevation (`--shadow-float`, `--shadow-modal`); and
  **`--header-height: 76px`** — the one value Tasks 10, 11 and 13 derive sticky offsets and `max-h`
  calculations from, so nothing hard-codes `top-24`, `top-20` or a `100dvh-7rem` stack again.
- [ ] **Step 1b:** Add chart tokens **without renaming the library's contract**. frappe-gantt reads only
  its own variable names, so keep `--g-bar-color`, `--g-today-highlight` and
  `--g-weekend-highlight-color` (the app passes the last one into `holidays` at
  `GanttScheduleSection.tsx:272`) and **add** app-owned `--g-critical-fill`, `--g-standard-fill`,
  `--g-pinned-stroke` and `--g-today-marker` alongside them. Renaming a library variable silently drops
  the theming instead of re-tokenising it.
- [ ] **Step 2:** Write failing tests in `src/utils/contrast.test.ts`: `contrastRatio('#FFFFFF','#B91C1C') >= 4.5`;
  `contrastRatio('#FFFFFF','#64748B') >= 4.5`; `contrastRatio('#FFFFFF','#94A3B8') < 4.5` (documents why
  `slate-400` is banned as text); `contrastRatio('#FFFFFF','#DC2626') < 4.5` (documents why
  `red-600` never carries a label).
- [ ] **Step 3:** Run `npm test` → FAIL, then implement both functions (WCAG relative luminance).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Update `instructions/uibranding`: replace the stale §9 gap list (it names
  `SectionInsurance`, `SectionTeam`, `SectionMortgage`, `SectionChangeOrder`, `SectionChecklist` —
  none exist) with the new token names, the contrast floor, and the sharpened red rule.
- [ ] **Step 6:** Commit `ui: add design token layer and contrast utilities`.

### Task 5: Shared UI primitives

**Files:**
- Create: `src/components/ui/{Container,Card,SectionHeader,KpiStat,EmptyState,Button,Field}.tsx`,
  `src/components/ui/index.ts`, and one test file per primitive under `src/components/ui/`

**Interfaces:**
- `Container: React.FC<{ children: React.ReactNode; className?: string }>` — owns
  `max-w-[1400px]` and `px-3 sm:px-5`; **the only** place either value appears.
- `Card: React.FC<{ children: React.ReactNode; className?: string }>` — white, `border-slate-200`, `rounded-card`.
- `SectionHeader: React.FC<{ title: string; description?: string; action?: React.ReactNode }>`
- `KpiStat: React.FC<{ label: string; value: string; tone?: 'neutral' | 'positive' | 'critical' }>`
- `EmptyState: React.FC<{ icon?: React.ElementType; title: string; body: string; action?: React.ReactNode }>`
- `Button: React.FC<{ variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'md' | 'lg'; … } & ButtonHTMLAttributes<HTMLButtonElement>>`
- `Field: React.FC<{ label: string; hint?: string; error?: string; id: string; children: React.ReactNode }>`

- [ ] **Step 1:** Write `Container` tests: it renders `max-w-[1400px]` and `px-3 sm:px-5` on the same node.
  (The assertion that *no other file* contains those literals cannot land yet — `Header.tsx`, `App.tsx`
  main and the footer still carry them; it lands in Task 7 Step 5 once those are migrated.)
- [ ] **Step 2:** Write `Button` tests: `variant="primary"` is the only variant emitting `bg-brand-text`;
  `bg-slate-900` appears in no variant; every variant carries
  `focus-visible:ring-2 focus-visible:ring-red-500`; `size="lg"` yields `min-h-11`.
- [ ] **Step 3:** Write `Field` tests: the label is linked by `htmlFor`, `error` sets `aria-invalid` on the
  child and `aria-describedby` pointing at the error node, and the error node has `role="alert"`.
- [ ] **Step 4:** Write `EmptyState` tests: `role="status"`, title and body rendered, `action` rendered once.
- [ ] **Step 5:** Write `KpiStat` tests: label is `text-label`, value is `text-figure` and `tabular-nums` —
  pinning the single KPI shape that replaces the two competing ones.
- [ ] **Step 6:** Implement the seven primitives against these tests. `npm test` → PASS; `npm run lint` → exit 0.
- [ ] **Step 7:** Commit `ui: add shared container, card, button, field, kpi and empty-state primitives`.

### Task 6: Contrast and motion floor sweep

**Files:**
- Modify: `src/index.css` (line 15 `scroll-behavior`), `src/components/**/*.tsx`, `src/components/BrandLogo.tsx`
- Create: `scripts/check-tokens.mjs`

**Interfaces:**
- Produces: `npm run verify:tokens`

- [ ] **Step 1:** Wrap `scroll-behavior: smooth` in `@media (prefers-reduced-motion: no-preference)`; add a
  global `@media (prefers-reduced-motion: reduce)` block that disables transitions/animations and the
  Gantt first-paint animation. `prefers-reduced-motion` currently appears **0** times in `src/**`.
- [ ] **Step 2:** Replace every `text-slate-400` (132 sites) and `text-slate-300` (4) with `text-muted-text`
  — a class-only substitution, so it is safe to apply with a scripted sweep. Keep `--color-placeholder`
  for placeholder attributes and decorative icons only, never for label text.
- [ ] **Step 3:** Move text-bearing red to `bg-brand-text`/`text-brand-text`: the header Save at
  `Header.tsx:32`, `ConfirmModal` confirm, and every `bg-red-600 text-white` pair.
- [ ] **Step 4:** Collapse the duplicated palette constants: `BrandLogo.tsx:15–19` JS constants and
  `workOrderPdf.ts:44–46` `rgb()` literals read from one exported palette module instead of re-declaring
  the hex values a third and fourth time.
- [ ] **Step 5:** Write `scripts/check-tokens.mjs`: fails if `text-slate-400`, `text-slate-300`, or a
  `text-[<number>px]` utility appears in `src/components/**` (the Gantt override block in `index.css` is
  exempt — it styles third-party markup). Scope it to the **type scale and contrast** rules only:
  `bg-slate-900` is governed by Task 20, because the `TradePackagesSection.tsx:81` primary must stay
  untouched until its replacement action exists. Add `"verify:tokens": "node scripts/check-tokens.mjs"`.
- [ ] **Step 6:** Run `npm run verify:tokens` → FAIL on the remaining `text-[Npx]` (expected; Task 7 clears
  those). Confirm it passes for the patterns you did clear. `npm run lint` → exit 0.
- [ ] **Step 7:** Commit `ui: enforce contrast and reduced-motion floor, single palette source`.

### Task 7: Migrate the shell, Home, intake and auth onto tokens and primitives

**Files:**
- Modify: `src/App.tsx`, `src/components/Header.tsx`, `src/components/SideMenu.tsx`,
  `src/components/Toast.tsx`, `src/components/ConfirmModal.tsx`, `src/components/EntryCard.tsx`,
  `src/components/SectionFallback.tsx`, `src/components/LoginPage.tsx`, `src/components/InstallPwa.tsx`,
  `src/components/sections/HomeSection.tsx`, `src/components/sections/IntakeSection.tsx`

- [ ] **Step 1:** Apply the type-scale mapping across these files: `9px`/`10px`/`11px` → `text-micro`;
  `12px` → `text-label`; `13px`/`14px` → `text-body`; `15px`/`16px`/`17px`/`18px` → `text-title` (keep
  `text-title` for headings, `text-body` for inputs and buttons); `22px`/`24px` → `text-figure`.
- [ ] **Step 2:** Replace the header/main/footer width and gutter literals with `Container`.
- [ ] **Step 3:** Replace the `EntryCard` "no estimate" card (`EntryCard.tsx:157–191` region and its
  duplicates) with `EmptyState`; convert the mode switcher to `role="tablist"` with `aria-selected`, and
  disable it while `isProcessing`.
- [ ] **Step 4:** Route every date and money render in these files through `formatDate`/`formatDateTime`/
  `formatMoney`/`formatMoneyWhole`.
- [ ] **Step 5:** Add the single-source assertion deferred from Task 5: no file under `src/` outside
  `src/components/ui/Container.tsx` contains `max-w-[1400px]`, and the footer gutter matches the content
  gutter. Verify: `npm run verify:tokens` reports no remaining arbitrary sizes in these files;
  `npm test`, `npm run lint` pass.
- [ ] **Step 6:** Commit `ui: migrate shell, home, intake and auth to design tokens`.

### Task 8: Migrate the six workflow sections onto tokens and primitives

**Files:**
- Modify: `src/components/sections/{BuyoutBudgetSection,TradePackagesSection,WorkOrdersSection,CustomersSection,CustomerSelectionsSection,JsonExportSection,WorkspaceSyncSection}.tsx`,
  `src/components/QuickAdd.tsx`, `src/components/TaskDetailsModal.tsx`

- [ ] **Step 1:** Apply the same type-scale mapping.
- [ ] **Step 2:** Replace **five** copy-pasted "no estimate" cards (`BuyoutBudgetSection.tsx:76–88`,
  `TradePackagesSection.tsx:33–45`, `WorkOrdersSection.tsx:108–121`, `JsonExportSection.tsx:25–37`,
  `WorkspaceSyncSection.tsx:54–66`) with `EmptyState`.
- [ ] **Step 3:** Replace the two KPI card styles (`BuyoutBudgetSection.tsx:275` vs `937`) with `KpiStat`.
- [ ] **Step 4:** Route all money and dates through the shared formatters: this fixes the same-table
  disagreement between `toLocaleString(undefined, …)` (`BuyoutBudgetSection.tsx:427`) and `formatMoney`
  (587, 601), and the 2-decimal/none split between Approved RCV and Target Buyout (434, 504, 693, 699).
- [ ] **Step 5:** Delete the `QuickAdd.tsx:200–204` gradient + hover-scale + rotate FAB in favour of a flat
  `bg-brand-text` circle with `transition-colors`.
- [ ] **Step 6:** Run `npm run verify:tokens` → PASS (0 arbitrary text sizes, 0 `text-slate-400`/`300` over
  all of `src/components/**`). Run `npm test`, `npm run lint`, `npm run verify:budget`, `verify:workorders`,
  `verify:selections` → all pass.
- [ ] **Step 7:** Commit `ui: migrate workflow sections to design tokens and shared primitives`.

## Phase 2 — Mobile field ergonomics

### Task 9: One-row mobile header and a single shell container

**Files:** Modify `src/components/Header.tsx`, `src/App.tsx`, `src/components/ui/Container.tsx`

- [ ] **Step 1:** Test the layout contract: at 320px the header renders exactly one row — assert the
  action group has `flex-nowrap` and that only one of {Save, New job} is a full labelled button, the rest
  collapse into an overflow menu button.
- [ ] **Step 2:** Implement the overflow menu (labelled "More actions", `aria-haspopup="menu"`,
  `aria-expanded`), holding New job, sign-out and install; keep the primary action in row one. Today the
  header is a 73px `flex-wrap` row that grows to ~120px at 320–390px with a job loaded.
- [ ] **Step 3:** Give the footer the same `Container` (today it hard-codes `px-5` against the content's
  `px-3 sm:px-5`, so the left edge drifts 8px on phones).
- [ ] **Step 4:** Standardise the page-title size — `HomeSection.tsx:73` uses `text-3xl` while section
  headings use `text-2xl`; make both `text-figure`.
- [ ] **Step 5:** Verify at 360×640 and 390×844: header height ≤ 76px with a job loaded, no horizontal
  overflow, the primary action visible without scrolling. `npm test`, `npm run lint`.
- [ ] **Step 6:** Commit `ui: single-row mobile header and shared shell container`.

### Task 10: Mobile navigation as a proper sheet, with explained disabled states

**Files:** Modify `src/components/SideMenu.tsx`

- [ ] **Step 1:** Tests: with no job loaded, the eight unavailable sections are still focusable and each
  exposes `aria-describedby` pointing at a reason ("Open a job to use this section") — today they are
  `disabled` with only a `title`, so keyboard and touch users get eight unexplained grey rows.
- [ ] **Step 2:** Test Escape: with the panel open and focus on `<body>`, Escape closes it. Today Escape is
  bound to a plain `<div>` `onKeyDown` that only fires when focus is already inside it.
- [ ] **Step 3:** Make the open panel a capped, scroll-locked sheet (`max-h-[70dvh] overflow-y-auto` plus a
  body scroll lock) so the lower groups are reachable without scrolling the page behind it. The current
  in-flow panel is ~560px tall at 375×667.
- [ ] **Step 4:** Tighten the closed toggle from `min-h-14` with a two-line label to a single `min-h-11` row,
  and keep one column below `md` (the current `sm:grid-cols-2` reads column-wise and fragments the sequence).
- [ ] **Step 5:** Fix the desktop offset: `lg:top-24` (96px) assumes a 112px stack against a 73px header,
  so the sidebar floats ~23px low and its last row can be clipped. Derive both the `top` and the
  `max-h` from one shared header-height token.
- [ ] **Step 6:** Verify at 375×667: menu opens, all groups reachable, Escape closes, focus ring visible,
  no page-level scroll while open. `npm test`, `npm run lint`.
- [ ] **Step 7:** Commit `ui: mobile navigation sheet with explained disabled states`.

### Task 11: Toast stack with announced status and a reachable dismiss

**Files:** Modify `src/components/Toast.tsx`, `src/App.tsx`

**Interfaces:**
- `Toast` becomes `React.FC<{ toasts: ToastMessage[]; onDismiss: (id: string) => void }>`;
  `App` holds `toasts: ToastMessage[]` and `showToast` pushes instead of replacing.

- [ ] **Step 1:** Tests: rendering a success toast exposes `role="status"`; an error toast exposes
  `role="alert"`; pushing a second toast keeps the first (today a single slot lets a new message
  overwrite an unseen one).
- [ ] **Step 2:** Implement the queue in `Toast.tsx` + `App.tsx` (cap at 3, newest first, each with its own
  5s timer).
- [ ] **Step 3:** Size the dismiss control to `min-h-11 min-w-11` with a focus-visible ring (today `p-1`
  around a 14px icon, ≈22px).
- [ ] **Step 4:** Anchor placement below the sticky header via the shared header-height token instead of a
  hard-coded `top-20`; move to the bottom on small screens so it cannot cover the header action row.
- [ ] **Step 5:** `npm test`, `npm run lint`; verify visually that two stacked toasts do not overlap the
  header at 375px.
- [ ] **Step 6:** Commit `ui: queued, announced toasts with mobile-safe placement`.

### Task 12: iOS input zoom, touch targets, install affordance and login scroll

**Files:** Modify `src/components/LoginPage.tsx`, `src/components/InstallPwa.tsx`,
`src/components/ui/Field.tsx`, `src/index.css`

- [ ] **Step 1:** Set every input to `text-base` (16px) below `sm` and `text-body` above it, so iOS Safari
  stops zooming and mis-framing on focus. `LoginPage.tsx:139` is `text-[13px]` at `h-11` today.
- [ ] **Step 2:** Enlarge the sub-44px controls: the password show/hide toggle (`LoginPage.tsx:163`,
  ≈24px), the toast dismiss (Task 11), and the iOS install sheet close (`InstallPwa.tsx:144`, ≈28px).
- [ ] **Step 3:** Make login scrollable on short/landscape viewports: `items-start sm:items-center` with
  `py-8`. Today `min-h-screen` + `items-center` clips the top of the ~520px card below 540px tall and the
  email field becomes unreachable.
- [ ] **Step 4:** Add `role="alert"` to the login error banner and wire `aria-invalid`/`aria-describedby`
  to the offending input (`LoginPage.tsx:106`).
- [ ] **Step 5:** Make the install affordance reachable on phones: the button label is `hidden sm:inline`
  today, so it is invisible exactly where it matters. Write the dismissal flag only on an explicit close
  (`InstallPwa.tsx:67` currently writes it on any backdrop tap), and add a manual "How to install" entry.
- [ ] **Step 6:** Verify at 375×667 with a keyboard-height viewport (375×400): the login form scrolls, no
  zoom on focus, every target ≥ 44px. Emulate with device toolbar. `npm test`, `npm run lint`.
- [ ] **Step 7:** Commit `ui: mobile input, touch-target and install-affordance fixes`.

### Task 13: Responsive data surfaces — table above `md`, labelled cards below

**Files:**
- Create: `src/components/ui/DataSurface.tsx` (+ test)
- Modify: `BuyoutBudgetSection.tsx`, `WorkOrdersSection.tsx`, `GanttScheduleSection.tsx`,
  `CustomerSelectionsSection.tsx`

**Interfaces:**
- `DataSurface<T>`: a generic function component with props
  `{ columns: { key: string; header: string; align?: 'left' | 'right'; numeric?: boolean }[]; rows: T[];
  rowKey: (row: T) => string; renderCells: (row: T) => React.ReactNode; renderCard: (row: T) => React.ReactNode;
  caption: string }` — one component, both presentations, so a column cannot exist in one and not the other.

- [ ] **Step 1:** Test `DataSurface`: it renders **one** DOM tree containing `<table>` with a `caption`
  and `scope="col"` headers, plus the card list; assert the table wrapper carries `hidden md:block` and the
  card wrapper carries `md:hidden`. Switching is **CSS-only** — no JavaScript `matchMedia` branch, so there
  is no hydration risk and the test needs no `matchMedia` stub (jsdom has none, and a JS branch would make
  the "no `<table>` below md" assertion untestable). Assert every column header appears in both
  presentations, which is what stops the two drifting apart.
- [ ] **Step 2:** Implement `DataSurface` with `hidden md:block` / `md:hidden` presentation switching, a
  sticky `thead` offset by `--header-height`, and horizontal-scroll containment.
- [ ] **Step 3:** Adopt it in the four sections. Rework `CustomerSelectionsSection.tsx:377–519` from a
  six-field grid per row with repeated labels and `pt-5` alignment hacks into one `DataSurface` with a
  single header row.
- [ ] **Step 4:** **Review Focus 2:** verify a 40-row buyout ledger at 375px — cards read in one column, no
  horizontal scroll, row actions reachable; and at 1024px — the table's sticky header holds while scrolling.
- [ ] **Step 5:** `npm test`, `npm run lint`, `npm run verify:budget`, `verify:selections` → pass.
- [ ] **Step 6:** Commit `ui: responsive data surfaces with card collapse below md`.

## Phase 3 — Schedule correctness before schedule polish

### Task 14: Repair the dead Day/Week/Month scale toggle

**Files:** Modify `scripts/verify-gantt.mjs`, `src/components/sections/GanttScheduleSection.tsx`
(options at 231–272), `src/index.css`

**Why first:** this is a control that lies. `frappe-gantt`'s `setup_options` runs
`t.view_mode = t.view_modes[0]` (`node_modules/frappe-gantt/dist/frappe-gantt.es.js:873`) and the app
passes `view_modes: ['Day', 'Week', {Month}]` (248–266) alongside `view_mode: viewMode` (232), so
`Day` always wins. `gantt-verify.png` and `gantt-verify-month.png` differ in only 6,234 of 1.4M pixels
— the toggle button and its caption — while the chart region is pixel-identical.

- [ ] **Step 1:** Repair the capture harness **before touching the chart**, because this task's visual
  proof and Task 17's depend on it. `scripts/verify-gantt.mjs` hard-codes `APP_URL=http://localhost:3002`, a
  fixed `chrome.exe` path, and `clickByLabel('Gantt Schedule')` — a label that no longer exists (the nav
  entry is `Schedule`, `SideMenu.tsx:24`) — and it never loads a job, so the section never opens and
  `shoot()` throws. Take the base URL from an env var with a documented default, drive the real nav label,
  and load a sample job (or seed `currentEstimate`) before navigating. Confirm it produces two PNGs from a
  clean run.
- [ ] **Step 2:** Write the failing unit test: build the gantt options through the extracted helper and
  assert `view_modes.length === 1` and `view_modes[0]` matches the selected mode for each of `'Day'`,
  `'Week'`, `'Month'`.
- [ ] **Step 3:** Run `npm test` → FAIL.
- [ ] **Step 4:** Extract `buildGanttOptions(viewMode, …)` into `src/utils/ganttOptions.ts` and pass only
  the selected mode (`view_modes: [modeFor(viewMode)]`). Keep the custom Month descriptor (200px column)
  as the `'Month'` entry, since the chart is rebuilt on `viewMode` change anyway.
- [ ] **Step 5:** `npm test` → PASS.
- [ ] **Step 6:** Prove it visually: re-run the repaired harness for both scales and confirm the chart
  region now differs (the axis labels change) — today the two PNGs differ in only 6,234 of 1.4M pixels.
  Overwrite `gantt-verify.png` / `gantt-verify-month.png`.
- [ ] **Step 7:** `npm run lint`; commit `ui: fix dead gantt scale toggle`.

### Task 15: Fix short-bar labels and the 10px floor

**Files:** Modify `src/index.css` (144–155), `src/components/sections/GanttScheduleSection.tsx`

- [ ] **Step 1:** Test-friendly assertion: a script check that `index.css` contains
  `.xg-gantt .bar-label.big` and does **not** contain `.bar-wrapper.big .bar-label`.
- [ ] **Step 2:** Fix the selector. The library adds `big` to the label element itself
  (`frappe-gantt.es.js:646`), so the current rule never matches and the label keeps the white fill from
  line 145 — long names on short bars render white-on-white (measured darkest glyph pixel `#ECF0F6` on
  `#FFFFFF`, ≈1.05:1).
- [ ] **Step 3:** Raise bar labels from 10px to the 11px micro floor and add a truncation strategy: short
  name inside the bar, full name in the popup and in the Schedule Detail table.
- [ ] **Step 4:** Add `paint-order: stroke` with a dark halo for in-bar labels so white text survives both
  a red critical bar and a pale weekend band.
- [ ] **Step 5:** Verify by cropping the chart region of the re-captured screenshot and confirming every
  label sits on a contrasting background. `npm run lint`.
- [ ] **Step 6:** Commit `ui: fix gantt bar label contrast and size`.

### Task 16: Make touch rescheduling work, or make it impossible

**Files:** Modify `src/components/sections/GanttScheduleSection.tsx` (gesture refs 205–215, 297, 640–660;
table 683–760)

**Why:** the app sets `draggedBarIdRef` on `onMouseDown` only, while the library binds `touchstart`
(`frappe-gantt.es.js:542`), and `on_date_change` bails unless the ref matches. On a phone the bar moves
under the finger and the reschedule is **silently discarded** — the worst possible failure for a
scheduler, and the primary audience is on a tablet.

- [ ] **Step 1:** Decide and record the rule: dragging is a pointer-agnostic interaction. Test the
  handler contract by extracting `beginDrag(taskId)` / `commitDrag(taskId, start, end)` and asserting
  `commitDrag` persists via `onUpdateTrade` for a task begun by either a mouse or a touch start.
- [ ] **Step 2:** Implement `onPointerDown`/`onPointerUp` parity (or keep `onMouseDown` and add a matching
  `touchstart` path), so the ref is set for touch.
- [ ] **Step 3:** Disable drag on coarse pointers only if Step 2 cannot be made reliable; in that case route
  rescheduling through the details modal and hide the drag cursors under
  `@media (pointer: coarse)`.
- [ ] **Step 4:** Make the Schedule Detail table the accessible primary surface: mark the SVG
  `aria-hidden="true"`; replace the clickable `<tr>` (`695–701`, mouse-only) with a real `<button>` around
  the trade name; the row's only keyboard-reachable control is currently the destructive Remove.
- [ ] **Step 5:** Verify on a touch emulation profile: drag a bar, confirm the change sticks and survives a
  section switch; and confirm every row's details are reachable by keyboard alone.
- [ ] **Step 6:** Commit `ui: touch-capable rescheduling and accessible schedule rows`.

### Task 17: Chart legibility and honest semantics

**Files:** Modify `src/index.css` (84–105, 113–141, 166–170), `src/components/sections/GanttScheduleSection.tsx`

- [ ] **Step 1:** Weekend shading: `#F1F5F9` on `#FFFFFF` is 1.10:1 — the "weekends shaded" promise is
  imperceptible, so a 17-workday project looks like it runs 7 days a week. Use the `--g-weekend-fill`
  token plus a diagonal hatch so the channel is not colour alone, and make the legend swatch
  (`GanttScheduleSection.tsx:621–624`) render the identical treatment.
- [ ] **Step 2:** Give the today marker its own token and weight (slate-900 dashed hairline plus a dot),
  reserving `#DC2626` for criticality. Today `--g-today-highlight` and the critical fill are the same red,
  so the marker vanishes against any critical bar (1:1).
- [ ] **Step 3:** Add a non-colour channel for criticality (heavier stroke or end cap) and give the toggle's
  off-state its own visual: with criticality off, critical bars become the standard `#334155` (red vs slate
  = 2.14:1), so the legend's "Standard Trade" entry is unreachable.
- [ ] **Step 4:** Fix the axis override: `index.css:166–170` targets `.grid-header`, but the axis text lives
  in `.lower-text`/`.upper-text` and keeps its own library colour, so the intended 11px/600 `#475569` axis
  never applies.
- [ ] **Step 5:** Remove the inner vertical scroller: size the container to the row count (8 rows ≈ 300px)
  instead of `container_height: 'auto'`, keeping horizontal scroll only. Today the chart has both, and the
  right-hand track covers the project-finish bar.
- [ ] **Step 6:** Accept a tap/click popup and flip its x at the container edge (`popup_on: 'hover'` with an
  absolute `left = bar.x + 10` never appears for touch and clips at the right edge). Add a legend key for
  the pinned/amber-dashed state and an `aria-label` for the pinned table cell (`721–724`).
- [ ] **Step 7:** Make the copy honest: the header promises "inspection milestones" but no milestone is
  rendered and every bar is hard-coded `progress: 0`; either render them or delete the claim. Compute
  "Calendar Span" as the real start→finish span (`594–596` currently uses `totalWorkdays * 1.4`) and drop
  its emerald status colour, which the brand doc reserves for "saved/connected".
- [ ] **Step 8:** Darken `--g-weekend-label-color` (`#E2E8F0` on a `#F8FAFC` header, 1.2:1 — an invisible
  hover chip), add `scope="col"` and a visually hidden `<caption>` to the detail table, and raise the
  near-invisible delete affordance from `text-slate-300` (1.48:1) to at least the muted floor.
- [ ] **Step 9:** **Review Focus 5:** convert the re-captured chart screenshot to greyscale and confirm
  weekends, criticality and the today marker remain distinguishable with colour removed. `npm run lint`.
- [ ] **Step 10:** Commit `ui: gantt legibility, status separation and honest metrics`.

## Phase 4 — Declutter and one primary action

### Task 18: Navigation labels, section titles and deep-linking

**Files:** Modify `src/components/SideMenu.tsx`, `src/App.tsx`, `src/components/sections/HomeSection.tsx`

- [ ] **Step 1:** Resolve the label contradiction: the nav entry and the mobile toggle say "Home" while the
  page `h1` says "Job overview". Pick "Home" for both, and assert in a test that every nav label matches
  the heading rendered for that section.
- [ ] **Step 2:** Derive `activeSection` from `location.hash` and push a history entry on change, so a
  mid-task refresh returns the supervisor to their section instead of Home, and Back does not exit the app.
  Test: setting `location.hash = '#gantt'` renders the schedule; navigating pushes a new entry.
- [ ] **Step 3:** Keep the existing 10 items and 4 groups (it is a sound IA) but stop the mobile two-column
  grid from fragmenting the reading order.
- [ ] **Step 4:** `npm test`, `npm run lint`; verify the hash survives a hard refresh at 375px.
- [ ] **Step 5:** Commit `ui: consistent navigation labels and hash deep-linking`.

### Task 19: Buyout Budget declutter

**Files:** Modify `src/components/sections/BuyoutBudgetSection.tsx`, `src/App.tsx` (prop threading at
624–633)

**Interfaces:**
- Consumes from `App.tsx`: `onShowToast: (type: 'success' | 'warning' | 'error', message: string) => void`
  (already exists in `App` as `showToast`; it is simply not passed to this section yet) and a **new**
  `onMarkBudgetReviewed: () => void` which is the *only* thing that stamps `budget_adjusted_at`.
- Produces: the rule that unlocking final work orders requires an explicit user action, not a keystroke.

**Why:** the same trades render three times — the buyout ledger, the AI Budget Engine master budget, and
the final work-orders card — with two overlapping per-trade tables, and the terminal action
("Generate Final Work Orders", 770–792) sits below two tables and a KPI grid while the first red button on
the page is "Apply 60% to all trades" (265).

- [ ] **Step 1:** Decide the source of truth for RCV and margin — the ledger — and fold the AI master budget
  into a collapsed "Engine detail" disclosure. Remove the duplicate per-trade table.
- [ ] **Step 2:** Hoist "Generate Final Work Orders" into the sticky workflow banner (132) as the single
  primary action; demote bulk-apply to a secondary button and wrap it in a confirm. Because bulk-apply
  rewrites every Sub Bid, the confirm is what calls `onMarkBudgetReviewed` — the reviewed timestamp is a
  consequence of an explicit user decision, never of a keystroke.
- [ ] **Step 3:** Fix the silent failure: `runGenerate` (119–127) has no `catch` and this section receives
  no `onShowToast`. Add `onShowToast` to the props and thread it from `App.tsx:624–633`, then catch the
  rejection and surface the message.
- [ ] **Step 4:** Give Margin Adjust an exact numeric entry alongside the slider, and clamp the displayed
  percentage to the slider's 0–70 range (a `$1` bid on a `$10k` trade currently shows "99.9%" beside a
  slider pinned at 70%).
- [ ] **Step 5:** Add `aria-label`s to the per-row Subcontractor and Sub Bid inputs (`437–463` have neither
  label nor id), and adopt the shared input class so the densest surface stops using `rounded-md`/`h-8`
  against every other control's `rounded-lg`/`h-10`.
- [ ] **Step 6:** Move the workflow step-2 pending state off `bg-red-600 text-white` (182) onto the warning
  token — red must keep meaning "act here", not "not finished".
- [ ] **Step 7:** Enlarge the row expander (402–419) from a 20×20px icon button to ≥ 28px with a visible
  hover/focus row state.
- [ ] **Step 8:** Verify at 375px and 1440px: one primary action visible without scrolling, one table,
  engine detail collapsed by default. `npm test`, `npm run lint`, `npm run verify:budget`.
- [ ] **Step 9:** Commit `ui: declutter buyout budget around one table and one action`.

### Task 20: One primary action per view, and shared status surfaces

**Files:** Modify `TradePackagesSection.tsx`, `WorkOrdersSection.tsx`, `WorkspaceSyncSection.tsx`,
`JsonExportSection.tsx`, `GanttScheduleSection.tsx`

**Interfaces:** no `App.tsx` change is needed — `WorkspaceSyncSection` already receives
`currentUser` (`App.tsx:646–652`), which is the section whose four exports must be gated on sign-in.

- [ ] **Step 1:** Trade Packages: make "Proceed to Buyout" the red primary and demote "New Package" from
  `bg-slate-900` (`81–94`), so the workflow-forward step is the most visible.
- [ ] **Step 2:** Work Orders: reduce three near-equal CTAs (red Generate, slate-900 Download All, white
  Save to Drive) plus an amber primary in the locked state (`280–335`, `301`) to one red primary per state.
- [ ] **Step 3:** Replace the two ad-hoc empty states (`471` amber pill vs `499` red rounded-2xl) and the
  duplicated status/footer card (`780–793` repeats `339–392`) with `EmptyState` and a single status strip.
- [ ] **Step 4:** Exports: disable all four export buttons and show the sign-in affordance when
  `currentUser` is null (`209–225`, `250`, `291`, `332` stay enabled under a "Sign-in Required" banner).
  Give each tool its own busy state — today one `loadingAction` string means the other three stay enabled
  during an in-flight call.
- [ ] **Step 5:** Collapse the three stacked provenance badges (`BuyoutBudgetSection.tsx:893–931`) into one
  status row, and drive the JSON export's "Strict Schema Verified" label (`JsonExportSection.tsx:223`) from
  `estimate.budget_audit.basis` instead of asserting it unconditionally.
- [ ] **Step 6:** Add a test asserting at most one element with the primary variant is present per section
  render (a shared helper the sections' tests call).
- [ ] **Step 7:** `npm test`, `npm run lint`; verify each section visually at 375px and 1440px.
- [ ] **Step 8:** Commit `ui: one primary action per view and shared status surfaces`.

### Task 21: Destructive guards and form feedback

**Files:** Modify `TaskDetailsModal.tsx`, `CustomerSelectionsSection.tsx`, `WorkOrdersSection.tsx`,
`JsonExportSection.tsx`, `BuyoutBudgetSection.tsx`, `EntryCard.tsx`

- [ ] **Step 1:** `TaskDetailsModal`: copy `ConfirmModal`'s focus trap, initial focus and focus restore
  (`ConfirmModal.tsx:35–51`), and require an explicit close when local state differs from props — a
  backdrop click (`158–167`) currently discards typed workdays with no guard.
- [ ] **Step 2:** `TaskDetailsModal`: validate per field on blur and render the error under its input with
  `aria-invalid`/`aria-describedby`, clearing on edit. Today validation runs only on save into one box below
  the whole grid, and `setError(null)` only happens after a successful save.
- [ ] **Step 3:** Customer Selections: confirm or offer undo on row removal (`512–519` deletes instantly
  while Rebuild gets a full modal), and key rows by `item.id` (`373` concatenates every editable field, so
  each edit remounts the row and drops the caret).
- [ ] **Step 4:** Customer Selections: replace toast-only add-form validation (`174–180`) with inline field
  errors, and stop silently reverting invalid Qty/`$Unit` text on blur (`435`, `472–474`).
- [ ] **Step 5:** Work Orders: close the confirm modal on confirm and disable its button while generating,
  showing the spinner inside it — today the modal stays open for the whole 10–30s AI call with no pending
  state, so it can be double-submitted into two packets.
- [ ] **Step 6:** EntryCard: make sample cards real `<button>`s (`432–434` are clickable `<div>`s wrapping a
  dead tab-stop button), and give both drop zones a keyboard path (`213`, `271` are `onClick`-only divs).
- [ ] **Step 7:** `npm test`, `npm run lint`; keyboard-only pass through both modals and both upload paths.
- [ ] **Step 8:** Commit `ui: destructive guards, inline validation and keyboard-reachable uploads`.

## Phase 5 — Speed

### Task 22: Precache discipline and a safe update path

**Files:** Modify `scripts/inject-sw-precache.mjs`, `public/sw.js`, `src/pwa.ts`

**Why:** first launch downloads 1,036.8 KiB of assets because every hashed chunk is precached, including the
448.2 KiB Work Orders path and the 72.4 KiB Gantt chunk — surfaces a supervisor may never open.

- [ ] **Step 1:** Change the injection to precache the shell plus the **eager set**: every `/assets/*.js`
  and `/assets/*.css` referenced by `dist/index.html`. Not the entry chunk name alone, and not every asset
  in `dist/assets`. Keep a `--all` escape hatch for a deliberate full-offline build. After Task 23's
  `manualChunks` split, a vendor chunk may be part of the eager set and **must** be precached — otherwise
  Review Focus 1's cold offline boot breaks while both budget metrics still pass.
- [ ] **Step 2:** Ensure lazy chunks still work offline after first use: they already fall through to the
  cache-first branch (`sw.js:109–127`), so verify rather than rewrite.
- [ ] **Step 3:** Add stale-while-revalidate for `/assets/*`: serve cache first, refresh in the background.
  Today it is cache-first only, so a hashed asset evicted from cache is refetched but never refreshed.
- [ ] **Step 4:** Add a "new version available" prompt so a deploy does not leave a stale worker serving old
  hashes indefinitely.
- [ ] **Step 5:** **Review Focus 1:** build, load once, then go offline and hard-reload — the shell must boot
  and the previously-opened section must still render from cache.
- [ ] **Step 6:** **Review Focus 3:** simulate a stale worker (serve a 404 for a hashed chunk) and confirm the
  error boundary from Task 3 catches it with a recovery action instead of a blank page.
- [ ] **Step 7:** `npm run build && npm run verify:bundle` → precache now within 420 KiB, and the eager set
  within 300 KiB. The guard reads `dist/sw.js`, so it measures the real precache list rather than an
  assumption about it.
- [ ] **Step 8:** Commit `ui: precache shell and entry only, with stale-while-revalidate`.

### Task 23: Defer the heavy PDF path, split chunks, drop the dead dependency

**Files:** Modify `src/components/sections/WorkOrdersSection.tsx`, `vite.config.ts`, `package.json`,
`src/components/sections/CustomerSelectionsSection.tsx`

- [ ] **Step 1:** Stop `WorkOrdersSection.tsx:35` statically importing `workOrderPdf` (448.2 KiB with its
  section chunk). Move PDF building behind a dynamic `import()` inside the click handler, so the bytes are
  fetched only when someone actually downloads a packet.
- [ ] **Step 2:** Do the same for `customerSelectionsPdf`.
- [ ] **Step 3:** Add `build.rollupOptions.output.manualChunks` to `vite.config.ts` splitting vendor React,
  the Gantt, and the PDF libraries, so the eager set (399.1 KiB today) drops below the 300 KiB budget.
  Any vendor chunk `index.html` still loads eagerly is part of the eager set and is precached automatically
  by Task 22's `index.html`-driven injection — re-run `verify:bundle` to confirm both numbers.
- [ ] **Step 4:** Remove `motion` (framer-motion) from `dependencies` — imported by zero source files.
- [ ] **Step 5:** Flip `npm run verify:bundle` to enforcing (`--enforce` by default) now that both budgets
  are met, and confirm `npm run build && npm run verify:bundle` exits 0.
- [ ] **Step 6:** Verify a cold load with a cleared cache on a throttled profile records LCP ≤ 2.5s and
  INP ≤ 200ms; record the numbers in the baseline doc.
- [ ] **Step 7:** Commit `ui: defer pdf bundles, split chunks, drop unused motion`.

### Task 24: Commit numeric edits on blur and stop re-rendering whole sections

**Files:** Modify `BuyoutBudgetSection.tsx`, `src/App.tsx`, `src/components/ui/DataSurface.tsx`

- [ ] **Step 1:** Fix a real correctness bug while fixing the input lag: the Sub Bid `onChange`
  (`454–463` with `App.tsx:360`) writes `Number(value) || 0` on every keystroke and every write stamps
  `budget_adjusted_at`, so backspacing to retype briefly commits a `$0` bid and marks the budget
  "reviewed". Commit on blur (and on Enter), ignore empty/NaN, and stop `handleUpdateTrade`'s
  `markBudgetAdjusted` option being set from this path — only `onMarkBudgetReviewed` (defined in Task 19)
  may stamp the flag. Test: typing `''` then `'500'` produces exactly one update carrying `500`, and
  `budget_adjusted_at` stays unset until the explicit confirm.
- [ ] **Step 2:** Memoise the hot list rows (`React.memo` on the row component) with stable callbacks, so
  one field edit does not re-render 40 rows. Keep `tabular-nums` intact.
- [ ] **Step 3:** Avoid re-creating `Intl` formatters per row (Task 1 already caches them; assert the row
  component does not construct one).
- [ ] **Step 4:** Verify with a 40-row ledger: typing in a Sub Bid input has no dropped frames and the
  caret stays put.
- [ ] **Step 5:** `npm test`, `npm run lint`, `npm run verify:budget` → pass.
- [ ] **Step 6:** Commit `ui: commit numeric edits on blur and memoise ledger rows`.

### Task 25: Search, sort and long-list performance

**Files:** Modify `BuyoutBudgetSection.tsx`, `WorkOrdersSection.tsx`, `CustomerSelectionsSection.tsx`,
`JsonExportSection.tsx`, `WorkspaceSyncSection.tsx`

- [ ] **Step 1:** Add a filter box and sortable money/date columns to the buyout ledger and the Work Orders
  list — at 20+ trades the only find affordance today is the browser's. Reuse the pattern already in
  `CustomersSection.tsx:151–171`.
- [ ] **Step 2:** **Review Focus 2:** with 40 rows at 375px, keep scroll smooth — paginate or virtualise if
  the card list exceeds ~50 rows, and assert the rendered row count stays bounded.
- [ ] **Step 3:** Store `createdItems` per export tool with last outcome and timestamp
  (`WorkspaceSyncSection.tsx:352–414` records successes only, and failures live in a 5s toast), so a partial
  failure is diagnosable.
- [ ] **Step 4:** **Review Focus 4:** `await` and `try/catch` the clipboard writes
  (`JsonExportSection.tsx:110`, `159` currently fire "Copied!" and a success toast unconditionally), and
  surface a failure. Test: with `navigator.clipboard.writeText` rejecting, no success toast is shown.
- [ ] **Step 5:** `npm test`, `npm run lint`, `npm run verify:workorders`, `verify:selections` → pass.
- [ ] **Step 6:** Commit `ui: list search, sort and long-list performance`.

---

## Execution notes

- **Order matters** in two places only: Phase 0 precedes everything (the harness and budget guard are the
  gates), and Tasks 14–16 precede Task 17 (do not design a chart that lies).
- **Phases 1–5 after Task 8 are independent enough to parallelise per section**, provided no two workers
  edit the same section file at once. The shared files — `src/index.css`, `src/components/ui/*`,
  `src/App.tsx`, `src/utils/format.ts` — are the collision points and should be owned by one worker at a time.
- **Task 23 is the only task that changes the budget gate from advisory to enforcing.** Until it lands,
  `npm run verify:bundle` warns rather than fails.
