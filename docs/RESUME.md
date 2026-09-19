# Resume here — ops-dash

Session of 2026-09-18. Design is done, approved and committed; **no code exists yet**.
Read this file plus the spec, then continue at "Next steps".

## Read first

| File | What it is |
|---|---|
| `docs/superpowers/specs/2026-09-18-ops-dash-design.md` | **The design.** Everything decided, with rationale. Start here. |
| `design_handoff_it_ops_dashboard/README.md` | Visual design spec — pixel measurements, tokens, every screen |
| `design_handoff_it_ops_dashboard/DATA_CONTRACTS.md` | View-model types + per-source API field mappings |
| `design_handoff_it_ops_dashboard/AGENTS.md` | Build order, file-ownership table, per-agent prompts |
| `design_handoff_it_ops_dashboard/IT Ops Dashboard.dc.html` | Working prototype — open in a browser (needs `support.js` + `aurora/` beside it) |

Outside the repo, read-only and **not to be modified without John's permission**:
`C:\Obsidian\Crexendo` — `wiki/projects/vendor-status-monitoring/_index.md` (verified vendor
feeds), `wiki/ops/Graph-Export-App-Registration.md`, `wiki/ops/EPC-Audit-Dashboard-Deploy.md`,
and `skills/{graph-export,epc,proofpoint,stellar-cyber}/` (working Python clients to port).

## Repo state

```
C:\git\ops dashboard        -> github.com/jczechowski-CXDO/ops-dash (remote empty, not pushed)
  .gitignore                                       committed
  design_handoff_it_ops_dashboard/                 committed — the design spec of record
  docs/RESUME.md                                   this file
  docs/superpowers/specs/2026-09-18-ops-dash-design.md
  IT service monitoring dashboard_withaurora.zip   untracked (*.zip gitignored); source archive
```

One commit on `main`, not yet pushed — the remote is still empty. No `server/`, `web/` or
`shared/` yet; that is Milestone 1.

## Decided (don't relitigate)

- Node API + Vite SPA, one repo, npm workspaces, TypeScript both sides, self-hosted
- SQLite via **`node:sqlite`** (built into Node 24 — no native module)
- Port the Python skills to TS, **sharing their existing credential files** in `C:\secure\`
- Aurora **tokens only**; we build 8 primitives (Button, IconButton, Switch, Table,
  LinearProgress, Icon, Skeleton, Alert)
- **Zero runtime external deps**: vendor Plus Jakarta Sans `.woff2`, lift the 11 icons from
  Aurora's extracted path data, no UI/chart library
- **Seven verified vendors**, config-driven, one adapter per *platform* (statuspage, statusio,
  zendesk-ssp, msgraph) — the handoff's AWS/Okta/Cloudflare list was placeholder
- Endpoints page comes from **Endpoint Central, not Intune** (Intune is test-machine only)

## Answered by John — 2026-09-18

Nothing is waiting on him any more except the open questions below, and only one of those
blocks anything.

1. **Contract amendments: all four approved.** Applied to `DATA_CONTRACTS.md`, which now carries
   an amendment log and is the amended source of record. `StatusLevel` gained `unknown` and
   `maintenance`; vendor gained `maintenance`, `incidentsSince[]`, `lastSuccessfulPoll`; the id
   union became the seven real vendors as `ServiceId`; `SourceResult` gained `empty`. Spec
   status is now `approved`. `shared/contracts.ts` is generated from that file and frozen once
   written.
2. **Urbanist dropped.** Confirmed. Zero pixels change; one fewer font fetch.
3. **Dashboard sign-in deferred**, auth seam in the API from day one. Confirmed as a known risk.
   The mitigation stands: ops-dash must not widen past its first operator before the seam is
   filled.
4. **Committed.** First commit on `main` carries `.gitignore`, the handoff bundle and `docs/`.
   The superseded zip is deleted; `*.zip` is gitignored so the `_withaurora` archive stays
   untracked in the working tree.

## Open questions (in the spec, repeated for convenience)

M365 Graph consent (`ServiceHealth.Read.All` + `ServiceMessage.Read.All`) · Hornetsecurity
region filter = `United States - Atlanta`? · Zendesk pod (one instance or two) · synthetic check
targets and regions · alert delivery channel · CrowdStrike as a later tile.

Only the first blocks anything, and it blocks exactly one tile.

## Next steps

1. Write the **Milestone 1 implementation plan** (scaffold only) via the `writing-plans` skill.
   Milestones 2–4 get their own plans.
2. Build Milestone 1: workspaces, `shared/contracts.ts` (amended, then frozen), self-hosted
   tokens/fonts/icons, 8 primitives, 7 routes, all views from prototype-derived fixtures.
   Offline — no network code at all.
3. Write `CLAUDE.md` once the scaffold exists and there are real commands to document. This was
   John's original `/init` request; it was correctly deferred because the repo was empty.

## Facts worth not re-deriving

- **Graph:** app `CXDO-GraphExport`, cert `C:\secure\.graph\cert.pem`, thumbprint
  `9038A7B238AA5E3C84D5BA657335431902932539`, expires 2028-08-09. Already holds all six scopes
  the Entra page needs — **no new consent required for that page**.
- **EPC:** `C:\secure\.epc\config.json`; Zoho OAuth refresh token; **errors arrive as HTTP 200**;
  10 access tokens per refresh token per 10 minutes.
- **Deployment target:** the existing audit dashboard server (Windows Server, corp VLAN,
  Streamlit audit app on 8501) already holds `C:\secure\` with these credentials, ACL-restricted.
- Environment: Node v24.14.1, npm 11.11.0, git 2.53.0, Windows 11.
