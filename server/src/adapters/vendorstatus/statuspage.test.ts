import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchLike } from '../../http/fetchJson.js';
import type { SourceResult } from '@ops-dash/shared';
import type { Vendor, VendorFeed } from './common.js';
import { COMPONENT_STATUS, INCIDENT_IMPACT, mapComponentStatus, pollStatuspage } from './statuspage.js';

/** Amendment 9 made `data` optional: an errored SourceResult carries no
 *  payload. These adapters promise one on EVERY path anyway — a broken feed is
 *  still a renderable `unknown` vendor half, with a note saying why — so this
 *  helper asserts that promise rather than papering over the optionality with a
 *  `!`. A path that quietly stops keeping it fails the test that touches it. */
const vendorOf = (result: SourceResult<Vendor>): Vendor => {
  if (result.data === undefined) throw new Error('the adapter returned no vendor half');
  return result.data;
};

const HERE = dirname(fileURLToPath(import.meta.url));

/** The captured bytes, unmodified. See `__fixtures__/README.md` for the URL and
 *  the capture date of each. Tests that need a shape the feeds were not showing
 *  on 2026-09-19 (an open incident, a scheduled maintenance) start from these
 *  and say so at the call site. */
const fixture = (name: string): string => readFileSync(join(HERE, '__fixtures__', name), 'utf8');
const parsed = (name: string): Record<string, unknown> =>
  JSON.parse(fixture(name)) as Record<string, unknown>;

/** A stub transport. Named so it cannot be confused with the global, and so the
 *  repo's bare-`fetch(` guard has nothing to catch. */
const serving = (body: string, init: ResponseInit = {}): FetchLike => {
  const respond: FetchLike = async () =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    });
  return respond;
};

const JIRA: VendorFeed = {
  id: 'jira',
  platform: 'statuspage',
  url: 'https://jira-software.status.atlassian.com/api/v2/summary.json',
};

const component = (name: string, status: string) => ({
  id: `synthetic-${name}`,
  name,
  status,
  group: false,
  group_id: null,
});

describe('the Statuspage component vocabulary maps to ours', () => {
  // The mapping is the adapter's whole job, so it is asserted member by member
  // against pinned literals rather than by calling the function that owns it.
  it('maps every word Statuspage publishes', () => {
    expect(COMPONENT_STATUS.operational).toBe('operational');
    expect(COMPONENT_STATUS.degraded_performance).toBe('degraded');
    expect(COMPONENT_STATUS.partial_outage).toBe('outage');
    expect(COMPONENT_STATUS.major_outage).toBe('outage');
    expect(COMPONENT_STATUS.under_maintenance).toBe('maintenance');
  });

  it('knows exactly those five words and no others', () => {
    // A sixth word appearing in the table without a decision about it, or one
    // of these five being deleted, is a change to the adapter's contract with
    // the platform and must fail here.
    expect(Object.keys(COMPONENT_STATUS).sort()).toEqual([
      'degraded_performance',
      'major_outage',
      'operational',
      'partial_outage',
      'under_maintenance',
    ]);
  });

  it('maps a word it has never seen to unknown', () => {
    // Positive assertion first: it must BE unknown. The negative is the
    // companion that names the failure we actually fear.
    expect(mapComponentStatus('quantum_flux')).toBe('unknown');
    expect(mapComponentStatus('quantum_flux')).not.toBe('operational');
  });

  it('maps a non-string status to unknown rather than throwing', () => {
    expect(mapComponentStatus(undefined)).toBe('unknown');
    expect(mapComponentStatus(null)).toBe('unknown');
    expect(mapComponentStatus(7)).toBe('unknown');
  });

  it('maps incident impact, including the impact that states nothing', () => {
    expect(INCIDENT_IMPACT.none).toBe('unknown');
    expect(INCIDENT_IMPACT.minor).toBe('degraded');
    expect(INCIDENT_IMPACT.major).toBe('outage');
    expect(INCIDENT_IMPACT.critical).toBe('outage');
    expect(INCIDENT_IMPACT.maintenance).toBe('maintenance');
  });
});

