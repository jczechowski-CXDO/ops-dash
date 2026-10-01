import type { BlockedMessage } from '@ops-dash/shared';
// Published at the top level beside services.ts: Endpoints and Entra carry
// vendor-authored free text too, and two correct copies of this would diverge
// the moment either premise moved.
import { safeText } from '../../vendorText.js';

/**
 * Everything this adapter does to a vendor payload, with no I/O in it.
 *
 * **This module is a security control, not a formatter.** The M1 review puts it
 * plainly: *"The Email page's whole job is to display attacker-authored
 * content."* A subject line and a sender address on this screen were chosen on
 * purpose by someone hostile, and they travel from a mail filter, through here,
 * into a browser.
 *
 * **The handling of hostile text itself now lives in `server/src/vendorText.ts`
 * and its three rules are argued there**, because Endpoints and Entra carry
 * vendor-authored free text too and this page should not be the only one that
 * thought about it. Read that module first; this one is what remains once the
 * text is safe. In short: nothing emitted here may become a sink, the vendor's
 * own words pass through verbatim because the hostility is the finding, and
 * only the codepoints that do not render as themselves are made visible.
 *
 * What stays here is the part that is genuinely about *mail*: which vendor
 * classification counts as blocked, which reason maps onto the contract's
 * vocabulary, and the two payload shapes this API answers with.
 */

// ------------------------------------------------------------------- reasons

/**
 * The vendor's classification vocabulary, mapped onto the contract's.
 *
 * **Measured, not guessed.** Counted over every blocked message in one live
 * 24-hour window (625 of them, 2026-09-20):
 *
 * ```
 *   422  spam content              -> Spam
 *    94  phishing                  -> Credential phishing
 *    59  bad ip reputation         -> passed through verbatim
 *    41  bad url reputation        -> Malicious URL
 *     4  malicious email content   -> Malware
 *     3  denied by user policy     -> passed through verbatim
 *     2  unsolicited email         -> Spam
 * ```
 *
 * **Two of the contract's six documented reasons cannot be produced from this
 * API.** `Impersonation` and `Lookalike domain` are Advanced Threat Protection
 * concepts and exist only as aggregate counts under `/atp/threat/…`, never
 * attached to a message. They stay in the union because the union is the
 * contract's and the contract is frozen; nothing here will ever emit them.
 *
 * **Anything unmapped passes through exactly as the vendor wrote it**, which is
 * about a tenth of live rows. Three reasons, in the order they matter:
 *
 *   - The contract's union ends in `| string`, so this is not a type violation
 *     — it is the case the union was widened for.
 *   - `Email.tsx`'s `reasonTone` has a real default branch, proven by a test
 *     rather than by data that happens to cover every case. An unrecognised
 *     reason renders in the neutral tone: never dropped, and never given a
 *     severity nobody measured.
 *   - Inventing a category for `bad ip reputation` would be this module
 *     deciding what the vendor meant. Normalising vendor text is how hostility
 *     gets sanded off before anybody sees it, and a reason the operator does
 *     not recognise is a reason worth them noticing.
 */
export const REASON_MAP: Readonly<Record<string, BlockedMessage['reason']>> = Object.freeze({
  'spam content': 'Spam',
  'unsolicited email': 'Spam',
  phishing: 'Credential phishing',
  'bad url reputation': 'Malicious URL',
  'malicious email content': 'Malware',
});

/** The vendor reason, mapped where we have an equivalent and verbatim where we
 *  do not. Always escaped first: `reason` is vendor-controlled like the rest. */
export function mapReason(raw: unknown): string {
  const text = safeText(raw, 'Unspecified');
  return REASON_MAP[text.toLowerCase()] ?? text;
}

// ---------------------------------------------------------------- timestamps

/**
 * The vendor's `date`, normalised to the ISO-8601 instant the contract wants.
 *
 * Returns `undefined` when it cannot be parsed, so the caller has to decide
 * what that means rather than receiving a plausible-looking wrong answer. The
 * caller's decision is below and it is deliberate: the row is **kept**, the
 * unparseable text is carried through escaped, and the read is marked
 * `degraded`. `ago()` already renders an unparseable stamp as "at an unknown
 * time", so the screen stays honest — and dropping a blocked message because
 * its timestamp was malformed would be the page lying about what happened,
 * which is worse than a row with no time on it.
 */
export function isoInstant(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms).toISOString();
}

// ------------------------------------------------------------- the two reads

/** What a parse produced, plus every reason it is less than the whole truth.
 *  `notes` is never thrown away: each entry becomes part of the `degraded`
 *  explanation the panel shows, because "we read this, partially, and here is
 *  which part" is a different statement from both success and failure. */
export type Parsed<T> = { value: T; notes: string[] };

