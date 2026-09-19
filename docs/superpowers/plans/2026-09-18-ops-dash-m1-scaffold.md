# ops-dash Milestone 1 — Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is written for **agent-team execution** — read "Teams and file ownership" before dispatching anything.

**Goal:** Build the offline shell of the IT ops dashboard — npm workspaces, the frozen shared contract, self-hosted Aurora tokens/fonts/icons, eight primitives, seven routes, and all seven views rendering from prototype-derived fixtures — such that the app reproduces the prototype's quiet and Sev1 states with the network disabled.

**Architecture:** A two-workspace npm monorepo. `shared/` holds `contracts.ts`, transcribed from the amended `DATA_CONTRACTS.md` and frozen the moment it is written. `web/` is a Vite + React + TypeScript SPA: a `BrowserRouter` over seven routes inside one `Shell` (232px sidebar, sticky header, content well). Every visual value is a `var(--*)` reference into Aurora's token CSS, which is copied into `web/public/aurora/` with its two Google Fonts `@import`s replaced by local `@font-face` rules over vendored `.woff2`. The eight Aurora primitives are re-implemented as typed React components ported from the bundle's source; the eleven icons are extracted from the bundle's path data at build time into a generated module. No network code of any kind ships in this milestone.

**Tech Stack:** Node 24.14.1, npm 11.11.0 workspaces, TypeScript 5.x, Vite 7, React 19, react-router 7, Vitest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-18-ops-dash-design.md` (approved 2026-09-18). Supporting sources of record: `design_handoff_it_ops_dashboard/DATA_CONTRACTS.md` (amended — the contract), `design_handoff_it_ops_dashboard/README.md` (the visual spec and its pixel measurements), `design_handoff_it_ops_dashboard/AGENTS.md` (file-ownership discipline), `design_handoff_it_ops_dashboard/IT Ops Dashboard.dc.html` (the prototype; its `renderVals()` is the source of every fixture value).

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Node >= 24.14.1.** `node:sqlite` is a Node 24 built-in and is why this floor exists. It is not used in Milestone 1; do not add it here.
- **Zero runtime external dependencies beyond the budget.** `web` runtime deps are exactly `react`, `react-dom`, `react-router`. Dev deps are exactly `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@playwright/test`, `@types/react`, `@types/react-dom`. **Nothing else may be added without stopping and asking.** Deliberately absent: UI kit, chart library, icon package, CSS framework, date library, state library.
  - *Approved by John 2026-09-19:* `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` and `@playwright/test` are dev-only, never shipped, and beyond the spec's dependency budget (which lists only `vitest`). Playwright carries the visual and interaction baselines that the manual fidelity pass cannot make repeatable. All four are build-and-test only; none reaches `web/dist`.
- **Everything that lands in git is under test where practical, and reviewed.** Three consequences, each with teeth elsewhere in this plan: the repository's own invariants are Vitest tests, not one-time greps (Task 3A); visual and interaction fidelity has committed Playwright baselines (Task 10A); and every wave ends at a review gate before the next wave is dispatched (see "Review gates").
- **Security is reviewed against this application's real surface, not a checklist.** Task 11A names that surface concretely. Two rules bind every task before it: **nothing but `Icon.tsx` may use `dangerouslySetInnerHTML`**, and **no value that originates outside our own source — a route param, a `localStorage` value, a fixture string, and from Milestone 2 a vendor payload — may reach an `href`, a `src`, a `style` string, or any HTML sink.** React escapes text by default; these are the places where it does not save you.
- **No network requests at runtime.** No `fetch`, no `XMLHttpRequest`, no API client, no credential read, no `<link>` or `@import` pointing off-box. The only outbound traffic permitted anywhere in this milestone is the one-time build-time font download in Task 3, whose output is committed and never fetched again.
- **No literal hex colors in `web/src/`.** Every color is `var(--token-name)`. The single exception is `#fff` on solid severity chips, the brand square and nav badges, which the prototype itself hard-codes; write it as `#fff /* prototype literal */`. Task 11 greps for violations and that comment is the allowlist marker.
- **Do not write a second dark palette.** Dark mode already exists in `fig-tokens.css` under `:root[data-theme="dark"], .dark`. Toggling the `dark` class on the root element is the entire implementation.
- **`shared/src/contracts.ts` is frozen after Task 2.** Read-only for every later task and every agent. An agent that believes it needs a change **stops and reports** — it does not edit the file and does not work around it. Changing it means amending `DATA_CONTRACTS.md` first, which requires John's approval.
- **Fixtures are permanently redacted.** No real UPNs, hostnames, IP addresses or mail subjects, ever, including in tests. People are `@example.com`, machines are `DEMO-*`. The exact redacted values are given in Task 6 — use them verbatim, because the Wave 2 view tests assert against them.
- **Seven services, not ten.** The prototype's ten-service list (AWS, Azure, Okta, Cloudflare, CrowdStrike, GitHub, Endpoint Central, Stellar Cyber) is placeholder and was superseded by amendment 3. The `ServiceId` union is `proofpoint | jira | helpjuice | claude | openai | zendesk | m365`. Every copy string reading "10 monitored services" or "Ten monitored services" becomes seven. Exact replacement copy is in Task 6.
- **`unknown` never renders green and never counts toward "ALL SYSTEMS OPERATIONAL."** The strip asserts health only when every service is affirmatively `operational`. `unknown` renders `var(--text-disabled)` **as decoration** — a dot, a border, a sparkline.
  *(amended at G3: as **text** it renders `var(--text-secondary)`. `--text-disabled` measures
  2.29:1 light and 2.78:1 dark, failing WCAG AA in both themes, and `unknown` is the status word
  read most often because two of seven services are permanently unknown. Amendment 1's substance
  is that `unknown` never reads as green and never counts toward the all-clear; a neutral grey
  people can actually read satisfies that better than one they cannot. Use `statusTextColor`.)*
  This is amendment 1 and it is load-bearing.
- **Pixel fidelity to `design_handoff_it_ops_dashboard/README.md` § "Screens / views".** Those measurements are acceptance criteria, not suggestions. Where this plan quotes a measurement it is quoting that file.
- **Commit at the end of every task**, using the message the task's final step gives.

---

## Teams and file ownership

This plan is built for agent teams. The hard rule from `AGENTS.md` applies and is exactly what makes parallel runs safe: **an agent writes only the files it owns.** An agent that needs a file it does not own stops and reports.

### Waves

```
Wave 0   lead (solo, in-session)     Tasks 1-3     repo, frozen contracts, self-hosted assets
Wave 1   team of 2, parallel         Tasks 4-5     primitives | fixtures
Wave 2   lead (solo, in-session)     Task 6        shell, routes, theme, view stubs
Wave 3   team of 4, parallel         Tasks 7-10    overview | service+incident | security | settings
Wave 4   lead (solo, in-session)     Tasks 11-12   wiring, fidelity pass, offline proof, docs
```

The dependency chain is real, not ceremonial:

- Wave 1 needs the frozen contract (Task 2) and the generated icon data plus `Icon.tsx` (Task 3). `Icon` sits in Wave 0 rather than with the other primitives precisely so the shell and the primitives can both depend on it without a cycle.
- Wave 2 needs the primitives (`IconButton` for the theme toggle) and the fixtures (nav badge counts), so it waits for **both** Wave 1 agents.
- Wave 3 needs the shell to route to it. Each of the four agents owns disjoint view files.
- Wave 4 needs all of Wave 3.

### Ownership table

| Wave | Agent | Owns (exclusive write) | May read |
|---|---|---|---|
| 0 | `lead` | root config, `shared/**`, `web/scripts/**`, `web/public/**`, `web/src/components/aurora/icons.generated.ts`, `web/src/components/aurora/Icon.tsx` | everything |
| 1 | `primitives` | `web/src/components/**` **except** `aurora/Icon.tsx` and `aurora/icons.generated.ts`; plus `web/src/theme/statusColor.ts` | contracts, Aurora bundle, handoff docs |
| 1 | `fixtures` | `web/src/fixtures/**` | contracts, prototype HTML, handoff docs |
| 2 | `lead` | `web/src/main.tsx`, `web/src/app/**`, `web/src/theme/ThemeProvider.tsx`, and the seven `web/src/views/*.tsx` **as stubs only** | everything |
| 3 | `view-overview` | `web/src/views/Overview.tsx` + `Overview.test.tsx` | everything except other agents' owned files |
| 3 | `view-service` | `web/src/views/ServiceDetail.tsx`, `IncidentDetail.tsx` + their tests | same |
| 3 | `view-security` | `web/src/views/Entra.tsx`, `Endpoints.tsx`, `Email.tsx` + their tests | same |
| 3 | `view-settings` | `web/src/views/Settings.tsx` + `Settings.test.tsx` | same |
| 4 | `lead` | everything | everything |

**`web/index.html` is owned by `lead` in every wave** — added at G2, because the original table
never assigned it and Task 6 Step 5 instructs a Wave 2 agent to edit it while Task 11A also
modifies it. It is also the one place in the tree that can hold `@keyframes`: there is no
stylesheet under `web/src` and there must not be one, and `web/public/aurora/*` is copied
verbatim. A wave agent that needs a keyframe **stops and asks the lead** rather than editing
it, until Task 11A creates `web/public/app.css` and moves the block there.

Two notes on that table. **Nobody owns `shared/src/contracts.ts` after Task 2** — it is frozen. And ownership of each `views/*.tsx` **transfers** from `lead` to its Wave 3 agent: Task 6 creates them as one-line stubs so the router compiles, and the Wave 3 agent replaces its own stub wholesale.

One reconciliation to note: `AGENTS.md` puts the contract at `src/types/contracts.ts`. The approved design spec puts it at `shared/contracts.ts` so the future `server/` workspace imports the same file. **The spec wins.** Path in this plan: `shared/src/contracts.ts`, imported as `@ops-dash/shared`.

### Review gates

**No wave is dispatched until the previous wave has been reviewed.** A green test suite says the code does what its author thought; it does not say the code is right, and it says nothing at all about the code the author did not write. The gate closes that.

At the end of each wave, before dispatching the next, run a review scoped to **that wave's diff** — `git diff <last-wave-tag>..HEAD` — at high effort, using the `code-review` skill or a `feature-dev:code-reviewer` agent. Review by **logical block**, not by file: the contract and its consumers together, the primitives as a set, the fixtures against the contract they claim to satisfy, each view against the README section it implements. A per-file skim finds typos; a per-block review finds the thing where two files each look fine and the seam between them is wrong.

| Gate | After | Reviews, specifically |
|---|---|---|
| G0 | Wave 0 | Does `contracts.ts` match the amended `DATA_CONTRACTS.md` **field for field**, including optionality and the amendment comments? Does the icon extraction produce only `<path>` geometry? Is anything in `public/` reaching outward? |
| G1 | Wave 1 | Do the primitives' signatures match what the Interfaces blocks promised the Wave 3 agents — exactly, including prop names? Do the fixtures satisfy the frozen contract without a single `as any`, widened type or silent `undefined`? Is `statusColor` total over `StatusLevel`? |
| G2 | Wave 2 | Does the shell leak any state between routes? Is the theme class the *only* dark-mode mechanism, with no second palette anywhere? Do nav badges derive from data rather than constants? |
| G3 | Wave 3 | Four agents wrote seven views in parallel and could not see each other. Did they diverge — different spacing for the same card, different date formatting, a re-implemented `StatCard`, duplicated helpers that should have been reported instead of written? This is the gate that matters most, and divergence is the expected finding. |
| G4 | Wave 4 | The whole tree, against the spec and the README. |

Findings are fixed by the agent that owns the file, or by the lead in Wave 4. A gate is closed when its findings are fixed or explicitly accepted in writing — not when they are merely recorded.

Tag each wave so the diffs are clean: `git tag wave-0` and so on, at the last commit of each wave.

### Preamble to paste into every Wave 1 and Wave 2 agent

```
You are one agent on a team building the offline scaffold of an IT operations
dashboard. Read, in this order:

  docs/superpowers/plans/2026-09-18-ops-dash-m1-scaffold.md
      (this plan: the Global Constraints section in full, plus your task)
  design_handoff_it_ops_dashboard/README.md      (the visual spec)
  shared/src/contracts.ts                        (the frozen types)

You own ONLY the files listed under "Files" for your task. You may read anything.
You may not create, edit or delete a file another agent owns, and you may not edit
shared/src/contracts.ts — it is frozen. If your task cannot be done without touching
a file you do not own, STOP and report exactly what you need and why. Do not work
around it, and do not "improve" a neighbouring file while you are in there.

Work test-first, in the step order given. Run the command each step names and
confirm the stated expected output before moving on. Commit with the message the
task gives. Report what you did, what you ran, and the actual output.
```

---

## File structure

Every file created in this milestone, with the one responsibility of each.

```
ops-dash/
  package.json                      workspaces root; scripts delegate to web
  tsconfig.base.json                strict TS settings shared by both workspaces
  .gitignore                        (append node_modules, dist, coverage)
  CLAUDE.md                         Task 12 — commands, layout, the frozen-contract rule

  shared/
    package.json                    @ops-dash/shared, type: module
    tsconfig.json
    src/contracts.ts                FROZEN. Every type from DATA_CONTRACTS.md, verbatim
    src/index.ts                    re-export surface
    src/contracts.test.ts           type-level conformance assertions

  web/
    package.json                    @ops-dash/web
    tsconfig.json
    vite.config.ts                  react plugin + vitest jsdom config
    vitest.setup.ts                 jest-dom matchers
    index.html                      links /aurora/styles.css once; mounts #root
    scripts/extract-icons.mjs       build-time: Aurora bundle -> icons.generated.ts
    scripts/vendor-fonts.mjs        one-time: Google Fonts -> public/fonts + local css
    public/aurora/styles.css        copied verbatim
    public/aurora/tokens/*.css      copied verbatim except fonts.css (rewritten local)
    public/fonts/*.woff2            vendored Plus Jakarta Sans variable, 4 files

    src/main.tsx                    createRoot + ThemeProvider + BrowserRouter
    src/app/App.tsx                 <Shell> wrapping <Routes>
    src/app/Shell.tsx               flex root; sidebar + main column
    src/app/Sidebar.tsx             brand, nav list with badges, demo-state footer
    src/app/Header.tsx              title/subtitle, refresh pill, clock, theme button
    src/app/routes.ts               route paths + nav metadata, one source of truth
    src/app/pageMeta.ts             per-route title/subtitle strings
    src/app/DemoModeProvider.tsx    dev-only quiet|sev1 fixture switch

    src/theme/ThemeProvider.tsx     light|dark, persisted to localStorage
    src/theme/statusColor.ts        StatusLevel / Severity / timeline kind -> token

    src/components/aurora/Icon.tsx            11 glyphs, inline SVG
    src/components/aurora/icons.generated.ts  GENERATED — do not hand-edit
    src/components/aurora/Button.tsx
    src/components/aurora/IconButton.tsx
    src/components/aurora/Switch.tsx
    src/components/aurora/Table.tsx
    src/components/aurora/LinearProgress.tsx
    src/components/aurora/Skeleton.tsx
    src/components/aurora/Alert.tsx
    src/components/Card.tsx         the card recipe, in one place
    src/components/StatCard.tsx     label / value / note or progress bar
    src/components/Sparkline.tsx    number[] -> scaled polyline, two size variants
    src/components/Panel.tsx        loading | stale | error | empty | ready wrapper
    src/components/SectionHeading.tsx

    src/fixtures/services.ts        7 ServiceStatus, quiet and sev1 variants
    src/fixtures/incidents.ts       4 Incident, full blastRadius + timeline
    src/fixtures/history.ts         recent-history rows and CheckRun[]
    src/fixtures/entra.ts           EntraSnapshot
    src/fixtures/endpoints.ts       EndpointSnapshot
    src/fixtures/email.ts           EmailSnapshot
    src/fixtures/rules.ts           AlertRule[] + Integration[]
    src/fixtures/index.ts           quiet/sev1 bundles keyed by DemoMode

    src/views/Overview.tsx
    src/views/ServiceDetail.tsx
    src/views/IncidentDetail.tsx
    src/views/Entra.tsx
    src/views/Endpoints.tsx
    src/views/Email.tsx
    src/views/Settings.tsx
```

Deliberately **not** created in Milestone 1: `server/`, any adapter, any query layer, any store. Those are Milestones 2-4.

---

## Wave 0 — lead, solo

### Task 1: Workspace scaffold and toolchain

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `shared/package.json`, `shared/tsconfig.json`
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/vitest.setup.ts`, `web/index.html`, `web/src/main.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: the workspace names `@ops-dash/shared` and `@ops-dash/web`; the npm scripts `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`; a Vitest environment where `*.test.ts(x)` under either workspace runs with jsdom and jest-dom matchers loaded.

- [ ] **Step 1: Create the workspace root**

`package.json`:

```json
{
  "name": "ops-dash",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24.14.1" },
  "workspaces": ["shared", "web"],
  "scripts": {
    "dev": "npm run dev --workspace @ops-dash/web",
    "build": "npm run build --workspace @ops-dash/web",
    "preview": "npm run preview --workspace @ops-dash/web",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b shared web",
    "icons": "npm run icons --workspace @ops-dash/web",
    "fonts": "npm run fonts --workspace @ops-dash/web"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vite": "^7.0.0",
    "vitest": "^3.0.0",
    "@playwright/test": "^1.49.0"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "jsx": "react-jsx"
  }
}
```

Append to `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
*.tsbuildinfo
```

- [ ] **Step 2: Create the two workspaces**

`shared/package.json`:

```json
{
  "name": "@ops-dash/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

`shared/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "noEmit": false },
  "include": ["src"]
}
```

`web/package.json`:

```json
{
  "name": "@ops-dash/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "icons": "node scripts/extract-icons.mjs",
    "fonts": "node scripts/vendor-fonts.mjs"
  },
  "dependencies": {
    "@ops-dash/shared": "*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.1.0"
  }
}
```

`web/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false,
    "declaration": false,
    "declarationMap": false,
    "types": ["vitest/globals"]
  },
  "include": ["src", "vitest.setup.ts", "e2e", "playwright.config.ts", "vite.config.ts"],
  "references": [{ "path": "../shared" }]
}
```

`web` deliberately drops `rootDir`, `outDir` and `composite` from the base config. With `rootDir: "src"` set, `tsc -b` fails `TS6059` the moment `vitest.setup.ts` — which lives beside `src`, not inside it — is included, and the same would happen later for `e2e/` and `playwright.config.ts`. `web` emits nothing (Vite builds it) and nothing references it, so none of those three options buys anything. `shared` keeps them, because `web` references `shared` and a referenced project must be composite.

- [ ] **Step 3: Configure Vite and Vitest**

`web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

`web/vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

Create a root `vitest.config.ts` so `npm test` runs both workspaces. Use `test.projects`, not the deprecated `vitest.workspace.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { projects: ['shared', 'web'] },
});
```

`shared/vitest.config.ts` — and note `typecheck.enabled`, which is not optional here:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'shared',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // contracts.test.ts asserts with expectTypeOf. Those assertions are
    // TYPE-level: without typecheck mode Vitest runs the file, finds no runtime
    // expectations, and reports a green pass that proves nothing at all.
    typecheck: { enabled: true, include: ['src/**/*.test.ts'] },
  },
});
```

`web/index.html` — note the single stylesheet link, which is the whole Aurora integration:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Crexendo IT · Service operations</title>
    <link rel="stylesheet" href="/aurora/styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/main.tsx` — a deliberate one-liner for now; Task 6 replaces its body:

```tsx
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(<div data-testid="app-boot">ops-dash</div>);
```

- [ ] **Step 4: Install and prove the toolchain runs**

Run: `npm install`
Expected: completes; `node_modules/` created; no peer-dependency errors.

Run: `npm run typecheck`
Expected: exits 0. (`shared/src` has no files yet — `tsc -b` on an empty `include` is fine; if it errors with "No inputs were found", create `shared/src/index.ts` containing `export {};` and re-run.)

Run: `npm run build`
Expected: Vite writes `web/dist/index.html` and an asset bundle, exits 0.

Run: `npm test`
Expected: exits 0 with "No test files found" — the harness is wired, there is simply nothing to run yet.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: npm workspaces, TypeScript, Vite and Vitest scaffold"
```

---

### Task 2: The frozen contract

**Files:**
- Create: `shared/src/contracts.ts`
- Create: `shared/src/index.ts`
- Create: `shared/src/contracts.test.ts`

**Interfaces:**
- Consumes: `design_handoff_it_ops_dashboard/DATA_CONTRACTS.md` (amended 2026-09-18), which is the source of record.
- Produces: every type the rest of the repo imports — `SourceResult<T>`, `StatusLevel`, `ServiceId`, `VendorIncident`, `ServiceStatus`, `CheckRun`, `Severity`, `Incident`, `BlastMetric`, `TimelineEntry`, `EntraSnapshot`, `EntraSignal`, `AuditEvent`, `EndpointSnapshot`, `EndpointIssue`, `EmailSnapshot`, `BlockedMessage`, `LogSourceSnapshot`, `AlertRule`, `Integration`. All exported from `@ops-dash/shared`.

**After this task the file is frozen.** Every later task and every agent treats it as read-only.

- [ ] **Step 1: Write the failing conformance test**

`shared/src/contracts.test.ts`:

```ts
import { describe, it, expectTypeOf } from 'vitest';
import type {
  StatusLevel, ServiceId, ServiceStatus, SourceResult,
  Incident, Severity, EntraSnapshot, EndpointSnapshot,
  EmailSnapshot, LogSourceSnapshot, AlertRule, Integration,
} from './contracts.js';

