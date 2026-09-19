# ops-dash Milestone 2 — Detection Implementation Plan

> **For agentic workers:** read `docs/RESUME.md` first, then this plan's **Global Constraints**
> in full, then your own task. This plan is written for **agent-team execution** — read "Teams
> and file ownership" before dispatching anything.

**Goal:** the headline rule, end to end. A real Statuspage outage on Jira, Helpjuice, Claude or
OpenAI — correlated with our own synthetic probe failing — opens a Sev1 row in SQLite, with a
stable id that survives the next poll. At the end of this milestone the product detects
something true that nobody told it about.

**Not in scope, deliberately:** the four credentialed adapters (Graph, EPC, Proofpoint, Stellar)
are Milestone 3; wiring the SPA to the API is Milestone 4. M2 ends at the API boundary. That
split is not arbitrary — everything here runs against **public, unauthenticated feeds**, so no
credential handling enters the codebase until M3, and the detection logic is proven before any
auth code exists to blame when it misbehaves.

**Architecture:** a third workspace, `server/`. Fastify over `node:sqlite`. One poller per
source with its own interval, one adapter per *platform* rather than per vendor, a correlation
engine that reads the store and writes `incidents`, and read-only API routes that mirror
`SourceResult<T>` outward unchanged.

**Spec:** `docs/superpowers/specs/2026-09-18-ops-dash-design.md`. Contract:
`design_handoff_it_ops_dashboard/DATA_CONTRACTS.md` as amended 2026-09-19 (amendments 5-8).

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Node >= 24.14.1, verified.** `node:sqlite` is why. Confirmed working on v24.21.0 with a real
  insert and select — this floor is no longer an assumption.
- **`shared/src/contracts.ts` is frozen again.** It was opened once, deliberately, for
  amendments 5-8 before this milestone began. It is read-only for every task here. An agent that
  believes it needs a change **stops and reports**.
- **Server dependency budget:** `fastify` and nothing else. The DB driver is `node:sqlite`, the
  HTTP client is `fetch`, the scheduler is `setInterval`, and there is no ORM. Dev deps are
  `vitest`, `typescript`, `@types/node`. **Nothing else without stopping and asking.**
  `@azure/msal-node` is budgeted for Milestone 3, not this one.
- **Read-only upstream, always.** Every call in this milestone is a GET against a public status
  feed or an HTTPS reachability probe. No mutating third-party call belongs in this repo, in any
  milestone.
- **A failed fetch must never render as green.** This is the rule the whole product exists to
  honour, and M2 is where it stops being a fixture convention and becomes adapter behaviour:
  - a non-2xx is `error`, level `unknown`
  - **a 2xx carrying non-JSON is `error` with `code: 'non_json_2xx'`, level `unknown`**
    (amendment 7) — never parsed leniently, never treated as `empty`
  - a 2xx with valid JSON and no records is `empty`, level `unknown` — **never `operational`**
  - only an affirmative statement of health from the feed is `operational`
- **One shared HTTP helper, not per-adapter handling.** The four rules above are per-transport,
  not per-vendor. An adapter that implements its own error mapping has bypassed the rule, and
  that is how it comes back.
- **The first run announces itself.** `vendor_state` is keyed `(vendor, component)`; the first
  poll writes a baseline and reports **no** change. It must say so explicitly in its return
  value and its log line, or a correct first run is indistinguishable from a silent failure.
- **No credential read, anywhere in this milestone.** Not a path, not an env var, not a
  discovery chain. M3 adds those, with the review that goes with them. `guards.test.ts` already
  fails the build on a credential-shaped string and its scan now includes `server/`.
- **Every network call is injectable.** Adapters take a `fetch`-shaped function as a parameter.
  Not for tidiness — a test that reaches the real internet is a test that fails when Atlassian
  has an incident, which is precisely when you need the suite to be trustworthy.
- **Commit at the end of every task**, using the message the task's final step gives.

---

## Teams and file ownership

**An agent writes only the files it owns.** An agent that needs a file it does not own stops and
reports. This is what makes the parallel waves safe.

### Waves

