import type {
  CodeViewLayout,
  CodeViewLineSelection,
  CodeViewOptions,
  SelectedLineRange,
  VirtualFileMetrics,
} from '@pierre/diffs';
import type { Card, CardAnnotation, CardLineAnnotation } from '../comments/anchors';
import type { Bus } from '../core/bus';
import type { AppState, AppStore } from '../core/store';
import { themeOptionFor } from '../theme/catppuccin';

export const LAYOUT: CodeViewLayout = { paddingTop: 12, paddingBottom: 48, gap: 12 };
export const EXPANSION_LINE_COUNT = 20;
export const HUNK_SEPARATORS = 'metadata' as const;

/**
 * The library reveals per-file horizontal scrollbars on hover. Keep that, but
 * tint the thumb with the chrome's token so it matches the flavor.
 */
export const SCROLLBAR_CSS = `
:host(:hover) [data-code]::-webkit-scrollbar-thumb {
  background-color: var(--dv-scroll-thumb);
}
`;

export type AnnotationRenderer = (
  annotation: CardAnnotation | CardLineAnnotation,
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
): CodeViewOptions<Card[]> => ({
  theme: themeOptionFor(state.themePref),
  themeType: state.themePref === 'auto' ? 'system' : undefined,
  diffStyle: state.view,
  overflow: state.wrap ? 'wrap' : 'scroll',
  stickyHeaders: true,
  expandUnchanged: true,
  expansionLineCount: EXPANSION_LINE_COUNT,
  enableLineSelection: true,
  hunkSeparators: HUNK_SEPARATORS,
  layout: LAYOUT,
  itemMetrics: metrics,
  unsafeCSS: SCROLLBAR_CSS,
  __devOnlyValidateItemHeights: import.meta.env.DEV,
  onSelectedLinesChange(selection: CodeViewLineSelection | null) {
    store.set({ selection, selectedFile: selection?.id ?? store.get().selectedFile });
    bus.emit('selection:changed', selection);
  },
  /**
   * Only a settled selection carries the draft box. Following every drag step
   * would shuffle the lines out from under the pointer mid-selection.
   */
  onLineSelected(range: SelectedLineRange | null, context: ItemHandle) {
    store.set({ composing: range === null ? null : { id: context.item.id, range } });
  },
  renderAnnotation,
});
