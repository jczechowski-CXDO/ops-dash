import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from './db.js';
import { evaluate, type ServiceSignal } from '../engine/rules.js';

const opened: Store[] = [];
let tmp: string | undefined;
afterEach(() => {
  for (const s of opened.splice(0)) { try { s.close(); } catch { /* already closed */ } }
  if (tmp) { rmSync(tmp, { recursive: true, force: true }); tmp = undefined; }
});
const open = (path = ':memory:') => { const s = openStore(path); opened.push(s); return s; };
const onDisk = () => {
  tmp ??= mkdtempSync(join(tmpdir(), 'opsdash-rulestate-'));
  return join(tmp, 'test.sqlite');
};

/** A service the `vendor` rule fires on: the vendor says outage and our own
 *  probe is failing. Used to prove the override reaches the engine. */
const firing: ServiceSignal = {
  serviceId: 'jira',
  vendor: { level: 'outage', platform: 'atlassian' },
  ours: { passing: 0, total: 1 },
};

describe('the INTEGER column, read back through SQLite', () => {
  it('gives booleans, not the 1 and 0 that are actually stored', () => {
    // Round-tripped through the real column rather than through a JS object:
    // SQLite has no boolean type, and the value that comes back is a number.
    const s = open();
    s.setRuleState('vendor', true);
    s.setRuleState('blackout', false);
    expect(s.ruleState()).toEqual({ vendor: true, blackout: false });
  });

  it('really did write 1 and 0 into the column', () => {
    // Read by a second, independent path — raw SQL — so the assertion does not
    // reach the value the same way the reader did. If `setRuleState` ever wrote
    // the strings 'true'/'false', the reader above would still say `true` for
    // both of them, because Number('false') !== 0 is... false, and the bug
    // would hide in the one case nobody checks.
    const s = open();
    s.setRuleState('vendor', false);
    s.setRuleState('blackout', true);
    const rows = s.db.prepare('SELECT key, enabled, typeof(enabled) AS t FROM rule_state ORDER BY key')
      .all() as Array<{ key: string; enabled: number; t: string }>;
    expect(rows).toEqual([
      { key: 'blackout', enabled: 1, t: 'integer' },
      { key: 'vendor', enabled: 0, t: 'integer' },
    ]);
  });

  it('reads a 0 written by hand as false, not as a truthy value', () => {
    // The defect this is really about: a truthiness check on what SQLite hands
    // back. Written with raw SQL, so it does not depend on the writer at all.
    const s = open();
    s.db.prepare(`INSERT INTO rule_state (key, enabled) VALUES ('vendor', 0)`).run();
    expect(s.ruleState()['vendor']).toBe(false);
  });

  it('overwrites rather than duplicating when a key is set twice', () => {
    const s = open();
    s.setRuleState('vendor', false);
    s.setRuleState('vendor', true);
    expect(s.ruleState()).toEqual({ vendor: true });
  });

  it('survives a restart', () => {
    const path = onDisk();
    const a = open(path);
    a.setRuleState('blackout', false);
    a.close();
    expect(open(path).ruleState()).toEqual({ blackout: false });
  });
});

describe('an absent key means "no override", never "disabled"', () => {
  it('a fresh database returns an empty record', () => {
    // Not `{ vendor: false, blackout: false }`, and not a row invented on read.
    expect(open().ruleState()).toEqual({});
  });

  it('leaves BOTH rules running on an empty table, judged by the engine itself', () => {
    // The consequence, asserted where it matters. A reader whose absent key
    // meant false would silently disable the whole product, and the symptom —
    // a dashboard that never raises anything — looks exactly like a quiet day.
    const s = open();
    expect(s.ruleState()).toEqual({});
    const findings = evaluate([firing], s.ruleState());
    expect(findings.map((f) => f.ruleKey)).toEqual(['vendor']);
  });

  it('an override of one rule does not disable the other', () => {
    // Setting `blackout` writes one row; `vendor` still has none and must still
    // run at its own default.
    const s = open();
    s.setRuleState('blackout', false);
    expect(evaluate([firing], s.ruleState()).map((f) => f.ruleKey)).toEqual(['vendor']);
  });

  it('a stored false actually stops the rule firing', () => {
    // The other direction, so the pair pins the override rather than just the
    // fallback: if `ruleState` returned {} regardless, every test above would
    // still pass and this one would not.
    const s = open();
    s.setRuleState('vendor', false);
    expect(evaluate([firing], s.ruleState())).toEqual([]);
  });
});
