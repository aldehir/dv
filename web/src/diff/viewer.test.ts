import { CodeView } from '@pierre/diffs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Comment, FilePayload, Manifest } from '../api/types';
import type { Card, Thread } from '../comments/anchors';
import { draftFor, threadFor } from '../comments/anchors';
import type { CommentsStore } from '../comments/store';
import { createBus } from '../core/bus';
import { createInitialState, createStore } from '../core/store';
import type { AnnotationRenderer } from './options';
import type { Viewer } from './viewer';
import { createViewer } from './viewer';

class StubResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const patchFor = (path: string): string => `diff --git a/${path} b/${path}
index 1111111..2222222 100644
--- a/${path}
+++ b/${path}
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
`;

const payload = (id: string, path: string): FilePayload => ({
  id,
  path,
  status: 'modified',
  patch: patchFor(path),
  oldLines: ['const a = 1;', 'const b = 2;', 'const c = 4;'],
  newLines: ['const a = 1;', 'const b = 3;', 'const c = 4;'],
  binary: false,
  tooLarge: false,
  oldSha: `old-${id}`,
  newSha: `new-${id}`,
  oldSize: 40,
  newSize: 40,
  mode: { old: '100644', new: '100644' },
  submodule: false,
  symlink: false,
});

const manifest = (): Manifest => ({
  files: ['f1', 'f2', 'f3'].map((id, index) => ({
    id,
    path: `src/${id}.ts`,
    status: 'modified' as const,
    additions: 1,
    deletions: 1,
    binary: false,
    tooLarge: false,
    submodule: false,
    symlink: false,
    mode: { old: '100644', new: '100644' },
    oldSha: `o${index}`,
    newSha: `n${index}`,
  })),
  totals: { files: 3, additions: 3, deletions: 3 },
});

/** `edited` stands in for any later revision: it moves the annotation signature. */
const comment = (id: string, edited = false): Comment => ({
  id,
  author: { name: 'alde' },
  createdAt: '2026-07-26T18:00:00Z',
  updatedAt: `2026-07-26T18:00:0${edited ? 1 : 0}Z`,
  body: 'take a look',
  anchor: {
    path: 'src/f1.ts',
    prevPath: null,
    side: 'additions',
    startLine: 2,
    endLine: 2,
    blobSha: 'new-f1',
    quote: '',
    contextBefore: [],
    contextAfter: [],
  },
  resolvedAnchor: { stale: false, movedFrom: null },
  replies: [],
});

interface Bench {
  store: ReturnType<typeof createStore<ReturnType<typeof createInitialState>>>;
  bus: ReturnType<typeof createBus>;
  viewer: Viewer;
  root: HTMLElement;
  loadFile: ReturnType<typeof vi.fn>;
  setThreads(threads: Thread[]): void;
  view(): CodeView<Card[]>;
}

let instances: CodeView<Card[]>[] = [];

const bench = (): Bench => {
  const store = createStore(createInitialState());
  const bus = createBus();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const loadFile = vi.fn();
  let threads: Thread[] = [];
  const notify = new Set<() => void>();

  const comments = {
    start: vi.fn(),
    refresh: vi.fn(() => Promise.resolve()),
    threads: () => threads,
    threadsFor: (fileId: string) => threads.filter((thread) => thread.fileId === fileId),
    draft: () => '',
    setDraft: vi.fn(),
    error: () => null,
    create: vi.fn(() => Promise.resolve(null)),
    update: vi.fn(() => Promise.resolve(null)),
    remove: vi.fn(() => Promise.resolve(true)),
    reply: vi.fn(() => Promise.resolve(null)),
    subscribe: (listener: () => void) => {
      notify.add(listener);
      return () => notify.delete(listener);
    },
    destroy: vi.fn(),
  } satisfies CommentsStore;

  const viewer = createViewer({ store, bus, comments, root, loadFile });
  const created = instances.at(-1);
  if (!created) throw new Error('no CodeView was constructed');

  return {
    store,
    bus,
    viewer,
    root,
    loadFile,
    setThreads(next) {
      threads = next;
      for (const listener of [...notify]) listener();
    },
    view: () => created,
  };
};

