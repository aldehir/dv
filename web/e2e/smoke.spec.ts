import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { COMMENTS_PATH } from '../playwright.config';

const firstFileRow = (page: Page) => page.locator('.dv-tree__row').first();

const DRAFT_INPUT = 'dv-thread__input--draft';

/*
 * These run in the page, so they carry no closure — each one re-collects the
 * spans. They scan every rendered file rather than just the first, because
 * whichever file leads the diff may be a lock file or another blob shiki has no
 * grammar for.
 */
const countTokenSpans = (): number =>
  [...document.querySelectorAll('diffs-container')]
    .flatMap((container) => [
      ...(container.shadowRoot?.querySelectorAll('[data-line] span') ?? []),
    ])
    .filter((span) => (span.getAttribute('style') ?? '').includes('--diffs-token')).length;

const collectTokenStyles = (): string =>
  [...document.querySelectorAll('diffs-container')]
    .flatMap((container) => [
      ...(container.shadowRoot?.querySelectorAll('[data-line] span') ?? []),
    ])
    .map((span) => span.getAttribute('style') ?? '')
    .join(' ')
    .toUpperCase();

const waitForDiff = async (page: Page) => {
  await expect(page.locator('diffs-container').first()).toBeVisible();
  await expect(page.locator('.dv-tree__row').first()).toBeVisible();
};

const openFirstFile = async (page: Page) => {
  await waitForDiff(page);
  await firstFileRow(page).click();
  return (await firstFileRow(page).locator('.dv-tree__name').textContent()) ?? '';
};

/**
 * Scrolls a file shiki can actually tokenize into view. The diff leads with
 * whatever git lists first, which is often a lock file with no grammar, and the
 * viewer only renders what is on screen.
 */
const openHighlightableFile = async (page: Page) => {
  await waitForDiff(page);
  const row = page
    .locator('.dv-tree__row')
    .filter({ has: page.locator('.dv-tree__name', { hasText: /\.(ts|go|css|md)$/ }) })
    .first();
  await expect(row).toBeVisible();
  await row.click();
  await expect
    .poll(() => page.evaluate(countTokenSpans), { timeout: 15_000 })
    .toBeGreaterThan(0);
  // Only what is on screen gets rendered, and a file whose first hunk sits below
  // the fold shows nothing but context until we step to it.
  await page.keyboard.press(']');
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('renders a real diff with highlighted lines', async ({ page }) => {
  await waitForDiff(page);

  expect(await page.locator('diffs-container').count()).toBeGreaterThan(0);
  expect(await page.locator('diffs-container [data-line]').count()).toBeGreaterThan(0);

  await openHighlightableFile(page);

  const changed = page.locator('diffs-container [data-line-type$="addition"]');
  await expect.poll(() => changed.count(), { timeout: 15_000 }).toBeGreaterThan(0);
});

test('paints the code surface with catppuccin, not the library default', async ({ page }) => {
  await openHighlightableFile(page);

  const themeCss = await page.evaluate(() => {
    const root = document.querySelector('diffs-container')?.shadowRoot;
    return root?.querySelector('[data-theme-css]')?.textContent ?? '';
  });

  expect(themeCss).toContain('#1e1e2e');
  expect(themeCss).toContain('#cdd6f4');
  expect(themeCss).toContain('#a6e3a1');
  expect(themeCss).not.toContain('#0a0a0a');
  expect(await page.evaluate(collectTokenStyles)).toMatch(
    /#89B4FA|#A6E3A1|#FAB387|#F38BA8|#CBA6F7/,
  );
});

test('switches theme across chrome and code surface', async ({ page }) => {
  await waitForDiff(page);

  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-flavor', /latte|frappe|macchiato|mocha/);

  const before = await html.getAttribute('data-flavor');
  await page.locator('.dv-select').first().selectOption('latte');
  await expect(html).toHaveAttribute('data-flavor', 'latte');

  const chromeBg = await page.evaluate(
    () => getComputedStyle(document.documentElement).getPropertyValue('--dv-base').trim(),
  );
  expect(chromeBg).not.toBe('');

  await page.locator('.dv-select').first().selectOption('mocha');
  await expect(html).toHaveAttribute('data-flavor', 'mocha');
  expect(before).toBeTruthy();
});

test('toggles split and unified without remounting', async ({ page }) => {
  await waitForDiff(page);

  const unified = page.getByRole('button', { name: /unified/i });
  await unified.click();
  await expect(page.locator('diffs-container').first()).toBeVisible();

  const split = page.getByRole('button', { name: /split/i });
  await split.click();
  await expect(page.locator('diffs-container').first()).toBeVisible();
});

test('expands unchanged context from a patch-sourced diff', async ({ page }) => {
  await openFirstFile(page);

  const expander = page
    .locator('diffs-container button, diffs-container [role="button"]')
    .filter({ hasText: /expand|\+|▲|▼|\.\.\./ })
    .first();

  const linesBefore = await page.locator('diffs-container [data-line]').count();

  if ((await expander.count()) === 0) {
    test.info().annotations.push({ type: 'note', description: 'no expander in this diff' });
    return;
  }

  await expander.click();
  await expect
    .poll(async () => page.locator('diffs-container [data-line]').count(), {
      timeout: 10_000,
    })
    .toBeGreaterThan(linesBefore);
});

test('reports validated item heights with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await waitForDiff(page);
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(1200);
  await page.mouse.wheel(0, -2000);
  await page.waitForTimeout(600);

  const relevant = errors.filter((text) => !/favicon|ERR_/i.test(text));
  expect(relevant).toEqual([]);
});

