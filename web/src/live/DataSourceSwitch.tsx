import type { ReactNode } from 'react';
import { useDemoMode } from '../app/DemoModeProvider.js';
import { LiveDataProvider } from './DataSource.js';

/**
 * The one decision: fixtures or the API.
 *
 * **`?demo=quiet|sev1` wins, always.** It selects the Milestone 1 world and
 * mounts no live provider at all, so the fixture path is not merely preferred —
 * it is the same code path it has always been, with nothing fetching in the
 * background and nothing that can fail. That is what keeps the 152 visual
 * baselines still meaning what they meant: every one of them is taken through
 * `urlFor()` in `e2e/support.ts`, which always appends `?demo=`.
 *
 * **Anything else is live**, because the product is a dashboard of real vendor
 * data and a default that shows a demo is a dashboard nobody can trust at a
 * glance. An unrecognised value — `?demo=banana`, `?demo=` — is not a world, so
 * it is not the demo, and `parseDemoMode` is the same validator the rest of the
 * app uses rather than a second reading of the same parameter.
 *
 * Mounted in `main.tsx` around `<App/>`, and nowhere else. Tests that render
 * `<App/>` or a view directly mount no provider and therefore get the fixtures,
 * which is why wiring the live path cost no existing test a change.
 */
export function DataSourceSwitch({ children }: { children: ReactNode }) {
  // Asks the provider rather than re-reading the URL. Re-deriving it here made
  // this component disagree with `DemoModeProvider` after any in-app
  // navigation, because links drop `?demo=` — see `isDemo` there.
  const { isDemo } = useDemoMode();
  return isDemo ? <>{children}</> : <LiveDataProvider>{children}</LiveDataProvider>;
}
