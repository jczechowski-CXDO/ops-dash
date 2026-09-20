import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import type { CheckRun, ServiceStatus } from '@ops-dash/shared';
import { fixtures, type DemoMode } from '../fixtures/index.js';
import ServiceDetail from './ServiceDetail.js';
import { serviceViewOf } from '../live/model.js';

/** The injected service goes in as a `ServiceStatus` and is widened by the same
 *  adapter the app uses. A hand-built `ServiceView` here would let the test pass
 *  over a shape `serviceViewOf` does not produce. */
const at = (
  id: string,
  mode: DemoMode = 'sev1',
  props: { service?: ServiceStatus; runs?: CheckRun[] } = {},
) =>
  render(
    <MemoryRouter initialEntries={[`/services/${id}?demo=${mode}`]}>
      <ThemeProvider><DemoModeProvider>
        <Routes>
          <Route
            path="/services/:id"
            element={
              <ServiceDetail
                {...(props.service ? { service: serviceViewOf(props.service) } : {})}
                {...(props.runs ? { runs: props.runs } : {})}
              />
            }
          />
        </Routes>
      </DemoModeProvider></ThemeProvider>
    </MemoryRouter>,
  );

/** The same service with its vendor poll removed / restored. `exactOptionalPropertyTypes`
 *  is on, so "absent" means the key is genuinely not there — not set to undefined. */
const withoutPoll = (s: ServiceStatus): ServiceStatus => {
  const { lastSuccessfulPoll: _dropped, ...vendor } = s.vendor;
  return { ...s, vendor };
};
const withPoll = (s: ServiceStatus, at_: string): ServiceStatus => ({
  ...s,
  vendor: { ...s.vendor, lastSuccessfulPoll: at_ },
});

/** Every (mode, service) pair the fixtures can render — fourteen shapes. The
 *  relationship tests below run over all of them rather than over the one or two
 *  where today's data happens to make both sides agree. */
const EVERY_SHAPE: { mode: DemoMode; id: string }[] = (['quiet', 'sev1'] as const).flatMap((mode) =>
  fixtures[mode].services.map((s) => ({ mode, id: s.id })),
);

const svc = (mode: DemoMode, id: string) => {
  const found = fixtures[mode].services.find((s) => s.id === id);
  if (!found) throw new Error(`test fixture lookup failed for ${mode}/${id}`);
  return found;
};

/** The check-history rows as an operator reads them: region and result, from the
 *  rendered cells rather than from the fixture the view was handed. */
const renderedChecks = (): { region: string; result: string }[] => {
  const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
  return rows.map((row) => {
    const cells = within(row).getAllByRole('cell');
    return { region: cells[2]?.textContent ?? '', result: cells[3]?.textContent ?? '' };
  });
};

