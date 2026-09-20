import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from './db.js';
import { foldActions, muteInForce, UnknownIncident, type ActionRow } from './incidentActions.js';
import { correlate, toStoreRow, WINDOW_MS } from '../engine/correlate.js';
import { evaluate, RULES, type ServiceSignal } from '../engine/rules.js';
import type { Incident } from '@ops-dash/shared';

/* ------------------------------------------------------------------ setup */

const opened: Store[] = [];
let tmp: string | undefined;
afterEach(() => {
  for (const s of opened.splice(0)) { try { s.close(); } catch { /* already closed */ } }
  if (tmp) { rmSync(tmp, { recursive: true, force: true }); tmp = undefined; }
});
const open = (path = ':memory:') => { const s = openStore(path); opened.push(s); return s; };
const onDisk = () => {
  tmp ??= mkdtempSync(join(tmpdir(), 'opsdash-actions-'));
  return join(tmp, 'test.sqlite');
};

/** A fixed clock. Nothing below depends on when it is run. */
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60 * 1000;

/** The actor the prototype used, and the literal Task 1 will replace. It is a
 *  PARAMETER at every call site — this file's own imports are the proof that
 *  the store forms no opinion about identity. */
const JOHN = 'John H.';

const row = (over: Partial<ActionRow> & Pick<ActionRow, 'action'>): ActionRow => ({
  actor: JOHN, at: iso(NOW), until: null, ...over,
});

const incidentRow = (id: string, over: Partial<{ resolvedAt: string | null; openedAt: string }> = {}) => ({
  id, ruleKey: 'vendor', serviceId: 'jira', severity: '1',
  openedAt: over.openedAt ?? iso(NOW - 10 * MIN),
  resolvedAt: over.resolvedAt ?? null,
  summary: 'redacted test incident',
});

const resolvedAtOf = (s: Store, id: string) =>
  (s.db.prepare('SELECT resolved_at FROM incidents WHERE id = ?').get(id) as { resolved_at: string | null }).resolved_at;
const countActions = (s: Store) =>
  Number((s.db.prepare('SELECT COUNT(*) AS n FROM incident_actions').get() as { n: number }).n);

/* ============================================================ the pure fold */

describe('an untouched incident has no flags at all', () => {
  it('folds an empty log to an object with NEITHER key present', () => {
    // Not `{ ack: undefined, muted: undefined }`. exactOptionalPropertyTypes is
    // on and an omitted key survives a spread in the web layer where an
    // explicit undefined overwrites what it lands on — which is how a fixture's
    // value quietly comes back. Asserted with `in`, because toEqual() treats
    // an explicit-undefined key as equal to an absent one and would pass over
    // exactly the bug this names.
    const flags = foldActions([], NOW);
    expect(flags).toEqual({});
    expect('ack' in flags).toBe(false);
    expect('muted' in flags).toBe(false);
  });

  it('is not "acknowledged at the epoch" — the absence is the value', () => {
    expect(foldActions([], NOW).ack).toBeUndefined();
    expect(foldActions([], NOW).muted).toBeUndefined();
  });
});

