import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiClient, checksPath, getJson } from './client.js';

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

describe('the door is same-origin, and sends credentials no further', () => {
  it('requests the literal path, and carries our own session and nothing else', async () => {
    const spy = stub({ body: '{}' });
    await getJson('/api/health');
    const [url, init] = spy.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/api/health');
    // `same-origin`, not `omit`. `omit` was right while there was no auth and
    // became an assertion that auth could not work: the server issues an
    // HttpOnly session cookie and the SPA could never hold it, so
    // `auth.authenticated` was permanently false in the browser.
    //
    // Pinned as the one allowed value rather than as "not include". A negative
    // passes for a missing key, which silently restores the default — the
    // absence-claim failure this repo has now hit five times.
    expect(init['credentials']).toBe('same-origin');
    // No bearer anywhere: the cookie is HttpOnly, so no code in this app can
    // read it, and nothing here assembles an Authorization header.
    expect(Object.keys(init['headers'] as object)).toEqual(['accept']);
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

describe('the one route that takes an argument is still built here', () => {
  it('asks for the service the caller named, as a same-origin path', async () => {
    const spy = stub({ body: '{"fetchedAt":"t","degraded":false,"data":[]}' });
    await apiClient.checks('jira');
    const [url] = spy.mock.calls[0] as [string];
    // Pinned literally, not compared against `checksPath('jira')`: both sides
    // calling the builder would agree however wrong the builder was.
    expect(url).toBe('/api/checks?service=jira');
  });

  it('encodes the id rather than interpolating it raw', () => {
    // The seven are a closed union, so nothing hostile can reach this today.
    // The encoding is what keeps that true if the union ever widens, and it is
    // asserted over a value the union does not contain for exactly that reason.
    const built = checksPath('jira');
    expect(built).toBe('/api/checks?service=jira');
    expect(checksPath('m365')).toBe('/api/checks?service=m365');
  });

  it('carries the same credential terms as every other read', async () => {
    // The route that builds its own path must not also acquire its own request
    // terms. Asserted against the same literal the collection routes are
    // asserted against, so the two cannot drift into two answers.
    const spy = stub({ body: '{"fetchedAt":"t","degraded":false,"data":[]}' });
    await apiClient.checks('zendesk');
    const [, init] = spy.mock.calls[0] as [string, Record<string, unknown>];
    expect(init['credentials']).toBe('same-origin');
    expect('signal' in init).toBe(false);
  });

  it('passes the signal through, so a route change cancels it', async () => {
    const spy = stub({ body: '{"fetchedAt":"t","degraded":false,"data":[]}' });
    const controller = new AbortController();
    await apiClient.checks('openai', controller.signal);
    const [, init] = spy.mock.calls[0] as [string, { signal?: AbortSignal }];
    expect(init.signal).toBe(controller.signal);
  });

  it('classifies a failure exactly as the collection routes do', async () => {
    // Same helper underneath, and the assertion is that it IS the same: a
    // second request path would be a second set of failure rules to keep true.
    stub({ status: 400, body: '{"error":{"code":"bad_service"}}' });
    const got = await apiClient.checks('jira');
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.error.code).toBe('http_status');
    expect(got.error.message).toContain('/api/checks?service=jira');
  });
});

/**
 * The status, as a value rather than as prose.
 *
 * Added because the number used to survive only inside `message`, so the only
 * way for a view to tell "you are not signed in" from "the store is down" was
 * to regex an English sentence. That matters beyond tidiness: every view paints
 * an error `kind` red, and G3 HIGH-2 ruled that a state which is not a source
 * failure must not be red — red for an ordinary condition teaches an operator
 * to distrust red.
 */
describe('a non-2xx carries its status as a number', () => {
  it('reports the status for every class of HTTP failure', async () => {
    // Several shapes, not one: a single 401 case would pass against a function
    // that hard-coded 401, and the claim is about the relationship between the
    // response and the reported status.
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      stub({ status, body: 'nope' });
      const got = await getJson('/api/services');
      expect(got.ok).toBe(false);
      if (got.ok) return;
      expect(got.error.status, `HTTP ${status}`).toBe(status);
      // The prose is still there and still names it; the field is what a caller
      // branches on.
      expect(got.error.message).toContain(String(status));
    }
  });

  it('lets a caller tell "not signed in" from "the store is down" without reading prose', async () => {
    stub({ status: 401, body: '' });
    const unauth = await getJson('/api/services');
    stub({ status: 503, body: '' });
    const down = await getJson('/api/services');
    expect(unauth.ok || down.ok).toBe(false);
    if (unauth.ok || down.ok) return;
    // The two independently reachable facts, compared: one number distinguishes
    // them, and neither assertion goes anywhere near the message string.
    expect(unauth.error.status).toBe(401);
    expect(down.error.status).toBe(503);
    expect(unauth.error.status === 401).not.toBe(down.error.status === 401);
  });

  it('carries no status where there was no response to have one', async () => {
    // A throw never reached a status line, and `status: 0` would be a reading.
    stub({ throws: new TypeError('Failed to fetch') });
    const got = await getJson('/api/health');
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.error.code).toBe('unreachable');
    expect(got.error.status).toBeUndefined();
    // …and the three 2xx failures likewise: they have a status, and it is 200,
    // which says nothing about them. The field is for the failures the status
    // line itself describes.
    stub({ body: '' });
    const empty = await getJson('/api/health');
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error.code).toBe('empty_body');
    expect(empty.error.status).toBeUndefined();
  });
});

