import type { Bus } from '../core/bus';
import type { Component } from '../core/component';
import { createDisposer } from '../core/component';
import { clear, el, frag, on } from '../core/dom';
import type { AppStore } from '../core/store';
import type { Viewer } from '../diff/viewer';
import type { Thread } from './anchors';
import type { CommentsStore } from './store';
import { locationLabel } from './thread';

export type InboxFilter = 'all' | 'open' | 'resolved' | 'stale';

export const INBOX_FILTERS: readonly InboxFilter[] = ['all', 'open', 'resolved', 'stale'];

export interface InboxDeps {
  store: AppStore;
  bus: Bus;
  comments: CommentsStore;
  viewer: Viewer;
}

export const matchesFilter = (thread: Thread, filter: InboxFilter): boolean => {
  switch (filter) {
    case 'open':
      return thread.status === 'open';
    case 'resolved':
      return thread.status !== 'open';
    case 'stale':
      return thread.stale;
    default:
      return true;
  }
};

const preview = (body: string): string => {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  return collapsed.length > 140 ? `${collapsed.slice(0, 139)}…` : collapsed;
};

export const createInbox = ({ store, bus, comments, viewer }: InboxDeps): Component<void> => {
  const disposer = createDisposer();
  let filter: InboxFilter = 'all';
  let visible: Thread[] = [];
  let focused: string | null = null;

  const meta = el('div', { class: 'dv-inbox__meta' });
  const anchoredList = el('ul', { class: 'dv-inbox__list' });
  const staleList = el('ul', { class: 'dv-inbox__list' });
  const staleSection = el(
    'section',
    { class: 'dv-inbox__section', hidden: true },
    el('h3', { class: 'dv-inbox__heading', textContent: 'Unanchored' }),
    staleList,
  );

  const buttons = INBOX_FILTERS.map((name) =>
    el('button', {
      class: 'dv-btn dv-inbox__filter',
      type: 'button',
      textContent: name,
      data: { filter: name },
    }),
  );

  const root = el(
    'div',
    { class: 'dv-inbox' },
    el('div', { class: 'dv-inbox__head' }, ...buttons),
    meta,
    el('section', { class: 'dv-inbox__section' }, anchoredList),
    staleSection,
  );

  const row = (thread: Thread): HTMLLIElement => {
    const button = el(
      'button',
      {
        class: 'dv-inbox__row',
        type: 'button',
        data: { commentId: thread.id },
      },
      el(
        'span',
        { class: 'dv-inbox__where' },
        el('span', { class: 'dv-inbox__path', textContent: thread.path }),
        el('span', { class: 'dv-inbox__line', textContent: locationLabel(thread) }),
      ),
      el('span', { class: 'dv-inbox__body', textContent: preview(thread.comment.body) }),
      el(
        'span',
        { class: 'dv-inbox__tags' },
        el('span', { class: 'dv-inbox__status', textContent: thread.status }),
        thread.stale && el('span', { class: 'dv-thread__badge', textContent: 'stale' }),
      ),
    );
    button.setAttribute('aria-current', String(thread.id === focused));
    return el('li', null, button);
  };

  const render = (): void => {
    const enabled = store.get().commentsEnabled;
    root.hidden = !enabled;
    const all = enabled ? comments.threads() : [];
    const matching = all.filter((thread) => matchesFilter(thread, filter));
    const anchored = matching.filter((thread) => !thread.stale);
    const stale = matching.filter((thread) => thread.stale);
    visible = [...anchored, ...stale];

    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
    }

    clear(anchoredList);
    anchoredList.appendChild(frag(...anchored.map(row)));
    clear(staleList);
    staleList.appendChild(frag(...stale.map(row)));
    staleSection.hidden = stale.length === 0;

    const failure = comments.error();
    if (failure !== null) meta.textContent = failure;
    else if (all.length === 0) meta.textContent = 'No comments yet';
    else meta.textContent = `${visible.length} of ${all.length} comments`;
  };

  const focus = (thread: Thread): void => {
    focused = thread.id;
    viewer.revealThread(thread);
    bus.emit('comment:focus', { id: thread.id });
    render();
  };

  const step = (delta: number): void => {
    if (visible.length === 0) return;
    const index = focused === null ? -1 : visible.findIndex((item) => item.id === focused);
    const next = index < 0 ? (delta > 0 ? 0 : visible.length - 1) : index + delta;
    const target = visible[Math.min(Math.max(next, 0), visible.length - 1)];
    if (target) focus(target);
  };

  disposer.add(
    on(root, 'click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const filterButton = target.closest<HTMLElement>('[data-filter]');
      if (filterButton?.dataset.filter) {
        filter = filterButton.dataset.filter as InboxFilter;
        render();
        return;
      }
      const id = target.closest<HTMLElement>('[data-comment-id]')?.dataset.commentId;
      const thread = id === undefined ? undefined : visible.find((item) => item.id === id);
      if (thread) focus(thread);
    }),
  );
  disposer.add(bus.on('comment:step', ({ delta }) => step(delta)));
  disposer.add(
    bus.on('comment:focus', ({ id }) => {
      if (id === focused) return;
      focused = id;
      render();
    }),
  );
  disposer.add(comments.subscribe(render));
  disposer.add(store.subscribe('manifest', render));
  disposer.add(store.subscribe('commentsEnabled', render));

  render();

  return { el: root, update: render, destroy: disposer.dispose };
};