describe('ack is the EARLIEST ack, and acking is one-way', () => {
  it('keeps the first acknowledgement when a second operator acks later', () => {
    // "Acknowledged at" is the instant this stopped being unnoticed. Moving it
    // forward would make the incident look newer than it is on a detail page
    // that renders an age off it.
    const flags = foldActions(
      [
        row({ action: 'ack', actor: 'first@example.com', at: iso(NOW - 30 * MIN) }),
        row({ action: 'ack', actor: 'second@example.com', at: iso(NOW - 5 * MIN) }),
      ],
      NOW,
    );
    expect(flags.ack).toEqual({ by: 'first@example.com', at: '2026-09-20T11:30:00.000Z' });
  });

  it('sorts by `at` rather than trusting the order it was handed', () => {
    // Same two rows, reversed. If the fold took rows[0] it would pass above and
    // fail here, which is the only reason both exist.
    const flags = foldActions(
      [
        row({ action: 'ack', actor: 'second@example.com', at: iso(NOW - 5 * MIN) }),
        row({ action: 'ack', actor: 'first@example.com', at: iso(NOW - 30 * MIN) }),
      ],
      NOW,
    );
    expect(flags.ack).toEqual({ by: 'first@example.com', at: '2026-09-20T11:30:00.000Z' });
  });

  it('carries the actor it was given, whoever that is', () => {
    // The whole point of taking the actor as a parameter. Two different
    // literals, so the assertion cannot pass against a hard-coded name.
    expect(foldActions([row({ action: 'ack', actor: JOHN })], NOW).ack?.by).toBe('John H.');
    expect(foldActions([row({ action: 'ack', actor: 'someone.else@example.com' })], NOW).ack?.by)
      .toBe('someone.else@example.com');
  });

  it('is not disturbed by a mute, an unmute or a resolve around it', () => {
    const flags = foldActions(
      [
        row({ action: 'mute', at: iso(NOW - 40 * MIN), until: iso(NOW + 60 * MIN) }),
        row({ action: 'ack', at: iso(NOW - 30 * MIN), actor: 'first@example.com' }),
        row({ action: 'unmute', at: iso(NOW - 20 * MIN) }),
        row({ action: 'resolve', at: iso(NOW - 10 * MIN) }),
      ],
      NOW,
    );
    expect(flags.ack).toEqual({ by: 'first@example.com', at: '2026-09-20T11:30:00.000Z' });
  });
});

describe('muted is the LAST instruction, which is the opposite rule to ack', () => {
  it('mute then unmute reads as not muted', () => {
    const flags = foldActions(
      [
        row({ action: 'mute', at: iso(NOW - 30 * MIN), until: null }),
        row({ action: 'unmute', at: iso(NOW - 5 * MIN) }),
      ],
      NOW,
    );
    expect('muted' in flags).toBe(false);
  });

  it('unmute then mute reads as muted — the later one wins, not the mute', () => {
    // The direction that catches a fold hard-coded to "any unmute clears it".
    const flags = foldActions(
      [
        row({ action: 'unmute', at: iso(NOW - 30 * MIN) }),
        row({ action: 'mute', at: iso(NOW - 5 * MIN), until: null, actor: 'ops@example.com' }),
      ],
      NOW,
    );
    expect(flags.muted).toEqual({ by: 'ops@example.com', until: null });
  });

  it('breaks a tie on `at` by the order the rows arrived', () => {
    // Two actions in the same millisecond. `at` alone is not a total order and
    // "the last instruction" is meaningless without a tiebreak; the store's
    // query orders by (at, rowid) and the fold's sort is stable, so insertion
    // order decides. Asserted both ways so it cannot pass by luck.
    const same = iso(NOW - MIN);
    expect(foldActions([row({ action: 'mute', at: same }), row({ action: 'unmute', at: same })], NOW).muted)
      .toBeUndefined();
    expect(foldActions([row({ action: 'unmute', at: same }), row({ action: 'mute', at: same })], NOW).muted)
      .toEqual({ by: JOHN, until: null });
  });
});

