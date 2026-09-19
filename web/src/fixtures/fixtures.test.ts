import { describe, it, expect } from 'vitest';
import { fixtures, serviceById, incidentById } from './index.js';

const ORDER = ['m365', 'proofpoint', 'jira', 'zendesk', 'helpjuice', 'claude', 'openai'];

describe('fixture shape', () => {
  it.each(['quiet', 'sev1'] as const)('%s has the seven verified services in order', (mode) => {
    expect(fixtures[mode].services.map((s) => s.id)).toEqual(ORDER);
  });

  it.each(['quiet', 'sev1'] as const)('%s gives every service 28 spark samples', (mode) => {
    for (const s of fixtures[mode].services) expect(s.spark).toHaveLength(28);
  });

  it.each(['quiet', 'sev1'] as const)('%s never pre-renders an svg point string', (mode) => {
    for (const s of fixtures[mode].services) {
      for (const v of s.spark) expect(typeof v).toBe('number');
    }
  });
});

describe('quiet mode', () => {
  const q = fixtures.quiet;

  it('has no open incidents', () => {
    expect(q.incidents).toHaveLength(0);
  });

  it('is affirmatively operational on both halves of every service', () => {
    for (const s of q.services) {
      expect(s.vendor.level).toBe('operational');
      expect(s.ours.level).toBe('operational');
    }
  });

  it('carries five closed incidents in recent history', () => {
    expect(q.recentHistory).toHaveLength(5);
  });
});

