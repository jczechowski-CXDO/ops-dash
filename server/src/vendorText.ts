/**
 * Vendor-authored text, made safe to render — for every adapter, not one.
 *
 * Here, at the top level beside `services.ts`, because more than one adapter
 * needs it and none of them should import another. It is deliberately **not**
 * in `http/`: everything in that directory is about the wire — the failure
 * rules, the body cap, the SSRF floor, the token exchange — and this is about
 * content that has already arrived. A content escaper filed under `http/`
 * would blur what that directory means, and what it means is load-bearing.
 *
 * ## What this is for
 *
 * The M1 security review names the sharpest case: *"The Email page's whole job
 * is to display attacker-authored content."* A mail subject and a sender
 * address are chosen on purpose by someone hostile, and they travel from a mail
 * filter, through an adapter, into a browser.
 *
 * It is not only that page. `EndpointIssue.computer`, `.assignedTo` and
 * `.issue`, and `AuditEvent.actor`, `.action` and `.target` are all free text
 * somebody outside this codebase chose — a machine name from a console, a
 * directory display name a user can set in a tenant with guest access. They are
 * less pointed than a phishing subject and they are not nothing: a display name
 * renders beside a success/failure result, and reordering who-did-what is worth
 * something to whoever did it.
 *
 * This lives in one module for the reason `docs/RESUME.md` gives under "Why
 * publishing beat deduplicating": two correct copies diverge the moment either
 * premise moves, and on this project the premises move constantly.
 *
 * ## The three rules, which pull against each other
 *
 * 1. **Nothing that passes through here may become a sink.** These values are
 *    rendered as text. React escapes text; an `href`, a `src` or a `style`
 *    string is where it does not. Keeping vendor text out of those is the
 *    caller's job and a guard in `web/src/guards.test.ts` now asserts the whole
 *    tree carries no URL-bearing attribute at all.
 * 2. **The hostility is the product.** An operator needs to see the lookalike
 *    domain exactly as it was sent. So this module does **not** sanitise,
 *    strip, defang, lowercase or clean up vendor text. `ceo@exarnple.com`
 *    renders as `ceo@exarnple.com`, because the homoglyph *is* the finding.
 * 3. **But invisible hostility is not content, it is a rendering attack.** Rule
 *    2 stops at the codepoints that do not render as themselves. Those are made
 *    **visible**, never removed — which serves rule 2 rather than breaking it.
 *
 * **"The adapter sanitises input" is the false summary somebody will write
 * about this module later.** It is worth refusing in advance. Sanitising means
 * removing the dangerous part; this removes nothing and reveals something. The
 * true summary is that it defangs the terminal without defanging the evidence.
 *
 * ## How we know these tests can fail
 *
 * Recorded here rather than in a commit message, because a mutation record
 * that lives only in a commit message is one bad commit from gone — which this
 * module has already demonstrated: the commit that was meant to carry it swept
 * these files into somebody else's message instead.
 *
 * Three mutations, predictions written down before running, all three matched:
 *
 * | mutation | red, in this module's own suite |
 * |---|---|
 * | `escapeInvisible` made the identity | 4 |
 * | the bidi-isolate range deleted from the table | 2 |
 * | length measured before escaping instead of after | 1 |
 *
 * **But the reds that matter are the ones in OTHER suites, and they are not
 * counted above on purpose.** Making `escapeInvisible` the identity also
 * reddens at least one test in every consumer:
 *
 * ```
 *   adapters/email/parse.test.ts       escapes an unmapped reason too
 *   adapters/endpoints/queries.test.ts escapes an invisible codepoint in a
 *                                      name, a user and an OS string
 *                                      reaches the attention rows, not just
 *                                      the helpers
 * ```
 *
 * That is the whole point of publishing this module. A cross-file red is what
 * proves a consumer genuinely routes through here rather than keeping a
 * private copy that would drift the first time either premise moved — and a
 * refactor of this shape is otherwise **indistinguishable** from one that left
 * a duplicate behind, because every suite passes either way.
 *
 * **The total is deliberately not pinned, and the reason is a small lesson.**
 * It was pinned at "5" for exactly one commit, and the next adopter made that
 * number wrong without touching this file or its tests — a claim that goes
 * stale when somebody else does the right thing is a claim that will be
 * silently false. What is durable is the property: *breaking this function
 * must redden something in every suite that imports it.* Count the consumers,
 * not the assertions. If a new consumer can be added and nothing outside its
 * own directory goes red, it is not really using this.
 *
 * Deleting the `[0x2066, 0x2069]` row reddens *covers every range in the
 * table* and *includes both ends of every range* — the two tests that exist
 * because a range quietly dropped from that table is the likeliest edit
 * anybody will make to this file. Measuring `value.length` instead of
 * `escaped.length` reddens only *measures the length AFTER escaping*, which is
 * the point of having that test: 200 overrides become 1,600 characters, and no
 * other assertion in either suite can see the difference.
 */

