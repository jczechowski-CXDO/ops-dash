import { describe, it, expect, vi } from 'vitest';
import { fetchJson, type FetchLike } from './fetchJson.js';

/** A stub Response good enough for the four rules. Deliberately hand-built
 *  rather than using undici's: the point is to control the exact body and
 *  status a hostile or broken feed would send. */
const res = (body: string, init: { status?: number; contentType?: string } = {}): Response =>
  ({
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    statusText: 'stub',
    headers: new Headers({ 'content-type': init.contentType ?? 'application/json' }),
    text: async () => body,
  }) as unknown as Response;

const stub = (r: Response | Error): FetchLike =>
  vi.fn(async () => {
    if (r instanceof Error) throw r;
    return r;
  });

describe('fetchJson — a broken feed is data, not an exception', () => {
  it('200 with valid JSON is the only path that yields data', async () => {
    const out = await fetchJson<{ ok: number }>('https://x/y', { fetchImpl: stub(res('{"ok":1}')) });
    expect(out.data).toEqual({ ok: 1 });
    expect(out.degraded).toBe(false);
    expect(out.error).toBeUndefined();
    expect(out.empty).toBeUndefined();
    expect(Date.parse(out.fetchedAt)).not.toBeNaN();
  });

  it('200 carrying HTML is an ERROR, not data — the EPC case', async () => {
    // Not hypothetical. EPC's /api/1.4/common/groups returns HTTP 200 with a
    // Zoho sign-in page when the token has expired, so an adapter that trusts
    // the status code reports a successful poll of zero records. This is
    // amendment 7 and it is the reason this helper exists at all.
    const html = '<!doctype html><html><body>Sign in to Zoho</body></html>';
    const out = await fetchJson('https://x/y', {
      fetchImpl: stub(res(html, { contentType: 'text/html' })),
    });
    expect(out.error?.code).toBe('non_json_2xx');
    expect(out.data).toBeUndefined();
    // And the body is NOT echoed into the message: a hostile feed's HTML must
    // not travel any further than it has to.
    expect(out.error?.message ?? '').not.toContain('Sign in to Zoho');
  });

  it('200 carrying JSON-shaped garbage is also non_json_2xx', async () => {
    // content-type lies are common; the decode is what decides, not the header.
    const out = await fetchJson('https://x/y', {
      fetchImpl: stub(res('{"unterminated": ', { contentType: 'application/json' })),
    });
    expect(out.error?.code).toBe('non_json_2xx');
  });

  it('200 with an empty collection is EMPTY, never operational', async () => {
    const out = await fetchJson<unknown[]>('https://x/y', { fetchImpl: stub(res('[]')) });
    expect(out.empty).toBe(true);
    expect(out.data).toEqual([]);
    expect(out.error).toBeUndefined();
  });

  it('200 with a JSON null is an error — a null body is not a payload', async () => {
    const out = await fetchJson('https://x/y', { fetchImpl: stub(res('null')) });
    // The CODE, not merely that something went wrong. Asserting `error` is
    // defined passed against a version with the guard removed: null fell
    // through to Object.keys(null), threw, and was caught as `network`. Still
    // an error, still wrong — a transport blamed for a payload problem, and a
    // diagnosis nobody could act on.
    expect(out.error?.code).toBe('null_body');
    expect(out.data).toBeUndefined();
  });

  it.each([
    [500, 'http_500'],
    [429, 'http_429'],
    [404, 'http_404'],
    [301, 'http_301'],
  ])('%i is an error with a code naming it', async (status, code) => {
    const out = await fetchJson('https://x/y', { fetchImpl: stub(res('{}', { status })) });
    expect(out.error?.code).toBe(code);
    expect(out.data).toBeUndefined();
  });

  it('a thrown network error is caught and named', async () => {
    const out = await fetchJson('https://x/y', { fetchImpl: stub(new Error('ECONNREFUSED')) });
    expect(out.error?.code).toBe('network');
    expect(out.error?.message).toContain('ECONNREFUSED');
  });

  it('a timeout aborts the request rather than merely giving up on it', async () => {
    // The distinction matters: a helper that stops waiting but leaves the
    // socket open leaks one per poll, and the poller runs every 60 seconds
    // forever. Assert the signal actually fired.
    let sawAbort = false;
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          sawAbort = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const out = await fetchJson('https://x/y', { fetchImpl: hang, timeoutMs: 10 });
    expect(out.error?.code).toBe('timeout');
    expect(sawAbort).toBe(true);
  });

  it('stamps fetchedAt on every path, success or failure', async () => {
    // A failed poll still happened at a time, and the UI renders "last tried"
    // from it. A missing fetchedAt on the error path makes a dead source look
    // like one that was never polled.
    for (const r of [res('{}'), res('', { status: 500 }), res('<html>', { contentType: 'text/html' })]) {
      const out = await fetchJson('https://x/y', { fetchImpl: stub(r) });
      expect(Date.parse(out.fetchedAt), JSON.stringify(out)).not.toBeNaN();
    }
  });

  it('never throws, whatever the transport does', async () => {
    // The poller's isolation depends on this. If the helper can throw, every
    // adapter needs its own try/catch and one of them will forget.
    const nasty: FetchLike = () => {
      throw new Error('synchronous explosion');
    };
    await expect(fetchJson('https://x/y', { fetchImpl: nasty })).resolves.toBeDefined();
  });
});
