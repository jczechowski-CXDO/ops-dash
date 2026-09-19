import type { CSSProperties, ReactNode } from 'react';
import type { AuditEvent, BlastMetric, EntraSignal, EntraSnapshot } from '@ops-dash/shared';
import { useDemoMode } from '../app/DemoModeProvider.js';
import { Card } from '../components/Card.js';
import { Panel, type PanelState } from '../components/Panel.js';
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

export default function Entra({ snapshot }: { snapshot?: EntraSnapshot } = {}) {
  const { bundle } = useDemoMode();
  // The same seam Task 9 prescribes for Email, applied to all three screens: the
  // production path renders `<Entra />` and reads the demo bundle; a test can
  // hand in a constructed snapshot and assert a relationship over shapes the two
  // fixtures do not contain.
  const { stats, signals, audit } = snapshot ?? bundle.entra;

  return (
    <div data-testid="view-entra" style={VIEW_STACK}>
      <div data-testid="entra-stats" style={STAT_GRID}>
        <StatCard
          label="Risky sign-ins (24h)"
          value={stats.riskySignIns24h.toLocaleString('en-US')}
          note={`${stats.riskyConfirmedCompromised.toLocaleString('en-US')} confirmed compromised`}
          valueColor={blastTextColor(riskyTone(stats))}
        />
        <StatCard
          label="Failed sign-ins (24h)"
          value={stats.failedSignIns24h.toLocaleString('en-US')}
          note={`against ${stats.failedSignInAccounts.toLocaleString('en-US')} accounts`}
          valueColor={blastTextColor(stats.failedSignIns24h > 0 ? 'warning' : 'normal')}
        />
        <StatCard
          label="MFA coverage"
          value={`${(stats.mfaCoverage * 100).toFixed(1)}%`}
          note={`${stats.mfaUnregistered.toLocaleString('en-US')} users unregistered`}
          // Full coverage is 'normal', not a green claim: 'good' is not a member
          // of this union, and inventing a family mapping in a view is the exact
          // bypass that produced the G3 failures.
          valueColor={blastTextColor(stats.mfaUnregistered > 0 ? 'warning' : 'normal')}
        />
        <StatCard
          label="Privileged accounts"
          value={stats.privilegedAccounts.toLocaleString('en-US')}
          note={`${stats.globalAdmins.toLocaleString('en-US')} Global Administrators`}
        />
      </div>

      <TableSection
        title="Signals · last 24 hours"
        count={signals.length}
        noun="signal"
        emptyMessage="No signals in the last 24 hours."
      >
        <Table columns={signalColumns} rows={signals} dense getRowKey={(row) => row.key} />
      </TableSection>

      <TableSection
        title="Directory audit"
        count={audit.length}
        noun="event"
        emptyMessage="No directory changes recorded."
      >
        <Table columns={auditColumns} rows={audit} dense />
      </TableSection>
    </div>
  );
}
