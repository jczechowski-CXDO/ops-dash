import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import { LiveDataProvider } from './DataSource.js';
import { parseEndpoints } from './parse.js';
import type { ApiClient, ApiPath, Fetched } from './client.js';
import Endpoints, { BITLOCKER_BASIS } from '../views/Endpoints.js';
import { fixtures } from '../fixtures/index.js';

/**
 * The Endpoints page against `/api/endpoints`.
 *
 * The assertions that carry this file are about ONE stat card. `130 / 213` and
 * a 61%-filled bar announce that 39% of this estate is unencrypted, when the
 * measured truth is 2 known-bad machines and 81 that have never been scanned —
 * ManageEngine reports BitLocker only after an inventory scan, so absence means
 * *unscanned*, not *unencrypted*. A false number in the alarming direction is
 * no better than a false green: a tile that cries wolf is one the operator
 * stops reading.
 *
 * That rendering is correct in the demo world, where every machine is scanned,
 * and it is what the 152 baselines photograph. So the live path diverges and
 * **the live path is the one nobody has ever screenshotted** — which is exactly
 * why it needs a mechanical check rather than an eye. The next person who
 * "restores consistency" between the two paths should get a red.
 *
 * Redacted throughout: machines `DEMO-*`, people at `example.com`.
 */

/* --------------------------------------------------------------- payloads */

/** The figures the real tenant last reported. */
const LIVE_STATS = {
  total: 213,
  patchCompliance: 0.86,
  checkedIn7d: 198,
  bitlockerEncrypted: 130,
  criticalPatchesMissing: 34,
};

const ATTENTION = [
  { computer: 'DEMO-LT-0412', assignedTo: 'a.user@example.com', os: 'Windows 11 23H2', issue: 'Agent stale · 34 days', issueKind: 'stale_agent', lastCheckIn: '2026-08-17T09:00:00.000Z' },
  { computer: 'DEMO-LT-0188', assignedTo: 'b.user@example.com', os: 'Windows 11 22H2', issue: '12 critical patches missing', issueKind: 'missing_patches', lastCheckIn: '2026-09-20T06:30:00.000Z' },
  { computer: 'DEMO-DT-0051', assignedTo: 'c.user@example.com', os: 'Windows 10 22H2', issue: 'BitLocker not enabled', issueKind: 'no_bitlocker', lastCheckIn: '2026-09-20T07:10:00.000Z' },
];

const SERVED_AT = '2026-09-20T08:00:00.000Z';

const body = (over: Record<string, unknown> = {}, stats: unknown = LIVE_STATS) => ({
  servedAt: SERVED_AT,
  result: { fetchedAt: SERVED_AT, degraded: false, data: { stats, attention: ATTENTION }, ...over },
});

/* ----------------------------------------------------------------- client */

const ok = (json: unknown): Fetched => ({ ok: true, json });
const fail = (message: string): Fetched => ({ ok: false, error: { code: 'unreachable', message } });
const pending = (): Promise<Fetched> => new Promise<Fetched>(() => {});

const clientOf = (answer: () => Promise<Fetched> | Fetched): ApiClient => ({
  get: async (path: ApiPath) => (path === '/api/endpoints' ? answer() : pending()),
  checks: async (serviceId) => fail(`no checks stub for ${serviceId}`),
});

const live = (answer: () => Promise<Fetched> | Fetched, children: ReactNode = <Endpoints />, intervalMs = 1_000_000) =>
  render(
    <MemoryRouter initialEntries={['/endpoints']}>
      <ThemeProvider>
        <DemoModeProvider>
          <LiveDataProvider client={clientOf(answer)} intervalMs={intervalMs}>
            {children}
          </LiveDataProvider>
        </DemoModeProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );

afterEach(() => vi.useRealTimers());

const stats = () => within(screen.getByTestId('endpoints-stats'));

/** One stat card, found by the label an operator reads. `StatCard` renders no
 *  testid of its own here, so the label's own element is walked back up to the
 *  card — which also means a card that stopped rendering its label fails loudly
 *  rather than silently matching nothing. */
const card = (label: string): HTMLElement => {
  const labelNode = stats().getByText(label);
  const el = labelNode.closest('div[style]')?.parentElement ?? labelNode.parentElement;
  expect(el, `no card around ${label}`).not.toBeNull();
  return el as HTMLElement;
};

const bodyRows = (name: string) =>
  within(within(screen.getByRole('region', { name })).getByRole('table')).getAllByRole('row').slice(1);

/* ------------------------------------------------------------ the parser */

