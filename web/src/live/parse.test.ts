import { describe, it, expect } from 'vitest';
import type { ServiceId } from '@ops-dash/shared';
import { loadKind } from './model.js';
import { decodeSeverity, incidentView, isStatusLevel, levelLabel, parseChecks, parseIncidents, parseServices, serviceEntryView, vendorAdvisories } from './parse.js';

/**
 * A `/api/services` entry, shaped exactly as `server/src/api/routes.ts`
 * serves one. Written out here rather than imported: the server is a different
 * workspace and importing its types would make this test agree with the server
 * by construction instead of pinning the shape the web was built against. The
 * values were read off a running instance on 2026-09-19.
 */
const entry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'jira',
  source: 'vendor:jira',
  result: {
    data: {
      platform: 'statuspage',
      level: 'operational',
      label: 'Operational',
      note: 'Statuspage reports all 11 components operational.',
      incidentsSince: [],
    },
    fetchedAt: '2026-09-19T12:00:00.000Z',
    degraded: false,
  },
  currentLevel: 'operational',
  ours: { level: 'operational', label: 'Passing', note: '1 of 1 checks passing.', passing: 1, total: 1 },
  latencyMs: 220,
  p50Ms: 112,
  p95Ms: 220,
  spark: [112, 108, 220],
  uptime30d: 1,
  incidents90d: 0,
  lastStateChange: null,
  ...over,
});

const view = (over: Record<string, unknown> = {}) => {
  const parsed = serviceEntryView(entry(over));
  if (parsed === null) throw new Error('entry did not parse');
  return parsed;
};

describe('the colour never comes from the stored payload', () => {
  it('a fresh entry reads what the vendor published', () => {
    expect(view().vendor.level).toBe('operational');
    expect(view().vendor.label).toBe('Operational');
  });

  /**
   * The test this whole file exists for, and the exact scenario
   * `store/currentLevel.ts` describes: Jira was green at 10:00, its feed has
   * 503'd since 10:01, and the stored payload still says `level: operational`.
   * The API computes `currentLevel: 'unknown'` beside it. Anything that reads
   * `result.data.level` for a colour renders a vendor nobody has been able to
   * see for hours as green — the one thing this product exists to prevent.
   */
  it('a stale entry is unknown, however green the stored payload is', () => {
    const stale = view({
      currentLevel: 'unknown',
      result: {
        data: { platform: 'statuspage', level: 'operational', label: 'Operational', note: 'all good', incidentsSince: [] },
        fetchedAt: '2026-09-19T09:00:00.000Z',
        degraded: true,
        error: { code: 'http_503', message: 'the feed answered HTTP 503' },
      },
    });
    expect(stale.vendor.level).toBe('unknown');
    expect(stale.vendor.label).toBe('Unknown');
    // And the history is kept, in the one place it is allowed to live.
    expect(stale.feed.data).toEqual({ level: 'operational', label: 'Operational', incidentsSince: [] });
    expect(loadKind(stale.feed)).toBe('stale');
    expect(stale.feed.error?.message).toBe('the feed answered HTTP 503');
  });

  it('a level the API did not send is unknown, not operational', () => {
    const silent = view({ currentLevel: undefined });
    expect(silent.vendor.level).toBe('unknown');
  });

  it('a level we do not recognise is unknown, not passed through', () => {
    expect(view({ currentLevel: 'ok' }).vendor.level).toBe('unknown');
    expect(view({ currentLevel: 'green' }).vendor.level).toBe('unknown');
    expect(view({ currentLevel: 42 }).vendor.level).toBe('unknown');
  });

  it('isStatusLevel accepts the five members and nothing else', () => {
    for (const member of ['operational', 'degraded', 'outage', 'maintenance', 'unknown']) {
      expect(isStatusLevel(member)).toBe(true);
    }
    for (const other of ['OPERATIONAL', 'ok', '', null, undefined, 0, {}]) {
      expect(isStatusLevel(other)).toBe(false);
    }
  });

  it('every level has its own word', () => {
    expect(levelLabel('operational')).toBe('Operational');
    expect(levelLabel('degraded')).toBe('Degraded');
    expect(levelLabel('outage')).toBe('Outage');
    expect(levelLabel('maintenance')).toBe('Maintenance');
    expect(levelLabel('unknown')).toBe('Unknown');
  });
});