/** The callback the diff uses to draw an annotation, as the viewer built it. */
const renderer = (harness: Bench) => {
  const setOptions = vi.spyOn(harness.view(), 'setOptions');
  harness.store.set({ wrap: !harness.store.get().wrap });
  const built = setOptions.mock.calls.at(-1)?.[0];
  setOptions.mockRestore();
  if (!built?.renderAnnotation) throw new Error('no renderAnnotation was built');
  // The view hands the callback an item handle the viewer has no use for.
  return built.renderAnnotation as AnnotationRenderer;
};

/** Draws the draft box for a range the way the diff would, attached. */
const drawDraft = (harness: Bench, id: string, range: Parameters<typeof draftFor>[1]) => {
  const element = renderer(harness)({
    side: 'additions',
    lineNumber: Math.max(range.start, range.end),
    metadata: [draftFor(id, range)],
  });
  if (!element) throw new Error('expected a draft box');
  document.body.appendChild(element);
  return element.querySelector('textarea');
};

const ids = (view: CodeView<Card[]>): string[] => {
  const found: string[] = [];
  for (const id of ['f1', 'f2', 'f3']) if (view.getItem(id)) found.push(id);
  return found;
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  instances = [];
  const original = CodeView.prototype.setup;
  vi.spyOn(CodeView.prototype, 'setup').mockImplementation(function setup(
    this: CodeView<Card[]>,
    node: HTMLElement,
  ) {
    instances.push(this);
    original.call(this, node);
  });
});

