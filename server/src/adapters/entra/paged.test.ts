import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchLike } from '../../http/fetchJson.js';
import { GRAPH_BETA, MAX_PAGES, MAX_RETRIES, RETRY_AFTER_CEILING_MS, RETRY_BASE_MS, readAll } from './paged.js';

// fileURLToPath, not URL.pathname — G-1 in docs/RESUME.md.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(HERE, '__fixtures__', name), 'utf8'));

const PAGE1 = fixture('signins-failed-page1.json') as { '@odata.nextLink': string; value: unknown[] };
const PAGE2 = fixture('signins-failed-page2.json') as { value: unknown[] };

/** A stub that answers per-URL and RECORDS every request, including its headers.
 *  The headers matter: the whole point of several tests below is where the
 *  bearer token did and did not go. */
function router(routes: Record<string, unknown>): { impl: FetchLike; seen: { url: string; auth: string | undefined }[] } {
  const seen: { url: string; auth: string | undefined }[] = [];
  const impl: FetchLike = async (url, init) => {
    const headers = new Headers(init?.headers ?? {});
    seen.push({ url, auth: headers.get('authorization') ?? undefined });
    const body = routes[url];
    if (body === undefined) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { impl, seen };
}

const START = `${GRAPH_BETA}/auditLogs/signIns?$top=1000`;

describe('paging a Graph collection', () => {
  it('follows @odata.nextLink and returns every row from BOTH pages', async () => {
    // The numbers are read off the fixtures by hand — 3 rows on page one, 3 on
    // page two — rather than computed from the same arrays the code walks.
    const { impl, seen } = router({ [START]: PAGE1, [PAGE1['@odata.nextLink']]: PAGE2 });
    const result = await readAll(START, 'stub-token', impl);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(6);
    // Pinned as literals, in order, so a loop that silently kept only the last
    // page cannot pass this.
    expect(result.rows.map((r) => r['id'])).toEqual([
      'DEMO-SIGNIN-0001', 'DEMO-SIGNIN-0002', 'DEMO-SIGNIN-0003',
      'DEMO-SIGNIN-0004', 'DEMO-SIGNIN-0005', 'DEMO-SIGNIN-0006',
    ]);
    expect(seen).toHaveLength(2);
    expect(seen.map((s) => s.auth)).toEqual(['Bearer stub-token', 'Bearer stub-token']);
  });

  it('the fixtures really are two pages — the control for the test above', () => {
    // Without this, a single-page fixture would make the assertion "returns
    // every row" pass while proving nothing about paging at all. Same failure
    // as a guard whose walk finds no files.
    expect(typeof PAGE1['@odata.nextLink']).toBe('string');
    expect(PAGE1.value).toHaveLength(3);
    expect(PAGE2).not.toHaveProperty('@odata.nextLink');
    expect(PAGE2.value).toHaveLength(3);
  });

  it('refuses a nextLink on another origin AND never sends the token there', async () => {
    // `safeTarget` would allow this URL: it is https, a named public host, no
    // embedded credential. It is refused here because the request carries an
    // app-only Graph token for the whole tenant and the URL was chosen by the
    // response body.
    const hostile = 'https://exfiltration.example.net/v1.0/auditLogs/signIns?$skiptoken=DEMO-SKIP-0002';
    const { impl, seen } = router({
      [START]: { value: [{ id: 'DEMO-SIGNIN-0001' }], '@odata.nextLink': hostile },
      [hostile]: { value: [] },
    });
    const result = await readAll(START, 'stub-token', impl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('entra_foreign_next_link');
    expect(result.error.message).toContain('exfiltration.example.net');
    // The claim the name makes: exactly one request, to the origin we chose.
    expect(seen.map((s) => s.url)).toEqual([START]);
  });

  it('a same-origin nextLink on a different path is followed — the other half', async () => {
    // A rule that refused everything would pass the test above for the wrong
    // reason. This is the world where the two candidates differ.
    const onward = `${GRAPH_BETA}/auditLogs/signIns?$skiptoken=DEMO-SKIP-0003`;
    const { impl } = router({
      [START]: { value: [{ id: 'DEMO-SIGNIN-0001' }], '@odata.nextLink': onward },
      [onward]: { value: [{ id: 'DEMO-SIGNIN-0002' }] },
    });
    const result = await readAll(START, 'stub-token', impl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r['id'])).toEqual(['DEMO-SIGNIN-0001', 'DEMO-SIGNIN-0002']);
  });

  it('stops at the page budget and SAYS it stopped', async () => {
    // A cycle: every page points at itself, on the SAME origin so the origin
    // pin does not short-circuit this and the budget is the only thing stopping
    // it. Without a budget this test does not fail, it hangs.
    const loop = `${GRAPH_BETA}/auditLogs/signIns?$skiptoken=DEMO-SKIP-0004`;
    const { impl, seen } = router({
      [START]: { value: [{ id: 'DEMO-SIGNIN-0001' }], '@odata.nextLink': loop },
      [loop]: { value: [{ id: 'DEMO-SIGNIN-0002' }], '@odata.nextLink': loop },
    });

    const result = await readAll(START, 'stub-token', impl, { maxPages: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.pages).toBe(3);
    expect(result.rows).toHaveLength(3);
    expect(seen).toHaveLength(3);
  });

  it('the default budget is a real number, not undefined', () => {
    // `maxPages ?? MAX_PAGES` silently becomes "unbounded" if the constant is
    // ever deleted, and an unbounded loop over a cycling nextLink does not fail
    // a test — it hangs one.
    expect(MAX_PAGES).toBeGreaterThan(1);
    expect(Number.isInteger(MAX_PAGES)).toBe(true);
  });

  it('a 200 with no `value` array is a FAILURE, not an empty collection', async () => {
    // Graph answers a rejected $filter with a JSON body and no `value`. Reading
    // that as zero rows is how a broken query becomes a confident zero, which on
    // this screen is the reassuring direction.
    const { impl } = router({ [START]: { error: { code: 'BadRequest', message: 'Unsupported Query.' } } });
    const result = await readAll(START, 'stub-token', impl);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('entra_shape');
  });

  it('a row that is not an object is a failure too', async () => {
    const { impl } = router({ [START]: { value: ['DEMO-SIGNIN-0001'] } });
    const result = await readAll(START, 'stub-token', impl);
    expect(result.ok).toBe(false);
  });

  it('an empty `value` array is a success with no rows — the other half', async () => {
    // The distinction the two tests above are about: "no records" and "we could
    // not ask" must not arrive in the same shape.
    const { impl } = router({ [START]: { value: [] } });
    const result = await readAll(START, 'stub-token', impl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('a transport failure comes back as a failure with fetchJson’s own code', async () => {
    const impl: FetchLike = async () => new Response('nope', { status: 503 });
    const result = await readAll(START, 'stub-token', impl);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('entra_http_503');
  });

  it('waits out a 429 and succeeds on the retry — found by running it, not by reasoning', async () => {
    // The live tenant answered `429 Too Many Requests` on the SECOND request of
    // the first real poll. Under this adapter's all-or-nothing rule that one
    // status costs the whole snapshot, so a 429 has to be waited out rather
    // than reported.
    const waits: number[] = [];
    let calls = 0;
    const impl: FetchLike = async () => {
      calls += 1;
      if (calls <= 2) return new Response('slow down', { status: 429 });
      return new Response(JSON.stringify({ value: [{ id: 'DEMO-SIGNIN-0001' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const result = await readAll(START, 'stub-token', impl, {
      sleep: async (ms) => { waits.push(ms); },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    // Exponential, and pinned as the literal milliseconds rather than derived
    // from the constant the code uses.
    expect(waits).toEqual([5000, 10000]);
    expect(calls).toBe(3);
  });

  it('gives up after a bounded number of 429s and reports the 429', async () => {
    // The other half. A retry loop with no ceiling is a poll that never ends,
    // and "we are being throttled" is a fact the operator should see rather than
    // something this hides by trying forever.
    const waits: number[] = [];
    let calls = 0;
    const impl: FetchLike = async () => { calls += 1; return new Response('slow down', { status: 429 }); };
    const result = await readAll(START, 'stub-token', impl, { sleep: async (ms) => { waits.push(ms); } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('entra_http_429');
    expect(calls).toBe(MAX_RETRIES + 1);
    expect(waits).toHaveLength(MAX_RETRIES);
  });

  it('retries a 429 and NOTHING else', async () => {
    // A retry on a 503 or a timeout would turn a poll into a stall; the poller's
    // next tick is the right granularity for those.
    for (const status of [500, 503, 403, 404]) {
      let calls = 0;
      const impl: FetchLike = async () => { calls += 1; return new Response('no', { status }); };
      const result = await readAll(START, 'stub-token', impl, { sleep: async () => {} });
      expect(result.ok).toBe(false);
      expect(calls).toBe(1);
    }
  });

  it('waits exactly what Retry-After asked for, in preference to our exponential', async () => {
    // The server named an interval; waiting one we invented instead is guessing
    // over a measurement. 7s and 3s are neither of them values the exponential
    // can produce, so this cannot pass by coincidence.
    const waits: number[] = [];
    let calls = 0;
    const impl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) return new Response('slow', { status: 429, headers: { 'retry-after': '7' } });
      if (calls === 2) return new Response('slow', { status: 429, headers: { 'retry-after': '3' } });
      return new Response(JSON.stringify({ value: [{ id: 'DEMO-SIGNIN-0001' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const result = await readAll(START, 'stub-token', impl, { sleep: async (ms) => { waits.push(ms); } });
    expect(result.ok).toBe(true);
    expect(waits).toEqual([7_000, 3_000]);
    // And not the fallback, which would have been these.
    expect(waits).not.toEqual([RETRY_BASE_MS, RETRY_BASE_MS * 2]);
  });

  it('falls back to the exponential only when the server named nothing', async () => {
    // The other half. Without it, "prefer Retry-After" could be implemented as
    // "always use Retry-After" and every 429 with no header would wait
    // `undefined` milliseconds — which `setTimeout` treats as zero, i.e. a hot
    // loop against a server asking for quiet.
    const waits: number[] = [];
    let calls = 0;
    const impl: FetchLike = async () => {
      calls += 1;
      if (calls <= 2) return new Response('slow', { status: 429 });   // no header
      return new Response(JSON.stringify({ value: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const result = await readAll(START, 'stub-token', impl, { sleep: async (ms) => { waits.push(ms); } });
    expect(result.ok).toBe(true);
    expect(waits).toEqual([5_000, 10_000]);
    for (const w of waits) expect(Number.isFinite(w)).toBe(true);
  });

  it('honours a Retry-After of ZERO rather than treating it as no header', async () => {
    // An HTTP-date already past parses to 0, which is a real instruction
    // meaning "now". A `??`-versus-`||` slip here silently restores the
    // five-second fallback and nothing else in the suite would notice.
    const waits: number[] = [];
    let calls = 0;
    const past = new Date(Date.now() - 60_000).toUTCString();
    const impl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) return new Response('slow', { status: 429, headers: { 'retry-after': past } });
      return new Response(JSON.stringify({ value: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const result = await readAll(START, 'stub-token', impl, { sleep: async (ms) => { waits.push(ms); } });
    expect(result.ok).toBe(true);
    expect(waits).toEqual([0]);
  });

  it('refuses to wait out a Retry-After past the ceiling, and says the server’s number', async () => {
    // Clamping would wait two minutes against a server that asked for an hour
    // and then ask again, earning a second 429 and telling the operator
    // nothing. Reporting it names the real figure.
    const waits: number[] = [];
    let calls = 0;
    const impl: FetchLike = async () => {
      calls += 1;
      return new Response('slow', { status: 429, headers: { 'retry-after': '3600' } });
    };
    const result = await readAll(START, 'stub-token', impl, { sleep: async (ms) => { waits.push(ms); } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('entra_http_429');
    expect(result.error.message).toContain('3600s');
    expect(result.error.message).toContain('120s');
    expect(waits).toEqual([]);      // it did not wait at all
    expect(calls).toBe(1);          // and it did not ask again
  });

  it('waits out a Retry-After exactly AT the ceiling — the boundary', async () => {
    // The other side of the comparison. `>` rather than `>=` is deliberate and
    // a test that only ever used 3600 could not tell the two apart.
    const waits: number[] = [];
    let calls = 0;
    const impl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) return new Response('slow', { status: 429, headers: { 'retry-after': '120' } });
      return new Response(JSON.stringify({ value: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const result = await readAll(START, 'stub-token', impl, { sleep: async (ms) => { waits.push(ms); } });
    expect(result.ok).toBe(true);
    expect(waits).toEqual([RETRY_AFTER_CEILING_MS]);
  });

  it('the backoff constants are real numbers', () => {
    expect(RETRY_AFTER_CEILING_MS).toBeGreaterThan(RETRY_BASE_MS);
    expect(MAX_RETRIES).toBeGreaterThan(0);
    expect(RETRY_BASE_MS).toBeGreaterThan(0);
  });

  it('refuses an unparseable starting URL rather than dialling it', async () => {
    const impl: FetchLike = async () => { throw new Error('should not be called'); };
    const result = await readAll('not a url', 'stub-token', impl);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('entra_bad_url');
  });
});
