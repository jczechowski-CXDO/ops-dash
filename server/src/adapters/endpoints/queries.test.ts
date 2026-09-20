import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Row } from './client.js';
import {
  ATTENTION_LIMIT,
  CHECKIN_WINDOW_DAYS,
  STALE_AGENT_DAYS,
  assignedTo,
  attentionRows,
  checkedInWithin,
  computerName,
  encryptedComputers,
  instant,
  osName,
} from './queries.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const rowsOf = (name: string, key: string): Row[] =>
  (JSON.parse(readFileSync(join(HERE, '__fixtures__', name), 'utf8')) as { message_response: Record<string, Row[]> })
    .message_response[key]!;

const COMPUTERS = [...rowsOf('computers-page1.json', 'computers'), ...rowsOf('computers-page2.json', 'computers')];
const PATCHES = rowsOf('patch-allsystems.json', 'allsystems');
const LOCKER = rowsOf('bitlocker.json', 'bitlockerreports');

/** The instant the fixture timestamps were computed against. */
const NOW = Date.parse('2026-09-20T12:00:00Z');

describe('EPC timestamps', () => {
  it('are epoch MILLISECONDS as a number, not ISO strings', () => {
    // Measured on the live tenant. A parser expecting ISO would return
    // undefined for every row and report an estate that has never checked in.
    expect(instant(1789819200000)).toBe(1789819200000);
    expect(instant('2026-09-20T12:00:00Z')).toBeUndefined();
  });

  it('treat 0 and nonsense as ABSENT, never as 1970 and never as now', () => {
    // 2 of the live 213 computers carry no readable last-contact time. A parser
    // that shrugged would count them as freshly checked in, which is the
    // reassuring direction.
    expect(instant(0)).toBeUndefined();
    expect(instant(-1)).toBeUndefined();
    expect(instant(undefined)).toBeUndefined();
    expect(instant(Number.NaN)).toBeUndefined();
  });
});

describe('check-in freshness', () => {
  it('counts the window, and a machine with no agent is NOT a hole', () => {
    // Read off the fixtures by hand against NOW: 1 day and 3 days ago are
    // inside seven; 30 and 45 days are outside; one row has never contacted and
    // has no agent installed. That last one is honestly "not checked in" — the
    // correct answer, not an approximation — so it is `neverInstalled` and not
    // `unreadable`, and it does not degrade anything.
    const out = checkedInWithin(COMPUTERS, NOW);
    expect(out).toEqual({ count: 2, neverInstalled: 1, unreadable: 0 });
    expect(CHECKIN_WINDOW_DAYS).toBe(7);
  });

  it('an agent that EXISTS and has never reported is the real anomaly', () => {
    // The other half, and the world where the two readings differ. Same missing
    // timestamp; the presence of an install time is what makes it a hole rather
    // than a fact. Measured on the live estate: both never-contacted machines
    // have no install time, so this branch is empty there — which is the whole
    // reason the live poll stopped reporting itself degraded on every tick.
    const anomaly: Row[] = [{ agent_last_contact_time: 0, agent_installed_on: 1785000000000 }];
    expect(checkedInWithin(anomaly, NOW)).toEqual({ count: 0, neverInstalled: 0, unreadable: 1 });
  });

  it('neither kind of missing row is counted as checked in, however wide the window', () => {
    // Not counted as fresh, ever. Widening the window to a year must not sweep
    // them in, because the reassuring direction is the one to refuse.
    const out = checkedInWithin(COMPUTERS, NOW, 365);
    expect(out.count).toBe(COMPUTERS.length - 1);
    expect(out.neverInstalled).toBe(1);
  });
});

