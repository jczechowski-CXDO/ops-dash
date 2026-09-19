import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
