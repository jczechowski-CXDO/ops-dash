import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { DemoModeProvider, parseDemoMode, useDemoMode, DEFAULT_MODE } from './DemoModeProvider.js';

function Probe() {
  const { mode, bundle } = useDemoMode();
  return <span data-testid="probe">{`${mode}:${bundle.incidents.length}`}</span>;
}

const at = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <DemoModeProvider>
        <Probe />
      </DemoModeProvider>
    </MemoryRouter>,
  );

describe('parseDemoMode', () => {
  it('accepts exactly the two worlds', () => {
    expect(parseDemoMode('quiet')).toBe('quiet');
    expect(parseDemoMode('sev1')).toBe('sev1');
  });

  it.each([
    null,
    '',
    ' quiet',
    'QUIET',
    'Sev1',
    'quiet,sev1',
    '__proto__',
    'constructor',
    '<script>alert(1)</script>',
    'javascript:alert(1)',
    '../../etc/passwd',
  ])('rejects %j', (raw) => {
    expect(parseDemoMode(raw)).toBeNull();
  });
});

describe('DemoModeProvider', () => {
  it('defaults to the sev1 world when nothing asks for one', () => {
    at('/');
    expect(screen.getByTestId('probe')).toHaveTextContent(`${DEFAULT_MODE}:5`);
  });

  it('honours ?demo=quiet, which is how Task 10A reaches the quiet baselines', () => {
    // The sidebar control is dev-only by design, so in the production bundle
    // Playwright screenshots this is the ONLY way into the quiet world.
    at('/?demo=quiet');
    expect(screen.getByTestId('probe')).toHaveTextContent('quiet:0');
  });

  it('honours ?demo=sev1', () => {
    at('/?demo=sev1');
    expect(screen.getByTestId('probe')).toHaveTextContent('sev1:5');
  });

  it('falls back to the default on junk, and never echoes the junk', () => {
    const junk = '<img src=x onerror=alert(1)>';
    at(`/?demo=${encodeURIComponent(junk)}`);
    expect(screen.getByTestId('probe')).toHaveTextContent(`${DEFAULT_MODE}:5`);
    expect(document.body.innerHTML).not.toContain('onerror');
    expect(document.body.innerHTML).not.toContain('alert(1)');
  });

  it('is not fooled by a case variant or a prototype key', () => {
    at('/?demo=QUIET');
    expect(screen.getByTestId('probe')).toHaveTextContent(`${DEFAULT_MODE}:5`);
    at('/?demo=__proto__');
    expect(screen.getAllByTestId('probe')[1]).toHaveTextContent(`${DEFAULT_MODE}:5`);
  });
});

describe('the production bundle', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** Re-import the module graph with import.meta.env.DEV false, which is what a
   *  `vite build` produces and what Task 10A's preview server serves. The flag
   *  is read at module scope, so stubbing it demands a fresh registry. */
  async function asProductionBuild() {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    const provider = await import('./DemoModeProvider.js');
    const sidebar = await import('./Sidebar.js');
    return { ...provider, Sidebar: sidebar.Sidebar };
  }

  it('hides the footer control, as the plan intends', async () => {
    const { DEMO_TOGGLE_VISIBLE, DemoModeProvider: P, Sidebar } = await asProductionBuild();
    expect(DEMO_TOGGLE_VISIBLE).toBe(false);
    render(
      <MemoryRouter initialEntries={['/']}>
        <P><Sidebar /></P>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Quiet' })).toBeNull();
    expect(screen.queryByText('Demo state')).toBeNull();
  });

  it('still reaches the quiet world by URL, which is the only way left', async () => {
    // The whole of G2 HIGH-2. If the parameter is ever gated behind DEV like the
    // footer is, every one of the 28 visual baselines becomes sev1-only and the
    // quiet Overview ships unphotographed. This test fails the moment that
    // happens — verified by making it happen.
    const { DemoModeProvider: P, Sidebar } = await asProductionBuild();
    render(
      <MemoryRouter initialEntries={['/?demo=quiet']}>
        <P><Sidebar /></P>
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation');
    expect(within(nav).queryByText(/^\d+$/)).toBeNull();      // quiet: no open incidents, no badges
    expect(screen.queryByRole('button', { name: 'Quiet' })).toBeNull(); // and no toggle to have clicked
  });

  it('rejects junk there too', async () => {
    const { DemoModeProvider: P, Sidebar } = await asProductionBuild();
    render(
      <MemoryRouter initialEntries={['/?demo=all-green']}>
        <P><Sidebar /></P>
      </MemoryRouter>,
    );
    expect(within(screen.getByRole('navigation')).getByText('5')).toBeInTheDocument();
  });
});
