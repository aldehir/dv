import type { CodeViewItem, FileDiffMetadata } from '@pierre/diffs';
import { parsePatchFiles } from '@pierre/diffs';
import type { FilePayload } from '../api/types';
import type { Thread, ThreadAnnotation } from '../comments/anchors';
import { lineAnnotationsFor } from '../comments/anchors';

export type DiffItem = CodeViewItem<Thread[]>;

export const CACHE_KEY_PREFIX = 'dv';

export const cacheKeyFor = (payload: FilePayload): string =>
  `${CACHE_KEY_PREFIX}:${payload.id}:${payload.oldSha}:${payload.newSha}`;

const normalizeLines = (lines: readonly string[]): string[] => {
  if (lines.length === 0) return [];
  if (lines.some((line) => line.includes('\n'))) return [...lines];
  return lines.map((line) => `${line}\n`);
};

const parseFileDiff = (payload: FilePayload): FileDiffMetadata | null => {
  if (payload.patch === '') return null;
  try {
    const patches = parsePatchFiles(payload.patch, `${CACHE_KEY_PREFIX}:${payload.id}`);
    for (const patch of patches) {
      const first = patch.files[0];
      if (first) return first;
    }
    return null;
  } catch {
    return null;
  }
};

const rebaseHunks = (fileDiff: FileDiffMetadata): void => {
  for (const hunk of fileDiff.hunks) {
    const deletionShift = Math.max(hunk.deletionStart - 1, 0) - hunk.deletionLineIndex;
    const additionShift = Math.max(hunk.additionStart - 1, 0) - hunk.additionLineIndex;
    if (deletionShift === 0 && additionShift === 0) continue;
    hunk.deletionLineIndex += deletionShift;
    hunk.additionLineIndex += additionShift;
    for (const content of hunk.hunkContent) {
      content.deletionLineIndex += deletionShift;
      content.additionLineIndex += additionShift;
    }
  }
};

const collapsedAfter = (fileDiff: FileDiffMetadata): number => {
  const last = fileDiff.hunks.at(-1);
  if (!last) return 0;
  if (fileDiff.deletionLines.length === 0 || fileDiff.additionLines.length === 0) return 0;
  const end = last.additionStart + last.additionCount - 1;
  return Math.max(fileDiff.additionLines.length - end, 0);
};

export const attachFullContents = (
  fileDiff: FileDiffMetadata,
  payload: FilePayload,
): FileDiffMetadata => {
  if (payload.oldLines === null || payload.newLines === null) return fileDiff;
  if (!fileDiff.isPartial) return fileDiff;
  fileDiff.deletionLines = normalizeLines(payload.oldLines);
  fileDiff.additionLines = normalizeLines(payload.newLines);
  fileDiff.isPartial = false;
  rebaseHunks(fileDiff);
  const trailing = collapsedAfter(fileDiff);
  fileDiff.splitLineCount += trailing;
  fileDiff.unifiedLineCount += trailing;
  return fileDiff;
};

const byteSize = (payload: FilePayload): number =>
  payload.newSize > 0 ? payload.newSize : payload.oldSize;

const modeChanged = (payload: FilePayload): boolean =>
  payload.mode.old !== '' &&
  payload.mode.new !== '' &&
  payload.mode.old !== payload.mode.new;

export const placeholderText = (payload: FilePayload): string => {
  if (payload.binary) return `Binary file (${byteSize(payload)} bytes)`;
  if (payload.tooLarge) return `File is too large to render (${byteSize(payload)} bytes)`;
  if (payload.submodule) return `Submodule ${payload.path}`;
  if (modeChanged(payload)) {
    return `File mode changed ${payload.mode.old} → ${payload.mode.new}`;
  }
  return 'No renderable changes';
};

export const placeholderItem = (
  payload: FilePayload,
  annotations: readonly ThreadAnnotation[] = [],
): DiffItem => ({
  type: 'file',
  id: payload.id,
  file: {
    name: payload.path,
    contents: `${placeholderText(payload)}\n`,
    lang: 'text',
    cacheKey: cacheKeyFor(payload),
  },
  annotations: lineAnnotationsFor(annotations),
  version: 0,
});

export const itemFor = (
  payload: FilePayload,
  annotations: readonly ThreadAnnotation[] = [],
): DiffItem => {
  if (payload.binary || payload.tooLarge) return placeholderItem(payload, annotations);

  const parsed = parseFileDiff(payload);
  if (!parsed) return placeholderItem(payload, annotations);

  const fileDiff = attachFullContents(parsed, payload);
  if (fileDiff.name === '') fileDiff.name = payload.path;
  if (!fileDiff.prevName && payload.prevPath) fileDiff.prevName = payload.prevPath;
  fileDiff.cacheKey = cacheKeyFor(payload);

  return {
    type: 'diff',
    id: payload.id,
    fileDiff,
    annotations: [...annotations],
    version: 0,
  };
};

export const withAnnotations = (
  item: DiffItem,
  annotations: readonly ThreadAnnotation[],
): DiffItem =>
  item.type === 'file'
    ? { ...item, annotations: lineAnnotationsFor(annotations) }
    : { ...item, annotations: [...annotations] };
