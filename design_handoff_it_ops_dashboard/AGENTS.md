# Agents: building this with Claude Code

The point of this file is that the UI contract is already frozen (`DATA_CONTRACTS.md`),
so six data sources can be built at the same time by six workers that never read each
other's files. Everything below is written to be pasted into Claude Code.

## Build order

```
Phase 0  scaffold-agent          (alone — everything depends on it)
Phase 1  six source agents       (parallel — no shared files)
Phase 2  correlation-agent       (needs phase 1 types, not phase 1 networking)
Phase 3  integration-agent       (alone — swaps fixtures for live queries)
Phase 4  review-agent            (alone)
```

Phase 2 can start as soon as phase 1's *types* exist, which they do from day zero
because they are in `DATA_CONTRACTS.md`. In practice, launch phase 2 alongside phase 1
and have it build against fixtures.

## File ownership

Hard rule: an agent edits only the files it owns. This is what makes parallel runs safe.

| Agent | Owns | May read |
|---|---|---|
| scaffold | `src/app/**`, `src/views/**`, `src/components/**`, `src/theme/**` | handoff docs |
| graph | `src/adapters/graph/**` | `src/types/**` |
| epc | `src/adapters/endpointcentral/**` | `src/types/**` |
| proofpoint | `src/adapters/proofpoint/**` | `src/types/**` |
| stellar | `src/adapters/stellar/**` | `src/types/**` |
| vendor-status | `src/adapters/vendorstatus/**` | `src/types/**` |
| synthetic | `src/adapters/synthetic/**` | `src/types/**` |
| correlation | `src/engine/**` | `src/types/**`, `src/adapters/*/fixtures.ts` |
| integration | `src/queries/**`, plus wiring edits in `src/views/**` | everything |
| review | nothing | everything |

`src/types/contracts.ts` is generated once, from `DATA_CONTRACTS.md`, by the scaffold
agent. After that it is **read-only for everyone**. A source agent that needs a change
stops and says so rather than editing it.

---

## Phase 0 — scaffold-agent

```
You are building the shell of an IT operations dashboard.

Read design_handoff_it_ops_dashboard/README.md in full, and open
"IT Ops Dashboard.dc.html" in the same folder — that HTML file is the visual
reference. It is a prototype, not code to copy: recreate it in this codebase's
existing stack and patterns.

Deliver:
1. src/types/contracts.ts — every type in DATA_CONTRACTS.md, verbatim. After you
   write it, treat it as frozen.
2. Routing: / , /services/:id , /incidents/:id , /entra , /endpoints , /email ,
   /settings. The sidebar drives real navigation.
3. The shell: 232px sidebar, sticky header with live clock and 30s auto-refresh
   countdown, content well. Light and dark themes via the Aurora `dark` class on
   the root, persisted.
4. All seven views, rendering from static fixtures that match contracts.ts.
   Pull the placeholder values out of the prototype so the views look identical
   to it on first run.
5. Loading skeletons and error/stale states for every panel. The prototype does
   not show these; you must design them from the Aurora primitives (Skeleton,
   Alert) and the tokens in README.md.

Use the Aurora design system for every visual. It ships in this bundle at
design_handoff_it_ops_dashboard/aurora/ — copy aurora/tokens/ and aurora/styles.css
into the app and link styles.css once; every color, size, radius and spacing
value in the design is a var(--*) reference into those files. Do not invent
colors or type sizes, and do not write a second dark palette — dark mode is
already in fig-tokens.css under the `dark` class. Match the measurements in the
"Screens / views" section exactly.

Do not write any network code. No fetch, no API clients, no credentials.

Definition of done: the app runs offline, all seven routes render, the Sev1
fixtures reproduce the prototype's Sev1 screenshots, and the empty/quiet
fixtures reproduce its quiet state.
```

## Phase 1 — source agents (run in parallel)

Shared preamble for all six:

```
You own exactly one data adapter. Read DATA_CONTRACTS.md for your section and
src/types/contracts.ts for the exact types. You may not modify contracts.ts,
any view, or another adapter. If the contract is wrong for your source, STOP and
report what needs to change — do not work around it.

Deliver, in your own directory only:
  client.ts    auth + transport, credentials from env vars only
  map.ts       vendor payload -> contract type, pure functions
  index.ts     one exported async function returning SourceResult<T>
  fixtures.ts  a real response, redacted (no real UPNs, IPs, hostnames, tokens)
  *.test.ts    map.ts tested against fixtures, no network

Rules:
- Read-only. Never call a mutating endpoint.
- Never log a full response body. Redact UPNs, IP addresses and message subjects
  in any log line.
- Handle partial failure: if one page or region fails, return what you have with
  degraded: true, not an exception.
- No colors, no labels that encode severity styling, no pre-rendered SVG. Return
  data; the UI decides how it looks.
- Respect the poll interval in the contract's polling table. Cache aggressively.
```

Then one of:

