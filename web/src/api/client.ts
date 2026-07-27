import type {
  Comment,
  CommentsResponse,
  FilePayload,
  Manifest,
  NewCommentRequest,
  PatchCommentRequest,
  Reply,
  Session,
} from './types';

export const TOKEN_HEADER = 'X-Dv-Token';
export const TOKEN_META_NAME = 'dv-token';
export const TOKEN_QUERY_PARAM = 'token';
export const TOKEN_PLACEHOLDER = '__DV_TOKEN__';

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly url: string;

  constructor(message: string, status: number, url: string, detail = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.detail = detail;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isUnreachable(): boolean {
    return this.status === 0;
  }

  get isUnauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export const readTokenFromDocument = (doc: Document = document): string => {
  const meta = doc.querySelector(`meta[name="${TOKEN_META_NAME}"]`);
  const value = meta?.getAttribute('content')?.trim() ?? '';
  return value === TOKEN_PLACEHOLDER ? '' : value;
};

export interface ApiClientOptions {
  baseUrl?: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
}

export interface ApiClient {
  readonly token: string;
  streamUrl(path: string): string;
  session(): Promise<Session>;
  manifest(): Promise<Manifest>;
  file(id: string): Promise<FilePayload>;
  comments(): Promise<CommentsResponse>;
  createComment(input: NewCommentRequest): Promise<Comment>;
  updateComment(id: string, input: PatchCommentRequest, etag?: string): Promise<Comment>;
  deleteComment(id: string, etag?: string): Promise<void>;
  addReply(id: string, body: string): Promise<Reply>;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  etag?: string;
  empty?: boolean;
}

const errorBody = async (response: Response): Promise<string> => {
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const parts = [record['error'], record['detail']].filter(
        (part): part is string => typeof part === 'string' && part !== '',
      );
      if (parts.length > 0) return parts.join(': ');
    }
  } catch {
    return '';
  }
  return '';
};

export const createClient = ({
  baseUrl = '',
  token = '',
  fetch: fetchImpl,
}: ApiClientOptions = {}): ApiClient => {
  const send = fetchImpl ?? globalThis.fetch.bind(globalThis);

  const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token !== '') headers[TOKEN_HEADER] = token;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.etag) headers['If-Match'] = options.etag;

    let response: Response;
    try {
      response = await send(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? null : JSON.stringify(options.body),
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new ApiError(`${path} is unreachable`, 0, url, reason);
    }

    if (!response.ok) {
      const detail = await errorBody(response);
      throw new ApiError(
        `${path} failed with ${response.status}`,
        response.status,
        url,
        detail,
      );
    }

    if (options.empty) return undefined as T;

    try {
      return (await response.json()) as T;
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new ApiError(`${path} returned invalid JSON`, response.status, url, reason);
    }
  };

  return {
    token,
    streamUrl(path) {
      const url = `${baseUrl}${path}`;
      if (token === '') return url;
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}${TOKEN_QUERY_PARAM}=${encodeURIComponent(token)}`;
    },
    session: () => request<Session>('/api/session'),
    manifest: () => request<Manifest>('/api/manifest'),
    file: (id) => request<FilePayload>(`/api/file/${encodeURIComponent(id)}`),
    comments: () => request<CommentsResponse>('/api/comments'),
    createComment: (input) =>
      request<Comment>('/api/comments', { method: 'POST', body: input }),
    updateComment: (id, input, etag) =>
      request<Comment>(`/api/comments/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: input,
        etag,
      }),
    deleteComment: (id, etag) =>
      request<void>(`/api/comments/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        etag,
        empty: true,
      }),
    addReply: (id, body) =>
      request<Reply>(`/api/comments/${encodeURIComponent(id)}/replies`, {
        method: 'POST',
        body: { body },
      }),
  };
};
