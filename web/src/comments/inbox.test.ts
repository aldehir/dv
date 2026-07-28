import { describe, expect, it, vi } from 'vitest';
import type { Comment } from '../api/types';
import { createBus } from '../core/bus';
import { createInitialState, createStore } from '../core/store';
import type { Viewer } from '../diff/viewer';
import type { Thread } from './anchors';
import { threadFor } from './anchors';
import { createInbox } from './inbox';
import type { CommentsStore } from './store';

const comment = (over: Partial<Comment> = {}): Comment => ({
  id: 'c1',
  author: { name: 'alde' },
  createdAt: '2026-07-26T18:00:00Z',
  updatedAt: '2026-07-26T18:00:00Z',
  body: 'looks wrong',
  anchor: {
    path: 'src/a.ts',
    prevPath: null,
    side: 'additions',
    startLine: 4,
    endLine: 6,
    blobSha: 'bbb',
    quote: '',
    contextBefore: [],
    contextAfter: [],
  },
  resolvedAnchor: { stale: false, movedFrom: null },
  replies: [],
  ...over,
});

const stale = (id: string): Thread =>
  threadFor('f1', comment({ id, resolvedAnchor: { stale: true, movedFrom: null } }));

const stubViewer = (): Viewer =>
  ({ revealThread: vi.fn() }) as unknown as Viewer;

const stubComments = (threads: readonly Thread[], over: Partial<CommentsStore> = {}): CommentsStore =>
  ({
    threads: vi.fn(() => threads),
    error: vi.fn(() => null),
    remove: vi.fn(() => Promise.resolve(true)),
    subscribe: vi.fn(() => () => {}),
    ...over,
  }) as unknown as CommentsStore;

const setup = (threads: readonly Thread[], over: Partial<CommentsStore> = {}) => {
  const store = createStore(createInitialState());
  store.set({ commentsEnabled: true });
  const bus = createBus();
  const comments = stubComments(threads, over);
  const inbox = createInbox({ store, bus, comments, viewer: stubViewer() });
  return { comments, inbox };
};

const deleteButtons = (inbox: { el: HTMLElement }): HTMLButtonElement[] => [
  ...inbox.el.querySelectorAll<HTMLButtonElement>('.dv-inbox__delete'),
];

const clearButton = (inbox: { el: HTMLElement }): HTMLButtonElement => {
  const button = inbox.el.querySelector<HTMLButtonElement>('.dv-inbox__clear');
  if (!button) throw new Error('inbox has no clear button');
  return button;
};

describe('createInbox', () => {
  it('deletes the comment its row belongs to', () => {
    const { comments, inbox } = setup([threadFor('f1', comment()), threadFor('f1', comment({ id: 'c2' }))]);

    deleteButtons(inbox)[1]?.click();

    expect(comments.remove).toHaveBeenCalledWith('c2');
    inbox.destroy();
  });

  it('deleting a row does not focus it', () => {
    const { comments, inbox } = setup([threadFor('f1', comment())]);
    const focused = vi.fn();
    deleteButtons(inbox)[0]?.click();

    expect(comments.remove).toHaveBeenCalledWith('c1');
    expect(focused).not.toHaveBeenCalled();
    expect(inbox.el.querySelector('.dv-inbox__row')?.getAttribute('aria-current')).toBe('false');
    inbox.destroy();
  });

  it('arms the clear button before wiping the unanchored section', async () => {
    const { comments, inbox } = setup([stale('s1'), stale('s2')]);
    const button = clearButton(inbox);

    button.click();
    expect(comments.remove).not.toHaveBeenCalled();
    expect(button.textContent).toBe('Delete 2?');

    button.click();
    // The deletes are serialised, so each one lands a microtask after the last.
    await vi.waitFor(() => expect(comments.remove).toHaveBeenCalledTimes(2));
    expect(comments.remove).toHaveBeenNthCalledWith(1, 's1');
    expect(comments.remove).toHaveBeenNthCalledWith(2, 's2');
    inbox.destroy();
  });

  it('leaves anchored comments alone when clearing', async () => {
    const { comments, inbox } = setup([threadFor('f1', comment()), stale('s1')]);

    clearButton(inbox).click();
    clearButton(inbox).click();
    await Promise.resolve();

    expect(comments.remove).toHaveBeenCalledTimes(1);
    expect(comments.remove).toHaveBeenCalledWith('s1');
    inbox.destroy();
  });

  it('stops clearing once a delete is refused', async () => {
    const remove = vi.fn(() => Promise.resolve(false));
    const { inbox } = setup([stale('s1'), stale('s2')], { remove });

    clearButton(inbox).click();
    clearButton(inbox).click();
    await Promise.resolve();

    expect(remove).toHaveBeenCalledTimes(1);
    inbox.destroy();
  });

  it('disarms the clear button when it loses focus', () => {
    const { inbox } = setup([stale('s1')]);
    const button = clearButton(inbox);

    button.click();
    expect(button.textContent).toBe('Delete 1?');

    button.dispatchEvent(new FocusEvent('blur'));
    expect(button.textContent).toBe('Clear');
    inbox.destroy();
  });
});
