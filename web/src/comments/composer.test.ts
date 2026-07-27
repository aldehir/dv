import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../core/bus';
import { createInitialState, createStore } from '../core/store';
import type { Viewer } from '../diff/viewer';
import { createComposer } from './composer';
import type { CommentsStore, ComposeTarget } from './store';

const RANGE = { start: 4, end: 6, side: 'additions' as const };

const target = (over: Partial<ComposeTarget> = {}): ComposeTarget => ({
  fileId: 'f1',
  path: 'src/a.ts',
  range: RANGE,
  key: 'f1:additions:4-6',
  ...over,
});

const stubViewer = (): Viewer => ({
  has: vi.fn(() => true),
  updateItem: vi.fn(() => true),
  refreshAnnotations: vi.fn(),
  revealFile: vi.fn(),
  revealRange: vi.fn(),
  revealThread: vi.fn(),
  stepHunk: vi.fn(),
  destroy: vi.fn(),
});

const stubComments = (compose: ComposeTarget | null): CommentsStore => ({
  start: vi.fn(),
  refresh: vi.fn(() => Promise.resolve()),
  threads: vi.fn(() => []),
  threadsFor: vi.fn(() => []),
  compose: vi.fn(() => compose),
  setCompose: vi.fn(),
  draft: vi.fn(() => ''),
  setDraft: vi.fn(),
  error: vi.fn(() => null),
  create: vi.fn(() => Promise.resolve(null)),
  update: vi.fn(() => Promise.resolve(null)),
  remove: vi.fn(() => Promise.resolve(true)),
  reply: vi.fn(() => Promise.resolve(null)),
  subscribe: vi.fn(() => () => {}),
  destroy: vi.fn(),
});

const setup = (compose: ComposeTarget | null = target()) => {
  const store = createStore(createInitialState());
  const bus = createBus();
  const comments = stubComments(compose);
  const viewer = stubViewer();
  const composer = createComposer({ store, bus, comments, viewer });
  return { store, bus, comments, viewer, composer };
};

describe('createComposer', () => {
  it('leaves an on-screen range where it is when it opens', () => {
    const { viewer, composer } = setup();

    composer.update({ open: true });

    expect(viewer.revealRange).toHaveBeenCalledWith('f1', RANGE, 'nearest');
    composer.destroy();
  });

  it('stays put with nothing to compose against', () => {
    const { viewer, composer } = setup(null);

    composer.update({ open: true });

    expect(viewer.revealRange).not.toHaveBeenCalled();
    expect(composer.el.hidden).toBe(true);
    composer.destroy();
  });
});
