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

const button = (toolbar: { el: HTMLElement }, label: string): HTMLButtonElement => {
  const found = [...toolbar.el.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent === label,
  );
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

  it('reflects and drives the view mode and wrap flags', () => {
    const { store, toolbar } = setup();
    expect(button(toolbar, 'split').getAttribute('aria-pressed')).toBe('true');

    button(toolbar, 'unified').click();
    expect(store.get().view).toBe('unified');
    expect(button(toolbar, 'unified').getAttribute('aria-pressed')).toBe('true');
    expect(button(toolbar, 'split').getAttribute('aria-pressed')).toBe('false');

    button(toolbar, 'wrap').click();
    expect(store.get().wrap).toBe(true);
    expect(button(toolbar, 'wrap').getAttribute('aria-pressed')).toBe('true');
    toolbar.destroy();
  });

  it('offers every flavor plus auto and emits theme:set', () => {
    const { bus, toolbar } = setup();
    const emitted = vi.fn();
    bus.on('theme:set', emitted);

    const select = toolbar.el.querySelector<HTMLSelectElement>('.dv-select');
    expect([...(select?.options ?? [])].map((option) => option.value)).toEqual([
      'latte',
      'frappe',
      'macchiato',
      'mocha',
      'auto',
    ]);

    if (select) {
      select.value = 'latte';
      select.dispatchEvent(new Event('change'));
    }
    expect(emitted).toHaveBeenCalledWith('latte');
    toolbar.destroy();
  });

  it('hides the comment toggle until comments are enabled', () => {
    const { store, bus, toolbar } = setup();
    const toggled = vi.fn();
    bus.on('panel:toggle', toggled);

    expect(button(toolbar, 'comments').hidden).toBe(true);
    store.set({ commentsEnabled: true });
    expect(button(toolbar, 'comments').hidden).toBe(false);

    button(toolbar, 'comments').click();
    expect(toggled).toHaveBeenCalledTimes(1);
    toolbar.destroy();
  });

  it('drops every listener and subscription on destroy', () => {
    const { store, bus, toolbar } = setup();
    const emitted = vi.fn();
    bus.on('theme:set', emitted);
    toolbar.destroy();

    button(toolbar, 'unified').click();
    button(toolbar, 'wrap').click();
    const select = toolbar.el.querySelector<HTMLSelectElement>('.dv-select');
    if (select) {
      select.value = 'mocha';
      select.dispatchEvent(new Event('change'));
    }
    store.set({ manifest: { files: [], totals: { files: 9, additions: 0, deletions: 0 } } });

    expect(store.get().view).toBe('split');
    expect(store.get().wrap).toBe(false);
    expect(emitted).not.toHaveBeenCalled();
    expect(toolbar.el.querySelector('.dv-count--files')?.textContent).toBe('0 files');
  });
});
