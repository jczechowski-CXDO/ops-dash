import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { AlertRule, Integration } from '@ops-dash/shared';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import { UNKNOWN_AGE } from '../theme/ageLabel.js';
import { fixtures } from '../fixtures/index.js';
import Settings from './Settings.js';

/** The Wave 3 preamble helper, specialised: /settings takes no params. The two
 *  optional props exist so the designed empty state can be rendered at all —
 *  the same escape hatch the plan gives the Email view (defect G-5). */
const at = (props: { rules?: AlertRule[]; integrations?: Integration[] } = {}) =>
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <ThemeProvider>
        <DemoModeProvider>
          <Routes>
            <Route path="/settings" element={<Settings {...props} />} />
          </Routes>
        </DemoModeProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );

const { rules, integrations } = fixtures.sev1;

const rowFor = (name: string) => screen.getByText(name).closest('[data-testid]') as HTMLElement;

// ---------------------------------------------------------------- plan Step 1

describe('Settings', () => {
  it('renders both lists', () => {
    at();
    expect(screen.getByRole('heading', { name: 'Integrations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alert rules' })).toBeInTheDocument();
  });

  it('renders six integrations with their state pills', () => {
    at();
    expect(screen.getAllByTestId('integration-row')).toHaveLength(6);
    expect(screen.getAllByText('Connected')).toHaveLength(4);
    expect(screen.getByText('Polling 60s')).toBeInTheDocument();
    expect(screen.getByText('Needs auth')).toBeInTheDocument();
  });

  it('surfaces the real M365 consent blocker as the needs-auth row', () => {
    at();
    expect(screen.getByText('M365 Service Health')).toBeInTheDocument();
    expect(screen.getByText(/ServiceHealth\.Read\.All/)).toBeInTheDocument();
  });

  it('names the seven verified vendors, not the handoff placeholders', () => {
    at();
    expect(
      screen.getByText(/Hornetsecurity, Jira, Helpjuice, Claude, OpenAI, Zendesk/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/AWS|Okta|Cloudflare|GitHub/)).not.toBeInTheDocument();
  });

  it('renders six rule switches with the prototype defaults', () => {
    at();
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(6);
    expect(screen.getByRole('switch', { name: /Agent stale/ })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /Vendor degraded/ })).toBeChecked();
  });

  it('toggles a rule', () => {
    at();
    const stale = screen.getByRole('switch', { name: /Agent stale/ });
    fireEvent.click(stale);
    expect(screen.getByRole('switch', { name: /Agent stale/ })).toBeChecked();
  });

  it('shows the threshold as the rule detail line', () => {
    at();
    expect(screen.getByText('More than 500 failures in 15 minutes')).toBeInTheDocument();
  });
});

// ------------------------------------------------- relationships, not values
//
// Each of these asserts that two things AGREE across several shapes, rather
// than pinning today's two numbers — a re-inlined divergent copy fails these
// even on a day when it happens to produce the right answer.

