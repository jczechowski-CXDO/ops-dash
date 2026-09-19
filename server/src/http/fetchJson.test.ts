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

describe('the SSRF floor applies to every hop, not just the one we typed', () => {
  /** A stub that replays a scripted sequence of responses and records every URL
   *  it was asked for. The URL list is the assertion: what matters is not only
   *  what came back but *where this process went*. */
  const chain = (...responses: Response[]) => {
    const asked: string[] = [];
    let i = 0;
    const impl: FetchLike = async (url) => {
      asked.push(url);
      return responses[Math.min(i++, responses.length - 1)]!;
    };
    return { impl, asked };
  };

  const redirectTo = (location: string, status = 302) =>
    new Response('', { status, headers: { location } });

  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

  it('refuses a redirect that downgrades to http, and never opens it', async () => {
    // Reproduced against two local servers before this was written: the
    // redirect was followed, the scheme downgraded, an internal address was
    // fetched, and the body came back as a clean un-degraded SourceResult —
    // indistinguishable from a good vendor read.
    const c = chain(redirectTo('http://127.0.0.1:9/latest/meta-data/'), json({ secret: 'internal' }));
    const result = await fetchJson<unknown>('https://status.example.com/feed.json', { fetchImpl: c.impl });

    expect(result.error?.code).toBe('not_https');
    expect(result.data).toBeUndefined();
    // The assertion that matters most: we never dialled it. A check that
    // rejected the *response* would still have made the request.
    expect(c.asked).toEqual(['https://status.example.com/feed.json']);
  });

  it('refuses an https redirect to loopback or a private-looking host', async () => {
    for (const target of [
      'https://127.0.0.1/admin',
      'https://localhost/admin',
      'https://[::1]/admin',
      'https://10.0.0.5/admin',
      'https://192.168.1.1/admin',
      'https://169.254.169.254/latest/meta-data/',
      'https://2130706433/admin',
      'https://printer.local/admin',
    ]) {
      const c = chain(redirectTo(target), json({ secret: 'internal' }));
      const result = await fetchJson<unknown>('https://status.example.com/feed.json', { fetchImpl: c.impl });
      expect(result.error?.code, `${target} was not refused`).toBe('private_target');
      expect(c.asked, `${target} was dialled`).toHaveLength(1);
    }
  });

  it('refuses a URL carrying credentials', async () => {
    const c = chain(json({}));
    const result = await fetchJson<unknown>('https://user:pw@status.example.com/feed.json', { fetchImpl: c.impl });
    expect(result.error?.code).toBe('url_credentials');
    expect(c.asked).toEqual([]);
  });

  it('follows a legitimate https redirect and re-validates the destination', async () => {
    // The floor must not be a wall. Real status hosts do redirect.
    const c = chain(redirectTo('https://status.example.com/v2/feed.json'), json({ ok: 1 }));
    const result = await fetchJson<{ ok: number }>('https://status.example.com/feed.json', { fetchImpl: c.impl });
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ ok: 1 });
    expect(c.asked).toEqual([
      'https://status.example.com/feed.json',
      'https://status.example.com/v2/feed.json',
    ]);
  });

  it('resolves a relative Location and still validates it', async () => {
    const c = chain(redirectTo('/v2/feed.json'), json({ ok: 1 }));
    const result = await fetchJson<unknown>('https://status.example.com/feed.json', { fetchImpl: c.impl });
    expect(result.error).toBeUndefined();
    expect(c.asked[1]).toBe('https://status.example.com/v2/feed.json');
  });

  it('gives up rather than looping forever', async () => {
    const c = chain(redirectTo('https://status.example.com/again'));
    const result = await fetchJson<unknown>('https://status.example.com/feed.json', { fetchImpl: c.impl });
    expect(result.error?.code).toBe('too_many_redirects');
    // Bounded, and the bound is small.
    expect(c.asked.length).toBeLessThanOrEqual(4);
  });

  it('treats a redirect with no Location as the http error it is', async () => {
    const c = chain(new Response('', { status: 302 }));
    const result = await fetchJson<unknown>('https://status.example.com/feed.json', { fetchImpl: c.impl });
    expect(result.error?.code).toBe('http_302');
  });
});

