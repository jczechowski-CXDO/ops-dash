import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { BlockedMessage, EmailSnapshot } from '@ops-dash/shared';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import { fixtures, type DemoMode } from '../fixtures/index.js';
import Email from './Email.js';

const at = (opts: { mode?: DemoMode; snapshot?: Partial<EmailSnapshot> } = {}) => {
  const base = fixtures[opts.mode ?? 'sev1'].email;
  const merged = opts.snapshot ? { ...base, ...opts.snapshot } : undefined;
  const path = opts.mode ? `/email?demo=${opts.mode}` : '/email';
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <DemoModeProvider>
          <Routes>
            <Route path="/email" element={merged ? <Email snapshot={merged} /> : <Email />} />
          </Routes>
        </DemoModeProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
};

const stats = () => within(screen.getByTestId('email-stats'));

const bodyRows = (name: string) =>
  within(within(screen.getByRole('region', { name })).getByRole('table'))
    .getAllByRole('row')
    .slice(1);

/** A message shaped like the fixtures but never equal to one — redacted the same
 *  way, because the redaction rule binds constructed test data too. */
const message = (over: Partial<BlockedMessage> = {}): BlockedMessage => ({
  at: fixtures.sev1.email.recentBlocked[0]!.at,
  from: 'billing@invoice-secure.net',
  to: 'ap@example.com',
  subject: 'Outstanding invoice #88214',
  reason: 'Credential phishing',
  ...over,
});

