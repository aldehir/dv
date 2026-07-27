import type { CommentsStore } from '../comments/store';
import type { Bus } from '../core/bus';
import type { Component, Unsubscribe } from '../core/component';
import { createDisposer } from '../core/component';
import { clear, el, frag, on } from '../core/dom';
import type { AppStore } from '../core/store';
import type { HunkMark, Viewer } from './viewer';
import { wheelDelta } from './wheel';

export interface RailDeps {
  store: AppStore;
  bus: Bus;
  comments: CommentsStore;
  viewer: Viewer;
  /** The scroller the rail stands for, so the wheel works over it too. */
  scroller: HTMLElement;
}

/** How far a press has to travel before it is a drag rather than a click. */
const DEAD_ZONE = 3;

const percent = (fraction: number): string =>
  `${(Math.min(Math.max(fraction, 0), 1) * 100).toFixed(3)}%`;

/** Green when the hunk mostly adds, red when it mostly removes. */
const weight = (mark: HunkMark): string => (mark.additions >= mark.deletions ? 'add' : 'del');

const label = (mark: HunkMark): string => {
  const where = mark.context === '' ? mark.path : `${mark.path} · ${mark.context}`;
  return `${where}  +${mark.additions} -${mark.deletions}`;
};

export const createRail = ({
  store,
  bus,
  comments,
  viewer,
  scroller,
}: RailDeps): Component<void> => {
  const disposer = createDisposer();
  let marks: HunkMark[] = [];
  /** Where inside the box the drag took hold, in px; null when nothing is held. */
  let grab: number | null = null;
  let origin = 0;
  let dragged = false;
  let gesture: Unsubscribe | null = null;

  const ticks = el('div', { class: 'dv-rail__ticks' });
  const box = el('div', { class: 'dv-rail__view' });
  // The box sits under the ticks, so the hunks it covers stay both readable
  // and clickable — those are the ones the reader is closest to.
  const root = el('div', { class: 'dv-rail', hidden: true }, box, ticks);

  const seam = (mark: HunkMark): HTMLElement => {
    const node = el('div', { class: 'dv-rail__seam' });
    node.style.top = percent(mark.fileOffset);
    return node;
  };

  const tick = (mark: HunkMark, position: number): HTMLElement => {
    const node = el('button', {
      class: `dv-rail__tick dv-rail__tick--${weight(mark)}`,
      type: 'button',
      title: label(mark),
      data: { hunk: String(position) },
    });
    node.style.top = percent(mark.offset);
    return node;
  };

  const syncViewport = (): void => {
    const { offset, extent } = viewer.viewport();
    box.style.top = percent(offset);
    box.style.height = percent(extent);
  };

  const render = (): void => {
    marks = viewer.hunks();
    root.hidden = marks.length === 0;

    clear(ticks);
    // The first file needs no seam: the top of the rail already is its edge.
    const seams = marks.filter((mark, position) => mark.index === 0 && position > 0).map(seam);
    ticks.appendChild(frag(...seams, ...marks.map(tick)));

    syncViewport();
  };

  const jump = (mark: HunkMark): void => {
    if (store.get().selectedFile !== mark.fileId) store.set({ selectedFile: mark.fileId });
    viewer.jumpToHunk(mark);
  };

  /** The scroll offset that leaves the box hanging where the pointer holds it. */
  const offsetUnder = (clientY: number, hold: number): number => {
    const track = root.getBoundingClientRect();
    if (track.height <= 0) return 0;
    return (clientY - hold - track.top) / track.height;
  };

  const dragTo = (clientY: number): void => {
    if (grab === null) return;
    dragged = true;
    viewer.scrollToOffset(offsetUnder(clientY, grab));
  };

  /** Under the dead zone the press is still a click, and clicks belong to ticks. */
  const moveDrag = (event: PointerEvent): void => {
    if (dragged || Math.abs(event.clientY - origin) >= DEAD_ZONE) dragTo(event.clientY);
  };

  const endDrag = (): void => {
    grab = null;
    delete root.dataset.dragging;
    gesture?.();
    gesture = null;
  };

  /** Press the box to drag it, press the track to send it there first. */
  const startDrag = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    endDrag();
    const target = event.target;
    const onTick = target instanceof HTMLElement && target.closest('[data-hunk]') !== null;

    const thumb = box.getBoundingClientRect();
    const held = event.clientY >= thumb.top && event.clientY <= thumb.bottom;
    grab = held ? event.clientY - thumb.top : thumb.height / 2;
    origin = event.clientY;
    dragged = false;
    root.dataset.dragging = 'true';
    // Ticks are buttons and want the press; everywhere else it only starts a drag.
    if (!onTick) event.preventDefault();

    // The pointer leaves the rail the moment the drag wanders sideways, so the
    // rest of the gesture belongs to the window.
    const moves = createDisposer();
    moves.add(on(window, 'pointermove', moveDrag));
    moves.add(on(window, 'pointerup', endDrag));
    moves.add(on(window, 'pointercancel', endDrag));
    gesture = moves.dispose;

    // Bare track under the pointer: send the box there and carry on from inside
    // it. A tick waits to see whether the press is its click or a drag.
    if (!held && !onTick) dragTo(event.clientY);
  };

  disposer.add(on(root, 'pointerdown', startDrag));
  disposer.add(endDrag);
  // A scrollbar scrolls under the wheel, and the rail stands where the diff's
  // own scrollbar used to: the delta belongs to the diff, not to nothing.
  disposer.add(
    on(
      root,
      'wheel',
      (event) => {
        // Pinch zoom rides in on the wheel with ctrlKey set; leave it alone.
        if (event.ctrlKey) return;
        const delta = wheelDelta(event, scroller.clientHeight);
        if (delta === 0) return;
        scroller.scrollTop += delta;
        event.preventDefault();
      },
      { passive: false },
    ),
  );
  disposer.add(
    on(root, 'click', (event) => {
      const target = event.target;
      // A drag that came to rest on a tick is not a click on it.
      if (dragged || !(target instanceof HTMLElement)) return;
      const position = target.closest<HTMLElement>('[data-hunk]')?.dataset.hunk;
      const mark = position === undefined ? undefined : marks[Number(position)];
      if (mark) jump(mark);
    }),
  );
  disposer.add(bus.on('file:payload', render));
  disposer.add(bus.on('manifest:ready', render));
  disposer.add(store.subscribe('view', render));
  disposer.add(store.subscribe('wrap', render));
  disposer.add(store.subscribe('scrollTop', syncViewport));
  // Cards change the height of the items the ticks are placed inside.
  disposer.add(comments.subscribe(render));
  disposer.add(on(window, 'resize', render));

  render();

  return { el: root, update: render, destroy: disposer.dispose };
};
