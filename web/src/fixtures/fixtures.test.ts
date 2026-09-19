import { describe, it, expect } from 'vitest';
import type { CheckRun, Incident } from '@ops-dash/shared';
import { fixtures, serviceById, incidentById, checkRunsFor } from './index.js';

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

  // Inverted from the plan's original, on John's decision. The Zendesk SSP has
  // no per-service status field, so its level is `unknown` in BOTH worlds — an
  // adapter does not gain the ability to tell "healthy" from "heard nothing"
  // because the day is quiet. Amendment 1 then makes ALL SYSTEMS OPERATIONAL
  // unreachable, in the fixtures and in production alike, and the quiet strip
  // reads "6 AFFIRMED · 1 UNKNOWN". A quiet world that claimed the all-clear
  // would be showing a screen the live system can never render.
  it('affirms five services and leaves two unknown', () => {
    const levels = q.services.map((s) => s.vendor.level);
    expect(levels.filter((l) => l === 'operational')).toHaveLength(5);
    expect(levels.filter((l) => l === 'unknown')).toHaveLength(2);
    expect(q.services.filter((s) => s.vendor.level === 'unknown').map((s) => s.id))
      .toEqual(['m365', 'zendesk']);
  });

  it('cannot claim all systems operational', () => {
    expect(q.services.every((s) => s.vendor.level === 'operational')).toBe(false);
  });

  it('keeps our own probes green on every service', () => {
    for (const s of q.services) expect(s.ours.level).toBe('operational');
  });

  it('carries five closed incidents in recent history', () => {
    expect(q.recentHistory).toHaveLength(5);
  });
});