describe('createViewer', () => {
  it('appends streamed payloads in manifest order', () => {
    const it0 = bench();
    it0.bus.emit('manifest:ready', manifest());
    it0.bus.emit('file:payload', payload('f3', 'src/f3.ts'));
    it0.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    it0.bus.emit('file:payload', payload('f2', 'src/f2.ts'));

    expect(ids(it0.view())).toEqual(['f1', 'f2', 'f3']);
    expect(it0.view().getTopForItem('f1')).toBeLessThanOrEqual(
      it0.view().getTopForItem('f3') ?? Number.NaN,
    );
    it0.viewer.destroy();
  });

  it('enables expansion by attaching the full contents', () => {
    const harness = bench();
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    const item = harness.view().getItem('f1');
    if (item?.type !== 'diff') throw new Error('expected a diff item');

    expect(item.fileDiff.isPartial).toBe(false);
    expect(item.fileDiff.cacheKey).toBe('dv:f1:old-f1:new-f1');
    harness.viewer.destroy();
  });

  it('bumps the version on every published change', () => {
    const harness = bench();
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    expect(harness.view().getItem('f1')?.version).toBe(0);

    harness.setThreads([threadFor('f1', comment('c1'))]);
    expect(harness.view().getItem('f1')?.version).toBe(1);
    expect(harness.view().getItem('f1')?.annotations?.length).toBe(1);

    harness.setThreads([threadFor('f1', comment('c1', true))]);
    expect(harness.view().getItem('f1')?.version).toBe(2);

    harness.viewer.updateItem('f1', { collapsed: true });
    expect(harness.view().getItem('f1')?.version).toBe(3);
    expect(harness.view().getItem('f1')?.collapsed).toBe(true);
    harness.viewer.destroy();
  });

  it('leaves the item alone when the annotations have not changed', () => {
    const harness = bench();
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    harness.setThreads([threadFor('f1', comment('c1'))]);
    const version = harness.view().getItem('f1')?.version;

    harness.viewer.refreshAnnotations();
    harness.setThreads([threadFor('f1', comment('c1'))]);

    expect(harness.view().getItem('f1')?.version).toBe(version);
    harness.viewer.destroy();
  });

  it('hangs a draft box under the settled selection', () => {
    const harness = bench();
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    harness.store.set({ commentsEnabled: true });
    const range = { start: 2, end: 2, side: 'additions' as const };

    harness.store.set({ composing: { id: 'f1', range } });
    const annotations = harness.view().getItem('f1')?.annotations ?? [];
    expect(annotations.length).toBe(1);
    expect(annotations[0]?.metadata?.map((card) => card.kind)).toEqual(['draft']);

    harness.store.set({ composing: null });
    expect(harness.view().getItem('f1')?.annotations?.length).toBe(0);
    harness.viewer.destroy();
  });

  it('leaves the range alone when a comment already covers it', () => {
    const harness = bench();
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    harness.store.set({ commentsEnabled: true });
    harness.setThreads([threadFor('f1', comment('c1'))]);

    // The inbox jumps here by selecting the comment's own lines.
    harness.store.set({ composing: { id: 'f1', range: { start: 2, end: 2 } } });
    const covered = harness.view().getItem('f1')?.annotations ?? [];
    expect(covered[0]?.metadata?.map((card) => card.kind)).toEqual(['thread']);

    harness.store.set({ composing: { id: 'f1', range: { start: 1, end: 2 } } });
    const wider = harness.view().getItem('f1')?.annotations ?? [];
    expect(wider[0]?.metadata?.map((card) => card.kind)).toEqual(['thread', 'draft']);
    harness.viewer.destroy();
  });

  it('puts the caret in the draft box once the diff draws it', async () => {
    const harness = bench();
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    harness.store.set({ commentsEnabled: true });
    const range = { start: 2, end: 2, side: 'additions' as const };

    harness.store.set({ composing: { id: 'f1', range } });
    const input = drawDraft(harness, 'f1', range);
    // The diff hangs the box in the DOM after asking for it, so the focus waits.
    await Promise.resolve();

    expect(document.activeElement).toBe(input);
    harness.viewer.destroy();
  });

  it('leaves a box drawn for another range alone', async () => {
    const harness = bench();
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    harness.store.set({ commentsEnabled: true });
    const range = { start: 2, end: 2, side: 'additions' as const };

    harness.store.set({ composing: { id: 'f1', range } });
    const input = drawDraft(harness, 'f1', range);
    await Promise.resolve();
    input?.blur();

    harness.store.set({ composing: { id: 'f1', range: { ...range, start: 1 } } });
    await Promise.resolve();

    expect(document.activeElement).not.toBe(input);
    harness.viewer.destroy();
  });

  it('keeps the draft box out of a diff with comments turned off', () => {
    const harness = bench();
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));

    harness.store.set({ composing: { id: 'f1', range: { start: 2, end: 2 } } });

    expect(harness.view().getItem('f1')?.annotations?.length).toBe(0);
    harness.viewer.destroy();
  });

  it('republishes a payload that arrives twice', () => {
    const harness = bench();
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    expect(harness.view().getItem('f1')?.version).toBe(1);
    expect(ids(harness.view())).toEqual(['f1']);
    harness.viewer.destroy();
  });

  it('reconfigures in place on a view, wrap or theme change', () => {
    const harness = bench();
    const setOptions = vi.spyOn(harness.view(), 'setOptions');
    const onThemeChange = vi.spyOn(harness.view(), 'onThemeChange');

    harness.store.set({ view: 'unified' });
    harness.store.set({ wrap: true });
    harness.bus.emit('theme:changed', { pref: 'latte', flavor: 'latte' });

    expect(setOptions).toHaveBeenCalledTimes(3);
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(setOptions.mock.calls.at(0)?.[0]?.diffStyle).toBe('unified');
    expect(setOptions.mock.calls.at(1)?.[0]?.overflow).toBe('wrap');
    harness.viewer.destroy();
  });

  it('requests a payload and reveals the file on selection', () => {
    const harness = bench();
    const scrollTo = vi.spyOn(harness.view(), 'scrollTo');
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));

    harness.bus.emit('file:selected', { id: 'f1', reveal: true });
    expect(harness.loadFile).toHaveBeenCalledWith('f1');
    expect(scrollTo).toHaveBeenCalledWith({ type: 'item', id: 'f1', align: 'start' });
    harness.viewer.destroy();
  });

  it('defers a reveal until the payload lands', () => {
    const harness = bench();
    harness.bus.emit('file:selected', { id: 'f1', reveal: true });
    const scrollTo = vi.spyOn(harness.view(), 'scrollTo');

    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    expect(scrollTo).toHaveBeenCalledWith({ type: 'item', id: 'f1', align: 'start' });
    harness.viewer.destroy();
  });

  it('reveals a deep-linked range and mirrors it into the viewer selection', () => {
    const harness = bench();
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    const range = { start: 1, end: 2, side: 'additions' as const };

    harness.store.set({ selection: { id: 'f1', range } });

    expect(harness.view().getSelectedLines()?.id).toBe('f1');
    expect(harness.view().getSelectedLines()?.range.start).toBe(1);
    harness.viewer.destroy();
  });

  it('scrolls to a thread anchor and to the file for a stale one', () => {
    const harness = bench();
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    const scrollTo = vi.spyOn(harness.view(), 'scrollTo');

    harness.viewer.revealThread(threadFor('f1', comment('c1')));
    expect(scrollTo).toHaveBeenLastCalledWith({
      type: 'range',
      id: 'f1',
      range: { start: 2, end: 2, side: 'additions', endSide: 'additions' },
      align: 'center',
    });

    const stale = threadFor('f1', {
      ...comment('c2'),
      resolvedAnchor: { stale: true, movedFrom: null },
    });
    harness.viewer.revealThread(stale);
    expect(scrollTo).toHaveBeenLastCalledWith({ type: 'item', id: 'f1', align: 'start' });
    harness.viewer.destroy();
  });

  it('steps through hunks of the selected file', () => {
    const harness = bench();
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    harness.store.set({ selectedFile: 'f1' });
    const scrollTo = vi.spyOn(harness.view(), 'scrollTo');

    harness.bus.emit('hunk:step', { delta: 1 });
    expect(scrollTo).toHaveBeenLastCalledWith({
      type: 'line',
      id: 'f1',
      lineNumber: 1,
      side: 'additions',
      align: 'start',
    });
    harness.viewer.destroy();
  });

  /** jsdom lays nothing out, so the measurements the rail reads are staged. */
  const measured = (harness: Bench, tops: Record<string, number>, total = 1000): void => {
    vi.spyOn(harness.view(), 'getScrollHeight').mockReturnValue(total);
    vi.spyOn(harness.view(), 'getTopForItem').mockImplementation((id: string) => tops[id]);
  };

  it('places a hunk tick inside the band of its own file', () => {
    const harness = bench();
    harness.bus.emit('manifest:ready', manifest());
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    harness.bus.emit('file:payload', payload('f2', 'src/f2.ts'));
    measured(harness, { f1: 0, f2: 400 });

    expect(harness.viewer.hunks()).toEqual([
      {
        fileId: 'f1',
        path: 'src/f1.ts',
        index: 0,
        offset: 0,
        fileOffset: 0,
        additions: 1,
        deletions: 1,
        context: '',
      },
      {
        fileId: 'f2',
        path: 'src/f2.ts',
        index: 0,
        offset: 0.4,
        fileOffset: 0.4,
        additions: 1,
        deletions: 1,
        context: '',
      },
    ]);
    harness.viewer.destroy();
  });

  it('has no ticks until the scroll has a height', () => {
    const harness = bench();
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    measured(harness, { f1: 0 }, 0);

    expect(harness.viewer.hunks()).toEqual([]);
    harness.viewer.destroy();
  });

  it('jumps to the hunk a tick stands for', () => {
    const harness = bench();
    harness.bus.emit('manifest:ready', manifest());
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    harness.bus.emit('file:payload', payload('f2', 'src/f2.ts'));
    measured(harness, { f1: 0, f2: 400 });
    const mark = harness.viewer.hunks()[1];
    if (!mark) throw new Error('expected a tick for f2');
    const scrollTo = vi.spyOn(harness.view(), 'scrollTo');

    harness.viewer.jumpToHunk(mark);

    expect(scrollTo).toHaveBeenLastCalledWith({
      type: 'line',
      id: 'f2',
      lineNumber: 1,
      side: 'additions',
      align: 'start',
    });
    harness.viewer.destroy();
  });

  it('reports the viewport as fractions of the scroll height', () => {
    const harness = bench();
    expect(harness.viewer.viewport()).toEqual({ offset: 0, extent: 1 });

    vi.spyOn(harness.view(), 'getScrollHeight').mockReturnValue(1000);
    vi.spyOn(harness.view(), 'getHeight').mockReturnValue(250);
    vi.spyOn(harness.view(), 'getScrollTop').mockReturnValue(500);

    expect(harness.viewer.viewport()).toEqual({ offset: 0.5, extent: 0.25 });
    harness.viewer.destroy();
  });

  it('reports which items it holds', () => {
    const harness = bench();
    expect(harness.viewer.has('f1')).toBe(false);
    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    expect(harness.viewer.has('f1')).toBe(true);
    expect(harness.viewer.updateItem('missing', { collapsed: true })).toBe(false);
    harness.viewer.destroy();
  });

  it('tears down every subscription and the code view', () => {
    const harness = bench();
    const cleanUp = vi.spyOn(harness.view(), 'cleanUp');
    harness.viewer.destroy();

    harness.bus.emit('file:payload', payload('f1', 'src/f1.ts'));
    harness.store.set({ view: 'unified' });

    expect(cleanUp).toHaveBeenCalledTimes(1);
    expect(harness.viewer.has('f1')).toBe(false);
  });
});