```
Wave 0   lead (solo)          Tasks 1-3    workspace, the HTTP helper, the store
Wave 1   team of 2, parallel  Tasks 4-5    vendor adapters | synthetic probes
Wave 2   lead (solo)          Task 6       the poller
Wave 3   team of 2, parallel  Tasks 7-8    correlation engine | API routes
Wave 4   lead (solo)          Tasks 9-10   the real-outage proof, docs and the close
```

The dependency chain is real. Wave 1 needs the HTTP helper and the store schema. Wave 2 needs
both adapters. Wave 3 needs rows in the store to correlate and to serve. Wave 4 needs all of it.

### Ownership table

| Wave | Agent | Owns (exclusive write) | May read |
|---|---|---|---|
| 0 | `lead` | `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/src/http/**`, `server/src/store/**`, root config | everything |
| 1 | `adapters` | `server/src/adapters/vendorstatus/**` | contracts, the HTTP helper, the store |
| 1 | `probes` | `server/src/adapters/synthetic/**` | same |
| 2 | `lead` | `server/src/poller/**` | everything |
| 3 | `engine` | `server/src/engine/**` | everything except `api/` |
| 3 | `api` | `server/src/api/**` | everything except `engine/` |
| 4 | `lead` | everything | everything |

`web/**` is untouched in this milestone. If a task appears to need a web change, that is a sign
the task has drifted into Milestone 4 — stop and report.

### Review gates

No wave is dispatched until the previous wave has been reviewed against **that wave's diff**.

| Gate | After | Reviews, specifically |
|---|---|---|
| G0 | Wave 0 | Does the HTTP helper implement all four failure rules, and can an adapter bypass it? Does the schema survive a restart, and is every column a query will need actually there? |
| G1 | Wave 1 | Do both adapters go through the helper for **every** call? Does a malformed feed produce `unknown` rather than a crash or a false green? Is the parsing tolerant of fields the vendor adds, and strict about fields it removes? |
| G2 | Wave 2 | Does the poller survive an adapter throwing, and keep polling the others? Does it write a baseline on first run and say so? Can two intervals overlap and corrupt a row? |
| G3 | Wave 3 | Does a Sev1 require **both** halves? Does `unknown` never satisfy the vendor half? Does an incident id survive the next poll so an ack is not orphaned? Does the API mirror `SourceResult` without flattening `error` into an empty body? |
| G4 | Wave 4 | The whole thing against a real outage, real or simulated. |

Tag each wave: `m2-wave-0` and so on.

### Practices, carried from Milestone 1 and non-negotiable

These are not style preferences. Each was learned by shipping the defect it prevents; the
evidence is in `docs/RESUME.md`.

1. **A passing test is not evidence until someone has watched it fail.** Before committing a
   test whose name makes a claim, break what it names and watch it go red. Report the mutations.
2. **An assertion may not reach the value under test by the same path the code did.** Pin a
   literal, or compare two independently-reachable definitions.
3. **Assert what a value must be, not what it must not be.** A negative assertion is safe only
   as a companion to a positive one.
4. **Run the battery against the world where the candidates differ.** Two implementations that
   agree on today's data are indistinguishable on today's data.
5. **Before trusting a check that passes, prove it can fail.** A control that cannot fail proves
   nothing.
6. **Stage by path.** Never `git add -A`, never `git stash` — other agents are writing.

---

## File structure

```
server/
  package.json                  @ops-dash/server, fastify only
  tsconfig.json
  vitest.config.ts              node environment, typecheck on
  src/
    http/
      fetchJson.ts              THE helper. All four failure rules, one place.
      fetchJson.test.ts
    store/
      schema.sql                the six tables, as DDL
      db.ts                     open, migrate, and the typed statements
      db.test.ts
    adapters/
      vendorstatus/
        vendors.json            config-driven: id -> platform + feed URL
        statuspage.ts           Jira, Helpjuice, Claude, OpenAI — one adapter, four vendors
        zendeskSsp.ts           Zendesk's SSP feed
        index.ts                platform dispatch
        __fixtures__/           captured real payloads, committed
        *.test.ts
      synthetic/
        probe.ts                one HTTPS reachability probe
        runner.ts               all probes, all services
        *.test.ts
    poller/
      schedule.ts               one interval per source, isolated failures
      schedule.test.ts
    engine/
      rules.ts                  vendor, blackout
      correlate.ts              rules -> Incident[], with stable ids
      *.test.ts
    api/
      routes.ts                 GET /api/services, /api/incidents, /api/health
      routes.test.ts
    index.ts                    compose: store + poller + api
```

