import type { Bus } from '../core/bus';
import type { Component } from '../core/component';
import { createDisposer } from '../core/component';
import { el, on } from '../core/dom';
import type { AppStore } from '../core/store';
import { icon } from './icons';

export interface FullscreenDeps {
  store: AppStore;
  bus: Bus;
  /** The element handed to the browser's own fullscreen; the page by default. */
  target?: Element;
  document?: Document;
}

/**
 * Two things wearing one name. `fullscreen` in the store folds the toolbar and
 * the status bar away, which is the part that works everywhere — iOS Safari on
 * a phone has no element fullscreen at all. Where the browser does have it, ask
 * for it as well, and follow it back out: leaving through the browser's own
 * gesture has to put the chrome back.
 *
 * The button is the way out. Fullscreen hides the toolbar the toggle lives in,
 * and a phone has no `f` to press.
 */
export const createFullscreen = ({
  store,
  bus,
  target,
  document: doc = document,
}: FullscreenDeps): Component<void> => {
  const disposer = createDisposer();
  const element = target ?? doc.documentElement;

  const button = el(
    'button',
    {
      class: 'dv-icon-btn dv-fullscreen-exit',
      type: 'button',
      hidden: true,
      ariaLabel: 'Leave fullscreen',
      title: 'Leave fullscreen',
    },
    icon('shrink'),
  );

  /** Both calls reject on a gesture the browser did not like; the chrome folds either way. */
  const ask = (wanted: boolean): void => {
    if (wanted) {
      if (doc.fullscreenElement === null) void element.requestFullscreen?.().catch(() => {});
      return;
    }
    if (doc.fullscreenElement !== null) void doc.exitFullscreen?.().catch(() => {});
  };

  const apply = (fullscreen: boolean): void => {
    button.hidden = !fullscreen;
    ask(fullscreen);
  };

  disposer.add(on(button, 'click', () => bus.emit('fullscreen:toggle')));
  disposer.add(
    bus.on('fullscreen:toggle', () => {
      store.set({ fullscreen: !store.get().fullscreen });
    }),
  );
  disposer.add(store.subscribe('fullscreen', apply));
  disposer.add(
    on(doc, 'fullscreenchange', () => {
      if (doc.fullscreenElement === null) store.set({ fullscreen: false });
    }),
  );

  apply(store.get().fullscreen);

  return { el: button, update: () => {}, destroy: disposer.dispose };
};