describe('a mute that has lapsed is not a mute', () => {
  it('reports an elapsed `until` as unmuted', () => {
    // The silenced-detector failure in its purest form: the operator sees a
    // quiet row and believes the mute they set an hour ago is still doing the
    // work. It lapsed, and nothing on screen says so.
    const flags = foldActions([row({ action: 'mute', until: iso(NOW - MIN) })], NOW);
    expect('muted' in flags).toBe(false);
  });

  it('is still muted AT the boundary instant and not one millisecond later', () => {
    // A mute "until 14:00" is in force at 14:00:00.000. Pinned against literals
    // rather than re-derived with the comparison the function uses.
    expect(muteInForce('2026-09-20T12:00:00.000Z', NOW)).toBe(true);
    expect(muteInForce('2026-09-20T11:59:59.999Z', NOW)).toBe(false);
  });

  it('treats `until: null` as indefinite, and puts an explicit null on the wire', () => {
    // Absent is not zero and it crosses the wire as null: the contract's
    // `muted.until` is `string | null`, so an indefinite mute is a null the
    // typechecker forces the web layer to handle, never a missing key.
    const flags = foldActions([row({ action: 'mute', until: null, at: iso(NOW - 400 * 24 * 60 * MIN) })], NOW);
    expect(flags.muted).toEqual({ by: JOHN, until: null });
    expect(flags.muted?.until).toBeNull();
  });

  it('treats an unreadable `until` as expired rather than as indefinite', () => {
    // Both choices lose information; only one of them fails loud. A detector
    // that comes back is a thing an operator reports; one silenced forever by a
    // date nobody could parse is one nobody ever notices.
    expect(muteInForce('not a date', NOW)).toBe(false);
    expect('muted' in foldActions([row({ action: 'mute', until: 'not a date' })], NOW)).toBe(false);
  });

  it('a mute expiring does not un-acknowledge the incident', () => {
    // The two are independent facts and a fold that returned early would
    // collapse them.
    const flags = foldActions(
      [
        row({ action: 'ack', at: iso(NOW - 60 * MIN) }),
        row({ action: 'mute', at: iso(NOW - 50 * MIN), until: iso(NOW - MIN) }),
      ],
      NOW,
    );
    expect(flags.ack).toEqual({ by: JOHN, at: '2026-09-20T11:00:00.000Z' });
    expect('muted' in flags).toBe(false);
  });
});

describe('resolve is recorded but is not a flag', () => {
  it('contributes nothing to ack or muted', () => {
    // `resolved` is `incidents.resolved_at`. A second answer to a question that
    // already has one is this project's most expensive recurring defect.
    expect(foldActions([row({ action: 'resolve' })], NOW)).toEqual({});
  });
});

/* ========================================================== the store half */

describe('a cold start is a real state', () => {
  it('a fresh database has no flags for anything, and invents none', () => {
    // Three components on this project have shipped or nearly shipped a
    // cold-start defect in two days. This is the boot state: tables exist,
    // nothing has been acted on.
    const s = open();
    expect(s.allIncidentFlags(NOW)).toEqual({});
    expect(s.actionsFor('INC-anything')).toEqual([]);
    expect(s.incidentFlags('INC-anything', NOW)).toEqual({});
  });

  it('an incident nobody has touched is ABSENT from allIncidentFlags, not empty in it', () => {
    // Not `{ 'INC-untouched': {} }`. A caller testing for the key's presence
    // would read an empty object as "this one has flags".
    const s = open();
    s.putIncident(incidentRow('INC-untouched'));
    const all = s.allIncidentFlags(NOW);
    expect(all).toEqual({});
    expect('INC-untouched' in all).toBe(false);
    expect(s.incidentFlags('INC-untouched', NOW)).toEqual({});
  });

  it('an incident whose only action was a resolve is absent too', () => {
    const s = open();
    s.putIncident(incidentRow('INC-r'));
    s.resolveIncident('INC-r', JOHN, iso(NOW));
    expect(s.allIncidentFlags(NOW)).toEqual({});
    expect(countActions(s), 'the action itself must still be logged').toBe(1);
  });
});