describe('Email', () => {
  it('computes the blocked percentage from the snapshot', () => {
    at();
    expect(stats().getByText('21.3% of inbound')).toBeInTheDocument();
    expect(stats().getByText('18,402')).toBeInTheDocument();
    expect(stats().getByText('3,911')).toBeInTheDocument();
  });

  it('keeps the blocked note equal to blocked over processed, whatever they are', () => {
    // The relationship, over shapes the fixtures do not contain — including the
    // zero-inbound case, where a percentage would be NaN and must not be shown.
    const shapes: { blocked: number; processed: number; note: string }[] = [
      { blocked: 3911, processed: 18402, note: '21.3% of inbound' },
      { blocked: 3402, processed: 17960, note: '18.9% of inbound' },
      { blocked: 1, processed: 3, note: '33.3% of inbound' },
      { blocked: 0, processed: 0, note: 'no inbound messages' },
    ];
    const base = fixtures.sev1.email.stats;
    for (const shape of shapes) {
      const { unmount } = at({
        snapshot: { stats: { ...base, blocked24h: shape.blocked, processed24h: shape.processed } },
      });
      expect(stats().getByText(shape.note)).toBeInTheDocument();
      unmount();
    }
  });

  it('signs the credential-phishing trend and tints a rise red', () => {
    const base = fixtures.sev1.email.stats;
    const { unmount } = at();
    expect(stats().getByText('+9 vs yesterday')).toBeInTheDocument();
    expect(stats().getByText('38')).toHaveStyle({ color: 'var(--error-dark)' });
    unmount();
    at({ snapshot: { stats: { ...base, credentialPhishing24h: 11, credentialPhishingDelta: -6 } } });
    expect(stats().getByText('-6 vs yesterday')).toBeInTheDocument();
    expect(stats().getByText('11')).toHaveStyle({ color: 'var(--warning-dark)' });
  });

  it('renders the recently-blocked table with redacted recipients', () => {
    at();
    expect(screen.getByRole('cell', { name: 'Outstanding invoice #88214' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'billing@invoice-secure.net' })).toBeInTheDocument();

    // Positive form (lead's ruling): the Sender column is exactly the
    // snapshot's senders — the prototype's synthetic hostile domains, which are
    // deliberately real-looking and deliberately not ours.
    const senders = bodyRows('Recently blocked').map(
      (r) => within(r).getAllByRole('cell')[1]?.textContent ?? '',
    );
    expect(senders).toEqual(fixtures.sev1.email.recentBlocked.map((m) => m.from));

    // README § 6 cuts the recipient column for width, so no recipient address
    // reaches the screen at all — the strongest redaction claim available here,
    // and a claim about this view rather than a re-run of the global guard.
    for (const m of fixtures.sev1.email.recentBlocked) {
      expect(screen.queryByText(m.to)).not.toBeInTheDocument();
    }
  });

  it('renders an undocumented reason rather than dropping or mis-tinting it', () => {
    // BlockedMessage.reason collapses to `string` in the type system, and the
    // fixtures deliberately cover neither Malware nor Spam nor anything a future
    // adapter might invent. The default branch is proven here, not by data.
    at({
      snapshot: {
        recentBlocked: [
          message({ reason: 'Bulk sender policy', subject: 'Quarterly newsletter' }),
          message({ reason: 'Malware', subject: 'Scanned document' }),
          message({ reason: 'Spam', subject: 'Limited time offer' }),
        ],
      },
    });
    expect(screen.getByRole('cell', { name: 'Bulk sender policy' })).toBeInTheDocument();
    expect(screen.getByText('Bulk sender policy')).toHaveStyle({ color: 'var(--text-primary)' });
    expect(screen.getByText('Malware')).toHaveStyle({ color: 'var(--error-dark)' });
    expect(screen.getByText('Spam')).toHaveStyle({ color: 'var(--text-primary)' });
    expect(bodyRows('Recently blocked')).toHaveLength(3);
  });

  it('never lets a sender or subject reach an href, a src or an HTML sink', () => {
    at({
      snapshot: {
        recentBlocked: [
          message({
            from: 'attacker@invoice-secure.net',
            subject: '<img src=x onerror=alert(1)> click https://example.net/pay',
          }),
        ],
      },
    });
    const region = screen.getByRole('region', { name: 'Recently blocked' });
    expect(within(region).queryAllByRole('link')).toHaveLength(0);
    expect(within(region).queryAllByRole('img')).toHaveLength(0);
    expect(region.querySelectorAll('img, a, iframe, script')).toHaveLength(0);
    // Rendered as text, escaped by React — the operator sees the payload, the
    // browser does not run it.
    expect(
      screen.getByText('<img src=x onerror=alert(1)> click https://example.net/pay'),
    ).toBeInTheDocument();
  });

  it('shows an empty state rather than zeros when there is nothing blocked', () => {
    at({ snapshot: { recentBlocked: [] } });
    expect(screen.getByText(/No messages blocked in the last 24 hours/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('keeps the heading count equal to the rows beneath it', () => {
    const base = fixtures.sev1.email.recentBlocked;
    const shapes: BlockedMessage[][] = [
      base,
      base.slice(0, 1),
      fixtures.quiet.email.recentBlocked,
      [],
    ];
    for (const recentBlocked of shapes) {
      const { unmount } = at({ snapshot: { recentBlocked } });
      const meta = recentBlocked.length === 1 ? '1 message' : `${recentBlocked.length} messages`;
      expect(screen.getByText(meta)).toBeInTheDocument();
      expect(recentBlocked.length === 0 ? [] : bodyRows('Recently blocked')).toHaveLength(
        recentBlocked.length,
      );
      unmount();
    }
  });

  it('shows the quiet world its own volumes', () => {
    at({ mode: 'quiet' });
    expect(stats().getByText('17,960')).toBeInTheDocument();
    expect(stats().getByText('18.9% of inbound')).toBeInTheDocument();
    expect(stats().queryByText('+9 vs yesterday')).not.toBeInTheDocument();
  });

  it('paints no word with a decoration-grade -main token', () => {
    // Call-site level, deliberately. The browser-free contrast suite asserts
    // that severityTextColor() returns a readable colour — a property of the
    // FUNCTION, not of any call site — so it stays green while a call site
    // bypasses the helper with a raw literal. That bypass is what produced G3's
    // 42 failures across these three screens, and a published fix cannot reach
    // a call site that calls nothing. This walks what was actually rendered.
    //
    // `color` only: `-main` remains correct on a dot, a 3px border and a
    // LinearProgress bar, which are `background` and judged at the 3:1 non-text
    // bar. It is words this rules out.
    for (const opts of [{}, { mode: 'quiet' as const }, { snapshot: { recentBlocked: [message({ reason: 'Bulk sender policy' }), message({ reason: 'Malware' }), message({ reason: 'Impersonation' })] } }]) {
      const { container, unmount } = at(opts);
      const offenders = [...container.querySelectorAll<HTMLElement>('*')]
        .filter((el) => /-main\)/.test(el.style.color))
        .map((el) => `${el.textContent?.slice(0, 30)} => ${el.style.color}`);
      expect(offenders).toEqual([]);
      unmount();
    }
  });

  it('keeps the view testid the shell asserts', () => {
    at();
    expect(screen.getByTestId('view-email')).toBeInTheDocument();
  });
});
