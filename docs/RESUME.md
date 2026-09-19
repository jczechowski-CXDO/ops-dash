# Resume here — ops-dash

Last updated 2026-09-19. **Milestone 1 is under construction. Task 1 of 15 is done and
committed; Task 2 is next.** Read this file, then the plan, then start at "Pick up here".

This file is the single entry point. Everything needed to continue lives in git — there is no
state on the machine this was started on that you need.

## Where the work is

| Thing | Where |
|---|---|
| **The plan you execute** | `docs/superpowers/plans/2026-09-18-ops-dash-m1-scaffold.md` — 15 tasks, 5 waves, ~4,100 lines. Complete code and exact expected output per step. |
| The approved design | `docs/superpowers/specs/2026-09-18-ops-dash-design.md` — the authority the plan argues from |
| Visual spec of record | `design_handoff_it_ops_dashboard/README.md` — pixel measurements, tokens, every screen |
| The contract | `design_handoff_it_ops_dashboard/DATA_CONTRACTS.md` — amended 2026-09-18, has an amendment log |
| File-ownership discipline | `design_handoff_it_ops_dashboard/AGENTS.md` |
| The prototype | `design_handoff_it_ops_dashboard/IT Ops Dashboard.dc.html` — open in a browser; its `renderVals()` is the source of every fixture value |

Branch: **`milestone-1-scaffold`**, cut from `main` at `437a228`. Work continues on it.

## Getting running on a fresh box

```bash
git clone <remote> && cd ops-dash
git checkout milestone-1-scaffold
npm install
npm run typecheck     # must exit 0
npm run build         # must exit 0
npm test              # runs both projects; no test files yet — correct at Task 1
```

Requires **Node >= 24.14.1** (the floor exists because `node:sqlite` is a Node 24 built-in,
used from Milestone 2). Verified on Node v24.14.1 / npm 11.11.0.

Linux notes:

- `.gitattributes` normalises line endings to LF in the repo. A fresh clone is clean; do not
  "fix" line endings in a commit.
- Task 3's font script makes the one and only outbound network call in this milestone
  (Google Fonts). It needs internet once; its output is committed and never fetched again.
- Task 10A needs `npx playwright install chromium` — a local browser download, not a repo
  dependency. The 28 visual baselines are **platform-sensitive**: baselines generated on
  Windows will not match Linux rendering. Generate them on the machine that will keep running
  them, and say so in the commit that adds them.

## Pick up here

**Task 2 — the frozen contract.** Plan section `### Task 2: The frozen contract`. It writes
`shared/src/contracts.ts` from the amended `DATA_CONTRACTS.md`, verbatim, then freezes it.

Then Task 3 (self-hosted tokens/fonts/icons), then Task 3A (the nine repository guards), which
closes Wave 0. Tag `wave-0` and run review gate G0 before Wave 1.

The plan's "Teams and file ownership" section defines five waves, the agent per task, and the
review gate that closes each wave. Waves 1 and 3 are parallel — two agents and four agents
respectively, with disjoint file ownership. Waves 0, 2 and 4 are sequential.

## What is actually built (verified, not claimed)

Commit `a9ac997`, Task 1 only:

```
package.json            npm workspaces ["shared","web"], scripts, dev deps
package-lock.json       committed — deploys use npm ci, never npm install
tsconfig.base.json      strict; noUncheckedIndexedAccess + exactOptionalPropertyTypes on
vitest.config.ts        root runner, test.projects: ["shared","web"]
.gitattributes          LF normalisation, binary + generated markers
shared/{package.json,tsconfig.json,vitest.config.ts}
shared/src/index.ts     `export {}` placeholder — Task 2 replaces it
web/{package.json,tsconfig.json,vite.config.ts,vitest.setup.ts,index.html}
web/src/main.tsx        one-line boot — Task 6 replaces it
```

Nothing else exists. No contract, no assets, no fonts, no icons, no primitives, no fixtures,
no shell, no views, no tests, no guards.

## Six plan defects found and fixed before/while building

Recorded because they were found by a pre-flight scan and by running the thing, and because
four of them would have produced silent wrong-green rather than a loud failure.

| # | Defect | Ruling |
|---|---|---|
| G-1 | `guards.test.ts` derived its path with `URL.pathname`, which encodes the space in `C:\git\ops dashboard` as `%20`; every `readdirSync` would throw. | Use `fileURLToPath`. Plan amended. Harmless on Linux, but the fix is strictly more correct — keep it. |
| G-2 | **The six contract tests would have passed while asserting nothing.** `expectTypeOf` is type-level; under a plain `vitest run` the file reports green with zero real assertions. | `shared/vitest.config.ts` enables `typecheck`; run via `--project shared --typecheck`; the run must report **6** assertions. Also replaced the deprecated `vitest.workspace.ts` with `test.projects`. |
| G-3 | Playwright measured the sidebar via `ancestor::div[1]` off the nav role — fragile. | `data-testid="sidebar"` on the Sidebar root (Task 6 adds it, Task 10A measures it). |
| G-4 | Recent-history `Table` columns keyed `dur`; the fixture field is `duration`. `Table` indexes `row[column.key]`, so this renders four empty cells **with no error**. | Correct keys named in Task 7. |
| G-5 | Task 9's Email test helper contradicted the Wave 3 preamble helper — the preamble's `at(path, route)` cannot express the empty-snapshot case. | Email's helper takes `Partial<EmailSnapshot>` and passes it via the documented `snapshot` prop. |
| G-6 | `npm run typecheck` **failed**: `TS6059`, `web/vitest.setup.ts` not under `rootDir: "src"`. Would have recurred for `e2e/` and `playwright.config.ts`. | `web/tsconfig.json` drops `rootDir`/`outDir`/`composite`. `web` emits nothing and nothing references it. `shared` keeps them — it is a referenced project. Fixed on disk and in the plan. |

