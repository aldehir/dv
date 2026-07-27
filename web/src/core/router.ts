import type { Bus } from './bus';
import type { Disposable } from './component';
import { createDisposer } from './component';
import { on } from './dom';
import type { AppStore, LineRange, LineSelection, SelectionSide } from './store';

export interface HashTarget {
  fileId: string;
  range: LineRange | null;
}

const ADDITIONS_MARKER = 'L';
const DELETIONS_MARKER = 'D';
const RANGE_PATTERN = /^([LD])(\d+)(?:-([LD])(\d+))?$/;

const markerToSide = (marker: string): SelectionSide =>
  marker === DELETIONS_MARKER ? 'deletions' : 'additions';

const sideToMarker = (side: SelectionSide | undefined): string =>
  side === 'deletions' ? DELETIONS_MARKER : ADDITIONS_MARKER;

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const isUsableLine = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 1;

export const parseHash = (hash: string): HashTarget | null => {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') return null;

  const separator = raw.lastIndexOf(':');
  if (separator <= 0) return { fileId: decode(raw), range: null };

  const matched = RANGE_PATTERN.exec(raw.slice(separator + 1));
  if (!matched) return { fileId: decode(raw), range: null };

  const fileId = decode(raw.slice(0, separator));
  if (fileId === '') return null;

  const startMarker = matched[1] ?? ADDITIONS_MARKER;
  const start = Number(matched[2]);
  const endMarker = matched[3] ?? startMarker;
  const end = matched[4] === undefined ? start : Number(matched[4]);
  if (!isUsableLine(start) || !isUsableLine(end)) {
    return { fileId, range: null };
  }

  const forward = end >= start;
  return {
    fileId,
    range: {
      start: forward ? start : end,
      end: forward ? end : start,
      side: markerToSide(forward ? startMarker : endMarker),
      endSide: markerToSide(forward ? endMarker : startMarker),
    },
  };
};

export const formatHash = (target: HashTarget | null): string => {
  if (!target || target.fileId === '') return '';
  const fileId = encodeURIComponent(target.fileId);
  const range = target.range;
  if (!range) return `#${fileId}`;

  const startSide = range.side ?? 'additions';
  const endSide = range.endSide ?? startSide;
  const start = `${sideToMarker(startSide)}${range.start}`;
  if (range.start === range.end && startSide === endSide) {
    return `#${fileId}:${start}`;
  }
  return `#${fileId}:${start}-${sideToMarker(endSide)}${range.end}`;
};

export const selectionToTarget = (selection: LineSelection | null): HashTarget | null =>
  selection ? { fileId: selection.id, range: selection.range } : null;

export const targetToSelection = (target: HashTarget | null): LineSelection | null =>
  target && target.range ? { id: target.fileId, range: target.range } : null;

export interface RouterDeps {
  store: AppStore;
  bus: Bus;
  host?: Window;
}

export interface Router extends Disposable {
  read(): HashTarget | null;
  write(target: HashTarget | null): void;
  apply(): void;
}

export const createRouter = ({ store, bus, host = window }: RouterDeps): Router => {
  const disposer = createDisposer();
  let lastWritten = '';
  let applied = false;

  const read = (): HashTarget | null => parseHash(host.location.hash);

  const write = (target: HashTarget | null): void => {
    const next = formatHash(target);
    if (next === lastWritten) return;
    lastWritten = next;
    const base = `${host.location.pathname}${host.location.search}`;
    host.history.replaceState(null, '', next === '' ? base : `${base}${next}`);
  };

  const apply = (): void => {
    const target = read();
    if (!target) return;
    const manifest = store.get().manifest;
    if (manifest && !manifest.files.some((file) => file.id === target.fileId)) return;
    lastWritten = formatHash(target);
    store.set({ selectedFile: target.fileId, selection: targetToSelection(target) });
    bus.emit('file:selected', { id: target.fileId, reveal: true });
  };

  disposer.add(on(host, 'hashchange', apply));
  disposer.add(
    bus.on('selection:changed', (selection) => {
      const fileId = selection?.id ?? store.get().selectedFile;
      write(selection ? selectionToTarget(selection) : fileId ? { fileId, range: null } : null);
    }),
  );
  disposer.add(
    bus.on('file:selected', ({ id }) => {
      if (store.get().selection?.id !== id) write({ fileId: id, range: null });
    }),
  );
  disposer.add(
    store.subscribe('manifest', () => {
      if (applied) return;
      applied = true;
      apply();
    }),
  );

  return { read, write, apply, destroy: disposer.dispose };
};