describe('BitLocker, which is per-drive and not per-computer', () => {
  it('counts a computer once, by its OS volume only', () => {
    // The fixture has 5 drive rows over 4 computers: 103 appears twice, as an
    // OS volume and a data volume, and 105 appears ONLY as an encrypted data
    // volume. Live: 136 rows over 132 computers.
    const out = encryptedComputers(LOCKER);
    expect(out.encrypted).toBe(2);
    expect(out.knownUnencrypted).toBe(1);
    expect(out.scanned).toBe(4);
  });

  it('an encrypted DATA volume does not make its computer encrypted', () => {
    // The world where the two readings differ, without which "OS volume only"
    // is unfalsifiable: computer 105 has an encrypted data volume and no OS
    // volume record at all. Counting any encrypted volume would report it as an
    // encrypted machine when nothing is known about the disk that matters.
    const rows = LOCKER.filter((r) => String(r['resource_id']) === '105');
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!['volume_type'])).toBe('1');
    expect(String(rows[0]!['encryption_status'])).toBe('1');
    expect(encryptedComputers(rows)).toEqual({ encrypted: 0, knownUnencrypted: 0, scanned: 1 });
  });

  it('a computer with NO row is unknown, not unencrypted — the whole point', () => {
    // 81 of the live 213 have no BitLocker record at all, because the status
    // only appears after an inventory scan. `scanned` is what makes that
    // visible; `total` is not the denominator of `encrypted`.
    expect(encryptedComputers(LOCKER).scanned).toBeLessThan(COMPUTERS.length);
    expect(encryptedComputers([])).toEqual({ encrypted: 0, knownUnencrypted: 0, scanned: 0 });
  });
});

describe('naming a computer and its owner', () => {
  it('falls back honestly rather than inventing or blanking', () => {
    // `owner_email_id` is populated on 2 of 213 rows live, so it is not the
    // field despite its name; `agent_logged_on_users` covers 145 of 213. The
    // contract's `assignedTo` is a required string with nowhere to put
    // "absent", so the absence is said in words.
    expect(assignedTo(COMPUTERS[0]!)).toBe('a.nguyen@example.com');
    expect(assignedTo(COMPUTERS[2]!)).toBe('unattributed');
    expect(assignedTo({})).toBe('unattributed');
    expect(computerName(COMPUTERS[0]!)).toBe('DEMO-LT-0412');
    expect(computerName({})).toBe('unknown');
    // EPC writes '--' for an unknown OS, which is a sentinel and not a name.
    expect(osName(COMPUTERS[4]!)).toBe('unknown');
    expect(osName(COMPUTERS[0]!)).toBe('Windows 11 Professional Edition (x64)');
  });
});

describe('vendor-authored text cannot reorder what the operator reads', () => {
  // Adopted from `server/src/vendorText.ts`, published by `m4-email`. Asserted
  // at MY call sites rather than trusted from theirs: their tests prove the
  // helper works, and these prove it is actually reached from here.
  const RLO = String.fromCodePoint(0x202e);

  it('escapes an invisible codepoint in a name, a user and an OS string', () => {
    expect(computerName({ resource_name: `DEMO-${RLO}gpj.exe` })).toBe('DEMO-[U+202E]gpj.exe');
    expect(assignedTo({ agent_logged_on_users: `a.nguyen${RLO}@example.com` })).toBe('a.nguyen[U+202E]@example.com');
    expect(osName({ os_name: `Windows${RLO} 11` })).toBe('Windows[U+202E] 11');
  });

  it('is the identity on ordinary text, including a real language', () => {
    // The control. A helper that mangled normal input would be worse than none,
    // and a Cyrillic machine name is a legitimate name and not an attack.
    expect(computerName({ resource_name: 'DEMO-LT-0412' })).toBe('DEMO-LT-0412');
    expect(osName({ os_name: 'macOS - Sequoia' })).toBe('macOS - Sequoia');
    const cyrillic = String.fromCodePoint(0x41c, 0x43e, 0x439);
    expect(computerName({ resource_name: cyrillic })).toBe(cyrillic);
  });

  it('still falls back rather than coercing a non-string', () => {
    // `String(value)` on a parsed payload runs vendor-shaped code; on null it
    // writes the word "null" into a cell, which reads as a machine named null
    // rather than a missing one.
    expect(computerName({ resource_name: null })).toBe('unknown');
    expect(assignedTo({ agent_logged_on_users: { toString: () => 'pwned' } })).toBe('unattributed');
  });

  it('reaches the attention rows, not just the helpers', () => {
    // The adoption is worth nothing if the rows are built from the raw fields.
    const row: Row = {
      resource_id: 700, resource_id_string: '700', resource_name: `DEMO-${RLO}0700`,
      agent_logged_on_users: `victim${RLO}@example.com`, os_name: 'Windows 11',
      agent_last_contact_time: NOW - 40 * 86_400_000, agent_installed_on: 1785000000000,
    };
    const [issue] = attentionRows([row], new Map(), [], NOW);
    expect(issue!.computer).toBe('DEMO-[U+202E]0700');
    expect(issue!.assignedTo).toBe('victim[U+202E]@example.com');
    // And the field this module writes itself is untouched by it.
    expect(issue!.issueKind).toBe('stale_agent');
  });
});

