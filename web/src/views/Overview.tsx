import { useState } from 'react';
import { Link } from 'react-router';
import type { Incident, ServiceStatus, StatusLevel } from '@ops-dash/shared';
import { useDemoMode } from '../app/DemoModeProvider.js';
import { Card } from '../components/Card.js';
import { Panel, type PanelState } from '../components/Panel.js';
import { SectionHeading } from '../components/SectionHeading.js';
import { Sparkline } from '../components/Sparkline.js';
import { Button } from '../components/aurora/Button.js';
import { Icon } from '../components/aurora/Icon.js';
import { Table, type Column } from '../components/aurora/Table.js';
import {
  allOperational,
  isAffirmed,
  severityColor,
  severityFillColor,
  severityLabel,
  severityOnFillColor,
  statusColor,
} from '../theme/statusColor.js';
import { srOnly } from '../theme/srOnly.js';
import type { HistoryRow } from '../fixtures/index.js';

/** The actor credited by ack/mute/resolve in this milestone, as in the
 *  prototype. Milestone 4 replaces it with the signed-in user. */
const ACTOR = 'John H.';

/**
 * Which level a tile shows for a service with two independently-sourced halves.
 *
 * Rank order is the whole point: `unknown` outranks `operational`, so a service
 * we cannot see never inherits the green of the half we can. That makes this
 * function agree with `isAffirmed` by construction — a tile is green exactly
 * when both halves are operational — and `Overview.test.tsx` asserts that
 * equivalence over four differently-shaped lists rather than over today's seven
 * services. `maintenance` sits above `operational` for the same reason
 * (amendment 1: announced work is not an assertion of health) and below
 * `unknown`, because knowing about a maintenance window is more information
 * than having none at all.
 */
const RANK: Record<StatusLevel, number> = {
  operational: 0,
  maintenance: 1,
  unknown: 2,
  degraded: 3,
  outage: 4,
};

export function tileLevel(service: ServiceStatus): StatusLevel {
  return RANK[service.vendor.level] >= RANK[service.ours.level]
    ? service.vendor.level
    : service.ours.level;
}

/**
 * A service's state as a phrase, for the strip pill's text equivalent.
 *
 * Written to be read immediately after the service name — "Microsoft 365,
 * status unknown" — rather than as a standalone fragment, because that is how a
 * screen reader runs the pill together.
 *
 * A Record, not a switch with a fallback: an eighth `StatusLevel` stops this
 * compiling instead of announcing nothing. `unknown` says so in words for the
 * same reason `statusColor` gives it the disabled grey — the absence of
 * information is a state, and must be stated rather than omitted.
 */
const STATUS_PHRASE: Record<StatusLevel, string> = {
  operational: 'operational',
  maintenance: 'in scheduled maintenance',
  unknown: 'status unknown',
  degraded: 'degraded',
  outage: 'not responding',
};

export function statusPhrase(level: StatusLevel): string {
  return STATUS_PHRASE[level];
}

/**
 * How the seven split. `affirmed` is defined by the published predicate and
 * nothing else — the count and the verdict have one definition between them.
 * `unknown` counts services with an unmeasurable half, which is the thing the
 * strip has to name; whatever is left is `other` (degraded, outage, announced
 * maintenance), so the three buckets always partition the list.
 */
export function statusTally(services: ServiceStatus[]): {
  affirmed: number;
  unknown: number;
  other: number;
} {
  const affirmed = services.filter(isAffirmed).length;
  const unknown = services.filter(
    (s) => !isAffirmed(s) && (s.vendor.level === 'unknown' || s.ours.level === 'unknown'),
  ).length;
  return { affirmed, unknown, other: services.length - affirmed - unknown };
}

/**
 * The strip's leading overline.
 *
 * README § 1 leads the quiet strip with "ALL SYSTEMS OPERATIONAL". Amendment 1
 * makes that claim conditional and, with Zendesk's SSP and M365's pending
 * consent, permanently unreachable in production — so the all-clear is returned
 * only when `allOperational` says so, and otherwise the strip states the split
 * it can actually evidence. The overline is never rendered over a grey dot.
 */
