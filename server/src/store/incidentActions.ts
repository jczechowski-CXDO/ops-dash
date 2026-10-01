/**
 * What an operator did to an incident, and what that adds up to now.
 *
 * `incident_actions` is an append-only LOG, not a pair of flags. That is the
 * whole design decision and everything below follows from it: a mute and its
 * later unmute are two rows, not one row edited, so "who silenced this and
 * when" survives the unmute and survives a restart. The contract's
 * `Incident.ack` / `Incident.muted` are then a *fold* of that log at an
 * instant, which is what this file computes.
 *
 * It is pure and knows nothing about SQLite, for the same reason
 * `currentLevel` and `staleness` are: the judgements that decide what the
 * operator sees must be testable without a database, and the store must not be
 * the only place they can be reached.
 *
 * `actor` is a PARAMETER everywhere. This module forms no opinion about who
 * the user is — `server/src/auth/` is being built right now and a second
 * opinion about identity, formed here, is precisely the seam defect this
 * project keeps paying for.
 */

/** The four verbs, exactly as `schema.sql`'s CHECK constraint spells them.
 *
 *  There is deliberately no `unack`. An acknowledgement is a statement that a
 *  human has SEEN this, and seeing it cannot be undone; the operator who wants
 *  it back on the pile resolves it or lets it recur under a new id. Widening
 *  the CHECK is also not free: `schema.sql` runs under `CREATE TABLE IF NOT
 *  EXISTS`, so an existing database would keep the old constraint while the
 *  code believed the new one, and the disagreement would only appear as a
 *  write failing on one machine and not another. */
export type ActionKind = 'ack' | 'mute' | 'unmute' | 'resolve';

export const ACTION_KINDS: readonly ActionKind[] = ['ack', 'mute', 'unmute', 'resolve'];

/** One row of the log, as it is stored. `until` is `string | null` and never
 *  absent: a mute with no end is an explicit null, not a missing key. */
export type ActionRow = {
  action: ActionKind;
  actor: string;
  at: string;
  until: string | null;
};

/**
 * The two optional fields of the frozen contract's `Incident`, and nothing
 * else — so a caller writes `{ ...incident, ...flags }` and the typechecker
 * does the rest.
 *
 * Keys are ABSENT when there is nothing to say, never present-and-undefined:
 * `exactOptionalPropertyTypes` is on, and an omitted key survives a spread in
 * the web layer while an explicit `undefined` would overwrite. Never
 * acknowledged is not "acknowledged at the epoch" and it is not `ack: null`.
 */
export type IncidentFlags = {
  ack?: { by: string; at: string };
  muted?: { by: string; until: string | null };
};

/** Thrown when an action names an incident that does not exist.
 *
 *  This is the WRITE path, where `api/routes.ts` already rules that throwing
 *  is correct — a guess made on the write path gets persisted and outlives the
 *  bug that made it. A dangling action row would be an ack attributed to
 *  nothing, and `PRAGMA foreign_keys = ON` refuses it at the database anyway;
 *  this turns that refusal into something a route can map to a 404 rather than
 *  a 500 carrying SQLite's wording. Nothing on the read path throws. */
export class UnknownIncident extends Error {
  readonly incidentId: string;
  constructor(incidentId: string, options?: { cause?: unknown }) {
    super(`no incident ${JSON.stringify(incidentId)} to act on`, options);
    this.name = 'UnknownIncident';
    this.incidentId = incidentId;
  }
}

const ms = (t: Date | number | string): number => {
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  return Date.parse(t);
};

/**
 * Is a mute still in force at `now`?
 *
 * `until: null` is indefinite and never expires — that is the operator saying
 * "until I say otherwise", and inventing an end for it would un-silence a
 * detector they deliberately silenced.
 *
 * An `until` that has PASSED is not a mute. A mute whose end has gone by but
 * which still renders as muted is the silenced-detector failure in its purest
 * form: the operator sees a quiet row, believes the mute they set is still
 * doing the work, and the fact that it lapsed an hour ago is invisible. The
 * boundary instant itself still counts as muted — `until` is the moment it
 * ends, and a mute "until 14:00" is in force at 14:00:00.000 and over one
 * millisecond later.
 *
 * An UNPARSEABLE `until` is treated as expired, not as indefinite. Both
 * choices lose information; only one of them fails loud. A date we cannot read
 * is not a promise we can keep, and the visible symptom — the row comes back —
 * is one an operator will report, where a permanently silenced detector is one
 * nobody ever notices.
 */
export function muteInForce(until: string | null, now: Date | number | string): boolean {
  if (until === null) return true;
  const ends = Date.parse(until);
  if (Number.isNaN(ends)) return false;
  return ms(now) <= ends;
}

/**
 * Fold an action log into the contract's `ack` / `muted`.
 *
 * ## `ack` is the EARLIEST ack, not the latest
 *
 * "Acknowledged at" is the instant this stopped being unnoticed. A second
 * operator acking an incident that was already acknowledged has not changed
 * that fact, and moving the timestamp forward would make the incident look
 * newer to the eye than it is — the detail page renders an age off it. So the
 * first ack wins and the rest are no-ops, and the full record of who else
 * pressed the button remains in the log for anyone who asks.
 *
 * ## `muted` is the LAST of mute/unmute, which is the opposite rule
 *
 * A mute is a state with two directions, so the most recent instruction is the
 * live one. This asymmetry with `ack` is deliberate rather than an oversight:
 * an acknowledgement is an event that happened, a mute is a switch that is
 * currently up or down.
 *
 * ## `resolve` contributes nothing here
 *
 * A manual resolve is recorded so the log says who did it, but "resolved" is
 * `incidents.resolved_at`, not a flag on the incident, and duplicating it into
 * this fold would create a second answer to a question that already has one.
 *
 * Rows are sorted by `at` before folding, stably, so rows sharing a timestamp
 * fold in insertion order — which is the order `actionsFor` returns them in
 * and the only order that makes "the last instruction" mean anything when two
 * arrive in the same millisecond.
 */
export function foldActions(rows: readonly ActionRow[], now: Date | number | string): IncidentFlags {
  const ordered = [...rows].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  let ack: IncidentFlags['ack'];
  let muteSwitch: ActionRow | undefined;

  for (const row of ordered) {
    if (row.action === 'ack') {
      ack ??= { by: row.actor, at: row.at };
    } else if (row.action === 'mute' || row.action === 'unmute') {
      muteSwitch = row;
    }
  }

  const muted =
    muteSwitch !== undefined && muteSwitch.action === 'mute' && muteInForce(muteSwitch.until, now)
      ? { by: muteSwitch.actor, until: muteSwitch.until }
      : undefined;

  // Built by assignment rather than with `{ ack, muted }`, because under
  // exactOptionalPropertyTypes the latter is a type error and, worse, would put
  // explicit `undefined`s on the wire. An omitted key survives a spread in the
  // web layer; an explicit undefined overwrites what it lands on.
  return { ...(ack ? { ack } : {}), ...(muted ? { muted } : {}) };
}
