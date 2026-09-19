import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from './DemoModeProvider.js';
import { App } from './App.js';

/**
 * The test that keeps Milestone 1's central promise from eroding while
 * Milestones 2-4 are built. It is deliberately NOT the same claim as
 * `guards.test.ts`'s grep for `fetch(`, nor the same as the Playwright offline
 * proof, and all three are worth having:
 *
 *   guards.test.ts   our SOURCE contains no network client
 *   this file        our COMPONENTS call no network client when rendered
 *   e2e/security     the PAGE issues no off-origin request, including ones we
 *                    never wrote — a stylesheet @import, a font, a favicon
 *
 * The middle one is the only one that would catch a dependency reaching for the
 * network from inside a render, which is how this promise is most likely to be
 * broken by accident rather than by anyone writing `fetch`.
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
