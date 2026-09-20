import type { CSSProperties, ReactNode } from 'react';
import type { AuditEvent, BlastMetric, EntraSignal, EntraSnapshot } from '@ops-dash/shared';
import { useDemoMode } from '../app/DemoModeProvider.js';
import { Card } from '../components/Card.js';
import { Panel, type PanelState } from '../components/Panel.js';
import { useEntra } from '../live/DataSource.js';
import { panelStateFor, type Load } from '../live/model.js';
import { SectionHeading } from '../components/SectionHeading.js';
import { StatCard } from '../components/StatCard.js';
import { Table, type Column } from '../components/aurora/Table.js';
import { ago, signedDelta } from '../theme/ago.js';
import { blastTextColor, severityLabel, severityTextColor } from '../theme/statusColor.js';

/* ------------------------------------------------------------------ shared --
 * Entra, Endpoints and Email are one screen shape — a stat row over one or two
 * dense tables — so the shape is defined ONCE, here, and imported by the other
 * two. Three screens that are meant to look like siblings must not be three
 * independent transcriptions of the same README paragraph.
 *
 * `ago` and `signedDelta` belong in `web/src/theme/` beside `ageLabel`, which is
 * where a fourth caller would look for them. No Wave 3 agent owns a shared util
 * file, so they live here and are exported rather than copied — reported to the
 * lead, and a one-line move when a home exists.
 * ------------------------------------------------------------------------- */

/** README § Content well: sections stack at gap 16. */
export const VIEW_STACK: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 };

/** README § 4/5/6: four stat cards, `repeat(auto-fit, minmax(160px, 1fr))`, gap 12. */
export const STAT_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12,
};

/** README § Tables: every table is the Aurora `Table` with `dense`, wrapped in a
 *  card with `overflow: hidden`, under a 15px/700 heading at gap 8.
 *
 *  The heading's meta states how many rows are beneath it, so the count and the
 *  list it counts are computed from one array in one place; and the empty case
 *  is a designed Panel state rather than a blank card. */
