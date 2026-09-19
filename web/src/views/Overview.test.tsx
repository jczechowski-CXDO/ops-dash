import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ServiceStatus } from '@ops-dash/shared';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import {
  allOperational,
  isAffirmed,
  severityFillColor,
  severityLabel,
  severityOnFillColor,
  statusColor,
} from '../theme/statusColor.js';
import { fixtures, type DemoMode } from '../fixtures/index.js';
import Overview, {
  StatusStrip,
  alertSummary,
  listState,
  statusPhrase,
  statusTally,
  stripOverline,
  tileLevel,
} from './Overview.js';

/**
 * PLAN DEFECT (Task 7 Step 1). The plan's helper renders `<Overview />` alone and
 * then selects the quiet world with `fireEvent.click(getByRole('button', {name:
 * 'Quiet'}))`. That button is the sidebar's segmented control, which this tree
 * does not render — the query throws. It is also gated by `DEMO_TOGGLE_VISIBLE`,
 * so it does not exist in a production build at all. `?demo=` is the documented
 * selector that works in every build (DemoModeProvider), so the mode is chosen
 * on the initial entry instead.
 */
const at = (mode: DemoMode = 'sev1') =>
  render(
    <MemoryRouter initialEntries={[`/?demo=${mode}`]}>
      <ThemeProvider>
        <DemoModeProvider>
          <Overview />
        </DemoModeProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );

const sev1 = fixtures.sev1;
const quiet = fixtures.quiet;

/** Four differently-shaped service lists, for the relationship assertions below.
 *  The two real fixtures, one constructed all-affirmed world (which no fixture
 *  can ever be — see amendment 1), and the empty list. Redaction is inherited:
 *  every one of these is built from the fixtures, never hand-written. */
const allAffirmed: ServiceStatus[] = quiet.services.map((s) => ({
  ...s,
  vendor: { ...s.vendor, level: 'operational' as const, label: 'Operational' },
  ours: { ...s.ours, level: 'operational' as const, label: 'Passing' },
}));
const shapes: { name: string; services: ServiceStatus[] }[] = [
  { name: 'quiet', services: quiet.services },
  { name: 'sev1', services: sev1.services },
  { name: 'constructed all-affirmed', services: allAffirmed },
  { name: 'empty', services: [] },
];

describe('Overview — sev1 (the default)', () => {
  it('renders one tile per verified service', () => {
    at();
    expect(screen.getAllByTestId('service-tile')).toHaveLength(7);
  });

  it('gives each tile a sparkline drawn from the raw samples', () => {
    at();
    expect(screen.getAllByTestId('service-tile')[0]?.querySelector('polyline')).toBeInTheDocument();
  });

  it('lists the five open incidents with their severity chips', () => {
    at();
    // amended at G1 — G-13: two Sev1s now. getByText THROWS on multiple matches,
    // so this must be getAllByText — it would not merely fail, it would error.
    expect(screen.getAllByText('SEV 1')).toHaveLength(2);
    expect(screen.getAllByText('SEV 2')).toHaveLength(2);
    expect(screen.getByText('SEV 3')).toBeInTheDocument();
  });

  it('links an alert title to its incident', () => {
    at();
    expect(screen.getByRole('link', { name: 'Exchange Online mail delivery delays' }))
      .toHaveAttribute('href', '/incidents/INC-2291');
  });

  it('dims an acknowledged row, credits the actor, and keeps the row in place', () => {
    at();
    const before = screen.getAllByTestId('alert-row').length;
    const row = screen.getAllByTestId('alert-row')[0]!;
    fireEvent.click(within(row).getByRole('button', { name: 'Acknowledge' }));
    expect(screen.getAllByTestId('alert-row')).toHaveLength(before);
    expect(screen.getAllByTestId('alert-row')[0]).toHaveStyle({ opacity: '0.45' });
    expect(screen.getAllByTestId('alert-row')[0]).toHaveTextContent('Acknowledged by John H.');
    expect(within(screen.getAllByTestId('alert-row')[0]!).getByRole('button', { name: 'Acknowledged' })).toBeInTheDocument();
  });

  it('flips Mute to Unmute', () => {
    at();
    const row = screen.getAllByTestId('alert-row')[1]!;
    fireEvent.click(within(row).getByRole('button', { name: 'Mute' }));
    expect(within(screen.getAllByTestId('alert-row')[1]!).getByRole('button', { name: 'Unmute' })).toBeInTheDocument();
  });

  it('resolving also acknowledges', () => {
    at();
    const row = screen.getAllByTestId('alert-row')[3]!;
    fireEvent.click(within(row).getByRole('button', { name: 'Resolve' }));
    const after = screen.getAllByTestId('alert-row')[3]!;
    expect(after).toHaveTextContent('Resolved by John H.');
    expect(within(after).getByRole('button', { name: 'Acknowledged' })).toBeInTheDocument();
  });

  it('never claims all systems operational while a service is unknown', () => {
    at();
    expect(screen.queryByText(/ALL SYSTEMS OPERATIONAL/i)).not.toBeInTheDocument();
  });
});