Deliberately **not** created: `adapters/{graph,endpointcentral,proofpoint,stellar}` (M3), any
web change (M4), any auth (M4).

---

## Wave 0 — lead, solo

### Task 1: The server workspace

**Files:** `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`,
`server/src/index.ts` (placeholder); modify root `package.json`, `tsconfig.base.json`,
`vitest.config.ts`, `web/src/guards.test.ts`.

- [ ] **Step 1: Add the workspace**

Root `package.json` `workspaces` becomes `["shared", "web", "server"]`. Root `typecheck` becomes
`tsc -b shared web server`. Root `vitest.config.ts` `projects` becomes
`['shared', 'web', 'server']`.

`server/package.json`: `@ops-dash/server`, `type: module`, dependency `fastify` only, and a
`dev` script running `node --watch src/index.ts`. **Node 24 runs TypeScript directly** — there
is no build step for the server and there should not be one.

`server/tsconfig.json` extends `tsconfig.base.json`. It emits nothing, like `web`, so it drops
`rootDir`/`outDir`/`composite` — see defect G-6 in `docs/RESUME.md`, which cost a broken
typecheck for two commits.

- [ ] **Step 2: Extend the guards to cover the server**

`web/src/guards.test.ts` scans `web/src`. The credential guard and the no-network-client guard
must now also scan `server/src` — and the network guard needs **inverting** there, because the
server's whole job is to make network calls. Split it:

- `web/src` — no network client at all. Unchanged.
- `server/src` — network calls only through `src/http/fetchJson.ts`. **No bare `fetch(` outside
  that file.** That is the guard that stops an adapter bypassing the failure rules.

The credential guard scans both, unchanged, and is the one that matters most from M3 onward.

Run: `npm test` — expect green with the new project present and the new guards passing
vacuously (no `server/src` content yet). **A vacuous pass is correct here and must be stated in
the test's comment**, or the next reader will trust it before it has anything to say.

- [ ] **Step 3: Prove the new guard bites before there is anything to guard**

Write a scratch `server/src/_probe.ts` containing `fetch('https://example.com')`, run the
guards, watch the bare-fetch guard fail, delete it. A guard added to an empty directory is a
guard nobody has tested.

- [ ] **Step 4: Commit**

```
feat(server): the server workspace, and guards that know it makes network calls
```

### Task 2: `fetchJson` — the shared failure rules

**Files:** `server/src/http/fetchJson.ts`, `server/src/http/fetchJson.test.ts`.

This is the most important file in the milestone. Every rule the product's honesty depends on
lives here, once.

**Interfaces:**

```ts
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** The one way this server talks to anything. Returns SourceResult<T> rather than
 *  throwing, because "the feed is broken" is data the UI has to render, not an
 *  exception the poller should swallow. */
export async function fetchJson<T>(
  url: string,
  opts?: { fetchImpl?: FetchLike; timeoutMs?: number; signal?: AbortSignal },
): Promise<SourceResult<T>>;
```

- [ ] **Step 1: Write the failing tests first.** Each rule, with a stub `fetchImpl`:

| Case | Expect |
|---|---|
| 200 + valid JSON | `data` set, `degraded: false`, no `error`, no `empty` |
| **200 + HTML body** | `error.code === 'non_json_2xx'`, **no `data`** |
| 200 + `[]` | `empty: true`, `data` set to the empty array |
| 500 | `error.code === 'http_500'` |
| 429 | `error.code === 'http_429'` |
| network throw | `error.code === 'network'`, message preserved |
| timeout | `error.code === 'timeout'`, and the request is actually aborted |
| 200 + JSON `null` | `error`, not `data: null` — a null body is not a payload |

