import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchLike } from '../http/fetchJson.js';
import { createApp, CORRELATE_SOURCE, PRUNE_SOURCE } from '../index.js';
import type { ProbeSpec } from '../adapters/synthetic/probe.js';

/**
 * Milestone 2's deliverable, and the reason the milestone exists.
 *
 * Everything before this was tested against payloads we chose, one layer at a
 * time. This drives the WHOLE chain — store, adapters, poller, engine, API —
 * from the real payloads captured off the live feeds, with only `fetch` stubbed.
 * No layer of ours is mocked. If the correlation rule is wrong, or the store
 * loses a row, or the composition root spells a key two ways, it fails here and
 * nowhere else.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'adapters', 'vendorstatus', '__fixtures__');
const load = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>;

/** The committed captures, keyed by the URL `vendors.json` actually requests. */
function realPayloads(): Map<string, unknown> {
  return new Map<string, unknown>([
    ['https://api.status.io/1.0/status/591aaa7fe69f388425000fda', load('statusio-hornet.json')],
    ['https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews', load('msgraph-health-overviews.json')],
    ['https://jira-software.status.atlassian.com/api/v2/summary.json', load('statuspage-jira-summary.json')],
    ['https://status.helpjuice.com/api/v2/summary.json', load('statuspage-helpjuice-summary.json')],
    ['https://status.claude.com/api/v2/summary.json', load('statuspage-claude-summary.json')],
    ['https://status.openai.com/api/v2/summary.json', load('statuspage-openai-summary.json')],
    // Pod-scoped, one per tenant — the adapter queries both accounts and the
    // stub refuses anything it was not given, which is how this caught the
    // change rather than quietly reporting an empty Zendesk.
    ['https://status.zendesk.com/api/ssp/incidents.json?subdomain=crexendo', load('zendesk-ssp-incidents.json')],
    ['https://status.zendesk.com/api/ssp/incidents.json?subdomain=netsapiens', load('zendesk-ssp-incidents.json')],
    ['https://status.zendesk.com/api/ssp/services.json?subdomain=crexendo', load('zendesk-ssp-services.json')],
  ]);
}

/**
 * A stub that serves the captures and 404s anything else.
 *
 * Deliberately NOT a permissive stub. A URL this map does not know is a URL the
 * chain invented — a typo in `vendors.json`, a path an adapter appended by
 * mistake — and the only way to notice is to refuse it loudly. A stub that
 * returned `{}` for an unknown URL would let a misdirected fetch read as an
 * empty feed, which is exactly the "nothing is wrong" / "we could not look"
 * confusion this product exists to prevent.
 */