describe('Settings · the switches and the count cannot disagree', () => {
  const checkedInDom = () =>
    screen.getAllByRole('switch').filter((s) => s.getAttribute('aria-checked') === 'true').length;

  const countInHeading = () => {
    const meta = screen.getByTestId('rules-count').textContent ?? '';
    const m = /^(\d+) of (\d+) enabled$/.exec(meta.trim());
    expect(m, `rules-count did not read "N of M enabled": ${meta}`).not.toBeNull();
    return { enabled: Number(m?.[1]), total: Number(m?.[2]) };
  };

  it('agrees on the fixture defaults and after every toggle', () => {
    at();
    const names = rules.map((r) => r.name);

    // Four shapes: as loaded; the disabled rule switched on; a second one
    // switched off; everything off. The count is re-read from the DOM each
    // time, so a count computed once from the fixture fails here.
    const shapes: string[][] = [[], ['Agent stale'], ['Vendor degraded + our check failing'], names];

    let toggledSoFar: string[] = [];
    for (const shape of shapes) {
      // move from the previous shape to this one
      for (const n of [...toggledSoFar, ...shape].filter(
        (n) => toggledSoFar.includes(n) !== shape.includes(n),
      )) {
        fireEvent.click(screen.getByRole('switch', { name: n }));
      }
      toggledSoFar = shape;

      // The toggles must actually move, or "they agree" would be satisfied by a
      // component that ignores onChange entirely and never changes anything.
      const expectedOn = rules
        .filter((r) => r.enabled !== shape.includes(r.name))
        .map((r) => r.name)
        .sort();
      const actuallyOn = screen
        .getAllByRole('switch')
        .filter((s) => s.getAttribute('aria-checked') === 'true')
        .map((s) => s.getAttribute('aria-label') ?? '')
        .sort();
      expect(actuallyOn).toEqual(expectedOn);

      const { enabled, total } = countInHeading();
      expect(enabled).toBe(checkedInDom());
      expect(total).toBe(screen.getAllByRole('switch').length);
      expect(total).toBe(rules.length);
    }
  });

  it('a switch reflects its rule and nothing else', () => {
    at();
    for (const rule of rules) {
      expect(screen.getByRole('switch', { name: rule.name })).toHaveAttribute(
        'aria-checked',
        String(rule.enabled),
      );
    }
  });
});

describe('Settings · the disabled rule explains a miss rather than hiding it', () => {
  const NOTE = /nothing alerts on this/i;

  it('marks exactly the rules that are off, and follows the switch', () => {
    at();
    for (const rule of rules) {
      const row = rowFor(rule.name);
      const hasNote = NOTE.test(row.textContent ?? '');
      expect(hasNote, `${rule.name} enabled=${rule.enabled}`).toBe(!rule.enabled);
    }

    // The note is a statement about the current state, not about the fixture.
    fireEvent.click(screen.getByRole('switch', { name: /Agent stale/ }));
    expect(NOTE.test(rowFor('Agent stale').textContent ?? '')).toBe(false);

    fireEvent.click(screen.getByRole('switch', { name: /Legacy auth attempt/ }));
    expect(NOTE.test(rowFor('Legacy auth attempt').textContent ?? '')).toBe(true);
  });
});

describe('Settings · an integration row says what its state means', () => {
  it('shows each row its own stateLabel — never a label picked by hand', () => {
    at();
    const rows = screen.getAllByTestId('integration-row');
    expect(rows).toHaveLength(integrations.length);
    rows.forEach((row, i) => {
      const integration = integrations[i]!;
      expect(within(row).getByText(integration.name)).toBeInTheDocument();
      expect(within(row).getByText(integration.detail)).toBeInTheDocument();
      expect(within(row).getByTestId('integration-state')).toHaveTextContent(
        integration.stateLabel,
      );
    });
  });

  it('every state has a distinct pill treatment, and none is picked by hand', () => {
    at();
    const seen = new Map<string, string>();
    screen.getAllByTestId('integration-row').forEach((row, i) => {
      const state = integrations[i]!.state;
      const bg = (within(row).getByTestId('integration-state') as HTMLElement).style.background;
      expect(bg).toMatch(/^var\(--[a-z]+-lighter\)$/);
      if (seen.has(state)) expect(bg).toBe(seen.get(state));
      // Two different states must never share a colour: that is how needs_auth
      // would quietly render as connected.
      for (const [other, otherBg] of seen) if (other !== state) expect(bg).not.toBe(otherBg);
      seen.set(state, bg);
    });
  });

  // G3 measured the needs-auth pill at 4.09:1 in light, under the 4.5 AA bar,
  // with README § 7's `-dark` on `-lighter`. jsdom cannot resolve var() against
  // the token sheet — a contrast assertion here would be the jsdom-contrast
  // decoration this project has already been caught by once. So what is pinned
  // is the INVARIANT the Chromium measurement blessed: one rung pair, the same
  // for all four states, family-matched. A state reverted to `-dark`, or a pill
  // whose text and background come from different families, fails here.
  it('pairs -darker text with -lighter fill, identically for all four states', () => {
    // All four, including `error`, which no fixture carries — a state whose
    // colours nothing renders is a state nobody can measure.
    const all: Integration[] = (
      [
        ['connected', 'Connected'],
        ['polling', 'Polling 60s'],
        ['needs_auth', 'Needs auth'],
        ['error', 'Unreachable'],
      ] as const
    ).map(([state, stateLabel], i) => ({
      key: `probe-${i}`,
      name: `Probe ${i}`,
      detail: 'synthetic row',
      state,
      stateLabel,
      lastSuccessAt: new Date().toISOString(),
    }));

    at({ integrations: all });
    const families = new Set<string>();
    for (const pill of screen.getAllByTestId('integration-state')) {
      const { color, background } = (pill as HTMLElement).style;
      const family = /^var\(--([a-z]+)-darker\)$/.exec(color)?.[1];
      expect(family, `text colour was ${color}`).toBeDefined();
      expect(background).toBe(`var(--${family}-lighter)`);
      families.add(family!);
    }
    expect(families.size).toBe(all.length);
  });
});

