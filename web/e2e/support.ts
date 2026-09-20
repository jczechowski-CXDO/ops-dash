import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Everything the three specs share, and the four things that have to be true
 * before a screenshot is worth committing: the right world, the right theme,
 * the real typeface, and a clock that does not move.
 */

export type Theme = 'light' | 'dark';
export type World = 'quiet' | 'sev1';

export const THEMES: readonly Theme[] = ['light', 'dark'];

/** Both worlds, always. Quiet is not a variant of sev1 — it is a different
 *  screen: a compressed status strip reading "5 AFFIRMED · 2 UNKNOWN" and an
 *  empty-state card where sev1 has a tile grid and an alert list. Photograph
 *  one and half the application is unbaselined. */
export const WORLDS: readonly World[] = ['quiet', 'sev1'];

/** The seven routes, in nav order, plus two more incidents.
 *
 * `/incidents/INC-2291` exists only in sev1; in quiet the same URL is the
 * "nothing is open" empty state, which is the correct quiet-world rendering of
 * that route and is baselined as such.
 *
 * INC-2286 and INC-2288 are here for a specific reason. INC-2291 carries
 * neither `ack` nor `muted`, so a route list containing only it photographs
 * none of README:81's acknowledged/muted treatment — the branch G1 accepted
 * finding **M-9** was about, which shipped unrendered until the fixtures gave
 * INC-2286 an ack and INC-2288 a mute so that it would appear on screen.
 * Closing M-9 in the fixtures and leaving it unbaselined would reopen it one
 * layer up. These two are also the only routes whose hero moved at 76a72f4,
 * when IncidentDetail stopped seeding its buttons from `false` and started
 * reading ack/muted from the record. */
export const ROUTES = [
  ['overview', '/'],
  ['service', '/services/m365'],
  ['incident', '/incidents/INC-2291'],
  ['incident-acked', '/incidents/INC-2286'],
  ['incident-muted', '/incidents/INC-2288'],
  ['entra', '/entra'],
  ['endpoints', '/endpoints'],
  ['email', '/email'],
  ['settings', '/settings'],
] as const;

export type RouteName = (typeof ROUTES)[number][0];

/** The instant every screenshot is taken at. The header clock ticks every
 *  second and the auto-refresh pill counts down from 30; unfrozen, every
 *  baseline is a false diff waiting to happen. */
export const FROZEN = new Date('2026-09-18T09:41:02Z');

/**
 * Select the world by query parameter, because the sidebar's segmented control
 * is `import.meta.env.DEV`-gated and is stripped from the production build we
 * are photographing. Without this every baseline would be sev1 (G2 HIGH-2).
 */
export function urlFor(path: string, world: World): string {
  return `${path}${path.includes('?') ? '&' : '?'}demo=${world}`;
}

/**
 * Install the frozen clock and the theme preference. Must run BEFORE goto:
 * both are init scripts, and the theme in particular has exactly one supported
 * mechanism.
 *
 * Setting `documentElement.classList` from the test does NOT work — the app's
 * ThemeProvider owns that class and syncs it back from its own state on the
 * next render, so anything captured afterwards is light mode wearing a dark
 * label. That mistake voided a whole contrast sweep once; `assertTheme` below
 * is the check that would have caught it.
 */
export async function prepare(page: Page, theme: Theme): Promise<void> {
  await page.clock.install({ time: FROZEN });
  // install() alone does not stop time — measured: Date.now() was 270ms past
  // the installed instant by the time the page was up, which is a header clock
  // and a 30-second countdown free to move between one screenshot and the next.
  // Pause at the same instant, BEFORE the first navigation: pauseAt fast-
  // forwards, and "fast-forward to the past" is an error once the page has
  // been open for a moment.
  await page.clock.pauseAt(FROZEN);
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('ops-dash.theme', t);
    } catch {
      // A context that refuses storage will render light; assertTheme fails loudly.
    }
  }, theme);
}

export const KILL_TRANSITIONS_CSS = '*, *::before, *::after { transition: none !important; }';

/** Same-origin so `style-src 'self'` admits it, and under `/__e2e__/` so it can
 *  never collide with a real asset in `web/public/`. Nothing serves this path —
 *  the route below is what answers it — which keeps the harness out of the
 *  production build entirely. */
export const KILL_TRANSITIONS_URL = '/__e2e__/kill-transitions.css';

