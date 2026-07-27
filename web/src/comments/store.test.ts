import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient, Mutation } from '../api/client';
import { ApiError } from '../api/client';
import type { SseSource } from '../api/sse';
import type {
  Comment,
  CommentsDoc,
  CommentsResponse,
  Manifest,
  NewCommentRequest,
} from '../api/types';
import { createBus } from '../core/bus';
import { createInitialState, createStore } from '../core/store';
import { draftFor } from './anchors';
import type { CommentsStore } from './store';
import { createCommentsStore } from './store';

const manifest = (): Manifest => ({
  files: [
    {
      id: 'f1',
      path: 'src/a.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
      binary: false,
      tooLarge: false,
      submodule: false,
      symlink: false,
      mode: { old: '100644', new: '100644' },
      oldSha: 'aaa',
      newSha: 'bbb',
    },
    {
      id: 'f2',
      path: 'src/b.ts',
      status: 'added',
      additions: 5,
      deletions: 0,
      binary: false,
      tooLarge: false,
      submodule: false,
      symlink: false,
      mode: { old: '', new: '100644' },
      oldSha: '',
      newSha: 'ccc',
    },
  ],
  totals: { files: 2, additions: 7, deletions: 1 },
});

const comment = (id: string, path = 'src/a.ts', stale = false): Comment => ({
  id,
  author: { name: 'alde' },
  createdAt: '2026-07-26T18:00:00Z',
  updatedAt: '2026-07-26T18:00:00Z',
  body: `body ${id}`,
  anchor: {
    path,
    prevPath: null,
    side: 'additions',
    startLine: 4,
    endLine: 6,
    blobSha: 'bbb',
    quote: '',
    contextBefore: [],
    contextAfter: [],
  },
  resolvedAnchor: { stale, movedFrom: null },
  replies: [],
});

const doc = (comments: Comment[]): CommentsDoc => ({
  version: 1,
  generator: 'dv/test',
  repo: { root: '/repo', head: 'head' },
  spec: { kind: 'worktree', left: '', right: '', argv: [] },
  updatedAt: '2026-07-26T18:00:00Z',
  comments,
});

class FakeSource implements SseSource {
  private readonly handlers = new Map<string, ((event: Event) => void)[]>();
  closed = false;

  addEventListener(type: string, listener: (event: Event) => void): void {
    const bucket = this.handlers.get(type) ?? [];
    bucket.push(listener);
    this.handlers.set(type, bucket);
  }

  close(): void {
    this.closed = true;
  }

  push(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.handlers.get(type) ?? []) listener(event);
  }
}

interface Harness {
  store: ReturnType<typeof createStore<ReturnType<typeof createInitialState>>>;
  comments: CommentsStore;
  source: FakeSource;
  client: ApiClient;
  responses: { doc: CommentsDoc; etag: string };
}

let created: NewCommentRequest[] = [];
let deletes: { id: string; etag?: string }[] = [];

const harness = (over: Partial<ApiClient> = {}): Harness => {
  const store = createStore(createInitialState());
  store.set({ manifest: manifest(), commentsEnabled: true });
  const bus = createBus();
  const source = new FakeSource();
  const responses = { doc: doc([]), etag: 'etag-1' };

  const client: ApiClient = {
    token: '',
    streamUrl: (path) => path,
    session: () => Promise.reject(new Error('unused')),
    manifest: () => Promise.reject(new Error('unused')),
    file: () => Promise.reject(new Error('unused')),
    comments: (): Promise<CommentsResponse> =>
      Promise.resolve({ doc: responses.doc, etag: responses.etag }),
    createComment: (input) => {
      created.push(input);
      return Promise.resolve({ value: comment('server-1'), etag: 'etag-2' });
    },
    updateComment: (id) =>
      Promise.resolve({ value: { ...comment(id), body: 'echoed' }, etag: 'etag-2' }),
    deleteComment: (id, etag) => {
      deletes.push({ id, etag });
      return Promise.resolve({ value: undefined, etag: 'etag-2' });
    },
    addReply: (id) =>
      Promise.resolve({
        value: {
          id: `${id}-r1`,
          author: { name: 'agent' },
          createdAt: '2026-07-26T19:00:00Z',
          body: 'done',
        },
        etag: 'etag-2',
      }),
    ...over,
  };

  const comments = createCommentsStore({
    store,
    bus,
    client,
    createSource: () => source,
  });
  return { store, comments, source, client, responses };
};

