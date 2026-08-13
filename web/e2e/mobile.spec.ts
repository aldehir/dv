import { expect, test, type Page } from '@playwright/test';
import { waitForStreamedDiff } from './ready';

/** A phone in portrait: narrow enough to be under the compact breakpoint. */
test.use({ viewport: { width: 390, height: 780 } });

const shell = (page: Page) => page.locator('.dv-shell');
const mount = (page: Page) => page.locator('.dv-shell__mount');

const scrollTop = (page: Page) =>
  page.evaluate(() => document.querySelector('.dv-shell__mount')?.scrollTop ?? 0);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStreamedDiff(page);
});

test('opens unified with the file tree away', async ({ page }) => {
  await expect(shell(page)).toHaveAttribute('data-compact', 'true');
  await expect(shell(page)).toHaveAttribute('data-sidebar', 'hidden');
  // The control is in the collapsed tree, so read the state rather than the pixels.
  await expect(page.locator('[aria-label="Unified view"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: 'test-results/mobile-unified.png' });
});

test('slides the file tree over the diff rather than squeezing it', async ({ page }) => {
  const before = await mount(page).boundingBox();

  await page.locator('[aria-label="Toggle the file tree"]').click();

  await expect(page.locator('.dv-tree__row').first()).toBeVisible();
  const after = await mount(page).boundingBox();
  expect(after?.width).toBe(before?.width);
  await page.screenshot({ path: 'test-results/mobile-tree.png' });
});

test('walks the hunks from the floating arrows', async ({ page }) => {
  const nav = page.locator('.dv-hunk-nav');
  await expect(nav).toBeVisible();

  // The first press lands on the first hunk of the diff, where the view already
  // is; the second is the one that has to move.
  await page.locator('[aria-label="Next hunk"]').click();
  await page.locator('[aria-label="Next hunk"]').click();
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
  const far = await scrollTop(page);

  await page.locator('[aria-label="Previous hunk"]').click();
  await expect.poll(() => scrollTop(page)).toBeLessThan(far);
  await page.screenshot({ path: 'test-results/mobile-hunk-nav.png' });
});

test('keeps stepping across the seam between files', async ({ page }) => {
  const next = page.locator('[aria-label="Next hunk"]');
  const file = page.locator('.dv-status__file');
  const first = await file.textContent();

  // Every fixture file runs out of hunks well inside a dozen presses.
  for (let press = 0; press < 12; press += 1) await next.click();

  await expect(file).not.toHaveText(first ?? '');
});