/**
 * Settle every CSS transition instantly, and here is why it is not optional.
 *
 * ThemeProvider applies the `dark` class in an effect, i.e. AFTER the first
 * paint, so every load in dark mode starts a colour transition from the light
 * values. Our clock is paused, and a paused clock freezes those transitions
 * PART-WAY: measured `color: rgb(28, 31, 35)` — all but the light-mode value —
 * on a Button sitting on the dark `rgb(6, 8, 10)` background, and the contrast
 * sweep duly reported 14 failures at 1.21:1 that do not exist in a real
 * browser. An identical sweep with the clock running found none.
 *
 * That is a measurement artefact, and it is the more dangerous kind: it
 * reported a defect rather than hiding one, and the numbers looked exactly like
 * the genuine 1.09:1 dark-mode Button from G1.
 *
 * Killing transitions rather than un-pausing the clock keeps determinism: every
 * property is at its final value at the instant we look, in both themes.
 * Animations are left alone here — `toHaveScreenshot({ animations: 'disabled' })`
 * pins those at capture time, and fidelity.spec.ts asserts that the refresh dot
 * is still animating at all.
 */
export async function killTransitions(page: Page): Promise<void> {
  // `addStyleTag({ content })` injects an INLINE <style>, which index.html's
  // `style-src 'self'` has refused since Task 11A landed the CSP (that is what
  // silently broke 135 of these tests). `addStyleTag({ url })` injects a
  // <link rel=stylesheet> instead; a same-origin stylesheet satisfies 'self',
  // and the bytes it applies are identical to what the inline tag applied, so
  // the baselines mean the same thing. The CSP is not relaxed for the tests.
  await page.route(KILL_TRANSITIONS_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: KILL_TRANSITIONS_CSS }),
  );
  await page.addStyleTag({ url: KILL_TRANSITIONS_URL });
  await assertTransitionsKilled(page);
}

/**
 * Prove the stylesheet is in effect, rather than that no error was thrown.
 *
 * Without this, a fix that quietly injected nothing — a 404 swallowed, a route
 * pattern that stopped matching, a CSP that refuses <link> too — would leave
 * every baseline test passing and every one of them free to catch a render
 * mid-transition again. So: MEASURE. A probe with a one-second transition of
 * its own must compute to 0s, which is only true if `transition: none
 * !important` is actually cascading over it.
 *
 * The probe's declarations are set through CSSOM (`el.style.x = ...`), not as a
 * `style` attribute: `style-src 'self'` blocks the attribute and leaves CSSOM
 * alone. assertRealFace measures the same way for the same reason.
 */
export async function assertTransitionsKilled(page: Page): Promise<void> {
  const [href, duration] = await page.evaluate((url) => {
    const sheet = [...document.styleSheets].find((s) => (s.href ?? '').endsWith(url));
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    el.style.transition = 'color 1s linear';
    document.body.appendChild(el);
    const d = getComputedStyle(el).transitionDuration;
    el.remove();
    return [sheet?.href ?? null, d] as const;
  }, KILL_TRANSITIONS_URL);
  expect(href, `no stylesheet ending in ${KILL_TRANSITIONS_URL} is attached to the page`).not.toBeNull();
  expect(
    duration,
    'a probe declaring `transition: color 1s` still computes to ' +
      `${duration}: the kill-transitions stylesheet is attached but not winning the cascade`,
  ).toBe('0s');
}

/** The theme the app actually applied, not the one we asked for. */
export async function assertTheme(page: Page, theme: Theme): Promise<void> {
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  expect(
    isDark,
    `requested theme "${theme}" but documentElement.classList.contains('dark') === ${isDark}. ` +
      'ThemeProvider owns that class; the preference must be set in localStorage before boot.',
  ).toBe(theme === 'dark');
}

/**
 * Prove the page is painted in Plus Jakarta Sans and not in a fallback face.
 *
 * `document.fonts.ready` is necessary and not sufficient: `font-display: swap`
 * means a paint can happen in the fallback and swap afterwards, which is the
 * mechanism most consistent with the two captures that came out in the wrong
 * face during the G3 contrast work. So this awaits the load, then MEASURES:
 * a probe in the real stack and a probe in the fallback-only stack must render
 * the same string at different widths. Equal widths mean we are looking at the
 * fallback, whatever `check()` claims.
 */
