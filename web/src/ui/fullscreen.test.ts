import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../core/bus';
import { createInitialState, createStore } from '../core/store';
import { createFullscreen } from './fullscreen';

/** jsdom has no fullscreen API at all, so the whole of it is stood up here. */
const setup = (supported = true) => {
  const requests: string[] = [];
  const target = {
    requestFullscreen: supported
      ? vi.fn(() => {
          Object.assign(doc, { fullscreenElement: target });
          requests.push('enter');
          return Promise.resolve();
        })
      : undefined,
  } as unknown as Element;

  const listeners = new Set<() => void>();
  const doc = {
    fullscreenElement: null as unknown,
    exitFullscreen: supported
      ? vi.fn(() => {
          doc.fullscreenElement = null;
          requests.push('leave');
          return Promise.resolve();
        })
      : undefined,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };

  const store = createStore(createInitialState());
  const bus = createBus();
  const component = createFullscreen({
    store,
    bus,
    target,
    document: doc as unknown as Document,
  });

  return {
    store,
    bus,
    component,
    requests,
    /** What the browser fires when it enters or leaves on its own. */
    fire: () => {
      for (const listener of [...listeners]) listener();
    },
    leaveOutsideTheApp: () => {
      doc.fullscreenElement = null;
      for (const listener of [...listeners]) listener();
    },
  };
};

describe('createFullscreen', () => {
  it('folds the chrome away and asks the browser to follow', () => {
    const it0 = setup();

    it0.bus.emit('fullscreen:toggle');
    expect(it0.store.get().fullscreen).toBe(true);
    expect(it0.requests).toEqual(['enter']);
    expect(it0.component.el.hidden).toBe(false);

    it0.bus.emit('fullscreen:toggle');
    expect(it0.store.get().fullscreen).toBe(false);
    expect(it0.requests).toEqual(['enter', 'leave']);
    expect(it0.component.el.hidden).toBe(true);
    it0.component.destroy();
  });

  it('is the way back out under a thumb', () => {
    const it0 = setup();
    it0.store.set({ fullscreen: true });

    it0.component.el.click();

    expect(it0.store.get().fullscreen).toBe(false);
    it0.component.destroy();
  });

  it('folds the chrome away where there is no fullscreen to ask for', () => {
    const it0 = setup(false);

    it0.bus.emit('fullscreen:toggle');

    expect(it0.store.get().fullscreen).toBe(true);
    expect(it0.component.el.hidden).toBe(false);
    it0.component.destroy();
  });

  it('puts the chrome back when the browser leaves on its own', () => {
    const it0 = setup();
    it0.store.set({ fullscreen: true });

    it0.leaveOutsideTheApp();

    expect(it0.store.get().fullscreen).toBe(false);
    it0.component.destroy();
  });

  it('drops every subscription on destroy', () => {
    const it0 = setup();
    it0.component.destroy();

    it0.bus.emit('fullscreen:toggle');

    expect(it0.store.get().fullscreen).toBe(false);
    expect(it0.requests).toEqual([]);
  });
});
