import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../../http/fetchJson.js';
import type { HornetConfig } from './config.js';
import { BLOCKED_CLASSIFICATION_IDS, RECENT_BLOCKED_LIMIT, readEmail } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(HERE, '__fixtures__', name), 'utf8')) as unknown;

/** A config that is obviously not a credential: the host is a documentation
 *  domain, the token is the word 'stub'. `loadHornetConfig` is tested against
 *  its own validation separately; this is the shape the adapter consumes. */
const CONFIG: HornetConfig = {
  baseUrl: 'https://cp.example.com/api/v0',
  token: 'stub-token',
  appId: '1234567890',
  objectId: '99',
};

const NOW = Date.parse('2026-09-20T18:00:00Z');

type Recorded = { url: string; method: string; headers: Record<string, string>; body: unknown };

/**
 * A stubbed Control Panel.
 *
 * `answer` is consulted per call with the parsed request body, so a test can
 * make the second search answer differently from the first — which is the whole
 * of the credential-phishing delta and the only place two calls to one endpoint
 * must not be confused for each other.
 */
function stub(answer: (call: Recorded, index: number) => { status?: number; body: unknown; text?: string }) {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const record: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(record);
    const { status = 200, body, text } = answer(record, calls.length - 1);
    return new Response(text ?? JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetchImpl };
}

/** The four answers a healthy poll gets, in the order the adapter asks. */
const healthy = (phishNow = 94, phishPrev = 92) =>
  stub((_call, i) => {
    if (i === 0) return { body: fixture('statistics-by-type.json') };
    if (i === 1) return { body: fixture('search-blocked.json') };
    if (i === 2) return { body: { num_found_items: phishNow, has_more_elements: true, emails: [] } };
    return { body: { num_found_items: phishPrev, has_more_elements: true, emails: [] } };
  });

describe('readEmail — the happy path', () => {
  it('produces the four figures that are real, pinned to hand-computed literals', async () => {
    const { fetchImpl } = healthy();
    const result = await readEmail({ config: CONFIG, fetchImpl, now: () => NOW });
    expect(result.error).toBeUndefined();
    expect(result.degraded).toBe(false);
    expect(result.data?.stats).toEqual({
      processed24h: 10000,
      blocked24h: 600, // 500 spam + 6 rejected + 90 threat + 0 content + 4 advthreat
      credentialPhishing24h: 94,
      credentialPhishingDelta: 2, // 94 - 92, both measured windows
    });
  });

  it('carries the blocked list, newest first', async () => {
    const { fetchImpl } = healthy();
    const result = await readEmail({ config: CONFIG, fetchImpl, now: () => NOW });
    expect(result.data?.recentBlocked).toHaveLength(4);
    expect(result.data?.recentBlocked[0]?.at).toBe('2026-09-20T16:18:36.000Z');
    expect(result.data?.recentBlocked.map((r) => r.at)).toEqual(
      [...(result.data?.recentBlocked ?? [])].map((r) => r.at).sort().reverse(),
    );
  });

  it('reports a falling delta as negative rather than as nothing', async () => {
    // A sign error here turns yesterday's spike into today's alarm. Run against
    // the world where the two candidates DIFFER, and in both directions.
    const down = await readEmail({ config: CONFIG, fetchImpl: healthy(11, 17).fetchImpl, now: () => NOW });
    expect(down.data?.stats.credentialPhishingDelta).toBe(-6);
    const flat = await readEmail({ config: CONFIG, fetchImpl: healthy(11, 11).fetchImpl, now: () => NOW });
    expect(flat.data?.stats.credentialPhishingDelta).toBe(0);
  });

  it('has no cold start — the first poll after a restart has a real yesterday', async () => {
    // Stated because three components in this repo have shipped or nearly
    // shipped a cold-start defect in two days, and the honest answer here is
    // that this one cannot have the defect rather than that nobody checked.
    // Unlike Entra's MFA gap, 'yesterday' is a QUERY against the vendor, not a
    // snapshot we have to have remembered. `readEmail` takes no `previous`
    // parameter, so there is no first-run branch to get wrong.
    const first = await readEmail({ config: CONFIG, fetchImpl: healthy(94, 92).fetchImpl, now: () => NOW });
    const second = await readEmail({ config: CONFIG, fetchImpl: healthy(94, 92).fetchImpl, now: () => NOW });
    expect(first.data?.stats).toEqual(second.data?.stats);
    expect(first.data?.stats.credentialPhishingDelta).toBe(2);
  });
});

