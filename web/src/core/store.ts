import type { StreamState } from '../api/sse';
import type {
  AnnotationSide,
  Flavor,
  Manifest,
  Session,
  ThemePref,
  ViewMode,
} from '../api/types';
import type { Unsubscribe } from './component';

export type SelectionSide = AnnotationSide;

export interface LineRange {
  start: number;
  end: number;
  side?: SelectionSide;
  endSide?: SelectionSide;
}

export interface LineSelection {
  id: string;
  range: LineRange;
}

export type FileLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface FileLoadState {
  status: FileLoadStatus;
  error?: string;
}

export interface AppState {
  session: Session | null;
  manifest: Manifest | null;
  themePref: ThemePref;
  flavor: Flavor;
  view: ViewMode;
  wrap: boolean;
  scrollTop: number;
  selectedFile: string | null;
  selection: LineSelection | null;
  filter: string;
  sidebarVisible: boolean;
  panelVisible: boolean;
  commentsEnabled: boolean;
  commentCounts: Record<string, number>;
  fileState: Record<string, FileLoadState>;
  stream: StreamState;
  notice: string | null;
}

export const createInitialState = (): AppState => ({
  session: null,
  manifest: null,
  themePref: 'auto',
  flavor: 'mocha',
  view: 'split',
  wrap: false,
  scrollTop: 0,
  selectedFile: null,
  selection: null,
  filter: '',
  sidebarVisible: true,
  panelVisible: false,
  commentsEnabled: false,
  commentCounts: {},
  fileState: {},
  stream: 'idle',
  notice: null,
});

type OpaqueListener = (value: unknown, state: unknown) => void;

export interface Store<S extends object> {
  get(): Readonly<S>;
  set(partial: Partial<S>): void;
  subscribe(listener: (state: Readonly<S>) => void): Unsubscribe;
  subscribe<K extends keyof S>(
    key: K,
    listener: (value: S[K], state: Readonly<S>) => void,
  ): Unsubscribe;
}

export type AppStore = Store<AppState>;

export const createStore = <S extends object>(initial: S): Store<S> => {
  let state: S = { ...initial };
  const whole = new Set<OpaqueListener>();
  const keyed = new Map<keyof S, Set<OpaqueListener>>();

  const subscribe = (first: unknown, second?: unknown): Unsubscribe => {
    if (typeof first === 'function') {
      const listener = first as OpaqueListener;
      whole.add(listener);
      return () => {
        whole.delete(listener);
      };
    }
    const key = first as keyof S;
    const listener = second as OpaqueListener;
    let listeners = keyed.get(key);
    if (!listeners) {
      listeners = new Set();
      keyed.set(key, listeners);
    }
    const bucket = listeners;
    bucket.add(listener);
    return () => {
      bucket.delete(listener);
    };
  };

  return {
    get: () => state,
    set(partial) {
      const changed: (keyof S)[] = [];
      for (const key of Object.keys(partial) as (keyof S)[]) {
        if (!Object.is(state[key], partial[key])) changed.push(key);
      }
      if (changed.length === 0) return;
      state = { ...state, ...partial };
      for (const key of changed) {
        const listeners = keyed.get(key);
        if (!listeners) continue;
        for (const listener of [...listeners]) listener(state[key], state);
      }
      for (const listener of [...whole]) listener(state, state);
    },
    subscribe: subscribe as Store<S>['subscribe'],
  };
};
