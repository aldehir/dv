import type { Bus } from '../core/bus';
import type { Component, OverlayProps } from '../core/component';
import { createDisposer } from '../core/component';
import { el, on } from '../core/dom';
import { KEYBINDS } from './keybinds';

export interface HelpDeps {
  bus: Bus;
}

export const createHelp = ({ bus }: HelpDeps): Component<OverlayProps> => {
  const disposer = createDisposer();

  const closeButton = el('button', {
    class: 'dv-btn',
    type: 'button',
    textContent: 'close',
  });

  const rows = KEYBINDS.map((binding) =>
    el(
      'tr',
      null,
      el('td', null, el('kbd', { textContent: binding.keys })),
      el('td', { class: 'dv-keys__label', textContent: binding.label }),
    ),
  );

  const card = el(
    'div',
    { class: 'dv-overlay__card', role: 'dialog', ariaLabel: 'Keyboard shortcuts' },
    el(
      'div',
      { class: 'dv-overlay__title' },
      el('span', { textContent: 'Keyboard shortcuts' }),
      closeButton,
    ),
    el('table', { class: 'dv-keys' }, el('tbody', null, ...rows)),
  );

  const root = el('div', { class: 'dv-overlay', hidden: true }, card);

  disposer.add(on(closeButton, 'click', () => bus.emit('overlay:dismiss')));
  disposer.add(
    on(root, 'click', (event) => {
      if (event.target === root) bus.emit('overlay:dismiss');
    }),
  );

  return {
    el: root,
    update({ open }: OverlayProps) {
      root.hidden = !open;
    },
    destroy: disposer.dispose,
  };
};
