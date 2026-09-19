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

124 PNGs, **generated on Linux** (Chromium 153.0.8010.12 / playwright v1243,
Node 22.22.3). The filenames carry a `-linux` suffix, so a Windows or macOS run
will not compare against them at all — it will report them missing, which is the
correct outcome. A *different Linux box* with different fontconfig settings will
diff, and the tolerance is deliberately tight enough to say so rather than hide
it: `maxDiffPixels: 40`, measured — a clean re-run here differs by 0 pixels, and
the smallest real regression measured (an h1 letter-spacing change) moved 348.
The plan's `maxDiffPixelRatio: 0.01` is ~13,000 pixels and swallowed that whole.

## What is photographed

- **7 routes × 2 worlds × 2 themes × 2 viewports = 56** full-page captures.
  The world dimension matters: `?demo=quiet` is a different screen, not a
  variant, and the sidebar control that would otherwise select it is
  `import.meta.env.DEV`-gated and stripped from the production bundle.
- **68 state clips** — rest, hover, keyboard focus and disabled, in both themes,
  for the nav item, the theme toggle, the alert-row Acknowledge button, the
  alert-rule Switch and the service tile. Rest-only coverage would have
  certified the 1.09:1 dark-mode Button of G1 as correct, because the proposed
  fix moved the invisible state to hover.

Every capture goes through `visit()` in `support.ts`, which refuses to proceed
until the theme really applied (`ThemeProvider` owns that class), the vendored
webfont is really the one painting (measured against a fallback stack, not just
`fonts.ready`), the clock is frozen and CSS transitions are settled. The last of
those is not cosmetic: a paused clock freezes the light→dark colour transition
part-way, and the contrast sweep reported 14 failures that do not exist.

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
