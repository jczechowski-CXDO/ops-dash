import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { EntraSnapshot } from '@ops-dash/shared';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import { fixtures, type DemoMode } from '../fixtures/index.js';
import Entra, { signedDelta } from './Entra.js';

/** The Wave 3 preamble helper, plus the two seams this task needs: a demo mode
 *  (the provider reads `?demo=`) and a constructed snapshot, so a relationship
 *  can be asserted over shapes the two fixtures do not happen to contain. */
const at = (opts: { mode?: DemoMode; snapshot?: Partial<EntraSnapshot> } = {}) => {
  const base = fixtures[opts.mode ?? 'sev1'].entra;
  const merged = opts.snapshot ? { ...base, ...opts.snapshot } : undefined;
  const path = opts.mode ? `/entra?demo=${opts.mode}` : '/entra';
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <DemoModeProvider>
          <Routes>
            <Route
              path="/entra"
              element={merged ? <Entra snapshot={merged} /> : <Entra />}
            />
          </Routes>
        </DemoModeProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
};

const stats = () => within(screen.getByTestId('entra-stats'));

/** Rows actually painted into a named section's table body. Each section is a
 *  labelled region, so the query names what an operator sees rather than an
 *  index into the DOM. */
const bodyRows = (name: string) =>
  within(within(screen.getByRole('region', { name })).getByRole('table'))
    .getAllByRole('row')
    .slice(1);