describe('sev1 mode', () => {
  const s = fixtures.sev1;

  it('opens four incidents, one per severity band the prototype shows', () => {
    expect(s.incidents.map((i) => i.severity)).toEqual([1, 2, 2, 3]);
  });

  it('degrades m365 on both halves, which is what makes the headline rule fire', () => {
    const m365 = serviceById('sev1', 'm365');
    expect(m365?.vendor.level).toBe('degraded');
    expect(m365?.ours.level).toBe('outage');
  });

  it('puts proofpoint on a vendor advisory with our probes merely slow', () => {
    const pfpt = serviceById('sev1', 'proofpoint');
    expect(pfpt?.vendor.level).toBe('degraded');
    expect(pfpt?.ours.level).toBe('degraded');
  });

  it('shows at least one unknown service so the neutral state is exercised', () => {
    expect(s.services.some((x) => x.vendor.level === 'unknown')).toBe(true);
  });

  it('never claims all-operational while anything is unknown', () => {
    expect(s.services.every((x) => x.vendor.level === 'operational')).toBe(false);
  });

  it('gives the Sev1 a full blast radius and a newest-first timeline', () => {
    const inc = incidentById('sev1', 'INC-2291');
    expect(inc?.blastRadius).toHaveLength(4);
    expect(inc?.timeline).toHaveLength(5);
    const times = inc!.timeline.map((t) => Date.parse(t.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('ties the Sev1 to the vendor rule', () => {
    expect(incidentById('sev1', 'INC-2291')?.ruleKey).toBe('vendor');
  });
});

describe('redaction', () => {
  const blob = JSON.stringify(fixtures);

  it('contains no real corporate identifiers', () => {
    expect(blob).not.toMatch(/@crexendo\.com/);
    expect(blob).not.toMatch(/CXDO-(LT|DT)-/);
  });

  it('uses only documentation-range IP addresses', () => {
    for (const ip of blob.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\w{1,3}\b/g) ?? []) {
      expect(ip.startsWith('203.0.113.')).toBe(true);
    }
  });
});

describe('integrations', () => {
  it('surfaces the real M365 consent blocker as the needs_auth row', () => {
    const row = fixtures.sev1.integrations.find((i) => i.state === 'needs_auth');
    expect(row?.name).toBe('M365 Service Health');
    expect(row?.detail).toContain('ServiceHealth.Read.All');
  });

  it('describes the vendor feed as the seven verified vendors, not the placeholder list', () => {
    const row = fixtures.sev1.integrations.find((i) => i.key === 'vendorstatus');
    expect(row?.detail).not.toMatch(/AWS|Okta|Cloudflare|GitHub/);
  });
});

describe('alert rules', () => {
  it('carries the six rules from DATA_CONTRACTS section 7 with the prototype defaults', () => {
    expect(fixtures.sev1.rules.map((r) => [r.key, r.enabled])).toEqual([
      ['vendor', true], ['spray', true], ['risky', true],
      ['secrets', true], ['stale', false], ['legacy', true],
    ]);
  });
});

// ------------------------------------------------------------------ G0 findings
// Two invariants the type system cannot express. Both were raised at gate G0 and
// assigned here, because a fixture is the only place they can be checked at all.

/** Incident.serviceId is deliberately `string` in the frozen contract: an incident
 *  can belong to a product source that is not one of the seven vendor tiles. The
 *  cost is that a typo renders /services/:id blank with no error, so the set of
 *  legitimate non-tile sources has to be enumerated somewhere. Here. */
const NON_TILE_SOURCES = ['endpointcentral'];

describe('every incident points at something that exists', () => {
  it.each(['quiet', 'sev1'] as const)('%s resolves every serviceId', (mode) => {
    const tiles = fixtures[mode].services.map((s) => s.id as string);
    const unresolved = fixtures[mode].incidents
      .map((i) => i.serviceId)
      .filter((id) => !tiles.includes(id) && !NON_TILE_SOURCES.includes(id));
    expect(unresolved).toEqual([]);
  });

  it('routes the three tile-backed incidents at m365 and the fourth at Endpoint Central', () => {
    expect(fixtures.sev1.incidents.map((i) => i.serviceId)).toEqual([
      'm365', 'm365', 'endpointcentral', 'm365',
    ]);
  });
});

/** BlockedMessage.reason documents a six-member union with a trailing `| string`,
 *  which TypeScript collapses to plain `string` — nothing in the type system checks
 *  the value. The Email view colours by reason, so an unlisted value falls through. */
const REASONS = [
  'Credential phishing', 'Impersonation', 'Lookalike domain',
  'Malicious URL', 'Malware', 'Spam',
];

describe('blocked-message reasons stay inside the documented union', () => {
  it.each(['quiet', 'sev1'] as const)('%s uses only documented reasons', (mode) => {
    for (const m of fixtures[mode].email.recentBlocked) expect(REASONS).toContain(m.reason);
  });
});

describe('the counts the two worlds are specified with', () => {
  it.each(['quiet', 'sev1'] as const)('%s has 7 services, 5 history rows, 5 check runs, 6 rules, 6 integrations', (mode) => {
    const b = fixtures[mode];
    expect({
      services: b.services.length,
      recentHistory: b.recentHistory.length,
      checkRuns: b.checkRuns.length,
      rules: b.rules.length,
      integrations: b.integrations.length,
      entraSignals: b.entra.signals.length,
      endpointsAttention: b.endpoints.attention.length,
      recentBlocked: b.email.recentBlocked.length,
    }).toEqual({
      services: 7, recentHistory: 5, checkRuns: 5, rules: 6, integrations: 6,
      entraSignals: 8, endpointsAttention: 6, recentBlocked: 5,
    });
  });

  it('quiet has no open incidents and sev1 has four', () => {
    expect(fixtures.quiet.incidents).toHaveLength(0);
    expect(fixtures.sev1.incidents).toHaveLength(4);
  });
});

describe('every timestamp is a real ISO instant in the past', () => {
  const stamps = (mode: 'quiet' | 'sev1'): string[] => {
    const b = fixtures[mode];
    return [
      ...b.services.flatMap((s) => [
        s.lastStateChange,
        ...(s.vendor.lastSuccessfulPoll === undefined ? [] : [s.vendor.lastSuccessfulPoll]),
        ...s.vendor.incidentsSince.map((v) => v.startedAt),
      ]),
      ...b.incidents.flatMap((i) => [i.openedAt, ...i.timeline.map((t) => t.at)]),
      ...b.checkRuns.map((c) => c.at),
      ...b.entra.audit.map((a) => a.at),
      ...b.entra.signals.map((s) => s.lastSeen),
      ...b.endpoints.attention.map((e) => e.lastCheckIn),
      ...b.email.recentBlocked.map((m) => m.at),
      ...b.integrations.flatMap((i) => (i.lastSuccessAt === undefined ? [] : [i.lastSuccessAt])),
    ];
  };

  it.each(['quiet', 'sev1'] as const)('%s parses and predates now', (mode) => {
    const now = Date.now();
    for (const at of stamps(mode)) {
      expect(Number.isNaN(Date.parse(at))).toBe(false);
      expect(Date.parse(at)).toBeLessThanOrEqual(now);
    }
  });
});

describe('the sev1 world does not contradict itself', () => {
  const s = fixtures.sev1;

  it('changes m365 state at the moment the Sev1 opened', () => {
    const inc = incidentById('sev1', 'INC-2291')!;
    expect(serviceById('sev1', 'm365')?.lastStateChange).toBe(inc.openedAt);
  });

  it('carries the same advisory on the service, its incidentsSince and the incident', () => {
    const m365 = serviceById('sev1', 'm365')!;
    const inc = incidentById('sev1', 'INC-2291')!;
    expect(m365.vendor.advisoryId).toBe('EX1084221');
    expect(m365.vendor.incidentsSince.map((v) => v.id)).toEqual(['EX1084221']);
    expect(m365.vendor.incidentsSince[0]?.startedAt).toBe(inc.openedAt);
    expect(inc.summary).toContain('EX1084221');
    expect(inc.metaParts).toContain('advisory EX1084221');
  });

  it('matches the failing probe count to the failing-probe note', () => {
    const m365 = serviceById('sev1', 'm365')!;
    expect(m365.ours.passing).toBe(1);
    expect(m365.ours.total).toBe(4);
    expect(s.checkRuns.filter((c) => c.result !== 'pass')).toHaveLength(1);
    expect(s.checkRuns.find((c) => c.result === 'timeout')?.latencyMs).toBeNull();
  });

  it('keeps every incident timeline newest first', () => {
    for (const inc of s.incidents) {
      const times = inc.timeline.map((t) => Date.parse(t.at));
      expect(times).toEqual([...times].sort((a, b) => b - a));
    }
  });

  it('opens every incident no later than its own first timeline entry', () => {
    for (const inc of s.incidents) {
      const opened = inc.timeline.filter((t) => t.kind === 'opened');
      expect(opened).toHaveLength(1);
      expect(opened[0]?.at).toBe(inc.openedAt);
    }
  });

  it('ties the failed sign-in spike to the Entra signal that produced it', () => {
    const spike = s.entra.signals.find((x) => x.key === 'failed_spike');
    expect(spike?.count).toBe(s.entra.stats.failedSignIns24h);
    expect(spike?.lastSeen).toBe(incidentById('sev1', 'INC-2290')?.openedAt);
  });

  it('leaves zendesk unknown rather than green, with the reason on the record', () => {
    const z = serviceById('sev1', 'zendesk')!;
    expect(z.vendor.level).toBe('unknown');
    expect(z.vendor.label).toBe('Unknown');
    expect(z.vendor.incidentsSince).toEqual([]);
    expect(z.vendor.note).toMatch(/absence is not an affirmation/i);
    expect(z.ours.level).toBe('operational');
  });

  it('badges the sidebar with exactly the open incident count', () => {
    expect(s.incidents.filter((i) => i.resolvedAt === undefined)).toHaveLength(4);
    expect(s.incidents.filter((i) => i.severity === 1)).toHaveLength(1);
  });
});

describe('the quiet world does not contradict itself either', () => {
  const q = fixtures.quiet;

  it('passes every check run', () => {
    expect(q.checkRuns.every((c) => c.result === 'pass')).toBe(true);
    expect(q.checkRuns.every((c) => typeof c.latencyMs === 'number')).toBe(true);
  });

  it('publishes no vendor incidents at all', () => {
    for (const s of q.services) expect(s.vendor.incidentsSince).toEqual([]);
  });

  it('keeps every probe passing four of four', () => {
    for (const s of q.services) {
      expect(s.ours.passing).toBe(4);
      expect(s.ours.total).toBe(4);
    }
  });
});

describe('lookups', () => {
  it('returns undefined rather than throwing for an id that is not there', () => {
    expect(serviceById('sev1', 'nope')).toBeUndefined();
    expect(incidentById('sev1', 'INC-9999')).toBeUndefined();
    expect(incidentById('quiet', 'INC-2291')).toBeUndefined();
  });

  it('finds what is there', () => {
    expect(serviceById('quiet', 'helpjuice')?.name).toBe('Helpjuice Knowledge Base');
    expect(incidentById('sev1', 'INC-2288')?.ruleKey).toBe('stale');
  });
});
