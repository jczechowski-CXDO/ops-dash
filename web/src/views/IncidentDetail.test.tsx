import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import type { Incident } from '@ops-dash/shared';
import { ageLabel, UNKNOWN_AGE } from '../theme/ageLabel.js';
import { clockOf } from '../fixtures/time.js';
import {
  blastTextColor,
  severityColor,
  severityFillColor,
  severityLabel,
  severityOnFillColor,
} from '../theme/statusColor.js';
import { fixtures, serviceById, type DemoMode } from '../fixtures/index.js';
import IncidentDetail from './IncidentDetail.js';

const at = (id: string, mode: DemoMode = 'sev1', props: { incident?: Incident } = {}) =>
  render(
    <MemoryRouter initialEntries={[`/incidents/${id}?demo=${mode}`]}>
      <ThemeProvider><DemoModeProvider>
        <Routes><Route path="/incidents/:id" element={<IncidentDetail {...props} />} /></Routes>
      </DemoModeProvider></ThemeProvider>
    </MemoryRouter>,
  );

/** G3 HIGH-1: blast values are 24px/700 WORDS, so the text rung. --warning-main
 *  is 2.40:1 on light paper and fails even the 3:1 large-text bar.
 *
 *  Spelled out rather than computed from `blastTextColor`, on purpose. These
 *  literals are what the Playwright baselines will photograph, so they pin the
 *  PIXELS; the test immediately below pins them to the published mapping. Two
 *  assertions, because they are two different claims — "the view uses the one
 *  mapping" and "that mapping still resolves to the colours we baselined". A
 *  single computed expectation would satisfy the first and silently follow the
 *  helper through any future change of the second. */
const LEVEL_COLOR = {
  normal: 'var(--text-primary)',
  warning: 'var(--warning-dark)',
  error: 'var(--error-dark)',
} as const;

describe('IncidentDetail — the blast mapping is the published one', () => {
  // G3 HIGH-4. The local copy this view carried was identical to
  // `blastTextColor` on all three levels, so adopting it moved no pixels; this
  // is that comparison, kept in the tree rather than done once and reported.
  it('agrees with blastTextColor on every level', () => {
    for (const level of ['normal', 'warning', 'error'] as const) {
      expect(blastTextColor(level), level).toBe(LEVEL_COLOR[level]);
    }
  });
});

