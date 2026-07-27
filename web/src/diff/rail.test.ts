import { describe, expect, it, vi } from 'vitest';
import type { FilePayload } from '../api/types';
import type { CommentsStore } from '../comments/store';
import { createBus } from '../core/bus';
import { createInitialState, createStore } from '../core/store';
import { createRail } from './rail';
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

/** The rail only ever reads the payload as a redraw signal. */
const payload = { id: 'f1' } as FilePayload;

/** jsdom lays nothing out, so the rail is told what its own box measures. */
const TRACK = 400;

const rect = (top: number, height: number): DOMRect =>
  ({ top, height, bottom: top + height }) as DOMRect;

/** jsdom has no PointerEvent; the rail only ever reads the mouse half of one. */
const point = (type: string, clientY: number, target: EventTarget): void => {
  target.dispatchEvent(new MouseEvent(type, { clientY, bubbles: true, cancelable: true }));
};

const setup = () => {
  const store = createStore(createInitialState());
  const bus = createBus();
  const notify = new Set<() => void>();
  let marks: HunkMark[] = [];
  let port: Viewport = { offset: 0, extent: 0.5 };

  const jumpToHunk = vi.fn();
  const scrollToOffset = vi.fn();
  const viewer = {
    hunks: () => marks,
    viewport: () => port,
    jumpToHunk,
    scrollToOffset,
  } as unknown as Viewer;

  const comments = {
    subscribe: (listener: () => void) => {
      notify.add(listener);
      return () => notify.delete(listener);
    },
  } as unknown as CommentsStore;

  const scroller = document.createElement('div');
  const rail = createRail({ store, bus, comments, viewer, scroller });

  return {
    store,
    bus,
    rail,
    scroller,
    jumpToHunk,
    scrollToOffset,
    /** Stages the layout the pointer is aimed at: a track of TRACK px from 0. */
    measure() {
      rail.el.getBoundingClientRect = () => rect(0, TRACK);
      const box = rail.el.querySelector<HTMLElement>('.dv-rail__view');
      if (box) box.getBoundingClientRect = () => rect(port.offset * TRACK, port.extent * TRACK);
    },
    /** Stages what the viewer reports; nothing is drawn until a trigger fires. */
    stage(next: HunkMark[], viewport?: Viewport) {
      marks = next;
      if (viewport) port = viewport;
    },
    draw(next: HunkMark[], viewport?: Viewport) {
      this.stage(next, viewport);
      rail.update();
    },
    touchComments() {
      for (const listener of [...notify]) listener();
    },
    ticks: () => [...rail.el.querySelectorAll<HTMLElement>('.dv-rail__tick')],
    seams: () => [...rail.el.querySelectorAll<HTMLElement>('.dv-rail__seam')],
    box: () => rail.el.querySelector<HTMLElement>('.dv-rail__view'),
  };
};