describe('the round trip through the real column', () => {
  it('an ack survives a restart', () => {
    // :memory: cannot show this, and "persisted" is the entire deliverable.
    const path = onDisk();
    const a = open(path);
    a.putIncident(incidentRow('INC-durable'));
    a.acknowledge('INC-durable', JOHN, iso(NOW - MIN));
    a.close();

    expect(open(path).incidentFlags('INC-durable', NOW))
      .toEqual({ ack: { by: 'John H.', at: '2026-09-20T11:59:00.000Z' } });
  });

  it('a mute survives a restart, with its `until` intact', () => {
    const path = onDisk();
    const a = open(path);
    a.putIncident(incidentRow('INC-muted'));
    a.mute('INC-muted', 'ops@example.com', iso(NOW + 60 * MIN), iso(NOW - MIN));
    a.close();

    expect(open(path).incidentFlags('INC-muted', NOW))
      .toEqual({ muted: { by: 'ops@example.com', until: '2026-09-20T13:00:00.000Z' } });
  });

  it('really did write the rows, read back by raw SQL', () => {
    // A second, independent path to the value: if `acknowledge` wrote the verb
    // 'acknowledge' or dropped the actor, the fold above could still be made to
    // agree with itself.
    const s = open();
    s.putIncident(incidentRow('INC-raw'));
    s.acknowledge('INC-raw', JOHN, iso(NOW));
    s.mute('INC-raw', JOHN, null, iso(NOW + MIN));
    const rows = s.db
      .prepare('SELECT incident_id, action, actor, at, until FROM incident_actions ORDER BY rowid')
      .all();
    expect(rows).toEqual([
      { incident_id: 'INC-raw', action: 'ack', actor: 'John H.', at: '2026-09-20T12:00:00.000Z', until: null },
      { incident_id: 'INC-raw', action: 'mute', actor: 'John H.', at: '2026-09-20T12:01:00.000Z', until: null },
    ]);
  });

  it('keeps the whole log, not just the latest state', () => {
    // An append-only log is the design decision: "who silenced this and when"
    // has to survive the unmute, or the audit question has no answer.
    const s = open();
    s.putIncident(incidentRow('INC-log'));
    s.mute('INC-log', 'ops@example.com', null, iso(NOW - 30 * MIN));
    s.unmute('INC-log', JOHN, iso(NOW - 5 * MIN));
    expect(s.actionsFor('INC-log').map((r) => [r.action, r.actor])).toEqual([
      ['mute', 'ops@example.com'],
      ['unmute', 'John H.'],
    ]);
    expect('muted' in s.incidentFlags('INC-log', NOW)).toBe(false);
  });

  it('separates two incidents rather than pooling their actions', () => {
    const s = open();
    s.putIncident(incidentRow('INC-a'));
    s.putIncident(incidentRow('INC-b'));
    s.acknowledge('INC-a', 'a@example.com', iso(NOW));
    s.mute('INC-b', 'b@example.com', null, iso(NOW));
    expect(s.allIncidentFlags(NOW)).toEqual({
      'INC-a': { ack: { by: 'a@example.com', at: '2026-09-20T12:00:00.000Z' } },
      'INC-b': { muted: { by: 'b@example.com', until: null } },
    });
  });

  it('drops an incident from allIncidentFlags once its mute lapses', () => {
    // The same store, two clocks. If `allIncidentFlags` ignored its `now` and
    // read the wall clock, the two calls would agree and this would pass
    // vacuously — hence the first assertion, which pins the muted state at a
    // time the wall clock is not.
    const s = open();
    s.putIncident(incidentRow('INC-lapse'));
    s.mute('INC-lapse', JOHN, iso(NOW + 10 * MIN), iso(NOW));
    expect(s.allIncidentFlags(NOW)).toEqual({ 'INC-lapse': { muted: { by: 'John H.', until: '2026-09-20T12:10:00.000Z' } } });
    expect(s.allIncidentFlags(NOW + 11 * MIN)).toEqual({});
  });
});

