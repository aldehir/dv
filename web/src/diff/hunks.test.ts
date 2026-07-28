import { describe, expect, it, vi } from 'vitest';
import type { FilePayload } from '../api/types';
import type { CommentsStore } from '../comments/store';
import { createBus } from '../core/bus';
import { createInitialState, createStore } from '../core/store';
import { createHunkList } from './hunks';
import type { HunkMark, Viewer, Viewport } from './viewer';

const mark = (
  fileId: string,
  index: number,
  offset: number,
  extra: Partial<HunkMark> = {},
): HunkMark => ({
  fileId,
  path: `src/${fileId}.ts`,
  index,
  offset,
  fileOffset: offset,
  additions: 4,
  deletions: 1,
  context: '',
  ...extra,
});

/** The list only ever reads the payload as a redraw signal. */
const payload = { id: 'f1' } as FilePayload;

const setup = () => {
  const store = createStore(createInitialState());
  const bus = createBus();
  const notify = new Set<() => void>();
  let marks: HunkMark[] = [];
  // A fifth of the diff on screen: far enough from the end that a scroll into
  // the middle is read as a position rather than as the bottom.
  let port: Viewport = { offset: 0, extent: 0.2 };

  const jumpToHunk = vi.fn();
  const viewer = {
    hunks: () => marks,
    viewport: () => port,
    jumpToHunk,
  } as unknown as Viewer;

  const comments = {
    subscribe: (listener: () => void) => {
      notify.add(listener);
      return () => notify.delete(listener);
    },
  } as unknown as CommentsStore;

  const list = createHunkList({ store, bus, comments, viewer });
  // The list only draws while the panel is showing it, which is where every
  // test but the one about that starts.
  store.set({ panelVisible: true, panelView: 'hunks' });

  return {
    store,
    bus,
    list,
    jumpToHunk,
    /** Stages what the viewer reports; nothing is drawn until a trigger fires. */
    stage(next: HunkMark[], viewport?: Viewport) {
      marks = next;
      if (viewport) port = viewport;
    },
    draw(next: HunkMark[], viewport?: Viewport) {
      this.stage(next, viewport);
      list.update();
    },
    /** Moves the view without redrawing, the way a scroll does. */
    scrollTo(offset: number) {
      port = { ...port, offset };
      store.set({ scrollTop: offset * 1000 });
    },
    touchComments() {
      for (const listener of [...notify]) listener();
    },
    meta: () => list.el.querySelector('.dv-hunks__meta')?.textContent,
    files: () => [...list.el.querySelectorAll<HTMLElement>('.dv-hunks__file')],
    rows: () => [...list.el.querySelectorAll<HTMLElement>('.dv-hunks__row')],
    current: () =>
      list.el.querySelector<HTMLElement>('.dv-hunks__row[aria-current="true"]')?.dataset.hunk,
  };
};

