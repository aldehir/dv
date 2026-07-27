import { flavors } from '@catppuccin/palette';
import type { Flavor, ThemePref } from '../api/types';

export const FLAVORS: readonly Flavor[] = ['latte', 'frappe', 'macchiato', 'mocha'];
export const THEME_PREFS: readonly ThemePref[] = [...FLAVORS, 'auto'];

export const LIGHT_FLAVOR: Flavor = 'latte';
export const DARK_FLAVOR: Flavor = 'mocha';

export interface AutoTheme {
  light: string;
  dark: string;
}

export const isFlavor = (value: unknown): value is Flavor =>
  typeof value === 'string' && (FLAVORS as readonly string[]).includes(value);

export const isThemePref = (value: unknown): value is ThemePref =>
  typeof value === 'string' && (THEME_PREFS as readonly string[]).includes(value);

export const shikiThemeFor = (flavor: Flavor): string => `catppuccin-${flavor}`;

export const AUTO_THEME: AutoTheme = {
  light: shikiThemeFor(LIGHT_FLAVOR),
  dark: shikiThemeFor(DARK_FLAVOR),
};

export const themeOptionFor = (pref: ThemePref): string | AutoTheme =>
  pref === 'auto' ? AUTO_THEME : shikiThemeFor(pref);

export const isDarkFlavor = (flavor: Flavor): boolean => flavors[flavor].dark;

export const flavorLabel = (flavor: Flavor): string => flavors[flavor].name;

export const themePrefLabel = (pref: ThemePref): string =>
  pref === 'auto' ? 'Auto' : flavorLabel(pref);

export const resolveFlavor = (pref: ThemePref, prefersDark: boolean): Flavor =>
  pref === 'auto' ? (prefersDark ? DARK_FLAVOR : LIGHT_FLAVOR) : pref;

export const colorSchemeFor = (flavor: Flavor): 'light' | 'dark' =>
  isDarkFlavor(flavor) ? 'dark' : 'light';

export const nextThemePref = (pref: ThemePref): ThemePref => {
  const index = THEME_PREFS.indexOf(pref);
  return THEME_PREFS[(index + 1) % THEME_PREFS.length] ?? 'auto';
};

export const accentHex = (flavor: Flavor): string => flavors[flavor].colors.mauve.hex;

export const swatchHexes = (flavor: Flavor): readonly string[] => {
  const colors = flavors[flavor].colors;
  return [colors.base.hex, colors.green.hex, colors.red.hex, colors.blue.hex];
};
