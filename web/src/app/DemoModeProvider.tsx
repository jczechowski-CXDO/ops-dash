/// <reference types="vite/client" />
// The reference is load-bearing: `import.meta.env` is a Vite ambient type, and
// without it `tsc -b` fails with TS2339 while Vitest — which transpiles web
// without typechecking it — reports a clean run. The plan's Step 4 source has
// no reference and does not compile.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { fixtures, type DemoMode, type FixtureBundle } from '../fixtures/index.js';

const Ctx = createContext<{ mode: DemoMode; setMode: (m: DemoMode) => void; bundle: FixtureBundle } | null>(null);

/** Which world we show when nothing asks for one. */
export const DEFAULT_MODE: DemoMode = 'sev1';

/** The query parameter that selects a world: `?demo=quiet`. */
export const DEMO_PARAM = 'demo';

/** Whether the sidebar's segmented control is rendered. Dev-only, as the plan
 *  and the README both intend — in production the toggle is an affordance we do
 *  not want. It gates the CONTROL, not the mode: `?demo=` below works in every
 *  build, because Task 10A screenshots the production bundle and a mode nothing
 *  can reach there is a mode that ships unbaselined (G2 HIGH-2). Milestone 4
 *  deletes this provider along with the footer. */
export const DEMO_TOGGLE_VISIBLE = import.meta.env.DEV;

/** A tripwire, not a lookup. If `DemoMode` gains a third world this object stops
 *  compiling, which is the only way `parseDemoMode` below — deliberately written
 *  as explicit literal comparisons so that no cast is involved — gets noticed. */
const ALL_MODES: Record<DemoMode, true> = { quiet: true, sev1: true };
void ALL_MODES;

/**
 * A query parameter is input from outside our own source, so it is parsed to the
 * union and never cast into it. Anything that is not exactly one of the two
 * literals — a case variant, an empty string, a script tag, an absent parameter
 * — yields null and the caller falls back to the default. The value is used only
 * to pick a fixture bundle; it reaches no href, src, style or HTML sink, and the
 * rejected string is never echoed back to the page.
 */
export function parseDemoMode(raw: string | null): DemoMode | null {
  return raw === 'quiet' || raw === 'sev1' ? raw : null;
}

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [params] = useSearchParams();
  const requested = parseDemoMode(params.get(DEMO_PARAM));
  const [mode, setMode] = useState<DemoMode>(requested ?? DEFAULT_MODE);

  // An explicit request wins, including when it arrives by navigation rather
  // than on first load. With no parameter the current mode stands, so the
  // sidebar control keeps working and a plain link does not reset the view.
  useEffect(() => {
    if (requested) setMode(requested);
  }, [requested]);

  const value = useMemo(() => ({ mode, setMode, bundle: fixtures[mode] }), [mode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemoMode() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDemoMode outside DemoModeProvider');
  return v;
}
