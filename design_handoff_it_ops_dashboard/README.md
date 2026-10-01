# Handoff: IT Service Monitoring Dashboard

## Overview

An internal IT operations dashboard for a ~512-user / ~612-endpoint Microsoft-centric
environment. It answers one question fast — *is anything broken right now, and who is
affected* — and then lets an operator drill from a service tile into a service, an
incident, or the underlying security signal.

Seven views: Overview, Service detail, Incident detail, Entra security, Endpoints &
patch health, Email security, Rules & integrations.

The prototype ships with **placeholder data**. The real work in this handoff is
section **"Plugging in real data with agents"** below — the UI contracts are already
fixed, so each data source can be implemented independently and in parallel.

## About the design files

`IT Ops Dashboard.dc.html` in this bundle is a **design reference created in HTML** —
a working prototype showing intended look and behavior. It is not production code to
copy. Recreate it in the target codebase's existing environment (React, Next.js, etc.)
using that codebase's established patterns, routing, and data layer. If no environment
exists yet, React + TypeScript + Vite is the closest match to how the prototype is
structured.

The prototype is a single component with a `renderVals()` method that returns every
value the template reads. **That return object is the de-facto view-model contract** —
`DATA_CONTRACTS.md` formalizes it. Keep those shapes and the UI transfers cleanly.

## Fidelity

**High fidelity.** Final colors, typography, spacing, density, and interactions.
Recreate pixel-accurately. All visual values come from the **Aurora Design System**
(see Design tokens). Do not hand-pick new colors — if the target codebase already
consumes Aurora, use its components and CSS custom properties directly.

---

## Screens / views

### Shell (all screens)

- **Root**: `display:flex; min-height:100vh; background: var(--background-default); color: var(--text-primary)`. Body font Urbanist; UI/headings Plus Jakarta Sans.
- **Sidebar**: fixed `232px` (`flex: 0 0 232px`), `position: sticky; top:0; height:100vh`, `background: var(--background-paper)`, `border-right: 1px solid var(--divider)`.
  - Brand block: 28×28 rounded-8 square filled `--primary-main` holding a white 17px `monitoring` icon; title "Crexendo IT" (13.5px/700, letter-spacing -0.01em) over "Service operations" (11px, `--text-secondary`). Padding `16px 18px`, bottom divider.
  - Nav list: padding `10px`, `gap:2px`. Each item is a `20px 1fr auto` grid, `gap:10px`, padding `7px 10px`, radius 8, 13px Plus Jakarta Sans.
    - Inactive: `background: transparent; color: var(--text-secondary); font-weight:600`
    - Active: `background: var(--primary-lighter); color: var(--primary-dark); font-weight:700`
    - Optional count badge: min-width 18, height 18, radius 9, white 10.5px/700 text; `--error-main` on Incident, `--warning-main` on Overview.
  - Nav items and icons, in order: Overview `space_dashboard`, Service detail `dns`, Incident `report`, Entra security `shield`, Endpoints `computer`, Email security `mail`, Rules & integrations `settings`.
  - Footer (margin-top auto, top divider, padding 14): overline "DEMO STATE" (10.5px/700, 0.08em, uppercase, `--text-secondary`) above a pill segmented control — track `background: var(--grey-grey-100)`, radius 999, padding 3, gap 3; each half `flex:1`, padding `5px 0`, radius 999, 11.5px/700; selected half gets `background: var(--background-paper); color: var(--text-primary)`, unselected `transparent` / `--text-secondary`.
    *This toggle is a prototype affordance for demoing the two states. In production it should be removed, or kept behind a dev flag.*
- **Header**: sticky, `z-index:5`, padding `14px 24px`, bottom divider, `background: var(--background-paper)`, flex with `gap:16px`.
  - Title 19px/700 letter-spacing -0.015em; subtitle 12.5px `--text-secondary`.
  - Auto-refresh pill: `padding:5px 11px`, `1px solid var(--divider)`, radius 8, `white-space:nowrap; flex:0 0 auto`. Contains a 7px `--success-main` dot animated `pulseDot 2s ease-in-out infinite` (opacity 1 → .35 → 1) and the text "Auto-refresh · {n}s" counting down from 30.
  - Clock: monospace 15px/600, `font-variant-numeric: tabular-nums`, ticks every second.
  - Theme toggle: Aurora `IconButton` with a 20px `nights_stay` / `light_mode` icon.
