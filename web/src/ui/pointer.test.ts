import { describe, expect, it } from 'vitest';
import type { Session } from '../api/types';
import { createInitialState, createStore } from '../core/store';
import { createPointerKind } from './pointer';

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
    swap(next: boolean) {
      media.matches = next;
      for (const listener of [...listeners]) listener({ matches: next } as MediaQueryListEvent);
    },
  };
};

const session = (wrap: boolean): Session => ({
  repoRoot: '/repo',
  head: 'abc1234',
  spec: { kind: 'worktree', left: '', right: '', argv: [] },
  argv: [],
  comments: false,
  defaults: { view: 'split', wrap, theme: 'auto' },
});

describe('createPointerKind', () => {
  it('reads the pointer the page is being read with, wrapped', () => {
    const store = createStore(createInitialState());
    createPointerKind({ store, media: fakeMedia(true).media });

    expect(store.get()).toMatchObject({ coarse: true, wrap: true });
  });

  it('leaves a mouse alone', () => {
    const store = createStore(createInitialState());
    createPointerKind({ store, media: fakeMedia(false).media });

    expect(store.get()).toMatchObject({ coarse: false, wrap: false });
  });

  it('follows a pointer that changes under it', () => {
    const store = createStore(createInitialState());
    const query = fakeMedia(false);
    createPointerKind({ store, media: query.media });

    query.swap(true);

    expect(store.get()).toMatchObject({ coarse: true, wrap: true });
  });

  it('stays wrapped when the session defaults land', () => {
    const store = createStore(createInitialState());
    createPointerKind({ store, media: fakeMedia(true).media });

    // What the loader does with the session response.
    store.set({ session: session(false), wrap: false });

    expect(store.get().wrap).toBe(true);
  });

  it('puts the mouse layout back, session defaults and all', () => {
    const store = createStore(createInitialState());
    const query = fakeMedia(true);
    createPointerKind({ store, media: query.media });
    store.set({ session: session(false), wrap: false });

    query.swap(false);

    expect(store.get()).toMatchObject({ coarse: false, wrap: false });
  });

  it('does not force a choice made under a thumb', () => {
    const store = createStore(createInitialState());
    createPointerKind({ store, media: fakeMedia(true).media });

    store.set({ wrap: false });

    expect(store.get().wrap).toBe(false);
  });

  it('stops following after destroy', () => {
    const store = createStore(createInitialState());
    const query = fakeMedia(false);
    createPointerKind({ store, media: query.media }).destroy();

    query.swap(true);

    expect(store.get()).toMatchObject({ coarse: false, wrap: false });
  });

  it('is never coarse without matchMedia', () => {
    const store = createStore(createInitialState());
    createPointerKind({ store, media: null });

    expect(store.get().coarse).toBe(false);
  });
});
