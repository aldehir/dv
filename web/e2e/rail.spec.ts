import { expect, test, type Page } from '@playwright/test';

const rail = (page: Page) => page.locator('.dv-rail');
const box = (page: Page) => page.locator('.dv-rail__view');

const scrollTop = (page: Page) =>
  page.evaluate(() => document.querySelector('.dv-shell__mount')?.scrollTop ?? 0);

const boxTop = async (page: Page) => (await box(page).boundingBox())?.y ?? 0;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('diffs-container').first()).toBeVisible();
  await expect(rail(page)).toBeVisible();
});

test('drags the diff by the box', async ({ page }) => {
  const start = await box(page).boundingBox();
  if (!start) throw new Error('expected a viewport box');
  const before = await scrollTop(page);
  const middle = { x: start.x + start.width / 2, y: start.y + start.height / 2 };

  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x, middle.y + 120, { steps: 6 });
  await page.mouse.up();

  expect(await scrollTop(page)).toBeGreaterThan(before);
  expect(await boxTop(page)).toBeGreaterThan(start.y);
  await page.screenshot({ path: 'test-results/rail-dragged.png' });
});

test('sends the box to a press on the track', async ({ page }) => {
  const track = await rail(page).boundingBox();
  if (!track) throw new Error('expected a rail');
  const before = await boxTop(page);

  await page.mouse.click(track.x + track.width / 2, track.y + track.height * 0.8);

  expect(await scrollTop(page)).toBeGreaterThan(0);
  expect(await boxTop(page)).toBeGreaterThan(before);
});

test('rolls the wheel over the rail into the diff', async ({ page }) => {
  const track = await rail(page).boundingBox();
  if (!track) throw new Error('expected a rail');

  await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2);
  await page.mouse.wheel(0, 400);

  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
});

test('still jumps to the hunk a tick stands for', async ({ page }) => {
  const ticks = page.locator('.dv-rail__tick');
  await expect(ticks.first()).toBeVisible();
  const before = await scrollTop(page);

  await ticks.last().click();

  expect(await scrollTop(page)).not.toBe(before);
});