- **Content well**: `flex:1`, padding `20px 24px 40px`, column flex, `gap:16px`.

**Card recipe used everywhere**: `1px solid var(--divider)`, radius 12, `background: var(--background-paper)`, padding `14–18px`. Stat cards: 11px/600 `--text-secondary` label over a 21–24px/700 tabular-nums value, optional 11px note.

### 1. Overview

The page has two states driven by `mode`.

**Quiet (all green)**
1. Compressed status strip: one bordered radius-12 row, padding `10px 14px`, wrapping flex, `gap:8px`. Leads with overline "ALL SYSTEMS OPERATIONAL", then one pill per service — `background: var(--grey-grey-100)`, radius 999, padding `4px 9px`, a 6px status dot plus 11.5px/600 name. Clicking a pill opens Service detail.
2. Empty state card: centered, padding `28px 24px`, a 34px `task_alt` icon in `--success-main`, "No active incidents" (16px/700), then a 13px `--text-secondary` line, `max-width:460px`, `text-wrap: pretty`.
3. "Recent history" table (see Tables).

**Sev1 (incident running)**
1. Expanded service tiles: `grid-template-columns: repeat(auto-fill, minmax(190px, 1fr))`, `gap:10px`. Each tile: card recipe + `border-left: 3px solid {statusColor}`, padding `10px 12px`, `gap:6px`.
   - Row 1: 7px status dot, 12.5px/700 name, right-aligned 11px latency (tabular-nums).
   - Row 2: latency sparkline — `<svg viewBox="0 0 100 26" preserveAspectRatio="none">` at `width:100%; height:26px`, a single `polyline`, `stroke: {statusColor}`, `stroke-width:1.4`, `vector-effect: non-scaling-stroke`, no fill. 28 points across the 24h window.
   - Row 3: 10.5px `--text-secondary`, "Vendor: {label}" left, "Ours: {label}" right.
2. "Active incidents" heading (15px/700) plus a 12.5px summary line, then the alert list.
   - Alert row: `grid-template-columns: 52px 1fr auto`, `gap:14px`, padding `11px 14px`, card recipe + `border-left: 3px solid {sevColor}`.
   - Sev chip: 52×22, radius 6, solid `{sevColor}`, white 11px/700 "SEV 1".
   - Middle: 13.5px/700 title (clickable → Incident detail) over 11.5px `--text-secondary` meta.
   - Right: Aurora `Button size="small"` — outlined "Acknowledge", text "Mute", text `color="success"` "Resolve".
   - Acknowledged / muted / resolved rows drop to `opacity: 0.45` and the meta line is prefixed "Acknowledged by {user} · " or "Resolved by {user} · ". The row stays in place (explicit product decision — acknowledging must not hide work).

### 2. Service detail

- Two side-by-side cards (`1fr 1fr`, gap 12): **Vendor status page** and **Our synthetic checks**. Each: overline label, then a 9px status dot + 16px/700 state word, then a 12.5px `--text-secondary` note. Showing both side by side is the point of the page — the vendor's claim and our own probe result are independently sourced and frequently disagree.
- Response-time card: "Response time · last 24h" (14px/700) plus "p50 / p95" in 12.5px secondary, then the sparkline at `height:120px`, `viewBox="0 0 100 30"`.
- Stat grid: `repeat(auto-fit, minmax(150px,1fr))`, gap 12 — Uptime (30d), Checks passing, Incidents (90d), Last state change.
- "Check history" table.

### 3. Incident detail

- Hero card, `border-left: 3px solid var(--error-main)`, padding `18px 20px`:
  - Meta row: solid `--error-main` "SEV 1" chip (radius 6, padding `3px 9px`, white 11px/700), monospace incident id, "Opened 09:12 · {age} elapsed".
  - Title 21px/700, letter-spacing -0.015em.
  - Body 13.5px `--text-secondary`, `max-width: 70ch`.
  - Actions: contained "Acknowledge", outlined "Mute service", outlined `color="success"` "Mark resolved". Labels flip to "Acknowledged by you" / "Unmute service" / "Resolved".
- Blast radius: `repeat(auto-fit, minmax(170px,1fr))`, gap 12. Four stat cards at 24px/700, value tinted by severity — Users affected, Mail queue depth, Median delay, Oldest message.
- Timeline card: rows of `grid-template-columns: 60px 18px 1fr`, gap 12, `padding-bottom:16px`. Left = monospace 12px time; middle = a 9px colored dot with a 1px `--divider` connector line beneath (`flex:1; min-height:14px`); right = 13px/700 title over 12px secondary body. Newest first.