The HTML-under-200 case is not hypothetical and the test comment must say so: EPC's
`/api/1.4/common/groups` returns a Zoho sign-in page under HTTP 200 when the token has expired.
An adapter that trusts the status code reports a successful poll of zero records.

- [ ] **Step 2: Implement.** Set `fetchedAt` on every path, success or failure — a failed poll
  still happened at a time, and the UI renders "last tried" from it.

- [ ] **Step 3: Mutate.** Remove the JSON-decode guard and watch the HTML case go red. Remove
  the `empty` flag and watch the `[]` case go red. Report both.

- [ ] **Step 4: Commit**

```
feat(server): fetchJson — one place where a broken feed becomes data, not an exception
```

### Task 3: The store

**Files:** `server/src/store/schema.sql`, `server/src/store/db.ts`, `server/src/store/db.test.ts`.

**Six tables**, per the spec:

| Table | Key | Holds |
|---|---|---|
| `snapshots` | `source` | last-good `SourceResult<T>` as JSON + `fetched_at` |
| `check_runs` | rowid | `service_id`, `at`, `check`, `region`, `result`, `latency_ms` |
| `vendor_state` | `(vendor, component)` | last canonical level, `last_successful_poll` |
| `incidents` | `id` | rule, service, window, severity, opened/resolved, summary |
| `incident_actions` | rowid | incident, action, actor, at |
| `rule_state` | `key` | enabled flag |

- [ ] **Step 1: Write the tests first.** The ones that matter are not "can it insert":

  - **It survives a restart.** Open, write, close, reopen, read. A store that only works
    in-process is not a store.
  - **`check_runs` answers the queries `spark[]`, p50, p95 and `uptime30d` need**, at a realistic
    row count. Insert 30 days of runs for seven services at 60s — roughly 300,000 rows — and
    assert the percentile query returns in reasonable time. **This is the assumption most likely
    to be wrong, and it is cheapest to find out now.** If it is slow, the fix is an index and
    the plan was right to make you measure.
  - **`vendor_state` is keyed on the pair**, so two components of one vendor do not overwrite
    each other.
  - **An `incidents` row keyed rule+service+window is stable across polls** — the same inputs
    produce the same id, so an ack survives.

- [ ] **Step 2: Implement.** `DatabaseSync` from `node:sqlite`. Prepared statements created once
  and reused. `PRAGMA journal_mode = WAL` so a read during a write does not block.

  The path comes from a parameter with a default, never a hardcoded absolute — the tests use
  `:memory:` and the server uses a file, and a store that can only be constructed one way cannot
  be tested honestly.

- [ ] **Step 3: Mutate.** Change the `vendor_state` key to `vendor` alone and watch the
  two-component test go red. Remove the index the percentile query needs and report what the
  timing does.

- [ ] **Step 4: Commit**

```
feat(server): the SQLite store, and proof it answers the queries the UI will ask
```

Then tag `m2-wave-0` and run gate **G0**.

---

## Wave 1 — team of 2, parallel

### Task 4: The vendor-status adapters — agent `adapters`

**Files:** `server/src/adapters/vendorstatus/{vendors.json,statuspage.ts,zendeskSsp.ts,index.ts}`,
their tests, and `__fixtures__/` holding **captured real payloads**.

**Must not touch:** `src/http/**`, `src/store/**`, `src/adapters/synthetic/**`, the contract.

**Interfaces:**

```ts
export type VendorFeed = { id: ServiceId; platform: VendorPlatform; url: string; component?: string };
export async function pollVendor(feed: VendorFeed, fetchImpl?: FetchLike):
  Promise<SourceResult<ServiceStatus['vendor']>>;
```

**One adapter per platform, four vendors on one of them.** That is the design's central claim
and this task is where it either holds or does not. `vendors.json` carries the list; adding a
fifth Statuspage vendor must be a config line and no code.

- [ ] **Step 1: Capture real payloads and commit them.**

Fetch each feed once, by hand, and commit the response under `__fixtures__/`. Statuspage's
`/api/v2/summary.json` for one of the four; Zendesk's `/api/ssp/{services,incidents}.json`.

