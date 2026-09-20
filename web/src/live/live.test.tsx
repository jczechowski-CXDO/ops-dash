import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import { App } from '../app/App.js';
import { LiveDataProvider, useChecks } from './DataSource.js';
import type { CheckRun, ServiceId } from '@ops-dash/shared';
import type { ApiClient, ApiPath, Fetched } from './client.js';

/**
 * The three states, rendered through the real screens.
 *
 * These are the assertions the milestone is actually about. Everything else in
 * `live/` is a unit; this is where an operator either sees the truth or does
 * not:
 *
 *   1. loading   — nothing yet, and it says so
 *   2. failed    — we could not reach our own API, and it says why
 *   3. stale     — the last good numbers, VISIBLY marked, with the reason
 *
 * Every payload below is hand-written in the shape a running server serves,
 * with redacted values only: vendor status hostnames and the seven service ids,
 * no person, no machine, no address.
 */

/* ------------------------------------------------------------- the payloads */

const vendorEntry = (over: Record<string, unknown>) => ({
  source: 'vendor:x',
  result: { data: null, fetchedAt: '2026-09-19T12:00:00.000Z', degraded: false },
  currentLevel: 'operational',
  ours: { level: 'unknown', label: 'No checks', note: 'No probe of ours has ever run for this service.', passing: 0, total: 0 },
  latencyMs: null,
  p50Ms: null,
  p95Ms: null,
  spark: null,
  uptime30d: null,
  incidents90d: 0,
  lastStateChange: null,
  ...over,
});

/** Jira: fresh, green, with probes of our own. The ordinary case. */
const JIRA = vendorEntry({
  id: 'jira',
  result: {
    data: { platform: 'statuspage', level: 'operational', label: 'Operational', note: 'Statuspage reports all 11 components operational.', incidentsSince: [] },
    fetchedAt: '2026-09-19T12:00:00.000Z',
    degraded: false,
  },
  ours: { level: 'operational', label: 'Passing', note: '1 of 1 checks passing.', passing: 1, total: 1 },
  latencyMs: 220,
  p50Ms: 112,
  p95Ms: 220,
  spark: [112, 108, 220],
  uptime30d: 1,
  incidents90d: 0,
});

/** Claude: the COMMON case — a vendor we can read and a service we do not
 *  probe. Every one of our own measurements is absent. */
const CLAUDE = vendorEntry({
  id: 'claude',
  result: {
    data: { platform: 'statuspage', level: 'operational', label: 'Operational', note: 'Statuspage reports all 6 components operational.', incidentsSince: [] },
    fetchedAt: '2026-09-19T12:00:00.000Z',
    degraded: false,
  },
});

/** Proofpoint: green in the store, unreadable since. The stale case. */
const PROOFPOINT = vendorEntry({
  id: 'proofpoint',
  result: {
    data: { platform: 'statusio', level: 'operational', label: 'Operational', note: 'status.io reports all 19 Hornetsecurity services operational.', incidentsSince: [] },
    fetchedAt: '2026-09-19T09:00:00.000Z',
    degraded: true,
    error: { code: 'http_503', message: 'the status.io feed answered HTTP 503' },
  },
  currentLevel: 'unknown',
});

/** m365: probes that did not answer, and a store that could not be read. */
const M365 = vendorEntry({
  id: 'm365',
  currentLevel: 'degraded',
  result: {
    data: { platform: 'msgraph', level: 'degraded', label: 'Degraded', note: 'Microsoft Graph reports 4 of 7 services we depend on not operational.', incidentsSince: [] },
    fetchedAt: '2026-09-19T12:00:00.000Z',
    degraded: false,
  },
  ours: { level: 'outage', label: 'Failing', note: '1 of 3 checks passing.', passing: 1, total: 3 },
  latencyMs: null,
  spark: [210, null, null, 260],
  incidents90d: null,
  metricsError: { code: 'store_unavailable', message: 'incidents: database is locked' },
});

const SERVICES = { servedAt: '2026-09-19T12:00:00.000Z', services: [JIRA, CLAUDE, PROOFPOINT, M365] };

const INCIDENT = {
  id: 'vendor:proofpoint:2026-09-19T12:00',
  ruleKey: 'vendor',
  serviceId: 'proofpoint',
  severity: 1,
  openedAt: '2026-09-19T12:00:00.000Z',
  summary: 'Proofpoint reports outage on its statusio feed. Both halves of the rule are satisfied, so this is a confirmed vendor-side incident.',
};

const incidentsBody = (data: unknown[], error?: { code: string; message: string }) => ({
  servedAt: '2026-09-19T12:00:00.000Z',
  result: { data, fetchedAt: '2026-09-19T12:00:00.000Z', degraded: error !== undefined, ...(error ? { error } : {}) },
});

/** The runs `/api/checks?service=jira` serves: one probe that answered and one
 *  that did not. Redacted like everything else here — a vendor endpoint name
 *  and a region, no host of ours. */
