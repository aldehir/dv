import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_METRICS,
  FALLBACK_SPACING,
  HEADER_GAP_UNITS,
  HUNK_LINE_COUNT,
  fontsReady,
  measureMetrics,
  measuredMetrics,
} from './metrics';

afterEach(() => {
  document.documentElement.style.removeProperty('--diffs-line-height');
  document.documentElement.style.removeProperty('--diffs-gap-block');
});

describe('FALLBACK_METRICS', () => {
  it('derives the header height from the row height and the library gap', () => {
    expect(FALLBACK_METRICS).toEqual({
      hunkLineCount: HUNK_LINE_COUNT,
      lineHeight: 20,
      diffHeaderHeight: 20 + HEADER_GAP_UNITS * FALLBACK_SPACING,
      spacing: FALLBACK_SPACING,
    });
  });
});

describe('measureMetrics', () => {
  it('returns a complete metrics shape with plausible numbers', () => {
    const metrics = measureMetrics();

    expect(Object.keys(metrics).sort()).toEqual([
      'diffHeaderHeight',
      'hunkLineCount',
      'lineHeight',
      'spacing',
    ]);
    expect(metrics.lineHeight).toBeGreaterThan(0);
    expect(metrics.spacing).toBeGreaterThan(0);
    expect(metrics.diffHeaderHeight).toBeGreaterThan(metrics.lineHeight);
    expect(metrics.hunkLineCount).toBe(HUNK_LINE_COUNT);
  });

  it('falls back to the declared row height when layout reports nothing', () => {
    expect(measureMetrics()).toEqual(FALLBACK_METRICS);
  });

  it('honours a font-size override expressed through the css variables', () => {
    document.documentElement.style.setProperty('--diffs-line-height', '26px');
    document.documentElement.style.setProperty('--diffs-gap-block', '10px');

    const metrics = measureMetrics();
    expect(metrics.lineHeight).toBe(26);
    expect(metrics.spacing).toBe(10);
    expect(metrics.diffHeaderHeight).toBe(26 + HEADER_GAP_UNITS * 10);
  });

  it('measures the probe row height when the host reports real layout', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const measured = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ height: 16 * 24 } as DOMRect);

    expect(measureMetrics(host).lineHeight).toBe(24);

    measured.mockRestore();
    host.remove();
  });

  it('leaves no probe behind in the host', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    measureMetrics(host);
    expect(host.childElementCount).toBe(0);
    host.remove();
  });
});

describe('measuredMetrics', () => {
  it('waits for fonts before measuring', async () => {
    await expect(measuredMetrics()).resolves.toEqual(FALLBACK_METRICS);
  });

  it('tolerates a missing font loading api', async () => {
    const original = document.fonts;
    Object.defineProperty(document, 'fonts', { value: undefined, configurable: true });
    await expect(fontsReady()).resolves.toBeUndefined();
    Object.defineProperty(document, 'fonts', { value: original, configurable: true });
  });
});
