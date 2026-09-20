import type { ReactNode } from 'react';
import { useParams } from 'react-router';
import type { CheckRun, StatusLevel } from '@ops-dash/shared';
import { Card } from '../components/Card.js';
import { Panel, type PanelState } from '../components/Panel.js';
import { SectionHeading } from '../components/SectionHeading.js';
import { Sparkline } from '../components/Sparkline.js';
import { StatCard } from '../components/StatCard.js';
import { Table, type Column } from '../components/aurora/Table.js';
import { useDemoMode } from '../app/DemoModeProvider.js';
import { useDashboard } from '../live/DataSource.js';
import {
  countText,
  lastSeenLine,
  panelStateFor,
  percentileText,
  sparkSamples,
  NO_VALUE,
  staleReason,
  uptimeText,
  type ServiceView,
} from '../live/model.js';
import { checkRunsFor } from '../fixtures/index.js';
// clockOf is the repository's one HH:MM formatter — the fixtures' wall-clock
// copy goes through it, so the table and the prose it describes cannot disagree.
// It lives in fixtures/time.ts because that is where it was first needed; see
// the report for the request to move it beside ageLabel in theme/ when a file
// owner is available.
import { clockOf } from '../fixtures/time.js';
import { ago } from '../theme/ago.js';
import { statusColor, statusTextColor } from '../theme/statusColor.js';

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
  extra,
}: {
  overline: string;
  level: StatusLevel;
  label: string;
  note: string;
  provenance: string;
  dotTestId: string;
  /** Lines that exist only when the feed is not current or the level was
   *  inferred — both impossible in a fixture. INSIDE the card, not in a wrapper
   *  around it: a wrapper makes the WRAPPER the grid item and the card stops
   *  stretching to the row height, which moves the layout on every service page
   *  in both worlds. Measured — it moved four of thirty-six captures. */
  extra?: ReactNode;
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
      {extra}
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
function vendorProvenance(vendor: ServiceView['vendor']): string {
  return vendor.lastSuccessfulPoll === undefined
    // Deliberately not a paraphrase of the note above it: the note is the
    // adapter's prose and this line is the structural fact, so an operator sees
    // 'no poll on record' even if the prose is later rewritten.
    ? 'No successful poll on record.'
    : `Last successful poll ${ago(vendor.lastSuccessfulPoll)}.`;
}

/**
 * Ours: the newest probe on the page, tying the half-card to the table below.
 *
 * The no-runs case is now two cases and they are different facts. With no runs
 * AND no counts, no probe has ever run — five of the seven services today. With
 * counts but no runs, the probes ran and the API does not serve the individual
 * rows: `/api/services` carries `ours.passing` and `ours.total` and there is no
 * check-runs route yet. Saying "no probe has run yet" over two passing probes
 * would be this dashboard lying in the one direction it is built not to.
 */
function oursProvenance(runs: CheckRun[], ours: ServiceView['ours']): string {
  const newest = runs[0];
  if (newest !== undefined) return `Last check run ${ago(newest.at)}.`;
  return ours.total === 0
    ? 'No probe has run yet.'
    : `${ours.passing} of ${ours.total} checks reported. Individual runs are not served by the API yet.`;
}

const RESULT_WORD: Record<CheckRun['result'], string> = {
  pass: 'Pass',
  fail: 'Fail',
  timeout: 'Timeout',
};

/** A probe result is not a StatusLevel, but it must not invent its own palette:
 *  a passing probe is the operational green and a failed one the outage red,
 *  both by way of the one mapping. The cell renders the result as a WORD, so it
 *  takes the text rung (G3 HIGH-1) — 'Pass' on --success-main measured 3.40:1
 *  against a 4.5:1 bar. */
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
        <span style={{ color: statusTextColor(RESULT_LEVEL[result]), fontWeight: 600 }}>
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

/**
 * The injection seam (G3 HIGH-3).
 *
 * The other five views take a `snapshot?` / `rules?` prop and can therefore be
 * asserted over shapes the fixtures do not contain. Without one here, every
 * assertion about this page ran over the fourteen (mode × service) pairs — and
 * across those fourteen there are only TWO distinct (id, hasPoll) combinations,
 * which align perfectly. A reviewer rewrote `vendorProvenance` to branch on
 * `id === 'm365'`, the exact thing its comment rules out, and the whole file
 * stayed green: over this data the field-derived and name-derived predicates are
 * the same function. Fourteen shapes of two combinations is two shapes.
 *
 * `service` and `runs` exist so a test can construct the combinations the
 * fixtures cannot: an unknown vendor WITH a successful poll, and an m365-id
 * service WITHOUT one. They are test-only and the app never passes them; the
 * route remains the only source of truth in the running application.
 */
/**
 * What the uptime figure actually covers.
 *
 * G5 HIGH 2. `uptime30d: 1` on a forty-minute-old install is a true statement
 * about forty minutes captioned as a month, and adding a probe today to a
 * service that was down all month produces the same reading. The number is not
 * the problem; "rolling 30 days" is.
 *
 * Only qualified when the coverage is genuinely short — a mature install says
 * "rolling 30 days" exactly as it always did, so the demo screens and the 152
 * baselines are untouched.
 */
export function uptimeCoverage(service: {
  uptime30d: number | null;
  uptimeFrom: string | null;
  uptimeSamples: number;
}): string {
  if (service.uptime30d === null || service.uptimeFrom === null) return 'no runs in the window';
  const coveredMs = Date.now() - Date.parse(service.uptimeFrom);
  const DAY = 86_400_000;
  // Within a day of the full window: the caption is honest as it stands.
  if (coveredMs >= 29 * DAY) return 'rolling 30 days';
  if (coveredMs >= DAY) {
    const days = Math.floor(coveredMs / DAY);
    return `only ${days} day${days === 1 ? '' : 's'} observed, not 30`;
  }
  const hours = Math.floor(coveredMs / 3_600_000);
  if (hours >= 1) return `only ${hours}h observed, not 30 days`;
  const minutes = Math.max(1, Math.floor(coveredMs / 60_000));
  return `only ${minutes}m observed, not 30 days`;
}

export default function ServiceDetail({
  service: injectedService,
  runs: injectedRuns,
}: {
  service?: ServiceView;
  runs?: CheckRun[];
} = {}) {
  const { id } = useParams();
  const { mode } = useDemoMode();
  const dashboard = useDashboard();
  const service = injectedService ?? dashboard.services.data?.find((s) => s.id === id);

  if (!service) {
    return (
      <div data-testid="view-service">
        {/* Two absences, and conflating them is how a loading spinner becomes
            "that service does not exist".

            If the LIST has not answered, this page's state is the list's state —
            loading, or the failure with its reason. Only once we hold a list can
            a missing id mean the id is wrong.

            G3 HIGH-2: that second case is NOT `kind: 'error'`. Panel documents
            that state as a SOURCE failure and paints it red; a route param
            naming something that does not exist is an ordinary navigation, and
            red here teaches an operator to distrust red. */}
        <Panel
          state={
            dashboard.services.data === undefined
              ? panelStateFor(dashboard.services, 'Service status')
              : {
                  kind: 'empty',
                  message: `${id ?? ''} is not a monitored service. We watch seven; pick one from the Overview.`,
                }
          }
        >
          {null}
        </Panel>
      </div>
    );
  }

  // The fixtures hold per-service check runs; the API serves none, and an empty
  // array there is "not served", not "nothing ran". The two get different
  // sentences below.
  const runs = injectedRuns ?? (dashboard.live ? [] : checkRunsFor(mode, service.id));
  const checkState: PanelState =
    runs.length === 0
      ? {
          kind: 'empty',
          message: dashboard.live
            ? 'Individual check runs are not served by the API yet; the counts above come from /api/services.'
            : 'No check runs recorded in this window.',
        }
      : { kind: 'ready' };
  const { values: sparkValues, missing: sparkMissing } = sparkSamples(service.spark);
  const feedStale = staleReason(service.feed);
  const lastSeen = lastSeenLine(service.feed);

  return (
    <div data-testid="view-service" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* README § 2: two side-by-side cards, 1fr 1fr, gap 12. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <HalfCard
          overline="Vendor status page"
          // The API's `currentLevel`, which is `unknown` the moment the newest
          // poll failed — never the stored payload's own level, which is what
          // the vendor said the last time we could read them. What they said
          // is `lastSeen` below, in the past tense, where it cannot colour
          // anything.
          level={service.vendor.level}
          label={service.vendor.label}
          note={service.vendor.note}
          provenance={vendorProvenance(service.vendor)}
          dotTestId="vendor-dot"
          extra={
            /* All three are null in both demo worlds — no fixture feed has
               ever failed and no fixture level is inferred — so nothing here
               renders on any baseline. */
            <>
              {feedStale === null ? null : (
                <div data-testid="vendor-feed-stale" style={{ fontSize: 11.5, color: 'var(--warning-dark)' }}>
                  {`This reading is stale: ${feedStale}`}
                </div>
              )}
              {lastSeen === null ? null : (
                <div data-testid="vendor-last-seen" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  {lastSeen}
                </div>
              )}
              {/* Amendment 10. A green the operator believes the vendor
                  affirmed, when it was really our own probes, is a worse lie
                  than the grey it replaced. */}
              {service.vendor.inferred === undefined ? null : (
                <div data-testid="vendor-inferred" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  {`Derived from our own evidence, not published by the vendor: ${service.vendor.inferred.basis}.`}
                </div>
              )}
            </>
          }
        />
        <HalfCard
          overline="Our synthetic checks"
          level={service.ours.level}
          label={service.ours.label}
          note={service.ours.note}
          provenance={oursProvenance(runs, service.ours)}
          dotTestId="ours-dot"
        />
      </div>

      {/* Our own store failed to answer. Every number below is then ignorance
          rather than measurement, and this says so once rather than leaving
          four em dashes to be read as four separate absences. */}
      {service.metricsError === undefined ? null : (
        <Panel
          state={{ kind: 'error', source: 'Our probe history', message: service.metricsError.message }}
        >
          {null}
        </Panel>
      )}

      <Card style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700 }}>
            Response time · last 24h
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            {percentileText(service.p50Ms, service.p95Ms)}
          </span>
        </div>
        <div data-testid="response-chart">
          {sparkValues.length === 0 ? (
            // `spark: null` is no samples at all; an all-null series is samples
            // where nothing answered. Neither is a flat line at zero, which
            // would draw a dead service as the fastest thing on the page.
            <Panel
              state={{
                kind: 'empty',
                message:
                  service.spark === null
                    ? 'No probe samples have been recorded for this service.'
                    : 'Every recent probe failed to answer, so there is nothing to plot.',
              }}
            >
              {null}
            </Panel>
          ) : (
            <Sparkline
              values={sparkValues}
              color={statusColor(service.ours.level)}
              height={120}
              viewBoxHeight={30}
            />
          )}
        </div>
        {sparkMissing === 0 ? null : (
          <div data-testid="spark-holes" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            {`${sparkMissing} of ${sparkValues.length + sparkMissing} samples are missing: those probes did not answer. The line is drawn over the ones that did.`}
          </div>
        )}
      </Card>

      {/* README § 2: repeat(auto-fit, minmax(150px, 1fr)), gap 12. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {/* No probe data is NOT 100% uptime, and it is not 0% either. An em
            dash, with the note saying why. A real 0 still prints 0.00%.

            And a figure that IS a measurement still has to say what it measured:
            on a fresh install this reads 100% after three minutes of probing,
            which is true of those three minutes and not of a month. The value
            stays — discarding a real measurement to avoid a bad caption would
            be the worse trade — and the note carries the coverage. */}
        <StatCard
          label="Uptime (30d)"
          value={uptimeText(service.uptime30d)}
          note={uptimeCoverage(service)}
        />
        <StatCard
          label="Checks passing"
          value={`${service.ours.passing} / ${service.ours.total}`}
          note="synthetic probes"
          // A stat value is text, not decoration: text rung (G3 HIGH-1).
          valueColor={statusTextColor(service.ours.level)}
        />
        {/* `0` here is a real count — a complete log with nothing in it — and
            prints as 0. Only an unreadable log prints the em dash. */}
        <StatCard
          label="Incidents (90d)"
          value={countText(service.incidents90d)}
          note={service.incidents90d === null ? 'incident log unreadable' : 'opened and closed'}
        />
        <StatCard
          label="Last state change"
          value={service.lastStateChange === null ? NO_VALUE : ago(service.lastStateChange)}
          {...(service.lastStateChange === null ? { note: 'no flip seen in the retained history' } : {})}
        />
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
