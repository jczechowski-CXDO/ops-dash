import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { DemoModeProvider } from '../app/DemoModeProvider.js';
import { App } from '../app/App.js';
import { DataSourceSwitch } from './DataSourceSwitch.js';

/**
 * Which source a URL selects, asserted through `main.tsx`'s own component.
 *
 * This is the mechanism the 152 visual baselines depend on, and the assertion
 * is deliberately made on the FETCH rather than on what rendered: a screen can
 * look right for the wrong reason, but a request either left or it did not.
 */
describe('?demo= selects the fixtures; everything else is live', () => {
  const fetchSpy = vi.fn(async () => {
    throw new Error('no API in this test');
  });

  beforeEach(() => {
    fetchSpy.mockClear();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  const at = (entry: string) =>
    render(
      <MemoryRouter initialEntries={[entry]}>
        <ThemeProvider>
          <DemoModeProvider>
            <DataSourceSwitch>
              <App />
            </DataSourceSwitch>
          </DemoModeProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

  it.each(['/?demo=quiet', '/?demo=sev1', '/services/m365?demo=sev1'])(
    '%s reads the fixtures and issues no request',
    async (entry) => {
      at(entry);
      await screen.findByRole('navigation');
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('renders the demo world itself, not merely an offline page', async () => {
    at('/?demo=quiet');
    // The quiet world's own screen, which the live path cannot produce: it is
    // the fixtures, not an empty live dashboard that happens not to fetch.
    expect(await screen.findByTestId('no-incidents')).toBeInTheDocument();
    expect(screen.getAllByTestId('service-pill')).toHaveLength(7);
  });

  it.each(['/', '/services/m365', '/incidents/INC-2291'])('%s goes live', async (entry) => {
    // `act`, because the stubbed fetch REJECTS and the rejection lands as a
    // state update after the assertion would otherwise have finished.
    await act(async () => {
      at(entry);
    });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls.map((c) => String((c as unknown[])[0]))).toContain('/api/services');
  });

  it('a value that is not one of the two worlds is not a world', async () => {
    // `parseDemoMode` is the same validator the rest of the app uses, so
    // `?demo=banana` is not a demo request and must not silently pin the app to
    // the default fixture world with no data behind it.
    await act(async () => {
      at('/?demo=banana');
    });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  });
});