describe('a captured, healthy Statuspage page', () => {
  it('reads operational from Atlassian’s real payload', async () => {
    const result = await pollStatuspage(JIRA, serving(fixture('statuspage-jira-summary.json')));
    expect(result.error).toBeUndefined();
    expect(vendorOf(result).level).toBe('operational');
    expect(vendorOf(result).label).toBe('Operational');
    expect(vendorOf(result).platform).toBe('statuspage');
    expect(vendorOf(result).incidentsSince).toEqual([]);
  });

  it('survives OpenAI publishing no incidents key at all', async () => {
    // Real, captured 2026-09-19: OpenAI's summary.json top level is
    // { page, status, components } — no `incidents`, no
    // `scheduled_maintenances`, where Atlassian's has both. An adapter reading
    // body.incidents.length throws on OpenAI today with nothing wrong upstream.
    // This is the case a hand-written fixture would never have contained.
    const raw = parsed('statuspage-openai-summary.json');
    expect(Object.keys(raw).sort()).toEqual(['components', 'page', 'status']);

    const feed: VendorFeed = { id: 'openai', platform: 'statuspage', url: 'https://status.openai.com/api/v2/summary.json' };
    const result = await pollStatuspage(feed, serving(fixture('statuspage-openai-summary.json')));
    expect(result.error).toBeUndefined();
    expect(vendorOf(result).level).toBe('operational');
    expect(vendorOf(result).incidentsSince).toEqual([]);
  });
});

describe('components the feed adds, and components it takes away', () => {
  it('ignores a component we have never heard of', async () => {
    // Vendors add components without telling anyone. An operational addition
    // must not crash and must not move the level.
    const body = parsed('statuspage-jira-summary.json');
    (body.components as unknown[]).push(component('Jira Sonic Screwdriver', 'operational'));
    const result = await pollStatuspage(JIRA, serving(JSON.stringify(body)));
    expect(vendorOf(result).level).toBe('operational');
  });

  it('goes unknown when a component we were configured to watch disappears', async () => {
    // The defect this prevents: the feed drops "Search", the rollup quietly
    // covers one fewer component, and the tile still reads green while we have
    // lost sight of the thing we were watching.
    const body = parsed('statuspage-jira-summary.json');
    body.components = (body.components as Array<{ name: string }>).filter((c) => c.name !== 'Search');
    const feed: VendorFeed = { ...JIRA, component: 'Search' };
    const result = await pollStatuspage(feed, serving(JSON.stringify(body)));
    expect(vendorOf(result).level).toBe('unknown');
    expect(vendorOf(result).label).toBe('Unknown');
    expect(vendorOf(result).note).toContain('Search');
  });

  it('reads the configured component and not the page rollup', async () => {
    // Run against a world where the two candidates DIFFER: the page is fine,
    // the one component we care about is not. A rollup implementation and a
    // component implementation are indistinguishable on a healthy page.
    const body = parsed('statuspage-jira-summary.json');
    (body.components as Array<{ name: string; status: string }>).forEach((c) => {
      if (c.name === 'Search') c.status = 'partial_outage';
    });
    const rollup = await pollStatuspage(JIRA, serving(JSON.stringify(body)));
    const narrowed = await pollStatuspage({ ...JIRA, component: 'Search' }, serving(JSON.stringify(body)));
    const other = await pollStatuspage({ ...JIRA, component: 'Notifications' }, serving(JSON.stringify(body)));
    expect(vendorOf(narrowed).level).toBe('outage');
    expect(vendorOf(other).level).toBe('operational');
    expect(vendorOf(rollup).level).toBe('outage');
  });
});

