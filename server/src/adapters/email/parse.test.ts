import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BLOCKED_TYPE_NAMES,
  MAX_FIELD_CHARS,
  PASSED_TYPE_NAMES,
  REASON_MAP,
  foundCount,
  isoInstant,
  mapReason,
  parseByType,
  parseSearch,
  safeText,
} from './parse.js';
import { BLOCKED_CLASSIFICATION_IDS } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(HERE, '__fixtures__', name), 'utf8')) as unknown;

/** Built from codepoints rather than typed, for two reasons. The first is that
 *  an invisible character pasted into a source file is invisible in the source
 *  file too, and the next person to edit this line cannot see what they are
 *  editing. The second is that this suite asserts these codepoints are escaped,
 *  and a test that contains the literal it forbids is the shape `RESUME.md`
 *  records four separate agents getting wrong. */
const RTL_OVERRIDE = String.fromCharCode(0x202e);
const ZERO_WIDTH = String.fromCharCode(0x200b);
const NUL = String.fromCharCode(0x00);

describe('safeText — the one function standing between a mail filter and a browser', () => {
  it('makes a right-to-left override visible instead of letting it reverse the text', () => {
    // The attack: U+202E before 'txt.exe' displays as 'exe.txt'. React escapes
    // markup and does nothing about this, because there is no markup in it.
    const subject = `invoice_${RTL_OVERRIDE}txt.exe`;
    expect(safeText(subject, 'x')).toBe('invoice_[U+202E]txt.exe');
  });

  it('escapes zero-width and control characters, which are the same trick with different codepoints', () => {
    expect(safeText(`pay${ZERO_WIDTH}pal`, 'x')).toBe('pay[U+200B]pal');
    expect(safeText(`a${NUL}b`, 'x')).toBe('a[U+0000]b');
  });

  it('leaves real languages completely alone — this is not an ASCII filter', () => {
    // A subject in Cyrillic, Greek or CJK is ordinary mail. Narrowing the escape
    // to printable ASCII would mangle legitimate content, and an operator who
    // cannot read the table stops reading the table.
    for (const text of ['Здравствуйте', 'παραλαβή', '請查收附件', 'Grüße — Rechnung №4', 'ceo@exarnple.com']) {
      expect(safeText(text, 'x')).toBe(text);
    }
  });

  it('refuses a non-string rather than coercing one', () => {
    // `String(value)` on an object runs vendor-shaped code; on null it writes
    // the word 'null' into a table cell, which reads as a sender named null.
    expect(safeText(null, '(none)')).toBe('(none)');
    expect(safeText(undefined, '(none)')).toBe('(none)');
    expect(safeText(42, '(none)')).toBe('(none)');
    expect(safeText({ toString: () => 'ceo@example.com' }, '(none)')).toBe('(none)');
    expect(safeText(['a', 'b'], '(none)')).toBe('(none)');
  });

  it('marks a truncation rather than presenting a prefix as the whole string', () => {
    const long = 'A'.repeat(MAX_FIELD_CHARS + 50);
    const out = safeText(long, 'x');
    expect(out).toBe(`${'A'.repeat(MAX_FIELD_CHARS)}… [truncated]`);
    // The literal boundary, pinned rather than derived: a cut that happened
    // silently is a benign prefix hiding a hostile suffix.
    expect(out.startsWith('A'.repeat(MAX_FIELD_CHARS))).toBe(true);
    expect(safeText('A'.repeat(MAX_FIELD_CHARS), 'x')).toBe('A'.repeat(MAX_FIELD_CHARS));
  });

  it('passes hostile-looking TEXT straight through — the hostility is the product', () => {
    // These are the strings the page exists to show. None of them is a sink
    // here: the adapter emits no href, no src and no style. Defanging them
    // would hide the finding from the only person who can act on it.
    for (const text of ['javascript:alert(1)', '<script>x</script>', 'http://evil.example.net/pay', "'; DROP TABLE"]) {
      expect(safeText(text, 'x')).toBe(text);
    }
  });
});