describe('Overview — quiet', () => {
  it('shows the status strip with its overline and one pill per service', () => {
    at('quiet');
    // amended at G1 — G-13: quiet is no longer all-green and never can be.
    // Zendesk's SSP publishes no per-service status, and M365 Service Health
    // consent is pending, so both are affirmatively `unknown` in BOTH worlds.
    // Per the rule twelve lines above, the overline is not rendered at all when
    // any service is unknown; the strip leads with the affirmed/unknown split.
    expect(screen.queryByText(/ALL SYSTEMS OPERATIONAL/i)).not.toBeInTheDocument();
    expect(screen.getByText(/5 AFFIRMED/i)).toBeInTheDocument();
    expect(screen.getByText(/2 UNKNOWN/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('service-pill')).toHaveLength(7);
  });

  it('links a pill to its service page', () => {
    at('quiet');
    expect(screen.getAllByTestId('service-pill')[0]).toHaveAttribute('href', '/services/m365');
  });

  it('shows the empty state, counting seven services rather than ten', () => {
    at('quiet');
    expect(screen.getByText('No active incidents')).toBeInTheDocument();
    expect(screen.getByText(/Seven monitored services/)).toBeInTheDocument();
  });

  it('shows the recent-history table with its five closed incidents', () => {
    at('quiet');
    expect(screen.getByRole('columnheader', { name: 'Incident' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'INC-2284' })).toBeInTheDocument();
  });

  it('shows no tiles and no alert rows', () => {
    at('quiet');
    expect(screen.queryAllByTestId('service-tile')).toHaveLength(0);
    expect(screen.queryAllByTestId('alert-row')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The relationships, asserted over several shapes rather than today's two values
// ---------------------------------------------------------------------------

describe('the strip overline and the health verdict cannot diverge', () => {
  it.each(shapes)('$name: the overline is the all-clear exactly when allOperational is', ({ services }) => {
    expect(stripOverline(services) === 'ALL SYSTEMS OPERATIONAL').toBe(allOperational(services));
  });

  it.each(shapes)('$name: the AFFIRMED count is the number of services isAffirmed accepts', ({ services }) => {
    expect(statusTally(services).affirmed).toBe(services.filter(isAffirmed).length);
  });

  it.each(shapes)('$name: the three buckets partition the service list', ({ services }) => {
    const t = statusTally(services);
    expect(t.affirmed + t.unknown + t.other).toBe(services.length);
    expect(Math.min(t.affirmed, t.unknown, t.other)).toBeGreaterThanOrEqual(0);
  });

  it('spells the split the strip actually shows, from the quiet fixture', () => {
    expect(stripOverline(quiet.services)).toBe('5 AFFIRMED · 2 UNKNOWN');
  });

  it('reaches the all-clear only in a world where every service is affirmed', () => {
    expect(stripOverline(allAffirmed)).toBe('ALL SYSTEMS OPERATIONAL');
  });
});

describe('a tile reads green exactly when the service is affirmed', () => {
  it.each(shapes)('$name: tileLevel is operational iff isAffirmed', ({ services }) => {
    for (const s of services) {
      expect(tileLevel(s) === 'operational').toBe(isAffirmed(s));
    }
  });

  it('paints the two unknown services with the disabled grey, never green', () => {
    at();
    const tiles = screen.getAllByTestId('service-tile');
    // m365 is vendor-unknown with our probes failing; the worse half wins, so it
    // is the error token. zendesk is unknown on the vendor half with our probes
    // passing — the case amendment 1 exists for, and the one that must not be green.
    const zendesk = tiles[sev1.services.findIndex((s) => s.id === 'zendesk')]!;
    expect(within(zendesk).getByTestId('tile-dot')).toHaveStyle({ background: 'var(--text-disabled)' });
    expect(within(zendesk).getByTestId('tile-dot')).not.toHaveStyle({ background: 'var(--success-main)' });
  });
});

describe('the alert summary counts the rows it summarises', () => {
  // Four differently-shaped lists, because a string hard-coded to today's five
  // incidents satisfies any assertion made only against today's five incidents.
  const lists = [
    { name: 'none open', open: [], expected: '0 open · 0 Sev1 · 0 Sev2 · 0 Sev3' },
    { name: 'one Sev1', open: sev1.incidents.slice(0, 1), expected: '1 open · 1 Sev1 · 0 Sev2 · 0 Sev3' },
    { name: 'two Sev1 and a Sev2', open: sev1.incidents.slice(0, 3), expected: '3 open · 2 Sev1 · 1 Sev2 · 0 Sev3' },
    { name: 'all five', open: sev1.incidents, expected: '5 open · 2 Sev1 · 2 Sev2 · 1 Sev3' },
  ];

  it.each(lists)('$name: the line states what the list contains', ({ open, expected }) => {
    expect(alertSummary(open)).toBe(expected);
  });

  it('states the open total and the per-severity split from the list itself', () => {
    at();
    const rows = screen.getAllByTestId('alert-row').length;
    const n = (sev: 1 | 2 | 3) => sev1.incidents.filter((i) => i.severity === sev).length;
    expect(rows).toBe(sev1.incidents.length);
    expect(screen.getByTestId('alert-summary')).toHaveTextContent(
      `${rows} open · ${n(1)} Sev1 · ${n(2)} Sev2 · ${n(3)} Sev3`,
    );
    // and it is the same function, not a second copy that happens to agree
    expect(screen.getByTestId('alert-summary').textContent).toBe(alertSummary(sev1.incidents));
  });

  it('keeps summarising the same number of rows after one is acknowledged', () => {
    at();
    const summary = screen.getByTestId('alert-summary').textContent;
    fireEvent.click(within(screen.getAllByTestId('alert-row')[0]!).getByRole('button', { name: 'Acknowledge' }));
    // The product decision: acknowledging must not hide work, so neither the
    // rows nor the count they are summarised by may move.
    expect(screen.getAllByTestId('alert-row')).toHaveLength(sev1.incidents.length);
    expect(screen.getByTestId('alert-summary').textContent).toBe(summary);
  });
});

describe('L-12: the row\'s click target is the title, not the card', () => {
  it('exposes exactly the three action buttons, with no button wrapping them', () => {
    at();
    const row = screen.getAllByTestId('alert-row')[0]!;
    // A `Card` with onClick takes role="button", which would make this four and
    // would nest three interactive children inside a control. The title is a
    // link instead, so an assistive-technology user gets a link and three
    // buttons rather than a button containing three buttons.
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Acknowledge',
      'Mute',
      'Resolve',
    ]);
    expect(within(row).getByRole('link')).toHaveAttribute('href', '/incidents/INC-2292');
  });
});

describe('both Sev1 stories read correctly', () => {
  it('shows the vendor-correlated one as vendor-corroborated', () => {
    at();
    const row = screen.getAllByTestId('alert-row')[0]!;
    expect(row).toHaveTextContent('Proofpoint filtering degraded — inbound mail delayed at the gateway');
    expect(row).toHaveTextContent('advisory hs-8841');
  });

  it('shows the hand-opened one as having no vendor signal at all', () => {
    at();
    const row = screen.getAllByTestId('alert-row')[1]!;
    expect(row).toHaveTextContent('Exchange Online mail delivery delays');
    expect(row).toHaveTextContent('no vendor signal');
    expect(row).not.toHaveTextContent(/advisory/i);
  });
});

describe('the quiet empty state does not overclaim', () => {
  it('names the affirmed count rather than calling all seven healthy', () => {
    at('quiet');
    const card = screen.getByTestId('no-incidents');
    const affirmed = quiet.services.filter(isAffirmed).length;
    const unaffirmed = quiet.services.length - affirmed;
    expect(card).toHaveTextContent(`Seven monitored services, five reporting healthy`);
    expect(card).toHaveTextContent(`two cannot be affirmed`);
    // The words above are only correct because these are the numbers. If a
    // service flips, the derived sentence changes and this fails with it.
    expect(affirmed).toBe(5);
    expect(unaffirmed).toBe(2);
    expect(card).not.toHaveTextContent(/seven monitored services reporting healthy/i);
  });

  it('quotes the last closed incident from the history fixture', () => {
    at('quiet');
    expect(screen.getByTestId('no-incidents')).toHaveTextContent(
      `Last incident closed ${quiet.recentHistory[0]!.closed}.`,
    );
  });
});

describe('the recent-history table renders the fixture fields, not the prototype names', () => {
  it('shows every row with its duration and closed date (defect G-4)', () => {
    at('quiet');
    for (const row of quiet.recentHistory) {
      expect(screen.getByRole('cell', { name: row.id })).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: row.title })).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: row.duration })).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: row.closed })).toBeInTheDocument();
    }
  });
});

