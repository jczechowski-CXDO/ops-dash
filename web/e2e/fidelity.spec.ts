import { test, expect } from '@playwright/test';
import { ROUTES, THEMES, WORLDS, shotAround, tabTo, visit } from './support.js';

/**
 * The visual record. Everything here is a claim about what the assembled
 * application LOOKS like, which is the one thing a jsdom test cannot make.
 *
 * Read the naming: `{route}-{world}-{theme}`, and Playwright appends the
 * project and the platform. The platform suffix is not decoration — these
 * baselines were generated on Linux and font rasterisation differs enough that
 * a Windows run would diff on every one of them.
 */

// ---------------------------------------------------------------------------
// The route matrix: 7 routes × 2 worlds × 2 themes, in both viewport projects.
//
// The world dimension is not in the plan's matrix, which would have produced 28
// sev1-only baselines. Quiet is a different screen, not a variant — and it is
// where the two defects this milestone nearly baselined both lived.
// ---------------------------------------------------------------------------
for (const [name, path] of ROUTES) {
  for (const world of WORLDS) {
    for (const theme of THEMES) {
      test(`${name} · ${world} · ${theme}`, async ({ page }) => {
        await visit(page, path, world, theme);
        await expect(page).toHaveScreenshot(`${name}-${world}-${theme}.png`, { fullPage: true });
      });
    }
  }
}

// ---------------------------------------------------------------------------
// States, not just rest.
//
// At G1 a proposed fix for the dark-mode Button would have moved an invisible
// 1.09:1 state from rest to hover. Every static rest-only screenshot would have
// shown that as fixed, and the baseline would have become the acceptance
// criterion for it. So hover and keyboard focus are photographed too, in both
// themes.
// ---------------------------------------------------------------------------
test.describe('interactive states', () => {
  for (const theme of THEMES) {
    test(`nav item · ${theme}`, async ({ page }) => {
      await visit(page, '/', 'sev1', theme);
      const link = page.getByRole('link', { name: /Entra security/ });
      await shotAround(page, link, `state-nav-rest-${theme}.png`);
      await link.hover();
      await shotAround(page, link, `state-nav-hover-${theme}.png`);
      await tabTo(page, link);
      await shotAround(page, link, `state-nav-focus-${theme}.png`);
    });

    test(`theme toggle · ${theme}`, async ({ page }) => {
      await visit(page, '/', 'sev1', theme);
      const toggle = page.getByRole('button', { name: /Switch to (light|dark) theme/ });
      await shotAround(page, toggle, `state-themetoggle-rest-${theme}.png`);
      await toggle.hover();
      await shotAround(page, toggle, `state-themetoggle-hover-${theme}.png`);
      await tabTo(page, toggle);
      await shotAround(page, toggle, `state-themetoggle-focus-${theme}.png`);
    });

    test(`alert row buttons · ${theme}`, async ({ page }) => {
      await visit(page, '/', 'sev1', theme);
      const row = page.getByTestId('alert-row').first();
      const ack = row.getByRole('button', { name: 'Acknowledge' });
      await shotAround(page, ack, `state-ack-rest-${theme}.png`);
      await ack.hover();
      await shotAround(page, ack, `state-ack-hover-${theme}.png`);
      await tabTo(page, ack);
      await shotAround(page, ack, `state-ack-focus-${theme}.png`);
      // Disabled is a third state with its own contrast question, and clicking
      // is the only way to reach it. G1 accepted L-1 is about exactly this.
      await ack.click();
      await expect(ack).toBeDisabled();
      await shotAround(page, ack, `state-ack-disabled-${theme}.png`);
    });

    test(`alert rule switch · ${theme}`, async ({ page }) => {
      await visit(page, '/settings', 'sev1', theme);
      const sw = page.getByRole('switch').first();
      await shotAround(page, sw, `state-switch-on-rest-${theme}.png`);
      await sw.hover();
      await shotAround(page, sw, `state-switch-on-hover-${theme}.png`);
      await tabTo(page, sw);
      await shotAround(page, sw, `state-switch-on-focus-${theme}.png`);
      await sw.click();
      await shotAround(page, sw, `state-switch-off-${theme}.png`);
    });

    test(`dimmed alert rows · ${theme}`, async ({ page }) => {
      // README:81: "Acknowledged / muted / resolved rows drop to opacity: 0.45
      // and the meta line is prefixed ... The row stays in place." G1 accepted
      // finding M-9: this treatment had no data to render from until the
      // fixtures gave INC-2286 an ack and INC-2288 a mute. A tight clip of each
      // one, so the state has a baseline of its own and not only a few hundred
      // pixels inside a full-page capture of the Overview.
      await visit(page, '/', 'sev1', theme);
      const dimmed = page.getByTestId('alert-row').filter({ hasText: 'Acknowledged by' });
      await shotAround(page, dimmed.first(), `state-alertrow-acked-${theme}.png`);
      const muted = page.getByTestId('alert-row').filter({ hasText: 'Muted by' });
      await shotAround(page, muted.first(), `state-alertrow-muted-${theme}.png`);
    });

    test(`service tile · ${theme}`, async ({ page }) => {
      await visit(page, '/', 'sev1', theme);
      const tile = page.getByTestId('service-tile').first();
      await shotAround(page, tile, `state-tile-rest-${theme}.png`);
      await tile.hover();
      await shotAround(page, tile, `state-tile-hover-${theme}.png`);
      // The focusable thing inside the tile is the service-name link; the Card
      // itself carries no onClick, so it is not in the tab order. (The
      // prototype makes the whole tile clickable — reported, not baselined.)
      await tabTo(page, tile.getByRole('link').first());
      await shotAround(page, tile, `state-tile-focus-${theme}.png`);
    });
  }
});

