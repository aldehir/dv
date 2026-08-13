import type { Disposable } from '../core/component';
import { createDisposer } from '../core/component';
import { on } from '../core/dom';
import type { AppStore } from '../core/store';

/** A thumb, a stylus, a TV remote: anything that cannot land on a hairline. */
export const COARSE_QUERY = '(pointer: coarse)';

export interface PointerKindDeps {
  store: AppStore;
  /** Null stands for an engine without `matchMedia`, which is never coarse. */
  media?: MediaQueryList | null;
}

const safeMedia = (): MediaQueryList | null =>
  typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(COARSE_QUERY) : null;

/**
 * Watches what is doing the pointing and writes it into the store. Separate
 * from `compact`, which is only ever about width: a phone is both, a laptop
 * with a narrow window is one, and a tablet in landscape is the other.
 */
export const createPointerKind = ({ store, media }: PointerKindDeps): Disposable => {
  const disposer = createDisposer();
  const query = media === undefined ? safeMedia() : media;

  const apply = (matches: boolean): void => {
    store.set({ coarse: matches });
  };

  if (query) disposer.add(on(query, 'change', (event) => apply(event.matches)));
  apply(query?.matches ?? false);

  return { destroy: disposer.dispose };
};