describe('an action against an incident that does not exist', () => {
  it('throws UnknownIncident rather than writing a dangling row', () => {
    // An ack attributed to nothing. foreign_keys is ON and refuses it; this
    // turns the refusal into something a route can answer 404 from.
    const s = open();
    expect(() => s.acknowledge('INC-nope', JOHN, iso(NOW))).toThrow(UnknownIncident);
    expect(countActions(s)).toBe(0);
  });

  it('names the id it could not find', () => {
    const s = open();
    let caught: unknown;
    try { s.mute('INC-ghost', JOHN, null, iso(NOW)); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UnknownIncident);
    expect((caught as UnknownIncident).incidentId).toBe('INC-ghost');
  });

  it('refuses a resolve too, and leaves no half-written transaction', () => {
    const s = open();
    s.putIncident(incidentRow('INC-real'));
    expect(() => s.resolveIncident('INC-ghost', JOHN, iso(NOW))).toThrow(UnknownIncident);
    expect(countActions(s)).toBe(0);
    expect(resolvedAtOf(s, 'INC-real'), 'the real incident must be untouched').toBeNull();
    // And the store is still usable — a rolled-back transaction that was never
    // rolled back leaves every later write failing with "cannot start a
    // transaction within a transaction".
    s.acknowledge('INC-real', JOHN, iso(NOW));
    expect(countActions(s)).toBe(1);
  });

  it('does NOT report a bad action verb as a missing incident', () => {
    // The CHECK constraint, not the foreign key. Reported as a missing
    // incident, a route would answer 404 about an incident sitting right there.
    const s = open();
    s.putIncident(incidentRow('INC-real'));
    expect(() =>
      s.recordAction({ incidentId: 'INC-real', action: 'shout' as never, actor: JOHN, at: iso(NOW) }),
    ).toThrow(/CHECK|constraint/i);
    expect(() =>
      s.recordAction({ incidentId: 'INC-real', action: 'shout' as never, actor: JOHN, at: iso(NOW) }),
    ).not.toThrow(UnknownIncident);
  });
});

describe('an action attributed to nobody', () => {
  // The `actor` column's provenance changed at `284be80`: it used to be the
  // constant `John H.` and it is now whatever the signed session says. That
  // makes this row the durable answer to "who silenced this", and an empty
  // string is not an answer. `auth/session.ts`'s `actorOf` already throws
  // rather than defaulting, so reaching here empty is a wiring mistake
  // upstream — which is precisely why the store refuses it too rather than
  // trusting one layer to be the only check.

  it('is refused for every verb, with nothing written', () => {
    const s = open();
    s.putIncident(incidentRow('INC-actor'));
    expect(() => s.acknowledge('INC-actor', '', iso(NOW))).toThrow(/no actor/);
    expect(() => s.mute('INC-actor', '', null, iso(NOW))).toThrow(/no actor/);
    expect(() => s.unmute('INC-actor', '', iso(NOW))).toThrow(/no actor/);
    expect(() => s.resolveIncident('INC-actor', '', iso(NOW))).toThrow(/no actor/);
    expect(countActions(s)).toBe(0);
    // The resolve must not have taken half: the throw happens inside the
    // transaction, before `markResolved`, and the rollback has to undo it.
    expect(resolvedAtOf(s, 'INC-actor')).toBeNull();
  });

  it('refuses whitespace that only looks like a name', () => {
    const s = open();
    s.putIncident(incidentRow('INC-ws'));
    expect(() => s.acknowledge('INC-ws', '   ', iso(NOW))).toThrow(/no actor/);
    expect(countActions(s)).toBe(0);
  });

  it('leaves the store usable afterwards', () => {
    // A rolled-back transaction that was never rolled back leaves every later
    // write failing with "cannot start a transaction within a transaction".
    const s = open();
    s.putIncident(incidentRow('INC-after'));
    expect(() => s.resolveIncident('INC-after', '', iso(NOW))).toThrow();
    s.acknowledge('INC-after', JOHN, iso(NOW));
    expect(countActions(s)).toBe(1);
  });

  it('stores a real actor VERBATIM, and does not tidy it on the way in', () => {
    // Trimmed for the emptiness test, never for the column. A name that comes
    // back different from the name that was recorded defeats the one question
    // this table exists to answer — and an identity is not ours to normalise.
    // Read by raw SQL so the assertion does not reach the value the same way
    // the writer did.
    const s = open();
    s.putIncident(incidentRow('INC-verbatim'));
    s.acknowledge('INC-verbatim', '  Someone O’Brien  ', iso(NOW));
    const stored = (s.db.prepare('SELECT actor FROM incident_actions').get() as { actor: string }).actor;
    expect(stored).toBe('  Someone O’Brien  ');
    expect(s.incidentFlags('INC-verbatim', NOW).ack?.by).toBe('  Someone O’Brien  ');
  });
});

