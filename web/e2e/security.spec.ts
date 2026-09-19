import { test, expect } from '@playwright/test';
import { ROUTES, WORLDS, assertRealFace, urlFor } from './support.js';

/**
 * The offline proof, and the four surfaces Task 11A's threat model names.
 *
 * `web/src/guards.test.ts` already greps our source for `fetch`. This file
 * makes the stronger and different claim: the PAGE issues no request that
 * leaves this machine, including the ones we never wrote — a stylesheet
 * `@import`, a webfont, a favicon, a sourcemap, a vendor beacon. Source-level
 * absence cannot see any of those.
 */

/** Same-machine, for the purposes of "no request leaves our origin". The
 *  preview server binds localhost; 127.0.0.1 is allowed too so the assertion
 *  does not quietly depend on which name we dialled. */
function isLocal(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return true;
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  } catch {
    return false;
  }
}

test('no request leaves this machine, on any route in either world', async ({ page, context }) => {
  const foreign: string[] = [];
  const seen: string[] = [];
  // Interception at the CONTEXT level, not a listener. A listener observes; this
  // also stops anything foreign from actually going out, so the test cannot
  // leak while it measures.
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    seen.push(url);
    if (!isLocal(url)) {
      foreign.push(`${route.request().resourceType()} ${url}`);
      await route.abort();
      return;
    }
    await route.continue();
  });

  for (const world of WORLDS) {
    for (const [, path] of ROUTES) {
      await page.goto(urlFor(path, world));
      await expect(page.getByRole('navigation')).toBeVisible();
      await page.waitForLoadState('networkidle');
      // Rendered COMPLETELY, not merely rendered: the shell, a body of content
      // in the well, and the vendored typeface actually painting. A page that
      // came up in a fallback face would be a page whose font request went
      // somewhere we are not allowed to go.
      await assertRealFace(page);
      // Content in the well, not just a frame — plus the whole shell. The text
      // floor is low on purpose: one of the fourteen is legitimately a
      // two-element, 90-character empty state (quiet has no open incident for
      // /incidents/INC-2291 to show), and a threshold tuned to the fullest page
      // would fail on the emptiest correct one. Per-view completeness is what
      // the 56 screenshots are for; this is "the page came up whole".
      expect((await page.locator('main').innerText()).trim().length).toBeGreaterThan(50);
      await expect(page.getByRole('heading', { level: 1 })).not.toBeEmpty();
      await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(7);
    }
  }

  expect(foreign).toEqual([]);

  // A recorder that never fires reports zero foreign requests for the wrong
  // reason. These say it was watching, and that the two asset classes most
  // likely to reach off-box — the webfont and the stylesheet — came from here.
  expect(seen.length).toBeGreaterThan(10);
  expect(seen.filter((u) => u.endsWith('.woff2')).length).toBeGreaterThan(0);
  expect(seen.filter((u) => u.endsWith('.css')).length).toBeGreaterThan(0);
});

test('the offline proof can see a foreign request (positive control)', async ({ page, context }) => {
  // The deliberate defect the test above needs to be worth anything. If this ever
  // goes green-by-silence, that assertion is measuring nothing.
  //
  // It fires from about:blank rather than from our own page, and that is the
  // point rather than a workaround. Task 11A's CSP carries `connect-src 'self'`,
  // so a foreign fetch issued FROM our page is refused by the browser before it
  // becomes a request at all — the interceptor never sees it, and a control
  // pointed there would pass for the wrong reason forever. about:blank has no
  // policy, so the request reaches the wire and the interceptor is the only
  // thing that can stop it. That is what this proves.
  const foreign: string[] = [];
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (!isLocal(url)) {
      foreign.push(url);
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.goto('about:blank');
  await page.evaluate(async () => {
    try {
      await fetch('https://fonts.googleapis.com/css2?family=Probe');
    } catch {
      // Aborted by the interceptor, which is the point.
    }
  });
  await expect.poll(() => foreign.length).toBeGreaterThan(0);
  expect(foreign.some((u) => u.includes('fonts.googleapis.com'))).toBe(true);
});

test('the CSP refuses a foreign fetch before it reaches the wire', async ({ page, context }) => {
  // The other half of the same claim, and the reason the control above had to
  // move. Two independent layers now stop an off-box request: the browser's own
  // policy, and — if the policy were ever removed — the interceptor. This test
  // asserts the FIRST one by showing the request never becomes a request.
  const reachedTheWire: string[] = [];
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (!isLocal(url)) reachedTheWire.push(url);
    await route.continue();
  });

  await page.goto(urlFor('/', 'sev1'));
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://fonts.googleapis.com/css2?family=Probe');
      return false;
    } catch {
      return true;
    }
  });

  expect(blocked, 'the fetch should be refused by the policy').toBe(true);
  expect(reachedTheWire, 'and refused before becoming a request').toEqual([]);
});


