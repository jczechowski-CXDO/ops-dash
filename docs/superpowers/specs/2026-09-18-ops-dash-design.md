---
type: spec
title: "IT Ops Dashboard (ops-dash) — Design"
status: approved
created: 2026-09-18
owner: John Czechowski
repo: jczechowski-CXDO/ops-dash
---

# IT Ops Dashboard — design

## Goal

One page that answers *is anything broken right now, and who is affected*, then lets an
operator drill from a service tile into a service, an incident, or the underlying security
signal. Seven views: Overview, Service detail, Incident detail, Entra security, Endpoints &
patch health, Email security, Rules & integrations.

Scope is a ~512-user / ~612-endpoint Microsoft-centric environment. Everything the product
does upstream is **read-only**; the only writes are to our own store.

## Inputs this design reconciles

1. `design_handoff_it_ops_dashboard/` — high-fidelity design handoff (README, DATA_CONTRACTS,
   AGENTS, prototype HTML, Aurora bundle). Authoritative for **visual design and view-model shape**.
2. `wiki/projects/vendor-status-monitoring/_index.md` — verified vendor-feed prework, 2026-09-14.
   Authoritative for **which vendors, which endpoints, and the failure semantics**.
3. Existing vault skills (`epc`, `proofpoint`, `stellar-cyber`, `graph-export`) — proven auth
   flows, endpoints, rate limits and traps. Authoritative for **how each API actually behaves**.

Where 1 and 2 disagree, 2 wins: the handoff's vendor list is placeholder, the prework's was read
live from the endpoints.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Node API + Vite SPA, one repo, self-hosted | Adapters need secrets and hit non-CORS APIs; a pure SPA can hold neither |
| Language | TypeScript both sides | One contract type shared by server and web |
| Source reuse | Port the Python skills to TS, **share their credential files** | A long-lived server caches access tokens; `epc.py` mints one per process against a 10-per-10-minutes Zoho limit |
| Store | SQLite via `node:sqlite` | Built into Node 24 — no native module, no service, survives restarts |
| Design system | Aurora tokens only; we build the 8 primitives (Button, IconButton, Switch, Table, LinearProgress, Icon, Skeleton, Alert) | The handoff's own recommendation; the prebuilt bundle is a `window`-global script that fights bundlers |
| External assets | None at runtime | Self-host fonts, inline the icons, serve everything off our box |
| Vendor list | The seven verified | Confirmed machine-readable 2026-09-14 |
| Endpoints source | Endpoint Central, not Intune | Intune is not implemented beyond a test machine |
| Dashboard sign-in | Deferred; auth seam in the API from day one | See Security posture — this is a known-risky deferral |

## Architecture

```
ops-dash/
  design_handoff_it_ops_dashboard/   committed as-is — the design spec of record
  docs/superpowers/specs/            this file
  shared/
    contracts.ts                     DATA_CONTRACTS.md + amendments; frozen, imported by both sides
  server/
    src/adapters/
      graph/            Entra snapshot        (cert auth, CXDO-GraphExport)
      endpointcentral/  endpoint snapshot     (Zoho OAuth refresh token)
      proofpoint/       email snapshot        (Hornetsecurity Control Panel)
      stellar/          log-source snapshot   (Stellar Cyber XDR)
      vendorstatus/
        platforms/{statuspage,statusio,zendesk-ssp,msgraph}.ts
        vendors.json                 config-driven vendor list
      synthetic/        our own probes
    src/engine/         correlation -> Incident[]
    src/poller/         one schedule per source
    src/store/          node:sqlite
    src/api/            routes + the auth seam
  web/
    src/{app,views,components,theme,queries}/
    public/aurora/      tokens + styles.css (fonts.css rewritten to local @font-face)
    public/fonts/       Plus Jakarta Sans .woff2, vendored
```

### Data flow

