import type { Disposable } from '../core/component';

export type StreamState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'retrying'
  | 'done'
  | 'closed';

export interface SseSource {
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
}

export type SseEventHandler = (data: string) => void;

export interface SseOptions {
  url: string;
  events?: Record<string, SseEventHandler>;
  onState?: (state: StreamState) => void;
  minDelay?: number;
  maxDelay?: number;
  create?: (url: string) => SseSource;
}

export interface SseClient extends Disposable {
  state(): StreamState;
  connect(): void;
  stop(): void;
}

const defaultCreate = (url: string): SseSource => new EventSource(url);

const messageData = (event: Event): string => {
  const data = (event as MessageEvent<unknown>).data;
  return typeof data === 'string' ? data : '';
};

export const createSse = ({
  url,
  events = {},
  onState,
  minDelay = 500,
  maxDelay = 15000,
  create,
}: SseOptions): SseClient => {
  const factory = create ?? (typeof EventSource === 'undefined' ? null : defaultCreate);
  let source: SseSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let state: StreamState = 'idle';
  let destroyed = false;

  const setState = (next: StreamState): void => {
    if (state === next) return;
    state = next;
    if (onState) onState(next);
  };

  const clearTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const closeSource = (): void => {
    if (!source) return;
    source.close();
    source = null;
  };

  const backoff = (): number => {
    const exponential = minDelay * 2 ** Math.min(attempt, 6);
    const capped = Math.min(exponential, maxDelay);
    return Math.round(capped * (0.7 + Math.random() * 0.6));
  };

  const scheduleRetry = (): void => {
    if (destroyed) return;
    setState('retrying');
    const delay = backoff();
    attempt += 1;
    clearTimer();
    timer = setTimeout(connect, delay);
  };

  function connect(): void {
    if (destroyed) return;
    clearTimer();
    closeSource();
    if (!factory) {
      setState('closed');
      return;
    }
    setState('connecting');
    const next = factory(url);
    source = next;
    next.addEventListener('open', () => {
      if (destroyed || source !== next) return;
      attempt = 0;
      setState('open');
    });
    next.addEventListener('error', () => {
      if (destroyed || source !== next) return;
      closeSource();
      scheduleRetry();
    });
    for (const [type, handler] of Object.entries(events)) {
      next.addEventListener(type, (event) => {
        if (destroyed || source !== next) return;
        handler(messageData(event));
      });
    }
  }

  return {
    state: () => state,
    connect,
    stop() {
      if (destroyed) return;
      clearTimer();
      closeSource();
      attempt = 0;
      setState('done');
    },
    destroy() {
      destroyed = true;
      clearTimer();
      closeSource();
      setState('closed');
    },
  };
};
