# Data contracts

Every adapter is a pure async function that returns one of the types below. The UI is
written against these types only — it never sees a vendor payload. Changing a type here
is a breaking change: update this file first, then the adapter, then the view.

> **Amended 2026-09-18**, approved by John, before any adapter was written. Four amendments,
> all driven by one rule from the vendor-status prework: **a failed fetch must never render as
> green.** See the amendment log at the end of this file. `shared/contracts.ts` is generated
> from this file and is frozen after these amendments.

Common envelope, returned by every adapter:

```ts
type SourceResult<T> = {
  data: T;
  fetchedAt: string;      // ISO 8601
  degraded: boolean;      // partial result (some pages/regions failed)
  empty?: boolean;        // fetch completed, returned no records — NOT an assertion of health
  error?: { code: string; message: string };
};
```

When `error` is set the UI renders the panel's last good data with a stale badge, or an
error state if there is none. It never renders zeros as if they were real.

`empty` exists because a completed fetch that returns nothing is not the same claim as a
completed fetch that returns "healthy" (**amendment 4**). Zendesk is the sharp case: its SSP
feed publishes no per-service status field, so an empty `incidents.json` is the only green
signal available — and an absence is not an affirmation. An adapter that cannot distinguish
"nothing is wrong" from "nothing came back" sets `empty` and maps the level to `unknown`.
Consumers must never infer `operational` from `empty`.

---

## 1. Services and status

Feeds: Overview strip/tiles, Service detail.

```ts
type StatusLevel =
  | 'operational'
  | 'degraded'
  | 'outage'
  | 'maintenance'              // amendment 1
  | 'unknown';                 // amendment 1

type ServiceId =               // amendment 3 — the seven verified vendors
  | 'proofpoint'               // Hornetsecurity / Proofpoint 365 Total Protection
  | 'jira'
  | 'helpjuice'
  | 'claude'
  | 'openai'
  | 'zendesk'
  | 'm365';                    // Microsoft 365 / Entra ID

type VendorIncident = {        // amendment 2
  id: string;
  title: string;
  level: StatusLevel;          // canonical, normalized from the platform's own vocabulary
  startedAt: string;           // ISO 8601
  resolvedAt?: string;         // absent while open
  url?: string;
};

type ServiceStatus = {
  id: ServiceId;
  short: string;               // tile label,   e.g. 'Microsoft 365'
  name: string;                // page title,   e.g. 'Microsoft 365 / Entra ID'
  vendor: {
    level: StatusLevel;
    label: string;             // 'Operational' | 'Degraded' | 'Advisory' | 'Maintenance' | 'Unknown'
    note: string;              // advisory text + last vendor update time, or why the level is unknown
    advisoryId?: string;       // e.g. 'EX1084221'
    url?: string;
    maintenance?: {            // amendment 2
      title: string;
      scheduledFor: string;    // ISO 8601
      scheduledUntil: string;  // ISO 8601
    };
    incidentsSince: VendorIncident[];  // amendment 2 — everything the vendor published since our
                                       // last SUCCESSFUL poll, not a current-state diff
    lastSuccessfulPoll?: string;       // ISO 8601; the lookback anchor for incidentsSince
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
  uptime30d: number;           // 0–1
  incidents90d: number;
  lastStateChange: string;     // ISO 8601
};
```

`StatusLevel` drives tile color: operational → `--success-main`, degraded → `--warning-main`,
outage → `--error-main`, maintenance → `--info-main`, unknown → `--text-disabled` (neutral
grey). The UI computes color; adapters never return colors.

Two rules bind `unknown`, and they are the whole point of amendment 1:

1. **`unknown` never counts toward "ALL SYSTEMS OPERATIONAL."** The Overview strip asserts
   health only when every service is affirmatively `operational`. Four of the seven vendors sit
   behind Statuspage, so without `unknown` a single Statuspage-wide failure paints Jira,
   Helpjuice, Claude and OpenAI green simultaneously and confidently — four vendors, one
   upstream, one correlated lie.
2. **`unknown` is not `degraded`.** It must never satisfy the vendor half of the Sev1
   correlation rule (section 7), or every Statuspage outage becomes a fleet of false Sev1s.

`maintenance` is likewise not `degraded`: announced work is not an incident, and it renders
distinctly so an operator does not chase a planned window.

`spark` is raw numbers. The view scales them into the `0 0 100 26` viewBox — do not
pre-render SVG point strings in an adapter.

### Check history rows

```ts
type CheckRun = {
  at: string;                  // ISO 8601
  check: string;               // 'Mailflow round trip'
  region: string;              // 'us-east'
  result: 'pass' | 'fail' | 'timeout';
  latencyMs: number | null;
};
```

---

## 2. Incidents

