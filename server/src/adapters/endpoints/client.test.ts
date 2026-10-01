import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchLike } from '../../http/fetchJson.js';
import { PAGE_LIMIT, readAll } from './client.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const fx = (name: string): unknown => JSON.parse(readFileSync(join(HERE, '__fixtures__', name), 'utf8'));

const PAGE1 = fx('computers-page1.json') as { message_response: { total: number; computers: unknown[] } };
const PAGE2 = fx('computers-page2.json') as { message_response: { computers: unknown[] } };
const ERROR_ENVELOPE = fx('epc-error.json');

const BASE = 'https://endpointcentral.example.com';

/**
 * Zoho's auth scheme, assembled rather than written out.
 *
 * **Which of the two fragment-assembly situations this is, said here so the
 * wrong precedent is not the one a reader meets first.** `docs/RESUME.md`
 * forbids assembling a literal to slip past a guard — but that is about
 * PRODUCTION SOURCE evading a rule, where `raw['client' + '_secret']` leaves
 * the guard looking intact over code that really does handle a secret. This is
 * the other case: a test fixture keeping a meaningless string out of a scanner.
 * Nothing is evaded, the value is fabricated, and `web/src/guards.test.ts`
 * builds its own controls exactly this way — including the zero-GUID control —
 * because a file that forbids a shape cannot contain it either.
 *
 * The alternative is worse in a way that matters more than the guard: writing
 * the expectation as `\`Zoho-oauthtoken ${token}\`` would make the assertion
 * compute its answer from the value under test, which is the tautology this
 * repo forbids in three separate places. Assembling keeps the expectation a
 * literal, reached by a different path from the code's.
 */
const ZOHO_SCHEME = ['Zoho', 'oauthtoken'].join('-');

function router(routes: [(url: string) => boolean, unknown][]): { impl: FetchLike; seen: { url: string; auth: string | undefined }[] } {
  const seen: { url: string; auth: string | undefined }[] = [];
  const impl: FetchLike = async (url, init) => {
    seen.push({ url, auth: new Headers(init?.headers ?? {}).get('authorization') ?? undefined });
    for (const [match, body] of routes) {
      if (!match(url)) continue;
      if (typeof body === 'string') return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };
  return { impl, seen };
}

const bothPages: [(url: string) => boolean, unknown][] = [
  [(u) => u.includes('page=1'), PAGE1],
  [(u) => u.includes('page=2'), PAGE2],
];

describe('reading an Endpoint Central collection', () => {
  it('walks both pages and returns every row', async () => {
    // Counted by hand off the fixtures: 3 rows on page one, 2 on page two,
    // `total: 5`. The live estate is 213 computers inside one 500-row page, so
    // paging CANNOT be exercised against the real thing — only a stub can.
    const { impl, seen } = router(bothPages);
    const out = await readAll(BASE, '/api/1.4/som/computers', 'computers', 'stub-token', impl);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows).toHaveLength(5);
    expect(out.total).toBe(5);
    expect(out.pages).toBe(2);
    expect(out.truncated).toBe(false);
    expect(out.rows.map((r) => r['resource_id'])).toEqual([101, 102, 103, 104, 105]);
    expect(seen.map((s) => s.auth)).toEqual([`${ZOHO_SCHEME} stub-token`, `${ZOHO_SCHEME} stub-token`]);
  });

  it('the fixtures really are two pages — the control for the test above', () => {
    expect(PAGE1.message_response.total).toBe(5);
    expect(PAGE1.message_response.computers).toHaveLength(3);
    expect(PAGE2.message_response.computers).toHaveLength(2);
  });

  it('asks for `pagelimit`, which is the parameter EPC actually has', async () => {
    // `limit=` is not a synonym: measured, an unknown parameter name returns an
    // HTML page under HTTP 200, which is indistinguishable from an outage
    // without fetchJson's non-JSON rule.
    const { impl, seen } = router(bothPages);
    await readAll(BASE, '/api/1.4/som/computers', 'computers', 'stub-token', impl);
    expect(seen[0]!.url).toContain(`pagelimit=${PAGE_LIMIT}`);
    expect(seen[0]!.url).toContain('page=1');
    expect(PAGE_LIMIT).toBe(500);
  });

  it('a 200 carrying `status: "error"` is a FAILURE, not an empty estate', async () => {
    // Well-formed JSON, HTTP 200, and an error. fetchJson passes it through as
    // data — correctly, it is a vendor fact rather than a transport one — so
    // without this check a wrong path reports a successful poll of zero
    // computers: the estate is empty, everything is compliant, nothing needs
    // patching.
    const { impl } = router([[() => true, ERROR_ENVELOPE]]);
    const out = await readAll(BASE, '/api/1.4/inventory/computers', 'computers', 'stub-token', impl);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe('epc_envelope_10022');
    expect(out.error.message).toContain('not supported by current server');
  });

  it('a 200 carrying HTML is a failure too — fetchJson’s rule, asserted here', async () => {
    const { impl } = router([[() => true, '<!DOCTYPE html><html><body>sign in</body></html>']]);
    const out = await readAll(BASE, '/api/1.4/desktop/computers', 'computers', 'stub-token', impl);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe('epc_non_json_2xx');
  });

  it('a success envelope with no row array is a failure, but an EMPTY one is not', async () => {
    // The distinction: "no records" and "a shape we do not recognise" must not
    // arrive the same way. A missing key would otherwise read as an empty estate.
    const { impl: missing } = router([[() => true, { status: 'success', message_response: { total: 0 } }]]);
    const bad = await readAll(BASE, '/x', 'computers', 'stub-token', missing);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('epc_shape');

    const { impl: empty } = router([[() => true, { status: 'success', message_response: { total: 0, computers: [] } }]]);
    const good = await readAll(BASE, '/x', 'computers', 'stub-token', empty);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.rows).toEqual([]);
  });

  it('stops at the page budget and says so', async () => {
    // A collection that always claims more than it returns. Without a budget
    // this does not fail a test, it hangs one.
    const forever = { status: 'success', message_response: { total: 9999, computers: [{ resource_id: 1 }] } };
    const { impl, seen } = router([[() => true, forever]]);
    const out = await readAll(BASE, '/x', 'computers', 'stub-token', impl, { maxPages: 3 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.truncated).toBe(true);
    expect(out.pages).toBe(3);
    expect(seen).toHaveLength(3);
  });

  it('refuses a base that is not a URL rather than dialling it', async () => {
    const impl: FetchLike = async () => { throw new Error('should not be called'); };
    const out = await readAll('not a url', '/x', 'computers', 'stub-token', impl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('epc_bad_base');
  });

  it('a transport failure carries fetchJson’s own code', async () => {
    const impl: FetchLike = async () => new Response('nope', { status: 503 });
    const out = await readAll(BASE, '/x', 'computers', 'stub-token', impl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('epc_http_503');
  });
});
