import type { FileDiffMetadata } from '@pierre/diffs';
import { describe, expect, it } from 'vitest';
import type { FilePayload } from '../api/types';
import type { Thread, ThreadAnnotation } from '../comments/anchors';
import {
  CACHE_KEY_PREFIX,
  attachFullContents,
  cacheKeyFor,
  itemFor,
  placeholderText,
  withAnnotations,
} from './items';

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -4,5 +4,6 @@ const head = 1;
 const context = 2;
-const removed = 3;
+const added = 3;
+const extra = 4;
 const tail = 5;
 const last = 6;
`;

const payload = (over: Partial<FilePayload> = {}): FilePayload => ({
  id: 'f1',
  path: 'src/a.ts',
  status: 'modified',
  patch: PATCH,
  oldLines: null,
  newLines: null,
  binary: false,
  tooLarge: false,
  oldSha: 'aaaa',
  newSha: 'bbbb',
  oldSize: 120,
  newSize: 240,
  mode: { old: '100644', new: '100644' },
  submodule: false,
  symlink: false,
  ...over,
});

const thread = (id: string): Thread => ({
  id,
  fileId: 'f1',
  path: 'src/a.ts',
  side: 'additions',
  lineNumber: 5,
  startLine: 5,
  endLine: 5,
  status: 'open',
  stale: false,
  pending: false,
  comment: {
    id,
    status: 'open',
    author: { name: 'alde' },
    createdAt: '2026-07-26T00:00:00Z',
    updatedAt: '2026-07-26T00:00:00Z',
    body: 'looks off',
    anchor: {
      path: 'src/a.ts',
      prevPath: null,
      side: 'additions',
      startLine: 5,
      endLine: 5,
      blobSha: 'bbbb',
      quote: '',
      contextBefore: [],
      contextAfter: [],
    },
    replies: [],
  },
});

const annotation = (): ThreadAnnotation => ({
  side: 'additions',
  lineNumber: 5,
  metadata: [thread('c1')],
});

describe('itemFor', () => {
  it('turns a single-file patch into a diff item', () => {
    const item = itemFor(payload());

    expect(item.type).toBe('diff');
    expect(item.id).toBe('f1');
    expect(item.version).toBe(0);
    if (item.type !== 'diff') throw new Error('expected a diff item');
    expect(item.fileDiff.name).toBe('src/a.ts');
    expect(item.fileDiff.hunks.length).toBe(1);
    expect(item.fileDiff.type).toBe('change');
  });

  it('carries the annotations it was given', () => {
    const item = itemFor(payload(), [annotation()]);
    expect(item.annotations?.length).toBe(1);
    expect(item.annotations?.[0]?.lineNumber).toBe(5);
  });

  it('stamps a content-addressed cache key', () => {
    const item = itemFor(payload({ id: 'x/y', oldSha: 'old', newSha: 'new' }));
    if (item.type !== 'diff') throw new Error('expected a diff item');
    expect(item.fileDiff.cacheKey).toBe(`${CACHE_KEY_PREFIX}:x/y:old:new`);
    expect(cacheKeyFor(payload({ id: 'x/y', oldSha: 'old', newSha: 'new' }))).toBe(
      'dv:x/y:old:new',
    );
  });

  it('leaves the diff partial while the parser only saw the patch', () => {
    const item = itemFor(payload());
    if (item.type !== 'diff') throw new Error('expected a diff item');
    expect(item.fileDiff.isPartial).toBe(true);
    expect(item.fileDiff.additionLines.length).toBe(5);
    expect(item.fileDiff.additionLines).not.toContain('const head = 1;\n');
  });

  it('replaces both line arrays and clears isPartial when full contents arrive', () => {
    const oldLines = ['a', 'b', 'c', 'context', 'removed', 'tail', 'last'];
    const newLines = ['a', 'b', 'c', 'context', 'added', 'extra', 'tail', 'last'];
    const item = itemFor(payload({ oldLines, newLines }));
    if (item.type !== 'diff') throw new Error('expected a diff item');

    expect(item.fileDiff.isPartial).toBe(false);
    expect(item.fileDiff.deletionLines).toEqual(oldLines.map((line) => `${line}\n`));
    expect(item.fileDiff.additionLines).toEqual(newLines.map((line) => `${line}\n`));
  });

  it('keeps lines that already carry their newline', () => {
    const parsed = itemFor(payload({ oldLines: ['a\n', 'b'], newLines: ['a\n', 'c'] }));
    if (parsed.type !== 'diff') throw new Error('expected a diff item');
    expect(parsed.fileDiff.deletionLines).toEqual(['a\n', 'b']);
  });

  it('stays partial when either side is unavailable', () => {
    const missingOld = itemFor(payload({ oldLines: null, newLines: ['a'] }));
    const missingNew = itemFor(payload({ oldLines: ['a'], newLines: null }));
    if (missingOld.type !== 'diff' || missingNew.type !== 'diff') {
      throw new Error('expected diff items');
    }
    expect(missingOld.fileDiff.isPartial).toBe(true);
    expect(missingNew.fileDiff.isPartial).toBe(true);
  });

  it('renders a placeholder for a binary file', () => {
    const item = itemFor(payload({ binary: true, patch: '' }));
    expect(item.type).toBe('file');
    if (item.type !== 'file') throw new Error('expected a file item');
    expect(item.file.name).toBe('src/a.ts');
    expect(item.file.contents).toBe('Binary file (240 bytes)\n');
    expect(item.file.cacheKey).toBe('dv:f1:aaaa:bbbb');
  });

  it('renders a placeholder for a too-large file even when a patch is present', () => {
    const item = itemFor(payload({ tooLarge: true }));
    if (item.type !== 'file') throw new Error('expected a file item');
    expect(item.file.contents).toContain('too large');
  });

  it('renders a placeholder for an empty patch without throwing', () => {
    expect(() => itemFor(payload({ patch: '' }))).not.toThrow();
    expect(itemFor(payload({ patch: '' })).type).toBe('file');
  });

  it('renders a placeholder when the patch yields no files', () => {
    const item = itemFor(payload({ patch: 'not a patch at all\n' }));
    expect(item.type).toBe('file');
  });

  it('describes a mode-only change', () => {
    const mode = { old: '100644', new: '100755' };
    expect(placeholderText(payload({ mode, patch: '' }))).toBe(
      'File mode changed 100644 → 100755',
    );
  });

  it('describes a submodule', () => {
    expect(placeholderText(payload({ submodule: true, path: 'vendor/lib' }))).toBe(
      'Submodule vendor/lib',
    );
  });

  it('folds annotations onto placeholder items by line', () => {
    const item = itemFor(payload({ binary: true }), [
      { side: 'additions', lineNumber: 1, metadata: [thread('a')] },
      { side: 'deletions', lineNumber: 1, metadata: [thread('b')] },
    ]);
    expect(item.annotations?.length).toBe(1);
    expect(item.annotations?.[0]?.metadata?.length).toBe(2);
  });

  it('carries the previous path onto a rename', () => {
    const item = itemFor(payload({ prevPath: 'src/old.ts' }));
    if (item.type !== 'diff') throw new Error('expected a diff item');
    expect(item.fileDiff.prevName).toBe('src/old.ts');
  });
});

const OFFSET_PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -4,4 +4,5 @@ const head = 1;
 const context = 2;
-const removed = 3;
+const added = 3;
+const extra = 4;
 const tail = 5;
 const last = 6;
`;

