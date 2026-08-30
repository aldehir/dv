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

/** What the touch layout displaced, to be put back if a mouse turns up. */
interface Fine {
  wrap: boolean;
}

const safeMedia = (): MediaQueryList | null =>
  typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(COARSE_QUERY) : null;

/**
 * Watches what is doing the pointing and writes it into the store. Separate
 * from `compact`, which is only ever about width: a phone is both, a laptop
 * with a narrow window is one, and a tablet in landscape is the other.
 *
 * A thumb also gets soft wrapping, which is not only about reading a long line
 * without dragging it sideways. Unwrapped, the library gives every file its own
 * horizontal scroller, and WebKit hands a touch to the scroller under it and
 * then drops the gesture when that element cannot move on the axis the gesture
 * is on — the same latch `diff/wheel.ts` carries a trackpad workaround for. Over
 * a hunk tall enough to fill the screen there is nowhere else to put the finger,
 * so the diff simply refuses to scroll. Wrapped, there is no inner scroller to
 * latch onto: see `SHADOW_CSS`.
 */
export const createPointerKind = ({ store, media }: PointerKindDeps): Disposable => {
  const disposer = createDisposer();
  const query = media === undefined ? safeMedia() : media;
  /** Non-null exactly while the touch layout is in force. */
  let fine: Fine | null = null;

  const enter = (): void => {
    fine = { wrap: store.get().wrap };
    store.set({ coarse: true, wrap: true });
  };

  const leave = (): void => {
    store.set(fine === null ? { coarse: false } : { ...fine, coarse: false });
    fine = null;
  };

  const apply = (matches: boolean): void => {
    if (matches === (fine !== null)) return;
    if (matches) enter();
    else leave();
  };

  // The session's defaults land a beat after the first paint and would take the
  // wrapping away again. They describe the diff a mouse would have read, so keep
  // them for that and stay wrapped.
  disposer.add(
    store.subscribe('session', () => {
      if (fine === null) return;
      fine = { wrap: store.get().wrap };
      store.set({ wrap: true });
    }),
  );
  if (query) disposer.add(on(query, 'change', (event) => apply(event.matches)));

  apply(query?.matches ?? false);

  return { destroy: disposer.dispose };
};
