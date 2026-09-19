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
| `npm test` | Vitest, all workspaces. **Runs `typecheck` first** via a `pretest` hook |
| `npm run typecheck` | `tsc -b shared web` |
| `npm run test:e2e` | Playwright — 152 visual baselines, interaction, the offline proof |
| `npm run test:e2e:update` | regenerate baselines. **Look at them before committing** |
| `npm run icons` | regenerate `web/src/components/aurora/icons.generated.ts` from the Aurora bundle |
| `npm run fonts` | re-vendor Plus Jakarta Sans (only if the font is replaced; one outbound call) |

## Layout

- `shared/src/contracts.ts` — the view-model contract. **Frozen.**
- `web/` — the SPA. `app/` shell and routing, `views/` the seven pages, `components/`
  the eight Aurora primitives plus five dashboard components, `fixtures/` the offline
  data, `theme/` the token helpers, `lib/` the URL guard.
- `web/e2e/` — Playwright. Baselines are **platform-sensitive**; these were generated
  on Linux and will not match Windows.
- `design_handoff_it_ops_dashboard/` — the design spec of record. Read-only.
- `docs/superpowers/` — the approved design, the per-milestone plans, the security review.
- `docs/RESUME.md` — **read this first.** State, standing rulings, and the traps.

## Rules that are not obvious from the code

- **`shared/src/contracts.ts` is frozen.** Amend `design_handoff_it_ops_dashboard/DATA_CONTRACTS.md`
  first, with John's approval, then the contract, then the consumers. Never work around it.
- **No runtime external dependencies.** Fonts, icons and tokens are vendored and served
  off our box. The CSP in `index.html` makes this enforceable by the browser rather than
  by everyone remembering it.
- **No literal hex colours in `web/src/`** — every colour is a `var(--*)` token, so dark
  mode needs no second palette.
- **Use the published colour helpers, do not reach for a raw token.** `statusColor` and
  `severityColor` return the `-main` rung, which is **decoration-grade**: correct for a
  dot, a 3px border or a sparkline, and unreadable as text. Text takes
  `statusTextColor` / `severityTextColor` / `blastTextColor`; fills take
  `severityFillColor` with `severityOnFillColor` on top. Bypassing these with a literal
  is how 42 contrast failures accumulated in one wave.
- **Fixtures are permanently redacted.** No real UPNs, hostnames, IPs or mail subjects,
  ever — fixtures are committed and pushed, so they leave the machine even though the
  app does not.
- **A failed fetch must never render as green.** `unknown` is neutral grey, never counts
  toward the all-clear, and never satisfies the vendor half of the Sev1 rule. Two of the
  seven services are permanently `unknown`, so **"ALL SYSTEMS OPERATIONAL" is unreachable
  in production** — that is correct, not a bug to fix.
- **Everything upstream is read-only.** No mutating third-party call belongs in this repo.
- **Runs locally only.** Not deployed, not served to any network. Deployment is John's
  call and is the trigger for everything on the "Reopens at release" list in
  `docs/superpowers/security/2026-09-18-m1-review.md`.

## Testing, and the one habit this repo runs on

**A passing test is not evidence until someone has watched it fail.** This milestone
produced roughly twenty checks that reported success without exercising what their name
claimed — type assertions that never ran, presence-only contract checks, a contrast suite
blind to its own call sites, a baseline tolerance 300x the noise floor, and a screenshot
harness that silently captured empty strips.

So: **before committing a test whose name makes a claim, break the thing it names and
watch it go red.** The rule that covers every case found here is narrower than it sounds —
*an assertion may not reach the value under test by the same path the code did.* Pin a
literal, or compare two independently-reachable definitions.

Three corollaries, each learned the hard way and all in `docs/RESUME.md` with the
evidence: assert what a value **must be**, never what it must not be; run the battery
against the world where the candidates **differ**; and before trusting a check that
passes, prove it can fail.

## Current state

Milestone 1 (offline scaffold) is complete: 539 unit tests, 153 e2e tests, 152 visual
baselines, thirteen repository guards, zero AA contrast failures across both themes.

Milestones 2-4 — the headline correlation rule, the remaining adapters, and live wiring —
each get their own plan under `docs/superpowers/plans/`. **Milestone 2 needs Node 24**:
the store is `node:sqlite`, a built-in.
