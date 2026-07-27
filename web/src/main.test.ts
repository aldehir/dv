import { describe, expect, it, vi } from 'vitest';

describe('boot', () => {
  it('renders the shell against an unreachable api', async () => {
    document.body.replaceChildren();
    const host = document.createElement('div');
    host.id = 'app';
    document.body.appendChild(host);
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('failed to fetch');
    });

    await import('./main');
    await vi.waitFor(() => {
      expect(host.querySelector('.dv-shell')).not.toBeNull();
    });

    expect(document.documentElement.dataset.flavor).toBe('mocha');
    expect(host.querySelector('.dv-toolbar')).not.toBeNull();
    expect(host.querySelector('.dv-tree__filter')).not.toBeNull();
    expect(host.querySelector('.dv-status')).not.toBeNull();
    expect(host.querySelector('#dv-diff')).not.toBeNull();

    await vi.waitFor(() => {
      expect(host.querySelector('.dv-shell__placeholder')?.textContent).toBe(
        'dv server is unreachable',
      );
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
    await vi.waitFor(() => {
      expect(host.querySelector('.dv-overlay')?.hasAttribute('hidden')).toBe(false);
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.querySelector('.dv-overlay')?.hasAttribute('hidden')).toBe(true);
  });
});
