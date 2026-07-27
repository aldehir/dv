import { describe, expect, it, vi } from 'vitest';
import type { Comment } from '../api/types';
import { createBus } from '../core/bus';
import type { Thread } from './anchors';
import { threadFor } from './anchors';
import type { CommentsStore } from './store';
import { createThreadList, locationLabel } from './thread';

const HOSTILE = '<img src=x onerror="alert(1)"><script>alert(2)</script>**bold**';

const comment = (over: Partial<Comment> = {}): Comment => ({
  id: 'c1',
  status: 'open',
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

const stubComments = (): CommentsStore => ({
  start: vi.fn(),
  refresh: vi.fn(() => Promise.resolve()),
  threads: vi.fn(() => []),
  threadsFor: vi.fn(() => []),
  compose: vi.fn(() => null),
  setCompose: vi.fn(),
  draft: vi.fn(() => ''),
  setDraft: vi.fn(),
  error: vi.fn(() => null),
  create: vi.fn(() => Promise.resolve(null)),
  update: vi.fn(() => Promise.resolve(null)),
  remove: vi.fn(() => Promise.resolve(true)),
  reply: vi.fn(() => Promise.resolve(null)),
  subscribe: vi.fn(() => () => {}),
  destroy: vi.fn(),
});

const setup = (threads: Thread[]) => {
  const bus = createBus();
  const comments = stubComments();
  const list = createThreadList(threads, { bus, comments });
  return { bus, comments, list };
};

const inputOf = (list: { el: HTMLElement }): HTMLTextAreaElement => {
  const input = list.el.querySelector<HTMLTextAreaElement>('.dv-thread__input');
  if (!input) throw new Error('card has no text box');
  return input;
};

const buttonFor = (list: { el: HTMLElement }, label: string): HTMLButtonElement | undefined =>
  [...list.el.querySelectorAll<HTMLButtonElement>('.dv-thread__action')].find(
    (button) => button.textContent === label,
  );

describe('createThreadList', () => {
  it('renders one editable card per thread', () => {
    const { list } = setup([threadFor('f1', comment()), threadFor('f1', comment({ id: 'c2' }))]);

    expect(list.el.querySelectorAll('.dv-thread__card').length).toBe(2);
    expect(list.el.querySelector('.dv-thread__card')?.id).toBe('dv-comment-c1');
    expect(inputOf(list).value).toBe('looks wrong');
    list.destroy();
  });

  it('offers only save and delete', () => {
    const { list } = setup([threadFor('f1', comment())]);
    const labels = [...list.el.querySelectorAll('.dv-thread__action')].map(
      (button) => button.textContent,
    );

    expect(labels).toEqual(['save', 'delete']);
    expect(list.el.querySelector('.dv-thread__author')).toBeNull();
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
    buttonFor(list, 'save')?.click();

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
    buttonFor(list, 'save')?.click();
    inputOf(list).value = '';
    buttonFor(list, 'save')?.click();

    expect(comments.update).not.toHaveBeenCalled();
    list.destroy();
  });

  it('deletes through the store', () => {
    const { comments, list } = setup([threadFor('f1', comment())]);
    buttonFor(list, 'delete')?.click();

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

  it('drops listeners from the previous render on update', () => {
    const { comments, list } = setup([threadFor('f1', comment())]);
    const stale = [...list.el.querySelectorAll<HTMLButtonElement>('.dv-thread__action')];

    list.update([threadFor('f1', comment({ id: 'c2' }))]);
    for (const button of stale) button.click();
    expect(comments.remove).not.toHaveBeenCalled();

    buttonFor(list, 'delete')?.click();
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