/**
 * The longest vendor string carried to a screen.
 *
 * Not a security boundary on its own — `http/fetchJson.ts`'s 5 MB cap is the
 * one that stops a memory attack, and it is upstream of this. This is about
 * layout: a 40,000-character machine name or sender address pushes a table off
 * the page for every row, and CSS truncation is applied per column by whichever
 * view happens to have thought about it. 512 is roughly four times the longest
 * subject measured in a live 24-hour sample, so nothing real is reached by it.
 */
export const MAX_FIELD_CHARS = 512;

/**
 * Codepoints that do not render as themselves.
 *
 * **Written as a numeric range table rather than as a character class, and
 * that is not a style preference.** A regular expression spelling these out has
 * to *contain* them, and this module was briefly unparseable for exactly that
 * reason: a literal U+2028 terminates a JavaScript line on its own, so the
 * class it sat in became an unterminated regex and `tsc` aborted before
 * checking any other file in the repository. In a module whose job is escaping
 * invisible characters, a source file full of invisible characters is a trap
 * with a delayed fuse — the next person to edit it cannot see what they are
 * editing. Hex codepoints are visible, diffable, and are the documentation.
 *
 * The same reasoning governs the comments: a comment naming these characters
 * has to contain them, so they are named as `U+XXXX` in prose and never typed.
 */
const INVISIBLE_RANGES: readonly [number, number][] = [
  [0x0000, 0x001f], // C0 controls
  [0x007f, 0x009f], // DEL and the C1 controls
  [0x200b, 0x200f], // zero-width space/joiner + the LTR/RTL marks
  [0x2028, 0x2029], // line and paragraph separators
  [0x202a, 0x202e], // bidi embedding and OVERRIDE - the filename trick
  [0x2066, 0x2069], // bidi isolates - the same attack, newer syntax
  [0xfeff, 0xfeff], // zero-width no-break space / BOM
];

/**
 * **Deliberately NOT a "printable ASCII only" filter**, and this is the line
 * that decides whether the module is usable.
 *
 * Real senders and real machines carry real languages. A subject in Cyrillic,
 * Greek or CJK is ordinary mail and must survive untouched; narrowing this to
 * an ASCII allowlist would mangle legitimate content into unreadability, which
 * is the failure this page can least afford — an operator who cannot read the
 * table stops reading the table.
 *
 * That leaves homoglyph attacks (U+0430, a Cyrillic `a`, for an ASCII `a`)
 * rendering as themselves. Correct, and the point: the *vendor* is the party
 * positioned to judge a confusable domain, and it does — such a sender arrives
 * classified, and the classification is what the adapter's `reason` carries.
 */
export function isInvisible(code: number): boolean {
  return INVISIBLE_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

/** Every invisible codepoint replaced by a visible `[U+XXXX]`. Exported for
 *  its own test: this is the half with no observable behaviour until somebody
 *  sends a payload built to be misread. */
export function escapeInvisible(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    out += isInvisible(code) ? `[U+${code.toString(16).toUpperCase().padStart(4, '0')}]` : ch;
  }
  return out;
}

/**
 * A vendor string, made safe to render as text — or `fallback` if what arrived
 * was not a string at all.
 *
 * **The type check is the load-bearing half, and it checks rather than
 * coerces.** `String(value)` on `{ toString: () => '...' }` runs vendor-shaped
 * code out of a parsed payload; on `null` it writes the word "null" into a
 * table cell, which reads as a sender named null rather than as a missing
 * sender. JSON cannot carry a function, so the first is not reachable through
 * `fetchJson` today — but `fetchJson` is not the only thing that could ever
 * hand this a parsed object, and "not reachable today" is how the last three
 * defects in this repository were described before they shipped.
 *
 * `fallback` is the caller's, not this module's: only the caller knows whether
 * the absent thing is a sender, a recipient or a machine, and `(unknown
 * sender)` tells an operator something that an empty cell does not.
 *
 * A note on the escape's own ambiguity: a string containing the literal text
 * `[U+202E]` is indistinguishable afterwards from one containing the override.
 * Accepted. The alternative is a scheme nobody reading the screen can decode,
 * and the confusion runs in the safe direction — the operator looks harder at
 * the row either way.
 */
export function safeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const escaped = escapeInvisible(value);
  if (escaped.length <= MAX_FIELD_CHARS) return escaped;
  // The marker says a cut happened. A silent truncation presents a different
  // string as the whole one, and that is how a benign prefix hides a hostile
  // suffix.
  return `${escaped.slice(0, MAX_FIELD_CHARS)}… [truncated]`;
}
