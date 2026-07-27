import type { DiffLineAnnotation, LineAnnotation } from '@pierre/diffs';
import type {
  AnnotationSide,
  Anchor,
  Comment,
  CommentStatus,
  NewCommentRequest,
} from '../api/types';
import type { LineRange } from '../core/store';

export const FILE_LEVEL_LINE = 0;
export const DEFAULT_SIDE: AnnotationSide = 'additions';

export interface Thread {
  kind: 'thread';
  id: string;
  fileId: string;
  path: string;
  side: AnnotationSide;
  lineNumber: number;
  startLine: number;
  endLine: number;
  status: CommentStatus;
  stale: boolean;
  pending: boolean;
  comment: Comment;
}

/** A comment being written, anchored to the range the user has selected. */
export interface Draft {
  kind: 'draft';
  key: string;
  fileId: string;
  side: AnnotationSide;
  lineNumber: number;
  range: LineRange;
}

/** Everything the diff renders under a line: saved comments, then the draft. */
export type Card = Thread | Draft;

export type CardAnnotation = DiffLineAnnotation<Card[]>;
export type CardLineAnnotation = LineAnnotation<Card[]>;

const sideOf = (anchor: Anchor): AnnotationSide =>
  anchor.side === 'deletions' ? 'deletions' : DEFAULT_SIDE;

const positiveLine = (value: number): number =>
  Number.isSafeInteger(value) && value >= 1 ? value : FILE_LEVEL_LINE;

export const anchorLineNumber = (anchor: Anchor): number =>
  positiveLine(anchor.endLine) || positiveLine(anchor.startLine);

export const threadFor = (fileId: string, comment: Comment, pending = false): Thread => {
  const anchor = comment.anchor;
  const endLine = anchorLineNumber(anchor);
  return {
    kind: 'thread',
    id: comment.id,
    fileId,
    path: anchor.path,
    side: sideOf(anchor),
    lineNumber: endLine,
    startLine: positiveLine(anchor.startLine) || endLine,
    endLine,
    status: comment.status,
    stale: comment.resolvedAnchor?.stale === true,
    pending,
    comment,
  };
};

export const isAnchored = (thread: Thread): boolean => !thread.stale;

export const anchoredThreads = (threads: readonly Thread[]): Thread[] =>
  threads.filter(isAnchored);

export const unanchoredThreads = (threads: readonly Thread[]): Thread[] =>
  threads.filter((thread) => thread.stale);

const annotationKey = (side: AnnotationSide, lineNumber: number): string =>
  `${side}:${lineNumber}`;

export const annotationsFor = (
  threads: readonly Thread[],
  draft: Draft | null = null,
): CardAnnotation[] => {
  const grouped = new Map<string, CardAnnotation>();
  const bucket = (side: AnnotationSide, lineNumber: number): CardAnnotation => {
    const key = annotationKey(side, lineNumber);
    const existing = grouped.get(key);
    if (existing) return existing;
    const created: CardAnnotation = { side, lineNumber, metadata: [] };
    grouped.set(key, created);
    return created;
  };

  for (const thread of anchoredThreads(threads)) {
    bucket(thread.side, thread.lineNumber).metadata.push(thread);
  }
  // The draft trails whatever is already anchored to the same line.
  if (draft) bucket(draft.side, draft.lineNumber).metadata.push(draft);

  return [...grouped.values()].sort(
    (left, right) =>
      left.lineNumber - right.lineNumber || left.side.localeCompare(right.side),
  );
};

export const lineAnnotationsFor = (
  annotations: readonly CardAnnotation[],
): CardLineAnnotation[] => {
  const grouped = new Map<number, CardLineAnnotation>();
  for (const annotation of annotations) {
    const existing = grouped.get(annotation.lineNumber);
    if (existing) {
      existing.metadata.push(...annotation.metadata);
      continue;
    }
    grouped.set(annotation.lineNumber, {
      lineNumber: annotation.lineNumber,
      metadata: [...annotation.metadata],
    });
  }
  return [...grouped.values()].sort((left, right) => left.lineNumber - right.lineNumber);
};

export const threadsFrom = (
  annotations: readonly (CardAnnotation | CardLineAnnotation)[],
): Thread[] =>
  annotations.flatMap((annotation) =>
    annotation.metadata.filter((card): card is Thread => card.kind === 'thread'),
  );

const cardSignature = (card: Card): string =>
  card.kind === 'draft'
    ? `draft:${card.key}`
    : `${card.id}:${card.status}:${card.comment.updatedAt}:${card.comment.replies.length}`;

export const annotationSignature = (annotations: readonly CardAnnotation[]): string =>
  annotations
    .flatMap((annotation) =>
      annotation.metadata.map(
        (card) => `${annotation.side}:${annotation.lineNumber}:${cardSignature(card)}`,
      ),
    )
    .join('|');

export const rangeFor = (thread: Thread): LineRange => ({
  start: thread.startLine,
  end: thread.endLine,
  side: thread.side,
  endSide: thread.side,
});

export const sideOfRange = (range: LineRange): AnnotationSide =>
  range.endSide === 'deletions' || (range.endSide === undefined && range.side === 'deletions')
    ? 'deletions'
    : DEFAULT_SIDE;

export const requestAnchorFor = (
  path: string,
  range: LineRange,
): NewCommentRequest['anchor'] => {
  const forward = range.end >= range.start;
  return {
    path,
    side: sideOfRange(range),
    startLine: forward ? range.start : range.end,
    endLine: forward ? range.end : range.start,
  };
};

export const draftKeyFor = (fileId: string, range: LineRange): string =>
  `${fileId}:${sideOfRange(range)}:${Math.min(range.start, range.end)}-${Math.max(range.start, range.end)}`;

/** Anchors the draft to the last selected line, the same place a saved comment lands. */
export const draftFor = (fileId: string, range: LineRange): Draft => ({
  kind: 'draft',
  key: draftKeyFor(fileId, range),
  fileId,
  side: sideOfRange(range),
  lineNumber: Math.max(range.start, range.end),
  range,
});
