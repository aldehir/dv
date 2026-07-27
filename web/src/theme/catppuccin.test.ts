import { describe, expect, it } from 'vitest';
import type { Flavor } from '../api/types';
import {
  AUTO_THEME,
  FLAVORS,
  THEME_PREFS,
  colorSchemeFor,
  flavorLabel,
  isDarkFlavor,
  isFlavor,
  isThemePref,
  nextThemePref,
  resolveFlavor,
  shikiThemeFor,
  swatchHexes,
  themeOptionFor,
} from './catppuccin';

describe('flavor mapping', () => {
  it('maps every flavor to its bundled shiki theme name', () => {
    expect(FLAVORS.map(shikiThemeFor)).toEqual([
      'catppuccin-latte',
      'catppuccin-frappe',
      'catppuccin-macchiato',
      'catppuccin-mocha',
    ]);
  });

  it('uses the light/dark object form for auto', () => {
    expect(themeOptionFor('auto')).toEqual(AUTO_THEME);
    expect(AUTO_THEME).toEqual({
      light: 'catppuccin-latte',
      dark: 'catppuccin-mocha',
    });
  });

  it('passes an explicit flavor straight through as a string', () => {
    expect(themeOptionFor('macchiato')).toBe('catppuccin-macchiato');
  });

  it('knows which flavors are dark', () => {
    expect(isDarkFlavor('latte')).toBe(false);
    expect(colorSchemeFor('latte')).toBe('light');
    for (const flavor of ['frappe', 'macchiato', 'mocha'] as Flavor[]) {
      expect(isDarkFlavor(flavor)).toBe(true);
      expect(colorSchemeFor(flavor)).toBe('dark');
    }
  });

  it('resolves auto against the system preference', () => {
    expect(resolveFlavor('auto', true)).toBe('mocha');
    expect(resolveFlavor('auto', false)).toBe('latte');
    expect(resolveFlavor('frappe', true)).toBe('frappe');
  });

  it('validates flavor and preference input', () => {
    expect(isFlavor('mocha')).toBe(true);
    expect(isFlavor('auto')).toBe(false);
    expect(isFlavor('nope')).toBe(false);
    expect(isFlavor(null)).toBe(false);
    expect(isThemePref('auto')).toBe(true);
    expect(isThemePref('latte')).toBe(true);
    expect(isThemePref('dark')).toBe(false);
  });

  it('cycles through every preference and wraps', () => {
    const seen = THEME_PREFS.map((_pref, index) =>
      THEME_PREFS.slice(0, index + 1).reduce(nextThemePref, THEME_PREFS[0] ?? 'auto'),
    );
    expect(seen.length).toBe(THEME_PREFS.length);
    expect(nextThemePref('auto')).toBe('latte');
    expect(nextThemePref('mocha')).toBe('auto');
  });

  it('sources labels and swatches from the palette package', () => {
    expect(flavorLabel('frappe')).toBe('Frappé');
    expect(swatchHexes('mocha')[0]).toBe('#1e1e2e');
    for (const hex of swatchHexes('latte')) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
