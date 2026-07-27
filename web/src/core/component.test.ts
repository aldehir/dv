import { describe, expect, it, vi } from 'vitest';
import type { Component, OverlayProps } from './component';
import { createDisposer, createLazyOverlay } from './component';
import { el } from './dom';

describe('createDisposer', () => {
  it('runs every registered unsubscribe once, in reverse order', () => {
    const order: string[] = [];
    const disposer = createDisposer();
    disposer.add(() => order.push('first'));
    disposer.add(() => order.push('second'));

    disposer.dispose();
    disposer.dispose();

    expect(order).toEqual(['second', 'first']);
  });
});

describe('createLazyOverlay', () => {
  const overlay = () => {
    const host = el('div');
    const destroy = vi.fn();
    const updates: boolean[] = [];
    const load = vi.fn(
      async (): Promise<Component<OverlayProps>> => ({
        el: el('div', { class: 'dv-overlay' }),
        update: ({ open }) => updates.push(open),
        destroy,
      }),
    );
    return { host, load, updates, destroy, lazy: createLazyOverlay(host, load) };
  };

  it('does not load the module until first opened', async () => {
    const { host, load, lazy } = overlay();
    expect(load).not.toHaveBeenCalled();
    expect(lazy.isOpen()).toBe(false);

    lazy.toggle();
    await vi.waitFor(() => expect(host.children.length).toBe(1));
    expect(load).toHaveBeenCalledTimes(1);
    expect(lazy.isOpen()).toBe(true);
    lazy.destroy();
  });

  it('loads once and reuses the instance across toggles', async () => {
    const { host, load, updates, lazy } = overlay();
    lazy.open();
    await vi.waitFor(() => expect(host.children.length).toBe(1));

    lazy.close();
    lazy.toggle();
    lazy.toggle();

    expect(load).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([true, false, true, false]);
    lazy.destroy();
  });

  it('removes and destroys the instance on destroy', async () => {
    const { host, destroy, lazy } = overlay();
    lazy.open();
    await vi.waitFor(() => expect(host.children.length).toBe(1));

    lazy.destroy();
    expect(host.children.length).toBe(0);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('discards a module that resolves after destroy', async () => {
    const { host, destroy, lazy } = overlay();
    lazy.open();
    lazy.destroy();
    await vi.waitFor(() => expect(destroy).toHaveBeenCalledTimes(1));
    expect(host.children.length).toBe(0);
  });
});