Feeds: Overview alert list, Incident detail, nav badges. Produced by the correlation
engine, not by a source adapter.

```ts
type Severity = 1 | 2 | 3 | 'info';

type Incident = {
  id: string;                       // 'INC-2291'
  severity: Severity;
  title: string;
  serviceId: string;
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

type BlastMetric = {
  label: string;                    // 'Users affected'
  value: string;                    // '384'   — preformatted for display
  note: string;                     // 'of 512 licensed mailboxes'
  level: 'normal' | 'warning' | 'error';
};

type TimelineEntry = {
  at: string;                       // ISO 8601, newest first in the array
  title: string;
  body: string;
  kind: 'opened' | 'detected' | 'escalated' | 'vendor' | 'update' | 'resolved';
};
```

`kind` maps to the dot color: opened → `--text-secondary`, detected/escalated → `--error-main`,
vendor → `--warning-main`, update → `--info-main`, resolved → `--success-main`.

---

## 3. Entra security

Source: Microsoft Graph, app-only with certificate auth. Feeds the Entra page and the
Sev2/Sev3 incidents.

```ts
type EntraSnapshot = {
  stats: {
    riskySignIns24h: number;
    riskyConfirmedCompromised: number;
    failedSignIns24h: number;
    failedSignInAccounts: number;    // distinct targeted accounts
    mfaCoverage: number;             // 0–1
    mfaUnregistered: number;
    privilegedAccounts: number;
    globalAdmins: number;
  };
  signals: EntraSignal[];
  audit: AuditEvent[];
};

type EntraSignal = {
  key: 'risky_signin' | 'failed_spike' | 'legacy_auth' | 'mfa_gap'
     | 'expiring_credentials' | 'role_change' | 'guest_access' | 'ca_change';
  label: string;
  count: number;
  delta24h: number;                  // rendered '+4' / '-2' / '0'
  severity: Severity;
  lastSeen: string;                  // ISO 8601
};

type AuditEvent = {
  at: string;
  actor: string;                     // UPN or 'System'
  action: string;                    // 'Add member to role'
  target: string;
  result: 'success' | 'failure';
};
```

**Graph mapping**

| Field | Source |
|---|---|
| `riskySignIns24h` | `/identityProtection/riskyUsers` + `/auditLogs/signIns?$filter=riskLevelDuringSignIn ne 'none'` |
| `failedSignIns24h`, `failedSignInAccounts` | `/auditLogs/signIns?$filter=status/errorCode ne 0`, distinct on `userPrincipalName` |
| `legacy_auth` | `/auditLogs/signIns?$filter=clientAppUsed in ('Other clients','IMAP4','POP3','SMTP')` |
| `mfaCoverage`, `mfaUnregistered` | `/reports/authenticationMethods/userRegistrationDetails` |
| `privilegedAccounts`, `globalAdmins` | `/directoryRoles` + `/directoryRoles/{id}/members` |
| `expiring_credentials` | `/applications?$select=id,displayName,passwordCredentials,keyCredentials`, filter `endDateTime` within 14 days |
| `role_change`, `ca_change`, `audit` | `/auditLogs/directoryAudits` |
| `guest_access` | `/users?$filter=userType eq 'Guest'` |

Sign-in logs require an Entra ID P1/P2 licence and are paged — follow `@odata.nextLink`
and expect several minutes of ingestion lag. Poll every 5 minutes; do not re-query the
full 24h window each time, keep a cursor on `createdDateTime`.

---

## 4. Endpoints

Source: ManageEngine Endpoint Central Cloud, Zoho OAuth self-client, read-only.

```ts
type EndpointSnapshot = {
  stats: {
    total: number;
    patchCompliance: number;         // 0–1
    checkedIn7d: number;
    bitlockerEncrypted: number;
    criticalPatchesMissing: number;
  };
  attention: EndpointIssue[];
};

type EndpointIssue = {
  computer: string;                  // 'CXDO-LT-0412'
  assignedTo: string;
  os: string;
  issue: string;                     // 'Agent stale · 34 days'
  issueKind: 'stale_agent' | 'missing_patches' | 'no_bitlocker' | 'eol_build';
  lastCheckIn: string;               // ISO 8601
};
```

Endpoints: `/dcapi/inventory/computers`, `/dcapi/patch/systemreport`,
`/dcapi/inventory/bitlocker`. Tokens are short-lived — refresh with the Zoho refresh
token, and cache the access token for its full validity rather than re-minting per call.
Poll every 15 minutes; this data moves slowly and the API is rate limited.

`os` is carried in the contract but not shown in the current table (the column was cut
for width). Keep it — it belongs in a row expansion or a tooltip.

---

## 5. Email security

Source: Proofpoint 365 Total Protection / Hornetsecurity Control Panel API.

