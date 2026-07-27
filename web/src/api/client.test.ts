import { describe, expect, it, vi } from 'vitest';
import { ApiError, TOKEN_HEADER, createClient, readTokenFromDocument } from './client';

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

const fetchStub =
  (respond: () => Response) =>
  async (_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
    respond();

describe('readTokenFromDocument', () => {
  it('reads the token from the injected meta tag', () => {
    document.head.replaceChildren();
    const meta = document.createElement('meta');
    meta.name = 'dv-token';
    meta.content = ' abc123 ';
    document.head.appendChild(meta);
    expect(readTokenFromDocument()).toBe('abc123');
  });

  it('treats the build-time placeholder as no token', () => {
    document.head.replaceChildren();
    const meta = document.createElement('meta');
    meta.name = 'dv-token';
    meta.content = '__DV_TOKEN__';
    document.head.appendChild(meta);
    expect(readTokenFromDocument()).toBe('');
  });

  it('returns an empty token when the meta tag is missing', () => {
    document.head.replaceChildren();
    expect(readTokenFromDocument()).toBe('');
  });
});

describe('createClient', () => {
  it('sends the token header on every request', async () => {
    const fetchImpl = vi.fn(fetchStub(() => jsonResponse({ files: [], totals: {} })));
    const client = createClient({ token: 'secret', fetch: fetchImpl });
    await client.manifest();

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/manifest');
    expect(headers[TOKEN_HEADER]).toBe('secret');
  });

  it('omits the token header when no token is available', async () => {
    const fetchImpl = vi.fn(fetchStub(() => jsonResponse({})));
    const client = createClient({ fetch: fetchImpl });
    await client.session();

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(TOKEN_HEADER in (init.headers as Record<string, string>)).toBe(false);
  });

  it('encodes path parameters', async () => {
    const fetchImpl = vi.fn(fetchStub(() => jsonResponse({})));
    const client = createClient({ fetch: fetchImpl });
    await client.file('web/src/main.ts');
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/file/web%2Fsrc%2Fmain.ts');
  });

  it('passes the token to stream urls as a query parameter', () => {
    const client = createClient({ token: 's e/cret' });
    expect(client.streamUrl('/api/stream')).toBe('/api/stream?token=s%20e%2Fcret');
    expect(createClient().streamUrl('/api/stream')).toBe('/api/stream');
  });

  it('sends If-Match on comment mutations', async () => {
    const fetchImpl = vi.fn(fetchStub(() => jsonResponse({})));
    const client = createClient({ fetch: fetchImpl });
    await client.updateComment('cmt_1', { status: 'resolved' }, 'etag-1');

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['If-Match']).toBe('etag-1');
    expect(init.body).toBe('{"status":"resolved"}');
  });

  it('surfaces 409 conflicts distinctly', async () => {
    const fetchImpl = vi.fn(
      fetchStub(() =>
        jsonResponse({ error: 'conflict', detail: 'etag mismatch' }, { status: 409 }),
      ),
    );
    const client = createClient({ fetch: fetchImpl });

    const error = await client.comments().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.isConflict).toBe(true);
    expect(apiError.isUnreachable).toBe(false);
    expect(apiError.detail).toBe('conflict: etag mismatch');
  });

  it('reports an unreachable server as status 0', async () => {
    const fetchImpl = vi.fn(
      fetchStub(() => {
        throw new TypeError('failed to fetch');
      }),
    );
    const client = createClient({ fetch: fetchImpl });

    const error = (await client.session().catch((caught: unknown) => caught)) as ApiError;
    expect(error.status).toBe(0);
    expect(error.isUnreachable).toBe(true);
  });

  it('reports invalid JSON with the response status', async () => {
    const fetchImpl = vi.fn(fetchStub(() => new Response('not json', { status: 200 })));
    const client = createClient({ fetch: fetchImpl });

    const error = (await client.manifest().catch((caught: unknown) => caught)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(200);
  });

  it('does not parse a body for deletes', async () => {
    const fetchImpl = vi.fn(fetchStub(() => new Response(null, { status: 204 })));
    const client = createClient({ fetch: fetchImpl });
    await expect(client.deleteComment('cmt_1', 'etag-1')).resolves.toEqual({
      value: undefined,
      etag: '',
    });
  });

  it('surfaces the etag a mutation wrote', async () => {
    const fetchImpl = vi.fn(
      fetchStub(() =>
        jsonResponse(
          { id: 'cmt_1' },
          { status: 201, headers: { ETag: '"etag-2"', 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const client = createClient({ fetch: fetchImpl });

    const created = await client.createComment({
      anchor: { path: 'a.ts', side: 'additions', startLine: 1, endLine: 1 },
      body: 'hi',
    });
    expect(created.etag).toBe('etag-2');
    expect(created.value.id).toBe('cmt_1');
  });

  it('unwraps a weak etag on a bodyless response', async () => {
    const fetchImpl = vi.fn(
      fetchStub(() => new Response(null, { status: 204, headers: { ETag: 'W/"etag-3"' } })),
    );
    const client = createClient({ fetch: fetchImpl });
    const deleted = await client.deleteComment('cmt_1', 'etag-2');
    expect(deleted.etag).toBe('etag-3');
  });
});
