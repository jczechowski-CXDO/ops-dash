import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ServiceStatus } from '@ops-dash/shared';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import { allOperational, isAffirmed } from '../theme/statusColor.js';
import { fixtures, type DemoMode } from '../fixtures/index.js';
import Overview, { alertSummary, listState, statusTally, stripOverline, tileLevel } from './Overview.js';

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
