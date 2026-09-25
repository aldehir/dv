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
 * Patches to the library's own stylesheet, injected into its shadow root:
 *
 * - the per-file horizontal scrollbars it reveals on hover are worth keeping,
 *   but the thumb should carry the chrome's token so it matches the flavor;
 * - the plus in the gutter is a library default; the flavor's accent is not;
 * - under a thumb the plus is the handle that opens a range, so give it a
 *   target a thumb can actually land on, without growing the 1lh square it
 *   draws.
 */
export const SHADOW_CSS = `
:host(:hover) [data-code]::-webkit-scrollbar-thumb {
  background-color: var(--dv-scroll-thumb);
}

[data-utility-button] {
  background-color: var(--dv-accent);
}

@media (pointer: coarse) {
  [data-utility-button]::after {
    content: '';
    position: absolute;
    inset: -0.45lh;
  }
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
): CodeViewOptions<Card[], undefined> => ({
  theme: themeOptionFor(state.themePref),
  themeType: state.themePref === 'auto' ? 'system' : undefined,
  diffStyle: state.view,
  overflow: state.wrap ? 'wrap' : 'scroll',
  stickyHeaders: true,
  expandUnchanged: true,
  expansionLineCount: EXPANSION_LINE_COUNT,
  enableLineSelection: true,
  /**
   * Selecting lines is the whole affordance, so under a mouse there is no plus
   * in the gutter. A thumb has no drag across the code to select with — that
   * gesture is the diff scrolling — and the plus is the handle that replaces
   * it: tap a line, then drag its handle to the other end of the range.
   *
   * The library arms it only when there is a handler here, and the range the
   * drag ends on arrives through `onLineSelected` like any other — which
   * leaves this with nothing of its own to do. Do not delete it.
   */
  enableGutterUtility: state.coarse,
  onGutterUtilityClick() {},
  hunkSeparators: HUNK_SEPARATORS,
  layout: LAYOUT,
  itemMetrics: metrics,
  unsafeCSS: SHADOW_CSS,
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
