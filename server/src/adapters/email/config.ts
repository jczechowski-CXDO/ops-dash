import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { refuseTarget } from '../../http/safeTarget.js';

/**
 * Where the Hornetsecurity Control Panel credential lives, and what shape it
 * has to be in before this process will use it.
 *
 * **No credential is transcribed here, and no path to one either.** The
 * location comes from `OPS_DASH_HORNET_CONFIG`, falling back to the same
 * conventional XDG-ish directory `http/graphToken.ts` already uses. That
 * fallback is the convention on this box rather than a variable anybody has
 * set — `graphToken.ts` has been running off its fallback since M3 — so this
 * file follows it exactly rather than inventing a second way to find a secret.
 * What the file contains, this module learns at runtime and never records.
 *
 * **This is Proofpoint 365 Total Protection, which IS Hornetsecurity.** Same
 * product, two brand names, one API. It is a **different thing** from the
 * public status.io feed `adapters/vendorstatus` already polls for the
 * `proofpoint` tile: that feed answers "is the vendor unwell", this API answers
 * "what did the vendor do to our mail". Conflating them would put a vendor
 * outage and a phishing campaign on the same number.
 */

export type HornetConfig = {
  /** Absolute https base, no trailing slash, e.g. `https://…/api/v0`. */
  baseUrl: string;
  /** The API access token. Sent as `Authorization: Token <t>` — see `client.ts`. */
  token: string;
  /** The `APP-ID` header the Control Panel requires on every read below. */
  appId: string;
  /** The customer scope, sent as `?object_id=`. A decimal string, because it is
   *  interpolated into a URL and a number would invite a float. */
  objectId: string;
};

/** Where the config lives. An env var first, so nothing is baked in. */
export function hornetConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env['OPS_DASH_HORNET_CONFIG'] ?? join(homedir(), '.config', 'ops-dash', 'hornet.json');
}

/**
 * Read and validate the config.
 *
 * **Throws**, on the same reasoning as `loadGraphConfig`: a malformed
 * credential file is a boot-time mistake of ours, not a runtime failure of the
 * vendor's. An adapter that silently ran unauthenticated would report `unknown`
 * forever while looking exactly like a vendor problem.
 *
 * **Every field is validated because every field is interpolated into a URL or
 * a header.** `objectId` becomes a query parameter and `appId` becomes a header
 * value; a newline in either is a header-injection primitive, and a `..` in
 * `baseUrl`'s path is a way out of the API namespace. `baseUrl` additionally
 * goes through `refuseTarget`, so a config pointing at `http://127.0.0.1` is
 * refused here at boot rather than on the first poll. `fetchJson` checks it
 * again on every request and that is not redundant — this check is about
 * failing loudly and early, that one is about the URL a redirect chose.
 */
export function loadHornetConfig(path = hornetConfigPath()): HornetConfig {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  // `Array.isArray` as well as the null check, because `typeof [] === 'object'`
  // and an array falls through to the per-field errors below. It still throws,
  // so nothing unsafe happened — but "base_url must be a string" is the wrong
  // sentence to hand someone who has written a JSON array into a config file,
  // and the wrong sentence costs the next person ten minutes.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${path}: not an object`);
  const cfg = raw as Record<string, unknown>;

  const base = cfg['base_url'];
  if (typeof base !== 'string' || base.length === 0) throw new Error(`${path}: base_url must be a string`);
  const baseUrl = base.replace(/\/+$/, '');
  const refusal = refuseTarget(baseUrl);
  if (refusal) throw new Error(`${path}: base_url ${refusal.message}`);

  const token = cfg['token'];
  if (typeof token !== 'string' || token.length === 0) throw new Error(`${path}: token must be a non-empty string`);
  // A header value, so it may not carry anything that ends a header. Checked as
  // a positive character class rather than as "no newline": the negative form
  // permits every other control character nobody listed.
  if (!/^[\x21-\x7e]+$/.test(token)) throw new Error(`${path}: token has a character that cannot go in a header`);

  const appId = cfg['app_id'];
  if (typeof appId !== 'string' || !/^[0-9]{1,32}$/.test(appId)) throw new Error(`${path}: app_id must be a decimal string`);

  const objectId = cfg['object_id'];
  if (typeof objectId !== 'string' || !/^[0-9]{1,20}$/.test(objectId)) throw new Error(`${path}: object_id must be a decimal string`);

  return { baseUrl, token, appId, objectId };
}
