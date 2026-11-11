import type { CodeViewLineSelection, Hunk, VirtualFileMetrics } from '@pierre/diffs';
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
import { on } from '../core/dom';
import type { AppStore, LineRange, LineSelection } from '../core/store';
import { themeOptionFor } from '../theme/catppuccin';
import type { DiffItem } from './items';
import { itemFor, withAnnotations } from './items';
import { measureMetrics, measuredMetrics } from './metrics';
import { buildOptions } from './options';

const WORKER_POOL_SIZE = 4;

/** An item that carries a real patch, as opposed to a placeholder. */
type DiffFileItem = Extract<DiffItem, { type: 'diff' }>;

export interface ItemChange {
  annotations?: readonly CardAnnotation[];
  collapsed?: boolean;
}

/**
 * `center` for a jump the user asked for, `nearest` when the range is likely
 * already on screen and moving the view would be jarring.
 */
export type RevealAlign = 'center' | 'nearest';

/** A run of added or removed lines placed in the whole scroll, 0 to 1. */
export interface ChangeBand {
  kind: 'addition' | 'deletion';
  offset: number;
  extent: number;
}

/** One hunk placed in the whole scroll, for the rail to draw. */
export interface HunkMark {
  fileId: string;
  path: string;
  index: number;
  /** Where the hunk sits in the total scroll height, 0 to 1. */
  offset: number;
  /** How much of the total scroll height the hunk spans. */
  extent: number;
  /** The hunk's added and removed runs, line for line. */
  changes: ChangeBand[];
  /** Where the hunk's file starts, so the rail can seam the boundary. */
  fileOffset: number;
  additions: number;
  deletions: number;
  /** The name after `@@`, when git found one. */
  context: string;
}

/** The visible slice of the scroll, both as fractions of its total height. */
export interface Viewport {
  offset: number;
  extent: number;
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
  revealRange(id: string, range: LineRange, align?: RevealAlign): void;
  revealThread(thread: Thread): void;
  stepHunk(delta: number): void;
  hunks(): HunkMark[];
  jumpToHunk(mark: HunkMark): void;
  viewport(): Viewport;
  scrollToOffset(offset: number): void;
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
  /** Manifest position by file id, and the ids in that order. */
  const rank = new Map<string, number>();
  let order: string[] = [];
  /** Payloads that arrived ahead of a file ranked before them, by id. */
  const waiting = new Map<string, FilePayload>();
  /** The manifest position the next append has to come from. */
  let cursor = 0;
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

  /** Whether the diff draws this file: every one, or only the selected one. */
  const shown = (id: string): boolean => {
    const { singleFile, selectedFile } = store.get();
    return !singleFile || id === selectedFile;
  };

  const append = (payload: FilePayload): void => {
    const annotations = annotationsFor(comments.threadsFor(payload.id), draftAt(payload.id));
    signatures.set(payload.id, annotationSignature(annotations));
    const next = itemFor(payload, annotations);

    if (localIndex(payload.id) >= 0) {
      publishItem(next);
    } else {
      items.push(next);
      if (shown(next.id)) view.addItems([next]);
    }
    flushPending(payload.id);
  };

  /**
   * Hands the library the files it should draw now, from a clean slate rather
   * than a reconcile: a list that changes in the middle is the reorder the
   * library keeps stray elements for (see `add`), and appends are the path it
   * is sure of.
   */
  const reshow = (): void => {
    view.reset();
    view.addItems(items.filter((item) => shown(item.id)));
    const { selection, selectedFile } = store.get();
    if (selection && view.getItem(selection.id)) view.setSelectedLines(selection);
    if (selectedFile !== null) revealFile(selectedFile);
    bus.emit('diff:reshown');
  };

  /**
   * Whether nothing more is coming for this file, so the ones ranked behind
   * it may land: its fetch failed, or the stream has finished without it.
   */
  const settled = (id: string): boolean => {
    const { fileState, stream } = store.get();
    return fileState[id]?.status === 'error' || stream === 'done' || stream === 'closed';
  };