```
poller (per-source interval) -> adapter -> SourceResult<T> -> SQLite (last-good + history)
                                                                 |
                                                 correlation engine -> Incident[]
                                                                 |
                         GET /api/{services,incidents,entra,endpoints,email,rules}
                                                                 |
                                 SPA - TanStack Query, one query per source, 30s
```

Three consequences:

- **Poll intervals live on the server.** The UI's 30-second countdown re-reads our cache, which
  is what the handoff requires. Graph keeps its 5-minute cursor and EPC its 15 minutes no matter
  how many browser tabs are open.
- **The API mirrors `SourceResult<T>` outward**, so `fetchedAt` / `degraded` / `error` reach the
  UI unchanged and each panel renders stale-vs-failed independently. One dead source never blanks
  the page.
- **Probe history is real.** Persisting every synthetic run is what makes `spark[]`, p50/p95 and
  `uptime30d` actual measurements rather than a generated curve.

## Contract amendments

**Approved by John 2026-09-18 and applied to `DATA_CONTRACTS.md`** (see its amendment log).
`AGENTS.md` freezes `contracts.ts` and requires `DATA_CONTRACTS.md` to be amended first; it was.
All four are driven by the prework's rule that **a failed fetch must never render as green**.

1. **`StatusLevel` gains `unknown` and `maintenance`.**

   ```ts
   type StatusLevel = 'operational' | 'degraded' | 'outage' | 'maintenance' | 'unknown';
   ```

   `unknown` renders neutral grey, never green, and never counts toward "ALL SYSTEMS
   OPERATIONAL". Without it a Statuspage-wide failure paints Jira, Helpjuice, Claude and OpenAI
   green simultaneously and confidently — four vendors, one upstream, one correlated lie.

2. **`ServiceStatus.vendor` gains maintenance and incident history.**

   ```ts
   maintenance?: { title: string; scheduledFor: string; scheduledUntil: string };
   incidentsSince: VendorIncident[];   // since last successful poll, not a current-state diff
   ```

   Current-state comparison alone is blind to anything that flaps between polls. At 60s that
   window is small but non-zero — a restart or network gap reopens it.

3. **`ServiceStatus.id` union becomes the seven real vendors**, replacing the placeholder set.

A fourth, smaller one: `SourceResult.error` must be distinguishable from "fetched, nothing
found". Zendesk is the sharp case — it publishes no per-service status field, so an empty
`incidents.json` is the only green signal, and an absence is not an affirmation.

## Sources

### Vendor status — config-driven, adapter per platform

`vendors.json` carries display name, platform type, endpoint, auth mode, and an optional
component/region filter. Adapters are written against the **platform**, not the vendor.

| Vendor | Endpoint | Platform | Notes |
|---|---|---|---|
| Hornetsecurity / Proofpoint | `api.status.io/1.0/status/591aaa7fe69f388425000fda` | Status.io | 8 regional containers per component; **filter to `United States - Atlanta`** — confirm before trusting |
| Jira | `jira-software.status.atlassian.com/api/v2/summary.json` | Statuspage v2 | |
| Helpjuice | `status.helpjuice.com/api/v2/summary.json` | Statuspage v2 | |
| Claude | `status.claude.com/api/v2/summary.json` | Statuspage v2 | |
| OpenAI | `status.openai.com/api/v2/summary.json` | Statuspage v2 | ULID page id |
| Zendesk | `status.zendesk.com/api/ssp/services.json` + `/api/ssp/incidents.json` | custom SSP | no status field; empty incidents is the only green signal; label "global Zendesk, not necessarily ours" until the pod question closes |
| Microsoft 365 | Graph `serviceAnnouncement/healthOverviews` + `/issues` | Graph, cert auth | **blocked on consent**; no public commercial feed exists as fallback |

Use `summary.json`, never `status.json` — the latter returns only a page-level rollup with no
components, incidents or maintenance. Normalization to the canonical scale is part of the config,
because the four platforms disagree on vocabulary.

### Product sources

