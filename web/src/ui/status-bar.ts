import type { StreamState } from '../api/sse';
import type { Totals } from '../api/types';
import type { Component } from '../core/component';
import { createDisposer } from '../core/component';
import { el } from '../core/dom';
import type { AppState, AppStore, LineSelection } from '../core/store';

export interface StatusBarProps {
  totals: Totals | null;
  selectedPath: string | null;
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
  totals: state.manifest?.totals ?? null,
  selectedPath:
    state.manifest?.files.find((file) => file.id === state.selectedFile)?.path ?? null,
  selection: state.selection,
  stream: state.stream,
  notice: state.notice,
});

export const createStatusBar = ({
  store,
}: StatusBarDeps): Component<StatusBarProps> => {
  const disposer = createDisposer();

  const counts = el('span', { class: 'dv-status__counts' });
  const file = el('span', { class: 'dv-status__file' });
  const selection = el('span', { class: 'dv-status__selection' });
  const notice = el('span', { class: 'dv-status__notice', hidden: true });
  const dot = el('span', { class: 'dv-status__dot' });
  const streamLabel = el('span', { class: 'dv-status__stream-label' });

  const root = el(
    'div',
    { class: 'dv-status' },
    counts,
    file,
    el('span', { class: 'dv-status__spacer' }),
    notice,
    selection,
    el('span', { class: 'dv-status__stream' }, dot, streamLabel),
  );

  const update = (props: StatusBarProps): void => {
    const totals = props.totals;
    counts.textContent = totals
      ? `${totals.files} files +${totals.additions} -${totals.deletions}`
      : 'no diff';
    file.textContent = props.selectedPath ?? '';
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
