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
Node 22.22.3) against **`97ca020`**. Record both whenever you regenerate: when
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

## Three tests are expected to be red

- `security.spec.ts` "the content security policy is present…" — Task 11A adds
  the meta tag to `web/index.html`. Written now, deliberately failing, per the
  plan.
- `fidelity.spec.ts` "no table cell is truncated where there is room for it" on
  the **desktop-1440** project — `Column.truncate` fixed the 1000px clip with
  `max-width: 0`, which makes the Subject column give up width first and always.
  At 1440 the Email subjects read "Outstanding invoic…" with ~180px of empty
  table beside them. The four `email-*-desktop-1440-*.png` captures record that
  and regenerate when it is fixed. Skipped at 1000px, where truncating is
  correct.

(The 1000px clip that was here is fixed: `/email` now fits, and "every table
keeps its last column reachable" is green in both projects.)
