import type { Unsubscribe } from '../core/component';
import { on } from '../core/dom';

/**
 * WebKit latches a wheel gesture onto the element under the pointer and drops
 * the delta when that element cannot move on the gesture's axis. With wrap off
 * the library gives every file its own horizontal scroller — `[data-code]` is
 * `overflow: scroll clip` — so two-finger trackpad scrolling over the diff goes
 * nowhere on iPadOS while touch gestures still reach the mount. Carry the
 * leftover vertical delta to the mount by hand.
 */

const LINE_HEIGHT = 16;
const PAGE_FRACTION = 0.9;
const EPSILON = 1;

export const isWebKit = (vendor: string = navigator.vendor): boolean =>
  vendor.startsWith('Apple');

/** Wheel deltas arrive in pixels, lines, or pages depending on the device. */
export const wheelDelta = (event: WheelEvent, viewport: number): number => {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * LINE_HEIGHT;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * viewport * PAGE_FRACTION;
  }
  return event.deltaY;
};

/** Whether `target` is a vertical scroller with room left in the delta's direction. */
export const consumesDelta = (target: EventTarget, delta: number): boolean => {
  if (!(target instanceof Element)) return false;
  const overflow = getComputedStyle(target).overflowY;
  if (overflow !== 'auto' && overflow !== 'scroll') return false;
  const room = target.scrollHeight - target.clientHeight;
  if (room <= EPSILON) return false;
  return delta < 0 ? target.scrollTop > EPSILON : target.scrollTop < room - EPSILON;
};

export const forwardWheel = (mount: HTMLElement, enabled = isWebKit()): Unsubscribe => {
  if (!enabled) return () => {};

  return on(
    mount,
    'wheel',
    (event) => {
      // Pinch zoom rides in on the wheel with ctrlKey set; leave it alone, and
      // leave predominantly horizontal gestures to the code scroller.
      if (event.defaultPrevented || event.ctrlKey) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

      const delta = wheelDelta(event, mount.clientHeight);
      if (delta === 0 || !consumesDelta(mount, delta)) return;

      for (const node of event.composedPath()) {
        if (node === mount) break;
        if (consumesDelta(node, delta)) return;
      }

      mount.scrollTop += delta;
      event.preventDefault();
    },
    { passive: false },
  );
};