describe('the attention list', () => {
  const patchByResource = new Map(PATCHES.map((p) => [String(p['resource_id_string']), p]));

  it('gives every issue kind a turn, so a numerous kind cannot crowd the others out', () => {
    // **The defect the live run found and no fixture would have.** The first
    // version ranked stale agents first and took the worst ten; against the real
    // estate that returned ten stale agents and nothing else, because there are
    // 22 of them — the two unencrypted machines and all 150 missing-patch rows
    // were pushed off the screen by a kind that is merely more numerous.
    //
    // Constructed here to differ: six stale agents against a limit of three.
    const many: Row[] = Array.from({ length: 6 }, (_, i) => ({
      resource_id: 900 + i, resource_id_string: String(900 + i), resource_name: `DEMO-LT-09${i}`,
      os_name: 'Windows 11', agent_last_contact_time: NOW - (STALE_AGENT_DAYS + 10 + i) * 86_400_000,
    }));
    const rows = attentionRows([...many, ...COMPUTERS], patchByResource, LOCKER, NOW, 3);
    expect(new Set(rows.map((r) => r.issueKind)).size).toBeGreaterThan(1);
    expect(rows.map((r) => r.issueKind)).toEqual(['stale_agent', 'no_bitlocker', 'missing_patches']);
  });

  it('leads with the worst of each kind', () => {
    const rows = attentionRows(COMPUTERS, patchByResource, LOCKER, NOW, 10);
    const stale = rows.filter((r) => r.issueKind === 'stale_agent');
    // 45 days before 30 days: worst first inside the kind.
    expect(stale.map((r) => r.computer)).toEqual(['DEMO-LT-0412', 'DEMO-LT-0355']);
    const patched = rows.filter((r) => r.issueKind === 'missing_patches');
    expect(patched[0]!.issue).toBe('11 missing patches');
  });

  it('never emits eol_build, because EPC cannot answer it', () => {
    // `os_version` gives builds and `os_name` gives product names, but nothing
    // says a build is end-of-life. That needs a maintained table this repo would
    // own and which goes stale SILENTLY. A list can express absence; a required
    // number cannot.
    const rows = attentionRows(COMPUTERS, patchByResource, LOCKER, NOW, 50);
    expect(rows.map((r) => r.issueKind)).not.toContain('eol_build');
    // And the three it CAN answer are all present, so this is not passing by
    // emitting nothing at all.
    expect(new Set(rows.map((r) => r.issueKind))).toEqual(new Set(['stale_agent', 'no_bitlocker', 'missing_patches']));
  });

  it('honours the limit and shares the same staleness number as section 7', () => {
    expect(attentionRows(COMPUTERS, patchByResource, LOCKER, NOW, 2)).toHaveLength(2);
    expect(attentionRows([], new Map(), [], NOW)).toEqual([]);
    // §7's `stale` rule is "no check-in for 21 days". The screen and the rule
    // must not disagree about what stale means.
    expect(STALE_AGENT_DAYS).toBe(21);
    expect(ATTENTION_LIMIT).toBe(10);
  });
});
