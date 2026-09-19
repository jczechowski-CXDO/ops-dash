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
Node 22.22.3) against **`d91aaa6`**. Record both whenever you regenerate: when
someone sees a diff they need to know whether the app changed or the renderer
did, and the SHA is what separates those two questions. The filenames carry a `-linux` suffix, so a Windows or macOS run
will not compare against them at all — it will report them missing, which is the
correct outcome. A *different Linux box* with different fontconfig settings will
diff, and the tolerance is deliberately tight enough to say so rather than hide
it: `maxDiffPixels: 40`, measured — a clean re-run differs by 0 pixels on the
full-page captures and by 2 on the smallest state clip (antialiasing on a focus
ring), while the smallest real regression measured — an h1 letter-spacing
change — moved 348.
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

`fidelity.spec.ts` also carries an explicit M-9 coverage test, which names the
captures that hold the acknowledged/muted treatment and fails if any of them
stops holding it. "The state is on the page" and "a capture contains the state"
are different claims.

## Two tests are expected to be red

- `security.spec.ts` "the content security policy is present…" — Task 11A adds
  the meta tag to `web/index.html`. Written now, deliberately failing, per the
  plan.
- `fidelity.spec.ts` "every table keeps its last column reachable" on the
  **narrow-1000** project — `/email`'s "Recently blocked" table overflows its
  card at 1000px (753 vs 718) and the REASON column is cut mid-word. This is a
  real defect in a file this task does not own; the four
  `email-*-narrow-1000-*.png` baselines record the clipped state and must be
  regenerated once it is fixed.
