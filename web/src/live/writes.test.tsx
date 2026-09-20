import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import { LiveDataProvider } from './DataSource.js';
import type { ApiClient, ApiPath, Fetched, IncidentAction } from './client.js';
import { App } from '../app/App.js';
import { RESOLVE_REOPEN_NOTE, RESOLVE_WARNING } from '../views/Overview.js';

/**
 * The four writes, through the real screens.
 *
 * **Every assertion here is about what an operator SEES after a write**, never
 * that a request was made. That is deliberate: the read path and the write path
 * have both been wrong about this same data inside one afternoon — `ack` and
 * `muted` were hydrated by the API into a parser that dropped them, so an
 * acknowledged incident rendered as untouched with the button still inviting a
 * second click. A test asserting "we POSTed" would have passed throughout.
 *
 * The rule the live path adds, and the one most of this file exists to pin:
 * **no optimistic update.** A demo click cannot fail; a live one can — 401 when
 * a session lapsed, 404 for an incident the engine closed underneath us, or the
 * API being down — and an optimistic "Acknowledged" over a write that never
 * happened is the most direct wrong-green this product can produce. The
 * operator believes the alert is handled, and it is not.
 *
 * Redacted: people at `example.com`.
 */

const SERVED_AT = '2026-09-20T12:00:00.000Z';
const ACKED_AT = '2026-09-20T12:05:00.000Z';

/** An open Sev1, the shape `/api/incidents` serves. */
const INCIDENT = {
  id: 'INC-2291',
  ruleKey: 'vendor',
  serviceId: 'proofpoint',
  severity: 1,
  openedAt: '2026-09-20T11:30:00.000Z',
  summary: 'Mail flow degraded. Two probes failing against the Proofpoint relay.',
};

const incidentsBody = (over: Record<string, unknown> = {}) => ({
  servedAt: SERVED_AT,
  result: { data: [{ ...INCIDENT, ...over }], fetchedAt: SERVED_AT, degraded: false },
});

const SERVICES = { servedAt: SERVED_AT, services: [] };

/** What a write answers: the resulting flags, so the screen renders what is now
 *  true instead of refetching and racing its own write. */
const flagsReply = (flags: Record<string, unknown>) => ({ servedAt: SERVED_AT, id: INCIDENT.id, flags });

const ok = (json: unknown): Fetched => ({ ok: true, json });
const fail = (message: string, status?: number, code = 'unreachable'): Fetched => ({
  ok: false,
  error: { code, message, ...(status === undefined ? {} : { status }) },
});
const never = (): Promise<Fetched> => new Promise<Fetched>(() => {});

type Calls = { action: IncidentAction; id: string; body?: { until?: string | null } }[];

function clientOf(
  answer: (action: IncidentAction) => Promise<Fetched> | Fetched,
  calls: Calls,
  incidents: unknown = incidentsBody(),
): ApiClient {
  return {
    get: async (path: ApiPath) => {
      if (path === '/api/incidents') return ok(incidents);
      if (path === '/api/services') return ok(SERVICES);
      return never();
    },
    checks: async (serviceId) => fail(`no checks stub for ${serviceId}`),
    act: async (action, id, body) => {
      calls.push({ action, id, ...(body === undefined ? {} : { body }) });
      return answer(action);
    },
  };
}

const mount = (client: ApiClient, path = '/', children: ReactNode = <App />) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <DemoModeProvider>
          <LiveDataProvider client={client} intervalMs={1_000_000}>
            {children}
          </LiveDataProvider>
        </DemoModeProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );

