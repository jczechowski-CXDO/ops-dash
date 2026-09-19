/// <reference types="vite/client" />
// The reference is load-bearing: `import.meta.env` is a Vite ambient type, and
// without it `tsc -b` fails with TS2339 while Vitest — which transpiles web
// without typechecking it — reports a clean run. The plan's Step 4 source has
// no reference and does not compile.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { fixtures, type DemoMode, type FixtureBundle } from '../fixtures/index.js';

const Ctx = createContext<{ mode: DemoMode; setMode: (m: DemoMode) => void; bundle: FixtureBundle } | null>(null);

/** Dev-only. Milestone 4 deletes this provider along with the sidebar footer. */
export const DEMO_TOGGLE_VISIBLE = import.meta.env.DEV;

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DemoMode>('sev1');
  const value = useMemo(() => ({ mode, setMode, bundle: fixtures[mode] }), [mode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemoMode() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDemoMode outside DemoModeProvider');
  return v;
}
