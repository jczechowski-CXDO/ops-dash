import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchLike } from '../../http/fetchJson.js';
import type { VendorFeed } from './common.js';
import { STATUSIO_CODE, pollStatusio } from './statusio.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The real Hornetsecurity payload, captured 2026-09-19 from
 *  api.status.io/1.0/status/591aaa7fe69f388425000fda — 19 services, ten
 *  datacentres, two of them ours. */
const CAPTURED = JSON.parse(
  readFileSync(join(HERE, '__fixtures__', 'statusio-hornet.json'), 'utf8'),
) as Record<string, unknown>;

const OURS = ['United States - Atlanta', 'United States - Georgia'];

const feed = (over: Partial<VendorFeed> = {}): VendorFeed => ({
  id: 'proofpoint',
  platform: 'statusio',
  url: 'https://api.status.io/1.0/status/591aaa7fe69f388425000fda',
  locations: OURS,
  ...over,
});

const serve = (body: unknown, status = 200): FetchLike => async () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Rebuild the captured payload with one service's container edited. Returns a
 *  NEW object — a test that mutates the fixture in place poisons every test
 *  after it in the file. */
function withContainer(service: string, container: string, statusCode: number) {
  const root = JSON.parse(JSON.stringify(CAPTURED)) as {
    result: { status: { name: string; containers?: { name: string; status_code: number }[] }[] };
  };
  const s = root.result.status.find((x) => x.name === service);
  if (!s) throw new Error(`fixture has no service ${service}`);
  const c = s.containers?.find((x) => x.name === container);
  if (!c) throw new Error(`${service} has no container ${container}`);
  c.status_code = statusCode;
  return root;
}

describe('the code map', () => {
  it('maps every documented status.io component code', () => {
    // Pinned as literals rather than read back off the map. Two of these were
    // observed live (100, 200); the other four are from status.io's published
    // table, and a mapping nobody has seen fire can be wrong for a long time.
    expect(STATUSIO_CODE[100]).toBe('operational');
    expect(STATUSIO_CODE[200]).toBe('maintenance');
    expect(STATUSIO_CODE[300]).toBe('degraded');
    expect(STATUSIO_CODE[400]).toBe('degraded');
    expect(STATUSIO_CODE[500]).toBe('outage');
    expect(STATUSIO_CODE[600]).toBe('outage');
  });

  it('an unrecognised code is unknown, never operational', async () => {
    // status.io could add a 700 tomorrow. The one thing it must not do is read
    // as healthy — and this is the single most likely way a future feed change
    // turns a real outage green.
    const body = withContainer('Mail Traffic', 'United States - Atlanta', 700);
    const r = await pollStatusio(feed(), serve(body));
    expect(r.data!.level).toBe('unknown');
  });
});