export async function assertRealFace(page: Page): Promise<void> {
  const [jakarta, realW, fallbackW] = await page.evaluate(async () => {
    await document.fonts.load('700 13.5px "Plus Jakarta Sans"');
    await document.fonts.load('400 13px "Plus Jakarta Sans"');
    await document.fonts.ready;
    const sample = 'Crexendo IT Service operations 0123456789';
    const measure = (family: string): number => {
      const el = document.createElement('span');
      el.textContent = sample;
      el.style.cssText = `position:absolute;left:-9999px;top:0;white-space:pre;font-size:13.5px;font-weight:700;font-family:${family}`;
      document.body.appendChild(el);
      const w = el.getBoundingClientRect().width;
      el.remove();
      return w;
    };
    return [
      document.fonts.check('700 13.5px "Plus Jakarta Sans"'),
      measure('"Plus Jakarta Sans", Arial, sans-serif'),
      measure('Arial, sans-serif'),
    ] as const;
  });
  expect(jakarta, 'the vendored webfont never finished loading').toBe(true);
  expect(
    Math.abs(realW - fallbackW),
    `the page is rendering in a fallback face: "Plus Jakarta Sans" and Arial measured the same ` +
      `width (${realW}px vs ${fallbackW}px) for the same string`,
  ).toBeGreaterThan(1);
}

/** Navigate, then refuse to proceed until the shell is up, the theme really
 *  applied and the real typeface is really in use. */
export async function visit(page: Page, path: string, world: World, theme: Theme): Promise<void> {
  await prepare(page, theme);
  await page.goto(urlFor(path, world));
  await killTransitions(page);
  await expect(page.getByRole('navigation')).toBeVisible();
  await assertTheme(page, theme);
  await assertRealFace(page);
}

/**
 * Walk the tab order until `target` holds focus, so it matches
 * `:focus-visible` — which a programmatic `.focus()` does not, and the focus
 * ring lives entirely in that pseudo-class. Fails loudly rather than
 * screenshotting an unfocused element, because a ring-less baseline of a
 * "focus" state is exactly the defect this suite exists to prevent.
 */
export async function tabTo(page: Page, target: Locator, max = 40): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`tabbed ${max} times without giving focus to the target element`);
}

/**
 * Screenshot an element WITH the margin around it.
 *
 * Two reasons this is not `locator.screenshot()`. It clips to the element's own
 * box, and index.html draws the focus ring as `outline: 2px solid ...;
 * outline-offset: 2px` — entirely outside that box, so a locator screenshot of
 * a focused control is pixel-identical to the unfocused one and would bless a
 * missing ring.
 *
 * And `page.screenshot({ clip })` clips in VIEWPORT coordinates. An element
 * below the fold produces a clip of blank page, silently — which is exactly
 * what happened when the service tiles grew 6px each: at 1000px the dimmed
 * alert rows dropped past the viewport bottom and the "baseline" became an
 * empty strip with one rounded corner in it. It was caught by looking at the
 * image, not by the run, which is the whole argument for looking. So: scroll
 * into view first, then refuse to capture a region that is not wholly inside
 * the viewport.
 */
export async function shotAround(
  page: Page,
  target: Locator,
  name: string,
  pad = 10,
): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport, 'no viewport to clip against').not.toBeNull();
  const v = viewport!;
  await target.scrollIntoViewIfNeeded();
  let box = await target.boundingBox();
  expect(box, 'element has no box to screenshot').not.toBeNull();
  // Centre it only if the padded clip would not fit where it currently sits —
  // a row at the very bottom of the document leaves no room for the margin.
  // Conditional on purpose: scrolling unconditionally moves every other capture
  // relative to the sticky header and sidebar, which rewrites baselines that had
  // nothing wrong with them.
  if (box!.y - pad < 0 || box!.y + box!.height + pad > v.height) {
    await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    box = await target.boundingBox();
  }
  const b = box!;
  // Clamp the margin to the viewport rather than failing on it. What must not
  // be clamped away is the element itself, which is asserted below.
  const x = Math.max(0, b.x - pad);
  const y = Math.max(0, b.y - pad);
  const clip = {
    x,
    y,
    width: Math.min(b.width + pad * 2, v.width - x),
    height: Math.min(b.height + pad * 2, v.height - y),
  };
  expect(
    b.x >= clip.x && b.y >= clip.y && b.x + b.width <= clip.x + clip.width && b.y + b.height <= clip.y + clip.height,
    `the element is not wholly inside the clip for ${name} — the capture would be ` +
      `partly blank page (element ${JSON.stringify(b)}, clip ${JSON.stringify(clip)})`,
  ).toBe(true);
  await expect(page).toHaveScreenshot(name, { clip });
}
