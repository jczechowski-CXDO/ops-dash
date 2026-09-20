import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import { LiveDataProvider } from './DataSource.js';
import { parseEntra } from './parse.js';
import type { ApiClient, ApiPath, Fetched } from './client.js';
import Entra, { GRAPH_UNCONFIGURED, MFA_BASIS } from '../views/Entra.js';
import { fixtures } from '../fixtures/index.js';
import { Panel, type PanelState } from '../components/Panel.js';

/**
 * The Entra page against `/api/entra`, and the parser underneath it.
 *
 * The screen this milestone is actually about: a working adapter has been
 * reading the real tenant every fifteen minutes and nothing served it, so the
 * page rendered fixtures. Everything below is about the four states that has to
 * arrive in — and about the one state that must never happen, which is the
 * fixture tenant rendering while the live one is unreadable. The fixture Entra
 * page is a quiet screen, so that particular failure would render as good news.
 *
 * Every payload here is in the shape a running server serves, with redacted
 * values only: people at `example.com`, no machine names, no addresses.
 */

/* --------------------------------------------------------------- payloads */

/** The figures the live tenant actually last reported, so the assertions below
 *  are read off a payload rather than off the code that renders it. */
const LIVE_STATS = {
  riskySignIns24h: 2,
  riskyConfirmedCompromised: 0,
  failedSignIns24h: 4503,
  failedSignInAccounts: 151,
  mfaCoverage: 0.762,
  mfaUnregistered: 112,
  privilegedAccounts: 32,
  globalAdmins: 11,
};

const SIGNALS = [
  { key: 'risky_signin', label: 'Risky sign-ins', count: 2, delta24h: 1, severity: 2, lastSeen: '2026-09-20T07:40:00.000Z' },
  { key: 'failed_spike', label: 'Failed sign-in spike', count: 4503, delta24h: 310, severity: 2, lastSeen: '2026-09-20T07:55:00.000Z' },
  { key: 'legacy_auth', label: 'Legacy authentication', count: 0, delta24h: 0, severity: 3, lastSeen: '2026-09-20T06:00:00.000Z' },
  { key: 'expiring_credentials', label: 'Expiring app credentials', count: 4, delta24h: 0, severity: 3, lastSeen: '2026-09-20T07:00:00.000Z' },
  { key: 'role_change', label: 'Privileged role changes', count: 1, delta24h: 1, severity: 2, lastSeen: '2026-09-20T05:12:00.000Z' },
  { key: 'guest_access', label: 'Guest accounts', count: 511, delta24h: 3, severity: 'info', lastSeen: '2026-09-20T04:00:00.000Z' },
];

const AUDIT = [
  { at: '2026-09-20T07:50:00.000Z', actor: 'admin@example.com', action: 'Add member to role', target: 'Helpdesk Administrator', result: 'success' },
  { at: '2026-09-20T07:20:00.000Z', actor: 'admin@example.com', action: 'Update conditional access policy', target: 'Require MFA for admins', result: 'success' },
  { at: '2026-09-20T06:40:00.000Z', actor: 'System', action: 'Consent to application', target: 'Reporting export', result: 'failure' },
  { at: '2026-09-20T06:10:00.000Z', actor: 'sec.lead@example.com', action: 'Reset user password', target: 'starter@example.com', result: 'success' },
  { at: '2026-09-20T05:30:00.000Z', actor: 'sec.lead@example.com', action: 'Invite external user', target: 'partner@example.com', result: 'success' },
  { at: '2026-09-20T05:12:00.000Z', actor: 'admin@example.com', action: 'Remove member from role', target: 'Global Administrator', result: 'success' },
  { at: '2026-09-20T04:44:00.000Z', actor: 'System', action: 'Update application', target: 'Reporting export', result: 'success' },
  { at: '2026-09-20T04:02:00.000Z', actor: 'admin@example.com', action: 'Disable user', target: 'leaver@example.com', result: 'failure' },
];

const SERVED_AT = '2026-09-20T08:00:00.000Z';

/** `{ servedAt, result }` — the envelope `/api/incidents` serves and the one
 *  this route matches, assembled here rather than spread through the tests so a
 *  shape change is one edit. */
const entraBody = (over: Record<string, unknown> = {}, stats: unknown = LIVE_STATS) => ({
  servedAt: SERVED_AT,
  result: {
    fetchedAt: SERVED_AT,
    degraded: false,
    data: { stats, signals: SIGNALS, audit: AUDIT },
    ...over,
  },
});

