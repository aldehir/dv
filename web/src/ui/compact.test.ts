import { describe, expect, it } from 'vitest';
import type { Session } from '../api/types';
import { createInitialState, createStore } from '../core/store';
import { createCompactLayout } from './compact';

/** A `MediaQueryList` the test moves by hand. */
const fakeMedia = (matches: boolean) => {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  };
  return {
    media: media as unknown as MediaQueryList,
    resize(next: boolean) {
      media.matches = next;
      for (const listener of [...listeners]) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    },
  };
};

const session = (view: Session['defaults']['view']): Session => ({
  repoRoot: '/repo',
  head: 'abc1234',
  spec: { kind: 'worktree', left: '', right: '', argv: [] },
  argv: [],
  comments: false,
  defaults: { view, wrap: false, theme: 'auto' },
});

describe('createCompactLayout', () => {
  it('opens a narrow window unified with the tree away', () => {
    const store = createStore(createInitialState());
    createCompactLayout({ store, media: fakeMedia(true).media });

    expect(store.get()).toMatchObject({
      compact: true,
      view: 'unified',
      sidebarVisible: false,
    });
  });

  it('leaves a wide window alone', () => {
    const store = createStore(createInitialState());
    createCompactLayout({ store, media: fakeMedia(false).media });

    expect(store.get()).toMatchObject({
      compact: false,
      view: 'split',
      sidebarVisible: true,
    });
  });

  it('keeps the diff unified when the session defaults land', () => {
    const store = createStore(createInitialState());
    createCompactLayout({ store, media: fakeMedia(true).media });

    // What the loader does with the session response.
    store.set({ session: session('split'), view: 'split' });

    expect(store.get().view).toBe('unified');
  });

  it('puts the wide layout back, session defaults and all', () => {
    const store = createStore(createInitialState());
    const query = fakeMedia(true);
    createCompactLayout({ store, media: query.media });
    store.set({ session: session('split'), view: 'split' });

    query.resize(false);

    expect(store.get()).toMatchObject({
      compact: false,
      view: 'split',
      sidebarVisible: true,
    });
  });

  it('does not force a choice made while narrow', () => {
    const store = createStore(createInitialState());
    const query = fakeMedia(true);
    createCompactLayout({ store, media: query.media });

    store.set({ view: 'split', sidebarVisible: true });

    expect(store.get()).toMatchObject({ view: 'split', sidebarVisible: true });
  });

  it('is never compact without matchMedia', () => {
    const store = createStore(createInitialState());
    createCompactLayout({ store, media: null });

    expect(store.get().compact).toBe(false);
  });
});
