import type { VirtualFileMetrics } from '@pierre/diffs';

export const HUNK_LINE_COUNT = 50;
export const HEADER_GAP_UNITS = 3;
export const FALLBACK_LINE_HEIGHT = 20;
export const FALLBACK_FONT_SIZE = 13;
export const FALLBACK_SPACING = 8;
export const MONO_STACK = "'Victor Mono Variable', ui-monospace, monospace";

const PROBE_ROWS = 16;
const PROBE_TEXT = 'MMMMMMMMMMWWWWWWWWWWiiiiiiiiii0123456789';

export const FALLBACK_METRICS: VirtualFileMetrics = {
  hunkLineCount: HUNK_LINE_COUNT,
  lineHeight: FALLBACK_LINE_HEIGHT,
  diffHeaderHeight: FALLBACK_LINE_HEIGHT + HEADER_GAP_UNITS * FALLBACK_SPACING,
  spacing: FALLBACK_SPACING,
};

const readText = (styles: CSSStyleDeclaration, name: string, fallback: string): string => {
  const value = styles.getPropertyValue(name).trim();
  return value === '' ? fallback : value;
};

const readPixels = (
  styles: CSSStyleDeclaration,
  name: string,
  fallback: number,
): number => {
  const parsed = Number.parseFloat(styles.getPropertyValue(name));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const probeRowHeight = (host: HTMLElement, styles: CSSStyleDeclaration): number => {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.position = 'absolute';
  probe.style.top = '0';
  probe.style.left = '-99999px';
  probe.style.visibility = 'hidden';
  probe.style.whiteSpace = 'pre';
  probe.style.padding = '0';
  probe.style.border = '0';
  probe.style.fontFamily = readText(styles, '--diffs-font-family', MONO_STACK);
  probe.style.fontSize = readText(styles, '--diffs-font-size', `${FALLBACK_FONT_SIZE}px`);
  probe.style.lineHeight = readText(
    styles,
    '--diffs-line-height',
    `${FALLBACK_LINE_HEIGHT}px`,
  );
  probe.textContent = Array.from({ length: PROBE_ROWS }, () => PROBE_TEXT).join('\n');

  host.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height / PROBE_ROWS;
};

export const measureMetrics = (host?: HTMLElement | null): VirtualFileMetrics => {
  const target = host ?? document.body;
  const styles = getComputedStyle(document.documentElement);
  const spacing = readPixels(styles, '--diffs-gap-block', FALLBACK_SPACING);
  const declared = readPixels(styles, '--diffs-line-height', FALLBACK_LINE_HEIGHT);
  const probed = probeRowHeight(target, styles);
  const lineHeight = probed >= 1 ? Math.round(probed * 100) / 100 : declared;

  return {
    hunkLineCount: HUNK_LINE_COUNT,
    lineHeight,
    diffHeaderHeight: lineHeight + HEADER_GAP_UNITS * spacing,
    spacing,
  };
};

export const fontsReady = async (): Promise<void> => {
  const fonts: FontFaceSet | undefined = document.fonts;
  if (!fonts?.ready) return;
  try {
    await fonts.ready;
  } catch {
    return;
  }
};

export const measuredMetrics = async (
  host?: HTMLElement | null,
): Promise<VirtualFileMetrics> => {
  await fontsReady();
  return measureMetrics(host);
};
