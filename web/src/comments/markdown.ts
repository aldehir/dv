import type { Child } from '../core/dom';
import { append, el, frag } from '../core/dom';

const FENCE = /^\s*```(\S*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const RULE = /^\s*(?:[-*_]\s*){3,}$/;

const INLINE =
  /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]]+)\]\(([^)\s]+)\)|<((?:https?|mailto):[^>\s]+)>|((?:https?):\/\/[^\s<>()]+)/g;

const EXTERNAL_SCHEME = /^(?:https?:|mailto:)/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export const safeHref = (raw: string): string | null => {
  const value = raw.trim();
  if (value === '') return null;
  if (EXTERNAL_SCHEME.test(value)) return value;
  if (ANY_SCHEME.test(value)) return null;
  if (value.startsWith('//')) return null;
  return value;
};

const link = (label: string, href: string): Child => {
  const target = safeHref(href);
  if (target === null) return label;
  return el('a', {
    class: 'dv-md__link',
    href: target,
    rel: 'noreferrer noopener',
    target: '_blank',
    textContent: label,
  });
};

export const renderInline = (text: string): DocumentFragment => {
  const nodes: Child[] = [];
  let cursor = 0;
  INLINE.lastIndex = 0;

  for (let match = INLINE.exec(text); match !== null; match = INLINE.exec(text)) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const [
      whole,
      code,
      strongStars,
      strongScores,
      strike,
      emphasisStars,
      emphasisScores,
      label,
      href,
      autolink,
      bare,
    ] = match;

    if (code !== undefined) nodes.push(el('code', { textContent: code }));
    else if (strongStars !== undefined) nodes.push(el('strong', { textContent: strongStars }));
    else if (strongScores !== undefined) nodes.push(el('strong', { textContent: strongScores }));
    else if (strike !== undefined) nodes.push(el('s', { textContent: strike }));
    else if (emphasisStars !== undefined) nodes.push(el('em', { textContent: emphasisStars }));
    else if (emphasisScores !== undefined) nodes.push(el('em', { textContent: emphasisScores }));
    else if (label !== undefined && href !== undefined) nodes.push(link(label, href));
    else if (autolink !== undefined) nodes.push(link(autolink, autolink));
    else if (bare !== undefined) nodes.push(link(bare, bare));
    else nodes.push(whole);

    cursor = match.index + whole.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return frag(...nodes);
};

const listItems = (lines: readonly string[], pattern: RegExp): HTMLLIElement[] =>
  lines.map((line) => {
    const matched = pattern.exec(line);
    return el('li', null, renderInline(matched?.[1] ?? line));
  });

export const renderMarkdown = (source: string): DocumentFragment => {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Child[] = [];
  let index = 0;

  const collect = (pattern: RegExp): string[] => {
    const gathered: string[] = [];
    while (index < lines.length) {
      const line = lines[index];
      if (line === undefined || !pattern.test(line)) break;
      gathered.push(line);
      index += 1;
    }
    return gathered;
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      index += 1;
      const body: string[] = [];
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      const language = fence[1] ?? '';
      blocks.push(
        el(
          'pre',
          { class: 'dv-md__pre', data: language === '' ? {} : { lang: language } },
          el('code', { textContent: body.join('\n') }),
        ),
      );
      continue;
    }

    if (RULE.test(line)) {
      index += 1;
      blocks.push(el('hr', { class: 'dv-md__rule' }));
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      index += 1;
      const level = Math.min((heading[1] ?? '#').length, 6);
      const node = el('div', { class: `dv-md__heading dv-md__heading--${level}` });
      append(node, [renderInline(heading[2] ?? '')]);
      blocks.push(node);
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted = collect(QUOTE).map((entry) => QUOTE.exec(entry)?.[1] ?? '');
      blocks.push(
        el('blockquote', { class: 'dv-md__quote' }, renderInline(quoted.join('\n'))),
      );
      continue;
    }

    if (BULLET.test(line)) {
      blocks.push(el('ul', { class: 'dv-md__list' }, ...listItems(collect(BULLET), BULLET)));
      continue;
    }

    if (ORDERED.test(line)) {
      blocks.push(el('ol', { class: 'dv-md__list' }, ...listItems(collect(ORDERED), ORDERED)));
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const entry = lines[index] ?? '';
      if (
        entry.trim() === '' ||
        FENCE.test(entry) ||
        HEADING.test(entry) ||
        QUOTE.test(entry) ||
        BULLET.test(entry) ||
        ORDERED.test(entry) ||
        RULE.test(entry)
      ) {
        break;
      }
      paragraph.push(entry);
      index += 1;
    }
    blocks.push(el('p', { class: 'dv-md__p' }, renderInline(paragraph.join('\n'))));
  }

  return frag(...blocks);
};