const JIRA_RUNS: CheckRun[] = [
  { serviceId: 'jira', at: '2026-09-19T11:59:30.000Z', check: 'Jira /status', region: 'us-east', result: 'pass', latencyMs: 220 },
  { serviceId: 'jira', at: '2026-09-19T11:59:00.000Z', check: 'Jira /status', region: 'eu-west', result: 'timeout', latencyMs: null },
];

const checksBody = (data: unknown[], over: Record<string, unknown> = {}) => ({
  fetchedAt: '2026-09-19T12:00:00.000Z',
  degraded: false,
  data,
  ...(data.length === 0 ? { empty: true } : {}),
  ...over,
});

/* --------------------------------------------------------------- the client */

const ok = (json: unknown): Fetched => ({ ok: true, json });
const fail = (message: string): Fetched => ({ ok: false, error: { code: 'unreachable', message } });
/** A request that never settles: the loading state, which is otherwise over
 *  before the first assertion can see it. */
const pending = (): Promise<Fetched> => new Promise<Fetched>(() => {});

function clientOf(
  answers: Partial<Record<ApiPath, () => Promise<Fetched> | Fetched>>,
  /** Takes the id it was asked for, so a test can prove the page asked about
   *  the service it is showing rather than about whichever one came first. */
  checks?: (serviceId: ServiceId) => Promise<Fetched> | Fetched,
): ApiClient {
  return {
    get: async (path) => {
      const answer = answers[path];
      if (!answer) return fail(`no stub for ${path}`);
      return answer();
    },
    // Unstubbed by default and deliberately an ERROR rather than an empty
    // success: a test that forgets to stub this should see a panel saying the
    // runs could not be read, not one saying there are none.
    checks: async (serviceId) => (checks ? checks(serviceId) : fail(`no checks stub for ${serviceId}`)),
  };
}

const live = (client: ApiClient, children: ReactNode, path = '/', intervalMs = 1_000_000) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <DemoModeProvider>
          <LiveDataProvider client={client} intervalMs={intervalMs}>
            {children}
          </LiveDataProvider>
        </DemoModeProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );

const app = (client: ApiClient, path = '/', intervalMs = 1_000_000) => live(client, <App />, path, intervalMs);

/**
 * The warning alert whose age line names this source.
 *
 * Panels do not carry a per-site testid for their stale reason and should not:
 * the Overview can have TWO stale panels on screen at once, both failing with
 * the same message, so a unique id would not be what distinguishes them anyway.
 * Finding the alert by the source it names and asserting the reason INSIDE it
 * asserts the pairing — this source's alert carries this source's reason —
 * which a per-site id cannot: the services reason rendered in the incidents
 * panel would satisfy it.
 */
const staleAlertFor = (source: string): HTMLElement => {
  const found = screen
    .getAllByRole('alert')
    .filter((a) => a.textContent?.includes(`${source} data is`));
  expect(found, `no stale alert naming ${source}`).toHaveLength(1);
  return found[0]!;
};

afterEach(() => vi.useRealTimers());

/* ------------------------------------------------------------- 1. loading */