**Redact nothing and invent nothing** — these are public feeds, and a fixture you wrote yourself
tests your understanding of the format rather than the format. Record the URL and the capture
date in a comment beside each.

- [ ] **Step 2: Write the tests against those payloads, before the adapter.**

Beyond the happy path, the cases that matter:

- **A component the feed adds** that we do not know about — must not crash, must not change the
  level. Vendors add components without telling anyone.
- **A component the feed removes** that we expected — must go `unknown`, not silently drop to a
  shorter list that still reads healthy.
- **Statuspage's own vocabulary**, mapped to ours: `operational`, `degraded_performance`,
  `partial_outage`, `major_outage`, `under_maintenance`. The mapping is the adapter's whole job;
  write it as a table and assert every member, so a new vocabulary word fails loudly rather than
  falling through to a default.
- **An unrecognised status string** → `unknown`. Never `operational`, and never a crash.
- **Zendesk's SSP has no per-service status field at all.** Empty `incidents.json` is the only
  green signal available, and it is an absence. Per amendment 4 this maps to `empty` with level
  **`unknown`** — and the note must say why, because a future reader will see a working feed
  returning nothing and be tempted to call it healthy. This one service is the reason amendment
  4 exists.
- **`platform` is set on every result**, from the feed config and never inferred from the id.

- [ ] **Step 3: Implement.** Every call goes through `fetchJson`. No bare `fetch` — the Task 1
  guard will fail the build, and it is right to.

- [ ] **Step 4: Prove the config claim.** Add a fifth Statuspage vendor to `vendors.json` in a
  test, poll it, assert it works **with no code change**. If that test needs a code change, the
  config-driven design is a claim rather than a fact and you should report that.

- [ ] **Step 5: Mutate.** Map an unknown status to `operational` and watch it go red. Drop the
  `platform` field and watch it go red. Make the removed-component case return the shorter list
  and watch it go red.

- [ ] **Step 6: Commit** — `feat(server): statuspage and zendesk-ssp adapters, config-driven`

### Task 5: The synthetic probes — agent `probes`

**Files:** `server/src/adapters/synthetic/{probe.ts,runner.ts}` and tests.

**Must not touch:** anything under `vendorstatus/`, `http/`, `store/`.

**Interfaces:**

```ts
export type ProbeSpec = { serviceId: ServiceId; check: string; url: string; region: string };
export async function runProbe(spec: ProbeSpec, fetchImpl?: FetchLike): Promise<CheckRun>;
export async function runAll(specs: ProbeSpec[], fetchImpl?: FetchLike): Promise<CheckRun[]>;
```

**Scope, decided:** one region (`us-east`), HTTPS reachability only. The M365 mailflow
round-trip needs Graph and is Milestone 3. Four targets to start — Jira, Zendesk, Helpjuice and
the two Zendesk pods count as one service with two probes.

**Zendesk has two pods** (`crexendo.zendesk.com` and `help.netsapiens.com`), confirmed by John
2026-09-19, and they are **one tile with two probes** rather than two services. `ServiceId` is
unchanged. A tile reading `1/2 passing` is the intended rendering when one pod is down.

- [ ] **Step 1: Tests first.** The cases that matter:

  - A probe that times out is `result: 'timeout'` with **`latencyMs: null`** — not `0`. A zero
    renders as an extremely fast probe, which is the opposite of true. The contract's
    `number | null` exists for exactly this and M1's fixtures already honour it.
  - A non-2xx is `'fail'`, not `'timeout'`. They are different diagnoses.
  - Latency is measured around the request, and a slow **success** is still `'pass'` — slowness
    is the `p95` story, not the pass/fail one.
  - `runAll` **isolates failures**: one probe throwing does not lose the other six results.
  - Every `CheckRun` carries its `serviceId` (amendment 6).

- [ ] **Step 2: Implement.** `fetchJson` is the wrong helper here — a reachability probe does
  not want the body parsed. Use a thin sibling in your own directory that shares the timeout and
  error vocabulary, and **say in a comment why it is not `fetchJson`**, so the next reader does
  not think you bypassed the rule. If you believe it should be `fetchJson` with a flag, stop and
  report — that is a reasonable argument and it is mine to arbitrate, not yours to assume.