describe('createRail', () => {
  it('stays hidden while the diff has no hunks', () => {
    const it0 = setup();

    expect(it0.rail.el.hidden).toBe(true);
    expect(it0.ticks()).toHaveLength(0);
    it0.rail.destroy();
  });

  it('draws a tick per hunk at its share of the scroll height', () => {
    const it0 = setup();
    it0.draw([mark('f1', 0, 0), mark('f1', 1, 0.25, { fileOffset: 0 })]);

    expect(it0.rail.el.hidden).toBe(false);
    expect(it0.ticks().map((tick) => tick.style.top)).toEqual(['0%', '25%']);
    it0.rail.destroy();
  });

  it('colors a tick by whichever side it mostly touches', () => {
    const it0 = setup();
    it0.draw([
      mark('f1', 0, 0, { additions: 9, deletions: 1 }),
      mark('f1', 1, 0.5, { additions: 0, deletions: 6 }),
    ]);

    expect(it0.ticks().map((tick) => tick.className)).toEqual([
      'dv-rail__tick dv-rail__tick--add',
      'dv-rail__tick dv-rail__tick--del',
    ]);
    it0.rail.destroy();
  });

  it('seams every file boundary but the top of the rail', () => {
    const it0 = setup();
    it0.draw([mark('f1', 0, 0), mark('f1', 1, 0.2, { fileOffset: 0 }), mark('f2', 0, 0.6)]);

    expect(it0.seams().map((seam) => seam.style.top)).toEqual(['60%']);
    it0.rail.destroy();
  });

  it('names the file, the context and the counts in the tick title', () => {
    const it0 = setup();
    it0.draw([mark('f1', 0, 0, { context: 'createViewer', additions: 12, deletions: 3 })]);

    expect(it0.ticks()[0]?.title).toBe('src/f1.ts · createViewer  +12 -3');
    it0.rail.destroy();
  });

  it('jumps to the clicked hunk and follows it with the selection', () => {
    const it0 = setup();
    const target = mark('f2', 1, 0.7);
    it0.draw([mark('f1', 0, 0), target]);

    it0.ticks()[1]?.click();

    expect(it0.jumpToHunk).toHaveBeenCalledWith(target);
    expect(it0.store.get().selectedFile).toBe('f2');
    it0.rail.destroy();
  });

  it('tracks the viewport box against the scroll', () => {
    const it0 = setup();
    it0.draw([mark('f1', 0, 0)], { offset: 0.4, extent: 0.2 });
    it0.stage([mark('f1', 0, 0)], { offset: 0.75, extent: 0.2 });
    it0.store.set({ scrollTop: 800 });

    expect(it0.box()?.style.top).toBe('75%');
    expect(it0.box()?.style.height).toBe('20%');
    it0.rail.destroy();
  });

  it('scrolls with the box the pointer drags, holding where it took hold', () => {
    const it0 = setup();
    it0.draw([mark('f1', 0, 0)], { offset: 0.25, extent: 0.5 });
    it0.measure();

    // Held 20px down a box that starts at 100px, then dragged to 150px.
    point('pointerdown', 120, it0.rail.el);
    expect(it0.scrollToOffset).not.toHaveBeenCalled();

    point('pointermove', 170, window);
    expect(it0.scrollToOffset).toHaveBeenLastCalledWith(0.375);

    point('pointerup', 170, window);
    point('pointermove', 300, window);
    expect(it0.scrollToOffset).toHaveBeenCalledTimes(1);
    it0.rail.destroy();
  });

  it('sends the box to a press on the track, then drags from there', () => {
    const it0 = setup();
    it0.draw([mark('f1', 0, 0)], { offset: 0, extent: 0.25 });
    it0.measure();

    // A press at 300px centers a 100px box on it: top 250px of a 400px track.
    point('pointerdown', 300, it0.rail.el);
    expect(it0.scrollToOffset).toHaveBeenLastCalledWith(0.625);

    point('pointermove', 340, window);
    expect(it0.scrollToOffset).toHaveBeenLastCalledWith(0.725);
    point('pointerup', 340, window);
    it0.rail.destroy();
  });

  it('leaves a press on a tick to the jump the tick already makes', () => {
    const it0 = setup();
    const target = mark('f1', 1, 0.5);
    it0.draw([mark('f1', 0, 0), target], { offset: 0, extent: 0.25 });
    it0.measure();

    const tick = it0.ticks()[1];
    if (!tick) throw new Error('expected a tick to press');

    point('pointerdown', 200, tick);
    // Nothing the hand does holding still counts as a drag.
    point('pointermove', 202, window);
    point('pointerup', 202, window);
    tick.click();

    expect(it0.scrollToOffset).not.toHaveBeenCalled();
    expect(it0.jumpToHunk).toHaveBeenCalledWith(target);
    it0.rail.destroy();
  });

  it('drags off a tick the pointer only meant to take hold of', () => {
    const it0 = setup();
    const target = mark('f1', 1, 0.5);
    it0.draw([mark('f1', 0, 0), target], { offset: 0.25, extent: 0.5 });
    it0.measure();

    const tick = it0.ticks()[1];
    if (!tick) throw new Error('expected a tick to press');

    // Held 100px into a box that starts at 100px, then dragged 60px down.
    point('pointerdown', 200, tick);
    point('pointermove', 260, window);
    point('pointerup', 260, window);
    tick.click();

    expect(it0.scrollToOffset).toHaveBeenLastCalledWith(0.4);
    expect(it0.jumpToHunk).not.toHaveBeenCalled();
    it0.rail.destroy();
  });

  it('rolls the wheel over the rail into the diff', () => {
    const it0 = setup();
    it0.draw([mark('f1', 0, 0)]);

    it0.rail.el.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, cancelable: true }));

    expect(it0.scroller.scrollTop).toBe(120);
    it0.rail.destroy();
  });

  it('drops the drag it is holding when destroyed', () => {
    const it0 = setup();
    it0.draw([mark('f1', 0, 0)], { offset: 0.25, extent: 0.5 });
    it0.measure();

    point('pointerdown', 120, it0.rail.el);
    it0.rail.destroy();

    point('pointermove', 170, window);
    expect(it0.scrollToOffset).not.toHaveBeenCalled();
  });

  it('redraws when payloads land, the view flips or cards resize the items', () => {
    const it0 = setup();

    it0.stage([mark('f1', 0, 0)]);
    it0.bus.emit('file:payload', payload);
    expect(it0.ticks()).toHaveLength(1);

    it0.stage([mark('f1', 0, 0), mark('f2', 0, 0.5)]);
    it0.store.set({ view: 'unified' });
    expect(it0.ticks()).toHaveLength(2);

    it0.stage([mark('f1', 0, 0)]);
    it0.store.set({ wrap: true });
    expect(it0.ticks()).toHaveLength(1);

    it0.stage([]);
    it0.touchComments();
    expect(it0.rail.el.hidden).toBe(true);
    it0.rail.destroy();
  });

  it('stops redrawing once destroyed', () => {
    const it0 = setup();
    it0.draw([mark('f1', 0, 0)]);
    it0.rail.destroy();

    it0.stage([]);
    it0.bus.emit('file:payload', payload);
    it0.store.set({ wrap: true });
    it0.touchComments();

    expect(it0.ticks()).toHaveLength(1);
  });
});
