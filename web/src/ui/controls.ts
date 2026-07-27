import type { ThemePref, ViewMode } from '../api/types';
import type { Bus } from '../core/bus';
import type { Component } from '../core/component';
import { createDisposer } from '../core/component';
import { el, on } from '../core/dom';
import type { AppState, AppStore } from '../core/store';
import { THEME_PREFS, themePrefLabel } from '../theme/catppuccin';
import { icon } from './icons';

export interface ControlsProps {
  view: ViewMode;
  wrap: boolean;
  themePref: ThemePref;
  panelVisible: boolean;
  commentsEnabled: boolean;
}

export interface ControlsDeps {
  store: AppStore;
  bus: Bus;
}

export const controlsProps = (state: AppState): ControlsProps => ({
  view: state.view,
  wrap: state.wrap,
  themePref: state.themePref,
  panelVisible: state.panelVisible,
  commentsEnabled: state.commentsEnabled,
});

const row = (label: string, ...children: (Node | string)[]): HTMLElement =>
  el(
    'div',
    { class: 'dv-control' },
    el('span', { class: 'dv-control__label', textContent: label }),
    el('div', { class: 'dv-control__field' }, ...children),
  );

const toggle = (
  name: Parameters<typeof icon>[0],
  ariaLabel: string,
  title: string,
): { button: HTMLButtonElement; state: HTMLElement } => {
  const state = el('span', { class: 'dv-toggle__state' });
  const button = el(
    'button',
    { class: 'dv-toggle', type: 'button', ariaLabel, title },
    icon(name),
    state,
  );
  return { button, state };
};

export const createControls = ({ store, bus }: ControlsDeps): Component<ControlsProps> => {
  const disposer = createDisposer();

  const splitButton = el(
    'button',
    {
      class: 'dv-seg__btn',
      type: 'button',
      ariaLabel: 'Split view',
      title: 'Side-by-side diff',
    },
    icon('split'),
  );
  const unifiedButton = el(
    'button',
    {
      class: 'dv-seg__btn',
      type: 'button',
      ariaLabel: 'Unified view',
      title: 'Unified diff',
    },
    icon('unified'),
  );
  const wrap = toggle('wrap', 'Wrap long lines', 'Wrap long lines');
  const comments = toggle('comments', 'Toggle the comment inbox', 'Toggle the comment inbox');
  const themeSelect = el(
    'select',
    { class: 'dv-select', ariaLabel: 'Catppuccin flavor', title: 'Catppuccin flavor' },
    ...THEME_PREFS.map((pref) =>
      el('option', { value: pref, textContent: themePrefLabel(pref) }),
    ),
  );

  const commentsRow = row('Comments', comments.button);
  const root = el(
    'div',
    { class: 'dv-controls' },
    row('View', el('div', { class: 'dv-seg' }, splitButton, unifiedButton)),
    row('Wrap', wrap.button),
    commentsRow,
    row('Theme', themeSelect),
  );

  const update = (props: ControlsProps): void => {
    splitButton.setAttribute('aria-pressed', String(props.view === 'split'));
    unifiedButton.setAttribute('aria-pressed', String(props.view === 'unified'));
    wrap.button.setAttribute('aria-pressed', String(props.wrap));
    wrap.state.textContent = props.wrap ? 'on' : 'off';
    comments.button.setAttribute('aria-pressed', String(props.panelVisible));
    comments.state.textContent = props.panelVisible ? 'on' : 'off';
    commentsRow.hidden = !props.commentsEnabled;
    themeSelect.value = props.themePref;
  };

  disposer.add(on(splitButton, 'click', () => store.set({ view: 'split' })));
  disposer.add(on(unifiedButton, 'click', () => store.set({ view: 'unified' })));
  disposer.add(on(wrap.button, 'click', () => store.set({ wrap: !store.get().wrap })));
  disposer.add(on(comments.button, 'click', () => bus.emit('panel:toggle')));
  disposer.add(
    on(themeSelect, 'change', () => {
      bus.emit('theme:set', themeSelect.value as ThemePref);
    }),
  );
  disposer.add(store.subscribe((state) => update(controlsProps(state))));

  update(controlsProps(store.get()));

  return { el: root, update, destroy: disposer.dispose };
};
