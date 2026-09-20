import type { EndpointIssue, EndpointSnapshot } from '@ops-dash/shared';
import { blastTextColor } from '../theme/statusColor.js';
import { useDemoMode } from '../app/DemoModeProvider.js';
import { StatCard } from '../components/StatCard.js';
import { Table, type Column } from '../components/aurora/Table.js';
// The screen shape, and the two formatters these three views share, are defined
// once in Entra.tsx — see the note there. Imported rather than re-typed so the
// three security screens are siblings, not three readings of one paragraph.
import {STAT_GRID, TableSection, VIEW_STACK} from './Entra.js';
import { ago } from '../theme/ago.js';
import { Panel, type PanelState } from '../components/Panel.js';
import { useEndpoints } from '../live/DataSource.js';
import { panelStateFor } from '../live/model.js';

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

/**
 * Why the BitLocker figure is a bare count on the live path and a fraction in
 * the demo, and why that divergence is the honest answer rather than a wart.
 *
 * `bitlockerEncrypted` is **not a share of the estate**. ManageEngine reports
 * BitLocker status only after an inventory scan, so a computer with no record
 * is *not scanned*, not *unencrypted*. Measured on the real tenant: 130
 * encrypted, **2** affirmatively unencrypted, and **81 never scanned** out of
 * 213. Rendering `130 / 213` announces that 39% of the estate is unencrypted
 * when the measured truth is two bad machines — a false number in the alarming
 * direction, which this project treats as no better than a false green, because
 * a tile that cries wolf is one the operator stops reading.
 *
 * The progress bar was the worse half of that and the half the brief missed: a
 * value string can carry a caption and a 61%-filled bar cannot. `queries.ts`'s
 * own docblock says "the screen must never divide it by `total`" — and the
 * screen did it twice, underneath the comment forbidding it.
 *
 * **The fixture path keeps both**, deliberately. In the demo world every
 * machine is scanned, so `576 / 612` is true there and the bar is a correct
 * rendering of data that has no unknowns. Removing it from a world where it
 * tells the truth, to protect a world where it does not, would move 152
 * baselines to make a screen less accurate to its own data. The divergence
 * tracks a real difference between the two worlds.
 *
 * **The line quotes no denominator**, for the reason the Entra one quotes no
 * member count: `EndpointSnapshot.stats` carries `total` and
 * `bitlockerEncrypted` and nothing else. `encryptedComputers` computes
 * `scanned` and `knownUnencrypted` and both die inside the adapter, so the 81
 * cannot be named from here. `total - bitlockerEncrypted` is 83, not 81, and
 * conflates the 2 known-bad with the 81 unknown — which is the exact
 * conflation this whole note exists to refuse. A contract amendment carrying
 * the denominator is queued; this line gains a number when it lands rather
 * than being rewritten.
 */
export const BITLOCKER_BASIS =
  'BitLocker status is reported only after an inventory scan, so this is a count of confirmed-encrypted machines and not a share of the estate.';

export default function Endpoints({ snapshot }: { snapshot?: EndpointSnapshot } = {}) {
  const { bundle } = useDemoMode();
  const polled = useEndpoints();
  const live = snapshot === undefined ? polled : null;
  // No `?? bundle.endpoints` on the live branch: a fixture fleet painted over a
  // tenant nobody could read is the wrong-green this layer exists to refuse.
  const data = snapshot ?? (live === null ? bundle.endpoints : live.data);
  const state: PanelState = live === null ? { kind: 'ready' } : panelStateFor(live, 'Endpoints');

  return (
    <div data-testid="view-endpoints" style={VIEW_STACK}>
      <Panel state={state}>
        {data === undefined ? null : (
          <EndpointsBody stats={data.stats} attention={data.attention} live={live !== null} />
        )}
      </Panel>
    </div>
  );
}

function EndpointsBody({
  stats,
  attention,
  live,
}: {
  stats: EndpointSnapshot['stats'];
  attention: EndpointIssue[];
  live: boolean;
}) {
  return (
    <>
      {/* README § 5: four stat cards, each with a LinearProgress under the value.
          Bar colours are fixed by the README — warning, success, primary, error —
          and every bar value is derived from the snapshot, never written twice. */}
      <div data-testid="endpoints-stats" style={STAT_GRID}>
        <StatCard
          label="Patch compliance"
          value={`${(stats.patchCompliance * 100).toFixed(1)}%`}
          // The BAR keeps `-main`: it is a 6px block, judged at the 3:1
          // non-text bar, and that is the rung `-main` is for. The NUMBER above
          // it is a word and takes the text rung. See the note in Entra.tsx.
          valueColor={blastTextColor(stats.patchCompliance < 1 ? 'warning' : 'normal')}
          progress={{ value: Math.round(stats.patchCompliance * 100), color: 'warning' }}
        />
        <StatCard
          label="Agents checked in (7d)"
          value={`${stats.checkedIn7d.toLocaleString('en-US')} / ${stats.total.toLocaleString('en-US')}`}
          // Was `--success-main` at 2.40:1. There is no 'good' tone in this
          // union and a count of agents is a measurement, not an assertion of
          // health — the green LinearProgress under it carries that.
          progress={{ value: pctOf(stats.checkedIn7d, stats.total), color: 'success' }}
        />
        {/* The one card that differs between the two worlds. See BITLOCKER_BASIS. */}
        {live ? (
          <StatCard
            label="BitLocker encrypted"
            value={stats.bitlockerEncrypted.toLocaleString('en-US')}
            note="confirmed encrypted"
          />
        ) : (
          <StatCard
            label="BitLocker encrypted"
            value={`${stats.bitlockerEncrypted.toLocaleString('en-US')} / ${stats.total.toLocaleString('en-US')}`}
            progress={{ value: pctOf(stats.bitlockerEncrypted, stats.total), color: 'primary' }}
          />
        )}
        <StatCard
          label="Critical patches missing"
          value={stats.criticalPatchesMissing.toLocaleString('en-US')}
          valueColor={blastTextColor(stats.criticalPatchesMissing > 0 ? 'error' : 'normal')}
          // A count, not a ratio — the prototype fills this bar by the count
          // itself. Capped, so 240 missing patches is a full bar rather than an
          // aria-valuenow above its own maximum.
          progress={{ value: Math.min(100, stats.criticalPatchesMissing), color: 'error' }}
        />
      </div>

      {live ? (
        <p
          data-testid="endpoints-bitlocker-basis"
          style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}
        >
          {BITLOCKER_BASIS}
        </p>
      ) : null}

      <TableSection
        title="Needs attention"
        count={attention.length}
        noun="device"
        emptyMessage="No endpoints need attention."
      >
        <Table columns={attentionColumns} rows={attention} dense getRowKey={(row) => row.computer} />
      </TableSection>
    </>
  );
}