test('nothing 404s and nothing fails — no asset is silently missing', async ({ page }) => {
  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  for (const world of WORLDS) {
    for (const [, path] of ROUTES) {
      await page.goto(urlFor(path, world));
      await page.waitForLoadState('networkidle');
    }
  }
  expect(failed).toEqual([]);
});

test('the console is clean on every route', async ({ page }) => {
  const noise: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') noise.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => noise.push(String(e)));
  for (const world of WORLDS) {
    for (const [, path] of ROUTES) {
      await page.goto(urlFor(path, world));
      await page.waitForLoadState('networkidle');
    }
  }
  expect(noise).toEqual([]);
});

test('a hostile route param is rendered as text, never as markup', async ({ page }) => {
  // Task 11A S2. Both routes interpolate the id back into their own copy.
  let alerted = false;
  page.on('dialog', async (d) => {
    alerted = true;
    await d.dismiss();
  });
  const payload = '<img src=x onerror="window.__x=1">';
  for (const base of ['/services/', '/incidents/']) {
    await page.goto(`${base}${encodeURIComponent(payload)}?demo=sev1`);
    // The copy comes back with the id in it — so the value really did reach the
    // page, and being rendered as text is a fact about escaping rather than
    // about the string having been dropped somewhere.
    await expect(page.locator('main')).toContainText(payload);
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
    expect(await page.locator('main img[src="x"]').count()).toBe(0);
  }
  expect(alerted).toBe(false);
});

test('a poisoned theme preference cannot inject anything', async ({ page }) => {
  // Task 11A S3. ThemeProvider validates the stored string against the union
  // rather than applying it, so a value from devtools falls back.
  await page.addInitScript(() => localStorage.setItem('ops-dash.theme', '"><script>window.__y=1</script>'));
  await page.goto(urlFor('/', 'sev1'));
  await expect(page.getByRole('navigation')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __y?: number }).__y)).toBeUndefined();
  await expect(page.locator('html')).not.toHaveClass(/script/);
  // Falls back to a real theme rather than to no theme at all.
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('every link is same-origin, or an https vendor link with rel protection', async ({ page }) => {
  let checked = 0;
  for (const world of WORLDS) {
    for (const [, path] of ROUTES) {
      await page.goto(urlFor(path, world));
      await expect(page.getByRole('navigation')).toBeVisible();
      for (const a of await page.locator('a[href]').all()) {
        const href = await a.getAttribute('href');
        checked += 1;
        expect(href).not.toMatch(/^\s*(javascript|data|vbscript):/i);
        if (href?.startsWith('http')) {
          expect(href).toMatch(/^https:/);
          expect(await a.getAttribute('rel')).toMatch(/noopener/);
          expect(await a.getAttribute('rel')).toMatch(/noreferrer/);
        }
      }
    }
  }
  // Fourteen loads of a page with a seven-item nav; a zero here would mean the
  // locator stopped matching, not that every link passed.
  expect(checked).toBeGreaterThan(50);
});

test('the content security policy is present and blocks an off-box fetch', async ({ page }) => {
  // Task 10A Step 4 says to write this now and let it fail. It is the handoff
  // signal into Task 11A, which adds the meta tag to web/index.html — a file
  // this task does not own — and whose Step expects this test green.
  await page.goto(urlFor('/', 'sev1'));
  const meta = page.locator('meta[http-equiv="Content-Security-Policy"]');
  // count() rather than a bare getAttribute, so the absence of the tag fails in
  // milliseconds instead of burning the 30s locator timeout on every run.
  expect(await meta.count(), 'web/index.html has no CSP meta tag yet — Task 11A adds it').toBe(1);
  const csp = await meta.getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'none'");
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://fonts.googleapis.com/css2?family=X');
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
});