describe('the vendor half carries its provenance', () => {
  it('a snapshot with a payload has a last successful poll', () => {
    expect(view().vendor.lastSuccessfulPoll).toBe('2026-09-19T12:00:00.000Z');
  });

  it('a snapshot with no payload has none at all — the field is absent', () => {
    const never = view({
      currentLevel: 'unknown',
      result: {
        fetchedAt: '2026-09-19T12:00:00.000Z',
        degraded: true,
        error: { code: 'never_polled', message: 'no poll of this source has ever been recorded' },
      },
    });
    // Absent, not undefined-valued: ServiceDetail branches on the key being
    // there to tell "answered and told us nothing" from "never authenticated".
    expect('lastSuccessfulPoll' in never.vendor).toBe(false);
    expect(never.vendor.note).toBe('no poll of this source has ever been recorded');
    expect(loadKind(never.feed)).toBe('failed');
  });

  it('carries amendment 10\'s basis when the level was ours rather than theirs', () => {
    const inferred = view({ inferred: { basis: '2 of 2 of our own checks passing' } });
    expect(inferred.vendor.inferred).toEqual({ basis: '2 of 2 of our own checks passing' });
  });

  it('has no inferred basis when the vendor spoke for itself', () => {
    expect(view().vendor.inferred).toBeUndefined();
  });
});

describe('an absent measurement is null, and a zero is a measurement', () => {
  it('keeps real zeros', () => {
    const zeros = view({ latencyMs: 0, uptime30d: 0, incidents90d: 0, p50Ms: 0, p95Ms: 0 });
    expect(zeros.latencyMs).toBe(0);
    expect(zeros.uptime30d).toBe(0);
    expect(zeros.incidents90d).toBe(0);
    expect(zeros.p50Ms).toBe(0);
  });

  it('turns every absent measurement into null, never into zero', () => {
    const none = view({
      latencyMs: null,
      p50Ms: null,
      p95Ms: null,
      spark: null,
      uptime30d: null,
      incidents90d: null,
      lastStateChange: null,
    });
    expect(none.latencyMs).toBeNull();
    expect(none.p50Ms).toBeNull();
    expect(none.p95Ms).toBeNull();
    expect(none.spark).toBeNull();
    expect(none.uptime30d).toBeNull();
    expect(none.incidents90d).toBeNull();
    expect(none.lastStateChange).toBeNull();
  });

  it('treats a missing key the same as an explicit null', () => {
    // Five of the seven services have no probe data, and a field the server
    // stops sending must not read as a measurement of nothing.
    const missing = serviceEntryView({ id: 'm365', currentLevel: 'unknown' });
    expect(missing?.latencyMs).toBeNull();
    expect(missing?.uptime30d).toBeNull();
    expect(missing?.spark).toBeNull();
  });

  it('refuses NaN and Infinity, which would render as words', () => {
    expect(view({ latencyMs: Number.NaN }).latencyMs).toBeNull();
    expect(view({ uptime30d: Number.POSITIVE_INFINITY }).uptime30d).toBeNull();
  });

  it('keeps the holes inside a sparkline as holes', () => {
    expect(view({ spark: [100, null, 300] }).spark).toEqual([100, null, 300]);
    expect(view({ spark: ['x', 100] }).spark).toEqual([null, 100]);
  });

  it('carries a store failure through so the nulls can be explained', () => {
    const broken = view({ metricsError: { code: 'store_unavailable', message: 'database is locked' } });
    expect(broken.metricsError).toEqual({ code: 'store_unavailable', message: 'database is locked' });
  });

  it('ours reads unknown, not passing, when the counts are absent', () => {
    const noOurs = serviceEntryView({ id: 'claude', currentLevel: 'operational' });
    expect(noOurs?.ours.level).toBe('unknown');
    expect(noOurs?.ours.passing).toBe(0);
    expect(noOurs?.ours.total).toBe(0);
  });
});