describe('state 1: loading', () => {
  it('says it is loading rather than showing an empty dashboard', async () => {
    app(clientOf({ '/api/services': pending, '/api/incidents': pending }));
    const statuses = await screen.findAllByRole('status');
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses[0]).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByText('Loading').length).toBeGreaterThan(0);
  });

  it('claims nothing about health while it is still reading', async () => {
    app(clientOf({ '/api/services': pending, '/api/incidents': pending }));
    await screen.findAllByRole('status');
    // The quiet screen is an assertion — "no active incidents" over a dashboard
    // that has not read anything yet is the wrong-green, one state early.
    expect(screen.queryByTestId('no-incidents')).not.toBeInTheDocument();
    expect(screen.queryByText(/ALL SYSTEMS OPERATIONAL/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('alert-summary')).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------- 2. failed */

describe('state 2: we cannot reach our own API', () => {
  const dead = () => clientOf({
    '/api/services': () => fail('Failed to fetch'),
    '/api/incidents': () => fail('Failed to fetch'),
  });

  it('says so, in the failure\'s own words, on both panels', async () => {
    app(dead());
    expect(await screen.findByText(/Service status is unavailable/)).toBeInTheDocument();
    expect(await screen.findByText(/Incidents is unavailable/)).toBeInTheDocument();
    expect(screen.getAllByText(/Failed to fetch/).length).toBeGreaterThanOrEqual(2);
  });

  it('does not render the all-clear over a dashboard that answered nothing', async () => {
    app(dead());
    await screen.findByText(/Service status is unavailable/);
    expect(screen.queryByTestId('no-incidents')).not.toBeInTheDocument();
    expect(screen.queryByTestId('alert-summary')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('service-tile')).toHaveLength(0);
    expect(screen.queryAllByTestId('service-pill')).toHaveLength(0);
  });

  it('the header counts nothing rather than counting zero', async () => {
    app(dead());
    await screen.findByText(/Service status is unavailable/);
    expect(screen.getByText('We cannot reach our own API')).toBeInTheDocument();
    expect(screen.queryByText(/monitored services affirmed healthy/)).not.toBeInTheDocument();
  });

  it('one dead endpoint does not blank the other', async () => {
    app(clientOf({
      '/api/services': () => ok(SERVICES),
      '/api/incidents': () => fail('Failed to fetch'),
    }));
    // Tiles from the endpoint that answered...
    expect(await screen.findAllByTestId('service-tile')).toHaveLength(4);
    // ...and the failure from the one that did not, instead of "no incidents".
    expect(screen.getByText(/Incidents is unavailable/)).toBeInTheDocument();
    expect(screen.queryByTestId('no-incidents')).not.toBeInTheDocument();
  });
});

/* --------------------------------------------------------------- 3. stale */

describe('state 3: the last good numbers, visibly stale, with the reason', () => {
  /** Answers once, then fails — the shape of every real outage. */
  const flaky = (first: unknown) => {
    let calls = 0;
    return () => (calls++ === 0 ? ok(first) : fail('Failed to fetch'));
  };

  it('keeps showing the numbers, and says how old they are and why', async () => {
    // The clock is pinned and the poll interval is a minute, so the age below
    // is arithmetic rather than whatever the suite happened to take: the
    // response was served at 12:00, the failing poll lands at 12:14, and the
    // badge must report the age of the DATA and not of the failure.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-19T12:13:00.000Z'));
    // An open incident, so the Overview renders the TILE grid: the numbers that
    // have to survive a failed poll are on the tiles, and the quiet strip has
    // none of them.
    const client = clientOf({ '/api/services': flaky(SERVICES), '/api/incidents': () => ok(incidentsBody([INCIDENT])) });
    app(client, '/', 60_000);
    await screen.findByText('Jira');

    // Second poll fails.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(await screen.findByText(/Service status data is 14 minutes old/)).toBeInTheDocument();

    // The numbers are STILL THERE. This is the whole point: not a spinner, not
    // zeros, not a blank panel.
    expect(screen.getByText('Jira')).toBeInTheDocument();
    expect(screen.getByText('220 ms')).toBeInTheDocument();
    // And the reason, which the age alone does not give.
    expect(within(staleAlertFor('Service status')).getByTestId('panel-stale-reason')).toHaveTextContent(
      'Failed to fetch',
    );
  });

  it('stops being stale the moment the source answers again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    const client = clientOf({
      '/api/services': () => (calls++ === 1 ? fail('Failed to fetch') : ok(SERVICES)),
      '/api/incidents': () => ok(incidentsBody([])),
    });
    app(client, '/', 60_000);
    await screen.findByText('Jira');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await screen.findByText(/Service status data is/);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    // A recovered source is not "stale but recent": the error is cleared, not
    // aged out.
    expect(await screen.findByText('Jira')).toBeInTheDocument();
    expect(screen.queryByText(/Service status data is/)).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('panel-stale-reason')).toHaveLength(0);
  });

  it('gives each stale panel its OWN reason, with two of them on screen', async () => {
    // The world where the candidates differ. With one stale panel, a view that
    // rendered the wrong source's reason — or one that rendered the same
    // sentence in both — passes every assertion. Two panels, stale for two
    // DIFFERENT causes, is the only shape that can tell those apart.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-19T12:13:00.000Z'));
    const client = clientOf({
      '/api/services': flaky(SERVICES),
      // The incidents envelope carries data AND its own error, so this panel is
      // stale on its first answer, for a reason of its own.
      '/api/incidents': () => ok(incidentsBody([INCIDENT], { code: 'store_unavailable', message: 'database is locked' })),
    });
    app(client, '/', 60_000);
    await screen.findByText('Jira');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

    const services = within(staleAlertFor('Service status')).getByTestId('panel-stale-reason');
    const incidents = within(staleAlertFor('Incidents')).getByTestId('panel-stale-reason');
    expect(services).toHaveTextContent('Failed to fetch');
    expect(incidents).toHaveTextContent('database is locked');
    // Neither carries the other's, which is the half a single-panel test cannot
    // see: two elements, two sentences, each in the alert that names its source.
    expect(services).not.toHaveTextContent('database is locked');
    expect(incidents).not.toHaveTextContent('Failed to fetch');
  });

  it('marks ONE service whose own feed is stale, without staling the others', async () => {
    app(clientOf({ '/api/services': () => ok(SERVICES), '/api/incidents': () => ok(incidentsBody([INCIDENT])) }));
    await screen.findByText('Proofpoint');
    const tiles = screen.getAllByTestId('service-tile');
    const proofpoint = tiles.find((t) => t.textContent?.includes('Proofpoint'));
    const jira = tiles.find((t) => t.textContent?.includes('Jira'));
    expect(within(proofpoint!).getByTestId('tile-feed-marker')).toHaveTextContent('Vendor feed unreadable');
    expect(within(jira!).queryByTestId('tile-feed-marker')).not.toBeInTheDocument();
  });

  it('paints the stale service grey and never green, whatever the payload says', async () => {
    app(clientOf({ '/api/services': () => ok(SERVICES), '/api/incidents': () => ok(incidentsBody([INCIDENT])) }));
    await screen.findByText('Proofpoint');
    const tiles = screen.getAllByTestId('service-tile');
    const proofpoint = tiles.find((t) => t.textContent?.includes('Proofpoint'))!;
    const jira = tiles.find((t) => t.textContent?.includes('Jira'))!;
    // Pinned literals, not `statusColor(...)` on both sides: the stored payload
    // for Proofpoint says `operational`, so a view reading `data.level` would
    // paint it exactly what Jira gets.
    expect(within(proofpoint).getByTestId('tile-dot')).toHaveStyle({ background: 'var(--text-disabled)' });
    expect(within(jira).getByTestId('tile-dot')).toHaveStyle({ background: 'var(--success-main)' });
    expect(within(proofpoint).getByText('Vendor: Unknown')).toBeInTheDocument();
  });

  it('shows the stale vendor\'s last reading as history on its detail page', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-19T12:00:00.000Z'));
    app(clientOf({ '/api/services': () => ok(SERVICES), '/api/incidents': () => ok(incidentsBody([])) }), '/services/proofpoint');
    expect(await screen.findByTestId('vendor-feed-stale')).toHaveTextContent('the status.io feed answered HTTP 503');
    expect(screen.getByTestId('vendor-last-seen')).toHaveTextContent(
      'Last time we could read this feed, 3 hours ago, the vendor said Operational.',
    );
    // The half-card's own word is the safe one, in the present tense.
    expect(within(screen.getByTestId('vendor-dot').parentElement!).getByText('Unknown')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------- absent, not zero */

describe('absent measurements render as absent', () => {
  const upClient = () => clientOf({ '/api/services': () => ok(SERVICES), '/api/incidents': () => ok(incidentsBody([INCIDENT])) });

  it('a service with no probe shows an em dash, not 0 ms', async () => {
    app(upClient());
    await screen.findByText('Claude');
    const claude = screen.getAllByTestId('service-tile').find((t) => t.textContent?.includes('Claude'))!;
    expect(within(claude).getByText('—')).toBeInTheDocument();
    expect(within(claude).queryByText('0 ms')).not.toBeInTheDocument();
  });

  it('a service with no samples draws no line and says why', async () => {
    app(upClient());
    await screen.findByText('Claude');
    const claude = screen.getAllByTestId('service-tile').find((t) => t.textContent?.includes('Claude'))!;
    expect(within(claude).getByTestId('tile-no-spark')).toHaveTextContent('No probe samples');
    // A flat line at zero is a service that flatlined. There must be no line.
    expect(claude.querySelector('polyline')).toBeNull();
  });

  it('a service WITH samples still draws its line', async () => {
    // The control: if the branch above fired for everything, the assertion
    // would be about a component that never renders a chart at all.
    app(upClient());
    await screen.findByText('Jira');
    const jira = screen.getAllByTestId('service-tile').find((t) => t.textContent?.includes('Jira'))!;
    expect(jira.querySelector('polyline')).not.toBeNull();
  });

  it('counts the probes that did not answer rather than drawing them as fast', async () => {
    app(upClient());
    await screen.findByText('Microsoft 365');
    const m365 = screen.getAllByTestId('service-tile').find((t) => t.textContent?.includes('Microsoft 365'))!;
    expect(within(m365).getByTestId('tile-spark-holes')).toHaveTextContent('2 of 4 probes did not answer');
  });

  it('no probe data is neither 100% nor 0% uptime, on the detail page', async () => {
    app(upClient(), '/services/claude');
    expect(await screen.findByText('Uptime (30d)')).toBeInTheDocument();
    const card = screen.getByText('Uptime (30d)').parentElement!;
    expect(within(card).getByText('—')).toBeInTheDocument();
    expect(within(card).getByText('no runs in the window')).toBeInTheDocument();
    expect(card.textContent).not.toContain('100.00%');
    expect(card.textContent).not.toContain('0.00%');
  });

  it('a real 100% still prints as a number', async () => {
    // The world where the two candidates differ: without this, a view that
    // printed the em dash unconditionally would pass the assertion above.
    app(upClient(), '/services/jira');
    expect(await screen.findByText('100.00%')).toBeInTheDocument();
  });

  it('an unreadable incident log is an em dash, while a real zero is 0', async () => {
    const { unmount } = app(upClient(), '/services/m365');
    expect(await screen.findByText('incident log unreadable')).toBeInTheDocument();
    const unreadable = screen.getByText('Incidents (90d)').parentElement!;
    expect(within(unreadable).getByText('—')).toBeInTheDocument();
    unmount();

    // The same stat over a service whose log WAS read and held nothing. Zero is
    // a fact about a complete record and prints as a number; without this the
    // assertion above passes for a view that prints the em dash always.
    app(upClient(), '/services/jira');
    expect(await screen.findByText('opened and closed')).toBeInTheDocument();
    const counted = screen.getByText('Incidents (90d)').parentElement!;
    expect(within(counted).getByText('0')).toBeInTheDocument();
    expect(within(counted).queryByText('—')).not.toBeInTheDocument();
  });

  it('says once, loudly, when our own store could not be read', async () => {
    app(upClient(), '/services/m365');
    expect(await screen.findByText(/Our probe history is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/database is locked/)).toBeInTheDocument();
  });

  it('a service with counts whose runs we could not read does not claim no probe has run', async () => {
    app(upClient(), '/services/jira');
    expect(await screen.findByText(/1 of 1 checks reported/)).toBeInTheDocument();
    expect(screen.queryByText('No probe has run yet.')).not.toBeInTheDocument();
    // `upClient` stubs no check runs, so the runs endpoint fails: the line says
    // which of the three no-runs cases this is, rather than implying the probes
    // never ran.
    expect(screen.getByText(/The individual runs could not be read/)).toBeInTheDocument();
  });

  it('a service with no checks at all says exactly that', async () => {
    app(upClient(), '/services/claude');
    expect(await screen.findByText('No probe has run yet.')).toBeInTheDocument();
  });
});

describe('a poll that was cancelled is not a failure', () => {
  it('unmounting mid-flight paints nothing red', async () => {
    // A route change aborts the in-flight request. Reporting that as an outage
    // is a false alarm, and a dashboard that cries wolf on navigation is one
    // whose red nobody reads.
    let settle: (v: Fetched) => void = () => {};
    const client = clientOf({
      '/api/services': () => new Promise<Fetched>((resolve) => { settle = resolve; }),
      '/api/incidents': () => ok(incidentsBody([])),
    });
    const { unmount } = app(client);
    await screen.findAllByRole('status');
    unmount();
    settle({ ok: false, error: { code: 'aborted', message: 'The operation was aborted' } });
    // Nothing to assert on screen — the claim is that resolving after unmount
    // neither throws nor warns about setting state on an unmounted tree.
    expect(true).toBe(true);
  });

  it('an abort code never becomes a panel error', async () => {
    const client = clientOf({
      '/api/services': () => ({ ok: false, error: { code: 'aborted', message: 'The operation was aborted' } }),
      '/api/incidents': () => ok(incidentsBody([])),
    });
    app(client);
    // Incidents answered, so the page is up; services is still loading rather
    // than failed, because an abort is not an answer.
    expect(await screen.findByText(/No active incidents/)).toBeInTheDocument();
    expect(screen.queryByText(/Service status is unavailable/)).not.toBeInTheDocument();
    expect(screen.queryByText(/The operation was aborted/)).not.toBeInTheDocument();
  });
});

/* ----------------------------------------------------------- the incidents */

describe('a live incident renders what the store actually keeps', () => {
  const upClient = () => clientOf({ '/api/services': () => ok(SERVICES), '/api/incidents': () => ok(incidentsBody([INCIDENT])) });

  it('lists it on the Overview with a title, a severity and a count', async () => {
    app(upClient());
    expect(await screen.findByText('Proofpoint reports outage on its statusio feed.')).toBeInTheDocument();
    expect(screen.getByText('SEV 1')).toBeInTheDocument();
    expect(screen.getByTestId('alert-summary')).toHaveTextContent('1 open · 1 Sev1 · 0 Sev2 · 0 Sev3');
  });

  it('shows designed empty states for the two things the store does not keep', async () => {
    app(upClient(), `/incidents/${INCIDENT.id}`);
    expect(await screen.findByText(/No blast-radius metrics are recorded/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been recorded on this incident yet/)).toBeInTheDocument();
    // And the summary, in full, which IS kept.
    expect(screen.getByText(/confirmed vendor-side incident/)).toBeInTheDocument();
  });

  it('links the incident to the service it names', async () => {
    app(upClient(), `/incidents/${INCIDENT.id}`);
    expect(await screen.findByTestId('affected-service-link')).toHaveAttribute('href', '/services/proofpoint');
  });

  it('an incident id we do not hold is not an error, and not "nothing is open"', async () => {
    app(upClient(), '/incidents/INC-0000');
    expect(await screen.findByText(/There is no open incident INC-0000/)).toBeInTheDocument();
  });

  it('but an incident id we could not LOOK UP is reported as a failure', async () => {
    app(clientOf({ '/api/services': () => ok(SERVICES), '/api/incidents': () => fail('Failed to fetch') }), '/incidents/INC-0000');
    expect(await screen.findByText(/Incidents is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/No incidents are open/)).not.toBeInTheDocument();
    expect(screen.queryByText(/That is the good outcome/)).not.toBeInTheDocument();
  });

  it('an empty incident list IS the good outcome, and says so', async () => {
    app(clientOf({ '/api/services': () => ok(SERVICES), '/api/incidents': () => ok(incidentsBody([])) }), '/incidents/INC-0000');
    expect(await screen.findByText(/That is the good outcome/)).toBeInTheDocument();
  });
});

/* ------------------------------------------------ the shell agrees with it */

describe('the shell counts what the pages render', () => {
  it('the nav badge counts the live incidents, not the fixtures', async () => {
    app(clientOf({ '/api/services': () => ok(SERVICES), '/api/incidents': () => ok(incidentsBody([INCIDENT])) }));
    await screen.findByText('Proofpoint reports outage on its statusio feed.');
    const sidebar = screen.getByTestId('sidebar');
    // The sev1 fixture bundle — the default demo world, still mounted
    // underneath — holds five open incidents, two of them Sev1. A badge reading
    // 5 over one live incident is the nav and the page disagreeing about the
    // same record. Both badges are read, because both are counts of this list.
    expect(within(sidebar).getAllByText('1')).toHaveLength(2);
    expect(within(sidebar).queryByText('5')).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('2')).not.toBeInTheDocument();
  });

  it('the header subtitle counts the live services, not the fixtures', async () => {
    app(clientOf({ '/api/services': () => ok(SERVICES), '/api/incidents': () => ok(incidentsBody([INCIDENT])) }));
    await screen.findByText('Proofpoint reports outage on its statusio feed.');
    expect(screen.getByText('1 open incidents across 4 monitored services')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------- the routed views */

describe('a route the live data does not cover', () => {
  it('reports the list\'s own state rather than "not a monitored service"', async () => {
    app(clientOf({ '/api/services': pending, '/api/incidents': pending }), '/services/jira');
    const statuses = await screen.findAllByRole('status');
    expect(statuses[0]).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText(/is not a monitored service/)).not.toBeInTheDocument();
  });

  it('still says "not a monitored service" once we hold a list', async () => {
    app(clientOf({ '/api/services': () => ok(SERVICES), '/api/incidents': () => ok(incidentsBody([])) }), '/services/nope');
    expect(await screen.findByText(/nope is not a monitored service/)).toBeInTheDocument();
  });
});

/* ------------------------------------------- the fixture path is untouched */

describe('the fixture path is not reached in live mode, and vice versa', () => {
  it('live data replaces the demo bundle rather than merging with it', async () => {
    app(clientOf({ '/api/services': () => ok(SERVICES), '/api/incidents': () => ok(incidentsBody([INCIDENT])) }));
    await screen.findByText('Jira');
    // The sev1 fixture world has seven tiles and five alert rows. Four tiles and
    // one row means the page is reading the API and nothing else.
    expect(screen.getAllByTestId('service-tile')).toHaveLength(4);
    expect(screen.getAllByTestId('alert-row')).toHaveLength(1);
    expect(screen.queryByText('Helpjuice')).not.toBeInTheDocument();
  });

  it('with no live provider the very same tree renders the fixtures', async () => {
    // The control for the claim above, and the one that protects 152 baselines:
    // mounting no provider is the fixture path, unchanged.
    render(
      <MemoryRouter initialEntries={['/?demo=sev1']}>
        <ThemeProvider>
          <DemoModeProvider>
            <App />
          </DemoModeProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    expect(await screen.findAllByTestId('service-tile')).toHaveLength(7);
    expect(screen.getAllByTestId('alert-row').length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------ the individual check runs */

describe('the check-runs table reads the API', () => {
  const withChecks = (checks: (id: ServiceId) => Promise<Fetched> | Fetched) =>
    clientOf(
      { '/api/services': () => ok(SERVICES), '/api/incidents': () => ok(incidentsBody([])) },
      checks,
    );

  /** The table is the only one on the page; its body rows are the runs. */
  const runRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

  it('renders one row per run, with the check, the region and the result', async () => {
    app(withChecks(() => ok(checksBody(JIRA_RUNS))), '/services/jira');
    expect(await screen.findByText('Check history')).toBeInTheDocument();
    const rows = runRows();
    expect(rows).toHaveLength(2);
    // Read off the payload by hand, not mapped from JIRA_RUNS: a loop over the
    // same array the stub served would pass for a table rendering nothing.
    expect(rows[0]).toHaveTextContent('Jira /status');
    expect(rows[0]).toHaveTextContent('us-east');
    expect(rows[0]).toHaveTextContent('Pass');
    expect(rows[0]).toHaveTextContent('220');
    expect(rows[1]).toHaveTextContent('eu-west');
    expect(rows[1]).toHaveTextContent('Timeout');
  });

  it('a probe that did not answer shows no latency, never a zero', async () => {
    app(withChecks(() => ok(checksBody(JIRA_RUNS))), '/services/jira');
    await screen.findByText('Check history');
    const timeout = runRows()[1]!;
    expect(timeout).toHaveTextContent('—');
    // A zero here renders as the fastest probe ever recorded, beside a row that
    // says Timeout.
    expect(timeout.textContent).not.toContain('0 ms');
    expect(within(timeout).queryByText('0')).not.toBeInTheDocument();
  });

  it('asks about the service whose page this is', async () => {
    const asked: ServiceId[] = [];
    app(
      withChecks((id) => {
        asked.push(id);
        return ok(checksBody([]));
      }),
      '/services/claude',
    );
    await screen.findByText('Check history');
    expect(asked).toEqual(['claude']);
  });

  it('serves the runs it was given rather than a shorter table', async () => {
    // The 5-vs-25 decision, pinned. The API caps the page at 25; the view shows
    // what it was served, because a table that silently drops rows is one an
    // operator cannot use to count how often a probe is flapping.
    const many: CheckRun[] = Array.from({ length: 25 }, (_, i) => ({
      serviceId: 'jira',
      at: new Date(Date.parse('2026-09-19T12:00:00.000Z') - i * 30_000).toISOString(),
      check: 'Jira /status',
      region: i % 2 === 0 ? 'us-east' : 'eu-west',
      result: 'pass',
      latencyMs: 100 + i,
    }));
    app(withChecks(() => ok(checksBody(many))), '/services/jira');
    await screen.findByText('Check history');
    expect(runRows()).toHaveLength(25);
  });

  it('a service with no runs says there are none, and does not read as a failure', async () => {
    // Five of the seven have no probe today, so this is the COMMON state. If it
    // renders red the operator learns that red means nothing.
    app(withChecks(() => ok(checksBody([]))), '/services/claude');
    expect(await screen.findByText('No check runs have been recorded for this service.')).toBeInTheDocument();
    expect(screen.queryByText(/Check history is unavailable/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('a store we could not read says so, and never says there are none', async () => {
    app(
      withChecks(() => ok({ fetchedAt: '2026-09-19T12:00:00.000Z', degraded: true, error: { code: 'store_unavailable', message: 'database is locked' } })),
      '/services/jira',
    );
    expect(await screen.findByText(/Check history is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/database is locked/)).toBeInTheDocument();
    // The distinction the route was added for: "we could not look" is not
    // "there are none".
    expect(screen.queryByText('No check runs have been recorded for this service.')).not.toBeInTheDocument();
  });

  it('a failure to reach the API at all is also not an empty table', async () => {
    app(withChecks(() => fail('Failed to fetch')), '/services/jira');
    expect(await screen.findByText(/Check history is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument();
    expect(screen.queryByText('No check runs have been recorded for this service.')).not.toBeInTheDocument();
  });

  it('keeps the last runs, marked stale, with the reason', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Served at 12:00, read at 12:14: the age is arithmetic, not whatever the
    // suite took.
    vi.setSystemTime(new Date('2026-09-19T12:14:00.000Z'));
    app(
      withChecks(() => ok(checksBody(JIRA_RUNS, { degraded: true, error: { code: 'store_unavailable', message: 'database is locked' } }))),
      '/services/jira',
    );
    expect(await screen.findByText(/Check history data is 14 minutes old/)).toBeInTheDocument();
    // The rows are STILL THERE — the last runs anyone has beat a blank panel.
    expect(runRows()).toHaveLength(2);
    expect(within(staleAlertFor('Check history')).getByTestId('panel-stale-reason')).toHaveTextContent(
      'database is locked',
    );
  });

  it('does not show one service\'s runs on another service\'s page', async () => {
    // The row is refused by the parser rather than rendered under the wrong
    // name: a probe attributed to the wrong service is worse than no table.
    app(withChecks(() => ok(checksBody(JIRA_RUNS))), '/services/claude');
    expect(await screen.findByText(/Check history is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('Jira /status')).not.toBeInTheDocument();
  });

  it('a route param that is not one of the seven asks the API nothing', async () => {
    // `/api/checks` answers an unknown id with HTTP 400, and a red panel on a
    // page that already says "not a monitored service" is the navigation-as-
    // outage false alarm this layer refuses everywhere else.
    let asked = 0;
    app(
      withChecks(() => {
        asked += 1;
        return ok(checksBody([]));
      }),
      '/services/nope',
    );
    expect(await screen.findByText(/nope is not a monitored service/)).toBeInTheDocument();
    expect(asked).toBe(0);
  });

  it('a new service\'s page never shows the previous one\'s runs', async () => {
    // The poll is keyed on the service, and a keyed poll starts with no data.
    // Without that, walking from Jira's page to Claude's leaves Jira's probes
    // on screen until the first answer arrives — attributed to Claude.
    const answers: Record<string, unknown[]> = { jira: JIRA_RUNS, claude: [] };
    const click = (href: string) => {
      const link = screen.getAllByRole('link').find((a) => a.getAttribute('href') === href);
      expect(link, `no link to ${href}`).toBeDefined();
      fireEvent.click(link!, { button: 0 });
    };
    app(
      withChecks((id) => new Promise<Fetched>((resolve) => {
        // Claude answers late, so the window in which the previous service's
        // rows could still be on screen is wide open rather than closed by a
        // synchronous reply.
        if (id === 'claude') setTimeout(() => resolve(ok(checksBody(answers[id] ?? []))), 50);
        else resolve(ok(checksBody(answers[id] ?? [])));
      })),
      '/',
    );
    await screen.findAllByTestId('service-pill');
    await act(async () => { click('/services/jira'); });
    expect(await screen.findAllByText('Jira /status')).toHaveLength(2);

    await act(async () => { click('/'); });
    await screen.findAllByTestId('service-pill');
    await act(async () => { click('/services/claude'); });
    expect(screen.queryAllByText('Jira /status')).toHaveLength(0);
    expect(await screen.findByText('No check runs have been recorded for this service.')).toBeInTheDocument();
  });

  it('distinguishes "still loading" from "could not be read" beside the counts', async () => {
    // Jira reports 1 of 1 passing, so the counts are real and the runs are not
    // here yet. Saying they could not be read would be a failure we have not
    // had; saying none came back would be a claim we cannot make yet.
    app(withChecks(() => pending()), '/services/jira');
    expect(await screen.findByText(/The individual runs are still loading/)).toBeInTheDocument();
    expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument();
  });

  it('says none came back when the read succeeded and held nothing', async () => {
    // The third case, and the world where the three candidates differ: counts
    // above zero, a successful read, an empty page.
    app(withChecks(() => ok(checksBody([]))), '/services/jira');
    expect(await screen.findByText(/No individual runs came back/)).toBeInTheDocument();
    expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument();
    expect(screen.queryByText(/still loading/)).not.toBeInTheDocument();
  });

  it('says which no-runs case it is beside the counts', async () => {
    // Claude has no probe at all: the half-card says so, and the table's empty
    // state agrees with it rather than contradicting it.
    app(withChecks(() => ok(checksBody([]))), '/services/claude');
    expect(await screen.findByText('No probe has run yet.')).toBeInTheDocument();
    expect(screen.getByText('No check runs have been recorded for this service.')).toBeInTheDocument();
  });
});

describe('the fixture path still owns the demo pages', () => {
  it('renders the fixture runs with no provider, and asks no API', async () => {
    // The branch all 152 baselines render through. Five fixture rows, from
    // Milestone 1's code path, with nothing live above them.
    render(
      <MemoryRouter initialEntries={['/services/jira?demo=sev1']}>
        <ThemeProvider>
          <DemoModeProvider>
            <App />
          </DemoModeProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Check history')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('row').slice(1)).toHaveLength(5);
    // And none of the live copy: the fixtures cannot fail, so the page must not
    // offer a reason they might have.
    expect(screen.queryByText('No check runs have been recorded for this service.')).not.toBeInTheDocument();
    expect(screen.queryByText(/Check history is unavailable/)).not.toBeInTheDocument();
  });
});

/* ------------------------------------------- the hook, where the view cannot */

describe('useChecks is keyed on the service it was asked about', () => {
  /** The claim is about a component that STAYS MOUNTED while the id under it
   *  changes — which routing does not reproduce, because every path between two
   *  service pages unmounts the page in between. So the hook is rendered
   *  directly, with the id as a prop. */
  function Runs({ id }: { id: string }) {
    const load = useChecks(id);
    return (
      <div data-testid="runs">
        {load === null ? 'no provider' : (load.data ?? []).map((r) => r.region).join(',')}
      </div>
    );
  }

  it('drops the previous service\'s runs the moment the id changes', async () => {
    let releaseClaude: (v: Fetched) => void = () => {};
    const client = clientOf({}, (id) =>
      id === 'jira'
        ? ok(checksBody(JIRA_RUNS))
        : new Promise<Fetched>((resolve) => { releaseClaude = resolve; }));
    const tree = (id: string) => (
      <LiveDataProvider client={client} intervalMs={1_000_000}>
        <Runs id={id} />
      </LiveDataProvider>
    );
    const { rerender } = render(tree('jira'));
    expect(await screen.findByTestId('runs')).toHaveTextContent('us-east,eu-west');

    await act(async () => { rerender(tree('claude')); });
    // Claude has not answered yet. Jira's regions on Claude's data would be
    // another service's probes under this service's name.
    expect(screen.getByTestId('runs').textContent).toBe('');
    await act(async () => { releaseClaude(ok(checksBody([]))); });
    expect(screen.getByTestId('runs').textContent).toBe('');
  });

  it('answers null with no provider above it, which is the fixture path', () => {
    render(<Runs id="jira" />);
    expect(screen.getByTestId('runs')).toHaveTextContent('no provider');
  });
});
