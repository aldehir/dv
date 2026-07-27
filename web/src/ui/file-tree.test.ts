import { describe, expect, it, vi } from 'vitest';
import type { FileEntry, Manifest } from '../api/types';
import { createBus } from '../core/bus';
import { createInitialState, createStore } from '../core/store';
import { createFileTree } from './file-tree';

const entry = (id: string, path: string, status: FileEntry['status']): FileEntry => ({
  id,
  path,
  status,
  additions: 3,
  deletions: 1,
  binary: false,
  tooLarge: false,
  submodule: false,
  symlink: false,
  mode: { old: '100644', new: '100644' },
  oldSha: 'a',
  newSha: 'b',
});

const manifest = (files: FileEntry[]): Manifest => ({
  files,
  totals: { files: files.length, additions: 0, deletions: 0 },
});

const setup = () => {
  const store = createStore(createInitialState());
  const bus = createBus();
  const tree = createFileTree({ store, bus });
  store.set({
    manifest: manifest([
      entry('f1', 'internal/gitx/blob.go', 'modified'),
      entry('f2', 'web/src/main.ts', 'added'),
      entry('f3', 'README.md', 'deleted'),
    ]),
  });
  return { store, bus, tree };
};

const rows = (tree: { el: HTMLElement }): HTMLElement[] =>
  [...tree.el.querySelectorAll<HTMLElement>('[data-file-id]')];

const visibleRows = (tree: { el: HTMLElement }): HTMLElement[] =>
  rows(tree).filter((row) => row.parentElement?.hidden !== true);

const dirs = (tree: { el: HTMLElement }): HTMLElement[] =>
  [...tree.el.querySelectorAll<HTMLElement>('[data-dir-path]')];

const visibleDirs = (tree: { el: HTMLElement }): HTMLElement[] =>
  dirs(tree).filter((row) => row.parentElement?.hidden !== true);

