import type { Bus } from '../core/bus';
import type { Component, Disposer } from '../core/component';
import { createDisposer } from '../core/component';
import { el, on, replaceChildren } from '../core/dom';
import { type IconName, icon } from '../ui/icons';
import type { Thread } from './anchors';
import type { CommentsStore } from './store';

export interface ThreadDeps {
  bus: Bus;
  comments: CommentsStore;
}

const MIN_ROWS = 2;
const MAX_ROWS = 12;

const sideLabel = (thread: Thread): string =>
  thread.side === 'deletions' ? 'old' : 'new';

export const locationLabel = (thread: Thread): string => {
  if (thread.lineNumber === 0) return `${sideLabel(thread)} file`;
  if (thread.startLine === thread.endLine) {
    return `${sideLabel(thread)} L${thread.endLine}`;
  }
  return `${sideLabel(thread)} L${thread.startLine}-L${thread.endLine}`;
};

const rowsFor = (body: string): number =>
  Math.min(Math.max(body.split('\n').length, MIN_ROWS), MAX_ROWS);

const actionButton = (
  name: IconName,
  title: string,
  modifier = '',
): HTMLButtonElement =>
  el(
    'button',
    {
      class: `dv-icon-btn dv-thread__action${modifier}`,
      type: 'button',
      ariaLabel: title,
      title,
    },
    icon(name),
  );

const buildCard = (thread: Thread, deps: ThreadDeps, disposer: Disposer): HTMLElement => {
  const input = el('textarea', {
    class: 'dv-thread__input',
    rows: rowsFor(thread.comment.body),
    value: thread.comment.body,
    spellcheck: false,
  });
  const save = actionButton('check', 'Save this comment');
  const remove = actionButton('trash', 'Delete this comment', ' dv-thread__action--danger');

  const actions = el('div', { class: 'dv-thread__actions' }, save, remove);
  // A pending comment has no server id yet, so it cannot be patched or deleted.
  actions.hidden = thread.pending;

  disposer.add(
    on(save, 'click', () => {
      const body = input.value.trim();
      if (body === '' || body === thread.comment.body) return;
      void deps.comments.update(thread.id, { body });
    }),
  );
  disposer.add(
    on(remove, 'click', () => {
      void deps.comments.remove(thread.id);
    }),
  );
  disposer.add(
    on(input, 'keydown', (event) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      save.click();
    }),
  );

  const card = el(
    'article',
    { class: 'dv-thread__card', id: `dv-comment-${thread.id}` },
    input,
    actions,
  );

  disposer.add(
    on(card, 'click', () => deps.bus.emit('comment:focus', { id: thread.id })),
  );
  return card;
};

export const createThreadList = (
  threads: readonly Thread[],
  deps: ThreadDeps,
): Component<readonly Thread[]> => {
  let disposer = createDisposer();
  const root = el('div', { class: 'dv-thread' });

  const update = (next: readonly Thread[]): void => {
    disposer.dispose();
    disposer = createDisposer();
    replaceChildren(root, ...next.map((thread) => buildCard(thread, deps, disposer)));
  };

  update(threads);

  return {
    el: root,
    update,
    destroy() {
      disposer.dispose();
      replaceChildren(root);
    },
  };
};