### 4. Entra security

- Four stat cards (`minmax(160px,1fr)`): Risky sign-ins 24h, Failed sign-ins 24h, MFA coverage, Privileged accounts. Value color carries severity.
- "Signals · last 24 hours" table: Signal, Count (right), 24h trend, Severity, Last seen (right).
- "Directory audit" table: Time, Actor, Action, Target (right).

### 5. Endpoints & patch health

- Four stat cards, each with an Aurora `LinearProgress` under the value: Patch compliance (warning), Agents checked in 7d (success), BitLocker encrypted (primary), Critical patches missing (error).
- "Needs attention" table: Computer, Assigned to, Issue, Last check-in (right).

### 6. Email security

- Four stat cards: Messages processed, Blocked, Quarantined, Credential phishing.
- "Recently blocked" table: Time, Sender, Subject, Reason (right).

### 7. Rules & integrations

- Two columns, `repeat(auto-fit, minmax(320px,1fr))`, gap 16, `align-items: start`.
- **Integrations** list: rows of `1fr auto`, padding `11px 16px`, bottom divider. Name 13px/700 over 11.5px secondary detail; right side a status pill (radius 999, padding `3px 9px`, 11px/700) using
  `--success-lighter`/`--success-darker`, `--info-lighter`/`--info-darker`,
  `--warning-lighter`/`--warning-darker`, `--error-lighter`/`--error-darker`.

  > **Amended 2026-09-19 at gate G3.** This specified the `-dark` rung, and at the
  > 11px/700 this same line mandates, `--warning-dark` on `--warning-lighter`
  > measures **4.09:1** — below the 4.5 AA bar. `--info-dark` was 4.65, passing by
  > 0.15. Measured in Chromium against the production build with fonts loaded, not
  > computed. Any view following this line literally shipped a contrast failure, so
  > the pairing is corrected here rather than only in the code: all four states move
  > to the `-darker` rung together, because four states sharing one rule is the point
  > of the mapping and a mixed rung leaves the next state added with nothing to
  > follow. Shipped ratios: 8.91-11.79 light, 6.68-6.87 dark.
- **Alert rules** list: same row shape, right side an Aurora `Switch`. Each rule's threshold is the secondary line.

### Tables

All tables are the Aurora `Table` component with `dense`, wrapped in a card
(`overflow: hidden`). Columns are deliberately capped at four or five so the last
column survives a ~1000px content well; the component scrolls horizontally below that.
Header cells are 12px/700 uppercase `--text-secondary` on `--background-cardelevation1`.

---

## Interactions & behavior

| Trigger | Result |
|---|---|
| Sidebar item click | Switch page. No URL routing in the prototype — **add real routes** (`/`, `/services/:id`, `/incidents/:id`, `/entra`, `/endpoints`, `/email`, `/settings`). |
| Service tile or pill click | Set selected service, navigate to Service detail. |
| Alert title click | Navigate to Incident detail. |
| Acknowledge | Toggle ack for that incident. Row dims to 0.45, meta prefixes the actor's name, button label becomes "Acknowledged". |
| Mute | Toggle mute for that service/incident. Row dims; label flips to "Unmute". |
| Resolve | Set resolved (also sets ack). Meta prefixes "Resolved by …", label becomes "Resolved". |
| Theme toggle | Toggle the `dark` class on the root element. Aurora ships the full dark palette under `:root[data-theme="dark"], .dark`. Persist the choice. |
| Quiet / Sev1 toggle | Prototype-only demo switch. |
| Every 1s | Clock re-renders; auto-refresh countdown decrements (30 → 0 → 30). |

**Motion**: only the pulsing refresh dot (2s ease-in-out) and Aurora's own component
transitions (`--dur-fast 120ms` hover, `--dur-base 200ms` toggles). Nothing decorative.

**Responsive**: the content well is fluid; every grid uses `auto-fit`/`auto-fill` with
`minmax`. The sidebar is fixed-width and not collapsible in the prototype — if the
target supports tablet widths, collapse it to icons below ~900px.

