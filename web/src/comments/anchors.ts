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

export type ThreadAnnotation = DiffLineAnnotation<Thread[]>;
export type ThreadLineAnnotation = LineAnnotation<Thread[]>;

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

export const annotationsFor = (threads: readonly Thread[]): ThreadAnnotation[] => {
  const grouped = new Map<string, ThreadAnnotation>();
  for (const thread of anchoredThreads(threads)) {
    const key = annotationKey(thread.side, thread.lineNumber);
    const existing = grouped.get(key);
    if (existing) {
      existing.metadata.push(thread);
      continue;
    }
    grouped.set(key, {
      side: thread.side,
      lineNumber: thread.lineNumber,
      metadata: [thread],
    });
  }
  return [...grouped.values()].sort(
    (left, right) =>
      left.lineNumber - right.lineNumber || left.side.localeCompare(right.side),
  );
};

export const lineAnnotationsFor = (
  annotations: readonly ThreadAnnotation[],
): ThreadLineAnnotation[] => {
  const grouped = new Map<number, ThreadLineAnnotation>();
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
  annotations: readonly (ThreadAnnotation | ThreadLineAnnotation)[],
): Thread[] => annotations.flatMap((annotation) => annotation.metadata);

export const annotationSignature = (annotations: readonly ThreadAnnotation[]): string =>
  annotations
    .flatMap((annotation) =>
      annotation.metadata.map(
        (thread) =>
          `${annotation.side}:${annotation.lineNumber}:${thread.id}:${thread.status}:${thread.comment.updatedAt}:${thread.comment.replies.length}`,
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
