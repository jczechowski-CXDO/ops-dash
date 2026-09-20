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
| `npm run typecheck` | `tsc -b shared web server` |
| `npm run test:e2e` | Playwright — 152 visual baselines, interaction, the offline proof |
| `npm run test:e2e:update` | regenerate baselines. **Look at them before committing** |
| `npm run icons` | regenerate `web/src/components/aurora/icons.generated.ts` from the Aurora bundle |
| `node --watch server/src/index.ts` | run the server: store + poller + adapters + engine + API, one process |
| `npm run fonts` | re-vendor Plus Jakarta Sans (only if the font is replaced; one outbound call) |

## Layout

- `shared/src/contracts.ts` — the view-model contract. **Frozen.**
- `web/` — the SPA. `app/` shell and routing, `views/` the seven pages, `components/`
  the eight Aurora primitives plus five dashboard components, `fixtures/` the offline
  data, `theme/` the token helpers, `lib/` the URL guard.
- `web/e2e/` — Playwright. Baselines are **platform-sensitive**; these were generated
  on Linux and will not match Windows.
- `server/` — the API and the detection chain. `http/fetchJson.ts` is the only way out
  to the network; `adapters/vendorstatus/` reads the five vendor status feeds and
  `adapters/synthetic/` runs the reachability probes; `store/` is `node:sqlite`;
  `poller/` schedules; `engine/` holds the two correlation rules; `api/` serves them
  read-only; `index.ts` composes all of it and is the only file that knows the shape of
  the whole.
- `server/src/__integration__/` — the chain end to end on the committed real payloads,
  with only `fetch` stubbed. **This is where a seam defect shows up**; three did.
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
  toward the all-clear, and never satisfies the vendor half of the Sev1 rule. `m365` is
  permanently `unknown` until its adapter exists, so **"ALL SYSTEMS OPERATIONAL" is
  unreachable in production** — that is correct, not a bug to fix.
- **Filter every vendor feed to the part of it that serves us.** Zendesk publishes every
  pod worldwide (`tenants` → `?subdomain=`, 17 incidents down to 10) and Hornetsecurity
  publishes ten datacentres (`locations` → `containers`, and a service can read
  `maintenance` globally while our region is fine). An unfiltered feed puts other people's
  outages on our tiles, and a tile whose incidents are usually irrelevant is one the
  operator stops reading — the same failure as a permanently-red tile, from the other side.
- **Everything upstream is read-only.** No mutating third-party call belongs in this repo.
- **Every network call goes through `server/src/http/fetchJson.ts`.** It owns the failure
  rules — non-2xx, a 2xx carrying non-JSON, an empty body, a throw, a body over the 5 MB
  cap, and an unsafe target or redirect — and it never throws, because a transport failure
  is a fact to report and not an exception to handle. That invariant is unconditional and
  tested against values that resist being stringified, which is the way it was once false.
- **Every URL this process opens is checked by `http/safeTarget.ts`, including the ones a
  redirect chose.** Parsed, never pattern-matched: `startsWith('https://')` is satisfied by
  `https://attacker@127.0.0.1/`. Redirects are followed manually so the `Location` header
  cannot pick the address for us. `web/src/guards.test.ts` enforces this by grepping for bare `fetch`. There is
  exactly one exemption, `adapters/synthetic/probe.ts`, and it is argued in a block
  comment there: a reachability probe asks a different question and must not read a body.
- **Nothing in `server/` throws to signal failure**, so nothing may treat a resolved
  promise as success. A `Source.run` that resolves with an errored `SourceResult` has
  failed. This was a shipped defect — the poller counted a source whose feed 503'd every
  minute as polling fine, and `/api/health` served it green.
- **A probe that cannot pass is worse than no probe.** It teaches the operator that red
  means nothing. Three of the four original probe targets could never have passed: two
  Zendesk pod roots behind a Cloudflare bot challenge, and a guessed Jira hostname that
  does not exist. Before adding a probe, run it against the real thing and record what it
  actually answered — `expectStatus` exists because one endpoint's healthy answer is a 401.
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

**The last run before any commit is a plain `npx vitest run`.** Mutation testing wants
`--typecheck.enabled=false` for speed, and that flag makes a green run a lie about whether
the file compiles — it has already produced a commit with nine passing tests and a broken
build. Speed during the mutation loop, the full thing before the commit.

## Current state

Milestone 1 (offline scaffold) is complete: 539 unit tests, 153 e2e tests, 152 visual
baselines, eighteen repository guards, zero AA contrast failures across both themes.

Milestone 2 (detection) is complete: 1067 unit tests. The chain reads six real vendor
status feeds, runs four synthetic probes, correlates two rules, and serves the result
read-only. It has been run against the live internet and detects a simulated outage end
to end. Only `m365` has no adapter — its own is the first that needs a credential.

Milestone 3 — the msgraph adapter and live UI wiring plus auth — gets its own plan under
`docs/superpowers/plans/`. **The server needs Node 24**:
the store is `node:sqlite`, a built-in.
