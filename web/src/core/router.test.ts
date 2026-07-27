import { describe, expect, it, vi } from 'vitest';
import { createBus } from './bus';
import { createRouter, formatHash, parseHash } from './router';
import { createInitialState, createStore } from './store';

describe('parseHash', () => {
  it('returns null for an empty hash', () => {
    expect(parseHash('')).toBeNull();
    expect(parseHash('#')).toBeNull();
  });

  it('parses a file-only hash', () => {
    expect(parseHash('#internal%2Fgitx%2Fblob.go')).toEqual({
      fileId: 'internal/gitx/blob.go',
      range: null,
    });
  });

  it('parses a single line on the additions side', () => {
    expect(parseHash('#f1:L42')).toEqual({
      fileId: 'f1',
      range: { start: 42, end: 42, side: 'additions', endSide: 'additions' },
    });
  });

  it('parses a range', () => {
    expect(parseHash('#f1:L10-L24')).toEqual({
      fileId: 'f1',
      range: { start: 10, end: 24, side: 'additions', endSide: 'additions' },
    });
  });

  it('parses the deletions side', () => {
    expect(parseHash('#f1:D3-D9')).toEqual({
      fileId: 'f1',
      range: { start: 3, end: 9, side: 'deletions', endSide: 'deletions' },
    });
  });

  it('parses a range that crosses sides', () => {
    expect(parseHash('#f1:D3-L9')).toEqual({
      fileId: 'f1',
      range: { start: 3, end: 9, side: 'deletions', endSide: 'additions' },
    });
  });

  it('normalises a reversed range', () => {
    expect(parseHash('#f1:L24-D10')).toEqual({
      fileId: 'f1',
      range: { start: 10, end: 24, side: 'deletions', endSide: 'additions' },
    });
  });

  it('recovers from malformed ranges by keeping the file', () => {
    expect(parseHash('#f1:L')).toEqual({ fileId: 'f1:L', range: null });
    expect(parseHash('#f1:garbage')).toEqual({ fileId: 'f1:garbage', range: null });
    expect(parseHash('#f1:L0')).toEqual({ fileId: 'f1', range: null });
    expect(parseHash('#f1:X1-X2')).toEqual({ fileId: 'f1:X1-X2', range: null });
    expect(parseHash('#f1:L99999999999999999999')).toEqual({
      fileId: 'f1',
      range: null,
    });
  });

  it('tolerates broken percent encoding', () => {
    expect(parseHash('#%E0%A4%A')).toEqual({ fileId: '%E0%A4%A', range: null });
  });

  it('keeps colons that belong to the file id', () => {
    expect(parseHash('#dv:abc')).toEqual({ fileId: 'dv:abc', range: null });
  });
});

describe('formatHash', () => {
  it('serialises nothing for a null target', () => {
    expect(formatHash(null)).toBe('');
  });

  it('serialises file-only and ranged targets', () => {
    expect(formatHash({ fileId: 'a/b.go', range: null })).toBe('#a%2Fb.go');
    expect(
      formatHash({ fileId: 'f1', range: { start: 5, end: 5, side: 'additions' } }),
    ).toBe('#f1:L5');
    expect(
      formatHash({ fileId: 'f1', range: { start: 5, end: 8, side: 'deletions' } }),
    ).toBe('#f1:D5-D8');
    expect(
      formatHash({
        fileId: 'f1',
        range: { start: 5, end: 8, side: 'deletions', endSide: 'additions' },
      }),
    ).toBe('#f1:D5-L8');
  });

  it('defaults a missing side to additions', () => {
    expect(formatHash({ fileId: 'f1', range: { start: 1, end: 2 } })).toBe('#f1:L1-L2');
  });

  it('round-trips every supported form', () => {
    for (const hash of ['#f1', '#f1:L10', '#f1:L10-L24', '#f1:D3-L9', '#a%2Fb.go:L1']) {
      expect(formatHash(parseHash(hash))).toBe(hash);
    }
  });
});

describe('createRouter', () => {
  const withHash = (hash: string): void => {
    window.history.replaceState(null, '', `/${hash}`);
  };

  it('applies the hash to the store once the manifest lands', () => {
    withHash('#f2:L4-L6');
    const store = createStore(createInitialState());
    const bus = createBus();
    const selected = vi.fn();
    bus.on('file:selected', selected);
    const router = createRouter({ store, bus });

    store.set({
      manifest: {
        files: [
          { id: 'f1' },
          { id: 'f2' },
        ] as never,
        totals: { files: 2, additions: 0, deletions: 0 },
      },
    });

    expect(store.get().selectedFile).toBe('f2');
    expect(store.get().selection).toEqual({
      id: 'f2',
      range: { start: 4, end: 6, side: 'additions', endSide: 'additions' },
    });
    expect(selected).toHaveBeenCalledWith({ id: 'f2', reveal: true });
    router.destroy();
  });

  it('ignores a hash pointing at an unknown file', () => {
    withHash('#nope:L1');
    const store = createStore(createInitialState());
    const bus = createBus();
    const router = createRouter({ store, bus });

    store.set({
      manifest: {
        files: [{ id: 'f1' }] as never,
        totals: { files: 1, additions: 0, deletions: 0 },
      },
    });

    expect(store.get().selectedFile).toBeNull();
    router.destroy();
  });

  it('writes the hash when a selection changes', () => {
    withHash('');
    const store = createStore(createInitialState());
    const bus = createBus();
    const router = createRouter({ store, bus });

    bus.emit('selection:changed', {
      id: 'f1',
      range: { start: 2, end: 4, side: 'additions', endSide: 'additions' },
    });
    expect(window.location.hash).toBe('#f1:L2-L4');

    bus.emit('selection:changed', null);
    expect(window.location.hash).toBe('');
    router.destroy();
  });

  it('stops writing the hash after destroy', () => {
    withHash('');
    const store = createStore(createInitialState());
    const bus = createBus();
    const router = createRouter({ store, bus });
    router.destroy();

    bus.emit('selection:changed', { id: 'f1', range: { start: 1, end: 1 } });
    expect(window.location.hash).toBe('');
  });
});