export function stripOverline(services: ServiceStatus[]): string {
  if (allOperational(services)) return 'ALL SYSTEMS OPERATIONAL';
  const { affirmed, unknown, other } = statusTally(services);
  const parts = [`${affirmed} AFFIRMED`];
  if (unknown > 0) parts.push(`${unknown} UNKNOWN`);
  if (other > 0) parts.push(`${other} NEEDS ATTENTION`);
  return parts.join(' · ');
}

/**
 * The summary line under "Active incidents", built from the list it summarises.
 *
 * A separate function only so it can be asserted over several lists: written
 * inline, a hard-coded string that happens to match today's five incidents
 * passes every test in this file. `Overview.test.tsx` runs it over four slices.
 */
export function alertSummary(open: Incident[]): string {
  const sev = (s: 1 | 2 | 3) => open.filter((i) => i.severity === s).length;
  return `${open.length} open · ${sev(1)} Sev1 · ${sev(2)} Sev2 · ${sev(3)} Sev3`;
}

/** An empty list is a designed state, not a blank area. */
export function listState(count: number, message: string): PanelState {
  return count === 0 ? { kind: 'empty', message } : { kind: 'ready' };
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: number): string => WORDS[n] ?? String(n);
const title = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The quiet empty-state sentence.
 *
 * PLAN DEFECT (Task 7 Step 1). The plan pins this copy as "Seven monitored
 * services reporting healthy across vendor status and our own synthetic
 * checks" — the same overclaim G1 raised a blocker on and G2 fixed one string
 * further along in the header subtitle. Five of the seven are affirmed; two
 * cannot be, in this world or any other. Zero open incidents does not license
 * the claim, so the count is named and every number here is derived.
 */
function emptyStateLine(services: ServiceStatus[], lastClosed: string | undefined): string {
  const { affirmed } = statusTally(services);
  const unaffirmed = services.length - affirmed;
  const health =
    unaffirmed === 0
      ? `${title(word(services.length))} monitored services, all reporting healthy across vendor status and our own synthetic checks.`
      : `${title(word(services.length))} monitored services, ${word(affirmed)} reporting healthy across vendor status and our own synthetic checks; ${word(unaffirmed)} cannot be affirmed.`;
  return lastClosed ? `${health} Last incident closed ${lastClosed}.` : health;
}

const DOT = (size: number, color: string) => ({
  width: size,
  height: size,
  borderRadius: '50%',
  background: color,
  flex: '0 0 auto',
});

// ------------------------------------------------------------------ the strip

/** README § 1 quiet 1: one bordered radius-12 row, padding 10px 14px, wrapping
 *  flex, gap 8px; one pill per service at radius 999, padding 4px 9px, with a
 *  6px dot and an 11.5px/600 name.
 *
 *  Exported only so the test can render it over the SEV1 service list as well.
 *  The strip itself is quiet-only, and in the quiet world every service's `ours`
 *  half is operational — so vendor-level and rolled-up-level agree for all seven
 *  and no assertion made through the page can tell them apart. Rendered over the
 *  sev1 list, m365 is vendor-`unknown` with our probes failing, which is exactly
 *  the pair that separates them. A mutation announcing only `s.vendor.level`
 *  survived the whole suite until this existed. */
