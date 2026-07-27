import type { Unsubscribe } from './component';

export type Child = Node | string | number | null | undefined | false;

type UnsettableKeys =
  | 'innerHTML'
  | 'outerHTML'
  | 'innerText'
  | 'style'
  | 'classList'
  | 'dataset'
  | 'children'
  | 'attributes';

export type ElementProps<K extends keyof HTMLElementTagNameMap> = Omit<
  Partial<HTMLElementTagNameMap[K]>,
  UnsettableKeys
> & {
  class?: string;
  data?: Record<string, string>;
};

export const append = (parent: Node, children: readonly Child[]): void => {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      typeof child === 'object' ? child : document.createTextNode(String(child)),
    );
  }
};

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElementProps<K> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (props) {
    const source = props as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      const value = source[key];
      if (value === undefined || value === null) continue;
      if (key === 'class') {
        node.setAttribute('class', String(value));
        continue;
      }
      if (key === 'data') {
        Object.assign(node.dataset, value as Record<string, string>);
        continue;
      }
      Reflect.set(node, key, value);
    }
  }
  append(node, children);
  return node;
};

export const frag = (...children: Child[]): DocumentFragment => {
  const fragment = document.createDocumentFragment();
  append(fragment, children);
  return fragment;
};

export const clear = (node: Node): void => {
  while (node.firstChild) node.removeChild(node.firstChild);
};

export const replaceChildren = (node: Node, ...children: Child[]): void => {
  clear(node);
  append(node, children);
};

type EventMapOf<T> = T extends Window
  ? WindowEventMap
  : T extends Document
    ? DocumentEventMap
    : T extends MediaQueryList
      ? MediaQueryListEventMap
      : T extends HTMLElement
        ? HTMLElementEventMap
        : Record<string, Event>;

export const on = <T extends EventTarget, K extends keyof EventMapOf<T> & string>(
  target: T,
  type: K,
  handler: (event: EventMapOf<T>[K]) => void,
  options?: AddEventListenerOptions,
): Unsubscribe => {
  const listener = handler as EventListener;
  target.addEventListener(type, listener, options);
  return () => {
    target.removeEventListener(type, listener, options);
  };
};

export const isTextEntry = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};
