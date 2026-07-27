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

describe('createThreadList', () => {
  it('renders one card per thread with status and location', () => {
    const { list } = setup([threadFor('f1', comment())]);
    const card = list.el.querySelector('.dv-thread__card');

    expect(card?.getAttribute('data-status')).toBe('open');
    expect(card?.querySelector('.dv-thread__author')?.textContent).toBe('alde');
    expect(card?.querySelector('.dv-thread__where')?.textContent).toBe('new L4-L6');
    expect(card?.querySelector('.dv-thread__status')?.textContent).toBe('open');
    list.destroy();
  });

  it('never parses markup coming from a comment body', () => {
    const { list } = setup([threadFor('f1', comment({ body: HOSTILE }))]);
    const body = list.el.querySelector('.dv-thread__body');

    expect(list.el.querySelector('img')).toBeNull();
    expect(list.el.querySelector('script')).toBeNull();
    expect(body?.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(body?.textContent).toContain('<script>alert(2)</script>');
    list.destroy();
  });

  it('keeps escaping once the markdown renderer has loaded', async () => {
    const first = setup([threadFor('f1', comment({ body: HOSTILE }))]);
    await vi.waitFor(() => {
      expect(first.list.el.querySelector('strong')).not.toBeNull();
    });

    expect(first.list.el.querySelector('img')).toBeNull();
    expect(first.list.el.querySelector('script')).toBeNull();
    expect(first.list.el.textContent).toContain('<img src=x onerror="alert(1)">');
    first.list.destroy();
  });

  it('renders replies and a stale badge', () => {
    const raw = comment({
      resolvedAnchor: { stale: true, movedFrom: null },
      replies: [
        {
          id: 'r1',
          author: { name: 'agent' },
          createdAt: '2026-07-26T19:00:00Z',
          body: 'fixed in 3f1a',
        },
      ],
    });
    const { list } = setup([threadFor('f1', raw)]);

    expect(list.el.querySelector('.dv-thread__badge')?.textContent).toBe('stale');
    expect(list.el.querySelectorAll('.dv-thread__reply').length).toBe(1);
    expect(list.el.querySelector('.dv-thread__card')?.getAttribute('data-stale')).toBe('true');
    list.destroy();
  });

  it('hides the actions for a thread still being saved', () => {
    const { list } = setup([threadFor('f1', comment(), true)]);
    expect(list.el.querySelector<HTMLElement>('.dv-thread__actions')?.hidden).toBe(true);
    list.destroy();
  });

  it('drives status changes, replies and deletion through the store', () => {
    const { comments, list } = setup([threadFor('f1', comment())]);
    const buttons = [...list.el.querySelectorAll<HTMLButtonElement>('.dv-thread__action')];
    const byLabel = (label: string): HTMLButtonElement | undefined =>
      buttons.find((button) => button.textContent === label);

    byLabel('resolve')?.click();
    expect(comments.update).toHaveBeenCalledWith('c1', { status: 'resolved' });

    byLabel('wontfix')?.click();
    expect(comments.update).toHaveBeenCalledWith('c1', { status: 'wontfix' });

    byLabel('reply')?.click();
    const input = list.el.querySelector<HTMLTextAreaElement>('.dv-thread__input');
    if (input) input.value = 'thanks';
    byLabel('send')?.click();
    expect(comments.reply).toHaveBeenCalledWith('c1', 'thanks');

    byLabel('delete')?.click();
    expect(comments.remove).toHaveBeenCalledWith('c1');
    list.destroy();
  });

  it('reopens a resolved thread', () => {
    const { comments, list } = setup([threadFor('f1', comment({ status: 'resolved' }))]);
    list.el.querySelector<HTMLButtonElement>('.dv-thread__action')?.click();
    expect(comments.update).toHaveBeenCalledWith('c1', { status: 'open' });
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
    expect(comments.update).not.toHaveBeenCalled();

    list.el.querySelector<HTMLButtonElement>('.dv-thread__action')?.click();
    expect(comments.update).toHaveBeenCalledWith('c2', { status: 'resolved' });
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
