import { describe, it, expect, vi, afterEach } from 'vitest';
import { getJson } from './client.js';

/**
 * The one door, exercised against the five ways a read fails.
 *
 * The global is stubbed rather than a server being started: the claim is about
 * how this function classifies what comes back, and a real socket would make
 * the same assertions slower and flakier without making them stronger.
 */

type Answer = { status?: number; body?: string; throws?: unknown };

const stub = (answer: Answer) => {
  const spy = vi.fn(async (_input: unknown, init?: { signal?: AbortSignal }) => {
    if (answer.throws !== undefined) {
      // An abort surfaces as a throw with the signal already aborted, which is
      // how the real thing behaves and the only way to reach that branch.
      void init;
      throw answer.throws;
    }
    return {
      ok: (answer.status ?? 200) >= 200 && (answer.status ?? 200) < 300,
      status: answer.status ?? 200,
      text: async () => answer.body ?? '',
    };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
};

afterEach(() => vi.unstubAllGlobals());

describe('getJson never throws and says which failure it was', () => {
  it('reads a JSON body on 200', async () => {
    stub({ body: '{"servedAt":"t","services":[]}' });
    const got = await getJson('/api/services');
    expect(got).toEqual({ ok: true, json: { servedAt: 't', services: [] } });
  });

  it('a non-2xx is a failure, with the status in the message', async () => {
    stub({ status: 503, body: 'nope' });
    const got = await getJson('/api/services');
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.error.code).toBe('http_status');
    expect(got.error.message).toContain('503');
  });

  it('a 200 carrying HTML is an error, not data', async () => {
    // A dev-server fallback, a proxy error page or an expired login all look
    // exactly like this. The server makes the same ruling (amendment 7).
    stub({ body: '<!doctype html><html><body>Sign in</body></html>' });
    const got = await getJson('/api/incidents');
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.error.code).toBe('non_json_2xx');
  });

  it('a 200 with an empty body is an error, not an empty dataset', async () => {
    stub({ body: '   ' });
    const got = await getJson('/api/incidents');
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.error.code).toBe('empty_body');
  });

  it('a throw is reported, never propagated', async () => {
    stub({ throws: new TypeError('Failed to fetch') });
    const got = await getJson('/api/services');
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.error.code).toBe('unreachable');
    expect(got.error.message).toBe('Failed to fetch');
  });

  it('survives a thrown value that is not an Error', async () => {
    stub({ throws: { nope: true } });
    const got = await getJson('/api/services');
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.error.code).toBe('unreachable');
  });

  it('an abort has its own code, so a route change is not painted as an outage', async () => {
    stub({ throws: new DOMException('aborted', 'AbortError') });
    const controller = new AbortController();
    controller.abort();
    const got = await getJson('/api/services', controller.signal);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.error.code).toBe('aborted');
  });
});

describe('the door is same-origin and carries no credential', () => {
  it('requests the literal path, with no origin and no cookies', async () => {
    const spy = stub({ body: '{}' });
    await getJson('/api/health');
    const [url, init] = spy.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/api/health');
    expect(init['credentials']).toBe('omit');
  });

  it('passes the caller\'s signal through, so a poll can be cancelled', async () => {
    const spy = stub({ body: '{}' });
    const controller = new AbortController();
    await getJson('/api/services', controller.signal);
    const [, init] = spy.mock.calls[0] as [string, { signal?: AbortSignal }];
    expect(init.signal).toBe(controller.signal);
  });

  it('omits the signal key entirely when there is none', async () => {
    // `exactOptionalPropertyTypes`: `{ signal: undefined }` is not the same as
    // no signal, and some runtimes treat the explicit undefined as an abort.
    const spy = stub({ body: '{}' });
    await getJson('/api/services');
    const [, init] = spy.mock.calls[0] as [string, Record<string, unknown>];
    expect('signal' in init).toBe(false);
  });
});
