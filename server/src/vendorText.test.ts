import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_FIELD_CHARS, escapeInvisible, isInvisible, safeText } from './vendorText.js';

/**
 * Built from codepoints rather than typed, for two reasons that are both real.
 *
 * The first is that an invisible character pasted into a source file is
 * invisible *in the source file too*, and the next person to edit the line
 * cannot see what they are editing — U+2028 would terminate this line outright.
 * The second is `docs/RESUME.md`'s "a test cannot forbid a literal by
 * containing it": this suite asserts these codepoints are escaped, so writing
 * them here is the shape four separate agents have already got wrong.
 */
const RTL_OVERRIDE = String.fromCharCode(0x202e);
const LTR_ISOLATE = String.fromCharCode(0x2066);
const ZERO_WIDTH = String.fromCharCode(0x200b);
const BOM = String.fromCharCode(0xfeff);
const NUL = String.fromCharCode(0x00);
const LINE_SEP = String.fromCharCode(0x2028);

describe('escapeInvisible — the codepoints that do not render as themselves', () => {
  it('makes a right-to-left override visible instead of letting it reverse the text', () => {
    // The attack: U+202E before 'txt.exe' displays as 'exe.txt'. React escapes
    // markup and does nothing about this, because there is no markup in it.
    expect(escapeInvisible(`invoice_${RTL_OVERRIDE}txt.exe`)).toBe('invoice_[U+202E]txt.exe');
  });

  it('covers every range in the table, not just the one anybody thinks of', () => {
    // Pinned as literals, one per range. A range quietly dropped from the table
    // is the failure this catches, and it is the likeliest edit anyone will
    // make to that file.
    expect(escapeInvisible(`a${NUL}b`)).toBe('a[U+0000]b');
    expect(escapeInvisible(`a${String.fromCharCode(0x7f)}b`)).toBe('a[U+007F]b');
    expect(escapeInvisible(`pay${ZERO_WIDTH}pal`)).toBe('pay[U+200B]pal');
    expect(escapeInvisible(`a${LINE_SEP}b`)).toBe('a[U+2028]b');
    expect(escapeInvisible(`a${LTR_ISOLATE}b`)).toBe('a[U+2066]b');
    expect(escapeInvisible(`a${BOM}b`)).toBe('a[U+FEFF]b');
  });

  it('leaves real languages completely alone — this is not an ASCII filter', () => {
    // A machine name or a subject in Cyrillic, Greek or CJK is ordinary. An
    // ASCII allowlist would mangle legitimate content into unreadability, and
    // an operator who cannot read the table stops reading the table.
    for (const text of ['Здравствуйте', 'παραλαβή', '請查收附件', 'Grüße — Rechnung №4', 'DEMO-LT-0412']) {
      expect(escapeInvisible(text)).toBe(text);
    }
  });

  it('leaves a homoglyph rendering as itself, which is the deliberate limit', () => {
    // U+0430 is a Cyrillic 'a'. It renders as an 'a' and this module does not
    // touch it: judging a confusable domain is the vendor's job, and it does it
    // — such a sender arrives classified. Asserted so that the limit is a
    // decision on the record rather than an oversight somebody "fixes" later.
    const cyrillicA = String.fromCharCode(0x0430);
    expect(escapeInvisible(`ex${cyrillicA}mple.com`)).toBe(`ex${cyrillicA}mple.com`);
    expect(isInvisible(0x0430)).toBe(false);
  });

  it('is the identity on text that carries nothing invisible', () => {
    expect(escapeInvisible('')).toBe('');
    expect(escapeInvisible('Outstanding invoice #88214')).toBe('Outstanding invoice #88214');
  });
});

describe('isInvisible — the range table, at its edges', () => {
  it('includes both ends of every range', () => {
    for (const [lo, hi] of [
      [0x0000, 0x001f], [0x007f, 0x009f], [0x200b, 0x200f],
      [0x2028, 0x2029], [0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff],
    ] as [number, number][]) {
      expect(isInvisible(lo)).toBe(true);
      expect(isInvisible(hi)).toBe(true);
    }
  });

  it('excludes the codepoints immediately outside them — the control', () => {
    // Without this, a table of [0, 0x10ffff] would pass everything above.
    for (const code of [0x0020, 0x0041, 0x00a0, 0x200a, 0x2010, 0x2027, 0x202f, 0x2065, 0x206a, 0xfefe]) {
      expect(isInvisible(code)).toBe(false);
    }
  });
});

