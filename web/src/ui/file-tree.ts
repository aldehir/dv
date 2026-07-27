import type { FileEntry, FileStatus } from '../api/types';
import type { Bus } from '../core/bus';
import type { Component } from '../core/component';
import { createDisposer } from '../core/component';
import { clear, el, frag, on } from '../core/dom';
import type { AppState, AppStore } from '../core/store';
import { fileIconName, icon } from './icons';

export interface FileTreeProps {
  files: readonly FileEntry[];
  filter: string;
  selectedFile: string | null;
  commentCounts: Record<string, number>;
}

export interface FileTreeDeps {
  store: AppStore;
  bus: Bus;
}

export interface FileTree extends Component<FileTreeProps> {
  focusFilter(): void;
}

const STATUS_LETTERS: Record<FileStatus, string> = {
  added: 'A',
  copied: 'C',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
  typechange: 'T',
  unmerged: 'U',
  untracked: '?',
};

interface FileNode {
  type: 'file';
  entry: FileEntry;
  haystack: string;
  item: HTMLLIElement;
  button: HTMLButtonElement;
  pip: HTMLElement;
}

interface DirNode {
  type: 'dir';
  path: string;
  label: string;
  children: TreeNode[];
  item: HTMLLIElement;
  button: HTMLButtonElement;
  chevron: SVGElement;
  glyph: HTMLElement;
}

type TreeNode = FileNode | DirNode;

export const fileTreeProps = (state: AppState): FileTreeProps => ({
  files: state.manifest?.files ?? [],
  filter: state.filter,
  selectedFile: state.selectedFile,
  commentCounts: state.commentCounts,
});

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const buildFile = (entry: FileEntry): FileNode => {
  const pip = el('span', { class: 'dv-pip', hidden: true });
  const title = entry.prevPath ? `${entry.prevPath} → ${entry.path}` : entry.path;
  const button = el(
    'button',
    {
      class: 'dv-tree__row',
      type: 'button',
      title,
      data: { fileId: entry.id },
    },
    el('span', { class: 'dv-tree__rail' }),
    el('span', { class: 'dv-tree__glyph-slot' }, icon(fileIconName(entry.path))),
    el('span', { class: 'dv-tree__name', textContent: basename(entry.path) }),
    el(
      'span',
      { class: 'dv-tree__counts' },
      el('span', { class: 'dv-count--add', textContent: `+${entry.additions}` }),
      el('span', { class: 'dv-count--del', textContent: `-${entry.deletions}` }),
    ),
    pip,
    el('span', {
      class: `dv-badge dv-badge--${entry.status}`,
      textContent: STATUS_LETTERS[entry.status],
      title: entry.status,
    }),
  );
  return {
    type: 'file',
    entry,
    haystack: `${entry.path}\n${entry.prevPath ?? ''}`.toLowerCase(),
    item: el('li', null, button),
    button,
    pip,
  };
};

const buildDir = (raw: RawDir, depth: number): DirNode => {
  const chevron = icon('chevron', 'dv-tree__chevron');
  const glyph = el('span', { class: 'dv-tree__glyph-slot' }, icon('folderOpen'));
  const button = el(
    'button',
    {
      class: 'dv-tree__dir',
      type: 'button',
      title: raw.path,
      data: { dirPath: raw.path },
    },
    chevron,
    glyph,
    el('span', { class: 'dv-tree__label', textContent: raw.label }),
  );
  button.style.setProperty('--dv-depth', String(depth));
  return {
    type: 'dir',
    path: raw.path,
    label: raw.label,
    children: materialize(raw.children, depth + 1),
    item: el('li', null, button),
    button,
    chevron,
    glyph,
  };
};

interface RawDir {
  type: 'dir';
  path: string;
  label: string;
  children: RawNode[];
  index: Map<string, RawDir>;
}

type RawNode = RawDir | { type: 'file'; entry: FileEntry };

/** Collapses `a` → `b` → `c` chains into one `a/b/c` row, VS Code style. */
const compact = (dir: RawDir): void => {
  while (dir.children.length === 1) {
    const only = dir.children[0];
    if (!only || only.type !== 'dir') break;
    dir.label = `${dir.label}/${only.label}`;
    dir.path = only.path;
    dir.children = only.children;
    dir.index = only.index;
  }
  for (const child of dir.children) {
    if (child.type === 'dir') compact(child);
  }
};

function materialize(raw: readonly RawNode[], depth: number): TreeNode[] {
  return raw.map((node) => {
    if (node.type === 'dir') return buildDir(node, depth);
    const file = buildFile(node.entry);
    file.button.style.setProperty('--dv-depth', String(depth));
    return file;
  });
}

/**
 * Nests the manifest into directories without sorting, so rows stay in the order
 * the files stream into the diff.
 */
const buildTree = (files: readonly FileEntry[]): TreeNode[] => {
  const root: Pick<RawDir, 'children' | 'index'> = { children: [], index: new Map() };

  for (const entry of files) {
    const segments = entry.path.split('/').slice(0, -1);
    let parent = root;
    let prefix = '';
    for (const segment of segments) {
      prefix = prefix === '' ? segment : `${prefix}/${segment}`;
      let dir = parent.index.get(segment);
      if (!dir) {
        dir = { type: 'dir', path: prefix, label: segment, children: [], index: new Map() };
        parent.index.set(segment, dir);
        parent.children.push(dir);
      }
      parent = dir;
    }
    parent.children.push({ type: 'file', entry });
  }

  for (const child of root.children) {
    if (child.type === 'dir') compact(child);
  }
  return materialize(root.children, 0);
};

