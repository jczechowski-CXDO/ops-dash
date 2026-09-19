import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { BlastMetric, Incident, TimelineEntry } from '@ops-dash/shared';
import { Card } from '../components/Card.js';
import { Panel } from '../components/Panel.js';
import { SectionHeading } from '../components/SectionHeading.js';
import { StatCard } from '../components/StatCard.js';
import { Button } from '../components/aurora/Button.js';
import { useDemoMode } from '../app/DemoModeProvider.js';
import { incidentById, serviceById } from '../fixtures/index.js';
// One HH:MM formatter and one elapsed-span formatter for the whole repository;
// see ServiceDetail.tsx for the note on where they live.
import { clockOf, span } from '../fixtures/time.js';
import { severityColor, severityLabel, timelineColor } from '../theme/statusColor.js';

function unreachable(value: never, what: string): never {
  throw new Error(`${what}: unhandled value ${JSON.stringify(value)}`);
}

/**
 * `BlastMetric.level` is its own three-member union — not a `StatusLevel`, not a
 * `Severity` — so it gets its own exhaustive mapping rather than being coerced
 * into one of those and tinted by accident. Adding a member to the contract
 * fails `tsc` here instead of rendering an untinted number.
 */
function blastColor(level: BlastMetric['level']): string {
  switch (level) {
    case 'normal':  return 'var(--text-primary)';
    case 'warning': return 'var(--warning-main)';
    case 'error':   return 'var(--error-main)';
    default:        return unreachable(level, 'blastColor');
  }
}

/** README § 3: solid severity chip, radius 6, padding 3px 9px, white 11px/700. */
function SeverityChip({ incident }: { incident: Incident }) {
  return (
    <span
      style={{
        background: severityColor(incident.severity),
        color: '#fff' /* prototype literal */,
        borderRadius: 6,
        padding: '3px 9px',
        fontFamily: 'var(--font-ui)',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.04em',
      }}
    >
      {severityLabel(incident.severity)}
    </span>
  );
}

/**
 * Which service this incident is about.
 *
 * Nothing in the type system links `Incident.serviceId` to a `ServiceStatus.id`
 * — the contract says so in a comment, because INC-2288 belongs to Endpoint
 * Central, which is a product source and not one of the seven tiles. So the link
 * is offered only where the target page exists; everything else would send an
 * operator to Service detail's not-found panel.
 */
function AffectedService({ serviceId }: { serviceId: string }) {
  const { mode } = useDemoMode();
  const service = serviceById(mode, serviceId);

  if (!service) {
    return (
      <span data-testid="affected-service" style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--text-secondary)' }}>
        {serviceId}
      </span>
    );
  }
  return (
    <Link
      data-testid="affected-service-link"
      to={`/services/${service.id}`}
      style={{ fontSize: 12.5, color: 'var(--primary-main)', textDecoration: 'none', fontWeight: 600 }}
    >
      {service.name}
    </Link>
  );
}

/** README § 3: 60px 18px 1fr, gap 12, padding-bottom 16, newest first. */
function TimelineRow({ entry, last }: { entry: TimelineEntry; last: boolean }) {
  return (
    <div
      data-testid="timeline-row"
      style={{ display: 'grid', gridTemplateColumns: '60px 18px 1fr', gap: 12, paddingBottom: 16 }}
    >
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
        {clockOf(entry.at)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span
          data-testid="timeline-dot"
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: timelineColor(entry.kind),
            flex: '0 0 auto',
            marginTop: 4,
          }}
        />
        {last ? null : (
          <span style={{ width: 1, background: 'var(--divider)', flex: 1, minHeight: 14, marginTop: 4 }} />
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 700 }}>{entry.title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', textWrap: 'pretty' }}>{entry.body}</div>
      </div>
    </div>
  );
}

/**
 * `incident` is the injection seam (G3 HIGH-3), matching the one on
 * ServiceDetail and the `snapshot?` prop the other five views already take. It
 * lets a test construct what the fixtures do not hold — an incident with an
 * empty timeline, a severity other than 1 — rather than asserting only over the
 * four incidents that happen to exist today. The app never passes it.
 */
