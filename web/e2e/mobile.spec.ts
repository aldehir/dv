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

test('leaves the whole width to the diff', async ({ page }) => {
  // Neither the strip of panel buttons nor the rail takes a column of its own:
  // the buttons lie down in the status bar, and the rail is not a thumb target.
  await expect(page.locator('.dv-shell__dock')).toBeHidden();
  await expect(page.locator('.dv-rail')).toBeHidden();
  await expect(
    page.locator('.dv-shell__status [aria-label="Toggle the hunk list"]'),
  ).toBeVisible();

  const box = await mount(page).boundingBox();
  expect(box?.width).toBe(390);
});

test('hands the right edge back when the window grows', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 780 });

  await expect(shell(page)).toHaveAttribute('data-compact', 'false');
  await expect(page.locator('.dv-rail')).toBeVisible();
  await expect(
    page.locator('.dv-shell__dock [aria-label="Toggle the hunk list"]'),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-grown.png' });

  await page.setViewportSize({ width: 390, height: 780 });

  await expect(page.locator('.dv-rail')).toBeHidden();
  await expect(
    page.locator('.dv-shell__status [aria-label="Toggle the hunk list"]'),
  ).toBeVisible();
});

test('gives the diff the window and comes back out', async ({ page }) => {
  await page.locator('[aria-label="Fullscreen"]').click();

  await expect(shell(page)).toHaveAttribute('data-fullscreen', 'true');
  await expect(page.locator('.dv-shell__toolbar')).toBeHidden();
  await expect(page.locator('.dv-shell__status')).toBeHidden();
  await page.screenshot({ path: 'test-results/mobile-fullscreen.png' });

  await page.locator('[aria-label="Leave fullscreen"]').click();

  await expect(shell(page)).toHaveAttribute('data-fullscreen', 'false');
  await expect(page.locator('.dv-shell__toolbar')).toBeVisible();
});

/**
 * Touch, which is the whole point of the narrow layout. Playwright drives taps
 * but not drags, so the gesture goes in through CDP as a raw touch stream — the
 * synthesised scroll gestures never reach the compositor in this browser.
 */
test.describe('under a thumb', () => {
  test.use({ hasTouch: true, isMobile: true });

  /** Paced like a finger: the diff re-lays out between frames, not between events. */
  const swipe = async (page: Page, x: number, y: number, distance: number) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(60);
    for (let step = 1; step <= 10; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + (distance * step) / 10 }],
      });
      await page.waitForTimeout(12);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };

  const startAt = async (page: Page, top: number) => {
    await page.evaluate((value) => {
      const node = document.querySelector('.dv-shell__mount');
      if (node) node.scrollTop = value;
    }, top);
  };

  /** The route carries the selection, and a range reads `L16-L20`. */
  const hash = (page: Page) => page.evaluate(() => location.hash);

  /** A line number at the left edge of whatever the diff is showing. */
  const GUTTER = { x: 14, y: 400 };

  // The library holds the line numbers still so a drag down them selects a
  // range. That is a mouse gesture: under a thumb the gutter is a strip down
  // the left of every file that the diff would not scroll from.
  test('scrolls from the line numbers as readily as from the code', async ({ page }) => {
    for (const x of [12, 40, 200]) {
      await startAt(page, 400);
      await swipe(page, x, 400, 150);
      await expect.poll(() => scrollTop(page)).toBeLessThan(350);
    }
  });

  /** The library gives every file its own; both axes have to be dead. */
  const codeOverflow = (page: Page) =>
    page.evaluate(() => {
      const code = document.querySelector('diffs-container')?.shadowRoot?.querySelector(
        '[data-code]',
      );
      if (!code) return 'no code block';
      const styles = getComputedStyle(code);
      return `${styles.overflowX}/${styles.overflowY}`;
    });

  // WebKit hands a touch to the scroller under it and then drops the gesture
  // when that element cannot move on the gesture's axis. Over a hunk tall enough
  // to fill the screen there is nowhere else to put a finger, so the only fix is
  // for there to be no scroller under it — wrapped or not.
  test('leaves no scroller under the finger but the diff', async ({ page }) => {
    await expect(page.locator('[aria-label="Wrap long lines"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await codeOverflow(page)).toBe('clip/clip');

    await page.locator('[aria-label="Toggle the file tree"]').click();
    await page.locator('[aria-label="Wrap long lines"]').click();
    await page.locator('[aria-label="Toggle the file tree"]').click();

    await expect(page.locator('[aria-label="Wrap long lines"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(await codeOverflow(page)).toBe('clip/clip');

    await startAt(page, 400);
    await swipe(page, 200, 400, 150);
    await expect.poll(() => scrollTop(page)).toBeLessThan(350);
  });

  // Which leaves the plus in the gutter as the way to a range: tap a line, then
  // drag its handle. Both directions — down means crossing the draft card the
  // tap just opened, which the viewer takes away for the length of the drag.
  for (const [direction, distance] of [
    ['down', 90],
    ['up', -90],
  ] as const) {
    test(`opens a range by dragging the gutter handle ${direction}`, async ({ page }) => {
      await page.touchscreen.tap(GUTTER.x, GUTTER.y);
      await expect.poll(() => hash(page)).toMatch(/:L\d+$/);
      await expect(page.locator('.dv-thread__card--draft')).toBeVisible();

      const handle = await page.locator('[data-utility-button]').first().boundingBox();
      if (!handle) throw new Error('the tap left no handle in the gutter');
      await swipe(page, handle.x + handle.width / 2, handle.y + handle.height / 2, distance);

      await expect.poll(() => hash(page)).toMatch(/:L\d+-L\d+$/);
      await expect(page.locator('.dv-thread__card--draft')).toBeVisible();
      await page.screenshot({ path: `test-results/mobile-handle-${direction}.png` });
    });
  }
});
