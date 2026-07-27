import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../core/bus';
import { createInitialState, createStore } from '../core/store';
import { createControls } from './controls';

const setup = () => {
  const store = createStore(createInitialState());
  const bus = createBus();
  const controls = createControls({ store, bus });
  return { store, bus, controls };
};

const labelled = (controls: { el: HTMLElement }, label: string): HTMLButtonElement => {
  const found = controls.el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`no ${label} button`);
  return found;
};

describe('createControls', () => {
  it('labels every row', () => {
    const { controls } = setup();
    const labels = [...controls.el.querySelectorAll('.dv-control__label')].map(
      (label) => label.textContent,
    );
    expect(labels).toEqual(['View', 'Wrap', 'Theme']);
    controls.destroy();
  });

  it('reflects and drives the view mode and wrap flags', () => {
    const { store, controls } = setup();
    expect(labelled(controls, 'Split view').getAttribute('aria-pressed')).toBe('true');

    labelled(controls, 'Unified view').click();
    expect(store.get().view).toBe('unified');
    expect(labelled(controls, 'Unified view').getAttribute('aria-pressed')).toBe('true');
    expect(labelled(controls, 'Split view').getAttribute('aria-pressed')).toBe('false');

    const wrap = labelled(controls, 'Wrap long lines');
    expect(wrap.textContent).toBe('off');
    wrap.click();
    expect(store.get().wrap).toBe(true);
    expect(wrap.getAttribute('aria-pressed')).toBe('true');
    expect(wrap.textContent).toBe('on');
    controls.destroy();
  });

  it('offers every flavor plus auto and emits theme:set', () => {
    const { bus, controls } = setup();
    const emitted = vi.fn();
    bus.on('theme:set', emitted);

    const select = controls.el.querySelector<HTMLSelectElement>('.dv-select');
    expect([...(select?.options ?? [])].map((option) => option.value)).toEqual([
      'latte',
      'frappe',
      'macchiato',
      'mocha',
      'auto',
    ]);

    if (select) {
      select.value = 'latte';
      select.dispatchEvent(new Event('change'));
    }
    expect(emitted).toHaveBeenCalledWith('latte');
    controls.destroy();
  });

  it('drops every listener and subscription on destroy', () => {
    const { store, bus, controls } = setup();
    const emitted = vi.fn();
    bus.on('theme:set', emitted);
    controls.destroy();

    labelled(controls, 'Unified view').click();
    labelled(controls, 'Wrap long lines').click();
    const select = controls.el.querySelector<HTMLSelectElement>('.dv-select');
    if (select) {
      select.value = 'mocha';
      select.dispatchEvent(new Event('change'));
    }
    store.set({ view: 'unified' });

    expect(store.get().wrap).toBe(false);
    expect(emitted).not.toHaveBeenCalled();
    expect(labelled(controls, 'Split view').getAttribute('aria-pressed')).toBe('true');
  });
});
