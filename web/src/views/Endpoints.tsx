import type { EndpointIssue, EndpointSnapshot } from '@ops-dash/shared';
import { useDemoMode } from '../app/DemoModeProvider.js';
import { StatCard } from '../components/StatCard.js';
import { Table, type Column } from '../components/aurora/Table.js';
// The screen shape, and the two formatters these three views share, are defined
// once in Entra.tsx — see the note there. Imported rather than re-typed so the
// three security screens are siblings, not three readings of one paragraph.
import { STAT_GRID, TableSection, VIEW_STACK, ago } from './Entra.js';

/** Whole-percent share, total-safe: a fleet of zero yields 0, not NaN in an
 *  aria-valuenow. */
function pctOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

const attentionColumns: Column<EndpointIssue>[] = [
  { key: 'computer', label: 'Computer' },
  { key: 'assignedTo', label: 'Assigned to' },
  { key: 'issue', label: 'Issue' },
  // `os` is carried by the contract and deliberately has no column: README caps
  // these tables at four so the last one survives a ~1000px well.
  { key: 'lastCheckIn', label: 'Last check-in', align: 'right', render: (_v, row) => ago(row.lastCheckIn) },
];

export default function Endpoints({ snapshot }: { snapshot?: EndpointSnapshot } = {}) {
  const { bundle } = useDemoMode();
  const { stats, attention } = snapshot ?? bundle.endpoints;

  return (
    <div data-testid="view-endpoints" style={VIEW_STACK}>
      {/* README § 5: four stat cards, each with a LinearProgress under the value.
          Bar colours are fixed by the README — warning, success, primary, error —
          and every bar value is derived from the snapshot, never written twice. */}
      <div data-testid="endpoints-stats" style={STAT_GRID}>
        <StatCard
          label="Patch compliance"
          value={`${(stats.patchCompliance * 100).toFixed(1)}%`}
          valueColor="var(--warning-main)"
          progress={{ value: Math.round(stats.patchCompliance * 100), color: 'warning' }}
        />
        <StatCard
          label="Agents checked in (7d)"
          value={`${stats.checkedIn7d.toLocaleString('en-US')} / ${stats.total.toLocaleString('en-US')}`}
          valueColor="var(--success-main)"
          progress={{ value: pctOf(stats.checkedIn7d, stats.total), color: 'success' }}
        />
        <StatCard
          label="BitLocker encrypted"
          value={`${stats.bitlockerEncrypted.toLocaleString('en-US')} / ${stats.total.toLocaleString('en-US')}`}
          progress={{ value: pctOf(stats.bitlockerEncrypted, stats.total), color: 'primary' }}
        />
        <StatCard
          label="Critical patches missing"
          value={stats.criticalPatchesMissing.toLocaleString('en-US')}
          valueColor={
            stats.criticalPatchesMissing > 0 ? 'var(--error-main)' : 'var(--text-primary)'
          }
          // A count, not a ratio — the prototype fills this bar by the count
          // itself. Capped, so 240 missing patches is a full bar rather than an
          // aria-valuenow above its own maximum.
          progress={{ value: Math.min(100, stats.criticalPatchesMissing), color: 'error' }}
        />
      </div>

      <TableSection
        title="Needs attention"
        count={attention.length}
        noun="device"
        emptyMessage="No endpoints need attention."
      >
        <Table columns={attentionColumns} rows={attention} dense getRowKey={(row) => row.computer} />
      </TableSection>
    </div>
  );
}