const flatten = (nodes: readonly TreeNode[], out: HTMLLIElement[]): HTMLLIElement[] => {
  for (const node of nodes) {
    out.push(node.item);
    if (node.type === 'dir') flatten(node.children, out);
  }
  return out;
};

export const createFileTree = ({ store, bus }: FileTreeDeps): FileTree => {
  const disposer = createDisposer();
  const collapsed = new Set<string>();
  const parents = new Map<string, string[]>();
  let nodes: TreeNode[] = [];
  let visible: string[] = [];
  let renderedFiles: readonly FileEntry[] | null = null;
  let revealed: string | null = null;

  const filterInput = el('input', {
    class: 'dv-tree__filter',
    type: 'search',
    placeholder: 'Filter files',
    spellcheck: false,
    autocomplete: 'off',
  });
  const meta = el('span', { class: 'dv-tree__meta' });
  const list = el('ul', { class: 'dv-tree__list' });
  const root = el(
    'div',
    { class: 'dv-tree' },
    el(
      'div',
      { class: 'dv-tree__head' },
      el('label', { class: 'dv-field' }, icon('search', 'dv-field__icon'), filterInput),
    ),
    el('div', { class: 'dv-tree__status' }, meta),
    list,
  );

  const select = (id: string): void => {
    if (store.get().selectedFile !== id) {
      store.set({ selectedFile: id, selection: null });
    }
    bus.emit('file:selected', { id, reveal: true });
  };

  const step = (delta: number): void => {
    if (visible.length === 0) return;
    const current = store.get().selectedFile;
    const index = current === null ? -1 : visible.indexOf(current);
    const next = index < 0 ? (delta > 0 ? 0 : visible.length - 1) : index + delta;
    const clamped = Math.min(Math.max(next, 0), visible.length - 1);
    const id = visible[clamped];
    if (id !== undefined) select(id);
  };

  const rebuild = (files: readonly FileEntry[]): void => {
    collapsed.clear();
    parents.clear();
    nodes = buildTree(files);

    const trail: string[] = [];
    const record = (siblings: readonly TreeNode[]): void => {
      for (const node of siblings) {
        if (node.type === 'file') {
          parents.set(node.entry.id, [...trail]);
          continue;
        }
        trail.push(node.path);
        record(node.children);
        trail.pop();
      }
    };
    record(nodes);

    clear(list);
    const batch = frag();
    for (const item of flatten(nodes, [])) batch.appendChild(item);
    list.appendChild(batch);
  };

  const setCollapsed = (path: string, next: boolean): void => {
    if (next) collapsed.add(path);
    else collapsed.delete(path);
    update(fileTreeProps(store.get()));
  };

  const revealAncestors = (id: string): boolean => {
    let changed = false;
    for (const path of parents.get(id) ?? []) {
      if (collapsed.delete(path)) changed = true;
    }
    return changed;
  };

  const paint = (
    siblings: readonly TreeNode[],
    props: FileTreeProps,
    needle: string,
    hidden: boolean,
  ): boolean => {
    let matched = false;
    for (const node of siblings) {
      if (node.type === 'file') {
        const shown = needle === '' || node.haystack.includes(needle);
        node.item.hidden = hidden || !shown;
        if (shown) {
          matched = true;
          visible.push(node.entry.id);
        }

        const count = props.commentCounts[node.entry.id] ?? 0;
        node.pip.hidden = count === 0;
        node.pip.textContent = count === 0 ? '' : String(count);

        const current = node.entry.id === props.selectedFile;
        node.button.setAttribute('aria-current', String(current));
        if (current && !node.item.hidden && props.selectedFile !== revealed) {
          node.button.scrollIntoView?.({ block: 'nearest' });
        }
        continue;
      }

      const shut = needle === '' && collapsed.has(node.path);
      const childMatched = paint(node.children, props, needle, hidden || shut);
      node.item.hidden = hidden || !childMatched;
      node.button.setAttribute('aria-expanded', String(!shut));
      node.glyph.replaceChildren(icon(shut ? 'folder' : 'folderOpen'));
      matched ||= childMatched;
    }
    return matched;
  };

  const update = (props: FileTreeProps): void => {
    if (props.files !== renderedFiles) {
      renderedFiles = props.files;
      rebuild(props.files);
    }
    if (filterInput.value !== props.filter) filterInput.value = props.filter;
    if (props.selectedFile !== null && props.selectedFile !== revealed) {
      revealAncestors(props.selectedFile);
    }

    visible = [];
    paint(nodes, props, props.filter.trim().toLowerCase(), false);
    revealed = props.selectedFile;

    meta.textContent =
      props.files.length === 0
        ? 'No files'
        : `${visible.length} of ${props.files.length} files`;
  };

  disposer.add(
    on(list, 'click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const row = target.closest<HTMLElement>('[data-file-id], [data-dir-path]');
      if (!row) return;
      const id = row.dataset.fileId;
      if (id !== undefined) {
        select(id);
        return;
      }
      const path = row.dataset.dirPath;
      if (path !== undefined) setCollapsed(path, !collapsed.has(path));
    }),
  );
  disposer.add(
    on(filterInput, 'input', () => {
      store.set({ filter: filterInput.value });
    }),
  );
  disposer.add(bus.on('file:step', ({ delta }) => step(delta)));
  disposer.add(bus.on('filter:focus', () => filterInput.focus()));
  disposer.add(store.subscribe((state) => update(fileTreeProps(state))));

  update(fileTreeProps(store.get()));

  return {
    el: root,
    update,
    focusFilter: () => filterInput.focus(),
    destroy: disposer.dispose,
  };
};
