import type { CodeViewLineSelection, VirtualFileMetrics } from '@pierre/diffs';
import { CodeView } from '@pierre/diffs';
import { getOrCreateWorkerPoolSingleton } from '@pierre/diffs/worker';
import type { FilePayload } from '../api/types';
import type { Card, CardAnnotation, Draft, Thread } from '../comments/anchors';
import {
  anchoredThreads,
  annotationSignature,
  annotationsFor,
  draftFor,
  draftKeyFor,
  rangeFor,
} from '../comments/anchors';
import type { CommentsStore } from '../comments/store';
import { DRAFT_INPUT_CLASS, createCardList } from '../comments/thread';
import type { Bus } from '../core/bus';
import type { Disposable } from '../core/component';
import { createDisposer } from '../core/component';
import type { AppStore, LineRange, LineSelection } from '../core/store';
import { themeOptionFor } from '../theme/catppuccin';
import type { DiffItem } from './items';
import { itemFor, withAnnotations } from './items';
import { measureMetrics, measuredMetrics } from './metrics';
import { buildOptions } from './options';
import { forwardWheel } from './wheel';

const WORKER_POOL_SIZE = 4;

export interface ItemChange {
  annotations?: readonly CardAnnotation[];
  collapsed?: boolean;
}

/**
 * `center` for a jump the user asked for, `nearest` when the range is likely
 * already on screen and moving the view would be jarring.
 */
export type RevealAlign = 'center' | 'nearest';

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
  revealRange(id: string, range: LineRange, align?: RevealAlign): void;
  revealThread(thread: Thread): void;
  stepHunk(delta: number): void;
}

const workerManager = (
  theme: ReturnType<typeof themeOptionFor>,
): ReturnType<typeof getOrCreateWorkerPoolSingleton> | undefined => {
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
      highlighterOptions: { theme },
    });
  } catch {
    return undefined;
  }
};

const draftKeyIn = (cards: readonly Card[]): string | null =>
  cards.find((card): card is Draft => card.kind === 'draft')?.key ?? null;

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
  let pendingRange: { selection: LineSelection; align: RevealAlign } | null = null;
  let draftInput: HTMLTextAreaElement | null = null;
  /** Which draft the box above belongs to, so a stale one never takes the focus. */
  let draftKey: string | null = null;
  let focusWhenDrawn = false;

  const renderAnnotation = (annotation: { metadata: Card[] }): HTMLElement | undefined => {
    if (annotation.metadata.length === 0) return undefined;
    const element = createCardList(annotation.metadata, { store, bus, comments }).el;
    const input = element.querySelector<HTMLTextAreaElement>(`.${DRAFT_INPUT_CLASS}`);
    if (input) {
      draftInput = input;
      draftKey = draftKeyIn(annotation.metadata);
      if (focusWhenDrawn) {
        focusWhenDrawn = false;
        // The diff hangs this element in the DOM once we hand it back, and a
        // detached box cannot hold the caret.
        queueMicrotask(() => {
          if (input.isConnected) input.focus({ preventScroll: true });
        });
      }
    }
    return element;
  };

  const options = () => buildOptions(store.get(), { store, bus, metrics, renderAnnotation });

  const workers = workerManager(themeOptionFor(store.get().themePref));
  const view = new CodeView<Card[]>(options(), workers);
  view.setup(root);

  /** The box the user is typing into, if the diff has that line on screen. */
  const draftAt = (fileId: string): Draft | null => {
    const { commentsEnabled, composing } = store.get();
    if (!commentsEnabled || composing === null || composing.id !== fileId) return null;
    const draft = draftFor(fileId, composing.range);
    // A comment already anchored to these exact lines is the box for them.
    // Jumping to one from the inbox selects its range, and a second empty box
    // stacked underneath is not what the reader asked for.
    const taken = anchoredThreads(comments.threadsFor(fileId)).some(
      (thread) => draftKeyFor(fileId, rangeFor(thread)) === draft.key,
    );
    return taken ? null : draft;
  };

  /** Move into the draft box, or arm the focus for when the diff draws it. */
  const focusDraft = (): void => {
    const composing = store.get().composing;
    const draft = composing === null ? null : draftAt(composing.id);
    if (draft === null) return;
    if (draft.key === draftKey && draftInput?.isConnected === true) {
      draftInput.focus({ preventScroll: true });
      return;
    }
    focusWhenDrawn = true;
  };

  const applyOptions = (): void => {
    view.setOptions(options());
    void workers?.setRenderOptions({ theme: themeOptionFor(store.get().themePref) });
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

  const revealRange = (id: string, range: LineRange, align: RevealAlign = 'center'): void => {
    if (!view.getItem(id)) {
      pendingRange = { selection: { id, range }, align };
      return;
    }
    pendingRange = null;
    view.setSelectedLines({ id, range });
    view.scrollTo({ type: 'range', id, range, align });
  };

  const flushPending = (id: string): void => {
    if (pendingRange?.selection.id === id) {
      const target = pendingRange;
      pendingRange = null;
      revealRange(target.selection.id, target.selection.range, target.align);
      return;
    }
    if (pendingFile === id) revealFile(id);
  };

  const add = (payload: FilePayload): void => {
    const annotations = annotationsFor(comments.threadsFor(payload.id), draftAt(payload.id));
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
      const annotations = annotationsFor(comments.threadsFor(item.id), draftAt(item.id));
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

  disposer.add(forwardWheel(root));
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
  disposer.add(bus.on('draft:focus', focusDraft));
  disposer.add(
    bus.on('theme:changed', () => {
      applyOptions();
      view.onThemeChange();
    }),
  );
  disposer.add(store.subscribe('view', applyOptions));
  disposer.add(store.subscribe('wrap', applyOptions));
  disposer.add(
    store.subscribe('commentsEnabled', () => {
      applyOptions();
      refreshAnnotations();
    }),
  );
  disposer.add(
    store.subscribe('composing', (composing) => {
      if (composing === null) {
        draftInput = null;
        draftKey = null;
        focusWhenDrawn = false;
      }
      refreshAnnotations();
      // A settled range means the user is ready to write: open the box focused.
      if (composing !== null) focusDraft();
    }),
  );
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