describe('contracts', () => {
  it('StatusLevel carries both amendment-1 members', () => {
    expectTypeOf<'unknown'>().toMatchTypeOf<StatusLevel>();
    expectTypeOf<'maintenance'>().toMatchTypeOf<StatusLevel>();
  });

  it('ServiceId is exactly the seven verified vendors', () => {
    expectTypeOf<ServiceId>().toEqualTypeOf<
      'proofpoint' | 'jira' | 'helpjuice' | 'claude' | 'openai' | 'zendesk' | 'm365'
    >();
  });

  it('SourceResult carries the amendment-4 empty flag', () => {
    expectTypeOf<SourceResult<number>>().toHaveProperty('empty');
  });

  it('ServiceStatus.vendor carries the amendment-2 history fields', () => {
    expectTypeOf<ServiceStatus['vendor']>().toHaveProperty('incidentsSince');
    expectTypeOf<ServiceStatus['vendor']>().toHaveProperty('lastSuccessfulPoll');
    expectTypeOf<ServiceStatus['vendor']>().toHaveProperty('maintenance');
  });

  it('Severity admits the info member', () => {
    expectTypeOf<'info'>().toMatchTypeOf<Severity>();
  });

  it('every snapshot type is exported', () => {
    expectTypeOf<Incident>().not.toBeNever();
    expectTypeOf<EntraSnapshot>().not.toBeNever();
    expectTypeOf<EndpointSnapshot>().not.toBeNever();
    expectTypeOf<EmailSnapshot>().not.toBeNever();
    expectTypeOf<LogSourceSnapshot>().not.toBeNever();
    expectTypeOf<AlertRule>().not.toBeNever();
    expectTypeOf<Integration>().not.toBeNever();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run --project shared --typecheck`
Expected: FAIL — `Failed to resolve import "./contracts.js"`. If it reports a *pass* with 0 assertions, typecheck mode is not on: fix `shared/vitest.config.ts` before going further, because every assertion in this file is type-level and a green run would be meaningless.

- [ ] **Step 3: Write the contract**

`shared/src/contracts.ts`. Transcribe every type from `DATA_CONTRACTS.md` sections 1-7 **verbatim**, keeping the amendment comments, because they are the reason the fields exist:

```ts
// Generated from design_handoff_it_ops_dashboard/DATA_CONTRACTS.md (amended 2026-09-18).
// FROZEN. Changing a type here is a breaking change: amend DATA_CONTRACTS.md first,
// with John's approval, then this file, then the consumers.

/** Common envelope, returned by every adapter. */
export type SourceResult<T> = {
  data: T;
  fetchedAt: string;      // ISO 8601
  degraded: boolean;      // partial result (some pages/regions failed)
  empty?: boolean;        // amendment 4 — fetch completed, returned no records.
                          // NOT an assertion of health. Never infer 'operational' from it.
  error?: { code: string; message: string };
};

// ---------------------------------------------------------------- 1. Services

export type StatusLevel =
  | 'operational'
  | 'degraded'
  | 'outage'
  | 'maintenance'              // amendment 1
  | 'unknown';                 // amendment 1

/** amendment 3 — the seven verified vendors. */
export type ServiceId =
  | 'proofpoint'               // Hornetsecurity / Proofpoint 365 Total Protection
  | 'jira'
  | 'helpjuice'
  | 'claude'
  | 'openai'
  | 'zendesk'
  | 'm365';                    // Microsoft 365 / Entra ID

/** amendment 2 */
export type VendorIncident = {
  id: string;
  title: string;
  level: StatusLevel;          // canonical, normalized from the platform's own vocabulary
  startedAt: string;           // ISO 8601
  resolvedAt?: string;         // absent while open
  url?: string;
};

export type ServiceStatus = {
  id: ServiceId;
  short: string;               // tile label,  e.g. 'Microsoft 365'
  name: string;                // page title,  e.g. 'Microsoft 365 / Entra ID'
  vendor: {
    level: StatusLevel;
    label: string;             // 'Operational' | 'Degraded' | 'Advisory' | 'Maintenance' | 'Unknown'
    note: string;              // advisory text + last vendor update, or why the level is unknown
    advisoryId?: string;       // e.g. 'EX1084221'
    url?: string;
    maintenance?: {            // amendment 2
      title: string;
      scheduledFor: string;    // ISO 8601
      scheduledUntil: string;  // ISO 8601
    };
    /** amendment 2 — everything published since our last SUCCESSFUL poll,
     *  not a current-state diff. */
    incidentsSince: VendorIncident[];
    lastSuccessfulPoll?: string;  // ISO 8601; the lookback anchor for incidentsSince
  };
  ours: {
    level: StatusLevel;
    label: string;             // 'Passing' | 'Slow' | 'Failing'
    note: string;              // which probes, which regions, last success
    passing: number;
    total: number;
  };
  latencyMs: number;           // most recent probe
  p50Ms: number;
  p95Ms: number;
  spark: number[];             // 28 samples, oldest first, milliseconds
  uptime30d: number;           // 0-1
  incidents90d: number;
  lastStateChange: string;     // ISO 8601
};

export type CheckRun = {
  at: string;                  // ISO 8601
  check: string;               // 'Mailflow round trip'
  region: string;              // 'us-east'
  result: 'pass' | 'fail' | 'timeout';
  latencyMs: number | null;
};

// --------------------------------------------------------------- 2. Incidents

export type Severity = 1 | 2 | 3 | 'info';

export type BlastMetric = {
  label: string;                    // 'Users affected'
  value: string;                    // '384' — preformatted for display
  note: string;                     // 'of 512 licensed mailboxes'
  level: 'normal' | 'warning' | 'error';
};

export type TimelineEntry = {
  at: string;                       // ISO 8601, newest first in the array
  title: string;
  body: string;
  kind: 'opened' | 'detected' | 'escalated' | 'vendor' | 'update' | 'resolved';
};

export type Incident = {
  id: string;                       // 'INC-2291'
  severity: Severity;
  title: string;
  serviceId: string;                // intentionally wider than ServiceId: an incident can
                                    // belong to a product source (e.g. 'endpointcentral')
                                    // that is not one of the seven vendor tiles
  openedAt: string;                 // ISO 8601
  resolvedAt?: string;
  summary: string;                  // one paragraph for the detail hero
  metaParts: string[];              // rendered joined by ' · ' on the list row
  ruleKey: string;                  // which alert rule fired
  blastRadius: BlastMetric[];
  timeline: TimelineEntry[];
  ack?: { by: string; at: string };
  muted?: { by: string; until: string | null };
};

// ----------------------------------------------------------- 3. Entra security

export type EntraSignal = {
  key: 'risky_signin' | 'failed_spike' | 'legacy_auth' | 'mfa_gap'
     | 'expiring_credentials' | 'role_change' | 'guest_access' | 'ca_change';
  label: string;
  count: number;
  delta24h: number;                  // rendered '+4' / '-2' / '0'
  severity: Severity;
  lastSeen: string;                  // ISO 8601
};

export type AuditEvent = {
  at: string;
  actor: string;                     // UPN or 'System'
  action: string;                    // 'Add member to role'
  target: string;
  result: 'success' | 'failure';
};

export type EntraSnapshot = {
  stats: {
    riskySignIns24h: number;
    riskyConfirmedCompromised: number;
    failedSignIns24h: number;
    failedSignInAccounts: number;    // distinct targeted accounts
    mfaCoverage: number;             // 0-1
    mfaUnregistered: number;
    privilegedAccounts: number;
    globalAdmins: number;
  };
  signals: EntraSignal[];
  audit: AuditEvent[];
};

// --------------------------------------------------------------- 4. Endpoints

export type EndpointIssue = {
  computer: string;                  // 'DEMO-LT-0412'
  assignedTo: string;
  os: string;                        // carried in the contract, not shown in the table —
                                     // the column was cut for width. Keep it.
  issue: string;                     // 'Agent stale · 34 days'
  issueKind: 'stale_agent' | 'missing_patches' | 'no_bitlocker' | 'eol_build';
  lastCheckIn: string;               // ISO 8601
};

export type EndpointSnapshot = {
  stats: {
    total: number;
    patchCompliance: number;         // 0-1
    checkedIn7d: number;
    bitlockerEncrypted: number;
    criticalPatchesMissing: number;
  };
  attention: EndpointIssue[];
};

// ---------------------------------------------------------- 5. Email security

export type BlockedMessage = {
  at: string;
  from: string;
  to: string;                        // may be 'N recipients'
  subject: string;
  reason: 'Credential phishing' | 'Impersonation' | 'Lookalike domain'
        | 'Malicious URL' | 'Malware' | 'Spam' | string;
};

export type EmailSnapshot = {
  stats: {
    processed24h: number;
    blocked24h: number;
    quarantined: number;
    quarantinePendingReview: number;
    credentialPhishing24h: number;
    credentialPhishingDelta: number;
  };
  recentBlocked: BlockedMessage[];
};

// ------------------------------------------------------------- 6. Log sources

export type LogSourceSnapshot = {
  sensors: { name: string; lastSeen: string; healthy: boolean }[];
  silentSources: { name: string; ip: string; lastEventAt: string }[];
};

// ------------------------------------------------- 7. Rules and integrations

export type AlertRule = {
  key: string;                       // 'vendor' | 'spray' | 'risky' | 'secrets' | 'stale' | 'legacy'
  name: string;
  detail: string;                    // human-readable threshold
  enabled: boolean;
  threshold?: Record<string, number | string>;
};

export type Integration = {
  key: string;
  name: string;
  detail: string;                    // auth mechanism / scope
  state: 'connected' | 'polling' | 'needs_auth' | 'error';
  stateLabel: string;                // 'Connected' | 'Polling 60s' | 'Needs auth'
  lastSuccessAt?: string;
};
```

`shared/src/index.ts`:

```ts
export type * from './contracts.js';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project shared --typecheck`
Expected: PASS, 6 type tests. The count must be 6 — a run reporting 0 assertions means typecheck mode is off and the file is proving nothing.

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Freeze and commit**

Add this line at the top of `shared/src/contracts.ts` above the existing header comment:

```ts
/* eslint-disable -- FROZEN FILE. See docs/superpowers/plans/2026-09-18-ops-dash-m1-scaffold.md */
```

```bash
git add shared/
git commit -m "feat(shared): frozen contracts.ts from amended DATA_CONTRACTS.md"
```

---

### Task 3: Self-hosted tokens, fonts and icons

**Files:**
- Create: `web/scripts/vendor-fonts.mjs`
- Create: `web/scripts/extract-icons.mjs`
- Create: `web/public/aurora/styles.css`, `web/public/aurora/tokens/{base,fig-tokens,spacing,typography}.css` (copied verbatim)
- Create: `web/public/aurora/tokens/fonts.css` (rewritten — local `@font-face`, no `@import`)
- Create: `web/public/fonts/*.woff2` (4 vendored files)
- Create: `web/src/components/aurora/icons.generated.ts`
- Create: `web/src/components/aurora/Icon.tsx`, `web/src/components/aurora/Icon.test.tsx`

**Interfaces:**
- Consumes: `design_handoff_it_ops_dashboard/aurora/` (the vendored bundle, read-only).
- Produces: `ICONS` and `IconName` from `icons.generated.ts`; the `<Icon name size color />` component; and a `/aurora/styles.css` served by Vite that pulls in the whole token system with **no outbound reference**.

Background, so nobody re-derives it: `tokens/fonts.css` is the **only** outbound reference in all of Aurora — two Google Fonts `@import`s, one for Plus Jakarta Sans + Urbanist, one for the Material Symbols webfont. Urbanist is dropped (confirmed by John 2026-09-18; `fonts.css` already points all three `--font-*` tokens at Plus Jakarta Sans, so the prototype's `var(--font-body, 'Urbanist', …)` fallback never fires and Urbanist is downloaded but never rendered). The Material Symbols webfont is not needed either: it exists only as Aurora's `Icon` fallback for glyphs missing from the extracted set, and all eleven glyphs this dashboard uses are present. Verified: the bundle carries 885 `{ viewBox, body }` entries and `MonitoringWeightRegular`, `SpaceDashboardWeightRegular`, `DnsWeightRegular`, `ReportWeightRegular`, `ShieldWeightRegular`, `ComputerWeightRegular`, `MailWeightRegular`, `SettingsWeightRegular`, `TaskAltWeightRegular`, `NightsStayWeightRegular` and `LightModeWeightRegular` are all among them, every one at `viewBox="0 0 48 48"`.

- [ ] **Step 1: Copy the Aurora token files verbatim**

```bash
mkdir -p "web/public/aurora/tokens" "web/public/fonts" "web/src/components/aurora"
cp "design_handoff_it_ops_dashboard/aurora/styles.css" web/public/aurora/styles.css
cp "design_handoff_it_ops_dashboard/aurora/tokens/base.css" \
   "design_handoff_it_ops_dashboard/aurora/tokens/fig-tokens.css" \
   "design_handoff_it_ops_dashboard/aurora/tokens/spacing.css" \
   "design_handoff_it_ops_dashboard/aurora/tokens/typography.css" \
   web/public/aurora/tokens/
```

Run: `grep -rn "https://" web/public/aurora/ || echo "CLEAN"`
Expected: `CLEAN` — `fonts.css` has not been copied yet, and nothing else reaches outward.

- [ ] **Step 2: Write the font vendoring script**

`web/scripts/vendor-fonts.mjs`. Run once; its output is committed and the script is never part of a build:

```js
// One-time, build-time only. Downloads the Plus Jakarta Sans variable font from
// Google Fonts and writes a local @font-face sheet. Output is committed; nothing
// at runtime ever reaches Google. Plus Jakarta Sans is OFL, so vendoring is fine.
import { mkdirSync, writeFileSync } from 'node:fs';

const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&display=swap';
// A modern desktop UA is required or Google serves ttf instead of woff2.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// English-only internal tool: latin and latin-ext are enough. Dropping the
// cyrillic-ext and vietnamese subsets halves the payload.
const KEEP = new Set(['latin', 'latin-ext']);

const css = await fetch(CSS_URL, { headers: { 'User-Agent': UA } }).then((r) => {
  if (!r.ok) throw new Error(`Google Fonts returned ${r.status}`);
  return r.text();
});

mkdirSync('public/fonts', { recursive: true });

const blocks = css.split('/*').slice(1);
const out = [
  '/* Plus Jakarta Sans (OFL), vendored from Google Fonts. Local only — no @import.',
  '   Regenerate with: npm run fonts --workspace @ops-dash/web',
  '   Urbanist is deliberately absent: all three --font-* tokens below point at',
  '   Plus Jakarta Sans, so Urbanist was downloaded but never rendered.',
  '   The Material Symbols webfont is deliberately absent: all 11 icons are inline',
  '   SVG from src/components/aurora/icons.generated.ts. */',
  '',
];
let written = 0;

for (const block of blocks) {
  const subset = block.slice(0, block.indexOf('*/')).trim();
  if (!KEEP.has(subset)) continue;
  const style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? 'normal';
  const url = /src:\s*url\((https:[^)]+)\)/.exec(block)?.[1];
  const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim();
  if (!url || !range) throw new Error(`could not parse @font-face for ${subset}/${style}`);

  const file = `plus-jakarta-sans-${subset}-${style}.woff2`;
  const bytes = Buffer.from(await fetch(url).then((r) => r.arrayBuffer()));
  writeFileSync(`public/fonts/${file}`, bytes);
  written++;

  out.push(
    '@font-face {',
    "  font-family: 'Plus Jakarta Sans';",
    `  font-style: ${style};`,
    '  font-weight: 200 800;',
    '  font-display: swap;',
    `  src: url('/fonts/${file}') format('woff2');`,
    `  unicode-range: ${range};`,
    '}',
    '',
  );
}

out.push(
  ':root {',
  '  --font-display: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;',
  '  --font-body: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;',
  '  --font-ui: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;',
  '  --font-mono: "SF Mono", ui-monospace, "SFMono-Regular", "Menlo", "Consolas", monospace;',
  '}',
  '',
);

writeFileSync('public/aurora/tokens/fonts.css', out.join('\n'));
console.log(`vendored ${written} woff2 files; wrote public/aurora/tokens/fonts.css`);
```

- [ ] **Step 3: Run it and verify nothing points outward**

Run: `npm run fonts --workspace @ops-dash/web`
Expected: `vendored 4 woff2 files; wrote public/aurora/tokens/fonts.css`

Run: `ls web/public/fonts/`
Expected: four files — `plus-jakarta-sans-latin-normal.woff2`, `plus-jakarta-sans-latin-ext-normal.woff2`, `plus-jakarta-sans-latin-italic.woff2`, `plus-jakarta-sans-latin-ext-italic.woff2`.

Run: `grep -rn "https://\|@import url('https" web/public/ || echo "CLEAN"`
Expected: `CLEAN`. This grep is the self-hosting acceptance test and Task 11 runs it again.

- [ ] **Step 4: Write the icon extraction script**

`web/scripts/extract-icons.mjs`. The glyph table lives on one very long line of the bundle that begins `let __ds_default_components_foundation_icon_data_hdnrqo;` and ends `};}catch{}`; the object between those markers is the 885-entry `{ viewBox, body }` table:

```js
// Build-time only. Lifts the 11 glyphs this dashboard uses out of the vendored
// Aurora bundle's extracted path data, so no icon webfont and no icon package is
// needed at runtime. Regenerate with: npm run icons --workspace @ops-dash/web
import { readFileSync, writeFileSync } from 'node:fs';

const BUNDLE = '../design_handoff_it_ops_dashboard/aurora/_ds_bundle.js';
const OUT = 'src/components/aurora/icons.generated.ts';

/** designer-facing snake_case name -> Aurora's PascalCase glyph key stem */
const NAMES = {
  monitoring: 'Monitoring',
  space_dashboard: 'SpaceDashboard',
  dns: 'Dns',
  report: 'Report',
  shield: 'Shield',
  computer: 'Computer',
  mail: 'Mail',
  settings: 'Settings',
  task_alt: 'TaskAlt',
  nights_stay: 'NightsStay',
  light_mode: 'LightMode',
};

const line = readFileSync(BUNDLE, 'utf8')
  .split('\n')
  .find((l) => l.startsWith('let __ds_default_components_foundation_icon_data_hdnrqo;'));
if (!line) throw new Error('icon-data line not found in the Aurora bundle');

const start = line.indexOf('={') + 1;
const end = line.lastIndexOf('};}catch{}') + 1;
if (start < 1 || end < 1) throw new Error('could not bracket the icon-data object literal');

// The bundle is vendored, committed and read at build time only — eval is the
// cheapest correct parser for a JS object literal with unquoted keys.
const data = eval(`(${line.slice(start, end)})`);

const entries = Object.entries(NAMES).map(([slug, stem]) => {
  const key = `${stem}WeightRegular`;
  const glyph = data[key];
  if (!glyph) throw new Error(`glyph ${key} is missing from the Aurora bundle`);
  return `  ${slug}: { viewBox: ${JSON.stringify(glyph.viewBox)}, body: ${JSON.stringify(glyph.body)} },`;
});

writeFileSync(
  OUT,
  `// GENERATED by scripts/extract-icons.mjs from design_handoff_it_ops_dashboard/aurora/_ds_bundle.js
// Do not hand-edit. Regenerate with: npm run icons --workspace @ops-dash/web

export type IconName = ${Object.keys(NAMES).map((n) => `'${n}'`).join(' | ')};

export const ICONS: Record<IconName, { viewBox: string; body: string }> = {
${entries.join('\n')}
};
`,
);
console.log(`wrote ${OUT} (${entries.length} glyphs)`);
```

- [ ] **Step 5: Run it**

Run: `npm run icons --workspace @ops-dash/web`
Expected: `wrote src/components/aurora/icons.generated.ts (11 glyphs)`

Run: `grep -c "viewBox" web/src/components/aurora/icons.generated.ts`
Expected: `11`

- [ ] **Step 6: Write the failing Icon test**

`web/src/components/aurora/Icon.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Icon } from './Icon.js';