## Standing rulings

- **Branch, not worktree.** The build scripts resolve `../design_handoff_it_ops_dashboard/...`,
  and per-agent worktrees would break a sequential build. Cost: `main` is not simultaneously
  usable while this branch is checked out.
- **Parallel implementers inside a wave.** The `subagent-driven-development` skill's default
  forbids it. Overridden because the file-ownership table is hard and disjoint — the discipline
  `AGENTS.md` already mandates. Cost: if two agents touch one file, gate G1/G3 catches it.
- **Dispatch per wave, not per task.** Tasks inside a wave are tightly coupled and the plan
  already defines its review boundaries as gates G0-G4. Cost: a larger diff per review, so a
  defect surfaces one gate later.
- **Testing dev-dependencies approved** (John, 2026-09-19): `@testing-library/react`,
  `@testing-library/jest-dom`, `jsdom`, `@playwright/test`. Dev-only, never shipped, beyond the
  spec's stated budget, which lists only `vitest`.
- **ops-dash runs locally only** (John, 2026-09-19). Not deployed, not served to any network,
  not on the corp VLAN. The spec's "deployment target is the existing audit dashboard server"
  is the *eventual* target, not a current fact. The security review in Task 11A is scoped to
  that premise and carries a "Reopens at release" list for the day it changes.

## Decided — don't relitigate

- Node API + Vite SPA, one repo, npm workspaces, TypeScript both sides, self-hosted
- SQLite via **`node:sqlite`** (Node 24 built-in — no native module). Milestone 2.
- Port the Python skills to TS, **sharing their existing credential files**
- Aurora **tokens only**; we build 8 primitives (Button, IconButton, Switch, Table,
  LinearProgress, Icon, Skeleton, Alert)
- **Zero runtime external deps**: vendored Plus Jakarta Sans `.woff2`, the 11 icons lifted from
  Aurora's extracted path data, no UI or chart library
- **Seven verified vendors**, config-driven, one adapter per *platform* (statuspage, statusio,
  zendesk-ssp, msgraph). The handoff's AWS/Okta/Cloudflare list was placeholder.
- Endpoints page comes from **Endpoint Central, not Intune**
- Contract amendments: all four approved and applied. `StatusLevel` gained `unknown` and
  `maintenance`; vendor gained `maintenance`, `incidentsSince[]`, `lastSuccessfulPoll`; the id
  union became the seven real vendors as `ServiceId`; `SourceResult` gained `empty`.
- Urbanist dropped. Dashboard sign-in deferred, auth seam in the API from day one.

## Open questions

M365 Graph consent (`ServiceHealth.Read.All` + `ServiceMessage.Read.All`) · Hornetsecurity
region filter = `United States - Atlanta`? · Zendesk pod (one instance or two) · synthetic check
targets and regions · alert delivery channel · CrowdStrike as a later tile.

Only the first blocks anything, and it blocks exactly one tile. It is now known to be a **hard
dependency**: there is no public per-workload status feed for commercial M365 at all, so Graph
is the only path. `status.cloud.microsoft/m365` is not one — its own payload scopes itself to
"can you reach Service Health".

## Facts worth not re-deriving

- **Graph:** app `CXDO-GraphExport`, thumbprint `9038A7B238AA5E3C84D5BA657335431902932539`,
  expires 2028-08-09. Holds all six scopes the Entra page needs — **no new consent for that
  page**. Credential path differs by machine: `C:\secure\.graph\` on the deploy server,
  `<vault>/_secure/_graph/` on the workstation. Since 2026-09-18 the app also holds
  `Exchange.ManageAsApp` and **Global Reader**, which `graph.py token` does not report.
- **EPC:** `C:\secure\.epc\config.json`; Zoho OAuth refresh token; **errors arrive as HTTP
  200**; 10 access tokens per refresh token per 10 minutes.
- **Icon extraction:** the Aurora glyph table is on the single bundle line beginning
  `let __ds_default_components_foundation_icon_data_hdnrqo;`, 885 entries, keys are
  `<PascalName>WeightRegular`, all eleven needed glyphs present at `viewBox="0 0 48 48"`.
- **Font vendoring:** Google's `css2` endpoint needs a desktop User-Agent or it serves ttf
  instead of woff2. Keep latin + latin-ext, both styles — four variable `.woff2` files.
- Environment this was started on: Node v24.14.1, npm 11.11.0, git 2.53.0, Windows 11.

A much longer set of carried-forward facts for Milestones 2-4 — the four Python clients' auth
mechanics, rate limits and proven traps, the deployment precedent, and an expansion scan of the
vault — is in the **appendix at the end of the plan**. Read it before writing any adapter.

## After Milestone 1

2. **The headline rule end to end.** `vendorstatus` (Statuspage first — four vendors, one
   adapter) + `synthetic`, the poller, SQLite, correlation. At this point it detects a real
   outage.
3. **The remaining adapters.** Graph, EPC, Proofpoint, Stellar — disjoint directories, safely
   parallel.
4. **Wire and harden.** Live queries, per-panel loading/stale/error states, ack/mute/resolve
   persistence, demo toggle removed, auth seam filled.

Each gets its own plan under `docs/superpowers/plans/`. Two things the vault survey says belong
in the Milestone 2 plan and are not yet in the contract: an explicit **"all sources of one
platform failed"** correlation signal (amendment 1 stops four Statuspage vendors rendering green
together, but raises no alarm that we have lost sight of all four at once), and the rule that
**a 2xx carrying non-JSON is an error, not data** — one shared helper, proven necessary by
`epc.py`'s `groups` endpoint returning an HTML login page under HTTP 200.
