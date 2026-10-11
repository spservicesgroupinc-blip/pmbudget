# Hays + Sons Workspace — UI Improvement Design

**Date:** 2026-10-11
**Status:** awaiting your approval (nothing is built until you approve this)
**Repo:** `C:\ghannt` (React 19 · Vite 8 · Tailwind v4 CSS-first `@theme` · lucide-react · frappe-gantt)
**Companion plan:** `docs/superpowers/plans/2026-10-11-ui-mobile-field-improvement.md`

---

## 1. Why this exists

This app runs the business: it turns an Xactimate estimate into trade packages, a buyout
budget, a Gantt schedule, subcontractor work orders and a customer allowance sheet, then pushes
the results to Google Workspace. The interface, though, grew one section at a time, desktop
first. The result is what you named in one phrase: **cluttered and slow**.

Clutter and slowness are not cosmetic here. The person holding this app is standing in a
damaged kitchen, one-handed, on a phone, often on bad cellular. They need *the next action* and
*the right number*, in seconds, without pinching or squinting. Every extra table, every
duplicated KPI card, every 10px grey label, and every kilobyte of JavaScript shipped on first
launch is a tax paid in the field.

The brand itself is not the problem, and this design does not touch it. The red/slate palette,
the H+ mark, the border-carried cards and the restrained motion are correct and consistent. What
is missing is a **system underneath them** — and a mobile layout on top of them.

## 2. What success looks like

Measurable, so we can tell whether this worked. Baseline numbers below are measured from the
current `dist/` build and the current source. Sizes are **KiB (1024 B)** throughout.

| Measure | Today | Target |
| --- | --- | --- |
| Asset bytes precached on first launch | **1,036.8 KiB** (17 JS + 2 CSS) | ≤ 420 KiB (shell + eager set only) |
| Eager set — every asset `index.html` loads before first paint | **399.1 KiB** | ≤ 300 KiB |
| Work Orders path downloaded eagerly | **448.2 KiB** | 0 until Work Orders is opened |
| Articulate `text-[Npx]` utilities in `src/**` | **465**, across 12 distinct sizes | 0 above the token scale |
| `text-slate-400` call sites (2.56:1, fails AA) | **132** | 0 for text |
| Interactive targets under 44×44 px | ≥ 12 | 0 on primary paths |
| Visible primary action per view | 0–3 competing | exactly 1 |
| `prefers-reduced-motion` handling | 0 occurrences | honoured app-wide |
| Interactive element without an accessible name | dozens | 0 on primary paths |
| Mobile LCP / INP (throttled, mid-tier phone) | unmeasured — this is itself a defect | ≤ 2.5 s / ≤ 200 ms |

## 3. Who it is for

**Primary: the field supervisor on a phone or tablet.** Thumb reach, one-handed use, glare,
gloves, unreliable signal, and app-like launch from the home screen. Every decision below is
resolved in their favour when the two audiences conflict.

**Secondary: the estimator/PM on a desktop.** They keep the dense 1400px canvas, the sticky
sidebar and the table views — as the *enhancement*, not the default.

## 4. Goals

1. **Mobile field ergonomics** — a single-column, one-handed layout with 44px targets, no iOS
   input zoom, a header that stays one row, and status feedback that is visible and announced.
2. **Declutter** — one visually primary action per view; one authoritative table instead of
   three; shared primitives instead of five hand-copied empty states.
3. **Speed** — cut the first-launch payload by roughly 60%, stop precaching surfaces nobody
   opened, and remove the render cost that makes typing and switching sections feel heavy.
4. **Correctness that blocks field use** — the three schedule blockers, destructive-action
   guards, a working error path, and contrast that holds up outdoors.

## 5. Non-goals

- No rebrand. The palette, the mark, and the "borders carry structure, shadows float" rule stay.
- No dark mode in this pass (token layer will make it a follow-up, not a rewrite).
- No native app, no new UI framework or component library, no new chart library.
- No backend or Google Apps Script changes; no change to budget/work-order/PDF *math*.
- No redesign of the generated PDFs.
- No new product features or new sections.

## 6. Anti-goals — these would make this a failure even if it "works"

- Buying polish with a new visual language. If it looks like a different product, we failed.
- A generic AI aesthetic: gradients, rounded-everything, purple, oversized padding, stock card
  grids. (`QuickAdd.tsx:200` already has the only gradient in the product — it goes.)
- A shrunk desktop on mobile, or a mobile layout that degrades the desktop tables.
- Breaking `npm run lint` or any existing `npm run verify:*` script.
- Trading field reliability for polish: offline launch and the PWA must keep working.

## 7. Constraints inherited from the codebase

- **No test framework exists.** `npm run lint` (`tsc --noEmit`) and the `tsx scripts/verify-*`
  domain checks are the only gates. 465 drift sites cannot be held still without a harness, so
  one is added first (Task 1) rather than assumed.
- Tailwind v4 tokens live in `src/index.css` `@theme` — currently **3 colour tokens only**.
- The service worker is hand-rolled (`public/sw.js`) and `scripts/inject-sw-precache.mjs`
  precaches *every* asset in `dist/assets`, which is where the 1,036.8 KiB comes from.
- Vercel serverless caps request bodies at ~4.5 MB; `EntryCard` guards at 3.2 MB. Untouched.
- Brand reference: `instructions/uibranding`. Its **§9 gap list is stale** — it names
  `SectionInsurance`, `SectionTeam`, `SectionMortgage`, `SectionChangeOrder` and
  `SectionChecklist`, none of which exist in `src/` any more. Fixing that document is Task 4.

