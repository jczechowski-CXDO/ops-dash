import { describe, it, expectTypeOf } from 'vitest';
import type {
  SourceResult, StatusLevel, ServiceId, VendorIncident, ServiceStatus, CheckRun,
  Severity, BlastMetric, TimelineEntry, Incident,
  EntraSignal, AuditEvent, EntraSnapshot,
  EndpointIssue, EndpointSnapshot,
  BlockedMessage, EmailSnapshot,
  LogSourceSnapshot, AlertRule, Integration,
} from './contracts.js';

// Conformance assertions for the FROZEN contract.
//
// Every expected shape below is transcribed from design_handoff_it_ops_dashboard/
// DATA_CONTRACTS.md (amended 2026-09-18) — NOT copied from contracts.ts. Copying
// the implementation would re-certify whatever typo it contains, which is exactly
// the failure this file exists to prevent.
//
// These are `toEqualTypeOf`, which is bidirectional and exact: it pins each field's
// TYPE and its OPTIONALITY. An earlier version of this file used `toMatchTypeOf`
// and `toHaveProperty`, which are presence-only — they proved a member or key
// existed and nothing more. Demonstrated hole: degrading amendment 2's
// `incidentsSince: VendorIncident[]` to `incidentsSince?: string[]` left the test
// named "carries the amendment-2 history fields" passing green.
//
// All assertions here are TYPE-level. They only run under typecheck mode, which is
// enabled in shared/vitest.config.ts (not merely via the --typecheck flag). A run
// reporting 0 type assertions is proving nothing — see defect G-2 in docs/RESUME.md.

describe('contracts — envelope', () => {
  it('SourceResult is exactly the documented envelope, with empty optional (amendment 4)', () => {
    expectTypeOf<SourceResult<number>>().toEqualTypeOf<{
      data: number;
      fetchedAt: string;
      degraded: boolean;
      empty?: boolean;
      error?: { code: string; message: string };
    }>();
  });
});

describe('contracts — services', () => {
  it('StatusLevel is exactly the five members, including both from amendment 1', () => {
    expectTypeOf<StatusLevel>().toEqualTypeOf<
      'operational' | 'degraded' | 'outage' | 'maintenance' | 'unknown'
    >();
  });

  it('ServiceId is exactly the seven verified vendors (amendment 3)', () => {
    expectTypeOf<ServiceId>().toEqualTypeOf<
      'proofpoint' | 'jira' | 'helpjuice' | 'claude' | 'openai' | 'zendesk' | 'm365'
    >();
  });

  it('VendorIncident is exact (amendment 2)', () => {
    expectTypeOf<VendorIncident>().toEqualTypeOf<{
      id: string;
      title: string;
      level: StatusLevel;
      startedAt: string;
      resolvedAt?: string;
      url?: string;
    }>();
  });

  it('ServiceStatus is exact, including the whole vendor sub-object', () => {
    expectTypeOf<ServiceStatus>().toEqualTypeOf<{
      id: ServiceId;
      short: string;
      name: string;
      vendor: {
        level: StatusLevel;
        label: string;
        note: string;
        advisoryId?: string;
        url?: string;
        maintenance?: {
          title: string;
          scheduledFor: string;
          scheduledUntil: string;
        };
        incidentsSince: VendorIncident[];
        lastSuccessfulPoll?: string;
      };
      ours: {
        level: StatusLevel;
        label: string;
        note: string;
        passing: number;
        total: number;
      };
      latencyMs: number;
      p50Ms: number;
      p95Ms: number;
      spark: number[];
      uptime30d: number;
      incidents90d: number;
      lastStateChange: string;
    }>();
  });

  it('ServiceStatus.id is ServiceId — the one place amendment 3 is enforced', () => {
    expectTypeOf<ServiceStatus['id']>().toEqualTypeOf<ServiceId>();
  });

  it('CheckRun is exact, and latencyMs stays nullable to encode a timeout', () => {
    expectTypeOf<CheckRun>().toEqualTypeOf<{
      at: string;
      check: string;
      region: string;
      result: 'pass' | 'fail' | 'timeout';
      latencyMs: number | null;
    }>();
  });
});

