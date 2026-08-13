import { describe, expect, it } from 'vitest';
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

describe('createPointerKind', () => {
  it('reads the pointer the page is being read with', () => {
    const store = createStore(createInitialState());
    createPointerKind({ store, media: fakeMedia(true).media });

    expect(store.get().coarse).toBe(true);
  });

  it('follows a pointer that changes under it', () => {
    const store = createStore(createInitialState());
    const query = fakeMedia(false);
    createPointerKind({ store, media: query.media });

    query.swap(true);

    expect(store.get().coarse).toBe(true);
  });

  it('stops following after destroy', () => {
    const store = createStore(createInitialState());
    const query = fakeMedia(false);
    createPointerKind({ store, media: query.media }).destroy();

    query.swap(true);

    expect(store.get().coarse).toBe(false);
  });

  it('is never coarse without matchMedia', () => {
    const store = createStore(createInitialState());
    createPointerKind({ store, media: null });

    expect(store.get().coarse).toBe(false);
  });
});