const row = () => within(screen.getByTestId('alert-row'));
const click = async (name: RegExp | string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

/* ------------------------------------------------------- the happy path */

describe('an acknowledgement that reaches the server', () => {
  it('shows the SERVER\'s actor, not the demo name, the moment it lands', async () => {
    const calls: Calls = [];
    mount(clientOf(() => ok(flagsReply({ ack: { by: 'ops.lead@example.com', at: ACKED_AT } })), calls));
    await screen.findByTestId('alert-row');

    await click(/^Acknowledge$/);

    // What was asked.
    expect(calls).toEqual([{ action: 'ack', id: 'INC-2291' }]);
    // What an operator sees. The credit is the server's actor — this is the
    // assertion that catches the bug this test found: `state.ack` flips from
    // the reply immediately while `incident.ack` stays undefined until the next
    // poll, so crediting the incident alone fell through to the hard-coded demo
    // name and printed "Acknowledged by John H." for somebody else's action.
    expect(row().getByText(/Acknowledged by ops\.lead@example\.com/)).toBeInTheDocument();
    expect(row().queryByText(/John H\./)).not.toBeInTheDocument();
    expect(row().getByRole('button', { name: 'Acknowledged' })).toBeDisabled();
  });

  it('mutes, then offers Unmute and sends unmute — not a second mute', async () => {
    const calls: Calls = [];
    mount(clientOf(() => ok(flagsReply({ muted: { by: 'ops.lead@example.com', until: null } })), calls));
    await screen.findByTestId('alert-row');

    await click('Mute');
    expect(row().getByRole('button', { name: 'Unmute' })).toBeInTheDocument();

    // The second click must be the OPPOSITE action. A button that says Unmute
    // and posts `mute` is the kind of thing that only ever fails in production.
    await click('Unmute');
    expect(calls.map((c) => c.action)).toEqual(['mute', 'unmute']);
  });

  it('never sends a placeholder expiry — absent means indefinite', async () => {
    const calls: Calls = [];
    mount(clientOf(() => ok(flagsReply({ muted: { by: 'ops.lead@example.com', until: null } })), calls));
    await screen.findByTestId('alert-row');
    await click('Mute');
    // The server answers an unparseable expiry with 400 and writes nothing. The
    // client cannot produce that shape: no body at all, rather than `''`.
    expect(calls[0]?.body).toBeUndefined();
  });
});

/* ------------------------------------ the rule this file mostly exists for */

describe('a write that fails does not render as success', () => {
  it('leaves the button exactly as it was, and says why', async () => {
    const calls: Calls = [];
    mount(clientOf(() => fail('this route needs a session', 401, 'unauthenticated'), calls));
    await screen.findByTestId('alert-row');

    await click(/^Acknowledge$/);

    // THE assertion. Not "Acknowledged", not disabled, no credit line claiming
    // somebody picked this up.
    expect(row().getByRole('button', { name: 'Acknowledge' })).toBeEnabled();
    expect(row().queryByRole('button', { name: 'Acknowledged' })).not.toBeInTheDocument();
    expect(row().queryByText(/Acknowledged by/)).not.toBeInTheDocument();
    // And it says so, in the server's own words, in a live region.
    const problem = row().getByTestId('write-error');
    expect(problem).toHaveTextContent('this route needs a session');
    expect(problem).toHaveAttribute('role', 'alert');
  });

  it('is equally unsuccessful when the reply is about a different incident', async () => {
    // A 200 is not a success if it answers about something else. Refused rather
    // than applied to this row.
    const calls: Calls = [];
    mount(clientOf(() => ok({ servedAt: SERVED_AT, id: 'INC-9999', flags: { ack: { by: 'x@example.com', at: ACKED_AT } } }), calls));
    await screen.findByTestId('alert-row');
    await click(/^Acknowledge$/);
    expect(row().getByRole('button', { name: 'Acknowledge' })).toBeEnabled();
    expect(row().getByTestId('write-error')).toHaveTextContent(/INC-9999/);
  });

  it('refuses to double-submit while a write is in flight', async () => {
    const calls: Calls = [];
    mount(clientOf(() => never(), calls));
    await screen.findByTestId('alert-row');
    await click(/^Acknowledge$/);
    // Pending, so the button is disabled and a second click cannot queue a
    // second request against a row whose state nobody knows yet.
    expect(row().getByRole('button', { name: 'Acknowledge' })).toBeDisabled();
    expect(calls).toHaveLength(1);
  });
});

/* ------------------------------------------------- resolve, and the reopen */

describe('Resolve says what it actually does', () => {
  it('warns once before the click, at the section and not on every row', async () => {
    mount(clientOf(() => ok(flagsReply({})), []));
    await screen.findByTestId('alert-row');
    const warnings = screen.getAllByTestId('resolve-warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toHaveTextContent(RESOLVE_WARNING);
    // The one fact that changes the decision, and no more than that.
    expect(RESOLVE_WARNING).toMatch(/will reopen it/);
  });

  it('after the resolve, says all three facts INCLUDING that the ack survives', async () => {
    mount(clientOf(() => ok(flagsReply({ ack: { by: 'ops.lead@example.com', at: ACKED_AT } })), []));
    await screen.findByTestId('alert-row');
    await click(/^Resolve$/);

    const note = row().getByTestId('resolve-note');
    expect(note).toHaveTextContent(RESOLVE_REOPEN_NOTE);
    // The three facts, each pinned rather than assumed from one substring. The
    // ack surviving is the one that makes a reopen tolerable and the one a
    // short tooltip would have dropped.
    expect(RESOLVE_REOPEN_NOTE).toMatch(/Resolved/);
    expect(RESOLVE_REOPEN_NOTE).toMatch(/reopen/);
    expect(RESOLVE_REOPEN_NOTE).toMatch(/acknowledgement is kept/);
  });

  it('a resolve that FAILED offers no reassurance at all', async () => {
    // The control on the note: it must be tied to the write succeeding, not to
    // the button having been pressed.
    mount(clientOf(() => fail('no such incident', 404, 'unknown_incident'), []));
    await screen.findByTestId('alert-row');
    await click(/^Resolve$/);
    expect(row().queryByTestId('resolve-note')).not.toBeInTheDocument();
    expect(row().getByRole('button', { name: 'Resolve' })).toBeEnabled();
    expect(row().getByTestId('write-error')).toHaveTextContent('no such incident');
  });
});

/* ----------------------------------------------- the demo path is untouched */

describe('the fixture path still flips locally and asks nothing', () => {
  it('acknowledges without a provider, and issues no request', async () => {
    const calls: Calls = [];
    // No LiveDataProvider: this is Milestone 1's code path, which the 152
    // baselines photograph.
    render(
      <MemoryRouter initialEntries={['/?demo=sev1']}>
        <ThemeProvider>
          <DemoModeProvider>
            <App />
          </DemoModeProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    const rows = await screen.findAllByTestId('alert-row');
    const first = within(rows[0]!);
    await act(async () => {
      fireEvent.click(first.getByRole('button', { name: /^Acknowledge$/ }));
    });
    expect(first.getByRole('button', { name: 'Acknowledged' })).toBeDisabled();
    expect(calls).toHaveLength(0);
    // Neither live-only sentence appears in a world with no engine to reopen
    // anything — saying it there would be false.
    expect(screen.queryByTestId('resolve-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resolve-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('write-error')).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------- the detail screen */

describe('the incident detail hero writes through the same seam', () => {
  const detail = (client: ApiClient) => mount(client, `/incidents/${INCIDENT.id}`);

  it('acknowledges and credits the server\'s actor', async () => {
    const calls: Calls = [];
    detail(clientOf(() => ok(flagsReply({ ack: { by: 'ops.lead@example.com', at: ACKED_AT } })), calls));
    await screen.findByTestId('incident-hero');
    await click(/^Acknowledge$/);
    expect(calls).toEqual([{ action: 'ack', id: 'INC-2291' }]);
    expect(screen.getByTestId('incident-credits')).toHaveTextContent(/ops\.lead@example\.com/);
    expect(screen.queryByText(/Acknowledged by you/)).not.toBeInTheDocument();
  });

  it('a failed write leaves the hero offering the action again', async () => {
    detail(clientOf(() => fail('this route needs a session', 401, 'unauthenticated'), []));
    await screen.findByTestId('incident-hero');
    await click(/^Acknowledge$/);
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeEnabled();
    expect(screen.getByTestId('write-error')).toHaveTextContent('this route needs a session');
  });

  it('swaps the warning for the note once a resolve lands', async () => {
    detail(clientOf(() => ok(flagsReply({})), []));
    await screen.findByTestId('incident-hero');
    expect(screen.getByTestId('resolve-warning')).toHaveTextContent(RESOLVE_WARNING);
    await click(/^Mark resolved$/);
    expect(screen.getByTestId('resolve-note')).toHaveTextContent(RESOLVE_REOPEN_NOTE);
    expect(screen.queryByTestId('resolve-warning')).not.toBeInTheDocument();
  });
});

/* --------------------------------------------------- the hydrated read path */

describe('an incident acknowledged elsewhere arrives already acknowledged', () => {
  it('renders the other actor and offers no second click', async () => {
    // The read half of the same seam, and the defect that was live this
    // afternoon: `/api/incidents` hydrates `ack`, the parser dropped it, and an
    // incident somebody had acknowledged rendered as untouched.
    mount(
      clientOf(
        () => fail('should not be called'),
        [],
        incidentsBody({ ack: { by: 'someone.else@example.com', at: ACKED_AT } }),
      ),
    );
    await screen.findByTestId('alert-row');
    expect(row().getByRole('button', { name: 'Acknowledged' })).toBeDisabled();
    expect(row().getByText(/Acknowledged by someone\.else@example\.com/)).toBeInTheDocument();
  });
});

afterEach(() => vi.useRealTimers());
