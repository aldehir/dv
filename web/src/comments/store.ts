import type { ApiClient } from '../api/client';
import { ApiError } from '../api/client';
import type { SseSource } from '../api/sse';
import { createSse } from '../api/sse';
import type {
  Comment,
  CommentsDoc,
  CommentsResponse,
  PatchCommentRequest,
  Reply,
} from '../api/types';
import type { Bus, ComposeIntent } from '../core/bus';
import type { Disposable, Unsubscribe } from '../core/component';
import { createDisposer } from '../core/component';
import type { AppStore, LineRange } from '../core/store';
import type { Thread } from './anchors';
import { draftKeyFor, requestAnchorFor, sideOfRange, threadFor } from './anchors';

export const COMMENTS_STREAM_PATH = '/api/comments/stream';
const PENDING_PREFIX = 'dv-pending-';
const STREAM_EVENTS = ['comments', 'doc', 'message'] as const;

export interface ComposeTarget {
  fileId: string;
  path: string;
  range: LineRange;
  key: string;
}

export interface CommentsStore extends Disposable {
  start(): void;
  refresh(): Promise<void>;
  threads(): readonly Thread[];
  threadsFor(fileId: string): readonly Thread[];
  compose(): ComposeTarget | null;
  setCompose(intent: ComposeIntent | null): void;
  draft(key: string): string;
  setDraft(key: string, body: string): void;
  error(): string | null;
  create(target: ComposeTarget, body: string): Promise<Comment | null>;
  update(id: string, patch: PatchCommentRequest): Promise<Comment | null>;
  remove(id: string): Promise<boolean>;
  reply(id: string, body: string): Promise<Reply | null>;
  subscribe(listener: () => void): Unsubscribe;
}

export interface CommentsStoreDeps {
  store: AppStore;
  bus: Bus;
  client: ApiClient;
  createSource?: (url: string) => SseSource;
}

const parseJson = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const describe = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.isUnreachable) return 'dv server is unreachable';
    return error.detail === '' ? error.message : error.detail;
  }
  return error instanceof Error ? error.message : String(error);
};

const isDoc = (value: unknown): value is CommentsDoc =>
  typeof value === 'object' && value !== null && Array.isArray((value as CommentsDoc).comments);

const isResponse = (value: unknown): value is CommentsResponse =>
  typeof value === 'object' && value !== null && isDoc((value as CommentsResponse).doc);