const OLD_LINES = [
  'const head = 1;',
  'const a = 1;',
  'const b = 2;',
  'const context = 2;',
  'const removed = 3;',
  'const tail = 5;',
  'const last = 6;',
  'const eof = 7;',
];

const NEW_LINES = [
  'const head = 1;',
  'const a = 1;',
  'const b = 2;',
  'const context = 2;',
  'const added = 3;',
  'const extra = 4;',
  'const tail = 5;',
  'const last = 6;',
  'const eof = 7;',
];

const expanded = (): FileDiffMetadata => {
  const full = payload({ patch: OFFSET_PATCH, oldLines: OLD_LINES, newLines: NEW_LINES });
  const item = itemFor(full);
  if (item.type !== 'diff') throw new Error('expected a diff item');
  return item.fileDiff;
};

describe('attachFullContents', () => {
  it('is a no-op when expansion is unavailable', () => {
    const item = itemFor(payload());
    if (item.type !== 'diff') throw new Error('expected a diff item');
    const before = item.fileDiff.additionLines;
    attachFullContents(item.fileDiff, payload({ oldLines: null, newLines: null }));
    expect(item.fileDiff.additionLines).toBe(before);
    expect(item.fileDiff.isPartial).toBe(true);
  });

  it('swaps in the whole file and marks the diff expandable', () => {
    const fileDiff = expanded();
    expect(fileDiff.isPartial).toBe(false);
    expect(fileDiff.deletionLines).toEqual(OLD_LINES.map((line) => `${line}\n`));
    expect(fileDiff.additionLines).toEqual(NEW_LINES.map((line) => `${line}\n`));
  });

  it('rebases hunk line indices onto the whole file', () => {
    const hunk = expanded().hunks[0];
    expect(hunk?.deletionLineIndex).toBe(hunk!.deletionStart - 1);
    expect(hunk?.additionLineIndex).toBe(hunk!.additionStart - 1);
  });

  it('rebases the line indices inside each hunk content group', () => {
    const hunk = expanded().hunks[0];
    expect(
      hunk?.hunkContent.map((content) => [
        content.type,
        content.deletionLineIndex,
        content.additionLineIndex,
      ]),
    ).toEqual([
      ['context', 3, 3],
      ['change', 4, 4],
      ['context', 5, 6],
    ]);
  });

  it('indexes back to the same text the patch carried', () => {
    const fileDiff = expanded();
    const change = fileDiff.hunks[0]?.hunkContent[1];
    expect(fileDiff.deletionLines[change!.deletionLineIndex]).toBe('const removed = 3;\n');
    expect(fileDiff.additionLines[change!.additionLineIndex]).toBe('const added = 3;\n');
  });

  it('counts the context collapsed below the last hunk', () => {
    const fileDiff = expanded();
    expect(fileDiff.splitLineCount).toBe(NEW_LINES.length);
    expect(fileDiff.unifiedLineCount).toBe(NEW_LINES.length + 1);
  });

  it('leaves an already-expanded diff alone when applied twice', () => {
    const fileDiff = expanded();
    const before = {
      split: fileDiff.splitLineCount,
      unified: fileDiff.unifiedLineCount,
      deletion: fileDiff.hunks[0]?.deletionLineIndex,
      addition: fileDiff.hunks[0]?.additionLineIndex,
    };
    attachFullContents(
      fileDiff,
      payload({ patch: OFFSET_PATCH, oldLines: OLD_LINES, newLines: NEW_LINES }),
    );
    expect(fileDiff.splitLineCount).toBe(before.split);
    expect(fileDiff.unifiedLineCount).toBe(before.unified);
    expect(fileDiff.hunks[0]?.deletionLineIndex).toBe(before.deletion);
    expect(fileDiff.hunks[0]?.additionLineIndex).toBe(before.addition);
  });

  it('keeps a new file at the top of its addition lines', () => {
    const newFilePatch = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..2222222
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+const one = 1;
+const two = 2;
`;
    const item = itemFor(
      payload({
        patch: newFilePatch,
        path: 'src/new.ts',
        oldLines: [],
        newLines: ['const one = 1;', 'const two = 2;'],
      }),
    );
    if (item.type !== 'diff') throw new Error('expected a diff item');
    expect(item.fileDiff.hunks[0]?.deletionLineIndex).toBe(0);
    expect(item.fileDiff.hunks[0]?.additionLineIndex).toBe(0);
    expect(item.fileDiff.splitLineCount).toBe(2);
  });
});

describe('withAnnotations', () => {
  it('replaces annotations without touching version', () => {
    const item = itemFor(payload(), [annotation()]);
    const next = withAnnotations(item, []);
    expect(next.annotations).toEqual([]);
    expect(next.version).toBe(item.version);
    expect(next).not.toBe(item);
  });
});
