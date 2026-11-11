import { describe, expect, it } from 'vitest';
import type { Defaults, Session } from '../api/types';
import { createInitialState, createStore } from '../core/store';
import { createPrefs, type PrefStorage } from './prefs';

const memory = (initial: Record<string, string> = {}): PrefStorage & {
  data: Record<string, string>;
} => {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
};

const session = (defaults: Defaults): Session => ({
  repoRoot: '/repo',
  head: 'abc1234',
  spec: { kind: 'worktree', left: '', right: '', argv: [] },
  argv: [],
  comments: false,
  defaults,
});

describe('createPrefs', () => {
  it('restores the saved settings into the store', () => {
    const store = createStore(createInitialState());
    const prefs = createPrefs({
      store,
      storage: memory({ 'dv:view': 'unified', 'dv:wrap': 'true', 'dv:single-file': 'true' }),
    });

    expect(store.get()).toMatchObject({ view: 'unified', wrap: true, singleFile: true });
    prefs.destroy();
  });

  it('keeps the defaults when nothing sensible is saved', () => {
    const store = createStore(createInitialState());
    const prefs = createPrefs({
      store,
      storage: memory({ 'dv:view': 'sideways', 'dv:wrap': 'yes', 'dv:single-file': '1' }),
    });

    expect(store.get()).toMatchObject({ view: 'split', wrap: false, singleFile: false });
    prefs.destroy();
  });

  it('saves every change, and stops once destroyed', () => {
    const store = createStore(createInitialState());
    const storage = memory();
    const prefs = createPrefs({ store, storage });

    store.set({ view: 'unified', wrap: true, singleFile: true });
    expect(storage.data).toEqual({
      'dv:view': 'unified',
      'dv:wrap': 'true',
      'dv:single-file': 'true',
    });

    prefs.destroy();
    store.set({ view: 'split' });
    expect(storage.data['dv:view']).toBe('unified');
  });

  it('leaves the unified view a narrow window forces out of the saved one', () => {
    const store = createStore(createInitialState());
    const storage = memory({ 'dv:view': 'split' });
    const prefs = createPrefs({ store, storage });

    store.set({ compact: true, view: 'unified' });
    expect(storage.data['dv:view']).toBe('split');

    store.set({ compact: false, view: 'split' });
    expect(storage.data['dv:view']).toBe('split');
    prefs.destroy();
  });

  it('lets a flag outrank the remembered setting without saving over it', () => {
    const store = createStore(createInitialState());
    const storage = memory({ 'dv:view': 'split', 'dv:wrap': 'true' });
    const prefs = createPrefs({ store, storage });

    store.set({ session: session({ theme: '', view: 'unified', wrap: null }) });
    expect(store.get()).toMatchObject({ view: 'unified', wrap: true });
    expect(storage.data).toEqual({ 'dv:view': 'split', 'dv:wrap': 'true' });

    // Picked by hand afterwards, it is the reader's choice again.
    store.set({ view: 'split' });
    store.set({ view: 'unified' });
    expect(storage.data['dv:view']).toBe('unified');
    prefs.destroy();
  });

  it('keeps the remembered settings when the session asks for nothing', () => {
    const store = createStore(createInitialState());
    const prefs = createPrefs({ store, storage: memory({ 'dv:view': 'unified' }) });

    store.set({ session: session({ theme: '', view: '', wrap: null }) });
    expect(store.get()).toMatchObject({ view: 'unified', wrap: false });
    prefs.destroy();
  });

  it('carries on without storage, or with storage that throws', () => {
    const store = createStore(createInitialState());
    const broken: PrefStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };

    const none = createPrefs({ store, storage: null });
    const throwing = createPrefs({ store, storage: broken });
    expect(() => store.set({ wrap: true, singleFile: true })).not.toThrow();
    none.destroy();
    throwing.destroy();
  });
});
