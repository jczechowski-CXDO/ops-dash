import type { CSSProperties, ReactNode } from 'react';
import type { AuditEvent, EntraSignal, EntraSnapshot } from '@ops-dash/shared';
import { useDemoMode } from '../app/DemoModeProvider.js';
import { Card } from '../components/Card.js';
import { Panel, type PanelState } from '../components/Panel.js';
import { SectionHeading } from '../components/SectionHeading.js';
import { StatCard } from '../components/StatCard.js';
import { Table, type Column } from '../components/aurora/Table.js';
import { ageLabel } from '../theme/ageLabel.js';
import { severityColor, severityLabel } from '../theme/statusColor.js';

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

/** '34 days ago'. `ageLabel` is deliberately non-directional — the caller
 *  composes the sentence — and every relative time on these three screens
 *  composes it the same way. */
export function ago(iso: string): string {
  return `${ageLabel(iso)} ago`;
}

/** '+1,102' / '-2' / '0'. A rise is signed, a fall carries its own minus, and
 *  zero is never '+0' — the prototype's own convention. */
export function signedDelta(n: number): string {
  const formatted = n.toLocaleString('en-US');
  return n > 0 ? `+${formatted}` : formatted;
}

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

/** Red means a compromise was confirmed; amber means risky sign-ins were seen
 *  but none confirmed; no risky sign-in at all is not a warning. Derived, so the
 *  quiet world is not painted with the sev1 world's alarm. */
function riskyColor(stats: EntraSnapshot['stats']): string {
  if (stats.riskyConfirmedCompromised > 0) return 'var(--error-main)';
  return stats.riskySignIns24h > 0 ? 'var(--warning-main)' : 'var(--text-primary)';
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
    render: (_v, row) => (
      <span style={{ color: severityColor(row.severity), fontWeight: 700 }}>
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
            <span style={{ color: 'var(--error-main)', fontWeight: 700 }}>failed</span>
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
          valueColor={riskyColor(stats)}
        />
        <StatCard
          label="Failed sign-ins (24h)"
          value={stats.failedSignIns24h.toLocaleString('en-US')}
          note={`against ${stats.failedSignInAccounts.toLocaleString('en-US')} accounts`}
          valueColor={stats.failedSignIns24h > 0 ? 'var(--warning-main)' : 'var(--text-primary)'}
        />
        <StatCard
          label="MFA coverage"
          value={`${(stats.mfaCoverage * 100).toFixed(1)}%`}
          note={`${stats.mfaUnregistered.toLocaleString('en-US')} users unregistered`}
          valueColor={stats.mfaUnregistered > 0 ? 'var(--warning-main)' : 'var(--success-main)'}
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
