import { describe, expect, it } from 'vitest';
import type { BusEvents } from '../core/bus';
import { createBus } from '../core/bus';
import { el } from '../core/dom';
import { createInitialState, createStore } from '../core/store';
import { createKeybinds } from './keybinds';

const press = (key: string, target?: HTMLElement): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  (target ?? document.body).dispatchEvent(event);
  return event;
};

const setup = () => {
  const store = createStore(createInitialState());
  const bus = createBus();
  const seen: [keyof BusEvents, unknown][] = [];
  const record = (type: keyof BusEvents): void => {
    bus.on(type, (payload) => seen.push([type, payload]));
  };
  for (const type of [
    'file:step',
    'hunk:step',
    'filter:focus',
    'theme:cycle',
    'draft:focus',
    'comment:step',
    'panel:toggle',
    'help:toggle',
    'overlay:dismiss',
  ] as (keyof BusEvents)[]) {
    record(type);
  }
  const keybinds = createKeybinds({ store, bus, target: document });
  return { store, bus, seen, keybinds };
};

describe('createKeybinds', () => {
  it('emits navigation intents on the bus', () => {
    const { seen, keybinds } = setup();
    press('j');
    press('k');
    press(']');
    press('[');
    expect(seen).toEqual([
      ['file:step', { delta: 1 }],
      ['file:step', { delta: -1 }],
      ['hunk:step', { delta: 1 }],
      ['hunk:step', { delta: -1 }],
    ]);
    keybinds.destroy();
  });

  it('emits the remaining chrome intents', () => {
    const { seen, keybinds } = setup();
    press('/');
    press('t');
    press('n');
    press('p');
    press('g');
    press('?');
    expect(seen.map(([type]) => type)).toEqual([
      'filter:focus',
      'theme:cycle',
      'comment:step',
      'comment:step',
      'panel:toggle',
      'help:toggle',
    ]);
    keybinds.destroy();
  });

  it('moves into the comment box only when a selection exists', () => {
    const { store, seen, keybinds } = setup();
    press('c');
    expect(seen).toEqual([]);
    expect(store.get().composing).toBeNull();

    const selection = { id: 'f1', range: { start: 2, end: 4, side: 'additions' as const } };
    store.set({ selection });
    press('c');
    expect(seen).toEqual([['draft:focus', undefined]]);
    expect(store.get().composing).toEqual(selection);
    keybinds.destroy();
  });

  it('prevents default for handled keys only', () => {
    const { keybinds } = setup();
    expect(press('j').defaultPrevented).toBe(true);
    expect(press('z').defaultPrevented).toBe(false);
    keybinds.destroy();
  });

  it('ignores keys while a text input has focus', () => {
    const { seen, keybinds } = setup();
    const input = el('input', { type: 'search' });
    document.body.appendChild(input);
    input.focus();

    press('j', input);
    press('/', input);
    press('?', input);
    expect(seen).toEqual([]);

    press('Escape', input);
    expect(seen).toEqual([['overlay:dismiss', undefined]]);

    input.remove();
    keybinds.destroy();
  });

  it('ignores modified key presses', () => {
    const { seen, keybinds } = setup();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true }));
    expect(seen).toEqual([]);
    keybinds.destroy();
  });

  it('stops handling keys after destroy', () => {
    const { seen, keybinds } = setup();
    keybinds.destroy();
    press('j');
    expect(seen).toEqual([]);
  });
});