describe('the requests it makes, and the ones it must never make', () => {
  it('never calls /emails/statistics/summary/ — that endpoint reports a false zero', async () => {
    // Measured on the live tenant: summary answered {"total":10079,"malicious":0}
    // for a window in which by_type reported 527 spam, 94 threat and 4 advthreat.
    // It is the shortest path to blocked24h and it is a lie. This is a pin on
    // the decision, not on the implementation — it fails the moment somebody
    // reaches for the convenient endpoint.
    const { calls, fetchImpl } = healthy();
    await readEmail({ config: CONFIG, fetchImpl, now: () => NOW });
    for (const call of calls) expect(call.url).not.toContain('summary');
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/api/v0/emails/statistics/by_type/',
      '/api/v0/emails/_search/',
      '/api/v0/emails/_search/',
      '/api/v0/emails/_search/',
    ]);
  });

  it('sends the customer scope on every call, and the token in a header rather than the URL', async () => {
    const { calls, fetchImpl } = healthy();
    await readEmail({ config: CONFIG, fetchImpl, now: () => NOW });
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(new URL(call.url).searchParams.get('object_id')).toBe('99');
      // A credential in a query string ends up in a log the day this is
      // deployed, and `fetchJson` puts a refused URL into an error message that
      // reaches /api/health.
      expect(call.url).not.toContain(CONFIG.token);
      expect(call.headers['authorization']).toBe('Token stub-token');
      expect(call.headers['app-id']).toBe('1234567890');
      expect(call.method).toBe('POST');
    }
  });

  it('asks for incoming mail only, in the 24-hour window the page claims', async () => {
    const { calls, fetchImpl } = healthy();
    await readEmail({ config: CONFIG, fetchImpl, now: () => NOW });
    const bodies = calls.map((c) => c.body as Record<string, unknown>);
    for (const body of bodies) expect(body['direction']).toEqual([1]);
    // Pinned as literals against a frozen clock, and with no fractional
    // seconds: that format is the one measured working, and a validation error
    // from this API arrives as a 400 that is indistinguishable, from the panel,
    // from the vendor being down.
    expect(bodies[0]).toMatchObject({ date_from: '2026-09-19T18:00:00Z', date_to: '2026-09-20T18:00:00Z' });
    expect(bodies[1]).toMatchObject({ date_from: '2026-09-19T18:00:00Z', date_to: '2026-09-20T18:00:00Z' });
    expect(bodies[2]).toMatchObject({ date_from: '2026-09-19T18:00:00Z', date_to: '2026-09-20T18:00:00Z' });
    // The previous window is the 24 hours BEFORE that one, and it must not
    // overlap it — an overlap double-counts the messages in the shared hours
    // and reports a delta of roughly zero however the traffic moved.
    expect(bodies[3]).toMatchObject({ date_from: '2026-09-18T18:00:00Z', date_to: '2026-09-19T18:00:00Z' });
  });

  it('filters the list to the blocked classifications and asks for the newest first', async () => {
    const { calls, fetchImpl } = healthy();
    await readEmail({ config: CONFIG, fetchImpl, now: () => NOW });
    expect(calls[1]?.body).toMatchObject({
      classification: [...BLOCKED_CLASSIFICATION_IDS],
      sort: { key: 'date', order: 'desc' },
      limit: RECENT_BLOCKED_LIMIT,
      offset: 0,
    });
    // `sort.key`, not `sort.field`. The vendor rejects `field` with a 400
    // validation error naming `key` as required, and that 400 would reach the
    // panel as 'the vendor is unreachable'.
    expect((calls[1]?.body as { sort: Record<string, unknown> }).sort['field']).toBeUndefined();
  });

  it('pulls one row, not ninety-four, when it only wants a count', async () => {
    const { calls, fetchImpl } = healthy();
    await readEmail({ config: CONFIG, fetchImpl, now: () => NOW });
    expect(calls[2]?.body).toMatchObject({ reason: 'phishing', limit: 1 });
    expect(calls[3]?.body).toMatchObject({ reason: 'phishing', limit: 1 });
  });

  it('issues them one at a time — four concurrent requests is the shape that earns a 429', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl: FetchLike = async (_url, init) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      const isStats = 'direction' in body && !('sort' in body);
      return new Response(
        JSON.stringify(isStats ? fixture('statistics-by-type.json') : { num_found_items: 1, emails: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    await readEmail({ config: CONFIG, fetchImpl, now: () => NOW });
    expect(maxInFlight).toBe(1);
  });
});

