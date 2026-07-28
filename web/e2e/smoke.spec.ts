import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { COMMENTS_PATH } from '../playwright.config';
import { waitForDiff } from './ready';

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

const openFirstFile = async (page: Page) => {
  await waitForDiff(page);
  await firstFileRow(page).click();
  return (await firstFileRow(page).locator('.dv-tree__name').textContent()) ?? '';
};

/** Naming a file is safe: the diff comes from `e2e/fixture.sh`, not from HEAD. */
const openFile = async (page: Page, name: string) => {
  await waitForDiff(page);
  const row = page
    .locator('.dv-tree__row')
    .filter({ has: page.locator('.dv-tree__name', { hasText: name }) })
    .first();
  await expect(row).toBeVisible();
  await row.click();
};

/**
 * Scrolls a file shiki can actually tokenize into view, skipping the fixture's
 * `vendor.lock` and anything else it has no grammar for, since the viewer only
 * renders what is on screen.
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

test('carries unchanged context past the hunks of a patch-sourced diff', async ({ page }) => {
  await openFile(page, 'viewer.ts');

  // dv ships whole blobs beside the patch — that is what `--max-blob` turns off
  // — so the viewer holds lines no hunk mentions. The library files those rows
  // under `context-expanded`, and there is no expander to press: they are
  // already there.
  const expanded = page.locator('diffs-container [data-line-type="context-expanded"]');
  await expect.poll(() => expanded.count(), { timeout: 10_000 }).toBeGreaterThan(0);

  // The fixture's first hunk opens at line 13, so line 1 rendering at all is the
  // full contents arriving rather than the patch.
  await expect(expanded.and(page.locator('[data-line="1"]')).first()).toBeAttached();
});

test('reports validated item heights with no console errors', async ({ page }) => {
  const errors: string[] = [];
  // A failed request reads the same whatever it was for — the URL only shows up
  // in the location — so carry it, or the filter below matches nothing.
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`);
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
  await expect(draft).toBeVisible();
  await draft.fill(body);
  await page.locator('.dv-thread__card--draft [aria-label="Save this comment"]').click();

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

/**
 * Hands the inbox tests a store of their own, so a line another test has
 * already commented on cannot deny them a draft box.
 *
 * The seeds carry the `resolvedAnchor` the server would compute for a quoteless
 * anchor. Getting that wrong is not cosmetic: re-anchoring writes the file back
 * whenever it changes the document, and the page would then be holding an etag
 * the next delete is rejected for.
 */
const resetComments = (stale: readonly string[] = []): void => {
  const doc = JSON.parse(readFileSync(COMMENTS_PATH, 'utf8'));
  doc.comments = stale.map((body, index) => ({
    id: `e2e-stale-${index}`,
    author: { name: 'e2e' },
    createdAt: '2026-07-27T00:00:00Z',
    updatedAt: '2026-07-27T00:00:00Z',
    body,
    anchor: {
      path: 'src/new-feature.ts',
      prevPath: null,
      side: 'additions',
      startLine: 2,
      endLine: 2,
      blobSha: '',
      quote: '',
      contextBefore: [],
      contextAfter: [],
    },
    resolvedAnchor: { stale: true, movedFrom: null, rule: 'no-quote' },
    replies: [],
  }));
  writeFileSync(COMMENTS_PATH, JSON.stringify(doc, null, 2));
};

const commentOnLine = async (page: Page, index: number, body: string) => {
  await page.locator('diffs-container [data-line-number-content]').nth(index).click();
  const draft = page.locator(`.${DRAFT_INPUT}`);
  await expect(draft).toBeVisible();
  await draft.fill(body);
  await page.locator('.dv-thread__card--draft [aria-label="Save this comment"]').click();
  await expect(page.locator('.dv-thread__card--draft')).toHaveCount(0);
};

test('the inbox deletes the comment whose row was clicked', async ({ page }) => {
  resetComments();
  await page.reload();
  await openFirstFile(page);

  const bodies = ['e2e keep this one', 'e2e drop this one'];
  await commentOnLine(page, 0, bodies[0] ?? '');
  await commentOnLine(page, 2, bodies[1] ?? '');

  await page.locator('[aria-label="Toggle the comment inbox"]').click();
  const rows = page.locator('.dv-inbox__item');
  await expect(rows).toHaveCount(2);

  // The trash sits beside the row, not inside it — a nested button would be
  // illegal — so the click has to route past the row's own focus handler.
  await rows.filter({ hasText: bodies[1] ?? '' }).locator('.dv-inbox__delete').click();

  await expect(rows).toHaveCount(1);
  await expect(page.locator('.dv-inbox')).toContainText(bodies[0] ?? '');
  await expect
    .poll(() => readFileSync(COMMENTS_PATH, 'utf8'), { timeout: 15_000 })
    .not.toContain(bodies[1] ?? '');
  expect(readFileSync(COMMENTS_PATH, 'utf8')).toContain(bodies[0] ?? '');
});

test('clearing the unanchored section takes two clicks', async ({ page }) => {
  resetComments(['e2e stale one', 'e2e stale two']);
  await page.reload();
  await openFirstFile(page);

  const anchored = 'e2e still anchored';
  await commentOnLine(page, 0, anchored);

  await page.locator('[aria-label="Toggle the comment inbox"]').click();
  const section = page.locator('.dv-inbox__section').last();
  await expect(section.locator('.dv-inbox__item')).toHaveCount(2);

  const clear = page.locator('.dv-inbox__clear');
  await clear.click();
  await expect(clear).toHaveText('Delete 2?');
  await expect(section.locator('.dv-inbox__item')).toHaveCount(2);

  await clear.click();
  await expect(section).toBeHidden();
  await expect
    .poll(() => readFileSync(COMMENTS_PATH, 'utf8'), { timeout: 15_000 })
    .not.toContain('e2e stale');
  // The anchored comment is not the section's to take.
  expect(readFileSync(COMMENTS_PATH, 'utf8')).toContain(anchored);
});

test('the draft box follows the selection without chasing the drag', async ({ page }) => {
  await openHighlightableFile(page);

  // Scope the gutter to one file: a range cannot span two, so indices taken
  // across every mounted container would silently drag from one file into the
  // next and collapse back to the line it started on.
  const gutter = page.locator('diffs-container').first().locator('[data-line-number-content]');
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
  // The range lands a frame behind the pointer, so poll for it — but the box
  // must not have moved by the time it does.
  await expect.poll(selection).toContain('-');
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

  // A settled range opens the box already focused; `c` is how you get back into
  // it once focus has moved on.
  await expect(draft).toBeFocused();
  await draft.blur();
  await expect(draft).not.toBeFocused();
  await page.keyboard.press('c');
  await expect(draft).toBeFocused();
});
