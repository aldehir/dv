import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../core/bus';
import { createInitialState, createStore } from '../core/store';
import { AUTO_THEME } from '../theme/catppuccin';
import { FALLBACK_METRICS } from './metrics';
import { HUNK_SEPARATORS, LAYOUT, buildOptions } from './options';

const setup = () => {
  const store = createStore(createInitialState());
  const bus = createBus();
  const renderAnnotation = vi.fn(() => document.createElement('div'));
  const options = () =>
    buildOptions(store.get(), { store, bus, metrics: FALLBACK_METRICS, renderAnnotation });
  return { store, bus, renderAnnotation, options };
};

describe('buildOptions', () => {
  it('mirrors the state onto the code view options', () => {
    const { store, options } = setup();
    store.set({ view: 'unified', wrap: true, commentsEnabled: true, themePref: 'frappe' });
    const built = options();

    expect(built.diffStyle).toBe('unified');
    expect(built.overflow).toBe('wrap');
    expect(built.theme).toBe('catppuccin-frappe');
    expect(built.enableLineSelection).toBe(true);
    expect(built.expandUnchanged).toBe(true);
    expect(built.stickyHeaders).toBe(true);
    expect(built.hunkSeparators).toBe(HUNK_SEPARATORS);
    expect(built.layout).toEqual(LAYOUT);
    expect(built.itemMetrics).toBe(FALLBACK_METRICS);
  });

  it('scrolls rather than wraps by default', () => {
    expect(setup().options().overflow).toBe('scroll');
  });

  it('hands the auto theme pair to the renderer', () => {
    const { store, options } = setup();
    store.set({ themePref: 'auto' });
    expect(options().theme).toBe(AUTO_THEME);
    expect(options().themeType).toBe('system');
  });

  it('never asks for the gutter affordance', () => {
    expect(setup().options().enableGutterUtility).toBeUndefined();
  });

  it('writes the viewer selection into the store and onto the bus', () => {
    const { store, bus, options } = setup();
    const changed = vi.fn();
    bus.on('selection:changed', changed);
    const selection = { id: 'f1', range: { start: 3, end: 9, side: 'additions' as const } };

    options().onSelectedLinesChange?.(selection);

    expect(store.get().selection).toBe(selection);
    expect(store.get().selectedFile).toBe('f1');
    expect(changed).toHaveBeenCalledWith(selection);
  });

  it('keeps the current file when the selection clears', () => {
    const { store, options } = setup();
    store.set({ selectedFile: 'f2' });
    options().onSelectedLinesChange?.(null);
    expect(store.get().selection).toBeNull();
    expect(store.get().selectedFile).toBe('f2');
  });

  it('parks the draft box on a settled selection, not on every drag step', () => {
    const { store, options } = setup();
    const range = { start: 4, end: 6, side: 'additions' as const };

    options().onSelectedLinesChange?.({ id: 'f7', range });
    expect(store.get().composing).toBeNull();

    options().onLineSelected?.(range, { item: { id: 'f7' } } as never);
    expect(store.get().composing).toEqual({ id: 'f7', range });

    options().onLineSelected?.(null, { item: { id: 'f7' } } as never);
    expect(store.get().composing).toBeNull();
  });
});