describe('failure is reported as failure, and the four stats fail together', () => {
  const cases: [string, (i: number) => { status?: number; body: unknown; text?: string }][] = [
    ['the statistics call', (i) => (i === 0 ? { status: 401, body: { error_message: 'Invalid token' } } : { body: {} })],
    [
      'the list call',
      (i) =>
        i === 0
          ? { body: fixture('statistics-by-type.json') }
          : { status: 503, body: { error_message: 'upstream' } },
    ],
    [
      'the credential-phishing call',
      (i) =>
        i === 0
          ? { body: fixture('statistics-by-type.json') }
          : i === 1
            ? { body: fixture('search-blocked.json') }
            : { status: 500, body: {} },
    ],
  ];

  for (const [what, answer] of cases) {
    it(`returns NO data when ${what} fails`, async () => {
      // All-or-nothing, the same decision `adapters/entra/index.ts` argues. The
      // contract has no way to write 'we could not look' into one of these
      // numbers, and every one of the four reads as GOOD NEWS at zero: no mail
      // processed, nothing blocked, no phishing, no change since yesterday.
      const { fetchImpl } = stub((_c, i) => answer(i));
      const result = await readEmail({ config: CONFIG, fetchImpl, now: () => NOW });
      expect(result.data).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.degraded).toBe(false);
    });
  }

  it('treats a 200 carrying a sign-in page as an error, not as zero mail', async () => {
    // Proven necessary on another tenant: EPC's groups endpoint answers HTTP
    // 200 with an HTML login page when the token has expired. `fetchJson` owns
    // that rule; this asserts the adapter inherits it rather than parsing
    // leniently on its own.
    const { fetchImpl } = stub(() => ({ status: 200, body: null, text: '<!doctype html><title>Sign in</title>' }));
    const result = await readEmail({ config: CONFIG, fetchImpl, now: () => NOW });
    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe('non_json_2xx');
  });

  it('refuses a 200 of the wrong shape rather than reading zeros out of it', async () => {
    const { fetchImpl } = stub(() => ({ body: { unexpected: true } }));
    const result = await readEmail({ config: CONFIG, fetchImpl, now: () => NOW });
    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe('unreadable_payload');
  });

  it('stops at the first failure instead of hammering a vendor that is already refusing us', async () => {
    const { calls, fetchImpl } = stub(() => ({ status: 429, body: {} }));
    await readEmail({ config: CONFIG, fetchImpl, now: () => NOW });
    expect(calls).toHaveLength(1);
  });
});

describe('degraded is a third state, and it is not decoration', () => {
  it('returns the data AND the reason when a category is one nobody here has seen', async () => {
    const { fetchImpl } = stub((_c, i) => {
      if (i === 0) {
        return {
          body: {
            emails_total: 12,
            data: [
              { type: 2, value: 10, name: 'clean' },
              { type: 99, value: 2, name: 'smuggled' },
            ],
          },
        };
      }
      if (i === 1) return { body: fixture('search-blocked.json') };
      return { body: { num_found_items: 0, emails: [] } };
    });
    const result = await readEmail({ config: CONFIG, fetchImpl, now: () => NOW });
    // Both halves. A degrade that lost the data would be a failure wearing a
    // different name, and a degrade with no explanation is a badge nobody can act on.
    expect(result.data?.stats.processed24h).toBe(12);
    expect(result.degraded).toBe(true);
    expect(result.error?.code).toBe('partial_read');
    expect(result.error?.message).toContain('smuggled');
  });
});