describe('pollStatusio against the real captured payload', () => {
  it('covers the WHOLE estate: ours by datacentre, single-region ones globally', async () => {
    // All 19, not 16. The first version dropped the three services with no US
    // container — AI Recipient Validation (Frankfurt), Ticket System
    // (Europe-West), Website (Hannover) — on the reasoning that we are not
    // served from those regions. But a service published in exactly ONE region
    // is delivered to everyone from it, and John confirmed we use the whole
    // Hornetsecurity estate. Dropping them was a quietly shorter list that
    // still read healthy.
    const r = await pollStatusio(feed(), serve(CAPTURED));
    expect(r.data!.note).toContain('19 Hornetsecurity services');
    expect(r.data!.note).toContain('16 read from');
    expect(r.data!.note).toContain('3 published from one region only');
    expect(r.error).toBeUndefined();
  });

  it('a single-region service going down does reach our tile', async () => {
    // The consequence of the above, asserted rather than assumed. Frankfurt is
    // not our datacentre, but AI Recipient Validation is only ever served from
    // there, so its outage is our outage.
    const body = withContainer('AI Recipient Validation', 'Germany - Frankfurt', 500);
    // status.io carries the rollup on the service too; move both, as the real
    // feed does.
    const root = body as { result: { status: { name: string; status_code: number }[] } };
    root.result.status.find((x) => x.name === 'AI Recipient Validation')!.status_code = 500;
    const r = await pollStatusio(feed(), serve(body));
    expect(r.data!.level).toBe('outage');
    expect(r.data!.note).toContain('AI Recipient Validation (Outage)');
  });

  it('reads a service from OUR container, not from its global rollup', async () => {
    // The whole reason `locations` exists, and the captured payload happens to
    // contain the case: on 2026-09-19 `365 Total Backup` was in Planned
    // Maintenance globally while its Georgia container read Operational. An
    // unfiltered read reports maintenance we are not having.
    const scoped = await pollStatusio(feed(), serve(CAPTURED));
    const { locations: _l, ...unscopedFeed } = feed();
    const unscoped = await pollStatusio(unscopedFeed, serve(CAPTURED));

    expect(unscoped.data!.note).toContain('365 Total Backup');
    expect(scoped.data!.note).not.toContain('365 Total Backup');
  });

  it('needs BOTH United States names — they are not duplicates', async () => {
    // Atlanta carries the 13 core email services and Georgia the 3 newer 365
    // products, mutually exclusive. With only one listed, the other's services
    // fall back to their GLOBAL status rather than vanishing — so the count
    // stays at 19 and what changes is how many are read from our region. That
    // is the honest failure mode: we lose regional precision, not services.
    const atlantaOnly = await pollStatusio(feed({ locations: ['United States - Atlanta'] }), serve(CAPTURED));
    expect(atlantaOnly.data!.note).toContain('13 read from');
    const georgiaOnly = await pollStatusio(feed({ locations: ['United States - Georgia'] }), serve(CAPTURED));
    expect(georgiaOnly.data!.note).toContain('3 read from');
    // And the cost of getting it wrong, concretely: with only Georgia listed,
    // `365 Total Backup` is still read regionally but the 13 Atlanta services
    // are not, so a maintenance window anywhere in the world reaches our tile.
    expect(georgiaOnly.data!.note).toContain('16 published from one region only');
  });

  it('an outage in a datacentre that is not ours does not reach our tile', async () => {
    const body = withContainer('Mail Traffic', 'Germany - Frankfurt', 500);
    const r = await pollStatusio(feed(), serve(body));
    expect(r.data!.level).toBe('maintenance');   // unchanged: only Hornet.email, as captured
    expect(r.data!.note).not.toContain('Mail Traffic');
  });

  it('an outage in OUR datacentre does reach it, and wins the rollup', async () => {
    // The positive control for the test above. Same edit, our region, and the
    // level must move — otherwise the previous test passes because the filter
    // drops everything rather than because it drops the right thing.
    const body = withContainer('Mail Traffic', 'United States - Atlanta', 500);
    const r = await pollStatusio(feed(), serve(body));
    expect(r.data!.level).toBe('outage');
    expect(r.data!.note).toContain('Mail Traffic (Outage)');
  });

  it('a single matching container carries the service', async () => {
    // Renamed from "worst wins across our two datacentres", which is what it
    // said and not what it did: no service in the real feed carries BOTH our
    // containers — Atlanta and Georgia are mutually exclusive — so `worstLevel`
    // over a one-element list is indistinguishable from taking the first. The
    // mutation proved it: replacing the rollup with `matched[0]` left the whole
    // suite green. The real two-container case is the test below.
    const body = withContainer('365 Total Backup', 'United States - Georgia', 300);
    const r = await pollStatusio(feed(), serve(body));
    expect(r.data!.level).toBe('degraded');
  });

  it('worst wins when one service really is in both our datacentres', async () => {
    // Constructed, because the live feed has no such service today — and that
    // is exactly why it needs a test. The day Hornetsecurity lists one product
    // in both US containers, taking the first would report an outage as
    // operational depending on array order.
    const root = JSON.parse(JSON.stringify(CAPTURED)) as {
      result: { status: { name: string; containers?: { name: string; status_code: number }[] }[] };
    };
    const mail = root.result.status.find((x) => x.name === 'Mail Traffic')!;
    mail.containers = [
      { name: 'United States - Atlanta', status_code: 100 },   // healthy
      { name: 'United States - Georgia', status_code: 500 },   // and not
    ];
    const r = await pollStatusio(feed(), serve(root));
    expect(r.data!.level).toBe('outage');
    expect(r.data!.note).toContain('Mail Traffic (Outage)');

    // Both orders, so the assertion cannot be satisfied by "take the last"
    // either — that mutation is as plausible as "take the first".
    mail.containers.reverse();
    const flipped = await pollStatusio(feed(), serve(root));
    expect(flipped.data!.level).toBe('outage');
  });

  it('narrows to one named service when the feed asks for it', async () => {
    const r = await pollStatusio(feed({ component: 'Mail Traffic' }), serve(CAPTURED));
    expect(r.data!.level).toBe('operational');
    expect(r.data!.note).toContain('1 Hornetsecurity services');
  });

  it('reads unknown when a named service stops being published', async () => {
    const r = await pollStatusio(feed({ component: 'A Service That Left' }), serve(CAPTURED));
    expect(r.data!.level).toBe('unknown');
    expect(r.data!.note).toContain('no longer published');
  });

  it('reads unknown when none of our datacentres appear at all', async () => {
    // Either the names changed or we are reading the wrong ones. Both mean we
    // cannot see Proofpoint, which is not the same as Proofpoint being well.
    //
    // Checked separately from the rollup, and that separation is load-bearing:
    // with the global fallback in place, a total mismatch would otherwise read
    // as a perfectly ordinary unscoped estate and report `maintenance` as if
    // everything were fine.
    const r = await pollStatusio(feed({ locations: ['Mars - Olympus'] }), serve(CAPTURED));
    expect(r.data!.level).toBe('unknown');
    expect(r.data!.note).toContain('cannot see Proofpoint');
  });
});

describe('failure paths never read as green', () => {
  it('a transport failure is unknown with the reason attached', async () => {
    const r = await pollStatusio(feed(), serve('', 503));
    expect(r.data!.level).toBe('unknown');
    expect(r.error?.code).toBe('http_503');
    expect(r.data!.note).toContain('our failure to look');
  });

  it('a 2xx carrying HTML is unknown, not an empty healthy estate', async () => {
    // Amendment 7. The sign-in-page case, which is how this class of bug was
    // found on this tenant in the first place.
    const impl: FetchLike = async () =>
      new Response('<html>sign in</html>', { status: 200, headers: { 'content-type': 'application/json' } });
    const r = await pollStatusio(feed(), impl);
    expect(r.data!.level).toBe('unknown');
    expect(r.error?.code).toBe('non_json_2xx');
  });

  it('a shape we do not recognise is unknown', async () => {
    const r = await pollStatusio(feed(), serve({ result: { status: 'not an array' } }));
    expect(r.data!.level).toBe('unknown');
    expect(r.data!.note).toContain('shape we do not recognise');
  });

  it('carries the platform on every path, including the failures', async () => {
    // Amendment 5 — blackout groups by platform, and a failure that forgot to
    // say which platform it belonged to could not be grouped.
    for (const impl of [serve(CAPTURED), serve('', 503), serve({ nope: true })]) {
      const r = await pollStatusio(feed(), impl);
      expect(r.data!.platform).toBe('statusio');
    }
  });
});