describe('an empty list is a designed state, not a blank area', () => {
  it('asks Panel for an empty state when there is nothing to list', () => {
    expect(listState(0, 'nothing here')).toEqual({ kind: 'empty', message: 'nothing here' });
  });

  it('asks Panel for the ready state when there is', () => {
    expect(listState(3, 'nothing here')).toEqual({ kind: 'ready' });
  });
});

// ---------------------------------------------------------------------------
// G3: colour is never the sole carrier of meaning
// ---------------------------------------------------------------------------

describe('a strip pill announces its status, not just its name', () => {
  it('reads the service and its state as one phrase, for every pill', () => {
    at('quiet');
    const pills = screen.getAllByTestId('service-pill');
    expect(pills).toHaveLength(quiet.services.length);
    // Every pill, derived — not the two interesting ones. A pill whose dot said
    // one thing and whose text said another would fail here.
    pills.forEach((pill, i) => {
      const s = quiet.services[i]!;
      expect(pill).toHaveTextContent(`${s.short}, ${statusPhrase(tileLevel(s))}`);
    });
  });

  it('names WHICH services are the unknown ones the overline only counts', () => {
    at('quiet');
    // The group overline says "2 UNKNOWN". Without this, that is all a
    // screen-reader user ever learns: two of seven, and no way to find out which.
    const unknown = screen
      .getAllByTestId('service-pill')
      .filter((p) => p.textContent?.includes('status unknown'));
    expect(unknown.map((p) => p.getAttribute('href'))).toEqual(['/services/m365', '/services/zendesk']);
    expect(unknown).toHaveLength(statusTally(quiet.services).unknown);
  });

  it('puts the status in text, not in the dot, and leaves the dot --main', () => {
    at('quiet');
    const pill = screen.getAllByTestId('service-pill')[0]!;
    // The ruling was explicitly NOT to darken the dot.
    expect(within(pill).getByTestId('pill-dot')).toHaveStyle({ background: 'var(--text-disabled)' });
    // Visually hidden, still announced: clip-path, never display:none, which
    // would take it back out of the accessibility tree.
    const hidden = pill.querySelector('span[style*="clip-path"]');
    expect(hidden).toHaveTextContent('status unknown');
    expect(pill.querySelector('span[style*="display: none"]')).toBeNull();
  });
});

