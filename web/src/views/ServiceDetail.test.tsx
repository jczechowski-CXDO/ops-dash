import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import { fixtures, type DemoMode } from '../fixtures/index.js';
import ServiceDetail from './ServiceDetail.js';

const at = (id: string, mode: DemoMode = 'sev1') =>
  render(
    <MemoryRouter initialEntries={[`/services/${id}?demo=${mode}`]}>
      <ThemeProvider><DemoModeProvider>
        <Routes><Route path="/services/:id" element={<ServiceDetail />} /></Routes>
      </DemoModeProvider></ThemeProvider>
    </MemoryRouter>,
  );

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

  it('shows an error panel, not a blank page, for an unknown service id', () => {
    at('nope');
    expect(screen.getByRole('alert')).toHaveTextContent(/not a monitored service/i);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