export function TableSection({
  title,
  count,
  noun,
  emptyMessage,
  children,
}: {
  title: string;
  count: number;
  noun: string;
  emptyMessage: string;
  children: ReactNode;
}) {
  const state: PanelState = count === 0 ? { kind: 'empty', message: emptyMessage } : { kind: 'ready' };
  return (
    // A labelled region per section: the table itself has no accessible name,
    // and an operator navigating by landmark should be able to reach 'Directory
    // audit' without counting tables.
    <section aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionHeading meta={`${count} ${noun}${count === 1 ? '' : 's'}`}>{title}</SectionHeading>
      <Card padding="0" style={{ overflow: 'hidden' }}>
        <Panel state={state}>{children}</Panel>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------- Entra -- */

/* A stat VALUE is a 22px/700 word, so it takes the text rung — `blastTextColor`,
 * the published picker for exactly this union — and never a `-main` token.
 * `-main` is decoration grade: correct for a dot, a 3px border, a sparkline or a
 * LinearProgress bar, where the bar is 3:1 non-text, and 2.40:1 against paper as
 * a word. G3 measured 42 failures across these three screens because every stat
 * here passed a raw `var(--*-main)` literal, which routes around the helpers
 * entirely — a published fix cannot reach a call site that calls nothing.
 *
 * So each stat derives a `BlastMetric['level']` — the vocabulary the incident
 * hero already uses for 'a headline number and how alarming it is' — and the
 * colour comes from the one picker. A new tone is a new member of that union,
 * not a new literal in this file. */
type Tone = BlastMetric['level'];

/** Red means a compromise was confirmed; amber means risky sign-ins were seen
 *  but none confirmed; no risky sign-in at all is not a warning. Derived, so the
 *  quiet world is not painted with the sev1 world's alarm. */
export function riskyTone(stats: EntraSnapshot['stats']): Tone {
  if (stats.riskyConfirmedCompromised > 0) return 'error';
  return stats.riskySignIns24h > 0 ? 'warning' : 'normal';
}

const signalColumns: Column<EntraSignal>[] = [
  { key: 'label', label: 'Signal' },
  {
    key: 'count',
    label: 'Count',
    align: 'right',
    render: (_v, row) => row.count.toLocaleString('en-US'),
  },
  { key: 'delta24h', label: '24h trend', render: (_v, row) => signedDelta(row.delta24h) },
  {
    key: 'severity',
    label: 'Severity',
    // The severity WORD, so the text rung. The `-main` rung still belongs on the
    // dots and borders that carry the same severity elsewhere.
    render: (_v, row) => (
      <span style={{ color: severityTextColor(row.severity), fontWeight: 700 }}>
        {severityLabel(row.severity)}
      </span>
    ),
  },
  { key: 'lastSeen', label: 'Last seen', align: 'right', render: (_v, row) => ago(row.lastSeen) },
];

const auditColumns: Column<AuditEvent>[] = [
  { key: 'at', label: 'Time', render: (_v, row) => ago(row.at) },
  { key: 'actor', label: 'Actor' },
  {
    key: 'action',
    label: 'Action',
    // README caps this table at four columns, so `result` has no column of its
    // own. A failed directory change rendering identically to a successful one
    // would be a quiet lie, so the failure is said here.
    render: (_v, row) => (
      <>
        {row.action}
        {row.result === 'failure' ? (
          <>
            {' · '}
            <span style={{ color: blastTextColor('error'), fontWeight: 700 }}>failed</span>
          </>
        ) : null}
      </>
    ),
  },
  { key: 'target', label: 'Target', align: 'right' },
];

/**
 * The sentence the MFA figure needs and cannot carry in its own label.
 *
 * `mfaCoverage` is **members only**. Over the whole directory the same tenant
 * reads 0.367, which is not a worse number but a meaningless one: B2B guests
 * register their methods in their home tenant, so counting them measures
 * somebody else's rollout. The honest figure is the members-only one, and a
 * figure that is honest only if you already know its denominator is one an
 * operator will reasonably read as covering everybody.
 *
 * It is stated here rather than folded into the StatCard's label because the
 * label renders on the fixture path too, where it would move visual baselines.
 * No denominator is quoted: the member count is not on the frozen contract, and
 * recovering it from `mfaUnregistered / (1 - mfaCoverage)` would be a number
 * this view invented out of two it was given.
 */
export const MFA_BASIS =
  'MFA coverage counts member accounts only — B2B guests register their methods in their home tenant.';

/**
 * The code `/api/entra` serves when this host has no Graph credential at all.
 *
 * Chosen by the route and pinned here because this view **branches on it**, not
 * merely displays it. `m4-auth` answers it from `graphHealth` — the same
 * function `/api/health` uses — so the health page and this panel cannot
 * disagree about whether a credential exists.
 */
export const GRAPH_UNCONFIGURED = 'graph_unconfigured';

/**
 * The panel state for a live Entra load, with ONE carve-out of `panelStateFor`.
 *
 * `panelStateFor` maps every error to `kind: 'error'`, which `Panel` paints as
 * a red "Entra is unavailable" alert. That is right for a source that failed
 * and wrong for a host that was deliberately never given a credential: nothing
 * is unavailable, nothing broke, and somebody chose this. G3 HIGH-2 ruled on
 * the same shape for an unknown service id, and CLAUDE.md says a permanently
 * red tile for a deliberate absence is as bad as a permanently green one —
 * red for an ordinary condition teaches an operator to distrust red.
 *
 * So `graph_unconfigured` renders as `empty`: the designed neutral state, in
 * the server's own words. **Exactly one code**, because the carve is a claim
 * about a specific deliberate absence and not a general softening:
 *
 *   - `never_polled` stays an error. `poller/schedule.ts` calls `guarded()`
 *     immediately on start rather than waiting out the first interval, so the
 *     window where a configured host has no row is the length of one poll and
 *     not fifteen minutes. A `never_polled` that an operator actually sees has
 *     outlived that window, and then it means the source never registered or
 *     every attempt died before writing — which is a failure, and red.
 *   - `store_unavailable`, `graph_read_failed` and everything else are
 *     failures and stay red.
 *
 * And only when there is no data. An error arriving ALONGSIDE a payload is
 * stale-with-last-good whatever its code, and swallowing that into a neutral
 * empty would drop numbers we hold.
 */
export function entraPanelState(load: Load<EntraSnapshot>): PanelState {
  return load.data === undefined && load.error?.code === GRAPH_UNCONFIGURED
    ? { kind: 'empty', message: load.error.message }
    : panelStateFor(load, 'Entra');
}

export default function Entra({ snapshot }: { snapshot?: EntraSnapshot } = {}) {
  const { bundle } = useDemoMode();
  /**
   * Three sources, and which one is in play is decided here once.
   *
   *   `snapshot` given      the test seam — a constructed shape, no panel states
   *   `useEntra() === null` the fixture path: no live provider above us, which
   *                         is how `?demo=` and the 152 baselines render
   *                         Milestone 1's code unchanged
   *   otherwise             the live poll, with all four of its states
   *
   * The hook is called unconditionally and before any branch, because it is a
   * hook. An injected snapshot simply wins over its answer.
   */
  const polled = useEntra();
  const live = snapshot === undefined ? polled : null;

  /**
   * The snapshot to render, and the one line where a wrong-green would live.
   *
   * There is deliberately no `?? bundle.entra` on the live branch. Falling back
   * to fixtures when the API has not answered would paint a working tenant over
   * a dead one — the fixture Entra page is a *quiet* screen, so the failure
   * would render as good news. On the live path an absent snapshot renders
   * nothing at all, and the Panel above says why.
   */
  const data = snapshot ?? (live === null ? bundle.entra : live.data);

  /**
   * One panel for the whole page, because the source is all-or-nothing.
   *
   * `stats` is eight required numbers with nowhere in the frozen contract to
   * write "we could not look" into two of them, so the adapter returns an error
   * and **no data** when any constituent Graph read fails — and the signals and
   * the audit rows come off that same snapshot. There is no arrangement of this
   * page where half of it can be true, so there is one panel rather than three
   * that would always agree.
   *
   * No page-level `empty` predicate: a snapshot always carries eight stats, so
   * "we looked and there is nothing" is not a fact about the page. It is a fact
   * about each TABLE, and `TableSection` renders it there, twice, in the two
   * places it can actually be true.
   */
  const state: PanelState = live === null ? { kind: 'ready' } : entraPanelState(live);

  return (
    <div data-testid="view-entra" style={VIEW_STACK}>
      <Panel state={state}>
        {data === undefined ? null : (
          // A fragment, not a wrapping div: on the fixture path the Panel is
          // `ready` and renders a fragment too, so these three sections stay
          // DIRECT children of the VIEW_STACK above and the rendered DOM is
          // byte-for-byte what the 152 baselines were taken against.
          <>
            <div data-testid="entra-stats" style={STAT_GRID}>
              <StatCard
                label="Risky sign-ins (24h)"
                value={data.stats.riskySignIns24h.toLocaleString('en-US')}
                note={`${data.stats.riskyConfirmedCompromised.toLocaleString('en-US')} confirmed compromised`}
                valueColor={blastTextColor(riskyTone(data.stats))}
              />
              <StatCard
                label="Failed sign-ins (24h)"
                value={data.stats.failedSignIns24h.toLocaleString('en-US')}
                note={`against ${data.stats.failedSignInAccounts.toLocaleString('en-US')} accounts`}
                valueColor={blastTextColor(data.stats.failedSignIns24h > 0 ? 'warning' : 'normal')}
              />
              <StatCard
                label="MFA coverage"
                value={`${(data.stats.mfaCoverage * 100).toFixed(1)}%`}
                note={`${data.stats.mfaUnregistered.toLocaleString('en-US')} users unregistered`}
                // Full coverage is 'normal', not a green claim: 'good' is not a member
                // of this union, and inventing a family mapping in a view is the exact
                // bypass that produced the G3 failures.
                valueColor={blastTextColor(data.stats.mfaUnregistered > 0 ? 'warning' : 'normal')}
              />
              <StatCard
                label="Privileged accounts"
                value={data.stats.privilegedAccounts.toLocaleString('en-US')}
                note={`${data.stats.globalAdmins.toLocaleString('en-US')} Global Administrators`}
              />
            </div>

            {live === null ? null : (
              <p
                data-testid="entra-mfa-basis"
                style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}
              >
                {MFA_BASIS}
              </p>
            )}

            <TableSection
              title="Signals · last 24 hours"
              count={data.signals.length}
              noun="signal"
              emptyMessage="No signals in the last 24 hours."
            >
              <Table columns={signalColumns} rows={data.signals} dense getRowKey={(row) => row.key} />
            </TableSection>

            <TableSection
              title="Directory audit"
              count={data.audit.length}
              noun="event"
              emptyMessage="No directory changes recorded."
            >
              <Table columns={auditColumns} rows={data.audit} dense />
            </TableSection>
          </>
        )}
      </Panel>
    </div>
  );
}