describe('the announced phrase cannot drift from the colour beside it', () => {
  // Both worlds, as asked: quiet and sev1 put different levels on the pills, and
  // sev1 reaches degraded, outage and maintenance, which quiet never does.
  it.each(shapes)('$name: a phrase reading "operational" means exactly isAffirmed', ({ services }) => {
    for (const s of services) {
      expect(statusPhrase(tileLevel(s)) === 'operational').toBe(isAffirmed(s));
    }
  });

  it.each(shapes)('$name: every service gets a non-empty phrase', ({ services }) => {
    for (const s of services) {
      expect(statusPhrase(tileLevel(s)).trim().length).toBeGreaterThan(0);
    }
  });

  /**
   * Read off the fixtures by hand, NOT computed with `tileLevel` — an expectation
   * derived by calling the function under test agrees with any level that
   * function picks, which is how "announce the vendor half only" passed the first
   * version of this suite. Each line below is a claim about both halves:
   * m365 is vendor-`unknown` with our probes failing and must announce OUR
   * failure, not the vendor's silence; zendesk is vendor-`unknown` with our
   * probes passing and must announce the silence; helpjuice is announced
   * maintenance with everything green; proofpoint is vendor-degraded with our
   * probes failing.
   */
  const SEV1_ANNOUNCED: [string, string][] = [
    ['Microsoft 365', 'not responding'],
    ['Proofpoint', 'not responding'],
    ['Jira', 'operational'],
    ['Zendesk', 'status unknown'],
    ['Helpjuice', 'in scheduled maintenance'],
    ['Claude', 'operational'],
    ['OpenAI', 'operational'],
  ];

  it('announces the worse of the two halves, rendered over the sev1 list', () => {
    render(
      <MemoryRouter>
        <StatusStrip services={sev1.services} />
      </MemoryRouter>,
    );
    const pills = screen.getAllByTestId('service-pill');
    expect(pills).toHaveLength(SEV1_ANNOUNCED.length);
    pills.forEach((pill, i) => {
      const [name, phrase] = SEV1_ANNOUNCED[i]!;
      expect(pill).toHaveTextContent(`${name}, ${phrase}`);
    });
  });

  it('announces the same phrases the quiet page renders, over the quiet list', () => {
    render(
      <MemoryRouter>
        <StatusStrip services={quiet.services} />
      </MemoryRouter>,
    );
    // Quiet differs from sev1 on exactly the four services whose halves differ.
    expect(screen.getAllByTestId('service-pill').map((p) => p.textContent)).toEqual([
      'Microsoft 365, status unknown',
      'Proofpoint, operational',
      'Jira, operational',
      'Zendesk, status unknown',
      'Helpjuice, operational',
      'Claude, operational',
      'OpenAI, operational',
    ]);
  });
});

