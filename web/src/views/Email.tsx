import type { BlastMetric, BlockedMessage, EmailSnapshot } from '@ops-dash/shared';
import { blastTextColor } from '../theme/statusColor.js';
import { useDemoMode } from '../app/DemoModeProvider.js';
import { StatCard } from '../components/StatCard.js';
import { Table, type Column } from '../components/aurora/Table.js';
// Shape and formatters: see the note at the top of Entra.tsx.
import {STAT_GRID, TableSection, VIEW_STACK} from './Entra.js';
import { ago, signedDelta } from '../theme/ago.js';

/**
 * `BlockedMessage.reason` documents six values and then unions them with
 * `string`, which collapses the whole union to `string` — nothing in the type
 * system checks what arrives here, and the fixtures deliberately cover neither
 * `Malware` nor `Spam`. So this is total over `string` with a real default
 * branch, and the default is proven by a view test rather than by data that
 * happens to cover every case (G0 LOW, carried to G3).
 *
 * It returns a TONE, not a colour. These are 14px/700 words in a table, so the
 * colour comes from `blastTextColor`; `--warning-main` on a word is 2.40:1 and
 * was one of the 42 failures G3 measured across these three screens.
 */
export function reasonTone(reason: string): BlastMetric['level'] {
  switch (reason) {
    case 'Credential phishing':
    case 'Malware':
      return 'error';
    case 'Impersonation':
    case 'Lookalike domain':
    case 'Malicious URL':
      return 'warning';
    case 'Spam':
      return 'normal';
    // An unrecognised reason is still a blocked message. It renders, as text, in
    // the neutral tone — never dropped, and never given a severity we did not
    // measure.
    default:
      return 'normal';
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
  // The one free-text column, so it is the one that yields. See Column.truncate.
  { key: 'subject', label: 'Subject', truncate: true },
  {
    key: 'reason',
    label: 'Reason',
    align: 'right',
    render: (_v, row) => (
      <span style={{ color: blastTextColor(reasonTone(row.reason)), fontWeight: 700 }}>
        {row.reason}
      </span>
    ),
  },
];

/** A rising number is the alarm, a standing one is a warning, none of it is not
 *  — the same rule Entra's risky sign-ins use, in the same vocabulary. */
export function phishingTone(stats: EmailSnapshot['stats']): BlastMetric['level'] {
  if (stats.credentialPhishingDelta > 0) return 'error';
  return stats.credentialPhishing24h > 0 ? 'warning' : 'normal';
}

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
          valueColor={blastTextColor(stats.quarantinePendingReview > 0 ? 'warning' : 'normal')}
        />
        <StatCard
          label="Credential phishing"
          value={stats.credentialPhishing24h.toLocaleString('en-US')}
          note={`${signedDelta(stats.credentialPhishingDelta)} vs yesterday`}
          // Same rule as Entra's risky sign-ins: a rising number is the alarm,
          // a standing one is a warning, none of it is not.
          valueColor={blastTextColor(phishingTone(stats))}
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