**States the prototype does not cover — you must add them**: per-panel loading
skeletons (Aurora `Skeleton`), per-source error/stale states ("Endpoint Central data is
14 minutes stale"), empty tables, and auth-expired states for integrations.

## State management

Prototype state, all local:

```
page      'overview' | 'service' | 'incident' | 'entra' | 'endpoints' | 'email' | 'settings'
service   selected service id
mode      'quiet' | 'sev1'            // demo only — drop in production
ack       Record<incidentId, boolean>
muted     Record<incidentId, boolean>
resolved  Record<incidentId, boolean>
rules     Record<ruleKey, boolean>
tick      number                       // 1s interval for clock + countdown
theme     'light' | 'dark'
```

In production: `page` and `service` become route params; `ack`/`muted`/`resolved`/`rules`
become server-persisted mutations with optimistic updates; everything else becomes
server state. Recommended split — TanStack Query per data source with independent
`staleTime` and refetch intervals (see `DATA_CONTRACTS.md`), Zustand or context for
theme only.

---

## Plugging in real data with agents

The prototype's view-model is deliberately flat, so each data source maps to one
independent worker. The recommended shape in Claude Code is **one subagent per source**,
each owning a single adapter module with a fixed output type, plus one correlation
agent that assembles incidents from the adapters' output.

Full specifications — the exact TypeScript types every adapter must return, the real
API endpoints, auth mechanics, rate limits, polling intervals, and the mapping from each
API field to each UI field — are in:

- **`DATA_CONTRACTS.md`** — the view-model types and per-source field mappings.
- **`AGENTS.md`** — ready-to-paste subagent definitions, the build order, and the
  parallelization plan.

Short version of the plan:

1. **Scaffold first, alone.** One agent builds the app shell, routing, theme, and the
   seven views against the static fixtures extracted from the prototype. No network.
   Everything downstream depends on this, so it is not parallelized.
2. **Fan out.** Six source agents run in parallel, each producing `adapters/<source>.ts`
   exporting one async function with the contract type, plus fixtures and tests. They
   never touch UI files, so they do not collide.
   - `graph-adapter` — Entra sign-ins, audit, MFA, privileged roles, credential expiry
   - `epc-adapter` — Endpoint Central: agents, patch compliance, BitLocker
   - `proofpoint-adapter` — blocked/quarantined mail counts and recent messages
   - `stellar-adapter` — sensor health and log-source reporting
   - `vendor-status-adapter` — AWS, Azure, Okta, Cloudflare, CrowdStrike, GitHub, M365 status feeds
   - `synthetic-checks-adapter` — our own probes (mailflow round trip, OIDC token, portal 200)
3. **Correlate.** One agent implements the incident engine: it consumes the adapter
   output, applies the rules from the Rules page (the headline rule is
   *vendor degraded **and** our check failing → open a Sev1*), dedupes, and emits the
   `Incident[]` the Overview and Incident pages render.
4. **Wire.** One agent replaces fixtures with live queries, adds loading/error/stale
   states, and persists ack/mute/resolve.

Non-negotiables for every source agent, because they are what make parallel work safe:

- The adapter's exported type is fixed by `DATA_CONTRACTS.md` and may not be changed
  without updating that file first.
- Every adapter ships a `fixtures.ts` captured from a real (redacted) response, and the
  UI must render from fixtures alone with the network disabled.
- Credentials come from environment variables only. Never commit a token, never log a
  full response body, redact UPNs and IPs in fixtures.
- All source calls are read-only. Nothing in this dashboard mutates a third-party system.
- Each adapter returns `{ data, fetchedAt, degraded, error }` so the UI can show a stale
  or failed panel instead of an empty one.

---

## Design tokens

Everything comes from Aurora. Use the CSS custom properties, not the hex values — the
hex values are listed only so the mapping is verifiable and so dark mode is not
hard-coded.

**Color (light mode)**

| Token | Value | Use here |
|---|---|---|
| `--primary-main` | `#0080BE` | Active nav, brand square, primary buttons |
| `--primary-lighter` / `--primary-dark` | blue-50 / blue-700 | Active nav background / text |
| `--success-main` | `#099F69` | Operational status, passing checks, refresh dot |
| `--warning-main` | `#F68D2A` | Sev2, advisories, degraded metrics |
| `--error-main` | `#D02241` | Sev1, outages, failing checks |
| `--info-main` | `#0DA6D6` | Sev3 / informational |
| `--text-primary` | grey-800 `#1B2124` | Body and headings |
| `--text-secondary` | grey-600 | Labels, meta, notes |
| `--divider` | grey-300 | All 1px borders |
| `--background-paper` | white | Cards, sidebar, header |
| `--background-default` | app background | Content well |
| `--grey-grey-100` | | Status pills, segmented track |
| `--success-lighter` / `--success-darker` (and warning/info/error equivalents) | | Integration status pills — amended at G3, see § 7: the `-dark` rung fails AA at 11px/700 |

Dark mode is the same token names under `:root[data-theme="dark"], .dark`. Because every
color in the prototype is a token reference, the dark theme needs no extra CSS.

**Type** — Plus Jakarta Sans for UI/headings (600/700), Urbanist for body, SF Mono stack
for times, ids, and latency. Sizes used: 24, 22, 21, 19, 16, 15, 14, 13.5, 13, 12.5, 12,
11.5, 11, 10.5. Overlines are 10.5px/700, `letter-spacing: 0.08em`, uppercase.
Numeric displays use `font-variant-numeric: tabular-nums`.

**Spacing** — 8px base. Gaps used: 2, 3, 6, 7, 8, 10, 12, 14, 16. Page padding `20px 24px 40px`;
card padding 14–20px; sidebar 232px.

**Radius** — 6 (sev chips), 8 (nav items, header pill), 10 (tiles, alert rows), 12 (cards),
999 (pills and the segmented control), 50% (dots).

**Elevation** — none used. Every surface is a 1px `--divider` border on `--background-paper`.
Aurora's `--shadow-card` is available if the target prefers elevated cards; be consistent.

## Assets

No images. All icons are Aurora's `Icon` component (Material Symbols Rounded, inline SVG):
`monitoring`, `space_dashboard`, `dns`, `report`, `shield`, `computer`, `mail`, `settings`,
`task_alt`, `nights_stay`, `light_mode`. Sparklines are inline `<svg><polyline>` generated
from data — no chart library is required, though one may be substituted.

## Files

```
IT Ops Dashboard.dc.html   the full prototype — open this in a browser
support.js                 runtime the prototype needs; keep it next to the HTML
aurora/                    the Aurora design system, self-contained
  _ds_bundle.js              all React components on window.AuroraDesignSystem_5047ff
  styles.css                 entry point, @imports the tokens below
  tokens/fonts.css           Plus Jakarta Sans, Urbanist, Material Symbols (Google Fonts)
  tokens/fig-tokens.css      1300+ variables, light + dark modes
  tokens/typography.css
  tokens/spacing.css
  tokens/base.css
DATA_CONTRACTS.md          view-model types and per-source field mappings
AGENTS.md                  subagent definitions, build order, parallelization plan
```

The prototype's markup is the template; the `<script>` class at the bottom holds the state
machine, all placeholder data, and the sparkline generator.

### Using the Aurora bundle in the target codebase

Everything Aurora needs is in `aurora/` — nothing is fetched from this project. Paths inside
the prototype are already relative, so the folder works wherever it is dropped.

**Two ways to consume it.**

1. **Tokens only (recommended for a React/TS rebuild).** Copy `aurora/tokens/` and
   `aurora/styles.css` into the app's static assets and link `styles.css` once in the root
   layout. That alone reproduces the entire visual language — every color, type size, radius
   and spacing value in this design is a `var(--*)` reference into those files. Then build
   the handful of primitives the dashboard actually uses (Button, IconButton, Switch, Table,
   LinearProgress, Icon, Skeleton, Alert) with whatever component library the codebase
   already has, styled against the tokens. This is the cleanest path: no global script, no
   `window` namespace, real props and types.

2. **The prebuilt bundle.** `aurora/_ds_bundle.js` is a plain browser script that expects
   React and ReactDOM to already be on `window`, and attaches every component to
   `window.AuroraDesignSystem_5047ff`. Load React, then the bundle, then read components off
   the namespace:

   ```js
   const { Button, Table, Switch, Icon, LinearProgress } = window.AuroraDesignSystem_5047ff;
   ```

   It is not an ES module and has no npm package, so in a bundled app it has to be loaded via
   a `<script>` tag in the HTML shell rather than imported. Workable, but it fights most build
   tools — prefer option 1 unless the target is also a plain-script page.

**Fonts** load from Google Fonts in `tokens/fonts.css`. For an internal tool with no outbound
internet, self-host Plus Jakarta Sans and Urbanist and replace that file's `@import` with local
`@font-face` rules. Icons are inline SVG in the bundle and do not depend on the webfont.

**Dark mode** is already in `fig-tokens.css` under `:root[data-theme="dark"], .dark`. Toggling
the `dark` class on the root element is the whole implementation — do not write a second
palette.