describe('ServiceDetail', () => {
  it('shows the vendor claim and our probe result side by side', () => {
    at('m365');
    expect(screen.getByText('Vendor status page')).toBeInTheDocument();
    expect(screen.getByText('Our synthetic checks')).toBeInTheDocument();
    // amended at G1 — G-13: m365's vendor half is `unknown`, not `degraded`.
    // Our probes are ours and still fail, so only 'Failing' survives.
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Failing')).toBeInTheDocument();
  });

  it('lets the two halves disagree', () => {
    at('zendesk');
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Passing')).toBeInTheDocument();
  });

  it('explains an unknown vendor level rather than leaving it blank', () => {
    at('zendesk');
    expect(screen.getByText(/absence is not an affirmation/i)).toBeInTheDocument();
  });

  it('never paints an unknown vendor green', () => {
    at('zendesk');
    expect(screen.getByTestId('vendor-dot')).toHaveStyle({ background: 'var(--text-disabled)' });
    expect(screen.getByTestId('ours-dot')).toHaveStyle({ background: 'var(--success-main)' });
  });

  // The pairing this page exists for. Zendesk's feed WORKS and says nothing;
  // M365's feed has NEVER AUTHENTICATED. Both render 'Unknown', and an operator
  // who cannot tell them apart will chase the wrong one. The distinguishing fact
  // is `vendor.lastSuccessfulPoll` — present for Zendesk, absent for M365 — so
  // the assertion is the relationship over all fourteen shapes, not the two
  // sentences that happen to differ today.
  it('tells a feed that reports nothing apart from a feed that has never returned', () => {
    for (const shape of EVERY_SHAPE) {
      const { unmount } = at(shape.id, shape.mode);
      const polled = svc(shape.mode, shape.id).vendor.lastSuccessfulPoll !== undefined;
      const where = `${shape.mode}/${shape.id}`;

      expect(
        screen.queryByText(/Last successful poll/i) !== null,
        `${where} should ${polled ? '' : 'not '}quote a successful poll`,
      ).toBe(polled);
      expect(
        screen.queryByText(/No successful poll on record/i) !== null,
        `${where} should ${polled ? 'not ' : ''}say there is no poll on record`,
      ).toBe(!polled);

      unmount();
    }
  });

  it('renders the response-time chart with p50 and p95', () => {
    at('m365');
    expect(screen.getByText(/p50 .* · p95 /)).toBeInTheDocument();
    expect(screen.getByTestId('response-chart').querySelector('polyline')).toBeInTheDocument();
  });

  it('renders the four stat cards', () => {
    at('m365');
    for (const label of ['Uptime (30d)', 'Checks passing', 'Incidents (90d)', 'Last state change']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('99.21%')).toBeInTheDocument();
    expect(screen.getByText('1 / 4')).toBeInTheDocument();
  });

  it('derives the stat values from the fixture in both worlds', () => {
    for (const shape of EVERY_SHAPE) {
      const s = svc(shape.mode, shape.id);
      const { unmount } = at(shape.id, shape.mode);
      expect(screen.getByText(`${(s.uptime30d * 100).toFixed(2)}%`)).toBeInTheDocument();
      expect(screen.getByText(`${s.ours.passing} / ${s.ours.total}`)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders the check history table', () => {
    at('m365');
    for (const h of ['Time', 'Check', 'Region', 'Result', 'ms']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
  });

  // G1 caught a fixture where the prose named regions the rows did not. The view
  // renders those two from different sources — `ours.note` and `checkRunsFor` —
  // so it can re-open the same defect. Asserted as a relationship over all
  // fourteen shapes: a screen that shows a failing region our own summary does
  // not name is a screen that contradicts itself.
  it('never shows a failing region that our summary does not name', () => {
    for (const shape of EVERY_SHAPE) {
      const s = svc(shape.mode, shape.id);
      const { unmount } = at(shape.id, shape.mode);
      const failing = renderedChecks().filter((r) => r.result !== 'Pass');
      const where = `${shape.mode}/${shape.id}`;

      expect(failing.length > 0, `${where}: table and summary disagree on whether we are failing`)
        .toBe(s.ours.passing < s.ours.total);
      for (const row of failing) {
        expect(s.ours.note, `${where}: ${row.region} fails in the table but is unnamed in the note`)
          .toContain(row.region);
      }
      unmount();
    }
  });

  // G3 HIGH-1. The decoration rung and the text rung differ exactly where it
  // matters: the DOT beside 'Passing' may be --success-main (3:1 bar), the WORD
  // 'Pass' in the table may not (3.40:1 against a 4.5:1 bar). Asserted as the
  // contrast between the two, so collapsing them back to one rung fails.
  it('paints result words at text grade while dots stay decoration grade', () => {
    at('m365');
    expect(screen.getByTestId('ours-dot')).toHaveStyle({ background: 'var(--error-main)' });
    const cells = within(screen.getByRole('table')).getAllByRole('row').slice(1)
      .map((row) => within(row).getAllByRole('cell')[3]!.firstElementChild!);
    expect(cells.some((c) => c.textContent === 'Timeout')).toBe(true);
    expect(cells.some((c) => c.textContent === 'Pass')).toBe(true);
    for (const cell of cells) {
      const expected = cell.textContent === 'Pass' ? 'var(--success-dark)' : 'var(--error-dark)';
      expect(cell, `${cell.textContent} must use the text rung`).toHaveStyle({ color: expected });
    }
  });

  it('paints the checks-passing stat at text grade', () => {
    at('m365');
    expect(screen.getByText('1 / 4')).toHaveStyle({ color: 'var(--error-dark)' });
  });

  it('shows a state, not a blank page, for an unknown service id', () => {
    at('nope');
    expect(screen.getByText(/not a monitored service/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  // G3 HIGH-2. A route param naming a service we do not watch is an ordinary
  // navigation, not a source failure. Panel's error state means "we could not
  // read the feed" and paints red; using it here trains an operator to discount
  // red. The assertion is on the ABSENCE of the alert role, because that is the
  // part a later edit would quietly undo.
  it('does not cry wolf: an unknown id is an empty state, not a red error', () => {
    at('nope');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // The designed empty state, reachable only through the seam: `checkRunsFor` is
  // total but every one of the seven has rows today, so without an injected
  // empty list this branch would ship unrendered and unasserted.
  it('renders the designed empty state when a service has no check runs', () => {
    at('m365', 'sev1', { runs: [] });
    expect(screen.getByText(/No check runs recorded/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // The half-cards still render: an empty probe history is not an empty page.
    expect(screen.getByText('Vendor status page')).toBeInTheDocument();
  });
});

/**
 * G3 HIGH-3. The fourteen fixture shapes carry only two (id, hasPoll)
 * combinations — m365 without a poll, everything else with one — so a
 * provenance line derived from `vendor.lastSuccessfulPoll` and one derived from
 * `id === 'm365'` are the SAME FUNCTION over that data, and the fourteen-shape
 * test above cannot tell them apart. These two hold the id fixed and flip only
 * the field, which is the only way the distinction is observable.
 */
describe('ServiceDetail — provenance is derived from the field, not from the name', () => {
  it('says a poll succeeded for an m365 whose feed did return', () => {
    const m365 = fixtures.sev1.services.find((s) => s.id === 'm365')!;
    expect(m365.vendor.lastSuccessfulPoll, 'precondition: the fixture has no poll').toBeUndefined();

    at('m365', 'sev1', { service: withPoll(m365, new Date(Date.now() - 120_000).toISOString()) });

    expect(screen.getByText(/Last successful poll/i)).toBeInTheDocument();
    expect(screen.queryByText(/No successful poll on record/i)).not.toBeInTheDocument();
  });

  it('says no poll is on record for a non-m365 service whose feed never returned', () => {
    const zendesk = fixtures.sev1.services.find((s) => s.id === 'zendesk')!;
    expect(zendesk.vendor.lastSuccessfulPoll, 'precondition: the fixture has a poll').toBeDefined();

    at('zendesk', 'sev1', { service: withoutPoll(zendesk) });

    expect(screen.getByText(/No successful poll on record/i)).toBeInTheDocument();
    expect(screen.queryByText(/Last successful poll/i)).not.toBeInTheDocument();
  });
});