/** An envelope with no snapshot at all: the all-or-nothing failure, which is
 *  the COMMON one on this source — one failed Graph read costs the lot. */
const couldNotLook = (message: string) => ({
  servedAt: SERVED_AT,
  result: {
    fetchedAt: SERVED_AT,
    degraded: true,
    error: { code: 'graph_read_failed', message },
  },
});

/* ----------------------------------------------------------------- client */

const ok = (json: unknown): Fetched => ({ ok: true, json });
const fail = (message: string): Fetched => ({ ok: false, error: { code: 'unreachable', message } });
const pending = (): Promise<Fetched> => new Promise<Fetched>(() => {});

function clientOf(answers: Partial<Record<ApiPath, () => Promise<Fetched> | Fetched>>): ApiClient {
  return {
    get: async (path) => {
      const answer = answers[path];
      return answer ? answer() : fail(`no stub for ${path}`);
    },
    checks: async (serviceId) => fail(`no checks stub for ${serviceId}`),
  };
}

const live = (
  answer: () => Promise<Fetched> | Fetched,
  children: ReactNode = <Entra />,
  intervalMs = 1_000_000,
) =>
  render(
    <MemoryRouter initialEntries={['/entra']}>
      <ThemeProvider>
        <DemoModeProvider>
          <LiveDataProvider
            client={clientOf({ '/api/entra': answer, '/api/services': pending, '/api/incidents': pending })}
            intervalMs={intervalMs}
          >
            {children}
          </LiveDataProvider>
        </DemoModeProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );

afterEach(() => vi.useRealTimers());

const stats = () => within(screen.getByTestId('entra-stats'));

/** Body rows actually painted into a named section's table. */
const bodyRows = (name: string) =>
  within(within(screen.getByRole('region', { name })).getByRole('table')).getAllByRole('row').slice(1);

/** The heading meta beside a section title — the count, as an operator reads it. */
const sectionMeta = (name: string) => within(screen.getByRole('region', { name })).getByText(/^\d+ (signal|event)s?$/);

/* ------------------------------------------------------------ the parser */