## 8. Decided by you

- The target is the ghannt app in `C:\ghannt` (not the DSH GUI).
- The primary user is the **field supervisor on phone/tablet**.
- The problem statement is **cluttered and slow**.
- A third-party design skill should be installed and used (done — see below).

## 9. Decided by me — my calls, overrule any of them

1. **Two-layer tokens.** `@theme` gains a type scale matching the brand doc's six roles
   (`micro 11 / label 12 / body 13 / title 15 / figure 24`, plus mono) and semantic colour
   roles, so `red-600` stops meaning *brand* **and** *danger* **and** *critical path* **and**
   *today* at the same time.
2. **`red-700` for text-bearing red.** The brand doc measures white-on-`red-600` at ~4.4:1,
   under AA. `red-600` stays the brand fill; anything with a label on it moves to `red-700`.
3. **A shared primitives layer** (`Container`, `Card`, `SectionHeader`, `KpiStat`, `EmptyState`,
   `Button`, `Field`) is the thing that actually kills the drift. The duplication is proven, not
   assumed: five copies of the "no estimate" card, three empty-state shapes, three date formats,
   two money formats, two KPI styles.
4. **Tables become card lists below `md`.** A 6-column ledger is not usable at 375px. Above
   `md`, nothing changes.
5. **Fix the schedule before designing it.** The Day/Week/Month toggle is a **dead control**
   (`frappe-gantt.es.js:873` overwrites the mode with `view_modes[0]`), short-bar labels render
   white-on-white, and touch drags are silently discarded. Visual work on top of those three is
   wasted effort.
6. **The Schedule Detail table becomes the accessible primary surface**, with the SVG chart as
   an enhancement (`aria-hidden`), because frappe-gantt ships no keyboard support at all.
7. **The precache becomes the shell plus the eager set** — every asset `index.html` loads before first
   paint, and nothing else. Hashed chunks are fetched on demand and served stale-while-revalidate, so
   offline launch still works for the shell.
8. **Deep-link the active section** via URL hash, so a mid-task refresh returns the supervisor to
   where they were instead of Home.
9. **Add a test harness** (vitest + @testing-library/react + jsdom). Without it every task below
   ends with "look at it and hope".
10. **Drop the unused `motion` dependency** — `framer-motion` is in `package.json` but imported
    by no source file.

## 10. The six things to do first

If only part of this ships, ship these, in order. They cover the stated pain directly.

1. **Task 14** — repair the dead Day/Week/Month toggle (the schedule screen is lying today).
2. **Task 16** — make touch rescheduling either work or be impossible; today it silently lies.
3. **Task 22** — precache discipline: 1,036.8 KiB → ≤ 420 KiB on first launch.
4. **Task 9** — a one-row mobile header (today it wraps and eats the top of a phone screen).
5. **Task 19** — Buyout Budget declutter (three tables for one job; the real action is buried).
6. **Task 12** — 16px mobile inputs (iOS currently zooms and mis-frames on every field tap).

## 11. What is left to the builder

Deliberately open, because a builder closer to the code should choose:

- The exact breakpoint where tables collapse to cards (`md` assumed).
- Whether Customer Selections ends as a table or stays a list with one header row.
- The wording of the new empty states and the disabled-nav explanations.
- Whether the Gantt's Month mode is worth repairing or should be removed in favour of
  Day/Week only — **this one needs your answer** (see the plan's open questions).
- Whether drag-to-reschedule is a real field requirement, or the modal is sufficient on touch.

## 12. The design skill, and what it contributed

You asked for a UI/design skill, so this is what was used and where it landed:

- **Installed:** `ui-ux-pro-max` → `C:\Users\russe\.dsh\skills\ui-ux-pro-max` (23 files,
  337 KiB: a `SKILL.md`, 12 CSV design databases, and a local BM25 search script). Its Python is
  pure local search — `csv`, `re`, `pathlib`, `math` only; no network, no writes, no subprocess.
- **Used:** its UX database supplied the mobile rules now written into the plan — 44×44 px touch
  targets, avoid the 300 ms tap delay (`touch-action: manipulation`), validate on blur rather
  than submit, announce errors with `role="alert"`, horizontal scroll or card layout for tables
  on mobile, and lazy-load below-the-fold content.
- **Also read:** the in-profile `dsh-client-ui-ux` skill (token discipline, reuse-before-adding,
  feedback surfaces, overlay safety) and `frontend-ui-engineering` at `~/.agents/skills`
  (WCAG 2.1 AA floor, "avoid the AI aesthetic", mobile-first breakpoints 320/768/1024/1440).
- **Where it is refused:** the skill's product database recommends a *grey + safety orange +
  blueprint blue* palette for construction. Your red/slate brand is already locked, better, and
  printed on physical collateral. The brand wins; the skill's process rules are kept.

## 13. Evidence base

Everything above is verified against source, not assumed:

- Three parallel audits (app shell/nav — rendered in headless Chrome at 375/640/1024/1440px;
  data-dense workflow surfaces; Gantt/tokens/a11y), each citing `path:line`.
- The dead Gantt toggle was confirmed two ways: by pixel-diffing `gantt-verify.png` against
  `gantt-verify-month.png` (6,234 of 1.4M pixels differ — only the toggle and caption) and by
  reading `frappe-gantt.es.js:873`.
- Bundle and precache figures come from the real `dist/` output, summed per file.
- The `text-[Npx]`, `text-slate-400`, and hex counts come from grep over `src/**`.
