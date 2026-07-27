import type { Bus } from '../core/bus';
import type { Component, OverlayProps } from '../core/component';
import { createDisposer } from '../core/component';
import { el, on } from '../core/dom';
import type { AppStore, LineSelection } from '../core/store';
import type { Viewer } from '../diff/viewer';
import { draftKeyFor } from './anchors';
import type { ComposeTarget, CommentsStore } from './store';

export interface ComposerDeps {
  store: AppStore;
  bus: Bus;
  comments: CommentsStore;
  viewer: Viewer;
}

export const createComposer = ({
  store,
  bus,
  comments,
  viewer,
}: ComposerDeps): Component<OverlayProps> => {
  const disposer = createDisposer();
  let target: ComposeTarget | null = null;
  let open = false;
  let saving = false;
  let following = false;

  const input = el('textarea', {
    class: 'dv-composer__input',
    rows: 6,
    placeholder: 'Comment — ⌘↵ or Ctrl↵ to save, Esc to cancel',
    spellcheck: false,
  });
  const notice = el('span', { class: 'dv-composer__notice', hidden: true });
  const save = el('button', {
    class: 'dv-btn dv-composer__save',
    type: 'button',
    textContent: 'save',
  });
  const cancel = el('button', {
    class: 'dv-btn dv-composer__cancel',
    type: 'button',
    textContent: 'cancel',
  });

  const root = el(
    'div',
    { class: 'dv-composer', hidden: true },
    input,
    el('div', { class: 'dv-composer__bar' }, notice, cancel, save),
  );

  const syncNotice = (): void => {
    const failure = comments.error();
    notice.hidden = failure === null;
    notice.textContent = failure ?? '';
  };

  const sync = (): void => {
    const next = comments.compose();
    if (next === null) {
      target = null;
      return;
    }
    if (target?.key !== next.key) {
      target = next;
      input.value = comments.draft(next.key);
      // Following the selection means the range is already on screen; re-centring
      // it mid-drag would fight the pointer.
      if (!following) viewer.revealRange(next.fileId, next.range);
    }
    syncNotice();
  };

  // An open composer follows the line selection instead of demanding another `c`.
  const retarget = (selection: LineSelection | null): void => {
    if (!open || target === null || selection === null) return;
    const key = draftKeyFor(selection.id, selection.range);
    if (key === target.key) return;
    const carried = input.value;
    comments.setDraft(target.key, '');
    comments.setDraft(key, carried);
    following = true;
    comments.setCompose({ fileId: selection.id, range: selection.range });
    following = false;
  };

  const close = (): void => {
    open = false;
    root.hidden = true;
    comments.setCompose(null);
  };

  const commit = (): void => {
    const current = target;
    if (saving || current === null) return;
    const body = input.value.trim();
    if (body === '') return;
    saving = true;
    void comments.create(current, body).then((saved) => {
      saving = false;
      syncNotice();
      if (!saved) return;
      input.value = '';
      close();
      bus.emit('overlay:dismiss');
    });
  };

  disposer.add(
    on(input, 'input', () => {
      if (target) comments.setDraft(target.key, input.value);
    }),
  );
  disposer.add(
    on(input, 'keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        bus.emit('overlay:dismiss');
        return;
      }
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      commit();
    }),
  );
  disposer.add(on(save, 'click', commit));
  disposer.add(on(cancel, 'click', () => bus.emit('overlay:dismiss')));
  disposer.add(comments.subscribe(sync));
  disposer.add(store.subscribe('selection', retarget));

  return {
    el: root,
    update(props: OverlayProps) {
      if (!props.open) {
        close();
        return;
      }
      open = true;
      sync();
      root.hidden = target === null;
      if (target !== null) input.focus();
    },
    destroy: disposer.dispose,
  };
};