```ts
type EmailSnapshot = {
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

type BlockedMessage = {
  at: string;
  from: string;
  to: string;                        // may be 'N recipients'
  subject: string;
  reason: 'Credential phishing' | 'Impersonation' | 'Lookalike domain'
        | 'Malicious URL' | 'Malware' | 'Spam' | string;
};
```

Poll every 5 minutes. Allow/deny list management is explicitly **out of scope** — this
dashboard is read-only.

---

## 6. Log sources

Source: Stellar Cyber XDR (`crexendo.stellarcyber.cloud`). Not shown as its own page
yet; it drives the Stellar Cyber service tile and should raise a Sev2 when a sensor goes
silent.

```ts
type LogSourceSnapshot = {
  sensors: { name: string; lastSeen: string; healthy: boolean }[];
  silentSources: { name: string; ip: string; lastEventAt: string }[];
};
```

Poll every 5 minutes. A source with no events for 60 minutes is silent.

---

## 7. Rules and integrations

```ts
type AlertRule = {
  key: string;                       // 'vendor' | 'spray' | 'risky' | 'secrets' | 'stale' | 'legacy'
  name: string;
  detail: string;                    // human-readable threshold
  enabled: boolean;
  threshold?: Record<string, number | string>;
};

type Integration = {
  key: string;
  name: string;
  detail: string;                    // auth mechanism / scope
  state: 'connected' | 'polling' | 'needs_auth' | 'error';
  stateLabel: string;                // 'Connected' | 'Polling 60s' | 'Needs auth'
  lastSuccessAt?: string;
};
```

Rule toggles and ack/mute/resolve are the only writes in the product, and they write
only to our own store.

### Rules as implemented in the prototype

| key | Rule | Threshold | Severity |
|---|---|---|---|
| `vendor` | Vendor status degraded **and** our check failing | both true | 1 |
| `spray` | Failed sign-in spike | > 500 failures in 15 min | 2 |
| `risky` | Risky sign-in confirmed compromised | any occurrence | 1 |
| `secrets` | Secret or certificate expiring | within 14 days | 3 |
| `stale` | Agent stale | no check-in for 21 days | 2 |
| `legacy` | Successful legacy protocol sign-in | any occurrence | 2 |

The `vendor` rule is the headline behavior of the product: neither signal alone opens a
Sev1. A vendor advisory with our checks still passing is informational; our checks
failing with no vendor advisory is a Sev2 pointing at our own network or credentials.

The vendor half of the rule is satisfied by `degraded` or `outage` **only**. `unknown` and
`maintenance` do not satisfy it (amendment 1). A vendor at `unknown` with our check failing is
the Sev2 case — we have lost sight of the vendor *and* something is broken here, which points
at our own side until proven otherwise.

---

## Polling summary

| Source | Interval | Notes |
|---|---|---|
| Vendor status feeds | 60s | Cheap, public, cache with ETag |
| Synthetic checks | 60s | Our own runner |
| Graph sign-ins / audit | 5m | Paged, ingestion lag, cursor on `createdDateTime` |
| Graph MFA / roles / credentials | 60m | Slow-moving |
| Proofpoint | 5m | |
| Stellar Cyber | 5m | |
| Endpoint Central | 15m | Rate limited |

The header's 30-second countdown is the UI's own refresh cadence, not any source's.
It should re-render from cache, not force every source to refetch.

---

## Amendment log

Amended 2026-09-18, approved by John, before any adapter was written. `AGENTS.md` requires this
file to change first; it did. After these four, `shared/contracts.ts` is frozen.

| # | Change | Prevents |
|---|---|---|
| 1 | `StatusLevel` gains `unknown` and `maintenance` | One Statuspage-wide failure rendering Jira, Helpjuice, Claude and OpenAI green at once; planned windows reading as incidents; `unknown` triggering false Sev1s |
| 2 | `ServiceStatus.vendor` gains `maintenance`, `incidentsSince[]` and `lastSuccessfulPoll` | Blindness to anything that flaps between polls — current-state diffing alone cannot see an incident that opened and closed inside the window |
| 3 | `ServiceStatus.id` becomes the `ServiceId` union of the seven verified vendors | Building against the handoff's placeholder list (AWS / Okta / Cloudflare / GitHub / CrowdStrike), none of which is a monitored source |
| 4 | `SourceResult.empty` added, with the rule that consumers never infer `operational` from it | Zendesk's absent status field reading as green when in fact nothing came back |

Amendment 3 note: CrowdStrike is a plausible eighth tile later — the credential and a
`pull_falcon.py` already exist — but it is not one of the seven verified feeds, so it is not in
the union today. Adding it is a one-line change here plus one `vendors.json` entry.
