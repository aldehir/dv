import type { Spec, ThemePref, Totals, ViewMode } from '../api/types';
import type { Bus } from '../core/bus';
import type { Component } from '../core/component';
import { createDisposer } from '../core/component';
import { el, on, replaceChildren } from '../core/dom';
import type { AppState, AppStore } from '../core/store';
import { THEME_PREFS, themePrefLabel } from '../theme/catppuccin';

export interface ToolbarProps {
  repoRoot: string;
  spec: Spec | null;
  totals: Totals | null;
  view: ViewMode;
  wrap: boolean;
  themePref: ThemePref;
  panelVisible: boolean;
  commentsEnabled: boolean;
}

export interface ToolbarDeps {
  store: AppStore;
  bus: Bus;
}

const SPEC_LABELS: Record<Spec['kind'], string> = {
  worktree: 'worktree',
  staged: 'staged',
  commit: 'commit',
  'two-dot': 'two-dot',
  'three-dot': 'three-dot',
  'merge-base': 'merge-base',
};

const basename = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '');
  const cut = trimmed.lastIndexOf('/');
  return cut < 0 ? trimmed : trimmed.slice(cut + 1);
};

const specSummary = (spec: Spec | null): string => {
  if (!spec) return '';
  const label = SPEC_LABELS[spec.kind];
  if (spec.kind === 'worktree' || spec.kind === 'staged') return label;
  const left = spec.left === '' ? '∅' : spec.left;
  const right = spec.right === '' ? 'worktree' : spec.right;
  const joiner = spec.kind === 'three-dot' ? '...' : '..';
  return `${left}${joiner}${right}`;
};

export const toolbarProps = (state: AppState): ToolbarProps => ({
  repoRoot: state.session?.repoRoot ?? '',
  spec: state.session?.spec ?? null,
  totals: state.manifest?.totals ?? null,
  view: state.view,
  wrap: state.wrap,
  themePref: state.themePref,
  panelVisible: state.panelVisible,
  commentsEnabled: state.commentsEnabled,
});

export const createToolbar = ({ store, bus }: ToolbarDeps): Component<ToolbarProps> => {
  const disposer = createDisposer();

  const repo = el('span', { class: 'dv-toolbar__repo' });
  const rev = el('span', { class: 'dv-toolbar__rev' });
  const splitButton = el('button', {
    class: 'dv-btn',
    type: 'button',
    textContent: 'split',
    title: 'Side-by-side diff',
  });
  const unifiedButton = el('button', {
    class: 'dv-btn',
    type: 'button',
    textContent: 'unified',
    title: 'Unified diff',
  });
  const wrapButton = el('button', {
    class: 'dv-btn',
    type: 'button',
    textContent: 'wrap',
    title: 'Wrap long lines',
  });
  const panelButton = el('button', {
    class: 'dv-btn',
    type: 'button',
    textContent: 'comments',
    title: 'Toggle the comment inbox',
  });
  const themeSelect = el(
    'select',
    { class: 'dv-select', title: 'Catppuccin flavor' },
    ...THEME_PREFS.map((pref) =>
      el('option', { value: pref, textContent: themePrefLabel(pref) }),
    ),
  );
  const counts = el('div', { class: 'dv-counts' });

  const root = el(
    'div',
    { class: 'dv-toolbar' },
    el('div', { class: 'dv-toolbar__spec' }, repo, rev),
    el('div', { class: 'dv-toolbar__spacer' }),
    counts,
    el('div', { class: 'dv-seg' }, splitButton, unifiedButton),
    el('div', { class: 'dv-toolbar__group' }, wrapButton, panelButton, themeSelect),
  );

  const update = (props: ToolbarProps): void => {
    repo.textContent = basename(props.repoRoot);
    rev.textContent = specSummary(props.spec);
    splitButton.setAttribute('aria-pressed', String(props.view === 'split'));
    unifiedButton.setAttribute('aria-pressed', String(props.view === 'unified'));
    wrapButton.setAttribute('aria-pressed', String(props.wrap));
    panelButton.setAttribute('aria-pressed', String(props.panelVisible));
    panelButton.hidden = !props.commentsEnabled;
    themeSelect.value = props.themePref;

    const totals = props.totals;
    replaceChildren(
      counts,
      el('span', {
        class: 'dv-count dv-count--files',
        textContent: `${totals?.files ?? 0} files`,
      }),
      el('span', {
        class: 'dv-count dv-count--add',
        textContent: `+${totals?.additions ?? 0}`,
      }),
      el('span', {
        class: 'dv-count dv-count--del',
        textContent: `-${totals?.deletions ?? 0}`,
      }),
    );
  };

  disposer.add(on(splitButton, 'click', () => store.set({ view: 'split' })));
  disposer.add(on(unifiedButton, 'click', () => store.set({ view: 'unified' })));
  disposer.add(on(wrapButton, 'click', () => store.set({ wrap: !store.get().wrap })));
  disposer.add(on(panelButton, 'click', () => bus.emit('panel:toggle')));
  disposer.add(
    on(themeSelect, 'change', () => {
      bus.emit('theme:set', themeSelect.value as ThemePref);
    }),
  );
  disposer.add(store.subscribe((state) => update(toolbarProps(state))));

  update(toolbarProps(store.get()));

  return { el: root, update, destroy: disposer.dispose };
};