export function StatusStrip({ services }: { services: ServiceStatus[] }) {
  return (
    <Card padding="10px 14px" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
        }}
      >
        {stripOverline(services)}
      </div>
      {services.map((s) => (
        <Link
          key={s.id}
          data-testid="service-pill"
          to={`/services/${s.id}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--grey-grey-100)',
            borderRadius: 999,
            padding: '4px 9px',
            textDecoration: 'none',
            color: 'var(--text-primary)',
          }}
        >
          {/* G3: the dot stays --main and stays 6px. It was not the colour that
              was wrong, it was being the ONLY thing that said anything: a pill
              was [dot][name], so a screen-reader user heard "Zendesk" and learned
              nothing, while the group overline told them two of seven were
              unknown without saying which two. Darkening the dot would have
              satisfied a contrast checker and left them exactly as blind. The
              status is now text, so the dot is redundant decoration; it is an
              empty span, which carries no accessible name, so it needs no
              aria-hidden to stay out of the accessibility tree. */}
          <span data-testid="pill-dot" style={DOT(6, statusColor(tileLevel(s)))} />
          <span style={{ fontSize: 11.5, fontWeight: 600 }}>{s.short}</span>
          <span style={srOnly}>{`, ${statusPhrase(tileLevel(s))}`}</span>
        </Link>
      ))}
    </Card>
  );
}

// ------------------------------------------------------------------- the tiles

/** README § 1 sev1 1: card recipe + border-left 3px solid {statusColor},
 *  padding 10px 12px, gap 6px; row 1 a 7px dot, a 12.5px/700 name and a
 *  right-aligned 11px tabular-nums latency; row 2 the 26px sparkline; row 3 the
 *  two half-labels at 10.5px --text-secondary. */
function ServiceTile({ service }: { service: ServiceStatus }) {
  const color = statusColor(tileLevel(service));
  return (
    // The testid lives on a wrapper because `Card` takes no arbitrary props and
    // it is not my file to widen. Reported rather than worked around by writing
    // a local card.
    <div data-testid="service-tile">
      <Card
        padding="10px 12px"
        borderLeft={color}
        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span data-testid="tile-dot" style={DOT(7, color)} />
          <Link
            to={`/services/${service.id}`}
            style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', textDecoration: 'none' }}
          >
            {service.short}
          </Link>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--text-secondary)',
            }}
          >
            {service.latencyMs} ms
          </span>
        </div>
        <Sparkline values={service.spark} color={color} height={26} viewBoxHeight={26} />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10.5, color: 'var(--text-secondary)' }}>
          <span>Vendor: {service.vendor.label}</span>
          <span>Ours: {service.ours.label}</span>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------- the alert rows

type RowState = { ack: boolean; muted: boolean; resolved: boolean };

/** README § 1 sev1 2: grid 52px 1fr auto, gap 14, padding 11px 14px, card
 *  recipe + border-left 3px solid {sevColor}; a 52x22 radius-6 solid chip in
 *  white 11px/700; a 13.5px/700 clickable title over an 11.5px meta line; three
 *  small Buttons. Acknowledged/muted/resolved rows drop to opacity 0.45 and the
 *  row stays in place. */
function AlertRow({
  incident,
  state,
  onAck,
  onMute,
  onResolve,
}: {
  incident: Incident;
  state: RowState;
  onAck: () => void;
  onMute: () => void;
  onResolve: () => void;
}) {
  const color = severityColor(incident.severity);
  const dimmed = state.ack || state.muted || state.resolved;
  const credit = state.resolved
    ? `Resolved by ${ACTOR}`
    : state.ack
      ? `Acknowledged by ${ACTOR}`
      : null;
  const meta = credit ? [credit, ...incident.metaParts] : incident.metaParts;

  return (
    <div data-testid="alert-row" style={dimmed ? { opacity: 0.45 } : {}}>
      <Card
        padding="11px 14px"
        borderLeft={color}
        style={{ display: 'grid', gridTemplateColumns: '52px 1fr auto', gap: 14, alignItems: 'center' }}
      >
        {/* G3 HIGH-1. The chip is filled with the `-dark` rung, not README:77's
            `-main`, and its word takes the theme-aware `-contrast` token rather
            than a literal white. Both are the lead's ruling, recorded here so
            Task 11's fidelity pass reads the chip as a decision rather than as
            drift from the prototype: white on `--warning-main` is 2.40:1, and a
            literal white collapses further in the dark palette, where `-dark`
            lightens. The 3px row accent beside it stays `-main` (severityColor),
            which is the rung that grade is for. */}
        <span
          style={{
            width: 52,
            height: 22,
            borderRadius: 6,
            background: severityFillColor(incident.severity),
            color: severityOnFillColor(incident.severity),
            fontSize: 11,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {severityLabel(incident.severity)}
        </span>

        <div style={{ minWidth: 0 }}>
          {/* L-12: the TITLE is the click target, not the card. A `Card` with
              onClick takes role="button", and nesting the three action buttons
              inside a role="button" is as invalid for assistive technology as a
              nested <button>. */}
          <Link
            to={`/incidents/${incident.id}`}
            style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', textDecoration: 'none' }}
          >
            {incident.title}
          </Link>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{meta.join(' · ')}</div>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Button size="small" variant="outlined" color="neutral" onClick={onAck} disabled={state.ack}>
            {state.ack ? 'Acknowledged' : 'Acknowledge'}
          </Button>
          <Button size="small" variant="text" color="neutral" onClick={onMute}>
            {state.muted ? 'Unmute' : 'Mute'}
          </Button>
          <Button size="small" variant="text" color="success" onClick={onResolve} disabled={state.resolved}>
            {state.resolved ? 'Resolved' : 'Resolve'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------ recent history

/** Defect G-4: these keys are the FIXTURE's field names. The prototype called
 *  `duration` "dur"; `Column<R>`'s `keyof R & string` now refuses that, but the
 *  names are still spelled out here rather than guessed. */
const HISTORY_COLUMNS: Column<HistoryRow>[] = [
  { key: 'id', label: 'Incident', width: '120px' },
  { key: 'title', label: 'Summary' },
  { key: 'duration', label: 'Duration', align: 'right' },
  { key: 'closed', label: 'Closed', align: 'right' },
];

// ------------------------------------------------------------------- the view

export default function Overview() {
  const { bundle } = useDemoMode();
  const services = bundle.services;

  // An incident is open while it has no resolvedAt — the contract's definition,
  // the same one the sidebar badge uses. `bundle.incidents` already arrives
  // sorted severity-then-newest, which is the order this list renders.
  const open = bundle.incidents.filter((i) => !i.resolvedAt);

  /**
   * Ack/mute/resolve are local state in this milestone; Milestone 4 makes them
   * server-persisted mutations. The INITIAL state is read off the incident, so
   * `ack` and `muted` from the contract are honoured rather than ignored — but
   * no fixture incident carries either (accepted finding M-9), so that path
   * renders in no world today and only the click path is covered by a test.
   */
  const [actions, setActions] = useState<Record<string, RowState>>({});
  const stateOf = (i: Incident): RowState =>
    actions[i.id] ?? { ack: Boolean(i.ack), muted: Boolean(i.muted), resolved: Boolean(i.resolvedAt) };
  const update = (i: Incident, patch: Partial<RowState>) =>
    setActions((prev) => ({ ...prev, [i.id]: { ...stateOf(i), ...patch } }));

  const quiet = open.length === 0;

  return (
    <div data-testid="view-overview" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Status: the compressed strip when nothing is running, the expanded
          tile grid when something is. */}
      <Panel state={listState(services.length, 'No service status has been collected yet.')}>
        {quiet ? (
          <StatusStrip services={services} />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
              gap: 10,
            }}
          >
            {services.map((s) => (
              <ServiceTile key={s.id} service={s} />
            ))}
          </div>
        )}
      </Panel>

      {quiet ? (
        <div data-testid="no-incidents">
          <Card
            padding="28px 24px"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}
          >
            <Icon name="task_alt" size={34} color="var(--success-main)" />
            <div style={{ fontSize: 16, fontWeight: 700 }}>No active incidents</div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                maxWidth: 460,
                textWrap: 'pretty',
              }}
            >
              {emptyStateLine(services, bundle.recentHistory[0]?.closed)}
            </div>
          </Card>
        </div>
      ) : (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionHeading
            meta={
              <span data-testid="alert-summary">{alertSummary(open)}</span>
            }
          >
            Active incidents
          </SectionHeading>
          {open.map((incident) => {
            const state = stateOf(incident);
            return (
              <AlertRow
                key={incident.id}
                incident={incident}
                state={state}
                onAck={() => update(incident, { ack: true })}
                onMute={() => update(incident, { muted: !state.muted })}
                // Resolving also acknowledges: you cannot resolve something
                // nobody picked up.
                onResolve={() => update(incident, { ack: true, resolved: true })}
              />
            );
          })}
        </section>
      )}

      {quiet ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionHeading>Recent history</SectionHeading>
          <Panel state={listState(bundle.recentHistory.length, 'No incidents have closed in the last 30 days.')}>
            <Card padding="0" style={{ overflow: 'hidden' }}>
              <Table
                dense
                columns={HISTORY_COLUMNS}
                rows={bundle.recentHistory}
                getRowKey={(row) => row.id}
              />
            </Card>
          </Panel>
        </section>
      ) : null}
    </div>
  );
}
