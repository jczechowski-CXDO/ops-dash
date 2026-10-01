import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from './DemoModeProvider.js';
import { App } from './App.js';
import { fixtures } from '../fixtures/index.js';

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <DemoModeProvider>
          <App />
        </DemoModeProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const toQuiet = () => fireEvent.click(screen.getByRole('button', { name: 'Quiet' }));

describe('sidebar', () => {
  it('lists the seven nav items in order', () => {
    at('/');
    const nav = screen.getByRole('navigation');
    expect(within(nav).getAllByRole('link').map((a) => a.textContent?.trim().replace(/\d+$/, ''))).toEqual([
      'Overview', 'Service detail', 'Incident', 'Entra security', 'Endpoints', 'Email security', 'Rules & integrations',
    ]);
  });

  it('carries the testid Task 10A measures the 232px rail by', () => {
    // Defect G-3: the Playwright width assertion used to reach the rail via
    // ancestor::div[1] off the nav role, which broke on any wrapper. It now
    // selects data-testid="sidebar", so this element must keep it and must be
    // the element that actually holds the nav.
    at('/');
    const rail = screen.getByTestId('sidebar');
    expect(within(rail).getByRole('navigation')).toBeInTheDocument();
    expect(within(rail).getByText('Crexendo IT')).toBeInTheDocument();
  });

  it('marks the current route as the active item, and only that one', () => {
    at('/entra');
    expect(screen.getByRole('link', { name: /Entra security/ })).toHaveAttribute('aria-current', 'page');
    // Exactly one item, which is the property that matters: two aria-current
    // links is a lie about where you are. Noted honestly after mutating it —
    // deleting `end` from the NavLink does NOT break this, because react-router
    // already special-cases the root path. `end` stays as the defence against a
    // nested route arriving later, not because this assertion catches its loss.
    const nav = screen.getByRole('navigation');
    expect(within(nav).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it('badges Overview with the open incident count and Incident with the open Sev1s', () => {
    at('/');
    // amended at G1 — G-13: sev1 now holds FIVE incidents, and TWO of them are
    // Sev1 — INC-2292 (proofpoint, auto-created by the vendor rule) and INC-2291
    // (m365, opened by hand because its vendor feed is unreadable).
    expect(within(screen.getByRole('link', { name: /Overview/ })).getByText('5')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: /^Incident/ })).getByText('2')).toBeInTheDocument();
  });

  it('agrees with the fixture bundle rather than with a number typed next to the label', () => {
    // Gate G2 asks specifically whether the badges derive from data. Equality
    // against the fixture counts is not enough on its own — a constant 5 also
    // equals 5 — so the load-bearing half is the quiet world below, where the
    // same two badges must disappear because the data says zero.
    const openIncidents = fixtures.sev1.incidents.filter((i) => !i.resolvedAt);
    const open = openIncidents.length;
    const sev1s = openIncidents.filter((i) => i.severity === 1).length;
    at('/');
    expect(within(screen.getByRole('link', { name: /Overview/ })).getByText(String(open))).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: /^Incident/ })).getByText(String(sev1s))).toBeInTheDocument();

    toQuiet();
    expect(fixtures.quiet.incidents).toHaveLength(0);
    expect(within(screen.getByRole('link', { name: /Overview/ })).queryByText(/\d/)).toBeNull();
    expect(within(screen.getByRole('link', { name: /^Incident/ })).queryByText(/\d/)).toBeNull();
  });

  it('shows the brand block', () => {
    at('/');
    expect(screen.getByText('Crexendo IT')).toBeInTheDocument();
    expect(screen.getByText('Service operations')).toBeInTheDocument();
  });
});

