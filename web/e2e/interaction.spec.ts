import { test, expect } from '@playwright/test';
import { FROZEN, prepare, urlFor, visit } from './support.js';

/**
 * The flows that only mean anything in a real browser: router navigation,
 * persisted preferences, keyboard operation of a control that is not a
 * <button>, and a countdown driven by a timer.
 */

test('the sidebar navigates and marks the destination current', async ({ page }) => {
  await visit(page, '/', 'sev1', 'light');
  await page.getByRole('link', { name: /Entra security/ }).click();
  await expect(page).toHaveURL(/\/entra/);
  await expect(page.getByRole('link', { name: /Entra security/ })).toHaveAttribute('aria-current', 'page');
  // And the item we left is no longer current — one-at-a-time is the claim.
  await expect(page.getByRole('link', { name: /^Overview/ })).not.toHaveAttribute('aria-current', 'page');
});

test('a service tile opens the service it names, from anywhere on the tile', async ({ page }) => {
  // The whole tile is the click target as of cc42f8f, matching the prototype's
  // `<div onClick>`. Click the tile BODY rather than the name, because the body
  // is the part that was dead before and the part no other test covers.
  await visit(page, '/', 'sev1', 'light');
  const tile = page.getByTestId('service-tile').first();
  // Read the name off the tile first. Asserting a hard-coded id would pass even
  // if every tile navigated to the same wrong service.
  const name = (await tile.getByRole('link').first().innerText()).trim();
  expect(name.length).toBeGreaterThan(0);
  await tile.getByTestId('tile-spark').click();
  await expect(page).toHaveURL(/\/services\/[a-z0-9]+/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
});

test('a service tile is operable from the keyboard', async ({ page }) => {
  // Card takes role="button" and tabIndex 0 when it has an onClick, so Enter
  // and Space must work. Role and tabindex without a key handler is the classic
  // half-fix, so press the key rather than reading the markup.
  await visit(page, '/', 'sev1', 'light');
  const tile = page.getByTestId('service-tile').first();
  await tile.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/services\/[a-z0-9]+/);
});

test('the service name is a real link, and clicking it navigates exactly once', async ({ page }) => {
  // Two claims that pull against each other, which is why they are asserted
  // together.
  //
  // The name stays an <a href> so middle-click and "open in new tab" survive —
  // a bare div with an onClick would pass every click test while silently
  // removing both.
  //
  // But the tile around it now navigates too, so a click on the name bubbles to
  // the Card and BOTH handlers fire. Measured: history.length goes 2 -> 4 on one
  // click, and a single Back press leaves you on the same page. To a user the
  // Back button is broken. One click is one navigation.
  await visit(page, '/', 'sev1', 'light');
  const link = page.getByTestId('service-tile').first().getByRole('link').first();
  await expect(link).toHaveAttribute('href', /^\/services\//);
  const before = await page.evaluate(() => history.length);
  await link.click();
  await expect(page).toHaveURL(/\/services\/[a-z0-9]+/);
  const after = await page.evaluate(() => history.length);
  expect(after - before, 'one click on the service name pushed more than one history entry').toBe(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/\?demo=sev1$/);
});

test('a status pill opens the service it names, in quiet', async ({ page }) => {
  // README § 1 quiet 1: "Clicking a pill opens Service detail."
  await visit(page, '/', 'quiet', 'light');
  const pill = page.getByTestId('service-pill').first();
  const name = (await pill.innerText()).trim().split(',')[0] ?? '';
  await pill.click();
  await expect(page).toHaveURL(/\/services\/[a-z0-9]+/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
});

test('an alert rule switch is operable from the keyboard', async ({ page }) => {
  // The Switch is a <button role="switch">, not a checkbox in a label, so its
  // keyboard behaviour is the browser's and is worth proving rather than
  // assuming. The enabled count is read as a second, independent path: a switch
  // that flipped only its own aria-checked would pass the first assertion alone.
  await visit(page, '/settings', 'sev1', 'light');
  const count = page.getByTestId('rules-count');
  const before = await count.innerText();
  const sw = page.getByRole('switch').first();
  const wasOn = await sw.getAttribute('aria-checked');
  await sw.focus();
  await page.keyboard.press('Space');
  await expect(sw).toHaveAttribute('aria-checked', wasOn === 'true' ? 'false' : 'true');
  await expect(count).not.toHaveText(before);
});

test('the theme choice survives a reload', async ({ page }) => {
  // Deliberately NOT `visit`: its init script re-seeds the stored preference on
  // every navigation, including the reload, so the test would be asserting
  // against its own fixture rather than against the app's persistence. A fresh
  // context defaults to light, which is the same starting point.
  await page.goto(urlFor('/', 'sev1'));
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: /Switch to dark theme/i }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem('ops-dash.theme'))).toBe('dark');
});

test('acknowledging dims the row and keeps it exactly where it was', async ({ page }) => {
  // README § 1: "Acknowledged / muted / resolved rows drop to opacity: 0.45 ...
  // The row stays in place (explicit product decision — acknowledging must not
  // hide work)."
  await visit(page, '/', 'sev1', 'light');
  const rows = page.getByTestId('alert-row');
  const before = await rows.count();
  const firstTitle = await rows.first().innerText();
  await rows.first().getByRole('button', { name: 'Acknowledge' }).click();
  await expect(rows).toHaveCount(before);
  await expect(rows.first()).toHaveCSS('opacity', '0.45');
  await expect(rows.first()).toContainText('Acknowledged by');
  // Same row, same position: the text that was first is still first.
  expect((await rows.first().innerText()).includes(firstTitle.split('\n')[1] ?? '')).toBe(true);
});

test('the refresh countdown actually counts down', async ({ page }) => {
  // README § Shell: the pill contains "Auto-refresh · {n}s counting down from
  // 30". Driven by setInterval, so the frozen clock is advanced deliberately
  // rather than waited on — a wall-clock wait here is how a suite becomes flaky.
  await prepare(page, 'light');
  await page.goto(urlFor('/', 'sev1'));
  const pill = page.getByText(/Auto-refresh · \d+s/);
  await expect(pill).toHaveText('Auto-refresh · 30s');
  await page.clock.runFor(3000);
  await expect(pill).toHaveText('Auto-refresh · 27s');
});

test('the header clock renders the frozen instant, so the baselines are stable', async ({ page }) => {
  // Config pins timezoneId to UTC; support.ts freezes the clock at 09:41:02Z.
  // If either stops working every screenshot gains four digits of diff, and
  // this is the test that says which one broke.
  await visit(page, '/', 'sev1', 'light');
  await expect(page.getByTestId('clock')).toHaveText('09:41:02');
  expect(await page.evaluate(() => Date.now())).toBe(FROZEN.getTime());
});

test('?demo= really selects the world in the production build', async ({ page }) => {
  // The whole quiet half of the baseline suite rests on this. The sidebar's
  // segmented control is stripped from the production bundle, so if the query
  // parameter stopped working every "quiet" screenshot would silently be sev1
  // (G2 HIGH-2) — and it would still look like a perfectly good baseline.
  await visit(page, '/', 'sev1', 'light');
  await expect(page.getByTestId('service-tile').first()).toBeVisible();
  await expect(page.getByTestId('alert-row').first()).toBeVisible();

  await visit(page, '/', 'quiet', 'light');
  await expect(page.getByTestId('no-incidents')).toBeVisible();
  await expect(page.getByTestId('alert-row')).toHaveCount(0);
  // And the strip tells the truth about what we cannot see, rather than
  // claiming an all-clear over two unknown services.
  await expect(page.getByTestId('service-pill').first()).toBeVisible();
});
