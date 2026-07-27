import type { Bus } from '../core/bus';
import type { Component } from '../core/component';
import { createDisposer } from '../core/component';
import { el, replaceChildren } from '../core/dom';
import type { AppState, AppStore } from '../core/store';

export const DIFF_MOUNT_ID = 'dv-diff';

export interface ShellProps {
  sidebarVisible: boolean;
  panelVisible: boolean;
  placeholder: string | null;
}

export interface ShellSlots {
  toolbar: HTMLElement;
  sidebar: HTMLElement;
  controls: HTMLElement;
  status: HTMLElement;
}

export interface ShellDeps extends ShellSlots {
  store: AppStore;
  bus: Bus;
}

export interface Shell extends Component<ShellProps> {
  mount: HTMLElement;
  panel: HTMLElement;
  overlays: HTMLElement;
}

const placeholderFor = (state: AppState): string | null => {
  if (state.notice) return state.notice;
  if (!state.manifest) return 'Loading diff…';
  if (state.manifest.files.length === 0) return 'No changes';
  return null;
};

export const shellProps = (state: AppState): ShellProps => ({
  sidebarVisible: state.sidebarVisible,
  panelVisible: state.panelVisible,
  placeholder: placeholderFor(state),
});

export const createShell = ({
  toolbar,
  sidebar,
  controls,
  status,
  store,
  bus,
}: ShellDeps): Shell => {
  const disposer = createDisposer();

  const mount = el('div', { class: 'dv-shell__mount', id: DIFF_MOUNT_ID });
  const placeholder = el('div', { class: 'dv-shell__placeholder', hidden: true });
  const panel = el('aside', { class: 'dv-shell__panel' });
  const overlays = el('div', { class: 'dv-shell__overlays' });

  const root = el(
    'div',
    { class: 'dv-shell' },
    el('header', { class: 'dv-shell__toolbar' }, toolbar),
    el(
      'aside',
      { class: 'dv-shell__sidebar' },
      el('div', { class: 'dv-shell__tree' }, sidebar),
      el('div', { class: 'dv-shell__controls' }, controls),
    ),
    el('div', { class: 'dv-shell__main' }, mount, placeholder),
    panel,
    el('footer', { class: 'dv-shell__status' }, status),
    overlays,
  );

  const update = (props: ShellProps): void => {
    root.dataset.sidebar = props.sidebarVisible ? 'visible' : 'hidden';
    root.dataset.panel = props.panelVisible ? 'visible' : 'hidden';
    placeholder.hidden = props.placeholder === null;
    replaceChildren(placeholder, props.placeholder ?? '');
  };

  disposer.add(store.subscribe((state) => update(shellProps(state))));
  disposer.add(
    bus.on('panel:toggle', () => {
      store.set({ panelVisible: !store.get().panelVisible });
    }),
  );
  disposer.add(
    bus.on('sidebar:toggle', () => {
      store.set({ sidebarVisible: !store.get().sidebarVisible });
    }),
  );

  update(shellProps(store.get()));

  return {
    el: root,
    mount,
    panel,
    overlays,
    update,
    destroy: disposer.dispose,
  };
};
