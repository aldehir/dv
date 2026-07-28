import { describe, expect, it } from 'vitest';
import type { AnnotationSide, Comment } from '../api/types';
import {
  FILE_LEVEL_LINE,
  annotationSignature,
  annotationsFor,
  anchoredThreads,
  draftFor,
  draftKeyFor,
  lineAnnotationsFor,
  rangeFor,
  requestAnchorFor,
  sideOfRange,
  threadFor,
  threadsFrom,
  unanchoredThreads,
} from './anchors';

interface CommentOverrides {
  id?: string;
  side?: AnnotationSide;
  startLine?: number;
  endLine?: number;
  updatedAt?: string;
  stale?: boolean;
  path?: string;
  replies?: number;
}

const comment = ({
  id = 'c1',
  side = 'additions',
  startLine = 42,
  endLine = 47,
  updatedAt = '2026-07-26T18:04:11Z',
  stale = false,
  path = 'internal/gitx/blob.go',
  replies = 0,
}: CommentOverrides = {}): Comment => ({
  id,
  createdAt: '2026-07-26T18:00:00Z',
  updatedAt,
  body: 'retries forever',
  anchor: {
    path,
    prevPath: null,
    side,
    startLine,
    endLine,
    blobSha: 'e5f6',
    quote: 'for {',
    contextBefore: [],
    contextAfter: [],
  },
  resolvedAnchor: { stale, movedFrom: null },
  replies: Array.from({ length: replies }, (_ignored, index) => ({
    id: `r${index}`,
    createdAt: '2026-07-26T19:00:00Z',
    body: 'fixed',
  })),
});

describe('threadFor', () => {
  it('anchors to the end line on the comment side', () => {
    const thread = threadFor('f1', comment());
    expect(thread).toMatchObject({
      id: 'c1',
      fileId: 'f1',
      path: 'internal/gitx/blob.go',
      side: 'additions',
      startLine: 42,
      endLine: 47,
      lineNumber: 47,
      stale: false,
      pending: false,
    });
  });

  it('keeps the deletions side for old-side comments', () => {
    expect(threadFor('f1', comment({ side: 'deletions' })).side).toBe('deletions');
  });

  it('treats a zero end line as file level', () => {
    const thread = threadFor('f1', comment({ startLine: 0, endLine: 0 }));
    expect(thread.lineNumber).toBe(FILE_LEVEL_LINE);
    expect(thread.startLine).toBe(FILE_LEVEL_LINE);
  });

  it('marks a stale resolved anchor', () => {
    expect(threadFor('f1', comment({ stale: true })).stale).toBe(true);
  });

  it('treats a missing resolved anchor as anchored', () => {
    const raw = comment();
    delete raw.resolvedAnchor;
    expect(threadFor('f1', raw).stale).toBe(false);
  });
});

describe('annotationsFor', () => {
  it('maps a thread to one annotation keyed by side and end line', () => {
    const annotations = annotationsFor([threadFor('f1', comment())]);
    expect(annotations).toEqual([
      { side: 'additions', lineNumber: 47, metadata: [threadFor('f1', comment())] },
    ]);
  });

  it('is identical for split and unified because it never reads a row index', () => {
    const threads = [
      threadFor('f1', comment({ id: 'a', side: 'additions', startLine: 3, endLine: 9 })),
      threadFor('f1', comment({ id: 'b', side: 'deletions', startLine: 3, endLine: 3 })),
    ];
    const first = annotationsFor(threads);
    const second = annotationsFor([...threads].reverse());

    expect(first.map((entry) => `${entry.side}:${entry.lineNumber}`)).toEqual([
      'deletions:3',
      'additions:9',
    ]);
    expect(second.map((entry) => `${entry.side}:${entry.lineNumber}`)).toEqual([
      'deletions:3',
      'additions:9',
    ]);
  });

  it('groups several threads landing on the same anchor', () => {
    const annotations = annotationsFor([
      threadFor('f1', comment({ id: 'a' })),
      threadFor('f1', comment({ id: 'b' })),
    ]);
    expect(annotations.length).toBe(1);
    expect(threadsFrom(annotations).map((thread) => thread.id)).toEqual(['a', 'b']);
  });

  it('trails the draft behind whatever already sits on that line', () => {
    const draft = draftFor('f1', { start: 42, end: 47, side: 'additions' });
    const annotations = annotationsFor([threadFor('f1', comment())], draft);

    expect(annotations.length).toBe(1);
    expect(annotations[0]?.metadata.map((card) => card.kind)).toEqual(['thread', 'draft']);
    expect(annotations[0]?.lineNumber).toBe(47);
  });

  it('gives a draft its own annotation when no comment shares the line', () => {
    const draft = draftFor('f1', { start: 3, end: 9, side: 'deletions' });
    const annotations = annotationsFor([], draft);

    expect(annotations).toEqual([{ side: 'deletions', lineNumber: 9, metadata: [draft] }]);
    expect(draft.key).toBe('f1:deletions:3-9');
  });

  it('renders a file-level annotation at line zero', () => {
    const annotations = annotationsFor([
      threadFor('f1', comment({ startLine: 0, endLine: 0 })),
    ]);
    expect(annotations[0]?.lineNumber).toBe(0);
  });

  it('drops stale threads but never loses them', () => {
    const threads = [
      threadFor('f1', comment({ id: 'ok' })),
      threadFor('f1', comment({ id: 'gone', stale: true })),
    ];
    expect(threadsFrom(annotationsFor(threads)).map((thread) => thread.id)).toEqual(['ok']);
    expect(unanchoredThreads(threads).map((thread) => thread.id)).toEqual(['gone']);
    expect(anchoredThreads(threads).map((thread) => thread.id)).toEqual(['ok']);
  });

  it('round-trips through threadsFrom', () => {
    const threads = [
      threadFor('f1', comment({ id: 'a', endLine: 4 })),
      threadFor('f1', comment({ id: 'b', endLine: 9 })),
    ];
    expect(threadsFrom(annotationsFor(threads))).toEqual(threads);
  });
});

