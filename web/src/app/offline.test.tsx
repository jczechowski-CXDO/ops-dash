import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from './DemoModeProvider.js';
import { App } from './App.js';
import { LiveDataProvider } from '../live/DataSource.js';

/**
 * The test that keeps Milestone 1's central promise from eroding while
 * Milestones 2-4 are built. It is deliberately NOT the same claim as
 * `guards.test.ts`'s one-door rule, nor the same as the Playwright offline
 * proof, and all three are worth having:
 *
 *   guards.test.ts   only `live/client.ts` NAMES a network client
 *   this file        our COMPONENTS call no network client when rendered
 *   e2e/security     the PAGE issues no off-origin request, including ones we
 *                    never wrote — a stylesheet @import, a font, a favicon
 *
 * The middle one is the only one that would catch a dependency reaching for the
 * network from inside a render, which is how this promise is most likely to be
 * broken by accident rather than by anyone writing `fetch`.
 *
 * ## What Milestone 3 changed about this claim, and what it did not
 *
 * The app can now read our own API, so "renders without touching the network"
 * is no longer true of every tree — it is true of the FIXTURE tree, which is
 * the one these routes mount and the one all 152 visual baselines photograph.
 * That is the claim worth keeping and it is exactly the claim tested here:
 * `<App/>` with no live provider above it fetches nothing, ever, on any route,
 * in either world.
 *
 * Narrowing a claim silently is how a guard becomes decoration, so the last
 * test in this file is the other half: mount the live provider and the very
 * same tree DOES fetch. Without it, this file would keep passing if the data
 * layer were deleted.
 */
describe('the scaffold is offline', () => {
  const reject = () => Promise.reject(new Error('network is disabled in Milestone 1'));
  const fetchSpy = vi.fn(reject);
  const xhrOpen = vi.fn();
  const beacon = vi.fn(() => true);

  beforeEach(() => {
    fetchSpy.mockClear();
    xhrOpen.mockClear();
    beacon.mockClear();
    vi.stubGlobal('fetch', fetchSpy);
    // Not only fetch: a spy on one API proves nothing about the others, and
    // "no network" is the claim rather than "no fetch".
    vi.stubGlobal('XMLHttpRequest', class { open = xhrOpen; send = () => {}; setRequestHeader = () => {}; });
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
  });
  afterEach(() => vi.unstubAllGlobals());

  const ROUTES = [
    '/', '/services/m365', '/incidents/INC-2291',
    '/entra', '/endpoints', '/email', '/settings',
  ];

  it.each(ROUTES)('renders %s without touching the network', (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <ThemeProvider><DemoModeProvider><App /></DemoModeProvider></ThemeProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });

  it('renders both demo worlds on every route without touching the network', () => {
    // The route list alone only ever exercises one world. Every view branches on
    // the bundle, so half the render paths would go unvisited.
    for (const mode of ['quiet', 'sev1'] as const) {
      for (const path of ROUTES) {
        const { unmount } = render(
          <MemoryRouter initialEntries={[`${path}?demo=${mode}`]}>
            <ThemeProvider><DemoModeProvider><App /></DemoModeProvider></ThemeProvider>
          </MemoryRouter>,
        );
        unmount();
      }
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });

  it('the live provider, mounted on the same tree, really does reach the network', async () => {
    // The control for the narrowed claim above. The fixture path is offline
    // BECAUSE nothing mounts the live provider — not because the data layer
    // cannot fetch. Delete `LiveDataProvider`'s poll and this test fails while
    // every assertion above stays green.
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <ThemeProvider><DemoModeProvider>
            <LiveDataProvider intervalMs={1_000_000}><App /></LiveDataProvider>
          </DemoModeProvider></ThemeProvider>
        </MemoryRouter>,
      );
    });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    // Same-origin paths only, which is the CSP's `connect-src 'self'` restated
    // as a runtime fact rather than a promise about the source.
    for (const call of fetchSpy.mock.calls) {
      expect(String((call as unknown[])[0])).toMatch(/^\/api\//);
    }
  });

  it('the spies would catch a call — they are not inert', () => {
    // A suite of "was not called" assertions passes identically against a spy
    // that can never be called. This is the control.
    void fetch('/probe').catch(() => {});
    new XMLHttpRequest().open('GET', '/probe');
    navigator.sendBeacon('/probe');
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(xhrOpen).toHaveBeenCalledOnce();
    expect(beacon).toHaveBeenCalledOnce();
  });
});
