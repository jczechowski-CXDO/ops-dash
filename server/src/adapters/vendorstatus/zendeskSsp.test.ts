import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchLike } from '../../http/fetchJson.js';
import type { SourceResult } from '@ops-dash/shared';
import type { Vendor, VendorFeed } from './common.js';
import { ZENDESK_IMPACT, pollZendeskSsp } from './zendeskSsp.js';

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
const fixture = (name: string): string => readFileSync(join(HERE, '__fixtures__', name), 'utf8');
const parsed = (name: string): Record<string, unknown> =>
  JSON.parse(fixture(name)) as Record<string, unknown>;

const ZENDESK: VendorFeed = {
  id: 'zendesk',
  platform: 'zendesk-ssp',
  url: 'https://status.zendesk.com/api/ssp',
};

type Incident = {
  id: string;
  attributes: {
    name: string;
    impact: string;
    status: string;
    outage: boolean;
    degradation: boolean;
    startedAt: string;
    resolvedAt: string | null;
  };
  relationships: { incidentServices: { data: Array<{ id: string }> } };
};

/** Serves the two SSP documents by path. The adapter must ask for the right
 *  ones off the configured base; an unexpected path is a 404 here, which shows
 *  up as `unknown` rather than as a silent pass. */
const sspServing = (docs: { services?: string; incidents?: string }): FetchLike => {
  const respond: FetchLike = async (url) => {
    const body = url.endsWith('/services.json') ? docs.services : url.endsWith('/incidents.json') ? docs.incidents : undefined;
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return respond;
};

const bothCaptured = () =>
  sspServing({ services: fixture('zendesk-ssp-services.json'), incidents: fixture('zendesk-ssp-incidents.json') });

describe('Zendesk SSP — the feed with no status field', () => {
  it('reads unknown, not operational, when nothing is open', async () => {
    // Amendment 4 exists for this service. The SSP feed publishes no
    // per-service status anywhere in either document, so "no open incident" is
    // the only green-ish signal available and it is an ABSENCE. An absence is
    // not an affirmation, so the level is unknown and the note says why.
    const result = await pollZendeskSsp(ZENDESK, bothCaptured());
    expect(vendorOf(result).level).toBe('unknown');
    expect(vendorOf(result).label).toBe('Unknown');
    expect(vendorOf(result).platform).toBe('zendesk-ssp');
    expect(vendorOf(result).note).toContain('no per-service status');
    expect(vendorOf(result).note).toContain('not an affirmation');
  });

  it('carries the published incident history through', async () => {
    const result = await pollZendeskSsp(ZENDESK, bothCaptured());
    // 17 incidents in the captured document, all closed. Pinned from the
    // capture, counted independently of the adapter.
    expect((parsed('zendesk-ssp-incidents.json').data as unknown[]).length).toBe(17);
    expect(vendorOf(result).incidentsSince.length).toBe(17);
    expect(vendorOf(result).incidentsSince[0]?.title).toBe('Voice issues pod 20');
  });

  it('reads openness from resolvedAt, because Zendesk’s status field goes stale', async () => {
    // Real capture: incident 10079, "Unable to Access Zendesk", is still
    // status "monitoring" two months after its resolvedAt of
    // 2026-07-24T12:42:29.000Z. An adapter reading `status` would show a July
    // outage as open forever; one reading resolvedAt does not.
    const doc = parsed('zendesk-ssp-incidents.json');
    const stale = (doc.data as Incident[]).find((i) => i.id === '10079');
    expect(stale?.attributes.status).toBe('monitoring');
    expect(stale?.attributes.resolvedAt).toBe('2026-07-24T12:42:29.000Z');

    const result = await pollZendeskSsp(ZENDESK, bothCaptured());
    expect(vendorOf(result).level).toBe('unknown');
    expect(vendorOf(result).incidentsSince.find((i) => i.id === '10079')?.resolvedAt).toBe('2026-07-24T12:42:29.000Z');
  });

  it('reads outage when an incident is genuinely open', async () => {
    // The captured document had nothing open, so one real incident has its
    // resolvedAt cleared. Everything else about it is as Zendesk published it.
    const doc = parsed('zendesk-ssp-incidents.json');
    const first = (doc.data as Incident[])[0]!;
    first.attributes.resolvedAt = null;
    first.attributes.outage = true;
    first.attributes.degradation = false;
    const result = await pollZendeskSsp(
      ZENDESK,
      sspServing({ services: fixture('zendesk-ssp-services.json'), incidents: JSON.stringify(doc) }),
    );
    expect(vendorOf(result).level).toBe('outage');
    expect(vendorOf(result).note).toContain('Voice issues pod 20');
  });

  it('reads degraded when the open incident is a degradation', async () => {
    const doc = parsed('zendesk-ssp-incidents.json');
    const first = (doc.data as Incident[])[0]!;
    first.attributes.resolvedAt = null;
    first.attributes.outage = false;
    first.attributes.degradation = true;
    const result = await pollZendeskSsp(
      ZENDESK,
      sspServing({ services: fixture('zendesk-ssp-services.json'), incidents: JSON.stringify(doc) }),
    );
    expect(vendorOf(result).level).toBe('degraded');
  });

  it('maps Zendesk impact words when the booleans say nothing', () => {
    expect(ZENDESK_IMPACT.minor).toBe('degraded');
    expect(ZENDESK_IMPACT.major).toBe('outage');
    expect(ZENDESK_IMPACT.critical).toBe('outage');
    expect(Object.keys(ZENDESK_IMPACT).sort()).toEqual(['critical', 'major', 'minor']);
  });
});

describe('an empty incidents document', () => {
  it('is empty and unknown, never operational', async () => {
    // The SSP document is `{ data: [], included: [] }` when nothing is
    // published — an object, so the transport helper cannot see that it is
    // empty. The adapter sets `empty` itself, and the level stays unknown.
    const result = await pollZendeskSsp(
      ZENDESK,
      sspServing({ services: fixture('zendesk-ssp-services.json'), incidents: '{"data":[],"included":[]}' }),
    );
    expect(result.empty).toBe(true);
    expect(vendorOf(result).level).toBe('unknown');
    expect(vendorOf(result).incidentsSince).toEqual([]);
  });

  it('is empty and unknown when the whole body is an empty array', async () => {
    const result = await pollZendeskSsp(
      ZENDESK,
      sspServing({ services: fixture('zendesk-ssp-services.json'), incidents: '[]' }),
    );
    expect(result.empty).toBe(true);
    expect(vendorOf(result).level).toBe('unknown');
  });
});

describe('a configured Zendesk service', () => {
  it('narrows to incidents touching that service', async () => {
    // Incident 10315 touches Voice (serviceId 31) and two of its children.
    // With component Voice it is ours; with component Chat it is not. Run
    // against the world where the two candidates differ.
    const doc = parsed('zendesk-ssp-incidents.json');
    const first = (doc.data as Incident[])[0]!;
    first.attributes.resolvedAt = null;
    first.attributes.outage = true;
    const serve = sspServing({ services: fixture('zendesk-ssp-services.json'), incidents: JSON.stringify(doc) });

    const voice = await pollZendeskSsp({ ...ZENDESK, component: 'Voice' }, serve);
    const chat = await pollZendeskSsp({ ...ZENDESK, component: 'Chat' }, serve);
    expect(vendorOf(voice).level).toBe('outage');
    expect(vendorOf(chat).level).toBe('unknown');
  });

  it('goes unknown when the service we watch is no longer published', async () => {
    const services = parsed('zendesk-ssp-services.json');
    services.data = (services.data as Array<{ attributes: { name: string } }>).filter(
      (s) => s.attributes.name !== 'Voice',
    );
    const result = await pollZendeskSsp(
      { ...ZENDESK, component: 'Voice' },
      sspServing({ services: JSON.stringify(services), incidents: fixture('zendesk-ssp-incidents.json') }),
    );
    expect(vendorOf(result).level).toBe('unknown');
    expect(vendorOf(result).note).toContain('Voice');
  });

  it('goes unknown when the services document itself cannot be read', async () => {
    const serve: FetchLike = async (url) =>
      url.endsWith('/services.json')
        ? new Response('<html>nope</html>', { status: 200, headers: { 'content-type': 'text/html' } })
        : new Response(fixture('zendesk-ssp-incidents.json'), { status: 200 });
    const result = await pollZendeskSsp({ ...ZENDESK, component: 'Voice' }, serve);
    expect(result.error?.code).toBe('non_json_2xx');
    expect(vendorOf(result).level).toBe('unknown');
  });
});

describe('transport failures arrive as unknown, with the reason intact', () => {
  it('reports a 503 as unknown and keeps the error', async () => {
    const down: FetchLike = async () => new Response('down', { status: 503, statusText: 'Service Unavailable' });
    const result = await pollZendeskSsp(ZENDESK, down);
    expect(result.error?.code).toBe('http_503');
    expect(vendorOf(result).level).toBe('unknown');
    expect(vendorOf(result).note).toContain('http_503');
  });

  it('reports an HTML body under 200 as unknown', async () => {
    const result = await pollZendeskSsp(
      ZENDESK,
      sspServing({ incidents: '<html><body>Sign in</body></html>' }),
    );
    expect(result.error?.code).toBe('non_json_2xx');
    expect(vendorOf(result).level).toBe('unknown');
  });
});

describe('platform comes from the config row', () => {
  it('uses the configured platform even when the id would suggest another', async () => {
    const feed: VendorFeed = { id: 'helpjuice', platform: 'zendesk-ssp', url: 'https://status.example.com/api/ssp' };
    const result = await pollZendeskSsp(feed, sspServing({ incidents: fixture('zendesk-ssp-incidents.json') }));
    expect(vendorOf(result).platform).toBe('zendesk-ssp');
  });
});

describe('pod scoping — the feed answers globally unless we say who we are', () => {
  const capture = () => {
    const urls: string[] = [];
    const impl: FetchLike = async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ data: [], included: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
    return { urls, impl };
  };

  const feed = (over: Partial<VendorFeed> = {}): VendorFeed => ({
    id: 'zendesk', platform: 'zendesk-ssp', url: 'https://status.zendesk.com/api/ssp', ...over,
  });

  it('queries every configured tenant, not just the first', async () => {
    // We have two Zendesk accounts. Both sit on Pod 23 today, so a single query
    // would happen to cover both — and that coincidence is exactly what not to
    // build on: the day either is migrated, a one-tenant feed stops covering
    // the other silently.
    const c = capture();
    await pollZendeskSsp(feed({ tenants: ['crexendo', 'netsapiens'] }), c.impl);
    expect(c.urls).toEqual([
      'https://status.zendesk.com/api/ssp/incidents.json?subdomain=crexendo',
      'https://status.zendesk.com/api/ssp/incidents.json?subdomain=netsapiens',
    ]);
  });

  it('omits the query entirely when no tenant is configured', async () => {
    // Not `?subdomain=` with an empty value, which a feed may read as a literal
    // subdomain named "".
    const c = capture();
    await pollZendeskSsp(feed(), c.impl);
    expect(c.urls).toEqual(['https://status.zendesk.com/api/ssp/incidents.json']);
  });

  it('merges both tenants and dedupes by incident id', async () => {
    // Two accounts on one pod return the SAME rows. Counting them twice would
    // report double the incidents the moment anything went wrong — and the
    // blast-radius numbers on the tile are what an operator triages by.
    const shared = {
      data: [{
        id: '900', type: 'incident',
        attributes: { name: 'Pod 23 latency', impact: 'minor', degradation: true, outage: false,
          status: 'monitoring', startedAt: '2026-09-19T10:00:00Z', resolvedAt: null },
      }],
      included: [],
    };
    const impl: FetchLike = async () =>
      new Response(JSON.stringify(shared), { status: 200, headers: { 'content-type': 'application/json' } });

    const result = await pollZendeskSsp(feed({ tenants: ['crexendo', 'netsapiens'] }), impl);
    expect(result.data!.incidentsSince).toHaveLength(1);
    expect(result.data!.level).toBe('degraded');
  });

  it('reads unknown if EITHER tenant cannot be read, however healthy the other looked', async () => {
    // A partial read that renders clean is the precise failure this product
    // exists to prevent. If we cannot see netsapiens we cannot speak for
    // Zendesk, and the note has to say which one we lost.
    let call = 0;
    const impl: FetchLike = async () => {
      call += 1;
      return call === 1
        ? new Response(JSON.stringify({ data: [], included: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('', { status: 503 });
    };
    const result = await pollZendeskSsp(feed({ tenants: ['crexendo', 'netsapiens'] }), impl);
    expect(result.data!.level).toBe('unknown');
    expect(result.error?.code).toBe('http_503');
    expect(result.data!.note).toContain('netsapiens');
  });

  it('names both tenants in the note, so the reader knows what was covered', async () => {
    const c = capture();
    const result = await pollZendeskSsp(feed({ tenants: ['crexendo', 'netsapiens'] }), c.impl);
    expect(result.data!.note).toContain('crexendo, netsapiens');
  });

  it('url-encodes each tenant rather than interpolating it raw', async () => {
    const c = capture();
    await pollZendeskSsp(feed({ tenants: ['a-b'] }), c.impl);
    expect(c.urls[0]).toContain('subdomain=a-b');
  });
});
