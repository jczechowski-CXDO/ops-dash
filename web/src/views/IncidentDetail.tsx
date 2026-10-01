import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { Incident, TimelineEntry } from '@ops-dash/shared';
import { Card } from '../components/Card.js';
import { Panel } from '../components/Panel.js';
import { SectionHeading } from '../components/SectionHeading.js';
import { StatCard } from '../components/StatCard.js';
import { Button } from '../components/aurora/Button.js';
import { useDashboard, useIncidentWrites } from '../live/DataSource.js';
import { RESOLVE_REOPEN_NOTE, RESOLVE_WARNING } from './Overview.js';
import { panelStateFor } from '../live/model.js';
// One HH:MM formatter and one elapsed-span formatter for the whole repository;
// see ServiceDetail.tsx for the note on where they live.
import { span } from '../fixtures/time.js';
import { clockStamp } from '../theme/ago.js';
import { ageLabel, UNKNOWN_AGE } from '../theme/ageLabel.js';
import {
  blastTextColor,
  severityColor,
  severityFillColor,
  severityLabel,
  severityOnFillColor,
  timelineColor,
} from '../theme/statusColor.js';
// M-4: one definition of "who silenced this and until when", shared with the
// Overview row rather than retyped here. It is exported from a sibling VIEW,
// which is the wrong home for it — see the report: it belongs beside ageLabel
// in theme/, and this import is the one line that changes when it moves.
import { muteCredit } from './Overview.js';

