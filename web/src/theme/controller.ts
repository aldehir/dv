import type { Flavor, ThemePref } from '../api/types';
import type { Bus } from '../core/bus';
import type { Disposable } from '../core/component';
import { createDisposer } from '../core/component';
import { on } from '../core/dom';
import type { AppStore } from '../core/store';
import {
  colorSchemeFor,
  isThemePref,
  nextThemePref,
  resolveFlavor,
} from './catppuccin';

export const THEME_STORAGE_KEY = 'dv:theme';
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeControllerDeps {
  store: AppStore;
  bus: Bus;
  root?: HTMLElement;
  storage?: ThemeStorage | null;
  darkScheme?: MediaQueryList | null;
}

export interface ThemeController extends Disposable {
  start(): void;
  pref(): ThemePref;
  flavor(): Flavor;
  set(pref: ThemePref, persist?: boolean): void;
  cycle(): void;
}

const safeStorage = (): ThemeStorage | null => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

const safeMedia = (): MediaQueryList | null => {
  if (typeof globalThis.matchMedia !== 'function') return null;
  return globalThis.matchMedia(DARK_SCHEME_QUERY);
};

export const createThemeController = ({
  store,
  bus,
  root,
  storage,
  darkScheme,
}: ThemeControllerDeps): ThemeController => {
  const disposer = createDisposer();
  const target = root ?? document.documentElement;
  const box = storage === undefined ? safeStorage() : storage;
  const media = darkScheme === undefined ? safeMedia() : darkScheme;
  let pref = store.get().themePref;
  let sessionApplied = false;

  const persist = (value: ThemePref): void => {
    if (!box) return;
    try {
      box.setItem(THEME_STORAGE_KEY, value);
    } catch {
      return;
    }
  };

  const restore = (): ThemePref | null => {
    if (!box) return null;
    try {
      const stored = box.getItem(THEME_STORAGE_KEY);
      return isThemePref(stored) ? stored : null;
    } catch {
      return null;
    }
  };

  const apply = (next: ThemePref, shouldPersist: boolean): void => {
    pref = next;
    const flavor = resolveFlavor(next, media?.matches ?? true);
    target.dataset.flavor = flavor;
    target.style.colorScheme = colorSchemeFor(flavor);
    if (shouldPersist) persist(next);
    store.set({ themePref: next, flavor });
    bus.emit('theme:changed', { pref: next, flavor });
  };

  disposer.add(bus.on('theme:set', (next) => apply(next, true)));
  disposer.add(bus.on('theme:cycle', () => apply(nextThemePref(pref), true)));
  if (media) {
    disposer.add(
      on(media, 'change', () => {
        if (pref === 'auto') apply('auto', false);
      }),
    );
  }
  disposer.add(
    store.subscribe('session', (session) => {
      if (sessionApplied || !session) return;
      sessionApplied = true;
      const serverPref = session.defaults.theme;
      if (isThemePref(serverPref)) apply(serverPref, false);
    }),
  );

  return {
    start() {
      apply(restore() ?? pref, false);
    },
    pref: () => pref,
    flavor: () => resolveFlavor(pref, media?.matches ?? true),
    set: (next, shouldPersist = true) => apply(next, shouldPersist),
    cycle: () => apply(nextThemePref(pref), true),
    destroy: disposer.dispose,
  };
};