| Source | Auth | Credential | Poll | Prior art |
|---|---|---|---|---|
| Microsoft Graph (Entra page) | app-only certificate, `CXDO-GraphExport` | `C:\secure\.graph\{config.json,cert.pem}` | 5m sign-ins/audit, 60m MFA/roles | `skills/graph-export/scripts/graph.py` |
| Endpoint Central Cloud | Zoho OAuth refresh token, read scopes | `C:\secure\.epc\config.json` | 15m | `skills/epc/scripts/epc.py` |
| Hornetsecurity Control Panel | `cp.proofpoint.com/api/v0` | `$PFPT_CONFIG` > `~/.proofpoint/config.json` | 5m | `skills/proofpoint/scripts/pfpt.py` |
| Stellar Cyber XDR | `crexendo.stellarcyber.cloud` | `$STELLAR_CONFIG` > vault default | 5m | `skills/stellar-cyber/scripts/stellar.py` |
| Synthetic checks | n/a | n/a | 60s | new |

**The Entra page needs no new consent.** `CXDO-GraphExport` already holds all six scopes the
handoff's graph-adapter requires (`AuditLog.Read.All`, `Directory.Read.All`, `Policy.Read.All`,
`Application.Read.All`, `UserAuthenticationMethod.Read.All`, `IdentityRiskyUser.Read.All`). Cert
expires **2028-08-09**; thumbprint `9038A7B238AA5E3C84D5BA657335431902932539`.

**The M365 service-health tile does need consent**: `ServiceHealth.Read.All` +
`ServiceMessage.Read.All`. Until granted, that tile renders `unknown` with an explicit reason,
not green.

### Traps carried over from the skills, each with a test

- **EPC returns errors as HTTP 200** with `{"status":"error","error_code":...}`. Status-code
  checking alone reports failures as success.
- **Zoho: 10 access tokens per refresh token per 10 minutes**; dcapi reports add 30 calls/min.
  Cache the access token for its full validity.
- **Graph sign-in logs page via `@odata.nextLink`** and lag several minutes; keep a cursor on
  `createdDateTime` rather than re-querying 24h each poll.
- **`healthOverviews` paginates at 100 objects.**
- **Hornetsecurity is per region** — an overall-Operational component can be down in Atlanta.

## Store

One SQLite file, `node:sqlite`.

| Table | Holds | Why it must persist |
|---|---|---|
| `snapshots` | last-good `SourceResult<T>` per source + `fetchedAt` | serve a stale panel instead of an empty one |
| `check_runs` | every probe: service, region, result, latency | the real source of `spark[]`, p50/p95, `uptime30d` |
| `vendor_state` | last canonical status per (vendor, component) + last successful poll | the change diff and the incident-history lookback |
| `incidents` | correlation output, keyed rule+service+window | stable ids, so an ack survives the next poll |
| `incident_actions` | ack / mute / resolve with actor and timestamp | the row meta the prototype renders |
| `rule_state` | per-rule enabled flag | the Rules page toggles |

## Correlation

Rules per `DATA_CONTRACTS.md` section 7. The headline rule is the product: **vendor degraded AND
our synthetic check failing -> Sev1**. Vendor-degraded alone is informational; our-check-failing
alone is a Sev2 pointing at our own network or credentials.

`unknown` is not `degraded`. An unknown vendor state must never satisfy the vendor half of the
Sev1 rule, or every Statuspage outage becomes a fleet of false Sev1s.

## Self-hosting

No runtime request leaves our infrastructure except to the monitored sources themselves.

- **Fonts** — `tokens/fonts.css` is the only outbound reference in all of Aurora (two Google
  Fonts `@import`s). Replaced with local `@font-face` over vendored `.woff2`. Plus Jakarta Sans
  is OFL, so committing the files is fine.
