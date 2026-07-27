import type { Bus } from '../core/bus';
import type { Component, Disposer } from '../core/component';
import { createDisposer } from '../core/component';
import { el, on, replaceChildren } from '../core/dom';
import type { AppStore } from '../core/store';
import { type IconName, icon } from '../ui/icons';
import type { Card, Draft, Thread } from './anchors';
import type { CommentsStore } from './store';

export interface CardDeps {
  store: AppStore;
  bus: Bus;
  comments: CommentsStore;
}

/** How the viewer finds the draft box once the diff has rendered it. */
export const DRAFT_INPUT_CLASS = 'dv-thread__input--draft';

const MIN_ROWS = 2;
const MAX_ROWS = 12;
const DRAFT_HINT = 'Comment — ⌘↵ or Ctrl↵ to save, Esc to cancel';

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

const saveOnEnter = (
  input: HTMLTextAreaElement,
  save: HTMLButtonElement,
  disposer: Disposer,
): void => {
  disposer.add(
    on(input, 'keydown', (event) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      save.click();
    }),
  );
};

const buildThreadCard = (
  thread: Thread,
  deps: CardDeps,
  disposer: Disposer,
): HTMLElement => {
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
  saveOnEnter(input, save, disposer);

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

const buildDraftCard = (draft: Draft, deps: CardDeps, disposer: Disposer): HTMLElement => {
  const body = deps.comments.draft(draft.key);
  const input = el('textarea', {
    class: `dv-thread__input ${DRAFT_INPUT_CLASS}`,
    rows: rowsFor(body),
    value: body,
    placeholder: DRAFT_HINT,
    spellcheck: false,
  });
  const save = actionButton('check', 'Save this comment');
  const discard = actionButton('close', 'Discard this comment');

  const failure = deps.comments.error();
  const notice = el('span', {
    class: 'dv-thread__notice',
    hidden: failure === null,
    textContent: failure ?? '',
  });

  // Dropping the selection is what takes the box away; the draft body outlives it.
  const dismiss = (): void => deps.store.set({ selection: null, composing: null });

  disposer.add(on(input, 'input', () => deps.comments.setDraft(draft.key, input.value)));
  disposer.add(
    on(save, 'click', () => {
      const text = input.value.trim();
      if (text === '') return;
      void deps.comments.create(draft, text);
      dismiss();
    }),
  );
  disposer.add(
    on(discard, 'click', () => {
      deps.comments.setDraft(draft.key, '');
      dismiss();
    }),
  );
  saveOnEnter(input, save, disposer);

  return el(
    'article',
    { class: 'dv-thread__card dv-thread__card--draft' },
    input,
    el('div', { class: 'dv-thread__actions dv-thread__actions--draft' }, notice, save, discard),
  );
};

const buildCard = (card: Card, deps: CardDeps, disposer: Disposer): HTMLElement =>
  card.kind === 'draft'
    ? buildDraftCard(card, deps, disposer)
    : buildThreadCard(card, deps, disposer);

export const createCardList = (
  cards: readonly Card[],
  deps: CardDeps,
): Component<readonly Card[]> => {
  let disposer = createDisposer();
  const root = el('div', { class: 'dv-thread' });

  const update = (next: readonly Card[]): void => {
    disposer.dispose();
    disposer = createDisposer();
    replaceChildren(root, ...next.map((card) => buildCard(card, deps, disposer)));
  };

  update(cards);

  return {
    el: root,
    update,
    destroy() {
      disposer.dispose();
      replaceChildren(root);
    },
  };
};
