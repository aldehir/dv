import type { Comment, FilePayload, Flavor, Manifest, ThemePref } from '../api/types';
import type { Unsubscribe } from './component';
import type { LineRange, LineSelection } from './store';

export interface FileSelected {
  id: string;
  reveal: boolean;
}

export interface StepIntent {
  delta: number;
}

export interface ComposeIntent {
  fileId: string;
  range: LineRange;
}

export interface ThemeChanged {
  pref: ThemePref;
  flavor: Flavor;
}

export interface BusEvents {
  'manifest:ready': Manifest;
  'file:payload': FilePayload;
  'file:selected': FileSelected;
  'file:step': StepIntent;
  'hunk:step': StepIntent;
  'filter:focus': void;
  'theme:set': ThemePref;
  'theme:cycle': void;
  'theme:changed': ThemeChanged;
  'selection:changed': LineSelection | null;
  'comment:compose': ComposeIntent;
  'comment:created': Comment;
  'comment:updated': Comment;
  'comment:deleted': { id: string };
  'comment:step': StepIntent;
  'comment:focus': { id: string };
  'panel:toggle': void;
  'sidebar:toggle': void;
  'help:toggle': void;
  'overlay:dismiss': void;
}

type EmitArgs<K extends keyof BusEvents> = BusEvents[K] extends void
  ? []
  : [payload: BusEvents[K]];

export interface Bus {
  emit<K extends keyof BusEvents>(type: K, ...args: EmitArgs<K>): void;
  on<K extends keyof BusEvents>(
    type: K,
    handler: (payload: BusEvents[K]) => void,
  ): Unsubscribe;
}

type OpaqueHandler = (payload: unknown) => void;

export const createBus = (): Bus => {
  const handlers = new Map<keyof BusEvents, Set<OpaqueHandler>>();

  return {
    emit(type, ...args) {
      const bucket = handlers.get(type);
      if (!bucket) return;
      const payload = (args as unknown[])[0];
      for (const handler of [...bucket]) handler(payload);
    },
    on(type, handler) {
      let bucket = handlers.get(type);
      if (!bucket) {
        bucket = new Set();
        handlers.set(type, bucket);
      }
      const entry = handler as OpaqueHandler;
      const owner = bucket;
      owner.add(entry);
      return () => {
        owner.delete(entry);
      };
    },
  };
};
