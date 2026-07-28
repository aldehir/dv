import type { CommentsStore } from '../comments/store';
import type { Bus } from '../core/bus';
import type { Component } from '../core/component';
import { createDisposer } from '../core/component';
import { clear, el, frag, on } from '../core/dom';
import type { AppStore } from '../core/store';
import { fileIconName, icon } from '../ui/icons';
import type { HunkMark, Viewer } from './viewer';

export interface HunkListDeps {
  store: AppStore;
  bus: Bus;
  comments: CommentsStore;
  viewer: Viewer;
}

/**
 * How far above the top of the view a hunk may still sit and count as the one
 * being read. Offsets are estimated from line counts inside each file's
 * measured band, so a jump rarely lands on the tick to the pixel.
 */
const NEAR = 0.001;

/** Hunks in the order they are scrolled through, split at each file boundary. */
interface Group {
  fileId: string;
  path: string;
  marks: HunkMark[];
  /** Where each mark sits in the flat list, which is what a row carries. */
  first: number;
}

const groupsOf = (marks: readonly HunkMark[]): Group[] => {
  const groups: Group[] = [];
  marks.forEach((mark, position) => {
    const last = groups.at(-1);
    if (last && last.fileId === mark.fileId) last.marks.push(mark);
    else groups.push({ fileId: mark.fileId, path: mark.path, marks: [mark], first: position });
  });
  return groups;
};

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const label = (mark: HunkMark, position: number): string =>
  mark.context === '' ? `hunk ${position + 1}` : mark.context;

export const createHunkList = ({
  store,
  bus,
  comments,
  viewer,
}: HunkListDeps): Component<void> => {
  const disposer = createDisposer();
  let marks: HunkMark[] = [];
  let current = -1;

  const meta = el('div', { class: 'dv-hunks__meta' });
  const list = el('ul', { class: 'dv-hunks__list' });
  const root = el('div', { class: 'dv-hunks' }, meta, list);

  const rows = (): NodeListOf<HTMLElement> =>
    list.querySelectorAll<HTMLElement>('.dv-hunks__row');

  const row = (mark: HunkMark, position: number, inFile: number): HTMLLIElement =>
    el(
      'li',
      { class: 'dv-hunks__item' },
      el(
        'button',
        {
          class: 'dv-hunks__row',
          type: 'button',
          ariaCurrent: String(position === current),
          data: { hunk: String(position) },
        },
        el('span', { class: 'dv-hunks__context', textContent: label(mark, inFile) }),
        el(
          'span',
          { class: 'dv-hunks__delta' },
          el('span', { class: 'dv-count--add', textContent: `+${mark.additions}` }),
          el('span', { class: 'dv-count--del', textContent: `-${mark.deletions}` }),
        ),
      ),
    );

  const group = (entry: Group): HTMLLIElement =>
    el(
      'li',
      { class: 'dv-hunks__group' },
      el(
        'button',
        {
          class: 'dv-hunks__file',
          type: 'button',
          title: entry.path,
          data: { file: entry.fileId },
        },
        icon(fileIconName(entry.path)),
        el('span', { class: 'dv-hunks__path', textContent: basename(entry.path) }),
        el('span', {
          class: 'dv-hunks__tally',
          textContent: String(entry.marks.length),
        }),
      ),
      el(
        'ul',
        { class: 'dv-hunks__sublist' },
        ...entry.marks.map((mark, inFile) => row(mark, entry.first + inFile, inFile)),
      ),
    );

  /**
   * The hunk the top of the view is inside. Above the first one — in the header
   * of the leading file — that is still the first: nothing else is up there.
   */
  const currentIndex = (): number => {
    const { offset, extent } = viewer.viewport();
    // The last screenful is the exception: a hunk down there can never be
    // brought to the top, so once the scroll ends every one still below it has
    // been reached as far as it ever will be.
    const ended = extent < 1 && offset + extent >= 1 - NEAR;
    const line = ended ? 1 : offset + NEAR;

    let found = -1;
    marks.forEach((mark, position) => {
      if (mark.offset <= line) found = position;
    });
    return found < 0 && marks.length > 0 ? 0 : found;
  };

  /** Whether the panel is showing this list rather than the inbox, or nothing. */
  const showing = (): boolean => {
    const { panelVisible, panelView } = store.get();
    return panelVisible && panelView === 'hunks';
  };

  /** Moves the mark to where the diff now is, and keeps that row in sight. */
  const syncCurrent = (): void => {
    if (!showing()) return;
    const found = currentIndex();
    if (found === current) return;
    current = found;
    for (const node of rows()) {
      const active = node.dataset.hunk === String(current);
      node.setAttribute('aria-current', String(active));
      // `nearest` leaves a row that is already on screen where it is, so the
      // panel only moves when the reader has scrolled past its own view.
      if (active) node.scrollIntoView?.({ block: 'nearest' });
    }
  };

  const render = (): void => {
    // Out of sight the list is not rebuilt at all: every file streaming in
    // would otherwise redraw a panel nobody is reading. Opening it draws it.
    if (!showing()) return;
    marks = viewer.hunks();
    current = currentIndex();

    clear(list);
    list.appendChild(frag(...groupsOf(marks).map(group)));

    const files = new Set(marks.map((mark) => mark.fileId)).size;
    meta.textContent =
      marks.length === 0
        ? 'No hunks yet'
        : `${marks.length} hunk${marks.length === 1 ? '' : 's'} · ${files} file${files === 1 ? '' : 's'}`;
  };

  const jump = (mark: HunkMark): void => {
    if (store.get().selectedFile !== mark.fileId) store.set({ selectedFile: mark.fileId });
    viewer.jumpToHunk(mark);
  };

  const openFile = (id: string): void => {
    if (store.get().selectedFile !== id) store.set({ selectedFile: id, selection: null });
    bus.emit('file:selected', { id, reveal: true });
  };

  disposer.add(
    on(list, 'click', (event) => {
      // The file glyph is an SVG, so the target is not always an HTMLElement.
      const target = event.target;
      if (!(target instanceof Element)) return;
      const position = target.closest<HTMLElement>('[data-hunk]')?.dataset.hunk;
      if (position !== undefined) {
        const mark = marks[Number(position)];
        if (mark) jump(mark);
        return;
      }
      const fileId = target.closest<HTMLElement>('[data-file]')?.dataset.file;
      if (fileId !== undefined) openFile(fileId);
    }),
  );
  disposer.add(bus.on('file:payload', render));
  disposer.add(bus.on('manifest:ready', render));
  disposer.add(store.subscribe('view', render));
  disposer.add(store.subscribe('wrap', render));
  disposer.add(store.subscribe('scrollTop', syncCurrent));
  disposer.add(store.subscribe('panelVisible', render));
  disposer.add(store.subscribe('panelView', render));
  // Cards move every hunk below them, which is what the offsets are measured on.
  disposer.add(comments.subscribe(render));

  render();

  return { el: root, update: render, destroy: disposer.dispose };
};
