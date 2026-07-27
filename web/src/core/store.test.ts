import { describe, expect, it, vi } from 'vitest';
import { createInitialState, createStore } from './store';

describe('createStore', () => {
  it('exposes the initial state as a copy', () => {
    const initial = createInitialState();
    const store = createStore(initial);
    store.set({ view: 'unified' });
    expect(store.get().view).toBe('unified');
    expect(initial.view).toBe('split');
  });

  it('merges partial updates', () => {
    const store = createStore(createInitialState());
    store.set({ filter: 'src', wrap: true });
    expect(store.get().filter).toBe('src');
    expect(store.get().wrap).toBe(true);
    expect(store.get().view).toBe('split');
  });

  it('notifies key subscribers only when that key changes', () => {
    const store = createStore(createInitialState());
    const listener = vi.fn();
    store.subscribe('filter', listener);

    store.set({ filter: 'a' });
    store.set({ wrap: true });
    store.set({ filter: 'a' });
    store.set({ filter: 'b' });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0]?.[0]).toBe('a');
    expect(listener.mock.calls[1]?.[0]).toBe('b');
  });

  it('notifies whole-store subscribers once per changed commit', () => {
    const store = createStore(createInitialState());
    const listener = vi.fn();
    store.subscribe(listener);

    store.set({ filter: 'a', wrap: true });
    store.set({ filter: 'a', wrap: true });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const store = createStore(createInitialState());
    const keyed = vi.fn();
    const whole = vi.fn();
    const offKeyed = store.subscribe('filter', keyed);
    const offWhole = store.subscribe(whole);

    offKeyed();
    offWhole();
    store.set({ filter: 'x' });

    expect(keyed).not.toHaveBeenCalled();
    expect(whole).not.toHaveBeenCalled();
  });

  it('gives subscribers the committed state', () => {
    const store = createStore(createInitialState());
    let seen = '';
    store.subscribe('selectedFile', (_value, state) => {
      seen = `${state.selectedFile}:${state.filter}`;
    });
    store.set({ selectedFile: 'f1', filter: 'go' });
    expect(seen).toBe('f1:go');
  });

  it('survives a subscriber that unsubscribes during notification', () => {
    const store = createStore(createInitialState());
    const second = vi.fn();
    const off = store.subscribe('filter', () => off());
    store.subscribe('filter', second);

    store.set({ filter: 'a' });
    store.set({ filter: 'b' });

    expect(second).toHaveBeenCalledTimes(2);
  });
});