- [ ] **Step 3: Mutate.** Make a timeout return `latencyMs: 0` and watch it go red. Make
  `runAll` use `Promise.all` instead of `allSettled` and watch the isolation test go red.

- [ ] **Step 4: Commit** — `feat(server): synthetic reachability probes, one region`

Then tag `m2-wave-1` and run gate **G1**.

---

## Wave 2 — lead, solo

### Task 6: The poller

**Files:** `server/src/poller/schedule.ts` and its test.

- [ ] **Step 1: Tests first**, with fake timers. The behaviours worth having:

  - Each source keeps **its own interval**. Vendor feeds 60s, synthetic 60s. A slow source does
    not delay a fast one.
  - **An adapter that throws does not stop the schedule**, and does not stop the *other*
    sources. This is the one that matters: a poller that dies on a bad feed turns one vendor's
    outage into a total blackout of our own making.
  - **Overlapping runs cannot corrupt a row.** If a poll takes longer than its interval, the
    next tick must skip rather than stack — assert that two runs of the same source never
    overlap.
  - **The first run writes a baseline and reports no change** (appendix, and it is a real trap):
    the return value says `baseline: true` and the log line says so. A correct first run must
    not look like a silent failure.
  - A poll that fails writes `error` to `snapshots` and **leaves the last good data in place**,
    so a panel can render stale rather than empty.

- [ ] **Step 2: Implement.** `setInterval`, no cron dependency. Each source gets a small record:
  interval, last run, in-flight flag, last result.

- [ ] **Step 3: Mutate.** Remove the in-flight guard and watch the overlap test go red. Remove
  the try/catch around one adapter and watch the isolation test go red. Make the first run report
  a change and watch the baseline test go red.

- [ ] **Step 4: Commit** — `feat(server): the poller, with isolated failures and an honest first run`

Then tag `m2-wave-2` and run gate **G2**.

---

## Wave 3 — team of 2, parallel

### Task 7: The correlation engine — agent `engine`

**Files:** `server/src/engine/{rules.ts,correlate.ts}` and tests. **Must not touch** `api/`.

**Two rules in this milestone**, both from `DATA_CONTRACTS.md` section 7:

| key | Fires when | Severity |
|---|---|---|
| `vendor` | vendor `degraded` **or** `outage`, **and** our check failing | 1 |
| `blackout` | every service on one platform is `unknown`, **and** more than one shares it | 2 |

- [ ] **Step 1: Tests first. The headline rule's whole value is in what it does NOT fire on:**

  - vendor degraded + our check passing → **no Sev1.** Informational only.
  - our check failing + vendor operational → **no Sev1.** That is a Sev2 pointing at our own
    network or credentials.
  - **vendor `unknown` + our check failing → no Sev1** (amendment 1). This is the one that
    matters most: without it, every Statuspage outage becomes a fleet of false Sev1s. Assert it
    explicitly, by name, with a comment saying so.
  - vendor `maintenance` + our check failing → **no Sev1.** Announced work is not an incident.
  - vendor degraded + our check failing → **Sev1**, at last.
  - `blackout` fires when all four Statuspage vendors go `unknown` together, and **does not**
    fire when one `msgraph` service goes `unknown` alone — the rule requires more than one
    service on the platform.
  - **An incident id is stable across polls.** Same rule + service + window ⇒ same id, so an ack
    recorded against it is not orphaned by the next tick. Assert it by correlating twice and
    comparing ids, not by reading the id-generation code.

- [ ] **Step 2: Implement.** Pure functions over store reads. The engine does not fetch and does
  not schedule — it takes state and returns `Incident[]`.

- [ ] **Step 3: Mutate — and this list is the rule's specification.** Each of these must go red:
  widen the vendor half to accept `unknown`; widen it to accept `maintenance`; drop the
  our-check-failing half so vendor alone fires; make the blackout rule fire on a single service;
  make the incident id include a timestamp so it changes every poll.

- [ ] **Step 4: Commit** — `feat(server): the correlation engine — the rule the product is for`

### Task 8: The API — agent `api`