/**
 * `POST /emails/statistics/by_type/` → the two counts the stat cards need.
 *
 * The payload is `{ emails_total, data: [{ type, name, value }] }`.
 *
 * **Parsed by name, never by index, and the reason is measured.** The 24-hour
 * window returned nine entries; the window immediately before it returned ten —
 * an extra `{"type":10,"name":"delivered"}` that simply was not there an hour
 * earlier. Positional parsing of this array would have silently read one
 * category's count into another's slot the first time the vendor's traffic mix
 * changed.
 *
 * **And an unrecognised category is reported, not ignored.** `blocked` is the
 * sum of a named set; a category nobody here has seen could be a blocked class
 * we are not counting, and under-counting blocked mail is a wrong-green on the
 * exact screen this repo is most careful about. So: any name outside the known
 * set, or a `data` array that does not add up to `emails_total`, degrades the
 * read and says which name it was.
 */
export const BLOCKED_TYPE_NAMES: readonly string[] = ['spam', 'rejected', 'threat', 'content', 'advthreat'];
/** Categories that are genuinely not blocked. Named so that a name outside BOTH
 *  sets is an unknown rather than silently falling into "not blocked". */
export const PASSED_TYPE_NAMES: readonly string[] = ['clean', 'info', 'delivered', 'rescanned', 'deleted'];

export function parseByType(body: unknown): Parsed<{ processed: number; blocked: number }> | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const o = body as Record<string, unknown>;
  const total = o['emails_total'];
  const data = o['data'];
  if (typeof total !== 'number' || !Number.isFinite(total) || !Array.isArray(data)) return undefined;

  const notes: string[] = [];
  let blocked = 0;
  let accounted = 0;
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) {
      notes.push('a statistics row was not an object');
      continue;
    }
    const row = entry as Record<string, unknown>;
    const name = typeof row['name'] === 'string' ? row['name'].toLowerCase() : '';
    const value = row['value'];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      notes.push(`statistics row ${JSON.stringify(name)} carried no numeric value`);
      continue;
    }
    accounted += value;
    if (BLOCKED_TYPE_NAMES.includes(name)) blocked += value;
    else if (!PASSED_TYPE_NAMES.includes(name)) {
      // Counted toward neither. Say so loudly rather than quietly treating an
      // unknown category as harmless.
      notes.push(`unknown message category ${JSON.stringify(name)} (${value}) counted as neither blocked nor passed`);
    }
  }
  if (accounted !== total) {
    notes.push(`categories sum to ${accounted} but the vendor reports ${total} processed`);
  }
  return { value: { processed: total, blocked }, notes };
}

/**
 * `POST /emails/_search/` → the "Recently blocked" rows.
 *
 * Field mapping, confirmed against live rows rather than against the docs:
 *
 * ```
 *   at      <- date          already ISO-8601 UTC; re-normalised anyway
 *   from    <- comm_partner  for direction 1 this is the external sender
 *   to      <- owner         our recipient
 *   subject <- subject
 *   reason  <- reason        via REASON_MAP
 * ```
 *
 * **`to` is always one address.** The Control Panel's log is per-recipient — a
 * message sent to fourteen mailboxes is fourteen rows, each with one `owner`.
 * Counted across all 625 rows of a live 24-hour window: no lists, no commas, no
 * aggregate form. So the contract's documented `'N recipients'` shape and the
 * fixture that carries it are a **fixture-only** shape this adapter will never
 * produce. That is recorded here because the opposite belief is the kind of
 * thing two agents discover they held differently at review.
 */
export function parseSearch(body: unknown, limit: number): Parsed<BlockedMessage[]> | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const o = body as Record<string, unknown>;
  const emails = o['emails'];
  if (!Array.isArray(emails)) return undefined;

  const notes: string[] = [];
  const rows: BlockedMessage[] = [];
  let unparseableDates = 0;

  for (const entry of emails.slice(0, limit)) {
    if (typeof entry !== 'object' || entry === null) {
      notes.push('a message row was not an object');
      continue;
    }
    const m = entry as Record<string, unknown>;
    const at = isoInstant(m['date']);
    if (at === undefined) unparseableDates += 1;
    rows.push({
      // Kept, not dropped — see `isoInstant`. The escaped raw goes through so
      // the operator can see what the vendor actually sent.
      at: at ?? safeText(m['date'], ''),
      from: safeText(m['comm_partner'], '(unknown sender)'),
      to: safeText(m['owner'], '(unknown recipient)'),
      subject: safeText(m['subject'], '(no subject)'),
      reason: mapReason(m['reason']),
    });
  }
  if (unparseableDates > 0) notes.push(`${unparseableDates} message(s) carried an unparseable date`);
  if (o['has_more_elements'] === true) {
    notes.push('the vendor has more messages than one page; this is the newest page only');
  }
  return { value: rows, notes };
}

/** `num_found_items` off a search response — the count without the bodies.
 *  `undefined` rather than `0` when it is missing: absent is not zero, and a
 *  zero on the credential-phishing card is the good news this page must never
 *  invent. */
export function foundCount(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const n = (body as Record<string, unknown>)['num_found_items'];
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
}