describe('contracts — incidents', () => {
  it('Severity is exactly 1 | 2 | 3 | info', () => {
    expectTypeOf<Severity>().toEqualTypeOf<1 | 2 | 3 | 'info'>();
  });

  it('BlastMetric is exact', () => {
    expectTypeOf<BlastMetric>().toEqualTypeOf<{
      label: string;
      value: string;
      note: string;
      level: 'normal' | 'warning' | 'error';
    }>();
  });

  it('TimelineEntry is exact', () => {
    expectTypeOf<TimelineEntry>().toEqualTypeOf<{
      at: string;
      title: string;
      body: string;
      kind: 'opened' | 'detected' | 'escalated' | 'vendor' | 'update' | 'resolved';
    }>();
  });

  it('Incident is exact, including the three-state muted shape', () => {
    expectTypeOf<Incident>().toEqualTypeOf<{
      id: string;
      severity: Severity;
      title: string;
      serviceId: string;
      openedAt: string;
      resolvedAt?: string;
      summary: string;
      metaParts: string[];
      ruleKey: string;
      blastRadius: BlastMetric[];
      timeline: TimelineEntry[];
      ack?: { by: string; at: string };
      muted?: { by: string; until: string | null };
    }>();
  });

  it('Incident.serviceId stays WIDER than ServiceId — deliberate, do not "fix" it', () => {
    // An incident can belong to a product source (e.g. 'endpointcentral') that is
    // not one of the seven vendor tiles. Narrowing this to ServiceId is a
    // regression, so assert the widening directly.
    expectTypeOf<'endpointcentral'>().toMatchTypeOf<Incident['serviceId']>();
    expectTypeOf<Incident['serviceId']>().not.toEqualTypeOf<ServiceId>();
  });
});

describe('contracts — entra', () => {
  it('EntraSignal is exact', () => {
    expectTypeOf<EntraSignal>().toEqualTypeOf<{
      key: 'risky_signin' | 'failed_spike' | 'legacy_auth' | 'mfa_gap'
         | 'expiring_credentials' | 'role_change' | 'guest_access' | 'ca_change';
      label: string;
      count: number;
      delta24h: number;
      severity: Severity;
      lastSeen: string;
    }>();
  });

  it('AuditEvent is exact', () => {
    expectTypeOf<AuditEvent>().toEqualTypeOf<{
      at: string;
      actor: string;
      action: string;
      target: string;
      result: 'success' | 'failure';
    }>();
  });

  it('EntraSnapshot is exact, including all eight stats', () => {
    expectTypeOf<EntraSnapshot>().toEqualTypeOf<{
      stats: {
        riskySignIns24h: number;
        riskyConfirmedCompromised: number;
        failedSignIns24h: number;
        failedSignInAccounts: number;
        mfaCoverage: number;
        mfaUnregistered: number;
        privilegedAccounts: number;
        globalAdmins: number;
      };
      signals: EntraSignal[];
      audit: AuditEvent[];
    }>();
  });
});

describe('contracts — endpoints', () => {
  it('EndpointIssue is exact, and os survives despite being cut from the table', () => {
    expectTypeOf<EndpointIssue>().toEqualTypeOf<{
      computer: string;
      assignedTo: string;
      os: string;
      issue: string;
      issueKind: 'stale_agent' | 'missing_patches' | 'no_bitlocker' | 'eol_build';
      lastCheckIn: string;
    }>();
  });

  it('EndpointSnapshot is exact', () => {
    expectTypeOf<EndpointSnapshot>().toEqualTypeOf<{
      stats: {
        total: number;
        patchCompliance: number;
        checkedIn7d: number;
        bitlockerEncrypted: number;
        criticalPatchesMissing: number;
      };
      attention: EndpointIssue[];
    }>();
  });
});