describe('the vendor reason vocabulary, measured against a live 24-hour window', () => {
  it('maps the five reasons that have a contract equivalent', () => {
    // Pinned as literals. The expectation may not be computed by the function
    // under test, and may not be read out of REASON_MAP either — that would be
    // the table asserting it equals itself.
    expect(mapReason('spam content')).toBe('Spam');
    expect(mapReason('unsolicited email')).toBe('Spam');
    expect(mapReason('phishing')).toBe('Credential phishing');
    expect(mapReason('bad url reputation')).toBe('Malicious URL');
    expect(mapReason('malicious email content')).toBe('Malware');
  });

  it('passes an unmapped reason through verbatim — about a tenth of live rows', () => {
    expect(mapReason('bad ip reputation')).toBe('bad ip reputation');
    expect(mapReason('denied by user policy')).toBe('denied by user policy');
  });

  it('escapes an unmapped reason too — it is vendor-controlled like everything else', () => {
    expect(mapReason(`held${RTL_OVERRIDE}back`)).toBe('held[U+202E]back');
  });

  it('names a reason rather than emitting an empty cell when the vendor sends none', () => {
    expect(mapReason(undefined)).toBe('Unspecified');
    expect(mapReason(null)).toBe('Unspecified');
  });

  it('never produces Impersonation or Lookalike domain, because this API cannot say them', () => {
    // Two of the contract's six documented reasons are ATP concepts that exist
    // only as aggregates under /atp/threat/, never attached to a message. This
    // is the record of that fact, so nobody spends an afternoon looking for the
    // query that produces them.
    expect(Object.values(REASON_MAP)).not.toContain('Impersonation');
    expect(Object.values(REASON_MAP)).not.toContain('Lookalike domain');
  });
});

describe('the two category vocabularies cannot drift apart', () => {
  it('the ids the search filters on are exactly the names the statistics count', () => {
    // The seam inside this adapter: `blocked24h` is summed from a NAME-keyed
    // statistics payload, and `recentBlocked` is filtered by an ID-keyed search
    // parameter. Two lists, two files, one meaning — which is the exact shape
    // of every expensive defect this project has recorded. Neither side is
    // derived from the other; the vendor's own documented table is transcribed
    // here a third time and both are compared against it.
    const VENDOR_TABLE: Record<number, string> = {
      1: 'spam',
      2: 'clean',
      3: 'rejected',
      5: 'threat',
      8: 'content',
      11: 'info',
      12: 'advthreat',
    };
    const namesForIds = BLOCKED_CLASSIFICATION_IDS.map((id) => VENDOR_TABLE[id]).sort();
    expect(namesForIds).toEqual([...BLOCKED_TYPE_NAMES].sort());
  });

  it('no category name is in both sets, which is what makes "unknown" detectable', () => {
    const both = BLOCKED_TYPE_NAMES.filter((n) => PASSED_TYPE_NAMES.includes(n));
    expect(both).toEqual([]);
  });
});

describe('parseByType', () => {
  it('reads the two volume figures, pinned to numbers computed by hand', () => {
    // 10000 is the payload's own emails_total; 600 is 500 spam + 6 rejected +
    // 90 threat + 0 content + 4 advthreat, added up in __fixtures__/README.md
    // by a person rather than by this code.
    const parsed = parseByType(fixture('statistics-by-type.json'));
    expect(parsed?.value).toEqual({ processed: 10000, blocked: 600 });
  });

  it('says nothing is wrong when nothing is wrong — the control for the notes below', () => {
    expect(parseByType(fixture('statistics-by-type.json'))?.notes).toEqual([]);
  });

  it('reports a category it has never seen instead of quietly treating it as harmless', () => {
    // The wrong-green this guards: a vendor invents a blocked class, this
    // adapter counts it as neither blocked nor passed, and `blocked24h` silently
    // under-reports on the one screen that must not under-report.
    const parsed = parseByType({
      emails_total: 12,
      data: [
        { type: 2, value: 10, name: 'clean' },
        { type: 99, value: 2, name: 'smuggled' },
      ],
    });
    expect(parsed?.value).toEqual({ processed: 12, blocked: 0 });
    expect(parsed?.notes).toEqual(['unknown message category "smuggled" (2) counted as neither blocked nor passed']);
  });

  it('reports a payload whose categories do not add up to its own total', () => {
    const parsed = parseByType({ emails_total: 100, data: [{ type: 2, value: 10, name: 'clean' }] });
    expect(parsed?.notes).toEqual(['categories sum to 10 but the vendor reports 100 processed']);
  });

  it('is keyed by name, not by position — a live window gained a category between two polls', () => {
    // Measured: one 24h window returned nine categories, the window immediately
    // before it returned ten, with `delivered` appearing in the middle. Same
    // payload, reordered, must produce the same two numbers.
    const shuffled = {
      emails_total: 10000,
      data: [
        { type: 3, value: 6, name: 'rejected' },
        { type: 10, value: 0, name: 'delivered' },
        { type: 5, value: 90, name: 'threat' },
        { type: 2, value: 8200, name: 'clean' },
        { type: 12, value: 4, name: 'advthreat' },
        { type: 1, value: 500, name: 'spam' },
        { type: 11, value: 1200, name: 'info' },
        { type: 8, value: 0, name: 'content' },
      ],
    };
    expect(parseByType(shuffled)?.value).toEqual({ processed: 10000, blocked: 600 });
    expect(parseByType(shuffled)?.notes).toEqual([]);
  });

  it('refuses a payload that is not the documented shape rather than guessing at it', () => {
    expect(parseByType(null)).toBeUndefined();
    expect(parseByType('<!doctype html>')).toBeUndefined();
    expect(parseByType({ data: [] })).toBeUndefined();
    expect(parseByType({ emails_total: 'many', data: [] })).toBeUndefined();
    expect(parseByType({ emails_total: 5 })).toBeUndefined();
  });
});

