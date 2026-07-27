import { CodeView } from '@pierre/diffs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Comment, FilePayload, Manifest } from '../api/types';
import type { Thread } from '../comments/anchors';
import { threadFor } from '../comments/anchors';
import type { CommentsStore } from '../comments/store';
import { createBus } from '../core/bus';
import { createInitialState, createStore } from '../core/store';
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

const comment = (id: string, status: Comment['status'] = 'open'): Comment => ({
  id,
  status,
  author: { name: 'alde' },
  createdAt: '2026-07-26T18:00:00Z',
  updatedAt: `2026-07-26T18:00:0${status === 'open' ? 0 : 1}Z`,
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
  view(): CodeView<Thread[]>;
}

let instances: CodeView<Thread[]>[] = [];

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
    compose: () => null,
    setCompose: vi.fn(),
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

const ids = (view: CodeView<Thread[]>): string[] => {
  const found: string[] = [];
  for (const id of ['f1', 'f2', 'f3']) if (view.getItem(id)) found.push(id);
  return found;
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  instances = [];
  const original = CodeView.prototype.setup;
  vi.spyOn(CodeView.prototype, 'setup').mockImplementation(function setup(
    this: CodeView<Thread[]>,
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

    harness.setThreads([threadFor('f1', comment('c1', 'resolved'))]);
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
