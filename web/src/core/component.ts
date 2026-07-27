export type Unsubscribe = () => void;

export interface Disposable {
  destroy(): void;
}

export interface Component<P = void> extends Disposable {
  el: HTMLElement;
  update(props: P): void;
}

export interface OverlayProps {
  open: boolean;
}

export interface Disposer {
  add(unsubscribe: Unsubscribe): void;
  dispose(): void;
}

export const createDisposer = (): Disposer => {
  const pending: Unsubscribe[] = [];
  return {
    add(unsubscribe) {
      pending.push(unsubscribe);
    },
    dispose() {
      while (pending.length > 0) {
        const unsubscribe = pending.pop();
        if (unsubscribe) unsubscribe();
      }
    },
  };
};

export interface LazyOverlay extends Disposable {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

export const createLazyOverlay = (
  host: HTMLElement,
  load: () => Promise<Component<OverlayProps>>,
): LazyOverlay => {
  let instance: Component<OverlayProps> | null = null;
  let loading = false;
  let opened = false;
  let destroyed = false;

  const sync = (): void => {
    if (instance) instance.update({ open: opened });
  };

  const ensureLoaded = (): void => {
    if (instance || loading || destroyed) return;
    loading = true;
    void load().then((component) => {
      loading = false;
      if (destroyed) {
        component.destroy();
        return;
      }
      instance = component;
      host.appendChild(component.el);
      sync();
    });
  };

  return {
    isOpen: () => opened,
    open() {
      opened = true;
      ensureLoaded();
      sync();
    },
    close() {
      opened = false;
      sync();
    },
    toggle() {
      if (opened) {
        opened = false;
        sync();
        return;
      }
      opened = true;
      ensureLoaded();
      sync();
    },
    destroy() {
      destroyed = true;
      opened = false;
      if (instance) {
        instance.el.remove();
        instance.destroy();
        instance = null;
      }
    },
  };
};