describe('createFileTree', () => {
  it('renders one row per manifest file with status, counts and escaped paths', () => {
    const { tree } = setup();
    expect(rows(tree).length).toBe(3);

    const first = rows(tree)[0];
    expect(first?.dataset.fileId).toBe('f1');
    expect(first?.querySelector('.dv-badge')?.textContent).toBe('M');
    expect(first?.querySelector('.dv-tree__name')?.textContent).toBe('blob.go');
    expect(first?.title).toBe('internal/gitx/blob.go');
    expect(first?.querySelector('.dv-count--add')?.textContent).toBe('+3');
    expect(first?.querySelector('.dv-count--del')?.textContent).toBe('-1');
    expect(tree.el.querySelector('.dv-tree__meta')?.textContent).toBe('3 of 3 files');
    tree.destroy();
  });

  it('nests files under compacted directory rows in manifest order', () => {
    const { tree } = setup();

    expect(dirs(tree).map((dir) => dir.dataset.dirPath)).toEqual([
      'internal/gitx',
      'web/src',
    ]);
    expect(dirs(tree).map((dir) => dir.querySelector('.dv-tree__label')?.textContent)).toEqual(
      ['internal/gitx', 'web/src'],
    );
    expect(dirs(tree).map((dir) => dir.getAttribute('aria-expanded'))).toEqual([
      'true',
      'true',
    ]);

    const order = [...tree.el.querySelectorAll<HTMLElement>('[data-file-id], [data-dir-path]')];
    expect(order.map((row) => row.dataset.dirPath ?? row.dataset.fileId)).toEqual([
      'internal/gitx',
      'f1',
      'web/src',
      'f2',
      'f3',
    ]);
    tree.destroy();
  });

  it('collapses a directory on click and re-expands it when a child is selected', () => {
    const { store, bus, tree } = setup();
    const gitx = dirs(tree)[0];

    gitx?.click();
    expect(gitx?.getAttribute('aria-expanded')).toBe('false');
    expect(visibleRows(tree).map((row) => row.dataset.fileId)).toEqual(['f2', 'f3']);

    bus.emit('file:step', { delta: 1 });
    expect(store.get().selectedFile).toBe('f1');
    expect(gitx?.getAttribute('aria-expanded')).toBe('true');
    expect(visibleRows(tree).map((row) => row.dataset.fileId)).toEqual(['f1', 'f2', 'f3']);
    tree.destroy();
  });

  it('hides directories with no matching descendant while filtering', () => {
    const { store, tree } = setup();
    store.set({ filter: 'blob' });

    expect(visibleDirs(tree).map((dir) => dir.dataset.dirPath)).toEqual(['internal/gitx']);
    expect(visibleRows(tree).map((row) => row.dataset.fileId)).toEqual(['f1']);
    tree.destroy();
  });

  it('does not parse markup coming from a repo path', () => {
    const store = createStore(createInitialState());
    const bus = createBus();
    const tree = createFileTree({ store, bus });
    store.set({ manifest: manifest([entry('x', '<img src=x onerror=1>', 'added')]) });

    expect(tree.el.querySelector('img')).toBeNull();
    expect(tree.el.querySelector('.dv-tree__name')?.textContent).toBe(
      '<img src=x onerror=1>',
    );
    tree.destroy();
  });

  it('filters rows without rebuilding them', () => {
    const { store, tree } = setup();
    const before = rows(tree);

    store.set({ filter: 'web' });
    expect(visibleRows(tree).map((row) => row.dataset.fileId)).toEqual(['f2']);
    expect(rows(tree)[0]).toBe(before[0]);
    expect(tree.el.querySelector('.dv-tree__meta')?.textContent).toBe('1 of 3 files');

    store.set({ filter: '' });
    expect(visibleRows(tree).length).toBe(3);
    tree.destroy();
  });

  it('shows comment pips only for files with comments', () => {
    const { store, tree } = setup();
    store.set({ commentCounts: { f2: 4 } });

    const pips = [...tree.el.querySelectorAll<HTMLElement>('.dv-pip')];
    expect(pips.map((pip) => pip.hidden)).toEqual([true, false, true]);
    expect(pips[1]?.textContent).toBe('4');
    tree.destroy();
  });

  it('selects a file on click and marks it current', () => {
    const { store, bus, tree } = setup();
    const selected = vi.fn();
    bus.on('file:selected', selected);

    rows(tree)[1]?.click();

    expect(store.get().selectedFile).toBe('f2');
    expect(rows(tree)[1]?.getAttribute('aria-current')).toBe('true');
    expect(selected).toHaveBeenCalledWith({ id: 'f2', reveal: true });
    tree.destroy();
  });

  it('steps through the filtered order on file:step', () => {
    const { store, bus, tree } = setup();
    bus.emit('file:step', { delta: 1 });
    expect(store.get().selectedFile).toBe('f1');

    bus.emit('file:step', { delta: 1 });
    expect(store.get().selectedFile).toBe('f2');

    bus.emit('file:step', { delta: -1 });
    expect(store.get().selectedFile).toBe('f1');

    bus.emit('file:step', { delta: -1 });
    expect(store.get().selectedFile).toBe('f1');

    store.set({ filter: 'README' });
    bus.emit('file:step', { delta: 1 });
    expect(store.get().selectedFile).toBe('f3');
    tree.destroy();
  });

  it('focuses the filter box on filter:focus', () => {
    const { bus, tree } = setup();
    document.body.appendChild(tree.el);
    bus.emit('filter:focus');
    expect(document.activeElement).toBe(tree.el.querySelector('.dv-tree__filter'));
    tree.el.remove();
    tree.destroy();
  });

  it('drops every listener and subscription on destroy', () => {
    const { store, bus, tree } = setup();
    const selected = vi.fn();
    bus.on('file:selected', selected);
    tree.destroy();

    rows(tree)[0]?.click();
    bus.emit('file:step', { delta: 1 });
    store.set({ filter: 'web', commentCounts: { f1: 2 } });

    expect(selected).not.toHaveBeenCalled();
    expect(store.get().selectedFile).toBeNull();
    expect(visibleRows(tree).length).toBe(3);
    expect(tree.el.querySelector<HTMLElement>('.dv-pip')?.hidden).toBe(true);
  });
});
