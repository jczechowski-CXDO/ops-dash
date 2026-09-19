import { useParams } from 'react-router';
import type { CheckRun, ServiceStatus, StatusLevel } from '@ops-dash/shared';
import { Card } from '../components/Card.js';
import { Panel, type PanelState } from '../components/Panel.js';
import { SectionHeading } from '../components/SectionHeading.js';
import { Sparkline } from '../components/Sparkline.js';
import { StatCard } from '../components/StatCard.js';
import { Table, type Column } from '../components/aurora/Table.js';
import { useDemoMode } from '../app/DemoModeProvider.js';
import { checkRunsFor, serviceById } from '../fixtures/index.js';
// clockOf is the repository's one HH:MM formatter — the fixtures' wall-clock
// copy goes through it, so the table and the prose it describes cannot disagree.
// It lives in fixtures/time.ts because that is where it was first needed; see
// the report for the request to move it beside ageLabel in theme/ when a file
// owner is available.
import { clockOf } from '../fixtures/time.js';
import { ageLabel } from '../theme/ageLabel.js';
import { statusColor } from '../theme/statusColor.js';

/** README § 2: "a 9px status dot + 16px/700 state word". */
function StatusDot({ level, testId }: { level: StatusLevel; testId: string }) {
  return (
    <span
      data-testid={testId}
      style={{
        width: 9,
        height: 9,
        borderRadius: '50%',
        // Amendment 1 lives here: `unknown` resolves to --text-disabled and can
        // never come out green, because the colour is not chosen locally.
        background: statusColor(level),
        flex: '0 0 auto',
      }}
    />
  );
}

/**
 * One half of the page. Both halves are this component, so the vendor's claim
 * and our own measurement are presented identically — which is the only way the
 * reader can attribute a difference to the evidence rather than to the layout.
 */
function HalfCard({
  overline,
  level,
  label,
  note,
  provenance,
  dotTestId,
}: {
  overline: string;
  level: StatusLevel;
  label: string;
  note: string;
  provenance: string;
  dotTestId: string;
}) {
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
        }}
      >
        {overline}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusDot level={level} testId={dotTestId} />
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 16, fontWeight: 700 }}>{label}</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', textWrap: 'pretty' }}>{note}</div>
      {/* --text-secondary, not --text-disabled: this line is the only thing on
          the page that tells the two Unknowns apart, and disabled grey is a
          contrast failure on body text. The DOT is the disabled grey, per
          amendment 1; the sentence explaining it has to be readable. */}
      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{provenance}</div>
    </Card>
  );
}

/**
 * Why this service's vendor half says what it says.
 *
 * Two services read 'Unknown' and they are unknown for entirely different
 * reasons: Zendesk's SSP answers and publishes no per-service status, while
 * M365's Graph feed has never authenticated at all. The contract records that
 * difference in exactly one machine-readable place — `lastSuccessfulPoll` is
 * present for the first and absent for the second — so the line is derived from
 * that field rather than from the service's name.
 */
function vendorProvenance(vendor: ServiceStatus['vendor']): string {
  return vendor.lastSuccessfulPoll === undefined
    // Deliberately not a paraphrase of the note above it: the note is the
    // adapter's prose and this line is the structural fact, so an operator sees
    // 'no poll on record' even if the prose is later rewritten.
    ? 'No successful poll on record.'
    : `Last successful poll ${ageLabel(vendor.lastSuccessfulPoll)} ago.`;
}

/** Ours: the newest probe on the page, tying the half-card to the table below. */
function oursProvenance(runs: CheckRun[]): string {
  const newest = runs[0];
  return newest === undefined
    ? 'No probe has run yet.'
    : `Last check run ${ageLabel(newest.at)} ago.`;
}

const RESULT_WORD: Record<CheckRun['result'], string> = {
  pass: 'Pass',
  fail: 'Fail',
  timeout: 'Timeout',
};

/** A probe result is not a StatusLevel, but it must not invent its own palette:
 *  a passing probe is the operational green and a failed one the outage red,
 *  both by way of the one mapping. */
const RESULT_LEVEL: Record<CheckRun['result'], StatusLevel> = {
  pass: 'operational',
  fail: 'outage',
  timeout: 'outage',
};

const CHECK_COLUMNS: Column<CheckRun>[] = [
  { key: 'at', label: 'Time', render: (v) => clockOf(String(v)) },
  { key: 'check', label: 'Check' },
  { key: 'region', label: 'Region' },
  {
    key: 'result',
    label: 'Result',
    render: (v) => {
      const result = v as CheckRun['result'];
      return (
        <span style={{ color: statusColor(RESULT_LEVEL[result]), fontWeight: 600 }}>
          {RESULT_WORD[result]}
        </span>
      );
    },
  },
  {
    key: 'latencyMs',
    label: 'ms',
    align: 'right',
    // A timeout has no latency. An em dash, never a 0, which would read as an
    // extremely fast probe.
    render: (v) => (v === null ? '—' : String(v)),
  },
];

export default function ServiceDetail() {
  const { id } = useParams();
  const { mode } = useDemoMode();
  const service = serviceById(mode, id ?? '');

  if (!service) {
    return (
      <div data-testid="view-service">
        <Panel
          state={{
            kind: 'error',
            source: 'Service detail',
            message: `${id ?? ''} is not a monitored service`,
          }}
        >
          {null}
        </Panel>
      </div>
    );
  }

  const runs = checkRunsFor(mode, service.id);
  const checkState: PanelState =
    runs.length === 0
      ? { kind: 'empty', message: 'No check runs recorded in this window.' }
      : { kind: 'ready' };

  return (
    <div data-testid="view-service" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* README § 2: two side-by-side cards, 1fr 1fr, gap 12. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <HalfCard
          overline="Vendor status page"
          level={service.vendor.level}
          label={service.vendor.label}
          note={service.vendor.note}
          provenance={vendorProvenance(service.vendor)}
          dotTestId="vendor-dot"
        />
        <HalfCard
          overline="Our synthetic checks"
          level={service.ours.level}
          label={service.ours.label}
          note={service.ours.note}
          provenance={oursProvenance(runs)}
          dotTestId="ours-dot"
        />
      </div>

      <Card style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700 }}>
            Response time · last 24h
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            {`p50 ${service.p50Ms} ms · p95 ${service.p95Ms} ms`}
          </span>
        </div>
        <div data-testid="response-chart">
          <Sparkline
            values={service.spark}
            color={statusColor(service.ours.level)}
            height={120}
            viewBoxHeight={30}
          />
        </div>
      </Card>

      {/* README § 2: repeat(auto-fit, minmax(150px, 1fr)), gap 12. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <StatCard label="Uptime (30d)" value={`${(service.uptime30d * 100).toFixed(2)}%`} note="rolling 30 days" />
        <StatCard
          label="Checks passing"
          value={`${service.ours.passing} / ${service.ours.total}`}
          note="synthetic probes"
          valueColor={statusColor(service.ours.level)}
        />
        <StatCard label="Incidents (90d)" value={String(service.incidents90d)} note="opened and closed" />
        <StatCard label="Last state change" value={`${ageLabel(service.lastStateChange)} ago`} />
      </div>

      <Card padding="0" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px' }}>
          <SectionHeading meta={`${service.short} · newest first`}>Check history</SectionHeading>
        </div>
        <Panel state={checkState}>
          <Table columns={CHECK_COLUMNS} rows={runs} dense />
        </Panel>
      </Card>
    </div>
  );
}
