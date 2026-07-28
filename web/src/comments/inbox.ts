import type { Bus } from '../core/bus';
import type { Component } from '../core/component';
import { createDisposer } from '../core/component';
import { clear, el, frag, on } from '../core/dom';
import type { AppStore } from '../core/store';
import type { Viewer } from '../diff/viewer';
import { icon } from '../ui/icons';
import type { Thread } from './anchors';
import type { CommentsStore } from './store';
import { locationLabel } from './thread';

export interface InboxDeps {
  store: AppStore;
  bus: Bus;
  comments: CommentsStore;
  viewer: Viewer;
}

const preview = (body: string): string => {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  return collapsed.length > 140 ? `${collapsed.slice(0, 139)}…` : collapsed;
};

export const createInbox = ({ store, bus, comments, viewer }: InboxDeps): Component<void> => {
  const disposer = createDisposer();
  let visible: Thread[] = [];
  let focused: string | null = null;
  let armed = false;

  const meta = el('div', { class: 'dv-inbox__meta' });
  const anchoredList = el('ul', { class: 'dv-inbox__list' });
  const staleList = el('ul', { class: 'dv-inbox__list' });
  const clearButton = el('button', {
    class: 'dv-btn dv-inbox__clear',
    type: 'button',
    title: 'Delete every unanchored comment',
  });
  const staleSection = el(
    'section',
    { class: 'dv-inbox__section', hidden: true },
    el(
      'div',
      { class: 'dv-inbox__heading-row' },
      el('h3', { class: 'dv-inbox__heading', textContent: 'Unanchored' }),
      clearButton,
    ),
    staleList,
  );

  const root = el(
    'div',
    { class: 'dv-inbox' },
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
        thread.stale && el('span', { class: 'dv-thread__badge', textContent: 'stale' }),
      ),
    );
    button.setAttribute('aria-current', String(thread.id === focused));
    const remove = el(
      'button',
      {
        class: 'dv-icon-btn dv-inbox__delete',
        type: 'button',
        ariaLabel: 'Delete this comment',
        title: 'Delete this comment',
        data: { deleteId: thread.id },
      },
      icon('trash'),
    );
    return el('li', { class: 'dv-inbox__item' }, button, remove);
  };

  const render = (): void => {
    const enabled = store.get().commentsEnabled;
    root.hidden = !enabled;
    const all = enabled ? comments.threads() : [];
    const anchored = all.filter((thread) => !thread.stale);
    const stale = all.filter((thread) => thread.stale);
    visible = [...anchored, ...stale];

    clear(anchoredList);
    anchoredList.appendChild(frag(...anchored.map(row)));
    clear(staleList);
    staleList.appendChild(frag(...stale.map(row)));
    staleSection.hidden = stale.length === 0;
    clearButton.textContent = armed ? `Delete ${stale.length}?` : 'Clear';
    clearButton.classList.toggle('dv-inbox__clear--armed', armed);

    const failure = comments.error();
    if (failure !== null) meta.textContent = failure;
    else if (all.length === 0) meta.textContent = 'No comments yet';
    else meta.textContent = `${all.length} comment${all.length === 1 ? '' : 's'}`;
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

  // Each delete is written against the etag the last one handed back, so a whole
  // section has to go one at a time; a refusal means the rest would fail too.
  const purge = async (doomed: readonly Thread[]): Promise<void> => {
    for (const thread of doomed) {
      if (!(await comments.remove(thread.id))) break;
    }
  };

  const disarm = (): void => {
    if (!armed) return;
    armed = false;
    render();
  };

  disposer.add(
    on(root, 'click', (event) => {
      // The trash glyph is an SVG, so the target is not always an HTMLElement.
      const target = event.target;
      if (!(target instanceof Element)) return;
      const doomed = target.closest<HTMLElement>('[data-delete-id]')?.dataset.deleteId;
      if (doomed !== undefined) {
        void comments.remove(doomed);
        return;
      }
      const id = target.closest<HTMLElement>('[data-comment-id]')?.dataset.commentId;
      const thread = id === undefined ? undefined : visible.find((item) => item.id === id);
      if (thread) focus(thread);
    }),
  );
  // Clearing a section cannot be undone, so the first click only arms the button.
  disposer.add(
    on(clearButton, 'click', () => {
      const stale = visible.filter((thread) => thread.stale);
      if (stale.length === 0) return;
      if (!armed) {
        armed = true;
        render();
        return;
      }
      armed = false;
      void purge(stale);
    }),
  );
  disposer.add(on(clearButton, 'blur', disarm));
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