describe('resolving by hand', () => {
  it('sets resolved_at and logs who did it', () => {
    const s = open();
    s.putIncident(incidentRow('INC-res'));
    s.resolveIncident('INC-res', JOHN, iso(NOW));
    expect(resolvedAtOf(s, 'INC-res')).toBe('2026-09-20T12:00:00.000Z');
    expect(s.actionsFor('INC-res').map((r) => r.action)).toEqual(['resolve']);
    expect(s.openIncidents()).toHaveLength(0);
  });

  it('does not move resolved_at when pressed a second time', () => {
    // The first resolution is when it stopped. A second press must not make the
    // outage look shorter.
    const s = open();
    s.putIncident(incidentRow('INC-twice'));
    s.resolveIncident('INC-twice', JOHN, iso(NOW));
    s.resolveIncident('INC-twice', 'someone.else@example.com', iso(NOW + 30 * MIN));
    expect(resolvedAtOf(s, 'INC-twice')).toBe('2026-09-20T12:00:00.000Z');
    expect(s.actionsFor('INC-twice'), 'both presses are still in the log').toHaveLength(2);
  });

  it('does not reach upstream — the only write is to our own store', () => {
    // "Acknowledge" means acknowledged HERE. Everything upstream is read-only,
    // and the guard in guards.test.ts already forbids this directory a `fetch`;
    // this states the same thing where the behaviour is, so the claim is in the
    // file that would have to break it.
    const s = open();
    s.putIncident(incidentRow('INC-local'));
    s.acknowledge('INC-local', JOHN, iso(NOW));
    // Every table this process can write, counted. Only ours moved.
    const counts = (t: string) => Number((s.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n);
    expect(counts('incident_actions')).toBe(1);
    expect(counts('snapshots')).toBe(0);
    expect(counts('vendor_state')).toBe(0);
    expect(counts('check_runs')).toBe(0);
  });
});

describe('retention still takes an acked incident and its actions together', () => {
  it('prunes both when the ack was recorded through the published API', () => {
    // retention.test.ts asserts this with a hand-written INSERT. This asserts
    // it through `acknowledge`, so a future change to how actions are written
    // cannot pass that test while breaking the foreign-key ordering here.
    const DAY = 24 * 60 * 60 * 1000;
    const s = open();
    s.putIncident(incidentRow('INC-ancient', { resolvedAt: iso(NOW - 300 * DAY), openedAt: iso(NOW - 301 * DAY) }));
    s.acknowledge('INC-ancient', JOHN, iso(NOW - 300 * DAY));
    s.mute('INC-ancient', JOHN, null, iso(NOW - 300 * DAY));

    const r = s.prune(NOW);
    expect(r.incidents).toBe(1);
    expect(r.incidentActions).toBe(2);
    expect(countActions(s)).toBe(0);
  });
});

/* ================================ what an ack MEANS when the condition returns */

/**
 * The question the plan calls the interesting one, driven through the real
 * correlation engine rather than asserted about the hash.
 *
 * `correlate` is pure and takes its instant as a parameter, so the whole
 * lifecycle — fire, clear, return — is reachable without a clock or a poller.
 */
const firing: ServiceSignal = {
  serviceId: 'jira',
  vendor: { level: 'outage', platform: 'statuspage' },
  ours: { passing: 0, total: 1 },
};
const clear: ServiceSignal = {
  serviceId: 'jira',
  vendor: { level: 'operational', platform: 'statuspage' },
  ours: { passing: 1, total: 1 },
};

/** Drive one correlation tick against the store, the way `index.ts` does. */
function tick(s: Store, at: number, services: readonly ServiceSignal[]): Incident[] {
  const atIso = iso(at);
  const since = iso(at - WINDOW_MS);
  const open = s.incidentsSince(since).map((r) => ({
    id: String(r['id']),
    ruleKey: String(r['rule_key']),
    serviceId: String(r['service_id']),
    severity: 1 as const,
    openedAt: String(r['opened_at']),
    ...(r['resolved_at'] ? { resolvedAt: String(r['resolved_at']) } : {}),
    summary: String(r['summary']),
    title: '', metaParts: [], blastRadius: [], timeline: [],
  }));
  const out = correlate({ at: atIso, services, open, enabledRules: s.ruleState() });
  for (const i of out) s.putIncident(toStoreRow(i));
  return out;
}

describe('an acknowledgement, when the condition clears and returns', () => {
  it('survives a clear-and-return INSIDE the window, because the id is the same', () => {
    // `stillOwns` keeps a recently-resolved incident's identity for WINDOW_MS,
    // so a vendor flapping every ninety seconds does not manufacture forty
    // incidents each needing its own ack.
    const s = open();
    const first = tick(s, NOW, [firing])[0]!;
    s.acknowledge(first.id, JOHN, iso(NOW + MIN));

    tick(s, NOW + 2 * MIN, [clear]);
    const again = tick(s, NOW + 4 * MIN, [firing])[0]!;

    expect(again.id, 'the same condition inside the window is the same incident').toBe(first.id);
    expect(s.incidentFlags(again.id, NOW + 4 * MIN).ack)
      .toEqual({ by: 'John H.', at: '2026-09-20T12:01:00.000Z' });
  });

  it('does NOT survive a return outside the window — a new id arrives unacknowledged', () => {
    // The answer to the plan's question, and it is correct rather than a
    // shortcoming: an hour later this is a new event, and folding it into the
    // old one would hide it behind the old one's ack.
    const s = open();
    const first = tick(s, NOW, [firing])[0]!;
    s.acknowledge(first.id, JOHN, iso(NOW + MIN));
    tick(s, NOW + 2 * MIN, [clear]);

    const later = NOW + 3 * WINDOW_MS;
    const recurrence = tick(s, later, [firing])[0]!;

    expect(recurrence.id, 'a recurrence outside the window is a different incident').not.toBe(first.id);
    expect(s.incidentFlags(recurrence.id, later), 'and it arrives unacknowledged').toEqual({});
    // The old ack is not destroyed — it still belongs to the incident it was
    // recorded against. An unacked recurrence beside an acked history is two
    // true statements, not a lost one.
    expect(s.incidentFlags(first.id, later).ack).toBeDefined();
  });

  it('a mute does not follow the condition into a new incident either', () => {
    // The same rule, and the one with teeth: a mute that leaked across the
    // window boundary would silence a genuinely new outage.
    const s = open();
    const first = tick(s, NOW, [firing])[0]!;
    s.mute(first.id, JOHN, null, iso(NOW + MIN));
    tick(s, NOW + 2 * MIN, [clear]);

    const later = NOW + 3 * WINDOW_MS;
    const recurrence = tick(s, later, [firing])[0]!;
    expect('muted' in s.incidentFlags(recurrence.id, later)).toBe(false);
  });
});

describe('a manual resolve does not make a live condition false', () => {
  it('is reopened on the next tick, with the same id and the ack intact', () => {
    // Nobody designed this; it falls out of `carryForward` stripping
    // `resolvedAt`, and it is the honest outcome. The operator sees it come
    // back — which is true — rather than a screen that agrees with them while
    // the service is still down. Recorded as a test so it is a decision rather
    // than a surprise.
    const s = open();
    const first = tick(s, NOW, [firing])[0]!;
    s.acknowledge(first.id, JOHN, iso(NOW + MIN));
    s.resolveIncident(first.id, JOHN, iso(NOW + 2 * MIN));
    expect(s.openIncidents(), 'resolved, for the moment').toHaveLength(0);

    const after = tick(s, NOW + 3 * MIN, [firing])[0]!;
    expect(after.id).toBe(first.id);
    expect(after.resolvedAt).toBeUndefined();
    expect(s.openIncidents(), 'and it is open again, because it still is').toHaveLength(1);
    expect(s.incidentFlags(first.id, NOW + 3 * MIN).ack)
      .toEqual({ by: 'John H.', at: '2026-09-20T12:01:00.000Z' });
    expect(s.actionsFor(first.id).map((r) => r.action)).toEqual(['ack', 'resolve']);
  });

  it('stays resolved when the condition really has cleared', () => {
    // The control. Without it the test above proves only that reopening
    // happens, not that it happens for a reason.
    const s = open();
    const first = tick(s, NOW, [firing])[0]!;
    s.resolveIncident(first.id, JOHN, iso(NOW + 2 * MIN));
    tick(s, NOW + 3 * MIN, [clear]);
    expect(s.openIncidents()).toHaveLength(0);
    expect(resolvedAtOf(s, first.id)).toBe('2026-09-20T12:02:00.000Z');
  });
});

/* ====================================================== rule_state, all three */

describe('the rule toggle reaches every DECLARED rule, not the two it was written for', () => {
  const ourSideOnly: ServiceSignal = {
    serviceId: 'helpjuice',
    vendor: { level: 'operational', platform: 'statuspage' },
    ours: { passing: 0, total: 1 },
  };

  it('every rule in RULES can be overridden, enumerated rather than named', () => {
    // Enumerated from RULES rather than from a list of keys kept here. A second
    // list in this file is a second definition, and this project's most
    // expensive recurring defect is two definitions of one thing drifting — the
    // describe name above said "all three rules" until `m4-entra` added four
    // more RuleKeys, at which point the NAME made a claim the BODY no longer
    // checked. Enumerating cannot go stale that way.
    //
    // The count is anchored positively: a RULES that shrank to empty would make
    // every loop below vacuous, which is how an absence-claim passes by
    // matching nothing.
    expect(RULES.length).toBeGreaterThanOrEqual(3);

    for (const rule of RULES) {
      const s = open();
      // Disabling one rule must not disturb the others. `firing` satisfies
      // `vendor` and nothing else, so the expected result is a function of
      // which rule was turned off — asserted by value, not by "did not throw".
      s.setRuleState(rule.key, false);
      expect(evaluate([firing], s.ruleState()).map((f) => f.ruleKey), rule.key)
        .toEqual(rule.key === 'vendor' ? [] : ['vendor']);
    }
  });

  it('`ourside` runs by default and stops when it is turned off', () => {
    // `ruleState.test.ts` covers `vendor` and `blackout`; `ourside` arrived
    // afterwards and nothing had pinned that a stored override reaches it.
    const s = open();
    expect(evaluate([ourSideOnly], s.ruleState()).map((f) => f.ruleKey)).toEqual(['ourside']);
    s.setRuleState('ourside', false);
    expect(evaluate([ourSideOnly], s.ruleState())).toEqual([]);
  });

  it('a disabled rule opens no incident at all through the store', () => {
    // Not a suppressed one. M1 shipped a fixture where a disabled rule still
    // had an incident attributed to it, and an incident that exists but should
    // not is worse than one that does not exist.
    const s = open();
    s.setRuleState('vendor', false);
    expect(tick(s, NOW, [firing])).toEqual([]);
    expect(s.openIncidents()).toEqual([]);
  });

  it('turning a rule back on is a stored `true`, not a deleted row', () => {
    // Which matters because absent and false are different: absent means "never
    // touched, use the rule's own default", and a future rule shipping disabled
    // by default would be silently enabled by a reader that conflated them.
    const s = open();
    s.setRuleState('vendor', false);
    s.setRuleState('vendor', true);
    expect(s.ruleState()).toEqual({ vendor: true });
    expect(tick(s, NOW, [firing]).map((i) => i.ruleKey)).toEqual(['vendor']);
  });
});
