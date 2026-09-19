# Playwright: baselines, interaction and the offline proof

```bash
npx playwright install chromium     # one-time local browser download, not a repo dependency
npm run test:e2e                    # build + preview + run everything
npm run test:e2e:update             # regenerate the PNG baselines
```

`playwright.config.ts` builds the app and serves `dist` with `vite preview` on
**localhost**:4173. Not `127.0.0.1` — that resolves to `::1` on the machine this
was written on and is refused outright (G-16).

## The baselines are platform- and machine-sensitive

148 PNGs, **generated on Linux** (Chromium 153.0.8010.12 / playwright v1243,
Node 22.22.3) against **`679852e`**. Record both whenever you regenerate: when
someone sees a diff they need to know whether the app changed or the renderer
did, and the SHA is what separates those two questions. The filenames carry a `-linux` suffix, so a Windows or macOS run
will not compare against them at all — it will report them missing, which is the
correct outcome. A *different Linux box* with different fontconfig settings will
diff, and the tolerance is deliberately tight enough to say so rather than hide
it: `maxDiffPixels: 4`. Measured, and re-measured when the numbers said the
first answer was wrong: a repeat run against the same build differs by **0**
pixels across all 114 captures (confirmed twice at zero tolerance), the largest
jitter seen across builds is **2**, the smallest real design change measured is
**16** (tiles and alert rows moving from radius 12 to 10, over twelve elements),
and the smallest regression measured is **348** (an h1 letter-spacing change).
A budget of 40 — my first answer, calibrated against the 348 alone — would have
hidden the 16.

**The method matters more than the number.** A tolerance calibrated on one
mutation is calibrated on that mutation's magnitude, which tells you nothing
about the smallest change you care about. Calibrate on the *noise floor*
instead, then check the gap: 2 pixels of jitter against 16 for the smallest real
design change is an 8x margin, and that gap is the budget. Nobody could have
guessed either number.

And note how the bad budget was caught, because it will be the same next time:
**a commit predicted a visual change, and the baselines did not move.** The
suite was green and wrong. If someone tells you a capture should have changed
and it did not, the tolerance is the first suspect.
The plan's `maxDiffPixelRatio: 0.01` is ~13,000 pixels and swallowed that whole.

## What is photographed

- **9 routes × 2 worlds × 2 themes × 2 viewports = 72** full-page captures.
  Seven routes are the nav; the other two are `/incidents/INC-2286` and
  `/incidents/INC-2288`, the acknowledged and the muted incident. INC-2291
  carries neither field, so without those two the whole opacity-0.45 treatment
  of README:81 — G1 accepted finding **M-9** — would be closed in the fixtures
  and unbaselined here.
  The world dimension matters: `?demo=quiet` is a different screen, not a
  variant, and the sidebar control that would otherwise select it is
  `import.meta.env.DEV`-gated and stripped from the production bundle.
- **76 state clips** — rest, hover, keyboard focus and disabled, in both themes,
  for the nav item, the theme toggle, the alert-row Acknowledge button, the
  alert-rule Switch, the service tile, and the acknowledged and muted alert rows. Rest-only coverage would have
  certified the 1.09:1 dark-mode Button of G1 as correct, because the proposed
  fix moved the invisible state to hover.

Every capture goes through `visit()` in `support.ts`, which refuses to proceed
until the theme really applied (`ThemeProvider` owns that class), the vendored
webfont is really the one painting (measured against a fallback stack, not just
`fonts.ready`), the clock is frozen and CSS transitions are settled. The last of
those is not cosmetic: a paused clock freezes the light→dark colour transition
part-way, and the contrast sweep reported 14 failures that do not exist.

**One test here has no unit-suite equivalent and cannot have one.** "The tile
sparkline occupies 26px and leaves a 6px gap under it" is a layout claim, and
jsdom has no layout engine — every height it reports is 0. That test is the only
possible home for the defect it pins: a `data-testid` wrapper around the SVG
measured 32px around a 26px child, because an SVG is `display: inline` and the
wrapper's line box added descender space beneath it. The SVG stayed correct at
26 while every tile grew 6px and the Overview below the grid shifted 11px. It is
the one thing in this repo that only a browser can assert.

Two limits of this suite, both measured rather than assumed, and both worth
knowing before someone trusts a green run:

- **`state-alertrow-acked/muted` cannot see a small radius change.** At
  `opacity: 0.45` the difference between a 12px and a 10px corner arc falls
  below 8-bit quantisation, so those two clips stayed byte-identical through a
  change that did alter the element. Verified in the DOM (all five rows compute
  `10px`) rather than recorded as a miss. A clip that genuinely cannot see a
  class of change is a limit to document, not a hole to plug.
- **`shotAround` clips in VIEWPORT coordinates.** An element below the fold
  produces a clip of blank page, silently. That happened the moment the tiles
  grew 6px: at 1000px the dimmed rows dropped past the viewport bottom and the
  "baseline" became an empty strip with one rounded corner in it. It was caught
  by looking at the image, not by the run. `shotAround` now scrolls when needed
  and refuses to capture a region the element does not fit inside — and scrolls
  *conditionally*, because scrolling unconditionally moves every other capture
  relative to the sticky header and rewrites baselines that were fine. The
  lesson underneath: **a fix to the capture harness is itself a change that
  moves baselines**, and needs the same "which moved and why" account as a
  change to the app.

`fidelity.spec.ts` also carries an explicit M-9 coverage test, which names the
captures that hold the acknowledged/muted treatment and fails if any of them
stops holding it. "The state is on the page" and "a capture contains the state"
are different claims.

## What is currently red — one test, by design

- `security.spec.ts` "the content security policy is present…" — Task 11A adds
  the meta tag to `web/index.html`. Written now, deliberately failing, per the
  plan.

Everything that was red here has been fixed upstream and regenerated: the 1000px
clip, the always-truncating Subject column, the 6px tile shift and the
double history entry. The only expected red is the CSP test above.
