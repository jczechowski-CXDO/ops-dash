import { describe, it, expect, vi } from 'vitest';
import { runProbe, type ProbeSpec } from './probe.js';
import { fetchJson, type FetchLike } from '../../http/fetchJson.js';

const SPEC: ProbeSpec = {
  serviceId: 'zendesk',
  check: 'Zendesk pod: crexendo',
  url: 'https://support.crexendo.com/api/v2/help_center/en-us/categories.json',
  region: 'us-east',
};

/** Hand-built rather than undici's, so the test controls exactly what a host
 *  does: the status, how long it takes, and whether the body is ever touched. */
const res = (status: number, body?: { cancel: () => Promise<void> }): Response =>
  ({ ok: status >= 200 && status < 300, status, statusText: 'stub', body: body ?? null }) as unknown as Response;

const after = (ms: number, r: Response): FetchLike =>
  vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        setTimeout(() => resolve(r), ms);
      }),
  );

/** A host that never answers. Rejects only when our own deadline aborts it,
 *  which is what a real hung TLS handshake does. */
const neverAnswers = (): { impl: FetchLike; signal: () => AbortSignal | undefined } => {
  let seen: AbortSignal | undefined;
  const impl: FetchLike = (_url, init) => {
    seen = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      seen?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  };
  return { impl, signal: () => seen };
};