describe('contracts — email', () => {
  // NOTE: `reason`'s six documented literals are NOT observable in the type system.
  // TypeScript collapses `'Credential phishing' | ... | string` to plain `string`,
  // on both sides of the assertion, so this test cannot tell the documented union
  // from bare `string` and does not try to. The literals are enforced nowhere by
  // types; enforce them where they can be seen — a fixture assertion that every
  // reason is one of the six, and a default branch in the Email view.
  it('BlockedMessage is exact (reason degrades to string — see note above)', () => {
    expectTypeOf<BlockedMessage>().toEqualTypeOf<{
      at: string;
      from: string;
      to: string;
      reason: 'Credential phishing' | 'Impersonation' | 'Lookalike domain'
            | 'Malicious URL' | 'Malware' | 'Spam' | string;
      subject: string;
    }>();
  });

  it('EmailSnapshot is exact', () => {
    expectTypeOf<EmailSnapshot>().toEqualTypeOf<{
      stats: {
        processed24h: number;
        blocked24h: number;
        quarantined: number;
        quarantinePendingReview: number;
        credentialPhishing24h: number;
        credentialPhishingDelta: number;
      };
      recentBlocked: BlockedMessage[];
    }>();
  });
});

describe('contracts — log sources, rules and integrations', () => {
  it('LogSourceSnapshot is exact', () => {
    expectTypeOf<LogSourceSnapshot>().toEqualTypeOf<{
      sensors: { name: string; lastSeen: string; healthy: boolean }[];
      silentSources: { name: string; ip: string; lastEventAt: string }[];
    }>();
  });

  it('AlertRule is exact', () => {
    expectTypeOf<AlertRule>().toEqualTypeOf<{
      key: string;
      name: string;
      detail: string;
      enabled: boolean;
      threshold?: Record<string, number | string>;
    }>();
  });

  it('Integration is exact', () => {
    expectTypeOf<Integration>().toEqualTypeOf<{
      key: string;
      name: string;
      detail: string;
      state: 'connected' | 'polling' | 'needs_auth' | 'error';
      stateLabel: string;
      lastSuccessAt?: string;
    }>();
  });
});

// ---------------------------------------------------------------------------
// @contract-shapes-end
//
// Everything BELOW this marker uses deliberately malformed object literals as
// hostile probes — they are not contract shapes and must not be read as such.
// The three-way field-set guard in web/src/guards.test.ts stops extracting here.
//
// Moving a contract shape below this line does NOT silence the guard — it removes
// that shape from the comparison, and the document side immediately reports every
// one of its fields as missing. The sentinel can only ever hide an ADDITION below
// it, which is not a weakening. Hoisting the sentinel itself fails loudest of all.
// ---------------------------------------------------------------------------

describe('contracts — optional fields reject an explicit undefined', () => {
  // tsconfig.base.json sets exactOptionalPropertyTypes: true, which makes
  // `x?: string` and `x?: string | undefined` DIFFERENT types — only the second
  // legalises writing `x: undefined` explicitly. toEqualTypeOf cannot separate
  // them, so the exact-shape assertions above are blind to that widening. These
  // catch it, and they are aimed squarely at gate G1's "silent undefined" concern.

  it('VendorIncident.resolvedAt cannot be set to an explicit undefined', () => {
    expectTypeOf<{
      id: string; title: string; level: 'unknown'; startedAt: string; resolvedAt: undefined;
    }>().not.toMatchTypeOf<VendorIncident>();
  });

  it('SourceResult.empty and .error cannot be set to an explicit undefined', () => {
    expectTypeOf<{
      data: number; fetchedAt: string; degraded: boolean; empty: undefined;
    }>().not.toMatchTypeOf<SourceResult<number>>();
    expectTypeOf<{
      data: number; fetchedAt: string; degraded: boolean; error: undefined;
    }>().not.toMatchTypeOf<SourceResult<number>>();
  });

  it('Incident.ack and .muted cannot be set to an explicit undefined', () => {
    expectTypeOf<{
      id: string; severity: Severity; title: string; serviceId: string; openedAt: string;
      summary: string; metaParts: string[]; ruleKey: string; blastRadius: BlastMetric[];
      timeline: TimelineEntry[]; ack: undefined;
    }>().not.toMatchTypeOf<Incident>();
    expectTypeOf<{
      id: string; severity: Severity; title: string; serviceId: string; openedAt: string;
      summary: string; metaParts: string[]; ruleKey: string; blastRadius: BlastMetric[];
      timeline: TimelineEntry[]; muted: undefined;
    }>().not.toMatchTypeOf<Incident>();
  });
});