// ---------------------------------------------------------------------------
// Measurements. Every number below is quoted from
// design_handoff_it_ops_dashboard/README.md, with the section it comes from,
// because a measurement asserted without its source is a number somebody typed.
// ---------------------------------------------------------------------------
test.describe('measurements from README § "Screens / views"', () => {
  test('the sidebar is 232px and does not shrink at either viewport', async ({ page }) => {
    // README § Shell: "Sidebar: fixed 232px (flex: 0 0 232px)".
    await visit(page, '/', 'sev1', 'light');
    const box = await page.getByTestId('sidebar').boundingBox();
    expect(box?.width).toBe(232);
  });

  test('the content well pads 20px 24px 40px', async ({ page }) => {
    // README § Shell, "Content well": flex:1, padding 20px 24px 40px.
    await visit(page, '/', 'sev1', 'light');
    const main = page.locator('main');
    await expect(main).toHaveCSS('padding-top', '20px');
    await expect(main).toHaveCSS('padding-right', '24px');
    await expect(main).toHaveCSS('padding-bottom', '40px');
    await expect(main).toHaveCSS('padding-left', '24px');
    await expect(main).toHaveCSS('row-gap', '16px'); // README: gap:16px
  });

  test('nav items are radius 8 with 7px 10px padding', async ({ page }) => {
    // README § Shell, Nav list: "padding 7px 10px, radius 8".
    await visit(page, '/', 'sev1', 'light');
    const item = page.getByRole('link', { name: /Entra security/ });
    await expect(item).toHaveCSS('border-radius', '8px');
    await expect(item).toHaveCSS('padding', '7px 10px');
    await expect(item).toHaveCSS('font-size', '13px'); // README: 13px Plus Jakarta Sans
  });

  test('the header title is 19px/700 and the clock is tabular', async ({ page }) => {
    // README § Shell, Header: "Title 19px/700"; "Clock: monospace 15px/600,
    // font-variant-numeric: tabular-nums".
    await visit(page, '/', 'sev1', 'light');
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCSS('font-size', '19px');
    await expect(h1).toHaveCSS('font-weight', '700');
    const clock = page.getByTestId('clock');
    await expect(clock).toHaveCSS('font-size', '15px');
    await expect(clock).toHaveCSS('font-weight', '600');
    await expect(clock).toHaveCSS('font-variant-numeric', 'tabular-nums');
  });

  test('the severity chip is 52x22 at radius 6', async ({ page }) => {
    // README § 1: "Sev chip: 52x22, radius 6, solid {sevColor}, white 11px/700".
    await visit(page, '/', 'sev1', 'light');
    const chip = page.getByTestId('alert-row').first().getByText(/^SEV \d$/);
    const box = await chip.boundingBox();
    expect({ w: box?.width, h: box?.height }).toEqual({ w: 52, h: 22 });
    await expect(chip).toHaveCSS('border-radius', '6px');
    await expect(chip).toHaveCSS('font-size', '11px');
    await expect(chip).toHaveCSS('font-weight', '700');
  });
});

