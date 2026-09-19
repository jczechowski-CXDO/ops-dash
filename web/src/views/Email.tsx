import type { BlockedMessage, EmailSnapshot } from '@ops-dash/shared';
import { useDemoMode } from '../app/DemoModeProvider.js';
import { StatCard } from '../components/StatCard.js';
import { Table, type Column } from '../components/aurora/Table.js';
// Shape and formatters: see the note at the top of Entra.tsx.
import { STAT_GRID, TableSection, VIEW_STACK, ago, signedDelta } from './Entra.js';

/**
 * `BlockedMessage.reason` documents six values and then unions them with
 * `string`, which collapses the whole union to `string` — nothing in the type
 * system checks what arrives here, and the fixtures deliberately cover neither
 * `Malware` nor `Spam`. So this is total over `string` with a real default
 * branch, and the default is proven by a view test rather than by data that
 * happens to cover every case (G0 LOW, carried to G3).
 */
export function reasonColor(reason: string): string {
  switch (reason) {
    case 'Credential phishing':
    case 'Malware':
      return 'var(--error-main)';
    case 'Impersonation':
    case 'Lookalike domain':
    case 'Malicious URL':
      return 'var(--warning-main)';
    case 'Spam':
      return 'var(--text-secondary)';
    // An unrecognised reason is still a blocked message. It renders, as text, in
    // the neutral tone — never dropped, and never given a severity we did not
    // measure.
    default:
      return 'var(--text-secondary)';
  }
}

/**
 * Every cell here is text. Senders and subjects are attacker-chosen strings —
 * today from a fixture, from Milestone 3 from a mail filter — so none of them
 * reaches an href, a src, a style string or any other HTML sink. React escapes
 * them; a linkified sender would hand the operator a click-through to whatever
 * the attacker wrote.
 */
const blockedColumns: Column<BlockedMessage>[] = [
  { key: 'at', label: 'Time', render: (_v, row) => ago(row.at) },
  { key: 'from', label: 'Sender' },
  { key: 'subject', label: 'Subject' },
  {
    key: 'reason',
    label: 'Reason',
    align: 'right',
    render: (_v, row) => (
      <span style={{ color: reasonColor(row.reason), fontWeight: 700 }}>{row.reason}</span>
    ),
  },
];

export default function Email({ snapshot }: { snapshot?: EmailSnapshot } = {}) {
  const { bundle } = useDemoMode();
  const { stats, recentBlocked } = snapshot ?? bundle.email;

  // Derived, never transcribed: '21.3% of inbound' is blocked over processed.
  // Zero inbound is a real state (a dead connector), and a percentage of nothing
  // is not 0.0% — it is nothing to report.
  const blockedNote =
    stats.processed24h > 0
      ? `${((stats.blocked24h / stats.processed24h) * 100).toFixed(1)}% of inbound`
      : 'no inbound messages';

  return (
    <div data-testid="view-email" style={VIEW_STACK}>
      <div data-testid="email-stats" style={STAT_GRID}>
        <StatCard
          label="Messages processed"
          value={stats.processed24h.toLocaleString('en-US')}
          note="inbound, last 24h"
        />
        <StatCard
          label="Blocked"
          value={stats.blocked24h.toLocaleString('en-US')}
          note={blockedNote}
        />
        <StatCard
          label="Quarantined"
          value={stats.quarantined.toLocaleString('en-US')}
          note={`${stats.quarantinePendingReview.toLocaleString('en-US')} pending review`}
          valueColor={
            stats.quarantinePendingReview > 0 ? 'var(--warning-main)' : 'var(--text-primary)'
          }
        />
        <StatCard
          label="Credential phishing"
          value={stats.credentialPhishing24h.toLocaleString('en-US')}
          note={`${signedDelta(stats.credentialPhishingDelta)} vs yesterday`}
          // Same rule as Entra's risky sign-ins: a rising number is the alarm,
          // a standing one is a warning, none of it is not.
          valueColor={
            stats.credentialPhishingDelta > 0
              ? 'var(--error-main)'
              : stats.credentialPhishing24h > 0
                ? 'var(--warning-main)'
                : 'var(--text-primary)'
          }
        />
      </div>

      <TableSection
        title="Recently blocked"
        count={recentBlocked.length}
        noun="message"
        emptyMessage="No messages blocked in the last 24 hours."
      >
        <Table
          columns={blockedColumns}
          rows={recentBlocked}
          dense
          getRowKey={(row, i) => `${row.at}-${i}`}
        />
      </TableSection>
    </div>
  );
}
