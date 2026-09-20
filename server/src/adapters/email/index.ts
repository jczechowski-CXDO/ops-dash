import type { BlockedMessage, SourceResult } from '@ops-dash/shared';
import type { FetchLike } from '../../http/fetchJson.js';
import type { HornetConfig } from './config.js';
import { ENDPOINTS, hornetPost, vendorTime } from './client.js';
import { foundCount, parseByType, parseSearch } from './parse.js';

/**
 * The Email security snapshot, read from the Hornetsecurity / Proofpoint 365
 * Total Protection Control Panel API.
 *
 * Shaped after `adapters/entra/index.ts`: credential loaded from outside the
 * repo, every request out through `http/fetchJson.ts`, failure returned as data
 * rather than thrown, and reads issued **sequentially** — four concurrent
 * requests is the shape that earns a 429, `fetchJson` has no backoff, and this
 * source is polled in minutes.
 *
 * ## Why this returns `EmailReading` and not `EmailSnapshot`
 *
 * **Because two of the contract's six stats have no source in this API, and
 * that is a frozen-contract question rather than mine to answer.**
 *
 * `EmailSnapshot.stats` requires `quarantined` and `quarantinePendingReview`.
 * I enumerated all 330 paths the Control Panel publishes and grepped its whole
 * OpenAPI document for pending / release / approval / requested:
 *
 *   - **`quarantinePendingReview` does not exist as a concept.** There is no
 *     release-request queue, no approval endpoint and no pending list.
 *     `/quarantinereport/*` configures the end-user digest email; it is not a
 *     queue. There is nothing to read and there will not be.
 *   - **`quarantined` has no *stock* source.** Every blocked message carries
 *     `last_remediation_actions: ["quarantine"]`, so the 24-hour *intake* is
 *     measurable (1,830 in a live window: 625 blocked plus 1,205 infomail).
 *     But the stat card reads "Quarantined / N pending review", which is a
 *     stock — how much is sitting there now — and the same filter over ninety
 *     days returns 268,392 and is still climbing, so retention is unbounded
 *     from outside and the flow cannot be turned into a stock.
 *
 * The brief's instruction for exactly this case is to stop and report rather
 * than approximate, and the reason is the one this repo keeps paying for: a
 * `0` in "Quarantined" reads as **good news**. It is the same fork
 * `adapters/entra/index.ts` records in prose — *a nullable field says "we could
 * not look"; a zero says "we looked and there is nothing", and on this screen
 * those are opposite pieces of news.*
 *
 * So this module reads the four figures that are real and stops there. The
 * shape below is **strictly additive**: nothing imports it yet, no existing
 * caller compiles differently because of it, and the last twenty lines — the
 * assembly into `EmailSnapshot` — are a one-file change on whatever the lead
 * and John rule. The open question stays open and this file is theirs to
 * change on their word.
 */

/** How many blocked messages to carry to the screen. The table is a "recently
 *  blocked" list, not an archive — 625 arrive in a live 24-hour window and the
 *  view renders every row it is given. Newest first. */
export const RECENT_BLOCKED_LIMIT = 50;

/** The vendor's classification ids that mean "this message was not delivered".
 *  Ids rather than names because the search filter takes ids; `parse.ts` holds
 *  the name-keyed twin for the statistics response, which is name-keyed. The
 *  two are asserted against each other in `index.test.ts` so they cannot drift
 *  into counting one set and listing another. */
export const BLOCKED_CLASSIFICATION_IDS: readonly number[] = [
  1, // spam
  3, // rejected
  5, // threat
  8, // content
  12, // advthreat
];

/** Incoming only. The page's own copy says "inbound, last 24h", and outbound is
 *  46 messages a day on this tenant, all of it clean. */
const INCOMING = [1] as const;

/** The vendor's `reason` for a credential-phishing block, verbatim.
 *
 *  **This, and not `/atp/threat/attack_vector/`.** That endpoint reports
 *  `phishing: 193` for the same 24 hours in which the message log holds 94, and
 *  `929` against the log's 92 the day before — it counts attack vectors (URL
 *  scan hits), not messages. Putting it on the stat card would print a number
 *  that cannot be reconciled with the table rendered directly underneath it,
 *  and a card whose number contradicts the list below it is a card the operator
 *  stops reading. The count here is a message count, consistent with
 *  `blocked24h` and with every row in `recentBlocked`. */
const CREDENTIAL_PHISHING_REASON = 'phishing';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The four figures that are genuinely readable, plus the list.
 *
 * Named separately from `EmailSnapshot` on purpose — see the module docblock.
 * When the contract question is settled this becomes the input to a four-line
 * assembly, and the deliberate absence of the two unreadable fields is the
 * thing that makes the assembly a decision somebody makes rather than a default
 * somebody inherits.
 */
export type EmailReading = {
  stats: {
    processed24h: number;
    blocked24h: number;
    credentialPhishing24h: number;
    credentialPhishingDelta: number;
  };
  recentBlocked: BlockedMessage[];
};

export type EmailPollOptions = {
  config: HornetConfig;
  fetchImpl?: FetchLike;
  /** Injected so tests pin a window rather than racing the wall clock. */
  now?: () => number;
  /** Lowered by tests so the list cap is reachable without fifty fixtures. */
  limit?: number;
};

const failed = (fetchedAt: string, code: string, message: string): SourceResult<EmailReading> => ({
  fetchedAt,
  degraded: false,
  error: { code, message },
});