describe('parseSearch', () => {
  const rows = () => parseSearch(fixture('search-blocked.json'), 50)!;

  it('maps the four contract fields off the vendor names, newest first', () => {
    expect(rows().value[0]).toEqual({
      at: '2026-09-20T16:18:36.000Z',
      from: 'billing@invoice-secure.net',
      to: 'ap@example.com',
      subject: 'Outstanding invoice #88214',
      reason: 'Credential phishing',
    });
  });

  it('emits exactly the contract’s five keys and nothing else', () => {
    // A security boundary rather than tidiness. The vendor row carries
    // `source_hostname`, `destination_ip`, `es_mail_id` and a `history` object,
    // and the day one of them is a URL is the day a vendor-chosen string is one
    // careless render away from an href. The adapter's output surface is the
    // narrowest thing that fills the contract, and this test is what keeps it
    // that way when somebody adds a field "just in case".
    for (const row of rows().value) {
      expect(Object.keys(row).sort()).toEqual(['at', 'from', 'reason', 'subject', 'to']);
    }
  });

  it('carries all four rows, including the reason with no contract equivalent', () => {
    expect(rows().value.map((r) => r.reason)).toEqual([
      'Credential phishing',
      'Malicious URL',
      'bad ip reputation',
      'Spam',
    ]);
  });

  it('keeps a message whose date is unparseable, and says so', () => {
    // Dropping a blocked message because its timestamp was malformed is the
    // page lying about what happened. `ago()` renders an unparseable stamp as
    // 'at an unknown time', so the screen stays honest with the row present.
    const parsed = parseSearch(
      { emails: [{ date: 'not a date', comm_partner: 'a@example.com', owner: 'b@example.com', subject: 's', reason: 'phishing' }] },
      50,
    )!;
    expect(parsed.value).toHaveLength(1);
    expect(parsed.value[0]?.at).toBe('not a date');
    expect(parsed.notes).toEqual(['1 message(s) carried an unparseable date']);
  });

  it('names every missing field rather than rendering an empty cell', () => {
    const parsed = parseSearch({ emails: [{}] }, 50)!;
    expect(parsed.value[0]).toEqual({
      at: '',
      from: '(unknown sender)',
      to: '(unknown recipient)',
      subject: '(no subject)',
      reason: 'Unspecified',
    });
  });

  it('honours the limit and says when the vendor had more', () => {
    const parsed = parseSearch(fixture('search-blocked.json'), 2)!;
    expect(parsed.value).toHaveLength(2);
    const more = parseSearch({ emails: [], has_more_elements: true }, 50)!;
    expect(more.notes).toEqual(['the vendor has more messages than one page; this is the newest page only']);
  });

  it('refuses a payload that is not the documented shape', () => {
    expect(parseSearch(null, 50)).toBeUndefined();
    expect(parseSearch({ emails: 'none' }, 50)).toBeUndefined();
  });
});

describe('foundCount — absent is not zero', () => {
  it('reads the count', () => {
    expect(foundCount({ num_found_items: 94 })).toBe(94);
    expect(foundCount({ num_found_items: 0 })).toBe(0);
  });

  it('returns undefined rather than 0 when the vendor did not say', () => {
    // A 0 on the credential-phishing card is the good news this page must never
    // invent. The caller has to distinguish 'none' from 'we could not look'.
    expect(foundCount({})).toBeUndefined();
    expect(foundCount({ num_found_items: null })).toBeUndefined();
    expect(foundCount({ num_found_items: '94' })).toBeUndefined();
    expect(foundCount({ num_found_items: -1 })).toBeUndefined();
    expect(foundCount(null)).toBeUndefined();
  });
});

describe('isoInstant', () => {
  it('normalises the vendor stamp to an ISO instant', () => {
    expect(isoInstant('2026-09-20T16:18:36Z')).toBe('2026-09-20T16:18:36.000Z');
  });

  it('returns undefined rather than an epoch or a now for anything it cannot read', () => {
    expect(isoInstant('not a date')).toBeUndefined();
    expect(isoInstant('')).toBeUndefined();
    expect(isoInstant(undefined)).toBeUndefined();
    expect(isoInstant(1758385116000)).toBeUndefined();
  });
});
