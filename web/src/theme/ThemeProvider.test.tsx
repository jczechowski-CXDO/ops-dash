import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeProvider.js';

function Probe() {
  return <span data-testid="probe">{useTheme().theme}</span>;
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores a persisted choice', () => {
    localStorage.setItem('ops-dash.theme', 'dark');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByText('dark')).toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
  });

  it('ignores junk in storage rather than rendering it', () => {
    // Anything may be under this key: an older format, a typo, a person with
    // devtools open. The only two acceptable outcomes are 'light' and 'dark'.
    localStorage.setItem('ops-dash.theme', 'DARK; drop table');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('probe')).toHaveTextContent('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('survives a localStorage that throws on read and on write', () => {
    // Safari in a partitioned third-party context, and any browser with site
    // data disabled, throw from both getItem and setItem. An unhandled throw
    // here takes the whole app down before first paint.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('probe')).toHaveTextContent('light');
  });
});