/**
 * **`stats` is all-or-nothing, and the four numbers fail together.**
 *
 * The same decision `adapters/entra/index.ts` argues at length, for the same
 * reason and with one addition specific to this screen. The contract offers no
 * way to write "we could not look" into one of these numbers, so a partial read
 * would have to put a `0` somewhere — and on this page every one of the four
 * reads as good news at zero: no mail processed, nothing blocked, no credential
 * phishing, no change since yesterday. A dashboard assembled out of holes, one
 * layer below where anybody would look for it.
 *
 * `recentBlocked` is the opposite and gets the opposite treatment, because a
 * list can express absence: an empty list is "nothing was blocked", which is a
 * statement the page is allowed to make and the view already renders as a real
 * empty state rather than as a blank table.
 *
 * **Degraded is not failed.** A read that succeeded but hit something it could
 * not fully account for — an unrecognised message category, a row with an
 * unparseable date, more messages than one page — returns the data with
 * `degraded: true` and a note saying which. That is a third state and it is not
 * decoration: under-counting blocked mail because the vendor invented a
 * category is precisely the wrong-green this screen must not produce, and a
 * silent success would hide it.
 */
export async function readEmail(opts: EmailPollOptions): Promise<SourceResult<EmailReading>> {
  const { config, fetchImpl, now = Date.now, limit = RECENT_BLOCKED_LIMIT } = opts;
  const at = now();
  const fetchedAt = new Date(at).toISOString();
  const post = <T,>(path: (typeof ENDPOINTS)[keyof typeof ENDPOINTS], body: unknown) =>
    hornetPost<T>(config, path, body, ...(fetchImpl === undefined ? [] : [{ fetchImpl }]));

  const window24h = { date_from: vendorTime(at - DAY_MS), date_to: vendorTime(at) };
  const windowPrev = { date_from: vendorTime(at - 2 * DAY_MS), date_to: vendorTime(at - DAY_MS) };
  const notes: string[] = [];

  // 1. The two volume figures. One call answers both, and it is the only place
  //    `blocked24h` comes from — `/emails/statistics/summary/` also offers a
  //    "malicious" count and it is WRONG: it returned 0 for a window in which
  //    this endpoint reported 527 spam, 94 threat and 4 advthreat. That is the
  //    shortest path to the number and it is a lie, so this adapter never calls
  //    it. `index.test.ts` pins that it never does.
  const byType = await post<unknown>(ENDPOINTS.statisticsByType, { ...window24h, direction: [...INCOMING] });
  if (byType.error) return failed(fetchedAt, byType.error.code, `statistics/by_type: ${byType.error.message}`);
  const volumes = parseByType(byType.data);
  if (!volumes) return failed(fetchedAt, 'unreadable_payload', 'statistics/by_type: not the documented shape');
  notes.push(...volumes.notes);

  // 2. The list. Newest first, incoming, blocked classifications only.
  const search = await post<unknown>(ENDPOINTS.search, {
    ...window24h,
    direction: [...INCOMING],
    classification: [...BLOCKED_CLASSIFICATION_IDS],
    sort: { key: 'date', order: 'desc' },
    limit,
    offset: 0,
  });
  if (search.error) return failed(fetchedAt, search.error.code, `_search: ${search.error.message}`);
  const blocked = parseSearch(search.data, limit);
  if (!blocked) return failed(fetchedAt, 'unreadable_payload', '_search: not the documented shape');
  notes.push(...blocked.notes);

  // 3 and 4. Credential phishing, this window and the one before it. Only the
  //    count is wanted, so `limit: 1` — the bodies of 94 hostile messages are
  //    not something to pull across the wire to divide by nothing.
  const phishBody = (w: { date_from: string; date_to: string }) => ({
    ...w,
    direction: [...INCOMING],
    reason: CREDENTIAL_PHISHING_REASON,
    sort: { key: 'date', order: 'desc' },
    limit: 1,
    offset: 0,
  });
  const phishNow = await post<unknown>(ENDPOINTS.search, phishBody(window24h));
  if (phishNow.error) return failed(fetchedAt, phishNow.error.code, `_search(phishing): ${phishNow.error.message}`);
  const credentialPhishing24h = foundCount(phishNow.data);
  if (credentialPhishing24h === undefined) {
    return failed(fetchedAt, 'unreadable_payload', '_search(phishing): no num_found_items');
  }

  const phishPrev = await post<unknown>(ENDPOINTS.search, phishBody(windowPrev));
  if (phishPrev.error) {
    return failed(fetchedAt, phishPrev.error.code, `_search(phishing, previous): ${phishPrev.error.message}`);
  }
  const previous = foundCount(phishPrev.data);
  if (previous === undefined) {
    return failed(fetchedAt, 'unreadable_payload', '_search(phishing, previous): no num_found_items');
  }

  return {
    fetchedAt,
    degraded: notes.length > 0,
    ...(notes.length > 0 ? { error: { code: 'partial_read', message: notes.join('; ') } } : {}),
    data: {
      stats: {
        processed24h: volumes.value.processed,
        blocked24h: volumes.value.blocked,
        credentialPhishing24h,
        // A real subtraction of two real measurements, both of them windows
        // this same endpoint answered. No cold-start hole: unlike Entra's MFA
        // gap, "yesterday" is a query rather than a remembered snapshot, so the
        // first poll after a restart has a genuine previous window and the
        // delta is honest from the first tick. Nothing needs handing in.
        credentialPhishingDelta: credentialPhishing24h - previous,
      },
      recentBlocked: blocked.value,
    },
  };
}