describe('createHunkList', () => {
  it('says so while the diff has no hunks', () => {
    const it0 = setup();

    expect(it0.meta()).toBe('No hunks yet');
    expect(it0.rows()).toHaveLength(0);
    it0.list.destroy();
  });

  it('groups the hunks under the file each one is in', () => {
    const it0 = setup();
    it0.draw([
      mark('f1', 0, 0, { context: 'createDock()' }),
      mark('f1', 1, 0.2),
      mark('f2', 0, 0.6, { path: 'src/f2.ts', additions: 0, deletions: 9 }),
    ]);

    expect(it0.meta()).toBe('3 hunks · 2 files');
    expect(it0.files().map((node) => node.textContent)).toEqual(['f1.ts2', 'f2.ts1']);

    const rows = it0.rows();
    // A hunk git found no name for is numbered inside its own file, not the list.
    expect(rows.map((node) => node.textContent)).toEqual([
      'createDock()+4-1',
      'hunk 2+4-1',
      'hunk 1+0-9',
    ]);
    it0.list.destroy();
  });

  it('jumps to the hunk a row stands for', () => {
    const it0 = setup();
    const marks = [mark('f1', 0, 0), mark('f2', 3, 0.6, { path: 'src/f2.ts' })];
    it0.draw(marks);

    it0.rows()[1]?.click();

    expect(it0.jumpToHunk).toHaveBeenCalledWith(marks[1]);
    // Jumping into another file is also how that file becomes the selected one.
    expect(it0.store.get().selectedFile).toBe('f2');
    it0.list.destroy();
  });

  it('opens the file a heading stands for', () => {
    const it0 = setup();
    const selected = vi.fn();
    it0.bus.on('file:selected', selected);
    it0.draw([mark('f1', 0, 0), mark('f2', 0, 0.6, { path: 'src/f2.ts' })]);

    it0.files()[1]?.click();

    expect(selected).toHaveBeenCalledWith({ id: 'f2', reveal: true });
    expect(it0.store.get().selectedFile).toBe('f2');
    it0.list.destroy();
  });

  it('marks the hunk the top of the view is inside', () => {
    const it0 = setup();
    it0.draw([mark('f1', 0, 0), mark('f1', 1, 0.3), mark('f2', 0, 0.7, { path: 'src/f2.ts' })]);

    expect(it0.current()).toBe('0');

    it0.scrollTo(0.5);
    expect(it0.current()).toBe('1');

    // Landing a hair short of a jump's target still counts as arriving on it.
    it0.scrollTo(0.6995);
    expect(it0.current()).toBe('2');
    it0.list.destroy();
  });

  it('marks the last hunk once the scroll has nowhere left to go', () => {
    const it0 = setup();
    // The bottom of the scroll leaves the last hunk mid-screen, never at the top.
    it0.draw([mark('f1', 0, 0), mark('f1', 1, 0.8), mark('f1', 2, 0.95)], {
      offset: 0.5,
      extent: 0.5,
    });

    expect(it0.current()).toBe('2');
    it0.list.destroy();
  });

  it('marks the first hunk when the whole diff is on screen', () => {
    const it0 = setup();
    it0.draw([mark('f1', 0, 0.1), mark('f1', 1, 0.6)], { offset: 0, extent: 1 });

    expect(it0.current()).toBe('0');
    it0.list.destroy();
  });

  it('redraws when a payload, a view change, or a card lands', () => {
    const triggers = [
      (it0: ReturnType<typeof setup>) => it0.bus.emit('file:payload', payload),
      (it0: ReturnType<typeof setup>) => it0.store.set({ view: 'unified' }),
      (it0: ReturnType<typeof setup>) => it0.touchComments(),
    ];

    for (const trigger of triggers) {
      const it0 = setup();
      it0.stage([mark('f1', 0, 0), mark('f1', 1, 0.5)]);
      expect(it0.rows()).toHaveLength(0);

      trigger(it0);

      expect(it0.rows()).toHaveLength(2);
      it0.list.destroy();
    }
  });

  it('draws nothing until the panel is showing it', () => {
    const it0 = setup();
    it0.store.set({ panelVisible: false });

    it0.stage([mark('f1', 0, 0), mark('f1', 1, 0.5)]);
    it0.bus.emit('file:payload', payload);
    expect(it0.rows()).toHaveLength(0);

    it0.store.set({ panelVisible: true });
    expect(it0.rows()).toHaveLength(2);

    // The inbox taking the panel is the same as it being closed.
    it0.stage([mark('f1', 0, 0)]);
    it0.store.set({ panelView: 'comments' });
    expect(it0.rows()).toHaveLength(2);
    it0.list.destroy();
  });

  it('drops every subscription on destroy', () => {
    const it0 = setup();
    it0.draw([mark('f1', 0, 0)]);
    it0.list.destroy();

    it0.stage([mark('f1', 0, 0), mark('f1', 1, 0.5)]);
    it0.bus.emit('file:payload', payload);
    it0.touchComments();

    expect(it0.rows()).toHaveLength(1);
  });
});