// ---------------------------------------------------------------------------
// M-9 coverage, asserted rather than assumed.
//
// "The state is on the page" and "a capture contains the state" are different
// claims, and this project has been bitten by the gap between them repeatedly.
// This test names the captures that carry README:81's acknowledged/muted
// treatment and fails if any of them stops carrying it — which is what would
// happen if a fixture lost its `ack`, if the opacity changed, or if someone
// pointed the incident route at an id with neither field.
// ---------------------------------------------------------------------------
test('the acknowledged and muted treatment is inside a capture, not merely on a page', async ({
  page,
}) => {
  // Capture 1: overview-sev1-{light,dark}-{project}. Full-page, so "below the
  // fold" cannot hide a row — asserted below against the document height
  // rather than against the viewport.
  await visit(page, '/', 'sev1', 'light');
  const acked = page.getByTestId('alert-row').filter({ hasText: 'Acknowledged by m.reyes@example.com' });
  const muted = page.getByTestId('alert-row').filter({ hasText: 'Muted by j.hart@example.com' });
  await expect(acked).toHaveCount(1);
  await expect(muted).toHaveCount(1);
  await expect(acked.first()).toHaveCSS('opacity', '0.45');
  await expect(muted.first()).toHaveCSS('opacity', '0.45');
  for (const row of [acked.first(), muted.first()]) {
    const within = await row.evaluate(
      (el) => el.getBoundingClientRect().bottom + window.scrollY <= document.documentElement.scrollHeight,
    );
    expect(within, 'row falls outside the full-page capture').toBe(true);
  }

  // Capture 2 and 3: incident-acked-sev1-* and incident-muted-sev1-*. These are
  // the two routes whose hero changed at 76a72f4, when IncidentDetail stopped
  // seeding its buttons from false and started reading the record.
  await visit(page, '/incidents/INC-2286', 'sev1', 'light');
  await expect(page.getByRole('button', { name: /Acknowledged/ })).toBeDisabled();
  await visit(page, '/incidents/INC-2288', 'sev1', 'light');
  await expect(page.getByRole('button', { name: 'Unmute service' })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Layout properties that only a layout engine can answer.
// ---------------------------------------------------------------------------
test('every table keeps its last column reachable, in both worlds', async ({ page }, testInfo) => {
  // README § Tables: "Columns are deliberately capped at four or five so the
  // last column survives a ~1000px content well; the component scrolls
  // horizontally below that."
  //
  // Two claims, and the second is the one with teeth. An earlier version of
  // this test also asserted that the last header cell sat inside the wrapper's
  // scrollable extent — which is true of any child of any scroll container by
  // construction, so it survived a mutation that widened every table to 3000px.
  // It is gone: a tautology dressed as a layout check is worse than no check,
  // because it makes the file look like it covers this.
  const narrow = testInfo.project.name === 'narrow-1000';
  let tables = 0;
  for (const world of WORLDS) {
    for (const [, path] of ROUTES) {
      await visit(page, path, world, 'light');
      for (const table of await page.locator('table').all()) {
        tables += 1;
        // Claim 1: four or five columns, never six.
        const columns = await table.locator('thead th').count();
        expect(columns).toBeGreaterThanOrEqual(4);
        expect(columns).toBeLessThanOrEqual(5);

        const wrapper = table.locator('xpath=..');
        const [clientW, scrollW] = await wrapper.evaluate((el) => [el.clientWidth, el.scrollWidth]);
        if (narrow) {
          // Claim 2: at a ~1000px viewport the last column still FITS. This is
          // the README's actual promise, and it fails the day a sixth column or
          // a wider cell lands.
          expect(scrollW, `${path} table overflows at 1000px`).toBeLessThanOrEqual(clientW);
        } else if (scrollW > clientW) {
          // Below that, it must scroll rather than clip.
          await expect(wrapper).toHaveCSS('overflow-x', /auto|scroll/);
        }
      }
    }
  }
  // Fourteen page loads' worth of tables; zero would mean the locator stopped
  // matching and the loop asserted nothing.
  expect(tables).toBeGreaterThan(10);
});

test('no table cell is truncated where there is room for it', async ({ page }, testInfo) => {
  // The companion to the test above, and the reason it needs one: `truncate`
  // fixed the 1000px clip by putting `max-width: 0` on the Subject cell, which
  // under `table-layout: auto` makes that column give up width FIRST and
  // ALWAYS. At 1440 the Email subjects now read "Outstanding invoic…" with
  // roughly 180px of empty table between them and the Reason column — text that
  // rendered in full before the fix, lost at the viewport most people use.
  //
  // "Yield when there is no room" and "always be the narrowest column" are
  // different behaviours, and only the first is what the narrow fix needed.
  // The usual shape is `max-width: 0` together with `width: 100%`, so the cell
  // absorbs the slack and truncates only when there is none.
  //
  // Skipped at 1000px, where truncating IS the correct behaviour.
  test.skip(testInfo.project.name === 'narrow-1000', 'truncation is correct at 1000px');
  const ellipsised: string[] = [];
  for (const world of WORLDS) {
    for (const [, path] of ROUTES) {
      await visit(page, path, world, 'light');
      ellipsised.push(
        ...(await page.evaluate(() =>
          [...document.querySelectorAll('td')]
            .filter((el) => el.scrollWidth > el.clientWidth + 1)
            .map((el) => `${location.pathname} "${(el.textContent ?? '').trim().slice(0, 24)}"`),
        )),
      );
    }
  }
  expect(ellipsised).toEqual([]);
});

test('the only animation on the page is the refresh dot', async ({ page }) => {
  // README § Shell: the auto-refresh dot is "animated pulseDot 2s ease-in-out
  // infinite". Anything else animating is something nobody asked for.
  await visit(page, '/', 'sev1', 'light');
  const animated = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .map((el) => getComputedStyle(el).animationName)
      .filter((a) => a && a !== 'none'),
  );
  expect(new Set(animated)).toEqual(new Set(['pulseDot']));
});

// ---------------------------------------------------------------------------
// Real colour. statusColor.test.ts computes these ratios out of band from the
// token sheet, which is cheaper and runs everywhere; this one measures what the
// browser actually painted, over every route, both worlds and both themes.
// The two are not substitutes: the node test cannot see a token a view routed
// around, and this one cannot run without a browser.
// ---------------------------------------------------------------------------
test('no text pair fails WCAG AA, in either theme or either world', async ({ page }) => {
  const failures: string[] = [];
  let measured = 0;
  for (const theme of THEMES) {
    for (const world of WORLDS) {
      for (const [, path] of ROUTES) {
        await visit(page, path, world, theme);
        const result = await page.evaluate(() => {
          const lum = (c: string): number => {
            const parts = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
            const [r, g, b] = parts.map((v) => {
              const s = v / 255;
              return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
          };
          // Walk from the element ITSELF, so a filled control's own background
          // counts rather than the card behind it.
          const bgOf = (el: Element): string => {
            for (let n: Element | null = el; n; n = n.parentElement) {
              const bg = getComputedStyle(n).backgroundColor;
              if (bg && !/^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)$/.test(bg) && bg !== 'transparent') return bg;
            }
            return getComputedStyle(document.body).backgroundColor;
          };
          const bad: string[] = [];
          let count = 0;
          for (const el of document.querySelectorAll('*')) {
            const text = [...el.childNodes]
              .filter((n) => n.nodeType === 3)
              .map((n) => n.textContent?.trim() ?? '')
              .join('');
            if (!text) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none') continue;
            // Screen-reader-only text is clipped to 1px and is not a visual pair.
            const box = el.getBoundingClientRect();
            if (box.width <= 1 || box.height <= 1) continue;
            const size = parseFloat(cs.fontSize);
            const l1 = lum(cs.color);
            const l2 = lum(bgOf(el));
            const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            // WCAG AA: 3:1 for large text (>=18.66px bold or >=24px), else 4.5:1.
            const threshold = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700) ? 3 : 4.5;
            count += 1;
            if (ratio < threshold) {
              bad.push(`${location.pathname}${location.search} "${text.slice(0, 30)}" ${ratio.toFixed(2)}:1 @${size}px`);
            }
          }
          return { bad, count };
        });
        failures.push(...result.bad);
        measured += result.count;
      }
    }
  }
  // A scan reporting zero is exactly what a broken scan reports. This is the
  // arithmetic's own canary: if the walk found no text at all, the empty
  // failure list below means nothing.
  expect(measured, 'the sweep found no text nodes at all — it measured nothing').toBeGreaterThan(1000);
  expect(failures).toEqual([]);
});
