import { expect, type Page } from '@playwright/test';

/**
 * Waits for a diff that is finished, not merely on screen.
 *
 * dv streams the manifest and then each file, so a page with one
 * `diffs-container` visible may still have payloads in flight. A gesture that
 * lands before the last one arrives gets its work undone when the new item
 * re-lays out the view: a track press scrolls and is reset to the top, a
 * dragged range collapses back to the line it started on. Both read as flaky
 * and neither is.
 */
export const waitForDiff = async (page: Page): Promise<void> => {
  await expect(page.locator('diffs-container').first()).toBeVisible();
  await expect(page.locator('.dv-tree__row').first()).toBeVisible();
  // The status dot carries the stream state; `done` is the last payload landing.
  await expect(page.locator('.dv-status__dot')).toHaveAttribute('data-state', /done|closed/);
  await expect.poll(() => overflow(page)).toBeGreaterThan(0);
};

/** How far the mount can scroll. Zero means the rail has nowhere to send it. */
export const overflow = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const mount = document.querySelector('.dv-shell__mount');
    return mount ? mount.scrollHeight - mount.clientHeight : 0;
  });