  /** Appends every waiting payload whose predecessors have all landed or settled. */
  const flush = (): void => {
    while (cursor < order.length) {
      const id = order[cursor];
      if (id === undefined) break;
      const queued = waiting.get(id);
      if (queued) {
        waiting.delete(id);
        append(queued);
      } else if (localIndex(id) < 0 && !settled(id)) {
        break;
      }
      cursor += 1;
    }
  };

  /**
   * Files come off the stream in whatever order the server's workers finish
   * them, and the diff holds them in manifest order. Splicing a late one into
   * place hands the library a reordered list, and its rebuild keeps its render
   * range by position: a file drawn near the top and then pushed down by an
   * insertion above it kept its element for good, and that stray element
   * skewed the sticky window every scroll ran through. So a payload waits
   * until everything ranked ahead of it has landed or settled, and only ever
   * goes on the end. One that was skipped as settled and turns up later goes
   * on the end too, out of place rather than spliced in.
   */
  const add = (payload: FilePayload): void => {
    const position = rank.get(payload.id);
    if (localIndex(payload.id) >= 0 || position === undefined || position < cursor) {
      append(payload);
      return;
    }
    waiting.set(payload.id, payload);
    flush();
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

  const scrollToHunk = (id: string, hunk: Hunk): void => {
    const additions = hunk.additionCount > 0;
    view.scrollTo({
      type: 'line',
      id,
      lineNumber: additions ? hunk.additionStart : hunk.deletionStart,
      side: additions ? 'additions' : 'deletions',
      align: 'start',
    });
  };

  /** The nearest file either side of `id` that has been loaded and has hunks. */
  const neighbourWithHunks = (id: string, delta: number): DiffFileItem | null => {
    const start = localIndex(id);
    if (start < 0) return null;
    for (let index = start + delta; index >= 0 && index < items.length; index += delta) {
      const item = items[index];
      if (item?.type === 'diff' && item.fileDiff.hunks.length > 0) return item;
    }
    return null;
  };

  const stepHunk = (delta: number): void => {
    const id = store.get().selectedFile;
    if (id === null) return;
    const item = view.getItem(id);
    if (!item) return;

    const hunks = item.type === 'diff' ? item.fileDiff.hunks : [];
    const current = hunkCursor.get(id) ?? (delta > 0 ? -1 : hunks.length);
    const index = current + delta;
    const hunk = index >= 0 ? hunks[index] : undefined;
    if (hunk) {
      hunkCursor.set(id, index);
      scrollToHunk(id, hunk);
      return;
    }

    // Off either end of this file. The diff reads as one long list, so carry on
    // into the next file that has hunks rather than stopping at the seam.
    const next = neighbourWithHunks(id, delta);
    if (!next) return;
    const landing = delta > 0 ? 0 : next.fileDiff.hunks.length - 1;
    const target = next.fileDiff.hunks[landing];
    if (!target) return;
    store.set({ selectedFile: next.id });
    hunkCursor.set(next.id, landing);
    scrollToHunk(next.id, target);
  };

  const jumpToHunk = (mark: HunkMark): void => {
    const item = view.getItem(mark.fileId);
    if (!item || item.type !== 'diff') return;
    const hunk = item.fileDiff.hunks[mark.index];
    if (!hunk) return;
    hunkCursor.set(mark.fileId, mark.index);
    scrollToHunk(mark.fileId, hunk);
  };

  /**
   * Every tick is placed inside its own file's measured band, so a band whose
   * height drifts from its line count cannot push the files below it off.
   */
  const hunks = (): HunkMark[] => {
    const total = view.getScrollHeight();
    if (total <= 0) return [];
    const split = store.get().view === 'split';
    const tops = items.map((item) => view.getTopForItem(item.id));

    // Where each file's band ends: the next file that has been measured.
    const ends: number[] = new Array(items.length);
    let below = total;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      ends[index] = below;
      const top = tops[index];
      if (top !== undefined) below = top;
    }

    const marks: HunkMark[] = [];
    items.forEach((item, index) => {
      const top = tops[index];
      if (item.type !== 'diff' || top === undefined) return;
      const band = Math.max((ends[index] ?? total) - top, 0);
      const lines = split ? item.fileDiff.splitLineCount : item.fileDiff.unifiedLineCount;
      if (lines <= 0) return;
      const at = (row: number): number => (top + (band * row) / lines) / total;
      const span = (rows: number): number => (band * rows) / lines / total;
      item.fileDiff.hunks.forEach((hunk, position) => {
        const start = split ? hunk.splitLineStart : hunk.unifiedLineStart;
        const count = split ? hunk.splitLineCount : hunk.unifiedLineCount;

        // Unified stacks a change's removals above its additions; split lays
        // them side by side, so the block is only as tall as the longer side.
        const changes: ChangeBand[] = [];
        let row = start;
        for (const content of hunk.hunkContent) {
          if (content.type === 'context') {
            row += content.lines;
            continue;
          }
          const { deletions, additions } = content;
          const added = split ? row : row + deletions;
          if (deletions > 0) {
            changes.push({ kind: 'deletion', offset: at(row), extent: span(deletions) });
          }
          if (additions > 0) {
            changes.push({ kind: 'addition', offset: at(added), extent: span(additions) });
          }
          row += split ? Math.max(deletions, additions) : deletions + additions;
        }

        marks.push({
          fileId: item.id,
          path: item.fileDiff.name,
          index: position,
          offset: at(start),
          extent: span(count),
          changes,
          fileOffset: top / total,
          additions: hunk.additionLines,
          deletions: hunk.deletionLines,
          context: hunk.hunkContext ?? '',
        });
      });
    });

    return marks;
  };

