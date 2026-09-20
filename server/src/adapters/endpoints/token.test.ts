import { describe, it, expect } from 'vitest';
import type { FetchLike } from '../../http/fetchJson.js';
import type { EpcConfig } from './config.js';
import { EXPIRY_MARGIN_MS, createEpcTokenSource, tokenUrl } from './token.js';

/** Obviously fake, and never read from disk. No test in this repo can reach the
 *  real credential by forgetting to stub something. */
const cfg: EpcConfig = {
  client_id: 'DEMO-CLIENT', client_secret: 'DEMO-SECRET', refresh_token: 'DEMO-REFRESH',
  accounts_host: 'accounts.example.com',
  api_base: 'https://endpointcentral.example.com', mdm_base: 'https://mdm.example.com',
};

const mints = (bodies: unknown[]): { impl: FetchLike; calls: () => number } => {
  let n = 0;
  const impl: FetchLike = async () => {
    const body = bodies[Math.min(n, bodies.length - 1)];
    n += 1;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { impl, calls: () => n };
};

describe('the Zoho token cache, which is not an optimisation', () => {
  it('mints ONCE for many gets — the ten-per-ten-minutes limit makes this mandatory', async () => {
    // The refresh token allows ten access tokens per ten minutes. That is a
    // limit on MINTING, not on requests, so a mint-per-request adapter dies on
    // the eleventh call of one poll — and the failure arrives as an auth error,
    // so it reads as a broken credential rather than as a rate limit. That is
    // the expensive kind of wrong: the obvious fix is to re-issue a credential
    // that was never the problem.
    const { impl, calls } = mints([{ access_token: 'T1', expires_in: 3600 }]);
    const src = createEpcTokenSource({ config: cfg, fetchImpl: impl, now: () => 1_000_000 });
    const got = await Promise.all(Array.from({ length: 12 }, () => src.get()));
    expect(got.every((g) => 'token' in g && g.token === 'T1')).toBe(true);
    expect(calls()).toBe(1);
  });

  it('twelve CONCURRENT gets still mint once', async () => {
    // The in-flight guard. Without it the first poll fires four reads before any
    // token is cached and mints four times — nearly half the budget on one tick.
    const { impl, calls } = mints([{ access_token: 'T1', expires_in: 3600 }]);
    const src = createEpcTokenSource({ config: cfg, fetchImpl: impl, now: () => 1_000_000 });
    await Promise.all(Array.from({ length: 12 }, () => src.get()));
    expect(calls()).toBe(1);
  });

  it('retires a token a full five minutes early', async () => {
    // Being one request short of a mint you are not allowed to make is much
    // worse than minting slightly early.
    let clock = 1_000_000;
    const { impl, calls } = mints([{ access_token: 'T1', expires_in: 3600 }, { access_token: 'T2', expires_in: 3600 }]);
    const src = createEpcTokenSource({ config: cfg, fetchImpl: impl, now: () => clock });
    await src.get();
    clock += 3_600_000 - EXPIRY_MARGIN_MS - 1_000;        // just inside the margin
    expect(await src.get()).toEqual({ token: 'T1' });
    clock += 2_000;                                        // now past it
    expect(await src.get()).toEqual({ token: 'T2' });
    expect(calls()).toBe(2);
    expect(EXPIRY_MARGIN_MS).toBe(300_000);
  });

  it('a 200 with no access_token is a failure, not a token', async () => {
    // Zoho reports a refused refresh as HTTP 200 with an `error` field and no
    // `access_token` — the same family as EPC's own error-inside-a-200 envelope.
    const { impl } = mints([{ error: 'invalid_code' }]);
    const src = createEpcTokenSource({ config: cfg, fetchImpl: impl });
    const out = await src.get();
    expect('error' in out && out.error.code).toBe('epc_auth_shape');
  });

  it('a failed mint does not pin every later call to the same failure', async () => {
    // `inFlight` is cleared in a `finally`. Without it, one 503 at start-up
    // would make the source permanently dead until a restart.
    let fail = true;
    const impl: FetchLike = async () =>
      fail ? new Response('no', { status: 503 })
           : new Response(JSON.stringify({ access_token: 'T9', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    const src = createEpcTokenSource({ config: cfg, fetchImpl: impl });
    expect('error' in (await src.get())).toBe(true);
    fail = false;
    expect(await src.get()).toEqual({ token: 'T9' });
  });

  it('builds the token URL from the configured host, over https', async () => {
    expect(tokenUrl(cfg)).toBe('https://accounts.example.com/oauth/v2/token');
  });

  it('posts, so fetchJson refuses to follow a redirect with the refresh token in the body', async () => {
    // The body carries the refresh token itself. A `Location` header must never
    // get to choose who receives it — fetchJson's `redirect_on_write` rule.
    const impl: FetchLike = async (_url, init) => {
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ access_token: 'T1', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await createEpcTokenSource({ config: cfg, fetchImpl: impl }).get();
  });
});
