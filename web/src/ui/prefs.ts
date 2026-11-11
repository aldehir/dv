import type { Disposable } from '../core/component';
import { createDisposer } from '../core/component';
import type { AppState, AppStore } from '../core/store';

export interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PrefsDeps {
  store: AppStore;
  storage?: PrefStorage | null;
}

type PrefKey = 'view' | 'wrap' | 'singleFile';

interface Pref<K extends PrefKey> {
  key: K;
  storageKey: string;
  read(stored: string): AppState[K] | undefined;
}

const VIEW: Pref<'view'> = {
  key: 'view',
  storageKey: 'dv:view',
  read: (stored) => (stored === 'split' || stored === 'unified' ? stored : undefined),
};

const flag = <K extends 'wrap' | 'singleFile'>(key: K, storageKey: string): Pref<K> => ({
  key,
  storageKey,
  read: (stored) =>
    (stored === 'true' ? true : stored === 'false' ? false : undefined) as
      | AppState[K]
      | undefined,
});

export const PREFS = [
  VIEW,
  flag('wrap', 'dv:wrap'),
  flag('singleFile', 'dv:single-file'),
] as const;

const safeStorage = (): PrefStorage | null => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

/**
 * Remembers the diff settings across reloads and runs. Restored synchronously,
 * so it wants to run ahead of the compact layout and the viewer: the narrow
 * layout then sets aside the remembered view, and the first draw is already
 * the one the reader left.
 */
export const createPrefs = ({ store, storage }: PrefsDeps): Disposable => {
  const disposer = createDisposer();
  const box = storage === undefined ? safeStorage() : storage;
  /** Set while a flag's value goes in: it holds for this run, not the next. */
  let applying = false;

  const restore = <K extends PrefKey>(pref: Pref<K>): void => {
    try {
      const stored = box?.getItem(pref.storageKey);
      const value = stored == null ? undefined : pref.read(stored);
      if (value !== undefined) store.set({ [pref.key]: value } as Partial<AppState>);
    } catch {
      // Unreadable storage leaves the default in place.
    }
  };

  const watch = <K extends PrefKey>(pref: Pref<K>): void => {
    disposer.add(
      store.subscribe(pref.key, (value, state) => {
        // A narrow window forces unified on its own account; that is not the
        // reader's choice, and the wide view it set aside comes back after.
        if (applying || state.compact) return;
        try {
          box?.setItem(pref.storageKey, String(value));
        } catch {
          // Full or blocked storage only costs the setting on the next load.
        }
      }),
    );
  };

  for (const pref of PREFS) {
    restore(pref);
    watch(pref);
  }

  // A flag or config key outranks what was remembered, for this run only. The
  // session carries one only when it was asked for. Ahead of the compact
  // layout's own session listener, which then sets the flag's view aside.
  disposer.add(
    store.subscribe('session', (session) => {
      if (!session) return;
      const { view, wrap } = session.defaults;
      applying = true;
      try {
        store.set({ ...(view === '' ? {} : { view }), ...(wrap === null ? {} : { wrap }) });
      } finally {
        applying = false;
      }
    }),
  );

  return { destroy: disposer.dispose };
};