**graph-adapter** — Microsoft Graph, app-only certificate auth, an existing app
registration. Implement `EntraSnapshot`. Sign-in and audit logs are paged via
`@odata.nextLink` and lag several minutes; keep a cursor on `createdDateTime` rather
than re-querying 24 hours each poll. Required permissions are read-only:
`AuditLog.Read.All`, `Directory.Read.All`, `Policy.Read.All`, `Application.Read.All`,
`UserAuthenticationMethod.Read.All`, `IdentityRiskyUser.Read.All`. Confirm the tenant
has a licence that exposes sign-in logs before assuming the endpoint works.

**epc-adapter** — ManageEngine Endpoint Central Cloud, Zoho OAuth self-client with a
refresh token. Implement `EndpointSnapshot` from the inventory, patch and BitLocker
endpoints. Cache the access token for its full lifetime; the API is rate limited and
15-minute polling is the target.

**proofpoint-adapter** — Hornetsecurity Control Panel API. Implement `EmailSnapshot`.
Allow/deny list endpoints exist — do not touch them.

**stellar-adapter** — Stellar Cyber XDR. Implement `LogSourceSnapshot`. A source with
no events for 60 minutes counts as silent.

**vendor-status-adapter** — public status feeds for Microsoft 365, AWS, Azure, Okta,
Cloudflare, CrowdStrike and GitHub. Implement the `vendor` half of `ServiceStatus` for
each. These feeds differ per vendor (Atlassian Statuspage JSON, RSS, bespoke); normalize
all of them to `StatusLevel` plus a note and an optional advisory id and URL. Use ETag /
If-None-Match. This adapter must never throw — a vendor's status page being down is
itself just `degraded: true`.

**synthetic-checks-adapter** — our own probes, filling the `ours` half of
`ServiceStatus` plus `CheckRun[]` and the `spark` series. Implement at minimum: a
mailflow round trip, an OIDC token acquisition, and an HTTP 200 on each service portal,
from multiple regions. Persist results so the 28-point sparkline and p50/p95 are real
history rather than a synthetic curve.

## Phase 2 — correlation-agent

```
You own src/engine/**. You consume adapter output (use their fixtures; do not
call networks) and produce Incident[] per DATA_CONTRACTS.md.

Implement the rule table in DATA_CONTRACTS.md section 7. The defining rule:
a Sev1 opens only when a vendor reports degraded AND our synthetic check for
that service is failing. Vendor-degraded alone is informational; our-check-
failing alone is a Sev2 against our own network or credentials.

Also implement:
- Stable incident ids that survive a poll (key on rule + service + open window),
  so acknowledging an incident does not un-acknowledge it 30 seconds later.
- Deduplication: one incident per rule per service while it stays open.
- Auto-resolve when the triggering condition clears, appending a resolved
  timeline entry.
- Timeline assembly from the underlying signals, newest first.
- Blast radius metrics per incident type. For the mail-delay case that is
  affected users, queue depth, median delay and oldest queued message.

Ship a test per rule: a fixture set in, an expected Incident[] out. Include the
case where both halves of the vendor rule are true and the case where only one is.
```

## Phase 3 — integration-agent

```
Replace fixtures with live data. One query per adapter, each with the staleTime
and refetch interval from the polling table in DATA_CONTRACTS.md. Panels load
and fail independently — one dead source must never blank the page.

Then: persist acknowledge, mute and resolve to our own store with optimistic
updates and rollback on failure; record who and when, and surface it in the row
meta exactly as the prototype does. Remove the Quiet/Sev1 demo toggle, or put it
behind a dev-only flag.

Every panel needs a stale indicator showing the age of its data when a fetch is
failing. Never render a zero that could be mistaken for a real measurement.
```

## Phase 4 — review-agent

```
Review against design_handoff_it_ops_dashboard/README.md. Report only real
defects, with evidence.

Check specifically:
- Visual fidelity to the prototype at 1440px and at ~1000px: sidebar 232px,
  card borders 1px --divider on --background-paper, radius 12 cards / 10 rows /
  8 nav, the type sizes listed in the tokens section.
- Every color is a var(--*) reference. No literal hex anywhere in src/.
- Dark mode has no unreadable pair; text contrast at least 4.5:1.
- Tables keep their last column visible at a 1000px content well.
- No credentials in source or in logs; no full response bodies logged.
- No mutating third-party calls anywhere in src/adapters.
- Adapters do not import from views, and views do not import from clients.
```

---

## Practical notes

**Start with vendor-status and synthetic-checks.** They are the two halves of the
headline Sev1 rule and the only ones that make the Overview page interesting. The
Entra, endpoint and email pages can ship on fixtures for a week without anyone
minding; an Overview that cannot detect an outage is pointless.

**Fixtures are the contract's test.** If an agent's fixtures do not render correctly
in the scaffold's views, one of the two is wrong, and you find out in minutes rather
than after wiring six sources.

**Do not let a source agent "improve" the UI.** The most common failure mode in a
parallel run is an adapter agent deciding a field should be formatted differently and
editing a view to match. The file-ownership table is the guard; restate it in every
prompt.

**Redaction is not optional.** These fixtures contain user principal names, source IP
addresses and mail subjects. Redact before committing, and keep the redaction in the
test data permanently.