const target = () => draftFor('f1', { start: 4, end: 6, side: 'additions' });

beforeEach(() => {
  created = [];
  deletes = [];
});

describe('createCommentsStore', () => {
  it('loads the document on start and keeps comment counts fresh', async () => {
    const bench = harness();
    bench.responses.doc = doc([comment('c1'), comment('c2', 'src/b.ts')]);
    bench.comments.start();

    await vi.waitFor(() => {
      expect(bench.comments.threads().length).toBe(2);
    });
    expect(bench.store.get().commentCounts).toEqual({ f1: 1, f2: 1 });
    expect(bench.comments.threadsFor('f2').map((thread) => thread.id)).toEqual(['c2']);
    bench.comments.destroy();
  });

  it('waits for the session to enable comments before loading', async () => {
    const store = createStore(createInitialState());
    const bus = createBus();
    const source = new FakeSource();
    const fetched = vi.fn(() => Promise.resolve({ doc: doc([comment('c1')]), etag: 'e' }));
    const comments = createCommentsStore({
      store,
      bus,
      client: {
        token: '',
        streamUrl: (path) => path,
        session: () => Promise.reject(new Error('unused')),
        manifest: () => Promise.reject(new Error('unused')),
        file: () => Promise.reject(new Error('unused')),
        comments: fetched,
        createComment: () => Promise.reject(new Error('unused')),
        updateComment: () => Promise.reject(new Error('unused')),
        deleteComment: () => Promise.reject(new Error('unused')),
        addReply: () => Promise.reject(new Error('unused')),
      },
      createSource: () => source,
    });

    comments.start();
    expect(fetched).not.toHaveBeenCalled();

    store.set({ commentsEnabled: true });
    await vi.waitFor(() => {
      expect(comments.threads().length).toBe(1);
    });
    comments.destroy();
  });

  it('shows an optimistic thread and then adopts the server echo', async () => {
    const bench = harness();
    bench.comments.start();
    await vi.waitFor(() => expect(bench.store.get().commentCounts).toEqual({}));

    const seen: number[] = [];
    bench.comments.subscribe(() => seen.push(bench.comments.threads().length));

    const saved = bench.comments.create(target(), 'please fix');
    expect(bench.comments.threads().length).toBe(1);
    expect(bench.comments.threads()[0]?.pending).toBe(true);

    await saved;
    expect(bench.comments.threads().length).toBe(1);
    expect(bench.comments.threads()[0]?.id).toBe('server-1');
    expect(bench.comments.threads()[0]?.pending).toBe(false);
    expect(bench.store.get().commentCounts).toEqual({ f1: 1 });
    expect(created[0]).toEqual({
      anchor: { path: 'src/a.ts', side: 'additions', startLine: 4, endLine: 6 },
      body: 'please fix',
    });
    expect(seen.length).toBeGreaterThan(0);
    bench.comments.destroy();
  });

  it('never sends server-owned anchor fields', async () => {
    const bench = harness();
    await bench.comments.create(target(), 'hi');
    expect(Object.keys(created[0]?.anchor ?? {})).toEqual([
      'path',
      'side',
      'startLine',
      'endLine',
    ]);
    bench.comments.destroy();
  });

  it('drops the optimistic thread and reports the failure when the post fails', async () => {
    const bench = harness({
      createComment: () =>
        Promise.reject(new ApiError('/api/comments failed with 500', 500, '/api/comments')),
    });
    const result = await bench.comments.create(target(), 'nope');
    expect(result).toBeNull();
    expect(bench.comments.threads().length).toBe(0);
    expect(bench.comments.error()).toContain('500');
    bench.comments.destroy();
  });

  it('re-reads the document after a 409 conflict', async () => {
    const bench = harness({
      updateComment: () =>
        Promise.reject(new ApiError('conflict', 409, '/api/comments/c1', 'etag mismatch')),
    });
    bench.responses.doc = doc([comment('c1')]);
    bench.comments.start();
    await vi.waitFor(() => expect(bench.comments.threads().length).toBe(1));

    bench.responses.doc = doc([{ ...comment('c1'), body: 'from the server' }, comment('c9')]);
    const result = await bench.comments.update('c1', { body: 'mine' });

    expect(result).toBeNull();
    expect(bench.comments.error()).toContain('etag mismatch');
    expect(bench.comments.threads().map((thread) => thread.id)).toEqual(['c1', 'c9']);
    expect(bench.comments.threads()[0]?.comment.body).toBe('from the server');
    bench.comments.destroy();
  });

  it('applies an update optimistically and adopts the echo', async () => {
    const bench = harness();
    bench.responses.doc = doc([comment('c1')]);
    bench.comments.start();
    await vi.waitFor(() => expect(bench.comments.threads().length).toBe(1));

    const pending = bench.comments.update('c1', { body: 'revised' });
    expect(bench.comments.threads()[0]?.comment.body).toBe('revised');
    await pending;
    expect(bench.comments.threads()[0]?.comment.body).toBe('echoed');
    bench.comments.destroy();
  });

  it('restores a deleted comment when the delete fails', async () => {
    const bench = harness({
      deleteComment: () => Promise.reject(new ApiError('boom', 500, '/x')),
    });
    bench.responses.doc = doc([comment('c1')]);
    bench.comments.start();
    await vi.waitFor(() => expect(bench.comments.threads().length).toBe(1));

    expect(await bench.comments.remove('c1')).toBe(false);
    expect(bench.comments.threads().length).toBe(1);
    bench.comments.destroy();
  });

  it('deletes a just-created comment with the etag the create returned', async () => {
    let current = 'etag-1';
    const bench = harness({
      createComment: (input) => {
        created.push(input);
        current = 'etag-2';
        return Promise.resolve({ value: comment('server-1'), etag: current });
      },
      deleteComment: (id, etag) => {
        deletes.push({ id, etag });
        if (etag !== current) {
          return Promise.reject(
            new ApiError('conflict', 409, `/api/comments/${id}`, 'etag mismatch'),
          );
        }
        current = 'etag-3';
        return Promise.resolve({ value: undefined, etag: current });
      },
    });
    bench.comments.start();
    await vi.waitFor(() => expect(bench.store.get().commentCounts).toEqual({}));

    await bench.comments.create(target(), 'please fix');
    bench.responses.doc = doc([comment('server-1')]);

    expect(await bench.comments.remove('server-1')).toBe(true);
    expect(deletes).toEqual([{ id: 'server-1', etag: 'etag-2' }]);
    expect(bench.comments.threads()).toEqual([]);
    expect(bench.comments.error()).toBeNull();
    bench.comments.destroy();
  });

  it('drops a still-pending comment locally and discards the late echo', async () => {
    let settle: (result: Mutation<Comment>) => void = () => undefined;
    const bench = harness({
      createComment: () =>
        new Promise<Mutation<Comment>>((resolve) => {
          settle = resolve;
        }),
    });

    const saving = bench.comments.create(target(), 'oops');
    const pending = bench.comments.threads()[0]?.id ?? '';
    expect(pending.startsWith('dv-pending-')).toBe(true);

    expect(await bench.comments.remove(pending)).toBe(true);
    expect(bench.comments.threads()).toEqual([]);
    expect(deletes).toEqual([]);

    settle({ value: comment('server-1'), etag: 'etag-2' });
    expect(await saving).toBeNull();
    expect(bench.comments.threads()).toEqual([]);
    expect(deletes).toEqual([{ id: 'server-1', etag: 'etag-2' }]);
    bench.comments.destroy();
  });

  it('appends a reply to its parent', async () => {
    const bench = harness();
    bench.responses.doc = doc([comment('c1')]);
    bench.comments.start();
    await vi.waitFor(() => expect(bench.comments.threads().length).toBe(1));

    await bench.comments.reply('c1', 'done');
    expect(bench.comments.threads()[0]?.comment.replies.map((entry) => entry.id)).toEqual([
      'c1-r1',
    ]);
    bench.comments.destroy();
  });

  it('adopts a document pushed over the stream', async () => {
    const bench = harness();
    bench.comments.start();
    await vi.waitFor(() => expect(bench.store.get().commentCounts).toEqual({}));

    bench.source.push('comments', {
      doc: doc([comment('sse-1'), comment('sse-2', 'src/b.ts')]),
      etag: 'etag-2',
    });

    expect(bench.comments.threads().map((thread) => thread.id)).toEqual(['sse-1', 'sse-2']);
    expect(bench.store.get().commentCounts).toEqual({ f1: 1, f2: 1 });
    bench.comments.destroy();
  });

  it('accepts a bare document on the stream too', async () => {
    const bench = harness();
    bench.comments.start();
    await vi.waitFor(() => expect(bench.store.get().commentCounts).toEqual({}));

    bench.source.push('doc', doc([comment('bare-1')]));
    expect(bench.comments.threads().map((thread) => thread.id)).toEqual(['bare-1']);
    bench.comments.destroy();
  });

  it('keeps stale comments reachable', async () => {
    const bench = harness();
    bench.responses.doc = doc([comment('gone', 'src/a.ts', true)]);
    bench.comments.start();

    await vi.waitFor(() => expect(bench.comments.threads().length).toBe(1));
    expect(bench.comments.threads()[0]?.stale).toBe(true);
    expect(bench.store.get().commentCounts).toEqual({ f1: 1 });
    bench.comments.destroy();
  });

  it('resolves the file id from a previous path', async () => {
    const bench = harness();
    bench.store.set({
      manifest: {
        ...manifest(),
        files: [{ ...manifest().files[0]!, id: 'renamed', prevPath: 'src/old.ts' }],
      },
    });
    bench.responses.doc = doc([comment('c1', 'src/old.ts')]);
    bench.comments.start();

    await vi.waitFor(() => expect(bench.comments.threads().length).toBe(1));
    expect(bench.comments.threads()[0]?.fileId).toBe('renamed');
    bench.comments.destroy();
  });

  it('keeps a draft body keyed to its range, not to the open box', () => {
    const bench = harness();
    bench.comments.setDraft(target().key, 'half written');

    expect(bench.comments.draft('f1:additions:4-6')).toBe('half written');
    expect(bench.comments.draft('f1:additions:7-9')).toBe('');
    bench.comments.destroy();
  });

  it('clears the draft once the comment is stored', async () => {
    const bench = harness();
    bench.comments.setDraft('f1:additions:4-6', 'draft body');
    await bench.comments.create(target(), 'draft body');
    expect(bench.comments.draft('f1:additions:4-6')).toBe('');
    bench.comments.destroy();
  });

  it('stops notifying after destroy', async () => {
    const bench = harness();
    bench.comments.start();
    await vi.waitFor(() => expect(bench.source.closed).toBe(false));
    const listener = vi.fn();
    bench.comments.subscribe(listener);
    bench.comments.destroy();
    await bench.comments.refresh();
    expect(listener).not.toHaveBeenCalled();
    expect(bench.source.closed).toBe(true);
  });
});
