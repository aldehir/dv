import type { Bus } from '../core/bus';
import type { Component } from '../core/component';
import { createDisposer } from '../core/component';
import { el, on } from '../core/dom';
import type { AppState, AppStore, PanelView } from '../core/store';
import type { IconName } from './icons';
import { icon } from './icons';

export interface DockProps {
  panelVisible: boolean;
  panelView: PanelView;
  commentsEnabled: boolean;
}

export interface DockDeps {
  store: AppStore;
  bus: Bus;
}

export const dockProps = (state: AppState): DockProps => ({
  panelVisible: state.panelVisible,
  panelView: state.panelView,
  commentsEnabled: state.commentsEnabled,
});

const tab = (name: IconName, label: string): HTMLButtonElement =>
  el(
    'button',
    { class: 'dv-icon-btn dv-dock__tab', type: 'button', ariaLabel: label, title: label },
    icon(name),
  );

/**
 * The strip down the far right edge: one button per panel list, and the only
 * way to reach either of them with the mouse.
 */
export const createDock = ({ store, bus }: DockDeps): Component<DockProps> => {
  const disposer = createDisposer();

  const hunksButton = tab('hunks', 'Toggle the hunk list');
  const commentsButton = tab('comments', 'Toggle the comment inbox');

  const root = el('div', { class: 'dv-dock' }, hunksButton, commentsButton);

  const update = (props: DockProps): void => {
    const showing = (view: PanelView): string =>
      String(props.panelVisible && props.panelView === view);
    hunksButton.setAttribute('aria-pressed', showing('hunks'));
    commentsButton.setAttribute('aria-pressed', showing('comments'));
    commentsButton.hidden = !props.commentsEnabled;
  };

  disposer.add(on(hunksButton, 'click', () => bus.emit('panel:toggle', 'hunks')));
  disposer.add(on(commentsButton, 'click', () => bus.emit('panel:toggle', 'comments')));
  disposer.add(store.subscribe((state) => update(dockProps(state))));

  update(dockProps(store.get()));

  return { el: root, update, destroy: disposer.dispose };
};