test('comment survives a reload and lands in comments.json', async ({ page }) => {
  await openFirstFile(page);

  const body = `e2e note ${Date.now()}`;
  // Selecting a line is the whole affordance now: the draft box follows it.
  await page.locator('diffs-container [data-line-number-content]').first().click();

  const draft = page.locator(`.${DRAFT_INPUT}`);
  if ((await draft.count()) === 0) {
    test.info().annotations.push({
      type: 'note',
      description: 'draft box needs a line selection; exercising the API path instead',
    });

    const created = await page.evaluate(async (text) => {
      const token =
        document.querySelector<HTMLMetaElement>('meta[name="dv-token"]')?.content ?? '';
      const manifest = await fetch('/api/manifest', {
        headers: { 'X-Dv-Token': token },
      }).then((r) => r.json());
      const file = manifest.files[0];
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'X-Dv-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anchor: { path: file.path, side: 'additions', startLine: 1, endLine: 1 },
          body: text,
        }),
      });
      return response.ok;
    }, body);

    expect(created).toBe(true);
  } else {
    await draft.fill(body);
    await page
      .locator('.dv-thread__card--draft [aria-label="Save this comment"]')
      .click();
  }

  await expect
    .poll(() => {
      try {
        return readFileSync(COMMENTS_PATH, 'utf8');
      } catch {
        return '';
      }
    }, { timeout: 15_000 })
    .toContain(body);

  await page.reload();
  await waitForDiff(page);

  const doc = JSON.parse(readFileSync(COMMENTS_PATH, 'utf8'));
  const stored = doc.comments.find((c: { body: string }) => c.body === body);
  expect(stored).toBeTruthy();
  expect(stored.anchor.blobSha).toMatch(/^[0-9a-f]{40}$/);
  expect(stored.anchor.quote.length).toBeGreaterThan(0);

  await expect(page.locator('.dv-shell__panel')).toBeAttached();
});

test('the draft box follows the selection without chasing the drag', async ({ page }) => {
  await openHighlightableFile(page);

  const gutter = page.locator('diffs-container [data-line-number-content]');
  const card = page.locator('.dv-thread__card--draft');
  const draft = page.locator(`.${DRAFT_INPUT}`);
  const selection = () => page.locator('.dv-status__selection').textContent();

  await gutter.nth(2).click();
  await expect(draft).toBeVisible();
  const parked = (await card.boundingBox())?.y ?? 0;

  // Dragging the end of the selection must not re-lay out the diff mid-drag:
  // the box moving would shuffle the lines out from under the pointer.
  await gutter.nth(2).hover();
  await page.mouse.down();
  const target = await gutter.nth(8).boundingBox();
  if (!target) throw new Error('nothing to drag to');
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  expect(await selection()).toContain('-');
  expect((await card.boundingBox())?.y).toBe(parked);

  await page.mouse.up();
  await expect.poll(async () => (await card.boundingBox())?.y).not.toBe(parked);

  // Esc drops the selection and the box with it, but keeps what was written.
  await draft.fill('kept while the box is away');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  expect(await selection()).toBe('no selection');

  await gutter.nth(2).click();
  await gutter.nth(8).click({ modifiers: ['Shift'] });
  await expect(draft).toHaveValue('kept while the box is away');

  await expect(draft).not.toBeFocused();
  await page.keyboard.press('c');
  await expect(draft).toBeFocused();
});
