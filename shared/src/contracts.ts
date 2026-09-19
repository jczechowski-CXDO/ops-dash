/* eslint-disable -- FROZEN FILE. See docs/superpowers/plans/2026-09-18-ops-dash-m1-scaffold.md */
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