describe('runProbe — reachability, and the three diagnoses it can return', () => {
  describe('expectStatus — when the healthy answer is not a 2xx', () => {
    // Forced by the real estate: `help.netsapiens.com`'s help-centre API answers
    // 401 every time because the centre is sign-in restricted. That 401 is
    // Zendesk's application tier responding, in ~150ms, exactly as it always
    // does. Under `response.ok` it is a permanent `fail`.
    const restricted: ProbeSpec = { ...SPEC, expectStatus: 401 };

    it('passes on the named status', async () => {
      const run = await runProbe(restricted, after(0, res(401)));
      expect(run.result).toBe('pass');
      expect(run.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('fails on a 2xx when 401 is what healthy looks like', async () => {
      // Both directions, deliberately. A restricted help centre that started
      // answering 200 has been opened to the world — still a change worth
      // hearing about, and emphatically not something to score as healthy just
      // because 200 is generically good.
      expect((await runProbe(restricted, after(0, res(200)))).result).toBe('fail');
    });

    it('fails on a different error status — 401 is not "any non-2xx"', async () => {
      // The mutation that matters. `expectStatus` must be an equality test, not
      // a licence for every failure: a 403 challenge or a 500 from this host is
      // a real fail, and a predicate that merely tolerated non-2xx would score
      // Zendesk healthy while it burned.
      for (const status of [403, 404, 429, 500, 503]) {
        expect((await runProbe(restricted, after(0, res(status)))).result).toBe('fail');
      }
    });

    it('leaves the ordinary rule alone when no status is named', async () => {
      // The default path must not have moved. Every 2xx still passes and every
      // non-2xx still fails for a spec that names nothing.
      for (const status of [200, 201, 204, 299]) {
        expect((await runProbe(SPEC, after(0, res(status)))).result).toBe('pass');
      }
      for (const status of [301, 401, 403, 404, 500]) {
        expect((await runProbe(SPEC, after(0, res(status)))).result).toBe('fail');
      }
    });

    it('still calls our deadline a timeout, not an unexpected status', async () => {
      // A spec that expects 401 and gets nothing at all has not been refused —
      // it has been unreachable, and the diagnoses stay distinct.
      const { impl } = neverAnswers();
      const run = await runProbe({ ...restricted, timeoutMs: 10 }, impl);
      expect(run.result).toBe('timeout');
      expect(run.latencyMs).toBeNull();
    });
  });

  it('a 2xx is a pass carrying a measured latency', async () => {
    const run = await runProbe(SPEC, after(0, res(200)));
    expect(run.result).toBe('pass');
    expect(typeof run.latencyMs).toBe('number');
    expect(run.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('every CheckRun carries its serviceId, check, region and timestamp', async () => {
    // Amendment 6. Pinned as literals rather than read back off SPEC: an
    // assertion that reaches the value the same way the code did proves only
    // that the object was copied, not that the right fields were copied.
    const run = await runProbe(SPEC, after(0, res(200)));
    expect(run.serviceId).toBe('zendesk');
    expect(run.check).toBe('Zendesk pod: crexendo');
    expect(run.region).toBe('us-east');
    expect(Date.parse(run.at)).not.toBeNaN();
  });

  it('a timeout is result timeout with latencyMs null — never 0', async () => {
    // A zero renders as an extremely fast probe, which is the opposite of what
    // happened. The contract's `number | null` exists for exactly this, and
    // M1's fixtures already honour it.
    const host = neverAnswers();
    const run = await runProbe({ ...SPEC, timeoutMs: 20 }, host.impl);
    expect(run.result).toBe('timeout');
    expect(run.latencyMs).toBeNull();
  });

  it('a timeout actually aborts the request rather than abandoning it', async () => {
    const host = neverAnswers();
    await runProbe({ ...SPEC, timeoutMs: 20 }, host.impl);
    expect(host.signal()?.aborted).toBe(true);
  });

  it('a non-2xx is a fail, not a timeout — they are different diagnoses', async () => {
    // A 503 means the host is up and the app is not; a timeout means we could
    // not reach the host at all. An operator acts differently on each, so
    // collapsing them loses the only information the probe gathered.
    const run = await runProbe({ ...SPEC, timeoutMs: 500 }, after(35, res(503)));
    expect(run.result).toBe('fail');
    // A response DID arrive, so it has a latency and that latency is the time
    // it took, not a placeholder.
    expect(run.latencyMs).toBeGreaterThanOrEqual(25);
  });

  it('a transport error is a fail with no latency, and never throws', async () => {
    const impl: FetchLike = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    });
    const run = await runProbe(SPEC, impl);
    expect(run.result).toBe('fail');
    expect(run.latencyMs).toBeNull();
  });

  it('a slow success is still a pass, and the latency is measured around the request', async () => {
    // Slowness is the p95 story, not the pass/fail one.
    const run = await runProbe({ ...SPEC, timeoutMs: 1_000 }, after(60, res(200)));
    expect(run.result).toBe('pass');
    expect(run.latencyMs).toBeGreaterThanOrEqual(50);
    expect(run.latencyMs).toBeLessThan(1_000);
  });

  it('a 2xx carrying HTML is a pass — reachability does not read the body', async () => {
    // This is the case where a probe and `fetchJson` must disagree, and the
    // reason the probe is a sibling rather than a flag. Crexendo's Zendesk pod
    // serves an HTML login page under HTTP 200. To `fetchJson` that is
    // `non_json_2xx`, an error, and rightly so. To a reachability probe the
    // host is up. Route the probe through the helper and every reachable host
    // in the estate reports as failing.
    const cancel = vi.fn(async () => undefined);
    const run = await runProbe(SPEC, after(0, res(200, { cancel })));
    expect(run.result).toBe('pass');
    // And the body is dropped rather than downloaded: reading it would fold
    // the size of the vendor's home page into a reachability number.
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('differs from fetchJson on the same response, which is why it is a sibling', async () => {
    // The two candidates for this code were "a thin sibling" and "`fetchJson`
    // with a parse flag". They are indistinguishable on a JSON feed, so the
    // comparison is run in the world where they differ: one HTML body under
    // HTTP 200, both helpers, side by side. `fetchJson` must call it an error
    // and the probe must call it a pass, and both are right about their own
    // question.
    const html = '<!doctype html><title>Sign in</title>';
    const stub: FetchLike = async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'stub',
        body: { cancel: async () => undefined },
        text: async () => html,
      }) as unknown as Response;

    const envelope = await fetchJson<unknown>('https://support.crexendo.com', { fetchImpl: stub });
    expect(envelope.error?.code).toBe('non_json_2xx');

    const run = await runProbe(SPEC, stub);
    expect(run.result).toBe('pass');
  });
});