describe('a hostile body cannot exhaust memory', () => {
  /** A response whose stream keeps producing chunks. Streamed rather than a big
   *  string, because the defect is about what gets BUFFERED — a test built from
   *  an already-materialised string proves the check runs, not that it saves
   *  anything. */
  const streaming = (chunkBytes: number, chunks: number, headers: Record<string, string> = {}) => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (sent++ >= chunks) return void ctrl.close();
        ctrl.enqueue(new Uint8Array(chunkBytes).fill(0x20));
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json', ...headers } });
  };

  it('refuses a body past the cap with its own error code', async () => {
    const impl: FetchLike = async () => streaming(64 * 1024, 200);   // ~12.5 MB
    const result = await fetchJson<unknown>('https://status.example.com/feed.json', {
      fetchImpl: impl, maxBytes: 1024 * 1024,
    });
    expect(result.error?.code).toBe('body_too_large');
    expect(result.data).toBeUndefined();
    // A failure like any other: reported, never thrown.
    expect(result.fetchedAt).toBeTruthy();
  });

  it('stops pulling instead of reading to the end', async () => {
    // The whole point. A cap enforced after `text()` resolves has already spent
    // the memory it was meant to save, so assert on how much was PULLED.
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        pulled += 1;
        ctrl.enqueue(new Uint8Array(64 * 1024).fill(0x20));
      },
    });
    const impl: FetchLike = async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });

    const result = await fetchJson<unknown>('https://status.example.com/feed.json', {
      fetchImpl: impl, maxBytes: 256 * 1024,
    });
    expect(result.error?.code).toBe('body_too_large');
    // 256 KB cap at 64 KB a chunk: a handful of pulls, not an unbounded stream.
    expect(pulled).toBeLessThan(10);
  });

  it('rejects on a declared content-length without draining the stream', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) { pulled += 1; ctrl.enqueue(new Uint8Array(1024)); },
    });
    const impl: FetchLike = async () =>
      new Response(body, { status: 200, headers: { 'content-length': String(50 * 1024 * 1024) } });

    const result = await fetchJson<unknown>('https://status.example.com/feed.json', {
      fetchImpl: impl, maxBytes: 1024 * 1024,
    });
    expect(result.error?.code).toBe('body_too_large');

    // At most one, and the one is ours on purpose: the header check cancels the
    // stream, and cancelling pulls the chunk already queued under the default
    // strategy. Chasing zero here would mean NOT cancelling, which leaves the
    // peer streaming into a socket nobody is reading — worse than the chunk it
    // saves. What this rules out is the read loop: 50 MB at 1 KB a chunk is
    // fifty thousand pulls, and the bound below is two.
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it('does not trust a lying content-length', async () => {
    // A hostile server declares 10 bytes and sends megabytes. The cheap header
    // check must be a shortcut, never the only check.
    const impl: FetchLike = async () => streaming(64 * 1024, 100, { 'content-length': '10' });
    const result = await fetchJson<unknown>('https://status.example.com/feed.json', {
      fetchImpl: impl, maxBytes: 512 * 1024,
    });
    expect(result.error?.code).toBe('body_too_large');
  });

  it('reads a normal payload unchanged, including one just under the cap', async () => {
    // The cap must not corrupt or truncate ordinary reads, and a multi-chunk
    // body must reassemble byte-exact.
    const payload = { items: Array.from({ length: 5_000 }, (_, i) => ({ i, name: `item-${i}` })) };
    const text = JSON.stringify(payload);
    const impl: FetchLike = async () =>
      new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
    const result = await fetchJson<typeof payload>('https://status.example.com/feed.json', {
      fetchImpl: impl, maxBytes: text.length + 1,
    });
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(payload);
  });

  it('reassembles multi-byte UTF-8 split across chunk boundaries', async () => {
    // Decoding each chunk separately would mangle a character straddling a
    // boundary. The payload is chunked at a byte offset chosen to split one.
    const value = { note: 'déjà vu — naïve café 日本語' };
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const split = 12;
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(bytes.slice(0, split));
        ctrl.enqueue(bytes.slice(split));
        ctrl.close();
      },
    });
    const impl: FetchLike = async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    const result = await fetchJson<typeof value>('https://status.example.com/feed.json', { fetchImpl: impl });
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(value);
  });
});
