import type { FileEntry, FileStatus } from '../api/types';
import type { Bus } from '../core/bus';
import type { Component } from '../core/component';
import { createDisposer } from '../core/component';
import { clear, el, frag, on } from '../core/dom';
import type { AppState, AppStore } from '../core/store';

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

interface Row {
  button: HTMLButtonElement;
  item: HTMLLIElement;
  pip: HTMLElement;
  haystack: string;
}

export const fileTreeProps = (state: AppState): FileTreeProps => ({
  files: state.manifest?.files ?? [],
  filter: state.filter,
  selectedFile: state.selectedFile,
  commentCounts: state.commentCounts,
});

const splitPath = (path: string): [string, string] => {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? ['', path] : [path.slice(0, cut + 1), path.slice(cut + 1)];
};

const buildRow = (entry: FileEntry): Row => {
  const [dir, name] = splitPath(entry.path);
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
    el('span', {
      class: `dv-badge dv-badge--${entry.status}`,
      textContent: STATUS_LETTERS[entry.status],
    }),
    el(
      'span',
      { class: 'dv-tree__path' },
      el('span', { class: 'dv-tree__dir', textContent: dir }),
      el('span', { class: 'dv-tree__name', textContent: name }),
    ),
    el(
      'span',
      { class: 'dv-tree__counts' },
      el('span', { class: 'dv-count--add', textContent: `+${entry.additions}` }),
      el('span', { class: 'dv-count--del', textContent: `-${entry.deletions}` }),
    ),
    pip,
  );
  return {
    button,
    item: el('li', null, button),
    pip,
    haystack: `${entry.path}\n${entry.prevPath ?? ''}`.toLowerCase(),
  };
};

export const createFileTree = ({ store, bus }: FileTreeDeps): FileTree => {
  const disposer = createDisposer();
  const rows = new Map<string, Row>();
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
  const meta = el('div', { class: 'dv-tree__meta' });
  const list = el('ul', { class: 'dv-tree__list' });
  const root = el(
    'div',
    { class: 'dv-tree' },
    el('div', { class: 'dv-tree__head' }, filterInput),
    meta,
    list,
  );

  const select = (id: string): void => {
    if (store.get().selectedFile === id) {
      bus.emit('file:selected', { id, reveal: true });
      return;
    }
    store.set({ selectedFile: id, selection: null });
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
    rows.clear();
    clear(list);
    const batch = frag();
    for (const entry of files) {
      const row = buildRow(entry);
      rows.set(entry.id, row);
      batch.appendChild(row.item);
    }
    list.appendChild(batch);
  };

  const update = (props: FileTreeProps): void => {
    if (props.files !== renderedFiles) {
      renderedFiles = props.files;
      rebuild(props.files);
    }
    if (filterInput.value !== props.filter) filterInput.value = props.filter;

    const needle = props.filter.trim().toLowerCase();
    visible = [];
    for (const entry of props.files) {
      const row = rows.get(entry.id);
      if (!row) continue;
      const shown = needle === '' || row.haystack.includes(needle);
      row.item.hidden = !shown;
      if (shown) visible.push(entry.id);

      const count = props.commentCounts[entry.id] ?? 0;
      row.pip.hidden = count === 0;
      row.pip.textContent = count === 0 ? '' : String(count);

      const current = entry.id === props.selectedFile;
      row.button.setAttribute('aria-current', String(current));
      if (current && shown && props.selectedFile !== revealed) {
        row.button.scrollIntoView?.({ block: 'nearest' });
      }
    }
    revealed = props.selectedFile;

    meta.textContent =
      props.files.length === 0
        ? 'No files'
        : `${visible.length} of ${props.files.length} files`;
  };

  disposer.add(
    on(list, 'click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const row = target.closest<HTMLElement>('[data-file-id]');
      const id = row?.dataset.fileId;
      if (id) select(id);
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
