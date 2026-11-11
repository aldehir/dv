import type { Bus } from '../core/bus';
import type { Component } from '../core/component';
import { createDisposer } from '../core/component';
import { el, on } from '../core/dom';
import type { IconName } from '../ui/icons';
import { icon } from '../ui/icons';
import type { Viewer } from './viewer';

export interface HunkNavDeps {
  bus: Bus;
  viewer: Viewer;
}

const step = (name: IconName, label: string): HTMLButtonElement =>
  el(
    'button',
    { class: 'dv-hunk-nav__btn', type: 'button', ariaLabel: label, title: label },
    icon(name),
  );

/**
 * The `[` and `]` walk as two targets, floated over the bottom right corner of
 * the diff. A narrow window has no keyboard to press them on and a rail too
 * thin to aim a thumb at, and the whole diff is one list either way.
 */
export const createHunkNav = ({ bus, viewer }: HunkNavDeps): Component<void> => {
  const disposer = createDisposer();

  const previous = step('prev', 'Previous hunk');
  const next = step('next', 'Next hunk');
  const root = el('div', { class: 'dv-hunk-nav', hidden: true }, previous, next);

  const update = (): void => {
    root.hidden = viewer.hunks().length === 0;
  };

  disposer.add(on(previous, 'click', () => bus.emit('hunk:step', { delta: -1 })));
  disposer.add(on(next, 'click', () => bus.emit('hunk:step', { delta: 1 })));
  disposer.add(bus.on('file:payload', update));
  disposer.add(bus.on('manifest:ready', update));
  disposer.add(bus.on('diff:reshown', update));
  disposer.add(on(window, 'resize', update));

  update();

  return { el: root, update, destroy: disposer.dispose };
};
