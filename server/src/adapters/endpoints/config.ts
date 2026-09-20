import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where the Endpoint Central credential lives, and nothing about what is in it.
 *
 * Same shape as `http/graphToken.ts`: an environment variable first, falling
 * back to a conventional directory under the user's home. **No path and no
 * field value is transcribed here** — this file learns both at runtime.
 * `web/src/guards.test.ts` fails the build on a credential assigned to a
 * literal, and it is right to.
 *
 * The fallback is what actually runs. No `OPS_DASH_*` variable is set on this
 * box; the variable exists so a second machine, or a test, can point somewhere
 * else without editing source.
 */
export function epcConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env['OPS_DASH_EPC_CONFIG'] ?? join(homedir(), '.config', 'ops-dash', 'epc.json');
}

export type EpcConfig = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  /** `accounts.zoho.com` — a HOST, not a URL, which is why the scheme is added
   *  where it is used rather than trusted from the file. */
  accounts_host: string;
  /** `https://endpointcentral.manageengine.com` */
  api_base: string;
  /** `https://mdm.manageengine.com` — a different origin, carried because the
   *  file ships it. Nothing in this adapter reads it: everything the Endpoints
   *  contract needs comes from `api_base`. It is named here rather than dropped
   *  so the next adapter does not have to rediscover that the two are separate
   *  origins, which matters because a request signed for one must not be sent
   *  to the other by accident. */
  mdm_base: string;
};

/**
 * Read and validate the config. **Throws**, because a malformed credential file
 * is a boot-time mistake of ours rather than a runtime failure of
 * ManageEngine's — and a poller that silently ran without auth would report
 * `unknown` forever while looking like a vendor problem. Same ruling as
 * `loadGraphConfig`.
 *
 * The two bases are validated as https URLs because they are the origins every
 * later request is pinned to. A file that shipped `http://` or a bare host
 * would otherwise turn the origin check into a check against nothing.
 */
export function loadEpcConfig(path = epcConfigPath()): EpcConfig {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  // `Array.isArray` matters: an array satisfies `typeof x === 'object'` and would
  // otherwise fall through to the field checks and fail with a confusing
  // complaint about a missing client_id rather than about its own shape.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${path}: not an object`);
  const rec = raw as Record<string, unknown>;

  const str = (key: string): string => {
    const v = rec[key];
    // The KEY is named in the error, never the value. A message that echoed the
    // secret would put it in a log, which is the one place it must never be.
    if (typeof v !== 'string' || v.length === 0) throw new Error(`${path}: ${key} is missing or not a string`);
    return v;
  };
  const httpsBase = (key: string): string => {
    const v = str(key);
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      throw new Error(`${path}: ${key} is not a URL`);
    }
    if (url.protocol !== 'https:') throw new Error(`${path}: ${key} must be https`);
    return url.origin;
  };

  return {
    client_id: str('client_id'),
    client_secret: str('client_secret'),
    refresh_token: str('refresh_token'),
    accounts_host: str('accounts_host'),
    api_base: httpsBase('api_base'),
    mdm_base: httpsBase('mdm_base'),
  };
}