describe('parseEndpoints', () => {
  it('reads the stats and attention rows a running server serves', () => {
    const parsed = parseEndpoints(body());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.value.stats.total).toBe(213);
    expect(parsed.value.value.stats.bitlockerEncrypted).toBe(130);
    expect(parsed.value.value.attention).toHaveLength(3);
  });

  it('refuses a payload missing any one stat rather than serving a zero for it', () => {
    const keys = Object.keys(LIVE_STATS);
    expect(keys).toHaveLength(5);
    for (const key of keys) {
      const { [key as keyof typeof LIVE_STATS]: _dropped, ...rest } = LIVE_STATS;
      expect(parseEndpoints(body({}, rest)).ok, `${key} absent`).toBe(false);
      expect(parseEndpoints(body({}, { ...LIVE_STATS, [key]: null })).ok, `${key} null`).toBe(false);
      expect(parseEndpoints(body({}, { ...LIVE_STATS, [key]: 'lots' })).ok, `${key} non-numeric`).toBe(false);
    }
  });

  it('keeps a stat that is genuinely zero', () => {
    const parsed = parseEndpoints(body({}, { ...LIVE_STATS, criticalPatchesMissing: 0, bitlockerEncrypted: 0 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.value.stats.criticalPatchesMissing).toBe(0);
    expect(parsed.value.value.stats.bitlockerEncrypted).toBe(0);
  });

  it('refuses an issueKind outside the contract rather than defaulting one', () => {
    // Nothing renders `issueKind` — and that is the argument FOR refusing it.
    // There is no honest default: `stale_agent` would mislabel a BitLocker
    // finding and `no_bitlocker` would invent an encryption problem, and an
    // invisible wrong value is worse than a visible one because nothing on
    // screen can contradict it.
    for (const issueKind of ['disk_full', undefined, 7]) {
      const row = { ...ATTENTION[0], ...(issueKind === undefined ? {} : { issueKind }) };
      if (issueKind === undefined) delete (row as Record<string, unknown>)['issueKind'];
      const payload = {
        servedAt: SERVED_AT,
        result: { fetchedAt: SERVED_AT, degraded: false, data: { stats: LIVE_STATS, attention: [row] } },
      };
      expect(parseEndpoints(payload).ok, String(issueKind)).toBe(false);
    }
    // The control: all four contract kinds are accepted, so the refusal above
    // is not a parser that rejects every row.
    for (const issueKind of ['stale_agent', 'missing_patches', 'no_bitlocker', 'eol_build']) {
      const payload = {
        servedAt: SERVED_AT,
        result: {
          fetchedAt: SERVED_AT,
          degraded: false,
          data: { stats: LIVE_STATS, attention: [{ ...ATTENTION[0], issueKind }] },
        },
      };
      expect(parseEndpoints(payload).ok, issueKind).toBe(true);
    }
  });

  it('reports "we could not look" in the server\'s own words, with no data', () => {
    const parsed = parseEndpoints({
      servedAt: SERVED_AT,
      result: { fetchedAt: SERVED_AT, degraded: true, error: { code: 'epc_read_failed', message: 'the BitLocker report could not be read' } },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message).toMatch(/BitLocker report/);
  });
});

/* ------------------------------------- the card this whole file is about */

describe('BitLocker is a count on the live path, never a share of the estate', () => {
  it('renders the count, and no fraction and no bar anywhere on that card', async () => {
    live(() => ok(body()));
    await screen.findByTestId('endpoints-stats');
    const bitlocker = card('BitLocker encrypted');

    // POSITIVE FIRST, and this is the assertion that carries the test: the card
    // renders the confirmed-encrypted COUNT, read off the payload by hand. An
    // absence claim alone would pass over a card that rendered nothing at all.
    expect(within(bitlocker).getByText('130')).toBeInTheDocument();
    expect(within(bitlocker).getByText('confirmed encrypted')).toBeInTheDocument();

    // Then the absences, as companions. `130 / 213` is the string that
    // announces 39% of the estate is unencrypted.
    expect(within(bitlocker).queryByText('130 / 213')).not.toBeInTheDocument();
    expect(within(bitlocker).queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('the other three cards DO still have bars — so the absence above means something', async () => {
    // The control. Without it, "no progressbar on the BitLocker card" passes
    // just as well over a page that renders no bars at all, or no cards, and
    // the test would certify the regression it exists to catch.
    live(() => ok(body()));
    await screen.findByTestId('endpoints-stats');
    for (const label of ['Patch compliance', 'Agents checked in (7d)', 'Critical patches missing']) {
      expect(within(card(label)).getByRole('progressbar'), label).toBeInTheDocument();
    }
    // Exactly three bars on the page, so a fourth reappearing is a failure
    // whichever card grows it.
    expect(screen.getAllByRole('progressbar')).toHaveLength(3);
  });

  it('says why the count is not a fraction, and quotes no denominator it was not given', async () => {
    live(() => ok(body()));
    expect(await screen.findByTestId('endpoints-bitlocker-basis')).toHaveTextContent(BITLOCKER_BASIS);
    // The 81 unscanned cannot be named: `EndpointSnapshot.stats` carries
    // `total` and `bitlockerEncrypted` and nothing else, and `total -
    // bitlockerEncrypted` is 83 — the 2 known-bad conflated with the 81
    // unknown, which is the error the whole line exists to refuse. So the
    // sentence must contain no number at all.
    expect(BITLOCKER_BASIS).not.toMatch(/\d/);
    expect(BITLOCKER_BASIS).toMatch(/inventory scan/);
  });

  it('the demo path keeps the fraction and the bar, because there it is true', () => {
    // 152 baselines photograph this, and in the fixture world every machine is
    // scanned — so the fraction is honest and the bar is a correct rendering of
    // data with no unknowns. Read off the fixture by hand.
    expect(fixtures.sev1.endpoints.stats.bitlockerEncrypted).toBe(576);
    expect(fixtures.sev1.endpoints.stats.total).toBe(612);
    render(
      <MemoryRouter initialEntries={['/endpoints?demo=sev1']}>
        <ThemeProvider>
          <DemoModeProvider>
            <Endpoints />
          </DemoModeProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    const bitlocker = card('BitLocker encrypted');
    expect(within(bitlocker).getByText('576 / 612')).toBeInTheDocument();
    expect(within(bitlocker).getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByTestId('endpoints-bitlocker-basis')).not.toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(4);
  });
});

/* ----------------------------------------------------------- the states */

describe('Endpoints · live · the four states', () => {
  it('loading says so, and shows no fleet at all', async () => {
    live(pending);
    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('endpoints-stats')).not.toBeInTheDocument();
    // And no fixture fleet standing in for a tenant nobody has read.
    expect(fixtures.sev1.endpoints.stats.total).toBe(612);
    expect(screen.queryByText(/612/)).not.toBeInTheDocument();
  });

  it('a failure is a failure, with no statistics behind it', async () => {
    live(() => ok({
      servedAt: SERVED_AT,
      result: { fetchedAt: SERVED_AT, degraded: true, error: { code: 'epc_read_failed', message: 'the agent inventory could not be read' } },
    }));
    expect(await screen.findByText(/Endpoints is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/agent inventory could not be read/)).toBeInTheDocument();
    expect(screen.queryByTestId('endpoints-stats')).not.toBeInTheDocument();
  });

  it('an empty attention list is a designed state, not a blank area', async () => {
    live(() => ok({
      servedAt: SERVED_AT,
      result: { fetchedAt: SERVED_AT, degraded: false, data: { stats: LIVE_STATS, attention: [] } },
    }));
    await screen.findByTestId('endpoints-stats');
    expect(screen.getByText('No endpoints need attention.')).toBeInTheDocument();
    // Still a read fleet: the stats are the evidence that we looked.
    expect(stats().getByText('130')).toBeInTheDocument();
  });

  it('a stale load keeps the fleet and says how old it is and why', async () => {
    live(() => ok(body({ degraded: true, error: { code: 'epc_partial', message: 'the patch summary could not be read' } })));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Endpoints data is/);
    expect(within(alert).getByTestId('panel-stale-reason')).toHaveTextContent('the patch summary could not be read');
    expect(stats().getByText('130')).toBeInTheDocument();
  });
});

describe('the heading count and the rows it counts cannot drift apart', () => {
  it('agrees across four shapes, live', async () => {
    for (const rows of [[], ATTENTION.slice(0, 1), ATTENTION.slice(0, 2), ATTENTION]) {
      const view = live(() => ok({
        servedAt: SERVED_AT,
        result: { fetchedAt: SERVED_AT, degraded: false, data: { stats: LIVE_STATS, attention: rows } },
      }));
      await screen.findByTestId('endpoints-stats');
      const painted = rows.length === 0 ? 0 : bodyRows('Needs attention').length;
      expect(painted, `${rows.length} rows`).toBe(rows.length);
      expect(
        within(screen.getByRole('region', { name: 'Needs attention' })).getByText(
          `${painted} device${painted === 1 ? '' : 's'}`,
        ),
      ).toBeInTheDocument();
      view.unmount();
    }
  });
});