export const createCommentsStore = ({
  store,
  bus,
  client,
  createSource,
}: CommentsStoreDeps): CommentsStore => {
  const disposer = createDisposer();
  const listeners = new Set<() => void>();
  const drafts = new Map<string, string>();
  let known = new Map<string, Comment>();
  let optimistic = new Map<string, Comment>();
  let cached: readonly Thread[] | null = null;
  let etag = '';
  let composing: ComposeTarget | null = null;
  let failure: string | null = null;
  let running = false;
  let watching = false;
  let pendingSeq = 0;

  const pathFor = (fileId: string): string => {
    const files = store.get().manifest?.files ?? [];
    return files.find((file) => file.id === fileId)?.path ?? fileId;
  };

  const fileIdFor = (path: string): string => {
    const files = store.get().manifest?.files ?? [];
    const match = files.find((file) => file.path === path || file.prevPath === path);
    return match?.id ?? path;
  };

  const build = (): readonly Thread[] => {
    const threads = [
      ...[...known.values()].map((comment) => threadFor(fileIdFor(comment.anchor.path), comment)),
      ...[...optimistic.values()].map((comment) =>
        threadFor(fileIdFor(comment.anchor.path), comment, true),
      ),
    ];
    return threads.sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.startLine - right.startLine ||
        left.id.localeCompare(right.id),
    );
  };

  const threads = (): readonly Thread[] => (cached ??= build());

  const publishCounts = (): void => {
    const counts: Record<string, number> = {};
    for (const thread of threads()) {
      counts[thread.fileId] = (counts[thread.fileId] ?? 0) + 1;
    }
    store.set({ commentCounts: counts });
  };

  const notify = (): void => {
    cached = null;
    publishCounts();
    for (const listener of [...listeners]) listener();
  };

  const apply = (doc: CommentsDoc, nextEtag: string): void => {
    known = new Map(doc.comments.map((comment) => [comment.id, comment]));
    if (nextEtag !== '') etag = nextEtag;
    notify();
  };

  const refresh = async (): Promise<void> => {
    try {
      const response = await client.comments();
      failure = null;
      apply(response.doc, response.etag);
    } catch (error: unknown) {
      failure = describe(error);
      notify();
    }
  };

  const recover = async (error: unknown): Promise<void> => {
    const message = describe(error);
    if (error instanceof ApiError && error.isConflict) {
      await refresh();
      failure = message;
    } else {
      failure = message;
    }
    notify();
  };

  const adopt = (comment: Comment): void => {
    known.set(comment.id, comment);
    notify();
  };

  const stream = createSse({
    url: client.streamUrl(COMMENTS_STREAM_PATH),
    create: createSource,
    events: Object.fromEntries(
      STREAM_EVENTS.map((name) => [
        name,
        (raw: string) => {
          const parsed = parseJson<unknown>(raw);
          if (isResponse(parsed)) {
            apply(parsed.doc, parsed.etag);
            return;
          }
          if (isDoc(parsed)) {
            apply(parsed, '');
            return;
          }
          void refresh();
        },
      ]),
    ),
  });

  disposer.add(stream.destroy);

  const begin = (): void => {
    if (running) return;
    running = true;
    void refresh();
    stream.connect();
  };

  return {
    start() {
      if (store.get().commentsEnabled) {
        begin();
        return;
      }
      if (watching) return;
      watching = true;
      disposer.add(
        store.subscribe('commentsEnabled', (enabled) => {
          if (enabled) begin();
        }),
      );
    },
    refresh,
    threads,
    threadsFor: (fileId) => threads().filter((thread) => thread.fileId === fileId),
    compose: () => composing,
    setCompose(intent) {
      if (!intent) {
        composing = null;
        notify();
        return;
      }
      composing = {
        fileId: intent.fileId,
        path: pathFor(intent.fileId),
        range: intent.range,
        key: draftKeyFor(intent.fileId, intent.range),
      };
      notify();
    },
    draft: (key) => drafts.get(key) ?? '',
    setDraft(key, body) {
      if (body === '') drafts.delete(key);
      else drafts.set(key, body);
    },
    error: () => failure,
    async create(target, body) {
      pendingSeq += 1;
      const now = new Date().toISOString();
      const anchor = requestAnchorFor(target.path, target.range);
      const draft: Comment = {
        id: `${PENDING_PREFIX}${pendingSeq}`,
        status: 'open',
        author: { name: 'you' },
        createdAt: now,
        updatedAt: now,
        body,
        anchor: {
          path: anchor.path,
          prevPath: null,
          side: sideOfRange(target.range),
          startLine: anchor.startLine,
          endLine: anchor.endLine,
          blobSha: '',
          quote: '',
          contextBefore: [],
          contextAfter: [],
        },
        replies: [],
      };
      optimistic.set(draft.id, draft);
      failure = null;
      notify();

      try {
        const saved = await client.createComment({ anchor, body });
        optimistic.delete(draft.id);
        drafts.delete(target.key);
        adopt(saved);
        bus.emit('comment:created', saved);
        return saved;
      } catch (error: unknown) {
        optimistic.delete(draft.id);
        await recover(error);
        return null;
      }
    },
    async update(id, patch) {
      const previous = known.get(id);
      if (previous) {
        known.set(id, { ...previous, ...patch });
        notify();
      }
      try {
        const saved = await client.updateComment(id, patch, etag);
        failure = null;
        adopt(saved);
        bus.emit('comment:updated', saved);
        return saved;
      } catch (error: unknown) {
        if (previous) known.set(id, previous);
        await recover(error);
        return null;
      }
    },
    async remove(id) {
      const previous = known.get(id);
      known.delete(id);
      notify();
      try {
        await client.deleteComment(id, etag);
        failure = null;
        bus.emit('comment:deleted', { id });
        notify();
        return true;
      } catch (error: unknown) {
        if (previous) known.set(id, previous);
        await recover(error);
        return false;
      }
    },
    async reply(id, body) {
      try {
        const saved = await client.addReply(id, body);
        failure = null;
        const parent = known.get(id);
        if (parent) adopt({ ...parent, replies: [...parent.replies, saved] });
        else await refresh();
        return saved;
      } catch (error: unknown) {
        await recover(error);
        return null;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      disposer.dispose();
      listeners.clear();
      optimistic = new Map();
    },
  };
};