  const viewport = (): Viewport => {
    const total = view.getScrollHeight();
    const height = view.getHeight();
    if (total <= 0 || height <= 0) return { offset: 0, extent: 1 };
    return { offset: view.getScrollTop() / total, extent: Math.min(height / total, 1) };
  };

  /** The inverse of `viewport`: put the top of the view at this fraction. */
  const scrollToOffset = (offset: number): void => {
    const total = view.getScrollHeight();
    if (total <= 0) return;
    view.scrollTo({ type: 'position', position: Math.min(Math.max(offset, 0), 1) * total });
  };

  const revealThread = (thread: Thread): void => {
    if (thread.stale || thread.lineNumber === 0) {
      revealFile(thread.fileId);
      return;
    }
    revealRange(thread.fileId, rangeFor(thread));
  };

  // The draft card stands directly under the line the gutter's plus belongs
  // to, and the library reads any point inside an annotation as that same
  // line: with the card in place, the first hundred pixels of a drag down the
  // handle go nowhere. Take it away for the length of the gesture — the range
  // it settles on opens it again, under whichever line it ended up. Capture,
  // because the library stops the press from propagating any further.
  disposer.add(
    on(
      root,
      'pointerdown',
      (event) => {
        const onHandle = event
          .composedPath()
          .some((node) => node instanceof Element && node.hasAttribute('data-utility-button'));
        if (onHandle) store.set({ composing: null });
      },
      { capture: true },
    ),
  );
  disposer.add(view.subscribeToScroll((top) => store.set({ scrollTop: top })));
  disposer.add(bus.on('file:payload', add));
  disposer.add(
    bus.on('manifest:ready', (manifest) => {
      order = manifest.files.map((file) => file.id);
      rank.clear();
      order.forEach((id, index) => rank.set(id, index));
      // The manifest lands twice, fetched and then off the stream. Starting
      // over is cheap: the flush walks past whatever is already in.
      cursor = 0;
      flush();
    }),
  );
  disposer.add(store.subscribe('fileState', flush));
  disposer.add(store.subscribe('stream', flush));
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
  // A jump to lines in another file names the file before the lines, so the
  // file is in the diff by the time the range is revealed.
  disposer.add(store.subscribe('singleFile', reshow));
  disposer.add(
    store.subscribe('selectedFile', () => {
      if (store.get().singleFile) reshow();
    }),
  );
  disposer.add(store.subscribe('view', applyOptions));
  disposer.add(store.subscribe('wrap', applyOptions));
  disposer.add(store.subscribe('coarse', applyOptions));
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
    hunks,
    jumpToHunk,
    viewport,
    scrollToOffset,
    destroy() {
      disposer.dispose();
      view.cleanUp();
    },
  };
};
