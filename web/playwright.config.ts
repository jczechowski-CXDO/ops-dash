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
  // Pixel-diff tolerance, MEASURED rather than guessed, and re-measured once the
  // numbers said the first answer was wrong.
  //
  // Four data points, all from this machine:
  //   0 px   — a repeat run against the same build, across all 114 captures,
  //            confirmed twice at zero tolerance. The noise floor is genuinely
  //            zero, not "small".
  //   2 px   — the largest jitter seen ACROSS builds, on a focus-ring clip.
  //  16 px   — the smallest real DESIGN change measured: tiles and alert rows
  //            moving from radius 12 to the prototype's 10, over twelve
  //            elements on a 1440x900 page. A 2px radius only alters a sliver
  //            of each corner, and most of that sliver sits against a
  //            same-coloured background.
  // 348 px   — the smallest REGRESSION measured, an h1 letter-spacing change.
  //
  // The plan's `maxDiffPixelRatio: 0.01` is ~13,000 pixels and swallowed the
  // 348. My own first answer, 40, was calibrated against that mutation alone
  // and would have swallowed the 16 — so a radius regression would have been
  // invisible. 4 sits above the cross-build jitter and four times below the
  // smallest change anyone has actually made here.
  //
  // These baselines carry a `-linux` suffix but not a machine identity: a Linux
  // box with different fontconfig settings WILL diff, and this tolerance makes
  // that visible rather than papering over it.
  expect: { toHaveScreenshot: { maxDiffPixels: 4, animations: 'disabled' } },
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
