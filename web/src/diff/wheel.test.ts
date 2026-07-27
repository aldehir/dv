import { afterEach, describe, expect, it } from 'vitest';
import { consumesDelta, forwardWheel, isWebKit, wheelDelta } from './wheel';

/** jsdom never lays anything out, so the scroll geometry has to be declared. */
const scroller = (
  overflowY: string,
  { scrollHeight = 0, clientHeight = 0, scrollTop = 0 } = {},
): HTMLElement => {
  const node = document.createElement('div');
  node.style.overflowY = overflowY;
  Object.defineProperty(node, 'scrollHeight', { value: scrollHeight });
  Object.defineProperty(node, 'clientHeight', { value: clientHeight });
  node.scrollTop = scrollTop;
  document.body.appendChild(node);
  return node;
};

const wheel = (init: WheelEventInit = {}): WheelEvent =>
  new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, ...init });

afterEach(() => {
  document.body.replaceChildren();
});

describe('isWebKit', () => {
  it('matches the Apple vendor string every WebKit browser reports', () => {
    expect(isWebKit('Apple Computer, Inc.')).toBe(true);
    expect(isWebKit('Google Inc.')).toBe(false);
    expect(isWebKit('')).toBe(false);
  });
});

describe('wheelDelta', () => {
  it('passes pixel deltas straight through', () => {
    expect(wheelDelta(wheel({ deltaY: 42, deltaMode: 0 }), 500)).toBe(42);
  });

  it('scales line and page deltas into pixels', () => {
    expect(wheelDelta(wheel({ deltaY: 3, deltaMode: 1 }), 500)).toBe(48);
    expect(wheelDelta(wheel({ deltaY: 1, deltaMode: 2 }), 500)).toBe(450);
  });
});

describe('consumesDelta', () => {
  it('ignores anything that is not a vertical scroller', () => {
    expect(consumesDelta(scroller('clip', { scrollHeight: 900, clientHeight: 300 }), 10)).toBe(
      false,
    );
    expect(consumesDelta(document, 10)).toBe(false);
  });

  it('ignores a scroller whose content fits', () => {
    expect(consumesDelta(scroller('auto', { scrollHeight: 300, clientHeight: 300 }), 10)).toBe(
      false,
    );
  });

  it('reports room only in the direction the delta travels', () => {
    const top = scroller('auto', { scrollHeight: 900, clientHeight: 300, scrollTop: 0 });
    expect(consumesDelta(top, 10)).toBe(true);
    expect(consumesDelta(top, -10)).toBe(false);

    const bottom = scroller('scroll', { scrollHeight: 900, clientHeight: 300, scrollTop: 600 });
    expect(consumesDelta(bottom, 10)).toBe(false);
    expect(consumesDelta(bottom, -10)).toBe(true);
  });
});

describe('forwardWheel', () => {
  const setup = (enabled = true) => {
    const mount = scroller('auto', { scrollHeight: 900, clientHeight: 300 });
    const code = scroller('clip', { scrollHeight: 100, clientHeight: 100 });
    mount.appendChild(code);
    return { mount, code, stop: forwardWheel(mount, enabled) };
  };

  it('scrolls the mount when the element under the pointer cannot', () => {
    const { mount, code } = setup();
    const event = wheel({ deltaY: 120 });

    code.dispatchEvent(event);

    expect(mount.scrollTop).toBe(120);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves the event alone when an inner scroller can take the delta', () => {
    const { mount, code } = setup();
    const inner = scroller('auto', { scrollHeight: 900, clientHeight: 300 });
    code.appendChild(inner);
    const event = wheel({ deltaY: 120 });

    inner.dispatchEvent(event);

    expect(mount.scrollTop).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves horizontal gestures and pinch zoom to the code scroller', () => {
    const { mount, code } = setup();

    code.dispatchEvent(wheel({ deltaX: 120, deltaY: 20 }));
    code.dispatchEvent(wheel({ deltaY: 120, ctrlKey: true }));

    expect(mount.scrollTop).toBe(0);
  });

  it('does not swallow the wheel once the mount runs out of room', () => {
    const { mount, code } = setup();
    mount.scrollTop = 600;
    const event = wheel({ deltaY: 120 });

    code.dispatchEvent(event);

    expect(mount.scrollTop).toBe(600);
    expect(event.defaultPrevented).toBe(false);
  });

  it('stays out of the way on engines that chain the delta themselves', () => {
    const { mount, code } = setup(false);
    const event = wheel({ deltaY: 120 });

    code.dispatchEvent(event);

    expect(mount.scrollTop).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it('detaches on dispose', () => {
    const { mount, code, stop } = setup();
    stop();

    code.dispatchEvent(wheel({ deltaY: 120 }));

    expect(mount.scrollTop).toBe(0);
  });
});
