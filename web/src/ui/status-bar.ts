import type { StreamState } from '../api/sse';
import type { FileEntry } from '../api/types';
import type { Component } from '../core/component';
import { createDisposer } from '../core/component';
import { el } from '../core/dom';
import type { AppState, AppStore, LineSelection } from '../core/store';

export interface StatusBarProps {
  file: FileEntry | null;
  selection: LineSelection | null;
  stream: StreamState;
  notice: string | null;
}

export interface StatusBarDeps {
  store: AppStore;
}

const STREAM_LABELS: Record<StreamState, string> = {
  idle: 'idle',
  connecting: 'connecting',
  open: 'live',
  retrying: 'reconnecting',
  done: 'loaded',
  closed: 'offline',
};

const selectionSummary = (selection: LineSelection | null): string => {
  if (!selection) return 'no selection';
  const { start, end, side, endSide } = selection.range;
  const sideLabel = side === 'deletions' ? 'old' : 'new';
  const endLabel = (endSide ?? side) === 'deletions' ? 'old' : 'new';
  if (start === end && sideLabel === endLabel) return `${sideLabel} L${start}`;
  if (sideLabel === endLabel) return `${sideLabel} L${start}-L${end}`;
  return `${sideLabel} L${start} → ${endLabel} L${end}`;
};

export const statusBarProps = (state: AppState): StatusBarProps => ({
  file: state.manifest?.files.find((entry) => entry.id === state.selectedFile) ?? null,
  selection: state.selection,
  stream: state.stream,
  notice: state.notice,
});

export const createStatusBar = ({
  store,
}: StatusBarDeps): Component<StatusBarProps> => {
  const disposer = createDisposer();

  const path = el('span', { class: 'dv-status__file' });
  const counts = el('span', { class: 'dv-status__counts', hidden: true });
  const additions = el('span', { class: 'dv-count--add' });
  const deletions = el('span', { class: 'dv-count--del' });
  counts.append(additions, deletions);
  const selection = el('span', { class: 'dv-status__selection dv-mono' });
  const notice = el('span', { class: 'dv-status__notice', hidden: true });
  const dot = el('span', { class: 'dv-status__dot' });
  const streamLabel = el('span', { class: 'dv-status__stream-label' });

  const root = el(
    'div',
    { class: 'dv-status' },
    path,
    counts,
    el('span', { class: 'dv-status__spacer' }),
    notice,
    selection,
    el('span', { class: 'dv-status__stream' }, dot, streamLabel),
  );

  const update = (props: StatusBarProps): void => {
    const file = props.file;
    path.textContent = file?.path ?? 'no file selected';
    counts.hidden = file === null;
    additions.textContent = `+${file?.additions ?? 0}`;
    deletions.textContent = `-${file?.deletions ?? 0}`;
    selection.textContent = selectionSummary(props.selection);
    notice.hidden = props.notice === null;
    notice.textContent = props.notice ?? '';
    dot.dataset.state = props.stream;
    streamLabel.textContent = STREAM_LABELS[props.stream];
  };

  disposer.add(store.subscribe((state) => update(statusBarProps(state))));
  update(statusBarProps(store.get()));

  return { el: root, update, destroy: disposer.dispose };
};
