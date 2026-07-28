import { describe, expect, it, vi } from 'vitest';
import type { PanelView } from '../core/store';
import { createBus } from '../core/bus';
import { createInitialState, createStore } from '../core/store';
import { createDock } from './dock';

const setup = () => {
  const store = createStore(createInitialState());
  const bus = createBus();
  const seen: PanelView[] = [];
  bus.on('panel:toggle', (view) => seen.push(view));
  const dock = createDock({ store, bus });
  const button = (label: string): HTMLButtonElement => {
    const found = dock.el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
    if (!found) throw new Error(`no ${label} button`);
    return found;
  };
  return {
    store,
    bus,
    dock,
    seen,
    hunks: () => button('Toggle the hunk list'),
    comments: () => button('Toggle the comment inbox'),
  };
};

describe('createDock', () => {
  it('asks for the list its button stands for', () => {
    const it0 = setup();

    it0.hunks().click();
    it0.comments().click();

    expect(it0.seen).toEqual(['hunks', 'comments']);
    it0.dock.destroy();
  });

  it('presses only the button whose list is showing', () => {
    const it0 = setup();

    expect(it0.hunks().getAttribute('aria-pressed')).toBe('false');

    it0.store.set({ panelVisible: true, panelView: 'hunks' });
    expect(it0.hunks().getAttribute('aria-pressed')).toBe('true');
    expect(it0.comments().getAttribute('aria-pressed')).toBe('false');

    it0.store.set({ panelView: 'comments' });
    expect(it0.hunks().getAttribute('aria-pressed')).toBe('false');
    expect(it0.comments().getAttribute('aria-pressed')).toBe('true');

    // A closed panel leaves nothing pressed, whichever list it last held.
    it0.store.set({ panelVisible: false });
    expect(it0.comments().getAttribute('aria-pressed')).toBe('false');
    it0.dock.destroy();
  });

  it('hides the inbox button until comments are enabled', () => {
    const it0 = setup();

    expect(it0.comments().hidden).toBe(true);
    expect(it0.hunks().hidden).toBe(false);

    it0.store.set({ commentsEnabled: true });
    expect(it0.comments().hidden).toBe(false);
    it0.dock.destroy();
  });

  it('drops every subscription on destroy', () => {
    const it0 = setup();
    const toggled = vi.fn();
    it0.bus.on('panel:toggle', toggled);
    it0.dock.destroy();

    it0.hunks().click();
    it0.store.set({ commentsEnabled: true });

    expect(toggled).not.toHaveBeenCalled();
    expect(it0.comments().hidden).toBe(true);
  });
});
