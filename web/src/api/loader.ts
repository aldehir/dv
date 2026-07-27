import type { Bus } from '../core/bus';
import type { Disposable } from '../core/component';
import { createDisposer } from '../core/component';
import type { AppStore, FileLoadState } from '../core/store';
import type { ApiClient } from './client';
import { ApiError } from './client';
import { createSse } from './sse';
import type { FilePayload, Manifest } from './types';

export interface LoaderDeps {
  client: ApiClient;
  store: AppStore;
  bus: Bus;
}

export interface Loader extends Disposable {
  start(): void;
  loadFile(id: string): Promise<FilePayload | null>;
}

const describe = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.isUnreachable) return 'dv server is unreachable';
    return error.detail === '' ? error.message : error.detail;
  }
  return error instanceof Error ? error.message : String(error);
};

const parseJson = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const createLoader = ({ client, store, bus }: LoaderDeps): Loader => {
  const disposer = createDisposer();
  const inFlight = new Map<string, Promise<FilePayload | null>>();

  const setFileState = (id: string, next: FileLoadState): void => {
    store.set({ fileState: { ...store.get().fileState, [id]: next } });
  };

  const applyManifest = (manifest: Manifest): void => {
    const current = store.get();
    store.set({
      manifest,
      notice: null,
      selectedFile: current.selectedFile ?? manifest.files[0]?.id ?? null,
    });
    bus.emit('manifest:ready', manifest);
  };

  const loadFile = (id: string): Promise<FilePayload | null> => {
    const pending = inFlight.get(id);
    if (pending) return pending;
    setFileState(id, { status: 'loading' });
    const request = client
      .file(id)
      .then((payload) => {
        inFlight.delete(id);
        setFileState(id, { status: 'loaded' });
        bus.emit('file:payload', payload);
        return payload;
      })
      .catch((error: unknown) => {
        inFlight.delete(id);
        setFileState(id, { status: 'error', error: describe(error) });
        return null;
      });
    inFlight.set(id, request);
    return request;
  };

  const stream = createSse({
    url: client.streamUrl('/api/stream'),
    onState: (state) => store.set({ stream: state }),
    events: {
      manifest: (data) => {
        const manifest = parseJson<Manifest>(data);
        if (manifest) applyManifest(manifest);
      },
      file: (data) => {
        const payload = parseJson<FilePayload>(data);
        if (!payload) return;
        setFileState(payload.id, { status: 'loaded' });
        bus.emit('file:payload', payload);
      },
    },
  });

  disposer.add(stream.destroy);

  return {
    start() {
      void client
        .session()
        .then((session) => {
          store.set({
            session,
            commentsEnabled: session.comments,
            view: session.defaults.view,
            wrap: session.defaults.wrap,
          });
        })
        .catch((error: unknown) => {
          store.set({ notice: describe(error) });
        });

      void client
        .manifest()
        .then(applyManifest)
        .catch((error: unknown) => {
          store.set({ notice: describe(error) });
        });

      stream.connect();
    },
    loadFile,
    destroy: disposer.dispose,
  };
};
