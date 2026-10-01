import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import { LiveDataProvider } from './DataSource.js';
import type { ApiClient, ApiPath, Fetched } from './client.js';
import { App } from '../app/App.js';

/**
 * Vendor advisories on the service detail page — amendment 2 finally reaching a
 * screen.
 *
 * `incidentsSince` is *"everything published since our last SUCCESSFUL poll"*.
 * Four adapters populate it, the store keeps it, the API mirrors the snapshot
 * wholesale so it never even names the field — and `parse.ts` dropped the array,
 * so the feature the frozen contract was AMENDED for did nothing for a
 * milestone. Neither open-loop guard could see it: one scans optional fields a
 * fixture carries, the other scans optional fields, and `incidentsSince` is
 * required.
 *
 * The other half of this file is the first `href` in `web/src`. The URL is
 * vendor-supplied, so these assertions are about a security control and not a
 * layout.
 */

const SERVED_AT = '2026-09-20T12:00:00.000Z';

const advisory = (over: Record<string, unknown> = {}) => ({
  title: 'Elevated API error rates',
  level: 'degraded',
  startedAt: '2026-09-20T09:00:00.000Z',
  resolvedAt: null,
  url: 'https://status.example.com/incidents/abc123',
  ...over,
});

const servicesBody = (incidentsSince: unknown[]) => ({
  servedAt: SERVED_AT,
  services: [
    {
      id: 'jira',
      source: 'vendor:jira',
      currentLevel: 'degraded',
      platform: 'statuspage',
      result: {
        data: { platform: 'statuspage', level: 'degraded', label: 'Degraded', note: 'Investigating.', incidentsSince },
        fetchedAt: SERVED_AT,
        degraded: false,
      },
      ours: { level: 'unknown', label: 'No checks', note: 'No probe of ours has ever run.', passing: 0, total: 0 },
      latencyMs: null,
      p50Ms: null,
      p95Ms: null,
      spark: null,
      uptime30d: null,
      incidents90d: 0,
      lastStateChange: null,
    },
  ],
});

const ok = (json: unknown): Fetched => ({ ok: true, json });
const fail = (m: string): Fetched => ({ ok: false, error: { code: 'unreachable', message: m } });
const never = (): Promise<Fetched> => new Promise<Fetched>(() => {});

const clientOf = (incidentsSince: unknown[]): ApiClient => ({
  get: async (path: ApiPath) => {
    if (path === '/api/services') return ok(servicesBody(incidentsSince));
    if (path === '/api/incidents') return ok({ servedAt: SERVED_AT, result: { data: [], fetchedAt: SERVED_AT, degraded: false, empty: true } });
    return never();
  },
  checks: async () => ok({ fetchedAt: SERVED_AT, degraded: false, data: [], empty: true }),
  act: async (action) => fail(`no act stub for ${action}`),
});

const detail = (incidentsSince: unknown[]) =>
  render(
    <MemoryRouter initialEntries={['/services/jira']}>
      <ThemeProvider>
        <DemoModeProvider>
          <LiveDataProvider client={clientOf(incidentsSince)} intervalMs={1_000_000}>
            <App />
          </LiveDataProvider>
        </DemoModeProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );

describe('the vendor advisories reach the screen', () => {
  it('renders what the vendor published, which used to reach nothing at all', async () => {
    detail([advisory(), advisory({ title: 'Login delays', level: 'outage', resolvedAt: '2026-09-20T10:00:00.000Z' })]);
    const panel = within(await screen.findByTestId('vendor-advisories'));
    expect(panel.getByText('Elevated API error rates')).toBeInTheDocument();
    expect(panel.getByText('Login delays')).toBeInTheDocument();
  });

  it('says the level in words, so colour is never the only carrier', async () => {
    // The ruling that made the Overview strip pill accessible applies here: a
    // colour with no text equivalent tells a screen-reader user nothing, and
    // darkening it would satisfy a contrast checker while still saying nothing.
    detail([advisory()]);
    const panel = within(await screen.findByTestId('vendor-advisories'));
    expect(panel.getByText('Degraded')).toBeInTheDocument();
  });

  it('distinguishes an open advisory from a resolved one', async () => {
    detail([advisory(), advisory({ title: 'Login delays', resolvedAt: '2026-09-20T10:00:00.000Z' })]);
    const panel = within(await screen.findByTestId('vendor-advisories'));
    expect(panel.getByText(/opened/)).toBeInTheDocument();
    expect(panel.getByText(/resolved/)).toBeInTheDocument();
  });

  it('renders nothing at all when the vendor published nothing', async () => {
    // Not an empty box with a heading: a vendor with no advisories is the
    // ordinary case and deserves no furniture.
    detail([]);
    await screen.findByTestId('view-service');
    expect(screen.queryByTestId('vendor-advisories')).not.toBeInTheDocument();
  });
});

describe('the first href in web/src is a vetted one', () => {
  it('links the advisory, and only over https', async () => {
    detail([advisory()]);
    const panel = within(await screen.findByTestId('vendor-advisories'));
    const link = panel.getByRole('link', { name: 'Elevated API error rates' });
    expect(link).toHaveAttribute('href', 'https://status.example.com/incidents/abc123');
    // `noopener` because a target=_blank link hands the opened page a handle to
    // ours; `noreferrer` because a vendor need not learn which of our pages an
    // operator was on.
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('refuses to link a scheme that is not https, and still shows the advisory', async () => {
    // A `javascript:` URL in an href executes on click, and a local-only app is
    // still a browser. Dropped rather than sanitised — "sanitise" is how these
    // come back. The TEXT survives: an advisory we will not link to is still an
    // advisory the operator should read.
    for (const url of ['javascript:alert(1)', 'http://status.example.com/x', 'data:text/html,x', '//evil.example/x']) {
      const view = detail([advisory({ url })]);
      const panel = within(await screen.findByTestId('vendor-advisories'));
      expect(panel.getByText('Elevated API error rates'), url).toBeInTheDocument();
      expect(panel.queryByRole('link'), url).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('puts no vendor string anywhere but a text node and a vetted href', async () => {
    // The whole tree under the panel: no other attribute carries vendor text —
    // no title, no style interpolation, no src. `guards.test.ts` asserts the
    // static half of this; here it is at runtime, over a rendered advisory.
    detail([advisory({ title: '<img src=x onerror=alert(1)>' })]);
    const panel = await screen.findByTestId('vendor-advisories');
    // Markup in a headline renders as the characters it is.
    expect(within(panel).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(panel.querySelector('img')).toBeNull();
    for (const el of panel.querySelectorAll('*')) {
      expect(el.getAttribute('title'), el.tagName).toBeNull();
      expect(el.getAttribute('src'), el.tagName).toBeNull();
      expect(el.getAttribute('style') ?? '', el.tagName).not.toMatch(/url\(/);
    }
  });
});