- **Urbanist is dropped** (confirmed by John 2026-09-18). The README calls it the body font, but `fonts.css` points all three
  `--font-*` tokens at Plus Jakarta Sans, so the prototype's `var(--font-body, 'Urbanist', ...)`
  fallback never fires and Urbanist is downloaded but never rendered. Reversible with one token
  change if the stated intent is preferred.
- **Material Symbols webfont is not needed.** All 11 icons exist as extracted path data in the
  Aurora bundle (878 glyph keys). We lift those into a local `Icon.tsx`.

### Dependency budget

| Side | Deps | Deliberately absent |
|---|---|---|
| web | react, react-dom, react-router, @tanstack/react-query, vite, typescript, vitest | UI kit, chart library, icon package, CSS framework |
| server | fastify, @azure/msal-node | DB driver (`node:sqlite`), HTTP client (`fetch`), cron (`setInterval`), ORM |

`@azure/msal-node` handles the Graph certificate client-assertion flow including token caching
and renewal. Hand-rolling it against `node:crypto` is ~40 lines and remains an option.

## Security posture

- **All upstream calls are read-only.** Allow/deny list management, EPC writes and any mutating
  endpoint are out of scope. The credentials themselves hold read scopes only.
- **Credentials are read from the existing `C:\secure\` store** via env-var paths. Nothing is
  copied into the repo; `cert.pem` holds a private key.
- **Fixtures are redacted** — no real UPNs, IPs, hostnames or mail subjects — and redaction is
  permanent in test data. No full response body is ever logged.
- **Deployment target** is the existing audit dashboard server: corp VLAN only, credentials
  already present and ACL-restricted, already treated as a sensitive asset.
- **Dashboard sign-in is deferred** (confirmed by John 2026-09-18), with a single auth-middleware seam in the API so Entra SSO
  drops in without restructuring. This is a known risk, not an oversight: the audit dashboard
  shipped v1 as "port 8501, network restriction only" with an Entra SSO fast-follow that was
  never confirmed done and is still open on the watchlist. Same data sensitivity, same
  trajectory. The mitigation is that ops-dash must not widen past its first operator before the
  seam is filled.

## Milestones

1. **Scaffold.** Workspaces, `shared/contracts.ts` (amended, then frozen), self-hosted tokens +
   fonts + icons, the 8 primitives, 7 routes, all views from prototype-derived fixtures. Offline,
   no network code. Reproduces the prototype's quiet and Sev1 states.
2. **The headline rule end to end.** `vendorstatus` (Statuspage first — four vendors for one
   adapter) + `synthetic`, the poller, SQLite, correlation. At this point it detects a real
   outage.
3. **The remaining adapters.** Graph, EPC, Proofpoint, Stellar — disjoint directories, safely
   parallel.
4. **Wire and harden.** Live queries, per-panel loading/stale/error states, ack/mute/resolve
   persistence, demo toggle removed, auth seam filled.

## Plan scope

Milestone 1 is a full implementation plan on its own and is what the first plan will cover.
Milestones 2-4 get their own plans, so each keeps a reviewable size.

## Open questions

1. **M365 consent** — `ServiceHealth.Read.All` + `ServiceMessage.Read.All` on CXDO-GraphExport.
   Blocks one tile, nothing else.
2. **Hornetsecurity region filter** — confirm `United States - Atlanta` in the Control Panel.
3. **Zendesk pod** — one instance (`crexendo.zendesk.com`) or two (`help.netsapiens.com`)? Until
   settled, readings are global Zendesk.
4. **Synthetic check targets and regions** — which probes, run from where. NodePing does uptime
   monitoring for NetSapiens but is another team's tool ($31.2K/yr, Chris Aaker) and out of scope
   here.
5. **Alert delivery** — the vendor-status prework left open whether a change-only alert goes to
   mail via `smtp2go` or whether the dashboard's own incident list *is* the alert.
6. **CrowdStrike** — a `.crowdstrike` credential and `pull_falcon.py` already exist. Not in the
   seven; a candidate tile later.
