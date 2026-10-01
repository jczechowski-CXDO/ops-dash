import { Link, useLocation } from 'react-router';
import { Icon } from '../components/aurora/Icon.js';
import { useDemoMode, DEMO_TOGGLE_VISIBLE } from './DemoModeProvider.js';
import { NAV, navHref, isNavCurrent, type NavBadge } from './routes.js';
import { useDashboard } from '../live/DataSource.js';
import { severityFillColor, severityOnFillColor } from '../theme/statusColor.js';
import type { Severity } from '@ops-dash/shared';
import type { DemoMode } from '../fixtures/index.js';

const MODES: readonly { mode: DemoMode; label: string }[] = [
  { mode: 'quiet', label: 'Quiet' },
  { mode: 'sev1', label: 'Sev1' },
];

/** A nav badge IS a severity signal, so it takes the published severity fill pair
 *  rather than a raw rung. `openIncidents` counts everything open, whose worst
 *  ordinary case is a Sev 2 — warning. `openSev1s` is Sev 1 — error.
 *
 *  This was `--warning-main` / `--error-main` with a literal white, measured at
 *  2.40:1 light and 2.04:1 dark. `-main` is decoration-grade: right for a dot,
 *  wrong for a word on a fill. `severityOnFillColor` is theme-aware, so the
 *  badge also stops needing a hex at all. */
const BADGE_SEVERITY: Record<NavBadge, Severity> = {
  openIncidents: 2,
  openSev1s: 1,
};

export function Sidebar() {
  const { mode, setMode } = useDemoMode();
  const dashboard = useDashboard();
  const { pathname } = useLocation();

  // Both counts are read off the dashboard on every render. An incident is open
  // while it has no resolvedAt — that is the contract's definition, not a
  // property of today's fixture, so the badges keep telling the truth when a
  // resolved incident lands in the list.
  // From the same source the pages render, not from the fixtures underneath
  // it: a badge reading 5 over a live Overview showing none is two components
  // disagreeing about the same record. With no answer yet there is nothing to
  // count and the badge is absent — a nav badge is a count, and 0 is rendered
  // as no badge already.
  const open = (dashboard.incidents.data ?? []).filter((i) => !i.resolvedAt);
  const counts: Record<NavBadge, number> = {
    openIncidents: open.length,
    openSev1s: open.filter((i) => i.severity === 1).length,
  };

  return (
    <aside
      data-testid="sidebar"
      style={{
        flex: '0 0 232px',
        position: 'sticky',
        top: 0,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--background-paper)',
        borderRight: '1px solid var(--divider)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '16px 18px',
          borderBottom: '1px solid var(--divider)',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: 'var(--primary-main)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="monitoring" size={17} color="#fff" /* prototype literal */ />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
            Crexendo IT
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Service operations</div>
        </div>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 10 }}>
        {NAV.map((item) => {
          const count = item.badge ? counts[item.badge] : 0;
          const href = navHref(item, dashboard.incidents.data ?? []);
          // Computed rather than taken from NavLink's isActive, which can only
          // compare against `to`. Two entries were current at once on '/' in
          // quiet, and the Incident entry was NOT current on an incident page
          // whose id differed from the one its href resolved to.
          const isActive = isNavCurrent(item, pathname, href);
          return (
            <Link
              key={item.id}
              to={href}
              aria-current={isActive ? 'page' : undefined}
              style={{
                display: 'grid',
                gridTemplateColumns: '20px 1fr auto',
                alignItems: 'center',
                gap: 10,
                padding: '7px 10px',
                borderRadius: 8,
                fontFamily: 'var(--font-ui)',
                fontSize: 13,
                textDecoration: 'none',
                background: isActive ? 'var(--primary-lighter)' : 'transparent',
                color: isActive ? 'var(--primary-dark)' : 'var(--text-secondary)',
                fontWeight: isActive ? 700 : 600,
              }}
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
              {item.badge && count > 0 ? (
                <span
                  style={{
                    minWidth: 18,
                    height: 18,
                    padding: '0 5px',
                    borderRadius: 9,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: severityFillColor(BADGE_SEVERITY[item.badge]),
                    color: severityOnFillColor(BADGE_SEVERITY[item.badge]),
                    fontSize: 10.5,
                    fontWeight: 700,
                  }}
                >
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {DEMO_TOGGLE_VISIBLE ? (
        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--divider)', padding: 14 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-secondary)',
              marginBottom: 8,
            }}
          >
            Demo state
          </div>
          <div
            style={{
              display: 'flex',
              gap: 3,
              padding: 3,
              borderRadius: 999,
              // A SEMANTIC surface, not a raw ramp token. `--grey-grey-100` is a
              // value in Aurora's ramp with no dark override, and in dark mode
              // `--text-primary` resolves to that same value — 1.00:1. That is
              // the Overview strip BLOCKER; this was its twin.
              background: 'var(--background-cardelevation2)',
            }}
          >
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                onClick={() => setMode(m.mode)}
                aria-pressed={mode === m.mode}
                style={{
                  flex: 1,
                  padding: '5px 0',
                  borderRadius: 999,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 11.5,
                  fontWeight: 700,
                  background: mode === m.mode ? 'var(--background-paper)' : 'transparent',
                  color: mode === m.mode ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
