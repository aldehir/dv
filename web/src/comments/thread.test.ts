import { describe, expect, it, vi } from 'vitest';
import type { Comment } from '../api/types';
import { createBus } from '../core/bus';
import { createInitialState, createStore } from '../core/store';
import type { Card } from './anchors';
import { draftFor, threadFor } from './anchors';
import type { CommentsStore } from './store';
import { createCardList, locationLabel } from './thread';

const HOSTILE = '<img src=x onerror="alert(1)"><script>alert(2)</script>**bold**';

const comment = (over: Partial<Comment> = {}): Comment => ({
  id: 'c1',
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

const stubComments = (over: Partial<CommentsStore> = {}): CommentsStore => ({
  start: vi.fn(),
  refresh: vi.fn(() => Promise.resolve()),
  threads: vi.fn(() => []),
  threadsFor: vi.fn(() => []),
  draft: vi.fn(() => ''),
  setDraft: vi.fn(),
  error: vi.fn(() => null),
  create: vi.fn(() => Promise.resolve(null)),
  update: vi.fn(() => Promise.resolve(null)),
  remove: vi.fn(() => Promise.resolve(true)),
  reply: vi.fn(() => Promise.resolve(null)),
  subscribe: vi.fn(() => () => {}),
  destroy: vi.fn(),
  ...over,
});

const setup = (cards: readonly Card[], over: Partial<CommentsStore> = {}) => {
  const store = createStore(createInitialState());
  const bus = createBus();
  const comments = stubComments(over);
  const list = createCardList(cards, { store, bus, comments });
  return { store, bus, comments, list };
};

const inputOf = (list: { el: HTMLElement }): HTMLTextAreaElement => {
  const input = list.el.querySelector<HTMLTextAreaElement>('.dv-thread__input');
  if (!input) throw new Error('card has no text box');
  return input;
};

const buttonFor = (list: { el: HTMLElement }, label: string): HTMLButtonElement | undefined =>
  [...list.el.querySelectorAll<HTMLButtonElement>('.dv-thread__action')].find(
    (button) => button.getAttribute('aria-label') === label,
  );

describe('createCardList', () => {
  it('renders one editable card per thread', () => {
    const { list } = setup([threadFor('f1', comment()), threadFor('f1', comment({ id: 'c2' }))]);

    expect(list.el.querySelectorAll('.dv-thread__card').length).toBe(2);
    expect(list.el.querySelector('.dv-thread__card')?.id).toBe('dv-comment-c1');
    expect(inputOf(list).value).toBe('looks wrong');
    list.destroy();
  });

  it('offers only save and delete', () => {
    const { list } = setup([threadFor('f1', comment())]);
    const labels = [...list.el.querySelectorAll('.dv-thread__action')].map((button) =>
      button.getAttribute('aria-label'),
    );

    expect(labels).toEqual(['Save this comment', 'Delete this comment']);
    expect(list.el.querySelector('.dv-thread__time')).toBeNull();
    expect(list.el.querySelector('.dv-thread__status')).toBeNull();
    expect(list.el.querySelector('.dv-thread__reply')).toBeNull();
    list.destroy();
  });

  it('never parses markup coming from a comment body', () => {
    const { list } = setup([threadFor('f1', comment({ body: HOSTILE }))]);

    expect(list.el.querySelector('img')).toBeNull();
    expect(list.el.querySelector('script')).toBeNull();
    expect(inputOf(list).value).toBe(HOSTILE);
    list.destroy();
  });

  it('saves an edited body through the store', () => {
    const { comments, list } = setup([threadFor('f1', comment())]);
    inputOf(list).value = '  now correct  ';
    buttonFor(list, 'Save this comment')?.click();

    expect(comments.update).toHaveBeenCalledWith('c1', { body: 'now correct' });
    list.destroy();
  });

  it('saves on ⌘↵', () => {
    const { comments, list } = setup([threadFor('f1', comment())]);
    const input = inputOf(list);
    input.value = 'via keyboard';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));

    expect(comments.update).toHaveBeenCalledWith('c1', { body: 'via keyboard' });
    list.destroy();
  });

  it('skips a save that changes nothing', () => {
    const { comments, list } = setup([threadFor('f1', comment())]);
    buttonFor(list, 'Save this comment')?.click();
    inputOf(list).value = '';
    buttonFor(list, 'Save this comment')?.click();

    expect(comments.update).not.toHaveBeenCalled();
    list.destroy();
  });

  it('deletes through the store', () => {
    const { comments, list } = setup([threadFor('f1', comment())]);
    buttonFor(list, 'Delete this comment')?.click();

    expect(comments.remove).toHaveBeenCalledWith('c1');
    list.destroy();
  });

  it('hides the actions for a thread still being saved', () => {
    const { list } = setup([threadFor('f1', comment(), true)]);
    expect(list.el.querySelector<HTMLElement>('.dv-thread__actions')?.hidden).toBe(true);
    list.destroy();
  });

  it('announces focus when a card is clicked', () => {
    const { bus, list } = setup([threadFor('f1', comment())]);
    const focused = vi.fn();
    bus.on('comment:focus', focused);
    list.el.querySelector<HTMLElement>('.dv-thread__card')?.click();
    expect(focused).toHaveBeenCalledWith({ id: 'c1' });
    list.destroy();
  });

  it('drops every listener on destroy', () => {
    const { comments, list } = setup([threadFor('f1', comment())]);
    const buttons = [...list.el.querySelectorAll<HTMLButtonElement>('.dv-thread__action')];
    list.destroy();

    for (const button of buttons) button.click();
    expect(comments.update).not.toHaveBeenCalled();
    expect(comments.remove).not.toHaveBeenCalled();
    expect(list.el.childElementCount).toBe(0);
  });

  it('gives a draft the same card as an edit, with a discard in place of delete', () => {
    const { list } = setup([draftFor('f1', { start: 4, end: 6, side: 'additions' })], {
      draft: vi.fn(() => 'half written'),
    });
    const labels = [...list.el.querySelectorAll('.dv-thread__action')].map((button) =>
      button.getAttribute('aria-label'),
    );

    expect(list.el.querySelectorAll('.dv-thread__card--draft').length).toBe(1);
    expect(labels).toEqual(['Save this comment', 'Discard this comment']);
    expect(inputOf(list).value).toBe('half written');
    list.destroy();
  });

  it('holds the draft body while the box moves around', () => {
    const draft = draftFor('f1', { start: 4, end: 6, side: 'additions' });
    const { comments, list } = setup([draft]);
    const input = inputOf(list);
    input.value = 'a thought';
    input.dispatchEvent(new Event('input'));

    expect(comments.setDraft).toHaveBeenCalledWith('f1:additions:4-6', 'a thought');
    list.destroy();
  });

  it('posts a draft and takes the box away with the selection', () => {
    const draft = draftFor('f1', { start: 4, end: 6, side: 'additions' });
    const { store, comments, list } = setup([draft]);
    store.set({ selection: { id: 'f1', range: draft.range }, composing: { id: 'f1', range: draft.range } });
    inputOf(list).value = '  worth a look  ';
    buttonFor(list, 'Save this comment')?.click();

    expect(comments.create).toHaveBeenCalledWith(draft, 'worth a look');
    expect(store.get().selection).toBeNull();
    expect(store.get().composing).toBeNull();
    list.destroy();
  });

  it('skips an empty draft', () => {
    const { comments, list } = setup([draftFor('f1', { start: 4, end: 6 })]);
    inputOf(list).value = '   ';
    buttonFor(list, 'Save this comment')?.click();

    expect(comments.create).not.toHaveBeenCalled();
    list.destroy();
  });

  it('throws the body away on discard', () => {
    const { store, comments, list } = setup([draftFor('f1', { start: 4, end: 6 })]);
    store.set({ composing: { id: 'f1', range: { start: 4, end: 6 } } });
    buttonFor(list, 'Discard this comment')?.click();

    expect(comments.setDraft).toHaveBeenCalledWith('f1:additions:4-6', '');
    expect(store.get().composing).toBeNull();
    list.destroy();
  });

  it('shows a save failure on the draft still holding the text', () => {
    const { list } = setup([draftFor('f1', { start: 4, end: 6 })], {
      error: vi.fn(() => 'dv server is unreachable'),
    });
    const notice = list.el.querySelector<HTMLElement>('.dv-thread__notice');

    expect(notice?.hidden).toBe(false);
    expect(notice?.textContent).toBe('dv server is unreachable');
    list.destroy();
  });

  it('drops listeners from the previous render on update', () => {
    const { comments, list } = setup([threadFor('f1', comment())]);
    const stale = [...list.el.querySelectorAll<HTMLButtonElement>('.dv-thread__action')];

    list.update([threadFor('f1', comment({ id: 'c2' }))]);
    for (const button of stale) button.click();
    expect(comments.remove).not.toHaveBeenCalled();

    buttonFor(list, 'Delete this comment')?.click();
    expect(comments.remove).toHaveBeenCalledWith('c2');
    list.destroy();
  });
});

describe('locationLabel', () => {
  it('labels a single line, a range and a file-level anchor', () => {
    expect(locationLabel(threadFor('f1', comment({ anchor: comment().anchor })))).toBe(
      'new L4-L6',
    );
    const single = comment();
    single.anchor.startLine = 9;
    single.anchor.endLine = 9;
    expect(locationLabel(threadFor('f1', single))).toBe('new L9');

    const fileLevel = comment();
    fileLevel.anchor.startLine = 0;
    fileLevel.anchor.endLine = 0;
    fileLevel.anchor.side = 'deletions';
    expect(locationLabel(threadFor('f1', fileLevel))).toBe('old file');
  });
});
