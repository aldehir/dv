import { describe, expect, it, vi } from 'vitest';
import { append, clear, el, frag, isTextEntry, on, replaceChildren } from './dom';

const PAYLOAD = '<img src=x onerror="window.pwned = true">';

describe('el', () => {
  it('sets class, dataset and properties', () => {
    const node = el('button', {
      class: 'dv-btn',
      type: 'button',
      textContent: 'go',
      data: { fileId: 'f1', kind: 'row' },
    });
    expect(node.className).toBe('dv-btn');
    expect(node.type).toBe('button');
    expect(node.textContent).toBe('go');
    expect(node.dataset.fileId).toBe('f1');
    expect(node.getAttribute('data-kind')).toBe('row');
  });

  it('appends nodes, strings and numbers while skipping empty children', () => {
    const node = el('div', null, 'a', 1, null, undefined, false, el('span'));
    expect(node.childNodes.length).toBe(3);
    expect(node.textContent).toBe('a1');
    expect(node.querySelector('span')).not.toBeNull();
  });

  it('escapes repo-derived text children instead of parsing markup', () => {
    const node = el('div', null, PAYLOAD);
    expect(node.querySelector('img')).toBeNull();
    expect(node.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
    expect(node.textContent).toBe(PAYLOAD);
    expect(node.innerHTML).toContain('&lt;img');
  });

  it('escapes markup passed through textContent', () => {
    const node = el('span', { textContent: PAYLOAD });
    expect(node.children.length).toBe(0);
    expect(node.textContent).toBe(PAYLOAD);
  });

  it('escapes markup passed through data and title attributes', () => {
    const node = el('div', { title: PAYLOAD, data: { path: PAYLOAD } });
    expect(node.getAttribute('title')).toBe(PAYLOAD);
    expect(node.dataset.path).toBe(PAYLOAD);
    expect(node.children.length).toBe(0);
  });

  it('never runs injected scripts through the dom layer', () => {
    const host = el('div', null, el('span', { textContent: '<script>bad()</script>' }));
    document.body.appendChild(host);
    expect(host.querySelector('script')).toBeNull();
    host.remove();
  });
});

describe('frag, append, clear and replaceChildren', () => {
  it('builds a fragment of children', () => {
    const fragment = frag('a', el('b'));
    expect(fragment.childNodes.length).toBe(2);
  });

  it('appends into an existing node', () => {
    const node = el('div');
    append(node, ['a', el('i')]);
    expect(node.childNodes.length).toBe(2);
  });

  it('clears and replaces children', () => {
    const node = el('div', null, 'a', 'b');
    clear(node);
    expect(node.childNodes.length).toBe(0);
    replaceChildren(node, 'c');
    expect(node.textContent).toBe('c');
    replaceChildren(node, PAYLOAD);
    expect(node.querySelector('img')).toBeNull();
  });
});

describe('on', () => {
  it('returns an unsubscribe that removes the listener', () => {
    const node = el('button');
    const handler = vi.fn();
    const off = on(node, 'click', handler);

    node.click();
    expect(handler).toHaveBeenCalledTimes(1);

    off();
    node.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('works with document targets', () => {
    const handler = vi.fn();
    const off = on(document, 'keydown', handler);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('isTextEntry', () => {
  it('detects text entry targets', () => {
    expect(isTextEntry(el('input'))).toBe(true);
    expect(isTextEntry(el('textarea'))).toBe(true);
    expect(isTextEntry(el('select'))).toBe(true);
    expect(isTextEntry(el('div'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
