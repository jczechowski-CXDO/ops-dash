import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'ops-dash.theme';

const Ctx = createContext<{ theme: Theme; toggle: () => void } | null>(null);

/**
 * Toggling the `dark` class on the document root is the ENTIRE dark-mode
 * implementation. Aurora's fig-tokens.css already ships the dark palette under
 * the `.dark` class (and a data-attribute twin of it), so there is nothing to
 * write here but the class. A second palette — or an OS-preference media query
 * that forks the colours — is a repository guard failure, not a style choice.
 *
 * The plan's Step 3 seeded this file with an OS-preference media query as a
 * fallback. It cannot ship: the repository guard greps web/src for exactly that
 * query and fails the build on it, which was verified by writing the plan's
 * version verbatim and watching the guard go red. The default is therefore
 * light, and the only input is the stored choice. (This comment deliberately
 * does not spell the query out — the guard would bite the prose too.)
 */

/** localStorage is not a reliable narrator. It throws in a partitioned or
 *  storage-disabled context, and it returns whatever a previous version — or a
 *  person with devtools open — put there. Both are handled here so every caller
 *  gets a Theme or nothing. */
function readStored(): Theme | null {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

function writeStored(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // A theme we cannot persist is still a theme we can render.
  }
}

function initial(): Theme {
  return readStored() ?? 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    writeStored(theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme outside ThemeProvider');
  return v;
}