function stubFetch(
  payloads: Map<string, unknown>,
  probeStatus: (url: string) => number = () => 200,
): { impl: FetchLike; asked: string[] } {
  const asked: string[] = [];
  const impl: FetchLike = async (url) => {
    const href = String(url);
    asked.push(href);
    if (payloads.has(href)) {
      return new Response(JSON.stringify(payloads.get(href)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Everything else is a synthetic probe target.
    return new Response('', { status: probeStatus(href) });
  };
  return { impl, asked };
}

/** Deterministic probes, so a test asserting "our half is failing" is asserting
 *  the rule and not the estate. Mirrors the real list's shape: two Zendesk pods
 *  on one tile, one of which expects a 401. */
const PROBES: ProbeSpec[] = [
  { serviceId: 'zendesk', check: 'Zendesk pod: crexendo', url: 'https://probe.test/zendesk-a', region: 'us-east' },
  { serviceId: 'zendesk', check: 'Zendesk pod: netsapiens', url: 'https://probe.test/zendesk-b', region: 'us-east', expectStatus: 401 },
  { serviceId: 'helpjuice', check: 'Helpjuice knowledge base', url: 'https://probe.test/helpjuice', region: 'us-east' },
];

/** Every probe answering the way it answers when it is well. */
const allWell = (url: string) => (url.endsWith('zendesk-b') ? 401 : 200);

/** A Graph token that is obviously fake. Every integration test passes one, so
 *  the m365 adapter is exercised end to end — and no test in this repo can
 *  reach the real credential by forgetting to stub something, because
 *  `createApp` has no token source unless it is handed one. */
const stubTokens = { get: async () => ({ token: 'integration-stub' }), reset: () => {} } as never;

const app = (impl: FetchLike, now: () => Date) =>
  createApp({ dbPath: ':memory:', fetchImpl: impl, now, probes: PROBES, tokens: stubTokens });

/**
 * One deterministic cycle of the READING sources — every vendor feed and the
 * probes — and deliberately not the correlation source.
 *
 * Correlation is left to an explicit `correlateNow(at)` in each test so that
 * every test states the instant it is correlating and correlates exactly once.
 * Running it here as well cost an hour: the engine emits nothing for a
 * condition that is already resolved and still clear (which is right — a
 * resolved incident is not news twice), so a hidden first correlation inside
 * `cycle` made the explicit one return an empty list, and the resolution test
 * failed while the code was behaving perfectly.
 */
async function cycle(a: ReturnType<typeof createApp>) {
  for (const source of a.sources) {
    if (source.name === CORRELATE_SOURCE) continue;
    await source.run();
  }
}

/** A statuspage capture with one component flipped. Returns a NEW object; the
 *  committed fixture is never mutated, because a test that edits a fixture in
 *  place poisons every test that runs after it in the same file. */
function withComponentStatus(payload: Record<string, unknown>, index: number, status: string) {
  const components = (payload['components'] as Record<string, unknown>[]).map((c, i) =>
    i === index ? { ...c, status } : { ...c },
  );
  return { ...payload, components };
}

const SEV1 = 1;

describe('the chain, end to end, on the real captured payloads', () => {
  it("reads every configured feed and writes a snapshot under the API's own key", async () => {
    const { impl, asked } = stubFetch(realPayloads(), allWell);
    const a = app(impl, () => new Date('2026-09-19T12:00:00.000Z'));
    await cycle(a);

    // Every vendors.json URL was actually requested. The stub refuses unknown
    // URLs, so this also proves no adapter invented a path.
    for (const feed of a.feeds) expect(asked.some((u) => u.startsWith(feed.url))).toBe(true);

    // And the snapshot reads back under the key the API serves from. A key
    // spelled two ways reads as `never_polled`, indistinguishable from a source
    // nobody configured.
    for (const feed of a.feeds) {
      const snapshot = a.store.getSnapshot(`vendor:${feed.id}`);
      expect(snapshot, `no snapshot for ${feed.id}`).toBeDefined();
      expect(snapshot!.error, `${feed.id} errored on a good payload`).toBeUndefined();
    }
  });

  it('opens nothing when every real feed is healthy and every probe passes', async () => {
    // The control, and it is not a formality: a rule that fires on the captured
    // payloads — all of which were taken on a quiet day — fires on nothing.
    const { impl } = stubFetch(realPayloads(), allWell);
    const a = app(impl, () => new Date('2026-09-19T12:00:00.000Z'));
    await cycle(a);
    expect(a.correlateNow('2026-09-19T12:00:00.000Z')).toEqual([]);
    expect(a.store.openIncidents()).toEqual([]);
  });

  it('never renders a service green that it could not read', async () => {
    // Two of the seven have no adapter until M3. They must appear, as unknown,
    // and must not satisfy the vendor half. CLAUDE.md: "ALL SYSTEMS OPERATIONAL
    // is unreachable in production" — that is this, asserted.
    const { impl } = stubFetch(realPayloads(), allWell);
    const a = app(impl, () => new Date('2026-09-19T12:00:00.000Z'));
    await cycle(a);

    const byId = Object.fromEntries(a.signals().map((s) => [s.serviceId, s]));
    expect(Object.keys(byId)).toHaveLength(7);
    // All seven now carry live vendor data. The two levels below are read off
    // the captured payloads and are real: Hornet.email was in a planned window
    // in our datacentre, and four of the seven Microsoft services we depend on
    // were in serviceDegradation, on 2026-09-19.
    expect(byId['proofpoint']!.vendor).toMatchObject({ level: 'maintenance', platform: 'statusio' });
    expect(byId['m365']!.vendor).toMatchObject({ level: 'degraded', platform: 'msgraph' });
    expect(byId['m365']!.vendor.errorCode).toBeUndefined();
    expect(byId['proofpoint']!.vendor.errorCode).toBeUndefined();
    expect(byId['jira']!.vendor.level).toBe('operational');
    // Nothing is unknown any more, which is the milestone's headline — and the
    // assertion that will fail the day a feed is dropped from the config.
    expect(a.signals().filter((s) => s.vendor.level === 'unknown')).toEqual([]);
  });
});

describe('the simulated outage', () => {
  /** Claude's capture, with its first component in a major outage, and the
   *  helpjuice probe failing. Both halves of the `vendor` rule, on two
   *  different services, so neither can be satisfied by accident. */
  function outage(): Map<string, unknown> {
    const payloads = realPayloads();
    const claude = payloads.get('https://status.claude.com/api/v2/summary.json') as Record<string, unknown>;
    payloads.set('https://status.claude.com/api/v2/summary.json', withComponentStatus(claude, 0, 'major_outage'));
    return payloads;
  }

  /** Claude has no probe in this list, so to satisfy our half for claude we add
   *  one and fail it. Without it the rule must NOT fire — which the next test
   *  asserts, because that is amendment 1's whole point. */
  const CLAUDE_PROBE: ProbeSpec = {
    serviceId: 'claude', check: 'Claude API', url: 'https://probe.test/claude', region: 'us-east',
  };

  const outageApp = (probeStatus: (u: string) => number, now: string) =>
    createApp({
      dbPath: ':memory:',
      fetchImpl: stubFetch(outage(), probeStatus).impl,
      now: () => new Date(now),
      probes: [...PROBES, CLAUDE_PROBE],
    });

  it('opens a Sev1 when the vendor says outage AND our check is failing', async () => {
    const a = outageApp((u) => (u.endsWith('claude') ? 503 : allWell(u)), '2026-09-19T12:00:00.000Z');
    await cycle(a);

    const incidents = a.correlateNow('2026-09-19T12:00:00.000Z');
    const sev1 = incidents.filter((i) => i.severity === SEV1);
    expect(sev1).toHaveLength(1);
    expect(sev1[0]!.ruleKey).toBe('vendor');
    expect(sev1[0]!.serviceId).toBe('claude');
    expect(sev1[0]!.resolvedAt).toBeUndefined();

    // And it is in the store, readable by the API, with the severity round
    // tripping through a TEXT column rather than coming back as "1.0".
    const rows = a.store.openIncidents();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!['id'])).toBe(sev1[0]!.id);
  });

  it('does NOT open a Sev1 when the vendor is in outage but our check passes', async () => {
    // Half the rule is not the rule. Claude being down for the world while our
    // probe of it succeeds is a real and common state, and it is not our Sev1.
    const a = outageApp(allWell, '2026-09-19T12:00:00.000Z');
    await cycle(a);
    expect(a.correlateNow('2026-09-19T12:00:00.000Z').filter((i) => i.severity === SEV1)).toEqual([]);
  });

  it('keeps the same incident id on a second run, so an ack cannot be orphaned', async () => {
    // The property the whole id scheme exists for. Asserted across two
    // independent runs of the chain a minute apart — not by reading the id back
    // out of the object that produced it.
    const first = outageApp((u) => (u.endsWith('claude') ? 503 : allWell(u)), '2026-09-19T12:00:00.000Z');
    await cycle(first);
    const a1 = first.correlateNow('2026-09-19T12:00:00.000Z').find((i) => i.severity === SEV1)!;

    const a2 = first.correlateNow('2026-09-19T12:01:00.000Z').find((i) => i.severity === SEV1)!;
    expect(a2.id).toBe(a1.id);
    expect(a2.openedAt).toBe(a1.openedAt);
    expect(first.store.openIncidents()).toHaveLength(1);
  });

  it('resolves the incident when the component recovers, rather than opening a second', async () => {
    // Step 3's last clause, and the one that would most easily pass for the
    // wrong reason: "one row" is also what you get if resolution never happened
    // and the id simply collided. So assert resolution positively — resolvedAt
    // set, on the SAME id — and that the store holds nothing open.
    const a = outageApp((u) => (u.endsWith('claude') ? 503 : allWell(u)), '2026-09-19T12:00:00.000Z');
    await cycle(a);
    const opened = a.correlateNow('2026-09-19T12:00:00.000Z').find((i) => i.severity === SEV1)!;
    expect(a.store.openIncidents()).toHaveLength(1);

    // Now everything is well: healthy payloads, every probe passing.
    const recovered = createApp({
      dbPath: ':memory:',
      fetchImpl: stubFetch(realPayloads(), allWell).impl,
      now: () => new Date('2026-09-19T12:05:00.000Z'),
      probes: [...PROBES, CLAUDE_PROBE],
    });
    // Carry the open incident across, which is what a restart or the next tick
    // against the same database would see.
    recovered.store.putIncident({
      id: opened.id, ruleKey: opened.ruleKey, serviceId: opened.serviceId,
      severity: '1', openedAt: opened.openedAt, resolvedAt: null, summary: opened.summary,
    });
    await cycle(recovered);

    const after = recovered.correlateNow('2026-09-19T12:05:00.000Z');
    const resolved = after.find((i) => i.id === opened.id);
    expect(resolved, 'the original incident was not carried forward at all').toBeDefined();
    expect(resolved!.resolvedAt).toBe('2026-09-19T12:05:00.000Z');
    expect(recovered.store.openIncidents()).toEqual([]);
    // No second incident opened beside it.
    expect(after.filter((i) => i.severity === SEV1 && !i.resolvedAt)).toEqual([]);
  });
});


describe('a feed that fails, which is the case the product exists for', () => {
  /** A stub where one feed is broken and the rest are fine. `broken` decides
   *  how: a 503, or a 200 carrying something that is not JSON. */
  function withBrokenFeed(url: string, kind: 'http_503' | 'non_json_2xx') {
    const payloads = realPayloads();
    payloads.delete(url);
    const impl: FetchLike = async (u) => {
      const href = String(u);
      if (href === url) {
        return kind === 'http_503'
          ? new Response('', { status: 503 })
          : new Response('<html>sign in</html>', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (payloads.has(href)) {
        return new Response(JSON.stringify(payloads.get(href)), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('', { status: allWell(href) });
    };
    return impl;
  }

  const CLAUDE = 'https://status.claude.com/api/v2/summary.json';

  it.each(['http_503', 'non_json_2xx'] as const)(
    'a %s feed reads unknown, never operational, and says why',
    async (kind) => {
      const a = app(withBrokenFeed(CLAUDE, kind), () => new Date('2026-09-19T12:00:00.000Z'));
      await cycle(a);

      const claude = a.signals().find((s) => s.serviceId === 'claude')!;
      expect(claude.vendor.level).toBe('unknown');
      expect(claude.vendor.errorCode).toBe(kind);
      // The others are unaffected: one broken feed is not a blackout of our own
      // making, which is the entire reason each source has its own timer.
      expect(a.signals().find((s) => s.serviceId === 'jira')!.vendor.level).toBe('operational');
    },
  );

  it('keeps the last good payload when a later poll fails, and marks it degraded', async () => {
    // The G0 BLOCKER 2 property, proven through the whole chain rather than
    // against the store directly: one good poll, then a failing one, and the
    // operator still sees the last real reading WITH the reason it is stale.
    const good = app(stubFetch(realPayloads(), allWell).impl, () => new Date('2026-09-19T12:00:00.000Z'));
    await cycle(good);
    const before = good.store.getSnapshot('vendor:claude')!;
    expect(before.error).toBeUndefined();
    expect(before.data).toBeDefined();

    // Same store, a failing feed. Rebuild the sources against it.
    const broken = createApp({
      dbPath: ':memory:', fetchImpl: withBrokenFeed(CLAUDE, 'http_503'),
      now: () => new Date('2026-09-19T12:01:00.000Z'), probes: PROBES,
    });
    // Seed the good snapshot, as a restart against the same database would see.
    broken.store.putSnapshot('vendor:claude', before);
    await cycle(broken);

    const after = broken.store.getSnapshot('vendor:claude')!;
    expect(after.data, 'the last good payload was destroyed by a failed poll').toBeDefined();
    expect(after.degraded).toBe(true);
    expect(after.error?.code).toBe('http_503');

    // And despite holding a payload that says operational, the signal is
    // unknown. This is the line the whole product rests on.
    expect(broken.signals().find((s) => s.serviceId === 'claude')!.vendor.level).toBe('unknown');
  });

  it('a stale operational payload never satisfies the vendor half', async () => {
    // Amendment 1 reached through the composition root. A snapshot whose stored
    // payload says `outage` but whose newest attempt failed must read `unknown`
    // — not `outage` — so it cannot open a Sev1 on evidence we could not
    // re-confirm. Without this, a feed that broke mid-outage would keep firing
    // a Sev1 forever on a ten-minute-old reading.
    const a = createApp({
      dbPath: ':memory:', fetchImpl: withBrokenFeed(CLAUDE, 'http_503'),
      now: () => new Date('2026-09-19T12:00:00.000Z'),
      probes: [...PROBES, { serviceId: 'claude', check: 'Claude API', url: 'https://probe.test/claude', region: 'us-east' }],
    });
    a.store.putSnapshot('vendor:claude', {
      data: { platform: 'statuspage', level: 'outage', label: 'Outage', incidentsSince: [] },
      fetchedAt: '2026-09-19T11:50:00.000Z', degraded: false,
    });
    await cycle(a);

    expect(a.signals().find((s) => s.serviceId === 'claude')!.vendor.level).toBe('unknown');
    expect(a.correlateNow('2026-09-19T12:00:00.000Z').filter((i) => i.severity === SEV1)).toEqual([]);
  });
});

describe('across repeated cycles', () => {
  it('reports our half as latest-per-check, not as a growing pile of rows', async () => {
    // Zendesk is two probes on one tile. After three polls the store holds six
    // rows, and counting them raw reports `4/6 passing` for a service with one
    // dead pod out of two — a number that drifts with the polling cadence
    // rather than with anything real, and that the operator cannot act on.
    const a = createApp({
      dbPath: ':memory:',
      fetchImpl: stubFetch(realPayloads(), (u) => (u.endsWith('zendesk-b') ? 500 : 200)).impl,
      now: () => new Date('2026-09-19T12:00:00.000Z'),
      probes: PROBES,
    });
    for (let i = 0; i < 3; i += 1) await cycle(a);

    expect(a.store.runsFor('zendesk', 50)).toHaveLength(6);
    expect(a.signals().find((s) => s.serviceId === 'zendesk')!.ours).toEqual({ passing: 1, total: 2 });
  });

  it('re-opens the same incident when a condition recurs inside its window', async () => {
    // The seam that `openIncidents()` alone cannot serve. A condition that
    // clears and returns eight minutes later must land back on the SAME
    // incident — the engine can only recognise a prior it was handed, and a
    // resolved one is not open. Without `incidentsSince` the engine's whole
    // recurrence branch is unreachable in production while its unit tests pass.
    //
    // `openedAt` is the assertion that makes this test worth writing. The id
    // alone proves nothing here: a brand-new incident opened in the same 30-min
    // bucket derives the SAME id, so "same id, one row" passes just as happily
    // on the broken behaviour. Only the carried `openedAt` distinguishes a
    // re-opened incident from a fresh one wearing its name.
    const outageFetch = () =>
      stubFetch(
        (() => {
          const p = realPayloads();
          const claude = p.get('https://status.claude.com/api/v2/summary.json') as Record<string, unknown>;
          p.set('https://status.claude.com/api/v2/summary.json', withComponentStatus(claude, 0, 'major_outage'));
          return p;
        })(),
        (u) => (u.endsWith('claude') ? 503 : allWell(u)),
      ).impl;
    const CLAUDE_PROBE: ProbeSpec = {
      serviceId: 'claude', check: 'Claude API', url: 'https://probe.test/claude', region: 'us-east',
    };
    const build = () =>
      createApp({
        dbPath: ':memory:', fetchImpl: outageFetch(),
        now: () => new Date('2026-09-19T12:00:00.000Z'), probes: [...PROBES, CLAUDE_PROBE],
      });

    // A throwaway instance, only to learn which id this condition owns.
    const scout = build();
    await cycle(scout);
    const id = scout.correlateNow('2026-09-19T12:00:00.000Z').find((i) => i.severity === SEV1)!.id;

    // A FRESH store, so the planted row is an insert rather than an upsert.
    // `putIncident` deliberately does not update `opened_at` on conflict — an
    // existing incident's start time must never move — so planting it into a
    // store that already holds the row would leave `opened_at` at 12:00 and the
    // assertion below would be measuring the test's own setup.
    const a = build();
    a.store.putIncident({
      id, ruleKey: 'vendor', serviceId: 'claude', severity: '1',
      openedAt: '2026-09-19T11:50:00.000Z', resolvedAt: '2026-09-19T11:55:00.000Z', summary: 'earlier',
    });
    expect(a.store.openIncidents()).toEqual([]);
    await cycle(a);

    const again = a.correlateNow('2026-09-19T12:00:00.000Z');
    const reopened = again.find((i) => i.id === id);
    expect(reopened, 'the recurrence did not land on the prior incident').toBeDefined();
    expect(reopened!.resolvedAt).toBeUndefined();
    expect(reopened!.openedAt).toBe('2026-09-19T11:50:00.000Z');
    expect(again.filter((i) => i.severity === SEV1 && i.serviceId === 'claude')).toHaveLength(1);
  });

  it('persists an escalated severity rather than serving the one it opened with', async () => {
    // Found while writing the test above. `putIncident`'s upsert is
    // `ON CONFLICT(id) DO UPDATE SET resolved_at, summary` — `severity` is not
    // in the list. The engine escalates correctly (`carryForward` takes the
    // finding's severity), but the store keeps the old value, and the API reads
    // the store. So an incident that opened Sev2 and escalated to Sev1 is
    // served to the operator as a Sev2 forever.
    const a = createApp({ dbPath: ':memory:', now: () => new Date('2026-09-19T12:00:00.000Z'), probes: [] });
    const row = {
      id: 'INC-esc', ruleKey: 'vendor', serviceId: 'claude',
      openedAt: '2026-09-19T11:50:00.000Z', resolvedAt: null, summary: 's',
    };
    a.store.putIncident({ ...row, severity: '2' });
    a.store.putIncident({ ...row, severity: '1' });
    expect(String(a.store.openIncidents()[0]!['severity'])).toBe('1');
  });
});

describe('the operator can turn a rule off', () => {
  /** The `vendor` Sev1 condition, live: Claude in outage with our probe failing. */
  const outageApp = () =>
    createApp({
      dbPath: ':memory:',
      fetchImpl: stubFetch(
        (() => {
          const p = realPayloads();
          const claude = p.get('https://status.claude.com/api/v2/summary.json') as Record<string, unknown>;
          p.set('https://status.claude.com/api/v2/summary.json', withComponentStatus(claude, 0, 'major_outage'));
          return p;
        })(),
        (u) => (u.endsWith('claude') ? 503 : allWell(u)),
      ).impl,
      now: () => new Date('2026-09-19T12:00:00.000Z'),
      probes: [...PROBES, { serviceId: 'claude', check: 'Claude API', url: 'https://probe.test/claude', region: 'us-east' }],
      tokens: stubTokens,
    });

  it('an empty rule_state leaves every rule ON', async () => {
    // The failure this prevents is the worst kind: a reader that returned
    // `false` for untouched rules, or a caller that treated absent as disabled,
    // would silently turn the whole product off — and a dashboard that never
    // raises anything is indistinguishable from a quiet day.
    const a = outageApp();
    await cycle(a);
    expect(a.store.ruleState()).toEqual({});
    expect(a.correlateNow('2026-09-19T12:00:00.000Z').filter((i) => i.severity === SEV1)).toHaveLength(1);
  });

  it('disabling the vendor rule stops it firing, through the whole chain', async () => {
    const a = outageApp();
    await cycle(a);
    a.store.setRuleState('vendor', false);
    expect(a.correlateNow('2026-09-19T12:00:00.000Z').filter((i) => i.severity === SEV1)).toEqual([]);
  });

  it('re-enabling it takes effect on the next tick, not the next restart', async () => {
    // Read fresh every correlation rather than captured at boot. An operator who
    // un-mutes a rule and watches nothing happen for an hour has learned that
    // the switch does not work.
    const a = outageApp();
    await cycle(a);
    a.store.setRuleState('vendor', false);
    expect(a.correlateNow('2026-09-19T12:00:00.000Z')).toEqual([]);
    a.store.setRuleState('vendor', true);
    expect(a.correlateNow('2026-09-19T12:00:00.000Z').filter((i) => i.severity === SEV1)).toHaveLength(1);
  });

  it('disabling one rule leaves the other alone', async () => {
    // Asserted positively, on the rule that stays: an override keyed wrongly
    // would disable everything and "no incidents" would still look plausible.
    const a = outageApp();
    await cycle(a);
    a.store.setRuleState('blackout', false);
    expect(a.correlateNow('2026-09-19T12:00:00.000Z').filter((i) => i.ruleKey === 'vendor')).toHaveLength(1);
  });
});

describe('retention runs as a source', () => {
  it('is scheduled, and reports what it deleted rather than nothing', async () => {
    // A prune whose WHERE clause matches nothing is silent while the log still
    // says "pruned". Returning the counts is what makes a no-op visible, and
    // running it as a source rather than its own timer is what puts a failing
    // prune into /api/health instead of leaving it invisible until the disk
    // fills.
    const a = app(stubFetch(realPayloads(), allWell).impl, () => new Date('2026-09-19T12:00:00.000Z'));
    const prune = a.sources.find((s) => s.name === PRUNE_SOURCE);
    expect(prune, 'retention is not scheduled at all').toBeDefined();
    // Hourly, not per poll: the windows are 45 and 180 days.
    expect(prune!.intervalMs).toBe(60 * 60_000);

    const result = await prune!.run();
    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({ checkRuns: expect.any(Number), incidents: expect.any(Number) });
  });
});