describe('the rollup never rounds toward green', () => {
  it('takes the worst component on the page', async () => {
    const body = parsed('statuspage-jira-summary.json');
    (body.components as Array<{ name: string; status: string }>)[0]!.status = 'major_outage';
    const result = await pollStatuspage(JIRA, serving(JSON.stringify(body)));
    expect(vendorOf(result).level).toBe('outage');
  });

  it('is degraded, not operational, when one component is slow', async () => {
    const body = parsed('statuspage-jira-summary.json');
    (body.components as Array<{ name: string; status: string }>)[1]!.status = 'degraded_performance';
    const result = await pollStatuspage(JIRA, serving(JSON.stringify(body)));
    expect(vendorOf(result).level).toBe('degraded');
  });

  it('goes unknown when one component speaks a word we do not know', async () => {
    const body = parsed('statuspage-jira-summary.json');
    (body.components as unknown[]).push(component('Jira Warp Core', 'containment_breach'));
    const result = await pollStatuspage(JIRA, serving(JSON.stringify(body)));
    expect(vendorOf(result).level).toBe('unknown');
  });

  it('goes unknown when the feed publishes no components', async () => {
    const body = parsed('statuspage-jira-summary.json');
    body.components = [];
    const result = await pollStatuspage(JIRA, serving(JSON.stringify(body)));
    expect(vendorOf(result).level).toBe('unknown');
  });

  it('goes unknown when components is not an array', async () => {
    const body = parsed('statuspage-jira-summary.json');
    body.components = { oops: true };
    const result = await pollStatuspage(JIRA, serving(JSON.stringify(body)));
    expect(vendorOf(result).level).toBe('unknown');
  });
});

describe('transport failures arrive as unknown, with the reason intact', () => {
  it('reports a 500 as unknown and keeps the error from the helper', async () => {
    const result = await pollStatuspage(JIRA, serving('{}', { status: 500, statusText: 'Server Error' }));
    expect(result.error?.code).toBe('http_500');
    expect(vendorOf(result).level).toBe('unknown');
    expect(vendorOf(result).platform).toBe('statuspage');
    expect(vendorOf(result).note).toContain('http_500');
  });

  it('reports an HTML sign-in page served under HTTP 200 as unknown', async () => {
    // Not hypothetical: EPC's /api/1.4/common/groups returns a Zoho sign-in
    // page under 200 when the token has expired. An adapter that trusts the
    // status code reports a successful poll of zero records.
    const result = await pollStatuspage(
      JIRA,
      serving('<html><body>Sign in</body></html>', { headers: { 'content-type': 'text/html' } }),
    );
    expect(result.error?.code).toBe('non_json_2xx');
    expect(vendorOf(result).level).toBe('unknown');
  });

  it('reports a transport throw as unknown', async () => {
    const boom: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const result = await pollStatuspage(JIRA, boom);
    expect(result.error?.code).toBe('network');
    expect(vendorOf(result).level).toBe('unknown');
  });
});

describe('platform comes from the config row', () => {
  it('uses the configured platform even when the id would suggest another', async () => {
    // A world where the two candidates differ: zendesk's id maps to
    // 'zendesk-ssp' everywhere else in the system, but this row says
    // statuspage, and the row is the authority. Inferring from the id would
    // put the wrong platform on the result and mis-group the blackout rule.
    const feed: VendorFeed = { id: 'zendesk', platform: 'statuspage', url: 'https://status.example.com/api/v2/summary.json' };
    const result = await pollStatuspage(feed, serving(fixture('statuspage-jira-summary.json')));
    expect(vendorOf(result).platform).toBe('statuspage');
  });
});