describe('a service the API does not name is still shown', () => {
  it('labels the seven from the map', () => {
    expect(view().short).toBe('Jira');
    expect(view().name).toBe('Jira Software');
  });

  it('falls back to the id for an eighth service rather than dropping the tile', () => {
    const eighth = serviceEntryView({ id: 'newthing', currentLevel: 'operational' });
    expect(eighth?.short).toBe('newthing');
    expect(eighth?.name).toBe('newthing');
  });

  it('refuses an entry with no id at all', () => {
    expect(serviceEntryView({ currentLevel: 'operational' })).toBeNull();
    expect(serviceEntryView('jira')).toBeNull();
    expect(serviceEntryView(null)).toBeNull();
  });
});

describe('parseServices', () => {
  it('reads a whole response', () => {
    const parsed = parseServices({ servedAt: '2026-09-19T12:00:00.000Z', services: [entry(), entry({ id: 'm365' })] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.services.map((s) => s.id)).toEqual(['jira', 'm365']);
    expect(parsed.value.servedAt).toBe('2026-09-19T12:00:00.000Z');
  });

  it('refuses a payload that is not a services response', () => {
    for (const junk of [null, 'nope', 42, {}, { servedAt: 'x' }, { services: [] }, '<html>']) {
      expect(parseServices(junk).ok).toBe(false);
    }
  });

  it('refuses the whole response rather than serving six of seven tiles', () => {
    // A tile that vanishes looks exactly like a service nobody monitors, which
    // is quieter and worse than an error.
    const parsed = parseServices({ servedAt: 't', services: [entry(), { noId: true }] });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('bad_payload');
  });
});

/* ------------------------------------------------------------- incidents */

const apiIncident = (over: Record<string, unknown> = {}) => ({
  id: 'vendor:proofpoint:2026-09-19T12:00',
  ruleKey: 'vendor',
  serviceId: 'proofpoint',
  severity: 1,
  openedAt: '2026-09-19T12:00:00.000Z',
  summary: 'Proofpoint reports outage on its statusio feed. Both halves of the rule are satisfied.',
  ...over,
});

describe('an incident arrives with four fields the store does not keep', () => {
  it('titles the row from the summary\'s first sentence', () => {
    const inc = incidentView(apiIncident());
    expect(inc?.title).toBe('Proofpoint reports outage on its statusio feed.');
    // The whole summary is still there for the detail page.
    expect(inc?.summary).toContain('Both halves of the rule are satisfied.');
  });

  it('leaves blast radius and timeline EMPTY rather than inventing them', () => {
    const inc = incidentView(apiIncident());
    expect(inc?.blastRadius).toEqual([]);
    expect(inc?.timeline).toEqual([]);
  });

  it('builds the meta line from fields that were served', () => {
    expect(incidentView(apiIncident())?.metaParts).toEqual(['Sev 1', 'Proofpoint', 'Rule vendor']);
  });

  it('says out loud when the severity is a fallback', () => {
    const inc = incidentView(apiIncident({ severity: 1, severityRaw: 'critical' }));
    expect(inc?.metaParts).toContain('severity unreadable (critical), shown as Sev 1');
  });

  it('names a platform-wide incident by its raw id rather than guessing', () => {
    const inc = incidentView(apiIncident({ serviceId: 'platform:statuspage', ruleKey: 'blackout', severity: 2 }));
    expect(inc?.metaParts).toEqual(['Sev 2', 'platform:statuspage', 'Rule blackout']);
  });

  it('refuses an incident missing anything a screen renders', () => {
    for (const key of ['id', 'summary', 'openedAt', 'serviceId']) {
      const broken: Record<string, unknown> = apiIncident();
      delete broken[key];
      expect(incidentView(broken)).toBeNull();
    }
  });
});

describe('decodeSeverity never decodes an unreadable value as benign', () => {
  it('reads the four real values, including the string forms SQLite produces', () => {
    expect(decodeSeverity(1)).toBe(1);
    expect(decodeSeverity('2')).toBe(2);
    expect(decodeSeverity(3)).toBe(3);
    expect(decodeSeverity('info')).toBe('info');
  });

  it('falls back to 1, the most severe, and never to info', () => {
    for (const junk of ['critical', null, undefined, 9, {}, '']) {
      expect(decodeSeverity(junk)).toBe(1);
    }
  });
});

describe('parseIncidents carries data and error together (amendment 9)', () => {
  const envelope = (result: Record<string, unknown>) => ({ servedAt: '2026-09-19T12:00:00.000Z', result });

  it('reads a good list', () => {
    const parsed = parseIncidents(envelope({ data: [apiIncident()], fetchedAt: 't', degraded: false }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.incidents).toHaveLength(1);
    expect(parsed.value.error).toBeUndefined();
  });

  it('an empty list is a list, not a failure', () => {
    const parsed = parseIncidents(envelope({ data: [], fetchedAt: 't', degraded: false, empty: true }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.incidents).toEqual([]);
  });

  it('keeps the last-good list AND the reason when both arrive', () => {
    // The obvious code — fail on `error`, succeed otherwise — throws away a
    // perfectly good list on the first bad tick, which is the stale state
    // disappearing at the last hop.
    const parsed = parseIncidents(
      envelope({ data: [apiIncident()], fetchedAt: 't', degraded: true, error: { code: 'store_unavailable', message: 'locked' } }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.incidents).toHaveLength(1);
    expect(parsed.value.error).toEqual({ code: 'store_unavailable', message: 'locked' });
  });

  it('reports the store\'s own words when there is no list at all', () => {
    const parsed = parseIncidents(
      envelope({ fetchedAt: 't', degraded: true, error: { code: 'store_unavailable', message: 'database is locked' } }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toEqual({ code: 'store_unavailable', message: 'database is locked' });
  });

  it('refuses a malformed envelope', () => {
    for (const junk of [null, {}, { servedAt: 't' }, { servedAt: 't', result: {} }, { result: { data: [] } }]) {
      expect(parseIncidents(junk).ok).toBe(false);
    }
  });
});

describe('an OMITTED key is handled, not merely an explicit null — G5 MEDIUM 6', () => {
  /**
   * The server omits `result.data` rather than sending `data: null` when a
   * source has never succeeded — `exactOptionalPropertyTypes` makes those
   * different types, and amendment 9 chose omission deliberately so a consumer
   * destructuring `data` gets nothing rather than a present-but-empty field.
   *
   * G5 raised the hazard: an omitted key survives `{ ...defaults, ...entry }`
   * and silently restores whatever the default was, so a fixture's "operational"
   * could outlive a source that has never been read.
   *
   * It does not reproduce here, because the parser reads every key explicitly
   * instead of spreading. These tests turn "happens not to bite" into "cannot
   * bite" — the distinction the reviewer was right to insist on, since the next
   * person to touch this file is one `...raw` away from the hazard being real.
   */
  const neverPolled = () =>
    entry({
      id: 'm365',
      source: 'vendor:m365',
      // No `data` key at all. Not `data: null`, not `data: {}`.
      result: { fetchedAt: '2026-09-20T04:00:00.000Z', degraded: true, error: { code: 'never_polled', message: 'no poll yet' } },
      currentLevel: 'unknown',
      ours: { level: 'unknown', label: 'No checks', note: 'No probe of ours has ever run.', passing: 0, total: 0 },
      latencyMs: null,
      p50Ms: null,
      p95Ms: null,
      spark: null,
      uptime30d: null,
      uptimeFrom: null,
      uptimeSamples: 0,
      incidents90d: 0,
      lastStateChange: null,
    });

  /**
   * The same narrowing `view()` does at the top of this file, for payloads
   * built by hand here rather than from `entry()`'s defaults.
   *
   * It throws rather than asserting non-null with `!`: `serviceEntryView`
   * returns `ServiceView | null` and every test below assumes the payload was
   * accepted. If one day it is not, the failure should name that fact instead
   * of reading as an assertion about a level.
   */
  const parsedView = (raw: unknown) => {
    const got = serviceEntryView(raw);
    if (got === null) throw new Error('the payload under test did not parse');
    return got;
  };

  it('a source that has never succeeded does not inherit a level from anywhere', () => {
    const view = parsedView(neverPolled());
    expect(view.vendor.level).toBe('unknown');
    // And the past-tense reading is absent rather than defaulted: there is no
    // "what we last saw", because we never saw anything.
    expect(view.feed.data).toBeUndefined();
    expect(view.feed.error?.code).toBe('never_polled');
  });

  it('the omitted key does not become a truthy object somewhere downstream', () => {
    // The specific failure: `data` arriving as `{}` and `level(undefined)`
    // resolving to a default. Asserted on the level rather than on the key, so
    // it holds however the parser is reorganised.
    const view = parsedView(neverPolled());
    expect(view.vendor.level).not.toBe('operational');
    expect(view.vendor.level).toBe('unknown');
  });

  it('an explicit null is handled the same as an omission', () => {
    // The server does not send this today. It should still not matter which
    // shape arrives — a consumer that behaved differently would be relying on
    // a serialisation detail nobody promised.
    const withNull = entry({
      result: { data: null, fetchedAt: '2026-09-20T04:00:00.000Z', degraded: true, error: { code: 'http_503', message: 'x' } },
      currentLevel: 'unknown',
    });
    const view = parsedView(withNull);
    expect(view.vendor.level).toBe('unknown');
    expect(view.feed.data).toBeUndefined();
  });

  it('a present payload still reads through, so the tests above are not passing vacuously', () => {
    // The control. Without it, a parser that dropped `data` unconditionally
    // would satisfy every assertion above.
    const view = parsedView(entry());
    expect(view.feed.data?.level).toBe('operational');
    expect(view.vendor.level).toBe('operational');
  });
});

/* --------------------------------------------------------------- /api/checks */

describe('the individual check runs', () => {
  const RUN = {
    serviceId: 'jira',
    at: '2026-09-20T04:00:00.000Z',
    check: 'Jira /status',
    region: 'us-east',
    result: 'pass',
    latencyMs: 110,
  };
  const page = (over: Record<string, unknown> = {}) => ({
    fetchedAt: '2026-09-20T04:00:05.000Z',
    degraded: false,
    data: [RUN],
    ...over,
  });

  const runsOf = (json: unknown, id: ServiceId = 'jira') => {
    const parsed = parseChecks(json, id);
    if (!parsed.ok) throw new Error(`refused: ${parsed.error.message}`);
    return parsed.value;
  };

  it('reads a run field by field', () => {
    // Pinned literals rather than a comparison against RUN: an echo of the
    // input would pass for a parser that spread the payload through unread.
    const [run] = runsOf(page()).value;
    expect(run).toEqual({
      serviceId: 'jira',
      at: '2026-09-20T04:00:00.000Z',
      check: 'Jira /status',
      region: 'us-east',
      result: 'pass',
      latencyMs: 110,
    });
    expect(runsOf(page()).servedAt).toBe('2026-09-20T04:00:05.000Z');
  });

  it('a timeout keeps its null latency rather than becoming a fast probe', () => {
    const [run] = runsOf(page({ data: [{ ...RUN, result: 'timeout', latencyMs: null }] })).value;
    expect(run?.result).toBe('timeout');
    expect(run?.latencyMs).toBeNull();
  });

  it('a missing latency is null, and a zero is kept as a measurement', () => {
    const [absent] = runsOf(page({ data: [{ ...RUN, latencyMs: undefined }] })).value;
    expect(absent?.latencyMs).toBeNull();
    const [zero] = runsOf(page({ data: [{ ...RUN, latencyMs: 0 }] })).value;
    expect(zero?.latencyMs).toBe(0);
  });

  it('an empty page is a successful read of nothing, not a failure', () => {
    const parsed = parseChecks(page({ data: [], empty: true }), 'jira');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.value).toEqual([]);
    // No error alongside it: "we looked and there are none" carries no reason,
    // because nothing went wrong.
    expect(parsed.value.error).toBeUndefined();
  });

  it('a store that could not be read is a failure in its own words, never an empty list', () => {
    const parsed = parseChecks(
      { fetchedAt: 't', degraded: true, error: { code: 'store_unavailable', message: 'database is locked' } },
      'jira',
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toEqual({ code: 'store_unavailable', message: 'database is locked' });
  });

  it('rows AND an error is stale-with-last-good, and keeps both', () => {
    const parsed = parseChecks(page({ degraded: true, error: { code: 'store_unavailable', message: 'locked' } }), 'jira');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.value).toHaveLength(1);
    expect(parsed.value.error).toEqual({ code: 'store_unavailable', message: 'locked' });
  });

  it('refuses a page with no age on it', () => {
    // A table of numbers with no idea how old they are is the panel this
    // milestone exists to remove.
    expect(parseChecks({ degraded: false, data: [RUN] }, 'jira').ok).toBe(false);
  });

  it('refuses a run whose result is not one we can colour', () => {
    for (const result of ['ok', 'PASS', '', null, undefined, 1]) {
      expect(parseChecks(page({ data: [{ ...RUN, result }] }), 'jira').ok).toBe(false);
    }
    // The control: the three real ones are all accepted, so the assertion above
    // is not passing over a parser that refuses everything.
    for (const result of ['pass', 'fail', 'timeout']) {
      expect(parseChecks(page({ data: [{ ...RUN, result }] }), 'jira').ok).toBe(true);
    }
  });

  it('refuses a run belonging to another service', () => {
    // Another service's probe on this page, attributed to this one. The query
    // is bound to one id; a row carrying a different one is a defect upstream.
    expect(parseChecks(page({ data: [{ ...RUN, serviceId: 'openai' }] }), 'jira').ok).toBe(false);
    expect(parseChecks(page(), 'openai').ok).toBe(false);
  });

  it('refuses a row missing any of the fields the table renders', () => {
    for (const key of ['serviceId', 'at', 'check', 'region']) {
      expect(parseChecks(page({ data: [{ ...RUN, [key]: undefined }] }), 'jira').ok).toBe(false);
    }
  });

  it('refuses a malformed page rather than reporting no runs', () => {
    for (const junk of [null, 'runs', {}, { fetchedAt: 't', degraded: false }, { fetchedAt: 't', data: {} }]) {
      expect(parseChecks(junk, 'jira').ok).toBe(false);
    }
  });
});

describe('incidentView hydrates the operator\'s own actions', () => {
  /** What `/api/incidents` serves for an incident somebody has acted on. */
  const served = (over: Record<string, unknown>) => ({
    id: 'INC-2291',
    ruleKey: 'vendor',
    serviceId: 'proofpoint',
    severity: 1,
    openedAt: '2026-09-20T07:00:00.000Z',
    summary: 'Mail flow degraded. Two probes failing.',
    ...over,
  });

  it('carries ack through, because three call sites already read it', () => {
    // `Overview.tsx` dims an acknowledged row, credits `incident.ack.by` and
    // disables its Acknowledge button; `IncidentDetail.tsx` reads it too. All
    // of that was dead on the live path — this parser built an Incident without
    // the field, so an incident somebody HAD acknowledged rendered as untouched
    // with the button still inviting them to do it again.
    const view = incidentView(served({ ack: { by: 'ops@example.com', at: '2026-09-20T07:30:00.000Z' } }));
    expect(view).not.toBeNull();
    expect(view?.ack).toEqual({ by: 'ops@example.com', at: '2026-09-20T07:30:00.000Z' });
  });

  it('treats an indefinite mute and an expiring one as different facts', () => {
    // `until: null` is muted indefinitely. It is NOT the same as an expiry we
    // could not read, and it is not the same as no mute at all.
    const forever = incidentView(served({ muted: { by: 'ops@example.com', until: null } }));
    expect(forever?.muted).toEqual({ by: 'ops@example.com', until: null });

    const timed = incidentView(served({ muted: { by: 'ops@example.com', until: '2026-09-21T00:00:00.000Z' } }));
    expect(timed?.muted).toEqual({ by: 'ops@example.com', until: '2026-09-21T00:00:00.000Z' });

    // An omitted `until` is the server's normalised indefinite, same as null.
    const omitted = incidentView(served({ muted: { by: 'ops@example.com' } }));
    expect(omitted?.muted).toEqual({ by: 'ops@example.com', until: null });
  });

  it('leaves both keys ABSENT when there is no action, never empty objects', () => {
    // `Overview.tsx` does `Boolean(i.ack)`, so `{}` would read as acknowledged
    // by nobody — and `{...incident}` has to keep working across the web layer.
    const view = incidentView(served({}));
    expect(view).not.toBeNull();
    expect(view && 'ack' in view).toBe(false);
    expect(view && 'muted' in view).toBe(false);
    expect(Boolean(view?.ack)).toBe(false);
  });

  it('refuses a half-built flag rather than crediting it to nobody', () => {
    // An ack with no `by` cannot be credited, and inventing a name would put a
    // person's name on an action they may not have taken. Dropping the flag
    // says "not acknowledged", which is the honest reading of a record we
    // cannot read — and it is visibly different from a wrong name.
    for (const ack of [{ at: '2026-09-20T07:30:00.000Z' }, { by: 'ops@example.com' }, 'yes', 7, []]) {
      const view = incidentView(served({ ack }));
      expect(view, JSON.stringify(ack)).not.toBeNull();
      expect(view?.ack, JSON.stringify(ack)).toBeUndefined();
    }
    // A mute whose expiry is neither a string nor null is refused whole: it
    // must not silently become "forever".
    expect(incidentView(served({ muted: { by: 'ops@example.com', until: 12345 } }))?.muted).toBeUndefined();
    // The control: a well-formed flag is still accepted, so the refusals above
    // are not a parser that drops every flag.
    expect(incidentView(served({ ack: { by: 'ops@example.com', at: 't' } }))?.ack).toEqual({
      by: 'ops@example.com',
      at: 't',
    });
  });
});


describe('vendorAdvisories — amendment 2 finally reaching a screen', () => {
  const advisory = (over: Record<string, unknown> = {}) => ({
    title: 'Elevated API error rates',
    level: 'degraded',
    startedAt: '2026-09-20T09:00:00.000Z',
    resolvedAt: null,
    url: 'https://status.example.com/incidents/abc123',
    ...over,
  });

  it('carries what four adapters populate and this parser used to drop', () => {
    // `incidentsSince` is REQUIRED on the contract, so neither open-loop guard
    // could see it going nowhere: one scans optional fields a fixture carries,
    // the other scans optional fields. It reached no screen for a milestone.
    const out = vendorAdvisories([advisory()]);
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe('Elevated API error rates');
    expect(out[0]?.level).toBe('degraded');
    expect(out[0]?.startedAt).toBe('2026-09-20T09:00:00.000Z');
    expect(out[0]?.resolvedAt).toBeNull();
  });

  it('drops a vendor URL that is not https, rather than sanitising it', () => {
    // `safeUrl` was written in Milestone 1 naming this exact field and had never
    // been called. A `javascript:` URL in an href executes on click, and a
    // local-only app is still a browser. Dropped, not cleaned: "sanitise" is how
    // these bugs come back.
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'http://status.example.com/x',
      'vbscript:msgbox(1)',
      'not a url at all',
      '//status.example.com/x',
    ]) {
      const out = vendorAdvisories([advisory({ url })]);
      // The ROW survives — an advisory we will not link to is still an advisory
      // the operator should read.
      expect(out, url).toHaveLength(1);
      expect(out[0] && 'url' in out[0], url).toBe(false);
      expect(out[0]?.title, url).toBe('Elevated API error rates');
    }
    // The control: an https URL IS kept, so the refusals above are not a
    // function that drops every link.
    expect(vendorAdvisories([advisory()])[0]?.url).toBe('https://status.example.com/incidents/abc123');
  });

  it('drops a row it cannot read rather than blanking the whole service', () => {
    // The opposite rule to `signals` and `attention`, deliberately: those ARE
    // the panel, this is a supplementary list beside a level the operator still
    // needs. One malformed advisory must not blank a tile.
    const out = vendorAdvisories([
      advisory(),
      { level: 'outage' },
      'not an object',
      advisory({ title: 7 }),
      advisory({ startedAt: undefined }),
      advisory({ title: 'Second real one' }),
    ]);
    expect(out.map((a) => a.title)).toEqual(['Elevated API error rates', 'Second real one']);
  });

  it('reads an unrecognised level as unknown, never as operational', () => {
    expect(vendorAdvisories([advisory({ level: 'fine' })])[0]?.level).toBe('unknown');
    expect(vendorAdvisories([advisory({ level: undefined })])[0]?.level).toBe('unknown');
  });

  it('shows an unreadable resolution as still open, which is the visible error', () => {
    // An advisory wrongly shown as OPEN is visible and gets corrected. One
    // wrongly shown as resolved is not, and disappears.
    expect(vendorAdvisories([advisory({ resolvedAt: 12345 })])[0]?.resolvedAt).toBeNull();
    expect(vendorAdvisories([advisory({ resolvedAt: '2026-09-20T10:00:00.000Z' })])[0]?.resolvedAt).toBe(
      '2026-09-20T10:00:00.000Z',
    );
  });

  it('is an empty list, never a crash, for anything that is not an array', () => {
    for (const raw of [undefined, null, 'x', 7, {}]) expect(vendorAdvisories(raw)).toEqual([]);
  });
});