describe('parseEntra', () => {
  it('reads the stats, signals and audit rows a running server serves', () => {
    const parsed = parseEntra(entraBody());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.servedAt).toBe(SERVED_AT);
    // Pinned literals, not a re-read of LIVE_STATS through the parser: the
    // assertion may not reach the value by the path the code did.
    expect(parsed.value.value.stats.failedSignIns24h).toBe(4503);
    expect(parsed.value.value.stats.mfaCoverage).toBeCloseTo(0.762, 5);
    expect(parsed.value.value.stats.globalAdmins).toBe(11);
    expect(parsed.value.value.signals).toHaveLength(6);
    expect(parsed.value.value.audit).toHaveLength(8);
    expect(parsed.value.error).toBeUndefined();
  });

  it('refuses a payload missing any one stat rather than serving a zero for it', () => {
    // Every one of the eight, because a zero on THIS screen reads as good news
    // and the contract has nowhere to write "we could not look" into one of
    // them. Absent and non-numeric are both unreadable; 0 is a real reading.
    const keys = Object.keys(LIVE_STATS);
    expect(keys).toHaveLength(8);
    for (const key of keys) {
      const { [key as keyof typeof LIVE_STATS]: _dropped, ...rest } = LIVE_STATS;
      expect(parseEntra(entraBody({}, rest)).ok, `${key} absent`).toBe(false);
      expect(parseEntra(entraBody({}, { ...LIVE_STATS, [key]: null })).ok, `${key} null`).toBe(false);
      expect(parseEntra(entraBody({}, { ...LIVE_STATS, [key]: 'many' })).ok, `${key} non-numeric`).toBe(false);
    }
  });

  it('keeps a stat that is genuinely zero, which is a reading and not an absence', () => {
    const parsed = parseEntra(entraBody({}, { ...LIVE_STATS, riskySignIns24h: 0, globalAdmins: 0 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.value.stats.riskySignIns24h).toBe(0);
    expect(parsed.value.value.stats.globalAdmins).toBe(0);
  });

  it('reports "we could not look" in the server\'s own words, with no data', () => {
    const parsed = parseEntra(couldNotLook('We could not read the MFA registration report, so nothing about Entra was read.'));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('graph_read_failed');
    expect(parsed.error.message).toMatch(/MFA registration report/);
  });

  it('carries a snapshot AND its error together, so a partial read is not thrown away', () => {
    const parsed = parseEntra(
      entraBody({ degraded: true, error: { code: 'entra_partial', message: 'These counts are lower bounds: hit the page budget on: failed sign-ins.' } }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.value.stats.failedSignIns24h).toBe(4503);
    expect(parsed.value.error?.code).toBe('entra_partial');
  });

  it('refuses a signal whose key is not one of the eight in the contract', () => {
    const parsed = parseEntra({
      ...entraBody(),
      result: { ...entraBody().result, data: { stats: LIVE_STATS, signals: [{ ...SIGNALS[0], key: 'password_spray' }], audit: AUDIT } },
    });
    expect(parsed.ok).toBe(false);
  });

  it('refuses an audit row whose result is unreadable rather than calling it a success', () => {
    for (const result of [undefined, 'ok', 7]) {
      const row = { ...AUDIT[0], ...(result === undefined ? {} : { result }) };
      if (result === undefined) delete (row as Record<string, unknown>)['result'];
      const parsed = parseEntra({
        servedAt: SERVED_AT,
        result: { fetchedAt: SERVED_AT, degraded: false, data: { stats: LIVE_STATS, signals: SIGNALS, audit: [row] } },
      });
      expect(parsed.ok, `result=${String(result)}`).toBe(false);
    }
  });

  it('shows a severity it cannot decode as Sev 1, never as the mildest thing on the page', () => {
    const parsed = parseEntra({
      servedAt: SERVED_AT,
      result: {
        fetchedAt: SERVED_AT,
        degraded: false,
        data: { stats: LIVE_STATS, signals: [{ ...SIGNALS[0], severity: 'moderate' }], audit: [] },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.value.signals[0]?.severity).toBe(1);
  });

  it('refuses a malformed envelope rather than rendering an empty tenant', () => {
    expect(parseEntra(null).ok).toBe(false);
    expect(parseEntra({ result: entraBody().result }).ok).toBe(false);
    expect(parseEntra({ servedAt: SERVED_AT }).ok).toBe(false);
    expect(parseEntra({ servedAt: SERVED_AT, result: { fetchedAt: SERVED_AT, degraded: false } }).ok).toBe(false);
  });
});

/* -------------------------------------------------------------- the screen */

describe('Entra · live · loading', () => {
  it('says it is loading and shows no tenant at all', async () => {
    live(pending);
    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading')).toBeInTheDocument();
    expect(screen.queryByTestId('entra-stats')).not.toBeInTheDocument();
  });

  it('does not fall back to the fixture tenant while the API has answered nothing', async () => {
    live(pending);
    await screen.findByRole('status');
    // The sev1 fixture's own figures, read off the fixture bundle by hand. If
    // any of these reach the screen, a quiet demo tenant is being rendered over
    // a live one nobody has read — the wrong-green this page can produce.
    expect(fixtures.sev1.entra.stats.failedSignIns24h).toBe(1204);
    expect(screen.queryByText('1,204')).not.toBeInTheDocument();
    expect(screen.queryByText('94.3%')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Directory audit' })).not.toBeInTheDocument();
  });
});

describe('Entra · live · we could not look', () => {
  const REASON = 'We could not read the MFA registration report, so nothing about Entra was read.';

  it('renders the failure as a failure, naming the question that went unanswered', async () => {
    live(() => ok(couldNotLook(REASON)));
    expect(await screen.findByText(/Entra is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp('MFA registration report'))).toBeInTheDocument();
  });

  it('shows no statistics at all rather than eight zeroes', async () => {
    live(() => ok(couldNotLook(REASON)));
    await screen.findByText(/Entra is unavailable/);
    expect(screen.queryByTestId('entra-stats')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
  });

  it('says the same when our own API is the thing that cannot be reached', async () => {
    live(() => fail('Failed to fetch'));
    expect(await screen.findByText(/Entra is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument();
    expect(screen.queryByTestId('entra-stats')).not.toBeInTheDocument();
  });
});

describe('Entra · live · ready', () => {
  it('puts the tenant\'s own figures on the screen', async () => {
    live(() => ok(entraBody()));
    await screen.findByTestId('entra-stats');
    // Read off the payload by hand, formatted as an operator sees them.
    expect(stats().getByText('4,503')).toBeInTheDocument();
    expect(stats().getByText('against 151 accounts')).toBeInTheDocument();
    expect(stats().getByText('76.2%')).toBeInTheDocument();
    expect(stats().getByText('112 users unregistered')).toBeInTheDocument();
    expect(stats().getByText('32')).toBeInTheDocument();
    expect(stats().getByText('11 Global Administrators')).toBeInTheDocument();
    // Two risky sign-ins and none confirmed compromised is amber, not red.
    expect(stats().getByText('2')).toHaveStyle({ color: 'var(--warning-dark)' });
    expect(stats().getByText('0 confirmed compromised')).toBeInTheDocument();
  });

  it('fills both tables from the payload and counts what it painted', async () => {
    live(() => ok(entraBody()));
    await screen.findByTestId('entra-stats');
    expect(bodyRows('Signals · last 24 hours')).toHaveLength(6);
    expect(bodyRows('Directory audit')).toHaveLength(8);
    expect(sectionMeta('Signals · last 24 hours')).toHaveTextContent('6 signals');
    expect(sectionMeta('Directory audit')).toHaveTextContent('8 events');
  });

  it('says a failed directory change failed', async () => {
    live(() => ok(entraBody()));
    await screen.findByTestId('entra-stats');
    const failures = AUDIT.filter((r) => r.result === 'failure');
    expect(failures).toHaveLength(2);
    expect(within(screen.getByRole('region', { name: 'Directory audit' })).getAllByText('failed')).toHaveLength(
      failures.length,
    );
  });

  it('qualifies the MFA figure as members-only, and only on the live path', async () => {
    live(() => ok(entraBody()));
    expect(await screen.findByTestId('entra-mfa-basis')).toHaveTextContent(MFA_BASIS);
    expect(MFA_BASIS).toMatch(/member accounts only/);
  });
});

describe('Entra · live · an absent signal is not a zero signal', () => {
  it('renders no mfa_gap row on a cold start, and never loses the count', async () => {
    // What the adapter serves before it has a previous snapshot to diff:
    // `mfa_gap` OMITTED, because its delta24h is unknowable. The count it would
    // have carried is `stats.mfaUnregistered`, which is present from the first
    // poll — so the fact survives the signal's absence.
    expect(SIGNALS.some((s) => s.key === 'mfa_gap')).toBe(false);
    live(() => ok(entraBody()));
    await screen.findByTestId('entra-stats');
    expect(bodyRows('Signals · last 24 hours')).toHaveLength(SIGNALS.length);
    expect(
      within(screen.getByRole('region', { name: 'Signals · last 24 hours' })).queryByText(/MFA/i),
    ).not.toBeInTheDocument();
    // Not a row reading 0, and not a row at all — but the number is on screen.
    expect(stats().getByText('112 users unregistered')).toBeInTheDocument();
  });

  it('renders the row when the adapter DOES have a previous snapshot to diff', async () => {
    const withGap = [
      ...SIGNALS,
      { key: 'mfa_gap', label: 'Users without MFA', count: 112, delta24h: -4, severity: 2, lastSeen: '2026-09-20T07:00:00.000Z' },
    ];
    live(() =>
      ok({ servedAt: SERVED_AT, result: { fetchedAt: SERVED_AT, degraded: false, data: { stats: LIVE_STATS, signals: withGap, audit: AUDIT } } }),
    );
    await screen.findByTestId('entra-stats');
    expect(bodyRows('Signals · last 24 hours')).toHaveLength(7);
    const region = within(screen.getByRole('region', { name: 'Signals · last 24 hours' }));
    expect(region.getByText('Users without MFA')).toBeInTheDocument();
    expect(region.getByText('-4')).toBeInTheDocument();
  });
});

describe('Entra · live · we looked and there is nothing', () => {
  it('gives each empty table its own designed sentence rather than a blank card', async () => {
    live(() => ok({ servedAt: SERVED_AT, result: { fetchedAt: SERVED_AT, degraded: false, data: { stats: LIVE_STATS, signals: [], audit: [] } } }));
    await screen.findByTestId('entra-stats');
    expect(screen.getByText('No signals in the last 24 hours.')).toBeInTheDocument();
    expect(screen.getByText('No directory changes recorded.')).toBeInTheDocument();
    // An empty tenant is still a read tenant: the stats are the evidence that
    // we looked, so they must be on screen beside the two empty states.
    expect(stats().getByText('4,503')).toBeInTheDocument();
    expect(sectionMeta('Signals · last 24 hours')).toHaveTextContent('0 signals');
  });
});

describe('Entra · live · stale', () => {
  it('keeps the last good snapshot across a failed poll, and says how old it is and why', async () => {
    // The clock is pinned and the interval is a minute, so the age is
    // arithmetic rather than whatever the suite happened to take: the snapshot
    // was served at 08:00, the failing poll lands at 08:14, and the badge must
    // report the age of the DATA and not of the failure.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-20T08:13:00.000Z'));
    let call = 0;
    live(() => (call++ === 0 ? ok(entraBody()) : fail('the API answered HTTP 503')), <Entra />, 60_000);
    await screen.findByTestId('entra-stats');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(await screen.findByText(/Entra data is 14 minutes old/)).toBeInTheDocument();
    // The numbers are STILL THERE. Not a spinner, not zeroes, not a blank page.
    expect(stats().getByText('4,503')).toBeInTheDocument();
    expect(bodyRows('Directory audit')).toHaveLength(8);
    // And the reason, which the age alone does not give.
    expect(within(screen.getByRole('alert')).getByTestId('panel-stale-reason')).toHaveTextContent(
      'the API answered HTTP 503',
    );
  });

  it('stops being stale the moment the source answers again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-20T08:13:00.000Z'));
    let call = 0;
    live(
      () => (call++ === 1 ? fail('the API answered HTTP 503') : ok(entraBody())),
      <Entra />,
      60_000,
    );
    await screen.findByTestId('entra-stats');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await screen.findByText(/Entra data is 14 minutes old/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(stats().getByText('4,503')).toBeInTheDocument();
  });

  it('marks a degraded snapshot as stale and prints the reason inside the alert', async () => {
    const REASON = 'These counts are lower bounds: hit the page budget on: failed sign-ins.';
    live(() => ok(entraBody({ degraded: true, error: { code: 'entra_partial', message: REASON } })));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Entra data is/);
    expect(within(alert).getByTestId('panel-stale-reason')).toHaveTextContent(REASON);
    // The numbers are still there: stale renders its children.
    expect(stats().getByText('4,503')).toBeInTheDocument();
  });
});

describe('Entra · live · this host was never given a credential', () => {
  /** What `/api/entra` serves when `graphHealth` reports no credential: an
   *  error, no data, and a code that says which absence this is. Transcribed
   *  from `api/routes.ts`'s `graphUnconfigured`. */
  const UNCONFIGURED_MESSAGE =
    'No Graph credential is configured on this host, so Entra has never been polled.';
  const unconfigured = () => ({
    servedAt: SERVED_AT,
    result: {
      fetchedAt: SERVED_AT,
      degraded: true,
      error: { code: GRAPH_UNCONFIGURED, message: UNCONFIGURED_MESSAGE },
    },
  });

  it('says so neutrally, and does not paint a deliberate absence as an outage', async () => {
    live(() => ok(unconfigured()));
    expect(await screen.findByText(UNCONFIGURED_MESSAGE)).toBeInTheDocument();
    // The assertions that matter are about what an operator does NOT see: this
    // host is not broken, nothing is unavailable, and a red alert here would
    // teach them to discount the red that means something.
    expect(screen.queryByText(/Entra is unavailable/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // And no fabricated tenant behind it.
    expect(screen.queryByTestId('entra-stats')).not.toBeInTheDocument();
  });

  it('a real failure is still a red failure — the carve is one code wide', async () => {
    // The control. Without it the test above passes just as well over a view
    // that stopped alerting on anything, which is the failure it would be
    // introducing rather than preventing.
    for (const code of ['graph_read_failed', 'never_polled', 'store_unavailable']) {
      const view = live(() =>
        ok({
          servedAt: SERVED_AT,
          result: { fetchedAt: SERVED_AT, degraded: true, error: { code, message: `it went wrong (${code})` } },
        }),
      );
      expect(await screen.findByText(/Entra is unavailable/), code).toBeInTheDocument();
      expect(screen.getByRole('alert'), code).toBeInTheDocument();
      view.unmount();
    }
  });

  it('keeps the last good numbers even under that code, rather than blanking them', async () => {
    // `graph_unconfigured` alongside a payload should not happen — the route
    // only serves it when there is no row at all — but the carve is written to
    // trigger only on an ABSENT payload, because swallowing a stale load into a
    // neutral empty would throw away numbers we are holding. Asserted rather
    // than left to the comment.
    live(() =>
      ok({
        servedAt: SERVED_AT,
        result: {
          fetchedAt: SERVED_AT,
          degraded: true,
          data: { stats: LIVE_STATS, signals: SIGNALS, audit: AUDIT },
          error: { code: GRAPH_UNCONFIGURED, message: UNCONFIGURED_MESSAGE },
        },
      }),
    );
    await screen.findByTestId('entra-stats');
    expect(stats().getByText('4,503')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Entra data is/);
  });
});

describe('the invariant the live branch leans on', () => {
  /**
   * Why this test exists, and it is the most useful thing the mutation battery
   * for this task produced.
   *
   * `Entra` chooses its snapshot with `live === null ? bundle.entra : live.data`
   * — explicitly, so that a live page with nothing to show renders NOTHING,
   * never the demo tenant. The obvious-looking rewrite `live?.data ??
   * bundle.entra` was applied and **all 727 tests stayed green**, because
   * `Panel` does not render its children in `loading`, `error` or `empty`: the
   * fixture tenant was being selected and then swallowed one component up.
   *
   * So the mutant is equivalent *today*, and it is equivalent because of a
   * property of a component this file does not own and does not state. The day
   * `Panel` renders children behind an error alert, the two forms stop being
   * equivalent and a quiet demo tenant appears over a tenant nobody could read
   * — which on this screen is the failure rendering as good news.
   *
   * This pins that property where the dependency actually is. It is not a test
   * of `Panel` for `Panel`'s sake; it is the assumption `Entra` makes, asserted
   * by the file that makes it.
   */
  it('Panel renders no children in the three states that have nothing to show', () => {
    const states: PanelState[] = [
      { kind: 'loading' },
      { kind: 'error', source: 'Entra', message: 'we could not look' },
      { kind: 'empty', message: 'nothing here' },
    ];
    for (const state of states) {
      const { unmount } = render(
        <Panel state={state}>
          <span data-testid="leaked-child">the fixture tenant</span>
        </Panel>,
      );
      expect(screen.queryByTestId('leaked-child'), `${state.kind} leaked its children`).not.toBeInTheDocument();
      unmount();
    }
    // The control: the states that DO render children still do, so the four
    // assertions above are not passing because `Panel` renders nothing at all.
    for (const state of [{ kind: 'ready' } as const, { kind: 'stale', source: 'Entra', fetchedAt: SERVED_AT } as const]) {
      const { unmount } = render(
        <Panel state={state}>
          <span data-testid="leaked-child">the live tenant</span>
        </Panel>,
      );
      expect(screen.getByTestId('leaked-child')).toBeInTheDocument();
      unmount();
    }
  });
});

describe('Entra · the fixture path is untouched', () => {
  it('renders the demo tenant with no provider, and no live-only copy', () => {
    render(
      <MemoryRouter initialEntries={['/entra?demo=sev1']}>
        <ThemeProvider>
          <DemoModeProvider>
            <Entra />
          </DemoModeProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    expect(stats().getByText('1,204')).toBeInTheDocument();
    expect(screen.queryByTestId('entra-mfa-basis')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

/* --------------------------------------------------------- the relationship */

describe('the heading count and the rows it counts cannot drift apart', () => {
  it('agrees across five shapes, live', async () => {
    const shapes: { signals: unknown[]; audit: unknown[] }[] = [
      { signals: [], audit: [] },
      { signals: SIGNALS.slice(0, 1), audit: AUDIT.slice(0, 1) },
      { signals: SIGNALS.slice(0, 3), audit: AUDIT.slice(0, 5) },
      { signals: SIGNALS, audit: AUDIT },
      { signals: SIGNALS.slice(0, 2), audit: [] },
    ];
    for (const shape of shapes) {
      const view = live(() =>
        ok({ servedAt: SERVED_AT, result: { fetchedAt: SERVED_AT, degraded: false, data: { stats: LIVE_STATS, ...shape } } }),
      );
      await screen.findByTestId('entra-stats');
      for (const [name, rows, noun] of [
        ['Signals · last 24 hours', shape.signals, 'signal'],
        ['Directory audit', shape.audit, 'event'],
      ] as const) {
        const painted = rows.length === 0 ? 0 : bodyRows(name).length;
        // The count an operator reads, against the rows an operator can see —
        // two independently reachable facts, not one value compared to itself.
        expect(sectionMeta(name), `${name} @ ${rows.length}`).toHaveTextContent(
          `${painted} ${noun}${painted === 1 ? '' : 's'}`,
        );
        expect(painted, `${name} painted`).toBe(rows.length);
      }
      view.unmount();
    }
  });
});