describe('lineAnnotationsFor', () => {
  it('collapses both sides of a line for file-type items', () => {
    const merged = lineAnnotationsFor([
      { side: 'additions', lineNumber: 1, metadata: [threadFor('f1', comment({ id: 'a' }))] },
      { side: 'deletions', lineNumber: 1, metadata: [threadFor('f1', comment({ id: 'b' }))] },
      { side: 'additions', lineNumber: 4, metadata: [threadFor('f1', comment({ id: 'c' }))] },
    ]);
    expect(merged.map((entry) => entry.lineNumber)).toEqual([1, 4]);
    expect(threadsFrom(merged.slice(0, 1)).map((thread) => thread.id)).toEqual(['a', 'b']);
  });
});

describe('annotationSignature', () => {
  it('changes when an edit or a reply lands', () => {
    const base = annotationSignature(annotationsFor([threadFor('f1', comment())]));
    const edited = annotationSignature(
      annotationsFor([threadFor('f1', comment({ updatedAt: '2026-07-26T19:00:00Z' }))]),
    );
    const replied = annotationSignature(
      annotationsFor([threadFor('f1', comment({ replies: 1 }))]),
    );
    expect(edited).not.toBe(base);
    expect(replied).not.toBe(base);
  });

  it('changes when the draft box moves', () => {
    const threads = [threadFor('f1', comment())];
    const base = annotationSignature(annotationsFor(threads));
    const drafted = annotationSignature(
      annotationsFor(threads, draftFor('f1', { start: 42, end: 47, side: 'additions' })),
    );
    const moved = annotationSignature(
      annotationsFor(threads, draftFor('f1', { start: 1, end: 1, side: 'additions' })),
    );

    expect(drafted).not.toBe(base);
    expect(moved).not.toBe(drafted);
  });
});

describe('ranges', () => {
  it('rebuilds a selection range from a thread', () => {
    expect(rangeFor(threadFor('f1', comment({ side: 'deletions' })))).toEqual({
      start: 42,
      end: 47,
      side: 'deletions',
      endSide: 'deletions',
    });
  });

  it('defaults an unsided range to additions', () => {
    expect(sideOfRange({ start: 1, end: 2 })).toBe('additions');
    expect(sideOfRange({ start: 1, end: 2, side: 'deletions' })).toBe('deletions');
    expect(sideOfRange({ start: 1, end: 2, side: 'deletions', endSide: 'additions' })).toBe(
      'additions',
    );
  });

  it('normalizes a reversed range into a request anchor', () => {
    expect(requestAnchorFor('a.ts', { start: 9, end: 3, side: 'additions' })).toEqual({
      path: 'a.ts',
      side: 'additions',
      startLine: 3,
      endLine: 9,
    });
  });

  it('keys drafts by file, side and normalized range', () => {
    expect(draftKeyFor('f1', { start: 9, end: 3 })).toBe('f1:additions:3-9');
    expect(draftKeyFor('f1', { start: 3, end: 9 })).toBe('f1:additions:3-9');
  });
});
