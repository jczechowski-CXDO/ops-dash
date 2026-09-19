import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright serves the PRODUCTION build, never the dev server. Two reasons,
 * both load-bearing:
 *
 *  - the dev server injects its own client and a websocket, which would make
 *    the "no request leaves our origin" assertion in e2e/security.spec.ts
 *    meaningless; and
 *  - the demo-mode footer control is `import.meta.env.DEV`-gated and stripped
 *    from the production bundle, so the world is selected by `?demo=` — which
 *    is what e2e/support.ts does, and what makes the quiet baselines exist at
 *    all (G2 HIGH-2).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: [['list']],
  // Traces and failure artefacts land inside node_modules, which .gitignore
  // already covers. The default `test-results/` is not in .gitignore — a file
  // this task does not own — and an untracked directory full of trace zips in
  // a tree several agents are staging from is an accident waiting to be
  // committed. Reported to the lead for a proper ignore entry.
  outputDir: 'node_modules/.playwright-results',
  // amended at G3 — G-16. This read 127.0.0.1 and nothing would have started:
  // `vite preview` binds localhost, which resolves to ::1 here, so 127.0.0.1 is
  // refused outright (verified: localhost -> 200, 127.0.0.1 -> connection
  // refused). Playwright's webServer health check would time out before a single
  // test ran. Keep both this and `url` below on localhost; the offline assertion
  // further down already allows either hostname, so nothing is weakened.
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    // Everything below this line exists so a baseline generated here means the
    // same thing when it is re-run somewhere else.
    //
    // The header clock renders LOCAL time, so an unpinned timezone bakes the
    // generating machine's offset into 28 PNGs and every other machine gets a
    // diff on four digits. Locale pins number and date formatting for the same
    // reason.
    timezoneId: 'UTC',
    locale: 'en-US',
    // Dark mode here is the `dark` class and nothing else, but the UA stylesheet
    // still reads the ambient preference for scrollbars and form controls. Pin
    // it so the dark baselines differ from the light ones only where OUR tokens
    // differ.
    colorScheme: 'light',
  },
  // Pixel-diff tolerance, MEASURED rather than guessed.
  //
  // The plan specified `maxDiffPixelRatio: 0.01`. That is 1% of a 1440x900
  // full-page capture — about 13,000 pixels — and it is far too loose to
  // protect anything: a mutation that changed the h1's letter-spacing on every
  // baseline moved **348 pixels** and the suite stayed green. A baseline that
  // cannot see a changed heading is decoration.
  //
  // A clean re-run of all 56 route baselines on the generating machine differs
  // by **0** pixels, so the same-machine noise floor is zero and the only thing
  // the tolerance buys is slack for a different machine's font rasterisation.
  // 40 absolute pixels is roughly a ninth of the smallest regression measured
  // here, and it applies to the small state clips too, where a ratio would have
  // been meaninglessly generous.
  //
  // Note that these baselines carry a `-linux` suffix but not a machine
  // identity: a Linux box with different fontconfig settings WILL diff, and
  // this tolerance makes that visible rather than papering over it.
  expect: { toHaveScreenshot: { maxDiffPixels: 40, animations: 'disabled' } },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'narrow-1000', use: { ...devices['Desktop Chrome'], viewport: { width: 1000, height: 900 } } },
  ],
  webServer: {
    // The build is part of the command on purpose. `vite preview` serves
    // whatever is already in dist/, so a run that skips the build compares one
    // build against itself and reports a confident, meaningless match.
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173', // amended at G3 — G-16, see above
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
