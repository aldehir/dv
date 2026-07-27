import type { Spec, Totals } from '../api/types';
import type { Bus } from '../core/bus';
import type { Component } from '../core/component';
import { createDisposer } from '../core/component';
import { el, on, replaceChildren } from '../core/dom';
import type { AppState, AppStore } from '../core/store';
import { icon } from './icons';

export interface ToolbarProps {
  repoRoot: string;
  spec: Spec | null;
  totals: Totals | null;
  sidebarVisible: boolean;
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

/** Trims full object ids down to the length people actually read. */
const shorten = (rev: string): string =>
  /^[0-9a-f]{40}$/.test(rev) ? rev.slice(0, 8) : rev;

const specSummary = (spec: Spec | null): string => {
  if (!spec) return '';
  const label = SPEC_LABELS[spec.kind];
  if (spec.kind === 'worktree' || spec.kind === 'staged') return label;
  const left = spec.left === '' ? '∅' : shorten(spec.left);
  const right = spec.right === '' ? 'worktree' : shorten(spec.right);
  const joiner = spec.kind === 'three-dot' ? '...' : '..';
  return `${left}${joiner}${right}`;
};

export const toolbarProps = (state: AppState): ToolbarProps => ({
  repoRoot: state.session?.repoRoot ?? '',
  spec: state.session?.spec ?? null,
  totals: state.manifest?.totals ?? null,
  sidebarVisible: state.sidebarVisible,
  panelVisible: state.panelVisible,
  commentsEnabled: state.commentsEnabled,
});

export const createToolbar = ({ store, bus }: ToolbarDeps): Component<ToolbarProps> => {
  const disposer = createDisposer();

  const sidebarButton = el(
    'button',
    {
      class: 'dv-icon-btn',
      type: 'button',
      ariaLabel: 'Toggle the file tree',
      title: 'Toggle the file tree',
    },
    icon('sidebar'),
  );
  const repo = el('span', { class: 'dv-toolbar__repo' });
  const rev = el('span', { class: 'dv-toolbar__rev' });
  const counts = el('div', { class: 'dv-counts' });
  const commentsButton = el(
    'button',
    {
      class: 'dv-icon-btn',
      type: 'button',
      ariaLabel: 'Toggle the comment inbox',
      title: 'Toggle the comment inbox',
    },
    icon('comments'),
  );
  const helpButton = el('button', {
    class: 'dv-icon-btn',
    type: 'button',
    textContent: '?',
    ariaLabel: 'Keyboard shortcuts',
    title: 'Keyboard shortcuts',
  });

  const root = el(
    'div',
    { class: 'dv-toolbar' },
    sidebarButton,
    el(
      'div',
      { class: 'dv-toolbar__spec' },
      repo,
      el('span', { class: 'dv-toolbar__rev-chip' }, icon('compare'), rev),
    ),
    el('div', { class: 'dv-toolbar__spacer' }),
    counts,
    commentsButton,
    helpButton,
  );

  const update = (props: ToolbarProps): void => {
    repo.textContent = basename(props.repoRoot);
    rev.textContent = specSummary(props.spec);
    sidebarButton.setAttribute('aria-pressed', String(props.sidebarVisible));
    commentsButton.setAttribute('aria-pressed', String(props.panelVisible));
    commentsButton.hidden = !props.commentsEnabled;

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

  disposer.add(on(helpButton, 'click', () => bus.emit('help:toggle')));
  disposer.add(on(sidebarButton, 'click', () => bus.emit('sidebar:toggle')));
  disposer.add(on(commentsButton, 'click', () => bus.emit('panel:toggle')));
  disposer.add(store.subscribe((state) => update(toolbarProps(state))));

  update(toolbarProps(store.get()));

  return { el: root, update, destroy: disposer.dispose };
};
