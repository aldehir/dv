import type { ViewMode } from '../api/types';
import type { Disposable } from '../core/component';
import { createDisposer } from '../core/component';
import { on } from '../core/dom';
import type { AppStore } from '../core/store';

/**
 * Under this the file tree and a side-by-side diff cannot both fit, and the
 * diff is what the reader came for.
 */
export const COMPACT_QUERY = '(max-width: 48rem)';

export interface CompactDeps {
  store: AppStore;
  /** Null stands for an engine without `matchMedia`, which is never compact. */
  media?: MediaQueryList | null;
}

/** What the narrow layout displaced, to be put back when the window grows. */
interface Wide {
  view: ViewMode;
  sidebarVisible: boolean;
}

const safeMedia = (): MediaQueryList | null =>
  typeof globalThis.matchMedia === 'function'
    ? globalThis.matchMedia(COMPACT_QUERY)
    : null;

/**
 * Watches the window width and switches the layout that goes with it: unified
 * columns and no file tree while it is narrow, whatever was there before once
 * it is wide again. Neither is forced — a choice made while narrow stands until
 * the window crosses the line.
 */
export const createCompactLayout = ({ store, media }: CompactDeps): Disposable => {
  const disposer = createDisposer();
  const query = media === undefined ? safeMedia() : media;
  /** Non-null exactly while the narrow layout is in force. */
  let wide: Wide | null = null;

  const enter = (): void => {
    const { view, sidebarVisible } = store.get();
    wide = { view, sidebarVisible };
    store.set({ compact: true, view: 'unified', sidebarVisible: false });
  };

  const leave = (): void => {
    store.set(wide === null ? { compact: false } : { ...wide, compact: false });
    wide = null;
  };

  const apply = (matches: boolean): void => {
    if (matches === (wide !== null)) return;
    if (matches) enter();
    else leave();
  };

  // The session's defaults land a beat after the first paint and would put the
  // split view back. They describe the diff a wide window would have shown, so
  // take them as that and stay unified.
  disposer.add(
    store.subscribe('session', () => {
      if (wide === null) return;
      wide = { ...wide, view: store.get().view };
      store.set({ view: 'unified' });
    }),
  );
  if (query) disposer.add(on(query, 'change', (event) => apply(event.matches)));

  apply(query?.matches ?? false);

  return { destroy: disposer.dispose };
};