describe('sev1 mode', () => {
  const s = fixtures.sev1;

  // Five, not the plan's four (G-13). The vendor correlation moved to Proofpoint
  // because its Status.io feed is readable, and m365 keeps the Exchange story on
  // our own probe evidence — two distinct detection stories, both Sev1 under
  // John's ruling. Compressing them into one incident to preserve the number
  // four would have hidden exactly the distinction the ruling is about.
  it('opens five incidents across the severity bands', () => {
    expect(s.incidents.map((i) => i.severity)).toEqual([1, 1, 2, 2, 3]);
    expect(s.incidents.map((i) => i.id)).toEqual([
      'INC-2292', 'INC-2291', 'INC-2290', 'INC-2288', 'INC-2286',
    ]);
  });

  // Inverted from the plan's original (HIGH-4). The plan had m365 degraded on
  // both halves, "which is what makes the headline rule fire" — but we cannot
  // see M365 vendor health at all: there is no public per-workload feed, and
  // Graph Service Health consent is still pending, which `rules.ts` records as
  // a needs_auth integration that has never had a successful poll. The vendor
  // half is therefore `unknown`, our half is real and failing, and the Sev1
  // rests on our probes alone. That is the screen the live system can render.
  it('leaves m365 blind on the vendor half and failing on ours', () => {
    const m365 = serviceById('sev1', 'm365');
    expect(m365?.vendor.level).toBe('unknown');
    expect(m365?.ours.level).toBe('outage');
  });

  it('never claims a successful poll from a feed that has never authenticated', () => {
    const m365 = serviceById('sev1', 'm365');
    expect(m365?.vendor.lastSuccessfulPoll).toBeUndefined();
    expect('lastSuccessfulPoll' in (m365?.vendor ?? {})).toBe(false);
    expect(m365?.vendor.note).toContain('ServiceHealth.Read.All');
    const consent = fixtures.sev1.integrations.find((i) => i.key === 'm365health');
    expect(consent?.state).toBe('needs_auth');
    expect(consent?.lastSuccessAt).toBeUndefined();
  });

  // Inverted from the plan's "our probes merely slow" (G-13). Proofpoint now
  // carries the headline correlation, and a Sev1 whose own half is 'slow' would
  // be a severity the impact does not support. Both halves are bad, from two
  // independent sources, which is the whole point of the rule.
  it('degrades proofpoint on both halves, which is what makes the headline rule fire', () => {
    const pfpt = serviceById('sev1', 'proofpoint');
    expect(pfpt?.vendor.level).toBe('degraded');
    expect(pfpt?.ours.level).toBe('outage');
    expect(pfpt?.ours.passing).toBe(2);
    expect(pfpt?.ours.total).toBe(4);
  });

  it('opens the headline Sev1 from a rule that could actually fire', () => {
    const inc = incidentById('sev1', 'INC-2292');
    const pfpt = serviceById('sev1', 'proofpoint');
    expect(inc?.severity).toBe(1);
    expect(inc?.serviceId).toBe('proofpoint');
    expect(inc?.ruleKey).toBe('vendor');
    // The rule's preconditions, both readable by a live poll: this is the
    // difference between a demo that is reproducible and one that is staged.
    expect(pfpt?.vendor.level).toBe('degraded');
    expect(pfpt?.vendor.lastSuccessfulPoll).toBeDefined();
    expect(pfpt?.vendor.incidentsSince.map((v) => v.id)).toEqual(['hs-8841']);
    expect(inc?.timeline.find((t) => t.kind === 'opened')?.body).toMatch(/auto-created/i);
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

  it('routes each incident at the service it actually belongs to', () => {
    expect(fixtures.sev1.incidents.map((i) => i.serviceId)).toEqual([
      'proofpoint', 'm365', 'm365', 'endpointcentral', 'm365',
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
  it.each(['quiet', 'sev1'] as const)('%s has 7 services, 5 history rows, 6 rules, 6 integrations', (mode) => {
    const b = fixtures[mode];
    expect({
      services: b.services.length,
      recentHistory: b.recentHistory.length,
      rules: b.rules.length,
      integrations: b.integrations.length,
      entraSignals: b.entra.signals.length,
    }).toEqual({ services: 7, recentHistory: 5, rules: 6, integrations: 6, entraSignals: 8 });
  });

  it.each(['quiet', 'sev1'] as const)('%s gives all seven services five check runs of their own', (mode) => {
    for (const s of fixtures[mode].services) {
      const runs = checkRunsFor(mode, s.id);
      expect(runs).toHaveLength(5);
      // Every probe name belongs to this service, not to whichever service
      // happened to be first: a single shared array put m365's mailflow probe
      // on six other vendors' detail pages.
      expect(new Set(runs.map((r) => r.check)).size).toBeGreaterThanOrEqual(2);
    }
  });

  it('quiet has no open incidents and sev1 has five', () => {
    expect(fixtures.quiet.incidents).toHaveLength(0);
    expect(fixtures.sev1.incidents).toHaveLength(5);
  });
});

/** Every check run in a bundle, across all seven services. */
const allRuns = (mode: 'quiet' | 'sev1'): CheckRun[] =>
  fixtures[mode].services.flatMap((s) => checkRunsFor(mode, s.id));

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
      ...allRuns(mode).map((c) => c.at),
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

  // The one deliberate exception: a maintenance window is announced, so it is
  // the only fixture timestamp allowed to postdate now.
  it('schedules maintenance in the future and ends it after it starts', () => {
    const windows = [...fixtures.quiet.services, ...fixtures.sev1.services]
      .map((s) => s.vendor.maintenance)
      .filter((m) => m !== undefined);
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(Date.parse(w.scheduledFor)).toBeGreaterThan(Date.now());
      expect(Date.parse(w.scheduledUntil)).toBeGreaterThan(Date.parse(w.scheduledFor));
    }
  });
});

describe('amendment 2 is reachable on a screen', () => {
  it('puts one service into a scheduled maintenance window', () => {
    const inMaintenance = fixtures.sev1.services.filter((s) => s.vendor.level === 'maintenance');
    expect(inMaintenance.map((s) => s.id)).toEqual(['helpjuice']);
    const only = inMaintenance[0];
    expect(only?.vendor.label).toBe('Maintenance');
    expect(only?.vendor.maintenance?.title).toBe('Search index rebuild');
    // Maintenance is not a fault: our own probes are unaffected.
    expect(only?.ours.level).toBe('operational');
  });

  it('records the vendor incidents a maintenance window did not produce', () => {
    // `incidentsSince` is everything published since the last successful poll,
    // not a current-state diff, so an announcement with no incident is [].
    expect(serviceById('sev1', 'helpjuice')?.vendor.incidentsSince).toEqual([]);
  });
});

describe('the numbers on the response-time card agree with the curve', () => {
  it.each(['quiet', 'sev1'] as const)('%s derives latency, p50 and p95 from the series', (mode) => {
    for (const s of fixtures[mode].services) {
      const sorted = [...s.spark].sort((a, b) => a - b);
      expect(s.latencyMs).toBe(s.spark[s.spark.length - 1]);
      expect(s.p50Ms).toBeGreaterThanOrEqual(sorted[0] ?? 0);
      expect(s.p50Ms).toBeLessThanOrEqual(s.p95Ms);
      // At most 5% of 28 samples — one — may sit above p95. Zero is possible
      // when the two highest samples tie, which is why this is a bound and not
      // an equality. The plan's flat p95 left ten samples above the line.
      expect(s.spark.filter((v) => v > s.p95Ms).length).toBeLessThanOrEqual(1);
    }
  });

  it('makes "above p95" true of proofpoint rather than decorative', () => {
    const pfpt = serviceById('sev1', 'proofpoint')!;
    const runs = checkRunsFor('sev1', 'proofpoint');
    expect(pfpt.ours.note).toContain('above p95');
    expect(pfpt.latencyMs).toBeGreaterThan(pfpt.p95Ms);
    // The two regions the note says are still delivering must both be above
    // p95, and the slowest of them is the number the tile shows as latencyMs.
    const surviving = runs.filter((r) => r.result === 'pass' && r.check.startsWith('Mail'));
    expect(surviving.map((r) => r.region).sort()).toEqual(['ap-south', 'us-west']);
    for (const r of surviving) expect(r.latencyMs).toBeGreaterThan(pfpt.p95Ms);
    expect(runs.some((r) => r.latencyMs === pfpt.latencyMs)).toBe(true);
    // And the failing regions are named, not merely counted.
    expect(runs.filter((r) => r.result !== 'pass').map((r) => r.region)).toEqual(['us-east', 'eu-west']);
    for (const region of ['us-east', 'eu-west']) expect(pfpt.ours.note).toContain(region);
  });

  it('anchors proofpoint\'s "last vendor update" to its own timeline entry', () => {
    const entry = incidentById('sev1', 'INC-2292')?.timeline.find((t) => t.kind === 'vendor');
    const minutes = Math.round((Date.now() - Date.parse(entry?.at ?? '')) / 60_000);
    expect(serviceById('sev1', 'proofpoint')?.vendor.note)
      .toContain(`Last vendor update ${minutes} minutes ago`);
  });
});

describe('the copy quotes the timestamps it sits beside', () => {
  it('quotes no vendor update time on a tile with no vendor feed', () => {
    // This assertion replaced one that anchored "Last vendor update N minutes
    // ago" to the timeline; under HIGH-4 the m365 tile has no vendor update to
    // quote at all, and saying otherwise is the lie the whole ruling is about.
    const note = serviceById('sev1', 'm365')?.vendor.note ?? '';
    expect(note).not.toMatch(/last vendor update/i);
    expect(note).not.toMatch(/no advisories posted/i);
  });

  it('cannot queue the oldest message after the incident opened', () => {
    const inc = incidentById('sev1', 'INC-2291')!;
    const oldest = inc.blastRadius.find((b) => b.label === 'Oldest message');
    const minutes = Number(/(\d+)h (\d+)m/.exec(oldest?.value ?? '')?.[1]) * 60
      + Number(/(\d+)h (\d+)m/.exec(oldest?.value ?? '')?.[2]);
    const queuedAt = Date.now() - minutes * 60_000;
    expect(queuedAt).toBeLessThanOrEqual(Date.parse(inc.openedAt));
  });

  it('leaves no hard-coded wall-clock literal in the incident copy', () => {
    // Every HH:MM in the fixtures is derived from an anchor. A literal would
    // drift away from the timestamp it describes the moment the app is opened
    // at a different hour, and the Overview row and incident hero would disagree.
    for (const inc of fixtures.sev1.incidents) {
      const opened = inc.metaParts.find((p) => p.startsWith('opened '));
      const stamp = /(\d{2}):(\d{2})/.exec(opened ?? '');
      if (!stamp) continue;
      const d = new Date(inc.openedAt);
      expect(stamp[0]).toBe(
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      );
    }
  });
});

/** Every piece of prose an incident renders. */
const incidentProse = (i: Incident): string =>
  [
    i.summary,
    ...i.metaParts,
    ...i.blastRadius.flatMap((b) => [b.label, b.value, b.note]),
    ...i.timeline.flatMap((t) => [t.title, t.body, t.kind]),
  ].join(' | ');

describe('no incident may cite vendor evidence for a service we cannot see', () => {
  // The general form of G-13, and the reason it is worth a test rather than a
  // fix: the specific instance was m365 quoting advisory EX1084221 while its
  // vendor feed had never once authenticated. At Milestone 2, when adapters
  // start writing real data, an `unknown` vendor level paired with vendor-
  // sourced incident prose is the same bug arriving from a different direction.
  const VENDOR_EVIDENCE = [
    /\badvisory\s+[a-z]{2,}-?\d{3,}/i,  // 'advisory EX1084221', 'advisory hs-8841'
    /\bvendor\s+(confirmed|reports?|says|posted|update)/i,
    /\bstatus\s*(page|\.io)\b/i,
    /\bposted\s+[a-z]{2,}-?\d{3,}/i,
  ];

  it.each(['quiet', 'sev1'] as const)('%s keeps blind services free of vendor claims', (mode) => {
    const blind = new Set(
      fixtures[mode].services.filter((s) => s.vendor.level === 'unknown').map((s) => s.id as string),
    );
    expect(blind.size).toBeGreaterThan(0);
    for (const inc of fixtures[mode].incidents) {
      if (!blind.has(inc.serviceId)) continue;
      const prose = incidentProse(inc);
      for (const pattern of VENDOR_EVIDENCE) {
        expect({ id: inc.id, cites: pattern.exec(prose)?.[0] ?? null }).toEqual({
          id: inc.id,
          cites: null,
        });
      }
      // 'vendor' is a timeline kind that means "the vendor told us something".
      expect(inc.timeline.some((t) => t.kind === 'vendor')).toBe(false);
    }
  });

  it.each(['quiet', 'sev1'] as const)('%s only fires the vendor rule where the vendor half is readable', (mode) => {
    for (const inc of fixtures[mode].incidents) {
      const opened = inc.timeline.find((t) => t.kind === 'opened');
      if (inc.ruleKey !== 'vendor' || !/auto-created/i.test(opened?.body ?? '')) continue;
      const svc = fixtures[mode].services.find((x) => x.id === inc.serviceId);
      // Amendment 1: `unknown` never satisfies the vendor side of the rule.
      expect(svc?.vendor.level).not.toBe('unknown');
      expect(['degraded', 'outage']).toContain(svc?.vendor.level);
      expect(svc?.vendor.lastSuccessfulPoll).toBeDefined();
    }
  });

  it('states on the incident itself why the blind service could not auto-open', () => {
    const opened = incidentById('sev1', 'INC-2291')?.timeline.find((t) => t.kind === 'opened');
    expect(opened?.body).toMatch(/could not fire/i);
    expect(opened?.body).toMatch(/consent is pending/i);
  });
});

describe('a disabled rule cannot have produced an incident', () => {
  it('reconciles INC-2288 with the Agent stale rule being off', () => {
    const stale = fixtures.sev1.rules.find((r) => r.key === 'stale');
    const inc = incidentById('sev1', 'INC-2288');
    expect(stale?.enabled).toBe(false);
    expect(inc?.ruleKey).toBe('stale');
    const opened = inc?.timeline.find((t) => t.kind === 'opened');
    // The rule is off, so nothing fired: this one says it was raised by hand.
    expect(opened?.body).not.toMatch(/auto-created/i);
    expect(opened?.body).toMatch(/by hand/i);
  });

  it('keeps every other incident attributable to an enabled rule', () => {
    const enabled = new Set(fixtures.sev1.rules.filter((r) => r.enabled).map((r) => r.key));
    for (const inc of fixtures.sev1.incidents) {
      const opened = inc.timeline.find((t) => t.kind === 'opened');
      if (/auto-created/i.test(opened?.body ?? '')) expect(enabled.has(inc.ruleKey)).toBe(true);
    }
  });
});

describe('the sev1 world does not contradict itself', () => {
  const s = fixtures.sev1;

  it('changes m365 state at the moment the Sev1 opened', () => {
    const inc = incidentById('sev1', 'INC-2291')!;
    expect(serviceById('sev1', 'm365')?.lastStateChange).toBe(inc.openedAt);
  });

  it('carries no vendor-sourced evidence at all on the blind service', () => {
    // EX1084221 is gone from the fixtures entirely. It was only ever readable
    // by a human in the admin centre, and an incident that quotes an advisory
    // id implies a feed behind it. The absence is now the story: the timeline
    // says we looked and found nothing, which is different from forgetting to.
    const m365 = serviceById('sev1', 'm365')!;
    const inc = incidentById('sev1', 'INC-2291')!;
    expect(m365.vendor.advisoryId).toBeUndefined();
    expect(m365.vendor.incidentsSince).toEqual([]);
    expect(JSON.stringify(fixtures)).not.toContain('EX1084221');
    expect(inc.metaParts).toContain('no vendor signal');
    expect(inc.timeline.some((t) => t.kind === 'vendor')).toBe(false);
    expect(inc.timeline.map((t) => t.title)).toContain('No vendor statement available');
  });

  it('does not let the Sev1 rest on a vendor half we cannot see', () => {
    // Amendment 1: `unknown` never satisfies the vendor side of the rule, so
    // the rule cannot have fired and the incident must not claim it did.
    const inc = incidentById('sev1', 'INC-2291')!;
    expect(inc.ruleKey).toBe('vendor');
    expect(serviceById('sev1', 'm365')?.vendor.level).toBe('unknown');
    const opened = inc.timeline.find((t) => t.kind === 'opened');
    expect(opened?.body).not.toMatch(/auto-created/i);
    expect(opened?.body).toMatch(/by hand/i);
    expect(opened?.body).toMatch(/consent is pending/i);
  });

  it('matches the failing probe count to the failing-probe note', () => {
    const m365 = serviceById('sev1', 'm365')!;
    expect(m365.ours.passing).toBe(1);
    expect(m365.ours.total).toBe(4);
    const runs = checkRunsFor('sev1', 'm365');
    const failed = runs.filter((c) => c.result !== 'pass');
    // Named, not merely counted: the note calls out three regions by name, and
    // flipping only the newest row left two of them visibly green in the table.
    expect(failed.map((c) => c.region)).toEqual(['us-east', 'us-west', 'eu-west']);
    for (const c of failed) expect(c.latencyMs).toBeNull();
    expect(runs.find((c) => c.region === 'ap-south')?.result).toBe('pass');
    for (const region of ['us-east', 'us-west', 'eu-west']) {
      expect(m365.ours.note).toContain(region);
    }
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

  it('keeps our own half real on a service whose vendor half is blind', () => {
    // The two halves are independently sourced, which is the point of the page.
    // Being unable to see Microsoft's claim does not stop our probes working,
    // and our probes failing is what the operator needs to act on.
    const m365 = serviceById('sev1', 'm365')!;
    expect(m365.vendor.level).toBe('unknown');
    expect(m365.ours.level).toBe('outage');
    expect(m365.ours.passing).toBe(1);
    expect(serviceById('quiet', 'm365')?.ours.level).toBe('operational');
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
    expect(s.incidents.filter((i) => i.resolvedAt === undefined)).toHaveLength(5);
    expect(s.incidents.filter((i) => i.severity === 1)).toHaveLength(2);
  });
});

describe('the quiet world does not contradict itself either', () => {
  const q = fixtures.quiet;

  it('passes every check run', () => {
    const runs = allRuns('quiet');
    expect(runs.every((c) => c.result === 'pass')).toBe(true);
    expect(runs.every((c) => typeof c.latencyMs === 'number')).toBe(true);
  });

  it('publishes no vendor incidents at all', () => {
    for (const s of q.services) expect(s.vendor.incidentsSince).toEqual([]);
  });

  it('is quieter than the Sev1 world on every security page, not just the tiles', () => {
    expect(q.entra.stats.failedSignIns24h).toBeLessThan(fixtures.sev1.entra.stats.failedSignIns24h);
    expect(q.entra.stats.riskyConfirmedCompromised).toBe(0);
    // No open incident means no rule fired, so nothing may be sitting on the
    // Entra page that a rule would have raised an incident for.
    expect(q.entra.signals.find((x) => x.key === 'expiring_credentials')?.count).toBe(0);
    expect(q.endpoints.attention.some((e) => e.issueKind === 'stale_agent')).toBe(false);
    expect(q.endpoints.stats.patchCompliance).toBeGreaterThan(fixtures.sev1.endpoints.stats.patchCompliance);
    expect(q.email.stats.credentialPhishingDelta).toBeLessThan(0);
  });

  it('keeps every probe passing four of four', () => {
    for (const s of q.services) {
      expect(s.ours.passing).toBe(4);
      expect(s.ours.total).toBe(4);
    }
  });
});

describe('lookups', () => {
  it('returns an empty check list for an id that is not a service', () => {
    // The detail page indexes by route param, i.e. an arbitrary string. This has
    // to be total, or a bad URL reads a Record with a key it does not have.
    expect(checkRunsFor('sev1', 'nope')).toEqual([]);
    expect(checkRunsFor('sev1', 'constructor')).toEqual([]);
    expect(checkRunsFor('sev1', '__proto__')).toEqual([]);
  });

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
