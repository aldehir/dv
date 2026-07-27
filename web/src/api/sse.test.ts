import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SseSource } from './sse';
import { createSse } from './sse';

class FakeSource implements SseSource {
  static instances: FakeSource[] = [];
  readonly url: string;
  closed = false;
  private readonly listeners = new Map<string, ((event: Event) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(listener);
    this.listeners.set(type, bucket);
  }

  close(): void {
    this.closed = true;
  }

  fire(type: string, data?: string): void {
    const event =
      data === undefined ? new Event(type) : new MessageEvent(type, { data });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const setup = () => {
  FakeSource.instances = [];
  const states: string[] = [];
  const files: string[] = [];
  const client = createSse({
    url: '/api/stream?token=t',
    minDelay: 100,
    maxDelay: 400,
    onState: (state) => states.push(state),
    events: { file: (data) => files.push(data) },
    create: (url) => new FakeSource(url),
  });
  return { client, states, files };
};

describe('createSse', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts idle and opens on connect', () => {
    const { client, states } = setup();
    expect(client.state()).toBe('idle');

    client.connect();
    expect(FakeSource.instances[0]?.url).toBe('/api/stream?token=t');
    expect(client.state()).toBe('connecting');

    FakeSource.instances[0]?.fire('open');
    expect(client.state()).toBe('open');
    expect(states).toEqual(['connecting', 'open']);
    client.destroy();
  });

  it('routes named events to their handlers', () => {
    const { client, files } = setup();
    client.connect();
    FakeSource.instances[0]?.fire('open');
    FakeSource.instances[0]?.fire('file', '{"id":"f1"}');
    expect(files).toEqual(['{"id":"f1"}']);
    client.destroy();
  });

  it('reconnects with growing backoff after errors', () => {
    const { client, states } = setup();
    client.connect();
    FakeSource.instances[0]?.fire('error');

    expect(states).toContain('retrying');
    expect(FakeSource.instances[0]?.closed).toBe(true);
    expect(FakeSource.instances.length).toBe(1);

    vi.advanceTimersByTime(100);
    expect(FakeSource.instances.length).toBe(2);

    FakeSource.instances[1]?.fire('error');
    vi.advanceTimersByTime(100);
    expect(FakeSource.instances.length).toBe(2);
    vi.advanceTimersByTime(100);
    expect(FakeSource.instances.length).toBe(3);

    FakeSource.instances[2]?.fire('open');
    expect(client.state()).toBe('open');
    client.destroy();
  });

  it('caps the backoff delay', () => {
    const { client } = setup();
    client.connect();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      FakeSource.instances[attempt]?.fire('error');
      vi.advanceTimersByTime(400);
    }
    expect(FakeSource.instances.length).toBe(9);
    client.destroy();
  });

  it('closes the source and cancels retries on destroy', () => {
    const { client, states } = setup();
    client.connect();
    FakeSource.instances[0]?.fire('error');
    client.destroy();

    expect(client.state()).toBe('closed');
    expect(states.at(-1)).toBe('closed');

    vi.advanceTimersByTime(5000);
    expect(FakeSource.instances.length).toBe(1);
  });

  it('stops retrying once the stream is stopped', () => {
    const { client, states } = setup();
    client.connect();
    FakeSource.instances[0]?.fire('open');
    client.stop();

    expect(client.state()).toBe('done');
    expect(states.at(-1)).toBe('done');
    expect(FakeSource.instances[0]?.closed).toBe(true);

    FakeSource.instances[0]?.fire('error');
    vi.advanceTimersByTime(5000);
    expect(FakeSource.instances.length).toBe(1);
    client.destroy();
  });

  it('ignores events from a superseded source', () => {
    const { client, files } = setup();
    client.connect();
    const first = FakeSource.instances[0];
    first?.fire('error');
    vi.advanceTimersByTime(100);

    first?.fire('file', 'stale');
    expect(files).toEqual([]);
    client.destroy();
  });

  it('reports closed when no EventSource implementation exists', () => {
    const client = createSse({ url: '/api/stream' });
    client.connect();
    expect(client.state()).toBe('closed');
    client.destroy();
  });
});
