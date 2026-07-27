import type { CodeViewLineSelection, VirtualFileMetrics } from '@pierre/diffs';
import { CodeView } from '@pierre/diffs';
import { getOrCreateWorkerPoolSingleton } from '@pierre/diffs/worker';
import type { FilePayload } from '../api/types';
import type { Thread, ThreadAnnotation } from '../comments/anchors';
import { annotationSignature, annotationsFor, rangeFor } from '../comments/anchors';
import type { CommentsStore } from '../comments/store';
import { createThreadList } from '../comments/thread';
import type { Bus } from '../core/bus';
import type { Disposable } from '../core/component';
import { createDisposer } from '../core/component';
import type { AppStore, LineRange, LineSelection } from '../core/store';
import type { DiffItem } from './items';
import { itemFor, withAnnotations } from './items';
import { measureMetrics, measuredMetrics } from './metrics';
import { buildOptions } from './options';

const WORKER_POOL_SIZE = 4;

export interface ItemChange {
  annotations?: readonly ThreadAnnotation[];
  collapsed?: boolean;
}

export interface ViewerDeps {
  store: AppStore;
  bus: Bus;
  comments: CommentsStore;
  root: HTMLElement;
  loadFile(id: string): void;
}

export interface Viewer extends Disposable {
  has(id: string): boolean;
  updateItem(id: string, change: ItemChange): boolean;
  refreshAnnotations(): void;
  revealFile(id: string): void;
  revealRange(id: string, range: LineRange): void;
  revealThread(thread: Thread): void;
  stepHunk(delta: number): void;
}

const workerManager = (): ReturnType<typeof getOrCreateWorkerPoolSingleton> | undefined => {
  if (typeof Worker === 'undefined') return undefined;
  try {
    return getOrCreateWorkerPoolSingleton({
      poolOptions: {
        poolSize: WORKER_POOL_SIZE,
        workerFactory: () =>
          new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), {
            type: 'module',
          }),
      },
      highlighterOptions: {},
    });
  } catch {
    return undefined;
  }
};

const sameRange = (left: LineRange, right: LineRange): boolean =>
  left.start === right.start &&
  left.end === right.end &&
  (left.side ?? 'additions') === (right.side ?? 'additions') &&
  (left.endSide ?? left.side ?? 'additions') === (right.endSide ?? right.side ?? 'additions');

const sameSelection = (
  left: CodeViewLineSelection | null,
  right: LineSelection | null,
): boolean => {
  if (left === null || right === null) return left === right;
  return left.id === right.id && sameRange(left.range, right.range);
};