describe('the severity chip is painted from the published fill-grade rungs', () => {
  /**
   * Asserted POSITIVELY, per the lead's G3 ruling, and over every chip the page
   * renders rather than the first one.
   *
   * The earlier version of this test asserted the chip was "not white" — twice,
   * once naming the hex (which tripped the repository's no-literal-hex guard,
   * because it greps tests too) and once as "contains no #". Both were the wrong
   * shape for the same reason: they permit every other wrong colour, and they
   * would keep passing if the contrast token were swapped for something
   * unreadable. Equality with the published function permits exactly one value.
   * Duplicating the guard's job in an assertion is also strictly worse than the
   * guard, which covers the whole tree.
   */
  it.each([1, 2, 3] as const)('SEV %i fills with severityFillColor and writes with severityOnFillColor', (sev) => {
    at();
    const chips = screen.getAllByText(severityLabel(sev));
    expect(chips).toHaveLength(sev1.incidents.filter((i) => i.severity === sev).length);
    for (const chip of chips) {
      expect(chip).toHaveStyle({
        background: severityFillColor(sev),
        color: severityOnFillColor(sev),
      });
    }
  });

  it('puts the chip on the -dark rung and its word on the theme-aware -contrast token', () => {
    at();
    // The concrete pin behind the equalities above: if severityFillColor were
    // moved back to the -main rung, the assertions above would still pass
    // (they compare the chip to whatever the function now returns) and this
    // would not. The pair is the guard; either alone is not.
    expect(screen.getAllByText('SEV 1')[0]!).toHaveStyle({
      background: 'var(--error-dark)',
      color: 'var(--error-contrast)',
    });
  });

  it('leaves the row accent on --main, which is the rung that grade is for', () => {
    at();
    // The row IS the Card now (the testid moved onto it at 37cea35), so the
    // accent is on the row element itself rather than on its first child.
    const row = screen.getAllByTestId('alert-row')[0]!;
    expect(row).toHaveStyle({ borderLeft: '3px solid var(--error-main)' });
  });
});

