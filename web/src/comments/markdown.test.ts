import { describe, expect, it } from 'vitest';
import { renderInline, renderMarkdown, safeHref } from './markdown';

const host = (source: string): HTMLElement => {
  const node = document.createElement('div');
  node.appendChild(renderMarkdown(source));
  return node;
};

describe('renderMarkdown', () => {
  it('never parses raw markup', () => {
    const node = host('<img src=x onerror="alert(1)">\n<script>alert(2)</script>');
    expect(node.querySelector('img')).toBeNull();
    expect(node.querySelector('script')).toBeNull();
    expect(node.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('renders emphasis, strong, strike and inline code', () => {
    const node = host('**bold** _em_ ~~gone~~ `code`');
    expect(node.querySelector('strong')?.textContent).toBe('bold');
    expect(node.querySelector('em')?.textContent).toBe('em');
    expect(node.querySelector('s')?.textContent).toBe('gone');
    expect(node.querySelector('code')?.textContent).toBe('code');
  });

  it('renders a fenced code block verbatim', () => {
    const node = host('```go\nif err != nil {\n\treturn err\n}\n```');
    const pre = node.querySelector('pre');
    expect(pre?.dataset.lang).toBe('go');
    expect(pre?.querySelector('code')?.textContent).toBe('if err != nil {\n\treturn err\n}');
  });

  it('renders headings, quotes, lists and rules', () => {
    const node = host('## Title\n\n> quoted\n\n- one\n- two\n\n1. first\n\n---');
    expect(node.querySelector('.dv-md__heading--2')?.textContent).toBe('Title');
    expect(node.querySelector('blockquote')?.textContent).toBe('quoted');
    expect([...node.querySelectorAll('ul li')].map((item) => item.textContent)).toEqual([
      'one',
      'two',
    ]);
    expect(node.querySelector('ol li')?.textContent).toBe('first');
    expect(node.querySelector('hr')).not.toBeNull();
  });

  it('groups consecutive lines into one paragraph', () => {
    const node = host('one\ntwo\n\nthree');
    expect([...node.querySelectorAll('p')].map((entry) => entry.textContent)).toEqual([
      'one\ntwo',
      'three',
    ]);
  });

  it('links http targets and autolinks', () => {
    const node = host('[docs](https://diffs.com) and https://example.com/x');
    const links = [...node.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://diffs.com',
      'https://example.com/x',
    ]);
    expect(links[0]?.rel).toBe('noreferrer noopener');
  });

  it('refuses to link a dangerous scheme', () => {
    const node = host('[click](javascript:alert(1))');
    expect(node.querySelector('a')).toBeNull();
    expect(node.textContent).toContain('click');
  });
});

describe('safeHref', () => {
  it('accepts http, https, mailto and relative targets', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('./docs/a.md')).toBe('./docs/a.md');
  });

  it('rejects other schemes, protocol-relative urls and blanks', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>')).toBeNull();
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('   ')).toBeNull();
  });
});

describe('renderInline', () => {
  it('keeps plain text intact', () => {
    const node = document.createElement('div');
    node.appendChild(renderInline('a < b && c > d'));
    expect(node.textContent).toBe('a < b && c > d');
    expect(node.childElementCount).toBe(0);
  });
});
