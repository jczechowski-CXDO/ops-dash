import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import { fixtures, serviceById, type DemoMode } from '../fixtures/index.js';
import IncidentDetail from './IncidentDetail.js';

const at = (id: string, mode: DemoMode = 'sev1') =>
  render(
    <MemoryRouter initialEntries={[`/incidents/${id}?demo=${mode}`]}>
      <ThemeProvider><DemoModeProvider>
        <Routes><Route path="/incidents/:id" element={<IncidentDetail />} /></Routes>
      </DemoModeProvider></ThemeProvider>
    </MemoryRouter>,
  );

const LEVEL_COLOR = {
  normal: 'var(--text-primary)',
  warning: 'var(--warning-main)',
  error: 'var(--error-main)',
} as const;

describe('IncidentDetail', () => {
  it('renders the hero with severity, id, title and summary', () => {
    at('INC-2291');
    expect(screen.getByText('SEV 1')).toBeInTheDocument();
    expect(screen.getByText('INC-2291')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Exchange Online mail delivery delays' })).toBeInTheDocument();
    // amended at G1 — G-13: EX1084221 is GONE from the fixtures and a test pins
    // its absence. We cannot read M365's vendor feed, so the advisory id could
    // never legitimately appear on this screen. Assert the absence instead.
    // Scoped to the hero: the plan's unscoped query matches twice, because the
    // timeline says the same thing in its own entry. Both matter, so both are
    // asserted, and neither is allowed to be the only one.
    const hero = within(screen.getByTestId('incident-hero'));
    expect(hero.getByText(/no vendor signal|Service Health consent/i)).toBeInTheDocument();
    expect(screen.getByText('No vendor statement available')).toBeInTheDocument();
    expect(screen.queryByText(/EX1084221/)).not.toBeInTheDocument();
  });

  it('says when the incident opened and how long it has been running', () => {
    at('INC-2291');
    // SEV1_OPENED_MINUTES_AGO is 83, so the elapsed span reads '1h 23m'.
    expect(screen.getByText(/^Opened \d\d:\d\d · 1h 23m elapsed$/)).toBeInTheDocument();
  });

  it('renders four blast-radius metrics tinted by level', () => {
    at('INC-2291');
    expect(screen.getAllByTestId('blast-metric')).toHaveLength(4);
    expect(screen.getByText('384')).toHaveStyle({ color: 'var(--error-main)' });
    expect(screen.getByText('18m 40s')).toHaveStyle({ color: 'var(--warning-main)' });
  });

  // One metric tinted right on one incident proves one mapping. The claim the
  // name makes is that the tint FOLLOWS the level, so it is asserted over every
  // metric of every incident — thirteen metrics across four levels of nesting.
  it('tints every blast metric from its own level, on every incident', () => {
    for (const inc of fixtures.sev1.incidents) {
      const { unmount } = at(inc.id);
      const cards = screen.getAllByTestId('blast-metric');
      expect(cards, `${inc.id}: one card per metric`).toHaveLength(inc.blastRadius.length);
      inc.blastRadius.forEach((metric, i) => {
        const card = cards[i]!;
        expect(within(card).getByText(metric.label)).toBeInTheDocument();
        expect(within(card).getByText(metric.note)).toBeInTheDocument();
        expect(within(card).getByText(metric.value), `${inc.id}/${metric.label}`)
          .toHaveStyle({ color: LEVEL_COLOR[metric.level] });
      });
      unmount();
    }
  });

  it('renders the timeline newest first with kind-coloured dots', () => {
    at('INC-2291');
    const rows = screen.getAllByTestId('timeline-row');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('Queue drain started');
    expect(rows[4]).toHaveTextContent('Incident opened');
    expect(rows[4]!.querySelector('[data-testid="timeline-dot"]')).toHaveStyle({ background: 'var(--text-secondary)' });
  });

  // 'Newest first' is a property of the rendered order AND of the contract's
  // ordering of `timeline`. Asserting only that row 0 is 'Queue drain started'
  // would survive a view that sorted ascending on a fixture that happened to be
  // stored ascending. Both halves, over every incident.
  it('renders the timeline in the order the contract stores it, which is newest first', () => {
    for (const inc of fixtures.sev1.incidents) {
      const { unmount } = at(inc.id);
      const rows = screen.getAllByTestId('timeline-row');
      expect(rows, `${inc.id}: one row per entry`).toHaveLength(inc.timeline.length);
      inc.timeline.forEach((entry, i) => {
        expect(rows[i], `${inc.id}: row ${i}`).toHaveTextContent(entry.title);
      });
      const times = inc.timeline.map((e) => new Date(e.at).getTime());
      expect([...times].sort((a, b) => b - a), `${inc.id}: fixture order is newest first`).toEqual(times);
      unmount();
    }
  });

  it('flips the three action labels', () => {
    at('INC-2291');
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(screen.getByRole('button', { name: 'Acknowledged by you' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mute service' }));
    expect(screen.getByRole('button', { name: 'Unmute service' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
    expect(screen.getByRole('button', { name: 'Resolved' })).toBeInTheDocument();
  });

  // LOW, carried from G0: nothing in the type system links `Incident.serviceId`
  // to a `ServiceStatus.id`, and INC-2288 belongs to Endpoint Central, which has
  // no tile. A link there would land on Service detail's not-found panel, so the
  // link exists exactly when the target does.
  it('links to the affected service only when that service has a page', () => {
    for (const inc of fixtures.sev1.incidents) {
      const { unmount } = at(inc.id);
      const target = serviceById('sev1', inc.serviceId);
      const link = screen.queryByTestId('affected-service-link');
      if (target) {
        expect(link, `${inc.id} -> ${inc.serviceId}`).toHaveAttribute('href', `/services/${target.id}`);
        expect(link).toHaveTextContent(target.name);
      } else {
        expect(link, `${inc.id} -> ${inc.serviceId} has no tile`).toBeNull();
        expect(screen.getByTestId('affected-service')).toHaveTextContent(inc.serviceId);
      }
      unmount();
    }
  });

  it('shows an error panel for an id that is not open', () => {
    at('INC-9999');
    expect(screen.getByRole('alert')).toHaveTextContent(/no open incident/i);
    expect(screen.queryAllByTestId('timeline-row')).toHaveLength(0);
  });

  it('shows the same error in the quiet world, where nothing is open', () => {
    at('INC-2291', 'quiet');
    expect(screen.getByRole('alert')).toHaveTextContent(/no open incident INC-2291/i);
  });
});