// ---------------------------------------------------------------------------
// The acknowledged/muted branch, reached from the DATA and not from a click
// ---------------------------------------------------------------------------

describe('a row acknowledged in the fixture renders acknowledged, with no interaction', () => {
  /** INC-2286 (sev3) carries `ack`, INC-2288 carries `muted` — landed by
   *  ops-fixtures at f1feaab for M-9. Both are read from the bundle rather than
   *  named here, so this fails if the fixture drops them rather than passing
   *  over a state nothing produces. */
  const acked = sev1.incidents.find((i) => i.ack)!;
  const mutedIncident = sev1.incidents.find((i) => i.muted)!;
  const rowOf = (id: string) =>
    screen.getAllByTestId('alert-row')[sev1.incidents.findIndex((i) => i.id === id)]!;

  it('the fixture actually carries an acknowledged and a muted incident', () => {
    // If M-9 is ever reverted, this says so in one line instead of leaving the
    // assertions below vacuously true over an empty find().
    expect(acked?.ack?.by).toBeTruthy();
    expect(mutedIncident?.muted).toBeTruthy();
    expect(acked.id).not.toBe(mutedIncident.id);
  });

  it('dims it and credits the actor the DATA names, not the one at the keyboard', () => {
    at();
    const row = rowOf(acked.id);
    expect(row).toHaveStyle({ opacity: '0.45' });
    expect(row).toHaveTextContent(`Acknowledged by ${acked.ack!.by}`);
    // The whole point of the ruling: this row was acknowledged by someone else.
    expect(row).not.toHaveTextContent('Acknowledged by John H.');
    expect(within(row).getByRole('button', { name: 'Acknowledged' })).toBeInTheDocument();
  });

  it('shows a muted row as muted, offering Unmute, from the data alone', () => {
    at();
    const row = rowOf(mutedIncident.id);
    expect(row).toHaveStyle({ opacity: '0.45' });
    expect(within(row).getByRole('button', { name: 'Unmute' })).toBeInTheDocument();
  });

  it('keeps an acknowledged incident open, counted and in place', () => {
    at();
    // README's product decision, now reachable without clicking: acknowledging
    // must not hide work. The summary, the row count and the order are unmoved.
    expect(screen.getAllByTestId('alert-row')).toHaveLength(sev1.incidents.length);
    expect(screen.getByTestId('alert-summary')).toHaveTextContent(alertSummary(sev1.incidents));
  });

  it('dims exactly the rows the data marks, and no others', () => {
    at();
    const dimmed = screen
      .getAllByTestId('alert-row')
      .map((r) => r.style.opacity === '0.45');
    // The relationship, over all five rows rather than the two interesting ones.
    expect(dimmed).toEqual(sev1.incidents.map((i) => Boolean(i.ack || i.muted || i.resolvedAt)));
  });

  it('still credits the local actor when the acknowledgement happens here', () => {
    at();
    // The other direction of `incident.ack?.by ?? ACTOR`: INC-2292 carries no
    // ack, so clicking it must credit the person at the keyboard.
    const row = screen.getAllByTestId('alert-row')[0]!;
    expect(sev1.incidents[0]!.ack).toBeUndefined();
    fireEvent.click(within(row).getByRole('button', { name: 'Acknowledge' }));
    expect(screen.getAllByTestId('alert-row')[0]!).toHaveTextContent('Acknowledged by John H.');
  });
});

describe('the testid hangs on the Card itself, not on a wrapper', () => {
  it('makes each tile the grid item, carrying the card recipe directly', () => {
    at();
    // Task 10A photographs structure: with a wrapper, minmax()/gap applied to a
    // box the Card did not control. The element the test selects must be the
    // element that carries the border and the radius.
    // Not the `border` shorthand: every tile also carries the 3px status accent
    // on borderLeft, so the shorthand is deliberately not uniform.
    screen.getAllByTestId('service-tile').forEach((tile, i) => {
      expect(tile).toHaveStyle({
        borderRadius: '12px',
        background: 'var(--background-paper)',
        borderLeft: `3px solid ${statusColor(tileLevel(sev1.services[i]!))}`,
      });
    });
    expect(screen.getAllByTestId('alert-row')[0]).toHaveStyle({ borderRadius: '12px' });
  });
});