export const createViewer = ({
  store,
  bus,
  comments,
  root,
  loadFile,
}: ViewerDeps): Viewer => {
  const disposer = createDisposer();
  const items: DiffItem[] = [];
  const rank = new Map<string, number>();
  const signatures = new Map<string, string>();
  const hunkCursor = new Map<string, number>();
  let metrics: VirtualFileMetrics = measureMetrics(root);
  let pendingFile: string | null = null;
  let pendingRange: LineSelection | null = null;

  const renderAnnotation = (annotation: {
    metadata: Thread[];
  }): HTMLElement | undefined => {
    if (annotation.metadata.length === 0) return undefined;
    return createThreadList(annotation.metadata, { bus, comments }).el;
  };

  const options = () => buildOptions(store.get(), { store, bus, metrics, renderAnnotation });

  const view = new CodeView<Thread[]>(options(), workerManager());
  view.setup(root);

  const applyOptions = (): void => {
    view.setOptions(options());
  };

  const rankOf = (id: string): number => rank.get(id) ?? Number.MAX_SAFE_INTEGER;

  const insertionIndex = (id: string): number => {
    const target = rankOf(id);
    for (let index = items.length; index > 0; index -= 1) {
      const previous = items[index - 1];
      if (!previous || rankOf(previous.id) <= target) return index;
    }
    return 0;
  };

  const localIndex = (id: string): number => items.findIndex((item) => item.id === id);

  const publishItem = (item: DiffItem): boolean => {
    const version = (view.getItem(item.id)?.version ?? 0) + 1;
    const next: DiffItem =
      item.type === 'file' ? { ...item, version } : { ...item, version };
    const index = localIndex(next.id);
    if (index >= 0) items[index] = next;
    return view.updateItem(next);
  };

  const updateItem = (id: string, change: ItemChange): boolean => {
    const current = items[localIndex(id)];
    if (!current) return false;
    const annotated = change.annotations
      ? withAnnotations(current, change.annotations)
      : current;
    const next: DiffItem =
      change.collapsed === undefined
        ? annotated
        : annotated.type === 'file'
          ? { ...annotated, collapsed: change.collapsed }
          : { ...annotated, collapsed: change.collapsed };
    return publishItem(next);
  };

  const revealFile = (id: string): void => {
    if (!view.getItem(id)) {
      pendingFile = id;
      return;
    }
    pendingFile = null;
    view.scrollTo({ type: 'item', id, align: 'start' });
  };

  const revealRange = (id: string, range: LineRange): void => {
    if (!view.getItem(id)) {
      pendingRange = { id, range };
      return;
    }
    pendingRange = null;
    view.setSelectedLines({ id, range });
    view.scrollTo({ type: 'range', id, range, align: 'center' });
  };

  const flushPending = (id: string): void => {
    if (pendingRange?.id === id) {
      const target = pendingRange;
      pendingRange = null;
      revealRange(target.id, target.range);
      return;
    }
    if (pendingFile === id) revealFile(id);
  };

  const add = (payload: FilePayload): void => {
    const annotations = annotationsFor(comments.threadsFor(payload.id));
    signatures.set(payload.id, annotationSignature(annotations));
    const next = itemFor(payload, annotations);

    if (view.getItem(payload.id)) {
      publishItem(next);
      flushPending(payload.id);
      return;
    }

    const position = insertionIndex(payload.id);
    if (position >= items.length) {
      items.push(next);
      view.addItems([next]);
    } else {
      items.splice(position, 0, next);
      view.setItems(items);
    }
    flushPending(payload.id);
  };

  const refreshAnnotations = (): void => {
    for (const item of [...items]) {
      const annotations = annotationsFor(comments.threadsFor(item.id));
      const signature = annotationSignature(annotations);
      if (signatures.get(item.id) === signature) continue;
      signatures.set(item.id, signature);
      updateItem(item.id, { annotations });
    }
  };

  const stepHunk = (delta: number): void => {
    const id = store.get().selectedFile;
    if (id === null) return;
    const item = view.getItem(id);
    if (!item || item.type !== 'diff') return;
    const hunks = item.fileDiff.hunks;
    if (hunks.length === 0) return;
    const current = hunkCursor.get(id) ?? (delta > 0 ? -1 : hunks.length);
    const index = Math.min(Math.max(current + delta, 0), hunks.length - 1);
    hunkCursor.set(id, index);
    const hunk = hunks[index];
    if (!hunk) return;
    const additions = hunk.additionCount > 0;
    view.scrollTo({
      type: 'line',
      id,
      lineNumber: additions ? hunk.additionStart : hunk.deletionStart,
      side: additions ? 'additions' : 'deletions',
      align: 'start',
    });
  };

  const revealThread = (thread: Thread): void => {
    if (thread.stale || thread.lineNumber === 0) {
      revealFile(thread.fileId);
      return;
    }
    revealRange(thread.fileId, rangeFor(thread));
  };

  disposer.add(view.subscribeToScroll((top) => store.set({ scrollTop: top })));
  disposer.add(bus.on('file:payload', add));
  disposer.add(
    bus.on('manifest:ready', (manifest) => {
      rank.clear();
      manifest.files.forEach((file, index) => rank.set(file.id, index));
    }),
  );
  disposer.add(
    bus.on('file:selected', ({ id, reveal }) => {
      loadFile(id);
      if (!reveal) return;
      const selection = store.get().selection;
      if (selection && selection.id === id) revealRange(id, selection.range);
      else revealFile(id);
    }),
  );
  disposer.add(bus.on('hunk:step', ({ delta }) => stepHunk(delta)));
  disposer.add(
    bus.on('theme:changed', () => {
      applyOptions();
      view.onThemeChange();
    }),
  );
  disposer.add(store.subscribe('view', applyOptions));
  disposer.add(store.subscribe('wrap', applyOptions));
  disposer.add(store.subscribe('commentsEnabled', applyOptions));
  disposer.add(
    store.subscribe('selection', (selection) => {
      if (sameSelection(view.getSelectedLines(), selection)) return;
      if (selection) revealRange(selection.id, selection.range);
      else view.clearSelectedLines();
    }),
  );
  disposer.add(comments.subscribe(refreshAnnotations));

  void measuredMetrics(root).then((measured) => {
    if (measured.lineHeight === metrics.lineHeight) return;
    metrics = measured;
    applyOptions();
  });

  return {
    has: (id) => view.getItem(id) !== undefined,
    updateItem,
    refreshAnnotations,
    revealFile,
    revealRange,
    revealThread,
    stepHunk,
    destroy() {
      disposer.dispose();
      view.cleanUp();
    },
  };
};