describe('Icon', () => {
  it('renders the requested glyph as inline svg at the requested size', () => {
    const { container } = render(<Icon name="shield" size={19} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '19');
    expect(svg).toHaveAttribute('height', '19');
    expect(svg).toHaveAttribute('viewBox', '0 0 48 48');
    expect(svg?.innerHTML).toContain('<path');
  });

  it('defaults to currentColor and honours an explicit colour token', () => {
    const { container } = render(<Icon name="monitoring" size={17} color="var(--primary-main)" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('style')).toContain('var(--primary-main)');
  });

  it('is aria-hidden unless given a label', () => {
    const { container, rerender } = render(<Icon name="mail" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<Icon name="mail" aria-label="Email security" />);
    expect(container.querySelector('svg')).not.toHaveAttribute('aria-hidden');
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run web/src/components/aurora/Icon.test.tsx`
Expected: FAIL — `Failed to resolve import "./Icon.js"`.

- [ ] **Step 8: Write Icon.tsx**

Ported from `design_handoff_it_ops_dashboard/aurora/_ds_bundle.js` lines 5292-5389, minus the webfont fallback branch (there is no webfont, and every name in `IconName` is present):

```tsx
import type { CSSProperties, SVGProps } from 'react';
import { ICONS, type IconName } from './icons.generated.js';

export type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
} & Omit<SVGProps<SVGSVGElement>, 'name' | 'color' | 'style' | 'className' | 'dangerouslySetInnerHTML'>;  // amended at G0 — H-1

export function Icon({
  name,
  size = 24,
  color = 'currentColor',
  className = '',
  style,
  ...rest
}: IconProps) {
  const glyph = ICONS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox={glyph.viewBox}
      fill="none"
      className={`aur-icon ${className}`}
      aria-hidden={rest['aria-label'] ? undefined : true}
      style={{ display: 'inline-block', flexShrink: 0, color, verticalAlign: 'middle', ...style }}
      {...rest}
      // amended at G0 — H-1. {...rest} MUST stay ABOVE this line. JSX spread is
      // last-wins, so with the sink above it a caller could replace the glyph
      // body with arbitrary markup, and the repository guard cannot see it —
      // the guard greps for the literal string, which `<Icon {...props} />`
      // does not contain. Proven: it rendered <image href="x" onerror="1">.
      // `dangerouslySetInnerHTML` is also in the Omit below for the same reason.
      dangerouslySetInnerHTML={{ __html: glyph.body }}
    />
  );
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run web/src/components/aurora/Icon.test.tsx`
Expected: PASS, 3 tests.

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 10: Commit**

```bash
git add web/public web/scripts web/src/components/aurora .gitignore
git commit -m "feat(web): self-hosted Aurora tokens, vendored fonts, extracted icons"
```

---

### Task 3A: Repository guards, as tests

**Files:**
- Create: `web/src/guards.test.ts`

**Interfaces:**
- Consumes: the repository itself, read from disk with `node:fs`.
- Produces: nothing importable. It produces the property that the rest of this plan's invariants **keep holding**.

Why this task exists, and why it is here rather than at the end. This plan states eight repository-wide invariants — no literal hex, no outbound reference, no `fetch`, no credential, no un-redacted identifier, one `dangerouslySetInnerHTML`, no second dark palette, no hand-edit of the generated icons. A grep that runs once during a final pass proves each of them **on the day it runs and never again**. Milestones 2-4 add a server, four adapters and live queries; every one of those is an opportunity for one of these to quietly stop being true. Written as tests, they run on every `npm test`, they fail the build, and they survive this milestone — which is the entire point of writing them at all.

They are placed in Wave 0 so that every later wave is guarded while it is being written, not audited after.

- [ ] **Step 1: Write the guards**

`web/src/guards.test.ts`. These are file-content assertions, so they run in Vitest but read the tree directly:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: the repo path contains a space
// ("C:\git\ops dashboard") and pathname would hand back "%20".
const WEB = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO = join(WEB, '..');

function walk(dir: string, exts: string[], acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, exts, acc);
    else if (exts.includes(extname(entry))) acc.push(p);
  }
  return acc;
}

const src = () => walk(join(WEB, 'src'), ['.ts', '.tsx']);
const read = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => p.slice(REPO.length + 1).replace(/\\/g, '/');

describe('every colour is a token', () => {
  it('no literal hex in web/src', () => {
    const offenders: string[] = [];
    for (const file of src()) {
      if (file.endsWith('icons.generated.ts')) continue;
      read(file).split('\n').forEach((line, i) => {
        if (/#[0-9a-fA-F]{3,8}\b/.test(line) && !line.includes('prototype literal')) {
          offenders.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('no second dark palette — the dark class is the whole implementation', () => {
    const offenders = src().filter((f) => /prefers-color-scheme|\[data-theme=/.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('nothing reaches off-box', () => {
  it('no outbound reference in the served assets', () => {
    const assets = walk(join(WEB, 'public'), ['.css', '.html', '.js']);
    const offenders = assets.filter((f) => /https?:\/\//.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('no network client anywhere in web/src', () => {
    const offenders: string[] = [];
    for (const file of src()) {
      if (file.endsWith('guards.test.ts') || file.endsWith('offline.test.tsx')) continue;
      if (/\bfetch\s*\(|XMLHttpRequest|new WebSocket|new EventSource|navigator\.sendBeacon/.test(read(file))) {
        offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('no credentials, ever', () => {
  it('no credential path or secret-shaped key in the repo source', () => {
    const files = [...src(), ...walk(join(REPO, 'shared'), ['.ts'])];
    const pattern = /C:\\+secure|cert\.pem|refresh_token|client_secret|api_key|Zoho-oauthtoken|BEGIN (RSA )?PRIVATE KEY/i;
    const offenders = files.filter((f) => pattern.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('fixtures stay redacted', () => {
  const fixtures = () => walk(join(WEB, 'src/fixtures'), ['.ts']).map(read).join('\n');

  it('carries no real corporate identifier', () => {
    // CXDO-GraphExport and Stellar-Connector are app-registration names, not
    // user or host identifiers, and are deliberately real. Hosts and UPNs are not.
    expect(fixtures()).not.toMatch(/@crexendo\.com/i);
    expect(fixtures()).not.toMatch(/CXDO-(LT|DT)-/);
  });

  it('uses only the RFC 5737 documentation range for IP addresses', () => {
    for (const ip of fixtures().match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.[\dx]{1,3}\b/g) ?? []) {
      expect(ip).toMatch(/^203\.0\.113\./);
    }
  });
});

describe('HTML sinks', () => {
  it('only Icon.tsx may use dangerouslySetInnerHTML', () => {
    const offenders = src().filter(
      (f) => read(f).includes('dangerouslySetInnerHTML') && !f.endsWith('aurora/Icon.tsx'),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('the generated icon data is geometry only — no script, no event handler, no external ref', () => {
    const generated = read(join(WEB, 'src/components/aurora/icons.generated.ts'));
    expect(generated).not.toMatch(/<script|on[a-z]+=|javascript:|xlink:href|<image|<foreignObject|url\(/i);
    // every body is one or more <path .../> elements and nothing else
    for (const [, body] of generated.matchAll(/body: "((?:[^"\\]|\\.)*)"/g)) {
      const decoded = JSON.parse(`"${body}"`);
      expect(decoded.replace(/<path\b[^>]*\/>/g, '').trim()).toBe('');
    }
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run web/src/guards.test.ts`
Expected: PASS, 9 tests. Wave 0 has produced no views and no fixtures yet, so the fixture guards pass vacuously — that is correct and they bite from Wave 1 onward.

- [ ] **Step 3: Prove each guard actually fails**

A guard that has never failed is a guard you cannot trust. For **each** of the nine, break it deliberately, watch it fail, then revert:

| Guard | Break it with | Expect |
|---|---|---|
| no literal hex | add `const c = '#ff0000';` to `Icon.tsx` | FAIL naming that file and line |
| no second dark palette | add `@media (prefers-color-scheme: dark){}` to a `.ts` file as a string | FAIL |
| no outbound reference | add `/* https://example.com */` to `public/aurora/styles.css` | FAIL |
| no network client | add `fetch('/x')` to `Icon.tsx` | FAIL |
| no credentials | add `// C:\secure\.epc\config.json` to `Icon.tsx` | FAIL |
| redaction, identifiers | add `// a.user@crexendo.com` to a fixture (create a scratch one if none exists yet) | FAIL |
| redaction, IPs | add `// 10.3.1.7` to a fixture | FAIL |
| one HTML sink | add `dangerouslySetInnerHTML` to a second component | FAIL |
| geometry only | add `<script/>` to a `body:` string in the generated file | FAIL |

Run: `git status --porcelain`
Expected: empty, after all nine reverts. Do not proceed with a break left in.

- [ ] **Step 4: Commit**

```bash
git add web/src/guards.test.ts
git commit -m "test(web): repository invariants as executable guards"
git tag wave-0
```

Then run review gate **G0**.

---

## Wave 1 — team of 2, parallel

Dispatch both agents in a single message so they run concurrently. Paste the shared preamble from "Teams and file ownership" above each task body.

### Task 4: The eight primitives and the dashboard components — agent `primitives`

**Files:**
- Create: `web/src/theme/statusColor.ts`, `web/src/theme/statusColor.test.ts`
- Create: `web/src/components/aurora/{Button,IconButton,Switch,Table,LinearProgress,Skeleton,Alert}.tsx`
- Create: `web/src/components/aurora/primitives.test.tsx`
- Create: `web/src/components/{Card,StatCard,Sparkline,Panel,SectionHeading}.tsx`
- Create: `web/src/components/dashboard.test.tsx`
- **Must not touch:** `web/src/components/aurora/Icon.tsx`, `web/src/components/aurora/icons.generated.ts` (both owned by Wave 0 and already done), `shared/src/contracts.ts`, anything under `web/src/fixtures/`, `web/src/app/` or `web/src/views/`.

**Interfaces:**
- Consumes: `Icon` and `IconName` from `./Icon.js` (Wave 0); every type from `@ops-dash/shared`.
- Produces, and these exact names and signatures are what the four Wave 3 view agents are written against:

```ts
// web/src/theme/statusColor.ts
export function statusColor(level: StatusLevel): string;
export function severityColor(severity: Severity): string;
export function severityLabel(severity: Severity): string;   // 'SEV 1' | 'SEV 2' | 'SEV 3' | 'INFO'
export function timelineColor(kind: TimelineEntry['kind']): string;
export function allOperational(services: ServiceStatus[]): boolean;

// web/src/components/aurora/*
export function Button(p: { variant?: 'contained'|'outlined'|'text'; color?: 'primary'|'success'|'error'|'warning'|'neutral'; size?: 'small'|'medium'; disabled?: boolean; onClick?: () => void; children: ReactNode }): JSX.Element;
export function IconButton(p: { onClick?: () => void; 'aria-label': string; disabled?: boolean; children: ReactNode }): JSX.Element;
export function Switch(p: { checked: boolean; onChange: (next: boolean) => void; 'aria-label': string; disabled?: boolean }): JSX.Element;
export type Column<R> = { key: keyof R & string; label: string; align?: 'left'|'right'; width?: string; render?: (value: R[keyof R & string], row: R) => ReactNode };
export function Table<R extends Record<string, unknown>>(p: { columns: Column<R>[]; rows: R[]; dense?: boolean; getRowKey?: (row: R, i: number) => string }): JSX.Element;
export function LinearProgress(p: { value: number; color?: 'primary'|'success'|'warning'|'error'; thickness?: number }): JSX.Element;
export function Skeleton(p: { variant?: 'text'|'rect'|'circle'; width?: string|number; height?: string|number; lines?: number }): JSX.Element;
export function Alert(p: { severity: 'info'|'success'|'warning'|'error'; title?: string; children: ReactNode }): JSX.Element;

// web/src/components/*
export function Card(p: { children: ReactNode; padding?: string; borderLeft?: string; style?: CSSProperties; onClick?: () => void }): JSX.Element;
export function StatCard(p: { label: string; value: string; note?: string; valueColor?: string; valueSize?: 21|22|24; progress?: { value: number; color: 'primary'|'success'|'warning'|'error' } }): JSX.Element;
export function Sparkline(p: { values: number[]; color: string; height: number; viewBoxHeight: number }): JSX.Element;
export type PanelState =
  | { kind: 'ready' }
  | { kind: 'loading'; rows?: number }
  | { kind: 'empty'; message: string }
  | { kind: 'stale'; source: string; fetchedAt: string }
  | { kind: 'error'; source: string; message: string; fetchedAt?: string };
export function Panel(p: { state: PanelState; children: ReactNode }): JSX.Element;
export function SectionHeading(p: { children: ReactNode; meta?: ReactNode }): JSX.Element;
```

**Porting source.** Do not invent these components. Aurora's own implementations are in the vendored bundle and you port them to typed React, dropping props the dashboard does not use. Exact line ranges in `design_handoff_it_ops_dashboard/aurora/_ds_bundle.js`:

| Component | Lines |
|---|---|
| `Button` | 336-516 |
| `IconButton` | 1066-1159 |
| `Table` | 2014-2098 |
| `Alert` | 2563-2686 |
| `LinearProgress` (in `Progress.jsx`) | 3079-3182 |
| `Skeleton` | 3202-3265 |
| `Switch` | 4790-4895 |

Keep their token references exactly. `Table`'s measurements are load-bearing and already match the handoff: `dense` gives `padding: 8px 16px`, header cells are `0.75rem`/700 uppercase `letter-spacing: 0.04em` in `var(--text-secondary)` on `var(--background-cardelevation1)` with a 1px `var(--divider)` bottom border, and the wrapper is `width:100%; overflow:auto` so a narrow content well scrolls the table rather than clipping it.

- [ ] **Step 1: Write the failing test for `statusColor`**

`web/src/theme/statusColor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ServiceStatus } from '@ops-dash/shared';
import { statusColor, severityColor, severityLabel, timelineColor, allOperational } from './statusColor.js';

const svc = (vendor: ServiceStatus['vendor']['level'], ours: ServiceStatus['ours']['level']) =>
  ({ vendor: { level: vendor }, ours: { level: ours } }) as ServiceStatus;

describe('statusColor', () => {
  it('maps every StatusLevel to its token', () => {
    expect(statusColor('operational')).toBe('var(--success-main)');
    expect(statusColor('degraded')).toBe('var(--warning-main)');
    expect(statusColor('outage')).toBe('var(--error-main)');
    expect(statusColor('maintenance')).toBe('var(--info-main)');
  });

  it('renders unknown as neutral grey, never green', () => {
    expect(statusColor('unknown')).toBe('var(--text-disabled)');
    expect(statusColor('unknown')).not.toBe(statusColor('operational'));
  });
});

describe('allOperational', () => {
  it('is true only when every service is affirmatively operational on both halves', () => {
    expect(allOperational([svc('operational', 'operational'), svc('operational', 'operational')])).toBe(true);
  });

  it('is false when any service is unknown — one Statuspage failure must not read as all-green', () => {
    expect(allOperational([svc('operational', 'operational'), svc('unknown', 'operational')])).toBe(false);
  });

  it('is false when a vendor is green but our own probe is not', () => {
    expect(allOperational([svc('operational', 'degraded')])).toBe(false);
  });

  it('is false during announced maintenance', () => {
    expect(allOperational([svc('maintenance', 'operational')])).toBe(false);
  });
});

describe('severity helpers', () => {
  it('maps severity to token and label', () => {
    expect(severityColor(1)).toBe('var(--error-main)');
    expect(severityColor(2)).toBe('var(--warning-main)');
    expect(severityColor(3)).toBe('var(--info-main)');
    expect(severityColor('info')).toBe('var(--info-main)');
    expect(severityLabel(1)).toBe('SEV 1');
    expect(severityLabel('info')).toBe('INFO');
  });
});

describe('timelineColor', () => {
  it('maps each kind to the dot colour from DATA_CONTRACTS section 2', () => {
    expect(timelineColor('opened')).toBe('var(--text-secondary)');
    expect(timelineColor('detected')).toBe('var(--error-main)');
    expect(timelineColor('escalated')).toBe('var(--error-main)');
    expect(timelineColor('vendor')).toBe('var(--warning-main)');
    expect(timelineColor('update')).toBe('var(--info-main)');
    expect(timelineColor('resolved')).toBe('var(--success-main)');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run web/src/theme/statusColor.test.ts`
Expected: FAIL — `Failed to resolve import "./statusColor.js"`.

- [ ] **Step 3: Implement `statusColor.ts`**

```ts
import type { ServiceStatus, Severity, StatusLevel, TimelineEntry } from '@ops-dash/shared';

/** StatusLevel -> Aurora token. Adapters never return colours; the UI computes them. */
export function statusColor(level: StatusLevel): string {
  switch (level) {
    case 'operational': return 'var(--success-main)';
    case 'degraded':    return 'var(--warning-main)';
    case 'outage':      return 'var(--error-main)';
    case 'maintenance': return 'var(--info-main)';
    case 'unknown':     return 'var(--text-disabled)';
  }
}

export function severityColor(severity: Severity): string {
  if (severity === 1) return 'var(--error-main)';
  if (severity === 2) return 'var(--warning-main)';
  return 'var(--info-main)';
}

export function severityLabel(severity: Severity): string {
  return severity === 'info' ? 'INFO' : `SEV ${severity}`;
}

export function timelineColor(kind: TimelineEntry['kind']): string {
  switch (kind) {
    case 'opened':    return 'var(--text-secondary)';
    case 'detected':
    case 'escalated': return 'var(--error-main)';
    case 'vendor':    return 'var(--warning-main)';
    case 'update':    return 'var(--info-main)';
    case 'resolved':  return 'var(--success-main)';
  }
}

/**
 * Amendment 1, rule 1: the Overview strip asserts health only when every service
 * is affirmatively operational on both halves. 'unknown' and 'maintenance' do not
 * count. Without this, one Statuspage-wide failure paints Jira, Helpjuice, Claude
 * and OpenAI green at once — four vendors, one upstream, one correlated lie.
 */
export function allOperational(services: ServiceStatus[]): boolean {
  return services.every((s) => s.vendor.level === 'operational' && s.ours.level === 'operational');
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run web/src/theme/statusColor.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the failing test for the Aurora primitives**

`web/src/components/aurora/primitives.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button.js';
import { IconButton } from './IconButton.js';
import { Switch } from './Switch.js';
import { Table, type Column } from './Table.js';
import { LinearProgress } from './LinearProgress.js';
import { Skeleton } from './Skeleton.js';
import { Alert } from './Alert.js';
import { Icon } from './Icon.js';

describe('Button', () => {
  it('renders its label and fires onClick', () => {
    const onClick = vi.fn();
    render(<Button variant="outlined" size="small" onClick={onClick}>Acknowledge</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Resolve</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('uses only token colours', () => {
    const { container } = render(<Button color="success" variant="text">Resolve</Button>);
    expect(container.innerHTML).toContain('var(--success');
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe('IconButton', () => {
  it('exposes its accessible name and fires onClick', () => {
    const onClick = vi.fn();
    render(
      <IconButton aria-label="Switch to dark theme" onClick={onClick}>
        <Icon name="nights_stay" size={20} />
      </IconButton>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('Switch', () => {
  it('reports the next value, not the event', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} aria-label="Agent stale" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Agent stale' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reflects checked state to assistive tech', () => {
    render(<Switch checked onChange={() => {}} aria-label="Vendor rule" />);
    expect(screen.getByRole('switch', { name: 'Vendor rule' })).toBeChecked();
  });
});

describe('Table', () => {
  type Row = { id: string; dur: string };
  const columns: Column<Row>[] = [
    { key: 'id', label: 'Incident' },
    { key: 'dur', label: 'Duration', align: 'right' },
  ];

  it('renders uppercase header labels and one row per record', () => {
    render(<Table dense columns={columns} rows={[{ id: 'INC-2284', dur: '41m' }]} />);
    expect(screen.getByRole('columnheader', { name: 'Incident' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'INC-2284' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2); // header + 1
  });

  it('right-aligns a column that asks for it', () => {
    render(<Table dense columns={columns} rows={[{ id: 'INC-2284', dur: '41m' }]} />);
    expect(screen.getByRole('cell', { name: '41m' })).toHaveStyle({ textAlign: 'right' });
  });

  it('uses a column render function when given one', () => {
    const cols: Column<Row>[] = [{ key: 'dur', label: 'Duration', render: (v) => <b>{String(v)}!</b> }];
    render(<Table columns={cols} rows={[{ id: 'x', dur: '41m' }]} />);
    expect(screen.getByText('41m!')).toBeInTheDocument();
  });

  it('scrolls horizontally rather than clipping the last column', () => {
    const { container } = render(<Table columns={columns} rows={[]} />);
    expect(container.firstElementChild).toHaveStyle({ overflow: 'auto' });
  });
});

describe('LinearProgress', () => {
  it('exposes its value to assistive tech and clamps out-of-range input', () => {
    render(<LinearProgress value={91} color="warning" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '91');
    render(<LinearProgress value={140} />);
    expect(screen.getAllByRole('progressbar')[1]).toHaveAttribute('aria-valuenow', '100');
  });
});

describe('Skeleton', () => {
  it('renders the requested number of lines and is hidden from assistive tech', () => {
    const { container } = render(<Skeleton variant="text" lines={3} />);
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    expect(container.textContent).toBe('');
  });
});

describe('Alert', () => {
  it('renders as a live region with its title and body', () => {
    render(<Alert severity="warning" title="Stale data">Endpoint Central data is 14 minutes stale</Alert>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Stale data');
    expect(alert).toHaveTextContent('Endpoint Central data is 14 minutes stale');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run web/src/components/aurora/primitives.test.tsx`
Expected: FAIL — unresolved imports for `./Button.js` and the six siblings.

- [ ] **Step 7: Port the seven primitives**

One file each, in `web/src/components/aurora/`. Port from the line ranges in the table above. Rules while porting:

- Drop props the dashboard never uses (`fullWidth`, `shape`, `grade`, `stickyHeader`, `variant="indeterminate"`, `CircularProgress`). Keep the signature in "Interfaces" above exactly — four Wave 3 agents are already written against it.
- Keep every `var(--*)` reference. Do not substitute a hex value for one.
- `Switch` renders a real `<button role="switch" aria-checked>` — the bundle's version is a styled `div`, which no screen reader and no `getByRole('switch')` will find. This is the one deliberate deviation from the port, and it changes no pixels.
- `LinearProgress` renders `role="progressbar"` with `aria-valuenow`/`aria-valuemin`/`aria-valuemax`, clamping `value` into `[0, 100]`.
- `Alert` renders `role="alert"`.
- `Skeleton` is `aria-hidden="true"` and renders no text.
- `Button` and `IconButton` render real `<button type="button">` elements and honour `disabled`.
- `Table` is generic over its row type and keys rows by `getRowKey` when given, index otherwise.

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run web/src/components/aurora/primitives.test.tsx`
Expected: PASS, 13 tests.

- [ ] **Step 9: Write the failing test for the dashboard components**

`web/src/components/dashboard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card.js';
import { StatCard } from './StatCard.js';
import { Sparkline } from './Sparkline.js';
import { Panel } from './Panel.js';
import { SectionHeading } from './SectionHeading.js';

describe('Card', () => {
  it('applies the card recipe from README "Card recipe used everywhere"', () => {
    const { container } = render(<Card>body</Card>);
    expect(container.firstElementChild).toHaveStyle({
      border: '1px solid var(--divider)',
      borderRadius: '12px',
      background: 'var(--background-paper)',
    });
  });

  it('takes an accent border on the left when asked', () => {
    const { container } = render(<Card borderLeft="var(--error-main)">body</Card>);
    expect(container.firstElementChild).toHaveStyle({ borderLeft: '3px solid var(--error-main)' });
  });
});

describe('StatCard', () => {
  it('renders label, value and note', () => {
    render(<StatCard label="MFA coverage" value="94.3%" note="29 users unregistered" />);
    expect(screen.getByText('MFA coverage')).toBeInTheDocument();
    expect(screen.getByText('94.3%')).toBeInTheDocument();
    expect(screen.getByText('29 users unregistered')).toBeInTheDocument();
  });

  it('renders a progress bar instead of a note when given one', () => {
    render(<StatCard label="Patch compliance" value="91.4%" progress={{ value: 91, color: 'warning' }} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '91');
  });

  it('renders values with tabular numerals', () => {
    render(<StatCard label="Blocked" value="3,911" />);
    expect(screen.getByText('3,911')).toHaveStyle({ fontVariantNumeric: 'tabular-nums' });
  });
});

describe('Sparkline', () => {
  it('emits 28 points across the viewBox width, oldest first', () => {
    const values = Array.from({ length: 28 }, (_, i) => 100 + i);
    const { container } = render(<Sparkline values={values} color="var(--success-main)" height={26} viewBoxHeight={26} />);
    const points = container.querySelector('polyline')?.getAttribute('points')?.split(' ') ?? [];
    expect(points).toHaveLength(28);
    expect(points[0]?.split(',')[0]).toBe('0.0');
    expect(points[27]?.split(',')[0]).toBe('100.0');
  });

  it('puts the highest latency highest on the chart', () => {
    const { container } = render(<Sparkline values={[100, 900]} color="var(--error-main)" height={26} viewBoxHeight={26} />);
    const [lo, hi] = (container.querySelector('polyline')?.getAttribute('points') ?? '').split(' ');
    expect(Number(hi?.split(',')[1])).toBeLessThan(Number(lo?.split(',')[1])); // smaller y = higher up
  });

  it('draws a flat mid-line when every sample is identical', () => {
    const { container } = render(<Sparkline values={[200, 200, 200]} color="var(--success-main)" height={26} viewBoxHeight={26} />);
    const ys = (container.querySelector('polyline')?.getAttribute('points') ?? '').split(' ').map((p) => p.split(',')[1]);
    expect(new Set(ys).size).toBe(1);
  });

  it('never renders a pre-baked point string handed in as data', () => {
    const { container } = render(<Sparkline values={[]} color="var(--success-main)" height={26} viewBoxHeight={26} />);
    expect(container.querySelector('polyline')).toBeNull();
  });
});

describe('Panel', () => {
  it('renders children when ready', () => {
    render(<Panel state={{ kind: 'ready' }}><p>real data</p></Panel>);
    expect(screen.getByText('real data')).toBeInTheDocument();
  });

  it('hides children behind a skeleton while loading', () => {
    render(<Panel state={{ kind: 'loading', rows: 3 }}><p>real data</p></Panel>);
    expect(screen.queryByText('real data')).not.toBeInTheDocument();
  });

  it('shows the age of the data and still renders it when stale', () => {
    const fourteenMinutesAgo = new Date(Date.now() - 14 * 60_000).toISOString();
    render(<Panel state={{ kind: 'stale', source: 'Endpoint Central', fetchedAt: fourteenMinutesAgo }}><p>last good</p></Panel>);
    expect(screen.getByRole('alert')).toHaveTextContent(/Endpoint Central data is 14 minutes (old|stale)/);
    expect(screen.getByText('last good')).toBeInTheDocument();
  });

  it('never renders children as if real when the fetch failed with nothing cached', () => {
    render(<Panel state={{ kind: 'error', source: 'Microsoft Graph', message: 'consent required' }}><p>0</p></Panel>);
    expect(screen.getByRole('alert')).toHaveTextContent('Microsoft Graph');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('distinguishes empty from healthy', () => {
    render(<Panel state={{ kind: 'empty', message: 'No incidents published' }}><p>rows</p></Panel>);
    expect(screen.getByText('No incidents published')).toBeInTheDocument();
    expect(screen.queryByText('rows')).not.toBeInTheDocument();
  });
});

describe('SectionHeading', () => {
  it('renders a heading with optional meta', () => {
    render(<SectionHeading meta="4 open · 1 Sev1">Active incidents</SectionHeading>);
    expect(screen.getByRole('heading', { name: 'Active incidents' })).toBeInTheDocument();
    expect(screen.getByText('4 open · 1 Sev1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `npx vitest run web/src/components/dashboard.test.tsx`
Expected: FAIL — unresolved imports for `./Card.js` and its four siblings.

- [ ] **Step 11: Implement the five dashboard components**

`Card.tsx` — the recipe from README, in one place so no view re-types it:

```tsx
import type { CSSProperties, ReactNode } from 'react';

export function Card({
  children,
  padding = '16px 18px',
  borderLeft,
  style,
  onClick,
}: {
  children: ReactNode;
  padding?: string;
  borderLeft?: string;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        border: '1px solid var(--divider)',
        ...(borderLeft ? { borderLeft: `3px solid ${borderLeft}` } : {}),
        borderRadius: 12,
        background: 'var(--background-paper)',
        padding,
        ...(onClick ? { cursor: 'pointer' } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
```

`StatCard.tsx` — label 11px/600 secondary, value 21-24px/700 tabular-nums, then either a note or a `LinearProgress`:

```tsx
import { LinearProgress } from './aurora/LinearProgress.js';
import { Card } from './Card.js';

export function StatCard({
  label,
  value,
  note,
  valueColor = 'var(--text-primary)',
  valueSize = 22,
  progress,
}: {
  label: string;
  value: string;
  note?: string;
  valueColor?: string;
  valueSize?: 21 | 22 | 24;
  progress?: { value: number; color: 'primary' | 'success' | 'warning' | 'error' };
}) {
  return (
    <Card padding="14px 16px" style={{ display: 'flex', flexDirection: 'column', gap: progress ? 6 : 3 }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</div>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontWeight: 700,
          fontSize: valueSize,
          fontVariantNumeric: 'tabular-nums',
          color: valueColor,
        }}
      >
        {value}
      </div>
      {progress ? <LinearProgress value={progress.value} color={progress.color} /> : null}
      {note ? <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{note}</div> : null}
    </Card>
  );
}
```

`Sparkline.tsx` — the contract says `spark` is raw milliseconds and the view scales them; never accept a pre-rendered point string:

```tsx
const PAD = 2;

/** Scales raw millisecond samples into the viewBox. Higher latency sits higher. */
export function Sparkline({
  values,
  color,
  height,
  viewBoxHeight,
}: {
  values: number[];
  color: string;
  height: number;
  viewBoxHeight: number;
}) {
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const usable = viewBoxHeight - PAD * 2;
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;

  const points = values
    .map((v, i) => {
      const norm = span === 0 ? 0.5 : (v - min) / span;
      const y = viewBoxHeight - PAD - norm * usable;
      return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 100 ${viewBoxHeight}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height }}
      aria-hidden="true"
    >
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
```

`Panel.tsx` — the states the prototype does not cover and the README says you must add. `Intl.RelativeTimeFormat` is a built-in; do not add a date library:

```tsx
import type { ReactNode } from 'react';
import { Alert } from './aurora/Alert.js';
import { Skeleton } from './aurora/Skeleton.js';

export type PanelState =
  | { kind: 'ready' }
  | { kind: 'loading'; rows?: number }
  | { kind: 'empty'; message: string }
  | { kind: 'stale'; source: string; fetchedAt: string }
  | { kind: 'error'; source: string; message: string; fetchedAt?: string };

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

export function ageLabel(iso: string, now: number = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return rtf.format(-minutes, 'minute').replace(' ago', '');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour').replace(' ago', '');
  return rtf.format(-Math.round(hours / 24), 'day').replace(' ago', '');
}

export function Panel({ state, children }: { state: PanelState; children: ReactNode }) {
  if (state.kind === 'loading') {
    return <Skeleton variant="text" lines={state.rows ?? 4} />;
  }
  if (state.kind === 'error') {
    return (
      <Alert severity="error" title={`${state.source} is unavailable`}>
        {state.message}
        {state.fetchedAt ? ` · last good data ${ageLabel(state.fetchedAt)} old` : ''}
      </Alert>
    );
  }
  if (state.kind === 'empty') {
    return (
      <div style={{ padding: '28px 24px', textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
        {state.message}
      </div>
    );
  }
  if (state.kind === 'stale') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Alert severity="warning">{`${state.source} data is ${ageLabel(state.fetchedAt)} old`}</Alert>
        {children}
      </div>
    );
  }
  return <>{children}</>;
}
```

`SectionHeading.tsx`:

```tsx
import type { ReactNode } from 'react';

export function SectionHeading({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <h2 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15 }}>{children}</h2>
      {meta ? <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{meta}</div> : null}
    </div>
  );
}
```

Note on the stale-copy test: it accepts `14 minutes old` or `14 minutes stale`. `Intl.RelativeTimeFormat` with `numeric: 'always'` yields `14 minutes ago`, and `ageLabel` strips the `ago`, giving `Endpoint Central data is 14 minutes old`. That matches.

- [ ] **Step 12: Run the test to verify it passes**

Run: `npx vitest run web/src/components/dashboard.test.tsx`
Expected: PASS, 14 tests.

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 13: Prove no literal hex leaked in**

Run: `grep -rnE "#[0-9a-fA-F]{3,8}\b" web/src/components web/src/theme | grep -v "prototype literal" | grep -v icons.generated || echo "CLEAN"`
Expected: `CLEAN`.

- [ ] **Step 14: Commit**

```bash
git add web/src/components web/src/theme
git commit -m "feat(web): Aurora primitives and dashboard components"
```

---

### Task 5: Fixtures — agent `fixtures`

**Files:**
- Create: `web/src/fixtures/{services,incidents,history,entra,endpoints,email,rules,index}.ts`
- Create: `web/src/fixtures/fixtures.test.ts`
- **Must not touch:** anything outside `web/src/fixtures/`. In particular `shared/src/contracts.ts` is frozen: if a prototype value has nowhere to live in the contract, **stop and report** rather than widening a type.

**Interfaces:**
- Consumes: every type from `@ops-dash/shared`.
- Produces, and this is what the four Wave 3 view agents import:

```ts
export type DemoMode = 'quiet' | 'sev1';
export type FixtureBundle = {
  services: ServiceStatus[];        // exactly 7, in the order below
  incidents: Incident[];            // 4 in sev1, 0 in quiet
  recentHistory: HistoryRow[];      // 5 rows, closed incidents
  checkRuns: CheckRun[];            // 5 rows, per selected service
  entra: EntraSnapshot;
  endpoints: EndpointSnapshot;
  email: EmailSnapshot;
  rules: AlertRule[];               // 6
  integrations: Integration[];      // 6
};
export type HistoryRow = { id: string; title: string; service: string; duration: string; closed: string };
export const fixtures: Record<DemoMode, FixtureBundle>;
export function serviceById(mode: DemoMode, id: string): ServiceStatus | undefined;
export function incidentById(mode: DemoMode, id: string): Incident | undefined;
```

**Where the values come from.** `IT Ops Dashboard.dc.html`'s `renderVals()` is the source. Carry its numbers and copy across unchanged **except** for the three reconciliations below, which are not optional.

1. **Ten services become seven.** The prototype's `SERVICES` array is placeholder. Use exactly these, in this order — it is the order the Overview strip and tile grid render:

   | `id` | `short` | `name` | baseline latency ms |
   |---|---|---|---|
   | `m365` | `Microsoft 365` | `Microsoft 365 / Entra ID` | 210 |
   | `proofpoint` | `Proofpoint` | `Proofpoint 365 Total Protection` | 260 |
   | `jira` | `Jira` | `Jira Software` | 175 |
   | `zendesk` | `Zendesk` | `Zendesk Support` | 190 |
   | `helpjuice` | `Helpjuice` | `Helpjuice Knowledge Base` | 140 |
   | `claude` | `Claude` | `Claude (Anthropic)` | 155 |
   | `openai` | `OpenAI` | `OpenAI` | 165 |

2. **Redaction is permanent.** People are `first.last@example.com`, machines are `DEMO-LT-0412`-style, IPs are `203.0.113.x` (RFC 5737 documentation range). Exact values are given per fixture below. No `@crexendo.com` address, no `CXDO-*` hostname, no real mail subject appears anywhere — including in your tests.

3. **The `needs_auth` integration row tells the truth.** The prototype used a fictional "ServiceDesk Plus · token expired". Replace it with the real open question: `M365 Service Health`, detail `ServiceHealth.Read.All + ServiceMessage.Read.All consent pending`, state `needs_auth`. That is the actual blocker on the M365 tile and it is worth having on screen.

- [ ] **Step 1: Write the failing fixture test**

`web/src/fixtures/fixtures.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fixtures, serviceById, incidentById } from './index.js';

const ORDER = ['m365', 'proofpoint', 'jira', 'zendesk', 'helpjuice', 'claude', 'openai'];

describe('fixture shape', () => {
  it.each(['quiet', 'sev1'] as const)('%s has the seven verified services in order', (mode) => {
    expect(fixtures[mode].services.map((s) => s.id)).toEqual(ORDER);
  });

  it.each(['quiet', 'sev1'] as const)('%s gives every service 28 spark samples', (mode) => {
    for (const s of fixtures[mode].services) expect(s.spark).toHaveLength(28);
  });

  it.each(['quiet', 'sev1'] as const)('%s never pre-renders an svg point string', (mode) => {
    for (const s of fixtures[mode].services) {
      for (const v of s.spark) expect(typeof v).toBe('number');
    }
  });
});

describe('quiet mode', () => {
  const q = fixtures.quiet;

  it('has no open incidents', () => {
    expect(q.incidents).toHaveLength(0);
  });

  it('is affirmatively operational on both halves of every service', () => {
    for (const s of q.services) {
      expect(s.vendor.level).toBe('operational');
      expect(s.ours.level).toBe('operational');
    }
  });

  it('carries five closed incidents in recent history', () => {
    expect(q.recentHistory).toHaveLength(5);
  });
});

describe('sev1 mode', () => {
  const s = fixtures.sev1;

  it('opens four incidents, one per severity band the prototype shows', () => {
    expect(s.incidents.map((i) => i.severity)).toEqual([1, 2, 2, 3]);
  });

  it('degrades m365 on both halves, which is what makes the headline rule fire', () => {
    const m365 = serviceById('sev1', 'm365');
    expect(m365?.vendor.level).toBe('degraded');
    expect(m365?.ours.level).toBe('outage');
  });

  it('puts proofpoint on a vendor advisory with our probes merely slow', () => {
    const pfpt = serviceById('sev1', 'proofpoint');
    expect(pfpt?.vendor.level).toBe('degraded');
    expect(pfpt?.ours.level).toBe('degraded');
  });

  it('shows at least one unknown service so the neutral state is exercised', () => {
    expect(s.services.some((x) => x.vendor.level === 'unknown')).toBe(true);
  });

  it('never claims all-operational while anything is unknown', () => {
    expect(s.services.every((x) => x.vendor.level === 'operational')).toBe(false);
  });

  it('gives the Sev1 a full blast radius and a newest-first timeline', () => {
    const inc = incidentById('sev1', 'INC-2291');
    expect(inc?.blastRadius).toHaveLength(4);
    expect(inc?.timeline).toHaveLength(5);
    const times = inc!.timeline.map((t) => Date.parse(t.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('ties the Sev1 to the vendor rule', () => {
    expect(incidentById('sev1', 'INC-2291')?.ruleKey).toBe('vendor');
  });
});

describe('redaction', () => {
  const blob = JSON.stringify(fixtures);

  it('contains no real corporate identifiers', () => {
    expect(blob).not.toMatch(/@crexendo\.com/);
    expect(blob).not.toMatch(/CXDO-(LT|DT)-/);
  });

  it('uses only documentation-range IP addresses', () => {
    for (const ip of blob.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\w{1,3}\b/g) ?? []) {
      expect(ip.startsWith('203.0.113.')).toBe(true);
    }
  });
});

describe('integrations', () => {
  it('surfaces the real M365 consent blocker as the needs_auth row', () => {
    const row = fixtures.sev1.integrations.find((i) => i.state === 'needs_auth');
    expect(row?.name).toBe('M365 Service Health');
    expect(row?.detail).toContain('ServiceHealth.Read.All');
  });

  it('describes the vendor feed as the seven verified vendors, not the placeholder list', () => {
    const row = fixtures.sev1.integrations.find((i) => i.key === 'vendorstatus');
    expect(row?.detail).not.toMatch(/AWS|Okta|Cloudflare|GitHub/);
  });
});

describe('alert rules', () => {
  it('carries the six rules from DATA_CONTRACTS section 7 with the prototype defaults', () => {
    expect(fixtures.sev1.rules.map((r) => [r.key, r.enabled])).toEqual([
      ['vendor', true], ['spray', true], ['risky', true],
      ['secrets', true], ['stale', false], ['legacy', true],
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run web/src/fixtures/fixtures.test.ts`
Expected: FAIL — `Failed to resolve import "./index.js"`.

- [ ] **Step 3: Write `services.ts`**

Build the seven `ServiceStatus` objects for both modes. Spark series: keep the prototype's deterministic generator so the curves match its screenshots, but return **milliseconds**, not viewBox coordinates — the contract says raw numbers and `Sparkline` does the scaling:

```ts
import type { ServiceStatus, ServiceId, StatusLevel } from '@ops-dash/shared';

/** The prototype's LCG, retargeted from viewBox units to milliseconds so the
 *  curves match its screenshots while the contract stays honest. */
function spark(seed: number, base: number, spike: boolean): number[] {
  let x = (seed * 7919 + 13) % 2147483647;
  const out: number[] = [];
  for (let i = 0; i < 28; i++) {
    x = (x * 48271) % 2147483647;
    const v = x / 2147483647;
    let ms = base * (0.85 + v * 0.35);
    if (spike && i > 17) ms = base * (2.6 + v * 1.6) + (i - 17) * base * 0.12;
    out.push(Math.round(ms));
  }
  return out;
}
```

Then one record per service. `m365` and `proofpoint` differ by mode; `zendesk` is `unknown` in sev1 (see below); the rest stay operational in both. Field values:

- **quiet, every service:** `vendor.level: 'operational'`, `vendor.label: 'Operational'`, `vendor.note: 'No advisories posted in the last 7 days. Feed polled every 60 seconds.'`, `vendor.incidentsSince: []`, `vendor.lastSuccessfulPoll` = now minus 41s. `ours.level: 'operational'`, `ours.label: 'Passing'`, `ours.note: 'All probes green from four regions. Last run 41 seconds ago.'`, `ours.passing: 4`, `ours.total: 4`. `latencyMs` = the baseline from the table. `p50Ms` = baseline, `p95Ms` = `Math.round(baseline * 1.8)`. `uptime30d: 0.9998`, `incidents90d: 1`, `lastStateChange` = 11 days ago.
- **sev1 `m365`:** *(amended at G1 — G-13: superseded. m365's vendor half is `unknown`/`Unknown` with NO `lastSuccessfulPoll`, because `ServiceHealth.Read.All` consent is pending and the feed has never authenticated. `advisoryId`, `incidentsSince` and every mention of EX1084221 are removed. The `ours` half below still stands. The vendor+ours correlation moved to Proofpoint, which carries INC-2292. See docs/RESUME.md, gate G1.)* ~~`vendor.level: 'degraded'`, `label: 'Degraded'`, `note: 'Advisory EX1084221 — "Users may experience delays receiving email." Last vendor update 12 minutes ago.'`, `advisoryId: 'EX1084221'`, `incidentsSince: [{ id: 'EX1084221', title: 'Users may experience delays receiving email', level: 'degraded', startedAt: <09:12 today> }]`. `ours.level: 'outage'`, `label: 'Failing'`, `note: 'Mailflow probe failing from us-east, us-west and eu-west. Last success 09:08.'`, `passing: 1`, `total: 4`. `latencyMs: 840` (4x baseline), `spark: spark(3, 210, true)`, `uptime30d: 0.9921`, `incidents90d: 4`, `lastStateChange` = 09:12 today.
- **sev1 `proofpoint`:** `vendor.level: 'degraded'`, `label: 'Advisory'`, `note: 'Status.io reports elevated processing latency in United States - Atlanta. Last vendor update 34 minutes ago.'`, `ours.level: 'degraded'`, `label: 'Slow'`, `note: 'Mailflow round trip above p95 from us-east. Last success 2 minutes ago.'`, `passing: 3`, `total: 4`.
- **sev1 `zendesk`:** `vendor.level: 'unknown'`, `label: 'Unknown'`, `note: 'Zendesk SSP publishes no per-service status field and returned no incidents. An absence is not an affirmation. Reading is global Zendesk, not necessarily our pod.'`, `incidentsSince: []`, `lastSuccessfulPoll` = 60s ago. `ours` stays operational. This one fixture is what proves amendment 1 and amendment 4 render correctly; do not "fix" it to green.

- [ ] **Step 4: Write `incidents.ts`**

Four `Incident` records, from the prototype's `alertsRaw`, `blastRadius` and `timeline`, in this order so `severity` reads `[1, 2, 2, 3]`:

| id | sev | title | serviceId | ruleKey |
|---|---|---|---|---|
| `INC-2291` | 1 | `Exchange Online mail delivery delays` | `m365` | `vendor` |
| `INC-2290` | 2 | `Failed sign-in spike — 1,204 attempts against 96 accounts` | `m365` | `spray` |
| `INC-2288` | 2 | `14 Endpoint Central agents stale for 21+ days` | `endpointcentral` | `stale` |
| `INC-2286` | 3 | `2 app registration secrets expire in 9 days` | `m365` | `secrets` |

`metaParts` are the prototype's meta strings split on ` · `, with the IP redacted:

- `INC-2291`: `['Microsoft 365', 'opened 09:12', '384 users affected', 'advisory EX1084221']`
- `INC-2290`: `['Entra ID', 'opened 08:47', 'source 203.0.113.x (RO, NL)', 'legacy auth endpoints']`
- `INC-2288`: `['Endpoint Central', 'opened yesterday 17:20', '9 laptops, 5 desktops']`
- `INC-2286`: `['Entra ID', 'opened 2 days ago', 'CXDO-GraphExport, Stellar-Connector']` — these two are app-registration names, not user or host identifiers, and they are the real ones; keep them.

`INC-2291.summary`: `Microsoft advisory EX1084221 reports delayed transport in North America. Our synthetic mailflow probe is failing from three of four regions, which matches the vendor claim.`

`INC-2291.blastRadius` (`value` is preformatted, `level` drives the tint):

```ts
[
  { label: 'Users affected',   value: '384',     note: 'of 512 licensed mailboxes', level: 'error' },
  { label: 'Mail queue depth', value: '2,140',   note: 'inbound messages held',     level: 'error' },
  { label: 'Median delay',     value: '18m 40s', note: 'up from 4s baseline',       level: 'warning' },
  { label: 'Oldest message',   value: '1h 12m',  note: 'queued since 08:29',        level: 'warning' },
]
```

`INC-2291.timeline`, newest first, `at` as a full ISO timestamp on today's date:

```ts
[
  { at: '…T10:24:00', kind: 'update',    title: 'Queue drain started',      body: 'Delay down to 18m 40s from a 31m peak. Monitoring.' },
  { at: '…T09:58:00', kind: 'vendor',    title: 'Vendor confirmed',         body: 'Microsoft posted EX1084221 and identified a transport infrastructure fault.' },
  { at: '…T09:31:00', kind: 'escalated', title: 'Escalated to Sev1',        body: 'Affected mailbox count crossed 300. Help desk notified, banner posted in Teams.' },
  { at: '…T09:14:00', kind: 'detected',  title: 'Synthetic probes failing', body: 'Mailflow round trip timed out from us-east, us-west and eu-west.' },
  { at: '…T09:12:00', kind: 'opened',    title: 'Incident opened',          body: 'Auto-created from rule "Vendor status page degraded + our check failing".' },
]
```

The other three incidents each get a two-entry timeline (`opened`, `detected`) and a two-metric blast radius, written in the same voice. They are only ever rendered from the Overview list in this milestone, but `IncidentDetail` routes by id, so they must be complete.

- [ ] **Step 5: Write `history.ts`, `entra.ts`, `endpoints.ts`, `email.ts`, `rules.ts`**

`history.ts` — the prototype's five closed incidents verbatim except the service names, which move to the seven-vendor world:

```ts
export const recentHistory: HistoryRow[] = [
  { id: 'INC-2284', title: 'Zendesk agent workspace slow to load',   service: 'Zendesk',       duration: '41m',    closed: '2 days ago' },
  { id: 'INC-2281', title: 'Helpjuice search index rebuild',          service: 'Helpjuice',     duration: '2h 14m', closed: '4 days ago' },
  { id: 'INC-2279', title: 'Teams call quality degradation',          service: 'Microsoft 365', duration: '1h 06m', closed: '6 days ago' },
  { id: 'INC-2277', title: 'Jira automation queue backlog',           service: 'Jira',          duration: '3h 48m', closed: '8 days ago' },
  { id: 'INC-2275', title: 'Claude API elevated error rate',          service: 'Claude',        duration: '27m',    closed: '11 days ago' },
];
```

`checkRuns` — the prototype's five rows as `CheckRun[]`, `latencyMs` numeric and `result` one of `pass | fail | timeout`. The 09:41:02 mailflow row is `timeout` with `latencyMs: null` in sev1 and `pass` with the baseline in quiet.

`entra.ts` — `EntraSnapshot` from the prototype's `entraStats`, `entraRows` and `auditRows`. Stats: `riskySignIns24h: 7`, `riskyConfirmedCompromised: 3`, `failedSignIns24h: 1204`, `failedSignInAccounts: 96`, `mfaCoverage: 0.943`, `mfaUnregistered: 29`, `privilegedAccounts: 11`, `globalAdmins: 4`. Eight `EntraSignal` rows keyed `risky_signin`, `failed_spike`, `legacy_auth`, `mfa_gap`, `expiring_credentials`, `role_change`, `guest_access`, `ca_change` with the prototype's counts (`7, 1204, 318, 29, 2, 1, 43, 0`), deltas (`+4, +1102, +296, -2, 0, +1, +3, 0`) and severities (`1, 2, 2, 3, 3, 2, 'info', 'info'`). Four `AuditEvent` rows, **redacted**:

```ts
[
  { at: '…', actor: 'j.hart@example.com',  action: 'Add member to role',      target: 'Helpdesk Administrator', result: 'success' },
  { at: '…', actor: 'System',              action: 'Disable user',            target: 'contractor-ac41',        result: 'success' },
  { at: '…', actor: 'm.reyes@example.com', action: 'Update app credentials',  target: 'Stellar-Connector',      result: 'success' },
  { at: '…', actor: 'j.hart@example.com',  action: 'Invite external user',    target: 'auditor@example.net',    result: 'success' },
]
```

`endpoints.ts` — `EndpointSnapshot`. Stats: `total: 612`, `patchCompliance: 0.914`, `checkedIn7d: 598`, `bitlockerEncrypted: 576`, `criticalPatchesMissing: 38`. Six `EndpointIssue` rows with hostnames rewritten `CXDO-` → `DEMO-` and users to first-initial form, each carrying its `issueKind`:

```ts
[
  { computer: 'DEMO-LT-0412', assignedTo: 'a.nguyen', os: 'Windows 11 23H2', issue: 'Agent stale · 34 days',        issueKind: 'stale_agent',    lastCheckIn: '…' },
  { computer: 'DEMO-LT-0288', assignedTo: 'r.patel',  os: 'Windows 11 23H2', issue: '6 critical patches missing',   issueKind: 'missing_patches', lastCheckIn: '…' },
  { computer: 'DEMO-DT-0117', assignedTo: 'shared / reception', os: 'Windows 10 22H2', issue: 'BitLocker not enabled', issueKind: 'no_bitlocker', lastCheckIn: '…' },
  { computer: 'DEMO-LT-0355', assignedTo: 'k.obrien', os: 'macOS 15.2',      issue: 'Agent stale · 27 days',        issueKind: 'stale_agent',    lastCheckIn: '…' },
  { computer: 'DEMO-LT-0501', assignedTo: 'd.silva',  os: 'Windows 11 24H2', issue: '4 critical patches missing',   issueKind: 'missing_patches', lastCheckIn: '…' },
  { computer: 'DEMO-DT-0092', assignedTo: 'lab / QA', os: 'Windows 10 22H2', issue: 'EOL build · upgrade required', issueKind: 'eol_build',      lastCheckIn: '…' },
]
```

`email.ts` — `EmailSnapshot`. Stats: `processed24h: 18402`, `blocked24h: 3911`, `quarantined: 147`, `quarantinePendingReview: 12`, `credentialPhishing24h: 38`, `credentialPhishingDelta: 9`. Five `BlockedMessage` rows; sender domains stay as the prototype's synthetic hostile ones, recipients become `@example.com`:

```ts
[
  { at: '…T09:48', from: 'billing@invoice-secure.net',  to: 'ap@example.com',      subject: 'Outstanding invoice #88214',     reason: 'Credential phishing' },
  { at: '…T09:31', from: 'no-reply@ms-verify.co',       to: 'j.hart@example.com',  subject: 'Your password expires today',    reason: 'Credential phishing' },
  { at: '…T09:12', from: 'hr-update@example-hr.com',    to: '14 recipients',       subject: 'Updated payroll direct deposit', reason: 'Impersonation' },
  { at: '…T08:55', from: 'ceo@exarnple.com',            to: 'finance@example.com', subject: 'Quick favour — wire today',      reason: 'Lookalike domain' },
  { at: '…T08:40', from: 'docs@sharefile-cloud.ru',     to: 'm.reyes@example.com', subject: 'Contract for signature',         reason: 'Malicious URL' },
]
```

`rules.ts` — six `AlertRule` records in the prototype's order, matching DATA_CONTRACTS section 7's threshold table, with `stale` the one disabled by default:

```ts
[
  { key: 'vendor',  name: 'Vendor degraded + our check failing', detail: 'Opens a Sev1 automatically',            enabled: true  },
  { key: 'spray',   name: 'Failed sign-in spike',                detail: 'More than 500 failures in 15 minutes',  enabled: true,  threshold: { failures: 500, windowMinutes: 15 } },
  { key: 'risky',   name: 'Risky sign-in confirmed compromised', detail: 'Any single occurrence',                 enabled: true  },
  { key: 'secrets', name: 'Secret or certificate expiring',      detail: 'Within 14 days',                        enabled: true,  threshold: { days: 14 } },
  { key: 'stale',   name: 'Agent stale',                         detail: 'No check-in for 21 days',               enabled: false, threshold: { days: 21 } },
  { key: 'legacy',  name: 'Legacy auth attempt',                 detail: 'Any successful legacy protocol sign-in', enabled: true },
]
```

and six `Integration` records:

```ts
[
  { key: 'graph',         name: 'Microsoft Graph',        detail: 'App-only, certificate auth · CXDO-GraphExport',         state: 'connected',  stateLabel: 'Connected' },
  { key: 'epc',           name: 'Endpoint Central Cloud', detail: 'Zoho OAuth self-client · read-only',                    state: 'connected',  stateLabel: 'Connected' },
  { key: 'stellar',       name: 'Stellar Cyber XDR',      detail: 'Tenant API token · read-only',  /* amended at G1 — G-12 */  state: 'connected',  stateLabel: 'Connected' },
  { key: 'proofpoint',    name: 'Proofpoint 365 TP',      detail: 'Hornetsecurity Control Panel API',                      state: 'connected',  stateLabel: 'Connected' },
  { key: 'vendorstatus',  name: 'Vendor status feeds',    detail: 'Hornetsecurity, Jira, Helpjuice, Claude, OpenAI, Zendesk', state: 'polling', stateLabel: 'Polling 60s' },
  { key: 'm365health',    name: 'M365 Service Health',    detail: 'ServiceHealth.Read.All + ServiceMessage.Read.All consent pending', state: 'needs_auth', stateLabel: 'Needs auth' },
]
```

- [ ] **Step 6: Write `index.ts`**

```ts
import type { ServiceStatus, Incident, CheckRun, EntraSnapshot, EndpointSnapshot, EmailSnapshot, AlertRule, Integration } from '@ops-dash/shared';
// … imports of the six fixture modules …

export type DemoMode = 'quiet' | 'sev1';
export type HistoryRow = { id: string; title: string; service: string; duration: string; closed: string };

export type FixtureBundle = {
  services: ServiceStatus[];
  incidents: Incident[];
  recentHistory: HistoryRow[];
  checkRuns: CheckRun[];
  entra: EntraSnapshot;
  endpoints: EndpointSnapshot;
  email: EmailSnapshot;
  rules: AlertRule[];
  integrations: Integration[];
};

export const fixtures: Record<DemoMode, FixtureBundle> = { quiet: /* … */, sev1: /* … */ };

export function serviceById(mode: DemoMode, id: string): ServiceStatus | undefined {
  return fixtures[mode].services.find((s) => s.id === id);
}

export function incidentById(mode: DemoMode, id: string): Incident | undefined {
  return fixtures[mode].incidents.find((i) => i.id === id);
}
```

Timestamps: compute them relative to module load (`new Date(Date.now() - 12 * 60_000).toISOString()` and friends) rather than hard-coding a date, so `Panel`'s age labels and the incident-age line stay sensible whenever the app is opened.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run web/src/fixtures/fixtures.test.ts`
Expected: PASS, 19 tests.

Run: `npm run typecheck`
Expected: exits 0 — every fixture satisfies the frozen contract with no `as any` and no widened type.

- [ ] **Step 8: Commit**

```bash
git add web/src/fixtures
git commit -m "feat(web): prototype-derived fixtures for the seven verified services"
```

---

## Wave 2 — lead, solo

### Task 6: Shell, routing, theme and view stubs

**Files:**
- Create: `web/src/app/routes.ts`, `web/src/app/pageMeta.ts`, `web/src/app/DemoModeProvider.tsx`, `web/src/app/Sidebar.tsx`, `web/src/app/Header.tsx`, `web/src/app/Shell.tsx`, `web/src/app/App.tsx`, `web/src/app/shell.test.tsx`
- Create: `web/src/theme/ThemeProvider.tsx`, `web/src/theme/ThemeProvider.test.tsx`
- Modify: `web/src/main.tsx`
- Create as **stubs only**: the seven `web/src/views/*.tsx`

**Interfaces:**
- Consumes: `Icon` (Wave 0); `IconButton` (Task 4); `fixtures`, `serviceById`, `incidentById`, `DemoMode` (Task 5); `severityColor` (Task 4).
- Produces, for the four Wave 3 view agents:

```ts
// web/src/app/DemoModeProvider.tsx
export function useDemoMode(): { mode: DemoMode; setMode: (m: DemoMode) => void; bundle: FixtureBundle };
// web/src/app/routes.ts
export const NAV: readonly { id: NavId; label: string; icon: IconName; path: string }[];
export const ROUTE = { overview: '/', service: '/services/:id', incident: '/incidents/:id',
                       entra: '/entra', endpoints: '/endpoints', email: '/email', settings: '/settings' } as const;
```

Every view is a default-exported component taking no props. It gets its data from `useDemoMode()` and its route params from react-router's `useParams`.

- [ ] **Step 1: Write the failing shell test**

`web/src/app/shell.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from './DemoModeProvider.js';
import { App } from './App.js';

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <DemoModeProvider>
          <App />
        </DemoModeProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );

describe('sidebar', () => {
  it('lists the seven nav items in order', () => {
    at('/');
    const nav = screen.getByRole('navigation');
    expect(within(nav).getAllByRole('link').map((a) => a.textContent?.trim().replace(/\d+$/, ''))).toEqual([
      'Overview', 'Service detail', 'Incident', 'Entra security', 'Endpoints', 'Email security', 'Rules & integrations',
    ]);
  });

  it('marks the current route as the active item', () => {
    at('/entra');
    expect(screen.getByRole('link', { name: /Entra security/ })).toHaveAttribute('aria-current', 'page');
  });

  it('badges Overview with the open incident count and Incident with the open Sev1s', () => {
    at('/');
    // amended at G1 — G-13: sev1 now holds FIVE incidents, and TWO of them are
    // Sev1 — INC-2292 (proofpoint, auto-created by the vendor rule) and INC-2291
    // (m365, opened by hand because its vendor feed is unreadable).
    expect(within(screen.getByRole('link', { name: /Overview/ })).getByText('5')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: /^Incident/ })).getByText('2')).toBeInTheDocument();
  });

  it('shows the brand block', () => {
    at('/');
    expect(screen.getByText('Crexendo IT')).toBeInTheDocument();
    expect(screen.getByText('Service operations')).toBeInTheDocument();
  });
});

describe('header', () => {
  it('shows the per-route title and subtitle', () => {
    at('/endpoints');
    expect(screen.getByRole('heading', { level: 1, name: 'Endpoints & patch health' })).toBeInTheDocument();
    expect(screen.getByText('612 managed endpoints · Endpoint Central')).toBeInTheDocument();
  });

  it('says seven monitored services, never ten', () => {
    at('/');
    expect(screen.getByText(/7 monitored services/)).toBeInTheDocument();
    expect(screen.queryByText(/10 monitored services/)).not.toBeInTheDocument();
  });

  it('counts the auto-refresh down from 30 seconds', () => {
    at('/');
    expect(screen.getByText(/Auto-refresh · \d{1,2}s/)).toBeInTheDocument();
  });

  it('shows a ticking clock', () => {
    at('/');
    expect(screen.getByTestId('clock').textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('routing', () => {
  it.each([
    ['/', 'view-overview'],
    ['/services/m365', 'view-service'],
    ['/incidents/INC-2291', 'view-incident'],
    ['/entra', 'view-entra'],
    ['/endpoints', 'view-endpoints'],
    ['/email', 'view-email'],
    ['/settings', 'view-settings'],
  ])('renders %s', (path, testId) => {
    at(path);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it('sends an unknown path back to the overview', () => {
    at('/nope');
    expect(screen.getByTestId('view-overview')).toBeInTheDocument();
  });
});

describe('theme', () => {
  it('toggles the dark class on the document root and persists it', () => {
    at('/');
    fireEvent.click(screen.getByRole('button', { name: /dark theme/i }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('ops-dash.theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: /light theme/i }));
    expect(document.documentElement).not.toHaveClass('dark');
  });
});

describe('demo state toggle', () => {
  it('switches the fixture bundle between quiet and sev1', () => {
    at('/');
    fireEvent.click(screen.getByRole('button', { name: 'Quiet' }));
    expect(screen.getByText(/5 of 7 monitored services affirmed healthy · 2 unknown  /* amended at G2: the original 'All 7 monitored services healthy' is the G1 wrong-green one string further along — it renders over two services we cannot affirm *//)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sev1' }));
    expect(screen.getByText(/open incidents across 7 monitored services/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run web/src/app/shell.test.tsx`
Expected: FAIL — unresolved imports for `./App.js`, `./DemoModeProvider.js`, `../theme/ThemeProvider.js`.

- [ ] **Step 3: Write the theme provider**

`web/src/theme/ThemeProvider.tsx`. The whole dark-mode implementation is the `dark` class — Aurora already ships the palette under `:root[data-theme="dark"], .dark`:

```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'ops-dash.theme';

const Ctx = createContext<{ theme: Theme; toggle: () => void } | null>(null);

function initial(): Theme {
  // amended at G2 — G-14. The original line here read the OS colour preference
  // via a media query, which FAILS Task 3A's "no second dark palette" guard and
  // gives a red build the moment you regenerate this task from the plan. The
  // guard greps prose as well as code, so a comment naming that query — or
  // quoting Aurora's own attribute selector — fails it identically. Default to
  // light; the stored value is the only input.
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);   // can throw: private mode, blocked storage
  } catch {
    stored = null;
  }
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme outside ThemeProvider');
  return v;
}
```

`web/src/theme/ThemeProvider.test.tsx` — one test, that a stored preference survives a remount:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeProvider.js';

function Probe() { return <span>{useTheme().theme}</span>; }

describe('ThemeProvider', () => {
  beforeEach(() => localStorage.clear());

  it('restores a persisted choice', () => {
    localStorage.setItem('ops-dash.theme', 'dark');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByText('dark')).toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
  });
});
```

- [ ] **Step 4: Write routes, page metadata and the demo-mode provider**

`web/src/app/routes.ts`:

```ts
import type { IconName } from '../components/aurora/icons.generated.js';

export type NavId = 'overview' | 'service' | 'incident' | 'entra' | 'endpoints' | 'email' | 'settings';

export const ROUTE = {
  overview: '/',
  service: '/services/:id',
  incident: '/incidents/:id',
  entra: '/entra',
  endpoints: '/endpoints',
  email: '/email',
  settings: '/settings',
} as const;

/** The sidebar's two detail entries need a concrete target. They point at the
 *  first service and the open Sev1 — the same defaults the prototype showed. */
export const NAV: readonly { id: NavId; label: string; icon: IconName; path: string }[] = [
  { id: 'overview',  label: 'Overview',             icon: 'space_dashboard', path: '/' },
  { id: 'service',   label: 'Service detail',       icon: 'dns',             path: '/services/m365' },
  { id: 'incident',  label: 'Incident',             icon: 'report',          path: '/incidents/INC-2291' },
  { id: 'entra',     label: 'Entra security',       icon: 'shield',          path: '/entra' },
  { id: 'endpoints', label: 'Endpoints',            icon: 'computer',        path: '/endpoints' },
  { id: 'email',     label: 'Email security',       icon: 'mail',            path: '/email' },
  { id: 'settings',  label: 'Rules & integrations', icon: 'settings',        path: '/settings' },
];
```

`web/src/app/pageMeta.ts` — the prototype's `titles` map, reconciled to seven services:

```ts
import type { FixtureBundle } from '../fixtures/index.js';

export function pageMeta(
  pathname: string,
  bundle: FixtureBundle,
): { title: string; subtitle: string } {
  const open = bundle.incidents.length;

  if (pathname.startsWith('/services/')) {
    const id = pathname.slice('/services/'.length);
    const svc = bundle.services.find((s) => s.id === id);
    return {
      title: svc?.name ?? 'Service detail',
      subtitle: 'Vendor status and our synthetic checks, side by side',
    };
  }
  if (pathname.startsWith('/incidents/')) {
    const id = pathname.slice('/incidents/'.length);
    const inc = bundle.incidents.find((i) => i.id === id);
    return { title: inc?.id ?? 'Incident', subtitle: inc?.title ?? 'Incident not found' };
  }
  switch (pathname) {
    case '/entra':     return { title: 'Entra security',           subtitle: 'Sign-in risk, identity hygiene and directory audit' };
    case '/endpoints': return { title: 'Endpoints & patch health', subtitle: '612 managed endpoints · Endpoint Central' };
    case '/email':     return { title: 'Email security',           subtitle: 'Proofpoint 365 Total Protection · last 24 hours' };
    case '/settings':  return { title: 'Rules & integrations',     subtitle: 'What we watch and where it comes from' };
    default:
      return {
        title: 'Overview',
        subtitle: open
          ? `${open} open incidents across 7 monitored services`
          : '5 of 7 monitored services affirmed healthy · 2 unknown  /* amended at G2: the original 'All 7 monitored services healthy' is the G1 wrong-green one string further along — it renders over two services we cannot affirm */ · 512 users, 612 endpoints',
      };
  }
}
```

`web/src/app/DemoModeProvider.tsx`. The README calls the Quiet/Sev1 switch "a prototype affordance … in production it should be removed, or kept behind a dev flag." In Milestone 1 it is the only way to reach both states, so it stays and is dev-gated. Milestone 4 removes it:

```tsx
import { createContext, useContext, useState, type ReactNode } from 'react';
import { fixtures, type DemoMode, type FixtureBundle } from '../fixtures/index.js';

const Ctx = createContext<{ mode: DemoMode; setMode: (m: DemoMode) => void; bundle: FixtureBundle } | null>(null);

/// <reference types="vite/client" />
// amended at G2 — G-15. Without that reference this file does not typecheck —
// `import.meta.env` is a Vite ambient type — while Vitest still reports
// "Type Errors  no errors", because Vitest typechecks only the `shared`
// project. Fourth occurrence of that trap; see docs/RESUME.md.

/** Dev-only. Milestone 4 deletes this provider along with the sidebar footer. */
export const DEMO_TOGGLE_VISIBLE = import.meta.env.DEV;

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DemoMode>('sev1');
  return <Ctx.Provider value={{ mode, setMode, bundle: fixtures[mode] }}>{children}</Ctx.Provider>;
}

export function useDemoMode() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDemoMode outside DemoModeProvider');
  return v;
}
```

- [ ] **Step 5: Write the sidebar, header and shell**

`Sidebar.tsx` — carries `data-testid="sidebar"` on its root (Task 10A measures it). 232px, `flex: 0 0 232px`, `position: sticky; top: 0; height: 100vh`, `background: var(--background-paper)`, `border-right: 1px solid var(--divider)`. Brand block: 28×28 radius-8 square on `--primary-main` holding a white 17px `monitoring` icon; "Crexendo IT" 13.5px/700 letter-spacing -0.01em over "Service operations" 11px `--text-secondary`; padding `16px 18px`, bottom divider. Nav list: `padding: 10px`, `gap: 2px`; each item a `20px 1fr auto` grid, `gap: 10px`, `padding: 7px 10px`, radius 8, 13px `--font-ui`; inactive `transparent` / `--text-secondary` / 600, active `--primary-lighter` / `--primary-dark` / 700 and `aria-current="page"`. Use react-router's `NavLink` so the active state comes from the router, not from local state. Badge: `min-width: 18px; height: 18px; padding: 0 5px; radius: 9px`, white 10.5px/700, `--error-main` on Incident, `--warning-main` on Overview — Overview's count is `bundle.incidents.length`, Incident's is `1` when a Sev1 is open, and neither renders at zero. Footer: `margin-top: auto`, top divider, padding 14, overline "DEMO STATE" (10.5px/700, 0.08em, uppercase, `--text-secondary`) over the segmented pill — track `--grey-grey-100`, radius 999, padding 3, gap 3; each half `flex: 1`, `padding: 5px 0`, radius 999, 11.5px/700; selected half `--background-paper` / `--text-primary`, unselected `transparent` / `--text-secondary`. Render the footer only when `DEMO_TOGGLE_VISIBLE`. The two halves are `<button>` elements so the test can find them by role.

`Header.tsx` — sticky, `z-index: 5`, `padding: 14px 24px`, bottom divider, `background: var(--background-paper)`, flex `gap: 16px`. Title is an `<h1>` at 19px/700 letter-spacing -0.015em with `margin: 0`; subtitle 12.5px `--text-secondary`. Auto-refresh pill: `padding: 5px 11px`, `1px solid var(--divider)`, radius 8, `white-space: nowrap; flex: 0 0 auto`, containing a 7px `--success-main` dot animated `pulseDot 2s ease-in-out infinite` and `Auto-refresh · {n}s` counting 30 → 0 → 30. Clock: `data-testid="clock"`, `var(--font-mono)`, 15px/600, `font-variant-numeric: tabular-nums`, ticking every second. Theme toggle: `IconButton` with a 20px `nights_stay` / `light_mode` `Icon`, `aria-label` `"Switch to dark theme"` / `"Switch to light theme"`.

One `setInterval(…, 1000)` in `Header` drives both the clock and the countdown; clear it on unmount. Define the `pulseDot` keyframes once, in `web/index.html`'s `<style>` block, exactly as the prototype does:

```css
@keyframes pulseDot { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
```

`Shell.tsx` — the flex root: `display: flex; min-height: 100vh; background: var(--background-default); color: var(--text-primary); font-family: var(--font-body)`. Sidebar, then a `flex: 1; min-width: 0` column holding `Header` and the content well (`flex: 1; padding: 20px 24px 40px; display: flex; flex-direction: column; gap: 16px`).

`App.tsx`:

```tsx
import { Navigate, Route, Routes } from 'react-router';
import { Shell } from './Shell.js';
import { ROUTE } from './routes.js';
import Overview from '../views/Overview.js';
import ServiceDetail from '../views/ServiceDetail.js';
import IncidentDetail from '../views/IncidentDetail.js';
import Entra from '../views/Entra.js';
import Endpoints from '../views/Endpoints.js';
import Email from '../views/Email.js';
import Settings from '../views/Settings.js';

export function App() {
  return (
    <Shell>
      <Routes>
        <Route path={ROUTE.overview} element={<Overview />} />
        <Route path={ROUTE.service} element={<ServiceDetail />} />
        <Route path={ROUTE.incident} element={<IncidentDetail />} />
        <Route path={ROUTE.entra} element={<Entra />} />
        <Route path={ROUTE.endpoints} element={<Endpoints />} />
        <Route path={ROUTE.email} element={<Email />} />
        <Route path={ROUTE.settings} element={<Settings />} />
        <Route path="*" element={<Navigate to={ROUTE.overview} replace />} />
      </Routes>
    </Shell>
  );
}
```

`main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ThemeProvider } from './theme/ThemeProvider.js';
import { DemoModeProvider } from './app/DemoModeProvider.js';
import { App } from './app/App.js';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <DemoModeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </DemoModeProvider>
    </ThemeProvider>
  </StrictMode>,
);
```

- [ ] **Step 6: Create the seven view stubs**

One file each, so the router compiles and the Wave 3 agents have a file to replace. `web/src/views/Overview.tsx`:

```tsx
export default function Overview() {
  return <div data-testid="view-overview" />;
}
```

and the same shape for `ServiceDetail` (`view-service`), `IncidentDetail` (`view-incident`), `Entra` (`view-entra`), `Endpoints` (`view-endpoints`), `Email` (`view-email`), `Settings` (`view-settings`). **Every Wave 3 agent must keep its `data-testid` on the view's root element** — the shell test asserts on them and Task 11 re-runs it.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run web/src/app web/src/theme`
Expected: PASS, 15 tests.

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 8: See it in a browser**

Run: `npm run dev`
Expected: Vite serves on `http://localhost:5173`. Open it. The sidebar, header, clock, countdown and theme toggle are all live; the content well is empty because the views are stubs. Confirm in devtools that the Network tab shows **no request to any third-party host** — only `localhost`. Stop the server.

- [ ] **Step 9: Commit**

```bash
git add web/src/app web/src/theme web/src/views web/src/main.tsx web/index.html
git commit -m "feat(web): app shell, routing, theme and demo-mode plumbing"
```

---

## Wave 3 — team of 4, parallel

Dispatch all four agents in a single message. Paste the shared preamble above each task body. Every agent in this wave:

- keeps the `data-testid` its stub carried, on the view's root element;
- reads its data from `useDemoMode()` and its params from `useParams()`;
- uses `Card`, `StatCard`, `Sparkline`, `Panel`, `SectionHeading` and the Aurora primitives rather than re-typing the card recipe;
- uses `statusColor` / `severityColor` / `severityLabel` / `timelineColor` rather than picking a token by hand;
- adds the loading and error states the README says the prototype does not cover, via `Panel`;
- writes no literal hex, no `fetch`, and no fixture of its own.

A test helper every one of them uses — write it inline at the top of your own test file rather than sharing a file, since no agent owns a shared test util:

```tsx
const at = (path: string, route: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <DemoModeProvider>
          <Routes><Route path={route} element={<TheView />} /></Routes>
        </DemoModeProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
```

### Task 7: Overview — agent `view-overview`

**Files:**
- Modify: `web/src/views/Overview.tsx` (replace the stub wholesale)
- Create: `web/src/views/Overview.test.tsx`

**Interfaces:**
- Consumes: `useDemoMode`, `Card`, `StatCard`, `Sparkline`, `Panel`, `SectionHeading`, `Button`, `Table`, `Icon`, `statusColor`, `severityColor`, `severityLabel`, `allOperational`.
- Produces: nothing other views import.

Build both states from README § "1. Overview". **Quiet:** the compressed status strip (one bordered radius-12 row, `padding: 10px 14px`, wrapping flex, `gap: 8px`, leading with the overline "ALL SYSTEMS OPERATIONAL", then one pill per service — `--grey-grey-100`, radius 999, `padding: 4px 9px`, a 6px status dot and an 11.5px/600 name, each linking to `/services/{id}`); the empty-state card (centered, `padding: 28px 24px`, a 34px `task_alt` icon in `--success-main`, "No active incidents" 16px/700, then a 13px `--text-secondary` line, `max-width: 460px`, `text-wrap: pretty`); and the "Recent history" table. **Sev1:** the expanded tile grid (`repeat(auto-fill, minmax(190px, 1fr))`, `gap: 10px`; each tile card recipe + `border-left: 3px solid {statusColor}`, `padding: 10px 12px`, `gap: 6px`; row 1 a 7px dot, 12.5px/700 name, right-aligned 11px tabular-nums latency; row 2 the 26px-high sparkline; row 3 10.5px `--text-secondary` "Vendor: {label}" left, "Ours: {label}" right); then "Active incidents" with the alert rows (`52px 1fr auto` grid, `gap: 14px`, `padding: 11px 14px`, card recipe + `border-left: 3px solid {sevColor}`; a 52×22 radius-6 solid sev chip in white 11px/700; a 13.5px/700 clickable title over an 11.5px `--text-secondary` meta line; and three small Buttons — outlined "Acknowledge", text "Mute", text `color="success"` "Resolve").

Three behaviours that are product decisions, not styling:

- The overline is asserted only when `allOperational(services)` is true. If any service is `unknown` or `maintenance`, render the strip **without** the "ALL SYSTEMS OPERATIONAL" overline. Never print it over a grey dot.
- Acknowledged, muted and resolved rows drop to `opacity: 0.45` and their meta line is prefixed `Acknowledged by {user} · ` or `Resolved by {user} · `. **The row stays in place** — an explicit product decision; acknowledging must not hide work.
- Ack/mute/resolve are local `useState` in this milestone. Milestone 4 makes them server-persisted mutations. Actor is the literal string `John H.`, as in the prototype.

- [ ] **Step 1: Write the failing test**

`web/src/views/Overview.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import Overview from './Overview.js';

const at = () =>
  render(
    <MemoryRouter>
      <ThemeProvider><DemoModeProvider><Overview /></DemoModeProvider></ThemeProvider>
    </MemoryRouter>,
  );

// amended at G3 — G-17. This clicked the SIDEBAR's segmented control, which the
// view-under-test's tree does not render, so getByRole THROWS rather than fails.
// It is also gated by DEMO_TOGGLE_VISIBLE and therefore absent from production
// builds entirely. Select the world the way the app itself does — the ?demo=
// query parameter, which works in every build and is what Task 10A must use too.
const at = (path = '/', mode = 'sev1') =>
  render(
    <MemoryRouter initialEntries={[`${path}?demo=${mode}`]}>…</MemoryRouter>,
  );
const toQuiet = undefined;  // removed; pass mode to at() instead

describe('Overview — sev1 (the default)', () => {
  it('renders one tile per verified service', () => {
    at();
    expect(screen.getAllByTestId('service-tile')).toHaveLength(7);
  });

  it('gives each tile a sparkline drawn from the raw samples', () => {
    at();
    expect(screen.getAllByTestId('service-tile')[0]?.querySelector('polyline')).toBeInTheDocument();
  });

  it('lists the five open incidents with their severity chips', () => {
    at();
    // amended at G1 — G-13: two Sev1s now. getByText THROWS on multiple matches,
    // so this must be getAllByText — it would not merely fail, it would error.
    expect(screen.getAllByText('SEV 1')).toHaveLength(2);
    expect(screen.getAllByText('SEV 2')).toHaveLength(2);
    expect(screen.getByText('SEV 3')).toBeInTheDocument();
  });

  it('links an alert title to its incident', () => {
    at();
    expect(screen.getByRole('link', { name: 'Exchange Online mail delivery delays' }))
      .toHaveAttribute('href', '/incidents/INC-2291');
  });

  it('dims an acknowledged row, credits the actor, and keeps the row in place', () => {
    at();
    const before = screen.getAllByTestId('alert-row').length;
    const row = screen.getAllByTestId('alert-row')[0]!;
    fireEvent.click(within(row).getByRole('button', { name: 'Acknowledge' }));
    expect(screen.getAllByTestId('alert-row')).toHaveLength(before);
    expect(screen.getAllByTestId('alert-row')[0]).toHaveStyle({ opacity: '0.45' });
    expect(screen.getAllByTestId('alert-row')[0]).toHaveTextContent('Acknowledged by John H.');
    expect(within(screen.getAllByTestId('alert-row')[0]!).getByRole('button', { name: 'Acknowledged' })).toBeInTheDocument();
  });

  it('flips Mute to Unmute', () => {
    at();
    const row = screen.getAllByTestId('alert-row')[1]!;
    fireEvent.click(within(row).getByRole('button', { name: 'Mute' }));
    expect(within(screen.getAllByTestId('alert-row')[1]!).getByRole('button', { name: 'Unmute' })).toBeInTheDocument();
  });

  it('resolving also acknowledges', () => {
    at();
    const row = screen.getAllByTestId('alert-row')[3]!;
    fireEvent.click(within(row).getByRole('button', { name: 'Resolve' }));
    const after = screen.getAllByTestId('alert-row')[3]!;
    expect(after).toHaveTextContent('Resolved by John H.');
    expect(within(after).getByRole('button', { name: 'Acknowledged' })).toBeInTheDocument();
  });

  it('never claims all systems operational while a service is unknown', () => {
    at();
    expect(screen.queryByText(/ALL SYSTEMS OPERATIONAL/i)).not.toBeInTheDocument();
  });
});

describe('Overview — quiet', () => {
  it('shows the status strip with its overline and one pill per service', () => {
    at(); toQuiet();
    // amended at G1 — G-13: quiet is no longer all-green and never can be.
    // Zendesk's SSP publishes no per-service status, and M365 Service Health
    // consent is pending, so both are affirmatively `unknown` in BOTH worlds.
    // Per the rule twelve lines above, the overline is not rendered at all when
    // any service is unknown; the strip leads with the affirmed/unknown split.
    expect(screen.queryByText(/ALL SYSTEMS OPERATIONAL/i)).not.toBeInTheDocument();
    expect(screen.getByText(/5 AFFIRMED/i)).toBeInTheDocument();
    expect(screen.getByText(/2 UNKNOWN/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('service-pill')).toHaveLength(7);
  });

  it('links a pill to its service page', () => {
    at(); toQuiet();
    expect(screen.getAllByTestId('service-pill')[0]).toHaveAttribute('href', '/services/m365');
  });

  it('shows the empty state, counting seven services rather than ten', () => {
    at(); toQuiet();
    expect(screen.getByText('No active incidents')).toBeInTheDocument();
    expect(screen.getByText(/Seven monitored services/)).toBeInTheDocument();
  });

  it('shows the recent-history table with its five closed incidents', () => {
    at(); toQuiet();
    expect(screen.getByRole('columnheader', { name: 'Incident' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'INC-2284' })).toBeInTheDocument();
  });

  it('shows no tiles and no alert rows', () => {
    at(); toQuiet();
    expect(screen.queryAllByTestId('service-tile')).toHaveLength(0);
    expect(screen.queryAllByTestId('alert-row')).toHaveLength(0);
  });
});
```

The quiet empty-state copy, which the test pins: `Seven monitored services reporting healthy across vendor status and our own synthetic checks. Last incident closed 2 days ago.`

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run web/src/views/Overview.test.tsx`
Expected: FAIL — the stub renders an empty div, so every query misses.

- [ ] **Step 3: Implement `Overview.tsx`**

One trap, since `Table` indexes rows as `row[column.key]`: the recent-history columns must key off the **fixture's** field names, not the prototype's. `HistoryRow` is `{ id, title, service, duration, closed }`, so the columns are `id`→"Incident", `title`→"Summary", `duration`→"Duration" (right), `closed`→"Closed" (right). The prototype called that third field `dur`; using `dur` here renders four empty cells and no error.

Root element keeps `data-testid="view-overview"` and is a `display: flex; flex-direction: column; gap: 16px` column. Tiles carry `data-testid="service-tile"`, pills `data-testid="service-pill"`, alert rows `data-testid="alert-row"`. The alert summary line under the "Active incidents" heading is built from the incident list, not hard-coded: `${open} open · ${n1} Sev1 · ${n2} Sev2 · ${n3} Sev3`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run web/src/views/Overview.test.tsx`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/views/Overview.tsx web/src/views/Overview.test.tsx
git commit -m "feat(web): Overview view, quiet and Sev1 states"
```

---

### Task 8: Service detail and Incident detail — agent `view-service`

**Files:**
- Modify: `web/src/views/ServiceDetail.tsx`, `web/src/views/IncidentDetail.tsx` (replace the stubs)
- Create: `web/src/views/ServiceDetail.test.tsx`, `web/src/views/IncidentDetail.test.tsx`

**Interfaces:**
- Consumes: `useDemoMode`, `useParams`, `serviceById`, `incidentById`, `Card`, `StatCard`, `Sparkline`, `Panel`, `SectionHeading`, `Table`, `Button`, `statusColor`, `severityLabel`, `timelineColor`.

**Service detail**, per README § 2: two side-by-side cards (`1fr 1fr`, gap 12) — "Vendor status page" and "Our synthetic checks", each an overline label, a 9px status dot beside a 16px/700 state word, then a 12.5px `--text-secondary` note. *Showing both side by side is the point of the page: the vendor's claim and our own probe result are independently sourced and frequently disagree.* Then the response-time card ("Response time · last 24h" 14px/700 plus "p50 {x} · p95 {y}" 12.5px secondary, and the sparkline at `height: 120px`, `viewBox="0 0 100 30"`). Then the stat grid (`repeat(auto-fit, minmax(150px, 1fr))`, gap 12) — Uptime (30d), Checks passing, Incidents (90d), Last state change. Then the "Check history" table (Time, Check, Region, Result, ms).

**Incident detail**, per README § 3: the hero card with `border-left: 3px solid var(--error-main)` and `padding: 18px 20px` — meta row (solid severity chip, radius 6, `padding: 3px 9px`, white 11px/700; monospace incident id; "Opened {HH:MM} · {age} elapsed"), title 21px/700 letter-spacing -0.015em, body 13.5px `--text-secondary` `max-width: 70ch`, then contained "Acknowledge", outlined "Mute service", outlined `color="success"` "Mark resolved", whose labels flip to "Acknowledged by you" / "Unmute service" / "Resolved". Then blast radius (`repeat(auto-fit, minmax(170px, 1fr))`, gap 12; four stat cards at 24px/700 tinted by `BlastMetric.level`). Then the timeline card: rows of `grid-template-columns: 60px 18px 1fr`, `gap: 12px`, `padding-bottom: 16px`; left a monospace 12px time, middle a 9px dot coloured by `timelineColor(kind)` with a 1px `--divider` connector beneath (`flex: 1; min-height: 14px`), right a 13px/700 title over a 12px secondary body. Newest first.

- [ ] **Step 1: Write the failing tests**

`web/src/views/ServiceDetail.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import ServiceDetail from './ServiceDetail.js';

const at = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/services/${id}`]}>
      <ThemeProvider><DemoModeProvider>
        <Routes><Route path="/services/:id" element={<ServiceDetail />} /></Routes>
      </DemoModeProvider></ThemeProvider>
    </MemoryRouter>,
  );

describe('ServiceDetail', () => {
  it('shows the vendor claim and our probe result side by side', () => {
    at('m365');
    expect(screen.getByText('Vendor status page')).toBeInTheDocument();
    expect(screen.getByText('Our synthetic checks')).toBeInTheDocument();
    // amended at G1 — G-13: m365's vendor half is `unknown`, not `degraded`.
    // Our probes are ours and still fail, so only 'Failing' survives. This pair
    // now reads well against the at('zendesk') case below: two services unknown
    // for two different reasons, one with our probes green and one with them red.
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Failing')).toBeInTheDocument();
  });

  it('lets the two halves disagree', () => {
    at('zendesk');
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Passing')).toBeInTheDocument();
  });

  it('explains an unknown vendor level rather than leaving it blank', () => {
    at('zendesk');
    expect(screen.getByText(/absence is not an affirmation/i)).toBeInTheDocument();
  });

  it('renders the response-time chart with p50 and p95', () => {
    at('m365');
    expect(screen.getByText(/p50 .* · p95 /)).toBeInTheDocument();
    expect(screen.getByTestId('response-chart').querySelector('polyline')).toBeInTheDocument();
  });

  it('renders the four stat cards', () => {
    at('m365');
    for (const label of ['Uptime (30d)', 'Checks passing', 'Incidents (90d)', 'Last state change']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('99.21%')).toBeInTheDocument();
    expect(screen.getByText('1 / 4')).toBeInTheDocument();
  });

  it('renders the check history table', () => {
    at('m365');
    for (const h of ['Time', 'Check', 'Region', 'Result', 'ms']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
  });

  it('shows an error panel, not a blank page, for an unknown service id', () => {
    at('nope');
    expect(screen.getByRole('alert')).toHaveTextContent(/not a monitored service/i);
  });
});
```

`web/src/views/IncidentDetail.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import IncidentDetail from './IncidentDetail.js';

const at = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/incidents/${id}`]}>
      <ThemeProvider><DemoModeProvider>
        <Routes><Route path="/incidents/:id" element={<IncidentDetail />} /></Routes>
      </DemoModeProvider></ThemeProvider>
    </MemoryRouter>,
  );

describe('IncidentDetail', () => {
  it('renders the hero with severity, id, title and summary', () => {
    at('INC-2291');
    expect(screen.getByText('SEV 1')).toBeInTheDocument();
    expect(screen.getByText('INC-2291')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Exchange Online mail delivery delays' })).toBeInTheDocument();
    // amended at G1 — G-13: EX1084221 is GONE from the fixtures and a test pins
    // its absence. We cannot read M365's vendor feed, so the advisory id could
    // never legitimately appear on this screen. Assert the absence instead.
    expect(screen.getByText(/no vendor signal|Service Health consent/i)).toBeInTheDocument();
  });

  it('renders four blast-radius metrics tinted by level', () => {
    at('INC-2291');
    expect(screen.getAllByTestId('blast-metric')).toHaveLength(4);
    expect(screen.getByText('384')).toHaveStyle({ color: 'var(--error-main)' });
    expect(screen.getByText('18m 40s')).toHaveStyle({ color: 'var(--warning-main)' });
  });

  it('renders the timeline newest first with kind-coloured dots', () => {
    at('INC-2291');
    const rows = screen.getAllByTestId('timeline-row');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('Queue drain started');
    expect(rows[4]).toHaveTextContent('Incident opened');
    expect(rows[4]!.querySelector('[data-testid="timeline-dot"]')).toHaveStyle({ background: 'var(--text-secondary)' });
  });

  it('flips the three action labels', () => {
    at('INC-2291');
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(screen.getByRole('button', { name: 'Acknowledged by you' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mute service' }));
    expect(screen.getByRole('button', { name: 'Unmute service' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
    expect(screen.getByRole('button', { name: 'Resolved' })).toBeInTheDocument();
  });

  it('shows an error panel for an id that is not open', () => {
    at('INC-9999');
    expect(screen.getByRole('alert')).toHaveTextContent(/no open incident/i);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run web/src/views/ServiceDetail.test.tsx web/src/views/IncidentDetail.test.tsx`
Expected: FAIL — the stubs render empty divs.

- [ ] **Step 3: Implement both views**

Keep `data-testid="view-service"` and `data-testid="view-incident"` on the roots. Add `data-testid` on `response-chart`, `blast-metric`, `timeline-row` and `timeline-dot`. The not-found cases use `Panel` with `kind: 'error'` — messages `"{id} is not a monitored service"` and `"There is no open incident {id}"`. The "Opened {HH:MM} · {age} elapsed" line derives `age` from `openedAt` against the current time; format it as `1h 23m`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run web/src/views/ServiceDetail.test.tsx web/src/views/IncidentDetail.test.tsx`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/views/ServiceDetail.tsx web/src/views/IncidentDetail.tsx web/src/views/ServiceDetail.test.tsx web/src/views/IncidentDetail.test.tsx
git commit -m "feat(web): service detail and incident detail views"
```

---

### Task 9: Entra, Endpoints and Email — agent `view-security`

**Files:**
- Modify: `web/src/views/Entra.tsx`, `Endpoints.tsx`, `Email.tsx` (replace the stubs)
- Create: `web/src/views/Entra.test.tsx`, `Endpoints.test.tsx`, `Email.test.tsx`

**Interfaces:**
- Consumes: `useDemoMode`, `StatCard`, `Table`, `Panel`, `SectionHeading`, `severityLabel`, `severityColor`.

These three pages share one shape — a four-card stat grid over one or two dense tables — which is why one agent owns all three.

**Entra** (README § 4): four stat cards, `repeat(auto-fit, minmax(160px, 1fr))`, value colour carrying severity — Risky sign-ins 24h (`7`, note `3 confirmed compromised`, `--error-main`), Failed sign-ins 24h (`1,204`, note `against 96 accounts`, `--warning-main`), MFA coverage (`94.3%`, note `29 users unregistered`, `--warning-main`), Privileged accounts (`11`, note `4 Global Administrators`, `--text-primary`). Then "Signals · last 24 hours" (Signal, Count right, 24h trend, Severity, Last seen right) and "Directory audit" (Time, Actor, Action, Target right).

**Endpoints** (README § 5): four stat cards each with a `LinearProgress` under the value — Patch compliance (`91.4%`, warning, 91), Agents checked in 7d (`598 / 612`, success, 98), BitLocker encrypted (`576 / 612`, primary, 94), Critical patches missing (`38`, error, 38). Then "Needs attention" (Computer, Assigned to, Issue, Last check-in right).

**Email** (README § 6): four stat cards — Messages processed (`18,402`, note `inbound, last 24h`), Blocked (`3,911`, note `21.3% of inbound`), Quarantined (`147`, note `12 pending review`, `--warning-main`), Credential phishing (`38`, note `+9 vs yesterday`, `--error-main`). Then "Recently blocked" (Time, Sender, Subject, Reason right).

Derive every displayed number from the snapshot rather than hard-coding the string: `94.3%` is `(stats.mfaCoverage * 100).toFixed(1)`, `1,204` is `stats.failedSignIns24h.toLocaleString('en-US')`, `21.3% of inbound` is computed from `blocked24h / processed24h`. Hard-coding them is the failure mode here — it means the page will lie the first time a real adapter lands in Milestone 3.

- [ ] **Step 1: Write the failing tests**

One file per view. `Entra.test.tsx`, with the same `at()` helper shape as Task 7:

```tsx
describe('Entra', () => {
  it('renders four stat cards with severity-tinted values', () => {
    at();
    expect(screen.getByText('Risky sign-ins (24h)')).toBeInTheDocument();
    expect(screen.getByText('7')).toHaveStyle({ color: 'var(--error-main)' });
    expect(screen.getByText('1,204')).toHaveStyle({ color: 'var(--warning-main)' });
  });

  it('derives MFA coverage from the ratio rather than a hard-coded string', () => {
    at();
    expect(screen.getByText('94.3%')).toBeInTheDocument();
  });

  it('renders the signals table with a row per signal and signed deltas', () => {
    at();
    expect(screen.getByRole('columnheader', { name: '24h trend' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '+1,102' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '-2' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '0' })).toBeInTheDocument();
  });

  it('renders the directory audit table with redacted actors', () => {
    at();
    expect(screen.getByRole('columnheader', { name: 'Actor' })).toBeInTheDocument();
    expect(screen.queryByText(/@crexendo\.com/)).not.toBeInTheDocument();
  });
});
```

`Endpoints.test.tsx`:

```tsx
describe('Endpoints', () => {
  it('puts a progress bar under every stat value', () => {
    at();
    expect(screen.getAllByRole('progressbar')).toHaveLength(4);
    expect(screen.getAllByRole('progressbar')[0]).toHaveAttribute('aria-valuenow', '91');
  });

  it('renders the needs-attention table with redacted hostnames', () => {
    at();
    expect(screen.getByRole('cell', { name: 'DEMO-LT-0412' })).toBeInTheDocument();
    expect(screen.queryByText(/CXDO-LT-/)).not.toBeInTheDocument();
  });

  it('keeps the last column present even though os is not shown', () => {
    at();
    expect(screen.getByRole('columnheader', { name: 'Last check-in' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'OS' })).not.toBeInTheDocument();
  });
});
```

`Email.test.tsx`:

```tsx
describe('Email', () => {
  it('computes the blocked percentage from the snapshot', () => {
    at();
    expect(screen.getByText('21.3% of inbound')).toBeInTheDocument();
  });

  it('renders the recently-blocked table with redacted recipients', () => {
    at();
    expect(screen.getByRole('cell', { name: 'Outstanding invoice #88214' })).toBeInTheDocument();
    expect(screen.queryByText(/@crexendo\.com/)).not.toBeInTheDocument();
  });

  it('shows an empty state rather than zeros when there is nothing blocked', () => {
    // render with an email snapshot whose recentBlocked is [] via a local override
    // of the fixture bundle, and assert the Panel empty message, not a zero row.
    at({ recentBlocked: [] });
    expect(screen.getByText(/No messages blocked in the last 24 hours/)).toBeInTheDocument();
  });
});
```

For that last test, give `Email.tsx` an optional prop `snapshot?: EmailSnapshot` that defaults to `useDemoMode().bundle.email`. That is the smallest seam that makes the empty state testable without a second fixture, and it costs the production path nothing.

Note that `Email.test.tsx`'s `at()` therefore differs from the other two in this task: it takes an optional `Partial<EmailSnapshot>`, merges it over the fixture, and passes the result as the `snapshot` prop. `Entra.test.tsx` and `Endpoints.test.tsx` use the plain no-argument helper. Write each helper inline in its own file — no agent owns a shared test util.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run web/src/views/Entra.test.tsx web/src/views/Endpoints.test.tsx web/src/views/Email.test.tsx`
Expected: FAIL — the stubs render empty divs.

- [ ] **Step 3: Implement the three views**

Keep `data-testid="view-entra"`, `"view-endpoints"`, `"view-email"` on the roots.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run web/src/views/Entra.test.tsx web/src/views/Endpoints.test.tsx web/src/views/Email.test.tsx`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/views/Entra.tsx web/src/views/Endpoints.tsx web/src/views/Email.tsx web/src/views/Entra.test.tsx web/src/views/Endpoints.test.tsx web/src/views/Email.test.tsx
git commit -m "feat(web): Entra, Endpoints and Email security views"
```

---

### Task 10: Rules and integrations — agent `view-settings`

**Files:**
- Modify: `web/src/views/Settings.tsx` (replace the stub)
- Create: `web/src/views/Settings.test.tsx`

**Interfaces:**
- Consumes: `useDemoMode`, `Card`, `SectionHeading`, `Switch`.

README § 7: two columns, `repeat(auto-fit, minmax(320px, 1fr))`, gap 16, `align-items: start`. Both lists are rows of `1fr auto`, `padding: 11px 16px`, bottom divider, a 13px/700 name over an 11.5px secondary detail. **Integrations** put a status pill on the right — radius 999, `padding: 3px 9px`, 11px/700, using `--success-lighter`/`--success-dark` for `connected`, `--info-lighter`/`--info-dark` for `polling`, `--warning-lighter`/`--warning-dark` for `needs_auth`, and `--error-lighter`/`--error-dark` for `error`. **Alert rules** put a `Switch` on the right, and the rule's threshold is the secondary line.

Rule toggles are local `useState` in this milestone; Milestone 4 persists them.

- [ ] **Step 1: Write the failing test**

```tsx
describe('Settings', () => {
  it('renders both lists', () => {
    at();
    expect(screen.getByRole('heading', { name: 'Integrations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alert rules' })).toBeInTheDocument();
  });

  it('renders six integrations with their state pills', () => {
    at();
    expect(screen.getAllByTestId('integration-row')).toHaveLength(6);
    expect(screen.getAllByText('Connected')).toHaveLength(4);
    expect(screen.getByText('Polling 60s')).toBeInTheDocument();
    expect(screen.getByText('Needs auth')).toBeInTheDocument();
  });

  it('surfaces the real M365 consent blocker as the needs-auth row', () => {
    at();
    expect(screen.getByText('M365 Service Health')).toBeInTheDocument();
    expect(screen.getByText(/ServiceHealth\.Read\.All/)).toBeInTheDocument();
  });

  it('names the seven verified vendors, not the handoff placeholders', () => {
    at();
    expect(screen.getByText(/Hornetsecurity, Jira, Helpjuice, Claude, OpenAI, Zendesk/)).toBeInTheDocument();
    expect(screen.queryByText(/AWS|Okta|Cloudflare|GitHub/)).not.toBeInTheDocument();
  });

  it('renders six rule switches with the prototype defaults', () => {
    at();
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(6);
    expect(screen.getByRole('switch', { name: /Agent stale/ })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /Vendor degraded/ })).toBeChecked();
  });

  it('toggles a rule', () => {
    at();
    const stale = screen.getByRole('switch', { name: /Agent stale/ });
    fireEvent.click(stale);
    expect(screen.getByRole('switch', { name: /Agent stale/ })).toBeChecked();
  });

  it('shows the threshold as the rule detail line', () => {
    at();
    expect(screen.getByText('More than 500 failures in 15 minutes')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run web/src/views/Settings.test.tsx`
Expected: FAIL — the stub renders an empty div.

- [ ] **Step 3: Implement `Settings.tsx`**

Keep `data-testid="view-settings"` on the root; integration rows carry `data-testid="integration-row"`. Each `Switch` gets `aria-label={rule.name}` so the test can address it by name.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run web/src/views/Settings.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/views/Settings.tsx web/src/views/Settings.test.tsx
git commit -m "feat(web): rules and integrations view"
git tag wave-3
```

Then run review gate **G3** — the four-agents-in-parallel gate, where divergence is the expected finding.

---

### Task 10A: Playwright — visual baselines, interaction and the real offline proof — lead, solo

**Files:**
- Create: `web/playwright.config.ts`
- Create: `web/e2e/fidelity.spec.ts`, `web/e2e/interaction.spec.ts`, `web/e2e/security.spec.ts`
- Create: `web/e2e/fidelity.spec.ts-snapshots/**` (28 committed PNG baselines)
- Modify: root `package.json` (add `test:e2e`)

**Interfaces:**
- Consumes: the built app, served by Playwright's `webServer`.
- Produces: committed baselines, so the fidelity pass becomes a diff instead of a memory. This is what makes the README's measurements survive Milestones 2-4.

Three things live here that a jsdom test cannot do. **Real layout** — jsdom has no layout engine, so it cannot tell you the sidebar is 232px or that a table's last column is still visible at 1000px. **Real network** — jsdom's `fetch` spy proves our code does not call `fetch`; only a real browser proves the *page* makes no third-party request, including the ones we never wrote, like a stylesheet `@import` or a font. **Real colour** — computed contrast in dark mode needs a rendering engine.

- [ ] **Step 1: Configure Playwright**

`web/playwright.config.ts`. Serve the **production build**, not the dev server — the dev server injects its own client and websocket, which would make the third-party-request assertion meaningless:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  // amended at G3 — G-16. This read 127.0.0.1 and nothing would have started:
  // `vite preview` binds localhost, which resolves to ::1 here, so 127.0.0.1 is
  // refused outright (verified: localhost -> 200, 127.0.0.1 -> connection
  // refused). Playwright's webServer health check would time out before a single
  // test ran. Keep both this and `url` below on localhost; the offline assertion
  // further down already allows either hostname, so nothing is weakened.
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  // Pixel-diff tolerance: tight enough to catch a spacing or colour regression,
  // loose enough to survive font antialiasing across machines.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'narrow-1000',  use: { ...devices['Desktop Chrome'], viewport: { width: 1000, height: 900 } } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',   // amended at G3 — G-16, see above
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

Add to the root `package.json` scripts: `"test:e2e": "playwright test --config web/playwright.config.ts"`.

Run: `npx playwright install chromium`
Expected: Chromium downloaded. This is a one-time local install, not a repo dependency.

- [ ] **Step 2: Write the fidelity spec**

`web/e2e/fidelity.spec.ts` — 7 routes × 2 themes, run under both viewport projects, giving 28 baselines:

```ts
import { test, expect, type Page } from '@playwright/test';

const ROUTES = [
  ['overview',  '/'],
  ['service',   '/services/m365'],
  ['incident',  '/incidents/INC-2291'],
  ['entra',     '/entra'],
  ['endpoints', '/endpoints'],
  ['email',     '/email'],
  ['settings',  '/settings'],
] as const;

async function settle(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => localStorage.setItem('ops-dash.theme', t), theme);
  // The clock and the refresh countdown change every second and would make every
  // screenshot a false diff. Freeze them, and only them.
  await page.addInitScript(() => {
    const fixed = new Date('2026-09-18T09:41:02Z').getTime();
    const RealDate = Date;
    // @ts-expect-error deliberate test-only override
    globalThis.Date = class extends RealDate {
      constructor(...a: unknown[]) { super(...(a.length ? a : [fixed]) as []); }
      static now() { return fixed; }
    };
  });
}

for (const [name, path] of ROUTES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${name} · ${theme}`, async ({ page }) => {
      await settle(page, theme);
      await page.goto(path);
      await expect(page.getByRole('navigation')).toBeVisible();
      await expect(page).toHaveScreenshot(`${name}-${theme}.png`, { fullPage: true });
    });
  }
}

test('sidebar is exactly 232px and does not shrink', async ({ page }) => {
  await page.goto('/');
  const box = await page.getByTestId('sidebar').boundingBox();
  expect(box?.width).toBe(232);
});

test('every table keeps its last column reachable at 1000px', async ({ page }) => {
  for (const [, path] of ROUTES) {
    await page.goto(path);
    for (const table of await page.locator('table').all()) {
      const wrapper = table.locator('xpath=..');
      const [clientW, scrollW] = await wrapper.evaluate((el) => [el.clientWidth, el.scrollWidth]);
      // Either it fits, or the wrapper scrolls. What it must never do is clip.
      if (scrollW > clientW) {
        await expect(wrapper).toHaveCSS('overflow', /auto|scroll/);
      }
    }
  }
});

test('the only animation is the refresh dot', async ({ page }) => {
  await page.goto('/');
  const animated = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((el) => {
        const a = getComputedStyle(el).animationName;
        return a && a !== 'none';
      })
      .map((el) => getComputedStyle(el).animationName),
  );
  expect(new Set(animated)).toEqual(new Set(['pulseDot']));
});

test('dark mode has no unreadable text pair', async ({ page }) => {
  await settle(page, 'dark');
  const failures: string[] = [];
  for (const [, path] of ROUTES) {
    await page.goto(path);
    failures.push(...await page.evaluate(() => {
      const lum = (c: string) => {
        const [r, g, b] = c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const bgOf = (el: Element): string => {
        for (let n: Element | null = el; n; n = n.parentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg && !/rgba?\((?:0, 0, 0, 0|0,0,0,0)\)/.test(bg)) return bg;
        }
        return 'rgb(255,255,255)';
      };
      const bad: string[] = [];
      for (const el of document.querySelectorAll('*')) {
        const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent?.trim()).join('');
        if (!text) continue;
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        const l1 = lum(cs.color), l2 = lum(bgOf(el));
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        // WCAG AA: 3:1 for large text (>=18.66px bold or >=24px), 4.5:1 otherwise.
        const threshold = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700) ? 3 : 4.5;
        if (ratio < threshold) bad.push(`${location.pathname} "${text.slice(0, 30)}" ${ratio.toFixed(2)}:1 @${size}px`);
      }
      return bad;
    }));
  }
  expect(failures).toEqual([]);
});
```

- [ ] **Step 3: Write the interaction spec**

`web/e2e/interaction.spec.ts` — the flows that only mean anything in a real browser:

```ts
import { test, expect } from '@playwright/test';

test('sidebar navigates and marks the active item', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Entra security/ }).click();
  await expect(page).toHaveURL(/\/entra$/);
  await expect(page.getByRole('link', { name: /Entra security/ })).toHaveAttribute('aria-current', 'page');
});

test('a service tile opens its service page', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('service-tile').first().click();
  await expect(page).toHaveURL(/\/services\/m365$/);
});

test('theme choice survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /dark theme/i }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('acknowledging dims the row and keeps it in place', async ({ page }) => {
  await page.goto('/');
  const rows = page.getByTestId('alert-row');
  const before = await rows.count();
  await rows.first().getByRole('button', { name: 'Acknowledge' }).click();
  await expect(rows).toHaveCount(before);
  await expect(rows.first()).toHaveCSS('opacity', '0.45');
  await expect(rows.first()).toContainText('Acknowledged by John H.');
});

test('the refresh countdown actually counts down', async ({ page }) => {
  await page.goto('/');
  const pill = page.getByText(/Auto-refresh · \d+s/);
  const first = await pill.textContent();
  await expect(pill).not.toHaveText(first!, { timeout: 3000 });
});

test('the app renders with JavaScript-driven fonts loaded, not fallbacks', async ({ page }) => {
  await page.goto('/');
  const loaded = await page.evaluate(() => document.fonts.check('700 13.5px "Plus Jakarta Sans"'));
  expect(loaded).toBe(true);
});
```

- [ ] **Step 4: Write the security spec**

`web/e2e/security.spec.ts`. The first test is the one that actually proves the self-hosting claim:

```ts
import { test, expect } from '@playwright/test';

const ROUTES = ['/', '/services/m365', '/incidents/INC-2291', '/entra', '/endpoints', '/email', '/settings'];

test('no request leaves our origin, on any route', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol !== 'data:') {
      foreign.push(`${r.resourceType()} ${r.url()}`);
    }
  });
  for (const path of ROUTES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(foreign).toEqual([]);
});

test('no request fails — nothing is silently missing', async ({ page }) => {
  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  for (const path of ROUTES) { await page.goto(path); await page.waitForLoadState('networkidle'); }
  expect(failed).toEqual([]);
});

test('the console is clean', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const path of ROUTES) { await page.goto(path); await page.waitForLoadState('networkidle'); }
  expect(errors).toEqual([]);
});

test('a hostile route param is rendered as text, never as markup', async ({ page }) => {
  let alerted = false;
  page.on('dialog', async (d) => { alerted = true; await d.dismiss(); });
  const payload = '<img src=x onerror="window.__x=1">';
  await page.goto(`/services/${encodeURIComponent(payload)}`);
  await expect(page.getByRole('alert')).toContainText('not a monitored service');
  expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(alerted).toBe(false);
});

test('a poisoned theme preference cannot inject anything', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ops-dash.theme', '"><script>window.__y=1</script>'));
  await page.goto('/');
  await expect(page.getByRole('navigation')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __y?: number }).__y)).toBeUndefined();
  // an unrecognised value falls back to a valid theme rather than being applied
  await expect(page.locator('html')).not.toHaveClass(/script/);
});

test('every link is same-origin or an https vendor link with rel protection', async ({ page }) => {
  for (const path of ROUTES) {
    await page.goto(path);
    for (const a of await page.locator('a[href]').all()) {
      const href = await a.getAttribute('href');
      expect(href).not.toMatch(/^\s*(javascript|data|vbscript):/i);
      if (href?.startsWith('http')) {
        expect(href).toMatch(/^https:/);
        expect(await a.getAttribute('rel')).toMatch(/noopener/);
      }
    }
  }
});

test('the content security policy is present and blocks an off-box fetch', async ({ page }) => {
  await page.goto('/');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'none'");
  const blocked = await page.evaluate(async () => {
    try { await fetch('https://fonts.googleapis.com/css2?family=X'); return false; } catch { return true; }
  });
  expect(blocked).toBe(true);
});
```

That last test requires the CSP meta tag added in Task 11A. Write the test now and let it fail; it goes green in Task 11A.

- [ ] **Step 5: Generate and eyeball the baselines**

Run: `npm run test:e2e -- --update-snapshots`
Expected: 28 PNGs written under `web/e2e/fidelity.spec.ts-snapshots/`.

**Open every one of them** and compare against `design_handoff_it_ops_dashboard/IT Ops Dashboard.dc.html` in a browser. A baseline is only worth what the first look at it is worth — committing a wrong baseline locks in the wrong design and every future run will agree with it. Check the measurements from README § "Screens / views": card radius 12, tile and alert-row radius 10, nav radius 8, page padding `20px 24px 40px`, the type scale, tabular numerals on every figure.

- [ ] **Step 6: Run clean and commit**

Run: `npm run test:e2e`
Expected: PASS except the CSP test, which fails until Task 11A. Note the count.

```bash
git add web/playwright.config.ts web/e2e package.json
git commit -m "test(web): Playwright fidelity baselines, interaction and security specs"
```

---

## Wave 4 — lead, solo

### Task 11: Wiring, fidelity pass and the offline proof

**Files:**
- Modify: whatever the checks below turn up. Expect `web/src/app/Sidebar.tsx` (badge counts against the real incident list) and one or two views.
- Create: `web/src/app/offline.test.tsx`

**Interfaces:**
- Consumes: everything.
- Produces: a green tree. This task's deliverable is evidence, not features.

- [ ] **Step 1: Write the offline guard test**

`web/src/app/offline.test.tsx` — this is the test that keeps Milestone 1's central promise from eroding while Milestones 2-4 are built:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from './DemoModeProvider.js';
import { App } from './App.js';

describe('the scaffold is offline', () => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error('network is disabled in Milestone 1')));

  beforeEach(() => { vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each(['/', '/services/m365', '/incidents/INC-2291', '/entra', '/endpoints', '/email', '/settings'])(
    'renders %s without touching the network',
    (path) => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <ThemeProvider><DemoModeProvider><App /></DemoModeProvider></ThemeProvider>
        </MemoryRouter>,
      );
      expect(screen.getByRole('navigation')).toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
});
```

- [ ] **Step 2: Run the whole suite**

Run: `npm test`
Expected: PASS. Roughly 100 tests across `shared` and `web`, zero failures, zero skipped.

Run: `npm run typecheck`
Expected: exits 0.

Run: `npm run build`
Expected: exits 0; `web/dist/` written.

- [ ] **Step 3: Confirm the guards still hold**

The static invariants are Vitest tests as of Task 3A, so `npm test` in Step 2 already ran them — there is nothing to grep by hand here. What this step checks is that they are **still nine and still meaningful**, rather than having been weakened to make something pass:

Run: `npx vitest run web/src/guards.test.ts --reporter=verbose`
Expected: PASS, 9 tests, and the fixture guards are now biting on real fixture content rather than passing vacuously as they did in Wave 0.

Run: `git log -p --follow -- web/src/guards.test.ts | grep -E "^\+.*(skip|todo|\.only)" || echo "CLEAN"`
Expected: `CLEAN`. No guard was skipped or narrowed along the way.

- [ ] **Step 4: Fidelity pass — automated first, then human**

Run: `npm run test:e2e`
Expected: PASS on everything except the CSP test, which stays red until Task 11A. The 28 baselines match, the sidebar measures 232px, no table clips at 1000px, dark mode clears its contrast thresholds, and no request leaves the origin.

That is the repeatable part. Now do the part a machine cannot: open the app and **look at it**, at **1440 × 900** and again at **1000 × 900**, on each of the seven routes, in both themes, against `design_handoff_it_ops_dashboard/README.md` § "Screens / views":

- Sidebar is exactly 232px and does not shrink.
- Cards are `1px solid var(--divider)` on `var(--background-paper)`; radius 12 on cards, 10 on tiles and alert rows, 8 on nav items and the header pill, 999 on pills and the segmented control.
- Type sizes match the list in the tokens section; overlines are 10.5px/700 at `letter-spacing: 0.08em`, uppercase.
- Numeric displays use `font-variant-numeric: tabular-nums` — latency, counts, the clock, every stat value.
- Page padding is `20px 24px 40px`; content-well gap is 16.
- At 1000px every table's **last column is still visible** (the component scrolls horizontally rather than clipping).
- Dark mode has no unreadable pair; spot-check body text and secondary text against their backgrounds for at least 4.5:1.
- The only motion is the pulsing refresh dot and Aurora's own transitions.

Compare side by side with the prototype: open `design_handoff_it_ops_dashboard/IT Ops Dashboard.dc.html` in a second tab. Sev1 mode must reproduce its Sev1 screen and Quiet must reproduce its quiet screen, allowing for the three deliberate reconciliations (seven services not ten, redacted fixture values, the M365 consent row in place of ServiceDesk Plus).

Then tick "Offline" in devtools and hard-reload — the app must still render completely.

Fix whatever the pass turns up, in the owning file. Re-run `npm test` after each fix, and if a fix changes pixels, re-run `npm run test:e2e -- --update-snapshots` and **look at the regenerated baselines** before committing them. A baseline updated without being looked at is worse than no baseline, because it converts a caught regression into an accepted one.

- [ ] **Step 5: Verify nav badge counts come from the data**

The sidebar's Overview badge is `bundle.incidents.length` and its Incident badge is the count of open Sev1s. Switch the demo toggle to Quiet: both badges must disappear, not render `0`. Switch back: `4` and `1`.

Run: `npx vitest run web/src/app/shell.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: offline guard; fix fidelity findings from the 1440/1000px pass"
```

---

### Task 11A: Security review and hardening — lead, solo

**Files:**
- Modify: `web/index.html` (CSP, keyframes moved out)
- Create: `web/public/app.css`
- Modify: `web/scripts/extract-icons.mjs` (pin the bundle)
- Create: `web/src/lib/safeUrl.ts`, `web/src/lib/safeUrl.test.ts`
- Create: `docs/superpowers/security/2026-09-18-m1-review.md`

This is a review of **this** application's surface. A generic web checklist would pass trivially and tell you nothing, because in Milestone 1 there is no server, no authentication, no user input, no database and no network. What there is instead is one HTML sink, one `eval`, two reflected route params, a browser-storage read, and a data model whose whole purpose is to render content that hostile strangers wrote. Those are the five things worth an hour.

#### Threat model

**Deployment, stated plainly, because it sets everything below.** Confirmed by John 2026-09-19: **ops-dash runs on his local machine only.** It is not served to the network, not on the corp VLAN, not on the audit dashboard server, and not reachable by anyone else until he decides to release it. The spec's "deployment target is the existing audit dashboard server" is the *eventual* target, not a current fact.

That strikes the adversary who would otherwise dominate this review. There is no unauthenticated reader, because there is no reader but John. The deferred-sign-in risk in the spec is real but **not yet live** — it becomes live the day the app is served to anything, and not before. Nothing in this plan should be justified by a confidentiality argument that a local-only app does not have.

So this review does not discuss who can read the page. It discusses the two things that are true regardless of who can read it.

**1. The data we render is authored by strangers, from Milestone 2 onward.** Seven upstream feeds and four product APIs return strings we display. A Statuspage incident title, a Graph advisory body, a Proofpoint mail **subject** and **sender address** — every one is written by someone outside this company, and in the mail case by someone actively hostile who chose that text on purpose. The Email security page's entire job is to display attacker-authored content. That is the point of the page, not a flaw in it, but it means the page's escaping is a security control rather than a formatting detail. A local-only app running in John's browser is still a browser: a `javascript:` URL from a vendor feed executes in it just the same.

**2. The build chain runs code from a file we did not write.** `web/scripts/extract-icons.mjs` runs `eval()` over a 2.1MB vendored JavaScript bundle and writes the result into a module that every page renders through `dangerouslySetInnerHTML`. If that file is ever swapped or corrupted, it is arbitrary code at build time on John's machine *and* arbitrary markup on every page. It is vendored, committed and diffable today, which is most of the defence — but "most" is not a pin, and this one costs one line.

Explicitly **out of scope** for Milestone 1: authentication, transport security, authorization, rate limiting, CSRF, and every server-side injection class. Not deferred out of optimism — there is no server, no mutation, no database, and no user input beyond a URL typed by the only user. **They all reopen at release**, which is the one thing worth writing down here: see "Reopens at release" at the end of this task.

One thing survives the change of premise for a different reason. **Fixtures still stay redacted** — not because the page is exposed, but because the repo has a remote (`github.com/jczechowski-CXDO/ops-dash`) and fixtures get committed and pushed. Real UPNs and hostnames in a committed fixture leave the machine even when the app never does. The Task 3A redaction guards stand on that, and only that.

#### The five surfaces, and what closes each

**S1 — The single HTML sink.** `Icon.tsx` uses `dangerouslySetInnerHTML`. It is safe only because of three properties that must all hold: the content is generated at build time from a vendored file, never at runtime; `IconName` is a closed union, so no runtime string can select a glyph; and the generated bodies are `<path>` geometry only. The third is asserted by the Task 3A geometry guard, which rejects `<script>`, any `on*=` handler, `javascript:`, `xlink:href`, `<image>`, `<foreignObject>` and `url(`. The first two are asserted by the "only Icon.tsx" guard plus TypeScript.

- [ ] **Verify** no call site passes a non-literal to `name`:
  Run: `grep -rn "<Icon" web/src --include=*.tsx | grep -v 'name="'`
  Expected: no output. Every icon name is a string literal, so the union is actually enforced rather than merely declared.

**S2 — Reflected route parameters.** `/services/:id` and `/incidents/:id` take an arbitrary string from the URL, and this plan's own error copy interpolates it back into the page: `"{id} is not a monitored service"`. React escapes text children, so this is safe — but it is safe *by default*, which means one future `dangerouslySetInnerHTML` or one `href={id}` turns it into stored-free reflected XSS. The Playwright test in Task 10A fires `<img src=x onerror=…>` through both routes and asserts nothing executes. Keep that test.

**S3 — Browser storage.** `ops-dash.theme` is read on boot and drives a class name. Validate it against the union — never apply the stored string directly — so a poisoned value falls back rather than propagating. Already specified in `ThemeProvider.initial()`; the Task 10A test proves it.

- [ ] **Confirm** the read is validated and not passed through:
  Run: `grep -n "localStorage.getItem" web/src/theme/ThemeProvider.tsx`
  Expected: the result is compared against `'light'`/`'dark'` before use.

**S4 — Untrusted content rendered as data.** This is the one that matters for Milestones 2-4, and the rules are cheapest to set now, before any of it is live.

- Mail **subjects** and **sender addresses** render as **text only**. Never as a link, never as `title`, never into `dangerouslySetInnerHTML`. A subject line is attacker-chosen by definition.
- Vendor advisory **notes** and incident **titles** render as text only.
- `VendorIncident.url` and `ServiceStatus.vendor.url` are the only fields that ever become an `href`, and they are **vendor-supplied**. A `javascript:` URL in an `href` executes on click. They must pass a scheme check.

Write the check now, in Milestone 1, so Milestone 2 has no excuse:

```ts
// web/src/lib/safeUrl.ts
/**
 * Vendor-supplied URLs (ServiceStatus.vendor.url, VendorIncident.url) are the only
 * externally-authored values that ever become an href. Anything but https is
 * dropped rather than sanitised — we have no use for a vendor link that is not https,
 * and "sanitise" is how these bugs come back.
 */
export function safeUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return undefined; }
  return parsed.protocol === 'https:' ? parsed.toString() : undefined;
}
```

```ts
// web/src/lib/safeUrl.test.ts
import { describe, it, expect } from 'vitest';
import { safeUrl } from './safeUrl.js';

describe('safeUrl', () => {
  it('passes an https vendor link through', () => {
    expect(safeUrl('https://status.claude.com/incidents/abc')).toBe('https://status.claude.com/incidents/abc');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'http://status.claude.com/x',
    'file:///C:/secure/.epc/config.json',
    'not a url',
    '',
  ])('drops %s', (bad) => {
    expect(safeUrl(bad)).toBeUndefined();
  });

  it('drops undefined without throwing', () => {
    expect(safeUrl(undefined)).toBeUndefined();
  });
});
```

Any anchor rendering a vendor URL also carries `target="_blank" rel="noopener noreferrer"`. The Task 10A link test enforces both across every route.

Run: `npx vitest run web/src/lib/safeUrl.test.ts`
Expected: PASS, 11 tests.

**S5 — Build-chain integrity.** Pin the bundle the icons come from, so a swap fails loudly instead of shipping.

- [ ] Record the hash and assert it in the extractor:

  Run: `node -e "const{createHash}=require('node:crypto');const{readFileSync}=require('node:fs');console.log(createHash('sha256').update(readFileSync('design_handoff_it_ops_dashboard/aurora/_ds_bundle.js')).digest('hex'))"`

  Add the printed value to `extract-icons.mjs` as a constant and fail the build on mismatch:

```js
import { createHash } from 'node:crypto';

// Pinned 2026-09-18. The extractor evals this file and its output is rendered via
// dangerouslySetInnerHTML on every page, so a silent swap is a code-execution path.
// If this fails: the bundle changed. Diff it, understand why, then update the pin.
const BUNDLE_SHA256 = '<paste the value>';

const raw = readFileSync(BUNDLE, 'utf8');
const actual = createHash('sha256').update(raw).digest('hex');
if (actual !== BUNDLE_SHA256) {
  throw new Error(`Aurora bundle hash mismatch\n  expected ${BUNDLE_SHA256}\n  actual   ${actual}`);
}
```

  Run: `npm run icons --workspace @ops-dash/web`
  Expected: `wrote src/components/aurora/icons.generated.ts (11 glyphs)` — and the regenerated file is byte-identical to the committed one (`git diff --stat` shows nothing).

  Then break it: append a newline to a scratch copy, point `BUNDLE` at it, and confirm the build throws with the mismatch message. Revert.

#### Hardening changes

- [ ] **Add a Content Security Policy.** Its value here is not confidentiality — it is that it makes the **zero-external-dependency rule** enforceable by the browser rather than by everyone remembering it. Self-hosting is a standing requirement of this project, and today it is held up by a grep and good intentions; with a CSP, the day someone re-adds a Google Fonts `@import` or a CDN script tag, the browser refuses it and a test goes red. That value is identical whether the app is local-only or deployed. In `web/index.html`:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">
```

  Two things to know rather than discover. **`style-src 'self'` with no `'unsafe-inline'` works here** only because React applies `style={{…}}` through CSSOM, which CSP does not govern — but a literal `<style>` block in the HTML *is* governed. So move the prototype's keyframes out of the inline `<style>` into a real file, `web/public/app.css`, linked alongside the Aurora sheet:

```css
/* ops-dash's own styles. Everything else is Aurora tokens. */
@keyframes pulseDot { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
```

  And **`frame-ancestors` is ignored in a `<meta>` CSP** — it only works as an HTTP header, so do not assume the meta tag covers framing. It is moot while the app is local-only; it lands on the "Reopens at release" list rather than here.

  Run: `npm run test:e2e -- security`
  Expected: PASS — including the CSP test that was failing at the end of Task 10A.

- [ ] **Confirm the production build leaks nothing.**

  Run: `npm run build && ls web/dist/assets/*.map 2>/dev/null || echo "NO SOURCEMAPS"`
  Expected: `NO SOURCEMAPS` (Vite omits them in production by default; if one appears, set `build.sourcemap: false` explicitly).

  Run: `grep -rniE "crexendo\.com|CXDO-(LT|DT)-|C:\\\\secure|203\.0\.113" web/dist || echo "CLEAN"`
  Expected: only `203.0.113.x` from the redacted fixture, which is the documentation range and is intended. No real identifier, no credential path.

- [ ] **Confirm dependency integrity.**

  Run: `npm audit --omit=dev`
  Expected: 0 vulnerabilities. Runtime is `react`, `react-dom`, `react-router` and nothing else, so this should be trivially clean; if it is not, that is worth knowing before Milestone 2 adds a server.

  Run: `git status --porcelain package-lock.json`
  Expected: empty — the lockfile is committed. Deploys use `npm ci`, never `npm install`.

#### The review itself

- [ ] **Dispatch a reviewer** over the whole milestone diff, at high effort, with the threat model above as its brief:

```
Security-review the full Milestone 1 diff (git diff <first-commit>..HEAD) for ops-dash,
a React SPA that currently runs ONLY on the developer's local machine — not served to
any network, not deployed, single user. Do not raise findings that depend on a remote
reader, network exposure, authentication or transport; those are out of scope by fact,
not by omission, and raising them is noise.

What IS in scope: this app renders data authored by third parties (vendor status feeds,
and from Milestone 2 real mail subjects and sender addresses chosen by attackers), and
its build step evals a vendored 2.1MB bundle whose output is injected via
dangerouslySetInnerHTML.

Review by logical block, not file by file. The threat model and the five surfaces are
in docs/superpowers/plans/2026-09-18-ops-dash-m1-scaffold.md, Task 11A — read it first
and review against it, not against a generic checklist.

Report only real, exploitable or plausibly-exploitable findings, each with the concrete
path from input to impact. Specifically hunt for:
  - any second HTML sink, any dynamic icon name, any innerHTML reachable from data
  - any externally-authored string reaching an href, src, style string or event handler
  - any route param, localStorage value or fixture string used unescaped
  - any real identifier, hostname, UPN, IP or credential path that survived redaction
    (these get committed and pushed to a remote, which is the exposure that exists)
  - any place a zero or a green state could be rendered from missing data
Say so plainly if a surface is genuinely closed. Do not pad the report.
```

- [ ] **Write up the result** in `docs/superpowers/security/2026-09-18-m1-review.md`: the local-only premise and the date it was stated, the five surfaces and their controls, the findings with their dispositions, and the "Reopens at release" list below.

#### Reopens at release

This is the section that earns the write-up. Everything above is scoped to a local-only app, and that scope is a **fact with an expiry date** — the day ops-dash is served to anything beyond localhost, the review below is out of date and the items here become live. Nothing on this list is a Milestone 1 task; all of it is a gate on release.

| Item | Why it reopens |
|---|---|
| **Authentication** | The spec's deferred sign-in stops being theoretical the moment a second person can load the page. The auth seam goes into the API in Milestone 2 precisely so this is a configuration change and not a rewrite. |
| **What the page discloses** | Served anywhere, this page shows MFA gaps, the Global Admin count, named unpatched and unencrypted machines, and which accounts are under a sign-in spike. That is worth a deliberate decision about audience, once there is an audience. |
| **Transport** | TLS. No server exists yet; when one does, plaintext is a choice rather than a default. |
| **Response headers** | `frame-ancestors` (a `<meta>` CSP cannot set it), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, HSTS. All belong on whatever serves the app. |
| **Server-side classes** | Authorization, rate limiting, CSRF on the ack/mute/resolve writes, and injection on anything that reaches SQLite. None exist in Milestone 1; all arrive with the server. |
| **The precedent** | `wiki/ops/EPC-Audit-Dashboard-Deploy.md` shipped its v1 as "port 8501, plaintext, network restriction only" with TLS, SSO and a low-privilege service account as fast-follows that were **never confirmed done**. If ops-dash is ever deployed to that same box, it inherits that posture by default. Worth knowing before, not after. |

Re-run this task at release. Until then, none of it applies.

- [ ] **Commit**

```bash
git add web/index.html web/public/app.css web/scripts/extract-icons.mjs web/src/lib docs/superpowers/security
git commit -m "security: CSP, bundle pin, vendor-URL scheme check, M1 review write-up"
```

---

### Task 12: CLAUDE.md and the milestone close

**Files:**
- Create: `CLAUDE.md`
- Modify: `docs/RESUME.md`

This was John's original `/init` request. It was correctly deferred until the repo had real commands to document; it now does.

- [ ] **Step 1: Write `CLAUDE.md`**

Keep it short and factual — commands, layout, and the handful of rules that are not derivable from the code:

```markdown
# ops-dash

Internal IT operations dashboard for a ~512-user / ~612-endpoint Microsoft-centric
environment. Node API + Vite SPA, one repo, npm workspaces, TypeScript both sides,
self-hosted. Read-only upstream; the only writes are to our own store.

## Commands

| Command | What it does |
|---|---|
| `npm install` | install all workspaces |
| `npm run dev` | Vite dev server on :5173 |
| `npm run build` | production build to `web/dist` |
| `npm test` | Vitest, all workspaces |
| `npm run typecheck` | `tsc -b shared web` |
| `npm run icons` | regenerate `web/src/components/aurora/icons.generated.ts` from the Aurora bundle |
| `npm run fonts` | re-vendor Plus Jakarta Sans (only needed if the font is replaced) |

## Layout

- `shared/src/contracts.ts` — the view-model contract. **Frozen.**
- `web/` — the SPA. `app/` shell and routing, `views/` the seven pages, `components/`
  the eight Aurora primitives plus five dashboard components, `fixtures/` the offline data,
  `theme/` the token helpers.
- `design_handoff_it_ops_dashboard/` — the design spec of record. Read-only.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — the approved design and the
  per-milestone plans.

## Rules that are not obvious from the code

- **`shared/src/contracts.ts` is frozen.** Amend `design_handoff_it_ops_dashboard/DATA_CONTRACTS.md`
  first, with John's approval, then the contract, then the consumers. Never work around it.
- **No runtime external dependencies.** Fonts, icons and tokens are vendored and served off
  our box. Adding an npm package needs a reason, in writing, in the PR.
- **No literal hex colours in `web/src/`** — every colour is a `var(--*)` token so dark mode
  needs no second palette.
- **Fixtures are permanently redacted.** No real UPNs, hostnames, IPs or mail subjects, ever —
  fixtures are committed and pushed, so they leave the machine even though the app does not.
- **A failed fetch must never render as green.** `unknown` is neutral grey, it never counts
  toward "ALL SYSTEMS OPERATIONAL", and it never satisfies the vendor half of the Sev1 rule.
- **Everything upstream is read-only.** No mutating third-party call belongs in this repo.
- **Runs locally only.** ops-dash is not deployed and not served to any network. Deployment is
  John's call, and it is the trigger for the deferred sign-in seam and everything else on the
  "Reopens at release" list in
  `docs/superpowers/plans/2026-09-18-ops-dash-m1-scaffold.md`, Task 11A.

## Current state

Milestone 1 (offline scaffold) is complete. Milestones 2-4 — the headline correlation rule,
the remaining adapters, and live wiring — each get their own plan under `docs/superpowers/plans/`.
```

- [ ] **Step 2: Update `docs/RESUME.md`**

Rewrite the "Repo state" and "Next steps" sections: Milestone 1 is built and committed, `CLAUDE.md` exists, and the next step is the Milestone 2 plan (`vendorstatus` + `synthetic` + poller + SQLite + correlation). Leave "Decided (don't relitigate)", "Answered by John" and "Facts worth not re-deriving" as they are, and add to the last of those: the icon extraction recipe (the glyph table is on the bundle line beginning `let __ds_default_components_foundation_icon_data_hdnrqo;`, 885 entries, keys are `PascalNameWeightRegular`, all eleven at `viewBox="0 0 48 48"`) and the font vendoring recipe (Google's `css2` endpoint needs a desktop UA or it serves ttf; latin + latin-ext, both styles, four variable woff2 files).

- [ ] **Step 3: Final verification before claiming done**

Run: `npm test`
Expected: PASS, zero failures.

Run: `npm run typecheck && npm run build`
Expected: both exit 0.

Run: `git status --porcelain`
Expected: empty.

Do not report Milestone 1 complete until all three of those have actually been run and their real output seen.

- [ ] **Step 4: Commit and push**

```bash
git add CLAUDE.md docs/RESUME.md
git commit -m "docs: CLAUDE.md and Milestone 1 resume state"
git push -u origin main
```

The remote `github.com/jczechowski-CXDO/ops-dash` is still empty; this is the first push. Confirm with John before pushing if anything in the tree has changed since he last looked.

---

## Definition of done for Milestone 1

Straight from the spec and `AGENTS.md`, phase 0:

- [ ] The app runs with the network disabled and all seven routes render.
- [ ] Sev1 fixtures reproduce the prototype's Sev1 screen; quiet fixtures reproduce its quiet screen.
- [ ] `shared/src/contracts.ts` carries every type in the amended `DATA_CONTRACTS.md` and is frozen.
- [ ] Light and dark both work off the single `dark` class; no second palette was written.
- [ ] Every panel has a loading skeleton and an error/stale state, none of which renders a zero that could be mistaken for a measurement.
- [ ] Nothing in `web/` reaches a third-party host at runtime — fonts, icons and tokens are all local.
- [ ] No literal hex in `web/src/`, no credential anywhere, no `fetch`.
- [ ] `npm test`, `npm run typecheck` and `npm run build` all exit 0.

Added 2026-09-19, on John's instruction that everything in git is under test where practical and fully reviewed:

- [ ] The nine repository guards pass as tests, not as greps, and each has been **observed failing** when deliberately broken.
- [ ] 28 Playwright baselines are committed and were **looked at** before they were committed.
- [ ] A real browser makes **zero requests off our origin** across all seven routes, no request fails, and the console is clean.
- [ ] Dark mode clears WCAG AA contrast on every route, measured rather than eyeballed.
- [ ] All five review gates G0-G4 are closed — findings fixed, or accepted in writing.
- [ ] The security review is written up at `docs/superpowers/security/2026-09-18-m1-review.md`, the CSP is enforced, the Aurora bundle is hash-pinned, and `safeUrl` exists and is tested before any vendor URL can reach an `href`.
- [ ] `npm run test:e2e` exits 0.

---

## Self-review

Run against the spec after the plan is written; recorded here so the executor can see what was already checked.

**Spec coverage.** Every Milestone-1 bullet in the spec maps to a task: workspaces → Task 1; `shared/contracts.ts` amended then frozen → Task 2; self-hosted tokens, fonts and icons → Task 3; the 8 primitives → Tasks 3 (Icon) and 4 (the other seven); 7 routes → Task 6; all views from prototype-derived fixtures → Tasks 5 and 7-10; offline with no network code → Global Constraints plus the Task 11 offline test; reproduces the prototype's quiet and Sev1 states → Tasks 7 and 11. The spec's "write `CLAUDE.md` once the scaffold exists" → Task 12. The four contract amendments are each pinned by a test: amendment 1 in `statusColor.test.ts` and the Overview "never claims all systems operational" test; amendment 2 in `contracts.test.ts`; amendment 3 in `fixtures.test.ts`; amendment 4 in `contracts.test.ts` and the Zendesk fixture.

**Deliberately out of scope**, and stated so no executor adds them: `server/`, every adapter, the poller, SQLite, the correlation engine, TanStack Query, the auth seam. Milestones 2-4.

**Known gaps the plan accepts.** Ack/mute/resolve and rule toggles are local state, not persisted — Milestone 4 does that, and the spec says so. The demo toggle survives this milestone because it is the only way to reach both states; Milestone 4 removes it. The M365 tile's real consent blocker is represented as a fixture row rather than resolved, because open question 1 is still open and it blocks exactly that one tile.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-18-ops-dash-m1-scaffold.md`. Two execution options:

**1. Subagent-driven (recommended)** — the wave structure above is built for it. Wave 0 and Wave 2 run in-session; Wave 1 dispatches two agents in one message; Wave 3 dispatches four. Review between waves, and re-read the ownership table before each dispatch.

**2. Inline execution** — run every task in this session with checkpoints between waves. Slower and it loses the parallelism, but it keeps all fifteen tasks in one context.

Either way the review gates are not optional: tag each wave, review its diff by logical block before dispatching the next, and close the gate before moving on.

Which approach?

---

## Appendix: carried forward to Milestones 2-4

None of this affects Milestone 1, which is offline by construction. It is recorded here because it was established by a read-only survey of `C:\Obsidian\Crexendo` on 2026-09-19 and would otherwise have to be re-derived when the adapters are written. Cite the vault path, not this appendix, when acting on any of it.

### Corrections to assumptions in the approved spec

- **Graph credential path.** The spec and `docs/RESUME.md` say `C:\secure\.graph\{config.json,cert.pem}`. That is correct **on the deploy server**. On the workstation and in the vault, `graph.py` resolves `<vault>/_secure/_graph/config.json`, which is where the live files are, and the vault's own `CLAUDE.md` codifies `_secure/_<integration>/config.json`. The TS port must honour both, via the same `--config` > env var > discovery chain the Python clients use. (`wiki/ops/Graph-Export-App-Registration.md`)
- **`CXDO-GraphExport` is no longer Graph-only or role-less.** As of 2026-09-18 it also holds `Exchange.ManageAsApp` on the O365 Exchange Online API and the **Global Reader** directory role on its service principal. `Exchange.ManageAsApp` carries no scope of its own — its reach comes from the directory role — so "read-only" is now enforced in two places, and `graph.py token` under-reports the identity's reach because it prints Graph roles only. Do not assume the token's `roles` claim is the whole picture.
- **Graph consent propagation is not uniform.** A fresh token showing a `roles` claim does not mean the backend authorizes yet: verified with `AccessReview.Read.All` — 403 on the v1.0 single-item route while the collection and beta routes returned 200, self-resolving about an hour later. When the `ServiceHealth.Read.All` consent lands, wait and retry before concluding it failed.
- **There is no public per-workload status feed for commercial M365.** `status.cloud.microsoft/m365` is not one — its own payload scopes itself to "can you reach Service Health". Graph is the only path, so open question 1 is a hard dependency on that tile, not a preference. (`wiki/projects/vendor-status-monitoring/_index.md`)

### One rule that belongs in shared code, not per-adapter

**A 2xx carrying non-JSON is an error, not data.** Proven on this tenant: `epc.py`'s `/api/1.4/common/groups` returns HTTP 200 with a Zoho sign-in HTML page, so the error normalizer never fires and the preset returns a one-item list holding the HTML blob. This is the vendor-status "a failed fetch must never render green" rule in miniature. Every adapter must treat a JSON-decode failure on a 2xx as `SourceResult.error` mapping to `unknown` — **one shared helper, not per-vendor handling.** Alongside it, EPC's documented trap that **errors arrive as HTTP 200** with `{"status":"error","error_code":…}`.

### The correlation rule the spec does not yet name

The prework asks for an explicit **"all sources of one platform failed" signal**. Amendment 1 stops four vendors rendering green when Statuspage itself is down, but it does not raise an alarm that we have lost sight of Jira, Helpjuice, Claude and OpenAI simultaneously. That is a Milestone 2 correlation rule and it needs a `ruleKey`; it is not in `DATA_CONTRACTS.md` section 7's table today, so adding it means amending that file first.

### Porting notes per client

- **`graph.py`** — port the auth, rewrite the query layer. The auth is solid and MSAL-free: a hand-built RS256 client-assertion JWT, `x5t` = base64url(SHA-1(cert DER)) with padding stripped, 600 s assertion lifetime, POST to `login.microsoftonline.com/{tenant}/oauth2/v2.0/token` with scope `.default`. It handles 429 by reading `Retry-After`. The query layer has two proven data-correctness defects: `/beta/auditLogs/signIns` returns **interactive-only** unless the filter carries `signInEventTypes/any(x: x ne 'interactiveUser')` (132 rows vs 3,829), and `userPrincipalName eq` on signIns returns a **silent zero** where `userId eq` returns thousands (0 vs 4,531). Also `/directoryRoles/{id}/members` **omits service principals** — use `roleAssignments`, or the privileged-accounts count is confidently wrong rather than merely absent. The spec's note that `@azure/msal-node` is optional stands; hand-rolling against `node:crypto` now has a working reference.
- **`epc.py`** — the header is `Authorization: Zoho-oauthtoken <token>`, **not Bearer**. Timestamps are epoch ms with `-1` meaning never, and conversion must be guarded to the 10^11-10^13 window because Zoho **IDs are ~10^16** and would otherwise be mangled into dates. Join on **serials, never MAC**: on 2026-08-05 MAC over-matched 129 devices where serial showed 1. Zoho keeps **20 refresh tokens per user and silently drops the oldest on the 21st**. dcapi needs versioned `Accept` headers; a 4xx with plain `application/json` is usually the header, not the scope.
- **`pfpt.py`** — `Authorization: Token <token>`, **not Bearer**, plus a required `APP-ID` header and an `object_id` on every call. **The trailing slash before the query string is mandatory**: `/domains/?object_id=` is 200, `/domains?object_id=` is a 301. "Blocked" is classification codes `[1,3,5,8,12]`, which is what `EmailSnapshot.blocked24h` must sum. Writes are dry-run by default and need an explicit confirmation after showing John the payload — a standing rule that binds any future ops-dash write path, though allow/deny management is out of scope.
- **`stellar.py`** — the JWT is valid ~10 minutes, so there is nothing worth caching. The raw ES endpoint **accepts no JSON DSL body by any method**; what works is classic ES URI Search (`q`, `size`, `sort`, `_source`, GET, no body), which means **no server-side aggregations** — "last event per device" is aggregated client-side. Group on `stellar_client_addr`, which is the per-device source IP; `msg_origin.source` is the parser/category name and is not a device. `service_status` on `data_sensor` is a JSON-encoded **string**, not an object.

### Deployment precedent, and the risk it repeats

`scripts/epc-audit/dashboard/app.py` is already deployed on the target server — Streamlit on port 8501, plaintext, corp-VLAN only, run by Task Scheduler as SYSTEM (NSSM was dropped 2026-08-07; there is no Chocolatey on that box, so **no third-party service wrapper**). Its v1 shipped as "network restriction only, no per-user identity", and its three fast-follows — TLS via a reverse proxy with an AD CS cert, then **oauth2-proxy Entra SSO (the recommended option)**, then a low-privilege domain service account — were never confirmed done and are still open on the watchlist. This is the precedent the spec's deferred-sign-in risk refers to. **It is not a live concern: ops-dash runs on John's machine only (confirmed 2026-09-19) and is not deployed anywhere.** Recorded because the spec names that server as the eventual target — if ops-dash ever lands there, the debt applies twice, and the mitigation now has a named implementation path (oauth2-proxy Entra SSO) rather than just a worry.

Two patterns from that dashboard worth copying in Milestone 4: a short read cache cleared after any manual refresh, and a freshness table so a failed pull leaves the previous data visible and visibly stale rather than blanking the panel.

### Expansion candidates — for John, not for this plan

Raised by the survey, none in scope for Milestones 1-4, all cheap relative to what they cover:

1. **Zendesk API-token keep-alive (ITSD-15019).** Zendesk deactivates any API token unused for 30 days; the `snapbrander 2025` legacy token must be exercised monthly to 2027-04-30, has **no owner**, and fails **silently** — a customer submits and no ticket is created. A lapse stops being recoverable in October 2026 when Zendesk blocks new token creation. "Has token X been exercised in the last 30 days" is a textbook ops-dash check.
2. **Stellar silent-source parity.** `stellar.py`'s `silent-check` already emits OK / STALE / MISSING against an expected-device list — functionally the panel the synthetic-checks adapter wants, and named in `wiki/hot.md` as the next action on ITSD-14212.
3. **Anthropic and OpenAI spend/seat tile.** `_secure/` already holds live `_anthropic` and `_openai` configs, so the admin/usage APIs are reachable today, not just the status pages. Feeds `wiki/projects/claude-seat-review/` (98 seats, $4,378.05).
4. **The two unowned EPC cleanup queues** — 14 retired-still-present and 33 stale >30 days, bearing on 300 paid seats, recomputed every run and visible but unowned.
5. **The alert-channel question has competition.** Opsgenie ($7,448/yr) and PagerDuty ($4,424/yr) both run today with **no assigned owner**, alongside NodePing ($31,200/yr, and `wiki/vendors/NodePing.md` flags possible duplicate billing). Whatever ops-dash does for alerting should be argued against those, and may be a consolidation case rather than a sixth tool. Open question 5 in the spec is really this question.

One thing ops-dash **cannot** absorb, so nobody promises it: the weekly blocked-email check (`wiki/ops/ITSD-blocked-email-weekly-check.md`). The JSM email processing log is not exposed by the Atlassian API and exists only in the admin UI.

### Vault conventions that bind any work touching it

`C:\Obsidian\Crexendo\CLAUDE.md` gates code changes: skill files, vault scripts, config files, hooks and scheduled-task definitions all require naming the defect, showing the diff, asking, and **stopping to wait**. Wiki content is exempt. `_secure/` is never linked, indexed or summarised. This plan's `C:\secure\` references are paths and field names only — no values, and nothing in this repo reads them in Milestone 1.

### Appendix addendum

Further items from the same 2026-09-19 survey, not covered above.

- **First run must announce itself.** The vendor-status state file is keyed `(vendor, component)` plus a last-run timestamp, and **the first run writes a baseline and reports nothing**. It has to say so explicitly, or a correct first run is indistinguishable from a silent failure. This applies to `vendor_state` in the Milestone 2 store.
- **Zendesk is subdomain-aware.** Its status UI carries a "Subdomain / Check status" box, so the generic endpoint may not reflect pod-scoped status at all. That sharpens open question 3 from "which pod" to "the generic feed may be the wrong feed"; until it is settled, label the tile as global Zendesk rather than ours.
- **"A config line, not code" holds only for already-supported platforms.** Keeper, CrowdStrike and Zoom are likely free; **Salesforce is not** — its status is instance-scoped on its own API and needs a fourth adapter. Worth saying plainly whenever the config-driven design is described, so the claim does not over-promise.
- **`epc.py` memoizes one token mint per process** — which is exactly why the spec ports these clients into a long-lived server rather than shelling out. Corollary: **never wrap the EPC client in a shell loop**; that is how you hit the 10-mints-per-10-minutes ceiling.
- **`run_audit.py` is the reconciliation of record.** If an ops-dash panel ever disagrees with the monthly audit workbook, the audit's serial-matched join wins and the panel is wrong. (`wiki/ops/EPC-Audit-Runbook.md`)
- **Two Proofpoint constants** the adapter needs and that are identifiers, not secrets: `APP-ID: 9332020803` and Crexendo `object_id = 468276755`, the latter required on every call.
- **`_secure/` has no `_stellar` entry** — the discovery chain's vault fallback does not exist, which is why the live credential sits at `C:\secure\stellar-cyber-api.json`. Anything scheduled against Stellar is blocked on a Brite-provisioned service account that does not exist yet.
- **Two stale docstrings in `stellar.py`** will mislead a porter: the module docstring still advertises the ES `source`/`source_content_type` workaround as the fix (the `raw_search()` docstring supersedes it and says it returns 400), and the `--field` CLI help still names `msg_origin.source` as the default when the corrected default is `stellar_client_addr`.
- **`vendor-status-monitoring` has no ITSD ticket**, and `wiki/meta/project-audit-2026-08-21.md` found the portfolio's problem is creation rate rather than throughput — 30 live projects against a target of 15 worked plus 3 parked, with this one at #31. The vault's own page says it competes with the closure shortlist rather than sitting beside it. Not a technical constraint, but it is the honest framing for how much of Milestones 2-4 to take on at once.
- **Awareness, no action here:** FortiGate HA versus log-source inactivity detection is open and red-flagged (only the active unit forwards syslog, and nobody knows what a failover does to the detection); 11 of 19 observed Stellar source IPs are unnamed; and Stellar containments are being worked entirely outside Jira, with the same `login-unknown-user` enumeration handled three times by three people and never ticketed.