describe('Entra', () => {
  it('renders four stat cards with severity-tinted values', () => {
    at();
    // Scoped to the stat grid: '7' is also the Risky sign-ins COUNT cell in the
    // signals table, so an unscoped getByText matches two elements and throws.
    expect(stats().getByText('Risky sign-ins (24h)')).toBeInTheDocument();
    expect(stats().getByText('7')).toHaveStyle({ color: 'var(--error-main)' });
    expect(stats().getByText('3 confirmed compromised')).toBeInTheDocument();
    expect(stats().getByText('1,204')).toHaveStyle({ color: 'var(--warning-main)' });
    expect(stats().getByText('against 96 accounts')).toBeInTheDocument();
    expect(stats().getByText('11')).toHaveStyle({ color: 'var(--text-primary)' });
    expect(stats().getByText('4 Global Administrators')).toBeInTheDocument();
  });

  it('derives MFA coverage from the ratio rather than a hard-coded string', () => {
    at();
    expect(stats().getByText('94.3%')).toBeInTheDocument();
    expect(stats().getByText('29 users unregistered')).toBeInTheDocument();
  });

  it('shows the quiet world its own numbers, not the sev1 ones', () => {
    at({ mode: 'quiet' });
    expect(stats().getByText('96.1%')).toBeInTheDocument();
    expect(stats().getByText('84')).toBeInTheDocument();
    expect(stats().queryByText('1,204')).not.toBeInTheDocument();
  });

  it('tints risky sign-ins red only when a compromise is confirmed', () => {
    // The relationship, over four shapes, not two current values: red means
    // 'confirmed compromised', amber means 'seen but unconfirmed', and no risky
    // sign-in at all is not a warning.
    const shapes: { compromised: number; risky: number; expected: string }[] = [
      { compromised: 3, risky: 7, expected: 'var(--error-main)' },
      { compromised: 0, risky: 1, expected: 'var(--warning-main)' },
      { compromised: 0, risky: 0, expected: 'var(--text-primary)' },
      { compromised: 1, risky: 1, expected: 'var(--error-main)' },
    ];
    for (const shape of shapes) {
      const base = fixtures.sev1.entra;
      const { unmount } = at({
        snapshot: {
          stats: {
            ...base.stats,
            riskySignIns24h: shape.risky,
            riskyConfirmedCompromised: shape.compromised,
          },
        },
      });
      expect(stats().getByText(String(shape.risky))).toHaveStyle({ color: shape.expected });
      unmount();
    }
  });

  it('renders the signals table with a row per signal and signed deltas', () => {
    at();
    expect(screen.getByRole('columnheader', { name: '24h trend' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '+1,102' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '-2' })).toBeInTheDocument();
    // Plan defect: the plan asserts getByRole('cell', { name: '0' }), which
    // matches three cells in this fixture — ca_change's count and two zero
    // trends — and getBy* throws on multiple matches.
    expect(screen.getAllByRole('cell', { name: '0' })).toHaveLength(3);
  });

  it('formats every trend cell with the same signed formatter, in row order', () => {
    // Relationship over shapes rather than two spot values: whatever the deltas
    // are, the column is signedDelta of them, in order.
    for (const mode of ['sev1', 'quiet'] as const) {
      const { unmount } = at({ mode });
      const trends = bodyRows('Signals · last 24 hours').map(
        (r) => within(r).getAllByRole('cell')[2]?.textContent,
      );
      expect(trends).toEqual(fixtures[mode].entra.signals.map((s) => signedDelta(s.delta24h)));
      unmount();
    }
  });

  it('labels and tints severity through severityLabel / severityColor', () => {
    at();
    const risky = bodyRows('Signals · last 24 hours')[0]!;
    expect(within(risky).getByText('SEV 1')).toHaveStyle({ color: 'var(--error-main)' });
    expect(screen.getAllByText('INFO').length).toBeGreaterThan(0);
  });

  it('renders the directory audit table with redacted actors', () => {
    at();
    expect(screen.getByRole('columnheader', { name: 'Actor' })).toBeInTheDocument();
    expect(screen.getAllByText('j.hart@example.com').length).toBeGreaterThan(0);

    // Positive, not negative (lead's ruling): every actor this screen paints is
    // either 'System' or a documentation-domain address, and the column is the
    // snapshot's actors in order. Naming a forbidden domain here would both
    // duplicate the global redaction guard and trip it.
    const rows = bodyRows('Directory audit');
    const actors = rows.map((r) => within(r).getAllByRole('cell')[1]?.textContent ?? '');
    expect(actors).toEqual(fixtures.sev1.entra.audit.map((a) => a.actor));
    expect(actors.filter((a) => a !== 'System' && !a.endsWith('@example.com'))).toEqual([]);

    // Targets are a mix of role names and external addresses; any that is
    // address-shaped is a documentation domain too.
    const targets = rows.map((r) => within(r).getAllByRole('cell')[3]?.textContent ?? '');
    expect(targets.filter((t) => t.includes('@') && !/@example\.(com|net)$/.test(t))).toEqual([]);
  });

  it('says so when a directory change failed rather than rendering it as routine', () => {
    const base = fixtures.sev1.entra;
    at({
      snapshot: {
        audit: [
          {
            at: base.audit[0]!.at,
            actor: 'j.hart@example.com',
            action: 'Add member to role',
            target: 'Helpdesk Administrator',
            result: 'failure',
          },
        ],
      },
    });
    expect(screen.getByText('failed')).toHaveStyle({ color: 'var(--error-main)' });
  });

  it('keeps each heading count equal to the rows beneath it', () => {
    const base = fixtures.sev1.entra;
    const shapes: Partial<EntraSnapshot>[] = [
      {},
      { signals: base.signals.slice(0, 1) },
      { audit: base.audit.slice(0, 2) },
      { signals: [] },
    ];
    for (const shape of shapes) {
      const merged = { ...base, ...shape };
      const { unmount } = at({ snapshot: shape });
      const signalsMeta = merged.signals.length === 1 ? '1 signal' : `${merged.signals.length} signals`;
      expect(screen.getByText(signalsMeta)).toBeInTheDocument();
      expect(merged.signals.length === 0 ? [] : bodyRows('Signals · last 24 hours')).toHaveLength(
        merged.signals.length,
      );
      const auditMeta = merged.audit.length === 1 ? '1 event' : `${merged.audit.length} events`;
      expect(screen.getByText(auditMeta)).toBeInTheDocument();
      unmount();
    }
  });

  it('shows a designed empty state rather than a blank area', () => {
    at({ snapshot: { signals: [], audit: [] } });
    expect(screen.getByText(/No signals in the last 24 hours/)).toBeInTheDocument();
    expect(screen.getByText(/No directory changes recorded/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('keeps the view testid the shell asserts', () => {
    at();
    expect(screen.getByTestId('view-entra')).toBeInTheDocument();
  });
});

describe('signedDelta', () => {
  it('signs rises, keeps the minus on falls and never signs zero', () => {
    expect(signedDelta(1102)).toBe('+1,102');
    expect(signedDelta(4)).toBe('+4');
    expect(signedDelta(-2)).toBe('-2');
    expect(signedDelta(-1102)).toBe('-1,102');
    expect(signedDelta(0)).toBe('0');
  });
});