/** README § 3: solid severity chip, radius 6, padding 3px 9px, white 11px/700. */
function SeverityChip({ incident }: { incident: Incident }) {
  return (
    <span
      style={{
        // G3 HIGH-1: fill and on-fill rungs, not -main and a literal white.
        // White on --warning-main is 2.40:1, and in the DARK palette -dark
        // lightens, so a hard-coded white collapses to 1.75:1 there. Both
        // tokens are theme-aware; the chip is readable in both.
        background: severityFillColor(incident.severity),
        color: severityOnFillColor(incident.severity),
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
  const { services } = useDashboard();
  // Only a service we are actually showing gets a link. A list that has not
  // loaded yields none, which renders the id as text — the same treatment as an
  // incident belonging to a product source that is not one of the seven tiles,
  // and the right one: a link to a page that will say "not a monitored service"
  // is worse than no link.
  const service = services.data?.find((s) => s.id === serviceId);

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
      // Link text, so the readable rung — --primary-main is decoration grade.
      style={{ fontSize: 12.5, color: 'var(--primary-dark)', textDecoration: 'none', fontWeight: 600 }}
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
      <div
        data-testid="timeline-time"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}
      >
        {clockStamp(entry.at)}
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
  const dashboard = useDashboard();
  const incidents = dashboard.incidents;
  const incident = injected ?? incidents.data?.find((i) => i.id === id);

  // M-4. Seeded FROM THE CONTRACT, not from false: INC-2286 arrives already
  // acknowledged and INC-2288 already muted, and a hero that offers
  // "Acknowledge" on an incident the Overview row shows as acknowledged is two
  // screens disagreeing about the same record. `ackedHere` is separate from
  // `acked` because the credit differs: an ack that happened in this session is
  // "by you", one that arrived on the record belongs to whoever did it.
  // Milestone 4 persists these; until then the flip is the whole behaviour.
  const [ackedHere, setAckedHere] = useState(false);
  const [mutedHere, setMutedHere] = useState(false);
  const [resolvedHere, setResolvedHere] = useState(false);
  /**
   * The live half. `null` on the fixture path, where the flip above IS the
   * whole behaviour and cannot fail.
   *
   * Called before the `!incident` early return because it is a hook. Nothing
   * about it is conditional; only what the buttons do with it is.
   */
  const writes = useIncidentWrites();

  if (!incident) {
    // G3 HIGH-2. The Sidebar links straight here, so in the quiet world this is
    // the FIRST thing an operator sees after one click — over a system with
    // nothing wrong with it. `Panel`'s error state is documented as a source
    // failure and renders a red alert; an id that is not open is neither a
    // failure nor a surprise. Empty state, and copy that says what is true:
    // when nothing is open, nothing being found is the good outcome.
    // And before either of those: if the LIST has not answered, the state of
    // this page is the state of the list. "No incidents are open, that is the
    // good outcome" over a dead API is the wrong-green this product exists to
    // refuse, one screen further along than anyone has looked for it.
    const list = incidents.data;
    const nothingOpen = list !== undefined && list.length === 0;
    return (
      <div data-testid="view-incident">
        <Panel
          state={
            list === undefined
              ? panelStateFor(incidents, 'Incidents')
              : {
                  kind: 'empty',
                  message: nothingOpen
                    ? `No incidents are open, so there is nothing to show for ${id ?? ''}. That is the good outcome.`
                    : `There is no open incident ${id ?? ''}. It may already be resolved, or the id may be wrong.`,
                }
          }
        >
          {null}
        </Panel>
      </div>
    );
  }

  const elapsedMinutes = Math.max(0, Math.round((Date.now() - new Date(incident.openedAt).getTime()) / 60_000));

  /**
   * Live and demo read the same three booleans from different evidence.
   *
   * On the live path nothing is anticipated: the server's reply wins where it
   * exists, otherwise what the poll hydrated. `ackedHere` deliberately plays no
   * part — an optimistic tick over a write that 401'd tells the operator the
   * alert is handled when it is not, which is the most direct wrong-green this
   * screen can produce.
   */
  const write = writes === null ? undefined : writes.writeFor(incident.id);
  const acked =
    writes === null ? ackedHere || incident.ack !== undefined : Boolean(write?.ack ?? incident.ack);
  const muted =
    writes === null
      ? mutedHere !== (incident.muted !== undefined)
      : Boolean(write?.muted ?? incident.muted);
  const resolved =
    writes === null
      ? resolvedHere || incident.resolvedAt !== undefined
      : write?.resolved === true || incident.resolvedAt !== undefined;
  const pending = write?.pending === true;

  /**
   * M-4. `ack.at` was carried by the contract and dropped on the floor, so the
   * hero credited an actor with no time while the mute beside it said exactly
   * when it expires. Both now say when — in the form each kind of time needs:
   * an ack is a past event, so it takes `ageLabel`'s elapsed magnitude, and a
   * mute is a deadline, so it keeps `clockOf`'s wall clock. Using one form for
   * both would print "Acknowledged at 10:58" for something two days old.
   */
  /**
   * An unparseable timestamp DROPS the time rather than composing it.
   * "Acknowledged by X an unknown age ago" renders a bad timestamp as prose, and
   * prose is the one form nobody double-checks. Panel.tsx makes the same branch
   * for the same reason; `ServiceDetail`'s two `ago` sites still compose bare,
   * which is the gap queued at 0fdc154 — the hoist that gives this a home must
   * carry THIS branch, not the bare composition, or it will standardise the bug.
   */
  const ackCredit = (ack: NonNullable<Incident['ack']>): string => {
    const age = ageLabel(ack.at);
    return age === UNKNOWN_AGE
      ? `Acknowledged by ${ack.by}`
      : `Acknowledged by ${ack.by} · ${age} ago`;
  };

  // The reply's flags outrank the polled ones for the same reason as the
  // Overview row: a live ack is true here up to 30 seconds before the poll
  // carries it, and crediting only `incident.ack` would print "Acknowledged by
  // you" for an action the server attributed to a named session.
  const ackFlag = write?.ack ?? incident.ack;
  const mutedFlag = write?.muted ?? incident.muted;
  const credits: string[] = [];
  if (ackFlag) credits.push(ackCredit(ackFlag));
  else if (ackedHere) credits.push('Acknowledged by you');
  if (mutedFlag) credits.push(muteCredit(mutedFlag, 'you'));
  else if (mutedHere) credits.push(muteCredit(undefined, 'you'));

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
              {`Opened ${clockStamp(incident.openedAt)} · ${span(elapsedMinutes)} elapsed`}
            </span>
            <AffectedService serviceId={incident.serviceId} />
          </div>

          <h2 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 21, fontWeight: 700, letterSpacing: '-0.015em' }}>
            {incident.title}
          </h2>

          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)', maxWidth: '70ch', textWrap: 'pretty' }}>
            {incident.summary}
          </p>

          {credits.length > 0 ? (
            <div data-testid="incident-credits" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {credits.join(' · ')}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              disabled={acked || pending}
              onClick={() => (writes === null ? setAckedHere(true) : writes.run('ack', incident.id))}
            >
              {/* 'by you' only when it WAS you. An ack that arrived on the
                  record is credited to its actor on the line above. */}
              {ackedHere ? 'Acknowledged by you' : acked ? 'Acknowledged' : 'Acknowledge'}
            </Button>
            <Button
              variant="outlined"
              color="neutral"
              disabled={pending}
              onClick={() =>
                writes === null
                  ? setMutedHere((m) => !m)
                  : writes.run(muted ? 'unmute' : 'mute', incident.id)
              }
            >
              {muted ? 'Unmute service' : 'Mute service'}
            </Button>
            <Button
              variant="outlined"
              color="success"
              disabled={resolved || pending}
              onClick={() => (writes === null ? setResolvedHere(true) : writes.run('resolve', incident.id))}
            >
              {resolved ? 'Resolved' : 'Mark resolved'}
            </Button>
          </div>

          {/* Live only, and only about OUR write. A failure must never leave
              this hero looking as though the action took. */}
          {write?.error === undefined ? null : (
            <div
              data-testid="write-error"
              role="alert"
              style={{ fontSize: 12, color: blastTextColor('error') }}
            >
              {`That did not save — ${write.error.message}`}
            </div>
          )}
          {write?.resolved === true ? (
            <div data-testid="resolve-note" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {RESOLVE_REOPEN_NOTE}
            </div>
          ) : writes === null || resolved ? null : (
            <div data-testid="resolve-warning" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {RESOLVE_WARNING}
            </div>
          )}
        </div>
      </Card>

      <SectionHeading meta="what this incident is costing us right now">Blast radius</SectionHeading>
      {/* An empty blast radius is a designed state, not a blank strip. The
          engine computes these metrics and the `incidents` table has no column
          for them, so every live incident arrives with none — which is a fact
          about our store and is said as one, rather than rendered as a gap
          between two headings. */}
      <Panel
        state={
          incident.blastRadius.length === 0
            ? { kind: 'empty', message: 'No blast-radius metrics are recorded for this incident.' }
            : { kind: 'ready' }
        }
      >
      {/* README § 3: repeat(auto-fit, minmax(170px, 1fr)), gap 12, values 24px/700. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        {incident.blastRadius.map((metric) => (
          <div key={metric.label} data-testid="blast-metric">
            <StatCard
              label={metric.label}
              value={metric.value}
              note={metric.note}
              valueSize={24}
              valueColor={blastTextColor(metric.level)}
            />
          </div>
        ))}
      </div>
      </Panel>

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
