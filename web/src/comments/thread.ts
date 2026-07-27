import type { CommentStatus, Reply } from '../api/types';
import type { Bus } from '../core/bus';
import type { Component, Disposer } from '../core/component';
import { createDisposer } from '../core/component';
import { el, on, replaceChildren } from '../core/dom';
import type { Thread } from './anchors';
import type { CommentsStore } from './store';

export interface ThreadDeps {
  bus: Bus;
  comments: CommentsStore;
}

type MarkdownRenderer = (source: string) => DocumentFragment;

let markdown: MarkdownRenderer | null = null;
let loading: Promise<MarkdownRenderer> | null = null;

const loadMarkdown = (): Promise<MarkdownRenderer> => {
  loading ??= import('./markdown').then((module) => {
    markdown = module.renderMarkdown;
    return module.renderMarkdown;
  });
  return loading;
};

const renderBody = (host: HTMLElement, source: string): void => {
  if (markdown) {
    replaceChildren(host, markdown(source));
    return;
  }
  host.textContent = source;
  void loadMarkdown().then((render) => {
    replaceChildren(host, render(source));
  });
};

const STATUS_LABELS: Record<CommentStatus, string> = {
  open: 'open',
  resolved: 'resolved',
  wontfix: 'wontfix',
};

const sideLabel = (thread: Thread): string =>
  thread.side === 'deletions' ? 'old' : 'new';

export const locationLabel = (thread: Thread): string => {
  if (thread.lineNumber === 0) return `${sideLabel(thread)} file`;
  if (thread.startLine === thread.endLine) {
    return `${sideLabel(thread)} L${thread.endLine}`;
  }
  return `${sideLabel(thread)} L${thread.startLine}-L${thread.endLine}`;
};

export const stamp = (iso: string): string => {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
};

const replyRow = (reply: Reply): HTMLLIElement => {
  const body = el('div', { class: 'dv-thread__reply-body' });
  renderBody(body, reply.body);
  return el(
    'li',
    { class: 'dv-thread__reply' },
    el(
      'div',
      { class: 'dv-thread__reply-head' },
      el('span', { class: 'dv-thread__author', textContent: reply.author.name }),
      el('span', { class: 'dv-thread__time', textContent: stamp(reply.createdAt) }),
    ),
    body,
  );
};

const actionButton = (label: string, title: string): HTMLButtonElement =>
  el('button', { class: 'dv-btn dv-thread__action', type: 'button', textContent: label, title });

const buildCard = (thread: Thread, deps: ThreadDeps, disposer: Disposer): HTMLElement => {
  const body = el('div', { class: 'dv-thread__body' });
  renderBody(body, thread.comment.body);

  const replies = el(
    'ol',
    { class: 'dv-thread__replies' },
    ...thread.comment.replies.map(replyRow),
  );
  replies.hidden = thread.comment.replies.length === 0;

  const input = el('textarea', {
    class: 'dv-thread__input',
    rows: 2,
    placeholder: 'Reply…',
    spellcheck: false,
  });
  const send = actionButton('send', 'Send this reply');
  const composer = el('div', { class: 'dv-thread__composer', hidden: true }, input, send);

  const toggleReply = actionButton('reply', 'Reply to this comment');
  const resolve = actionButton(
    thread.status === 'open' ? 'resolve' : 'reopen',
    thread.status === 'open' ? 'Mark resolved' : 'Reopen this comment',
  );
  const wontfix = actionButton('wontfix', 'Mark as wontfix');
  const remove = actionButton('delete', 'Delete this comment');

  const actions = el(
    'div',
    { class: 'dv-thread__actions' },
    resolve,
    wontfix,
    toggleReply,
    remove,
  );
  actions.hidden = thread.pending;

  const head = el(
    'div',
    { class: 'dv-thread__head' },
    el('span', { class: 'dv-thread__author', textContent: thread.comment.author.name }),
    el('span', { class: 'dv-thread__where', textContent: locationLabel(thread) }),
    el('span', { class: 'dv-thread__spacer' }),
    thread.stale && el('span', { class: 'dv-thread__badge', textContent: 'stale' }),
    thread.pending && el('span', { class: 'dv-thread__badge', textContent: 'saving' }),
    el('span', {
      class: 'dv-thread__status',
      textContent: STATUS_LABELS[thread.status],
    }),
    el('span', { class: 'dv-thread__time', textContent: stamp(thread.comment.updatedAt) }),
  );

  disposer.add(
    on(resolve, 'click', () => {
      void deps.comments.update(thread.id, {
        status: thread.status === 'open' ? 'resolved' : 'open',
      });
    }),
  );
  disposer.add(
    on(wontfix, 'click', () => {
      void deps.comments.update(thread.id, { status: 'wontfix' });
    }),
  );
  disposer.add(
    on(remove, 'click', () => {
      void deps.comments.remove(thread.id);
    }),
  );
  disposer.add(
    on(toggleReply, 'click', () => {
      composer.hidden = !composer.hidden;
      if (!composer.hidden) input.focus();
    }),
  );
  disposer.add(
    on(send, 'click', () => {
      const value = input.value.trim();
      if (value === '') return;
      input.value = '';
      composer.hidden = true;
      void deps.comments.reply(thread.id, value);
    }),
  );
  disposer.add(
    on(input, 'keydown', (event) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      send.click();
    }),
  );

  const card = el(
    'article',
    {
      class: 'dv-thread__card',
      data: { status: thread.status, stale: String(thread.stale) },
      id: `dv-comment-${thread.id}`,
    },
    head,
    body,
    replies,
    actions,
    composer,
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