describe('IncidentDetail', () => {
  it('renders the hero with severity, id, title and summary', () => {
    at('INC-2291');
    expect(screen.getByText('SEV 1')).toBeInTheDocument();
    expect(screen.getByText('INC-2291')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Exchange Online mail delivery delays' })).toBeInTheDocument();
    // amended at G1 — G-13: EX1084221 is GONE from the fixtures and a test pins
    // its absence. We cannot read M365's vendor feed, so the advisory id could
    // never legitimately appear on this screen. Assert the absence instead.
    // Scoped to the hero: the plan's unscoped query matches twice, because the
    // timeline says the same thing in its own entry. Both matter, so both are
    // asserted, and neither is allowed to be the only one.
    const hero = within(screen.getByTestId('incident-hero'));
    expect(hero.getByText(/no vendor signal|Service Health consent/i)).toBeInTheDocument();
    expect(screen.getByText('No vendor statement available')).toBeInTheDocument();
    expect(screen.queryByText(/EX1084221/)).not.toBeInTheDocument();
  });

  it('says when the incident opened and how long it has been running', () => {
    at('INC-2291');
    // SEV1_OPENED_MINUTES_AGO is 83, so the elapsed span reads '1h 23m'.
    expect(screen.getByText(/^Opened \d\d:\d\d · 1h 23m elapsed$/)).toBeInTheDocument();
  });

  it('renders four blast-radius metrics tinted by level', () => {
    at('INC-2291');
    expect(screen.getAllByTestId('blast-metric')).toHaveLength(4);
    expect(screen.getByText('384')).toHaveStyle({ color: 'var(--error-dark)' });
    expect(screen.getByText('18m 40s')).toHaveStyle({ color: 'var(--warning-dark)' });
  });

  // One metric tinted right on one incident proves one mapping. The claim the
  // name makes is that the tint FOLLOWS the level, so it is asserted over every
  // metric of every incident — thirteen metrics across four levels of nesting.
  it('tints every blast metric from its own level, on every incident', () => {
    for (const inc of fixtures.sev1.incidents) {
      const { unmount } = at(inc.id);
      const cards = screen.getAllByTestId('blast-metric');
      expect(cards, `${inc.id}: one card per metric`).toHaveLength(inc.blastRadius.length);
      inc.blastRadius.forEach((metric, i) => {
        const card = cards[i]!;
        expect(within(card).getByText(metric.label)).toBeInTheDocument();
        expect(within(card).getByText(metric.note)).toBeInTheDocument();
        expect(within(card).getByText(metric.value), `${inc.id}/${metric.label}`)
          .toHaveStyle({ color: LEVEL_COLOR[metric.level] });
      });
      unmount();
    }
  });

  // G3 HIGH-1, asserted positively per the lead's ruling. The earlier form
  // ("no literal white") named the forbidden literal and tripped the repo's own
  // no-literal-hex guard — and it was the weaker claim anyway: "not white"
  // permits every other wrong colour, and it would still pass if we swapped the
  // contrast token and the chip went wrong. This asserts the chip IS the two
  // published rungs, over every severity the fixtures carry, not just SEV 1.
  //
  // Both sides call the same helpers, so equality alone could not tell the fill
  // rung from the decoration rung. The second assertion is what does that: the
  // fill must NOT be severityColor, which is where the prototype's unreadable
  // white-on---warning-main came from.
  it('fills the severity chip and writes on it with the published rungs', () => {
    for (const inc of fixtures.sev1.incidents) {
      const { unmount } = at(inc.id);
      const chip = screen.getByText(severityLabel(inc.severity));
      const where = `${inc.id} (${severityLabel(inc.severity)})`;

      expect(chip, where).toHaveStyle({
        background: severityFillColor(inc.severity),
        color: severityOnFillColor(inc.severity),
      });
      expect(chip, `${where}: the fill rung is not the decoration rung`)
        .not.toHaveStyle({ background: severityColor(inc.severity) });

      unmount();
    }
  });

  it('renders the timeline newest first with kind-coloured dots', () => {
    at('INC-2291');
    const rows = screen.getAllByTestId('timeline-row');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('Queue drain started');
    expect(rows[4]).toHaveTextContent('Incident opened');
    expect(rows[4]!.querySelector('[data-testid="timeline-dot"]')).toHaveStyle({ background: 'var(--text-secondary)' });
  });

  // 'Newest first' is a property of the rendered order AND of the contract's
  // ordering of `timeline`. Asserting only that row 0 is 'Queue drain started'
  // would survive a view that sorted ascending on a fixture that happened to be
  // stored ascending. Both halves, over every incident.
  it('renders the timeline in the order the contract stores it, which is newest first', () => {
    for (const inc of fixtures.sev1.incidents) {
      const { unmount } = at(inc.id);
      const rows = screen.getAllByTestId('timeline-row');
      expect(rows, `${inc.id}: one row per entry`).toHaveLength(inc.timeline.length);
      inc.timeline.forEach((entry, i) => {
        expect(rows[i], `${inc.id}: row ${i}`).toHaveTextContent(entry.title);
      });
      const times = inc.timeline.map((e) => new Date(e.at).getTime());
      expect([...times].sort((a, b) => b - a), `${inc.id}: fixture order is newest first`).toEqual(times);
      unmount();
    }
  });

  it('flips the three action labels', () => {
    at('INC-2291');
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(screen.getByRole('button', { name: 'Acknowledged by you' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mute service' }));
    expect(screen.getByRole('button', { name: 'Unmute service' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
    expect(screen.getByRole('button', { name: 'Resolved' })).toBeInTheDocument();
  });

  // LOW, carried from G0: nothing in the type system links `Incident.serviceId`
  // to a `ServiceStatus.id`, and INC-2288 belongs to Endpoint Central, which has
  // no tile. A link there would land on Service detail's not-found panel, so the
  // link exists exactly when the target does.
  it('links to the affected service only when that service has a page', () => {
    for (const inc of fixtures.sev1.incidents) {
      const { unmount } = at(inc.id);
      const target = serviceById('sev1', inc.serviceId);
      const link = screen.queryByTestId('affected-service-link');
      if (target) {
        expect(link, `${inc.id} -> ${inc.serviceId}`).toHaveAttribute('href', `/services/${target.id}`);
        expect(link).toHaveTextContent(target.name);
      } else {
        expect(link, `${inc.id} -> ${inc.serviceId} has no tile`).toBeNull();
        expect(screen.getByTestId('affected-service')).toHaveTextContent(inc.serviceId);
      }
      unmount();
    }
  });

  // M-4. `ack.at` was carried by the contract and thrown away: the hero credited
  // an actor with no time, while the mute on the row beside it said exactly when
  // it expires. Both halves now say when, and the seeded state matters more than
  // the timestamp — INC-2286 ARRIVES acknowledged, and a hero offering
  // "Acknowledge" on a record the Overview shows as acknowledged is two screens
  // disagreeing about one incident.
  it('credits an acknowledgement that arrived on the record, with its time', () => {
    const inc = fixtures.sev1.incidents.find((i) => i.ack)!;
    at(inc.id);
    const credits = screen.getByTestId('incident-credits');
    expect(credits).toHaveTextContent(inc.ack!.by);
    expect(credits).toHaveTextContent(ageLabel(inc.ack!.at));
    // Credited to its actor, not to 'you', and not still on offer.
    expect(screen.getByRole('button', { name: 'Acknowledged' })).toBeDisabled();

    // ...and NOT a clock time. This ack is two days old, so "Acknowledged at
    // 12:30" would read as today — the asymmetry with the mute's "until 16:47"
    // is load-bearing, not an inconsistency somebody should tidy up. Asserted as
    // an absence so a later tidy-up back to clockOf fails. Safe to scan the
    // whole line here: this incident carries no mute, so no legitimate clock.
    expect(inc.muted, 'this assertion assumes the ack-only incident').toBeUndefined();
    expect(credits.textContent).not.toMatch(/\d\d:\d\d/);
  });

  // The multi-word age, stolen from w3-overview's mutation pass: their regex
  // `\S+ ago` could not match "less than a minute ago", so an invented time slid
  // past an assertion written to forbid one. Any age phrasing has to survive the
  // composition, and this is the one that breaks naive patterns.
  it('composes a multi-word age without mangling it', () => {
    const base = fixtures.sev1.incidents.find((i) => i.severity === 1)!;
    at(base.id, 'sev1', {
      incident: { ...base, ack: { by: 'a.patel@example.com', at: new Date(Date.now() - 10_000).toISOString() } },
    });
    expect(screen.getByTestId('incident-credits'))
      .toHaveTextContent('Acknowledged by a.patel@example.com · less than a minute ago');
  });

  // A bad timestamp must read as a bad timestamp, never as prose. Composing
  // UNKNOWN_AGE bare gives "Acknowledged by X an unknown age ago", which is a
  // sentence, and sentences do not get double-checked.
  it('drops the time rather than composing an unknown age into prose', () => {
    const base = fixtures.sev1.incidents.find((i) => i.severity === 1)!;
    at(base.id, 'sev1', {
      incident: { ...base, ack: { by: 'a.patel@example.com', at: 'not-a-timestamp' } },
    });
    const credits = screen.getByTestId('incident-credits');
    expect(credits).toHaveTextContent('Acknowledged by a.patel@example.com');
    expect(credits.textContent).not.toContain(UNKNOWN_AGE);
    expect(credits.textContent).not.toMatch(/ ago\b/);
  });

  it('credits a mute that arrived on the record, with its expiry', () => {
    const inc = fixtures.sev1.incidents.find((i) => i.muted)!;
    at(inc.id);
    expect(screen.getByTestId('incident-credits')).toHaveTextContent(
      `Muted by ${inc.muted!.by} until ${clockOf(inc.muted!.until!)}`,
    );
    expect(screen.getByRole('button', { name: 'Unmute service' })).toBeInTheDocument();
  });

  // The relationship, over every incident: a credit line appears exactly when
  // the record carries one of the two states, and when an ack is credited it
  // always carries its time. Asserting only INC-2286 would pass against a hero
  // that hard-coded m.reyes.
  it('shows credits for exactly the incidents that carry them', () => {
    for (const inc of fixtures.sev1.incidents) {
      const { unmount } = at(inc.id);
      const credits = screen.queryByTestId('incident-credits');
      const expected = inc.ack !== undefined || inc.muted !== undefined;
      expect(credits !== null, `${inc.id}`).toBe(expected);
      if (inc.ack) {
        expect(credits, `${inc.id}: an ack with no time`).toHaveTextContent(ageLabel(inc.ack.at));
      }
      unmount();
    }
  });

  // The same mutation that survived w3-overview's pass, and it survived mine too
  // until this existed: a local click inventing a time — "Acknowledged by you ·
  // less than a minute ago" — when nothing on the record says when, because
  // nothing has been written anywhere. Milestone 4 gives the control a clock;
  // until then the honest credit has no time in it.
  //
  // Pinned by EXACT equality on the whole line, not a regex. Their survivor got
  // through a pattern written specifically to forbid it, because `\S+ ago`
  // cannot match a multi-word age; equality has no such gap, and it pins the
  // ' · ' join between the two local credits as well.
  it('invents no time for an ack or a mute taken here and now', () => {
    const inc = fixtures.sev1.incidents.find((i) => !i.ack && !i.muted)!;
    at(inc.id);
    expect(screen.queryByTestId('incident-credits'), 'nothing to credit yet').toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(screen.getByTestId('incident-credits').textContent).toBe('Acknowledged by you');

    fireEvent.click(screen.getByRole('button', { name: 'Mute service' }));
    expect(screen.getByTestId('incident-credits').textContent).toBe('Acknowledged by you · Muted by you');
  });

  // Caught by mutation: hard-coding `m.reyes@example.com` as the ack actor
  // passed every test above, because exactly one fixture incident carries an
  // ack and exactly one carries a mute, so "reads the record" and "prints the
  // only actor there is" are the same function on this data. Same defect as
  // HIGH-3, one contract field over. The seam supplies the second actor the
  // fixtures do not have — and the indefinite mute, which `until: string | null`
  // permits and no fixture exercises.
  it('credits whoever is on the record, not whoever is in the fixtures', () => {
    const base = fixtures.sev1.incidents.find((i) => i.severity === 1)!;
    const injectedAck = 'a.patel@example.com';
    const injectedMute = 'd.okafor@example.com';

    // The precondition, without which this test can go vacuous the day a fixture
    // is edited: the constructed actors must not be actors the fixtures already
    // contain. If ops-fixtures ever renamed INC-2286's acker to a.patel, a hero
    // hard-coding the fixture value would print the expected string and this
    // test would wave it through — the discriminating power would be gone and
    // nothing would say so. Derived from the fixture set, never from a literal.
    const fixtureActors = fixtures.sev1.incidents.flatMap((i) =>
      [i.ack?.by, i.muted?.by].filter((by): by is string => by !== undefined),
    );
    expect(fixtureActors, 'nothing to discriminate against').not.toHaveLength(0);
    expect(fixtureActors, 'the constructed ack actor must not exist in the fixtures')
      .not.toContain(injectedAck);
    expect(fixtureActors, 'the constructed mute actor must not exist in the fixtures')
      .not.toContain(injectedMute);

    at(base.id, 'sev1', {
      incident: {
        ...base,
        ack: { by: injectedAck, at: new Date(Date.now() - 3 * 60 * 60_000).toISOString() },
        muted: { by: injectedMute, until: null },
      },
    });

    const credits = screen.getByTestId('incident-credits');
    expect(credits).toHaveTextContent(`Acknowledged by ${injectedAck} · 3 hours ago`);
    // An indefinite mute says so by saying nothing about an expiry, rather than
    // rendering 'until null'.
    expect(credits).toHaveTextContent(`Muted by ${injectedMute}`);
    expect(credits).not.toHaveTextContent(/until/);
    // Derived, not the literal 'm.reyes@example.com' this line used to carry:
    // the point is that NO fixture actor can appear on a hero rendering someone
    // else's record, whoever the fixtures happen to name this week.
    for (const actor of fixtureActors) {
      expect(credits, `${actor} came from the fixtures, not from this record`)
        .not.toHaveTextContent(actor);
    }
  });

  it('shows a state, not a blank page, for an id that is not open', () => {
    at('INC-9999');
    expect(screen.getByText(/no open incident INC-9999/i)).toBeInTheDocument();
    expect(screen.queryAllByTestId('timeline-row')).toHaveLength(0);
  });

  // G3 HIGH-2, and the reason this one matters more than its Service detail
  // twin: the Sidebar links straight to /incidents/INC-2291, so in the quiet
  // world this page is ONE CLICK from anywhere, over a system with nothing
  // wrong with it. A red 'unavailable' alert there is a lie about a healthy
  // system, and an operator who sees it daily learns to discount red.
  it('does not cry wolf in the quiet world, where nothing being open is the good outcome', () => {
    at('INC-2291', 'quiet');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/No incidents are open/i)).toHaveTextContent('INC-2291');
  });

  it('does not cry wolf for a bad id in a world that does have incidents', () => {
    at('INC-9999');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // The two absences are not the same absence, and the copy has to know which
  // it is: 'nothing is open' is news about the system, 'no such id' is news
  // about the link you followed. Asserted as the relationship — which sentence
  // appears is decided by whether the world holds any incidents at all.
  it('tells a quiet world apart from a wrong id', () => {
    for (const mode of ['quiet', 'sev1'] as const) {
      const { unmount } = at('INC-9999', mode);
      const nothingOpen = fixtures[mode].incidents.length === 0;
      expect(screen.queryByText(/No incidents are open/i) !== null, `${mode}`).toBe(nothingOpen);
      expect(screen.queryByText(/no open incident/i) !== null, `${mode}`).toBe(!nothingOpen);
      unmount();
    }
  });

  // The designed empty state, reachable only through the seam: every fixture
  // incident has a timeline, so without an injected one this branch would ship
  // unrendered. An incident with nothing recorded on it yet is a real state —
  // it is what the first second of an auto-created incident looks like.
  it('renders the designed empty state for an incident with nothing recorded yet', () => {
    const base = fixtures.sev1.incidents[0]!;
    at('INC-2292', 'sev1', { incident: { ...base, timeline: [] } });
    expect(screen.getByText(/Nothing has been recorded on this incident yet/i)).toBeInTheDocument();
    expect(screen.queryAllByTestId('timeline-row')).toHaveLength(0);
    // The hero is still there: an empty timeline is not an empty page.
    expect(screen.getByRole('heading', { name: base.title })).toBeInTheDocument();
  });
});
