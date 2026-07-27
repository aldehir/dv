import type { Bus } from '../core/bus';
import type { Component, OverlayProps } from '../core/component';
import { createDisposer } from '../core/component';
import { el, on } from '../core/dom';
import type { Viewer } from '../diff/viewer';
import { sideOfRange } from './anchors';
import type { ComposeTarget, CommentsStore } from './store';

export interface ComposerDeps {
  bus: Bus;
  comments: CommentsStore;
  viewer: Viewer;
}

const anchorLabel = (target: ComposeTarget): string => {
  const side = sideOfRange(target.range) === 'deletions' ? 'old' : 'new';
  const start = Math.min(target.range.start, target.range.end);
  const end = Math.max(target.range.start, target.range.end);
  const lines = start === end ? `L${end}` : `L${start}-L${end}`;
  return `${target.path} · ${side} ${lines}`;
};

export const createComposer = ({
  bus,
  comments,
  viewer,
}: ComposerDeps): Component<OverlayProps> => {
  const disposer = createDisposer();
  let target: ComposeTarget | null = null;
  let saving = false;

  const where = el('span', { class: 'dv-composer__where' });
  const input = el('textarea', {
    class: 'dv-composer__input',
    rows: 6,
    placeholder: 'Markdown comment — ⌘↵ or Ctrl↵ to save, Esc to cancel',
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
    el(
      'div',
      { class: 'dv-composer__head' },
      el('span', { class: 'dv-composer__title', textContent: 'Comment' }),
      where,
    ),
    input,
    el('div', { class: 'dv-composer__foot' }, notice, cancel, save),
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
      where.textContent = anchorLabel(next);
      viewer.revealRange(next.fileId, next.range);
    }
    syncNotice();
  };

  const close = (): void => {
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

  return {
    el: root,
    update({ open }: OverlayProps) {
      if (!open) {
        close();
        return;
      }
      sync();
      root.hidden = target === null;
      if (target !== null) input.focus();
    },
    destroy: disposer.dispose,
  };
};