export default function IncidentDetail({ incident: injected }: { incident?: Incident } = {}) {
  const { id } = useParams();
  const { mode, bundle } = useDemoMode();
  const incident = injected ?? incidentById(mode, id ?? '');

  // Local, view-only state. Milestone 4 persists these; until then flipping a
  // label is the whole behaviour, and it is deliberately not written anywhere.
  const [acked, setAcked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [resolved, setResolved] = useState(false);

  if (!incident) {
    // G3 HIGH-2. The Sidebar links straight here, so in the quiet world this is
    // the FIRST thing an operator sees after one click — over a system with
    // nothing wrong with it. `Panel`'s error state is documented as a source
    // failure and renders a red alert; an id that is not open is neither a
    // failure nor a surprise. Empty state, and copy that says what is true:
    // when nothing is open, nothing being found is the good outcome.
    const nothingOpen = bundle.incidents.length === 0;
    return (
      <div data-testid="view-incident">
        <Panel
          state={{
            kind: 'empty',
            message: nothingOpen
              ? `No incidents are open, so there is nothing to show for ${id ?? ''}. That is the good outcome.`
              : `There is no open incident ${id ?? ''}. It may already be resolved, or the id may be wrong.`,
          }}
        >
          {null}
        </Panel>
      </div>
    );
  }

  const elapsedMinutes = Math.max(0, Math.round((Date.now() - new Date(incident.openedAt).getTime()) / 60_000));

  return (
    <div data-testid="view-incident" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* README § 3: hero card, 3px severity left border, padding 18px 20px. */}
      <Card padding="18px 20px" borderLeft={severityColor(incident.severity)}>
        <div data-testid="incident-hero" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <SeverityChip incident={incident} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--text-secondary)' }}>
              {incident.id}
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
              {`Opened ${clockOf(incident.openedAt)} · ${span(elapsedMinutes)} elapsed`}
            </span>
            <AffectedService serviceId={incident.serviceId} />
          </div>

          <h2 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 21, fontWeight: 700, letterSpacing: '-0.015em' }}>
            {incident.title}
          </h2>

          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)', maxWidth: '70ch', textWrap: 'pretty' }}>
            {incident.summary}
          </p>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={() => setAcked(true)}>
              {acked ? 'Acknowledged by you' : 'Acknowledge'}
            </Button>
            <Button variant="outlined" color="neutral" onClick={() => setMuted((m) => !m)}>
              {muted ? 'Unmute service' : 'Mute service'}
            </Button>
            <Button variant="outlined" color="success" onClick={() => setResolved(true)}>
              {resolved ? 'Resolved' : 'Mark resolved'}
            </Button>
          </div>
        </div>
      </Card>

      <SectionHeading meta="what this incident is costing us right now">Blast radius</SectionHeading>
      {/* README § 3: repeat(auto-fit, minmax(170px, 1fr)), gap 12, values 24px/700. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        {incident.blastRadius.map((metric) => (
          <div key={metric.label} data-testid="blast-metric">
            <StatCard
              label={metric.label}
              value={metric.value}
              note={metric.note}
              valueSize={24}
              valueColor={blastColor(metric.level)}
            />
          </div>
        ))}
      </div>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SectionHeading meta="newest first">Timeline</SectionHeading>
          {/* The contract stores `timeline` newest first and the fixtures are
              asserted to honour it, so the rendered order is the stored order —
              no local re-sort that could disagree with the times on screen. */}
          <Panel
            state={
              incident.timeline.length === 0
                ? { kind: 'empty', message: 'Nothing has been recorded on this incident yet.' }
                : { kind: 'ready' }
            }
          >
            <div>
              {incident.timeline.map((entry, i) => (
                <TimelineRow
                  key={`${entry.at}-${entry.title}`}
                  entry={entry}
                  last={i === incident.timeline.length - 1}
                />
              ))}
            </div>
          </Panel>
        </div>
      </Card>
    </div>
  );
}
