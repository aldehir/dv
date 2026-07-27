import type { CommentsStore } from '../comments/store';
import type { Bus } from '../core/bus';
import type { Component } from '../core/component';
import { createDisposer } from '../core/component';
import { clear, el, frag, on } from '../core/dom';
import type { AppStore } from '../core/store';
import type { HunkMark, Viewer } from './viewer';

export interface RailDeps {
  store: AppStore;
  bus: Bus;
  comments: CommentsStore;
  viewer: Viewer;
}

const percent = (fraction: number): string =>
  `${(Math.min(Math.max(fraction, 0), 1) * 100).toFixed(3)}%`;

/** Green when the hunk mostly adds, red when it mostly removes. */
const weight = (mark: HunkMark): string => (mark.additions >= mark.deletions ? 'add' : 'del');

const label = (mark: HunkMark): string => {
  const where = mark.context === '' ? mark.path : `${mark.path} · ${mark.context}`;
  return `${where}  +${mark.additions} -${mark.deletions}`;
};

export const createRail = ({ store, bus, comments, viewer }: RailDeps): Component<void> => {
  const disposer = createDisposer();
  let marks: HunkMark[] = [];

  const ticks = el('div', { class: 'dv-rail__ticks' });
  const box = el('div', { class: 'dv-rail__view' });
  const root = el('div', { class: 'dv-rail', hidden: true }, ticks, box);

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

  disposer.add(
    on(root, 'click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
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