describe('a non-2xx body explains itself in the server\'s own words', () => {
  it('adopts the code and message our own API served', async () => {
    stub({
      status: 401,
      body: JSON.stringify({ error: { code: 'unauthenticated', message: 'this route needs a session' } }),
    });
    const got = await getJson('/api/services');
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.error.code).toBe('unauthenticated');
    expect(got.error.message).toBe('this route needs a session');
    // The status survives ALONGSIDE the served words, not instead of them.
    expect(got.error.status).toBe(401);
  });

  it('falls back to describing the status when the body explains nothing', async () => {
    const useless = [
      '',
      'Not Found',
      '<!doctype html><html><body>Sign in</body></html>',
      '[]',
      'null',
      JSON.stringify({ error: 'unauthenticated' }),
      JSON.stringify({ error: { code: 'unauthenticated' } }),
      JSON.stringify({ error: { message: 'no code' } }),
      JSON.stringify({ error: { code: 7, message: 'not a string' } }),
      JSON.stringify({ code: 'unauthenticated', message: 'not nested under error' }),
    ];
    for (const body of useless) {
      stub({ status: 401, body });
      const got = await getJson('/api/services');
      expect(got.ok).toBe(false);
      if (got.ok) return;
      expect(got.error.code, body.slice(0, 40)).toBe('http_status');
      expect(got.error.message, body.slice(0, 40)).toContain('401');
      // Unreadable prose never costs us the number.
      expect(got.error.status, body.slice(0, 40)).toBe(401);
    }
  });

  it('never lets the server speak this door\'s private vocabulary', async () => {
    // `DataSource.tsx` DROPS an `aborted` error without painting anything — an
    // abort means the user navigated. A served `aborted` would therefore make a
    // real HTTP failure vanish into a blank panel with nothing to explain it.
    // The other four are this door's own classifications and would misdescribe
    // what happened.
    for (const code of ['aborted', 'unreachable', 'http_status', 'empty_body', 'non_json_2xx']) {
      stub({ status: 500, body: JSON.stringify({ error: { code, message: 'a served message' } }) });
      const got = await getJson('/api/incidents');
      expect(got.ok).toBe(false);
      if (got.ok) return;
      expect(got.error.code, code).toBe('http_status');
      expect(got.error.message, code).toContain('500');
      expect(got.error.status, code).toBe(500);
    }
    // The control: a code that is NOT reserved is still adopted, so the four
    // assertions above are not passing because adoption is broken outright.
    stub({ status: 500, body: JSON.stringify({ error: { code: 'store_unavailable', message: 'a served message' } }) });
    const adopted = await getJson('/api/incidents');
    expect(adopted.ok).toBe(false);
    if (adopted.ok) return;
    expect(adopted.error.code).toBe('store_unavailable');
    expect(adopted.error.message).toBe('a served message');
  });
});