**Files:** `server/src/api/routes.ts` and its test. **Must not touch** `engine/`.

**Routes:** `GET /api/health`, `GET /api/services`, `GET /api/incidents`.

- [ ] **Step 1: Tests first.**

  - **The API mirrors `SourceResult<T>` outward unchanged.** `fetchedAt`, `degraded`, `empty`
    and `error` all reach the client as they are. A route that flattens an errored source into
    an empty array has thrown away the only thing that distinguishes "nothing is wrong" from
    "we could not look" — which is the failure this whole product exists to prevent, reappearing
    at the last hop.
  - **One dead source never blanks the response.** Six good sources and one errored returns six
    payloads and one error object, HTTP 200. The transport succeeded; the source did not.
  - `/api/health` reports the store and the poller separately, because they fail separately.
  - **No route mutates anything.** Assert that the router exposes no non-GET method at all —
    ack/mute/resolve are Milestone 4 and the auth seam is not filled yet.

- [ ] **Step 2: Implement.** Fastify, read-only, no auth (M4 fills the seam; leave it visible).

- [ ] **Step 3: Mutate.** Flatten an errored source to `[]` and watch it go red. Add a POST route
  and watch the read-only test go red.

- [ ] **Step 4: Commit** — `feat(server): read-only API that mirrors SourceResult outward`

Then tag `m2-wave-3` and run gate **G3**.

---

## Wave 4 — lead, solo

### Task 9: The real-outage proof

**Files:** `server/src/index.ts`, `server/src/__integration__/detects.test.ts`.

This milestone's deliverable is not code, it is **evidence that the product detects something
true**. Everything before this has been tested against payloads we chose.

- [ ] **Step 1: Compose.** `index.ts` wires store + poller + adapters + engine + api. One
  process, one SQLite file, `node --watch src/index.ts` in dev.

- [ ] **Step 2: The integration test.** Feed the *committed real payloads* through the whole
  chain with a stubbed `fetch` and a `:memory:` store, then assert a Sev1 row exists with the
  right rule, service and severity. End to end, no mocking of our own layers.

- [ ] **Step 3: The simulated outage.** Take the captured Statuspage payload, flip one component
  to `major_outage`, fail the matching probe, and run the chain. Assert: a Sev1 opens; its id is
  stable across a second run; and flipping the component back **resolves** it rather than
  opening a second incident.

- [ ] **Step 4: Run it against the real internet, once, by hand.** Not in the suite — the suite
  must never depend on Atlassian being up. Record the actual output in the commit message,
  including what the feeds said at that moment. **This is the only step in the milestone that
  proves the URLs are right**, and no amount of fixture testing substitutes for it.

- [ ] **Step 5: Commit** — `feat(server): the chain detects a real outage, end to end`

### Task 10: Docs and the close

- [ ] Update `CLAUDE.md`: the server commands, the `server/` layout, and the rule that every
  network call goes through `fetchJson`.
- [ ] Update `docs/RESUME.md`: state, what M2 proved, and what M3 inherits.
- [ ] Write `docs/superpowers/security/2026-09-19-m2-review.md`. **M2 changes the threat model
  for the first time**: the app now makes outbound calls and stores data. That is a new surface
  even with no credentials — SSRF via a poisoned `vendors.json`, a hostile feed body, unbounded
  store growth, and the first thing in this repo that runs unattended.
- [ ] Final verification, all three run and their real output seen: `npm test`,
  `npm run typecheck`, `npm run build`.

Then tag `m2-wave-4` and run gate **G4**.

---

## Definition of done for Milestone 2

1. A real Statuspage outage, correlated with a failing probe, opens a Sev1 in SQLite.
2. The id is stable across polls, so an ack would survive.
3. `unknown` never opens a Sev1 — asserted by name.
4. Four vendors going dark together raise a `blackout` Sev2.
5. A broken feed leaves the last good data visible and marked stale, and never reads as green.
6. One dead source never blanks the API response.
7. Adding a fifth Statuspage vendor is a config line, proven by a test.
8. Zero credentials in the codebase.
9. `npm test`, `npm run typecheck` and `npm run build` all exit 0, run and seen.