describe('header', () => {
  it('shows the per-route title and subtitle', () => {
    at('/endpoints');
    expect(screen.getByRole('heading', { level: 1, name: 'Endpoints & patch health' })).toBeInTheDocument();
    expect(screen.getByText('612 managed endpoints · Endpoint Central')).toBeInTheDocument();
  });

  it('says seven monitored services, never ten', () => {
    at('/');
    expect(screen.getByText(/7 monitored services/)).toBeInTheDocument();
    expect(screen.queryByText(/10 monitored services/)).not.toBeInTheDocument();
  });

  it('counts the auto-refresh down from 30 seconds', () => {
    at('/');
    expect(screen.getByText(/Auto-refresh · \d{1,2}s/)).toBeInTheDocument();
  });

  it('shows a ticking clock', () => {
    at('/');
    expect(screen.getByTestId('clock').textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('actually ticks — the clock advances and the countdown decrements', () => {
    // 'Shows a clock' is satisfied by a frozen string. This is the part of the
    // claim that needs a second: one interval drives both readouts.
    vi.useFakeTimers({ now: new Date(2026, 8, 19, 10, 30, 0) });
    at('/');
    expect(screen.getByTestId('clock')).toHaveTextContent('10:30:00');
    expect(screen.getByText(/Auto-refresh · 30s/)).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByTestId('clock')).toHaveTextContent('10:30:02');
    expect(screen.getByText(/Auto-refresh · 28s/)).toBeInTheDocument();
  });

  it('stops its interval when the shell unmounts', () => {
    vi.useFakeTimers();
    const cleared = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = at('/');
    unmount();
    expect(cleared).toHaveBeenCalled();
  });

  it('never claims health for a world holding two unknown services', () => {
    // The quiet world is 5 AFFIRMED · 2 UNKNOWN and permanently so: the Zendesk
    // SSP publishes no per-service status and M365 Service Health consent is
    // pending. 'All 7 monitored services healthy' would be exactly the wrong-green
    // the G1 blocker was about, one string further along.
    at('/');
    toQuiet();
    expect(screen.queryByText(/All 7 monitored services healthy/)).not.toBeInTheDocument();
    expect(screen.getByText(/5 of 7 monitored services affirmed healthy · 2 unknown/)).toBeInTheDocument();
  });
});

describe('routing', () => {
  it.each([
    ['/', 'view-overview'],
    ['/services/m365', 'view-service'],
    ['/incidents/INC-2291', 'view-incident'],
    ['/entra', 'view-entra'],
    ['/endpoints', 'view-endpoints'],
    ['/email', 'view-email'],
    ['/settings', 'view-settings'],
  ])('renders %s', (path, testId) => {
    at(path);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it('sends an unknown path back to the overview', () => {
    at('/nope');
    expect(screen.getByTestId('view-overview')).toBeInTheDocument();
  });

  it('follows a nav click and comes back clean', () => {
    at('/');
    fireEvent.click(screen.getByRole('link', { name: /Entra security/ }));
    expect(screen.getByTestId('view-entra')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Entra security');

    fireEvent.click(screen.getByRole('link', { name: /Overview/ }));
    expect(screen.getByTestId('view-overview')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Overview');
    expect(screen.queryByTestId('view-entra')).toBeNull();
  });
});

describe('theme', () => {
  it('toggles the dark class on the document root and persists it', () => {
    at('/');
    fireEvent.click(screen.getByRole('button', { name: /dark theme/i }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('ops-dash.theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: /light theme/i }));
    expect(document.documentElement).not.toHaveClass('dark');
  });
});

describe('demo state by URL', () => {
  it('renders the whole quiet shell from ?demo=quiet, with no toggle click', () => {
    // G2 HIGH-2: the sidebar control is dev-only, Task 10A screenshots the
    // production build, so without this parameter all 28 baselines would be
    // sev1 and the quiet Overview would ship unphotographed.
    at('/?demo=quiet');
    expect(screen.getByText(/5 of 7 monitored services affirmed healthy · 2 unknown/)).toBeInTheDocument();
    const nav = screen.getByRole('navigation');
    expect(within(nav).queryByText(/^\d+$/)).toBeNull();
  });

  it('ignores a demo parameter it does not recognise', () => {
    at('/?demo=all-green');
    expect(screen.getByText(/5 open incidents across 7 monitored services/)).toBeInTheDocument();
  });
});

describe('demo state toggle', () => {
  it('switches the fixture bundle between quiet and sev1', () => {
    at('/');
    toQuiet();
    expect(screen.getByText(/5 of 7 monitored services affirmed healthy/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sev1' }));
    expect(screen.getByText(/open incidents across 7 monitored services/)).toBeInTheDocument();
  });
});