describe('incidents and maintenance', () => {
  // All four captured pages were clean on 2026-09-19, so these two structures
  // are grafted onto a real payload in the shape Statuspage v2 documents. That
  // is stated rather than hidden: the surrounding document is real, these two
  // objects are not.
  it('carries published incidents through as VendorIncidents', async () => {
    const body = parsed('statuspage-jira-summary.json');
    body.incidents = [
      {
        id: 'abc123',
        name: 'Elevated error rates on Search',
        status: 'investigating',
        impact: 'major',
        created_at: '2026-09-19T09:00:00.000Z',
        started_at: '2026-09-19T08:55:00.000Z',
        resolved_at: null,
        shortlink: 'https://stspg.io/abc123',
      },
    ];
    const result = await pollStatuspage(JIRA, serving(JSON.stringify(body)));
    expect(vendorOf(result).incidentsSince).toEqual([
      {
        id: 'abc123',
        title: 'Elevated error rates on Search',
        level: 'outage',
        startedAt: '2026-09-19T08:55:00.000Z',
        url: 'https://stspg.io/abc123',
      },
    ]);
    expect(vendorOf(result).advisoryId).toBe('abc123');
  });

  it('keeps resolvedAt when the incident has one', async () => {
    const body = parsed('statuspage-jira-summary.json');
    body.incidents = [
      {
        id: 'done1',
        name: 'Brief blip',
        status: 'resolved',
        impact: 'minor',
        started_at: '2026-09-18T08:00:00.000Z',
        resolved_at: '2026-09-18T09:00:00.000Z',
      },
    ];
    const result = await pollStatuspage(JIRA, serving(JSON.stringify(body)));
    expect(vendorOf(result).incidentsSince[0]?.resolvedAt).toBe('2026-09-18T09:00:00.000Z');
    expect(vendorOf(result).incidentsSince[0]?.level).toBe('degraded');
  });

  it('reports a scheduled maintenance window', async () => {
    const body = parsed('statuspage-jira-summary.json');
    body.scheduled_maintenances = [
      {
        id: 'maint1',
        name: 'Database upgrade',
        status: 'scheduled',
        impact: 'maintenance',
        scheduled_for: '2026-09-20T02:00:00.000Z',
        scheduled_until: '2026-09-20T04:00:00.000Z',
      },
    ];
    const result = await pollStatuspage(JIRA, serving(JSON.stringify(body)));
    expect(vendorOf(result).maintenance).toEqual({
      title: 'Database upgrade',
      scheduledFor: '2026-09-20T02:00:00.000Z',
      scheduledUntil: '2026-09-20T04:00:00.000Z',
    });
  });

  it('marks the result degraded when incidents is present but unusable', async () => {
    // A partial answer: the levels are readable, the incident list is not.
    // `degraded` on the envelope is what says so.
    const body = parsed('statuspage-jira-summary.json');
    body.incidents = 'not an array';
    const result = await pollStatuspage(JIRA, serving(JSON.stringify(body)));
    expect(result.degraded).toBe(true);
    expect(vendorOf(result).level).toBe('operational');
    expect(vendorOf(result).incidentsSince).toEqual([]);
  });
});

describe('a vendor headline is text, not a rendering instruction', () => {
  /**
   * Every title here is written by a stranger and lands on an operator's screen.
   *
   * `safeText` renders a bidi override as `[U+202E]` rather than stripping it.
   * React escapes markup and does **nothing** about direction — no markup is
   * involved — so a right-to-left override inside a status-page headline
   * reorders what an operator reads about an outage while every character in it
   * is individually innocent.
   *
   * **Made visible, never removed.** The hostility is the finding, and defanging
   * it hides it from the only person who can act on it. The homoglyph case is
   * asserted as a deliberate limit rather than left as an oversight somebody
   * later "fixes".
   *
   * Found by `m4-views` while wiring advisories to the screen: `safeText` had
   * been hoisted to `server/src/vendorText.ts` and adopted by two adapters, and
   * `vendorstatus/` — whose text is authored furthest outside this company —
   * did not import it at all. They stated the residual in their own code rather
   * than copying the helper into `web/` to cover one call site.
   */
  const RLO = '\u202E';

  const bodyWith = (name: string) => JSON.stringify({
    components: [{ id: 'c1', name: 'API', status: 'operational' }],
    incidents: [{ id: 'i1', name, impact: 'minor', status: 'investigating', created_at: '2026-09-20T00:00:00Z' }],
  });

  it('makes a direction override visible instead of obeying it', async () => {
    const result = await pollStatuspage(JIRA, serving(bodyWith(`Degraded ${RLO}gnv.exe`)));
    const [advisory] = vendorOf(result).incidentsSince;
    expect(advisory!.title).toContain('[U+202E]');
    expect(advisory!.title).not.toContain(RLO);
  });

  it('leaves a homoglyph exactly as the vendor sent it', async () => {
    const result = await pollStatuspage(JIRA, serving(bodyWith('Outage at exarnple.com')));
    const [advisory] = vendorOf(result).incidentsSince;
    expect(advisory!.title).toBe('Outage at exarnple.com');
  });
});