describe('safeText — the type check is the load-bearing half', () => {
  it('refuses a non-string rather than coercing one', () => {
    // `String(value)` on an object runs vendor-shaped code out of a parsed
    // payload; on null it writes the word 'null' into a table cell, which reads
    // as a sender named null rather than as a missing sender.
    expect(safeText(null, '(none)')).toBe('(none)');
    expect(safeText(undefined, '(none)')).toBe('(none)');
    expect(safeText(42, '(none)')).toBe('(none)');
    expect(safeText({ toString: () => 'ceo@example.com' }, '(none)')).toBe('(none)');
    expect(safeText(['a', 'b'], '(none)')).toBe('(none)');
    expect(safeText(true, '(none)')).toBe('(none)');
  });

  it('uses the caller’s fallback, because only the caller knows what is missing', () => {
    expect(safeText(null, '(unknown sender)')).toBe('(unknown sender)');
    expect(safeText(null, '(no subject)')).toBe('(no subject)');
  });

  it('escapes on the way through', () => {
    expect(safeText(`invoice_${RTL_OVERRIDE}txt.exe`, 'x')).toBe('invoice_[U+202E]txt.exe');
  });

  it('marks a truncation rather than presenting a prefix as the whole string', () => {
    const long = 'A'.repeat(MAX_FIELD_CHARS + 50);
    expect(safeText(long, 'x')).toBe(`${'A'.repeat(MAX_FIELD_CHARS)}… [truncated]`);
    // The boundary itself, pinned: an off-by-one here silently cuts a character
    // off every long value, and a cut that happened silently is how a benign
    // prefix hides a hostile suffix.
    expect(safeText('A'.repeat(MAX_FIELD_CHARS), 'x')).toBe('A'.repeat(MAX_FIELD_CHARS));
    expect(safeText('A'.repeat(MAX_FIELD_CHARS - 1), 'x')).toBe('A'.repeat(MAX_FIELD_CHARS - 1));
  });

  it('measures the length AFTER escaping, so an escape cannot overflow the cap', () => {
    // 200 overrides become 1,600 characters. Measuring before escaping would
    // let a short hostile string expand past the limit this exists to enforce.
    const out = safeText(RTL_OVERRIDE.repeat(200), 'x');
    expect(out.endsWith('… [truncated]')).toBe(true);
    expect(out.length).toBe(MAX_FIELD_CHARS + '… [truncated]'.length);
  });

  it('passes hostile-looking TEXT straight through — the hostility is the product', () => {
    // These are the strings the Email page exists to show, and nothing here is
    // a sink: no href, no src, no style. Defanging them would hide the finding
    // from the only person who can act on it.
    for (const text of [
      'javascript:alert(1)',
      '<script>x</script>',
      'http://evil.example.net/pay',
      "'; DROP TABLE",
      'ceo@exarnple.com',
      '../../etc/passwd',
    ]) {
      expect(safeText(text, 'x')).toBe(text);
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Who imports this module, pinned as a literal list.
 *
 * **Why a guard and not the sentence in the docblock.** That docblock says
 * *"breaking this function must redden something in every suite that imports
 * it"*, and until now nothing checked it. This repository has counted four
 * accurate comments that failed to prevent the thing they described, and the
 * ruling it drew is that prose is the third defence and it keeps losing. The
 * reach claim is exactly the kind that rots: it was pinned as a number for one
 * commit before an adopter in another directory made it wrong, without
 * touching this file or its tests.
 *
 * **The case that justifies it is a consumer LEAVING, not arriving.** A new
 * adopter failing this test is useful and somebody would probably notice
 * anyway. A consumer quietly dropping its import is the one nobody catches:
 * that suite silently stops being evidence of anything, while the docblock goes
 * on naming it as proof of reach. Both directions are covered here; the second
 * is the reason it exists.
 *
 * **What this does NOT buy, stated plainly so nobody reads it as the stronger
 * guarantee:** it guards *who imports*, not *whether each importer's suite
 * actually reddens*. A consumer that imports `safeText` and never calls it
 * passes this test. The mutation battery recorded in `vendorText.ts` is still
 * the thing that proves reach; this only stops that battery's conclusion from
 * going stale in silence.
 */
const SRC = dirname(fileURLToPath(import.meta.url));
const REPO = join(SRC, '..', '..');
const relative = (p: string) => p.slice(REPO.length + 1).split(sep).join('/');

const tsFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );

/**
 * Comments removed before matching, and that is load-bearing rather than
 * tidy. A content grep catches prose: `m4-entra` inflated an import count
 * twofold this afternoon by grepping without stripping, having quoted the
 * ruling about it to somebody else an hour earlier. Measured here too — an
 * unstripped scan reports `adapters/endpoints/queries.test.ts` as a consumer,
 * and it only mentions the module. There is a self-reference in it as well:
 * `vendorText.ts`'s own docblock names its consumers, so an unstripped walk
 * can list this module as an importer of itself.
 *
 * Line comments are stripped only where `//` is not preceded by a colon, so a
 * `'https://...'` in ordinary code survives intact. That is deliberately the
 * conservative direction: the residual risk is a TRAILING comment producing a
 * false positive, which fails loudly and gets investigated, rather than a
 * false negative, which hides.
 */
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** A real import specifier, not a mention of the name. */
export const importsVendorText = (code: string) =>
  /from\s+['"][^'"]*vendorText\.js['"]/.test(stripComments(code));

/** Every consumer, measured 2026-09-20T17:28Z. Adding one is a line somebody
 *  defends in review rather than a diff nobody reads — the same argument
 *  `guards.test.ts` makes for its own allowlists. */
const CONSUMERS = [
  'server/src/adapters/email/parse.ts',
  'server/src/adapters/endpoints/queries.ts',
  'server/src/vendorText.test.ts',
];

describe('the consumer set is pinned, so a reach claim cannot rot unnoticed', () => {
  it('is exactly these importers', () => {
    const found = tsFiles(SRC)
      .filter((f) => importsVendorText(readFileSync(f, 'utf8')))
      .map(relative)
      .sort();
    expect(found).toEqual([...CONSUMERS].sort());
  });

  it('read a real tree and a non-empty list — the control for the assertion above', () => {
    // POSITIVE on both sides. "The importers are exactly none" is what a broken
    // walk reports, and an empty expectation would accept it. Anchored on the
    // walk having found files AND on the pinned list having entries, because
    // this suite has already shipped the absence-satisfied-vacuously hole twice
    // today and caught it twice.
    expect(tsFiles(SRC).length).toBeGreaterThan(20);
    expect(CONSUMERS.length).toBeGreaterThan(0);
    expect(tsFiles(SRC).map(relative)).toContain('server/src/vendorText.ts');
  });

  it('counts an import and refuses a mention — the controls, on text rather than on files', () => {
    // Proven able to fail without anybody writing a broken consumer.
    expect(importsVendorText("import { safeText } from '../../vendorText.js';")).toBe(true);
    expect(importsVendorText('import { safeText } from "./vendorText.js";')).toBe(true);
    // Must NOT count: the docblock sentence that names a consumer, the block
    // comment that records the mutation battery, and a bare mention of the name.
    expect(importsVendorText("// see server/src/vendorText.js for the escaping")).toBe(false);
    expect(importsVendorText("/** reddens a test in vendorText.js too */")).toBe(false);
    // A COMMENTED-OUT IMPORT, which is the only shape that actually exercises
    // the comment stripping. Added after a mutation survived: deleting
    // `stripComments` entirely reddened nothing, because no file in the tree
    // today mentions this module in an import-shaped way inside a comment, and
    // every other control here is a mention that would not match the specifier
    // pattern regardless. The stripping was a defence that nothing defended —
    // real protection against a state that is one careless edit away, and
    // completely unproven until these two lines.
    expect(importsVendorText("// import { safeText } from '../../vendorText.js';")).toBe(false);
    expect(importsVendorText("/* import { safeText } from './vendorText.js'; */")).toBe(false);
    expect(importsVendorText('const what = "vendorText.js";')).toBe(false);
    // A URL ending in the module's name. Written as a bare string rather than
    // as a call, because the first draft of this line spelled it as a network
    // call and tripped the repo's no-bare-fetch guard — in `server/src`, which
    // that guard watches hardest. The guard was right: the control is about a
    // URL that is not an import, and nothing about it needed a call to make
    // the point. Fifth instance of "a test cannot forbid a literal by
    // containing it", this time against a different guard than the four in
    // `docs/RESUME.md`.
    expect(importsVendorText("const asset = 'https://example.com/vendorText.js';")).toBe(false);
  });
});
