import { fetchJson, type FetchLike } from '../../http/fetchJson.js';
import { loadEpcConfig, type EpcConfig } from './config.js';

/**
 * Zoho OAuth for Endpoint Central: a refresh token exchanged for an access
 * token, cached.
 *
 * **The cache is not an optimisation, it is the only way this works.** The
 * refresh token allows **ten access tokens per ten minutes** — a hard limit on
 * MINTING, not on requests. A naive mint-per-request adapter dies on the
 * eleventh call of a single poll, and the failure arrives as an auth error, so
 * it reads as a broken credential rather than as a rate limit. That is the
 * expensive kind of wrong: the obvious fix is to go and re-issue a credential
 * that was never the problem.
 *
 * This is the same shape as `http/graphToken.ts`'s cache and a different
 * reason. There, sixty tokens an hour was merely rude. Here it is fatal, so the
 * margin is wider: a token is retired a full five minutes before it expires,
 * because being one request short of a mint you are not allowed to make is much
 * worse than minting slightly early.
 *
 * Measured: `expires_in` is 3600 seconds.
 */

/** Retire a token this long before it actually expires. */
export const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export const tokenUrl = (cfg: EpcConfig): string => `https://${cfg.accounts_host}/oauth/v2/token`;

type Cached = { token: string; expiresAt: number };

export type EpcTokenSource = {
  get(): Promise<{ token: string } | { error: { code: string; message: string } }>;
  /** Test seam only: forget the cached token. */
  reset(): void;
};

export function createEpcTokenSource(
  opts: { config?: EpcConfig; fetchImpl?: FetchLike; now?: () => number } = {},
): EpcTokenSource {
  let cached: Cached | undefined;
  /** In-flight mint, shared. Two collections read back to back at start-up
   *  would otherwise mint twice for one poll, and ten is not many. */
  let inFlight: Promise<{ token: string } | { error: { code: string; message: string } }> | undefined;

  const mint = async (): Promise<{ token: string } | { error: { code: string; message: string } }> => {
    let cfg: EpcConfig;
    try {
      cfg = opts.config ?? loadEpcConfig();
    } catch (cause) {
      // Deliberately does not echo the path or any field. This is the one place
      // that knows where the credential lives.
      return { error: { code: 'epc_config', message: `could not read the Endpoint Central credential config: ${(cause as Error).name}` } };
    }

    // Through `fetchJson` like everything else, so the four failure rules, the
    // 5 MB cap and the SSRF floor apply to the most sensitive request this
    // adapter makes — and so a redirect on this POST is refused rather than
    // followed, because the body carries the refresh token itself.
    const result = await fetchJson<{ access_token?: unknown; expires_in?: unknown }>(tokenUrl(cfg), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
        refresh_token: cfg.refresh_token,
        grant_type: 'refresh_token',
      }).toString(),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });

    if (result.error !== undefined) {
      return { error: { code: `epc_auth_${result.error.code}`, message: result.error.message } };
    }
    const token = result.data?.access_token;
    const ttl = result.data?.expires_in;
    if (typeof token !== 'string' || typeof ttl !== 'number') {
      // Zoho reports a refused refresh as HTTP 200 with an `error` field and no
      // `access_token`, which is the same family as EPC's own 200-carrying-an-
      // error envelope. A shape check is the only thing that catches it.
      return { error: { code: 'epc_auth_shape', message: 'the token endpoint returned no usable access_token' } };
    }

    cached = { token, expiresAt: (opts.now ?? Date.now)() + ttl * 1000 };
    return { token };
  };

  return {
    async get() {
      const now = opts.now ?? Date.now;
      if (cached && cached.expiresAt > now() + EXPIRY_MARGIN_MS) return { token: cached.token };
      // Never two mints for one expiry. `inFlight` is cleared in a `finally` so
      // a failed mint does not pin every later call to the same failure.
      inFlight ??= mint().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
    reset() {
      cached = undefined;
      inFlight = undefined;
    },
  };
}
