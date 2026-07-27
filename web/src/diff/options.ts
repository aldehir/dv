import type {
  CodeViewLayout,
  CodeViewLineSelection,
  CodeViewOptions,
  SelectedLineRange,
  VirtualFileMetrics,
} from '@pierre/diffs';
import type { Thread, ThreadAnnotation, ThreadLineAnnotation } from '../comments/anchors';
import type { Bus } from '../core/bus';
import type { AppState, AppStore } from '../core/store';
import { themeOptionFor } from '../theme/catppuccin';

export const LAYOUT: CodeViewLayout = { paddingTop: 12, paddingBottom: 48, gap: 12 };
export const EXPANSION_LINE_COUNT = 20;
export const HUNK_SEPARATORS = 'metadata' as const;

export type AnnotationRenderer = (
  annotation: ThreadAnnotation | ThreadLineAnnotation,
) => HTMLElement | undefined;

interface ItemHandle {
  item: { id: string };
}

export interface OptionsDeps {
  store: AppStore;
  bus: Bus;
  metrics: VirtualFileMetrics;
  renderAnnotation: AnnotationRenderer;
}

export const buildOptions = (
  state: AppState,
  { store, bus, metrics, renderAnnotation }: OptionsDeps,
): CodeViewOptions<Thread[]> => ({
  theme: themeOptionFor(state.themePref),
  themeType: state.themePref === 'auto' ? 'system' : undefined,
  diffStyle: state.view,
  overflow: state.wrap ? 'wrap' : 'scroll',
  stickyHeaders: true,
  expandUnchanged: true,
  expansionLineCount: EXPANSION_LINE_COUNT,
  enableLineSelection: true,
  enableGutterUtility: state.commentsEnabled,
  hunkSeparators: HUNK_SEPARATORS,
  layout: LAYOUT,
  itemMetrics: metrics,
  __devOnlyValidateItemHeights: import.meta.env.DEV,
  onSelectedLinesChange(selection: CodeViewLineSelection | null) {
    store.set({ selection, selectedFile: selection?.id ?? store.get().selectedFile });
    bus.emit('selection:changed', selection);
  },
  onGutterUtilityClick(range: SelectedLineRange, context: ItemHandle) {
    bus.emit('comment:compose', { fileId: context.item.id, range });
  },
  renderAnnotation,
});