describe('Settings · the feed that has never authenticated', () => {
  it('reports the absence honestly instead of inventing an age', () => {
    at();
    for (const integration of integrations) {
      const row = rowFor(integration.name);
      const text = row.textContent ?? '';
      // No row ever prints the unknown-age sentinel as though it were an age.
      expect(text).not.toContain(UNKNOWN_AGE);
      if (integration.lastSuccessAt) {
        expect(text).toMatch(/Last success .+ ago/);
        expect(text).not.toMatch(/never/i);
      } else {
        expect(text).not.toMatch(/Last success/);
        expect(text).toMatch(/never/i);
      }
    }
  });

  it('spells out the consequence: no data, so nothing can be affirmed or alerted', () => {
    at();
    const row = rowFor('M365 Service Health');
    expect(row).toHaveTextContent(/Unknown/);
    expect(row).toHaveTextContent(/no rule can fire on it/i);
    // The fixture genuinely omits the field; this test is worthless if it does not.
    expect(integrations.find((i) => i.key === 'm365health')?.lastSuccessAt).toBeUndefined();
  });
});

describe('Settings · designed states', () => {
  it('renders an empty message per list rather than a blank column', () => {
    at({ rules: [], integrations: [] });
    expect(screen.queryAllByTestId('integration-row')).toHaveLength(0);
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.getByText(/No integrations are configured/i)).toBeInTheDocument();
    expect(screen.getByText(/No alert rules are configured/i)).toBeInTheDocument();
  });

  it('keeps the view testid the shell asserts', () => {
    at();
    expect(screen.getByTestId('view-settings')).toBeInTheDocument();
  });
});

describe('Settings · README § 7 measurements', () => {
  it('is two columns, auto-fit minmax(320px,1fr), gap 16, align-items start', () => {
    at();
    expect(screen.getByTestId('settings-grid')).toHaveStyle({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
      gap: '16px',
      alignItems: 'start',
    });
  });

  it('rows are 1fr auto with 11px 16px padding and a divider', () => {
    at();
    const row = screen.getAllByTestId('integration-row')[0]!;
    expect(row).toHaveStyle({
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      padding: '11px 16px',
      borderBottom: '1px solid var(--divider)',
    });
  });

  it('pills are radius 999, padding 3px 9px, 11px/700', () => {
    at();
    expect(screen.getAllByTestId('integration-state')[0]!).toHaveStyle({
      borderRadius: '999px',
      padding: '3px 9px',
      fontSize: '11px',
      fontWeight: '700',
    });
  });
});
