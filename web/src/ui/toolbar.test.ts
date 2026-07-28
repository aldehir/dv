import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../api/types';
import { createBus } from '../core/bus';
import { createInitialState, createStore } from '../core/store';
import { createToolbar } from './toolbar';

const session = (): Session => ({
  repoRoot: '/home/alde/dev/alde/dv',
  head: 'a1b2c3d',
  spec: { kind: 'three-dot', left: 'main', right: 'feature', argv: ['main...feature'] },
  argv: ['main...feature'],
  defaults: { theme: 'auto', view: 'split', wrap: false },
  comments: true,
});

const setup = () => {
  const store = createStore(createInitialState());
  const bus = createBus();
  const toolbar = createToolbar({ store, bus });
  return { store, bus, toolbar };
};

const labelled = (toolbar: { el: HTMLElement }, label: string): HTMLButtonElement => {
  const found = toolbar.el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`no ${label} button`);
  return found;
};

describe('createToolbar', () => {
  it('renders the revspec breadcrumb and totals from the store', () => {
    const { store, toolbar } = setup();
    store.set({
      session: session(),
      manifest: { files: [], totals: { files: 7, additions: 12, deletions: 3 } },
    });

    expect(toolbar.el.querySelector('.dv-toolbar__repo')?.textContent).toBe('dv');
    expect(toolbar.el.querySelector('.dv-toolbar__rev')?.textContent).toBe(
      'main...feature',
    );
    expect(toolbar.el.querySelector('.dv-count--files')?.textContent).toBe('7 files');
    expect(toolbar.el.querySelector('.dv-count--add')?.textContent).toBe('+12');
    expect(toolbar.el.querySelector('.dv-count--del')?.textContent).toBe('-3');
    toolbar.destroy();
  });

  it('toggles the sidebar and mirrors its state', () => {
    const { store, bus, toolbar } = setup();
    const toggled = vi.fn();
    bus.on('sidebar:toggle', toggled);

    const button = labelled(toolbar, 'Toggle the file tree');
    expect(button.getAttribute('aria-pressed')).toBe('true');

    button.click();
    expect(toggled).toHaveBeenCalledTimes(1);

    store.set({ sidebarVisible: false });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    toolbar.destroy();
  });

  it('opens the keyboard help', () => {
    const { bus, toolbar } = setup();
    const toggled = vi.fn();
    bus.on('help:toggle', toggled);

    labelled(toolbar, 'Keyboard shortcuts').click();
    expect(toggled).toHaveBeenCalledTimes(1);
    toolbar.destroy();
  });

  it('drops every listener and subscription on destroy', () => {
    const { store, bus, toolbar } = setup();
    const toggled = vi.fn();
    bus.on('help:toggle', toggled);
    toolbar.destroy();

    labelled(toolbar, 'Keyboard shortcuts').click();
    store.set({ manifest: { files: [], totals: { files: 9, additions: 0, deletions: 0 } } });

    expect(toggled).not.toHaveBeenCalled();
    expect(toolbar.el.querySelector('.dv-count--files')?.textContent).toBe('0 files');
  });
});
