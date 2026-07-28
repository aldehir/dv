import type { Bus } from '../core/bus';
import type { Disposable } from '../core/component';
import { createDisposer } from '../core/component';
import { isTextEntry, on } from '../core/dom';
import type { AppStore } from '../core/store';

export interface KeybindDescription {
  keys: string;
  label: string;
}

export const KEYBINDS: readonly KeybindDescription[] = [
  { keys: 'j / k', label: 'Next / previous file' },
  { keys: '] / [', label: 'Next / previous hunk' },
  { keys: '/', label: 'Focus the file filter' },
  { keys: 't', label: 'Cycle Catppuccin flavor' },
  { keys: 'c', label: 'Write in the comment box for the selection' },
  { keys: 'n / p', label: 'Next / previous comment' },
  { keys: 'g', label: 'Toggle the comment inbox' },
  { keys: 'h', label: 'Toggle the hunk list' },
  { keys: 'b', label: 'Toggle the file tree' },
  { keys: '?', label: 'Toggle this help' },
  { keys: 'Esc', label: 'Dismiss overlays' },
];

export interface KeybindsDeps {
  store: AppStore;
  bus: Bus;
  target?: Document;
}

export const createKeybinds = ({
  store,
  bus,
  target = document,
}: KeybindsDeps): Disposable => {
  const disposer = createDisposer();

  // The box is already there whenever a range is selected; `c` just moves into it.
  const focusDraft = (): void => {
    const selection = store.get().selection;
    if (!selection) return;
    store.set({ composing: selection });
    bus.emit('draft:focus');
  };

  const handle = (event: KeyboardEvent): boolean => {
    switch (event.key) {
      case 'j':
        bus.emit('file:step', { delta: 1 });
        return true;
      case 'k':
        bus.emit('file:step', { delta: -1 });
        return true;
      case ']':
        bus.emit('hunk:step', { delta: 1 });
        return true;
      case '[':
        bus.emit('hunk:step', { delta: -1 });
        return true;
      case '/':
        bus.emit('filter:focus');
        return true;
      case 't':
        bus.emit('theme:cycle');
        return true;
      case 'c':
        focusDraft();
        return true;
      case 'n':
        bus.emit('comment:step', { delta: 1 });
        return true;
      case 'p':
        bus.emit('comment:step', { delta: -1 });
        return true;
      case 'g':
        bus.emit('panel:toggle', 'comments');
        return true;
      case 'h':
        bus.emit('panel:toggle', 'hunks');
        return true;
      case 'b':
        bus.emit('sidebar:toggle');
        return true;
      case '?':
        bus.emit('help:toggle');
        return true;
      case 'Escape':
        bus.emit('overlay:dismiss');
        return true;
      default:
        return false;
    }
  };

  disposer.add(
    on(target, 'keydown', (event) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const inTextEntry = isTextEntry(event.target);
      if (inTextEntry) {
        if (event.key !== 'Escape') return;
        if (event.target instanceof HTMLElement) event.target.blur();
        bus.emit('overlay:dismiss');
        return;
      }
      if (handle(event)) event.preventDefault();
    }),
  );

  return { destroy: disposer.dispose };
};
